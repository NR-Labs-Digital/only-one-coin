# CLAUDE.md — Only One Coin · Plataforma Académica Digital

Contexto permanente do projeto. Lido em toda sessão. Se algo aqui conflitar com um pedido meu, **avise antes de seguir**.

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
- **Matrícula aberta pelo backoffice é a exceção, não um segundo caminho.** O fluxo acima continua sendo o normal: o aluno preenche `/matricula` e sobe o comprovante. Para a venda que fechou no WhatsApp e nunca chegou ao formulário, `admin` e `coordinator` podem abrir a matrícula pelo painel (`/backoffice/enrollments`), sob quatro travas: **(a)** só sobre aluno **já cadastrado** — registrar pessoa é outro fluxo, porque carrega o consentimento do apoderado (§8); **(b)** o preço é o **vigente do plano, somente leitura** — não há desconto, nunca; **(c)** a vaga entra como `reserved`, nunca `confirmed`; **(d)** o pagamento **nunca nasce aprovado** — o comprovante entra na mesma escada de OCR e na mesma fila de revisão (§5). Quem abre a matrícula não liquida o dinheiro dela. A seção inteira (`/backoffice/enrollments`) é de `admin` e `coordinator`: `treasury` liquida dinheiro em Pagos e o docente chega aos seus alunos pela turma (`docs/ARCHITECTURE.md` §3).
- **Cadastro manual de aluno pelo backoffice** é o par do item acima: a matrícula manual só age sobre aluno já cadastrado, então o cadastro da pessoa é um fluxo próprio (`/backoffice/students`, `admin` e `coordinator`). O **apoderado é opcional** — e deixa de ser no instante em que a data de nascimento diz que o aluno é menor de idade, quando passa a ser obrigatório. O **consentimento (Ley 29733) nunca é digitado ali**: quem aceita é o apoderado, com a data, a versão e o IP dele; a ficha nasce com o consentimento pendente. O cadastro não matricula ninguém.
- **Docente tem contrato com vigência, e o painel vigia o vencimento.** O contrato fica registrado como **arquivo** (nome + data de arquivamento, bytes no bucket como qualquer comprovante) mais o **período que cobre** (início e fim). O painel marca o contrato como *a vencer* a partir de **45 dias** do fim (`CONTRACT_ALERT_DAYS` — número provisório, a confirmar), *vencido* assim que a data passa, e *sem contrato* quando não há nenhum arquivado — esse último é um achado, não uma célula vazia. Arquivo, início e fim são as três coisas juntas ou nenhuma: meio contrato não se arquiva. **Gerar** o contrato a partir do modelo da Asociación é passo à parte, ainda não construído — hoje o painel só arquiva o que foi assinado.
- **Docente sai do quadro, não some.** `inactive` é o que a coordenação marca quando alguém para de dar aula (contrato vencido, ciclo encerrado) — nunca apagar: quem assinou nota e deu turma continua apontado por elas. Sair do quadro **para a vigilância do contrato**: o alerta existe para impedir alguém de dar aula com contrato vencido, e quem está inativo não dá aula. O documento continua arquivado na ficha. O painel avisa quando ainda há turma em andamento apontando para o docente que está saindo — avisa, não bloqueia: quem larga no meio do ciclo é caso real, e travar deixaria a ficha presa.
- **O e-mail do aluno tem que ser uma conta pessoal do Gmail.** Não é preferência: o formulário atual recusa em maiúsculas conta institucional e corporativa, porque o acesso à aula chega por Google Classroom. Endereço de colégio que morre em dezembro é aluno que perde o curso que pagou. Vale para o aluno; o e-mail do apoderado pode ser de qualquer provedor.
- **O celular é pedido no formulário de matrícula.** A regra "nunca pedir número de telefone" (`docs/REGRAS-NEGOCIO.md` §5) governa a **conversa de venda no WhatsApp**, onde o número já é conhecido — não o formulário, que sempre teve coluna `CELULAR`.
- **Data de início e horário são escolhas separadas.** O mesmo curso abre em várias datas — começar esta semana ou com a turma do fim do mês — e cada data tem seus três ou quatro horários. Quem abre turma é `admin`/`coordinator` pelo backoffice; o checkout público lê o que estiver aberto.
- Comprovante: retido por **5 anos**. Só a **versão processada/reduzida** (pós downscale/grayscale da OCR, `CLAUDE.md` §5) é retida — não o upload original bruto.
- **Exame de clasificación é o portão do inglés intermedio/avanzado e do Cambridge (decisão 02/09/2026).** Ninguém entra nesses níveis sem aprovar o exame, que é **pago** (valor vigente na tabela de procedimentos, `docs/REGRAS-NEGOCIO.md` §3/§5). Hoje roda em Google Forms com correção manual; na plataforma vira exame online com **resultado calculado automaticamente**. Aprovado → segue pra pagar o nível alto (paquete ou mensual); reprovado → começa do básico. **Em aberto no desenho:** se o exame pode ser feito sem registro prévio (resultado → opção de matricular) ou se exige registro antes — os dois caminhos foram descritos, qual (ou se ambos) fica pra hora de desenhar o fluxo. Validade do resultado também não foi definida.
- **Quem já é aluno não volta pelo site público (decisão 02/09/2026).** Repetir módulo, exame de rezagados (pago), próximo nível e re-matrícula saem do **portal do aluno**, puxando o cadastro existente — nunca duplicando `student`. E-mails de gatilho convidam pro próximo curso/nível. As solicitações pagas do portal seguem o mesmo padrão da constancia: solicitação com pagamento associado, comprovante + OCR + fila de revisão.
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
  notifications/     adapter de e-mail + outbox
  ocr/               pipeline de extração
  i18n/              locales (es-PE.json)
  shared/            tipos e utilitários
