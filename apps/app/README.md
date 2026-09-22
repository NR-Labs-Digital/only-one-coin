# apps/app

Next.js App Router — portal do aluno e backoffice administrativo no mesmo
deploy (`CLAUDE.md` §8, "Pontos de entrada separados"): duas telas de login,
um único processo. Nunca fala direto com o Postgres — toda leitura/escrita
passa por `apps/api` via `fetch` (`src/lib/backoffice/api-client.ts`).

Regras e convenções deste app (layout responsivo, regras de celular, feature
flags, RBAC na UI) estão em [`CLAUDE.md`](CLAUDE.md), não aqui — este arquivo
é só "o que é e como roda". Estado real de cada tela (o que já fala com a API,
o que ainda é mock) está no `README.md` da raiz, seção "Estado de integração
por tela".

## Rodar local

```bash
pnpm dev:web   # sobe apps/landing + apps/app (na raiz do monorepo)
```

Várias telas do backoffice (alunos, equipe, funcionalidades, matrícula
manual) chamam `apps/api` de verdade — para elas funcionarem, suba também
`pnpm db:up` + `pnpm dev:api`. O resto do backoffice e todo o portal do aluno
ainda são mock e funcionam sem API no ar.

| Comando | O que faz |
| --- | --- |
| `pnpm --filter @ooc/app dev` | só este app, em `localhost:3000` |
| `pnpm --filter @ooc/app build` | build de produção (o que a Vercel roda) |
| `pnpm --filter @ooc/app typecheck` | `tsc --noEmit` |
| `pnpm --filter @ooc/app lint` | `next lint` |

## Estrutura

```
src/
  app/          # rotas do App Router — [locale]/portal/*, [locale]/backoffice/*, [locale]/login, [locale]/enrollment
  components/   # componentes de UI (shadcn/ui sobre Tailwind v4) e de layout (AutoGrid, TableShell...)
  lib/          # clientes de API, permissões (backoffice/permissions.ts), feature flags, dados mock
  hooks/        # hooks de cliente
  i18n/         # roteamento e mensagens trilíngues (es-PE padrão, pt-BR, en)
  messages/     # arquivos de tradução — es-PE.json / pt-BR.json / en.json
```

`src/lib/*/mock-data.ts` é onde vive o dado mockado de cada área — trocar por
chamada real não deve exigir tocar em nenhum componente que já lê de lá
(mesmo contrato de dados).
