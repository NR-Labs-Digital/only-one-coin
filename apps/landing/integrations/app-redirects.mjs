/**
 * Costura local entre a landing (Astro) e `apps/app` (Next.js).
 *
 * Em produção quem faz isso é o Vercel (`middleware.ts`): 302 de `/enrollment*`,
 * `/login*`, `/portal*` e `/libro-de-reclamaciones*` (OOC-63) para o domínio do app. `astro dev` não lê
 * `middleware.ts`, então sem isto os CTAs da landing ("Matricúlate ahora",
 * "Portal del Alumno") dão 404 no local — e a matrícula e o login do aluno só
 * se testam digitando a porta do Next à mão.
 *
 * 302 e não proxy, pelo mesmo motivo de lá: o local tem que responder o que o
 * visitante vai receber, incluindo a troca de origem. A query string vai junto
 * (`?course=&group=&src=whatsapp` — o link do vendedor).
 *
 * A origem vem de env (`PUBLIC_APP_ORIGIN`), nunca fixa no código
 * (`CLAUDE.md` §6).
 */

/**
 * Prefixos de rota do app, escritos no locale padrão (sem prefixo).
 *
 * `/login` é a porta do aluno — é para lá que o header da landing manda, não
 * para o dashboard: quem chega da landing ainda não tem sessão. `/portal` fica
 * aqui do mesmo jeito, porque link salvo e link compartilhado existem; quem
 * decide se aquilo abre ou volta para o login é o app, nunca a landing.
 */
const APP_PATHS = ["/enrollment", "/login", "/portal", "/libro-de-reclamaciones"];

/** Locales prefixados na landing e no app (`es-PE` é o padrão, sem prefixo). */
const LOCALE_PREFIXES = ["/en", "/pt"];

/** Caminho sem o prefixo de locale, para casar rota em qualquer idioma. */
function stripLocale(pathname) {
  for (const prefix of LOCALE_PREFIXES) {
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

function belongsToApp(pathname) {
  const path = stripLocale(pathname);
  return APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export default function appRedirects() {
  return {
    name: "ooc:app-redirects",
    hooks: {
      "astro:server:setup": ({ server, logger }) => {
        // O Vite já carregou o `.env` da landing (prefixo `PUBLIC_`); uma var
        // exportada no shell ganha dele.
        const origin = process.env.PUBLIC_APP_ORIGIN ?? server.config.env?.PUBLIC_APP_ORIGIN;

        if (!origin) {
          logger.warn(
            `PUBLIC_APP_ORIGIN não definida: ${APP_PATHS.join(", ")} vão dar 404 no local. Ver .env.example.`,
          );
          return;
        }

        const target = origin.replace(/\/+$/, "");
        logger.info(`${APP_PATHS.join(", ")} redirecionam para ${target}`);

        server.middlewares.use((req, res, next) => {
          // `base` só existe para parsear o caminho relativo da requisição.
          const url = new URL(req.url ?? "/", "http://landing.invalid");
          if (!belongsToApp(url.pathname)) return next();

          res.writeHead(302, { Location: `${target}${url.pathname}${url.search}` });
          res.end();
        });
      },
    },
  };
}
