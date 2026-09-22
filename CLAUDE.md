# CLAUDE.md — Only One Coin · Plataforma Académica Digital

Contexto permanente do projeto. Lido em toda sessão. Se algo aqui conflitar com um pedido meu, **avise antes de seguir**.

## Mapa de contexto — este arquivo é a raiz, não o total

Este `CLAUDE.md` guarda só o que vale para **mais de um** app/pacote: negócio, stack, i18n, erros proibidos, ambientes e o quadro de segurança/papéis. Cada área tem o próprio `CLAUDE.md`, carregado automaticamente pelo Claude Code quando a sessão trabalha ali dentro (e só ali):

| Arquivo | Cobre |
| --- | --- |
| [`apps/landing/CLAUDE.md`](apps/landing/CLAUDE.md) | O sistema de layout/design-token da landing (`--dp`, as duas larguras de desenho) |
| [`apps/app/CLAUDE.md`](apps/app/CLAUDE.md) | Layout de tela, regras de celular, feature flags, pontos de entrada (portal × backoffice), RBAC na UI |
| [`apps/api/CLAUDE.md`](apps/api/CLAUDE.md) | Pagamento, OCR, upload, vagas/condição de corrida, notificações, autorização deny-by-default, gestão de cargos |
| [`packages/domain/CLAUDE.md`](packages/domain/CLAUDE.md) | A fronteira DDD pura e sua única exceção documentada |
| [`packages/db/CLAUDE.md`](packages/db/CLAUDE.md) | Disciplina de migration e convenções de schema |

**Regra para não duplicar:** se uma instrução vale para mais de uma dessas áreas, ela vive aqui na raiz. Se é específica de uma só, vive só no arquivo dela — nunca copiada em dois lugares (`§10`, Documentação viva).

---

## 1. O projeto

Plataforma académica da **Only One Coin** — marca peruana que oferece cursos de idiomas e oficinas de baixo custo a alunos de todo o Peru.

**Razão social que responde pelo site: `INGLES POR UN SOL S.A.C.` — RUC `20613918028`** (decisão do dono, 04/09/2026). Substituiu a *Asociación Only One Coin Perú* (RUC 20610561463), que **não aparece mais em nenhuma página pública**: rodapé, Términos y condiciones, Política de privacidad e dados estruturados (JSON-LD) nomeiam a S.A.C. A identidade legal vive num lugar só — `org` em `apps/landing/src/i18n/ui.ts` — e chega aos textos pelos tokens `{legalName}` / `{ruc}`. **Em aberto:** a relação entre as duas entidades (qual delas emite certificado, assina contrato de docente e recebe o pagamento) e o **endereço fiscal da S.A.C.** — o site ainda mostra o endereço da Asociación em Chorrillos.

Cinco módulos:

1. **Site público** — reescrito em código, substituindo WordPress
2. **Matrícula + leitura de comprovante por IA** — o núcleo
3. **Portal do Aluno**
4. **Backoffice administrativo**
5. **Módulo de e-mail** — transacional + campanhas

### Fluxo de negócio (não inventar variações)

```
Venda por WhatsApp (humano, fora do sistema)
  → aluno paga por Yape/Plin/transferência
  → aluno acessa /matricula e preenche o formulário
  → sobe foto do comprovante
  → IA extrai os dados e valida contra o preço do plano
  → aprovado: recebe credenciais e e-mail de bem-vindas
  → duvidoso: fila de revisão humana no backoffice
```

### Regras de negócio confirmadas

