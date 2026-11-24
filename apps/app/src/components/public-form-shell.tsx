import type { ReactNode } from 'react'
import Image from 'next/image'
import { LanguageSwitcher } from '@/components/enrollment/language-switcher'
import { CheckoutIcon } from '@/components/enrollment/icons'
import { WhatsAppMark } from '@/components/enrollment/whatsapp-mark'
import { body, display } from '@/lib/enrollment/fonts'
import { whatsappUrl } from '@/lib/org'
import { env } from '@/env'

/**
 * The frame of the public forms a stranger fills with no session behind it —
 * the enrollment checkout and the complaints book (OOC-63). Header, the
 * language switcher and nothing else; each form names itself (`label`) and
 * says in the footer what its data is used for (`footerNote`).
 *
 * The viewport IS the ruler here — there is no shell column stealing width, so
 * `sm:` means what it says (`CLAUDE.md` §5, "Layout das telas").
 *
 * Typography is the landing's, not the app's (see `lib/enrollment/fonts.ts`):
 * somebody arrives here mid-thought from the marketing site, and a font that
 * changes on that hop reads as a handoff to a different company.
 */
export function PublicFormShell({
  label,
  backToSite,
  footerNote,
  support,
  children,
}: {
  label: string
  backToSite: string
  footerNote: string
  support: string
  children: ReactNode
}) {
  // De volta ao site público. Não ter nenhuma saída é pior: quem quer sair
  // sai pelo botão do navegador, ou fecha a aba.
  const siteUrl = env.NEXT_PUBLIC_LANDING_URL ?? '/'

  return (
    <div
      /* Scales the whole checkout with the window, on the landing's ruler —
         the rule lives in `globals.css` because rem only reads `<html>`. */
      data-checkout-ruler=""
      className={`${body.className} flex min-h-dvh flex-col bg-sky-soft text-ink`}
      /* The landing's two washes — yellow high on the right, blue low on the
         left — at the same stops it uses. A form needs calm, so they stay this
         faint: enough that the page is not a white sheet, never enough to
         compete with a field. */
      style={{
        backgroundImage:
          'radial-gradient(50% 45% at 92% 2%, rgba(255, 201, 60, 0.16), transparent 60%), radial-gradient(45% 40% at 4% 98%, rgba(47, 107, 255, 0.12), transparent 60%)',
        backgroundAttachment: 'fixed',
      }}
    >
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* The real mark, not a stand-in. This is the first screen somebody
              sees after the landing, and the wordmark is already inside the
              image — printing "Only One Coin" beside it would say it twice.
              `priority` because it is the one image above the fold. */}
          {/* A marca leva à home, como em qualquer site — e o link ao lado diz
              em palavras o que o logo só insinua. */}
          <a
            href={siteUrl}
            aria-label={backToSite}
            className="flex min-w-0 items-center gap-3"
          >
            <Image
              src="/brand/logo.png"
              alt="Only One Coin"
              width={768}
              height={127}
              priority
              className="h-6 w-auto sm:h-7"
            />
            <span aria-hidden="true" className="hidden h-6 w-px bg-line sm:block" />
            <span
              className={`${display.className} hidden truncate text-[0.9375rem] font-medium text-brand-blue sm:block`}
            >
              {label}
            </span>
          </a>

          <span className="flex items-center gap-2">
            <a
              href={siteUrl}
              className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-sky hover:text-ink sm:inline-flex"
            >
              <CheckoutIcon name="arrow-left" size={16} />
              {backToSite}
            </a>
            <LanguageSwitcher />
          </span>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span className="inline-flex items-center gap-1.5">
            <CheckoutIcon name="lock" size={14} />
            {footerNote}
          </span>
          {/* The landing's primary button, down to the blue → yellow hover.
              Help was a sentence here, which is a dead end on a screen where
              somebody is stuck: the way out has to be something you can press.
              `noopener` because it opens WhatsApp in a new tab. */}
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-brand-blue px-6 py-3 text-sm font-bold text-white shadow-blue transition hover:-translate-y-0.5 hover:bg-brand-yellow hover:text-ink hover:shadow-yellow"
          >
            <WhatsAppMark size={20} />
            {support}
          </a>
        </div>
      </footer>
    </div>
  )
}
