/* global clients, self */

const DEFAULT_TITLE = '提醒中心';
const DEFAULT_BODY = '有新的到时提醒，请打开应用确认。';
const DEFAULT_TAG = 'reminder-push';
const DEFAULT_URL = '/#/reminder';

function resolveTargetUrl(rawUrl) {
  const input = typeof rawUrl === 'string' && rawUrl.trim() ? rawUrl.trim() : DEFAULT_URL;
  try {
    return new URL(input, self.registration.scope).toString();
  } catch {
    return new URL(DEFAULT_URL, self.registration.scope).toString();
  }
}

function parsePushPayload(data) {
  if (!data) {
    return {};
  }

  try {
    return data.json();
  } catch {
    try {
      return { body: data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event.data);
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : DEFAULT_TITLE;
  const body = typeof payload.body === 'string' && payload.body.trim() ? payload.body.trim() : DEFAULT_BODY;
  const tag = typeof payload.tag === 'string' && payload.tag.trim() ? payload.tag.trim() : DEFAULT_TAG;
  const targetUrl = resolveTargetUrl(payload.url);

  const options = {
    body,
    tag,
    renotify: true,
    requireInteraction: true,
    icon: 'favicon.svg',
    badge: 'favicon.svg',
    data: {
      url: targetUrl,
      source: 'reminder-push',
      triggeredAtUnix: payload.triggeredAtUnix,
    },
  };

  if (Array.isArray(payload.vibrate) && payload.vibrate.length > 0) {
    options.vibrate = payload.vibrate;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = resolveTargetUrl(event.notification?.data?.url);
  event.waitUntil(
    (async () => {
      const windowClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if (!('focus' in client)) {
          continue;
        }

        try {
          const existingUrl = new URL(client.url);
          const expectedUrl = new URL(targetUrl);
          if (existingUrl.href === expectedUrl.href || existingUrl.pathname === expectedUrl.pathname) {
            await client.focus();
            return;
          }
        } catch {
          // Ignore invalid URL parsing and fallback to opening a new window.
        }
      }

      if (clients.openWindow) {
        await clients.openWindow(targetUrl);
      }
    })(),
  );
});