- **Pagamento único é a regra; inglês é a exceção mensual (decisão 02/09/2026).** Todo curso vende o paquete com pagamento único. Só os cursos de **inglês** (qualquer nível — básico, kids, intermedio/avanzado, Cambridge) têm também a modalidade **mensual**: o aluno escolhe no formulário de matrícula entre *mensual* e *paquete completo*. Mensual **não é parcelamento** do paquete — é compra pré-paga de um módulo por vez. Não existe juros, multa nem cobrança de dívida: quem não paga o módulo seguinte simplesmente **perde o acesso à aula no portal** (ver progressão de módulo, abaixo) e recebe lembrete por e-mail + notificação no portal. O aluno sobe o comprovante mensal sozinho pelo portal (mesma escada de OCR); o backoffice tem visão dos pagamentos mensais pendentes por turma.
- **O aluno pode adiantar módulos seguintes (decisão 06/09/2026).** No portal, a tela de Pagamentos lista os módulos ainda não pagos daquela matrícula mensal: o módulo vigente vem marcado e não se desmarca, e o aluno pode marcar os seguintes para pagar mais de um de uma vez, num comprovante só. A seleção é **um prefixo, nunca escolha livre** — módulo roda em ordem, então pagar o 4 com o 3 em aberto não existe. Adiantar **não vira desconto** (o valor é sempre `n × preço vigente do módulo`) e **não vira dívida**: continua sendo compra antecipada, e quem não adianta nada não deve nada.
- **Sem descontos.** Nunca. O preço vigente do plano é o valor esperado, sempre.
- O aluno compra um **paquete** (ex.: conjunto de módulos) ou o **curso completo**. Nunca aula avulsa.
- **Vários idiomas** (~10) e várias turmas por idioma. Nada específico de idioma no código.
- **Toda aula é online.** 100% virtual, via Google Meet + Classroom, turma sempre grupal e horário fixo durante o módulo (`docs/REGRAS-NEGOCIO.md` §8). Não existe modalidade presencial, e a **sede é escritório administrativo — não faz atendimento presencial** (§9). Nada na plataforma pode oferecer aula presencial, sede de estudo ou endereço de comparecimento ao aluno; texto público que sugira isso é bug de conteúdo.
- Cada **período de venda** tem seus próprios cursos, horários, datas de início e vagas.
- Idade mínima por curso. **Boa parte do público é menor de idade** → consentimento do apoderado é fluxo central.
- Volume: **5.000/mês** em escala normal (9 meses/ano) · **até 20.000/mês** em escala pico / temporada alta (3 meses/ano).
- **Constancia de matrícula é procedimento pago** (S/25) — não é um botão grátis. Entra como **solicitação com pagamento associado**: mesmo fluxo de comprovante + OCR da matrícula, e só vira documento com o pagamento aprovado. Vale para os demais procedimentos da tabela (`docs/REGRAS-NEGOCIO.md` §5).
- **Certificado de finalização é grátis**, em até **25 dias úteis** do término. Exige nota **≥ 14**; DA (não rendeu exame final) não recebe. Inglés Básico exige também o **exame de certificação** solicitado à parte.
- **Emissão de certificado é em lote por turma, com gate humano.** O sistema deixa a lista pronta; a coordenação confirma. Nunca disparo automático por data — quem concluiu é decisão da coordenação. Detalhe em `docs/DOCUMENTOS-E-CERTIFICADOS.md`.
- **Matrícula aberta pelo backoffice é a exceção, não um segundo caminho.** O fluxo acima continua sendo o normal: o aluno preenche `/matricula` e sobe o comprovante. Para a venda que fechou no WhatsApp e nunca chegou ao formulário, `admin` e `enrollment_supervisor` podem abrir a matrícula pelo painel (`/backoffice/enrollments`), sob quatro travas: **(a)** só sobre aluno **já cadastrado** — registrar pessoa é outro fluxo, porque carrega o consentimento do apoderado (§8); **(b)** o preço é o **vigente do plano, somente leitura** — não há desconto, nunca; **(c)** a vaga entra como `reserved`, nunca `confirmed`; **(d)** o pagamento **nunca nasce aprovado** — o comprovante entra na mesma escada de OCR e na mesma fila de revisão (`apps/api/CLAUDE.md`). Quem abre a matrícula não liquida o dinheiro dela. A seção inteira (`/backoffice/enrollments`) é de `admin` e `enrollment_supervisor`: `billing` liquida dinheiro em Pagos e o docente chega aos seus alunos pela turma (`docs/ARCHITECTURE.md` §3).
- **Cadastro manual de aluno pelo backoffice** é o par do item acima: a matrícula manual só age sobre aluno já cadastrado, então o cadastro da pessoa é um fluxo próprio (`/backoffice/students`, `admin` e `enrollment_supervisor`). O **apoderado é opcional** — e deixa de ser no instante em que a data de nascimento diz que o aluno é menor de idade, quando passa a ser obrigatório. O **consentimento (Ley 29733) nunca é digitado ali**: quem aceita é o apoderado, com a data, a versão e o IP dele; a ficha nasce com o consentimento pendente. O cadastro não matricula ninguém.
- **Docente tem contrato com vigência, e o painel vigia o vencimento.** O contrato fica registrado como **arquivo** (nome + data de arquivamento, bytes no bucket como qualquer comprovante) mais o **período que cobre** (início e fim). O painel marca o contrato como *a vencer* a partir de **45 dias** do fim (`CONTRACT_ALERT_DAYS` — número provisório, a confirmar), *vencido* assim que a data passa, e *sem contrato* quando não há nenhum arquivado — esse último é um achado, não uma célula vazia. Arquivo, início e fim são as três coisas juntas ou nenhuma: meio contrato não se arquiva. **Gerar** o contrato a partir do modelo da Asociación é passo à parte, ainda não construído — hoje o painel só arquiva o que foi assinado.
- **Docente sai do quadro, não some.** `inactive` é o que a coordenação marca quando alguém para de dar aula (contrato vencido, ciclo encerrado) — nunca apagar: quem assinou nota e deu turma continua apontado por elas. Sair do quadro **para a vigilância do contrato**: o alerta existe para impedir alguém de dar aula com contrato vencido, e quem está inativo não dá aula. O documento continua arquivado na ficha. O painel avisa quando ainda há turma em andamento apontando para o docente que está saindo — avisa, não bloqueia: quem larga no meio do ciclo é caso real, e travar deixaria a ficha presa.
- **O e-mail do aluno tem que ser uma conta pessoal do Gmail.** Não é preferência: o formulário atual recusa em maiúsculas conta institucional e corporativa, porque o acesso à aula chega por Google Classroom. Endereço de colégio que morre em dezembro é aluno que perde o curso que pagou. Vale para o aluno; o e-mail do apoderado pode ser de qualquer provedor.
- **O celular é pedido no formulário de matrícula.** A regra "nunca pedir número de telefone" (`docs/REGRAS-NEGOCIO.md` §5) governa a **conversa de venda no WhatsApp**, onde o número já é conhecido — não o formulário, que sempre teve coluna `CELULAR`.
- **Data de início e horário são escolhas separadas.** O mesmo curso abre em várias datas — começar esta semana ou com a turma do fim do mês — e cada data tem seus três ou quatro horários. Quem abre turma é `admin`/`enrollment_supervisor` pelo backoffice; o checkout público lê o que estiver aberto.
- Comprovante: retido por **5 anos**. Só a **versão processada/reduzida** (pós downscale/grayscale da OCR, `apps/api/CLAUDE.md`) é retida — não o upload original bruto.
- **Exame de clasificación é o portão do inglés intermedio/avanzado e do Cambridge (decisão 02/09/2026).** Ninguém entra nesses níveis sem aprovar o exame, que é **pago** (valor vigente na tabela de procedimentos, `docs/REGRAS-NEGOCIO.md` §3/§5). Hoje roda em Google Forms com correção manual; na plataforma vira exame online com **resultado calculado automaticamente**. Aprovado → segue pra pagar o nível alto (paquete ou mensual); reprovado → começa do básico. **Em aberto no desenho:** se o exame pode ser feito sem registro prévio (resultado → opção de matricular) ou se exige registro antes — os dois caminhos foram descritos, qual (ou se ambos) fica pra hora de desenhar o fluxo. Validade do resultado também não foi definida.
- **Quem já é aluno não volta pelo site público (decisão 02/09/2026).** Repetir módulo, exame de rezagados (pago), próximo nível e re-matrícula saem do **portal do aluno**, puxando o cadastro existente — nunca duplicando `student`. E-mails de gatilho convidam pro próximo curso/nível. As solicitações pagas do portal seguem o mesmo padrão da constancia: solicitação com pagamento associado, comprovante + OCR + fila de revisão.
- **Um documento, uma pessoa, uma ficha (decisão 21/09/2026).** O par `(national_id_type, national_id)` identifica o aluno — nunca o nome, nunca o e-mail. Até esta data todo caminho que escrevia aluno fazia `INSERT` cego, então o mesmo DNI abria tantas fichas quantas vezes fosse digitado, e cada ficha levava um pedaço do histórico junto (matrícula e pagamento penduram no `student_id` que estava valendo naquele dia). Agora:
  - **O checkout público reaproveita a ficha existente.** Achou o documento, matricula sobre aquela pessoa e **atualiza só o contato** que ela acabou de redigitar (e-mail, celular, país/região/cidade). Nome, documento e data de nascimento ficam intactos — corrigir isso é ato de staff com trilha de auditoria, não efeito colateral de um checkout. Idem para o apoderado: `guardians.student_id` é único, então a ficha do apoderado é atualizada no lugar e o **consentimento novo é anexado** (a tabela `consents` é append — cada aceite é um registro, com versão, data e IP).
  - **O cadastro manual recusa.** Documento já na base → `StudentAlreadyRegisteredError` (422) e a tela manda procurar no diretório. A diferença é intencional: no checkout quem digita é a própria pessoa, então dá pra levá-la de volta à ficha dela; no painel é um terceiro afirmando que uma pessoa nova existe, e um formulário de criar não pode reescrever em silêncio os dados de um estranho por causa de um DNI errado.
  - **Apagar ou invalidar a ficha antiga está fora** — §6 proíbe delete físico em `student`, e invalidar a antiga partiria o histórico entre dois ids que as FKs (`onDelete: restrict`) seguram de pé.
  - **Em aberto:** o índice único em `(national_id_type, national_id)` ainda **não existe**. Vai em duas etapas (§7, expand/contract): primeiro consolidar as duplicatas que já estão na base — `pnpm --filter @ooc/api report:duplicate-students` lista cada documento repetido e quantas matrículas cada cópia carrega —, depois a migration do índice parcial (`where deleted_at is null`). Enquanto ele não existe, a garantia é só de aplicação: duas gravações simultâneas do mesmo documento ainda passam.
