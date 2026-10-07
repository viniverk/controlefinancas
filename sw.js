/* Service worker do app Nossas Finanças
   - deixa o site instalável no celular (PWA)
   - recebe e mostra as notificações (Firebase Cloud Messaging) */

const CACHE = 'nossas-financas-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

// ---- Notificações push (FCM) ----
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyAOpm4-OkBelk3oElT55Tm3jx1E34CYcF0',
    authDomain: 'financaspessoais-92164.firebaseapp.com',
    databaseURL: 'https://financaspessoais-92164-default-rtdb.firebaseio.com',
    projectId: 'financaspessoais-92164',
    storageBucket: 'financaspessoais-92164.firebasestorage.app',
    messagingSenderId: '261263856158',
    appId: '1:261263856158:web:47652fa99b7df0da4cd40f'
  });
  const messaging = firebase.messaging();
  // O servidor manda mensagens só com "data"; quem desenha a notificação é este código.
  messaging.onBackgroundMessage(payload => {
    const d = (payload && payload.data) || {};
    return self.registration.showNotification(d.title || 'Nossas finanças', {
      body: d.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'alertas-diarios',
      data: { url: d.url || './' }
    });
  });
} catch (e) {
  // sem rede para carregar o Firebase: o app continua instalável, só não recebe push agora
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});

// ---- Instalação / cache básico (rede primeiro, para nunca ficar com versão velha) ----
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
