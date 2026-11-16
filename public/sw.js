const CACHE='coffee-royal-v3';
self.addEventListener('install',event=>event.waitUntil(Promise.all([caches.open(CACHE).then(cache=>cache.addAll(['/images/fallback.svg','/icon.svg','/offline.html'])),self.skipWaiting()])));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));return;}
 if(!url.pathname.startsWith('/images/'))return;
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;})));
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let data;try{data=event.data.json();}catch{return;}
 if(typeof data.title!=='string'||typeof data.body!=='string')return;
 await self.registration.showNotification(data.title,{body:data.body,icon:'/images/icon-192.png',badge:'/images/icon-192.png',tag:data.tag||'royal-order',renotify:true,requireInteraction:data.kind==='ready',vibrate:[200,100,200],data:{orderId:data.orderId,url:data.url,callAt:data.callAt}});
 const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of clients)client.postMessage({type:'ROYAL_PUSH',orderId:data.orderId});
 // Provider acceptance and browser display are not customer acknowledgement.
})()));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const target=event.notification.data?.url==='/manager.html'?'/manager.html':'/';const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=windows.find(w=>new URL(w.url).origin===self.location.origin&&((target==='/manager.html')===new URL(w.url).pathname.startsWith('/manager')));if(client){await client.focus();client.postMessage({type:'MAZAJ_ORDER_NOTIFICATION',orderId:event.notification.data?.orderId});}else await self.clients.openWindow(target);})());});
