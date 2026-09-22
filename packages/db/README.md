# @ooc/db

Schema e migrations do Postgres — mesma `DATABASE_URL` aponta pro Postgres
local (Docker, este pacote) em desenvolvimento e pro Neon em staging/produção,
sem trocar de ferramenta.

## Ferramenta — Drizzle Kit

Schema declarado em TypeScript (`src/schema.ts`) e migration SQL **gerada**
por diff contra esse schema (`drizzle-kit generate`), não escrita à mão.
Escolhido em vez de um migration runner separado (`node-pg-migrate` etc.)
porque o schema-first já resolve migration + (futuramente) tipagem de query
com uma ferramenta só — decisão registrada em `docs/ARCHITECTURE.md` §5.8.

`Drizzle ORM` como client de query em `apps/api` é uma decisão separada,
ainda em aberto — este pacote só cobre schema/migration.

## Estrutura

```
drizzle.config.ts   # dialect postgresql, schema -> migrations, lê DATABASE_URL
src/
  schema.ts          # tabelas Drizzle — modelo acadêmico, de pessoas, matrícula/pagamento e identidade (10 migrations além da baseline, ver README.md da raiz)
migrations/          # SQL gerado pelo drizzle-kit, versionado no Git
```

## Uso

Requer `compose.yml` da raiz do monorepo rodando (`pnpm db:up`) e um `.env`
neste pacote (copiar de `.env.example`).

| Comando (raiz) | O que faz |
| --- | --- |
| `pnpm db:up` | sobe o Postgres local (Docker) |
| `pnpm db:down` | derruba o container, mantém o volume |
| `pnpm db:generate` | gera migration nova a partir do diff de `src/schema.ts` |
| `pnpm db:migrate` | aplica as migrations pendentes |
| `pnpm db:reset` | derruba o container **e o volume**, sobe do zero, reaplica todas as migrations |

Migrations são sempre **aditivas** em staging/produção (`CLAUDE.md` §7) — o
`drizzle-kit generate` produzindo um `DROP`/`RENAME` é sinal de que a mudança
precisa virar duas migrations (expand/contract), não uma.
