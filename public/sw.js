const CACHE='mazaj-v2';
self.addEventListener('install',event=>event.waitUntil(Promise.all([
  caches.open(CACHE).then(cache=>cache.addAll(['/images/fallback.svg','/icon.svg'])),
  self.skipWaiting()
])));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin||!url.pathname.startsWith('/images/'))return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
    return response;
  })));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(window=>new URL(window.url).origin===self.location.origin);
    if(client){await client.focus();client.postMessage({type:'MAZAJ_ORDER_NOTIFICATION',orderId:event.notification.data?.orderId});}
    else await self.clients.openWindow('/');
  })());
});
