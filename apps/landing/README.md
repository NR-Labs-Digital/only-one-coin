# apps/landing

Astro estático — o site público. Nenhum acesso a banco: lê preço/curso hoje
de dados estáticos em `src/data/`, trilíngue (`es-PE` padrão, `pt-BR`, `en`).

Regras deste app (o sistema de layout `--dp`, as duas larguras de desenho)
estão em [`CLAUDE.md`](CLAUDE.md), não aqui.

## Rodar local

```bash
pnpm dev:web   # sobe apps/landing + apps/app (na raiz do monorepo)
```

Os CTAs (`/enrollment`, `/login`) são links relativos que, em produção, a
Vercel redireciona pro domínio de `apps/app`. Para o dev server local fazer
o mesmo redirect (preservando `?course=&group=&src=whatsapp` do link do
vendedor), copie `apps/landing/.env.example` para `apps/landing/.env` — sem
isso os CTAs dão 404 localmente, mas o resto do site sobe normal.

| Comando | O que faz |
| --- | --- |
| `pnpm --filter @ooc/landing dev` | só este app, em `localhost:4321` |
| `pnpm --filter @ooc/landing build` | build de produção (o que a Vercel roda) |
| `pnpm --filter @ooc/landing preview` | serve o build de produção localmente |

## Estrutura

```
src/
  pages/        # rotas do Astro — uma pasta por locale onde o roteamento exige prefixo (/en, /pt)
  layouts/      # Base.astro (SEO, JSON-LD, hreflang) e afins
  components/   # seções da home e componentes de página (Header, WhyUs, LanguageFinder...)
  data/         # cursos, preços e conteúdo estático — sem banco
  seo/          # registro de rotas (routes.ts) usado por sitemap.xml e llms.txt
  i18n/         # es-PE.json / pt-BR.json / en.json e a identidade legal (org, {legalName}/{ruc})
  styles/       # global.css — o sistema de design tokens (--dp), ver CLAUDE.md deste app
```
