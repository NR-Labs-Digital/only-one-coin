# ROADMAP — Only One Coin · Plataforma Académica Digital

Plano de desenvolvimento em **sessões pequenas**. Uma sessão = um objetivo = um PR.

## Como usar

1. **Uma sessão por vez.** Não comece a próxima sem a anterior mesclada e verde no CI.
2. **Uma sessão = um PR.** Se o PR passar de ~400 linhas de código de verdade, a sessão estava grande demais — quebre.
3. **Só avance quando o critério de pronto estiver cumprido.** "Quase funcionando" não conta.
4. Marque o checkbox aqui quando fechar. Este arquivo mora em `docs/ROADMAP.md` e é o mapa da obra.
5. Se uma sessão revelar trabalho não previsto, **crie uma sessão nova** em vez de inflar a atual.

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

## FASE 0 — Espinha dorsal · Semanas 1–2

Sem isso, tudo depois fica mais caro. Não pule nem comprima.

| # | Sessão | Entregável | Pronto quando |
| --- | --- | --- | --- |
| ☐ 1 | **Repositório e scaffold** | `git init`, pnpm workspaces, TypeScript strict, `apps/landing` (Astro) e `apps/app` (Next) subindo em branco, `packages/*` criados vazios | `pnpm dev` sobe os dois apps localmente e o repo está no GitHub |
| ☐ 2 | **Config e ambiente** | Validação de env com zod no boot, `.env.example`, `.gitignore`, zero URL literal | App recusa subir com variável faltando, com mensagem clara |
| ☐ 3 | **Banco Postgres local** | Postgres local rodando (Docker — staging/produção usam Neon), CLI de migrations configurado (Postgres puro, Neon não exige CLI própria), migration vazia inicial aplicando | `reset` do banco roda do zero e reaplica as migrations |
| ☐ 4 | **Migration: modelo acadêmico** | `academic_periods`, `courses`, `plans`, `plan_prices`, `class_groups` com `CHECK (seats_taken <= capacity)` | `db reset` roda limpo; `plan_prices` versionado por vigência |
| ☐ 5 | **Migration: pessoas e papéis** | `students`, `guardians`, `consents`, `teachers`, `user_roles`, `pg_trgm` para busca | Busca por nome/DNI/telefone funciona; sem grant de DELETE em `students` |
| ☐ 6 | **Migration: matrícula e pagamento** | `enrollments`, `payments` (idempotency key única, `amount_cents`), `payment_receipts` (índice único por operação e por `image_phash`), `waitlist_entries` | Máquina de estados documentada; tentar inserir pagamento duplicado falha no banco |
| ☐ 7 | **Migration: operação** | `outbox`, `campaigns`, ~~`audit_log`~~ (append-only), `attendance`, `grades`, `materials`, `certificates` — `audit_log` já nasceu adiantado, no wiring real de Equipo (`packages/db/migrations/0007_*.sql`); o resto da sessão segue pendente | `audit_log` sem grant de UPDATE/DELETE nem para admin |
| ☑ 8 | **Autorização deny-by-default + suíte de teste** | Middleware deny-by-default em `apps/api`, toda rota/usecase declara o papel exigido | Teste enumera rotas e falha se faltar declaração de papel; teste tenta acessar com papel errado e falha corretamente — feito: `apps/api/src/infra/plugins/authorization.ts` falha o **boot** da aplicação se alguma rota não declarar `.roles()`/`.owners()`/`.public()`, e `authorization.test.ts` cobre os três casos |
| ☐ 9 | **Seed** | Script com dado fictício: 500 alunos, 3 períodos, ~40 turmas em vários idiomas, 200 comprovantes | Idempotente, com comando de reset. Zero dado real |
| ☐ 10 | **Fila e outbox** | BullMQ (Redis/Upstash) via `packages/queue`, worker rodando em `apps/api` (Fly.io) com retry/backoff/DLQ, adapter de notificação, `providers/brevo.ts` stub | Job falho vai para DLQ e não trava a fila. **Guarda de e-mail ativa: fora de produção só allowlist** |
| ☐ 11 | **i18n** | `packages/i18n` com `es-PE.json`, lint `no-literal-string` nos diretórios de UI | Build quebra ao introduzir string crua |
| ☐ 12 | **CI — 7 portões** | GitHub Actions: gitleaks, varredura do build do Next.js por credencial de banco, `tsc`, ESLint (`no-floating-promises`, `no-literal-string`), teste de autorização, migrations em banco limpo, validação de env | PR com segredo ou rota sem papel declarado é bloqueado |
| ☐ 13 | **Ambientes** | Banco Postgres gerenciado de staging (Neon), `apps/api` publicado no Fly.io, `netlify.toml` com contextos (landing+app), env por contexto, branch protection na `main`, `docs/ENVIRONMENTS.md` | Push na `staging` publica em `staging.aula.onlyonecoin.edu.pe`; PR gera preview |

