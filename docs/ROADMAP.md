# ROADMAP — Only One Coin · Plataforma Académica Digital

Plano de desenvolvimento em **sessões pequenas**. Uma sessão = um objetivo = um PR.

Este arquivo é o **único lugar do estado por sessão** — o `README.md` não repete. O estado tela a tela de `apps/app` (o que já fala com a API, o que é mock) vive no [`apps/app/README.md`](../apps/app/README.md).

## Como usar

1. **Uma sessão por vez.** Não comece a próxima sem a anterior mesclada e verde no CI.
2. **Uma sessão = um PR.** Se o PR passar de ~400 linhas de código de verdade, a sessão estava grande demais — quebre.
3. **Só avance quando o critério de pronto estiver cumprido.** "Quase funcionando" não conta.
4. Atualize a coluna **Estado** quando fechar ou avançar uma sessão. Uma linha, com o ticket do Linear — o detalhe vive no ticket e no `CLAUDE.md` da área, não aqui.
5. Se uma sessão revelar trabalho não previsto, **crie uma sessão nova** em vez de inflar a atual.

**Legenda do Estado:** ✅ pronto (critério cumprido) · 🟡 parcial (diz o que falta) · ⬜ não iniciado.

### Template de prompt por sessão

```
Leia o CLAUDE.md e o docs/ROADMAP.md.

Vamos fazer a Sessão N — <título>.
Entregável: <copiar da tabela>
Pronto quando: <copiar da tabela>

Me mostre o plano em passos numerados e espere meu OK.
Não faça nada fora do escopo desta sessão. Se identificar
trabalho adicional necessário, me avise e eu decido se
entra aqui ou vira sessão nova.
```

### Regras que valem para todas as sessões

- Nada de string em espanhol dentro de `.ts` / `.tsx` — sempre em `es-PE.json`
- Toda mudança de banco é migration versionada
- Migration aplicada em staging antes de produção, sempre
- Nenhuma feature entra sem checagem de autorização por papel declarada e sem rate limit declarado

---

## Resumo (revisado em 07/11/2026)

| Fase | ✅ | 🟡 | ⬜ | Leitura rápida |
| --- | --- | --- | --- | --- |
| 0 — Espinha dorsal | 9 | 4 | 0 | Faltam as tabelas acadêmicas (frequência, certificado, campanhas; notas prontas, OOC-38), a imagem dos comprovantes no seed, o ambiente de staging inteiro e a branch protection da `main` (o CI roda, mas não bloqueia merge) |
| 1 — Site público | 0 | 6 | 0 | Páginas e SEO no ar; faltam píxeis/PostHog, blog, redirects do WordPress e o cutover de DNS |
| 2 — Matrícula + IA | 9 | 3 | 3 | Núcleo construído de ponta a ponta; falta medir a OCR, o nível 2 e a espera no checkout |
| 3 — Backoffice | 5 | 3 | 2 | Operacional fechado na semana de 19–23/10: alunos, turmas, Pagos, equipe, docentes, contrato e auditoria reais. Home do painel real; Relatórios continuam mock e estão ligados em produção. Notas do docente reais desde a OOC-38 (em revisão; falta frequência, a confirmar); conciliação fica para depois |
| 4 — Portal do aluno | 1 | 3 | 1 | Login e telas reais (OOC-32), o enlace da aula (Classroom da turma, OOC-98), o pedido pago da constancia (OOC-83) e a seção Arquivos (OOC-143); faltam módulos/mensalidade, os demais trâmites e os documentos emitidos |
| 5 — E-mail | 0 | 3 | 1 | Envio real via Brevo pela outbox; fluxos automáticos reais (catálogo, preview, não entregues, prova — OOC-89, em revisão); webhook no código, não confirmado em produção; campanhas ainda mock |
| 6 — Instalável | 0 | 0 | 4 | — |
| 7 — Lançamento | 0 | 3 | 3 | Importador legado pronto (falta o dry-run revisado com o cliente); backup a cada deploy já roda; restauração nunca testada; headers prontos; Sentry/PostHog não instalados |

### Sprint da semana (09–14/11/2026): o que estourou e o feedback de 07/11

A semana de 02–06/11 fechou com a OOC-83 (constancia paga) e, fora do plano, os hotfixes do cliente (OOC-130 a OOC-138, OOC-140 a OOC-142) e a OOC-143 (envio de documentos genérico). Estouraram o prazo de 06/11 e foram para quarta, **11/11**: OOC-38 e OOC-102 (notas), OOC-89 (prova de e-mail), OOC-99 (calendário de docentes), OOC-50 (restauração do backup) e OOC-72 (consentimento do apoderado, ainda em Backlog esperando decisão). As tarefas novas de 07/11 vão para **14/11**. Nenhuma tem dono atribuído. Fora da tabela, mas com prazo no Linear: OOC-62, OOC-95, OOC-96 e OOC-103 vencem em **13/11** e esperam decisão (ver abaixo); a OOC-108 (cursos do backoffice × checkout, sessão 16/22) está em Todo com prazo de **14/10, vencido** — precisa de prazo novo ou de entrar na semana.

| Frente | Ticket | Sessão / tema | Prazo |
| --- | --- | --- | --- |
| Notas | OOC-38 + OOC-102 (nota do exame final, DA, ficha de notas do docente; dois critérios da 102 contradizem regra fechada, ver abaixo) | Sessão 37; destrava OOC-85, OOC-33 e OOC-59 | 11/11 |
| E-mail | OOC-89 (envio de prova real) | Parte "prova" da sessão 49 | 11/11 |
| Acadêmico | OOC-99 (calendário de docentes) | Portal do docente, fora das sessões | 11/11 |
| Lançamento | OOC-50 (restauração do backup; espera o OK do dono sobre onde restaurar) | Sessão 55, que nunca se corta | 11/11 |
| Decisão | OOC-72 (como chega o consentimento do apoderado) | Fora das sessões | 11/11 |
| Dinheiro | OOC-146 (refazer Pagos e a revisão de comprovantes; contradiz regras fechadas, ver abaixo) | Sessão 32 | 14/11 |
| Matrícula | OOC-139 (link do WhatsApp enviado pela IA; a origem `whatsapp` já existe desde a OOC-25 — falta separar IA × vendedor e mostrar nas métricas), OOC-145 (fila da matrícula aplicada à turma; sem descrição, provável continuação da OOC-140) | Sessões 20a e 24 | 14/11 |
| Portal do aluno | OOC-144 (Classroom por módulo e modal da matrícula), OOC-148 (documentos unificados, sobre a tabela da OOC-143), OOC-150 (idioma do perfil não fica salvo) | Sessões 42, 43 e 44 | 14/11 |
| Backoffice | OOC-151 (KPIs sem rótulo e números conferidos), OOC-149 (revisar os módulos; sem descrição) | Sessão 39 e OOC-94 | 14/11 |
| Avaliação | OOC-147 (acesso de apoderado com vários filhos e compra de vários cursos) | Fora das sessões, provável ordem de mudança | 14/11 |

