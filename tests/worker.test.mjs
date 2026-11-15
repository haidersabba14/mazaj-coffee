import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {MockAgent} from 'undici';
import {hash,isOpen,bahrainDate,bahrainWeekday,pricing,emailHtml} from '../src/worker.js';
const origin='https://coffee.test';let mf,db,cookie;const token=()=>randomBytes(32).toString('hex'),password='test-admin-password-long';
const mock=new MockAgent();mock.disableNetConnect();
const site=mock.get('https://challenges.cloudflare.com');site.intercept({path:'/turnstile/v0/siteverify',method:'POST'}).reply(200,{success:true,hostname:'coffee.test',action:'checkout'}).persist();
const resend=mock.get('https://api.resend.com');resend.intercept({path:'/emails',method:'POST'}).reply(200,{id:'email-test'}).persist();
async function request(path,data,auth=false,customOrigin=origin){return mf.dispatchFetch(origin+'/api/'+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json','Origin':customOrigin}:{}),...(auth?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});}
function order(){return {id:crypto.randomUUID(),token:token(),name:'عميل الاختبار',phone:'+973 33333333',notes:'بدون سكر',items:[{id:'cappuccino',quantity:1}],expectedTotal:0,turnstile:'test-token'};}
async function migrate(d){for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile('migrations/'+file,'utf8');if(file.includes('0003')){const base=sql.slice(0,sql.indexOf('CREATE TRIGGER'));for(const stmt of base.split(';').map(s=>s.trim()).filter(Boolean))await d.prepare(stmt).run();const check=sql.slice(sql.indexOf('CREATE TRIGGER'),sql.indexOf('ALTER TABLE orders'));await d.exec(check);await d.prepare(sql.slice(sql.indexOf('ALTER TABLE orders'))).run();}else for(const stmt of sql.split(';').map(s=>s.trim()).filter(Boolean))await d.prepare(stmt).run();}}
before(async()=>{const salt='test-salt';mf=new Miniflare({modules:true,scriptPath:'src/worker.js',compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{TURNSTILE_SITE_KEY:'test-site',TURNSTILE_SECRET:'test-secret',RATE_SALT:'test-rate-salt',ADMIN_PASSWORD_HASH:salt+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'),RESEND_API_KEY:'test',EMAIL_FROM:'coffee@example.com'},serviceBindings:{ASSETS:()=>new Response('asset')},fetchMock:mock});db=await mf.getD1Database('DB');await migrate(db);await db.prepare('UPDATE settings SET opening_hour=0,all_free=1').run();});
beforeEach(async()=>{await db.prepare('DELETE FROM limits').run();});
after(async()=>{await mf.dispose();await mock.close();});
test('البحرين: يفتح ٣ عصرًا والعرض ينتهي عند منتصف الليل',()=>{assert.equal(isOpen({accepting:1,opening_hour:15},new Date('2026-11-13T11:59:59Z')),false);assert.equal(isOpen({accepting:1,opening_hour:15},new Date('2026-11-13T12:00:00Z')),true);assert.equal(isOpen({accepting:0,opening_hour:15},new Date('2026-11-13T12:00:00Z')),false);assert.equal(bahrainDate(new Date('2026-11-13T21:00:00Z')),'2026-11-14');});
test('كل واجهات الإدارة محمية ولا تسرب بيانات',async()=>{for(const p of ['data','status','settings','product','retry','logout'])assert.equal((await request('admin/'+p,p==='data'?undefined:{})).status,401);});
test('منع المصدر الخارجي',async()=>assert.equal((await request('orders',order(),false,'https://attacker.test')).status,403));
test('تسجيل دخول آمن وقراءة الإحصاءات',async()=>{assert.equal((await request('login',{password:'wrong'})).status,401);const r=await request('login',{password});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);cookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await request('admin/data',undefined,true)).status,200);});
test('حفظ طلب فعلي، منع التكرار، تتبع آمن، بريد ومراجعة الإجمالي',async()=>{const b=order(),r=await request('orders',b);assert.equal(r.status,201);const j=await r.json();assert.equal(j.total,0);assert.equal(j.subtotal,2000);assert.equal((await db.prepare('SELECT name FROM orders WHERE id=?').bind(b.id).first()).name,b.name);assert.equal((await request('orders',b)).status,200);assert.equal((await db.prepare('SELECT COUNT(*) n FROM orders WHERE id=?').bind(b.id).first()).n,1);assert.equal((await request('orders',{...b,notes:'changed'})).status,409);const track=await request('track',{id:b.id,token:b.token});const data=await track.json();assert.equal(data.status,'new');assert.equal(data.name,undefined);assert.equal(data.phone,undefined);assert.equal(data.token_hash,undefined);assert.equal((await request('track',{id:b.id,token:token()})).status,404);const stored=await db.prepare('SELECT token_hash FROM orders WHERE id=?').bind(b.id).first();assert.equal(stored.token_hash,await hash(b.token));});
test('رفض كمية غير صالحة ومنتج مجهول وعدم الثقة بالسعر',async()=>{assert.equal((await request('orders',{...order(),items:[{id:'cappuccino',quantity:-1}]})).status,400);assert.equal((await request('orders',{...order(),items:[{id:'unknown',quantity:1}]})).status,400);assert.equal((await request('orders',{...order(),expectedTotal:2000})).status,409);});
test('سعر دينارين لكل مشروب بعد العرض وإغلاق الطلبات',async()=>{await db.prepare('UPDATE settings SET all_free=0,promotion_weekday=?').bind((bahrainWeekday()+1)%7).run();assert.equal((await request('orders',order())).status,409);await db.prepare('DELETE FROM limits').run();const b=order();const r=await request('orders',{...b,expectedTotal:2000,items:[{id:'cappuccino',quantity:1,price:0}]});assert.equal(r.status,201);assert.equal((await r.json()).total,2000);await request('admin/settings',{accepting:false,opening_hour:15},true);assert.equal((await request('orders',order())).status,409);});
test('تعديل الحالة والإخفاء والإعدادات وتسجيل الخروج',async()=>{const o=await db.prepare('SELECT id FROM orders LIMIT 1').first();assert.equal((await request('admin/status',{id:o.id,status:'ready'},true)).status,200);assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').bind(o.id).first()).status,'ready');assert.equal((await request('admin/status',{id:o.id,status:'invalid'},true)).status,400);assert.equal((await request('admin/product',{id:'new',name:'قهوة جديدة',description:'وصف جديد',image:'javascript:alert(1)',category:'hot',available:true},true)).status,400);assert.equal((await request('admin/logout',{},true)).status,200);assert.equal((await request('admin/data',undefined,true)).status,401);});
test('ترميز HTML في البريد',()=>{const html=emailHtml({id:'test',name:'<script>bad</script>',phone:'1234567',notes:'<img src=x>',items:JSON.stringify([{name:'قهوة',quantity:2}]),created_at:1,total:0});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('0.000 د.ب.'));});
test('تحديد محاولات التتبع',async()=>{for(let i=0;i<20;i++)assert.equal((await request('track',{id:crypto.randomUUID(),token:token()})).status,404);assert.equal((await request('track',{id:crypto.randomUUID(),token:token()})).status,429);});
test('فشل البريد لا يمنع الحفظ وتُعاد المحاولة دون تكرار الطلب',async()=>{
 const salt='failure-test',f=new Miniflare({modules:true,scriptPath:'src/worker.js',compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{TURNSTILE_SITE_KEY:'site',TURNSTILE_SECRET:'secret',RATE_SALT:'salt',ADMIN_PASSWORD_HASH:salt+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')},serviceBindings:{ASSETS:()=>new Response('asset')},fetchMock:mock});
 try{const d=await f.getD1Database('DB');await migrate(d);await d.prepare('UPDATE settings SET opening_hour=0,all_free=1').run();const b=order();const r=await f.dispatchFetch(origin+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(b)});assert.equal(r.status,201);await r.text();
 const login=await f.dispatchFetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({password})});const session=login.headers.get('set-cookie').split(';')[0];await f.dispatchFetch(origin+'/api/admin/retry',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:session},body:JSON.stringify({id:b.id})});const row=await d.prepare('SELECT email_status FROM orders WHERE id=?').bind(b.id).first();assert.equal(row.email_status,'failed');assert.equal((await d.prepare('SELECT COUNT(*) n FROM orders').first()).n,1);
 }finally{await f.dispose();}
});

test('الإدارة بكلمة مرور فقط دون رمز تفعيل وتبقى صفحة الويب محذوفة',async()=>{
 for(const path of ['/admin','/admin.html','/admin.js'])assert.equal((await mf.dispatchFetch(origin+path)).status,404);
 assert.equal((await mf.dispatchFetch(origin+'/api/admin/data')).status,401);
 const r=await mf.dispatchFetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(r.status,200);
 const session=r.headers.get('set-cookie').split(';')[0];
 assert.equal((await mf.dispatchFetch(origin+'/api/admin/data',{headers:{Cookie:session}})).status,200);
});

test('كل المشروبات مجانية دائمًا عند تفعيل المجانية، وعرض الجمعة يحترم توقيت البحرين',()=>{
 assert.equal(pricing({all_free:1},new Date('2026-11-15T14:00:00Z')).promotion,true);
 assert.equal(pricing({all_free:0,promotion_weekday:5},new Date('2026-11-12T20:59:59Z')).promotion,false);
 assert.equal(pricing({all_free:0,promotion_weekday:5},new Date('2026-11-12T21:00:00Z')).promotion,true);
 assert.equal(pricing({all_free:0,promotion_weekday:5},new Date('2026-11-13T21:00:00Z')).promotion,false);
});
test('مشروب واحد للطلب العادي والتحقق من التوصيل وحفظ الموقع للإدارة فقط',async()=>{
 await db.prepare('UPDATE settings SET accepting=1,opening_hour=0,all_free=1').run();
 assert.equal((await request('orders',{...order(),items:[{id:'black',quantity:2}]})).status,400);
 assert.equal((await request('orders',{...order(),fulfillment:'delivery'})).status,400);
 const b={...order(),fulfillment:'delivery',location:{lat:26.22,lng:50.58},address:'طريق الاختبار',customization:{milk:'whole',sugar:'none',size:'large'}};
 const r=await request('orders',b);assert.equal(r.status,201);const saved=await db.prepare('SELECT * FROM orders WHERE id=?').bind(b.id).first();assert.equal(saved.fulfillment,'delivery');assert.equal(saved.location_lat,26.22);assert.equal(JSON.parse(saved.customization).milk,'whole');
 const tracked=await (await request('track',{id:b.id,token:b.token})).json();assert.equal(tracked.location_lat,undefined);assert.equal(tracked.address,undefined);
 const other=await request('orders',order());assert.equal(other.status,201);
});
test('خمس ختمات من الإدارة تمنح مشروبين، والاستبدال آمن ولا يتكرر',async()=>{
 const b={id:crypto.randomUUID(),token:token(),name:'صاحب البطاقة',contact:'33333333'};const created=await request('cards',b);assert.equal(created.status,201);const card=await created.json();assert.match(card.card_number,/^\d{7}$/);assert.equal(card.token_hash,undefined);
 assert.equal((await request('card',{id:b.id,token:token()})).status,404);
 const login=await request('login',{password});cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('admin/stamp',{id:b.id,event_id:crypto.randomUUID()})).status,401);
 const event=crypto.randomUUID();await request('admin/stamp',{id:b.id,event_id:event},true);await request('admin/stamp',{id:b.id,event_id:event},true);
 for(let i=0;i<4;i++)await request('admin/stamp',{id:b.id,event_id:crypto.randomUUID()},true);
 const owner=await (await request('card',{id:b.id,token:b.token})).json();assert.equal(owner.total_stamps,5);assert.equal(owner.stamps,0);assert.equal(owner.reward_drinks,2);
 const o={...order(),items:[{id:'cappuccino',quantity:1},{id:'iced-latte',quantity:1}],reward_card:{id:b.id,token:b.token}};
 const response=await request('orders',o);assert.equal(response.status,201);assert.equal((await request('orders',o)).status,200);
 const depleted=await (await request('card',{id:b.id,token:b.token})).json();assert.equal(depleted.reward_drinks,0);
 assert.equal((await request('orders',{...o,id:crypto.randomUUID(),token:token()})).status,409);
});

test('الحليب كامل الدسم فقط',async()=>{const r=await request('orders',{...order(),customization:{milk:'oat'}});assert.equal(r.status,400);});
