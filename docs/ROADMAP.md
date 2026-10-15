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

## Resumo (revisado em 14/10/2026)

| Fase | ✅ | 🟡 | ⬜ | Leitura rápida |
| --- | --- | --- | --- | --- |
| 0 — Espinha dorsal | 10 | 3 | 0 | Faltam as tabelas acadêmicas (notas, frequência, certificado), o seed de comprovantes e o domínio de staging |
| 1 — Site público | 0 | 6 | 0 | Páginas e SEO no ar; faltam píxeis/PostHog, blog, redirects do WordPress e o cutover de DNS |
| 2 — Matrícula + IA | 8 | 4 | 3 | Núcleo construído de ponta a ponta; falta medir a OCR, o nível 2 e a espera no checkout |
| 3 — Backoffice | 2 | 3 | 5 | Alunos, turmas, Pagos, equipe e docentes reais; área do docente, notas, conciliação e relatórios ainda mock |
| 4 — Portal do aluno | 1 | 2 | 2 | Login e telas reais (OOC-32); faltam enlace da aula, módulos/mensalidade, trâmites pagos e documentos |
| 5 — E-mail | 0 | 1 | 3 | Envio real via Brevo pela outbox; telas de e-mail ainda mock |
| 6 — Instalável | 0 | 0 | 4 | — |
| 7 — Lançamento | 0 | 2 | 4 | Backup a cada deploy já roda; restauração nunca testada; Sentry/PostHog não instalados |

---

## FASE 0 — Espinha dorsal · Semanas 1–2

Sem isso, tudo depois fica mais caro. Não pule nem comprima.

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 1 | **Repositório e scaffold** | `git init`, pnpm workspaces, TypeScript strict, `apps/landing` (Astro) e `apps/app` (Next) subindo em branco, `packages/*` criados vazios | `pnpm dev` sobe os dois apps localmente e o repo está no GitHub | ✅ |
| 2 | **Config e ambiente** | Validação de env com zod no boot, `.env.example`, `.gitignore`, zero URL literal | App recusa subir com variável faltando, com mensagem clara | ✅ `apps/api/src/config.ts` |
| 3 | **Banco Postgres local** | Postgres local rodando (Docker — staging/produção usam Neon), CLI de migrations configurado, migration vazia inicial aplicando | `reset` do banco roda do zero e reaplica as migrations | ✅ `compose.yml` + Drizzle Kit |
| 4 | **Migration: modelo acadêmico** | `academic_periods`, `courses`, `plans`, `plan_prices`, `class_groups` com `CHECK (seats_taken <= capacity)` | `db reset` roda limpo; `plan_prices` versionado por vigência | ✅ `0003`; `plan_prices` append-only desde a `0017` |
| 5 | **Migration: pessoas e papéis** | `students`, `guardians`, `consents`, `teachers`, `user_roles`, `pg_trgm` para busca | Busca por nome/DNI/telefone funciona; sem grant de DELETE em `students` | ✅ Pessoas, `pg_trgm` e trava de DELETE (`0011`) prontos; `teachers` (com idiomas, disponibilidade e contratos) desde a `0025`/`0026` (OOC-77). `user_roles` não vai existir: o papel é `user.role` do Better Auth |
| 6 | **Migration: matrícula e pagamento** | `enrollments`, `payments` (idempotency key única, `amount_cents`), `payment_receipts`, `waitlist_entries` | Máquina de estados documentada; tentar inserir pagamento duplicado falha no banco | ✅ Máquina de estados em `apps/api/CLAUDE.md`. O índice de `image_phash` virou comum (`0016`, OOC-22). Decisão em coluna própria (`decided_at`/`decided_by`/`rejection_reason`) desde a `0027` (OOC-112) |
| 7 | **Migration: operação** | `outbox`, `campaigns`, `audit_log` (append-only), `attendance`, `grades`, `materials`, `certificates` | `audit_log` sem grant de UPDATE/DELETE nem para admin | 🟡 `outbox` (`0013`) e `audit_log` com trava (`0007`/`0011`) prontos. Faltam `campaigns`, `attendance`, `grades`, `materials`, `certificates` — entram com as sessões 37, 45 e 48 |
| 8 | **Autorização deny-by-default + suíte de teste** | Middleware deny-by-default em `apps/api`, toda rota/usecase declara o papel exigido | Teste enumera rotas e falha se faltar declaração; teste com papel errado falha | ✅ Rota sem `.roles()`/`.owners()`/`.public()` derruba o **boot** (`infra/plugins/authorization.ts`) |
| 9 | **Seed** | Script com dado fictício: 500 alunos, 3 períodos, ~40 turmas em vários idiomas, 200 comprovantes | Idempotente, com comando de reset. Zero dado real | 🟡 `seed:students`, `seed:enrollments`, `seed:catalog` e `seed-admin`, idempotentes, com `--confirm-host` e `--undo`. Falta o seed de comprovantes e o de carga (OOC-48) |
| 10 | **Fila e outbox** | BullMQ (Redis self-hospedado no Fly.io) via `packages/queue`, worker em `apps/api` com retry/backoff/DLQ, adapter de notificação | Job falho vai para DLQ e não trava a fila. **Guarda de e-mail ativa: fora de produção só allowlist** | ✅ OOC-26. Job esgotado fica no conjunto `failed` por 7 dias; `AllowlistGuard` na frente do Brevo |
| 11 | **i18n** | Mensagens trilíngues com lint `no-literal-string` nos diretórios de UI | Build quebra ao introduzir string crua | ✅ OOC-14. Sem `packages/i18n`: cada app tem as próprias mensagens (`CLAUDE.md` §3) |
| 12 | **CI — portões** | gitleaks, varredura do build do Next.js por credencial de banco, `tsc`, ESLint, teste de autorização, migrations em banco limpo, validação de env | PR com segredo ou rota sem papel declarado é bloqueado | ✅ Nove portões (`CLAUDE.md` §6), incluindo a trava de privilégio e os repositórios contra o banco |
| 13 | **Ambientes** | Neon de staging, `apps/api` no Fly.io, Vercel (landing + app) com env por projeto, branch protection na `main` | Staging publica em `staging.aula.onlyonecoin.edu.pe`; PR gera preview | 🟡 Deploy automático em `main` para os três apps, backup → migration → deploy, blue-green no Fly. Falta o domínio de staging, que depende do cutover de DNS (OOC-44) |

