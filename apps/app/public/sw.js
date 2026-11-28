/*
 * The student portal's service worker (OOC-51). Two jobs only:
 *
 * - make the portal installable (Android, and iOS through "Add to Home
 *   Screen");
 * - show the push notifications apps/api sends (`deliverOutboxPush`) and open
 *   the portal when one is tapped.
 *
 * No fetch handler and no cache on purpose: every portal page is behind a
 * session and rendered per request, and a cached page is a page that can show
 * yesterday's payment status — or another account's, on a shared phone.
 *
 * No words live here: title and body arrive in the payload, already in the
 * recipient's language (CLAUDE.md §4).
 */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    return
  }
  if (typeof data.title !== 'string' || data.title === '') return

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/pwa/icon-192.png',
      // One notification per message: a repeat replaces, never stacks.
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      data: { url: typeof data.url === 'string' ? data.url : '/portal' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever our own origin: a payload naming another site is ignored.
  let target = new URL('/portal', self.location.origin)
  try {
    const asked = new URL(event.notification.data && event.notification.data.url, self.location.origin)
    if (asked.origin === self.location.origin) target = asked
  } catch {
    /* keep /portal */
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && 'focus' in client) {
          return client.navigate(target.href).then((c) => (c || client).focus())
        }
      }
      return self.clients.openWindow(target.href)
    }),
  )
})
