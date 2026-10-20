/* Notificações do BancaFlow. Não armazena páginas, sessões ou avaliações em cache. */
'use strict';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const data=event.notification.data||{},room=typeof data.room==='string'?data.room:'geral';
 const base=new URL(self.registration.scope),target=new URL(base.href);
 target.hash='chat='+encodeURIComponent(room);
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const appPaths=[base.pathname,base.pathname+'index.html',base.pathname+'BancaFlow_TCC_2026_Unico.html'];
  const candidates=clients.filter(client=>{try{const url=new URL(client.url);return url.origin===base.origin&&appPaths.includes(url.pathname);}catch{return false;}});
  const client=candidates.find(item=>item.focused)||candidates.find(item=>item.visibilityState==='visible')||candidates[0];
  if(client){try{await client.focus();client.postMessage({type:'bancaflow-open-chat',room,accountId:typeof data.accountId==='string'?data.accountId:''});return;}catch{/* A aba pode ter sido fechada durante o toque. */}}
  await self.clients.openWindow(target.href);
 })());
});