- **Congelamento de matrícula (decisão 02/09/2026).** Procedimento pago (tabela §5 da `docs/REGRAS-NEGOCIO.md`), gerido pelo aluno no portal e pela coordenação no backoffice. O aluno volta **só no módulo em que parou**, **sem prazo máximo** — com cadência de e-mails de reengajamento em **1, 3 e 6 meses** (o de 6 é o último; depois dele, silêncio, não exclusão). Não disponível para intermedio/avanzado (regra atual, §5 da doc de regras).
- **Progressão de módulo é em lote, com o mesmo docente (decisão 02/09/2026).** Ao fim de um módulo, os aprovados seguem juntos pro módulo seguinte com o mesmo docente — independente de serem mensual ou paquete completo. Quem reprovou ou não pagou o mês (mensual) tem o **acesso à aula bloqueado no portal do aluno** — o "cadeado" é a opção de acessar a aula no portal, **não** integração com o Google Classroom (integração está em estudo, fora do escopo por ora — §2). Mesmo padrão do certificado: o sistema prepara a lista, a coordenação confirma.

---

## 2. Fora do escopo — não construir, não sugerir

- ❌ Pasarela de pago / cobrança dentro da plataforma — **continua fora de escopo como implementação**, mas desde 06/09/2026 o portal **anuncia** a intenção: a tela de Pagamentos mostra um botão "Pagar" desabilitado, com cadeado, ao lado de "Enviar comprovante", com a legenda de que o pagamento pelo portal chega em breve e que por ora se paga por Yape/Plin/transferência. É um cartaz, não um caminho: nada clica, nada integra.
- ❌ Integração com WhatsApp
- ❌ Apps nativos iOS/Android
- ❌ Hospedagem, upload ou streaming de vídeo (só link externo)
- ❌ Links de matrícula tokenizados
- ❌ Descontos, bolsas, promoções
- ❌ Parcelamento de paquete, juros, multa, cobrança de dívida — a modalidade mensual do inglês (§1) é compra pré-paga módulo a módulo, nunca dívida: atraso bloqueia acesso, não gera cobrança
- ❌ Integração com Google Classroom (API) — em estudo; hoje aula é link externo e o bloqueio de acesso vive no portal do aluno
- ❌ Aula virtual / videoconferência própria — mesmo caso da pasarela: desde 06/09/2026 o menu do portal tem o grupo **"Área do aluno"** (Tarefas · Provas · Sala de aula · Estudar) como **dropdown fechado, com os quatro itens travados** (cadeado, sem link, `aria-disabled`). Anuncia o que vem; não constrói nem promete data. Hoje a aula continua sendo link externo (Meet/Classroom).
- ❌ Faturamento eletrônico / SUNAT

