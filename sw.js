self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Handle scheduled notification messages from the app
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_HYDRATION') {
    // Store schedule info
    self.hydrationSchedule = e.data.schedule;
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window'}).then(clients => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});

// Handle push events (for future server-side push)
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || '💧 Time to hydrate!', {
      body: data.body || 'Don\'t forget to drink water',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'hydration',
      renotify: true,
      actions: [
        { action: 'log8', title: '8 oz' },
        { action: 'log16', title: '16 oz' }
      ]
    })
  );
});