```

---

## 4. Idioma

**Código em inglês. Interface trilíngue. Conversa comigo em português.**

### Trilíngue obrigatório

**Tudo que o usuário vê tem três idiomas: `es-PE` (padrão) · `pt-BR` · `en`.** Espanhol do Peru é o idioma padrão e o fallback quando faltar tradução. Cada idioma é um arquivo de locale com a **mesma estrutura de chaves** — nunca uma chave que exista só num idioma.

| Camada | Idioma |
| --- | --- |
| Tabelas, colunas, enums, funções, variáveis, tipos | Inglês |
| Branches, commits, comentários de código | Inglês |
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

## 5. Regras de arquitetura

### Pagamento

- `payments` é **agnóstico de origem**. Máquina de estados: `pending → under_review → approved | rejected`.
- Dados de extração ficam em `payment_receipts`, não em `payments`.
- **`amount_cents INTEGER`.** Nunca float, nunca `numeric` de ponto flutuante.
- **Idempotency key em todo pagamento.** Duplo POST de celular ruim é certeza.
- Preço é **versionado, nunca editado**. A matrícula congela o `plan_price_id` vigente. Corrigir a tabela de preços não pode revalidar histórico.
- Tolerância de validação **configurável no backoffice**, não constante no código.

### OCR — nunca síncrono

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

### Upload

**Signed URL direto ao Storage.** A imagem nunca passa pela função — é o que derruba tudo sob volume.

### Vagas — condição de corrida

Nunca validar vaga na aplicação. Instrução atômica única:

```sql
UPDATE class_groups
   SET seats_taken = seats_taken + 1
 WHERE id = $1 AND seats_taken < capacity
