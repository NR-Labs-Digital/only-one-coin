import type { ReactNode } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { logout } from '../actions'
import { getPortalView } from '@/lib/portal/session'
import { getFeatureFlags, requireFeature } from '@/lib/feature-flags/server'
import type { FeatureFlagKey } from '@/lib/feature-flags/registry'
import type { NotificationKind } from '@/lib/portal/types'
import { initials } from '@/lib/portal/format'
import type { NavGroup } from '@/components/portal/portal-nav'
import { PortalShell } from '@/components/portal/portal-shell'
import type { NoticeItem } from '@/components/portal/notifications-bell'

export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('portal')

  // The portal as a whole. Off, the student portal simply is not on the air —
  // shell included, so nothing under it can be reached by URL (CLAUDE.md §5).
  await requireFeature('portal')
  const flags = await getFeatureFlags('portal')

  const { student, notifications } = await getPortalView()
  const fullName = `${student.firstName} ${student.lastName}`
  const monogram = initials(student.firstName, student.lastName)

  /**
   * Two groups. The second one is announced, not built: tarefas, provas, sala
   * de aula and estudar are the classroom side of the portal, and today the
   * class itself lives outside the platform (CLAUDE.md §2 — no own
   * videoconference, no Classroom API). Padlocked rows say what is coming
   * without the portal pretending the screens exist.
   *
   * `tabBar` diz quem fica fixo na barra de abas do celular
   * (`portal-tabbar.tsx`) — item a item, nunca recortado por posição: a ordem
   * da sidebar responde outra pergunta, e um `slice` mudaria a barra sozinho
   * assim que alguém inserisse uma seção no meio da lista. São as três seções
   * que o aluno abre sem motivo; o resto vai para a folha de "mais", o grupo
   * travado inclusive — anunciar não é navegar.
   *
   * **Pagamentos não fica na barra**: mensalidade e comprovante são visita com
   * hora marcada, não navegação de todo dia — e uma coluna permanente para o
   * dinheiro faz o portal parecer uma cobrança. O aviso de módulo em atraso já
   * chega pelo sino e pelo cadeado no curso, que é o caminho por onde a pessoa
   * realmente entra ali.
   *
   * `shortLabel` só nas fixas cujo nome longo não cabe numa coluna de ~90px.
   */
  const navGroups: NavGroup[] = [
    {
      /* Each section answers to its own flag: a section that is not on the air
         is not offered either, because a padlock here would announce something
         the student cannot be told about yet — that is what the locked group
         below is for, and it is a different statement. */
      items: [
        {
          href: '/portal',
          label: t('nav.dashboard'),
          shortLabel: t('nav.tab_dashboard'),
          icon: 'home' as const,
          tabBar: true,
        },
        ...(flags['portal.courses']
          ? [
              {
                href: '/portal/courses',
                label: t('nav.courses'),
                shortLabel: t('nav.tab_courses'),
                icon: 'courses' as const,
                tabBar: true,
              },
            ]
          : []),
        ...(flags['portal.payments']
          ? [{ href: '/portal/payments', label: t('nav.payments'), icon: 'card' as const }]
          : []),
        ...(flags['portal.procedures']
          ? [
              {
                href: '/portal/enrollment',
                label: t('nav.enrollments'),
                icon: 'enrollment' as const,
              },
            ]
          : []),
        ...(flags['portal.documents']
          ? [
              {
                /* Absorveu os trâmites (o pedido e o documento que ele produz
                   viraram uma tela só), então herdou a coluna que era deles na
                   barra. */
                href: '/portal/documents',
                label: t('nav.documents'),
                icon: 'documents' as const,
                tabBar: true,
              },
            ]
          : []),
      ],
    },
    {
      title: t('nav.student_area'),
      items: [
        { href: '/portal/tasks', label: t('nav.tasks'), icon: 'clipboard', locked: true },
        { href: '/portal/exams', label: t('nav.exams'), icon: 'doc', locked: true },
        { href: '/portal/classroom', label: t('nav.classroom'), icon: 'video', locked: true },
        { href: '/portal/study', label: t('nav.study'), icon: 'pencil', locked: true },
      ],
    },
  ]

  /* A notice is a doorway: each kind opens one section (`notifications-bell`
     holds the map). A notice whose section is off would be a bell that leads
     to a 404, so it is not rung at all. */
  const noticeSection = {
    monthly_payment_due: 'portal.payments',
    next_level_invite: 'portal.continue',
    document_ready: 'portal.documents',
  } as const satisfies Record<NotificationKind, FeatureFlagKey>

  const noticeItems: NoticeItem[] = notifications
    .filter((n) => flags[noticeSection[n.kind]])
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      courseName: n.courseName,
    }))

  return (
    <PortalShell
      portalLabel={t('brand.portal_label')}
      navGroups={navGroups}
      studentName={fullName}
      monogram={monogram}
      notifications={noticeItems}
      logoutAction={logout}
    >
      {children}
    </PortalShell>
  )
}
