import { getTranslations } from 'next-intl/server'

/**
 * The code field: a plain GET form to `/verificar`, which normalizes the code
 * and sends the reader to its page. No script — the page works from a phone
 * that scanned nothing and typed the code off paper.
 */
export async function VerifyForm({ action, defaultValue }: { action: string; defaultValue?: string }) {
  const t = await getTranslations('verify')
  return (
    <form action={action} method="get" className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink">{t('code_label')}</span>
        <input
          name="code"
          required
          defaultValue={defaultValue}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          placeholder={t('code_placeholder')}
          className="min-h-tap rounded-xl border border-line bg-white px-3.5 py-2.5 font-mono text-base tracking-wider text-ink uppercase outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
        />
      </label>
      <button
        type="submit"
        className="inline-flex min-h-tap w-full items-center justify-center rounded-xl bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
      >
        {t('submit')}
      </button>
    </form>
  )
}