RETURNING seats_taken;
```

Zero linhas = cheia. Mais `CHECK (seats_taken <= capacity)` como rede.

Estados de vaga: `reserved` → `confirmed` (pagamento aprovado) → `released` (rejeitado ou expirado).

**Dois relógios, não um.** A vaga é presa antes do pagamento — quem paga já pagou com a vaga na mão — e isso cria duas janelas com prazos muito diferentes:

| Relógio | De → até | Prazo | Quem devolve a vaga |
| --- | --- | --- | --- |
| **Hold de checkout** | vaga presa no checkout → comprovante enviado | **15 min** | o próprio checkout, ao expirar |
| **Janela de revisão** | comprovante enviado → pagamento aprovado ou recusado | **5 dias** | cron de reserva parada |

O hold curto existe porque o pagamento acontece **fora da plataforma** (Yape/transferência, `CLAUDE.md` §2 — não há pasarela): a pessoa sai da página, paga no app do banco e volta. Sem o hold, ela paga e descobre a turma cheia na volta — e não existe fluxo de devolução. Expirado o hold sem comprovante, a vaga volta pra turma e o checkout recomeça do passo da turma.

Enviado o comprovante, a vaga **continua `reserved`** e passa a correr no relógio de 5 dias. Ela só vira `confirmed` quando o pagamento é aprovado (OCR ou revisão humana) — enviar comprovante não confirma matrícula, só garante que a vaga não cai pelo hold curto.

Os dois prazos são **configuráveis no backoffice** (`/backoffice/settings`), nunca constante no código — mesma regra da tolerância de valor.

### Origem da matrícula (atribuição de canal)

Toda matrícula grava **de onde veio** — hoje `whatsapp` (link mandado pelo vendedor depois da venda fechada) ou `web` (a pessoa chegou sozinha pela landing). É campo do domínio, não analytics: fica na própria `enrollments`, não só no PostHog, porque a coordenação precisa responder "quantas matrículas o zap trouxe neste ciclo" dentro do backoffice, e porque analytics de borda se perde com bloqueador de anúncio.

- Mora na **matrícula**, não no aluno. A mesma pessoa pode voltar por outro canal no ciclo seguinte; um campo no aluno perderia o histórico.
- Capturado no **primeiro acesso** ao checkout e carregado até o submit — se a pessoa recarregar ou sair pra pagar, a origem não se perde.
- Valor **nunca vem confiado do cliente** como texto livre: é união fechada, e qualquer coisa fora dela cai em `web`.
- Os parâmetros de campanha (`utm_*`) andam junto, mas separados, para relatório — a origem é o dado de negócio, o `utm` é o detalhe da peça.

O link do WhatsApp é URL comum com `?course=&group=&src=whatsapp` — **prefill e atribuição, não token**: sem segredo, sem autenticação e sem preço embutido (o valor vem sempre do `plan_price` vigente, lido no servidor). Isso é o que o mantém compatível com §2, "sem links de matrícula tokenizados".

### Notificações

Tudo passa pela tabela `outbox`. O sistema não conhece o Brevo:

```ts
interface NotificationProvider {
  sendEmail(to, templateKey, vars): Promise<{ providerId: string }>
}
```

Templates versionados no repositório, não desenhados só no painel do Brevo.

### Feature flags — o que está no ar em produção (decisão 06/09/2026; interruptor no painel 08/09/2026; leitura pública 09/09/2026; recuperação da tela 17/09/2026)

**As três superfícies de `apps/app` são geridas por feature flag: portal do
aluno, backoffice e painel do docente.** Uma flag ligada significa que a seção
aparece em produção; desligada significa que ela **não existe em produção** —
some da navegação e a URL responde 404 — e continua inteira **para nós**: local,
deploy de preview da Vercel e, em produção, para quem abriu o destravamento
interno (`/api/preview?token=…`, cookie de 12 h, com tarja em toda tela dizendo
que aquilo não está ativo para mais ninguém).

- **Flag não é controle de acesso.** Quem pode o quê continua sendo o papel
  declarado na rota em `apps/api` (§8). A flag diz se a funcionalidade está no
  ar; o papel diz para quem ela responde.
- **O catálogo vive em código; o interruptor vive no painel (08/09/2026).** A
  flag continua nascendo num commit, no registro único
  (`apps/app/src/lib/feature-flags/registry.ts`) ao lado da seção que governa —
  inventar uma pela tela seria inventar uma seção que não existe. Mas **ligar e
  desligar é a tela `FUNCIONALIDADES`** (`/backoffice/features`), que grava em
  `feature_flag_overrides` pela API (`SetFeatureFlagOverrideUseCase`, toda troca
  no `audit_log`). Isto reverte o adiamento registrado antes: a pilha que ele
  cobrava — migration, usecase, rota — foi construída, porque o custo do
  adiamento era pior (só quem abre `registry.ts` sabia o que estava no ar, e
  desligar uma seção em produção era um deploy).
- **Só os donos abrem a tela — e é o e-mail que decide, não o cargo.** Conta em
  `@nrlabsdigital.com` (`isOwnerEmail`, o mesmo domínio do `master`): o que a
  plataforma admite existir é decisão de quem opera a plataforma, não de quem
  administra a escola. Na API é uma declaração de rota própria, `.owners()`, ao
  lado de `.roles(...)` e `.public()` — deny-by-default continua valendo — e o
  usecase repete a checagem antes de escrever.
- **Ordem de resolução:** `OOC_FLAG_<CHAVE>` (env, *scoped* por ambiente na
  Vercel) → interruptor do painel → fora de produção tudo ligado → padrão do
  registro → pai. A env **ganha do painel** de propósito: é o caminho de volta
  quando o painel é o que quebrou.
- **A leitura do estado é pública (revertido 09/09/2026).** `GET
  /feature-flags/state` nasceu `.internal()`, atrás de um segredo
  `INTERNAL_API_TOKEN` novo e obrigatório em produção — e ninguém garantiu que
  esse segredo existisse no Fly.io antes do deploy: a API não subia sem ele, o
  processo caía em produção, e como o formulário de login do backoffice não
  tinha `try/finally` em volta do `fetch` (bug preexistente, não desta
  decisão), a queda virou "login carregando pra sempre" em vez de um erro
  claro — auth inteiro fora do ar sem ninguém perceber no deploy. Decisão do
  dono: o que precisa de porta é **quem muda** uma flag (`.owners()` em `PUT
  /feature-flags/:key`, e-mail `@nrlabsdigital.com`, inalterado) — **quem só
  lê** o estado atual não, porque o resolver às vezes não tem sessão nenhuma
  pra checar (o shell do portal renderiza pra um aluno; a página de convite,
  pra ninguém). `INTERNAL_API_TOKEN` foi removido do código dos dois lados
  (`apps/api`, `apps/app`), não só desligado — segredo de produção obrigatório
  que ninguém revisou uma vez já foi o suficiente.
- **A tela de flags não tem flag própria**: seria a única da qual não se volta
  pela tela que ela esconde. Até 17/09/2026 essa frase era só intenção: o
  `layout.tsx` do painel checava `requireFeature('backoffice')` antes de
  qualquer rota filha, `/backoffice/features` incluída — então desligar
  `backoffice` (ou `portal`, que carrega a mesma armadilha do lado do aluno)
  derrubava o painel inteiro **e** a tela que devolveria o flag, em produção,
  para todo mundo. Foi o que aconteceu nesta data: alguém desligou o flag raiz
  de uma superfície pelo card novo de Funcionalidades (`2ce11b6`, que põe esse
  interruptor no topo do card, ao lado dos filhos) e não havia como religar
  pela UI — só variável de ambiente na Vercel ou escrita direta na API. Fix em
  duas partes: **(a)** `/backoffice/features` saiu do grupo de rota que checa
  `requireFeature('backoffice')` (`(panel)/(gated)/layout.tsx` carrega o
  portão agora; `(panel)/features` fica fora dele, protegida só pelo próprio
  `canManageFeatureFlags` por e-mail, que já existia) — a frase acima passou a
  ser verdade no código, não só no comentário; **(b)** o switch que desliga o
  flag raiz de uma superfície pede confirmação antes de gravar (o resto dos
  flags continua sem essa fricção — só esse switch derruba um card inteiro).
- **Fora de produção toda flag está ligada**, sempre. E `APP_ENV` falha fechada:
  processo sem rótulo rodando build de produção conta como produção.
- **Flag nova nasce desligada em produção** (`production: false`) e é ligada no
  mesmo PR que torna a seção real. Quando a seção deixa de ser novidade, a flag
  sai do registro — flag eterna vira ruído que ninguém confia.
- **Desligada não vira cadeado.** Cadeado é o vocabulário de "anunciado, não
  construído" (a Área do aluno do portal, §2), que é uma afirmação pública e
  diferente.

Detalhe — a pilha completa, o destravamento interno, a tabela de flags de hoje,
o desenho da tela e a limitação conhecida (links profundos entre seções do
backoffice): `docs/ARCHITECTURE.md` §8.

### Layout das telas (`apps/app`)

**A tela responde à coluna que recebeu, nunca à janela.** O painel nunca ocupa a
janela inteira — a sidebar tira 13,5rem aberta e 3rem recolhida —, então
`sm:`/`lg:`/`xl:` decidem a partir de um número que a tela não vê: a mesma janela
de 1280px dá ~1000px de coluna com a sidebar aberta e ~1170px com ela recolhida.
É isso que faz uma tela parecer certa no monitor de quem desenhou e quebrada no
monitor do lado.

- Grade de cards ou campos: **`AutoGrid`** (`components/layout/auto-grid.tsx`).
  Você declara a largura mínima de uma coluna (`min`) e o browser decide quantas
  cabem — a cada resize e a cada toggle da sidebar. **Antes de escrever
  `grid-cols-*` com breakpoint, use `AutoGrid`.**
- Linha de controles (busca + filtros): `flex-wrap`, não `flex-col sm:flex-row`.
  Quebra quando falta espaço de verdade, não quando a janela cruza um número.
- Split assimétrico (2fr/1fr), que `auto-fit` não expressa: container query
  (`@4xl/page:`). O `@container/page` já está declarado no `<main>` dos dois
  shells (portal e backoffice).
- Breakpoint de viewport (`lg:`) só onde a tela **é** a janela — ex.: o split da
  tela de login, que não tem shell em volta.
- Scroll horizontal mora no wrapper da tabela, nunca na página. O `<main>` do
  shell leva `min-w-0`: sem isso uma célula que não encolhe empurra o documento
  inteiro e arrasta o header sticky junto.

Detalhe e histórico da decisão: `docs/ARCHITECTURE.md` §7.

### Celular (`apps/app`) — decisão 06/09/2026

**O app é operado no celular de ponta a ponta.** O aluno vive no portal pelo
telefone; a coordenação aprova pagamento e abre matrícula de onde estiver. Uma
tela que apenas não estoura na horizontal ainda não é uma tela de celular.

- **Tabela densa não rola de lado num telefone: vira lista.** Abaixo de **48rem
  de coluna** cada `<tr>` vira um item, o `<thead>` some e cada célula mostra o
  nome da própria coluna. Passe os títulos: `<TableShell columns={[...]}>` no
  painel, `stackLabels()` (`lib/table-stack.ts`) + as classes `table-scroll` /
  `table-stack` fora dele. **Coluna que só existe sob condição entra na lista
  sob a mesma condição** — o rótulo casa com a célula por posição.
- **O menu do portal fica embaixo**, na barra de abas
  (`components/portal/portal-tabbar.tsx`). Quem fica fixo é marcado item a item
  (`tabBar: true` em `navItems`), nunca recortado por posição — hoje início,
  cursos e trâmites. O resto vai para a folha de "mais", junto do perfil e da
  saída. **Pagamentos fica na folha**: mensalidade e comprovante são visita com
  hora marcada, e uma coluna permanente para o dinheiro faz o portal parecer uma
  cobrança.
- **Idioma mora no perfil**, nunca no chrome. No portal é
  `/portal/profile` (cartão "Preferências"); no painel, `/backoffice/account`.
  Escolha que se faz uma vez não ocupa espaço permanente em toda tela. As telas
  de login são a exceção: antes de entrar não há perfil para abrir, e quem não
  lê espanhol precisa trocar ali.
- **Toda borda fixa soma a safe area** — `pb-safe-b`, `pt-safe-t`. O layout raiz
  declara `viewportFit: 'cover'`, então a página pinta sob o notch e sob a barra
  de gestos. **Nunca bloquear zoom** (`maximumScale`/`userScalable`).
- **Alvo de toque: `min-h-tap`** (44px), nunca um número solto.
- **Campo de formulário tem 16px abaixo de 768px** — já é regra global em
  `globals.css`, não repita por componente. Menos que isso e o Safari do iPhone
  dá zoom ao focar, e não volta.
- **Modal vira folha de baixo** e folha lateral ocupa a largura toda — já vem
  pronto nos primitivos (`components/ui/dialog.tsx`, `sheet.tsx`).
- **Ação principal com largura inteira** no celular; "voltar" embaixo dela, não
  ao lado (`StepNav`, `components/enrollment/ui.tsx`).

Detalhe e histórico: `docs/ARCHITECTURE.md` §7.1.

### Layout da landing (`apps/landing`) — duas larguras de desenho, uma régua em cada

**Decisão 04/09/2026.** A landing tinha os tamanhos presos a breakpoints: dentro
de uma faixa nada mudava e, ao cruzar o número, tudo saltava. Entre 620px e
900px o título do hero ficava em 30,4px enquanto a coluna crescia 280px — e em
910px pulava para 41,9px de uma vez. É isso que fazia a página quebrar em
larguras intermediárias, no desktop tanto quanto no celular.

**Todo tamanho da landing é múltiplo de `--dp`** (`src/styles/global.css`):

```css
--dp: min(1.5px, 0.084745vw); /* 1/1180 da janela, com teto em 1.5px */
--maxw: calc(1180 * var(--dp));  /* a coluna cresce junto com a régua */
```

Fonte, padding, gap, ícone, raio, sombra, borda, `minmax()` de grade — tudo sai
daí, inclusive `font-size` do `body`. A página passa a ser **o mesmo desenho em
qualquer largura da faixa** (ver a correção de 04/09 logo abaixo, que separa a
faixa larga da do celular): nada congela dentro dela, nada salta num limite.
Verificável — medindo qualquer bloco em duas larguras da mesma faixa, a razão
das alturas é a razão das larguras.

- **A largura de desenho larga é 1180px**, onde `--dp` vale 1px. Consequência
  prática: **conserta-se em 1180px e o conserto vale para toda a faixa larga** —
  o que não couber ali não cabe em lugar nenhum.
- **A régua cresce até 1.5px e só então trava** (ajuste 04/09/2026). O teto era
  1px, e isso quebrava monitor grande: a partir de 1180px a página congelava
  numa coluna de 1180px com texto de 16px, enquanto as faixas que sangram
  (hero, propósito, CTA) continuavam ocupando a janela inteira — foto gigante
  ao lado de letra miúda. Agora o desenho cresce até **1770px** (`1180 × 1.5`,
  texto base de 24px) e aí centraliza. **`--maxw` anda preso à régua**
  (`calc(1180 * var(--dp))`): a coluna cresce junto com a fonte, em vez de o
  container travar e o resto crescer sozinho. Abaixo de 1180px nada mudou.
- **`vw` puro é equivalente** e podia ficar; foi convertido para `--dp` só para
  haver uma régua só. Não misture as duas.
- **Nada de `clamp()` para tamanho.** O `clamp` é exatamente o mecanismo que
  congela dentro de uma faixa: os limites viram degraus.

**Correção 04/09/2026 — a segunda largura de desenho, para o celular.** A régua
única acima descrevia um desenho só; abaixo de ~900px ela deixava de descrever
um desenho e passava a descrever uma **miniatura** dele. Em 375px o texto
corrido saía com **5,08px** e o `h1` com 17px — ilegível em mão, não "pequeno".
A saída registrada na versão anterior desta seção ("não se mexe em `--dp`, muda-se
a composição") não resolve, e isso ficou provado: `Audiences` já trocava de
grade em 620px e o texto continuava com 5px, porque quem define tamanho de fonte
ali é o próprio `--dp`.

Então o celular ganhou a **segunda largura de desenho: 390px**, num único bloco
`@media (max-width: 900px)` em `global.css`:

```css
:root {
  --dp: min(1.5px, 0.084745vw);                    /* desenho de 1180px */
  --maxw: calc(1180 * var(--dp));
}
@media (max-width: 900px) {
  :root {
    --dp: min(1px, 0.25641vw);                     /* desenho de 390px */
    --maxw: calc(560 * var(--dp));                 /* coluna de leitura */
  }
}
```

O teto de 1.5px é só da faixa larga: ele existe para o desenho de 1180 crescer
até 1770 num monitor grande. Na faixa do celular o teto é 1px — acima de 390px
de janela quem cresce é a largura útil, até o teto de 560 do container, não a
fonte.

- **A régua continua uma só dentro de cada faixa.** O que muda ao cruzar 900px
  não é o tamanho de um desenho — é qual desenho está na tela. Dentro de cada
  faixa nada congela e nada salta, que era o ponto da decisão original.
- **900px porque é onde a composição já trocava** (`Header`, `WhyUs`,
  `StepsFaq`, `Testimonials`). Nenhuma faixa de largura fica sem dono, e não
  existe janela em que meia página esteja num desenho e meia no outro.
- **Conserta-se o celular em 390px**, do mesmo jeito que se conserta a faixa
  larga em 1180px.
- **Cada seção da home tem a composição do celular escrita à mão**, num bloco
  `@media (max-width: 900px)` no próprio componente, comentado com o motivo.
  Regra de ouro: **empilhar não é encolher** — se a peça só faz sentido ao lado
  de outra (o degradê lateral que fundia a foto do hero na coluna de texto, a
  etiqueta pendurada na margem do título em `CourseDetail`, a textura do sol do
  orbe), ela sai ou vira outra coisa, não vai junto reduzida.
- **No hero do celular a foto é o FUNDO do texto, não um bloco embaixo dele.**
  Empilhados, título e foto disputavam a primeira tela e o corte entre os dois
  era seco. A foto fica ancorada no rodapé do hero e o texto corre por cima; o
  véu (o próprio `--sky-soft`) faz a passagem. Duas relações mandam nos números,
  e mexer num sem o outro quebra: **a sobreposição é `altura da foto − o
  padding-bottom da cópia`** (padding menor = foto mais alta atrás do texto,
  não o contrário), e **o véu tem que estar forte onde a cópia termina e já ter
  acabado onde começam as cabeças**, por volta de 25% da altura da foto — o que
  obriga a sobreposição a ficar abaixo desses 25%. Hoje: foto 310, padding 265,
  sobreposição 45 (15%), véu limpo em 30%.
- **O orbe de idiomas fica** (`LanguageFinder`) — é o desenho da seção, não
  enfeite. No celular os satélites perdem o rótulo e ficam só na bandeira; o
  nome continua no nome acessível do link e é o que o centro mostra ao tocar.
  Cuidado registrado: `--r` é consumido num `translateX`, onde **porcentagem se
  resolve contra a largura do próprio satélite, que é zero** — o raio sai de
  `vw`, nunca de `%`.
- **O que ainda não foi feito:** só a **home** recebeu composição de celular.
  As páginas de curso, `/about`, `/faq`, `/preuniversitario`, contato e as
  legais rodam a régua nova com a composição larga — legíveis, mas não
  desenhadas para o celular. Em `CourseDetail` só o estouro horizontal da
  etiqueta de preço foi corrigido.

### Domínio e fila (`packages/domain`, `packages/queue`, `apps/api`)

Regra de fronteira, vale pra qualquer contexto novo (não só `example`): `packages/domain` é DDD puro (portas e adaptadores) — nunca importa Fastify, provedor de banco ou Redis, só define a **interface** de repositório. A implementação concreta mora na infra de quem consome (`apps/api/src/infra/`). Detalhe de padrão (`BaseModel`/`BaseUseCase`, `RouteBuilder`, `container.ts`, entrypoints) está em `packages/domain/README.md` e `apps/api/README.md` — não duplicado aqui. Estrutura e dependência entre os pacotes: `docs/ARCHITECTURE.md` §1.

**Exceção documentada à regra acima:** o vocabulário de erro HTTP (`packages/domain/src/shared/base/errors/` — `HttpError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `UnableToProcessEntryError`) carrega uma noção de HTTP (`status`) dentro do pacote de domínio. Decisão consciente pra reaproveitar o mesmo vocabulário entre `apps/api` e qualquer bounded context futuro, em vez de duplicar a classe do lado de fora. Nada além dessas classes pode importar ou expor tipo de framework — o resto do pacote continua puro.