Se algo parecer exigir um desses, **pare e pergunte**.

---

## 3. Stack (fechada)

| Camada | Escolha |
| --- | --- |
| Site público | **Astro** (estático) |
| App (portal + backoffice) | **Next.js App Router** |
| API de domínio + workers | **Fastify** (`apps/api`), processo Node separado |
| Hospedagem | **Vercel** (landing + app) · **Fly.io** (`apps/api`, região GRU/São Paulo — VM always-on, workers de fila no mesmo processo da API) |
| Banco | **Postgres** gerenciado — **Neon** (`sa-east-1`/São Paulo) |
| Storage (comprovante + backup) | **Tigris** (nativo do Fly.io — `fly storage create`, S3-compatible, egress zero) — mesmo bucket-provider pros dois usos, sem conta separada |
| Auth | **Better Auth** — biblioteca embutida no processo de `apps/api` (Fastify), nunca instanciada em `apps/app` |
| Fila | **Redis (Upstash) + BullMQ** — workers em `apps/api` |
| OCR / IA | **Gemini 3.1 Flash-Lite** (nível 1) · modelo de outra família (nível 2) |
| E-mail (transacional/campanhas) | **Brevo**, atrás de adapter |
| E-mail (caixa/mailbox de staff) | **Zoho Mail Lite** — Brevo não hospeda caixa (sem IMAP próprio); usar só se alguém precisar **receber e ler** e-mail em `contato@`/`matricula@` |
| Rate limit + idempotência | **Upstash Redis** (borda) — mesma instância usada pela fila |
| Captcha | **Cloudflare Turnstile** |
| Backup | `pg_dump` → **Tigris** via Scheduled Function (mesmo storage do comprovante) |
| Observabilidade | **Sentry** + **PostHog** (EU Cloud) |
| Realtime | a decidir — item de infra que segue em aberto por conta própria |

Não trocar nada disso sem me perguntar. Já foram avaliadas e descartadas: Clerk, Pinecone, Resend, Cloudflare CDN. O provedor de backend gerenciado que havia sido escolhido foi **removido**; Postgres, hospedagem de `apps/api`, storage de comprovante, caixa de e-mail e auth já foram refechados (acima, sessão 17/08/2026 para os quatro primeiros, `docs/ARCHITECTURE.md` §5; auth fechado depois — ver abaixo e `docs/ARCHITECTURE.md` §5.6).

