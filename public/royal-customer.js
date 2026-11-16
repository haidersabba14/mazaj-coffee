(()=>{
 const $=s=>document.querySelector(s);let order=null,context=null,ringTimer=null,installPrompt=null,pushConfig=null,subscribedTo='',soundOn=false;
 try{order=JSON.parse(localStorage.getItem('mazaj-receipt'));}catch{}
 const preferences=(()=>{try{return {tone:'royal',volume:.65,...JSON.parse(localStorage.getItem('royal-sound')||'{}')};}catch{return {tone:'royal',volume:.65};}})();
 $('#sound-tone').value=preferences.tone;
 async function call(path,data){const r=await fetch('/api/'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const b=await r.json();if(!r.ok)throw Error(b.error||'تعذر الاتصال');return b;}
 function help(message){$('#order-notification-help').textContent=message;}
 function sound(){
  if(!soundOn||!context||context.state!=='running'||document.hidden)return;
  const frequencies=preferences.tone==='bell'?[660,880]:preferences.tone==='bright'?[880,1174,1318]:[523,659,784,1046];
  frequencies.forEach((f,i)=>{const osc=context.createOscillator(),gain=context.createGain(),t=context.currentTime+i*.19;osc.type='sine';osc.frequency.value=f;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(preferences.volume*.28,t+.025);gain.gain.exponentialRampToValueAtTime(.001,t+.6);osc.connect(gain);gain.connect(context.destination);osc.start(t);osc.stop(t+.65);});
  if(navigator.vibrate)navigator.vibrate([180,100,180]);
 }
 async function enableSound(){try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error();context=context||new Audio();await context.resume();soundOn=true;$('#sound-enable').textContent='صوت التنبيه مفعّل ✓';sound();updateRinging();}catch{help('الصوت غير متاح. تنبيه الجاهزية سيظهر على الشاشة.');}}
 function updateRinging(){const shouldRing=order?.status==='ready'&&!!order.called_at&&!order.acknowledged_at&&soundOn&&!document.hidden;if(shouldRing&&!ringTimer){sound();ringTimer=setInterval(sound,7000);}else if(!shouldRing&&ringTimer){clearInterval(ringTimer);ringTimer=null;}}
 function render(){if(!order)return;$('#royal-order-number').textContent=order.order_label||(order.order_number?'CR-'+order.order_number:order.id?.slice(0,8)||'');const labels=['القبول','التحضير','جاهز','التسليم'],step={new:0,accepted:1,preparing:2,ready:3,delivered:4}[order.status]||0;$('#order-progress').replaceChildren(...labels.map((label,i)=>{const el=document.createElement('span');el.textContent=label;el.className=i<step?'done':'';return el;}));$('#acknowledge-call').hidden=!(order.status==='ready'&&order.called_at&&!order.acknowledged_at);$('#order-stage').classList.toggle('ready',order.status==='ready');$('#order-messages').replaceChildren(...(order.messages||[]).map(m=>{const p=document.createElement('p');p.textContent=m.text;return p;}));if(order.acknowledged_at)help('أكدت استلام التنبيه. المقهى يعرف أنك شفت الاستدعاء.');updateRinging();
  if('Notification'in window){const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;const ios=/iPad|iPhone|iPod/.test(navigator.userAgent);$('#enable-order-notifications').hidden=Notification.permission==='denied'||(subscribedTo===order.id&&Notification.permission==='granted');$('#enable-order-notifications').textContent=ios&&!standalone?'ثبّت التطبيق لتفعيل إشعارات الطلب':'تفعيل إشعارات الطلب';}
 }
 function keyBytes(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
 async function savePermission(permission){if(!order)return;try{await call('push/subscribe',{id:order.id,token:order.token,permission});}catch{}}
 async function subscribe(ask=false){
  if(!order)return;const ios=/iPad|iPhone|iPod/.test(navigator.userAgent),standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  if(ios&&!standalone){$('#install-dialog').showModal();return;}
  if(!('Notification'in window)||!('PushManager'in window)||!('serviceWorker'in navigator)){await savePermission('unsupported');help('إشعارات الخلفية غير مدعومة هنا. على الآيفون استخدم iOS 16.4 أو أحدث وافتح الموقع من الشاشة الرئيسية.');return;}
  try{
   // Ask synchronously inside the user gesture before any network requests.
   const permission=ask&&Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
   if(permission!=='granted'){await savePermission(permission);help(permission==='denied'?'رفضت الإشعارات. يمكنك السماح بها من إعدادات الجهاز. الصوت داخل الصفحة متاح بعد تفعيله.':'اسمح بالإشعارات حتى يصلك تنبيه الجاهزية خارج الصفحة.');return;}
   pushConfig=pushConfig||await call('push/config');if(!pushConfig.webPush)throw Error('خدمة إشعارات الخلفية غير مهيأة بعد. متابعة الطلب والصوت داخل الصفحة متاحان.');
   const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(pushConfig.publicKey)});
   await call('push/subscribe',{id:order.id,token:order.token,permission:'granted',subscription:sub.toJSON()});subscribedTo=order.id;help('تم تفعيل إشعارات الطلب. ظهورها وصوتها يخضعان لاتصال الجهاز وإعدادات الإشعارات والصامت والتركيز.');render();
  }catch(e){help(e.message||'تعذر تفعيل الإشعارات، حاول مرة أخرى.');}
 }
 window.addEventListener('royal-order-update',ev=>{order=ev.detail;render();if(subscribedTo!==order?.id&&'Notification'in window&&Notification.permission==='granted')void subscribe();});
 $('#acknowledge-call').onclick=async()=>{if(!order)return;const button=$('#acknowledge-call');button.disabled=true;try{const b=await call('order/acknowledge',{id:order.id,token:order.token});order.acknowledged_at=b.acknowledged_at;localStorage.setItem('mazaj-receipt',JSON.stringify(order));sessionStorage.setItem('mazaj-receipt',JSON.stringify(order));render();void window.royalOrderRefresh?.();}catch(e){help(e.message);}finally{button.disabled=false;}};
 $('#sound-enable').onclick=enableSound;$('#sound-test').onclick=enableSound;$('#sound-mute').onclick=()=>{soundOn=false;$('#sound-enable').textContent='تفعيل صوت الجاهزية';updateRinging();};$('#sound-tone').onchange=()=>{preferences.tone=$('#sound-tone').value;localStorage.setItem('royal-sound',JSON.stringify(preferences));if(soundOn)sound();};$('#enable-order-notifications').onclick=()=>void subscribe(true);
 function openInstall(){if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)$('#install-state').textContent='التطبيق مثبّت ومفتوح من الشاشة الرئيسية ✓';$('#install-dialog').showModal();}
 $('#install-open').onclick=openInstall;$('#hero-install').onclick=openInstall;
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install-native').hidden=false;});$('#install-native').onclick=async()=>{if(!installPrompt)return;await installPrompt.prompt();const choice=await installPrompt.userChoice;$('#install-state').textContent=choice.outcome==='accepted'?'تم طلب التثبيت. افتح الأيقونة من الشاشة الرئيسية.':'تقدر تثبّت التطبيق لاحقًا.';installPrompt=null;$('#install-native').hidden=true;};
 window.addEventListener('appinstalled',()=>{$('#install-state').textContent='تم تثبيت التطبيق ✓';$('#install-native').hidden=true;});document.addEventListener('visibilitychange',()=>{updateRinging();if(!document.hidden&&order)void window.royalOrderRefresh?.();});
 if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',e=>{if(['ROYAL_PUSH','MAZAJ_ORDER_NOTIFICATION'].includes(e.data?.type)&&order?.id===e.data.orderId)void window.royalOrderRefresh?.();});
 void call('push/config').then(c=>pushConfig=c).catch(()=>{});render();
})();
