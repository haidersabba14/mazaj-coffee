import {validPushEndpoint,pushConfigured,apnsConfigured,enqueueNotification,processNotifications} from './notifications.js';
const now=()=>Math.floor(Date.now()/1000);
export const orderLabel=o=>o.order_number?'CR-'+o.order_number:o.id.slice(0,8);
export const allowedTransitions={new:['accepted','preparing','cancelled'],accepted:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['delivered','cancelled'],delivered:[],cancelled:[]};
export async function audit(env,actor,action,orderId=null,detail=''){await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor?.id||'owner',action,orderId,detail,now()).run();}
export async function passwordHash(password){const salt=crypto.randomUUID();const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256);return salt+':'+Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');}
export async function operations(req,env,ctx,h,actor=null){
 const {body,text,fail,json,hash,rate}=h,url=new URL(req.url),p=url.pathname,m=req.method,ip=req.headers.get('CF-Connecting-IP')||'local';
 async function owned(b){const o=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND token_hash=?').bind(text(b.id,36,36),await hash(text(b.token,64,64))).first();if(!o){await rate(env,`ownership:${ip}`,15,600);fail('بيانات متابعة الطلب غير صحيحة',404);}return o;}
 async function owner(){if(actor?.role!=='owner')fail('هذه العملية للمالك فقط',403);}
 if(p==='/api/push/config'&&m==='GET')return json({webPush:pushConfigured(env),publicKey:env.VAPID_PUBLIC_KEY||'',iosRequiresStandalone:true});
 if(p==='/api/push/subscribe'&&m==='POST'){
  const b=await body(req),o=await owned(b);await rate(env,`subscribe:${ip}:${o.id}`,8,600);
  const permission=['granted','denied','unsupported','default'].includes(b.permission)?b.permission:'unknown';
  await env.DB.prepare('UPDATE orders SET notification_permission=? WHERE id=?').bind(permission,o.id).run();
  if(!b.subscription)return json({ok:true,subscribed:false});if(!pushConfigured(env))fail('خدمة إشعارات الخلفية غير مهيأة',503);
  const sub=b.subscription;if(!validPushEndpoint(sub.endpoint)||!/^[A-Za-z0-9_-]{80,100}={0,2}$/.test(sub.keys?.p256dh||'')||!/^[A-Za-z0-9_-]{20,30}={0,2}$/.test(sub.keys?.auth||''))fail('اشتراك إشعارات غير صالح');
  const id=await hash(o.id+sub.endpoint);const count=await env.DB.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE order_id=? AND active=1 AND id!=?').bind(o.id,id).first();if(count.n>=3)fail('الحد الأقصى ثلاثة أجهزة لكل طلب',409);
  await env.DB.prepare("INSERT INTO push_subscriptions(id,order_id,channel,endpoint,keys,created_at) VALUES(?,?,'web',?,?,?) ON CONFLICT(id) DO UPDATE SET keys=excluded.keys,active=1").bind(id,o.id,sub.endpoint,JSON.stringify(sub.keys),now()).run();
  if(o.status==='ready'&&o.called_at){await env.DB.prepare("UPDATE notification_jobs SET state='pending',next_attempt=? WHERE order_id=? AND kind='ready' AND state='no_subscription'").bind(now(),o.id).run();ctx.waitUntil(processNotifications(env));}
  return json({ok:true,subscribed:true});
 }
 if(p==='/api/order/acknowledge'&&m==='POST'){
  const b=await body(req),o=await owned(b);if(!o.called_at||o.status!=='ready')fail('لا يوجد استدعاء جاهز للتأكيد',409);await env.DB.prepare('UPDATE orders SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=?').bind(now(),o.id).run();return json({ok:true,acknowledged_at:o.acknowledged_at||now()});
 }
 if(!p.startsWith('/api/admin/'))return null;
 if(p==='/api/admin/me'&&m==='GET')return json({user:{id:actor.id,name:actor.name,role:actor.role}});
 if(p==='/api/admin/events'&&m==='GET'){ctx.waitUntil(processNotifications(env));const data=await env.DB.prepare('SELECT COUNT(*)+COALESCE(MAX(created_at),0) cursor FROM audit_log').first();return json({cursor:data.cursor,server_time:now(),poll_after:5});}
 if(p==='/api/admin/audit'&&m==='GET'){await owner();return json({events:(await env.DB.prepare('SELECT a.*,COALESCE(s.name,\'المالك\') user_name FROM audit_log a LEFT JOIN staff s ON s.id=a.user_id ORDER BY a.created_at DESC LIMIT 200').all()).results});}
 if(p==='/api/admin/preferences'){
  if(m==='GET'){const r=await env.DB.prepare('SELECT settings FROM admin_preferences WHERE user_id=?').bind(actor.id).first();return json({settings:r?JSON.parse(r.settings):{}});}
  if(m==='POST'){const b=await body(req),s=b.settings||{},v={};for(const k of ['theme','accent','cards','view','tone','background','font','icons'])if(s[k]!==undefined)v[k]=text(s[k],1,40);if(s.accent&&!/^#[0-9a-fA-F]{6}$/.test(s.accent))fail('لون غير صالح');for(const k of ['sound','vibration'])if(typeof s[k]==='boolean')v[k]=s[k];if(s.volume!==undefined){if(!Number.isFinite(s.volume)||s.volume<0||s.volume>1)fail('مستوى صوت غير صالح');v.volume=s.volume;}for(const k of ['sections','shortcuts'])if(Array.isArray(s[k]))v[k]=s[k].slice(0,12).map(x=>text(x,1,30));await env.DB.prepare('INSERT INTO admin_preferences VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at').bind(actor.id,JSON.stringify(v),now()).run();return json({ok:true,settings:v});}
 }
 if(p==='/api/admin/sessions'&&m==='GET')return json({sessions:(await env.DB.prepare('SELECT substr(token_hash,1,16) id,created_at,expires,device_name FROM sessions WHERE user_id=? AND expires>? ORDER BY created_at DESC').bind(actor.id,now()).all()).results});
 if(p==='/api/admin/revoke-sessions'&&m==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash!=?').bind(actor.id,actor.session_hash).run();await audit(env,actor,'sessions_revoked');return json({ok:true});}
 if(p==='/api/admin/staff'){
  await owner();if(m==='GET')return json({staff:(await env.DB.prepare('SELECT id,username,name,role,active,created_at FROM staff ORDER BY created_at').all()).results});
  if(m==='POST'){const b=await body(req),id=b.id?text(b.id,36,36):crypto.randomUUID(),username=text(b.username,3,40).toLowerCase();if(!/^[a-z0-9_.-]+$/.test(username)||username==='owner')fail('اسم المستخدم غير صالح');const name=text(b.name,2,80),role=['staff','owner'].includes(b.role)?b.role:'staff',active=b.active===false?0:1;const old=await env.DB.prepare('SELECT id FROM staff WHERE id=?').bind(id).first();if(!old&&!b.password)fail('أدخل كلمة مرور');const pass=b.password?await passwordHash(text(b.password,10,200)):null;await env.DB.prepare('INSERT INTO staff VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,role=excluded.role,active=excluded.active,password_hash=COALESCE(?,staff.password_hash)').bind(id,username,name,pass||'',role,active,now(),pass).run();await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();await audit(env,actor,'staff_updated',null,id);return json({ok:true,id});}
 }
 if(p==='/api/admin/device'&&m==='POST'){
  const b=await body(req);if(!/^[a-f0-9]{64,200}$/.test(b.token||''))fail('رمز جهاز غير صالح');if(!apnsConfigured(env))fail('APNs غير مهيأ بعد؛ التنبيهات داخل التطبيق تعمل عند فتحه',503);const id=await hash(actor.id+b.token);await env.DB.prepare("INSERT INTO push_subscriptions(id,user_id,channel,endpoint,created_at,session_hash) VALUES(?,?,'apns',?,?,?) ON CONFLICT(id) DO UPDATE SET active=1,user_id=excluded.user_id,session_hash=excluded.session_hash").bind(id,actor.id,b.token,now(),actor.session_hash).run();return json({ok:true});
 }
 if(p==='/api/admin/notifications'&&m==='GET')return json({jobs:(await env.DB.prepare('SELECT id,order_id,kind,state,attempts,created_at FROM notification_jobs ORDER BY created_at DESC LIMIT 100').all()).results,attempts:(await env.DB.prepare('SELECT a.id,a.job_id,a.state,a.http_status,a.error_code,a.created_at FROM notification_attempts a ORDER BY a.created_at DESC LIMIT 100').all()).results});
 if(p==='/api/admin/diagnostics'&&m==='GET'){await owner();const db=await env.DB.prepare('SELECT 1 ok').first();return json({database:!!db.ok,webPush:pushConfigured(env),apns:apnsConfigured(env),email:!!(env.RESEND_API_KEY&&env.EMAIL_FROM),turnstile:!!(env.TURNSTILE_SECRET&&env.TURNSTILE_SITE_KEY),version:'3.0.0',server_time:now()});}
 if(p==='/api/admin/report'&&m==='GET'){
  await owner();const performance=(await env.DB.prepare("SELECT COALESCE(s.name,'غير مخصص') employee,COUNT(*) orders,ROUND(AVG(CASE WHEN o.delivered_at>0 THEN o.delivered_at-o.created_at END)/60.0,1) average_wait,ROUND(AVG(CASE WHEN o.ready_at>0 AND o.preparation_started_at>0 THEN o.ready_at-o.preparation_started_at END)/60.0,1) average_prep FROM orders o LEFT JOIN staff s ON s.id=o.assigned_to GROUP BY o.assigned_to").all()).results;const drinks=(await env.DB.prepare("SELECT json_extract(j.value,'$.name') drink,COUNT(*) orders,ROUND(AVG(o.ready_at-o.preparation_started_at)/60.0,1) average_prep FROM orders o,json_each(o.items) j WHERE o.ready_at>0 AND o.preparation_started_at>0 GROUP BY drink").all()).results;return json({performance,drinks});
 }
 if(p==='/api/admin/backup'&&m==='GET'){
  await owner();await rate(env,'backup:'+actor.id,3,3600);const snapshot={version:3,created_at:now(),tables:{}};for(const table of ['orders','products','settings','branches','loyalty_cards','loyalty_events','loyalty_redemptions','audit_log','order_messages'])snapshot.tables[table]=(await env.DB.prepare('SELECT * FROM '+table+' LIMIT 10000').all()).results;await audit(env,actor,'backup_exported');return new Response(JSON.stringify(snapshot),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="coffee-royal-private-backup.json"','Cache-Control':'no-store'}});
 }
 if(p==='/api/admin/export'&&m==='GET'){
  await owner();const rows=(await env.DB.prepare('SELECT order_number,status,created_at,accepted_at,ready_at,delivered_at,total,priority,branch_id FROM orders ORDER BY created_at DESC LIMIT 10000').all()).results;
  const columns=['order_number','status','created_at','accepted_at','ready_at','delivered_at','total','priority','branch_id'];return new Response('\uFEFF'+[columns.join(','),...rows.map(r=>columns.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(','))].join('\r\n'),{headers:{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="coffee-royal-report.csv"','Cache-Control':'no-store'}});
 }
 if(p==='/api/admin/branches'){
  if(m==='GET')return json({branches:(await env.DB.prepare('SELECT * FROM branches').all()).results});await owner();if(m==='POST'){const b=await body(req);for(const k of ['opening_hour','closing_hour'])if(!Number.isInteger(b[k])||b[k]<0||b[k]>24)fail('ساعات غير صالحة');if(b.closing_hour<=b.opening_hour)fail('الإغلاق يجب أن يكون بعد الفتح');await env.DB.prepare('INSERT INTO branches VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,opening_hour=excluded.opening_hour,closing_hour=excluded.closing_hour,active=excluded.active').bind(text(b.id,1,40),text(b.name,2,80),b.opening_hour,b.closing_hour,b.active===false?0:1).run();await audit(env,actor,'branch_updated');return json({ok:true});}
 }
 if(p==='/api/admin/operations-settings'&&m==='POST'){
  await owner();const b=await body(req);for(const k of ['busy_mode','maintenance','auto_accept'])if(typeof b[k]!=='boolean')fail('إعدادات غير صالحة');if(!Number.isInteger(b.capacity)||b.capacity<1||b.capacity>200)fail('سعة غير صالحة');if(!Number.isInteger(b.closing_hour)||b.closing_hour<1||b.closing_hour>24)fail('وقت إغلاق غير صالح');await env.DB.prepare('UPDATE settings SET busy_mode=?,maintenance=?,auto_accept=?,capacity=?,brand_name=?,closing_hour=? WHERE id=1').bind(+b.busy_mode,+b.maintenance,+b.auto_accept,b.capacity,text(b.brand_name,2,60),b.closing_hour).run();await audit(env,actor,'operations_settings');return json({ok:true});
 }
 if(p==='/api/admin/call'&&m==='POST'){
  const b=await body(req),id=text(b.id,36,36),o=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();if(!o)fail('الطلب غير موجود',404);if(o.status!=='ready')fail('حدد الطلب جاهزًا قبل الاستدعاء',409);
  const fresh=await env.DB.prepare('UPDATE orders SET called_at=?,call_count=1,version=version+1 WHERE id=? AND called_at IS NULL AND status=\'ready\' RETURNING *').bind(now(),id).first();const called=fresh||o;
  await enqueueNotification(env,called,'ready');if(fresh)await audit(env,actor,'customer_called',id);ctx.waitUntil(processNotifications(env));return json({ok:true,called_at:called.called_at,already_called:!fresh,acknowledged_at:called.acknowledged_at,notification:'queued'});
 }
 if(p==='/api/admin/notification-retry'&&m==='POST'){
  const b=await body(req);await rate(env,'retry:'+actor.id,8,600);const j=await env.DB.prepare("UPDATE notification_jobs SET state='retry',next_attempt=? WHERE id=? AND state IN('failed','retry','unconfigured','no_subscription') AND attempts<4 AND lease_until<? RETURNING id").bind(now(),text(b.id,36,36),now()).first();if(!j)fail('لا توجد محاولة قابلة للإعادة أو وصل الحد الآمن',409);await audit(env,actor,'notification_retry');ctx.waitUntil(processNotifications(env));return json({ok:true});
 }
 if(p==='/api/admin/message'&&m==='POST'){
  const b=await body(req),id=text(b.id,36,36),message=text(b.message,1,300),o=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();if(!o)fail('الطلب غير موجود',404);await rate(env,'message:'+id,3,600);const mid=crypto.randomUUID();await env.DB.prepare('INSERT INTO order_messages VALUES(?,?,?,?)').bind(mid,id,message,now()).run();await enqueueNotification(env,{...o,message},'message:'+mid);await audit(env,actor,'message_sent',id);ctx.waitUntil(processNotifications(env));return json({ok:true});
 }
 if(p==='/api/admin/queue'&&m==='POST'){
  const b=await body(req),id=text(b.id,36,36);if(!Number.isInteger(b.priority)||b.priority<0||b.priority>2||!Number.isInteger(b.position)||b.position<0||b.position>10000)fail('ترتيب غير صالح');if(b.assigned_to&&b.assigned_to!=='owner'&&!await env.DB.prepare('SELECT id FROM staff WHERE id=? AND active=1').bind(b.assigned_to).first())fail('موظف غير صالح');await env.DB.prepare('UPDATE orders SET priority=?,queue_position=?,assigned_to=?,version=version+1 WHERE id=?').bind(b.priority,b.position,b.assigned_to||null,id).run();await audit(env,actor,'queue_updated',id);return json({ok:true});
 }
 if(p==='/api/admin/archive'&&m==='POST'){await owner();const b=await body(req);const r=await env.DB.prepare("UPDATE orders SET archived=? WHERE id=? AND status IN('cancelled','delivered')").bind(b.archived===false?0:1,text(b.id,36,36)).run();if(!r.meta.changes)fail('يمكن أرشفة الطلبات المنتهية فقط',409);await audit(env,actor,'order_archived',b.id);return json({ok:true});}
 if(p==='/api/admin/stock'&&m==='POST'){
  await owner();const b=await body(req);if(!Number.isInteger(b.stock)||b.stock< -1||b.stock>100000)fail('مخزون غير صالح');const product=await env.DB.prepare('SELECT stock FROM products WHERE id=?').bind(text(b.id,1,80)).first();if(!product)fail('المشروب غير موجود',404);await env.DB.batch([env.DB.prepare('UPDATE products SET stock=? WHERE id=?').bind(b.stock,b.id),env.DB.prepare('INSERT INTO inventory_log VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),b.id,b.stock-product.stock,actor.id,now())]);await audit(env,actor,'stock_updated',null,b.id);return json({ok:true});
 }
 return null;
}
export async function changeStatus(env,ctx,actor,b,h){
 const {text,fail,json}=h,id=text(b.id,36,36),o=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();if(!o)fail('الطلب غير موجود',404);if(!allowedTransitions[b.status])fail('حالة غير صالحة');
 if(o.status===b.status){if(b.status==='ready'&&b.call!==false){await enqueueNotification(env,o,'ready');ctx.waitUntil(processNotifications(env));}return json({ok:true,unchanged:true});}
 if(!allowedTransitions[o.status]?.includes(b.status))fail('انتقال حالة غير مسموح، حدّث الطلب أولًا',409);
 const minutes=b.eta_minutes??15;if(['accepted','preparing'].includes(b.status)&&(!Number.isInteger(minutes)||minutes<1||minutes>120))fail('وقت التجهيز من دقيقة إلى ١٢٠ دقيقة');
 const reason=b.status==='cancelled'?text(b.reason||'تم رفض الطلب من المقهى',1,300):'';const t=now(),call=b.status==='ready'&&b.call!==false;
 const expected=b.version??o.version;
 const updated=await env.DB.prepare("UPDATE orders SET status=?,estimated_ready_at=CASE WHEN ? IN('accepted','preparing') THEN ? ELSE estimated_ready_at END,rejection_reason=?,accepted_at=CASE WHEN ? IN('accepted','preparing') THEN COALESCE(accepted_at,?) ELSE accepted_at END,preparation_started_at=CASE WHEN ?='preparing' THEN COALESCE(preparation_started_at,?) ELSE preparation_started_at END,ready_at=CASE WHEN ?='ready' THEN ? ELSE ready_at END,delivered_at=CASE WHEN ?='delivered' THEN ? ELSE delivered_at END,called_at=CASE WHEN ? THEN COALESCE(called_at,?) ELSE called_at END,call_count=CASE WHEN ? THEN 1 ELSE call_count END,version=version+1 WHERE id=? AND version=? RETURNING *").bind(b.status,b.status,t+minutes*60,reason,b.status,t,b.status,t,b.status,t,b.status,t,+call,t,+call,id,expected).first();
 if(!updated)fail('عدّل موظف آخر الطلب. حدّث الصفحة وحاول مجددًا.',409);await audit(env,actor,'status:'+b.status,id);
 const kind=call?'ready':b.status==='cancelled'?'cancelled':['accepted','preparing'].includes(b.status)?'accepted':null;if(kind){await enqueueNotification(env,updated,kind);ctx.waitUntil(processNotifications(env));}
 return json({ok:true,status:updated.status,version:updated.version,called_at:updated.called_at});
}
