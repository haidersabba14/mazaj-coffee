const now=()=>Math.floor(Date.now()/1000),hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
export async function resolveGroup(env,code,customer,fail){
 if(code===undefined||code===null||code==='')return null;if(typeof code!=='string'||!/^[a-f0-9]{24}$/.test(code))fail('رابط المجموعة غير صالح');if(!customer)fail('سجّل دخولك للمشاركة في الطلب الجماعي',401);const group=await env.DB.prepare('SELECT * FROM group_batches WHERE code=?').bind(code).first();if(!group)fail('المجموعة غير موجودة',404);return group;
}
export async function groupRoutes(req,env,h){
 const {json,fail,text,rate,customer}=h,url=new URL(req.url),p=url.pathname,m=req.method;
 if(p==='/api/group'&&m==='GET'){const code=url.searchParams.get('code')||'';if(!/^[a-f0-9]{24}$/.test(code))fail('رابط المجموعة غير صالح');const g=await env.DB.prepare("SELECT g.label,g.branch_id,g.max_members,g.expires_at,g.closed,b.name branch_name,(SELECT COUNT(*) FROM orders WHERE group_id=g.id AND status!='cancelled') members,(SELECT COUNT(*) FROM orders WHERE group_id=g.id AND status='ready') ready FROM group_batches g JOIN branches b ON b.id=g.branch_id WHERE g.code=?").bind(code).first();if(!g)fail('المجموعة غير موجودة',404);return json({group:{...g,open:!g.closed&&g.expires_at>now()&&g.members<g.max_members}});}
 if(!['/api/customer/groups','/api/customer/group-close'].includes(p))return null;if(!customer)fail('سجّل دخولك أولًا',401);
 if(p==='/api/customer/groups'){
  if(m==='GET')return json({groups:(await env.DB.prepare("SELECT g.*,(SELECT COUNT(*) FROM orders WHERE group_id=g.id AND status!='cancelled') members FROM group_batches g WHERE owner_customer_id=? ORDER BY created_at DESC LIMIT 20").bind(customer.id).all()).results});
  if(m==='POST'){await rate(env,'group-create:'+customer.id,3,3600);const b=await h.body(req);if(!b||typeof b!=='object'||Array.isArray(b))fail('بيانات غير صالحة');const label=text(b.label,2,80),branch=text(b.branch_id||'main',1,40),max=b.max_members??10,hours=b.hours??2;if(!Number.isInteger(max)||max<2||max>20||!Number.isInteger(hours)||hours<1||hours>24)fail('من ٢ إلى ٢٠ عضوًا، وصلاحية من ساعة إلى ٢٤ ساعة');if(!await env.DB.prepare('SELECT id FROM branches WHERE id=? AND active=1').bind(branch).first())fail('الفرع غير متاح');const id=crypto.randomUUID(),code=hex(crypto.getRandomValues(new Uint8Array(12)));await env.DB.prepare('INSERT INTO group_batches(id,code,owner_customer_id,label,branch_id,max_members,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,code,customer.id,label,branch,max,now(),now()+hours*3600).run();return json({id,code,label,expires_at:now()+hours*3600},201);}
 }
 if(p==='/api/customer/group-close'&&m==='POST'){const b=await h.body(req);if(!b||typeof b!=='object')fail('بيانات غير صالحة');const r=await env.DB.prepare('UPDATE group_batches SET closed=1 WHERE id=? AND owner_customer_id=?').bind(text(b.id,36,36),customer.id).run();if(!r.meta.changes)fail('المجموعة غير موجودة',404);return json({ok:true});}
 return null;
}