> **Marco:** protótipo navegável aprovado pelo cliente. Fecha a Fase 0 do contrato.

---

## FASE 1 — Site público · Semanas 3–4

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 14 | **Design system** | Tokens, tipografia, componentes base do Astro, identidade da associação modernizada | Página de referência mostrando todos os componentes | 🟡 Tokens e layout prontos (`apps/landing/CLAUDE.md`); a página de referência não existe |
| 15 | **Home e Nosotros** | Duas páginas com conteúdo real, seção de testemunhos, contador de impacto | Lighthouse mobile ≥ 90 em performance | 🟡 Páginas no ar nos três idiomas; Lighthouse não medido |
| 16 | **Cursos e Talleres** | Listagem lendo do banco (cursos e turmas abertas), com filtro | Turma fechada ou fora da janela não aparece | 🟡 `/courses` e `/courses/[slug]` existem, mas leem conteúdo estático, não o catálogo da API — o descasamento está em OOC-108 |
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
| 22 | **Seleção de turma** | Lista só turmas abertas com vaga, mostra horário e data de início, oferece lista de espera quando cheia | Turma cheia não dá erro: oferece espera | 🟡 Data e horário separados, turma cheia desabilitada. A lista de espera existe só no backoffice (OOC-35); o checkout ainda não oferece |
| 23 | **Upload de comprovante** | Signed URL direto ao Storage, magic bytes, teto de tamanho, normalização (downscale, cinza, strip EXIF, HEIC) | Arquivo nunca passa pela função; HEIC de iPhone convertido | ✅ OOC-19 |
| 24 | **Submit e reserva de vaga** | Transação curta, incremento atômico de vaga, idempotency key, enfileiramento | p95 < 300ms; duas requisições simultâneas na última vaga → só uma entra | 🟡 Tudo construído, incluindo o hold de 15 min e a origem do canal (OOC-25). Falta medir o p95, que entra no teste de carga (57) |
| 25 | **Proteção da rota pública** | Turnstile, rate limit em `apps/api` sobre o Redis da fila, cache de idempotência | Rota resiste a rajada de requisições sem tocar o banco | ✅ OOC-24 |
| 26 | **OCR nível 1** | Worker chamando Gemini 3.1 Flash-Lite via OpenRouter com JSON schema, 5 campos, confiança por campo, `tier`/`model`/`version` | 20 comprovantes reais de amostra extraídos e conferidos à mão | 🟡 Worker no ar (OOC-20). Falta a medição na amostra real (`docs/OCR-AVALIACAO.md`, histórico vazio) |
| 27 | **Semáforo e validação** | Comparação contra `plan_prices` vigente, tolerância configurável, três estados | Casos de teste: exato, centavos a menos, a mais, muito abaixo | ✅ OOC-21. Só valida, nunca aprova (decisão de 03/10/2026) |
| 28 | **Antifraude** | pHash, bloqueio por número de operação, EXIF, cruzamento de titular | Mesmo comprovante recortado e reenviado é barrado | ✅ OOC-22. Quem barra é o nº de operação; pHash só registra. Regra em `apps/api/CLAUDE.md` |
| 29 | **OCR nível 2** | Escalada para modelo de outra família em baixa confiança, critério de concordância, alarme de volume | Divergência entre modelos vai para fila humana; escalada nunca encadeia | ⬜ O modelo já se configura (`RECEIPT_OCR_TIER2_MODEL`), mas nada escala. Depende da medição da 26 |
| 30 | **E-mails da matrícula** | Templates de matrícula recebida, pago aprovado/em revisão/rejeitado, credenciais — via outbox | Todos trilíngues, disparados pela fila, nenhum no caminho síncrono | ✅ OOC-26 e OOC-28 (acesso ao portal por link de definir senha) |
| 20a | **Porta de entrada na landing** | URL do app por env, CTA "Matricúlate" nos três idiomas, link do vendedor (`?course=&group=&src=whatsapp`) | Nenhuma URL literal; o CTA leva ao passo 1 e o link do vendedor ao passo 2 | ✅ CTAs relativos, com 302 do `vercel.json`. Desde a OOC-117 o botão de curso manda a chave da página (`?course=english`), ligada ao curso no backoffice — o mapa de ids nunca casou com o catálogo. Pendente: ligar os cursos de produção e decidir o que a página de curso sem turma aberta mostra |
| 21a | **Nome do aluno no domínio** | `students.full_name` numa coluna só; `firstName`/`lastName` vira derivado ou some | Backoffice, portal e checkout leem o mesmo campo | ⬜ O banco ainda tem `first_name`/`last_name` |
| 27a | **PayPal para aluno no exterior** | Confirmar com o cliente; se sim, estender `PaymentMethod` e conversão como preço versionado | Aluno no exterior conclui a matrícula sem passar pelo WhatsApp | ⬜ Hoje `other` + texto livre registra o meio, sem conversão. Aguarda o cliente |
| 30a | **E-mail do aluno verificado** | Confirmar que o Gmail informado existe e é do aluno | — | 🟡 Em andamento (OOC-65) |