Esperando decisão: OOC-146 contra três regras fechadas (remover o status pendente, quando `pending` é o verde esperando uma pessoa; comprovante obrigatório, quando hoje sem comprovante a tela avisa e não bloqueia; priorizar os mais antigos, quando a OOC-120 abre por confiança com "mais antigos" a um clique — `CLAUDE.md` §1), OOC-144 pedindo um Classroom por módulo contra o Classroom por turma da OOC-98, OOC-145 e OOC-149 sem descrição, OOC-72 (como chega o consentimento do apoderado, prazo passado para 11/11), onde restaurar o backup (OOC-50), se frequência continua no escopo (OOC-38), a OOC-102 pedindo que enviar notas finalize a turma (contra o status só por mão da OOC-35) e que a turma finalizada saia do portal do docente (contra a regra de 08/10/2026, que a tira só quando fechada), a OOC-95 e a OOC-102 pedindo "editar nota" contra a nota travada de 08/10/2026, dois critérios da OOC-98 que contradizem a OOC-35 e a OOC-80 (a turma "fica ativa" ao atribuir docente, e docente só se atribui com link), a OOC-103 pedindo que o docente preencha a própria ficha contra a ficha só de leitura da OOC-79, onde mostrar os comprovantes do aluno (OOC-62), se o aluno corrige o próprio celular (OOC-110), a definição de "vagas fechadas" (OOC-97), quem exporta alunos (`STUDENT_EXPORT_ROLES`, OOC-121), quem vê a auditoria (`AUDIT_LOG_ROLES`, OOC-122), quem reenvia e-mail que falhou (`EMAIL_DELIVERY_RESEND_ROLES`, OOC-90) e a regra de suspensão de aluno.

---

## FASE 0 — Espinha dorsal · Semanas 1–2

Sem isso, tudo depois fica mais caro. Não pule nem comprima.

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 1 | **Repositório e scaffold** | `git init`, pnpm workspaces, TypeScript strict, `apps/landing` (Astro) e `apps/app` (Next) subindo em branco, `packages/*` criados vazios | `pnpm dev` sobe os dois apps localmente e o repo está no GitHub | ✅ |
| 2 | **Config e ambiente** | Validação de env com zod no boot, `.env.example`, `.gitignore`, zero URL literal | App recusa subir com variável faltando, com mensagem clara | ✅ `apps/api/src/config.ts` |
| 3 | **Banco Postgres local** | Postgres local rodando (Docker — staging/produção usam Neon), CLI de migrations configurado, migration vazia inicial aplicando | `reset` do banco roda do zero e reaplica as migrations | ✅ `compose.yml` + Drizzle Kit |
| 4 | **Migration: modelo acadêmico** | `academic_periods`, `courses`, `plans`, `plan_prices`, `class_groups` com `CHECK (seats_taken <= capacity)` | `db reset` roda limpo; `plan_prices` versionado por vigência | ✅ `0003`; `plan_prices` append-only desde a `0017` |
| 5 | **Migration: pessoas e papéis** | `students`, `guardians`, `consents`, `teachers`, `user_roles`, `pg_trgm` para busca | Busca por nome/DNI/telefone funciona; sem grant de DELETE em `students` | ✅ Pessoas, `pg_trgm` e trava de DELETE (`0011`, OOC-18) prontos; `teachers` (com idiomas, disponibilidade e contratos) desde a `0025`/`0026` (OOC-77). `user_roles` não vai existir: o papel é `user.role` do Better Auth |
| 6 | **Migration: matrícula e pagamento** | `enrollments`, `payments` (idempotency key única, `amount_cents`), `payment_receipts`, `waitlist_entries` | Máquina de estados documentada; tentar inserir pagamento duplicado falha no banco | ✅ Máquina de estados em `apps/api/CLAUDE.md`. O índice de `image_phash` virou comum (`0016`, OOC-22). Decisão em coluna própria (`decided_at`/`decided_by`/`rejection_reason`) desde a `0027` (OOC-112) |
| 7 | **Migration: operação** | `outbox`, `campaigns`, `audit_log` (append-only), `attendance`, `grades`, `materials`, `certificates` | `audit_log` sem grant de UPDATE/DELETE nem para admin | 🟡 `outbox` (`0013`) e `audit_log` com trava (`0007`/`0011`, OOC-18) prontos. Material do módulo virou coluna de `courses` (`module_materials`, `0037`, OOC-94), não tabela própria. `grades` pronta (`0050`, append-only, OOC-38). Faltam `attendance` (sessão 37, escopo a confirmar), `certificates` (sessão 45, OOC-33/OOC-59 em Backlog) e `campaigns` (sessão 48). *O Entregável ainda pede a tabela `materials` — reescrever só com confirmação.* |
| 8 | **Autorização deny-by-default + suíte de teste** | Middleware deny-by-default em `apps/api`, toda rota/usecase declara o papel exigido | Teste enumera rotas e falha se faltar declaração; teste com papel errado falha | ✅ Rota sem `.roles()`/`.owners()`/`.public()` derruba o **boot** (`infra/plugins/authorization.ts`) |
| 9 | **Seed** | Script com dado fictício: 500 alunos, 3 períodos, ~40 turmas em vários idiomas, 200 comprovantes | Idempotente, com comando de reset. Zero dado real | 🟡 `seed:students`, `seed:enrollments`, `seed:catalog` e `seed-admin`, idempotentes; `seed:students` e `seed:enrollments` com `--confirm-host` (só `seed:students` tem `--undo`). `seed:load` (OOC-48, 28/10/2026) completa o entregável: alunos, 3 períodos, turmas em todos os idiomas do catálogo, matrículas, pagamentos e comprovantes com leitura da OCR e veredito do semáforo, em três perfis (`dev` = os números desta linha, ~570 comprovantes; `normal` = 5.000 e `peak` = 20.000 matrículas, um mês). Reset = banco novo (`pnpm db:reset:load`). Falta só a imagem dos comprovantes no bucket: o seed grava a chave do objeto mas não sobe o arquivo, então abrir a imagem na fila falha (`seed-load.ts`) |
| 10 | **Fila e outbox** | BullMQ (Redis self-hospedado no Fly.io) via `packages/queue`, worker em `apps/api` com retry/backoff/DLQ, adapter de notificação | Job falho vai para DLQ e não trava a fila. **Guarda de e-mail ativa: fora de produção só allowlist** | ✅ OOC-26. Job esgotado fica no conjunto `failed` por 7 dias; `AllowlistGuard` na frente do Brevo |
| 11 | **i18n** | Mensagens trilíngues com lint `no-literal-string` nos diretórios de UI | Build quebra ao introduzir string crua | ✅ OOC-14. Sem `packages/i18n`: cada app tem as próprias mensagens (`CLAUDE.md` §3) |
| 12 | **CI — portões** | gitleaks, varredura do build do Next.js por credencial de banco, `tsc`, ESLint, teste de autorização, migrations em banco limpo, validação de env | PR com segredo ou rota sem papel declarado é bloqueado | 🟡 Nove portões no CI (`CLAUDE.md` §6), incluindo a trava de privilégio e os repositórios contra o banco. Falta tornar o CI obrigatório: a `main` não tem branch protection nem ruleset (conferido em 07/11/2026), então um PR vermelho ainda pode ser mesclado |
| 13 | **Ambientes** | Neon de staging, `apps/api` no Fly.io, Vercel (landing + app) com env por projeto, branch protection na `main` | Staging publica em `staging.aula.onlyonecoin.edu.pe`; PR gera preview | 🟡 Deploy automático em `main` para os três apps (produção), backup → migration → deploy, blue-green no Fly, preview da Vercel por PR. Faltam o ambiente de staging inteiro (não há app de staging no Fly nem deploy de staging na Vercel; o branch de staging do Neon não foi conferido), o domínio `staging.aula.onlyonecoin.edu.pe` e a branch protection da `main` (ver 12). O DNS já está no Cloudflare (OOC-7), então o staging não depende do cutover; os domínios próprios de produção esperam a OOC-44 (Backlog) |

