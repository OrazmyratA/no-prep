// Video test only: a video player can't send a Google sign-in, so this adds it to each request.
let token = '';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'token') token = event.data.token || '';
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const match = url.pathname.match(/\/drive-test\/stream\/([\w-]+)$/);
  if (!match) return;
  const headers = { Authorization: `Bearer ${token}` };
  const range = event.request.headers.get('range');
  if (range) headers.Range = range;
  event.respondWith(fetch(
    `https://www.googleapis.com/drive/v3/files/${match[1]}?alt=media`,
    { headers }
  ));
});
