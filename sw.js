const CACHE_PREFIX="fantaasta2-";
const CACHE="fantaasta2-v2.0.0-alpha.6.0.2";
const ASSETS=[
  "./","./index.html","./styles.css?v=2.0.0-alpha.6.0.2","./app.js?v=2.0.0-alpha.6.0.2",
  "./regulation-engine.js?v=2.0.0-alpha.6.0.2","./strategy-engine.js?v=2.0.0-alpha.6.0.2","./opponent-intelligence-engine.js?v=2.0.0-alpha.6.0.2","./listone-importer.js?v=2.0.0-alpha.6.0.2","./mantra-rules.js?v=2.0.0-alpha.6.0.2",
  "./listone-template.csv","./DATI-E-COPYRIGHT.md","./README-A6.0.2-CLEAN-DATA.md",
  "./manifest.webmanifest","./icon-192.png","./icon-512.png","./apple-touch-icon.png","./favicon-32.png"
];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put("./index.html",copy));return response}).catch(()=>caches.match("./index.html")));return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response})));
});
