'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { Card, SectionTitle } from '@/components/portal/ui'
import { Icon } from '@/components/portal/icons'
import { Flag } from '@/components/portal/flag'
import { savePreferredLocale } from '@/lib/preferred-locale'

/**
 * O que o aluno escolhe sobre o próprio portal. Hoje é só o idioma; o cartão
 * já nasce como "Preferências" porque o próximo ajuste (aviso por e-mail,
 * fuso) entra aqui em vez de virar mais uma seção solta.
 *
 * O idioma morava no menu do avatar no desktop e na folha de "mais" no celular
 * — dois lugares para uma escolha que se faz uma vez, ocupando espaço
 * permanente nos dois. Mesmo movimento que o painel já tinha feito, onde ele
 * saiu do cabeçalho e foi para `/backoffice/account`: o que a pessoa define
 * sobre si mora com o resto do que ela define sobre si.
 *
 * As três opções ficam abertas, não atrás de um menu: nesta tela elas são o
 * assunto. Um quarto idioma (quechua, CLAUDE.md §4) vira mais uma linha sem
 * tocar em código — a lista vem da configuração de rotas.
 *
 * Trocar o idioma troca o locale da rota, então vale na hora e sobrevive a um
 * link compartilhado — e grava a escolha na conta (OOC-150), para o próximo
 * login, em qualquer aparelho, abrir nela. A gravação não segura a troca: se
 * falhar, só o próximo login volta ao idioma antigo.
 */
export function ProfilePreferences() {
  const t = useTranslations('portal')
  const languages = useTranslations('language')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Card className="p-5 sm:p-6">
      <SectionTitle>{t('profile.preferences_title')}</SectionTitle>

      <p
        id="profile-language-label"
        className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {t('profile.language_label')}
      </p>

      {/* `div`, não `ul`: um `radiogroup` precisa ter os rádios como filhos
          diretos, e o `listitem` do `<li>` entra no meio da relação. */}
      <div
        role="radiogroup"
        aria-labelledby="profile-language-label"
        className="mt-2 flex flex-col gap-1.5"
      >
        {routing.locales.map((code) => {
          const active = code === locale
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => {
                if (active) return
                void savePreferredLocale(code)
                startTransition(() => {
                  router.replace(pathname, { locale: code })
                })
              }}
              className={`flex min-h-tap w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition disabled:opacity-60 ${
                active
                  ? 'border-brand-blue bg-sky text-brand-blue-deep'
                  : 'border-line text-muted-foreground hover:border-brand-blue hover:text-ink'
              }`}
            >
              <Flag locale={code} />
              <span className="flex-1">{languages(code)}</span>
              {active && (
                <span className="text-brand-blue">
                  <Icon name="check" size={16} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </Card>
  )
}