**Biblioteca embutida no processo nunca responde HTTP com o shape dela própria.** Better Auth (e qualquer outra lib embutida que fale HTTP direto, ver `CLAUDE.md` §3) roda dentro de `apps/api`, mas isso não abre exceção ao contrato de erro (`docs/ARCHITECTURE.md` §5.7): a mensagem/código nativo do provedor nunca chega ao cliente como está — sempre traduzido pro envelope `{status, reason, path?, errorId?}` do projeto antes de sair, e o texto original (se não puramente técnico) fica só no log do servidor (`CLAUDE.md` §4, "zero string de UI... inclui mensagem de erro de API"; §6, "stack trace ao usuário proibido"). Implementação: `apps/api/src/http/auth/AuthCatchAllRoute.ts`.

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
| Delete físico | sem grant de DELETE em student, payment, audit. Só `deleted_at` |
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

---

## 7. Ambientes

| Ambiente | Onde |
| --- | --- |
| Local | Postgres local |
| Staging | `staging.aula.onlyonecoin.edu.pe` · Postgres gerenciado (Neon, branch de staging) |
| Produção | `aula.onlyonecoin.edu.pe` · Postgres gerenciado (Neon) |

- Netlify: `main` → produção, `staging` → branch deploy, PR → deploy preview
- Variáveis de ambiente **por contexto** do Netlify
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
- `audit_log` append-only: sem grant de UPDATE nem DELETE, nem para admin
- Ley 29733: consentimento com timestamp, versão do texto e IP; política de retenção; exclusão a pedido

