# CLAUDE.md — `apps/api`

Carregado junto com o `CLAUDE.md` da raiz quando uma sessão trabalha aqui dentro. Regra que vale para mais de um app/pacote vive na raiz — este arquivo só tem o que é específico do backend (Fastify + workers).

---

## Pagamento

- `payments` é **agnóstico de origem**. Máquina de estados: `pending → under_review → approved | rejected`.
- Dados de extração ficam em `payment_receipts`, não em `payments`.
- **`amount_cents INTEGER`.** Nunca float, nunca `numeric` de ponto flutuante (ver também `packages/db/CLAUDE.md`).
- **Idempotency key em todo pagamento.** Duplo POST de celular ruim é certeza.
- Preço é **versionado, nunca editado**. A matrícula congela o `plan_price_id` vigente. Corrigir a tabela de preços não pode revalidar histórico.
- Tolerância de validação **configurável no backoffice**, não constante no código.

## OCR — nunca síncrono

```
submit → grava student + enrollment + payment (pending) → responde em <300ms
       → enfileira job
       → worker: normaliza imagem → pHash → extrai → valida → outbox
```

A rota de submit **não pode importar o módulo de IA.**

Escada de níveis:

| Nível | Gatilho | Ação |
| --- | --- | --- |
| 0 | pHash já visto | bloqueia |
| 1 | padrão | Gemini 3.1 Flash-Lite |
| 1r | falha técnica (timeout, 429) | retry mesmo modelo, até 3x, backoff |
| 2 | confiança baixa em campo crítico | modelo de **outra família** |
| 3 | divergência ou ilegível | fila humana |

- **Nunca mais de uma escalada.** Divergiu, é humano.
- **Concordância é o critério**, não o modelo mais caro. Os dois batem em `operation_number` e `amount` → aprova. Divergem → humano.
- Gravar `tier`, `model_name`, `model_version` e confiança por campo em toda extração.
- Pré-processar sempre: downscale ~1000px, escala de cinza, strip EXIF, converter HEIC.

## Upload

**Signed URL direto ao Storage.** A imagem nunca passa pela função — é o que derruba tudo sob volume.

## Vagas — condição de corrida

Nunca validar vaga na aplicação. Instrução atômica única:

```sql
UPDATE class_groups
   SET seats_taken = seats_taken + 1
 WHERE id = $1 AND seats_taken < capacity
RETURNING seats_taken;
```

Zero linhas = cheia. Mais `CHECK (seats_taken <= capacity)` como rede (`packages/db/CLAUDE.md`).

Estados de vaga: `reserved` → `confirmed` (pagamento aprovado) → `released` (rejeitado ou expirado).

**Dois relógios, não um.** A vaga é presa antes do pagamento — quem paga já pagou com a vaga na mão — e isso cria duas janelas com prazos muito diferentes:

| Relógio | De → até | Prazo | Quem devolve a vaga |
| --- | --- | --- | --- |
| **Hold de checkout** | vaga presa no checkout → comprovante enviado | **15 min** | o próprio checkout, ao expirar |
| **Janela de revisão** | comprovante enviado → pagamento aprovado ou recusado | **5 dias** | cron de reserva parada |

O hold curto existe porque o pagamento acontece **fora da plataforma** (Yape/transferência, `CLAUDE.md` §2 — não há pasarela): a pessoa sai da página, paga no app do banco e volta. Sem o hold, ela paga e descobre a turma cheia na volta — e não existe fluxo de devolução. Expirado o hold sem comprovante, a vaga volta pra turma e o checkout recomeça do passo da turma.

Enviado o comprovante, a vaga **continua `reserved`** e passa a correr no relógio de 5 dias. Ela só vira `confirmed` quando o pagamento é aprovado (OCR ou revisão humana) — enviar comprovante não confirma matrícula, só garante que a vaga não cai pelo hold curto.

Os dois prazos são **configuráveis no backoffice** (`/backoffice/settings`), nunca constante no código — mesma regra da tolerância de valor.

## Origem da matrícula (atribuição de canal)

Toda matrícula grava **de onde veio** — hoje `whatsapp` (link mandado pelo vendedor depois da venda fechada) ou `web` (a pessoa chegou sozinha pela landing). É campo do domínio, não analytics: fica na própria `enrollments`, não só no PostHog, porque a coordenação precisa responder "quantas matrículas o zap trouxe neste ciclo" dentro do backoffice, e porque analytics de borda se perde com bloqueador de anúncio.

- Mora na **matrícula**, não no aluno. A mesma pessoa pode voltar por outro canal no ciclo seguinte; um campo no aluno perderia o histórico.
- Capturado no **primeiro acesso** ao checkout e carregado até o submit — se a pessoa recarregar ou sair pra pagar, a origem não se perde.
- Valor **nunca vem confiado do cliente** como texto livre: é união fechada, e qualquer coisa fora dela cai em `web`.
- Os parâmetros de campanha (`utm_*`) andam junto, mas separados, para relatório — a origem é o dado de negócio, o `utm` é o detalhe da peça.

O link do WhatsApp é URL comum com `?course=&group=&src=whatsapp` — **prefill e atribuição, não token**: sem segredo, sem autenticação e sem preço embutido (o valor vem sempre do `plan_price` vigente, lido no servidor). Isso é o que o mantém compatível com `CLAUDE.md` §2, "sem links de matrícula tokenizados".

