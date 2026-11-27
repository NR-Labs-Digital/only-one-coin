'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, SectionTitle } from '@/components/portal/ui'
import { HelpHint } from '@/components/backoffice/help-hint'
import { promptInstall, useInstallPrompt, SERVICE_WORKER_URL } from '@/components/portal/pwa'

/**
 * The portal on this device (OOC-51): install it as an app, and turn push
 * notifications on or off. Both are about the device in hand, never the
 * account as a whole — a push is turned on per browser, and the API keeps one
 * subscription per device (`/portal/push/subscription`).
 *
 * A push is never a message of its own: it is the e-mail the student already
 * gets, sent a second way (apps/api/CLAUDE.md, "Notificações"). The e-mail
 * keeps coming either way.
 *
 * iOS only offers push to a portal installed to the home screen and opened
 * from there (Safari 16.4+); in the browser tab `PushManager` does not exist,
 * so the card asks to install first instead of saying "not supported".
 */

type PushState = 'loading' | 'unavailable' | 'unsupported' | 'needs_install' | 'denied' | 'off' | 'on'

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** The VAPID public key comes base64url-encoded; `subscribe` wants the bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function saveSubscription(subscription: PushSubscription): Promise<boolean> {
  const json = subscription.toJSON()
  const response = await fetch('/api/v1/portal/push/subscription', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  })
  return response.ok
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' })
}

export function DeviceNotifications() {
  const t = useTranslations('portal')
  const help = useTranslations('bo')
  const installOffer = useInstallPrompt()

  const [push, setPush] = useState<PushState>('loading')
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    setInstalled(isStandalone())
    setIos(isIos())

    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/v1/portal/push', { cache: 'no-store' })
        const body = response.ok ? ((await response.json()) as { publicKey: string | null }) : { publicKey: null }
        if (cancelled) return
        if (!body.publicKey) return setPush('unavailable')
        setPublicKey(body.publicKey)

        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
          return setPush(isIos() && !isStandalone() ? 'needs_install' : 'unsupported')
        }
        if (Notification.permission === 'denied') return setPush('denied')

        const current = await (await registration()).pushManager.getSubscription()
        if (cancelled) return
        if (current) {
          // Already on here: tell the API again, in case it dropped the device
          // (another account took the browser, or the per-account cap).
          void saveSubscription(current).catch(() => undefined)
          setPush('on')
        } else {
          setPush('off')
        }
      } catch {
        if (!cancelled) setPush('unsupported')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const turnOn = useCallback(async () => {
    if (!publicKey) return
    setBusy(true)
    setFailed(false)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPush(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await registration()
      const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
      if (!(await saveSubscription(subscription))) {
        await subscription.unsubscribe()
        setFailed(true)
        return
      }
      setPush('on')
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [publicKey])

  const turnOff = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      const subscription = await (await registration()).pushManager.getSubscription()
      if (subscription) {
        const { endpoint } = subscription
        await subscription.unsubscribe()
        await fetch('/api/v1/portal/push/subscription', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        })
      }
      setPush('off')
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [])

  const install = useCallback(async () => {
    if (await promptInstall()) setInstalled(true)
  }, [])

  const buttonClass =
    'flex min-h-tap w-full items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 sm:w-auto'

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-1.5">
        <SectionTitle>{t('profile.device_title')}</SectionTitle>
        <HelpHint what={help('help.portal_device_what')} how={help('help.portal_device_how')} />
      </div>

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('profile.install_label')}</p>
      <div className="mt-2 text-sm text-ink">
        {installed ? (
          <p>{t('profile.install_done')}</p>
        ) : installOffer ? (
          <button type="button" onClick={() => void install()} className={`${buttonClass} border-brand-blue bg-brand-blue text-white`}>
            {t('profile.install_button')}
          </button>
        ) : (
          <p className="text-muted-foreground">{ios ? t('profile.install_ios') : t('profile.install_other')}</p>
        )}
      </div>

      {push !== 'unavailable' && (
        <>
          <p className="mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('profile.push_label')}</p>
          <div className="mt-2 flex flex-col gap-2 text-sm text-ink" aria-live="polite">
            {push === 'loading' && <p className="text-muted-foreground">{t('profile.push_loading')}</p>}
            {push === 'unsupported' && <p className="text-muted-foreground">{t('profile.push_unsupported')}</p>}
            {push === 'needs_install' && <p className="text-muted-foreground">{t('profile.push_needs_install')}</p>}
            {push === 'denied' && <p className="text-muted-foreground">{t('profile.push_denied')}</p>}
            {push === 'off' && (
              <>
                <p className="text-muted-foreground">{t('profile.push_off')}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void turnOn()}
                  className={`${buttonClass} border-brand-blue bg-brand-blue text-white`}
                >
                  {t('profile.push_turn_on')}
                </button>
              </>
            )}
            {push === 'on' && (
              <>
                <p>{t('profile.push_on')}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void turnOff()}
                  className={`${buttonClass} border-line text-muted-foreground hover:border-brand-blue hover:text-ink`}
                >
                  {t('profile.push_turn_off')}
                </button>
              </>
            )}
            {failed && (
              <p role="alert" className="text-sm text-red-700">
                {t('profile.push_error')}
              </p>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
