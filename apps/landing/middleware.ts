// Vercel Routing Middleware — costura entre a landing e `apps/app`.
//
// Mesma lógica de `integrations/app-redirects.mjs` (usada no `astro dev`
// local): 302 de `/enrollment*`, `/login*`, `/portal*` e
// `/libro-de-reclamaciones*` (OOC-63) para o domínio do
// app, preservando a query string (`?course=&group=&src=whatsapp`, o link
// do vendedor). Ver `CLAUDE.md` §6 — o domínio vem de env, nunca fixo no
// código, então staging aponta pra `staging.aula...` só por variável
// diferente no ambiente "Preview" do Vercel.
import { next } from "@vercel/functions";

const APP_PATHS = ["/enrollment", "/login", "/portal", "/libro-de-reclamaciones"];
const LOCALE_PREFIXES = ["/en", "/pt"];

function stripLocale(pathname: string): string {
  for (const prefix of LOCALE_PREFIXES) {
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

function belongsToApp(pathname: string): boolean {
  const path = stripLocale(pathname);
  return APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export const config = {
  matcher: [
    "/enrollment/:path*",
    "/login/:path*",
    "/portal/:path*",
    "/libro-de-reclamaciones/:path*",
    "/en/:path*",
    "/pt/:path*",
  ],
};

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  if (!belongsToApp(url.pathname)) return next();

  const origin = process.env.PUBLIC_APP_ORIGIN;
  if (!origin) return next();

  const target = `${origin.replace(/\/+$/, "")}${url.pathname}${url.search}`;
  return Response.redirect(target, 302);
}