> **Marco:** protótipo navegável aprovado pelo cliente. Fecha a Fase 0 do contrato.

---

## FASE 1 — Site público · Semanas 3–4

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 14 | **Design system** | Tokens, tipografia, componentes base do Astro, identidade da associação modernizada | Página de referência mostrando todos os componentes | 🟡 Tokens e layout prontos (`apps/landing/CLAUDE.md`); a página de referência não existe |
| 15 | **Home e Nosotros** | Duas páginas com conteúdo real, seção de testemunhos, contador de impacto | Lighthouse mobile ≥ 90 em performance | 🟡 Home e Nosotros no ar nos três idiomas, com testemunhos na Home. O contador de impacto (`Stats.astro`) saiu da Home no redesign de 03/09 e não aparece em nenhuma página. Lighthouse não medido, sem ticket |
| 16 | **Cursos e Talleres** | Listagem lendo do banco (cursos e turmas abertas), com filtro | Turma fechada ou fora da janela não aparece | 🟡 `/courses` e `/courses/[slug]` no ar nos três idiomas, mas com conteúdo estático (`apps/landing/src/i18n/ui.ts`), sem leitura do catálogo da API e sem filtro — sem ticket. Preços da landing atualizados pela OOC-111. Desde a OOC-117 o botão de curso manda a chave da página e o checkout resolve o curso ligado no backoffice. (A OOC-108 é sobre o checkout do app, não sobre a landing) |
| 17 | **Blog, Contacto, FAQ** | Três páginas, migração dos últimos 20 artigos | Artigos migrados com URLs preservadas ou redirecionadas | 🟡 Contacto e FAQ prontos; blog é placeholder `noindex` (OOC-46) |
| 18 | **SEO e medição** | Metadados, sitemap, dados estruturados, píxeis Meta/TikTok, PostHog | Sitemap válido; funil de matrícula visível no PostHog | 🟡 Metadados, `hreflang`, sitemap, `llms.txt` e JSON-LD prontos. Faltam píxeis e PostHog (OOC-47) |
| 19 | **Publicação** | Domínio apontado, SSL, redirects do WordPress antigo | Site em produção; nenhuma URL antiga em 404 | 🟡 DNS já no Cloudflare (OOC-7). O domínio ainda aponta pro WordPress: faltam o cutover (OOC-44) e os redirects (OOC-45) |

> **Marco:** aprovação da Fase 1. Libera 30% do pagamento junto com a Fase 2.

---

## FASE 2 — Matrícula + IA · Semanas 5–7