## Notificações

Tudo passa pela tabela `outbox`. O sistema não conhece o Brevo:

```ts
interface NotificationProvider {
  sendEmail(to, templateKey, vars): Promise<{ providerId: string }>
}
```

Templates versionados no repositório (`packages/notifications`), não desenhados só no painel do Brevo.

## Domínio e fila (fronteira com `packages/domain`, `packages/queue`)

`packages/domain` é DDD puro — nunca importa Fastify, provedor de banco ou Redis. A implementação concreta (repositórios Drizzle, adapters) mora aqui, em `apps/api/src/infra/`. Detalhe completo da regra de fronteira e da exceção do vocabulário de erro HTTP: `packages/domain/CLAUDE.md`. Padrão de código (`BaseModel`/`BaseUseCase`, `RouteBuilder`, `container.ts`, entrypoints): `packages/domain/README.md` e `apps/api/README.md`.

**Biblioteca embutida no processo nunca responde HTTP com o shape dela própria.** Better Auth (e qualquer outra lib embutida que fale HTTP direto) roda dentro de `apps/api`, mas isso não abre exceção ao contrato de erro (`docs/ARCHITECTURE.md` §5.7): a mensagem/código nativo do provedor nunca chega ao cliente como está — sempre traduzido pro envelope `{status, reason, path?, errorId?}` do projeto antes de sair, e o texto original (se não puramente técnico) fica só no log do servidor (`CLAUDE.md` §4, "zero string de UI... inclui mensagem de erro de API"; §6, "stack trace ao usuário proibido"). Implementação: `apps/api/src/http/auth/AuthCatchAllRoute.ts`.

## Feature flags — ponta do backend

O catálogo e o interruptor de feature flags são coisa de `apps/app` (`apps/app/CLAUDE.md`, seção "Feature flags"). Aqui só vive a ponta que a API precisa garantir: `PUT /feature-flags/:key` é `.owners()` (e-mail do domínio dos donos, nunca papel), `GET /feature-flags/state` é público (sem sessão), e toda troca grava no `audit_log`. Deny-by-default (abaixo) continua valendo mesmo pra rota `.owners()`.

## Autorização deny-by-default

Todo usecase/rota declara explicitamente `.roles(...)`, `.owners()` ou `.public()` — rota sem declaração falha o **boot** da aplicação (não só o CI), via `onRoute` hook. `onRequest` resolve a sessão, responde 401 sem sessão válida e 403 fora do papel/domínio exigido. Suíte de teste cobre os três casos (`apps/api/src/infra/plugins/authorization.test.ts`). Ver `CLAUDE.md` §8 para o quadro de papéis e o que cada um pode.

## Gestão de cargos — anti-escalada de privilégio

O `role` **nunca** mora em lugar que o próprio usuário escreve. Regras duras:

- `role` vive em coluna protegida na própria tabela `user` gerenciada pelo Better Auth (`additionalFields.role`, `input:false` — API pública de signup/update não aceita esse campo). `apps/api` **não expõe rota genérica de `UPDATE`** nela — a única forma de mudar `role` é um usecase dedicado de promoção (não um `PATCH` de usuário comum), nem para o próprio dono, nem para admin comum fora desse fluxo.
- **Nunca** guardar `role` em algo editável pelo usuário (ex.: `user_metadata` de provedores de auth que expõem isso). `input:false` garante que o `role` do Better Auth é preenchido **server-side**, nunca a partir do payload de cadastro/perfil do usuário.
- `apps/api` lê o `role` a partir do registro do usuário autenticado no banco a cada requisição sensível — **nunca** de header/JWT montado pelo cliente.
- Toda mudança de cargo → `audit_log` append-only.

**Modelo de criação de staff (fechado):**

1. **Bootstrap:** o primeiro `admin` nasce por **script versionado** (`apps/api/src/scripts/seed-admin.ts`, `pnpm --filter @ooc/api seed:admin`) — não por migration SQL de mão: a senha precisa do hash real do Better Auth, que uma migration não consegue reproduzir sem reimplementar o hasher. O script assina o cadastro pelo próprio `auth.api.signUpEmail` (hash correto) e só então promove `role` pra `admin` direto no banco — o único ponto autorizado a contornar `additionalFields.role.input:false`, porque nunca roda sobre HTTP. Local/dev apenas; nunca apontar pra staging/produção. Credencial de desenvolvimento: `admin@admin.com` / `admin1234` (Better Auth recusa senha com menos de 8 caracteres — não foi afrouxado pro seed).
2. **Depois:** **só `admin`** cria/promove staff, pela UI, via usecase dedicado (`PromoteUserRoleUseCase`, `packages/domain/src/identity/`) que exige **re-autenticação fresca** do admin. Nenhum outro papel promove ninguém. O plugin `admin` do Better Auth não garante reautenticação fresca sozinho — é o usecase, não o provedor, que impõe essa checagem antes de escrever o `role`.

---

Regras de negócio, stack, i18n e o quadro de papéis/RBAC estão no `CLAUDE.md` da raiz — não duplicadas aqui. Estrutura de pastas e estado real do backend: `apps/api/README.md`.
