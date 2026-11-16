import {build} from 'esbuild';
const bundled=(await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser'})).outputFiles[0].text;
import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pbkdf2Sync,randomBytes,generateKeyPairSync} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {MockAgent} from 'undici';
import {hash,isOpen,bahrainDate,bahrainWeekday,pricing,emailHtml} from '../src/worker.js';
const vapid=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});const vapidPublic=Buffer.concat([Buffer.from([4]),Buffer.from(vapid.x,'base64url'),Buffer.from(vapid.y,'base64url')]).toString('base64url');
const origin='https://coffee.test';let mf,db,cookie;const token=()=>randomBytes(32).toString('hex'),password='test-admin-password-long';
const mock=new MockAgent();mock.disableNetConnect();
const site=mock.get('https://challenges.cloudflare.com');site.intercept({path:'/turnstile/v0/siteverify',method:'POST'}).reply(200,{success:true,hostname:'coffee.test',action:'checkout'}).persist();
mock.get('https://fcm.googleapis.com').intercept({path:'/fcm/send/royal-test',method:'POST'}).reply(201,'').persist();
const resend=mock.get('https://api.resend.com');resend.intercept({path:'/emails',method:'POST'}).reply(200,{id:'email-test'}).persist();
async function request(path,data,auth=false,customOrigin=origin){return mf.dispatchFetch(origin+'/api/'+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json','Origin':customOrigin}:{}),...(auth?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});}
function order(){return {id:crypto.randomUUID(),token:token(),name:'عميل الاختبار',phone:'+973 33333333',notes:'بدون سكر',items:[{id:'cappuccino',quantity:1}],expectedTotal:0,turnstile:'test-token'};}
async function migrate(d){for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile('migrations/'+file,'utf8');let regular='';const flush=async()=>{for(const stmt of regular.split(';').map(s=>s.trim()).filter(Boolean))await d.prepare(stmt).run();regular='';};for(const line of sql.split('\n')){if(line.startsWith('CREATE TRIGGER')){await flush();await d.exec(line);}else regular+=line+'\n';}await flush();}}
before(async()=>{const salt='test-salt';mf=new Miniflare({modules:true,script:bundled,compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{TURNSTILE_SITE_KEY:'test-site',TURNSTILE_SECRET:'test-secret',RATE_SALT:'test-rate-salt',ADMIN_PASSWORD_HASH:salt+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'),VAPID_PUBLIC_KEY:vapidPublic,VAPID_PRIVATE_KEY:vapid.d,RESEND_API_KEY:'test',EMAIL_FROM:'coffee@example.com'},serviceBindings:{ASSETS:()=>new Response('asset')},fetchMock:mock});db=await mf.getD1Database('DB');await migrate(db);await db.prepare('UPDATE settings SET opening_hour=0,all_free=1').run();await db.prepare('UPDATE branches SET opening_hour=0').run();});
beforeEach(async()=>{await db.prepare('DELETE FROM limits').run();});
after(async()=>{await mf.dispose();await mock.close();});
test('البحرين: يفتح ٣ عصرًا والعرض ينتهي عند منتصف الليل',()=>{assert.equal(isOpen({accepting:1,opening_hour:15},new Date('2026-11-13T11:59:59Z')),false);assert.equal(isOpen({accepting:1,opening_hour:15},new Date('2026-11-13T12:00:00Z')),true);assert.equal(isOpen({accepting:0,opening_hour:15},new Date('2026-11-13T12:00:00Z')),false);assert.equal(bahrainDate(new Date('2026-11-13T21:00:00Z')),'2026-11-14');});
test('كل واجهات الإدارة محمية ولا تسرب بيانات',async()=>{for(const p of ['data','status','settings','product','retry','logout'])assert.equal((await request('admin/'+p,p==='data'?undefined:{})).status,401);});
test('منع المصدر الخارجي',async()=>assert.equal((await request('orders',order(),false,'https://attacker.test')).status,403));
test('تسجيل دخول آمن وقراءة الإحصاءات',async()=>{assert.equal((await request('login',{password:'wrong'})).status,401);const r=await request('login',{password});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);cookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await request('admin/data',undefined,true)).status,200);});
test('حفظ طلب فعلي، منع التكرار، تتبع آمن، بريد ومراجعة الإجمالي',async()=>{const b=order(),r=await request('orders',b);assert.equal(r.status,201);const j=await r.json();assert.equal(j.total,0);assert.equal(j.subtotal,2000);assert.equal((await db.prepare('SELECT name FROM orders WHERE id=?').bind(b.id).first()).name,b.name);assert.equal((await request('orders',b)).status,200);assert.equal((await db.prepare('SELECT COUNT(*) n FROM orders WHERE id=?').bind(b.id).first()).n,1);assert.equal((await request('orders',{...b,notes:'changed'})).status,409);const track=await request('track',{id:b.id,token:b.token});const data=await track.json();assert.equal(data.status,'new');assert.equal(data.name,undefined);assert.equal(data.phone,undefined);assert.equal(data.token_hash,undefined);assert.equal((await request('track',{id:b.id,token:token()})).status,404);const stored=await db.prepare('SELECT token_hash FROM orders WHERE id=?').bind(b.id).first();assert.equal(stored.token_hash,await hash(b.token));});
test('رفض كمية غير صالحة ومنتج مجهول وعدم الثقة بالسعر',async()=>{assert.equal((await request('orders',{...order(),items:[{id:'cappuccino',quantity:-1}]})).status,400);assert.equal((await request('orders',{...order(),items:[{id:'unknown',quantity:1}]})).status,400);assert.equal((await request('orders',{...order(),expectedTotal:2000})).status,409);});
test('سعر دينارين لكل مشروب بعد العرض وإغلاق الطلبات',async()=>{await db.prepare('UPDATE settings SET all_free=0,promotion_weekday=?').bind((bahrainWeekday()+1)%7).run();assert.equal((await request('orders',order())).status,409);await db.prepare('DELETE FROM limits').run();const b=order();const r=await request('orders',{...b,expectedTotal:2000,items:[{id:'cappuccino',quantity:1,price:0}]});assert.equal(r.status,201);assert.equal((await r.json()).total,2000);await request('admin/settings',{accepting:false,opening_hour:15},true);assert.equal((await request('orders',order())).status,409);});
test('تعديل الحالة والإخفاء والإعدادات وتسجيل الخروج',async()=>{const o=await db.prepare('SELECT id FROM orders LIMIT 1').first();assert.equal((await request('admin/status',{id:o.id,status:'preparing'},true)).status,200);assert.equal((await request('admin/status',{id:o.id,status:'ready'},true)).status,200);assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').bind(o.id).first()).status,'ready');assert.equal((await request('admin/status',{id:o.id,status:'invalid'},true)).status,400);assert.equal((await request('admin/product',{id:'new',name:'قهوة جديدة',description:'وصف جديد',image:'javascript:alert(1)',category:'hot',available:true},true)).status,400);assert.equal((await request('admin/logout',{},true)).status,200);assert.equal((await request('admin/data',undefined,true)).status,401);});
test('ترميز HTML في البريد',()=>{const html=emailHtml({id:'test',name:'<script>bad</script>',phone:'1234567',notes:'<img src=x>',items:JSON.stringify([{name:'قهوة',quantity:2}]),created_at:1,total:0});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('0.000 د.ب.'));});
test('تحديد محاولات التتبع',async()=>{for(let i=0;i<20;i++)assert.equal((await request('track',{id:crypto.randomUUID(),token:token()})).status,404);assert.equal((await request('track',{id:crypto.randomUUID(),token:token()})).status,429);});
test('فشل البريد لا يمنع الحفظ وتُعاد المحاولة دون تكرار الطلب',async()=>{
 const salt='failure-test',f=new Miniflare({modules:true,script:bundled,compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{TURNSTILE_SITE_KEY:'site',TURNSTILE_SECRET:'secret',RATE_SALT:'salt',ADMIN_PASSWORD_HASH:salt+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')},serviceBindings:{ASSETS:()=>new Response('asset')},fetchMock:mock});
 try{const d=await f.getD1Database('DB');await migrate(d);await d.prepare('UPDATE settings SET opening_hour=0,all_free=1').run();await d.prepare('UPDATE branches SET opening_hour=0').run();const b=order();const r=await f.dispatchFetch(origin+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(b)});assert.equal(r.status,201);await r.text();
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
 const b={...order(),fulfillment:'delivery',location:{lat:26.22,lng:50.58},address:'طريق الاختبار',customization:{milk:'whole',sugar:'none',size:'medium'}};
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
test('المتابعة المتكررة لطلب صحيح لا تتوقف عند حد المحاولات الخاطئة',async()=>{
 await db.prepare('UPDATE settings SET accepting=1,opening_hour=0,all_free=1').run();
 const b=order();assert.equal((await request('orders',b)).status,201);
 for(let i=0;i<25;i++)assert.equal((await request('track',{id:b.id,token:b.token})).status,200);
});
async function loginOwner(){const r=await request('login',{password});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];return cookie;}
test('أحجام صغير ووسط فقط والشاي والقهوة العربية بسكر عادي',async()=>{
 await db.prepare('UPDATE settings SET accepting=1,opening_hour=0,all_free=1,capacity=200').run();
 assert.equal((await request('orders',{...order(),customization:{size:'large'}})).status,400);
 assert.equal((await request('orders',{...order(),items:[{id:'tea',quantity:1}],customization:{size:'small',sugar:'none'}})).status,400);
 const b={...order(),items:[{id:'arabic-coffee',quantity:1}],customization:{size:'medium'}};assert.equal((await request('orders',b)).status,201);assert.equal(JSON.parse((await db.prepare('SELECT customization FROM orders WHERE id=?').bind(b.id).first()).customization).sugar,'normal');
});
test('أرقام CR فريدة وحالات صحيحة واستدعاء واحد وتأكيد آمن من الزبون',async()=>{
 await loginOwner();const b=order(),c=order();const [r1,r2]=await Promise.all([request('orders',b),request('orders',c)]);assert.equal(r1.status,201);assert.equal(r2.status,201);const a=await r1.json(),z=await r2.json();assert.match(a.order_label,/^CR-\d+$/);assert.notEqual(a.order_label,z.order_label);
 assert.equal((await request('admin/status',{id:b.id,status:'ready'},true)).status,409);
 assert.equal((await request('admin/status',{id:b.id,status:'accepted',version:0},true)).status,200);
 assert.equal((await request('admin/status',{id:b.id,status:'preparing',version:0},true)).status,409);
 assert.equal((await request('admin/status',{id:b.id,status:'preparing',version:1},true)).status,200);
 const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'}),p256dh=Buffer.concat([Buffer.from([4]),Buffer.from(key.x,'base64url'),Buffer.from(key.y,'base64url')]).toString('base64url');
 const sub={id:b.id,token:b.token,permission:'granted',subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/royal-test',keys:{p256dh,auth:randomBytes(16).toString('base64url')}}};
 assert.equal((await request('push/subscribe',sub)).status,200);assert.equal((await request('push/subscribe',{...sub,token:token()})).status,404);
 assert.equal((await request('admin/status',{id:b.id,status:'ready',version:2},true)).status,200);
 await Promise.all([request('admin/call',{id:b.id},true),request('admin/call',{id:b.id},true)]);
 const o=await db.prepare('SELECT * FROM orders WHERE id=?').bind(b.id).first();assert.equal(o.call_count,1);assert.equal(o.acknowledged_at,null);
 const jobs=await db.prepare("SELECT COUNT(*) n FROM notification_jobs WHERE order_id=? AND kind='ready'").bind(b.id).first();assert.equal(jobs.n,1);const sent=await db.prepare("SELECT state FROM notification_jobs WHERE order_id=? AND kind='ready'").bind(b.id).first();assert.equal(sent.state,'sent');const acceptedCount=await db.prepare("SELECT COUNT(*) n FROM notification_attempts a JOIN notification_jobs j ON j.id=a.job_id WHERE j.order_id=? AND j.kind='ready' AND a.state='sent'").bind(b.id).first();assert.equal(acceptedCount.n,1);
 const tracked=await(await request('track',{id:a.order_label,token:b.token})).json();assert.equal(tracked.id,b.id);assert.equal(tracked.name,undefined);assert.ok(tracked.called_at);
 assert.equal((await request('order/acknowledge',{id:b.id,token:token()})).status,404);assert.equal((await request('order/acknowledge',{id:b.id,token:b.token})).status,200);
 const ack=await(await request('order/acknowledge',{id:b.id,token:b.token})).json();assert.ok(ack.acknowledged_at);assert.ok((await(await request('admin/audit',undefined,true)).json()).events.some(e=>e.action==='customer_acknowledged'&&e.order_id===b.id));assert.equal((await db.prepare('SELECT acknowledged_at FROM orders WHERE id=?').bind(b.id).first()).acknowledged_at,ack.acknowledged_at);
 assert.equal((await request('admin/status',{id:b.id,status:'delivered'},true)).status,200);assert.equal((await request('admin/status',{id:b.id,status:'new'},true)).status,409);
 const stored=await db.prepare('SELECT ready_at,delivered_at,preparation_started_at FROM orders WHERE id=?').bind(b.id).first();assert.ok(stored.ready_at&&stored.delivered_at&&stored.preparation_started_at);
});
test('رفض روابط Push الخطرة وعدم نشر مفاتيح سرية',async()=>{
 const b=order();await request('orders',b);const config=await(await request('push/config')).json();assert.equal(config.publicKey,vapidPublic);assert.equal(config.privateKey,undefined);
 assert.equal((await request('push/subscribe',{id:b.id,token:b.token,permission:'granted',subscription:{endpoint:'https://127.0.0.1/private',keys:{}}})).status,400);
 assert.equal((await request('push/subscribe',{id:b.id,token:b.token,permission:'denied'})).status,200);assert.equal((await db.prepare('SELECT notification_permission FROM orders WHERE id=?').bind(b.id).first()).notification_permission,'denied');
});
test('المخزون ذري تحت التزامن ويرجع مرة واحدة عند الإلغاء',async()=>{
 await loginOwner();await request('admin/stock',{id:'secret',stock:1},true);const a={...order(),items:[{id:'secret',quantity:1}]},b={...order(),items:[{id:'secret',quantity:1}]};const responses=await Promise.all([request('orders',a),request('orders',b)]);assert.equal(responses.filter(r=>r.status===201).length,1);assert.equal((await db.prepare("SELECT stock FROM products WHERE id='secret'").first()).stock,0);const winner=responses[0].status===201?a:b;
 await request('admin/status',{id:winner.id,status:'cancelled',reason:'اختبار المخزون'},true);await request('admin/status',{id:winner.id,status:'cancelled',reason:'اختبار المخزون'},true);assert.equal((await db.prepare("SELECT stock FROM products WHERE id='secret'").first()).stock,1);await request('admin/stock',{id:'secret',stock:-1},true);
});
test('صلاحيات الموظفين والجلسات الملغاة والتخصيص الخاص بكل مستخدم',async()=>{
 const ownerCookie=await loginOwner();const id=crypto.randomUUID(),staffPassword='staff-password-long-123';let r=await request('admin/staff',{id,username:'barista',name:'موظف الاختبار',password:staffPassword,role:'staff',active:true},true);assert.equal(r.status,200);
 r=await request('login',{username:'barista',password:staffPassword});assert.equal(r.status,200);const staffCookie=r.headers.get('set-cookie').split(';')[0];cookie=staffCookie;
 for(const path of ['staff','audit','diagnostics','backup','export','ingredients','images','archives'])assert.equal((await request('admin/'+path,undefined,true)).status,403);
 assert.equal((await request('admin/product',{id:'black',name:'غير مسموح'},true)).status,403);
 assert.equal((await request('admin/preferences',{settings:{theme:'light',tone:'bell',volume:.3,sound:false,accent:'#123456'}},true)).status,200);
 assert.equal((await(await request('admin/preferences',undefined,true)).json()).settings.theme,'light');
 const second=await request('login',{username:'barista',password:staffPassword});const otherCookie=second.headers.get('set-cookie').split(';')[0];await request('admin/revoke-sessions',{},true);cookie=otherCookie;assert.equal((await request('admin/me',undefined,true)).status,401);cookie=staffCookie;assert.equal((await request('admin/me',undefined,true)).status,200);
 cookie=ownerCookie;assert.notEqual((await(await request('admin/preferences',undefined,true)).json()).settings.theme,'light');
 assert.equal((await request('admin/staff',{id,username:'barista',name:'موظف الاختبار',role:'staff',active:false},true)).status,200);cookie=staffCookie;assert.equal((await request('admin/me',undefined,true)).status,401);cookie=ownerCookie;
});
test('وضع المشغول والصيانة والسعة تمنع الطلبات على الخادم',async()=>{
 await loginOwner();await db.prepare('UPDATE settings SET maintenance=1').run();assert.equal((await request('orders',order())).status,409);await db.prepare('UPDATE settings SET maintenance=0,capacity=1').run();assert.equal((await request('orders',order())).status,409);await db.prepare('UPDATE settings SET capacity=200').run();
});
test('أرشفة الطلبات المنتهية وسجل إداري ونسخة خاصة وتصدير CSV',async()=>{
 await loginOwner();const o=await db.prepare("SELECT id FROM orders WHERE status='cancelled' LIMIT 1").first();assert.equal((await request('admin/archive',{id:o.id},true)).status,200);const list=await(await request('admin/data',undefined,true)).json();assert.ok(!list.orders.some(r=>r.id===o.id));const a=await(await request('admin/audit',undefined,true)).json();assert.ok(a.events.some(a=>a.action==='order_archived'));
 const csv=await request('admin/export',undefined,true);assert.match(csv.headers.get('content-type'),/text\/csv/);assert.ok((await csv.text()).includes('order_number'));
 const backup=await(await request('admin/backup',undefined,true)).json();assert.equal(backup.version,3);assert.ok(Array.isArray(backup.tables.orders));assert.equal(backup.tables.sessions,undefined);
});

test('اسم مالك مخصص مطلوب ولا يقبل الاسم القديم أو كلمة المرور وحدها',async()=>{
 const salt='custom-owner',f=new Miniflare({modules:true,script:bundled,compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{RATE_SALT:'salt',ADMIN_USERNAME:'Royal_Owner',ADMIN_PASSWORD_HASH:salt+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')},serviceBindings:{ASSETS:()=>new Response('asset')}});
 try{await migrate(await f.getD1Database('DB'));const send=b=>f.dispatchFetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(b)});assert.equal((await send({username:'owner',password})).status,401);assert.equal((await send({password})).status,401);assert.equal((await send({username:'ROYAL_OWNER',password})).status,200);}finally{await f.dispose();}
});

test('المكونات تُخصم ذريًا وتعود بكميتها الأصلية بعد تغيير الوصفة',async()=>{
 await loginOwner();await db.prepare('UPDATE settings SET accepting=1,opening_hour=0,capacity=200').run();const ingredientId=crypto.randomUUID();
 assert.equal((await request('admin/ingredients',{id:ingredientId,name:'بن اختبار',unit:'g',stock_milli:20000,reorder_level_milli:5000,active:true},true)).status,200);
 assert.equal((await request('admin/recipe',{id:'black',ingredients:[{id:ingredientId,quantity_milli:20000}]},true)).status,200);
 const a={...order(),items:[{id:'black',quantity:1}]},b={...order(),items:[{id:'black',quantity:1}]};const results=await Promise.all([request('orders',a),request('orders',b)]);assert.equal(results.filter(r=>r.status===201).length,1);assert.equal((await db.prepare('SELECT stock_milli FROM ingredients WHERE id=?').bind(ingredientId).first()).stock_milli,0);
 const catalog=await(await request('catalog')).json();assert.ok(!catalog.products.some(p=>p.id==='black'));
 await request('admin/recipe',{id:'black',ingredients:[{id:ingredientId,quantity_milli:1000}]},true);const winner=results[0].status===201?a:b;
 assert.equal((await request('admin/status',{id:winner.id,status:'cancelled',reason:'اختبار الوصفة'},true)).status,200);await request('admin/status',{id:winner.id,status:'cancelled',reason:'اختبار الوصفة'},true);assert.equal((await db.prepare('SELECT stock_milli FROM ingredients WHERE id=?').bind(ingredientId).first()).stock_milli,20000);
 assert.equal((await request('admin/ingredients',{id:ingredientId,name:'بن اختبار',unit:'ml',stock_milli:20000,reorder_level_milli:5000,active:true},true)).status,409);
 await request('admin/recipe',{id:'black',ingredients:[]},true);
 assert.equal((await request('admin/recipe',{id:'black',ingredients:[{id:ingredientId,quantity_milli:-1}]},true)).status,400);
});
test('رفع صور حقيقية وحمايتها ورفض SVG والملفات الكبيرة وحذف غير المستخدم فقط',async()=>{
 await loginOwner();const bytes=await readFile('public/images/icon-192.png');const upload=async(data,type)=>mf.dispatchFetch(origin+'/api/admin/images',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':type},body:data});
 assert.equal((await upload('<svg/>','image/svg+xml')).status,415);assert.equal((await upload(new Uint8Array(205000),'image/png')).status,413);assert.equal((await upload('bad image','image/png')).status,400);
 const result=await upload(bytes,'image/png');assert.equal(result.status,201);const image=await result.json();const loaded=await mf.dispatchFetch(origin+image.url);assert.equal(loaded.status,200);assert.equal(loaded.headers.get('content-type'),'image/png');const imageData=Buffer.from(await loaded.arrayBuffer());assert.equal(imageData.length,bytes.length);assert.deepEqual(imageData,bytes);
 await request('admin/product',{id:'black',name:'بلاك كوفي',description:'مشروب اختبار',image:image.url,category:'hot',available:true},true);assert.equal((await request('admin/image-delete',{id:image.id},true)).status,409);
 await request('admin/product',{id:'black',name:'بلاك كوفي',description:'مشروب اختبار',image:'/images/black.webp',category:'hot',available:true},true);assert.equal((await request('admin/image-delete',{id:image.id},true)).status,200);assert.equal((await mf.dispatchFetch(origin+image.url)).status,404);
});
test('تقارير مؤرخة وفرع مستقل وتصدير Excel حقيقي دون صيغ قابلة للتنفيذ',async()=>{
 await loginOwner();const {unzipSync,strFromU8}=await import('fflate');const {spreadsheet}=await import('../src/reporting.js');const x=await request('admin/export?format=xlsx',undefined,true);assert.equal(x.status,200);assert.match(x.headers.get('content-type'),/spreadsheetml/);const zipped=unzipSync(new Uint8Array(await x.arrayBuffer()));assert.ok(zipped['xl/workbook.xml']);assert.ok(strFromU8(zipped['xl/worksheets/sheet1.xml']).includes('order_number'));
 const safe=unzipSync(spreadsheet(['name'],[['=HYPERLINK("https://example.com")'],['<script>']]));const sheet=strFromU8(safe['xl/worksheets/sheet1.xml']);assert.ok(sheet.includes('inlineStr'));assert.ok(!sheet.includes('<f>'));assert.ok(sheet.includes('&lt;script&gt;'));
 const r=await(await request('admin/report?from=2000-01-01&to=2000-01-02',undefined,true)).json();assert.equal(r.summary.orders,0);assert.equal((await request('admin/report?from=2026-02-30',undefined,true)).status,400);assert.equal((await request('admin/export?from=2026-11-20&to=2026-11-01',undefined,true)).status,400);
 const id=crypto.randomUUID();assert.equal((await request('admin/branches',{id,name:'فرع اختبار',opening_hour:0,closing_hour:24,active:true},true)).status,200);const o={...order(),branch_id:id};assert.equal((await request('orders',o)).status,201);const scoped=await(await request('admin/report?branch='+id,undefined,true)).json();assert.equal(scoped.summary.orders,1);assert.equal(scoped.branches[0].branch_id,id);
 await request('admin/branches',{id,name:'فرع اختبار',opening_hour:0,closing_hour:24,active:false},true);assert.equal((await request('orders',{...order(),branch_id:id})).status,409);
});
test('التخصيص يرفض إدخال CSS وترتيبًا مكررًا ويحفظ الخطوط والاختصارات',async()=>{
 await loginOwner();assert.equal((await request('admin/preferences',{settings:{background:'url(javascript:bad)'}},true)).status,400);assert.equal((await request('admin/preferences',{settings:{metrics:['daily','daily']}},true)).status,400);assert.equal((await request('admin/preferences',{settings:{sections:['unknown']}},true)).status,400);
 const settings={theme:'system',accent:'#112233',background:'coffee',font:'rounded',icons:'filled',sections:['products','orders','management'],shortcuts:['ready','accepted'],metrics:['weekly','daily'],sound:false,volume:.25};assert.equal((await request('admin/preferences',{settings},true)).status,200);assert.deepEqual((await(await request('admin/preferences',undefined,true)).json()).settings,settings);
 const archived=await(await request('admin/archives',undefined,true)).json();if(archived.orders.length){const id=archived.orders[0].id;assert.equal((await request('admin/archive',{id,archived:false},true)).status,200);assert.ok(!(await(await request('admin/archives',undefined,true)).json()).orders.some(o=>o.id===id));}
});
test('حد مكتبة الصور ذري عند رفعين متزامنين',async()=>{
 await loginOwner();await db.batch(Array.from({length:99},(_,n)=>db.prepare('INSERT INTO product_images VALUES(?,?,?,?,?,?)').bind('quota-'+n,'image/png',new Uint8Array([1]).buffer,1,1,'owner')));
 try{const bytes=await readFile('public/images/icon-192.png'),upload=()=>mf.dispatchFetch(origin+'/api/admin/images',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'image/png'},body:bytes});const r=await Promise.all([upload(),upload()]);assert.equal(r.filter(r=>r.status===201).length,1);assert.equal(r.filter(r=>r.status===409).length,1);assert.equal((await db.prepare('SELECT COUNT(*) n FROM product_images').first()).n,100);}finally{await db.prepare('DELETE FROM product_images').run();}
});