> **Marco:** protótipo navegável aprovado pelo cliente. Fecha a Fase 0 do contrato.

---

## FASE 1 — Site público · Semanas 3–4

| # | Sessão | Entregável | Pronto quando |
| --- | --- | --- | --- |
| ☐ 14 | **Design system** | Tokens, tipografia, componentes base do Astro, identidade da associação modernizada | Página de referência mostrando todos os componentes |
| ☐ 15 | **Home e Nosotros** | Duas páginas com conteúdo real, seção de testemunhos, contador de impacto | Lighthouse mobile ≥ 90 em performance |
| ☐ 16 | **Cursos e Talleres** | Listagem lendo do banco (cursos e turmas abertas), com filtro | Turma fechada ou fora da janela não aparece |
| ☐ 17 | **Blog, Contacto, FAQ** | Três páginas, migração dos últimos 20 artigos | Artigos migrados com URLs preservadas ou redirecionadas |
| ☐ 18 | **SEO e medição** | Metadados, sitemap, dados estruturados, píxeis Meta/TikTok, PostHog | Sitemap válido; funil de matrícula visível no PostHog |
| ☐ 19 | **Publicação** | Domínio apontado, SSL, redirects do WordPress antigo | Site em produção; nenhuma URL antiga em 404 |

> **Marco:** aprovação da Fase 1. Libera 30% do pagamento junto com a Fase 2.

---

## FASE 2 — Matrícula + IA · Semanas 5–7

**Fase de maior risco. Não comprima.** Se houver atraso no projeto, corte notas e frequência — nunca esta.

| # | Sessão | Entregável | Pronto quando |
| --- | --- | --- | --- |
| ☐ 20 | **Formulário — estrutura** | Wizard multi-passo, validação com zod no cliente e no servidor, estado preservado entre passos | Recarregar a página no meio não perde o preenchimento |
| ☐ 21 | **Formulário — dados e menores** | Campos de aluno, apoderado, validação de idade mínima por curso, registro de consentimento com versão e IP | Curso com `min_age` recusa idade menor; consentimento gravado com timestamp |
| ☐ 22 | **Seleção de turma** | Lista só turmas abertas com vaga, mostra horário e data de início, oferece lista de espera quando cheia | Turma cheia não dá erro: oferece espera |
| ☐ 23 | **Upload de comprovante** | Signed URL direto ao Storage, validação por magic bytes, teto de tamanho, normalização (downscale, cinza, strip EXIF, HEIC) | Arquivo nunca passa pela função; HEIC de iPhone convertido |
| ☐ 24 | **Submit e reserva de vaga** | Transação curta, incremento atômico de vaga, idempotency key, enfileiramento | p95 < 300ms; duas requisições simultâneas na última vaga → só uma entra |
| ☐ 25 | **Proteção da rota pública** | Turnstile, rate limit na borda com Upstash, cache de idempotência | Rota resiste a rajada de requisições sem tocar o banco |
| ☐ 26 | **OCR nível 1** | Worker chamando Gemini 3.1 Flash-Lite com JSON schema, extração dos 5 campos, confiança por campo, registro de `tier`/`model`/`version` | 20 comprovantes reais de amostra extraídos e conferidos à mão |
| ☐ 27 | **Semáforo e validação** | Comparação contra `plan_prices` vigente, faixa de tolerância configurável, três estados | Casos de teste: exato, centavos a menos, a mais, muito abaixo |
| ☐ 28 | **Antifraude** | pHash, bloqueio por número de operação, checagem de EXIF, cruzamento de titular | Mesmo comprovante recortado e reenviado é barrado |
| ☐ 29 | **OCR nível 2** | Escalada para modelo de outra família em baixa confiança, critério de concordância, alarme de volume | Divergência entre modelos vai para fila humana; escalada nunca encadeia |
| ☐ 30 | **E-mails da matrícula** | Templates de matrícula recebida, pago aprovado/em revisão/rejeitado, credenciais — via outbox | Todos em `es-PE.json`, disparados pela fila, nenhum no caminho síncrono |