**Decisão revertida — hospedagem de frontend (Netlify → Vercel, sessão 31/08/2026).** Vercel havia sido avaliado e descartado antes; reaberto e refechado nesta sessão a pedido meu, pensando num terceiro frontend futuro (portal do aluno) sobre a mesma conta/organização. Hoje `apps/app` continua **um único Next.js** (portal + backoffice juntos, `CLAUDE.md` §8) — nenhum desmembramento decidido ainda; o terceiro frontend é escopo em aberto, não confundir com decisão fechada.

**Decisão fechada — fila mesclada com a API (sessão 31/08/2026).** `apps/api` tinha dois entrypoints (`src/index.ts` HTTP e `src/worker.ts`) pensados pra escalar/reiniciar de forma independente — isso só se justificava se a hospedagem permitisse escalar cada um à parte. Como o Fly.io hospeda `apps/api` como uma VM always-on única, a separação parou de se justificar: um entrypoint só, HTTP + workers de fila no mesmo processo. Simplifica o deploy (uma imagem, uma máquina) sem abrir mão do requisito de always-on que os workers de BullMQ exigem.

**Decisão fechada — auth.** O provedor removido cobria Postgres, auth e storage juntos; os três já foram resolvidos (Neon, Better Auth e Tigris, acima). Better Auth é uma **biblioteca embutida no processo do backend**, não um serviço hospedado externo — roda dentro do próprio `apps/api`, aceita conexão Postgres existente, e o campo `role` fica travado contra escrita client-side (`additionalFields.role`, `input:false`). Padrão de integração completo (porta em `packages/domain`, adapter em `apps/api/src/infra`, `apps/app` nunca instanciando o provedor) em `docs/ARCHITECTURE.md` §5.6.

**Decisão fechada — modelo de autorização.** Autorização vive na **camada de aplicação** (`apps/api`, ver §8), não em RLS — motivo e comparação de caminhos em `docs/ARCHITECTURE.md` §2. RLS pode voltar depois como camada extra de defesa, mas nunca como o mecanismo de aceite documentado.

### Monorepo

```
apps/
  landing/           Astro — site público
  app/               Next.js — portal + backoffice
  api/               Fastify — expõe @ooc/domain via HTTP + workers de fila (BullMQ/Redis)
packages/
  domain/            domínio DDD puro (entidades, usecases, portas de repositório) — sem framework, sem infra
  queue/             contrato de fila compartilhado (jobs, producers) — usado por quem publica e por quem consome
  db/                schema + migrations (Drizzle Kit) + seed — mesma DATABASE_URL local/Neon
  notifications/     ainda não criado — adapter de e-mail + outbox (entra com a Sessão 30 do ROADMAP)
  ocr/               ainda não criado — pipeline de extração (entra com a Sessão 26 do ROADMAP)
```

Hoje só `domain/`, `queue/` e `db/` existem. `i18n` e `shared` não viraram pacote — cada app tem as próprias mensagens (`apps/*/src/i18n/`, `apps/*/src/messages/`) e não há tipo/utilitário cross-app que já justifique extrair um `packages/shared`.

---

## 4. Idioma

**Código em inglês. Interface trilíngue. Conversa comigo em português.**

### Trilíngue obrigatório

**Tudo que o usuário vê tem três idiomas: `es-PE` (padrão) · `pt-BR` · `en`.** Espanhol do Peru é o idioma padrão e o fallback quando faltar tradução. Cada idioma é um arquivo de locale com a **mesma estrutura de chaves** — nunca uma chave que exista só num idioma.

| Camada | Idioma |
| --- | --- |
| Tabelas, colunas, enums, funções, variáveis, tipos | Inglês |
| Branches, commits, comentários de código | Inglês — **sem exceção** (ver §9) |
| Chaves de i18n | Inglês (`payment.status.under_review`) |
| **Todo texto visível ao usuário** | **Trilíngue**: `es-PE.json` (padrão) · `pt-BR.json` · `en.json` |
| Templates de e-mail, PDFs, manual | **Trilíngue**, `es-PE` padrão |
| Documentação interna e nossas conversas | Português |

Seletor de idioma visível na interface. Roteamento: `es-PE` sem prefixo, `/en` e `/pt` prefixados.

### Regra dura de i18n

**Zero string de UI dentro de `.ts` / `.tsx` / `.astro`.** Todo texto visível sai do arquivo de locale, nos três idiomas. Inclui mensagem de erro de API e corpo de e-mail. Lint quebra o build.

Motivo: a Asociación dá oficinas de quechua. Um quarto idioma (ex.: quechua) é só mais um arquivo de locale com a mesma estrutura — nunca uma caçada por strings soltas.

**Zero código de domínio na tela.** Enum, flag, id técnico e nome de campo (`amount_mismatch`, `pp_en_a1_v3`, `yape`, `enr_1188`) nunca aparecem para o usuário — sempre resolvidos em texto pelo locale. Se um dado da UI pode ser código, o tipo diz qual é (união discriminada), não uma string solta. Exceção: nome próprio de marca (`Yape`, `Plin`, `BCP`) e dado real do aluno (nome de curso, número de operação).

