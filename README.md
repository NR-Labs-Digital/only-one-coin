# Only One Coin — Plataforma Académica Digital

Plataforma académica da **Only One Coin** (`INGLES POR UN SOL S.A.C.`, RUC 20613918028): site público, matrícula com leitura de comprovante por IA, portal do aluno, backoffice e módulo de e-mail.

**O que está pronto e o que falta:** [`docs/ROADMAP.md`](docs/ROADMAP.md) (por sessão) e [`apps/app/README.md`](apps/app/README.md) (tela a tela). Este arquivo não repete esse estado.

## Monorepo

| Pasta | O quê | No ar em |
| --- | --- | --- |
| `apps/landing` | Site público (Astro), trilíngue | Vercel |
| `apps/app` | Portal do aluno + backoffice + checkout `/enrollment` (Next.js) | Vercel |
| `apps/api` | API de domínio + workers de fila (Fastify, Better Auth, BullMQ) | Fly.io (`only-one-coin-api.fly.dev`) |
| `packages/domain` | Domínio DDD puro | — |
| `packages/db` | Schema, migrations (Drizzle Kit) | Neon |
| `packages/queue` | Contrato de fila (jobs, producers) | — |
| `packages/notifications` | Templates de e-mail trilíngues, adapter Brevo, allowlist | — |
| `packages/ocr` | Adapter OpenRouter da leitura de comprovante | — |
| `packages/templates` | Engine de templates editáveis (LiquidJS travado) — [como usar](packages/templates/README.md) | — |

Stack e regras: [`CLAUDE.md`](CLAUDE.md), com um `CLAUDE.md` por app/pacote. Deploy automático a cada push em `main` (`.github/workflows/`).

## Rodar local

```bash
pnpm install
pnpm dev:web            # landing em :4321 + app em :3000
pnpm db:up              # Postgres, Redis e S3 local (LocalStack) via compose.yml
pnpm db:migrate
pnpm dev:api            # apps/api — necessário para as telas que já são reais
```

Copie os `.env.example` de `apps/api` e `apps/landing`. Sem o `.env` da landing, os CTAs (`/enrollment`, `/login`) dão 404 no local — em produção quem redireciona é o `vercel.json`.

### Seeds

```bash
pnpm seed:students                       # 300 alunos fictícios (--count=N)
pnpm seed:enrollments                    # matrículas sobre esses alunos
pnpm seed:students -- --confirm-host=<host-do-neon>   # qualquer host não local exige nomear o destino
pnpm seed:students -- --confirm-host=<host> --undo    # aposenta o que o seed criou (deleted_at, nunca DELETE)
```

Idempotentes. Build de produção recusa rodar.

## Documentos

- [`CLAUDE.md`](CLAUDE.md) — fonte da verdade: negócio, stack, i18n, erros proibidos, segurança e papéis.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — sessões do contrato e o estado de cada uma.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — monorepo, modelo de autorização, RBAC, custo, layout de `apps/app`, feature flags.
- [`docs/REGRAS-NEGOCIO.md`](docs/REGRAS-NEGOCIO.md) — regras extraídas da operação, a partir do export do bot de vendas.
- [`docs/REQUISITOS.md`](docs/REQUISITOS.md) — requisitos levantados com o cliente.
- [`docs/MATRICULA-CHECKOUT.md`](docs/MATRICULA-CHECKOUT.md) — o funil público de matrícula.
- [`docs/OCR-AVALIACAO.md`](docs/OCR-AVALIACAO.md) — como medir a OCR em comprovantes reais.
- [`docs/DOCUMENTOS-E-CERTIFICADOS.md`](docs/DOCUMENTOS-E-CERTIFICADOS.md) — constancia e certificado.
- [`docs/INFRAESTRUTURA.md`](docs/INFRAESTRUTURA.md) — pesquisa de mercado que baseou a hospedagem.
- [`docs/FRONTEND-CONSOLIDACAO.md`](docs/FRONTEND-CONSOLIDACAO.md) — avaliação em aberto: unificar `landing` + `app`.
- [`docs/OPEN-FINANCE-PERU.md`](docs/OPEN-FINANCE-PERU.md) — pesquisa: Open Finance no Peru.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — desenhos das features grandes (catálogo, Pagos, semáforo, auth do aluno, verificação do e-mail no checkout).