#### Estado das Sessões 20–25 (atualizado em 21/08/2026; servidor auditado em 22/09/2026)

O **front inteiro** do checkout público existe e está navegável em
`/enrollment` (`apps/app`), desenhado em `docs/MATRICULA-CHECKOUT.md`. As
peças da Fase 0 que bloqueavam a metade de servidor (autorização
deny-by-default da Sessão 8, `apps/api` publicado da Sessão 13) já existem, e
uma fatia real do servidor foi construída junto do checkout público
(`SubmitPublicEnrollmentRoute`, `apps/api`): validação server-side, registro
de consentimento com timestamp/IP, e o núcleo de concorrência da Sessão 24
(incremento atômico de vaga + idempotency key, com reforço no banco). Ainda
não fecha nenhuma sessão porque falta o restante de cada entregável (ver
coluna "Falta" abaixo) — mas a checagem seguinte é sobre isso, não mais sobre
"nada existe no servidor".

| # | Já existe | Falta para fechar |
| --- | --- | --- |
| 20 | Wizard de 4 passos, validação com zod no cliente, estado preservado no `sessionStorage` (recarregar no meio não perde nada), **e a validação no servidor com o mesmo formato** (`SubmitPublicEnrollmentBodySchema`, `apps/api`) | — (fechada nesta auditoria; falta só confirmar p95 < 300ms sob carga, que nenhuma sessão mediu ainda) |
| 21 | Campos reais da planilha do Forms (nome completo em um campo, documento, celular, nascimento, Gmail travado), bloco do apoderado com aceite de consentimento versionado, **e o consentimento já grava timestamp e IP no servidor** (`consents`, via `SubmitPublicEnrollmentRoute`) | Confirmar que a idade mínima por curso é recusada também no **servidor**, não só na trava do cliente — não verificado nesta auditoria |
| 22 | Data de início e horário como escolhas separadas, só turma com vaga selecionável, turma cheia visível e desabilitada | **Lista de espera** quando a data inteira estiver cheia — `waitlist_entries` existe na base, mas nenhuma rota grava nela ainda |
| 23 | Upload com teto de tamanho, tipo aceito, prévia, comprovante **obrigatório** travando o passo | **Signed URL** direto ao Storage, magic bytes, normalização (downscale, cinza, strip EXIF, HEIC) — nada disso existe no servidor ainda |
| 24 | Tela de revisão e envio, guarda de duplo clique, **e o núcleo do servidor: transação curta com incremento atômico de vaga (`UPDATE ... WHERE seats_taken < capacity`) e idempotency key única por pagamento** (`DrizzlePublicEnrollmentRepository`, com índice único no banco) | **Enfileiramento** do job de OCR (o submit hoje só grava e responde, não enfileira nada) e confirmar p95 < 300ms sob carga |
| 25 | — | Turnstile, rate limit na borda, cache de idempotência |

**Decisão nova desta sessão, que muda o desenho da Sessão 24:** a vaga passa a
ter **dois relógios** (`CLAUDE.md` §5) — um *hold de checkout* de 15 minutos,
que prende a vaga antes do pagamento, e a janela de revisão de 5 dias, que já
existia. Os dois são parâmetros do backoffice, não constantes. Motivo: o
pagamento acontece fora da plataforma, e sem o hold curto a pessoa paga e volta
para uma turma cheia — sem fluxo de devolução no negócio.

**Segunda decisão:** toda matrícula grava a **origem do canal**
(`whatsapp`/`web`), resolvida no servidor na chegada. É o que permite responder
dentro do backoffice quanto do ciclo veio do zap — e é o que tornou
desnecessário manter dois formulários diferentes.

> **Marco:** aprovação da Fase 2. Libera 30% do pagamento.

### Sessões novas, abertas por esta sessão

Trabalho que apareceu ao construir o checkout e que não cabia em nenhuma das
sessões acima (regra 5: sessão que revela trabalho não previsto vira sessão
nova, não incha a atual).

