import {authorizedCustomerOrder} from './customers.js';
// Only a delivered order's owner can rate its actual drinks. No public names/comments.
export async function reviewRoutes(req,env,h){
 const p=new URL(req.url).pathname;if(p!=='/api/order/rating'||req.method!=='POST')return null;
 const {body,fail,json,rate,customer}=h,b=await body(req);
 if(!b||typeof b!=='object'||Array.isArray(b))fail('بيانات التقييم غير صالحة');
 await rate(env,'rating-ip:'+(req.headers.get('CF-Connecting-IP')||'local'),30,600);
 const o=await authorizedCustomerOrder(env,customer,b.id,b.token,fail);if(!o)fail('رقم الطلب أو رمز التحقق غير صحيح',404);
 if(o.status!=='delivered')fail('يمكن تقييم المشروب بعد استلام الطلب فقط',409);
 if(typeof b.product_id!=='string'||!JSON.parse(o.items).some(i=>i.id===b.product_id))fail('المشروب ليس ضمن طلبك',400);
 if(!Number.isInteger(b.stars)||b.stars<1||b.stars>5)fail('اختر تقييمًا من نجمة إلى خمس نجوم',400);
 await rate(env,'rating-order:'+o.id,10,600);
 const now=Math.floor(Date.now()/1000);
 // Gate again in the write so a concurrent owner action cannot insert an ineligible rating.
 const saved=await env.DB.prepare("INSERT INTO drink_ratings(order_id,product_id,stars,created_at,updated_at) SELECT id,?,?,?,? FROM orders WHERE id=? AND status='delivered' ON CONFLICT(order_id,product_id) DO UPDATE SET stars=excluded.stars,updated_at=excluded.updated_at RETURNING product_id,stars").bind(b.product_id,b.stars,now,now,o.id).first();
 if(!saved)fail('تعذر حفظ التقييم، حدّث حالة الطلب وحاول مجددًا',409);
 return json({ok:true,rating:saved});
}
