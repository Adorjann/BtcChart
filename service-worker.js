// service-worker.js for WebRTC Chat with MQTT Signaling PWA

const CACHE_NAME = 'webrtc-mqtt-chat-v3';

// Resources to cache immediately when the service worker installs
const PRECACHE_RESOURCES = [
  './',
  './index.html',
  './offline.html',
  './icons/favicon.ico',
  './icons/icon-192-192.png',
  './icons/icon-512-512.png',
  './icons/maskable-icon.png'
];

// Resources to cache from CDNs that we want available offline
const CDN_RESOURCES = [
  'https://unpkg.com/mqtt@5.13.0/dist/mqtt.min.js'
];

// Install event - cache core app shell
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Precaching app shell');
        // Cache local resources
        return cache.addAll(PRECACHE_RESOURCES)
          .then(() => {
            // Cache CDN resources
            return cache.addAll(CDN_RESOURCES);
          });
      })
      .then(() => {
        console.log('[Service Worker] Precaching complete');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[Service Worker] Precaching failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating...');
  const currentCaches = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
    }).then(cachesToDelete => {
      return Promise.all(cachesToDelete.map(cacheToDelete => {
        console.log('[Service Worker] Deleting old cache:', cacheToDelete);
        return caches.delete(cacheToDelete);
      }));
    }).then(() => {
      console.log('[Service Worker] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', event => {
  // Skip MQTT WebSocket connections - we don't want to cache these
  if (event.request.url.includes('broker.emqx.io')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Return cached response if found
        if (cachedResponse) {
          console.log('[Service Worker] Serving from cache:', event.request.url);
          return cachedResponse;
        }

        // Otherwise try to fetch from network
        console.log('[Service Worker] Fetching from network:', event.request.url);
        return fetch(event.request)
          .then(response => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response so we can cache it and return it
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
                console.log('[Service Worker] Caching new resource:', event.request.url);
              });

            return response;
          })
          .catch(error => {
            console.error('[Service Worker] Fetch failed:', error);
            
            // If the request is for an HTML page, return the offline page
            if (event.request.mode === 'navigate') {
              return caches.match('/offline.html');
            }
            
            // Otherwise just propagate the error
            throw error;
          });
      })
  );
});

// Handle push notifications (if you implement them later)
self.addEventListener('push', event => {
  console.log('[Service Worker] Push received:', event);
  
  // Example notification when new message arrives while app is in background
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'New Message';
  const options = {
    body: data.body || 'New Bitcoin price update!',
    icon: 'icons/icon-192-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  console.log('[Service Worker] Notification click:', event);
  event.notification.close();

  const urlToOpen = event.notification.data.url;
  
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    })
    .then(windowClients => {
      // Check if there's already a window open
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Background sync for offline message queuing (if implemented)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

// Function to sync queued messages when connection is restored
function syncMessages() {
  return idb.open('webrtc-chat-store')
    .then(db => {
      const tx = db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      
      return store.getAll().then(messages => {
        return Promise.all(messages.map(message => {
          // Post messages that failed to send when offline
          // You'd need to implement this with a client-side postMessage
          // to communicate with the main thread
          return self.clients.matchAll().then(clients => {
            clients.forEach(client => {
              client.postMessage({
                type: 'sync-message',
                message: message
              });
            });
            
            // After sending, remove from outbox
            return store.delete(message.id);
          });
        }));
      });
    });
}
