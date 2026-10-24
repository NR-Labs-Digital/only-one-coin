import { getTranslations } from 'next-intl/server'

/**
 * The marker that says "what you are looking at is not on the air".
 *
 * Two doors lead here, one marker for both (`lib/feature-flags/resolve.ts`):
 *
 * - `preview` — the internal unlock (`/api/preview`). Rendered on every screen
 *   of the app by the root layout, with the way out: the cookie is the
 *   browser's, and it can be dropped.
 * - `owner` — an owners' e-mail domain signed in on a staff surface. Rendered
 *   by the panel's and the docente portal's shells whenever something there is
 *   off for everybody else. No way out to offer: it is the account, not the
 *   browser — signing in with another account is what "exit" would mean.
 *
 * It is not optional in either case: someone reading an internal screen as a
 * live one is exactly how a "the student says it isn't there" hunt starts.
 */
export async function InternalPreviewBadge({ mode = 'preview' }: { mode?: 'preview' | 'owner' }) {
  const t = await getTranslations('preview')

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-[13px] text-amber-950 shadow-lg">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full bg-amber-500"
        />
        <span className="font-semibold">{t('badge')}</span>
        <span className="hidden truncate text-amber-900/80 sm:inline">
          {mode === 'owner' ? t('owner_description') : t('description')}
        </span>
        {/* A plain anchor on purpose: `/api/preview` is a route handler, not a
            page. `next/link` would soft-navigate and the cookie would never be
            cleared — this has to be a real request. */}
        {mode === 'preview' && (
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a
            href="/api/preview?off=1"
            className="shrink-0 rounded-full px-2 py-0.5 font-semibold underline underline-offset-2 hover:bg-amber-100"
          >
            {t('exit')}
          </a>
        )}
      </div>
    </div>
  )
}
