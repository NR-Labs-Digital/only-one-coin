# Arquitetura

Detalhe de apoio ao que está fechado no `CLAUDE.md`. Este documento não substitui o `CLAUDE.md` — quando os dois divergirem, `CLAUDE.md` vence.

A seção de autorização/RBAC tem origem no documento de arquitetura pré-implementação (apresentação ao cliente, ago/2026). O comparativo de hospedagem/custo que baseou a escolha de Postgres, hospedagem de `apps/api`, storage de comprovante e caixa de e-mail está na seção 5.

---

## 1. Estrutura do monorepo

pnpm workspaces com dois grupos, no mesmo padrão do diagrama do `CLAUDE.md` §3: `apps/*` é o que roda como processo/deploy próprio; `packages/*` é código compartilhado, sem processo próprio — ninguém faz `pnpm dev` dentro de um `package`.

| Pacote | Papel | Depende de | Status |
| --- | --- | --- | --- |
| `apps/landing` (`@ooc/landing`) | Site público, Astro estático | Nenhum pacote interno | Implementado |
| `apps/app` (`@ooc/app`) | Next.js App Router — portal do aluno + backoffice | Nenhum pacote interno hoje | Mockup, sem acesso a dado real |
| `apps/api` (`@ooc/api`) | Fastify — expõe `@ooc/domain` via HTTP, roda os workers de `@ooc/queue` | `@ooc/domain`, `@ooc/queue` | Scaffold rodando local, persistência em memória |
| `packages/domain` (`@ooc/domain`) | DDD puro — entidades, usecases, portas de repositório | Nenhum (núcleo — não depende de nada do monorepo) | Scaffold com contexto de exemplo + porta de identidade (auth) + vocabulário de erro HTTP |
| `packages/queue` (`@ooc/queue`) | Contrato de fila compartilhado (schemas zod, producers) | Nenhum pacote interno (só `bullmq`/`ioredis`/`zod`) | Scaffold com job de exemplo |
| `packages/db` (`@ooc/db`) | Schema + migrations (Drizzle Kit) — mesma `DATABASE_URL` local/Neon | Nenhum pacote interno (só `drizzle-orm`/`pg`) | Postgres local (Docker) + migration baseline vazia aplicando |
| `notifications`, `ocr`, `i18n`, `shared` | Reservados no diagrama do `CLAUDE.md` §3 | — | Ainda não criados |

**Regra de dependência:** `apps/*` depende de `packages/*`, nunca o contrário. Dentro de `packages/*`, `@ooc/domain` é o núcleo — todo o resto pode depender dele, ele não depende de nenhum outro pacote do monorepo (nem de `@ooc/queue`, nem de infra). Hoje só `apps/api` importa `@ooc/domain` e `@ooc/queue`; `apps/app` é candidato futuro a importar `@ooc/queue` como produtor de job (ver `CLAUDE.md` §5), mas ainda não faz isso.

**Único ponto de acesso ao banco:** só `apps/api` (e seus workers) têm credencial de Postgres — reforça a decisão de autorização na aplicação da seção 2 abaixo. `apps/app` nunca fala direto com o banco.

---

## 2. Caminho A vs. Caminho B — por que autorização na aplicação

Duas filosofias válidas de mercado para onde a regra "quem pode ver o quê" é aplicada:

| | Caminho A — regra no banco (RLS) | Caminho B — regra na aplicação |
| --- | --- | --- |
| Onde vive a regra | Policy declarativa por tabela, no Postgres | Middleware/usecase, no código do backend |
| Vantagem | Defesa mais próxima do dado | Modelo mental mais familiar; banco nunca fica exposto direto à internet |
| Risco principal | Policy mal escrita vaza dado **silenciosamente**, sem erro visível | Falha de autorização é bug de API comum — risco e ferramental conhecidos |
| Exige da equipe | Domínio real de RLS + suíte de teste específica pra isso | Disciplina normal de teste de autorização por rota |

**Decisão fechada: Caminho B.** Dois motivos, não um só:

1. Enquanto o backend era Supabase, o banco ficava exposto direto ao cliente via PostgREST — RLS era a única barreira possível. Sem Supabase, todo acesso passa por `apps/api` (Fastify); o banco nunca é tocado pelo browser. A barreira de RLS deixa de ser a única linha de defesa disponível — a aplicação já é essa linha.
2. RLS exige disciplina de teste que a equipe não tem consolidada hoje. A opção mais segura é sempre a que a equipe consegue operar corretamente, não a teoricamente mais forte.

Isso não proíbe usar RLS depois como camada **extra** de defesa em profundidade — só que ela nunca é o mecanismo de aceite documentado. O mecanismo de aceite é sempre o teste de autorização da aplicação (`CLAUDE.md` §8, item 5 do portão de CI).

---

## 3. RBAC — papéis, escopo e fase

| Papel | Onde acessa | Fase | Pode | Nunca pode |
| --- | --- | --- | --- | --- |
| `admin` | Backoffice | MVP | Gestão completa, cria/promove outros papéis, configura regras | — (toda ação é auditada, sem exceção) |
| `coordinator` | Backoffice | MVP | Gerencia turmas, períodos, matrículas, relatórios acadêmicos | Não cria nem promove usuários |
| `treasury` | Backoffice | MVP | Revisão financeira, conciliação de pagamentos, aprovação individual | Sem acesso a dado acadêmico não financeiro |
| `student` | Portal do aluno | MVP | Vê os próprios dados, status de matrícula, materiais, certificados | Nunca acessa dado de outro aluno, nem manipulando URL |
| `guardian` | Portal do aluno | MVP | Dá consentimento, acompanha dados do(s) menor(es) sob sua responsabilidade | Vinculado explicitamente ao(s) estudante(s); não é papel genérico |
| `mass_approver` | Backoffice | **Fase 2** | Aprovação em lote de casos já validados com alta confiança pela IA | No MVP, aprovação é sempre individual por `treasury`/`coordinator`. Aprovação em lote sempre gera auditoria individual por caso, nunca um log agregado |
| `teacher` (docente) | Backoffice (visão restrita) | **Fase 2** | Vê e edita **apenas as próprias turmas** (frequência, notas) | Não vê aluno/turma de outro docente — checagem no usecase, não escondida na tela |

`mass_approver` e `teacher` não bloqueiam o lançamento: aprovação em lote é otimização de operação em escala, e gestão de frequência/notas pode ficar fora do primeiro lançamento se o produto inicial for só matrícula + acesso liberado. `guardian` fica no MVP porque consentimento do responsável é exigência legal desde o dia um (público menor de idade), não conveniência.

Todo papel implementado sem exceção segue a regra dura de anti-escalada de privilégio do `CLAUDE.md` §8 ("Gestão de cargos") — não repetida aqui.

---

## 4. Segurança — checklist mínimo do MVP

A maior parte já está coberta pelos mecanismos do `CLAUDE.md` §6/§8 (tabela "Erros proibidos" + seção "Segurança"). Itens do documento de origem que valem destacar por não terem mecanismo 1:1 ainda escrito:

- Anti-enumeração de conta (login/recuperação de senha respondem igual pra conta existente e inexistente) — já coberto, `CLAUDE.md` §8.
- Reautenticação por senha (não MFA completo) para ação sensível (promoção de papel, aprovação financeira) — já é o mecanismo descrito em `CLAUDE.md` §8 pra promoção de staff.
- Storage de comprovante privado, signed URL curto, acesso registrado — já coberto.

### Pendente de confirmação — não decidido ainda

O documento de origem propõe rebaixar dois itens hoje fechados no `CLAUDE.md` para Fase 2, achando que a versão MVP mais barata já cobre o risco:

- **MFA completo** (`admin`, `treasury`) — hoje `CLAUDE.md` §8 lista como obrigatório e fechado. Proposta: reautenticação por senha cobre o MVP, MFA completo (app autenticador) entra depois, quando houver tempo de engenharia pra operar sem gerar fricção de suporte (recuperação de acesso perdido, etc.).
- **Captcha** (Cloudflare Turnstile) — hoje `CLAUDE.md` §3 lista como stack fechada. Proposta: começar só com rate limit por IP, evoluir pra captcha se houver abuso real observado em produção.

**Isso não está decidido.** `CLAUDE.md` continua valendo como está até essa confirmação acontecer — ver seção 9 do `CLAUDE.md` ("avise antes de executar" quando um pedido contradiz o que está fechado).