| # | Sessão | Entregável | Pronto quando |
| --- | --- | --- | --- |
| ☐ 20a | **Porta de entrada na landing** | Variável de ambiente com a URL do app validada com zod, CTA "Matricúlate" na landing nos três idiomas, apontando pro checkout, e o link do vendedor documentado (`?course=&group=&src=whatsapp`) | Nenhuma URL literal no código; o CTA leva ao passo 1 e o link do vendedor cai no passo 2 |
| ☐ 21a | **Nome do aluno no domínio** | Decidir e migrar: `students.full_name` numa coluna só (como o formulário coleta) e o `firstName`/`lastName` do backoffice vira derivado ou some | Backoffice, portal e checkout leem o mesmo campo; nenhuma tela remonta nome por concatenação |
| ☐ 27a | **PayPal para aluno no exterior** | Confirmar com o cliente se o checkout público atende estrangeiro; se sim, estender `PaymentMethod` e a tabela de conversão como preço versionado, nunca câmbio ao vivo | Aluno no exterior conclui a matrícula sem passar pelo WhatsApp |

---

## FASE 3 — Backoffice · Semanas 8–10

| # | Sessão | Entregável | Pronto quando |
| --- | --- | --- | --- |
| ☐ 31 | **Shell e autenticação** | Login, papéis, MFA para `admin`/`billing`, navegação, anti-enumeração | Docente logado não acessa rota de tesouraria, nem pela URL |
| ☐ 32 | **Bandeja de comprovantes** | Fila ordenada por confiança, painel de comparação imagem × extração, aprovar/rejeitar, atalhos de teclado, botão reprocessar | 25 revisões seguidas sem usar o mouse |
| ☐ 33 | **Aprovação em massa** | Seleção dos casos verdes, ação em lote, confirmação de vaga, disparo de credenciais | Aprovar 100 pagamentos em uma ação, com auditoria de cada um |
| ☐ 34 | **Gestão de alunos** | Ficha única, busca `pg_trgm`, filtros, edição, suspensão, exportação | Busca por nome parcial e por DNI retorna em < 300ms com 30k alunos no seed |
| ☐ 35 | **Turmas e períodos** | CRUD de turmas, janela de inscrição, cupos, lista de espera, **duplicar período anterior** | Duplicar cria ~40 turmas zerando datas e vagas |
| ☐ 36 | **Docentes** | Perfis, atribuição de turmas, acesso restrito checado no usecase (`teacher_id` do usuário autenticado comparado ao dado, nunca filtro de input) | Docente vê exatamente as próprias turmas, comprovado por teste |
| ☐ 37 | **Frequência e notas** | Registro por sessão, interface para celular do docente, tolerante a conexão ruim | Funciona em 3G lento; perda de conexão não perde o registro |
| ☐ 38 | **Conciliação bancária** | Upload de extrato CSV, casamento por número de operação, relatório de divergência | Extrato de 500 linhas casado, com os não conciliados listados |
| ☐ 39 | **Relatórios e tablero** | Matrículas por período/curso/região, ingressos, retenção, impacto social, materialized views noturnas | Relatório carrega em < 2s; agregação não é ao vivo |
| ☐ 40 | **Auditoria** | Tela de bitácora, filtros, exportação | Tentativa de alterar ou apagar registro falha no banco |

#### Estado da Fase 3 (auditado em 22/09/2026)

Nenhuma sessão fecha o próprio critério de pronto ainda — mas três já têm
trabalho real por baixo do mock, o que o quadro de checkboxes sozinho não
mostra:

| # | O que já existe |
| --- | --- |
| 31 | Login, logout, convite e redefinição de senha do backoffice já falam com o Better Auth de verdade; gate de papel na UI (`permissions.ts`) e anti-enumeração no formulário de login. **Falta**: MFA (nenhum plugin `twoFactor` configurado) — login do aluno (`/login`) continua um stub à parte |
| 34 | Listagem, ficha e criação de aluno são reais, com `pg_trgm` funcionando. **Falta**: edição (é stub de frontend, sem usecase de escrita em `apps/api`), suspensão, exportação |
| 40 | Existe uma bitácora real de troca de cargo (lê `audit_log` via `/backoffice/team`), mas não a tela geral de auditoria com filtro/exportação que a sessão descreve |

32, 33, 35, 36, 37, 38 e 39 continuam só UI mock, sem contraparte no
`apps/api` — 32/33 esperam o OCR (Sessão 26, não iniciada); 35/36 esperam
rota de escrita de turma e a tabela `teachers` (nenhuma existe); 37/38/39
esperam suas próprias tabelas (`attendance`, `grades`, conciliação, materialized
views), nenhuma criada ainda.

---

## FASE 4 — Portal do Aluno · Semanas 11–12

