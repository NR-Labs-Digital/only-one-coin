import { z } from 'zod'

/**
 * Client-safe env. Validated at boot/build — falta de var quebra o start,
 * nunca `localhost` fixo no código (CLAUDE.md §6).
 * NEXT_PUBLIC_* são inlined pelo Next; precisam ser referenciadas literalmente.
 *
 * apps/app nunca fala direto com Postgres/auth/storage (CLAUDE.md §5,
 * "client separado") — nenhuma var de provedor entra aqui, cliente ou
 * servidor; tudo isso mora só em apps/api.
 */
const schema = z.object({
  // Landing pública (Astro). Opcional; fallback para a raiz do próprio app.
  NEXT_PUBLIC_LANDING_URL: z.string().url().optional(),
  // Cloudflare Turnstile site key (public) — the checkout's review step
  // (OOC-24). Required: without it nobody can submit an enrollment.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
  // Measurement on the public checkout (OOC-47, docs/MEDICAO.md). All
  // optional: unset, that piece does not load — local and preview stay
  // silent. PostHog project key (EU Cloud) and the two pixel ids, plus the
  // parent domain the pixel-banner answer is shared on with the landing.
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_META_PIXEL_ID: z.string().optional(),
  NEXT_PUBLIC_TIKTOK_PIXEL_ID: z.string().optional(),
  NEXT_PUBLIC_CONSENT_COOKIE_DOMAIN: z.string().optional(),
})

export const env = schema.parse({
  NEXT_PUBLIC_LANDING_URL: process.env.NEXT_PUBLIC_LANDING_URL,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_META_PIXEL_ID: process.env.NEXT_PUBLIC_META_PIXEL_ID,
  NEXT_PUBLIC_TIKTOK_PIXEL_ID: process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID,
  NEXT_PUBLIC_CONSENT_COOKIE_DOMAIN: process.env.NEXT_PUBLIC_CONSENT_COOKIE_DOMAIN,
})
