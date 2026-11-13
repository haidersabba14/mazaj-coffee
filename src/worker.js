const statuses=['new','preparing','ready','delivered','cancelled'];
export const statusNames={new:'بانتظار القبول',preparing:'قيد التجهيز',ready:'جاهز للاستلام',delivered:'تم التسليم',cancelled:'ملغي'};
export const bahrainDate=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bahrain',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
export const pricing=(s)=>({basePrice:2000,promotion:s.promotion_date===bahrainDate(),currency:'BHD'});
const money=n=>(n/1000).toFixed(3)+' د.ب.';
const now=()=>Math.floor(Date.now()/1000);
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export const hash=async s=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export function isOpen(s,date=new Date()){return !!s.accepting&&Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bahrain',hour:'numeric',hourCycle:'h23'}).format(date))>=s.opening_hour;}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function emailHtml(o){return `<html lang="ar" dir="rtl"><body style="background:#171512;color:#eee4d4;font-family:Arial;padding:32px"><h1 style="color:#c7a66b">☕ طلب قهوة جديد</h1><p>رقم الطلب: ${esc(o.id)}</p><table cellpadding="12" style="border:1px solid #b39159;border-collapse:collapse;width:100%">${[['العميل',o.name],['الهاتف',o.phone],['التاريخ والوقت — البحرين',new Date(o.created_at*1000).toLocaleString('ar-BH',{timeZone:'Asia/Bahrain'})],...JSON.parse(o.items).map(i=>[i.name,i.quantity]),['الملاحظات',o.notes||'لا توجد'],['الاستلام','من المقهى'],['الإجمالي',money(o.total)],['الدفع',o.total===0?'مجاني — عرض اليوم':'عند الاستلام'],['الحالة','جديد — بانتظار القبول']].map(r=>`<tr><th style="text-align:right;border-bottom:1px solid #55452e">${esc(r[0])}</th><td style="border-bottom:1px solid #55452e">${esc(r[1])}</td></tr>`).join('')}</table></body></html>`;}
async function notify(env,id){
 const lease=await env.DB.prepare("UPDATE orders SET email_status='sending',email_attempts=email_attempts+1,email_updated=? WHERE id=? AND email_status!='sent' AND (email_status!='sending' OR email_updated<?) RETURNING *").bind(now(),id,now()-120).first();
 if(!lease)return;
 let state='failed';
 try{
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)throw Error('unconfigured');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`order-${id}`},body:JSON.stringify({from:env.EMAIL_FROM,to:['haider.sabba@icloud.com'],subject:`☕ طلب قهوة جديد — ${id}`,html:emailHtml(lease)}),signal:AbortSignal.timeout(12000)});
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
async function appAccess(req,env){
 const token=req.headers.get('X-Mazaj-App-Key');
 if(!env.ADMIN_APP_TOKEN||!token||token.length>128)fail('الصفحة غير موجودة',404);
 const a=await hash(token),b=await hash(env.ADMIN_APP_TOKEN);let diff=0;
 for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 if(diff)fail('الصفحة غير موجودة',404);
}
async function admin(req,env){const token=(req.headers.get('cookie')||'').match(/(?:^|; )session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token||!await env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?').bind(await hash(token),now()).first())fail('يرجى تسجيل الدخول',401);}
async function checkTurnstile(req,env,token){if(!env.TURNSTILE_SECRET||!env.TURNSTILE_SITE_KEY||!env.RATE_SALT)fail('استقبال الطلبات غير مهيأ بعد.',503);const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:text(token,1,2048),remoteip:req.headers.get('CF-Connecting-IP')||''}),signal:AbortSignal.timeout(10000)});const result=await response.json();if(!result.success||result.hostname!==new URL(req.url).hostname||result.action!=='checkout')fail('تعذر التحقق الأمني، أعد المحاولة.',403);}
async function route(req,env,ctx){
 const url=new URL(req.url),p=url.pathname,m=req.method;const ip=req.headers.get('CF-Connecting-IP')||'local';
 if(/^\/admin(?:[./]|$)/i.test(p))fail('الصفحة غير موجودة',404);
 if(p==='/api/login'||p.startsWith('/api/admin/'))await appAccess(req,env);
 if(!p.startsWith('/api/'))return env.ASSETS.fetch(req);
 if(!env.DB)fail('قاعدة البيانات غير مهيأة',503);
 if(!['GET','HEAD'].includes(m)&&req.headers.get('Origin')!==url.origin)fail('مصدر الطلب غير مقبول',403);
 if(p==='/api/catalog'&&m==='GET'){const s=await env.DB.prepare('SELECT * FROM settings WHERE id=1').first();return json({products:(await env.DB.prepare('SELECT * FROM products WHERE available=1 ORDER BY sort').all()).results,settings:{...s,open:isOpen(s),configured:!!(env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET&&env.RATE_SALT)},pricing:pricing(s),siteKey:env.TURNSTILE_SITE_KEY||''});}
 if(p==='/api/orders'&&m==='POST'){
  const b=await body(req);const id=text(b.id,36,36),token=text(b.token,64,64);if(!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(token))fail('رمز الطلب غير صالح');
  const name=text(b.name,2,100),phone=text(b.phone,7,25),notes=text(b.notes||'',0,1000);if(!/^\+?[\d\s()-]{7,25}$/.test(phone))fail('رقم الهاتف غير صالح');
  if(!Array.isArray(b.items)||b.items.length<1||b.items.length>20)fail('السلة غير صالحة');
  const ids=new Set();for(const i of b.items){if(typeof i.id!=='string'||ids.has(i.id)||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>20)fail('الكميات غير صالحة');ids.add(i.id);}
  if(b.items.reduce((s,i)=>s+i.quantity,0)>30)fail('الحد الأقصى ٣٠ مشروبًا');
  const requestHash=await hash(JSON.stringify({name,phone,notes,items:b.items}));const tokenHash=await hash(token);
  const existing=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();if(existing){if(existing.token_hash!==tokenHash||existing.request_hash!==requestHash)fail('رقم طلب مستخدم',409);return json({id,status:existing.status,items:JSON.parse(existing.items),total:existing.total,subtotal:existing.subtotal});}
  await rate(env,`order:${ip}`,5,600);
  const s=await env.DB.prepare('SELECT * FROM settings WHERE id=1').first();if(!isOpen(s))fail(`استقبال الطلبات مغلق. نفتح الساعة ${s.opening_hour===15?'٣ عصرًا':s.opening_hour+':00'} بتوقيت البحرين.`,409);
  await checkTurnstile(req,env,b.turnstile);
  const products=(await env.DB.prepare('SELECT * FROM products WHERE available=1').all()).results;
  const items=b.items.map(i=>{const product=products.find(p=>p.id===i.id);if(!product)fail('أحد المشروبات لم يعد متاحًا');return {id:product.id,name:product.name,quantity:i.quantity,price:pricing(s).promotion?0:2000};});
  const subtotal=items.reduce((v,i)=>v+i.quantity*2000,0),total=items.reduce((v,i)=>v+i.quantity*i.price,0);
  if(b.expectedTotal!==total)fail('تغيّر العرض أو السعر. حدّث السلة وراجع الإجمالي قبل التأكيد.',409);
  const result=await env.DB.prepare('INSERT OR IGNORE INTO orders(id,token_hash,request_hash,name,phone,notes,items,created_at,subtotal,total) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,tokenHash,requestHash,name,phone,notes,JSON.stringify(items),now(),subtotal,total).run();
  if(!result.meta.changes){const prior=await env.DB.prepare('SELECT token_hash,request_hash FROM orders WHERE id=?').bind(id).first();if(prior?.token_hash!==tokenHash||prior?.request_hash!==requestHash)fail('تعارض الطلب',409);}
  ctx.waitUntil(notify(env,id));return json({id,status:'new',items,subtotal,total},201);
 }
 if(p==='/api/track'&&m==='POST'){await rate(env,`track:${ip}`,20,600);const b=await body(req);const o=await env.DB.prepare('SELECT id,status,items,created_at,total,subtotal FROM orders WHERE id=? AND token_hash=?').bind(text(b.id,36,36),await hash(text(b.token,64,64))).first();if(!o)fail('رقم الطلب أو رمز التحقق غير صحيح',404);return json({...o,items:JSON.parse(o.items)});}
 if(p==='/api/login'&&m==='POST'){
  if(!env.ADMIN_PASSWORD_HASH||!env.RATE_SALT)fail('دخول الإدارة غير مهيأ',503);await rate(env,`login:${ip}`,5,900);const b=await body(req);
  const [salt,expected]=env.ADMIN_PASSWORD_HASH.split(':');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(text(b.password,1,200)),'PBKDF2',false,['deriveBits']);const actual=hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256));
  const a=await hash(actual),e=await hash(expected);let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^e.charCodeAt(i);if(diff)fail('كلمة المرور غير صحيحة',401);
  const token=random();await env.DB.prepare('INSERT INTO sessions VALUES(?,?)').bind(await hash(token),now()+28800).run();return json({ok:true},200,{'Set-Cookie':`session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=28800`});
 }
 if(p.startsWith('/api/admin/')){
  await admin(req,env);
  if(p==='/api/admin/logout'&&m==='POST'){const t=(req.headers.get('cookie')||'').match(/session=([a-f0-9]{64})/)?.[1];await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(t||'')).run();return json({ok:true},200,{'Set-Cookie':'session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0'});}
  if(p==='/api/admin/data'&&m==='GET'){
   const q=(url.searchParams.get('q')||'').slice(0,100),status=url.searchParams.get('status')||'',date=url.searchParams.get('date')||'';
   if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('تاريخ غير صالح');
   const orders=await env.DB.prepare("SELECT id,name,phone,notes,items,status,created_at,email_status,email_attempts,total,subtotal FROM orders WHERE (id LIKE ? OR name LIKE ? OR phone LIKE ?) AND (?='' OR status=?) AND (?='' OR date(created_at+10800,'unixepoch')=?) ORDER BY created_at DESC LIMIT 200").bind(...Array(3).fill(`%${q}%`),status,status,date,date).all();
   const stats=await env.DB.prepare("SELECT SUM(date(created_at+10800,'unixepoch')=date('now','+3 hours')) daily, SUM(created_at>=?) weekly FROM orders").bind(now()-7*86400).first();
   const popular=await env.DB.prepare("SELECT json_extract(j.value,'$.name') name,SUM(json_extract(j.value,'$.quantity')) quantity FROM orders o,json_each(o.items) j WHERE o.status!='cancelled' GROUP BY name ORDER BY quantity DESC LIMIT 7").all();
   return json({orders:orders.results.map(o=>({...o,items:JSON.parse(o.items)})),stats,popular:popular.results,products:(await env.DB.prepare('SELECT * FROM products ORDER BY sort').all()).results,settings:await env.DB.prepare('SELECT * FROM settings WHERE id=1').first()});
  }
  const b=await body(req);
  if(p==='/api/admin/status'&&m==='POST'){if(!statuses.includes(b.status))fail('حالة غير صالحة');await env.DB.prepare('UPDATE orders SET status=? WHERE id=?').bind(b.status,text(b.id,36,36)).run();return json({ok:true});}
  if(p==='/api/admin/retry'&&m==='POST'){await notify(env,text(b.id,36,36));return json({ok:true});}
  if(p==='/api/admin/settings'&&m==='POST'){if(typeof b.accepting!=='boolean'||!Number.isInteger(b.opening_hour)||b.opening_hour<0||b.opening_hour>23)fail('إعداد غير صالح');await env.DB.prepare('UPDATE settings SET accepting=?,opening_hour=? WHERE id=1').bind(+b.accepting,b.opening_hour).run();return json({ok:true});}
  if(p==='/api/admin/product'&&m==='POST'){const image=text(b.image,1,1000);if(!/^\/images\/[a-zA-Z0-9_.-]+$/.test(image)){let u;try{u=new URL(image);}catch{fail('رابط صورة غير صالح');}if(u.protocol!=='https:'||u.username||u.password)fail('استخدم رابط صورة HTTPS');}if(!['hot','cold','signature'].includes(b.category)||typeof b.available!=='boolean')fail('بيانات المشروب غير صالحة');await env.DB.prepare('INSERT INTO products(id,name,description,category,image,available,sort) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,image=excluded.image,available=excluded.available').bind(text(b.id,1,80),text(b.name,2,100),text(b.description,1,300),b.category,image,+b.available,99).run();return json({ok:true});}
 }
 return json({error:'الصفحة غير موجودة'},404);
}
export default {
 async fetch(req,env,ctx){let r;try{r=await route(req,env,ctx);}catch(e){const status=e.status||500;if(status===500)console.error(JSON.stringify({event:'request_failed',path:new URL(req.url).pathname}));r=json({error:status===500?'تعذر إتمام العملية، حاول مجددًا.':e.message},status);}r=new Response(r.body,r);r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Frame-Options','DENY');r.headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');r.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");return r;},
 async scheduled(event,env,ctx){ctx.waitUntil((async()=>{await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now()),env.DB.prepare('DELETE FROM limits WHERE expires<?').bind(now()),env.DB.prepare('DELETE FROM orders WHERE created_at<?').bind(now()-30*86400)]);const jobs=await env.DB.prepare("SELECT id FROM orders WHERE email_status!='sent' AND email_attempts<5 ORDER BY created_at LIMIT 10").all();for(const j of jobs.results)await notify(env,j.id);})());}
};