### Glossário (termos peruanos → código)

| Domínio | Código |
| --- | --- |
| Alumno | `student` |
| Apoderado | `guardian` |
| Docente | `teacher` |
| Aula / turma | `class_group` (nunca `class` — reservada em JS) |
| Curso | `course` |
| Paquete / plan | `plan` |
| Matrícula | `enrollment` |
| Comprobante | `receipt` |
| Constancia | `enrollment_certificate` |
| Certificado (conclusão) | `certificate` |
| Ciclo / período | `academic_period` |
| DNI | `national_id` + `national_id_type` |
| Sol / PEN | `PEN` (ISO 4217) |
| Yape, Plin, BCP, Interbank | `yape`, `plin`, `bcp`, `interbank` — minúsculo, não traduzir |
| Qualquer outro meio (PayPal, banco fora da lista) | `other` + texto livre em `paymentMethodDetail` — o texto **é** o rótulo; `other` sozinho nunca aparece na tela sem ele |

---

## 5. Regras de arquitetura — onde cada uma vive

Todo o detalhe de arquitetura por camada morou aqui até esta sessão; agora vive no `CLAUDE.md` de cada app/pacote, carregado automaticamente quando a sessão trabalha ali (ver "Mapa de contexto" no topo deste arquivo). Nada foi perdido — só deixou de ser carregado em toda sessão, esteja ela mexendo em `apps/landing` ou não.

| Assunto | Onde está agora |
| --- | --- |
| Pagamento (máquina de estados, `amount_cents`, idempotência, preço versionado) | `apps/api/CLAUDE.md` |
| OCR (escada de níveis, pré-processamento, nunca síncrono) | `apps/api/CLAUDE.md` |
| Upload (signed URL) | `apps/api/CLAUDE.md` |
| Vagas (condição de corrida, os dois relógios) | `apps/api/CLAUDE.md` |
| Origem da matrícula (atribuição de canal) | `apps/api/CLAUDE.md` |
| Notificações (outbox, `NotificationProvider`) | `apps/api/CLAUDE.md` |
| Fronteira `packages/domain` (DDD puro, exceção do vocabulário de erro HTTP) | `packages/domain/CLAUDE.md` |
| Feature flags das três superfícies | `apps/app/CLAUDE.md` |
| Layout de tela do backoffice/portal (`AutoGrid`, container query) | `apps/app/CLAUDE.md` |
| Regras de celular do backoffice/portal | `apps/app/CLAUDE.md` |
| Layout da landing (`--dp`, as duas larguras de desenho) | `apps/landing/CLAUDE.md` |
| Disciplina de migration e convenções de schema | `packages/db/CLAUDE.md` |

---

## 6. Erros proibidos

Cada um tem um mecanismo. O mecanismo é obrigatório, não a boa intenção.

| Erro | Mecanismo |
| --- | --- |
| `.env` no Git | `.gitignore` + gitleaks no CI + só `.env.example` versionado |
| **Credencial de banco no bundle do cliente** | check de CI varrendo o build do Next.js. Catastrófico — só `apps/api`/workers têm connection string do Postgres |
| **E-mail real disparado de staging** | provider recusa destinatário fora da allowlist quando `NODE_ENV !== production` |
| Rota sem checagem de papel | middleware deny-by-default em `apps/api`; rota sem papel declarado falha no CI |
| SQL rodado à mão no painel de produção | só migration versionada |
| Sem rate limiting | middleware deny-by-default; rota sem política declarada falha no CI |
| Commit direto na `main` | branch protection: PR + CI verde |
| Stack trace ao usuário | error boundary → mensagem genérica + `error_id`. Detalhe só no Sentry |
| `localhost` fixo no código | tudo via env validada com zod no boot + regra de lint |
| `async` sem tratamento | `no-floating-promises`, `require-await`, handler de `unhandledRejection`, DLQ na fila |
| Float para dinheiro | `amount_cents INTEGER` |
| Data sem timezone | `timestamptz` sempre, UTC no banco, `America/Lima` só na renderização |
| Delete físico | trava no próprio Postgres (migration `0011`), não só no domínio: papel de aplicação `ooc_app` sem grant de DELETE em `students`, `payments`, `payment_receipts`, `consents` e `audit_log` (nem UPDATE em `audit_log`) **e** trigger que recusa a mesma coisa para o dono das tabelas. Só `deleted_at`. Detalhe em `packages/db/CLAUDE.md` |
| PII em log | redaction de nome, DNI, e-mail, payload de comprovante. Scrubbing no Sentry |
| Dado real de produção em staging | seed anonimizado, nunca dump |
| Backup nunca restaurado | restauração testada em staging por trimestre |

### Portão de CI (bloqueia merge)