---

## 5. Infraestrutura — hospedagem e provedores (fechado 17/08/2026)

Base: levantamento comparativo de mercado (preços, specs, latência a partir de São Paulo — usada como proxy pra latência ao Peru, região LatAm mais próxima com presença de datacenter) feito em 17/08/2026. Critério dos dois lados da comparação: **custo-benefício** (mais barato que ainda atende o requisito) vs. **mais seguro/robusto** (mais maduro em HA/compliance/isolamento de rede, ainda que mais caro). Escolhemos custo-benefício nos três itens — volume do projeto (5.000/mês normal, até 20.000/mês em pico, só 3 meses/ano, `CLAUDE.md` §1) não justifica pagar pela opção enterprise ainda.

### 5.1 Postgres gerenciado — Neon

| Critério | **Neon (escolhido)** | Alternativa mais robusta — AWS RDS/Aurora |
| --- | --- | --- |
| Preço de entrada | Pay-as-you-go, sem mínimo (~US$0,106/CU-h) | ~US$12/mês (db.t4g.micro) sem HA; Multi-AZ sobe rápido |
| Região | `sa-east-1` (São Paulo) nativa | `sa-east-1` nativa |
| Diferencial | Branching copy-on-write — casa com o fluxo expand/contract de migration que já é regra (`CLAUDE.md` §7) | Multi-AZ com failover automático, IAM, compliance mais maduro |
| Por que não a alternativa agora | — | HA enterprise e maturidade de compliance da AWS são mais do que o volume atual exige; complexidade operacional maior do que o time opera hoje |

Descartados sem chegar a comparar de perto: Aiven, Railway, Render (nenhum tem região LatAm — Aiven em nenhuma nuvem, os outros só US/EU/Singapura); Crunchy Bridge e Timescale (especialistas em Postgres com extensões — PostGIS, pgvector, time-series — que este projeto não usa; entrada de US$30-70/mês sem esse ganho não se paga).

**Trade-off aceito:** sem HA Multi-AZ automática. Revisar se o volume real de pico pressionar disponibilidade — upgrade de provedor é migração de banco, não troca de config.

**Segundo trade-off aceito, confirmado 24/08/2026:** em produção, o orçamento de `<300ms` no submit (`CLAUDE.md` §5) exige compute **sempre ligado**, sem autosuspend — isso anula a vantagem de custo do modelo serverless do Neon (cobra por hora ligada, pensado pra escalar a zero em uso picado). Comparando specs equivalentes (~1-2vCPU/4GB) always-on:

| Provedor | Preço always-on/mês |
| --- | --- |
| **Neon** (escolhido) | ~US$77-80 (compute US$0,106/CU-h × 730h + storage) |
| DigitalOcean Managed DB (Growth, 2vCPU/4GB) | ~US$61 (já inclui 60GB storage + backup + PITR) |
| AWS RDS db.t4g.medium (2vCPU/4GB) | ~US$47-66 (sa-east-1 soma 20-40% sobre base us-east-1) + storage à parte |

Neon fica ~25% mais caro que a alternativa mais barata (DO) nesse regime de uso. Decisão confirmada: **manter Neon em produção e staging** mesmo com o prêmio — motivo é simplicidade (um provedor só, branching funciona igual nos dois ambientes, zero migração de banco no meio do projeto), não desconhecimento do trade-off. Revisar se o prêmio começar a doer de verdade em volume bem maior que o atual.

### 5.2 Hospedagem de `apps/api` — Fly.io

Requisito não-negociável (`CLAUDE.md` §3): processo **always-on**, porque roda os workers de fila (BullMQ) — descarta qualquer opção serverless-puro (Cloud Run, App Runner) independente de preço ou região.

| Critério | **Fly.io (escolhido)** | Alternativa mais robusta — Northflank (BYOC) |
| --- | --- | --- |
| Preço | ~US$2-6/mês, cobrança por segundo | ~US$5-10/mês por container (~40% mais barato que Railway, mas ainda maior custo de entrada que Fly.io) |
| Região | GRU (São Paulo) nativa | Só via BYOC — conta cloud própria (AWS/GCP/DO) na região |
| Modelo de execução | VM persistente — compatível com worker de fila | Container persistente, mas dentro da sua própria conta cloud |
| Por que não a alternativa agora | — | Exige montar e manter conta cloud própria pro BYOC — mais operação do que o time tem hoje só pra ganhar isolamento de rede que o requisito atual não pede |

Descartados: AWS App Runner (descontinuado pra novo cliente a partir de abr/2026); Heroku, Railway, Render, DigitalOcean App Platform (nenhum tem região LatAm — ~110-140ms de Lima/SP em vez de ~1-5ms); Google Cloud Run (serverless — viola o requisito de always-on, mesmo tendo região `southamerica-east1` e sendo o mais barato do levantamento).

### 5.3 Caixa de e-mail (staff) — Zoho Mail Lite

Distinto do Brevo (`CLAUDE.md` §3, envio transacional/campanhas): **Brevo não hospeda caixa de e-mail** — sem servidor IMAP próprio, não dá pra alguém **receber e ler** e-mail nele. Se `contato@` ou `matricula@onlyonecoin.edu.pe` precisar de alguém respondendo manualmente, é infra separada.

| Critério | **Zoho Mail Lite (escolhido)** | Alternativa mais robusta — Google Workspace |
| --- | --- | --- |
| Preço | US$1/usuário/mês | US$8,40/usuário/mês (Business Starter) |
| Armazenamento | 5-10 GB | 30 GB pooled |
| Por que não a alternativa agora | — | Custo ~8x maior se justifica pelo admin console/MFA/DLP mais maduro do Google — não é a prioridade agora pro volume de staff do projeto |

### 5.4 Storage (comprovante de pagamento + backup) — Tigris (Fly.io)

Requisito de origem (`CLAUDE.md` §5, "Upload"): signed URL direto ao storage, upload nunca passa pela função. Egress é o custo que mais importa aqui — o backoffice reabre o comprovante toda vez que revisa um caso na fila humana (`CLAUDE.md` §5), então esse custo cresceria junto com o volume de matrícula (5.000/mês normal, até 20.000/mês em pico) se algum provedor cobrasse por download.

| Critério | **Tigris — Fly.io (escolhido)** | Alternativa considerada — Cloudflare R2 |
| --- | --- | --- |
| Preço storage | US$0,02/GB-mês | US$0,015/GB-mês (mais barato por GB) |
| Egress | US$0 sempre | US$0 sempre |
| Free tier | 5GB + 10k Class A + 100k Class B/mês | 10GB + 1M Class A + 10M Class B/mês (maior) |
| Integração | Nativo do Fly.io (`fly storage create`) — mesma conta e fatura do compute que já hospeda `apps/api` (§5.2) | Cloudflare via API própria, conta separada da Fly |
| Por que essa e não a alternativa | Prioridade dada foi consolidar com o provedor que já roda `apps/api` — signed URL, upload, worker de processamento e backup ficam na mesma conta/fatura que o compute que os usa | R2 é marginalmente mais barato por GB e tem free tier maior, mas fica numa conta Cloudflare desacoplada do compute |

Empate técnico em egress (o fator que mais pesava no critério "barato com o tempo") — decisão girou em cima de integração operacional, não preço.

**Backup também migrou pra cá:** `pg_dump` → Tigris (era Cloudflare R2 — `CLAUDE.md` §3) substituído no mesmo commit que fechou esta decisão. Um bucket-provider só pros dois usos (comprovante + backup de banco), zero conta Cloudflare no projeto pra esse fim.

**O que fica retido, e por quanto tempo** (`CLAUDE.md` §1): só a **versão processada/reduzida** do comprovante (pós downscale ~1000px/grayscale da OCR, `CLAUDE.md` §5) é persistida — não o upload bruto do celular. Retenção de **5 anos**; depois disso, política de exclusão a implementar (Ley 29733, `CLAUDE.md` §8). Essa escolha (reduzida, não bruta) é o que mantém o volume de storage pequeno mesmo em 5 anos de acúmulo.

**Acúmulo em 5 anos** (imagem reduzida ~200KB, volume `CLAUDE.md` §1 — 5.000/mês normal × 9 meses + 20.000/mês pico × 3 meses ≈ 105.000 matrículas/ano ≈ 20,3GB novos/ano):

