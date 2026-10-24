import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageFeatureFlags } from '@/lib/backoffice/permissions'
import { listFeatureFlagOverrides } from '@/lib/backoffice/feature-flags'
import { featureEnv, readFlagOverride } from '@/lib/feature-flags/env'
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  flagEnvVar,
  type FeatureFlagKey,
} from '@/lib/feature-flags/registry'
import { getFeatureView } from '@/lib/feature-flags/server'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { FeaturesView, type FlagRow } from './features-view'

/**
 * Funcionalidades — what of the platform is on the air, and the switch that
 * decides it (CLAUDE.md §5).
 *
 * The screen exists because the alternative was a deploy: until now a section
 * was hidden from students by editing `registry.ts` or an env var on Vercel,
 * which meant the two people who can read that file were the only two who
 * could answer "is the portal's payments screen live?".
 *
 * Owners only, and by e-mail rather than by cargo: what the platform admits to
 * existing belongs to whoever runs the platform. An `admin` of the Asociación
 * authorizes everything academic and none of this. The gate here draws the
 * screen or the locked state; the check that counts is `.owners()` on the
 * route in `apps/api` (CLAUDE.md §8).
 *
 * The section carries no flag of its own on purpose — see the note at the foot
 * of `registry.ts`.
 */
export default async function FeatureFlagsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  if (!canManageFeatureFlags(staff.email)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('features.title')} />
        <EmptyState
          icon="shield"
          title={t('features.locked_title')}
          body={t('features.locked_body')}
        />
      </div>
    )
  }

  const [overrides, view] = await Promise.all([
    listFeatureFlagOverrides(),
    getFeatureView('backoffice'),
  ])
  /* What everybody else gets, never what this reader does: whoever is on this
     screen is an owner, and an owner sees every staff flag on — reported as
     what is on the air, every switch here would read "live". */
  const effective = view.everybody

  const byKey = new Map(overrides.map((row) => [row.key, row]))

  const rows: FlagRow[] = FEATURE_FLAG_KEYS.map((key) => {
    const spec: { surface: string; production: boolean; parent?: string } = FEATURE_FLAGS[key]
    const envValue = readFlagOverride(key) ?? null
    const override = byKey.get(key) ?? null

    /* Which of the four sources actually decided this flag — the same ladder
       the resolver walks (`lib/feature-flags/server.ts`), reported rather than
       re-derived, so the screen can never disagree with the platform. */
    const source: FlagRow['source'] = envValue
      ? 'env'
      : override
        ? 'panel'
        : featureEnv.APP_ENV !== 'production'
          ? 'environment'
          : 'code'

    const own =
      envValue !== null
        ? envValue === 'on'
        : override
          ? override.enabled
          : featureEnv.APP_ENV !== 'production'
            ? true
            : spec.production

    return {
      key,
      surface: spec.surface as FlagRow['surface'],
      parent: (spec.parent as FeatureFlagKey | undefined) ?? null,
      envVar: flagEnvVar(key),
      codeDefault: spec.production,
      envValue,
      override: override
        ? {
            enabled: override.enabled,
            byName: override.updatedByName,
            at: override.updatedAt,
          }
        : null,
      own,
      effective: effective[key],
      source,
    }
  })

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('features.title')} />
      <FeaturesView
        rows={rows}
        appEnv={featureEnv.APP_ENV}
        unlock={view.unlock}
      />
    </div>
  )
}