**Papéis (quadro redefinido pelo dono, 07/09/2026):** `master`, `admin`, `analyst`, `enrollment_supervisor`, `academic_supervisor`, `teacher`, `sales`, `support`, `billing`. Aluno e apoderado: `student`, `guardian`. Substituiu o quadro antigo (`coordinator`, `treasury`, `mass_approver` deixaram de existir; grosso modo: coordinator → enrollment_supervisor, treasury → billing, mass_approver extinto — aprovação é de admin/billing).

- **`master`** é o cargo dos donos da plataforma: vê e faz tudo, e **só conta com e-mail `@nrlabsdigital.com`** pode carregá-lo (`canHoldMaster`, `apps/app/src/lib/backoffice/permissions.ts`). O mesmo domínio — e não o cargo — é o que abre a seção **Funcionalidades** (§5): lá quem decide é `isOwnerEmail`, então um `admin` da Asociación é recusado e um dono passa com qualquer cargo.
- **`admin`** vê tudo e autoriza. **`analyst`** (assistente/analista da administração) observa todas as áreas e propõe solução, mas **não aprova nem edita nada**.
- **`enrollment_supervisor`** cuida do lado acadêmico das matrículas (alunos, matrículas manuais, cursos/turmas); **`academic_supervisor`** supervisiona os docentes.
- **`sales`** (vendedor) e **`support`** (atenção ao cliente) leem alunos/matrículas; **`billing`** (facturación) liquida dinheiro e não vê dado acadêmico não financeiro.
- A matriz tela-a-tela vive em `apps/app/src/lib/backoffice/permissions.ts`. O backend já fala o quadro novo: `Role` em `packages/domain/src/identity/Role.ts` (com `MASTER_EMAIL_DOMAIN`/`canHoldMaster`), as rotas de `apps/api` declaram os cargos novos, e a migration `0009` troca os CHECKs de `user.role` e `staff_invites.role`. O convite recusa `master` fora do domínio dos donos na própria rota (`CreateStaffInviteRoute`). Pendente: a tabela RBAC de `docs/ARCHITECTURE.md` §3 ainda descreve o quadro antigo.