| Ano | Acumulado (retenção rolante de 5 anos) | Custo Tigris no mês (storage) |
| --- | --- | --- |
| 1 | ~20GB | ~US$0,40/mês |
| 3 | ~61GB | ~US$1,22/mês |
| 5+ (regime permanente) | ~101GB (teto — dado mais velho que 5 anos sai) | ~US$2,00/mês |

Descartados sem chegar a comparar de perto: AWS S3/`sa-east-1` e Google Cloud Storage/`southamerica-east1` (cobram egress ~US$0,11-0,12/GB — o backoffice reabrindo comprovante em volume tornaria isso caro com o tempo); Backblaze B2 e Wasabi (sem região LatAm, egress grátis só por acordo de parceria condicional); DigitalOcean Spaces (sem região LatAm — mais perto é Toronto).

### 5.5 Auth — Better Auth (fechado)

Postgres, hospedagem de `apps/api`, storage, caixa de e-mail e agora auth (login de `student`/`guardian`/staff) estão todos fechados.

| Critério | **Better Auth (escolhido)** | Alternativa mais robusta — Clerk/Auth0 |
| --- | --- | --- |
| Modelo | Biblioteca embutida no processo do backend — roda dentro de `apps/api` (Fastify), como qualquer outra dependência de infra | Serviço hospedado externo — auth vive fora do monorepo, numa conta de terceiro |
| Banco | Aceita conexão Postgres existente (adapter, não ORM próprio obrigatório) — mesma instância Neon de tudo o resto | Banco de usuários próprio do provedor, fora do controle do time |
| Leitura de sessão | `auth.api.getSession()` bate no banco a cada chamada — nunca JWT cego confiado no cliente (casa direto com `CLAUDE.md` §8, "apps/api lê o role do registro autenticado no banco a cada requisição sensível") | Depende do provedor — geralmente JWT de vida curta, exige lógica própria de revalidação |
| Campo `role` protegido | `additionalFields.role` com `input:false` — API pública de signup/update não aceita esse campo, só escrita server-side | Também suportado, mas acoplado ao painel/API do provedor |
| Por que não a alternativa agora | — | Clerk já tinha sido avaliado e descartado antes (`CLAUDE.md` §3); custo e acoplamento a um provedor hospedado não se justificam pro volume do projeto (`CLAUDE.md` §1), e Better Auth já resolve as regras duras de `CLAUDE.md` §8 sem sair do monorepo |

Detalhe completo do padrão de integração (fronteira com `packages/domain`, como `apps/app` fala com o auth sem tocar banco, migration, bootstrap do primeiro admin): §5.6 abaixo.

### 5.6 Padrão de integração — Better Auth

**Fronteira com `packages/domain` (DDD puro).** Better Auth nunca é importado por `packages/domain` — o pacote só define a porta:

| Peça | Onde mora | Por quê |
| --- | --- | --- |
| Contrato de "usuário autenticado atual", `role`, portas de sessão/promoção (`ICurrentSessionPort`, `IUserRoleRepository`, `IAuditLogRepository`, `IFreshAuthVerifier`, `PromoteUserRoleUseCase`) | `packages/domain/src/identity/` | Só interfaces/tipos/orquestração — zero import de `better-auth`, zero I/O |
| Instância do `betterAuth()`, handler `/api/auth/*`, leitura de `auth.api.getSession`, escrita na coluna `role` | `apps/api/src/infra/auth/` e `apps/api/src/infra/persistence/identity/` | Implementação concreta — ainda não criada, depende de Postgres local existir (Sessão 3 do `ROADMAP.md`) |
| Nada | `apps/app` | Nunca instancia `betterAuth()` nem toca banco |

`ICurrentSessionPort.resolve(sessionToken: string)` recebe uma **string opaca** (o valor do cookie), não `Headers`/`FastifyRequest` — quem extrai o cookie da requisição é a camada HTTP em `apps/api`. Isso é o que preserva a pureza do domínio: ele não sabe o que é HTTP.

**`role` como coluna nativa, não `user_roles` separada.** Decisão fechada: `role` fica em `additionalFields.role` na própria tabela `user` do Better Auth (`input:false`), não numa tabela `user_roles` à parte. Motivo: `input:false` já impede escrita client-side, e `auth.api.getSession()` já bate no banco a cada leitura — isso satisfaz literalmente as regras duras de `CLAUDE.md` §8 sem precisar de uma segunda tabela desincronizada da tabela `user`. A promoção de papel (`PromoteUserRoleUseCase`) escreve direto na coluna `role`, nunca pela rota pública de update de usuário do Better Auth (bloqueada por `input:false`).

**Reautenticação fresca na promoção é responsabilidade nossa.** O plugin `admin` do Better Auth exige que quem chama `setRole` já esteja autenticado como admin, mas **não** garante reautenticação fresca sozinho. `PromoteUserRoleUseCase` (`packages/domain/src/identity/`) impõe isso via `IFreshAuthVerifier` antes de mudar o `role` e gravar o `audit_log` — o adapter concreto em `apps/api` envolve a escrita do `role` + o append do `audit_log` na mesma transação de banco (o usecase não sabe de transação, só a ordem de chamadas).

**`apps/app` nunca fala direto com o banco — padrão "client separado".** Better Auth roda só dentro de `apps/api`. `apps/app` propaga a sessão via **proxy same-origin**: `apps/app/src/app/api/auth/[...all]/route.ts` recebe a requisição do browser em `aula.onlyonecoin.edu.pe/api/auth/*`, encaminha pra `apps/api` (`API_INTERNAL_URL`, env server-side do Next, nunca exposta ao browser), propaga `Set-Cookie` de volta. Mantém o cookie de sessão same-origin do ponto de vista do browser — mais simples e mais seguro que apontar o browser direto pro domínio do Fly.io. Redirect por `role` continua sempre server-side (`CLAUDE.md` §8): `apps/app` resolve o `role` chamando `apps/api`, nunca o banco.

**Migration entra na esteira normal.** O CLI do Better Auth (`generate`) produz SQL revisável, não roda sozinho em runtime — esse SQL é copiado como migration versionada dentro de `packages/db` (a nascer na Sessão 3 do `ROADMAP.md`), na mesma numeração/ferramenta das demais migrations do projeto. Não há duas esteiras de migration.

**Bootstrap do primeiro admin, em dois passos** (`CLAUDE.md` §8): (1) criar a conta pelo fluxo normal do Better Auth, garantindo hash de senha compatível com login futuro — `role` nasce no `defaultValue` de menor privilégio, `input:false` ignora qualquer `role` no payload; (2) uma migration versionada (`UPDATE "user" SET role = 'admin' WHERE email = $1`) promove esse usuário específico — única exceção documentada a "só o usecase promove".

**Adapter implementado.** `better-auth` roda dentro de `apps/api` (`infra/auth/betterAuth.ts`, Postgres via `pg.Pool`/`DATABASE_URL`), a rota catch-all `/api/auth/*` (`http/auth/AuthCatchAllRoute.ts`) converte Fastify ↔ Web Request/Response, `ICurrentSessionPort` está implementada (`infra/identity/BetterAuthCurrentSessionPort.ts`, reconstrói o header `Cookie` a partir do valor opaco recebido) e o proxy same-origin existe em `apps/app/src/app/api/auth/[...all]/route.ts` (repassa via `API_INTERNAL_URL`, env server-only em `src/server-env.ts`). Sign-up/sign-in/get-session testados ponta a ponta local (browser→`apps/app`→`apps/api`→Postgres), incluindo confirmar que `role` no payload de signup é ignorado (`input:false` segurando na prática). Migration do Better Auth (`user`/`session`/`account`/`verification`) versionada em `packages/db/migrations/0001_better_auth_core.sql`, com `default`/`CHECK` em `user.role` espelhando `packages/domain/src/identity/Role.ts` além do que o CLI gerou.

**Ainda não implementado, propositalmente:** os adapters concretos de `IUserRoleRepository`/`IAuditLogRepository`/`IFreshAuthVerifier` e o wiring de `PromoteUserRoleUseCase` — o bloqueio real é só `audit_log` (Sessão 7 do `ROADMAP.md`): a promoção de papel escreve `role` + `audit_log` na mesma transação (§ acima), e sem a tabela de audit log essa transação não existe ainda. As telas de login (`apps/app/src/app/[locale]/login`, `.../backoffice`) continuam mockadas — wiring real, MFA e redirect por `role` pertencem à Sessão 31 (`ROADMAP.md`, "Shell e autenticação"), que também depende da autorização deny-by-default da Sessão 8.

