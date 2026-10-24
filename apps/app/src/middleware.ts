import createMiddleware from 'next-intl/middleware'
import type { NextRequest } from 'next/server'
import { routing } from './i18n/routing'

const intlMiddleware = createMiddleware(routing)

// Domínio dedicado do backoffice (registrado 29/09/2026, CLAUDE.md §7).
// student.onlyonecoin.edu.pe não precisa de rewrite: a raiz do app já é o
// portal. backoffice.onlyonecoin.edu.pe precisa cair sob /backoffice, e isso
// tem que acontecer antes do next-intl resolver o locale — daí mexer no
// pathname aqui, não depois da resposta do intlMiddleware.
const BACKOFFICE_HOST = 'backoffice.onlyonecoin.edu.pe'
const locales: readonly string[] = routing.locales

function isAlreadyBackofficePath(pathname: string): boolean {
  const [, first, second] = pathname.split('/')
  return locales.includes(first) ? second === 'backoffice' : first === 'backoffice'
}

function withBackofficePrefix(pathname: string): string {
  const [, first, ...rest] = pathname.split('/')
  if (locales.includes(first)) {
    const restPath = rest.join('/')
    return restPath ? `/${first}/backoffice/${restPath}` : `/${first}/backoffice`
  }
  return pathname === '/' ? '/backoffice' : `/backoffice${pathname}`
}

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

// CSP com nonce por request (CLAUDE.md §8). Exige rendering dinâmico em toda
// rota — natural aqui, porque apps/app inteiro fica atrás de login (portal +
// backoffice, sem página pública indexada). O nonce só nonça os scripts que o
// próprio Next injeta (framework, hydration, bundle da rota); se algum dia
// entrar um <Script> de terceiro (analytics, etc.), o valor também precisa
// ser encaminhado via header de request (`x-nonce`) pro Server Component ler
// com `headers()` — não precisa disso ainda, nada aqui usa script inline.
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
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE_ORIGIN}${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:${receiptBucketOrigin()};
    font-src 'self';
    connect-src 'self'${receiptBucketOrigin()};
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
  if (request.headers.get('host') === BACKOFFICE_HOST && !isAlreadyBackofficePath(request.nextUrl.pathname)) {
    request.nextUrl.pathname = withBackofficePrefix(request.nextUrl.pathname)
  }

  const response = intlMiddleware(request)

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  response.headers.set('Content-Security-Policy', buildCsp(nonce))
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')

  return response
}

export const config = {
  // Tudo menos api, assets do Next e arquivos com extensão.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