Emitem documento (constancia, certificado) e disparam o lote de uma turma: `master`, `admin`, `enrollment_supervisor`, `academic_supervisor`, `teacher` — o docente **só nas próprias turmas**, checado no usecase. `billing` não emite. Toda emissão e todo reenvio de e-mail vão para o `audit_log`.

### Pontos de entrada separados (portal ≠ backoffice)

Um **único backend de auth** (um só provedor de auth, um só registro de usuários) — a separação de acesso é a checagem de **`role`** em `apps/api`, nunca a tela. Mas **duas telas de login distintas**, pelo mesmo app Next.js (não são dois deploys):

- **Portal do aluno** — `/` ou `/portal`, linkado da landing, indexável, sem MFA. **Sem auto-cadastro**: o aluno recebe credenciais por e-mail após aprovação, não se registra.
- **Backoffice** — path discreto (`/backoffice`), **nunca linkado na landing nem indexável**, MFA no fluxo. É defesa em profundidade, não a defesa.
- **Docente** entra pelo backoffice, mas vê só as próprias turmas — checagem no usecase, não filtro solto.
- **Redirect por `role` sempre server-side.** O cliente nunca escolhe "sou aluno/sou admin"; o `role` vem do banco, lido por `apps/api`.

### Gestão de cargos — anti-escalada de privilégio