**Docs interativas.** `better-auth` roda com o plugin `openAPI()` (`infra/auth/betterAuth.ts`), e `infra/plugins/authSwagger.ts` reprefixa (`/api/auth/...`) e funde o schema gerado por ele no mesmo documento do `@fastify/swagger` — os ~30 endpoints do auth aparecem lado a lado com o resto da API em `/docs`, um só lugar, sem precisar visitar a página `/api/auth/reference` própria do better-auth. É um monkey-patch deliberado em `app.swagger()` (as rotas do auth não são rotas Fastify com schema Zod, então `@fastify/swagger` nunca as vê sozinho) — só registrado fora de produção, junto do resto do Swagger. `trustedOrigins` inclui a própria origem local de `apps/api` fora de produção (além de `APP_PUBLIC_URL`) só pra "try it out" funcionar direto em `/docs`, sem passar pelo proxy de `apps/app`.

**Erros do auth passam pelo mesmo envelope.** `AuthCatchAllRoute.ts` nunca repassa o `{message, code}` nativo do better-auth pro cliente — ele já é o `code` que vira `reason` (`INVALID_EMAIL_OR_PASSWORD` → `auth.invalid_email_or_password`), sem tabela de mapeamento manual, e o `message` original fica só no log do servidor. Resposta sem `code` reconhecível (ou `status >= 500`) cai no mesmo default 500/`errorId` do resto da API — detalhe completo em §5.7 abaixo.

### 5.7 Contrato de erro da API

Vocabulário reutilizável em `packages/domain/src/shared/base/errors/`: `HttpError` (base, `status` default 500) e as subclasses genéricas `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `UnableToProcessEntryError` (422 — regra de negócio recusa uma requisição bem formada). Exceção documentada à regra "domínio nunca sabe de HTTP" — `CLAUDE.md` §5.

**Better Auth também obedece o envelope, mesmo sem passar pelo `setErrorHandler` do Fastify.** A rota catch-all devolve a `Response` do `auth.handler()` diretamente — não lança uma exceção que o `errorHandlerPlugin` (`infra/plugins/errorHandler.ts`) possa interceptar. `AuthCatchAllRoute.ts` faz essa tradução manualmente: `status >= 400` sempre vira `{status, reason, path?, errorId?}`, nunca o JSON nativo `{message, code}` do provedor — mesma regra do resto da API, aplicada num ponto diferente do pipeline (`CLAUDE.md` §5, "biblioteca embutida no processo nunca responde HTTP com o shape dela própria").

Envelope de resposta pública (`apps/api/src/shared/http/ErrorResponseSchema.ts`, aplicado via `setErrorHandler` global em `apps/api/src/infra/plugins/errorHandler.ts`): `{ status, reason, path?, errorId? }`. Sem `message` livre no contrato — `reason` é a chave estável que `apps/app` resolve pra texto localizado via `packages/i18n` (`CLAUDE.md` §4, "zero string de UI... inclui mensagem de erro de API"); `message` (herdado de `Error`) fica só em log/Sentry. Erro inesperado (não tipado) responde 500 com `errorId` = `request.id` (Fastify, UUID gerado por requisição via `genReqId`, compartilhado por todo log daquela requisição via `container.logger`) — nunca stack trace ao usuário (`CLAUDE.md` §6).

### 5.8 Postgres local + migrations — Docker e Drizzle Kit (fechado)

**Postgres local — `postgres:18-alpine` via `compose.yml` na raiz.** Staging e produção seguem no Neon (§5.1); local é só pra desenvolvimento, sem dado real (`CLAUDE.md` §7). Volume nomeado montado em `/var/lib/postgresql` (não `/var/lib/postgresql/data`) — a partir do Postgres 18 a imagem oficial passou a versionar o `PGDATA` (`/var/lib/postgresql/18/docker`), e montar no caminho antigo cria um volume anônimo não-persistente pro caminho real. `pnpm db:reset` derruba container **e volume**, sobe de novo do zero e reaplica todas as migrations — é o critério de pronto da Sessão 3 do `ROADMAP.md`.

**Migrations — Drizzle Kit, não um migration runner separado.**

| Critério | **Drizzle Kit (escolhido)** | Alternativa considerada — `node-pg-migrate` |
| --- | --- | --- |
| Modelo | Schema-first: `packages/db/src/schema.ts` em TypeScript, migration SQL **gerada** por diff (`drizzle-kit generate`) | Migration-first: cada mudança é um arquivo JS/SQL escrito à mão, sem schema central |
| Ferramenta | Uma só — schema e migration vivem juntos, tipagem de query (`drizzle-orm`) fica disponível de graça se `apps/api` decidir usá-la depois | Duas esteiras se algo mais tarde precisar de schema tipado: o runner de migration e, separado, o que gera tipos de query |
| Portabilidade Neon | Dialeto `postgresql` puro, mesma `DATABASE_URL` local/Neon, sem CLI específica de provedor | Igual — também é Postgres puro |
| Por que não a alternativa agora | — | Decisão revertida em 19/08/2026: manter duas ferramentas (uma pra migration, outra se `apps/api` algum dia quiser um query builder tipado) não se paga frente a uma ferramenta só cobrindo os dois papéis |

Migration "vazia inicial" (Sessão 3) gerada com `drizzle-kit generate --custom` — o modo padrão (`generate`, diff de schema) não produz arquivo quando não há tabela nenhuma ainda; `--custom` existe justamente pra SQL que não vem de diff de schema (baseline vazia, extensão, seed pontual). `Drizzle ORM` como client de query em `apps/api` (substituindo `pg` cru nos repositórios) é decisão separada, ainda em aberto — este fechamento cobre só schema/migration em `packages/db`.

**Migration de produção é automática no deploy, sempre atrás de backup (sessão 31/08/2026).** `.github/workflows/deploy-api.yml` roda um job `backup-and-migrate` entre o CI e o `flyctl deploy`: `pg_dump` do Neon de produção → `gzip` → upload pro bucket Tigris `only-one-coin-backups` (S3-compatible, `https://t3.storage.dev`) e só then a migration (`pnpm --filter @ooc/db db:migrate`). Se o backup falhar, a migration não roda; se a migration falhar, o deploy não roda — mecaniza o `CLAUDE.md` §7 ("migration em produção sempre depois de backup") sem depender de alguém lembrar de rodar o comando manualmente. Não substitui o backup periódico do `CLAUDE.md` §3 ("pg_dump → Tigris via Scheduled Function") — aquele ainda não existe e cobre a janela entre deploys; este é só o snapshot imediatamente antes de qualquer mudança de schema chegar em produção.

Precisa de três GitHub secrets além do `FLY_API_TOKEN` já existente: `DATABASE_URL` (a mesma URL do Neon de produção, também setada como secret do Fly), `TIGRIS_ACCESS_KEY_ID` e `TIGRIS_SECRET_ACCESS_KEY` (saem de `fly storage create -a only-one-coin-api -n only-one-coin-backups`, impressas uma vez só — nunca recuperáveis depois). O nome do bucket está fixo no workflow (`only-one-coin-backups`) porque não é segredo.

**Retenção — 30 dias, via lifecycle rule do próprio Tigris, não script de limpeza.** Backup roda a cada deploy (potencialmente vários por semana); sem expirar, o bucket cresce sem limite e o custo (US$0,02/GB acima dos primeiros 5GB grátis) só sobe. Tigris suporta expiração nativa por idade do objeto — configurada uma vez com `aws s3api put-bucket-lifecycle-configuration`, sem precisar de nenhum passo a mais no CI nem risco de um script de limpeza malfeito apagar backup recente por engano. Regra em `apps/api/infra/tigris-backup-lifecycle.json`, aplicada uma única vez na criação do bucket:

```
aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url https://t3.storage.dev \
  --bucket only-one-coin-backups \
  --lifecycle-configuration file://apps/api/infra/tigris-backup-lifecycle.json
```

30 dias cobre bastante margem pra "múltiplos deploys por semana" sem chegar perto do teto de 5GB grátis, dado o volume atual do banco. Ajustar o `Days` no JSON se o volume ou a frequência de deploy mudar muito.

### 5.9 Hospedagem de `apps/landing` e `apps/app` — Vercel (deploy real feito 31/08/2026)