**Fase de maior risco. Não comprima.** Se houver atraso no projeto, corte notas e frequência — nunca esta.

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 20 | **Formulário — estrutura** | Wizard multi-passo, validação com zod no cliente e no servidor, estado preservado entre passos | Recarregar a página no meio não perde o preenchimento | ✅ Desenho em `docs/MATRICULA-CHECKOUT.md` |
| 21 | **Formulário — dados e menores** | Campos de aluno, apoderado, idade mínima por curso, consentimento com versão e IP | Curso com `min_age` recusa idade menor; consentimento gravado com timestamp | ✅ Campos validados também na API e documento normalizado (OOC-64) |
| 22 | **Seleção de turma** | Lista só turmas abertas com vaga, mostra horário e data de início, oferece lista de espera quando cheia | Turma cheia não dá erro: oferece espera | 🟡 Data e horário separados, turma cheia desabilitada. Desde a OOC-140 (06/11/2026) turmas do mesmo horário viram um cartão só, com as vagas somadas, e o docente não aparece. A lista de espera existe só no backoffice (OOC-35); o checkout ainda não oferece, e não há ticket. A OOC-108 (Todo, prazo vencido em 14/10) aponta curso do backoffice que não aparece no checkout — triagem de 07/10 diz que pode não ser bug (rascunho ou janela fechada) |
| 23 | **Upload de comprovante** | Signed URL direto ao Storage, magic bytes, teto de tamanho, normalização (downscale, cinza, strip EXIF, HEIC) | Arquivo nunca passa pela função; HEIC de iPhone convertido | ✅ OOC-19 |
| 24 | **Submit e reserva de vaga** | Transação curta, incremento atômico de vaga, idempotency key, enfileiramento | p95 < 300ms; duas requisições simultâneas na última vaga → só uma entra | 🟡 Tudo construído, incluindo o hold de 15 min e a origem do canal (OOC-25). Falta medir o p95, que entra no teste de carga (57) |
| 25 | **Proteção da rota pública** | Turnstile, rate limit em `apps/api` sobre o Redis da fila, cache de idempotência | Rota resiste a rajada de requisições sem tocar o banco | ✅ OOC-24 |
| 26 | **OCR nível 1** | Worker chamando Gemini 3.1 Flash-Lite via OpenRouter com JSON schema, 5 campos, confiança por campo, `tier`/`model`/`version` | 20 comprovantes reais de amostra extraídos e conferidos à mão | 🟡 Worker no ar (OOC-20). Falta a medição na amostra real (`docs/OCR-AVALIACAO.md`, histórico vazio) |
| 27 | **Semáforo e validação** | Comparação contra `plan_prices` vigente, tolerância configurável, três estados | Casos de teste: exato, centavos a menos, a mais, muito abaixo | ✅ OOC-21. Só valida, nunca aprova (decisão de 03/10/2026) |
| 28 | **Antifraude** | pHash, bloqueio por número de operação, EXIF, cruzamento de titular | Mesmo comprovante recortado e reenviado é barrado | ✅ OOC-22. Quem barra é o nº de operação; pHash só registra. Regra em `apps/api/CLAUDE.md` |
| 29 | **OCR nível 2** | Escalada para modelo de outra família em baixa confiança, critério de concordância, alarme de volume | Divergência entre modelos vai para fila humana; escalada nunca encadeia | ⬜ O modelo já se configura (`RECEIPT_OCR_TIER2_MODEL`), e o limiar de confiança também (`platform_settings.ocr_low_confidence_percent`, OOC-41 — hoje só marca o campo na revisão), mas nada escala. Depende da medição da 26 |
| 30 | **E-mails da matrícula** | Templates de matrícula recebida, pago aprovado/em revisão/rejeitado, credenciais — via outbox | Todos trilíngues, disparados pela fila, nenhum no caminho síncrono | ✅ OOC-26 e OOC-28 (acesso ao portal por link de definir senha) |
| 20a | **Porta de entrada na landing** | URL do app por env, CTA "Matricúlate" nos três idiomas, link do vendedor (`?course=&group=&src=whatsapp`) | Nenhuma URL literal; o CTA leva ao passo 1 e o link do vendedor ao passo 2 | ✅ CTAs relativos, com 302 do `middleware.ts` da landing. Desde a OOC-117 o botão de curso manda a chave da página (`?course=english`), ligada ao curso no backoffice — o mapa de ids nunca casou com o catálogo. Pendente: ligar os cursos de produção e decidir o que a página de curso sem turma aberta mostra. A OOC-139 (Todo, 14/11) pede um link próprio para a IA do WhatsApp, separado do link do vendedor, com a origem gravada para as métricas de venda |
| 21a | **Nome do aluno no domínio** | `students.full_name` numa coluna só; `firstName`/`lastName` vira derivado ou some | Backoffice, portal e checkout leem o mesmo campo | ⬜ O banco ainda tem `first_name`/`last_name` |
| 27a | **PayPal para aluno no exterior** | Confirmar com o cliente; se sim, estender `PaymentMethod` e conversão como preço versionado | Aluno no exterior conclui a matrícula sem passar pelo WhatsApp | ⬜ Hoje `other` + texto livre registra o meio, sem conversão. Aguarda o cliente |
| 30a | **E-mail do aluno verificado** | Confirmar que o Gmail informado existe e é do aluno | — | ✅ OOC-65 (07/10/2026) — **código retirado pela OOC-141 (06/11/2026, decisão do dono: fricção e abandono)**. Fica a recusa do nome de usuário do Gmail que não pode existir, e o campo passa a pedir só o usuário, com `@gmail.com` fixo; a conferência vira operacional (quem não assistiu nem entrou no portal na primeira semana). Ainda no código, sem uso: as rotas `/enrollments/email-verifications`, os usecases, a tabela `email_verifications` (sai por expand/contract) e o template `email_verification_code`, que o catálogo ainda marca como disparado — saem num PR seguinte, **sem ticket no Linear**. *O Entregável desta linha ficou desatualizado — reescrever só com confirmação.* |

> **Marco:** aprovação da Fase 2. Libera 30% do pagamento.

---

