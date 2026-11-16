import {customerSuite} from './customer-suite.js';
import {reviewRoutes} from './reviews.js';
import {customerRoutes,customerFromRequest,authorizedCustomerOrder} from './customers.js';
import {operations,changeStatus,audit,orderLabel} from './operations.js';
import {enqueueNotification,processNotifications} from './notifications.js';
export const statusNames={new:'بانتظار القبول',accepted:'مقبول',preparing:'قيد التجهيز',ready:'جاهز للاستلام',delivered:'تم التسليم',cancelled:'ملغي'};
export const bahrainDate=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bahrain',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
export const bahrainWeekday=(d=new Date())=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bahrain',weekday:'short'}).format(d));
export const pricing=(s,d=new Date())=>({basePrice:2000,promotion:s.all_free!==0||bahrainWeekday(d)===(s.promotion_weekday??5),promotionWeekday:s.promotion_weekday??5,currency:'BHD'});
const money=n=>(n/1000).toFixed(3)+' د.ب.';
const now=()=>Math.floor(Date.now()/1000);
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export const hash=async s=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export function isOpen(s,date=new Date()){return !!s.accepting&&!s.maintenance&&Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bahrain',hour:'numeric',hourCycle:'h23'}).format(date))>=s.opening_hour&&Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bahrain',hour:'numeric',hourCycle:'h23'}).format(date))<(s.closing_hour??24);}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function emailHtml(o){return `<html lang="ar" dir="rtl"><body style="background:#171512;color:#eee4d4;font-family:Arial;padding:32px"><h1 style="color:#c7a66b">☕ طلب قهوة جديد</h1><p>رقم الطلب: ${esc(orderLabel(o))}</p><table cellpadding="12" style="border:1px solid #b39159;border-collapse:collapse;width:100%">${[['العميل',o.name],['الهاتف',o.phone],['التاريخ والوقت — البحرين',new Date(o.created_at*1000).toLocaleString('ar-BH',{timeZone:'Asia/Bahrain'})],...JSON.parse(o.items).map(i=>[i.name,i.quantity]),['الملاحظات',o.notes||'لا توجد'],['الاستلام',o.fulfillment==='delivery'?'توصيل للبيت — مجانًا':'من المقهى'],['العنوان',o.fulfillment==='delivery'?o.address||'الموقع المحدد على الخريطة':'لا يوجد'],...(o.fulfillment==='delivery'?[['موقع التوصيل',`https://www.google.com/maps?q=${o.location_lat},${o.location_lng}`]]:[]),['الإجمالي',money(o.total)],['الدفع',o.total===0?'مجاني — عرض اليوم':'عند الاستلام'],['الحالة','جديد — بانتظار القبول']].map(r=>`<tr><th style="text-align:right;border-bottom:1px solid #55452e">${esc(r[0])}</th><td style="border-bottom:1px solid #55452e">${esc(r[1])}</td></tr>`).join('')}</table></body></html>`;}
async function notify(env,id){
 const lease=await env.DB.prepare("UPDATE orders SET email_status='sending',email_attempts=email_attempts+1,email_updated=? WHERE id=? AND email_status!='sent' AND (email_status!='sending' OR email_updated<?) RETURNING *").bind(now(),id,now()-120).first();
 if(!lease)return;
 let state='failed';
 try{
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)throw Error('unconfigured');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`order-${id}`},body:JSON.stringify({from:env.EMAIL_FROM,to:['haider.sabba@icloud.com'],subject:`☕ طلب قهوة جديد — ${orderLabel(lease)}`,html:emailHtml(lease)}),signal:AbortSignal.timeout(12000)});
  if(r.ok)state='sent';
 }catch{console.warn(JSON.stringify({event:'email_delivery_failed',order:id}));}
 await env.DB.prepare('UPDATE orders SET email_status=?,email_updated=? WHERE id=?').bind(state,now(),id).run();
}
async function rate(env,key,max,seconds){
 const slot=Math.floor(now()/seconds);const k=await hash(`${env.RATE_SALT}:${key}:${slot}`);
 const row=await env.DB.prepare('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(k,now()+seconds).first();
 if(row.count>max)fail('محاولات كثيرة، يرجى الانتظار قليلًا.',429);
}
async function body(req){if(!(req.headers.get('content-type')||'').includes('application/json'))fail('نوع طلب غير مقبول',415);const reader=req.body?.getReader();let size=0,parts=[];if(!reader)fail('بيانات مفقودة');while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16000){await reader.cancel();fail('الطلب كبير جدًا',413);}parts.push(value);}try{return JSON.parse(new TextDecoder().decode(new Uint8Array(parts.flatMap(p=>Array.from(p)))));}catch{fail('بيانات غير صالحة');}}
function text(v,min,max){if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)fail('يرجى التحقق من البيانات المدخلة');return v.trim();}
async function admin(req,env){
 const token=(req.headers.get('cookie')||'').match(/(?:^|; )session=([a-f0-9]{64})(?:;|$)/)?.[1];
 const session=token?await env.DB.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').bind(await hash(token),now()).first():null;
 if(!session)fail('يرجى تسجيل الدخول',401);
 if(session.user_id==='owner')return {id:'owner',name:'المالك',role:'owner',session_hash:session.token_hash};
 const user=await env.DB.prepare('SELECT id,name,role FROM staff WHERE id=? AND active=1').bind(session.user_id).first();if(!user)fail('الحساب موقوف',401);return {...user,session_hash:session.token_hash};
}
async function checkTurnstile(req,env,token,action='checkout'){if(!env.TURNSTILE_SECRET||!env.TURNSTILE_SITE_KEY||!env.RATE_SALT)fail('استقبال الطلبات غير مهيأ بعد.',503);const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:text(token,1,2048),remoteip:req.headers.get('CF-Connecting-IP')||''}),signal:AbortSignal.timeout(10000)});const result=await response.json();if(!result.success||result.hostname!==new URL(req.url).hostname||result.action!==action)fail('تعذر التحقق الأمني، أعد المحاولة.',403);}
async function route(req,env,ctx){
 const url=new URL(req.url),p=url.pathname,m=req.method;const ip=req.headers.get('CF-Connecting-IP')||'local';
 if(!p.startsWith('/api/')&&env.CANONICAL_ORIGIN&&url.origin!==env.CANONICAL_ORIGIN)return Response.redirect(env.CANONICAL_ORIGIN+p+url.search,302);
 if(/^\/admin(?:[./]|$)/i.test(p))fail('الصفحة غير موجودة',404);
 if(!p.startsWith('/api/'))return env.ASSETS.fetch(req);
 if(!env.DB)fail('قاعدة البيانات غير مهيأة',503);
 if(!['GET','HEAD'].includes(m)&&req.headers.get('Origin')!==url.origin)fail('مصدر الطلب غير مقبول',403);
 const customer=await customerFromRequest(req,env);const helpers={body,text,fail,json,hash,rate,checkTurnstile,customer};const suiteResponse=await customerSuite(req,env,helpers);if(suiteResponse)return suiteResponse;const accountResponse=await customerRoutes(req,env,helpers);if(accountResponse)return accountResponse;
 const reviewResponse=await reviewRoutes(req,env,helpers);if(reviewResponse)return reviewResponse;
 if(!p.startsWith('/api/admin/')){const extra=await operations(req,env,ctx,helpers);if(extra)return extra;}
 if(p==='/api/catalog'&&m==='GET'){const s=await env.DB.prepare('SELECT * FROM settings WHERE id=1').first();return json({products:(await env.DB.prepare('SELECT id,name,description,category,image,available,sort,(SELECT COUNT(*) FROM drink_ratings WHERE product_id=products.id) rating_count,(SELECT ROUND(AVG(stars),1) FROM drink_ratings WHERE product_id=products.id) rating_average FROM products WHERE available=1 AND stock!=0 AND NOT EXISTS(SELECT 1 FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=products.id AND (i.active=0 OR i.stock_milli<r.quantity_milli)) ORDER BY sort').all()).results,settings:{accepting:s.accepting,opening_hour:s.opening_hour,closing_hour:s.closing_hour,brand_name:s.brand_name,busy_mode:s.busy_mode,maintenance:s.maintenance,open:isOpen(s),configured:!!(env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET&&env.RATE_SALT)},pricing:pricing(s),siteKey:env.TURNSTILE_SITE_KEY||'',branches:(await env.DB.prepare('SELECT id,name FROM branches WHERE active=1').all()).results});}
 if(p==='/api/orders'&&m==='POST'){
  const b=await body(req);const id=text(b.id,36,36),token=text(b.token,64,64);if(!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(token))fail('رمز الطلب غير صالح');
  const name=text(b.name,2,100),phone=text(b.phone,7,25),notes=text(b.notes||'',0,1000);
  const fulfillment=b.fulfillment||'pickup';if(!['pickup','delivery'].includes(fulfillment))fail('اختر طريقة استلام صحيحة');
  const address=fulfillment==='delivery'?text(b.address||'',0,300):'';
  const lat=fulfillment==='delivery'?b.location?.lat:null,lng=fulfillment==='delivery'?b.location?.lng:null;
  if(fulfillment==='delivery'&&(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat > 90||lng < -180||lng > 180))fail('حدد موقع البيت على الخريطة لإتمام التوصيل');if(!/^\+?[\d\s()-]{7,25}$/.test(phone))fail('رقم الهاتف غير صالح');
  const rewardCard=b.reward_card||null,limit=rewardCard?2:1;
  if(!Array.isArray(b.items)||b.items.length<1||b.items.length>limit||b.items.some(i=>typeof i.id!=='string'||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>limit)||new Set(b.items.map(i=>i.id)).size!==b.items.length||b.items.reduce((v,i)=>v+i.quantity,0)!==limit)fail(rewardCard?'اختر مشروبين فقط لمكافأة الولاء':'يسمح بمشروب واحد فقط وبكمية واحدة في كل طلب');
  const raw=b.customization||{};const customization={};for(const [key,allowed] of Object.entries({temperature:['hot','cold'],milk:['whole'],sugar:['none','light','normal','extra'],strength:['light','medium','strong'],size:['small','medium']})){if(raw[key]!==undefined&&!allowed.includes(raw[key]))fail('خيارات المشروب غير صالحة');if(raw[key])customization[key]=raw[key];}

  if(b.items.some(i=>['tea','arabic-coffee'].includes(i.id))){if(customization.sugar&&customization.sugar!=='normal')fail('الشاي والقهوة العربية بسكر عادي فقط');customization.sugar='normal';}
  const requestHash=await hash(JSON.stringify({name,phone,notes,items:b.items,fulfillment,address,lat,lng,customization,branchId:b.branch_id||'main',...(customer?{customerId:customer.id}:{}),rewardCardId:rewardCard?.id||null}));const tokenHash=await hash(token);
  const existing=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();if(existing){if(existing.token_hash!==tokenHash||existing.request_hash!==requestHash)fail('رقم طلب مستخدم',409);return json({id,order_number:existing.order_number,order_label:orderLabel(existing),status:existing.status,items:JSON.parse(existing.items),total:existing.total,subtotal:existing.subtotal,fulfillment:existing.fulfillment});}
  await rate(env,`order:${ip}`,5,600);
  const s=await env.DB.prepare('SELECT * FROM settings WHERE id=1').first();if(!isOpen(s))fail(`استقبال الطلبات مغلق. نفتح الساعة ${s.opening_hour===15?'٣ عصرًا':s.opening_hour+':00'} بتوقيت البحرين.`,409);
  await checkTurnstile(req,env,b.turnstile);
  const active=await env.DB.prepare("SELECT COUNT(*) n FROM orders WHERE status IN('new','accepted','preparing','ready')").first();if(active.n>=Math.max(1,Math.floor(s.capacity*(s.busy_mode?0.5:1))))fail('المقهى مشغول الآن، حاول بعد قليل.',409);
  const branchId=b.branch_id||'main';const branch=await env.DB.prepare('SELECT * FROM branches WHERE id=? AND active=1').bind(branchId).first();const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bahrain',hour:'numeric',hourCycle:'h23'}).format(new Date()));if(!branch||hour<branch.opening_hour||hour>=branch.closing_hour)fail('الفرع مغلق حاليًا',409);
  const products=(await env.DB.prepare('SELECT * FROM products WHERE available=1 AND stock!=0').all()).results;
  const items=b.items.map(i=>{const product=products.find(p=>p.id===i.id);if(!product)fail('أحد المشروبات لم يعد متاحًا');return {id:product.id,name:product.name,quantity:i.quantity,price:pricing(s).promotion?0:2000};});
  const subtotal=items.reduce((v,i)=>v+i.quantity*2000,0),total=items.reduce((v,i)=>v+i.quantity*i.price,0);
  if(b.expectedTotal!==total)fail('تغيّر العرض أو السعر. حدّث السلة وراجع الإجمالي قبل التأكيد.',409);
  let loyalty=null;if(rewardCard){loyalty=rewardCard.account===true&&customer?await env.DB.prepare('SELECT id,reward_drinks FROM loyalty_cards WHERE customer_id=? AND blocked=0').bind(customer.id).first():await env.DB.prepare('SELECT id,reward_drinks FROM loyalty_cards WHERE id=? AND token_hash=? AND blocked=0').bind(text(rewardCard.id,36,36),await hash(text(rewardCard.token,64,64))).first();if(!loyalty||loyalty.reward_drinks<2)fail('رصيد المكافأة لا يكفي لمشروبين',409);}
  const insert=env.DB.prepare('INSERT OR IGNORE INTO orders(id,token_hash,request_hash,name,phone,notes,items,created_at,subtotal,total,fulfillment,location_lat,location_lng,address,customization,customer_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,tokenHash,requestHash,name,phone,notes,JSON.stringify(items),now(),subtotal,total,fulfillment,lat,lng,address,JSON.stringify(customization),customer?.id||null);
  let result;try{if(loyalty){try{const out=await env.DB.batch([insert,env.DB.prepare('INSERT OR IGNORE INTO loyalty_redemptions(order_id,card_id,drinks) VALUES(?,?,2)').bind(id,loyalty.id)]);result=out[0];}catch(e){if(String(e).includes('loyalty_balance'))fail('تم استعمال المكافأة بالفعل، حدّث البطاقة',409);throw e;}}else result=await insert.run();}catch(e){if(String(e).includes('insufficient_ingredient'))fail('نفد أحد مكونات المشروب، اختر مشروبًا آخر',409);if(String(e).includes('capacity_full'))fail('المقهى مشغول الآن، حاول بعد قليل.',409);if(String(e).includes('insufficient_stock'))fail('نفد مخزون المشروب، اختر مشروبًا آخر',409);throw e;}
  if(!result.meta.changes){const prior=await env.DB.prepare('SELECT token_hash,request_hash FROM orders WHERE id=?').bind(id).first();if(prior?.token_hash!==tokenHash||prior?.request_hash!==requestHash)fail('تعارض الطلب',409);}
  await env.DB.prepare('UPDATE orders SET branch_id=? WHERE id=?').bind(branchId,id).run();
  let saved=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
  if(s.auto_accept&&saved.status==='new'){await env.DB.prepare("UPDATE orders SET status='accepted',accepted_at=?,estimated_ready_at=? WHERE id=? AND status='new'").bind(now(),now()+900,id).run();saved=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();}
  await audit(env,{id:'system'},'order_created',id);await enqueueNotification(env,saved,'new');ctx.waitUntil(Promise.all([notify(env,id),processNotifications(env)]));return json({id,order_number:saved.order_number,order_label:orderLabel(saved),status:saved.status,items,subtotal,total,fulfillment},201);
 }
 if(p==='/api/cards'&&m==='POST'){
  await rate(env,`card:${ip}`,5,600);const b=await body(req),name=text(b.name,2,80),contact=text(b.contact,4,30),id=text(b.id,36,36),token=text(b.token,64,64);
  if(!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(token))fail('بيانات البطاقة غير صالحة');
  const existing=await env.DB.prepare('SELECT * FROM loyalty_cards WHERE id=? AND token_hash=?').bind(id,await hash(token)).first();if(existing)return json(cardView(existing));
  const number=String(1000000+crypto.getRandomValues(new Uint32Array(1))[0]%9000000);
  await env.DB.prepare('INSERT INTO loyalty_cards(id,card_number,token_hash,name,contact_hash,created_at) VALUES(?,?,?,?,?,?)').bind(id,number,await hash(token),name,await hash(env.RATE_SALT+contact.replace(/\s/g,'')),now()).run();
  return json(cardView(await env.DB.prepare('SELECT * FROM loyalty_cards WHERE id=?').bind(id).first()),201);
 }
 if(p==='/api/card'&&m==='POST'){
  await rate(env,`card-read:${ip}`,40,600);const b=await body(req);const card=await env.DB.prepare('SELECT * FROM loyalty_cards WHERE id=? AND token_hash=? AND blocked=0').bind(text(b.id,36,36),await hash(text(b.token,64,64))).first();if(!card)fail('البطاقة غير موجودة أو الرمز غير صحيح',404);return json(cardView(card));
 }
 if(p==='/api/track'&&m==='POST'){const b=await body(req);const found=await authorizedCustomerOrder(env,customer,b.id,b.token,fail);const fields=['id','order_number','status','items','created_at','total','subtotal','fulfillment','estimated_ready_at','rejection_reason','called_at','acknowledged_at','notification_permission','ready_at','version','notes','customization','cancelled_by'];const o=found?Object.fromEntries(fields.map(k=>[k,found[k]])):null;if(!o){await rate(env,`track:${ip}`,20,600);fail('رقم الطلب أو رمز التحقق غير صحيح',404);}await rate(env,`track:${ip}:${o.id}`,90,600);return json({...o,order_label:orderLabel(o),items:JSON.parse(o.items),customization:JSON.parse(o.customization||'{}'),ratings:(await env.DB.prepare('SELECT product_id,stars FROM drink_ratings WHERE order_id=?').bind(o.id).all()).results,messages:(await env.DB.prepare('SELECT text,created_at FROM order_messages WHERE order_id=? ORDER BY created_at DESC LIMIT 20').bind(o.id).all()).results,notification:(await env.DB.prepare("SELECT state,attempts FROM notification_jobs WHERE order_id=? AND kind='ready'").bind(o.id).first())||null});}
 if(p==='/api/login'&&m==='POST'){
  if(!env.ADMIN_PASSWORD_HASH||!env.RATE_SALT)fail('دخول الإدارة غير مهيأ',503);await rate(env,`login:${ip}`,5,900);const b=await body(req);
  const ownerUsername=(env.ADMIN_USERNAME||'owner').trim().toLowerCase(),username=typeof b.username==='string'?b.username.trim().toLowerCase():(env.ADMIN_USERNAME?'':'owner');let user=null,credential=env.ADMIN_PASSWORD_HASH;if(username===ownerUsername)user={id:'owner',name:'المالك',role:'owner'};else if(username){const u=await env.DB.prepare('SELECT * FROM staff WHERE username=? AND active=1').bind(username).first();if(u){user={id:u.id,name:u.name,role:u.role};credential=u.password_hash;}}
  const [salt,expected]=credential.split(':');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(text(b.password,1,200)),'PBKDF2',false,['deriveBits']);const actual=hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256));
  const a=await hash(actual),e=await hash(expected);let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^e.charCodeAt(i);if(diff||!user)fail('بيانات الدخول غير صحيحة',401);
  const token=random();await env.DB.prepare('INSERT INTO sessions(token_hash,expires,user_id,created_at,device_name) VALUES(?,?,?,?,?)').bind(await hash(token),now()+28800,user.id,now(),String(b.device_name||'جهاز إدارة').slice(0,80)).run();await audit(env,user,'login');return json({ok:true,user},200,{'Set-Cookie':`session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=28800`});
 }
 if(p.startsWith('/api/admin/')){
  const actor=await admin(req,env);const extra=await operations(req,env,ctx,helpers,actor);if(extra)return extra;
  if(actor.role!=='owner'&&['/api/admin/settings','/api/admin/product','/api/admin/retry'].includes(p))fail('هذه العملية للمالك فقط',403);
  if(p==='/api/admin/logout'&&m==='POST'){const t=(req.headers.get('cookie')||'').match(/session=([a-f0-9]{64})/)?.[1];await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(t||'')).run();return json({ok:true},200,{'Set-Cookie':'session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0'});}
  if(p==='/api/admin/cards'&&m==='GET'){
   const number=(url.searchParams.get('number')||'').replace(/^MAZAJ:/,'').trim();const card=await env.DB.prepare('SELECT * FROM loyalty_cards WHERE card_number=?').bind(number).first();if(!card)fail('البطاقة غير موجودة',404);return json(cardView(card));
  }
  if(p==='/api/admin/stamp'&&m==='POST'){
   const b=await body(req),id=text(b.id,36,36),event=text(b.event_id,36,36);const card=await env.DB.prepare('SELECT id FROM loyalty_cards WHERE id=? AND blocked=0').bind(id).first();if(!card)fail('البطاقة غير موجودة',404);
   const stamped=await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO loyalty_events(id,card_id,kind,created_at) VALUES(?,?,'stamp',?)").bind(event,id,now()),env.DB.prepare('UPDATE loyalty_cards SET reward_drinks=reward_drinks+CASE WHEN stamps=4 THEN 2 ELSE 0 END,stamps=(stamps+1)%5,total_stamps=total_stamps+1 WHERE id=? AND changes()=1').bind(id)]);
   if(stamped[0].meta.changes)await audit(env,actor,'loyalty_stamp',null,id);return json(cardView(await env.DB.prepare('SELECT * FROM loyalty_cards WHERE id=?').bind(id).first()));
  }
  if(p==='/api/admin/data'&&m==='GET'){
   const q=(url.searchParams.get('q')||'').slice(0,100),status=url.searchParams.get('status')||'',date=url.searchParams.get('date')||'';
   if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('تاريخ غير صالح');
   const orders=await env.DB.prepare("SELECT id,order_number,name,phone,notes,items,status,created_at,email_status,email_attempts,total,subtotal,fulfillment,location_lat,location_lng,address,estimated_ready_at,rejection_reason,customization,accepted_at,preparation_started_at,ready_at,delivered_at,called_at,acknowledged_at,call_count,notification_permission,assigned_to,priority,queue_position,version,branch_id,archived FROM orders WHERE archived=0 AND (id LIKE ? OR name LIKE ? OR phone LIKE ? OR 'CR-'||order_number LIKE ?) AND (?='' OR status=?) AND (?='' OR date(created_at+10800,'unixepoch')=?) ORDER BY priority DESC,queue_position ASC,created_at DESC LIMIT 200").bind(...Array(4).fill(`%${q}%`),status,status,date,date).all();
   const stats=await env.DB.prepare("SELECT SUM(date(created_at+10800,'unixepoch')=date('now','+3 hours')) daily, SUM(created_at>=?) weekly,SUM(status='new' AND archived=0) waiting,SUM(status='preparing' AND archived=0) preparing,SUM(status='ready' AND archived=0) ready FROM orders").bind(now()-7*86400).first();
   const popular=await env.DB.prepare("SELECT json_extract(j.value,'$.name') name,SUM(json_extract(j.value,'$.quantity')) quantity FROM orders o,json_each(o.items) j WHERE o.status!='cancelled' GROUP BY name ORDER BY quantity DESC LIMIT 7").all();
   const notificationRows=(await env.DB.prepare("SELECT order_id,state,attempts FROM notification_jobs WHERE kind='ready'").all()).results;
   return json({user:{id:actor.id,name:actor.name,role:actor.role},orders:orders.results.map(o=>({...o,order_label:orderLabel(o),notification:notificationRows.find(n=>n.order_id===o.id)||null,items:JSON.parse(o.items),customization:JSON.parse(o.customization)})),stats,popular:popular.results,products:(await env.DB.prepare('SELECT * FROM products ORDER BY sort').all()).results,settings:await env.DB.prepare('SELECT * FROM settings WHERE id=1').first()});
  }
  const b=await body(req);
  if(p==='/api/admin/status'&&m==='POST')return changeStatus(env,ctx,actor,b,helpers);
  if(p==='/api/admin/retry'&&m==='POST'){await notify(env,text(b.id,36,36));return json({ok:true});}
  if(p==='/api/admin/settings'&&m==='POST'){if(typeof b.accepting!=='boolean'||!Number.isInteger(b.opening_hour)||b.opening_hour<0||b.opening_hour>23)fail('إعداد غير صالح');await env.DB.prepare('UPDATE settings SET accepting=?,opening_hour=? WHERE id=1').bind(+b.accepting,b.opening_hour).run();await audit(env,actor,'shop_settings');return json({ok:true});}
  if(p==='/api/admin/product'&&m==='POST'){const image=text(b.image,1,1000);if(!/^\/images\/[a-zA-Z0-9_.-]+$/.test(image)&&!/^\/api\/images\/[a-f0-9-]{36}$/.test(image)){let u;try{u=new URL(image);}catch{fail('رابط صورة غير صالح');}if(u.protocol!=='https:'||u.username||u.password)fail('استخدم رابط صورة HTTPS');}if(!['hot','cold','signature'].includes(b.category)||typeof b.available!=='boolean')fail('بيانات المشروب غير صالحة');await env.DB.prepare('INSERT INTO products(id,name,description,category,image,available,sort) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,image=excluded.image,available=excluded.available').bind(text(b.id,1,80),text(b.name,2,100),text(b.description,1,300),b.category,image,+b.available,99).run();await audit(env,actor,'product_updated',null,b.id);return json({ok:true});}
 }
 return json({error:'الصفحة غير موجودة'},404);
}
function cardView(c){return {id:c.id,card_number:c.card_number,name:c.name,stamps:c.stamps,reward_drinks:c.reward_drinks,total_stamps:c.total_stamps,remaining:5-c.stamps,wallet_available:false,account_linked:!!c.customer_id};}
export default {
 async fetch(req,env,ctx){let r;try{r=await route(req,env,ctx);}catch(e){const status=e.status||500;if(status===500)console.error(JSON.stringify({event:'request_failed',path:new URL(req.url).pathname}));r=json({error:status===500?'تعذر إتمام العملية، حاول مجددًا.':e.message},status);}r=new Response(r.body,r);r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Frame-Options','DENY');r.headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');r.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");return r;},
 async scheduled(event,env,ctx){ctx.waitUntil((async()=>{await processNotifications(env);await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now()),env.DB.prepare('DELETE FROM customer_sessions WHERE expires<?').bind(now()),env.DB.prepare('DELETE FROM limits WHERE expires<?').bind(now()),env.DB.prepare('DELETE FROM orders WHERE created_at<?').bind(now()-30*86400),env.DB.prepare('DELETE FROM audit_log WHERE created_at<?').bind(now()-90*86400),env.DB.prepare('DELETE FROM inventory_log WHERE created_at<?').bind(now()-90*86400),env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id IS NOT NULL AND session_hash NOT IN(SELECT token_hash FROM sessions)').bind()]);const jobs=await env.DB.prepare("SELECT id FROM orders WHERE email_status!='sent' AND email_attempts<5 ORDER BY created_at LIMIT 10").all();for(const j of jobs.results)await notify(env,j.id);})());}
};
