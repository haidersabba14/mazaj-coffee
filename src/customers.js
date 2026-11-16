const now=()=>Math.floor(Date.now()/1000),encode=s=>new TextEncoder().encode(s);
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async s=>hex(await crypto.subtle.digest('SHA-256',encode(s)));
const cookieName='__Host-royal_customer',ttl=7*86400;
const cookie=(value,age=ttl)=>`${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const cookieToken=req=>(req.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-royal_customer=([a-f0-9]{64})(?:;|$)/)?.[1];
function view(c){return {id:c.id,username:c.username,name:c.name,phone:c.phone,created_at:c.created_at};}
async function keyed(env,value){const key=await crypto.subtle.importKey('raw',encode(env.CUSTOMER_AUTH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encode(value)));}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export async function customerPasswordHash(env,password,salt=random()){
 const peppered=await keyed(env,'customer-password-v1:'+password);
 const key=await crypto.subtle.importKey('raw',encode(peppered),'PBKDF2',false,['deriveBits']);
 const value=hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encode(salt),iterations:100000},key,256));
 return `v1:${salt}:${value}`;
}
export async function verifyCustomerPassword(env,password,stored){
 const [,salt]=String(stored||'').split(':');const actual=await customerPasswordHash(env,password,salt||'invalid-customer-credential');return equal(actual,stored);
}
export async function customerFromRequest(req,env){
 const token=cookieToken(req);if(!token)return null;
 return env.DB.prepare('SELECT c.id,c.username,c.name,c.phone,c.created_at,c.password_hash,c.recovery_hash,c.auth_version,s.token_hash session_hash FROM customer_sessions s JOIN customers c ON c.id=s.customer_id AND c.auth_version=s.auth_version WHERE s.token_hash=? AND s.expires>?').bind(await digest(token),now()).first();
}
// The same access check protects tracking, push subscription and acknowledgement.
// Account ownership is set by the server; a phone number never proves ownership.
export async function authorizedCustomerOrder(env,actor,id,token,fail){
 if(typeof id!=='string'||(!/^[a-f0-9-]{36}$/.test(id)&&!/^CR-\d{4,12}$/.test(id)))fail('رقم الطلب غير صالح');
 if(token!==undefined&&token!==null&&token!==''&&(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)))fail('رمز المتابعة غير صالح');
 const tokenHash=typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?await digest(token):'';
 return env.DB.prepare("SELECT * FROM orders WHERE (id=? OR 'CR-'||order_number=?) AND (token_hash=? OR (? IS NOT NULL AND customer_id=?))").bind(id,id,tokenHash,actor?.id||null,actor?.id||null).first();
}
export async function customerRoutes(req,env,h){
 const url=new URL(req.url),p=url.pathname,m=req.method;if(!p.startsWith('/api/customer/'))return null;
 const {body,text,fail,json,rate,checkTurnstile}=h,ip=req.headers.get('CF-Connecting-IP')||'local';
 const actor=h.customer;
 const requireActor=()=>{if(!actor)fail('سجّل دخول حسابك أولًا',401);return actor;};
 const configured=()=>{if(!env.CUSTOMER_AUTH_SECRET)fail('تسجيل العملاء غير مهيأ بعد',503);};
 const password=value=>{if(typeof value!=='string'||value.length<10||value.length>128)fail('كلمة المرور من ١٠ إلى ١٢٨ حرفًا');return value;};
 const username=value=>{if(typeof value==='string')value=value.trim();if(typeof value!=='string'||!/^[A-Za-z0-9_.-]{3,32}$/.test(value))fail('اسم المستخدم من ٣ إلى ٣٢ حرفًا إنجليزيًا أو رقمًا أو . أو _ أو -');return value.toLowerCase();};
 const phone=value=>{const s=text(value||'',0,25);if(s&&!/^\+?[\d\s()-]{7,25}$/.test(s))fail('رقم الهاتف غير صالح');return s;};
 const read=async()=>{const b=await body(req);if(!b||typeof b!=='object'||Array.isArray(b))fail('بيانات غير صالحة');return b;};
 const sessionStatement=async(c,token)=>env.DB.prepare('INSERT INTO customer_sessions VALUES(?,?,?,?,?)').bind(await digest(token),c.id,c.auth_version,now(),now()+ttl);
 if(p==='/api/customer/config'&&m==='GET')return json({configured:!!env.CUSTOMER_AUTH_SECRET,registration:!!(env.CUSTOMER_AUTH_SECRET&&env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET),siteKey:env.TURNSTILE_SITE_KEY||''});
 if(p==='/api/customer/me'&&m==='GET')return json({user:view(requireActor())});
 if(p==='/api/customer/logout'&&m==='POST'){
  const token=cookieToken(req);if(token)await env.DB.prepare('DELETE FROM customer_sessions WHERE token_hash=?').bind(await digest(token)).run();return json({ok:true},200,{'Set-Cookie':cookie('',0)});
 }
 if(p==='/api/customer/register'&&m==='POST'){
  configured();await rate(env,'customer-register:'+ip,5,3600);const b=await read(),user=username(b.username),pass=password(b.password),name=text(typeof b.name==='string'?b.name.trim()||user:b.name??user,2,100),contact=phone(b.phone);
  await checkTurnstile(req,env,b.turnstile,'customer-register');
  const id=crypto.randomUUID(),recovery=random(),token=random(),passwordHash=await customerPasswordHash(env,pass),recoveryHash=await keyed(env,'customer-recovery-v1:'+recovery),created=now();
  try{await env.DB.batch([env.DB.prepare('INSERT INTO customers(id,username,name,phone,password_hash,recovery_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,user,name,contact,passwordHash,recoveryHash,created,created),await sessionStatement({id,auth_version:0},token)]);}catch(err){if(String(err).includes('UNIQUE constraint failed: customers.username'))fail('اسم المستخدم مستخدم بالفعل، اختر اسمًا آخر',409);throw err;}
  return json({user:{id,username:user,name,phone:contact,created_at:created},recovery_code:recovery},201,{'Set-Cookie':cookie(token)});
 }
 if(p==='/api/customer/login'&&m==='POST'){
  configured();await rate(env,'customer-login:'+ip,10,900);const b=await read(),user=username(b.username);await rate(env,'customer-login-user:'+user,30,900);
  if(typeof b.password!=='string'||b.password.length<1||b.password.length>128)fail('اسم المستخدم أو كلمة المرور غير صحيحة',401);
  const c=await env.DB.prepare('SELECT * FROM customers WHERE username=?').bind(user).first();
  const valid=await verifyCustomerPassword(env,b.password,c?.password_hash);if(!valid||!c)fail('اسم المستخدم أو كلمة المرور غير صحيحة',401);
  const token=random();await(await sessionStatement(c,token)).run();return json({user:view(c)},200,{'Set-Cookie':cookie(token)});
 }
 if(p==='/api/customer/recover'&&m==='POST'){
  configured();await rate(env,'customer-recover:'+ip,5,900);const b=await read(),user=username(b.username),pass=password(b.new_password);
  if(typeof b.recovery_code!=='string'||!/^[a-f0-9]{64}$/.test(b.recovery_code))fail('بيانات الاسترداد غير صحيحة',401);
  const oldHash=await keyed(env,'customer-recovery-v1:'+b.recovery_code),c=await env.DB.prepare('SELECT id FROM customers WHERE username=? AND recovery_hash=?').bind(user,oldHash).first();if(!c)fail('بيانات الاسترداد غير صحيحة',401);
  const recovery=random(),newHash=await keyed(env,'customer-recovery-v1:'+recovery),passHash=await customerPasswordHash(env,pass);
  const result=await env.DB.batch([env.DB.prepare('UPDATE customers SET password_hash=?,recovery_hash=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND recovery_hash=?').bind(passHash,newHash,now(),c.id,oldHash),env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id=? AND EXISTS(SELECT 1 FROM customers WHERE id=? AND recovery_hash=?)').bind(c.id,c.id,newHash)]);
  if(!result[0].meta.changes)fail('استُخدم رمز الاسترداد بالفعل، استخدم الرمز الأحدث',409);
  return json({ok:true,recovery_code:recovery},200,{'Set-Cookie':cookie('',0)});
 }
 if(p==='/api/customer/profile'&&m==='POST'){
  requireActor();const b=await read();await env.DB.prepare('UPDATE customers SET name=?,phone=?,updated_at=? WHERE id=?').bind(text(b.name,2,100),phone(b.phone),now(),actor.id).run();const c=await env.DB.prepare('SELECT * FROM customers WHERE id=?').bind(actor.id).first();return json({user:view(c)});
 }
 if(p==='/api/customer/orders'&&m==='GET'){
  requireActor();const result=await env.DB.prepare('SELECT id,order_number,status,items,customization,created_at,total,fulfillment,estimated_ready_at,rejection_reason,called_at,acknowledged_at FROM orders WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(actor.id).all();return json({orders:result.results.map(o=>({...o,order_label:'CR-'+o.order_number,items:JSON.parse(o.items),customization:JSON.parse(o.customization)}))});
 }
 if(p==='/api/customer/claim-order'&&m==='POST'){
  requireActor();await rate(env,'customer-claim:'+ip,10,900);const b=await read();if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))fail('رمز متابعة الطلب مطلوب');
  const order=await authorizedCustomerOrder(env,null,b.id,b.token,fail);if(!order||order.customer_id&&order.customer_id!==actor.id)fail('تعذر ربط الطلب بهذا الحساب',404);
  const result=await env.DB.prepare('UPDATE orders SET customer_id=? WHERE id=? AND (customer_id IS NULL OR customer_id=?)').bind(actor.id,order.id,actor.id).run();if(!result.meta.changes)fail('الطلب مرتبط بحساب آخر',409);return json({ok:true});
 }
 if(p==='/api/customer/password'&&m==='POST'){
  configured();requireActor();await rate(env,'customer-password:'+actor.id,5,900);const b=await read(),pass=password(b.new_password);
  if(typeof b.current_password!=='string'||b.current_password.length>128||!await verifyCustomerPassword(env,b.current_password,actor.password_hash))fail('كلمة المرور الحالية غير صحيحة',401);
  const passHash=await customerPasswordHash(env,pass),recovery=random(),recoveryHash=await keyed(env,'customer-recovery-v1:'+recovery),token=random();
  const result=await env.DB.batch([
   env.DB.prepare('UPDATE customers SET password_hash=?,recovery_hash=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND password_hash=? AND auth_version=?').bind(passHash,recoveryHash,now(),actor.id,actor.password_hash,actor.auth_version),
   env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id=? AND EXISTS(SELECT 1 FROM customers WHERE id=? AND password_hash=?)').bind(actor.id,actor.id,passHash),
   env.DB.prepare('INSERT INTO customer_sessions SELECT ?,id,auth_version,?,? FROM customers WHERE id=? AND password_hash=?').bind(await digest(token),now(),now()+ttl,actor.id,passHash)
  ]);if(!result[0].meta.changes)fail('تغيّر الحساب، سجّل دخولك مجددًا',409);
  return json({ok:true,recovery_code:recovery},200,{'Set-Cookie':cookie(token)});
 }
 if(p==='/api/customer/revoke-sessions'&&m==='POST'){
  requireActor();await env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id=? AND token_hash!=?').bind(actor.id,actor.session_hash).run();return json({ok:true});
 }
 if(p==='/api/customer/delete'&&m==='POST'){
  configured();requireActor();await rate(env,'customer-delete:'+actor.id,5,900);const b=await read();if(typeof b.password!=='string'||b.password.length>128||!await verifyCustomerPassword(env,b.password,actor.password_hash))fail('كلمة المرور غير صحيحة',401);
  const result=await env.DB.prepare('DELETE FROM customers WHERE id=? AND password_hash=? AND auth_version=?').bind(actor.id,actor.password_hash,actor.auth_version).run();if(!result.meta.changes)fail('تغيّر الحساب، أعد المحاولة',409);return json({ok:true},200,{'Set-Cookie':cookie('',0)});
 }
 return json({error:'الصفحة غير موجودة'},404);
}