> **Marco:** aprovação da Fase 2. Libera 30% do pagamento.

---

## FASE 3 — Backoffice · Semanas 8–10

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 31 | **Shell e autenticação** | Login, papéis, MFA para `admin`/`billing`, navegação, anti-enumeração | Docente logado não acessa rota de tesouraria, nem pela URL | ✅ Login, convite, recuperação (OOC-30) e troca de senha (OOC-31) reais. MFA por código de e-mail (OOC-29, 14/10/2026): obrigatório para `master`/`admin`/`billing` — a API recusa esses cargos em toda rota até ativarem — e opcional para o resto, com códigos de recuperação. App autenticador fica para depois |
| 32 | **Bandeja de comprovantes** | Fila ordenada por confiança, comparação imagem × extração, aprovar/rejeitar, atalhos de teclado, reprocessar | 25 revisões seguidas sem usar o mouse | 🟡 Fila real em Pagos (OOC-55): imagem por URL assinada, leitura da IA, veredito do semáforo, aprovar/rejeitar. O livro abre em Abertos, com abas Abertos · Resolvidos · Todos e contador do servidor (OOC-114). Faltam ordenação por confiança, atalhos e reprocessar |
| 33 | **Aprovação em massa** | Seleção dos casos verdes, ação em lote, confirmação de vaga, disparo de credenciais | Aprovar 100 pagamentos em uma ação, com auditoria de cada um | ⬜ Sem ticket. Se entrar, o lote continua sendo escolha de uma pessoa (decisão de 03/10/2026) |
| 34 | **Gestão de alunos** | Ficha única, busca `pg_trgm`, filtros, edição, suspensão, exportação | Busca por nome parcial e por DNI em < 300ms com 30k alunos no seed | 🟡 Em review: busca e filtros no servidor (OOC-76), matrículas na ficha (OOC-73), edição (OOC-74), aba Atividade (OOC-75), abas Ativos · Ex-alunos · Sem matrícula com ativo = matrícula vigente (OOC-116). Faltam suspensão, exportação e a medição com 30k |
| 35 | **Turmas e períodos** | CRUD de turmas, janela de inscrição, cupos, lista de espera, **duplicar período anterior** | Duplicar cria ~40 turmas zerando datas e vagas | ✅ OOC-35/OOC-36. Ajustes em OOC-70, OOC-93 e OOC-104 |
| 36 | **Docentes** | Perfis, atribuição de turmas, acesso checado no usecase (`teacher_id` do usuário autenticado) | Docente vê exatamente as próprias turmas, comprovado por teste | 🟡 OOC-77 (tabelas, trava, entidade), OOC-78 (CRUD na API; diretório, cadastro, ficha, disponibilidade e saída do quadro reais) e OOC-80 (turma aponta para o docente do cadastro; turmas sem vínculo destacadas) feitos. Faltam OOC-79, 81 e 82 |
| 37 | **Frequência e notas** | Registro por sessão, interface para celular do docente, tolerante a conexão ruim | Funciona em 3G lento; perda de conexão não perde o registro | ⬜ OOC-38, OOC-102 |
| 38 | **Conciliação bancária** | Upload de extrato CSV, casamento por número de operação, relatório de divergência | Extrato de 500 linhas casado, com os não conciliados listados | ⬜ OOC-39 |
| 39 | **Relatórios e tablero** | Matrículas por período/curso/região, ingressos, retenção, impacto social, materialized views noturnas | Relatório carrega em < 2s; agregação não é ao vivo | ⬜ Tela mock (OOC-40). Home do painel com dado real (OOC-67), agregada ao vivo — exceção decidida pelo dono em 11/10/2026: os relatórios desta sessão seguem em view noturna, a home não ("matrículas de hoje" numa view noturna seria sempre zero) |
| 40 | **Auditoria** | Tela de bitácora, filtros, exportação | Tentativa de alterar ou apagar registro falha no banco | 🟡 A trava no banco existe (`0011`), e há bitácora de cargo e a aba Atividade do aluno. Falta a tela geral com filtro e exportação |