Dois projetos Vercel separados na mesma conta/organização (`tech-1048`), um por app — cada um com **Root Directory** apontado pro seu subdiretório (`apps/landing`, `apps/app`) pra tanto o CLI quanto o Git integration acharem o app certo dentro do monorepo:

| Projeto | Root Directory | Domínio hoje |
| --- | --- | --- |
| `only-one-coin-landing` | `apps/landing` | `only-one-coin-landing.vercel.app` |
| `only-one-coin-app` | `apps/app` | `only-one-coin-app.vercel.app` |

Domínio próprio (`onlyonecoin.edu.pe` / `aula.onlyonecoin.edu.pe`) ainda não configurado — depende de DNS, fora do escopo desta sessão.

**Env vars já setadas** (`vercel env add`, sem segredo nenhum — as duas são URL pública, nunca credencial):

- `only-one-coin-app`: `API_INTERNAL_URL=https://only-one-coin-api.fly.dev` (server-only, `src/server-env.ts`), `NEXT_PUBLIC_LANDING_URL=https://only-one-coin-landing.vercel.app`.
- `only-one-coin-landing`: `PUBLIC_APP_ORIGIN=https://only-one-coin-app.vercel.app` — lido pelo `middleware.ts` pra fazer o 302 de `/enrollment`, `/login` e `/portal` pro app (não pelo `vercel.json`, que só declara os security headers).

**Deploy automático por push do lado do Vercel (Git integration) ainda não está ligado.** `vercel git connect` falha com `Failed to link Herick201/only-one-coin. You need to add a Login Connection to your GitHub account first.` — é autenticação em nível de conta Vercel (OAuth com o GitHub), só dá pra resolver pelo dashboard (Account Settings → Login Connections), não por CLI/token.

**Cobre isso por fora: `.github/workflows/deploy-vercel.yml` (sessão 01/09/2026).** Mesmo padrão do `deploy-api.yml` — espera o CI passar, depois roda `vercel deploy --prod --project <nome> --token $VERCEL_TOKEN` pra `only-one-coin-app` e `only-one-coin-landing` (matrix, um passo por projeto), sempre a partir da raiz do repo (upload do CLI só funciona assim porque o Root Directory já está setado nos dois projetos — rodar de dentro do subdiretório do app quebra com "Root Directory ... does not exist"). Existe porque um merge real bateu nisso: PR mergeada, CI verde, e a produção continuou rodando o código antigo até alguém notar e rodar o deploy manual. Precisa do secret `VERCEL_TOKEN` (gerado no dashboard Vercel → Account Settings → Tokens) no repo do GitHub — `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` não são segredo, ficam direto no workflow. Quando o Login Connection acima for resolvido, este workflow vira redundante (o Git integration nativo do Vercel assume) — mas não estorva ficar, veja `--yes` sempre promovendo a mesma build a produção.

---

## 6. Custo mensal estimado

Preços detalhados e fontes: `docs/INFRAESTRUTURA.md`. Três colunas — **free tier** (MVP/staging), **escala normal** (produção, 5.000 matrículas/mês, 9 meses/ano) e **escala pico** (produção, até 20.000 matrículas/mês, 3 meses/ano — `CLAUDE.md` §1). Estimativa, não orçamento fechado — premissas marcadas onde assumi algo ainda não confirmado.

| Item | Free tier | Escala normal (5k/mês) | Escala pico (até 20k/mês) | Premissa |
| --- | --- | --- | --- | --- |
| **Neon** (Postgres) | US$0 | **~US$79/mês** | **~US$79/mês** | Compute 1 CU always-on (730h × US$0,106) — cobrado por hora ligada, não por matrícula, então **não varia com o volume** (`§5.1` — trade-off do modelo serverless aceito por simplicidade) |
| **Fly.io** (`apps/api`) | Não existe (só trial) | **~US$6/mês** | **~US$10/mês** | Normal: 2 machines mínimas (API+worker). Pico: réplica extra pra throughput de fila (OCR via Gemini tem latência, fila pode acumular) |
| **Tigris** (storage) | US$0 | **~US$0,40-2/mês** (cresce com os anos até o teto de 5 anos de retenção, ver §5.4) | igual — custo é sobre o **acumulado total**, não sobre o volume do mês corrente | Só a versão reduzida (~200KB) é retida, não o upload bruto (`§5.4`) |
| **Brevo** (transacional) | US$0 — até 9.000 e-mails/mês | **US$0** — ~6.000 e-mails/mês (5.000 × ~1,2/matrícula), dentro do free | **~US$29/mês** — ~24.000 e-mails/mês (20.000 × ~1,2) **estoura o free (9k) e o tier de 20k (US$18)**, precisa do tier de 40k | Só transacional por enquanto, sem campanha (confirmado) — ~1,2 e-mail/matrícula (credencial + boas-vindas) é estimativa, ajustar quando o fluxo real de notificação for desenhado |
| **Redis (Upstash)** | US$0 — 500k comandos/mês | **US$0** | **Provavelmente US$0**, mas mais perto do limite (~300-400k comandos/mês estimado) — monitorar; se estourar, pay-as-you-go é US$0,20/100k | Fila (BullMQ) + rate limit compartilham a mesma instância |
| **Zoho Mail** (mailbox) | US$0 — até 5 caixas | US$0-3/mês | igual | Não depende do volume de aluno. Quantidade de caixas não confirmada (usei 3 de exemplo) |
| **Sentry / PostHog / Vercel / Turnstile** | US$0 | **US$0 (provável)** | **US$0 (provável)** | Não escalam linearmente com matrícula nesse volume — free tier de cada um (5k erros, 1M eventos, 100GB banda) tem folga |
| **Total produção** | — | **~US$86-88/mês** | **~US$120-125/mês** | Neon domina os dois cenários (~65-90% do total); Brevo é o item que mais varia entre normal e pico |

**Leitura**: Neon é o único item praticamente **fixo** (não varia com matrícula — é o preço do compute sempre ligado). Brevo é o item mais **sensível ao volume** — passa de grátis pra ~US$29/mês só em pico, porque envio transacional escala 1:1 com matrícula. Tigris cresce devagar e nunca fica caro porque reteve a versão pequena da imagem, não a original.

---

## 7. Shell e layout das telas (`apps/app`) — fechado 20/08/2026

Regra curta e as primitivas estão em `CLAUDE.md` §5 ("Layout das telas"). Aqui
fica o porquê, que é o que evita a próxima tela nascer torta pelo mesmo motivo.

### O que quebrava

O painel e o portal têm shell: uma sidebar fixa ao lado de uma coluna de
conteúdo. Toda decisão de layout, porém, estava escrita em breakpoint de
**viewport** (`sm:`, `lg:`, `xl:`), e a tela nunca recebe o viewport:

| Janela | Sidebar do painel | Coluna real |
| --- | --- | --- |
| 1280px | aberta (13,5rem) | ~1000px |
| 1280px | recolhida (3rem) | ~1170px |
| 1920px | aberta | ~1704px (antes: travada em 1152px pelo `max-w-6xl`) |

Três consequências, todas visíveis:

1. **`xl:grid-cols-4` disparava a 1280px de janela** e espremia quatro cards em
   ~1000px de coluna, truncando os rótulos. Recolher a sidebar liberava 170px e
   nada mudava — o breakpoint não enxerga a sidebar.
2. **`max-w-6xl` (72rem) travava a coluna em 1152px.** Num monitor largo sobrava
   gutter dos dois lados enquanto a tabela dentro da coluna cortava a última
   coluna e rolava na horizontal.
3. **`SidebarInset` não tinha `min-w-0`.** Como item de flex, seu tamanho mínimo
   automático é o `min-content` do conteúdo: uma célula que não encolhia deixava
   o inset mais largo que o espaço disponível e empurrava o **documento inteiro**
   pra rolagem horizontal — header sticky e seletor de idioma junto. Medido em
   `/backoffice/home` a 1280px: `documentElement.scrollWidth` = 1360.

### O que passou a valer

- **`min-w-0` no `SidebarInset`** (`components/ui/sidebar.tsx`). O overflow volta
  pra dentro do wrapper que o possui. É o item que sozinho mata a rolagem
  horizontal de página em toda tela do painel, presente e futura.
- **Coluna do painel fluida** — `max-w-[100rem]` (1600px) no lugar de
  `max-w-6xl`. O painel é ferramenta de trabalho, não coluna de leitura: cresce
  com o monitor. O teto existe só porque linha muito longa deixa de ser
  escaneável. O portal segue em `max-w-5xl` — ali a leitura é o produto.
