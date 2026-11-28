'use client'

import { useEffect, useSyncExternalStore } from 'react'

/**
 * The portal as an installable app (OOC-51): registers the service worker
 * (`public/sw.js`) and keeps the browser's install offer for the profile's
 * "Install" button.
 *
 * Chrome fires `beforeinstallprompt` once, early — usually before the student
 * reaches the profile — so the event is caught here, on every portal page,
 * and kept in a small module store the button reads.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let installPrompt: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

function setInstallPrompt(event: InstallPromptEvent | null) {
  installPrompt = event
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The install offer Chrome/Edge/Samsung made, or null (iOS never makes one). */
export function useInstallPrompt(): InstallPromptEvent | null {
  return useSyncExternalStore(
    subscribe,
    () => installPrompt,
    () => null,
  )
}

/** Shows the browser's own install dialog; the offer can be used only once. */
export async function promptInstall(): Promise<boolean> {
  const event = installPrompt
  if (!event) return false
  await event.prompt()
  const { outcome } = await event.userChoice
  setInstallPrompt(null)
  return outcome === 'accepted'
}

export const SERVICE_WORKER_URL = '/sw.js'

export function PwaRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' }).catch(() => {
      // Not installable on this browser: the portal works the same without it.
    })

    const onPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const onInstalled = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  return null
}