1. gitleaks
2. varredura do build do Next.js por credencial de banco
3. `tsc --noEmit`
4. ESLint (`no-floating-promises`, `no-literal-string`)
5. teste de autorização — toda rota de `apps/api` declara papel exigido; teste tenta acessar com papel errado e exige falha
6. migrations em banco limpo
7. validação de env com zod
8. trava de privilégio no banco — a suíte emite DELETE/UPDATE/TRUNCATE proibido direto no Postgres migrado e exige a recusa (`packages/db/tests/privileges.test.ts`, no mesmo job das migrations)

---

## 7. Ambientes

| Ambiente | Onde |
| --- | --- |
| Local | Postgres local |
| Staging | `staging.aula.onlyonecoin.edu.pe` · Postgres gerenciado (Neon, branch de staging) |
| Produção | `aula.onlyonecoin.edu.pe` · Postgres gerenciado (Neon) |

- `apps/landing`/`apps/app`: Vercel, deploy automático a cada push em `main` via GitHub Actions (`.github/workflows/deploy-vercel.yml`); PR gera deploy preview nativo da Vercel. `apps/api`: Fly.io, mesmo gatilho (`deploy-api.yml`), sempre backup → migration → deploy, nessa ordem
- Variáveis de ambiente **por projeto/ambiente** na Vercel e como secret do repo no GitHub (o que `apps/api` lê em runtime vem do Fly.io)
- **Migrations sempre aditivas.** Renomear/apagar em duas etapas (expand/contract), separadas por semanas
- Migration em produção **sempre depois de backup**
- Staging nunca recebe dado real

---

## 8. Segurança

- Autorização **deny-by-default na camada de aplicação** (`apps/api`, Caminho B — ver §3): toda rota/usecase declara explicitamente o(s) papel(is) permitido(s); rota sem declaração falha o CI. Teste automatizado cobre toda rota sensível, tentando acessar com papel errado e exigindo falha.
- Só `apps/api` (e workers) têm credencial de acesso ao Postgres. O Next.js (`apps/app`) nunca fala direto com o banco — tudo passa pela API.
- Bucket de comprovantes privado, signed URL de 5 min, caminho escopado por aluno, acesso registrado
- Docente vê só as próprias turmas — checagem explícita no usecase (`teacher_id` do usuário autenticado comparado ao dado), nunca um filtro montado a partir de input do cliente
- Nenhum id vindo do cliente é confiado (anti-IDOR)
- MFA obrigatório: `master`, `admin`, `billing`
- Anti-enumeração: login e recuperação de senha respondem igual para conta existente e inexistente
- Upload validado por **magic bytes**, re-encode da imagem, teto de tamanho
- Headers: CSP, HSTS, X-Frame-Options, Referrer-Policy
- `audit_log` append-only: sem grant de UPDATE nem DELETE, nem para admin — e desde a migration `0011` um trigger recusa UPDATE/DELETE/TRUNCATE também para o dono da tabela, que é quem uma `DATABASE_URL` vazada entrega. Só `apps/api` (papel `ooc_app`) conecta no runtime; ligar esse papel em cada ambiente é passo de ops documentado em `packages/db/README.md`
- Ley 29733: consentimento com timestamp, versão do texto e IP; política de retenção; exclusão a pedido

**Papéis (quadro redefinido pelo dono, 07/09/2026):** `master`, `admin`, `analyst`, `enrollment_supervisor`, `academic_supervisor`, `teacher`, `sales`, `support`, `billing`. Aluno e apoderado: `student`, `guardian`. Substituiu o quadro antigo (`coordinator`, `treasury`, `mass_approver` deixaram de existir; grosso modo: coordinator → enrollment_supervisor, treasury → billing, mass_approver extinto — aprovação é de admin/billing).

- **`master`** é o cargo dos donos da plataforma: vê e faz tudo, e **só conta em `@nrlabsdigital.com` ou `@admin.com`** pode carregá-lo (`canHoldMaster`, `apps/app/src/lib/backoffice/permissions.ts`). Os mesmos domínios — e não o cargo — são o que abre a seção **Funcionalidades** (§5): lá quem decide é `isOwnerEmail`, então um `admin` da Asociación é recusado e um dono passa com qualquer cargo.
  - **`admin.com` entrou na lista em 17/09/2026**, decisão do dono, junto do fix do incidente de Funcionalidades (§5): a conta que a equipe de fato usa como login de produção carrega esse domínio, não `nrlabsdigital.com`, e sem isso ela nunca teria como abrir Funcionalidades — nem pra reverter um flag que ela mesma derrubou. `MASTER_EMAIL_DOMAINS` (plural agora, `packages/domain/src/identity/Role.ts` e o espelho em `apps/app/src/lib/backoffice/permissions.ts`) é lista, não string única. Isso não reabre `docs/REGRAS-NEGOCIO.md`/seed: `admin@admin.com` **continua** sendo a credencial do script `seed-admin.ts` (§8, "Bootstrap"), que segue proibido apontar pra staging/produção — a conta em produção com esse domínio tem senha própria, gerada à parte, não a do seed.
