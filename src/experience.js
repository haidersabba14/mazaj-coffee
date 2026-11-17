import {validateDrinkOptions} from './customer-suite.js';
const now=()=>Math.floor(Date.now()/1000),day=()=>new Date((now()+10800)*1000).toISOString().slice(0,10);
export const coffeeQuestions=[
 {key:'espresso',question:'أي مشروب يُصنع من الإسبريسو والحليب؟',choices:['لاتيه','ماء','شاي'],answer:0,explanation:'اللاتيه يجمع الإسبريسو والحليب.'},
 {key:'ice',question:'ما الذي يميّز الأمريكانو البارد؟',choices:['مكعبات الثلج','حبوب الشاي','عدم وجود قهوة'],answer:0,explanation:'الأمريكانو البارد إسبريسو وماء مع الثلج.'},
 {key:'arabic',question:'ما النكهة الشائعة في القهوة العربية؟',choices:['النعناع','الهيل','الكاكاو'],answer:1,explanation:'الهيل من النكهات المعروفة في القهوة العربية.'},
 {key:'milk',question:'ما نوع الحليب الموجود في قائمتنا؟',choices:['صويا','شوفان','كامل الدسم'],answer:2,explanation:'المقهى يستخدم الحليب كامل الدسم فقط.'},
 {key:'stamp',question:'كم ختمًا يمنحك مشروبين من اختيارك؟',choices:['خمسة','اثنان','عشرة'],answer:0,explanation:'خمس ختمات من الإدارة تمنحك مشروبين.'},
 {key:'sizes',question:'ما الحجمان المتاحان في المقهى؟',choices:['كبير وعملاق','صغير ووسط','صغير فقط'],answer:1,explanation:'جميع المشروبات بحجم صغير أو وسط.'},
 {key:'secret',question:'كيف تُضاف ختمة الولاء؟',choices:['بالضغط في الموقع','من الإدارة فقط','بتغيير الساعة'],answer:1,explanation:'الإدارة تمسح البطاقة وتضيف الختمة بعد التحقق.'}
];
function questionFor(today){const index=Math.floor(Date.parse(today+'T00:00:00Z')/86400000)%coffeeQuestions.length;return coffeeQuestions[index];}
export async function experienceRoutes(req,env,h){
 const p=new URL(req.url).pathname,m=req.method,{customer,fail,json,rate,text}=h;if(!['/api/customer/quiz','/api/customer/recipes','/api/customer/recipe-delete'].includes(p))return null;if(!customer)fail('سجّل دخولك أولًا',401);
 if(p==='/api/customer/quiz'){
  const today=day(),q=questionFor(today);if(m==='GET'){const result=await env.DB.prepare('SELECT answer,correct FROM customer_quizzes WHERE customer_id=? AND day=?').bind(customer.id,today).first();return json({day:today,question:{key:q.key,text:q.question,choices:q.choices},result:result?{...result,explanation:q.explanation}:null,points_if_correct:10});}
  if(m==='POST'){await rate(env,'quiz:'+customer.id,5,600);const b=await h.body(req);if(!b||b.day!==today||b.key!==q.key)fail('تغيّر لغز اليوم. أعد تحميله',409);if(!Number.isInteger(b.answer)||b.answer<0||b.answer>=q.choices.length)fail('اختر إجابة صحيحة');await env.DB.prepare('INSERT OR IGNORE INTO customer_quizzes VALUES(?,?,?,?,?)').bind(customer.id,today,q.key,b.answer,+(b.answer===q.answer)).run();const saved=await env.DB.prepare('SELECT answer,correct FROM customer_quizzes WHERE customer_id=? AND day=?').bind(customer.id,today).first();if(saved.answer!==b.answer)fail('سُجلت إجابة اليوم بالفعل',409);return json({ok:true,correct:!!saved.correct,points:saved.correct?10:0,explanation:q.explanation});}
 }
 if(p==='/api/customer/recipes'){
  if(m==='GET')return json({recipes:(await env.DB.prepare('SELECT * FROM customer_recipes WHERE customer_id=? ORDER BY updated_at DESC').bind(customer.id).all()).results.map(r=>({...r,options:JSON.parse(r.options)}))});
  if(m==='POST'){await rate(env,'own-recipe:'+customer.id,15,600);const b=await h.body(req);if(!b||typeof b!=='object'||Array.isArray(b))fail('بيانات غير صالحة');const id=b.id?text(b.id,36,36):crypto.randomUUID(),existing=await env.DB.prepare('SELECT customer_id FROM customer_recipes WHERE id=?').bind(id).first();if(existing&&existing.customer_id!==customer.id)fail('الخلطة غير موجودة',404);if(!/^[a-f0-9-]{36}$/.test(id))fail('رقم الخلطة غير صالح');const product=await env.DB.prepare('SELECT id FROM products WHERE id=?').bind(text(b.product_id,1,80)).first();if(!product)fail('المشروب الأساسي غير موجود');const options=validateDrinkOptions(b.options,[{id:product.id}],fail);try{const written=await env.DB.prepare('INSERT INTO customer_recipes VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,notes=excluded.notes,options=excluded.options,updated_at=excluded.updated_at WHERE customer_recipes.customer_id=excluded.customer_id').bind(id,customer.id,product.id,text(b.name,2,60),text(b.notes||'',0,500),JSON.stringify(options),now(),now()).run();if(!written.meta.changes)fail('الخلطة غير موجودة',404);}catch(err){if(String(err).includes('recipe_quota'))fail('الحد ٢٠ خلطة للحساب. احذف خلطة غير مستخدمة',409);throw err;}return json({ok:true,id});}
 }
 if(p==='/api/customer/recipe-delete'&&m==='POST'){const b=await h.body(req);if(!b)fail('بيانات غير صالحة');const r=await env.DB.prepare('DELETE FROM customer_recipes WHERE id=? AND customer_id=?').bind(text(b.id,36,36),customer.id).run();if(!r.meta.changes)fail('الخلطة غير موجودة',404);return json({ok:true});}
 return null;
}