---

## FASE 4 — Portal do Aluno · Semanas 11–12

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 41 | **Acesso do aluno** | Login com credencial recebida por e-mail, recuperação de senha, política de senha, rate limit, anti-enumeração | Aluno só vê os próprios dados, comprovado por teste de autorização | ✅ OOC-28: conta criada na aprovação, login por e-mail ou documento, link de 1 h |
| 42 | **Painel do aluno** | Cursos, horário, data de início, enlace à aula, estado de matrícula e pagamento | Constancia visível na tela, sem depender do e-mail | 🟡 OOC-32: cursos, horário, data de início, próxima aula, estado de matrícula e pagamento leem `GET /portal/overview`. Faltam o enlace da aula (OOC-98), módulos/cadeado (OOC-94/OOC-85), mensalidade (OOC-86) e a constancia (OOC-33/OOC-83) |
| 43 | **Materiais e reenvio** | Materiais e links de gravação, carga de novo comprovante pelo portal | Nenhum vídeo no Storage — só link externo | ⬜ O aluno já reabre o comprovante enviado (URL de 5 min, OOC-32); materiais e reenvio pelo portal ainda não — OOC-100, OOC-62 |
| 44 | **Notas, frequência e perfil** | Visualização de notas e avanço, perfil editável, dados do apoderado | — | 🟡 Perfil e apoderado reais, só leitura (OOC-32); o aluno editar o próprio contato é o OOC-110; notas e avanço dependem da 37 |
| 45 | **Certificados** | Constancia e certificado em PDF, código de verificação, página pública de validação | Página pública valida sem expor dado pessoal além do nome e curso | ⬜ OOC-33, OOC-59 |

> **Marco:** aprovação das Fases 3 e 4. Libera 25% do pagamento.

---

## FASE 5 — Módulo de e-mail · Semana 13