- **`admin`** vê tudo e autoriza. **`analyst`** (assistente/analista da administração) observa todas as áreas e propõe solução, mas **não aprova nem edita nada**.
- **`enrollment_supervisor`** cuida do lado acadêmico das matrículas (alunos, matrículas manuais, cursos/turmas); **`academic_supervisor`** supervisiona os docentes.
- **`sales`** (vendedor) e **`support`** (atenção ao cliente) leem alunos/matrículas; **`billing`** (facturación) liquida dinheiro e não vê dado acadêmico não financeiro.
- A matriz tela-a-tela vive em `apps/app/src/lib/backoffice/permissions.ts`. O backend já fala o quadro novo: `Role` em `packages/domain/src/identity/Role.ts` (com `MASTER_EMAIL_DOMAINS`/`canHoldMaster`), as rotas de `apps/api` declaram os cargos novos, e a migration `0009` troca os CHECKs de `user.role` e `staff_invites.role`. O convite recusa `master` fora dos domínios dos donos na própria rota (`CreateStaffInviteRoute`). Pendente: a tabela RBAC de `docs/ARCHITECTURE.md` §3 ainda descreve o quadro antigo.

Emitem documento (constancia, certificado) e disparam o lote de uma turma: `master`, `admin`, `enrollment_supervisor`, `academic_supervisor`, `teacher` — o docente **só nas próprias turmas**, checado no usecase. `billing` não emite. Toda emissão e todo reenvio de e-mail vão para o `audit_log`.

Detalhe de implementação que consome este quadro de papéis — pontos de entrada portal × backoffice (`apps/app/CLAUDE.md`) e gestão de cargos/anti-escalada de privilégio, incluindo o modelo de criação de staff (`apps/api/CLAUDE.md`).

---

## 9. Como trabalhar comigo

- **Não invente regra de negócio.** Se eu der um exemplo, é exemplo — não generalize para regra. Em dúvida, pergunte.
- **Pergunte antes de assumir** volume, preço, nome de curso, quantidade de turmas.
- Mudança de banco = migration versionada. Nunca `psql` direto em ambiente remoto.
- **Todo commit é em inglês. Sem exceção, e isso vale para a mensagem inteira** — título e corpo, não só o prefixo convencional. O mesmo para nome de branch, título e descrição de PR, e comentário de código. A regra já estava na tabela do §4; está repetida aqui porque é a que mais escapa na hora de escrever. Nossa conversa continua em português; o que vai pro Git, não.
- Commits pequenos, no formato convencional (`feat:`, `fix:`, `chore:`).
- Antes de escrever código novo, diga em uma linha o que vai fazer e onde.
- Se um pedido meu contradisser este arquivo, **avise antes de executar**.
- Prefira explicitar o trade-off a escolher em silêncio.

---

## 10. Documentação viva

**Nenhuma decisão de arquitetura termina no código.** Toda sessão que fecha, muda ou reverte uma decisão — de stack, de modelo de autorização, de RBAC, de fluxo de negócio — só está pronta quando a documentação reflete isso. "Depois eu atualizo" não é aceitável: a doc desatualizada é o que faz a próxima sessão (minha ou sua) tomar decisão em cima de premissa errada.

- **`CLAUDE.md`** é a fonte da verdade, agora **em camada**: a raiz tem o que vale para mais de um app/pacote (negócio, stack, i18n, erros proibidos, ambientes, quadro de segurança/papéis); `apps/*/CLAUDE.md` e `packages/*/CLAUDE.md` têm o que é específico de cada um (mapa completo no topo deste arquivo). Ao fechar uma decisão, ela entra **numa só** dessas camadas — nunca duplicada. Decisão que nasce específica de um app e passa a valer para outro sobe pra raiz; decisão da raiz que só um app ainda cumpre desce pro `CLAUDE.md` dele.
- **`docs/ARCHITECTURE.md`** guarda o detalhe que não cabe no `CLAUDE.md` sem inchar (ex.: tabela completa de RBAC, comparação de caminhos de decisão, checklist de segurança) — `CLAUDE.md` referencia, não duplica.
- **`README.md`** reflete o **estado real do repo** — o que existe hoje, não o plano. Se `Estado atual` descreve algo que não é mais verdade, é bug de documentação, trato como trato bug de código.
- **`docs/ROADMAP.md`** é atrelado ao contrato — sinalizar quando ficar desatualizado, **nunca editar sem confirmação minha**.
- Doc nova (ex.: `docs/ARCHITECTURE.md`) é linkada na seção "Documentos" do `README.md` no mesmo commit que a cria — doc órfã não existe pra quem não sabe procurar.

Antes de considerar uma sessão pronta: **alguma doc ficou desatualizada com o que acabei de fazer?** Se sim, atualiza antes de terminar, não depois.