- **`AutoGrid`** (`components/layout/auto-grid.tsx`) —
  `repeat(auto-fit, minmax(min(<min>, 100%), 1fr))`. Substitui a família
  `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` em toda grade de cards e de
  campos. Sem breakpoint: o número de colunas é recalculado a cada resize e a
  cada toggle da sidebar. O `min(…, 100%)` impede overflow quando o container é
  mais estreito que o mínimo pedido.
- **`Toolbar` + `toolbarSearchClass`** (`components/backoffice/ui.tsx`) — a linha
  de busca/filtros usa `flex-wrap` em vez de `flex-col lg:flex-row`.
- **`@container/page`** declarado no `<main>` dos dois shells, pros casos que
  `auto-fit` não expressa (split assimétrico 2fr/1fr — ex.: detalhe de curso no
  portal, `@4xl/page:grid-cols-3`).
- **Scrollbar fina e sempre desenhada** nos wrappers de tabela
  (`[scrollbar-width:thin]`). Overlay scrollbar só aparece depois que você rola,
  então tabela cortada lia como bug em vez de "tem mais coisa à direita".

### Onde breakpoint de viewport continua certo

Quando a tela **é** a janela, sem shell em volta: o split da tela de login
(`/backoffice`, `lg:grid-cols-[1.05fr_0.95fr]`). Fora disso, breakpoint de
viewport dentro de `portal/` ou `backoffice/(panel)/` é sinal de tela que vai
quebrar em monitor diferente.

### Verificação

Varredura das 18 rotas de `apps/app` (13 do painel, 5 do portal) em 1920, 1600,
1440, 1280, 1024, 820 e 500px — 126 combinações, **zero** com
`documentElement.scrollWidth > viewport`.

---

## 7.1 Celular (`apps/app`) — fechado 06/09/2026

A §7 acertou a régua (container em vez de janela) e matou a rolagem horizontal
de página. O que ela não resolveu é o outro lado: **o app é operado no celular
de ponta a ponta** — o aluno vive no portal pelo telefone, e a coordenação
aprova pagamento e abre matrícula de onde estiver. Uma tela que só não estoura
ainda não é uma tela de celular.

### O que quebrava

1. **A tabela do painel.** Cinco a oito colunas com `min-width: 46rem` num
   telefone de 375px é rolagem lateral dentro de rolagem vertical — é assim que
   se perde uma linha no meio de uma fila de revisão.
2. **O menu do portal ficava no topo, numa tira que rolava de lado.** O que não
   coubesse era invisível (ninguém arrasta uma tira que não parece arrastável),
   e o topo de um celular grande é o canto mais longe do polegar.
3. **Campo de 14px.** O Safari do iPhone dá zoom ao focar qualquer campo com
   menos de 16px, e o zoom não volta sozinho: a pessoa termina o formulário com
   a página cortada de lado.
4. **Modal centralizado.** Num telefone ele desperdiça margem dos dois lados,
   põe as ações no meio da tela e — o que de fato quebra — pula quando o teclado
   abre, porque um elemento centrado se recentra contra o viewport encolhido.
5. **Sem safe area.** Nada previa notch nem barra de gestos.
6. **Alvos de toque de 30–36px.** Abaixo dos 44px que Apple e Google publicam.

### O que passou a valer

- **`viewport` no layout raiz** (`app/[locale]/layout.tsx`) com
  `viewportFit: 'cover'`, e os tokens `--spacing-safe-*` derivados de
  `env(safe-area-inset-*)` (`globals.css`). Todo elemento fixo numa borda soma a
  faixa do sistema: `pb-safe-b`, `pt-safe-t`. `maximumScale`/`userScalable`
  ficam de fora de propósito — boa parte do público é apoderado lendo termo de
  consentimento no celular.
- **Tabela vira lista** abaixo de **48rem de coluna** (container query em
  `page`, não breakpoint de janela — a sidebar rouba largura). Cada `<tr>` vira
  um item com o nome da coluna como etiqueta; a primeira célula vira o título do
  item, sem etiqueta e na linha inteira. A regra é CSS
  (`globals.css`, "Tabela densa vira lista"); o que o CSS não sabe é o nome da
  coluna, porque o `<thead>` está escondido nessa largura — então quem monta a
  tabela passa os mesmos títulos que já imprime no cabeçalho
  (`TableShell columns={[...]}` no painel, `stackLabels()` fora dele) e eles
  viajam na `<table>` como `--stack-col-N`. **Coluna condicional entra na lista
  sob a mesma condição**, ou o rótulo cai na célula errada.
- **Barra de abas no portal** (`components/portal/portal-tabbar.tsx`): as seções
  que o aluno abre sem motivo ficam fixas embaixo, e a última aba abre uma folha
  com o resto **mais** o canto da pessoa — perfil e saída, que no desktop moram
  no avatar do topo. Quem fica fixo é declarado item a item
  (`tabBar: true` em `navItems`), não recortado por posição: a ordem da sidebar
  responde outra pergunta, e um `slice` faria a barra mudar sozinha assim que
  alguém inserisse uma seção no meio da lista. Hoje: início, cursos, trâmites.
  **Pagamentos ficou de fora da barra** (decisão do dono, 06/09/2026) —
  mensalidade e comprovante são visita com hora marcada, não navegação de todo
  dia, e uma coluna permanente para o dinheiro faz o portal parecer uma
  cobrança; quem precisa chegar lá chega pelo sino e pelo cadeado no curso.
- **O idioma saiu do chrome do portal** (06/09/2026) — estava no menu do avatar
  no desktop e na folha de "mais" no celular, dois lugares permanentes para uma
  escolha que se faz uma vez. Foi para `/portal/profile`, num cartão
  "Preferências" que já nasce nomeado no plural porque o próximo ajuste (aviso
  por e-mail, fuso) entra ali em vez de virar seção solta. É o mesmo movimento
  que o painel tinha feito antes, quando o globo deixou o cabeçalho e foi para
  `/backoffice/account`. As telas de login mantêm o seletor: antes de entrar não
  há perfil para abrir.
- **Campo com 16px abaixo de 768px** (`globals.css`). É o único lugar em que a
  régua do toque ganha da régua do desenho.
- **Modal vira folha de baixo** no telefone (`components/ui/dialog.tsx`), e a
  folha lateral passa a ocupar a largura toda (`components/ui/sheet.tsx`) — 75%
  de 375px são 281px, que não é painel de detalhe.
- **Ação principal com largura inteira** no checkout público, com o botão de
  voltar embaixo dela (`StepNav`, `components/enrollment/ui.tsx`). O
  `flex-col-reverse` inverte só o desenho: na ordem do documento "voltar"
  continua vindo antes.
- **`--spacing-tap` (44px)** como utilitário (`min-h-tap`), em vez de número
  mágico espalhado.
- **Hover não gruda**: sob `@media (hover: none)` a transição é zerada, porque
  no toque o `:hover` fica preso até o próximo toque em outro lugar.

### Onde a janela continua sendo a régua

No checkout público (`/enrollment`) e nas telas de login — não há shell roubando
largura, então `sm:` quer dizer o que diz. Dentro de `portal/` e
`backoffice/(panel)/` vale a §7: container query.

### Verificação (06/09/2026)

- **Portal e checkout a 375px**, rota por rota (`/portal` e suas seis seções,
  `/enrollment`, as duas telas de login): **zero** com
  `documentElement.scrollWidth > viewport`.
- **Painel**: a lista empilhada foi conferida com sessão real de `admin`,
  estreitando a coluna para 390px — que é o que um telefone produz, já que a
  regra é container query e não media query. Conferidas alunos, turmas, equipe,
  docentes, fila de revisão e certificados da turma: `thead` some, `<tr>` vira
  bloco, a primeira célula vira o título sem etiqueta e as demais casam rótulo
  com valor.
- **Os dois lados de cada coluna condicional** foram exercidos, que é onde o
  mecanismo erraria em silêncio: docentes com e sem o quadro ativo (coluna
  "Contrato"), e turma que certifica com exame (`cg_01`, 5 colunas) contra uma
  que não certifica (`cg_03`, 4 colunas) — rótulo e célula alinhados nos dois.
- **Não exercido**: a tabela de `/backoffice/reports` não renderiza com o seed
  atual (a quebra por dimensão sai vazia), então o `columns` dela passou só por
  `tsc`. Mesma coisa para `teacher-home`, que pede sessão de docente.