## FASE 3 — Backoffice · Semanas 8–10

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 31 | **Shell e autenticação** | Login, papéis, MFA para `admin`/`billing`, navegação, anti-enumeração | Docente logado não acessa rota de tesouraria, nem pela URL | ✅ Login, convite, recuperação (OOC-30) e troca de senha (OOC-31) reais. MFA por código de e-mail (OOC-29, 14/10/2026): obrigatório para `master`/`admin`/`billing` — a API recusa esses cargos em toda rota até ativarem — e opcional para o resto, com códigos de recuperação. App autenticador fica para depois. Correções: OOC-6, OOC-12, OOC-13; flags visíveis aos donos em produção (OOC-61) |
| 32 | **Bandeja de comprovantes** | Fila ordenada por confiança, comparação imagem × extração, aprovar/rejeitar, atalhos de teclado, reprocessar | 25 revisões seguidas sem usar o mouse | ✅ Fila real em Pagos (OOC-55, OOC-114). OOC-120: a fila abre por prioridade (vermelho → amarelo → verde, menor confiança primeiro; "mais antigos" a um clique), atalhos de teclado com legenda (`?`) e "Ler de novo", que reenfileira a OCR e recalcula o semáforo sem mexer no status (`receipt_rereads`, migration `0031`). 25 revisões seguidas só com teclado medidas no navegador em 22/10/2026. A OOC-146 pede refazer Pagos e a revisão, e contradiz três regras fechadas (ver "Esperando decisão") |
| 33 | **Aprovação em massa** | Seleção dos casos verdes, ação em lote, confirmação de vaga, disparo de credenciais | Aprovar 100 pagamentos em uma ação, com auditoria de cada um | ⬜ Sem ticket. Se entrar, o lote continua sendo escolha de uma pessoa (decisão de 03/10/2026) |
| 34 | **Gestão de alunos** | Ficha única, busca `pg_trgm`, filtros, edição, suspensão, exportação | Busca por nome parcial e por DNI em < 300ms com 30k alunos no seed | 🟡 Busca e filtros no servidor (OOC-76), seções da ficha (OOC-34), matrículas na ficha (OOC-73), edição (OOC-74), aba Atividade (OOC-75), abas Ativos · Ex-alunos · Sem matrícula com ativo = matrícula vigente (OOC-116). Medido com 30k alunos e ~100k matrículas (Postgres local, 15/10/2026): diretório ~70 ms por aba, busca do seletor ~5 ms. Em produção a aba levava 6–14 s: `enrollments.deleted_at` sem estatística, plano em *nested loop* — `ANALYZE` na `0030` (OOC-119) — medido em produção depois: 14,4 s → 35 ms. Exportação em CSV (OOC-121): botão no diretório, mesma aba/busca/filtro da tela, gerada no servidor em lotes de 2.000, `audit_log` (`student.directory_exported`, sem o texto da busca) e 10 por hora por conta — ainda não medida com 30k alunos. Falta suspensão, sem regra de negócio definida e sem ticket |
| 35 | **Turmas e períodos** | CRUD de turmas, janela de inscrição, cupos, lista de espera, **duplicar período anterior** | Duplicar cria ~40 turmas zerando datas e vagas | ✅ OOC-35/OOC-36. Ajustes em OOC-70 (editar e aposentar/reativar período pela tela, com a contagem de matrículas de pé antes de confirmar — feito 24/10/2026), OOC-93 (filtro de início das aulas, período rotulado como período de matrícula) e OOC-104. Desde 27/10/2026 o código da turma é gerado pela API (`A-00042`, sequence do Postgres) e não se edita; duplicar dá código novo a cada cópia |
| 36 | **Docentes** | Perfis, atribuição de turmas, acesso checado no usecase (`teacher_id` do usuário autenticado) | Docente vê exatamente as próprias turmas, comprovado por teste | ✅ OOC-37 (contexto de docentes e telas religadas), OOC-77 (tabelas, trava, entidade), OOC-78 (CRUD na API; diretório, cadastro, ficha, disponibilidade e saída do quadro reais), OOC-80 (turma aponta para o docente do cadastro; turmas sem vínculo destacadas) e OOC-79 (convite liga a conta à ficha, `/me` com o `teacherId` real, docente lê a própria ficha) feitos. O portal próprio `/docente` entrou com o PR #136 (decisão de 18/10/2026) e, com a OOC-82, lê dado real: home, minhas turmas, a turma e a agenda vêm de `/teaching/*` (`.roles('teacher')`, escopo checado no usecase). **Critério cumprido:** `Teaching.integration.test.ts` prova no Postgres que o docente A não lê turma nem alunos do docente B (404, mesmo trocando o id), e `teaching-routes.test.ts` que o docente leva 403 em Pagos e na coordenação. Ficha de notas real e ligada desde a OOC-38 (`teacher.grades`); avisos à turma atrás de `teacher.notices` (desligada), sem ticket. Calendário de docentes é a OOC-99 (Todo, 11/11) e o onboarding do docente a OOC-103 (Backlog). Os acessos da turma (`teacher.class_links`) estão ligados em produção desde a OOC-98 (27/10/2026): o Classroom da turma, colado pela coordenação junto do docente, chega real ao portal; o material do módulo chega com a OOC-100 (28/10/2026: a turma guarda o módulo que dá, e a API entrega o link do curso para ele); a agenda continua atrás de `teacher.agenda`. OOC-81 (contrato: upload de PDF pela ficha, histórico, download auditado) feito; a OOC-124 (feita 24/10/2026) troca o upload pelo registro do período ao gerar o contrato pelo modelo publicado — a cópia assinada fica fora da plataforma. |
| 37 | **Frequência e notas** | Registro por sessão, interface para celular do docente, tolerante a conexão ruim | Funciona em 3G lento; perda de conexão não perde o registro | 🟡 Notas feitas (OOC-38, em revisão): tabela `grades` append-only (`0050`, travada nas duas camadas), `GET`/`POST /teaching/class-groups/:id/grades` só para o docente da turma (escopo no usecase, provado no Postgres com docente A × B), nota do exame final ou DA, travada depois de lançada, `audit_log` `teaching.grades_recorded`. A ficha do docente grava na API e aguenta conexão ruim: a nota confirmada fica numa fila no aparelho e é reenviada até a API responder (reenvio da mesma nota é no-op), e o rascunho do lote também fica no aparelho; `teacher.grades` ligada em produção. **Não medido em 3G de verdade** (só o mecanismo testado). Faltam: frequência (escopo a confirmar com o dono), observações por aluno (saíram da ficha, sem API), a coordenação lançar nota e os três critérios da OOC-102 que contradizem regra fechada (ver "Esperando decisão") |
| 38 | **Conciliação bancária** | Upload de extrato CSV, casamento por número de operação, relatório de divergência | Extrato de 500 linhas casado, com os não conciliados listados | ⬜ OOC-39 |
| 39 | **Relatórios e tablero** | Matrículas por período/curso/região, ingressos, retenção, impacto social, materialized views noturnas | Relatório carrega em < 2s; agregação não é ao vivo | 🟡 Relatórios sobre mock (OOC-40, Backlog, 23/11), **com `backoffice.reports` ligada por padrão em produção: a tela mostra números inventados sem aviso**; sem view noturna nem rota de relatório na API. Home do painel com dado real (OOC-67), agregada ao vivo — exceção decidida pelo dono em 11/10/2026: os relatórios desta sessão seguem em view noturna, a home não ("matrículas de hoje" numa view noturna seria sempre zero). Conferir os números dos KPIs e tirar os rótulos é a OOC-151 (Todo, 14/11) |
| 40 | **Auditoria** | Tela de bitácora, filtros, exportação | Tentativa de alterar ou apagar registro falha no banco | ✅ A trava no banco existe (`0011`), com bitácora de cargo na Equipe (OOC-69) e a aba Atividade do aluno. Tela geral `/backoffice/audit` (OOC-122): filtros por período (dias de Lima), autor, ação e entidade no servidor, paginação por cursor (índices na `0035`), link para a entidade quando ela existe, e exportação CSV registrada no próprio `audit_log`. Quem vê (`master`/`admin`/`analyst`) ainda a confirmar com o dono |

