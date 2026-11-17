import {authorizedCustomerOrder} from './customers.js';
import {audit} from './operations.js';
const now=()=>Math.floor(Date.now()/1000);
async function readBody(req,h){const b=await h.body(req);if(!b||typeof b!=='object'||Array.isArray(b))h.fail('بيانات غير صالحة');return b;}
const options={temperature:['hot','cold'],milk:['whole'],sugar:['none','light','normal','extra'],strength:['light','medium','strong'],size:['small','medium']};
export function validateDrinkOptions(raw,items,fail){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!Object.hasOwn(options,k)))fail('خيارات المشروب غير صالحة');
 const out={};for(const [key,allowed] of Object.entries(options)){if(raw[key]!==undefined&&!allowed.includes(raw[key]))fail('خيارات المشروب غير صالحة');if(raw[key])out[key]=raw[key];}
 if(items?.some(i=>['tea','arabic-coffee'].includes(i.id))){if(out.sugar&&out.sugar!=='normal')fail('الشاي والقهوة العربية بسكر عادي فقط');out.sugar='normal';}return out;
}
export const loyaltyView=c=>c?{id:c.id,card_number:c.card_number,name:c.name,stamps:c.stamps,reward_drinks:c.reward_drinks,total_stamps:c.total_stamps,remaining:5-c.stamps,wallet_available:false,account_linked:!!c.customer_id}:null;
export async function customerSuite(req,env,h){
 const {body,text,fail,json,hash,rate,customer}=h,url=new URL(req.url),p=url.pathname,m=req.method;
 const member=()=>{if(!customer)fail('سجّل دخول حسابك أولًا',401);return customer;};
 const linked=()=>env.DB.prepare('SELECT * FROM loyalty_cards WHERE customer_id=? AND blocked=0').bind(member().id).first();
 if(p==='/api/customer/preferences'){
  member();if(m==='GET'){const r=await env.DB.prepare('SELECT * FROM customer_preferences WHERE customer_id=?').bind(customer.id).first();return json({customer_id:customer.id,favorites:r?JSON.parse(r.favorites):[],customization:r?JSON.parse(r.customization):{},version:r?.version||0});}
  if(m==='POST'){
   await rate(env,'customer-preferences:'+customer.id,60,600);const b=await readBody(req,h);if(b?.customer_id!==customer.id)fail('تغيّر الحساب. حدّث الصفحة وحاول مجددًا',409);if(!b||!Number.isSafeInteger(b.version)||b.version<0)fail('نسخة الإعدادات غير صالحة');
   if(!Array.isArray(b.favorites)||b.favorites.length>100||b.favorites.some(id=>typeof id!=='string'||id.length>80)||new Set(b.favorites).size!==b.favorites.length)fail('قائمة المفضلة غير صالحة');
   const products=(await env.DB.prepare('SELECT id FROM products').all()).results;if(b.favorites.some(id=>!products.some(p=>p.id===id)))fail('أحد المشروبات غير موجود');
   const customization=validateDrinkOptions(b.customization,[],fail);await env.DB.prepare('INSERT OR IGNORE INTO customer_preferences(customer_id,updated_at) VALUES(?,?)').bind(customer.id,now()).run();
   const r=await env.DB.prepare('UPDATE customer_preferences SET favorites=?,customization=?,version=version+1,updated_at=? WHERE customer_id=? AND version=? RETURNING version').bind(JSON.stringify(b.favorites),JSON.stringify(customization),now(),customer.id,b.version).first();if(!r)fail('تغيّرت التفضيلات على جهاز آخر. أعد تحميلها وحاول مجددًا',409);return json({ok:true,version:r.version});
  }
 }
 if(p==='/api/customer/loyalty'&&m==='GET')return json({card:loyaltyView(await linked())});
 if(p==='/api/customer/loyalty-link'&&m==='POST'){
  member();await rate(env,'loyalty-link:'+customer.id,10,600);const b=await readBody(req,h);if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))fail('رمز البطاقة الخاص مطلوب');const id=text(b.id,36,36),c=await env.DB.prepare('SELECT * FROM loyalty_cards WHERE id=? AND token_hash=? AND blocked=0').bind(id,await hash(b.token)).first();if(!c||c.customer_id&&c.customer_id!==customer.id)fail('تعذر ربط البطاقة بهذا الحساب',404);
  try{const changed=await env.DB.prepare('UPDATE loyalty_cards SET customer_id=? WHERE id=? AND (customer_id IS NULL OR customer_id=?)').bind(customer.id,id,customer.id).run();if(!changed.meta.changes)fail('البطاقة مرتبطة بحساب آخر',409);}catch(err){if(String(err).includes('UNIQUE constraint'))fail('يوجد بالفعل بطاقة مرتبطة بحسابك',409);throw err;}
  await audit(env,{id:'customer'},'loyalty_linked',null,id);return json({card:loyaltyView(await linked())});
 }
 if(p==='/api/customer/loyalty-create'&&m==='POST'){
  member();await rate(env,'loyalty-create:'+customer.id,5,600);const existing=await linked();if(existing)return json({card:loyaltyView(existing),created:false});const b=await readBody(req,h),id=text(b.id,36,36);if(!/^[a-f0-9-]{36}$/.test(id)||typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))fail('بيانات البطاقة غير صالحة');const name=text(b.name,2,80),contact=text(b.contact,4,30);
  for(let attempt=0;attempt<4;attempt++)try{const number=String(1000000+crypto.getRandomValues(new Uint32Array(1))[0]%9000000);await env.DB.prepare('INSERT INTO loyalty_cards(id,card_number,token_hash,name,contact_hash,created_at,customer_id) VALUES(?,?,?,?,?,?,?)').bind(id,number,await hash(b.token),name,await hash(env.RATE_SALT+contact),now(),customer.id).run();await audit(env,{id:'customer'},'loyalty_created',null,id);return json({card:loyaltyView(await linked()),created:true},201);}catch(err){if(!String(err).includes('UNIQUE constraint'))throw err;const card=await linked();if(card)return json({card:loyaltyView(card),created:false});if(attempt===3)fail('تعذر إنشاء رقم بطاقة، أعد المحاولة',409);}
 }
 if(['/api/order/edit','/api/order/cancel','/api/order/invoice'].includes(p)&&m==='POST'){
  const b=await readBody(req,h);await rate(env,'order-tools:'+(req.headers.get('CF-Connecting-IP')||'local'),40,600);const o=await authorizedCustomerOrder(env,customer,b.id,b.token,fail);if(!o)fail('بيانات متابعة الطلب غير صحيحة',404);
  if(p==='/api/order/invoice'){const branch=await env.DB.prepare('SELECT name FROM branches WHERE id=?').bind(o.branch_id).first(),s=await env.DB.prepare('SELECT brand_name FROM settings WHERE id=1').first();return json({invoice:{number:'INV-'+o.order_number,order_label:'CR-'+o.order_number,created_at:o.created_at,name:o.name,items:JSON.parse(o.items),customization:JSON.parse(o.customization),total:o.total,delivery_fee:0,fulfillment:o.fulfillment,status:o.status,branch:branch?.name||'الفرع الرئيسي',brand:s.brand_name,scheduled_at:o.scheduled_at,currency:'BHD'}});}
  if(o.status!=='new')fail('يمكن تعديل الطلب أو إلغاؤه قبل قبول المقهى فقط',409);if(!Number.isSafeInteger(b.version)||b.version!==o.version)fail('تغيّر الطلب، حدّث حالته أولًا',409);await rate(env,'order-edit:'+o.id,10,600);
  if(p==='/api/order/edit'){
   const notes=text(b.notes||'',0,1000),customization=validateDrinkOptions(b.customization,JSON.parse(o.items),fail);
   const r=await env.DB.prepare("UPDATE orders SET notes=?,customization=?,version=version+1 WHERE id=? AND status='new' AND version=? RETURNING version").bind(notes,JSON.stringify(customization),o.id,b.version).first();if(!r)fail('قبل المقهى الطلب أو تم تعديله. حدّث الحالة',409);await audit(env,{id:'customer'},'customer_order_edited',o.id);return json({ok:true,version:r.version});
  }
  const reason=text(b.reason||'ألغى الزبون الطلب قبل قبوله',1,300),r=await env.DB.prepare("UPDATE orders SET status='cancelled',cancelled_by='customer',rejection_reason=?,version=version+1 WHERE id=? AND status='new' AND version=? RETURNING version").bind(reason,o.id,b.version).first();if(!r)fail('قبل المقهى الطلب أو تم تعديله. حدّث الحالة',409);await audit(env,{id:'customer'},'customer_order_cancelled',o.id);return json({ok:true,status:'cancelled',version:r.version});
 }
 return null;
}
export async function customerAdmin(req,env,h,actor){
 const url=new URL(req.url),p=url.pathname,m=req.method;if(!['/api/admin/customers','/api/admin/customer-block','/api/admin/customer-sessions'].includes(p))return null;const {json,body,text,fail,rate}=h;if(actor?.role!=='owner')fail('هذه العملية للمالك فقط',403);
 if(p==='/api/admin/customers'&&m==='GET'){const q=(url.searchParams.get('q')||'').trim().slice(0,100),offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail('رقم صفحة غير صالح');const result=await env.DB.prepare("SELECT c.id,c.username,c.name,c.phone,c.blocked,c.created_at,c.birthday_month,c.birthday_day,(SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id) order_count,(SELECT MAX(created_at) FROM orders o WHERE o.customer_id=c.id) last_order_at,(SELECT card_number FROM loyalty_cards l WHERE l.customer_id=c.id) card_number FROM customers c WHERE c.username LIKE ? OR c.name LIKE ? OR c.phone LIKE ? ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET ?").bind('%'+q+'%','%'+q+'%','%'+q+'%',offset).all();return json({customers:result.results.slice(0,50),has_more:result.results.length>50,offset});}
 if(m==='POST'){
  await rate(env,'customer-admin:'+actor.id,30,600);const b=await readBody(req,h),id=text(b.id,36,36),c=await env.DB.prepare('SELECT id FROM customers WHERE id=?').bind(id).first();if(!c)fail('العميل غير موجود',404);
  if(p==='/api/admin/customer-block'){if(typeof b.blocked!=='boolean')fail('حالة الحساب غير صالحة');await env.DB.batch([env.DB.prepare('UPDATE customers SET blocked=?,auth_version=auth_version+1,updated_at=? WHERE id=?').bind(+b.blocked,now(),id),env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id=?').bind(id)]);await audit(env,actor,b.blocked?'customer_blocked':'customer_unblocked',null,id);return json({ok:true});}
  if(p==='/api/admin/customer-sessions'){await env.DB.batch([env.DB.prepare('UPDATE customers SET auth_version=auth_version+1 WHERE id=?').bind(id),env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id=?').bind(id)]);await audit(env,actor,'customer_sessions_revoked',null,id);return json({ok:true});}
 }
 return null;
}
