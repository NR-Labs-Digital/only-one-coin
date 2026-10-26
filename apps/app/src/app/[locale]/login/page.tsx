import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { AuthShell } from './auth-shell'
import { LoginForm } from './login-form'
import { ArrowRightIcon } from './icons'

/**
 * Login do aluno — a porta pública do portal, alcançada pelo botão do header da
 * landing (`CLAUDE.md` §8: pontos de entrada separados; o backoffice tem a sua,
 * discreta). Por isso ela veste o sistema visual da landing (ver `AuthShell`).
 *
 * Sem auto-cadastro: a conta nasce na aprovação do pagamento; o aluno recebe um
 * link para criar a senha. O bloco "ainda não tem conta" leva à matrícula, não
 * a um registro.
 */
export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('login')

  return (
    <AuthShell>
      <LoginForm />

      {/* Sem auto-cadastro (CLAUDE.md §8): daqui só se vai à matrícula. */}
      <div className="mt-4 rounded-3xl border border-line bg-white/70 px-6 py-4">
        <p className="font-display text-base font-semibold text-ink">{t('no_account_title')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('no_account_body')}</p>
        <Link
          href="/enrollment"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-brand-blue transition hover:gap-2.5 hover:text-brand-blue-deep"
        >
          {t('no_account_cta')}
          <ArrowRightIcon size={16} />
        </Link>
      </div>
    </AuthShell>
  )
}