---

## 8. Feature flags — o que está no ar em produção (fechado 06/09/2026, interruptor no painel 08/09/2026, leitura pública 09/09/2026, recuperação da tela 17/09/2026)

As três superfícies de `apps/app` — **portal do aluno**, **backoffice** e o
**painel do docente** — são geridas por feature flag. A semântica é uma só:

> **Ligada:** a seção aparece em produção, para quem tem o papel.
> **Desligada:** a seção não existe em produção — some da navegação e a URL
> responde **404** — e continua inteira para nós: local, deploy de preview da
> Vercel e, em produção, para quem abriu o destravamento interno.

Flag **não é controle de acesso.** O que uma pessoa *pode fazer* continua sendo
o papel declarado na rota em `apps/api` (`CLAUDE.md` §8). A flag decide se a
funcionalidade está no ar; o papel decide para quem ela responde.

### 8.1 Onde vive o interruptor

**Duas peças, e a distinção importa:** o *catálogo* de flags vive em código, ao
lado das seções que governa; o *interruptor* vive no banco, movido pela tela
**Funcionalidades** do backoffice. Uma flag nova continua nascendo num commit —
inventar uma pelo painel seria inventar uma seção que não existe.

| Peça | Onde |
| --- | --- |
| Declaração de toda flag (o catálogo) | `apps/app/src/lib/feature-flags/registry.ts` |
| Ambiente + overrides de env (zod no boot) | `apps/app/src/lib/feature-flags/env.ts` |
| Interruptor persistido | tabela `feature_flag_overrides` (`packages/db`) |
| Regra de escrita (donos + `audit_log`) | `packages/domain/src/platform/SetFeatureFlagOverrideUseCase.ts` |
| Rotas | `apps/api/src/http/platform/` — `GET /feature-flags/state` (pública), `GET /feature-flags` e `PUT /feature-flags/:key` (donos) |
| Leitura do interruptor (server-only) | `apps/app/src/lib/feature-flags/overrides.ts` |
| Resolução (server-only) | `apps/app/src/lib/feature-flags/server.ts` |
| Destravamento interno | `apps/app/src/lib/feature-flags/preview.ts` + `src/app/api/preview/route.ts` |
| A tela | `apps/app/src/app/[locale]/backoffice/(panel)/features/` |

**Por que mudou (08/09/2026).** A versão anterior desta seção registrava que
banco + tela tinham sido adiados: `apps/app` não fala com o banco
(`CLAUDE.md` §8), então a primeira flag exigiria migration, usecase e rota antes
de existir. O custo era real e foi pago — as três camadas estão acima. O que o
adiamento cobrava em troca era pior: as duas pessoas que sabem abrir
`registry.ts` eram as duas únicas capazes de responder "a tela de pagamentos do
portal está no ar?", e desligar uma seção em produção era um deploy ou uma
variável na Vercel.

**Quem abre: só os donos da plataforma.** Não é cargo — são os domínios do
e-mail (`isOwnerEmail`, `packages/domain/src/identity/Role.ts`,
`MASTER_EMAIL_DOMAINS = ["nrlabsdigital.com", "admin.com"]` — o segundo entrou
17/09/2026, junto do fix de §8.8, porque a conta que a equipe realmente usa
como login de produção carrega esse domínio, não o outro). O que a plataforma
admite existir é decisão de quem opera a plataforma, não de quem administra a
escola: um `admin` da Asociación autoriza tudo o que é acadêmico e nada disto.
Na API isso é uma declaração de rota própria, `.owners()`, ao lado de
`.roles(...)` e `.public()` — deny-by-default continua valendo, e o usecase
repete a checagem antes de escrever, para que um segundo chamador não herde a
escrita sem a regra.

**A leitura é pública, revertido 09/09/2026.** `GET /feature-flags/state`
nasceu `.internal()` — segredo `INTERNAL_API_TOKEN`, obrigatório em produção
por um `throw` no boot de `apps/api` (`config.ts`). Ninguém garantiu que esse
segredo novo existisse no Fly.io antes do deploy da #91: a API não subiu em
produção, e como o formulário de login do backoffice não tinha
`try/finally` em volta do `fetch` de sign-in (bug preexistente, não desta
decisão) nem o proxy same-origin tinha timeout, a queda da API virou "login
carregando pra sempre" em vez de um erro claro — ninguém viu no deploy.

Decisão do dono ao ver a causa: o resolver às vezes não tem sessão nenhuma
pra checar (o shell do portal renderiza para um aluno; a página de convite,
para ninguém), então checar e-mail ali não é possível — mas isso não exige um
segredo de serviço-a-serviço, exige aceitar que **ler o estado não precisa de
porta**. O que a lista de flags desligadas revela (quais seções ainda não
foram lançadas) não é sensível o bastante pra justificar um segredo de
produção obrigatório sem processo nenhum garantindo que ele exista antes do
deploy. A porta que importa continua de pé: **mudar** uma flag exige
`.owners()` (§8.1 acima) — só ler o estado, não.

`INTERNAL_API_TOKEN` foi removido do código dos dois lados (`apps/api`,
`apps/app`), não só desligado: um segredo obrigatório em produção que ninguém
revisou uma vez já bastou.

**A tela não tem flag própria**, de propósito: seria a única flag da qual não se
volta pela tela que ela esconde. Ela é mantida fora do ar por outros meios — só
é desenhada para o domínio dos donos, e as rotas atrás dela são `.owners()`.

### 8.2 Ordem de resolução

Para cada flag, nesta ordem:

1. **Override de ambiente** — `OOC_FLAG_<CHAVE>` valendo `on` ou `off`
   (`portal.payments` → `OOC_FLAG_PORTAL_PAYMENTS`). Qualquer outro valor é
   erro de boot, não um encolher de ombros. Na Vercel a variável é *scoped* por
   ambiente, que é o que permite ligar algo em produção sem mexer no código.
   **Ela ganha do painel de propósito:** é o caminho de volta quando o painel é
   justamente o que quebrou.
2. **Interruptor do painel** — a linha em `feature_flag_overrides`. Fica
   naturalmente restrita ao ambiente pelo banco em que foi escrita (local,
   branch de staging, produção).
3. **Ambiente** — fora de produção **toda flag está ligada**, sempre. Ramo
   nenhum é demonstrado com meio painel faltando. Note que (2) ganha de (3):
   quem move um interruptor *neste* ambiente não é o padrão esquecido contra o
   qual essa regra foi escrita — é um ato deliberado, e testar o estado
   desligado localmente é exatamente para o que se abre aquela tela.
4. **Padrão do registro** — o campo `production` da flag.
5. **Pai** — filha nunca fica mais ligada que a mãe (`portal.payments` depende
   de `portal`; `teacher` depende de `backoffice`).
6. **Destravamento interno** — com o cookie válido, tudo resolve ligado.

Uma linha cuja chave não está mais no registro **não governa nada**: flag
aposentada deixa a linha para trás, e o resolver a ignora em vez de andar uma
cadeia de pais para uma chave que já não existe.

`APP_ENV` diz qual é o ambiente. É derivada (`APP_ENV` explícita →
`VERCEL_ENV` → `NODE_ENV`) e **falha fechada**: processo sem rótulo rodando
build de produção é tratado como produção, porque chutar "development" ali
colocaria toda tela pela metade no ar.

### 8.3 O destravamento interno ("fica só pra nós")

```
/api/preview?token=<segredo>&next=/portal/payments   abre
/api/preview?off=1                                   fecha
```

- O segredo é `FEATURE_PREVIEW_TOKEN` (≥ 24 caracteres), configurado por
  ambiente na Vercel. **Sem token configurado não há destravamento** — a rota
  responde 404.
- Token errado responde **404**, nunca "token inválido": quem chuta não pode
  descobrir que havia algo a chutar (anti-enumeração, `CLAUDE.md` §8).
- O cookie é `httpOnly`, `secure`, `SameSite=Lax`, **12 h** — um dia de
  trabalho, e ele mesmo expira. A rota redireciona na hora, então o segredo não
  fica na barra de endereço nem vaza no referrer.
- Enquanto está aberto, **uma tarja aparece em toda tela do app** dizendo que o
  que está sendo visto não está ativo para mais ninguém, com o botão de sair.
  Ela não é opcional: ver uma tela interna em produção sem saber que ela é
  interna é exatamente como nasce a caçada do "o aluno diz que não aparece".