| # | Sessão | Entregável | Pronto quando |
| --- | --- | --- | --- |
| ☐ 41 | **Acesso do aluno** | Login com credencial recebida por e-mail (sem auto-cadastro, `CLAUDE.md` §8), recuperação de senha, política de senha, rate limit, anti-enumeração | Aluno só vê os próprios dados, comprovado por teste de autorização |
| ☐ 42 | **Painel do aluno** | Cursos, horário, data de início, enlace à aula, estado de matrícula e pagamento | Constancia visível na tela, sem depender do e-mail |
| ☐ 43 | **Materiais e reenvio** | Materiais e links de gravação, carga de novo comprovante pelo portal | Nenhum vídeo no Storage — só link externo |
| ☐ 44 | **Notas, frequência e perfil** | Visualização de notas e avanço, perfil editável, dados do apoderado | — |
| ☐ 45 | **Certificados** | Constancia e certificado em PDF, código de verificação, página pública de validação | Página pública valida sem expor dado pessoal além do nome e curso |

> **Marco:** aprovação das Fases 3 e 4. Libera 25% do pagamento.

---

## FASE 5 — Módulo de e-mail · Semana 13

| # | Sessão | Entregável | Pronto quando |
| --- | --- | --- | --- |
| ☐ 46 | **Brevo real e DNS** | Provider de produção, subdomínios `avisos.` e `noticias.` com DKIM próprio, SPF, DMARC em `p=none`, webhook de bounce/unsubscribe | E-mail entregando; bounce sincronizando de volta ao banco |
| ☐ 47 | **Tela A — fluxos automáticos** | Catálogo dos transacionais, preview renderizado do template do repositório, toggle, métricas de 30 dias, botão de prova | Preview mostra o template versionado, não o do painel do Brevo |
| ☐ 48 | **Tela B — campanhas** | Assistente de 4 passos, segmentos calculados no Postgres, contagem real, consentimento e opt-out | Segmento nunca fica armazenado no Brevo |
| ☐ 49 | **Aprovação e prova** | Botão enviar prova (até 5 endereços, dados reais de amostra, prefixo `[PRUEBA]`), trava de aprovação por hash do conteúdo, dupla aprovação para base inteira, cooldown de 7 dias, log imutável | Editar o conteúdo após a prova fecha a trava de novo |

---

## FASE 6 — Instalável e tablero · Semana 14

| # | Sessão | Entregável | Pronto quando |
| --- | --- | --- | --- |
| ☐ 50 | **PWA** | Manifest, service worker, instalação no celular, offline básico | Instala em Android e iOS (via adicionar à tela de início) |
| ☐ 51 | **Push** | Notificações push com opt-in, integradas ao outbox | Aviso de turma chega como push e como e-mail, sem duplicar |
| ☐ 52 | **Tablero de impacto** | Painel exportável para doadores e aliados | Exportação em PDF e CSV |
| ☐ 53 | **E-mail de renovação** | Fluxo D-7 de fim de curso com oferta do próximo paquete | Cron dispara na data correta em `America/Lima` |

---

## FASE 7 — Migração, QA e lançamento · Semana 15

| # | Sessão | Entregável | Pronto quando |
| --- | --- | --- | --- |
| ☐ 54 | **Importador da base** | Import com **dry-run**, relatório de erro linha por linha, deduplicação | Planilha real do cliente importada em dry-run com relatório revisado |
| ☐ 55 | **Backup e restauração** | `pg_dump` noturno cifrado para Tigris via Scheduled Function (mesmo storage do comprovante), **restauração testada** | Backup restaurado em staging com sucesso, documentado |
| ☐ 56 | **Segurança final** | Headers, CSP, revisão de autorização por rota, scrubbing de PII no Sentry e PostHog, retenção de imagens | Checklist da seção 8 do `CLAUDE.md` inteiro verde |
| ☐ 57 | **Teste de carga** | k6 com relatório de p50/p95/p99 e ponto de saturação | Relatório gerado — é entregável do contrato |
| ☐ 58 | **Capacitação e docs** | Manual do backoffice em espanhol, 2 sessões gravadas | Manual entregue; sessões gravadas e enviadas |
| ☐ 59 | **Go-live** | Migração real, cutover do DNS, monitoramento, aquecimento de domínio já em curso desde a Fase 1 | Primeira matrícula real aprovada de ponta a ponta |

> **Marco:** aceitação final. Libera os 15% restantes.

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
