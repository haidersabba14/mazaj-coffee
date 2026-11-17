import {authorizedCustomerOrder} from './customers.js';
import {seasonalSQL} from './planning.js';
const now=()=>Math.floor(Date.now()/1000);
const statusTitles={new:'بانتظار قبول المقهى',accepted:'مقبول',preparing:'قيد التحضير',ready:'جاهز للاستلام',delivered:'تم التسليم',cancelled:'ملغي'};
async function read(req,h){const b=await h.body(req);if(!b||typeof b!=='object'||Array.isArray(b))h.fail('بيانات غير صالحة');return b;}
export async function engagementRoutes(req,env,h){
 const {customer,json,fail,text,rate}=h,url=new URL(req.url),p=url.pathname,m=req.method;
 if(p.startsWith('/api/customer/')&&['/api/customer/activity','/api/customer/activity-read','/api/customer/club','/api/customer/suggestions'].includes(p)){
  if(!customer)fail('سجّل دخول حسابك أولًا',401);
  if(p==='/api/customer/activity'&&m==='GET'){
   const last=(await env.DB.prepare('SELECT last_seq FROM customer_activity_read WHERE customer_id=?').bind(customer.id).first())?.last_seq||0;
   const events=(await env.DB.prepare("SELECT e.seq,e.kind,e.status,e.message,e.created_at,o.id order_id,'CR-'||o.order_number order_label FROM order_events e JOIN orders o ON o.id=e.order_id WHERE o.customer_id=? ORDER BY e.seq DESC LIMIT 50").bind(customer.id).all()).results;
   const unread=(await env.DB.prepare('SELECT COUNT(*) n FROM order_events e JOIN orders o ON o.id=e.order_id WHERE o.customer_id=? AND e.seq>?').bind(customer.id,last).first()).n;return json({events,unread,last_read:last});
  }
  if(p==='/api/customer/activity-read'&&m==='POST'){
   const b=await read(req,h);if(!Number.isSafeInteger(b.through_seq)||b.through_seq<0)fail('إشارة قراءة غير صالحة');const max=(await env.DB.prepare('SELECT COALESCE(MAX(e.seq),0) n FROM order_events e JOIN orders o ON o.id=e.order_id WHERE o.customer_id=?').bind(customer.id).first()).n;if(b.through_seq>max)fail('لا يمكن قراءة تنبيهات مستقبلية');await env.DB.prepare('INSERT INTO customer_activity_read VALUES(?,?) ON CONFLICT(customer_id) DO UPDATE SET last_seq=MAX(last_seq,excluded.last_seq)').bind(customer.id,b.through_seq).run();return json({ok:true});
  }
  if(p==='/api/customer/club'&&m==='GET'){
   const stats=await env.DB.prepare('SELECT * FROM customer_statistics WHERE customer_id=?').bind(customer.id).first();const quiz=(await env.DB.prepare('SELECT COUNT(*) n FROM customer_quizzes WHERE customer_id=? AND correct=1').bind(customer.id).first()).n,visits=(await env.DB.prepare('SELECT day FROM customer_visit_days WHERE customer_id=? ORDER BY day DESC LIMIT 730').bind(customer.id).all()).results.map(r=>r.day),today=new Date((now()+10800)*1000).toISOString().slice(0,10);let streak=0;let expected=Date.parse(today+'T00:00:00Z');if(visits[0]===new Date(expected-86400000).toISOString().slice(0,10))expected-=86400000;for(const date of visits){if(date!==new Date(expected).toISOString().slice(0,10))break;streak++;expected-=86400000;}
   const count=stats?.delivered_orders||0,points=count*20+quiz*10,levels=[{key:'bronze',name:'برونزي',at:0},{key:'silver',name:'فضي',at:100},{key:'gold',name:'ذهبي',at:300},{key:'vip',name:'VIP',at:600}],level=[...levels].reverse().find(x=>points>=x.at),next=levels.find(x=>x.at>points)||null;
   const daily=await env.DB.prepare("SELECT COUNT(*) orders,COUNT(DISTINCT json_extract(j.value,'$.id')) variety FROM orders o,json_each(o.items) j WHERE o.customer_id=? AND o.status='delivered' AND date(o.delivered_at+10800,'unixepoch')=date('now','+3 hours')").bind(customer.id).first();
   return json({points,streak_days:streak,quizzes_correct:quiz,delivered_orders:count,cups:stats?.delivered_drinks||0,level,next_level:next,badges:[{key:'first',name:'أول رشفة',earned:count>=1},{key:'regular',name:'من أهل المقهى',earned:count>=5},{key:'streak',name:'٣ أيام متتالية',earned:streak>=3},{key:'ten',name:'عشر لحظات ملكية',earned:count>=10},{key:'vip',name:'ثلاثون زيارة',earned:count>=30}],missions:[{key:'daily',name:'استلم مشروبك اليوم',completed:daily.orders>0},{key:'variety',name:'استلم مشروبين مختلفين اليوم بطلبين',completed:daily.variety>=2}],note:'٢٠ نقطة تجربة لكل طلب مسلّم، و١٠ لإجابة لغز اليوم الصحيحة. المستويات والشارات تقدّم معنوي، ولا تضيف ختمات أو مكافآت. الختمات من الإدارة فقط.'});
  }
  if(p==='/api/customer/suggestions'&&m==='GET'){
   const prefs=await env.DB.prepare('SELECT favorites,customization FROM customer_preferences WHERE customer_id=?').bind(customer.id).first(),favorites=prefs?JSON.parse(prefs.favorites):[],opts=prefs?JSON.parse(prefs.customization):{};
   const products=(await env.DB.prepare('SELECT id,name,category,featured FROM products WHERE available=1 AND stock!=0 AND '+seasonalSQL+" AND NOT EXISTS(SELECT 1 FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=products.id AND (i.active=0 OR i.stock_milli<r.quantity_milli)) ORDER BY sort").all()).results;
   const categories=products.filter(p=>favorites.includes(p.id)).map(p=>p.category);const suggestions=products.map(p=>({...p,score:(p.category===opts.temperature?3:0)+categories.filter(c=>c===p.category).length*2+(favorites.includes(p.id)?1:0)+p.featured})).sort((a,b)=>b.score-a.score).slice(0,3).map(p=>({id:p.id,reason:p.score>0?'قريب من مفضلتك وتفضيلاتك':'من قائمة المقهى'}));return json({suggestions,method:'قواعد من المفضلة وتفضيلات الحرارة؛ لا نموذج ذكاء اصطناعي خارجي.'});
  }
 }
 if(p==='/api/assistant'&&m==='POST'){
  await rate(env,'assistant:'+(req.headers.get('CF-Connecting-IP')||'local'),25,600);const b=await read(req,h),q=text(b.question,1,300).toLowerCase().normalize('NFKD').replace(/[\u064b-\u065f]/g,'').replace(/[أإآ]/g,'ا');if(b.lang!==undefined&&!['ar','en'].includes(b.lang))fail('اللغة غير مدعومة');let ar,en;
  if(/طلب|order|جاهز|ready/.test(q)&&/حاله|حالة|وين|متابع|status|where|جاهز|ready/.test(q)){
   const o=b.context?await authorizedCustomerOrder(env,customer,b.context.id,b.context.token,fail):customer?await env.DB.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 1').bind(customer.id).first():null;
   const englishStatus={new:'Awaiting cafe acceptance',accepted:'Accepted',preparing:'Preparing',ready:o?.fulfillment==='delivery'?'Ready for delivery':'Ready to collect',delivered:'Delivered',cancelled:'Cancelled'};
   ar=o?'طلبك CR-'+o.order_number+': '+statusTitles[o.status]+(o.estimated_ready_at?'، الوقت المتوقع '+new Date(o.estimated_ready_at*1000).toLocaleTimeString('ar-BH',{timeZone:'Asia/Bahrain',hour:'2-digit',minute:'2-digit'}):''):'افتح متابعة الطلب برقم الطلب ورمزك الخاص، أو سجّل دخول الحساب المرتبط. لا نعرض طلبًا من رقم الهاتف فقط.';
   en=o?'Your order CR-'+o.order_number+': '+englishStatus[o.status]+(o.estimated_ready_at?'. Estimated time: '+new Date(o.estimated_ready_at*1000).toLocaleTimeString('en-BH',{timeZone:'Asia/Bahrain',hour:'2-digit',minute:'2-digit'}):''):'Open order tracking with your order number and private code, or sign in to the linked account. We never show an order using a phone number alone.';
  }else if(/مجان|سعر|فلوس|price|free|cost/.test(q)){
   const s=await env.DB.prepare('SELECT all_free FROM settings WHERE id=1').first();ar=s.all_free?'كل المشروبات مجانية، والتوصيل بدون رسوم. مشروب واحد لكل طلب، ومشروبان لمكافأة الولاء.':'راجع السعر الحالي في ملخص الطلب قبل التأكيد.';en=s.all_free?'Every drink is free, with no delivery fees. One drink per order, or two when redeeming a loyalty reward.':'Check the current price in the order summary before confirming.';
  }else if(/ساع|وقت|متى|فتح|hours|open|schedule/.test(q)){
   const s=await env.DB.prepare('SELECT opening_hour,closing_hour,accepting,maintenance FROM settings WHERE id=1').first();ar='الساعات العامة '+s.opening_hour+':00 إلى '+s.closing_hour+':00 بتوقيت البحرين. قد تختلف أيام الفروع؛ المواعيد المتاحة تظهر في السلة.'+(!s.accepting||s.maintenance?' استقبال الطلبات متوقف حاليًا.':'');en='General opening hours: '+s.opening_hour+':00 to '+s.closing_hour+':00, Bahrain time. Branch days may differ; available scheduled times appear in the cart.'+(!s.accepting||s.maintenance?' Order reception is currently paused.':'');
  }else if(/ولاء|ختم|مكاف|loyal|stamp/.test(q)){
   ar='كل خمس ختمات من الإدارة تعطيك مشروبين من اختيارك. افتح بطاقتك واعرض QR للمسؤول. المستويات والنقاط معنوية ولا تمنح ختمات من المتصفح.';en='Five staff-issued stamps earn two drinks of your choice. Open your card and show its QR code to staff. Levels and points are symbolic and never add stamps from the browser.';
  }else if(/توصيل|سياره|سيارة|delivery|pickup|car/.test(q)){
   ar='اختر استلامًا من المقهى، توصيلًا مجانيًا مع تحديد البيت، أو استلامًا من السيارة مع وصفها. لطلب السيارة المقبول يظهر زر «وصلت للمقهى».';en='Choose cafe pickup, free home delivery with a map location, or curbside pickup with a car description. Accepted curbside orders show an “I’ve arrived” button.';
  }else if(/حليب|سكر|حجم|milk|sugar|size/.test(q)){
   ar='الحليب كامل الدسم فقط، والحجم صغير أو وسط. السكر على ذوقك باستثناء الشاي والقهوة العربية: سكر عادي فقط.';en='Whole milk only, in small or medium cups. Choose your sugar, except for tea and Arabic coffee, which use regular sugar only.';
  }else if(/الغ|عدل|edit|cancel/.test(q)){
   ar='قبل قبول المقهى يمكنك تعديل الملاحظات وخيارات المشروب أو إلغاء الطلب من صفحة متابعته. بعد القبول تتولى الإدارة الإجراء.';en='Before cafe acceptance, you can edit notes and drink options or cancel from order tracking. After acceptance, staff handle changes.';
  }else{
   ar='أقدر أساعدك في ساعات العمل والأسعار والولاء والتوصيل وخيارات المشروب وحالة طلبك. هذا مساعد إرشادي بقواعد محددة، ولا ينفّذ طلبًا بدل تأكيدك.';en='I can help with opening hours, prices, loyalty, collection, drink options and your order status. This is a guide using fixed rules. It never places an order without your confirmation.';
  }
  return json({reply:b.lang==='en'?en:ar,translations:{ar,en},kind:'guided-help'});
 }
 return null;
}