| # | Sessão | Entregável | Pronto quando | Estado |
| --- | --- | --- | --- | --- |
| 46 | **Brevo real e DNS** | Provider de produção, subdomínios `avisos.` e `noticias.` com DKIM, SPF, DMARC `p=none`, webhook de bounce/unsubscribe | E-mail entregando; bounce sincronizando de volta ao banco | 🟡 Provider Brevo real atrás da outbox, domínio raiz autenticado (DKIM + DMARC `p=none`). Faltam os subdomínios `avisos.`/`noticias.` e o webhook (OOC-91) |
| 47 | **Tela A — fluxos automáticos** | Catálogo dos transacionais, preview do template do repositório, toggle, métricas de 30 dias, botão de prova | Preview mostra o template versionado, não o do painel do Brevo | ⬜ Tela mock. OOC-87, OOC-88, OOC-90 |
| 48 | **Tela B — campanhas** | Assistente de 4 passos, segmentos calculados no Postgres, contagem real, consentimento e opt-out | Segmento nunca fica armazenado no Brevo | ⬜ Tela mock (OOC-42) |
| 49 | **Aprovação e prova** | Prova para até 5 endereços com prefixo `[PRUEBA]`, trava por hash do conteúdo, dupla aprovação, cooldown de 7 dias, log imutável | Editar o conteúdo após a prova fecha a trava de novo | ⬜ OOC-89 |

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
| 54 | **Importador da base** | Import com **dry-run**, relatório de erro linha por linha, deduplicação | Planilha real do cliente importada em dry-run com relatório revisado | ⬜ Sem ticket. Junto vai a consolidação das fichas duplicadas antes do índice único de documento (`CLAUDE.md` §1) |
| 55 | **Backup e restauração** | `pg_dump` para Tigris a cada deploy da API, antes da migration (o agendado foi arquivado em 07/10/2026), **restauração testada** | Backup restaurado em staging com sucesso, documentado | 🟡 Backup por deploy pronto, com retenção de 30 dias. Falta a restauração testada (OOC-50) |
| 56 | **Segurança final** | Headers, CSP, revisão de autorização por rota, scrubbing de PII no Sentry e PostHog, retenção de imagens | Checklist da seção 8 do `CLAUDE.md` inteiro verde | 🟡 Retenção só da imagem processada já vale. Sentry e PostHog não estão instalados em nenhum app |
| 57 | **Teste de carga** | k6 com relatório de p50/p95/p99 e ponto de saturação | Relatório gerado — é entregável do contrato | ⬜ OOC-48, OOC-49 |
| 58 | **Capacitação e docs** | Manual do backoffice em espanhol, 2 sessões gravadas | Manual entregue; sessões gravadas e enviadas | ⬜ |
| 59 | **Go-live** | Migração real, cutover do DNS, monitoramento, aquecimento de domínio | Primeira matrícula real aprovada de ponta a ponta | ⬜ OOC-44 |

> **Marco:** aceitação final. Libera os 15% restantes.

---

## Trabalho no Linear fora das sessões do contrato

Escopo que nasceu das decisões de negócio de setembro e outubro (`CLAUDE.md` §1) e que nenhuma sessão acima cobre. **Decidir com o cliente se entra no contrato ou se é ordem de mudança (cláusula 9)** antes de construir.

| Tema | Tickets | Decisão de origem |
| --- | --- | --- |
| Modalidade mensual do inglês e adiantar módulos | OOC-86 | 02/09 e 06/09/2026 |
| Procedimentos pagos além da matrícula (constancia, congelamento, troca de turma) | OOC-83, OOC-84, OOC-105 | 02/09/2026 |
| Progressão de módulo em lote e curso com módulos | OOC-85, OOC-94, OOC-97 | 02/09/2026 |
| Exame de clasificación | sem ticket | 02/09/2026 |
| Novos cargos e tela de permissões | OOC-57, OOC-95, OOC-96 | 07/09/2026 |
| Portal do docente (materiais, calendário, convite) | OOC-98 a OOC-101, OOC-103 | — |
| Consentimento do apoderado para aluno cadastrado pelo backoffice | OOC-72 | 21/09/2026 |
| Livro de reclamações | OOC-58, OOC-63 | — |
| Índice único de documento e consolidação de duplicatas | sem ticket | 21/09/2026 |
| Separar Alunos, Matrículas e Pagos: cada lista abre no que está aberto | OOC-112 (decisão do pagamento em coluna e índices das listas abertas — feito), OOC-113, OOC-114 (Pagos abre em Abertos — feito), OOC-115 (Matrículas abre em Vigentes — feito), OOC-116 (Alunos abre em Ativos; ativo = matrícula vigente — feito), OOC-118 | 12/10/2026 |
| Tirar o mock do backoffice | OOC-66, OOC-41, OOC-92, OOC-68 (convite de docente sem o seletor mock — feito), OOC-67 (home e badge de Pagos — feito), OOC-71 (matriculados da turma na visão da coordenação, `GET /catalog/class-groups/:id/roster`, colunas por cargo — feito 15/10/2026; base para roster do docente, notas e lote de certificados) | — |

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
