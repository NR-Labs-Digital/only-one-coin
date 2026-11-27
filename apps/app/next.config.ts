import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `@ooc/domain/fields` — the person-record field rules, shared with apps/api
  // (OOC-64) — is exported as raw .ts so this build never depends on the
  // domain package's dist/. Only that subpath: the rest of the domain package
  // stays out of the browser.
  transpilePackages: ['@ooc/domain'],
  // PostHog through our own domain (OOC-47): the checkout sends to `/ooc-ev`
  // and Vercel forwards to PostHog's EU Cloud, so the CSP keeps
  // `connect-src 'self'` for it and a blocker's list of tracker hosts does
  // not hide the funnel. Order matters: assets first, then the catch-all.
  // The path is excluded from `middleware.ts`.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/ooc-ev/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
      { source: '/ooc-ev/array/:path*', destination: 'https://eu-assets.i.posthog.com/array/:path*' },
      { source: '/ooc-ev/:path*', destination: 'https://eu.i.posthog.com/:path*' },
    ]
  },
}

export default withNextIntl(nextConfig)