---

## FASE 4 — Portal do Aluno · Semanas 11–12

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 41 | **Acesso do aluno** | Login com credencial recebida por e-mail, recuperação de senha, política de senha, rate limit, anti-enumeração | Aluno só vê os próprios dados, comprovado por teste de autorização | ✅ OOC-28: conta criada na aprovação, login por e-mail ou documento, link de 1 h |
| 42 | **Painel do aluno** | Cursos, horário, data de início, enlace à aula, estado de matrícula e pagamento | Constancia visível na tela, sem depender do e-mail | 🟡 OOC-32: cursos, horário, data de início, próxima aula, estado de matrícula e pagamento leem `GET /portal/overview`. O enlace da aula é o Classroom da turma (OOC-98), entregue só a vaga confirmada; um link por módulo e a matrícula em modal são a OOC-144. O aluno já pede e paga a constancia em Trâmites e acompanha o estado (OOC-83, 04/11/2026). Faltam o portal ler os módulos do curso (a base no backoffice é a OOC-94, feita; hoje o portal recebe a lista vazia), o cadeado e a progressão (OOC-85), a mensalidade (OOC-86) e o documento da constancia (OOC-33) |
| 43 | **Materiais e reenvio** | Materiais e links de gravação, carga de novo comprovante pelo portal | Nenhum vídeo no Storage — só link externo | 🟡 O aluno já reabre o comprovante enviado (URL de 5 min, OOC-32) e envia pelo portal o comprovante dos procedimentos pagos (OOC-83). Materiais do lado do docente feitos (OOC-100: o material do módulo da turma no portal do docente). Seção Arquivos do aluno real na ficha e no portal, sobre a tabela `documents` (OOC-143, 07/11/2026); unificar com os documentos emitidos é a OOC-148. Ainda não: materiais e gravações para o aluno (o portal recebe a lista vazia; sem ticket) e reenvio do comprovante de matrícula rejeitada (sem ticket). A lista de comprovantes do aluno é a OOC-62 (Backlog) |
| 44 | **Notas, frequência e perfil** | Visualização de notas e avanço, perfil editável, dados do apoderado | — | 🟡 Perfil e apoderado reais, só leitura (OOC-32); o aluno editar o próprio contato é o OOC-110; o idioma escolhido no perfil não fica salvo (OOC-150, sem descrição — confirmar se é o portal ou a conta do staff); notas e avanço dependem da 37 |
| 45 | **Certificados** | Constancia e certificado em PDF, código de verificação, página pública de validação | Página pública valida sem expor dado pessoal além do nome e curso | ⬜ OOC-33, OOC-59 (em P3, 23/11: dependem de notas). Base pronta (OOC-123, 23/10/2026): engine de templates em `packages/templates` (LiquidJS), modelos versionados (rascunho + versões imutáveis, `0034`), PDF com WeasyPrint na API e preview pelo pipeline real — com o contrato do docente como primeiro documento. Baixar o contrato preenchido pela ficha também (*Generar contrato*, sem guardar o PDF). Editor visual em Configuração → Documentos, com preview do PDF ao lado. Desde a OOC-124 (24/10/2026) gerar o contrato registra o período com a versão do modelo, e o registro reimprime pela versão gravada — primeiro documento emitido que aponta a versão; constancia e certificado entram no mesmo mecanismo |

> **Marco:** aprovação das Fases 3 e 4. Libera 25% do pagamento.

---

## FASE 5 — Módulo de e-mail · Semana 13

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 46 | **Brevo real e DNS** | Provider de produção, subdomínios `avisos.` e `noticias.` com DKIM, SPF, DMARC `p=none`, webhook de bounce/unsubscribe | E-mail entregando; bounce sincronizando de volta ao banco | 🟡 Provider Brevo real atrás da outbox, domínio raiz autenticado (DKIM + DMARC `p=none`). Webhook no código (OOC-91, fechada no Linear com 2 dos 3 critérios de aceite pendentes): entregue, bounce, bloqueio e descadastro viram `outbox_delivery_events`, e hard bounce marca o e-mail da ficha. Falta ligar em produção (`BREVO_WEBHOOK_TOKEN` + cadastro no painel do Brevo; sem registro no ticket de que foi feito), os subdomínios `avisos.`/`noticias.` e as telas lerem isso (entregues/devoluções nas métricas da OOC-88; motivos de bounce em não entregues) |
| 47 | **Tela A — fluxos automáticos** | Catálogo dos transacionais, preview do template do repositório, toggle, métricas de 30 dias, botão de prova | Preview mostra o template versionado, não o do painel do Brevo | 🟡 Catálogo único do domínio (OOC-87 ✅) e, com a OOC-88, lista, detalhe e jornada reais: contagem de 30 dias do outbox e preview do template versionado do repositório, renderizado pela API nos três idiomas — o critério de pronto. Não entregues reais (OOC-90 ✅: falhas `failed` do outbox ligadas à ficha pelo `dedupeKey`, reenvio como linha nova + `audit_log`). Faltam entregues/devoluções e motivos de bounce nas telas (o webhook já grava, OOC-91; falta ligar em produção e a tela ler `outbox_delivery_events`) Envio de prova real feito (OOC-89, em revisão): `POST /emails/flows/:key/proof`, até 5 endereços, assunto com `[PRUEBA]`, pelo outbox com a guarda de staging, fora das métricas e do reenvio, `audit_log` `email.proof_sent`. **A confirmar:** o entregável pede um toggle, que saiu da tela porque nada no backend pausa um template |
| 48 | **Tela B — campanhas** | Assistente de 4 passos, segmentos calculados no Postgres, contagem real, consentimento e opt-out | Segmento nunca fica armazenado no Brevo | ⬜ Tela mock (`/emails/new`). Sem ticket próprio: a OOC-42 (guarda-chuva das telas de e-mail, 4 de 5 sub-tickets feitos) deixa campanhas fora do escopo dela |
| 49 | **Aprovação e prova** | Prova para até 5 endereços com prefixo `[PRUEBA]`, trava por hash do conteúdo, dupla aprovação, cooldown de 7 dias, log imutável | Editar o conteúdo após a prova fecha a trava de novo | 🟡 Prova dos e-mails automáticos feita (OOC-89, em revisão): até 5 endereços, prefixo `[PRUEBA]`, pelo outbox e pela allowlist de staging, auditada. A prova do composer (campanha) continua só na tela. Trava por hash, dupla aprovação, cooldown de 7 dias e log imutável sem ticket (a OOC-89 os deixa de fora) |