Nada disso chega ao cliente: a resolução é server-only e componente de cliente
recebe o booleano já resolvido por prop — a lista do que existe mas está
desligado não vai no bundle.

### 8.4 Onde a flag é aplicada

- **Rota:** `layout.tsx` da seção chama `requireFeature('<chave>')`, que faz
  `notFound()`. Fica no layout, e não em cada página, para que uma tela nova
  criada ali amanhã **herde** o portão em vez de precisar lembrar dele. No
  backoffice isso é `(panel)/(gated)/layout.tsx` (desde 17/09/2026, §8.8) — um
  layout aninhado dentro do `(panel)/layout.tsx` que desenha a casca (sidebar,
  header); `(panel)/features` fica fora do grupo `(gated)`, e por isso nunca
  herda o portão de `backoffice`.
- **Navegação:** o item some do menu. Não vira cadeado — cadeado é o vocabulário
  de "anunciado, não construído" (a Área do aluno do portal), que é uma
  afirmação diferente e pública.
- **Portas internas:** entrada de dashboard, ação de linha e CTA que levam a uma
  seção desligada não são desenhadas. O fato continua dito (o cadeado da aula, o
  "pendente" da mensalidade); o que some é a porta.

### 8.5 As flags de hoje

| Chave | Superfície | O que governa |
| --- | --- | --- |
| `portal` | portal | O portal inteiro (shell, dashboard, perfil) |
| `portal.courses` | portal | Meus cursos + detalhe do curso |
| `portal.payments` | portal | Pagos (mensalidade, comprovante, histórico) |
| `portal.procedures` | portal | Trámites pagos (`/portal/enrollment`) |
| `portal.documents` | portal | Constancias e certificados |
| `portal.continue` | portal | Continuar estudando (próximo nível, re-matrícula) |
| `backoffice` | backoffice | O painel inteiro |
| `backoffice.students` | backoffice | Diretório de alunos e ficha |
| `backoffice.enrollments` | backoffice | Matrículas + reservas |
| `backoffice.payments` | backoffice | Pagamentos, fila de revisão, parâmetros |
| `backoffice.academic` | backoffice | Turmas + cursos |
| `backoffice.teachers` | backoffice | Docentes e fichas |
| `backoffice.email` | backoffice | Módulo de e-mail |
| `backoffice.reports` | backoffice | Relatórios |
| `backoffice.staff` | backoffice | Equipe (cargos, MFA) |
| `backoffice.settings` | backoffice | Configuração da plataforma |
| `teacher` | docente | O painel do docente (mesma app, rail estreita) |

Todas nascem aqui com `production: true` porque **todas já estão no ar**: o
registro chegou para gerir o que se expõe, não para aposentar tela sem aviso.
Desligar qualquer uma agora é um clique em Funcionalidades — e toda troca fica
no `audit_log` (`feature_flag.override`, com o valor de antes e o de depois).

**Flag nova nasce `production: false`**, e é ligada no mesmo PR que torna a
seção real. Quando a seção deixa de ser novidade, a flag sai do registro junto
com o `layout.tsx` que a checava — flag eterna vira ruído que ninguém confia.

### 8.6 A tela (Funcionalidades)

`/backoffice/features`, último item do grupo Administração — e o único item da
rail decidido por e-mail em vez de cargo.

Por flag ela mostra o nome, a chave técnica, **qual das quatro fontes decidiu**
(env, painel, ambiente, código), quem moveu por último, e o interruptor. Duas
verdades diferentes convivem ali: o que a flag diz de si (o interruptor) e o que
o leitor de fato recebe depois de o pai opinar — uma seção pode estar ligada e
invisível porque a superfície acima dela está desligada, e a tela diz isso em
vez de deixar o interruptor parecer quebrado. Flag mandada por `OOC_FLAG_*` tem
o interruptor travado, com o nome da variável do lado: a tela não finge poder
mover o que não move.

Quem já foi movida ganha **"Voltar ao código"**, que apaga a linha em vez de
gravar o padrão — o padrão do código volta a valer de verdade, inclusive se ele
mudar num commit futuro.

### 8.7 Limitação conhecida

Links profundos **entre seções do backoffice** ainda não consultam a flag do
destino: abrir a ficha de um aluno a partir de Pagamentos, de Matrículas, de
Reservas, de Envios de e-mail ou da lista de certificados de uma turma; abrir
uma turma a partir da ficha do docente ou do detalhe de matrícula; abrir a ficha
do docente a partir de Equipe. Com a seção de destino desligada e a de origem
ligada, esses links dão 404 para quem trabalha no painel. As portas das telas de
entrada (dashboard de coordenação e dashboard do docente) e **todo o portal do
aluno** já respeitam a flag. Fechar o resto exige levar o booleano como prop até
os componentes de cliente dessas telas — trabalho mecânico, ainda não feito.

### 8.8 Incidente 17/09/2026 — backoffice e portal fora do ar

**O que aconteceu.** Pelo card novo de Funcionalidades (`2ce11b6`, que põe o
flag raiz da superfície como o primeiro interruptor do card, ao lado dos
filhos), alguém desligou `backoffice` — e, pelo mesmo motivo, `portal` e os
seis flags filhos dele também ficaram em `false`. `requireFeature('backoffice')`
rodava no mesmo `layout.tsx` que desenha a casca do painel (sidebar, header) e
que serve **toda** rota sob `/backoffice`, `/backoffice/features` incluída —
então o 404 comeu o painel inteiro, e a única tela que devolveria o flag ficou
atrás do próprio flag que ela devolve. `GET /feature-flags/state` (rota
pública, §8.1) confirmou em produção: `{"backoffice": false, "portal": false,
"portal.courses": false, ...}`. Sem sessão de dono para gravar de volta pela
API e sem acesso à tela, a única saída documentada até então era variável de
ambiente na Vercel (`OOC_FLAG_BACKOFFICE=on`) — o caminho de emergência, não a
porta de todo dia.

**A correção, em duas partes:**

1. **Estrutural.** `apps/app/src/app/[locale]/backoffice/(panel)/` ganhou um
   grupo de rota `(gated)/`: todo screen que antes vivia direto em `(panel)/`
   (home, students, payments, enrollments, class-groups, courses, teachers,
   emails, reports, team, settings, account) mudou para
   `(panel)/(gated)/<seção>/` — mesma URL, route group não entra no caminho.
   O `requireFeature('backoffice')` (e o `requireFeature('teacher')`
   condicional do docente) saiu do `layout.tsx` da casca e foi para um
   `(gated)/layout.tsx` novo, que só embrulha essas seções. `(panel)/features`
   ficou fora do grupo — segue protegida como sempre foi, por
   `canManageFeatureFlags(staff.email)` dentro da própria página — mas nunca
   mais herda o portão de `backoffice`. Isso fecha, no código, o que o
   comentário do registro já dizia por escrito desde 06/09 ("a tela de flags
   não tem flag própria") e nunca tinha sido verdade na prática.
   `getStaffSession` (`lib/backoffice/session.ts`) ganhou `cache()` no processo
   — a casca e o portão agora leem `/me` no mesmo request, e memoizar evita
   duplicar a chamada.
2. **De interface.** O switch que desliga o flag raiz de uma superfície
   (`SurfaceHeader` em `features-view.tsx`) passou a abrir um diálogo de
   confirmação antes de gravar — dizendo quantas seções descem junto e que todo
   endereço da superfície vira 404 para todo mundo menos para nós. É o único
   switch da tela com essa fricção: os demais continuam desligando direto, como
   sempre — só esse derruba um card inteiro de uma vez.

**Detecção, pra quem passar por isto de novo:** `curl
https://only-one-coin-api.fly.dev/feature-flags/state` (rota pública, sem
sessão) mostra o override cru gravado no banco — se `backoffice` ou `portal`
aparecem como `false` ali, é a mesma causa. O 404 do Next chega com HTTP 200
quando pego por streaming (o cabeçalho já foi enviado antes de `notFound()`
disparar), então o status HTTP sozinho engana; o corpo da resposta que carrega
o marcador de "não encontrado" é a prova.

**O que ficou de fora, de propósito:** a limitação de §8.7 (links profundos
entre seções) é outro problema, não coberto por este fix — reduzir o alcance de
um único clique errado não elimina outras formas de acabar num 404 dentro do
painel.