O `role` **nunca** mora em lugar que o próprio usuário escreve. Regras duras:

- `role` vive em coluna protegida na própria tabela `user` gerenciada pelo Better Auth (`additionalFields.role`, `input:false` — API pública de signup/update não aceita esse campo). `apps/api` **não expõe rota genérica de `UPDATE`** nela — a única forma de mudar `role` é um usecase dedicado de promoção (não um `PATCH` de usuário comum), nem para o próprio dono, nem para admin comum fora desse fluxo.
- **Nunca** guardar `role` em algo editável pelo usuário (ex.: `user_metadata` de provedores de auth que expõem isso). `input:false` garante que o `role` do Better Auth é preenchido **server-side**, nunca a partir do payload de cadastro/perfil do usuário.
- `apps/api` lê o `role` a partir do registro do usuário autenticado no banco a cada requisição sensível — **nunca** de header/JWT montado pelo cliente.
- Toda mudança de cargo → `audit_log` append-only.

**Modelo de criação de staff (fechado):**

1. **Bootstrap:** o primeiro `admin` nasce por **script versionado** (`apps/api/src/scripts/seed-admin.ts`, `pnpm --filter @ooc/api seed:admin`) — não por migration SQL de mão: a senha precisa do hash real do Better Auth, que uma migration não consegue reproduzir sem reimplementar o hasher. O script assina o cadastro pelo próprio `auth.api.signUpEmail` (hash correto) e só então promove `role` pra `admin` direto no banco — o único ponto autorizado a contornar `additionalFields.role.input:false`, porque nunca roda sobre HTTP. Local/dev apenas; nunca apontar pra staging/produção. Credencial de desenvolvimento: `admin@admin.com` / `admin1234` (Better Auth recusa senha com menos de 8 caracteres — não foi afrouxado pro seed).
2. **Depois:** **só `admin`** cria/promove staff, pela UI, via usecase dedicado (`PromoteUserRoleUseCase`, `packages/domain/src/identity/`) que exige **re-autenticação fresca** do admin. Nenhum outro papel promove ninguém. O plugin `admin` do Better Auth não garante reautenticação fresca sozinho — é o usecase, não o provedor, que impõe essa checagem antes de escrever o `role`.