---

## FASE 6 — Instalável e tablero · Semana 14

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 50 | **PWA** | Manifest, service worker, instalação no celular, offline básico | Instala em Android e iOS | ⬜ OOC-51 |
| 51 | **Push** | Notificações push com opt-in, integradas ao outbox | Aviso de turma chega como push e como e-mail, sem duplicar | ⬜ OOC-51 |
| 52 | **Tablero de impacto** | Painel exportável para doadores e aliados | Exportação em PDF e CSV | ⬜ OOC-52 |
| 53 | **E-mail de renovação** | Fluxo D-7 de fim de curso com oferta do próximo paquete | Cron dispara na data correta em `America/Lima` | ⬜ OOC-53 |

---

## FASE 7 — Migração, QA e lançamento · Semana 15

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 54 | **Importador da base** | Import com **dry-run**, relatório de erro linha por linha, deduplicação | Planilha real do cliente importada em dry-run com relatório revisado | 🟡 Importador pronto (PR #85, `pnpm --filter @ooc/api import:legacy`): dry-run por padrão, relatório de exceções linha por linha, idempotente, trava extra para produção. Validado só em local com as planilhas de Agosto/Setiembre 2026 (91,5% limpo). Faltam o dry-run sobre a planilha real com o relatório revisado pelo cliente e a consolidação das fichas duplicadas antes do índice único de documento (`CLAUDE.md` §1). Sem ticket |
| 55 | **Backup e restauração** | `pg_dump` para Tigris a cada deploy da API, antes da migration (o agendado foi arquivado em 07/10/2026), **restauração testada** | Backup restaurado em staging com sucesso, documentado | 🟡 Backup por deploy pronto, com retenção de 30 dias. Falta a restauração testada (OOC-50, Todo, 11/11), que espera o OK do dono para restaurar num branch descartável do Neon em vez do staging (staging não recebe dado real). *O "Pronto quando" (restaurar em staging) contradiz `CLAUDE.md` §6/§7 — reescrever só com confirmação.* |
| 56 | **Segurança final** | Headers, CSP, revisão de autorização por rota, scrubbing de PII no Sentry e PostHog, retenção de imagens | Checklist da seção 8 do `CLAUDE.md` inteiro verde | 🟡 Headers prontos no app (CSP com nonce, HSTS, X-Frame-Options, Referrer-Policy em `middleware.ts`) e na landing (`vercel.json`). Retenção só da imagem processada já vale. Sentry e PostHog não estão instalados em nenhum app: sem ticket para o Sentry; PostHog só na landing (OOC-47). Falta a revisão final de autorização por rota contra o §8 |
| 57 | **Teste de carga** | k6 com relatório de p50/p95/p99 e ponto de saturação | Relatório gerado — é entregável do contrato | ⬜ A base de carga existe (`seed:load --profile=peak`, OOC-48: 20.000 matrículas em ~25 s local); faltam o k6 e o relatório (OOC-49, Backlog, sem prazo) |
| 58 | **Capacitação e docs** | Manual do backoffice em espanhol, 2 sessões gravadas | Manual entregue; sessões gravadas e enviadas | ⬜ |
| 59 | **Go-live** | Migração real, cutover do DNS, monitoramento, aquecimento de domínio | Primeira matrícula real aprovada de ponta a ponta | ⬜ Cutover do DNS na OOC-44 (Backlog, sem prazo; o texto do ticket ainda fala do corte de nameservers, já feito na OOC-7). Migração real, monitoramento (depende do Sentry, 56) e aquecimento de domínio sem ticket |

> **Marco:** aceitação final. Libera os 15% restantes.

---

## Trabalho no Linear fora das sessões do contrato

Escopo que nasceu das decisões de negócio de setembro e outubro (`CLAUDE.md` §1) e que nenhuma sessão acima cobre. **Decidir com o cliente se entra no contrato ou se é ordem de mudança (cláusula 9)** antes de construir.

| Tema | Tickets | Decisão de origem |
| --- | --- | --- |
| Modalidade mensual do inglês e adiantar módulos | OOC-86 | 02/09 e 06/09/2026 |
| Equipe: eliminar perfil com o e-mail digitado; convite enviado por e-mail | OOC-136, OOC-138 — feitos 04/11/2026 | 04/11/2026 |
| *Nueva aula*: passo Docente some ao abrir mais de uma turma | OOC-137 — feito 04/11/2026 | 04/11/2026 |
| Procedimentos pagos além da matrícula (constancia, congelamento, troca de turma) | OOC-83 (constancia paga — feito 04/11/2026), OOC-84 (trocar de turma, congelar, retirar), OOC-105 (transferir a matrícula para outro aluno) | 02/09/2026 |
| Progressão de módulo em lote e curso com módulos | OOC-85, OOC-94 (cada curso guarda um link de material — Drive ou Docs — por módulo, exigido ao criar e ao mexer nos módulos; curso antigo aparece "Sin material" e segue editável — feito; mostrar o link ao docente é a OOC-100, feita: a turma guarda o módulo que dá), OOC-97 (feita), OOC-149 (revisar os módulos, sem descrição) | 02/09/2026 |
| Exame de clasificación | sem ticket | 02/09/2026 |
| Novos cargos e tela de permissões | OOC-57, OOC-95, OOC-96 | 07/09/2026 |
| Portal do docente (materiais, calendário, convite) | OOC-98 (Classroom da turma, feita; um link por módulo é a OOC-144; os critérios "link obrigatório ao atribuir" e "turma ativa após atribuir" esperam o dono), OOC-99 (calendário, no sprint, 11/11), OOC-100 (material do módulo — feito 28/10/2026), OOC-101 (portal sem cursos ativos — feito 24/10/2026), OOC-103 (convite e onboarding; o convite por e-mail já existe desde a OOC-138, falta o onboarding, que contradiz a ficha só de leitura da OOC-79) | — |
| Consentimento do apoderado para aluno cadastrado pelo backoffice | OOC-72 | 21/09/2026 |
| Livro de reclamações | OOC-58, OOC-63 | — |
| Templates de e-mail editáveis pelo backoffice | OOC-60 (Backlog; reverte a decisão de template versionado no repositório — esperar o dono; se entrar, sobre `packages/templates`) | — |
| Índice único de documento e consolidação de duplicatas | sem ticket | 21/09/2026 |
| Separar Alunos, Matrículas e Pagos: cada lista abre no que está aberto | OOC-112 (decisão do pagamento em coluna e índices das listas abertas — feito), OOC-113 (feito), OOC-114 (Pagos abre em Abertos — feito), OOC-115 (Matrículas abre em Vigentes — feito), OOC-116 (Alunos abre em Ativos; ativo = matrícula vigente — feito), OOC-118 (roteiro de aceite da v1, da landing ao backoffice — validado ao longo da semana, fechado 15/10/2026) | 12/10/2026 |
| Telas de entrada no modelo de banda (exemplar pedido pelo cliente) | OOC-127 (aluno, backoffice e docente: banda de marca com balão de boas-vindas no topo, formulário centralizado embaixo, no lugar do split — no ar desde 26/10/2026, Done no Linear) | 16/10/2026 |
| Ajustes do formulário Nuevo curso (feedback do cliente) | OOC-106 (idioma em campo de texto, sem datalist — feito), OOC-107 (sem "Sobre el curso"; o portal esconde o bloco quando está vazio — feito) | 05/10/2026 |
| Checkout pequeno no monitor grande (feedback do cliente) | OOC-125 (acima de 1180px de janela o checkout cresce na régua da landing, até 1,5× — feito 26/10/2026) | 16/10/2026 |
| Curso que não salvava e painel lateral do curso (feedback do cliente) | OOC-126 (o Guardar das opções travava sem aviso em curso anterior à OOC-36, que tem nível vazio — agora só bloqueia o campo obrigatório que a pessoa apagou, com aviso embaixo dele; os dois painéis laterais viraram a página do curso, `/backoffice/courses/[id]`, com planos e configuração lado a lado — feito 26/10/2026) | 25/10/2026 |
| Idioma duplicado por grafia e tirar curso do catálogo (feedback do cliente) | OOC-128 (idioma virou cadastro — tabela `languages`, aba Idiomas em Académico, curso e docente escolhem da lista; migrations `0041` unifica as grafias e `0042` cria os idiomas e liga cursos e docentes, fase *expand* com o texto espelhado; página do curso em abas — Planes · Historial de precios · Configuración — com *Sacar del catálogo* / *Volver al catálogo*, nunca delete físico — feito 28/10/2026) | 28/10/2026 |
| Nova turma passo a passo (feedback do cliente, 01/11/2026) | OOC-129 (cadastro de turma em 5 passos — Curso · Horário · Datas · Docente · Revisão —, no stepper de *Nuevo envío*; docente e Classroom seguem opcionais, a edição continua num card só, API intocada — feito). O mesmo feedback pedia o docente como não obrigatório: já era, desde a OOC-80; a fila das turmas sem docente é a OOC-97 (aba *Pendientes* em Académico, todos os períodos, com contador; "vagas fechadas" = em andamento, lotada ou janela encerrada, com aluno e sem docente — proposta a confirmar com o Herick — feito 01/11/2026), OOC-142 (*+ Nuevo período* no primeiro passo derrubava a tela: a Revisão formatava as datas do período novo ainda vazias — corrigido 06/11/2026) | 01/11/2026 |
| Hotfixes de cadastro de turma e curso (feedback do cliente, 04/11/2026) | OOC-130 (turma de curso completo: coluna `class_groups.full_course`, docente vê o material de todos os módulos), OOC-131 (período de matrícula deixa de cortar), OOC-132 (quantidade de turmas e vagas gerais ou por turma, no passo a passo), OOC-133 e OOC-134 (ajuda (?) no período e na configuração de curso, no lugar do texto fixo), OOC-135 (stepper com mais retorno visual, e aviso em destaque de que o docente é opcional) — feitos 04/11/2026 | 04/11/2026 |
| Checkout: turmas no mesmo horário viram uma opção, sem docente (feedback do cliente, 06/11/2026) | OOC-140 (um cartão por horário com as vagas somadas; a vaga enche as turmas em ordem de código e passa à irmã se o servidor disser que lotou; linha "Docente:" removida do checkout — feito 06/11/2026), OOC-145 (aplicar a fila da matrícula à turma, sem descrição) | 06/11/2026 |
| Envio de documentos genérico: bucket único, arquivo pelo id, tabela de metadados | OOC-143 (tabela `documents`, rotas genéricas por dono, limpeza dos envios não confirmados; seção Arquivos do aluno real na ficha e no portal — papéis e "aluno não remove" são proposta a confirmar — feito 07/11/2026). Migrar comprovante (OOC-19) e contrato (OOC-81) para a tabela é ticket separado; juntar emitidos e anexos com rótulo e refazer a tela do aluno é a OOC-148 | 07/11/2026 |
| Apoderado com vários filhos numa conta e compra de vários cursos de uma vez | OOC-147 (avaliação; o portal hoje é uma conta por aluno, com o e-mail do Gmail do próprio aluno) | 07/11/2026 |
| Tirar o mock do backoffice | OOC-66, OOC-41 (parâmetros reais em `platform_settings`, lidos por todo consumidor — feito 22/10/2026), OOC-70 (telas para as rotas de catálogo que já existiam: editar curso, aposentar plano, editar/aposentar período, com a contagem de matrículas de pé antes de confirmar — feito 24/10/2026), OOC-92, OOC-69 (bitácora de cargo em Equipe — feito 16/10/2026), OOC-68 (convite de docente sem o seletor mock — feito), OOC-67 (home e badge de Pagos — feito), OOC-71 (matriculados da turma na visão da coordenação, `GET /catalog/class-groups/:id/roster`, colunas por cargo — feito 15/10/2026; base para roster do docente, notas e lote de certificados) | — |

---

## Se atrasar

Ordem de corte, da primeira à última coisa a sacrificar:

1. Notas e frequência (Sessões 37, 44) → pós-lançamento
2. Tablero de impacto (52)
3. Push (51)
4. Conciliação bancária (38) → pós-lançamento, mas **antes da segunda temporada**

**Nunca cortar:** Fase 0, OCR e antifraude (26–29), autorização (8), backup restaurado (55).

---

## Fora do roadmap

Se aparecer, é ordem de mudança conforme a cláusula 9 do contrato — não entra em sessão:

pasarela de pago · WhatsApp · app nativo · hospedagem de vídeo · desconto · parcelamento · aula virtual própria · faturamento eletrônico
