import {audit} from './operations.js';
import {authorizedCustomerOrder} from './customers.js';
const now=()=>Math.floor(Date.now()/1000);
export const bahTime=t=>({weekday:new Date((t+10800)*1000).getUTCDay(),minute:Math.floor(((t+10800)%86400)/60)});
export const seasonalSQL="(available_from IS NULL OR available_from<=CAST(strftime('%s','now') AS INTEGER)) AND (available_until IS NULL OR available_until>CAST(strftime('%s','now') AS INTEGER))";
export async function branchWindow(env,s,branch,t){
 const local=bahTime(t),hours=await env.DB.prepare('SELECT * FROM branch_hours WHERE branch_id=? AND weekday=?').bind(branch.id,local.weekday).first();
 const opening=Math.max(s.opening_hour*60,hours?.opening_minute??branch.opening_hour*60),closing=Math.min((s.closing_hour??24)*60,hours?.closing_minute??branch.closing_hour*60);
 return {opening,closing,open:!!branch.active&&!hours?.closed&&local.minute>=opening&&local.minute<closing};
}
export async function validateSchedule(env,s,branch,scheduled,prepMinutes,fail,time=now()){
 if(scheduled===null)return null;
 if(!Number.isSafeInteger(scheduled)||scheduled%900!==0||scheduled<time+Math.max(15,prepMinutes)*60||scheduled>time+(s.schedule_days??7)*86400)fail('اختر موعدًا متاحًا بفاصل ربع ساعة، بعد ١٥ دقيقة على الأقل وضمن الأيام المتاحة');
 if(!(await branchWindow(env,s,branch,scheduled)).open)fail('الموعد خارج ساعات عمل الفرع',409);
 const r=await env.DB.prepare("SELECT COUNT(*) n FROM orders WHERE branch_id=? AND scheduled_at=? AND status!='cancelled'").bind(branch.id,scheduled).first();if(r.n>=s.slot_capacity)fail('اكتمل هذا الموعد. اختر موعدًا آخر',409);
 return scheduled-prepMinutes*60;
}
async function read(req,h){const b=await h.body(req);if(!b||typeof b!=='object'||Array.isArray(b))h.fail('بيانات غير صالحة');return b;}
export async function planningRoutes(req,env,h,actor=null){
 const url=new URL(req.url),p=url.pathname,m=req.method,{json,fail,text,rate,customer}=h;
 if(p==='/api/availability'&&m==='GET'){
  const s=await env.DB.prepare('SELECT * FROM settings WHERE id=1').first(),branch=await env.DB.prepare('SELECT * FROM branches WHERE id=? AND active=1').bind((url.searchParams.get('branch')||'main').slice(0,40)).first();if(!branch)fail('الفرع غير موجود',404);
  const time=now(),slots=[],prep=Number(url.searchParams.get('prep')||15);if(!Number.isInteger(prep)||prep<1||prep>120)fail('وقت تحضير غير صالح');
  const reservations=(await env.DB.prepare("SELECT scheduled_at,COUNT(*) n FROM orders WHERE branch_id=? AND scheduled_at>=? AND status!='cancelled' GROUP BY scheduled_at").bind(branch.id,time).all()).results;
  const hours=(await env.DB.prepare('SELECT * FROM branch_hours WHERE branch_id=?').bind(branch.id).all()).results;
  for(let t=Math.ceil((time+Math.max(15,prep)*60)/900)*900;t<=time+s.schedule_days*86400&&slots.length<250;t+=900){const local=bahTime(t),day=hours.find(d=>d.weekday===local.weekday),opening=Math.max(s.opening_hour*60,day?.opening_minute??branch.opening_hour*60),closing=Math.min(s.closing_hour*60,day?.closing_minute??branch.closing_hour*60),used=reservations.find(x=>x.scheduled_at===t)?.n||0;if(!day?.closed&&local.minute>=opening&&local.minute<closing&&used<s.slot_capacity)slots.push({at:t,remaining:s.slot_capacity-used});}
  return json({branch:branch.id,now_open:(await branchWindow(env,s,branch,time)).open,slots,receiving:!!s.accepting&&!s.maintenance,schedule_days:s.schedule_days});
 }
 if(p==='/api/order/arrived'&&m==='POST'){
  const b=await read(req,h),o=await authorizedCustomerOrder(env,customer,b.id,b.token,fail);if(!o)fail('بيانات متابعة الطلب غير صحيحة',404);if(o.fulfillment!=='curbside'||!['accepted','preparing','ready'].includes(o.status))fail('إشعار الوصول متاح لطلب السيارة المقبول فقط',409);await rate(env,'arrived:'+o.id,5,600);
  const r=await env.DB.prepare("UPDATE orders SET arrived_at=?,version=version+1 WHERE id=? AND arrived_at IS NULL AND fulfillment='curbside' AND status IN('accepted','preparing','ready') RETURNING arrived_at").bind(now(),o.id).first();if(r)await env.DB.prepare('INSERT INTO order_events(order_id,kind,status,created_at) VALUES(?,?,?,?)').bind(o.id,'arrived',o.status,r.arrived_at).run();const arrived=r?.arrived_at||(await env.DB.prepare('SELECT arrived_at FROM orders WHERE id=?').bind(o.id).first()).arrived_at;return json({ok:true,arrived_at:arrived});
 }
 if(p.startsWith('/api/admin/')&&['/api/admin/branch-hours','/api/admin/schedule-settings','/api/admin/product-season'].includes(p)){
  if(actor?.role!=='owner')fail('هذه العملية للمالك فقط',403);
  if(p==='/api/admin/branch-hours'){
   if(m==='GET')return json({hours:(await env.DB.prepare('SELECT * FROM branch_hours ORDER BY branch_id,weekday').all()).results});
   if(m==='POST'){const b=await read(req,h),id=text(b.branch_id,1,40);if(!await env.DB.prepare('SELECT id FROM branches WHERE id=?').bind(id).first())fail('الفرع غير موجود',404);if(!Array.isArray(b.days)||b.days.length!==7||new Set(b.days.map(d=>d.weekday)).size!==7||b.days.some(d=>!Number.isInteger(d.weekday)||d.weekday<0||d.weekday>6||!Number.isInteger(d.opening_minute)||!Number.isInteger(d.closing_minute)||d.opening_minute<0||d.opening_minute>=1440||d.closing_minute>d.opening_minute+1440||d.closing_minute>1440||d.closing_minute<=d.opening_minute||typeof d.closed!=='boolean'))fail('تحقق من أيام وساعات الفرع');await env.DB.batch(b.days.map(d=>env.DB.prepare('INSERT INTO branch_hours VALUES(?,?,?,?,?) ON CONFLICT(branch_id,weekday) DO UPDATE SET opening_minute=excluded.opening_minute,closing_minute=excluded.closing_minute,closed=excluded.closed').bind(id,d.weekday,d.opening_minute,d.closing_minute,+d.closed)));await audit(env,actor,'branch_hours_updated',null,id);return json({ok:true});}
  }
  if(p==='/api/admin/schedule-settings'&&m==='POST'){const b=await read(req,h);if(!Number.isInteger(b.slot_capacity)||b.slot_capacity<1||b.slot_capacity>50||!Number.isInteger(b.schedule_days)||b.schedule_days<1||b.schedule_days>7)fail('السعة من ١ إلى ٥٠، والجدولة من يوم إلى ٧ أيام');await env.DB.prepare('UPDATE settings SET slot_capacity=?,schedule_days=? WHERE id=1').bind(b.slot_capacity,b.schedule_days).run();await audit(env,actor,'schedule_settings');return json({ok:true});}
  if(p==='/api/admin/product-season'&&m==='POST'){const b=await read(req,h),id=text(b.id,1,80);for(const key of ['available_from','available_until'])if(b[key]!==null&&(!Number.isSafeInteger(b[key])||b[key]<0))fail('وقت موسمي غير صالح');if(b.available_from!==null&&b.available_until!==null&&b.available_until<=b.available_from||typeof b.featured!=='boolean'||!Number.isInteger(b.prep_minutes)||b.prep_minutes<1||b.prep_minutes>120)fail('تحقق من فترة العرض ووقت التحضير');const r=await env.DB.prepare('UPDATE products SET available_from=?,available_until=?,featured=?,seasonal_label=?,prep_minutes=? WHERE id=?').bind(b.available_from,b.available_until,+b.featured,text(b.seasonal_label||'',0,40),b.prep_minutes,id).run();if(!r.meta.changes)fail('المشروب غير موجود',404);await audit(env,actor,'product_season_updated',null,id);return json({ok:true});}
 }
 return null;
}
