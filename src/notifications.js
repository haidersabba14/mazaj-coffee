import {buildPushPayload} from '@block65/webcrypto-web-push';
const now=()=>Math.floor(Date.now()/1000);
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export function validPushEndpoint(endpoint){try{const u=new URL(endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname);}catch{return false;}}
export const pushConfigured=env=>!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY);
export const apnsConfigured=env=>!!(env.APNS_KEY&&env.APNS_KEY_ID&&env.APPLE_TEAM_ID&&env.APNS_TOPIC);
export async function enqueueNotification(env,order,kind){
 const number=order.order_number?'CR-'+order.order_number:order.id.slice(0,8);
 const copy={ready:['☕ طلبك جاهز!',`طلبك رقم ${number} جاهز ${order.fulfillment==='delivery'?'للتوصيل':'للاستلام'}. تفضل لاستلام قهوتك ❤️`],accepted:['تم قبول طلبك',`طلبك ${number} قُبل وبنبدأ تجهيزه.`],cancelled:['تحديث على طلبك',order.rejection_reason||'نعتذر، تم إلغاء الطلب.'],new:['☕ طلب جديد',`وصل طلب جديد ${number}`],message:['رسالة من المقهى',order.message||'هناك تحديث جديد على طلبك.']};
 const [title,body]=copy[kind.split(':')[0]]||copy.ready;
 const payload={title,body,orderId:order.id,number,kind,tag:'royal-'+order.id,url:kind==='new'?'/manager.html':'/',callAt:order.called_at||null};
 await env.DB.prepare("INSERT OR IGNORE INTO notification_jobs(id,order_id,kind,payload,next_attempt,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),order.id,kind,JSON.stringify(payload),now(),now()).run();
}
async function sendAPNS(env,device,payload){
 if(!apnsConfigured(env))return {state:'unconfigured',code:'apns_not_configured'};
 const header=b64(new TextEncoder().encode(JSON.stringify({alg:'ES256',kid:env.APNS_KEY_ID}))),claims=b64(new TextEncoder().encode(JSON.stringify({iss:env.APPLE_TEAM_ID,iat:now()})));
 const pem=env.APNS_KEY.replace(/-----[^-]+-----|\s/g,'');const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(header+'.'+claims)));
 const host=env.APNS_SANDBOX==='true'?'api.sandbox.push.apple.com':'api.push.apple.com';
 const r=await fetch(`https://${host}/3/device/${device.endpoint}`,{method:'POST',headers:{authorization:'bearer '+header+'.'+claims+'.'+signature,'apns-topic':env.APNS_TOPIC,'apns-push-type':'alert','apns-priority':'10','apns-expiration':String(now()+3600),'apns-collapse-id':payload.tag,'content-type':'application/json'},body:JSON.stringify({aps:{alert:{title:payload.title,body:payload.body},sound:'default'},orderId:payload.orderId}),signal:AbortSignal.timeout(10000)});
 return {state:r.ok?'sent':r.status===410?'expired':'failed',status:r.status,code:r.ok?'':'apns_http_'+r.status};
}
async function sendWeb(env,device,payload){
 if(!pushConfigured(env))return {state:'unconfigured',code:'vapid_not_configured'};
 if(!validPushEndpoint(device.endpoint))return {state:'failed',code:'invalid_endpoint'};
 const options=await buildPushPayload({data:JSON.stringify(payload),options:{ttl:3600,urgency:'high',topic:payload.orderId.replace(/-/g,'').slice(0,32)}},{endpoint:device.endpoint,expirationTime:null,keys:JSON.parse(device.keys)},{subject:env.VAPID_SUBJECT||'https://mazaj-cafe-995.pages.dev',publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
 const r=await fetch(device.endpoint,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});
 return {state:r.ok?'sent':[404,410].includes(r.status)?'expired':'failed',status:r.status,code:r.ok?'':'push_http_'+r.status};
}
export async function processNotifications(env,limit=8){
 const jobs=(await env.DB.prepare("SELECT id FROM notification_jobs WHERE state IN('pending','retry','sending') AND attempts<4 AND next_attempt<=? AND lease_until<? ORDER BY created_at LIMIT ?").bind(now(),now(),limit).all()).results;
 for(const {id} of jobs){
  const job=await env.DB.prepare("UPDATE notification_jobs SET state='sending',attempts=attempts+1,lease_until=? WHERE id=? AND state IN('pending','retry','sending') AND lease_until<? RETURNING *").bind(now()+180,id,now()).first();if(!job)continue;
  const devices=(await env.DB.prepare(job.kind==='new'?"SELECT p.* FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash AND s.expires>unixepoch() LEFT JOIN staff f ON f.id=p.user_id WHERE p.user_id IS NOT NULL AND p.active=1 AND (p.user_id='owner' OR f.active=1) LIMIT 30":"SELECT * FROM push_subscriptions WHERE order_id=? AND active=1 LIMIT 3").bind(...(job.kind==='new'?[]:[job.order_id])).all()).results;
  if(!devices.length){await env.DB.prepare("UPDATE notification_jobs SET state='no_subscription',lease_until=0 WHERE id=?").bind(id).run();continue;}
  let failed=false,sent=false,unconfigured=false;
  for(const d of devices){
   // An accepted provider response is recorded once; retries target failed devices only.
   if(await env.DB.prepare("SELECT 1 FROM notification_attempts WHERE job_id=? AND subscription_id=? AND state='sent'").bind(id,d.id).first()){sent=true;continue;}
   let result;try{const payload=JSON.parse(job.payload);result=d.channel==='apns'?await sendAPNS(env,d,payload):await sendWeb(env,d,payload);}catch{result={state:'failed',code:'transport_error'};}
   await env.DB.prepare('INSERT INTO notification_attempts VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,d.id,result.state,result.status||null,result.code||'',now()).run();
   if(result.state==='expired')await env.DB.prepare('UPDATE push_subscriptions SET active=0 WHERE id=?').bind(d.id).run();
   if(result.state==='sent')sent=true;else if(result.state==='unconfigured')unconfigured=true;else if(result.state!=='expired')failed=true;
  }
  const state=failed?(job.attempts<4?'retry':'failed'):unconfigured?'unconfigured':sent?'sent':'expired';
  await env.DB.prepare('UPDATE notification_jobs SET state=?,lease_until=0,next_attempt=? WHERE id=?').bind(state,now()+Math.min(3600,30*2**job.attempts),id).run();
 }
}
