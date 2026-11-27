import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { routeForHost } from './lib/host-routing'
import { isMeasuredPath } from './lib/analytics/measured-path'

const intlMiddleware = createMiddleware(routing)

// Dedicated domains (apps/app/CLAUDE.md, "Três domínios, um deploy"):
// backoffice.* is served under /backoffice and teacher.* under /docente. It
// has to happen before next-intl resolves the locale, hence rewriting the
// pathname here rather than after intlMiddleware answers. The rule is pure
// and tested in lib/host-routing.ts.
const locales: readonly string[] = routing.locales

// The receipts bucket (Tigris in production, LocalStack locally) is a second
// origin the browser talks to directly, twice:
// - `connect-src`: the checkout POSTs the receipt straight to the bucket
//   with a presigned form (OOC-19) — the file never goes through apps/api.
//   Without the bucket here the browser refuses the request before sending
//   it: the API never sees it, the bucket never logs it, and the checkout
//   only says "the upload failed".
// - `img-src`: the backoffice review queue shows the receipt from a
//   short-lived signed URL on the same host.
// Read from RECEIPT_IMAGE_ORIGIN (the name predates the upload use). Unset,
// both break: no receipt can be uploaded or shown. Only a bare origin
// (scheme + host + port, nothing after it) is accepted; anything else is
// ignored rather than spliced into the policy.
function receiptBucketOrigin(): string {
  const value = process.env.RECEIPT_IMAGE_ORIGIN
  if (!value) return ''
  try {
    return new URL(value).origin === value ? ` ${value}` : ''
  } catch {
    return ''
  }
}

// Cloudflare Turnstile (OOC-24, the checkout's review step). Its script is
// inserted by our nonced bundle, which `strict-dynamic` already trusts — the
// host in script-src is only the fallback for browsers without it. The widget
// itself is an iframe from the same host: without `frame-src` the default-src
// 'self' blocks it and nobody can submit an enrollment.
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

// The paid-media pixels (OOC-47), only on the public checkout and only after
// the visitor accepts the banner (`lib/analytics/checkout-analytics.ts`).
// Their scripts are inserted by our nonced bundle, which 'strict-dynamic'
// already trusts — the script hosts are the fallback for browsers without
// it; `connect-src`/`img-src` are where the pixels report. Portal, backoffice
// and teacher screens never get these hosts: nothing there measures, and a
// host that is not needed is a host an injected script could use.
// PostHog needs none: it goes through `/ooc-ev` on our own domain.
const PIXEL_SCRIPT_ORIGINS = ' https://connect.facebook.net https://analytics.tiktok.com'
const PIXEL_CONNECT_ORIGINS =
  ' https://www.facebook.com https://connect.facebook.net https://analytics.tiktok.com https://analytics-ipv6.tiktokw.us'
const PIXEL_IMG_ORIGINS = ' https://www.facebook.com https://analytics.tiktok.com'

// CSP com nonce por request (CLAUDE.md §8). Exige rendering dinâmico em toda
// rota — natural aqui, porque apps/app inteiro fica atrás de login (portal +
// backoffice, sem página pública indexada). O nonce só nonça os scripts que o
// próprio Next injeta (framework, hydration, bundle da rota); se algum dia
// entrar um <Script> de terceiro como tag, o valor também precisa ser
// encaminhado via header de request (`x-nonce`) pro Server Component ler com
// `headers()` — não precisa disso ainda: os píxeis do checkout (OOC-47) são
// inseridos pelo nosso bundle, que o 'strict-dynamic' já confia.
//
// style-src NÃO leva nonce, de propósito: nonce nunca autoriza *atributo*
// `style`, e a presença dele faz o browser ignorar 'unsafe-inline' — o que
// matava todo valor dinâmico por elemento (as colunas do AutoGrid, a largura
// do ProgressBar) e colapsava as grades do app inteiro em coluna única.
// Valor dinâmico contínuo não tem classe possível, então estilo inline fica
// liberado; o vetor que a CSP existe pra fechar é script, e script-src segue
// nonce + strict-dynamic.
// `worker-src 'self'`: the document editor draws its PDF preview with pdf.js,
// whose worker is a file of our own bundle (OOC-123). Without it a worker falls
// back to script-src, where 'strict-dynamic' ignores 'self' and refuses it.
function buildCsp(nonce: string, measured: boolean): string {
  const isDev = process.env.NODE_ENV === 'development'
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE_ORIGIN}${measured ? PIXEL_SCRIPT_ORIGINS : ''}${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:${receiptBucketOrigin()}${measured ? PIXEL_IMG_ORIGINS : ''};
    font-src 'self';
    connect-src 'self'${receiptBucketOrigin()}${measured ? PIXEL_CONNECT_ORIGINS : ''};
    frame-src ${TURNSTILE_ORIGIN};
    worker-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export default function middleware(request: NextRequest) {
  const route = routeForHost(
    request.headers.get('host'),
    request.nextUrl.pathname,
    request.nextUrl.search,
    locales,
  )
  // 307, not 308: a browser caches a permanent redirect for good, and these
  // follow a domain table that can still change.
  if (route.kind === 'redirect') return NextResponse.redirect(route.url, 307)
  if (route.kind === 'rewrite') request.nextUrl.pathname = route.pathname

  const response = intlMiddleware(request)

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const measured = isMeasuredPath(request.nextUrl.pathname, locales)
  response.headers.set('Content-Security-Policy', buildCsp(nonce, measured))
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')

  return response
}

export const config = {
  // Tudo menos api, assets do Next, arquivos com extensão e o proxy do
  // PostHog (`/ooc-ev`, rewrite em next.config.ts — OOC-47).
  matcher: ['/((?!api|_next|_vercel|ooc-ev|.*\\..*).*)'],
}
