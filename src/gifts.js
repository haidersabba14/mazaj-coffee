import {audit} from './operations.js';
const now=()=>Math.floor(Date.now()/1000),hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
export function birthdayEligible(month,day,time=now()){
 if(!month||!day)return false;const today=new Date((time+10800)*1000),year=today.getUTCFullYear(),midnight=Date.UTC(year,today.getUTCMonth(),today.getUTCDate());return [year-1,year,year+1].some(y=>{const leap=new Date(Date.UTC(y,1,29)).getUTCMonth()===1,actualDay=month===2&&day===29&&!leap?28:day;return Math.abs(midnight-Date.UTC(y,month-1,actualDay))<=7*86400000;});
}
export function birthdayValues(month,day,fail){if((month===null||month==='')&&(day===null||day===''))return {month:null,day:null};if(!['number','string'].includes(typeof month)||!['number','string'].includes(typeof day))fail('اختر يوم وشهر صحيحين');month=Number(month);day=Number(day);const d=new Date(Date.UTC(2000,month-1,day));if(!Number.isInteger(month)||!Number.isInteger(day)||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)fail('اختر يوم وشهر ميلاد صحيحين');return {month,day};}
async function read(req,h){const b=await h.body(req);if(!b||typeof b!=='object'||Array.isArray(b))h.fail('بيانات غير صالحة');return b;}
export async function giftRoutes(req,env,h,actor=null){
 const p=new URL(req.url).pathname,m=req.method,{json,fail,hash,rate,text,customer}=h;
 if(p==='/api/customer/gift-redeem'&&m==='POST'){
  if(!customer)fail('سجّل دخول حسابك أولًا',401);await rate(env,'gift-redeem:'+customer.id,5,600);const b=await read(req,h),code=typeof b.code==='string'?b.code.toUpperCase().replace(/ROYAL|[\s-]/g,''):'';if(!/^[0-9A-F]{24}$/.test(code))fail('كود الهدية غير صالح');const card=await env.DB.prepare('SELECT id FROM loyalty_cards WHERE customer_id=? AND blocked=0').bind(customer.id).first();if(!card)fail('اربط بطاقة ولائك بحسابك قبل استبدال الهدية',409);const claim=crypto.randomUUID(),time=now();
  const result=await env.DB.batch([env.DB.prepare('UPDATE gift_cards SET redeemed_by=?,redeemed_at=?,card_id=?,claim=? WHERE code_hash=? AND redeemed_at IS NULL AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM loyalty_cards WHERE id=? AND customer_id=? AND blocked=0)').bind(customer.id,time,card.id,claim,await hash('gift-card-v1:'+env.RATE_SALT+':'+code),time,card.id,customer.id),env.DB.prepare("INSERT INTO loyalty_grants(id,customer_id,card_id,kind,period,drinks,created_by,created_at) SELECT ?,?,?, 'gift',id,2,'gift-card',? FROM gift_cards WHERE claim=? AND redeemed_by=?").bind(crypto.randomUUID(),customer.id,card.id,time,claim,customer.id)]);
  if(!result[0].meta.changes)fail('الهدية غير صالحة أو انتهت أو استُخدمت',409);await audit(env,{id:'customer'},'gift_redeemed');return json({ok:true,drinks:2});
 }
 if(!p.startsWith('/api/admin/'))return null;
 if(!['/api/admin/gifts','/api/admin/gift-revoke','/api/admin/birthday-gift'].includes(p))return null;if(actor?.role!=='owner')fail('الهدايا للمالك فقط',403);
 if(p==='/api/admin/gifts'){
  if(m==='GET')return json({gifts:(await env.DB.prepare('SELECT id,label,created_at,expires_at,revoked,redeemed_at FROM gift_cards ORDER BY created_at DESC LIMIT 200').all()).results});
  if(m==='POST'){await rate(env,'gift-create:'+actor.id,20,3600);const b=await read(req,h),id=crypto.randomUUID(),code=hex(crypto.getRandomValues(new Uint8Array(12))).toUpperCase(),expires=Number(b.days??30);if(!Number.isInteger(expires)||expires<1||expires>90)fail('صلاحية الهدية من يوم إلى ٩٠ يومًا');await env.DB.prepare('INSERT INTO gift_cards(id,code_hash,label,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id,await hash('gift-card-v1:'+env.RATE_SALT+':'+code),text(b.label||'هدية المقهى',2,80),actor.id,now(),now()+expires*86400).run();await audit(env,actor,'gift_created',null,id);return json({id,code:'ROYAL-'+code.match(/.{6}/g).join('-'),drinks:2,expires_at:now()+expires*86400},201);}
 }
 if(p==='/api/admin/gift-revoke'&&m==='POST'){const b=await read(req,h),id=text(b.id,36,36),r=await env.DB.prepare('UPDATE gift_cards SET revoked=1 WHERE id=? AND redeemed_at IS NULL').bind(id).run();if(!r.meta.changes)fail('الهدية مستبدلة أو غير موجودة',409);await audit(env,actor,'gift_revoked',null,id);return json({ok:true});}
 if(p==='/api/admin/birthday-gift'&&m==='POST'){
  await rate(env,'birthday-gift:'+actor.id,20,3600);const b=await read(req,h),id=text(b.id,36,36),c=await env.DB.prepare('SELECT * FROM customers WHERE id=? AND blocked=0').bind(id).first();if(!c||!birthdayEligible(c.birthday_month,c.birthday_day))fail('الهدية متاحة خلال ٧ أيام من يوم الميلاد المسجّل فقط',409);const card=await env.DB.prepare('SELECT id FROM loyalty_cards WHERE customer_id=? AND blocked=0').bind(id).first();if(!card)fail('لا توجد بطاقة ولاء نشطة للعميل',409);const year=String(new Date((now()+10800)*1000).getUTCFullYear());try{await env.DB.prepare("INSERT INTO loyalty_grants VALUES(?,?,?,'birthday',?,2,?,?)").bind(crypto.randomUUID(),id,card.id,year,actor.id,now()).run();}catch(err){if(String(err).includes('UNIQUE constraint'))fail('صُرفت هدية هذا العام بالفعل',409);throw err;}await audit(env,actor,'birthday_gift_granted',null,id);return json({ok:true,drinks:2,year});
 }
 return null;
}