---

## 9. Como trabalhar comigo

- **Não invente regra de negócio.** Se eu der um exemplo, é exemplo — não generalize para regra. Em dúvida, pergunte.
- **Pergunte antes de assumir** volume, preço, nome de curso, quantidade de turmas.
- Mudança de banco = migration versionada. Nunca `psql` direto em ambiente remoto.
- Commits pequenos e em inglês, no formato convencional (`feat:`, `fix:`, `chore:`).
- Antes de escrever código novo, diga em uma linha o que vai fazer e onde.
- Se um pedido meu contradisser este arquivo, **avise antes de executar**.
- Prefira explicitar o trade-off a escolher em silêncio.

---

## 10. Documentação viva

**Nenhuma decisão de arquitetura termina no código.** Toda sessão que fecha, muda ou reverte uma decisão — de stack, de modelo de autorização, de RBAC, de fluxo de negócio — só está pronta quando a documentação reflete isso. "Depois eu atualizo" não é aceitável: a doc desatualizada é o que faz a próxima sessão (minha ou sua) tomar decisão em cima de premissa errada.

- **`CLAUDE.md`** é a fonte da verdade — qualquer decisão fechada (stack, arquitetura, regra de negócio confirmada) vive aqui, sempre que a mudança tocar algo que já está neste arquivo.
- **`docs/ARCHITECTURE.md`** guarda o detalhe que não cabe no `CLAUDE.md` sem inchar (ex.: tabela completa de RBAC, comparação de caminhos de decisão, checklist de segurança) — `CLAUDE.md` referencia, não duplica.
- **`README.md`** reflete o **estado real do repo** — o que existe hoje, não o plano. Se `Estado atual` descreve algo que não é mais verdade, é bug de documentação, trato como trato bug de código.
- **`docs/ROADMAP.md`** é atrelado ao contrato — sinalizar quando ficar desatualizado, **nunca editar sem confirmação minha**.
- Doc nova (ex.: `docs/ARCHITECTURE.md`) é linkada na seção "Documentos" do `README.md` no mesmo commit que a cria — doc órfã não existe pra quem não sabe procurar.

Antes de considerar uma sessão pronta: **alguma doc ficou desatualizada com o que acabei de fazer?** Se sim, atualiza antes de terminar, não depois.
