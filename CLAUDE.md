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
  → IA extrai os dados e valida contra o preço do plano (só valida — nunca aprova)
  → uma pessoa aprova em Pagos: o aluno recebe o link para criar a senha do portal e o e-mail de aprovação
  → duvidoso: vai pra revisão marcado, e uma pessoa decide do mesmo jeito
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
- **Nota lançada não se altera (decisão 08/10/2026).** O docente lança **uma nota por aluno: a do exame final, que é a nota do módulo** (mesma lógica do exame de rezagados, `docs/REGRAS-NEGOCIO.md` §3) — uma vez, numa ficha de notas, sozinha ou em lote, com confirmação antes de gravar; depois ela fica travada. A nota vai de 0 a 20 e **aceita decimais**; a aprovação é a nota mínima de `platform_settings.passing_grade` (OOC-41, hoje **14**) — lida da API, nunca constante no código —, comparada como digitada (nenhuma regra de arredondamento foi definida — não inventar). Quem não fez o exame final é marcado **DA** por um botão próprio, e DA ocupa o lugar da nota. **A turma sai do portal do docente quando a coordenação a fecha** — enquanto está só finalizada ela fica, porque a nota do exame final e o relatório vêm depois da última aula. **Em aberto:** quem corrige uma nota lançada errada — hoje não há caminho na plataforma.
- **Emissão de certificado é em lote por turma, com gate humano.** O sistema deixa a lista pronta; a coordenação confirma. Nunca disparo automático por data — quem concluiu é decisão da coordenação. Detalhe em `docs/DOCUMENTOS-E-CERTIFICADOS.md`.
- **Matrícula aberta pelo backoffice é a exceção, não um segundo caminho.** O fluxo acima continua sendo o normal: o aluno preenche `/matricula` e sobe o comprovante. Para a venda que fechou no WhatsApp e nunca chegou ao formulário, `admin` e `enrollment_supervisor` podem abrir a matrícula pelo painel (`/backoffice/enrollments`), sob quatro travas: **(a)** só sobre aluno **já cadastrado** — registrar pessoa é outro fluxo, porque carrega o consentimento do apoderado (§8); **(b)** o preço é o **vigente do plano, somente leitura** — não há desconto, nunca; **(c)** a vaga entra como `reserved`, nunca `confirmed`; **(d)** o pagamento **nunca nasce aprovado** — o comprovante entra na mesma escada de OCR e na mesma fila de revisão (`apps/api/CLAUDE.md`). Quem abre a matrícula não liquida o dinheiro dela. A seção inteira (`/backoffice/enrollments`) é de `admin` e `enrollment_supervisor`: `billing` liquida dinheiro em Pagos e o docente chega aos seus alunos pela turma (`docs/ARCHITECTURE.md` §3).
- **Matrícula só existe nas listas depois que o dinheiro é confirmado (OOC-55, 01/10/2026).** Matrículas mostra só vaga `confirmed`; Alunos esconde quem tem matrícula reservada e nenhuma confirmada (o seletor da matrícula manual ainda acha, pra não duplicar ficha). **Cada lista abre no que está aberto (OOC-113, 12/10/2026):** Pagos em Abertos (`pending`/`under_review`), Matrículas em Vigentes (turma `enrolling`/`in_progress`) e Alunos em Ativos — aluno **ativo** é quem tem matrícula vigente, não quem algum dia teve vaga confirmada; quem só tem matrícula de turma encerrada é ex-aluno, e o status muda com a turma, sem escrita no aluno. O resto fica a uma aba de distância, com contador. Tudo que está aberto — pendente, em revisão — vive em **Pagos**, e é lá que `master`/`admin`/`billing` aprovam (vaga `reserved → confirmed`, e-mail `payment_approved`) ou rejeitam com motivo (vaga `released`, devolvida à turma, e-mail `payment_rejected`). **Aprovação nunca é automática (decisão do dono, 03/10/2026):** o semáforo do comprovante (OOC-21) só valida — marca de verde o pagamento cujo valor, nº de operação e meio de pagamento lidos batem, e ele continua `pending` esperando uma pessoa; amarelo e vermelho vão pra `under_review` (`apps/api/CLAUDE.md`, Semáforo). Aprovar vale também para pagamento `pending` (sem OCR, todo checkout fica `pending`); sem comprovante, a tela avisa e não bloqueia. Rejeitada não volta pra Matrículas. **Fora:** cron da janela de 5 dias. **Conta do portal (reaberto em 05/10/2026):** a primeira aprovação cria a conta do aluno (`"user"`, papel `student`, ligada por `students.user_id`) e envia `portal_credentials` com um link de definir senha — nunca a senha; e-mail já usado por outra conta não cria e não trava a aprovação (vira aviso e `audit_log`); a ficha tem o botão *Enviar acesso ao portal* para quem foi aprovado antes ou para depois de corrigir o e-mail. Login por e-mail **ou** documento, recuperação por link de 1 h, sem auto-cadastro (`disableSignUp`). **Em aberto:** editar o e-mail de contato da ficha (o formulário da ficha ainda é mock) e trocar o e-mail de login de uma conta não estão construídos — então um conflito de e-mail só se resolve quando isso existir; a cópia do painel diz que o e-mail precisa ser corrigido, sem prometer edição ali. Desenho em `docs/superpowers/specs/2026-10-05-student-auth-design.md`.
- **Cadastro manual de aluno pelo backoffice** é o par do item acima: a matrícula manual só age sobre aluno já cadastrado, então o cadastro da pessoa é um fluxo próprio (`/backoffice/students`, `admin` e `enrollment_supervisor`). O **apoderado é opcional** — e deixa de ser no instante em que a data de nascimento diz que o aluno é menor de idade, quando passa a ser obrigatório. O **consentimento (Ley 29733) nunca é digitado ali**: quem aceita é o apoderado, com a data, a versão e o IP dele; a ficha nasce com o consentimento pendente. O cadastro não matricula ninguém.
- **Corrigir a ficha é dos mesmos três do cadastro (decisão 07/10/2026, OOC-74):** `master`, `admin` e `enrollment_supervisor` editam aluno e apoderado (`STUDENT_FILE_ROLES`, `apps/api/src/http/student/studentRoles.ts`); `support` não corrige nem contato. É o único caminho que reescreve nome, documento e nascimento, preso às regras do cadastro: documento que já está em outra ficha é recusado, e nascimento que torna o aluno menor exige apoderado antes. Aluno sem apoderado ganha um pela ficha, com consentimento pendente.
- **Exportar o diretório de alunos é dos mesmos três da ficha (OOC-121, 23/10/2026 — proposta do ticket, a confirmar com o dono).** `STUDENT_EXPORT_ROLES` (`apps/api/src/http/student/studentRoles.ts`): `master`, `admin`, `enrollment_supervisor`. O arquivo leva documento, e-mail e celular, e só exporta quem já os vê na ficha; `sales`/`support` atendem um aluno por vez e não levam a base. Sai o que a tela filtra (aba, busca, filtro de idade), todas as páginas, gerado no servidor. Toda exportação vai pro `audit_log` **antes** da primeira linha (`student.directory_exported`: aba, filtro, se houve busca — nunca o texto dela, que é nome ou documento — e quantas linhas) e tem rate limit próprio por conta (`studentExport`, 10/h, provisório).
- **Docente tem contrato com vigência, e o painel vigia o vencimento.** O contrato fica registrado como o **período que cobre** (início e fim) — o arquivo não é mais guardado (OOC-124, 24/10/2026). O painel marca o contrato como *a vencer* a partir de **45 dias** do fim (`platform_settings.contract_alert_days`, editável em Configuração desde a OOC-41 — número provisório, a confirmar), *vencido* assim que a data passa, e *sem contrato* quando não há nenhum registrado — esse último é um achado, não uma célula vazia. **Registrar é gerar:** *Generar contrato* na ficha pede o período, grava o registro (período, quem gerou e a **versão publicada do modelo** usada, editado em Configuração → Documentos) e devolve o PDF preenchido com os dados da ficha — montado na hora, **nunca guardado**; o mesmo registro reimprime pela versão gravada (*Descargar*), com os dados da ficha de hoje. `audit_log` `teacher_contract.generated` / `teacher_contract.regenerated`. Gera quem corrige a ficha; baixa quem lê o quadro (o `analyst` também), não o próprio docente. **Decisão do dono (23/10/2026):** a cópia assinada fica fora da plataforma (Drive da coordenação) — o envio do assinado pela ficha saiu (o código da OOC-81 está no histórico do Git), e volta como opcional só se alguém pedir. Os contratos arquivados como PDF antes disso continuam baixáveis (link de 5 min, `audit_log`). Mecanismo em `apps/api/CLAUDE.md`, "Contrato do docente".
- **Catálogo sai do ar, não some (decisão 22/09/2026).** Curso, plano, turma e período são **aposentados** (`deleted_at`), nunca apagados — a matrícula que aconteceu neles continua apontando pra eles, e o livro de matrículas continua mostrando toda matrícula confirmada sobre o que saiu do catálogo (a que ainda espera dinheiro vive em Pagos). Aposentar **não é bloqueado por matrícula viva**: segue o mesmo princípio do docente saindo do quadro (item abaixo) — avisa, não trava. A resposta diz quantas matrículas ainda estavam de pé (não aposentadas e com vaga não devolvida), porque o curso cuja última turma ainda roda é exatamente o que alguém precisa parar de vender. Não cascateia em escrita e não precisa: as leituras do catálogo filtram cada tabela de que tratam, então aposentar o curso tira os planos e turmas dele do ar sozinho — e reativar traz de volta. Quem aposenta e reativa é quem abre turma: `admin` e `enrollment_supervisor` (mais `master`); tudo vai pro `audit_log`. **Reativar existe de propósito** — sem ele um id errado seria irreversível, porque §6 não deixa DELETE e §7 não deixa SQL de mão em produção.
- **Curso é uma jornada de módulos, cada um com seu material (OOC-94, 26/10/2026).** O curso guarda, além da quantidade de módulos, **um link de material por módulo** — `https` em `drive.google.com` ou `docs.google.com`, nada mais, porque o link vira `href` na tela do docente. O link é **exigido ao criar o curso e sempre que a quantidade ou um link muda**; o curso anterior a isso, sem material, aparece com o selo *Sin material* e continua editável nas outras opções — avisa, não trava. Edita quem edita as opções do curso (`master`/`admin`/`enrollment_supervisor`); trocar o link substitui o anterior, e o `audit_log` guarda só que o campo mudou. É desse link que o portal do docente lê o material do módulo (OOC-100). Desenho em `docs/superpowers/specs/2026-10-26-course-modules-design.md`.
- **Idioma do curso é texto livre, gravado numa grafia só (27/10/2026).** Não existe tabela de idiomas: Cursos, Turmas e o checkout agrupam pela string de `courses.language`, então `INGLES` ao lado de `Inglés` abria um segundo inglês. Idioma é comparado **sem maiúscula, acento nem espaço sobrando** (`packages/domain/src/catalog/courseLanguage.ts`, espelhado em `apps/app/src/lib/backoffice/teacher-allocation.ts` para o docente que ensina o idioma). Ao criar curso — ou mover um curso para outro idioma — a API grava a grafia que os cursos vivos já usam (a mais usada); redigitar o idioma do próprio curso fica como digitado, que é como se corrige uma grafia errada, curso a curso.
- **Docente sai do quadro, não some.** `inactive` é o que a coordenação marca quando alguém para de dar aula (contrato vencido, ciclo encerrado) — nunca apagar: quem assinou nota e deu turma continua apontado por elas. Sair do quadro **para a vigilância do contrato**: o alerta existe para impedir alguém de dar aula com contrato vencido, e quem está inativo não dá aula. O documento continua arquivado na ficha. **Sair do quadro também fecha a conta do painel vinculada ao docente, e voltar reabre** (decisão 12/10/2026, OOC-78): quem não dá aula não tem turma para abrir, e conta aberta é porta para as notas dos alunos. Corrige ficha, disponibilidade e quadro `master`/`admin`/`academic_supervisor`; cadastra só `master`/`admin`; `analyst` só lê. O painel avisa quando ainda há turma em andamento apontando para o docente que está saindo — avisa, não bloqueia: quem larga no meio do ciclo é caso real, e travar deixaria a ficha presa.
- **A conta do docente pertence a uma ficha, e o cargo `teacher` só entra pelo convite e só sai pelo quadro (OOC-79, 22/10/2026).** O convite de cargo `teacher` nomeia a ficha — ativa, sem conta e sem outro convite aberto — e aceitá-lo grava `teachers.user_id`; é esse vínculo que dá ao docente as próprias turmas e a própria ficha (que ele lê, nunca edita). Trocar o cargo de uma conta para `teacher`, ou de `teacher` para outro, **não existe** em Equipe: quem para de dar aula sai do quadro (fecha a conta), e quem vira docente sendo de outro cargo recebe um convite novo, com outro e-mail — uma conta, um cargo. *Restaurar acesso* em Equipe recusa a conta de docente fora do quadro: só voltar ao quadro reabre. Conta `teacher` sem ficha (aberta antes desse vínculo) aparece em Equipe como achado. Mecanismo em `apps/api/CLAUDE.md`, Gestão de cargos.
- **O e-mail do aluno tem que ser uma conta pessoal do Gmail.** Não é preferência: o formulário atual recusa em maiúsculas conta institucional e corporativa, porque o acesso à aula chega por Google Classroom. Endereço de colégio que morre em dezembro é aluno que perde o curso que pagou. Vale para o aluno; o e-mail do apoderado pode ser de qualquer provedor. **Desde 07/10/2026 o checkout prova o Gmail:** o passo do aluno só avança com o código de 6 dígitos enviado ao endereço, e o nome de usuário do Gmail que não pode existir (fora de 6–30 caracteres, com `+`, `_`, ponto na ponta ou dois seguidos) é recusado em todo e-mail novo `@gmail.com`, no checkout e no backoffice. O apoderado não recebe código. Detalhe em `apps/api/CLAUDE.md`, Verificação do e-mail.
- **O celular é pedido no formulário de matrícula.** A regra "nunca pedir número de telefone" (`docs/REGRAS-NEGOCIO.md` §5) governa a **conversa de venda no WhatsApp**, onde o número já é conhecido — não o formulário, que sempre teve coluna `CELULAR`.
- **O botão da landing leva a página, não o curso (OOC-117, 12/10/2026).** A landing é estática e manda `?course=<chave da página>` (`english`, `english-kids`, `french-advanced`…, lista fechada em `LANDING_COURSE_KEYS`, `packages/domain`), nunca o id: o mapa de UUIDs que ela carregava nunca casou com nenhum catálogo e o checkout abria vazio sem ninguém ver. Quem diz qual curso responde por uma página é o backoffice — campo *Página en la web* do curso, `master`/`admin`, um curso vivo por página (aposentar solta a página). Curso recriado precisa ser ligado de novo; a tela de Cursos lista as páginas sem curso ligado. O checkout aceita chave **ou** id (o link do vendedor continua com id) e segue sendo pré-seleção: página sem curso ligado com turma aberta abre o passo 1 vazio. Detalhe da landing em `apps/landing/CLAUDE.md`.
- **Data de início e horário são escolhas separadas.** O mesmo curso abre em várias datas — começar esta semana ou com a turma do fim do mês — e cada data tem seus três ou quatro horários. Quem abre turma é `admin`/`enrollment_supervisor` pelo backoffice; o checkout público lê o que estiver aberto.
- **Turma nasce rascunho e avança por mão (OOC-35, 01/10/2026).** Rascunho fica fora do checkout e da matrícula manual; publicar exige datas. A **janela de inscrição** é opcional (vazio = sem limite). O status só avança, **um passo por vez, sempre por uma pessoa** (`draft → enrolling → in_progress → finished → closed`) — nunca por data. **Duplicar período** copia curso, horário, docente e capacidade, dá a cada cópia um código novo, e zera datas, janela e vagas ocupadas, sem matrícula, espera ou hold; roda uma vez por par (origem, destino). **Docente vem do cadastro (OOC-80, 12/10/2026):** a turma aponta para `teacher_id`, escolhido entre os docentes **ativos** que ensinam o idioma do curso — a API checa ao atribuir e ao trocar o curso, nunca uma atribuição intocada, então quem sai do quadro no meio do ciclo continua na turma que deu. O texto livre antigo (`class_groups.teacher_name`, fica até o passo de contract, §7) não vira vínculo sozinho: sobra só como pista nas turmas ainda sem docente, que o painel destaca, e é apagado quando alguém vincula. Horário fora da disponibilidade declarada ou em cima de outra turma do docente no mesmo período **avisa, não bloqueia**. **Lista de espera é manual no backoffice** (só entra quando a turma está cheia) e a matrícula manual fecha a entrada; espera no checkout continua Sessão 22. Quem cria, edita, publica e duplica turma é `master`/`admin`/`enrollment_supervisor`; `academic_supervisor` só lê.
- **O código da turma é gerado, nunca digitado (27/10/2026, pedido do Rick).** Ao criar a turma a API tira o próximo número de uma sequence do Postgres (`class_group_code_seq`) e grava `A-` + o número com pelo menos 5 dígitos (`A-00042`; passa de 99.999 sem cortar dígito) — `classGroupCodeOf`, `packages/domain/src/catalog/ClassGroup.ts`. **Ninguém edita:** o campo saiu do formulário e create/update da API ignoram um `code` enviado; o código é o nome estável da turma no papel, no portal do docente e no relatório de notas. É opaco de propósito — curso e período aparecem ao lado dele em toda tela, e um código com sigla de curso envelheceria junto com o nome do curso (idioma é texto livre). Duplicar período dá código novo a cada cópia. Turma antiga fica com o código que tem; a que estava sem código ganhou um da mesma sequence na migration `0039`. **Sem índice único:** a importação antiga pode ter gravado o mesmo `<curso>-<data>` duas vezes — a garantia dos códigos novos é a sequence.
- **A turma leva o link do Classroom, colado junto do docente (OOC-98, 27/10/2026).** Um link só — o Google Classroom da turma, onde o Meet vive —, `https` em `classroom.google.com`, campo logo abaixo do seletor de docente no formulário da turma (mesmos papéis que editam turma). **Opcional:** atribuir docente não exige link, e a lista marca *Sin Classroom* nas turmas em inscrição ou em andamento sem ele — avisa, não trava. O docente vê o link no portal dele (`/teaching/*`, escopo do usecase) e o aluno no portal só com **vaga confirmada** — a API manda `null` para vaga reservada ou devolvida. Duplicar período **não copia** o link (turma nova, Classroom novo). `audit_log` guarda só que o campo mudou. **Em aberto (dono):** dois critérios do ticket contradizem regra fechada e não foram construídos — "não atribuir docente sem o link" (a OOC-80 já atribui sem, e há turmas assim em produção) e "a turma fica ativa após a atribuição" (pela OOC-35 o status só avança por uma pessoa). Desenho em `docs/superpowers/specs/2026-10-27-class-group-classroom-link-design.md`.
- Comprovante: retido por **5 anos**. Só a **versão processada/reduzida** (pós downscale/grayscale da OCR, `apps/api/CLAUDE.md`) é retida — não o upload original bruto.
- **Exame de clasificación é o portão do inglés intermedio/avanzado e do Cambridge (decisão 02/09/2026).** Ninguém entra nesses níveis sem aprovar o exame, que é **pago** (valor vigente na tabela de procedimentos, `docs/REGRAS-NEGOCIO.md` §3/§5). Hoje roda em Google Forms com correção manual; na plataforma vira exame online com **resultado calculado automaticamente**. Aprovado → segue pra pagar o nível alto (paquete ou mensual); reprovado → começa do básico. **Em aberto no desenho:** se o exame pode ser feito sem registro prévio (resultado → opção de matricular) ou se exige registro antes — os dois caminhos foram descritos, qual (ou se ambos) fica pra hora de desenhar o fluxo. Validade do resultado também não foi definida.
- **Quem já é aluno não volta pelo site público (decisão 02/09/2026).** Repetir módulo, exame de rezagados (pago), próximo nível e re-matrícula saem do **portal do aluno**, puxando o cadastro existente — nunca duplicando `student`. E-mails de gatilho convidam pro próximo curso/nível. As solicitações pagas do portal seguem o mesmo padrão da constancia: solicitação com pagamento associado, comprovante + OCR + fila de revisão.
- **Um documento, uma pessoa, uma ficha (decisão 21/09/2026).** O par `(national_id_type, national_id)` identifica o aluno — nunca o nome, nunca o e-mail. Até esta data todo caminho que escrevia aluno fazia `INSERT` cego, então o mesmo DNI abria tantas fichas quantas vezes fosse digitado, e cada ficha levava um pedaço do histórico junto (matrícula e pagamento penduram no `student_id` que estava valendo naquele dia). Agora:
  - **O checkout público reaproveita a ficha existente.** Achou o documento, matricula sobre aquela pessoa e **atualiza só o contato** que ela acabou de redigitar (e-mail, celular, país/região/cidade). Nome, documento e data de nascimento ficam intactos — corrigir isso é ato de staff com trilha de auditoria, não efeito colateral de um checkout. Idem para o apoderado: `guardians.student_id` é único, então a ficha do apoderado é atualizada no lugar e o **consentimento novo é anexado** (a tabela `consents` é append — cada aceite é um registro, com versão, data e IP).
  - **O cadastro manual recusa.** Documento já na base → `StudentAlreadyRegisteredError` (422) e a tela manda procurar no diretório. A diferença é intencional: no checkout quem digita é a própria pessoa, então dá pra levá-la de volta à ficha dela; no painel é um terceiro afirmando que uma pessoa nova existe, e um formulário de criar não pode reescrever em silêncio os dados de um estranho por causa de um DNI errado.
  - **Apagar ou invalidar a ficha antiga está fora** — §6 proíbe delete físico em `student`, e invalidar a antiga partiria o histórico entre dois ids que as FKs (`onDelete: restrict`) seguram de pé.
  - **Em aberto:** o índice único em `(national_id_type, national_id)` ainda **não existe**. Vai em duas etapas (§7, expand/contract): primeiro consolidar as duplicatas que já estão na base — `pnpm --filter @ooc/api report:duplicate-students` lista cada documento repetido e quantas matrículas cada cópia carrega —, depois a migration do índice parcial (`where deleted_at is null`). Enquanto ele não existe, a garantia é só de aplicação: duas gravações simultâneas do mesmo documento ainda passam.
  - **Documento normalizado na escrita (OOC-64, 03/10/2026).** Todo caminho que grava aluno ou apoderado passa pelas regras de `packages/domain/src/student/fields.ts`: o número sai sem ponto, traço e espaço, em maiúsculo, e só então é buscado e gravado — `12.345.678` e `12345678` são a mesma ficha daqui pra frente. **Em aberto:** as fichas gravadas antes disso continuam com o valor cru, então a busca do checkout e o `report:duplicate-students` (que comparam a string) não casam uma ficha antiga com pontos com o mesmo documento digitado limpo — já o login do portal por documento casa, porque normaliza a coluna em SQL (índice de expressão `students_portal_national_id_idx`, `apps/api/CLAUDE.md`, Auth do aluno). Normalizar o que já está na base é migration de dados — vai junto da consolidação das duplicatas, antes do índice.
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

| Camada | Escolha | Estado (07/10/2026) |
| --- | --- | --- |
| Site público | **Astro** (estático) | no ar na Vercel; o domínio ainda aponta pro WordPress antigo (OOC-44) |
| App (portal + backoffice + checkout) | **Next.js App Router**, next-intl, shadcn/ui sobre Tailwind v4 | no ar na Vercel |
| API de domínio + workers | **Fastify** (`apps/api`) — HTTP e workers de fila num processo só | no ar no Fly.io |
| Hospedagem | **Vercel** (landing + app) · **Fly.io** (`apps/api`, GRU/São Paulo, VM always-on, deploy blue-green) | deploy por GitHub Actions a cada push em `main`. Funções do app em `gru1` (`apps/app/vercel.json`, OOC-119) — no padrão `iad1` cada chamada à API cruzava o continente |
| Banco | **Postgres** gerenciado — **Neon** (`sa-east-1`), Drizzle ORM + Drizzle Kit | em uso |
| Storage | **Tigris** (Fly.io, S3-compatible) — comprovantes e backups | em uso |
| Auth | **Better Auth**, embutido em `apps/api`, nunca instanciado em `apps/app` | em uso (staff e aluno); MFA do staff por código de e-mail (OOC-29) |
| Fila | **Redis self-hospedado no Fly.io** (`redis-nrlabs`, repo NR-Labs/services) **+ BullMQ**, chaves sob `ooc:` (`QUEUE_PREFIX`) | em uso |
| Rate limit + idempotência | **Mesmo Redis**, aplicado **dentro de `apps/api`** (a borda da Vercel não alcança a rede privada do Fly) | em uso (OOC-24) |
| Captcha | **Cloudflare Turnstile** | em uso (checkout e recuperação de senha) |
| OCR / IA | **OpenRouter** pra todos os níveis — **Gemini 3.1 Flash-Lite** (nível 1) · outra família (nível 2, a escolher) | nível 1 em uso; nível 2 não escala (Sessão 29) |
| E-mail transacional/campanhas | **Brevo**, atrás de `NotificationProvider` | em uso, autenticado no domínio raiz (DKIM + DMARC `p=none`) |
| E-mail de staff (caixa) | **Google Workspace** — o que já roda no domínio | em uso |
| DNS | **Cloudflare** (só DNS) | nameservers já no Cloudflare |
| Backup | `pg_dump` → Tigris (`only-one-coin-backups`) **a cada deploy da API**, antes da migration; retenção de 30 dias | em uso. Backup agendado arquivado (07/10/2026) — o por deploy é a política |
| Observabilidade | **Sentry** + **PostHog** (EU Cloud) | escolhidos, **não instalados** |
| Templates editáveis (documentos, e-mail) | **LiquidJS**, embrulhado em `packages/templates` (decisão 23/10/2026, OOC-123) | em uso no contrato do docente (rascunho, preview, publicação) |
| HTML → PDF (documentos) | **WeasyPrint**, chamado como comando pela API, instalado na imagem (decisão 23/10/2026, OOC-123) | em uso no preview; VM da API em 512 MB por causa dele |

Não trocar nada disso sem me perguntar. **Avaliados e descartados:** Clerk, Pinecone, Resend, Cloudflare CDN, Netlify, Upstash, Zoho Mail, chamada direta ao Google (`@google/genai`), o provedor de backend gerenciado que cobria Postgres + auth + storage. Realtime não tem uso hoje — decidir quando aparecer o primeiro.

**Por que cada escolha não óbvia (para não reabrir):**

- **Vercel** (31/08/2026, revertendo Netlify): mesma conta/organização para um possível terceiro frontend. Hoje `apps/app` continua **um único Next.js** — desmembrar não está decidido.
- **API e workers no mesmo processo** (31/08/2026): o Fly hospeda `apps/api` como uma VM always-on única, então dois entrypoints não compravam nada.
- **Redis self-hospedado, sem Upstash** (03/10/2026). **Em aberto (OOC-119):** o `redis-nrlabs` roda em `iad` e a API em `gru`, então todo request paga ~140 ms de rate limit antes de qualquer SQL (até o `/health`). Mover ou ter um Redis em `gru` é decisão do repo NR-Labs/services, que é compartilhado.
  O porquê do self-hospedado: o pay-as-you-go cobra por comando e o BullMQ é conversador. Custo aceito: rajada contra a rota pública chega ao processo da API, que recusa com 429 antes do banco. Users de ACL do Redis precisam de `+info`, senão o BullMQ derruba o boot com `NOPERM` (incidente de 03/10/2026).
- **OCR via OpenRouter** (02/10/2026): o nível 2 exige outra família, e com uma chave só o nível vira um id de modelo (`RECEIPT_OCR_TIER1_MODEL`/`RECEIPT_OCR_TIER2_MODEL`); o boot recusa nível 2 da mesma família do 1. Custo: um intermediário a mais com dado pessoal (Ley 29733) — por isso a chamada exige **retenção zero** (`zdr`), sem coleta de dados e `require_parameters`. Detalhe em `apps/api/CLAUDE.md`.
- **WeasyPrint, não Chromium** (23/10/2026): motor de impressão (CSS de página, cabeçalho corrido, contador de páginas) sem navegador nem JavaScript — ~60 MB e ~0,5 s por render contra centenas de MB de um Chromium. Sem serviço novo: roda dentro da VM da API, que foi a 512 MB. O texto do documento é editado num editor visual (quem edita não sabe HTML); o layout é uma moldura no código.
- **LiquidJS para template editável** (23/10/2026): LiquidJS ou Handlebars eram aceitos; LiquidJS ganhou por ser feito para texto editado pelo usuário final (sem código, limite de render) e por ter análise estática — o placeholder errado é recusado ao salvar, com linha e coluna, sem renderizar. **Todo template reutilizável do projeto passa por `packages/templates`**, nunca por um `new Liquid()` solto: é lá que vivem as travas (sem `include`/`render`/`layout`, escape, modo estrito) e os filtros `money`/`local_date`. Detalhe no `README.md` do pacote.
- **Google Workspace, não Zoho** (07/10/2026): o domínio já roda no Workspace; Brevo não hospeda caixa, então Brevo envia e o Workspace recebe.
- **Better Auth** é biblioteca, não serviço: `role` travado contra escrita do cliente (`additionalFields.role`, `input:false`). Padrão de integração em `docs/ARCHITECTURE.md` §5.6.
- **Autorização na camada de aplicação, não em RLS** — motivo em `docs/ARCHITECTURE.md` §2. RLS pode voltar como defesa extra, nunca como o mecanismo de aceite.

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
  notifications/     NotificationProvider, templates de e-mail trilíngues, adapter Brevo e guarda de allowlist
  ocr/               adapter OpenRouter do OCR (um por nível, só muda o modelo) atrás da porta IReceiptExtractor do domínio — só os workers de apps/api importam
  templates/         engine de templates do projeto (LiquidJS travado): tipo de template = schema zod dos placeholders + amostra pro preview; check estático, render com escape e formatação nossa
```

Hoje existem `domain/`, `queue/`, `notifications/`, `ocr/`, `templates/` e `db/`. `i18n` e `shared` não viraram pacote — cada app tem as próprias mensagens (`apps/*/src/i18n/`, `apps/*/src/messages/`) e não há tipo/utilitário cross-app que já justifique extrair um `packages/shared`.

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
| Notificações (outbox, `NotificationProvider`, allowlist de staging) | `apps/api/CLAUDE.md` |
| Fronteira `packages/domain` (DDD puro, exceção do vocabulário de erro HTTP) | `packages/domain/CLAUDE.md` |
| Feature flags das três superfícies | `apps/app/CLAUDE.md` |
| Layout de tela do backoffice/portal (`AutoGrid`, container query) | `apps/app/CLAUDE.md` |
| Regras de celular do backoffice/portal | `apps/app/CLAUDE.md` |
| Layout da landing (`--dp`, as duas larguras de desenho) | `apps/landing/CLAUDE.md` |
| Disciplina de migration e convenções de schema | `packages/db/CLAUDE.md` |

**Número de regra nunca é constante no código — nem na API, nem na tela (OOC-41; subiu pra raiz em 23/10/2026).** Nota mínima, prazo do certificado, janela de revisão, tolerância do comprovante, alerta de contrato e os demais parâmetros vivem em `platform_settings` (tabela completa em `apps/api/CLAUDE.md`, "Configurações da plataforma"). Tela que aplica um deles lê `getPlatformSettings()` (`GET /settings`) no servidor e passa o número como prop; leitura que falha mostra o estado de erro (`settings.rules_load_error_*`), nunca um valor de fallback que parece real. A regra morava só no `CLAUDE.md` da API, e o app — que é quem consome nota e prazo — não a carregava: o portal do docente (PR #136) nasceu com `PASSING_GRADE` fixo por isso.

---

## 6. Erros proibidos

Cada um tem um mecanismo. O mecanismo é obrigatório, não a boa intenção.

| Erro | Mecanismo |
| --- | --- |
| `.env` no Git | `.gitignore` + gitleaks no CI + só `.env.example` versionado |
| **Credencial de banco no bundle do cliente** | check de CI varrendo o build do Next.js. Catastrófico — só `apps/api`/workers têm connection string do Postgres |
| **E-mail real disparado de staging** | `AllowlistGuard` embrulha o provider e recusa destinatário fora de `EMAIL_ALLOWLIST` quando `NODE_ENV !== production`. **Atenção:** o `Dockerfile` da API fixa `NODE_ENV=production` — um staging com a mesma imagem precisa sobrescrever `NODE_ENV`, senão a guarda fica aberta (`apps/api/CLAUDE.md`, Notificações) |
| Rota sem checagem de papel | middleware deny-by-default em `apps/api`; rota sem papel declarado falha no CI |
| SQL rodado à mão no painel de produção | só migration versionada |
| Sem rate limiting | plugin deny-by-default em `apps/api` (OOC-24): rota `.public()` sem `.rateLimit(...)` derruba o **boot** (como a falta de papel); rota com sessão herda o orçamento por usuário do staff |
| Commit direto na `main` | branch protection: PR + CI verde |
| Stack trace ao usuário | error boundary → mensagem genérica + `error_id`. Detalhe só no Sentry |
| `localhost` fixo no código | tudo via env validada com zod no boot + regra de lint |
| `async` sem tratamento | `no-floating-promises`, `require-await`, handler de `unhandledRejection`, DLQ na fila |
| Float para dinheiro | `amount_cents INTEGER` |
| Data sem timezone | `timestamptz` sempre, UTC no banco, `America/Lima` só na renderização |
| Delete físico | trava no próprio Postgres (migration `0011`), não só no domínio: papel de aplicação `ooc_app` sem grant de DELETE em `students`, `teachers`, `payments`, `payment_receipts`, `receipt_rereads`, `consents` e `audit_log`, sem UPDATE em `audit_log`, e sem UPDATE nem DELETE em `plan_prices` e `teacher_contracts`, **e** trigger que recusa a mesma coisa para o dono das tabelas. Só `deleted_at` — que existe nas oito tabelas que podem aposentar linha (`0012`, `0025`), e tem espelho no domínio: `SoftDeletableModel` separado de `BaseModel`, entidade append-only fica sem `softDelete()`. Detalhe em `packages/db/CLAUDE.md` e `packages/domain/CLAUDE.md` |
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
9. repositórios contra o banco — o SQL que o `tsc` não verifica (join na coluna errada compila) roda contra o Postgres migrado do mesmo job (`apps/api/**/*.integration.test.ts`, `pnpm test:api:db`)

---

## 7. Ambientes

| Ambiente | Onde |
| --- | --- |
| Local | Postgres local |
| Staging | `staging.aula.onlyonecoin.edu.pe` · Postgres gerenciado (Neon, branch de staging) |
| Produção | `student.onlyonecoin.edu.pe` (portal) · `backoffice.onlyonecoin.edu.pe` (backoffice) · Postgres gerenciado (Neon) |

- `apps/landing`/`apps/app`: Vercel, deploy automático a cada push em `main` via GitHub Actions (`.github/workflows/deploy-vercel.yml`); PR gera deploy preview nativo da Vercel. `apps/api`: Fly.io, mesmo gatilho (`deploy-api.yml`), sempre checagem de secrets → backup → migration → deploy, nessa ordem. **Variável obrigatória nova no `config.ts` = `fly secrets set` antes do merge**: o job `check-secrets` compara o `ConfigSchema` (`pnpm --filter @ooc/api env:required`) com o Fly e para tudo se faltar alguma. O deploy é **blue-green** (`fly.toml`): release que não passa no `/health` falha e a máquina antiga segue no ar — sem isso, uma release que cai no boot deixava a API parada até um `fly machine start` (incidente de 03/10/2026)
- Variáveis de ambiente **por projeto/ambiente** na Vercel e como secret do repo no GitHub (o que `apps/api` lê em runtime vem do Fly.io)
- **Migrations sempre aditivas.** Renomear/apagar em duas etapas (expand/contract), separadas por semanas
- Migration em produção **sempre depois de backup**
- Staging nunca recebe dado real

---

## 8. Segurança

- Autorização **deny-by-default na camada de aplicação** (`apps/api`, Caminho B — ver §3): toda rota/usecase declara explicitamente o(s) papel(is) permitido(s); rota sem declaração falha o CI. Teste automatizado cobre toda rota sensível, tentando acessar com papel errado e exigindo falha.
- Só `apps/api` (e workers) têm credencial de acesso ao Postgres. O Next.js (`apps/app`) nunca fala direto com o banco — tudo passa pela API.
- Bucket de comprovantes privado, signed URL de 5 min, caminho escopado por aluno, acesso registrado
- Docente vê só as próprias turmas — checagem explícita no usecase (`teacher_id` do usuário autenticado comparado ao dado), nunca um filtro montado a partir de input do cliente. **No ar desde a OOC-82** (`packages/domain/src/teaching/`, rotas `/teaching/*`, mecanismo em `apps/api/CLAUDE.md`): o portal mostra as turmas em inscrição, em andamento e finalizadas; fechada sai (regra de 08/10/2026, §1). **A confirmar com o dono:** rascunho e turma aposentada também ficam fora — escolha da OOC-82, não decisão registrada.
- **Id de escopo nulo não é um id (23/10/2026).** Conta `teacher` sem ficha (`teacherId: null`) vê **nada** — toda comparação de escopo exige o id presente antes de comparar. Comparado cru, `null === null` casa toda turma ainda sem docente, que é exatamente o dado que não é de ninguém. Vale para todo escopo por vínculo que pode faltar (docente↔ficha, aluno↔conta, apoderado↔aluno), na API e no mock do app.
- **Exportação em CSV/planilha neutraliza fórmula (23/10/2026).** Célula de texto que começa com `=`, `+`, `-`, `@`, tab ou CR sai com `'` na frente: nome de aluno, apoderado e qualquer texto livre são digitados por gente de fora (checkout público), e no Excel de quem baixa viram fórmula (CSV injection). Número sai como número. A regra vive num lugar só, `apps/app/src/lib/backoffice/csv.ts` (`csvCell`/`csvLine`), usado pelo relatório de notas do docente e pela exportação de alunos (OOC-121) — toda exportação nova passa por ele.
- Nenhum id vindo do cliente é confiado (anti-IDOR)
- MFA obrigatório: `master`, `admin`, `billing`; opcional para o resto do staff (OOC-29, 14/10/2026). **Por código enviado ao e-mail** (decisão do dono — app autenticador fica para depois), com 10 códigos de recuperação. Sem "confiar neste navegador": o código é pedido em todo login. Para os três cargos não há como desligar, e a API recusa a sessão deles em toda rota até ativarem — mecanismo em `apps/api/CLAUDE.md`, "MFA do staff"
- Anti-enumeração: login e recuperação de senha respondem igual para conta existente e inexistente
- Upload validado por **magic bytes**, re-encode da imagem, teto de tamanho
- Headers: CSP, HSTS, X-Frame-Options, Referrer-Policy
- `audit_log` append-only: sem grant de UPDATE nem DELETE, nem para admin — e desde a migration `0011` um trigger recusa UPDATE/DELETE/TRUNCATE também para o dono da tabela, que é quem uma `DATABASE_URL` vazada entrega. Só `apps/api` (papel `ooc_app`) conecta no runtime; ligar esse papel em cada ambiente é passo de ops documentado em `packages/db/README.md`
- **Bitácora geral (OOC-122, 23/10/2026): lê `master`, `admin` e `analyst`** (`AUDIT_LOG_ROLES`, `apps/api/src/http/audit/auditRoles.ts` — proposta do ticket, **a confirmar com o dono**). O que cada ação quer dizer vive num catálogo só, `packages/domain/src/identity/auditCatalog.ts`, lido pela API (filtros e qual registro a entrada aponta) e pela tela (rótulos): **ação nova gravada no `audit_log` entra no catálogo no mesmo PR**, senão aparece como "acción no catalogada" — e `apps/api/src/tests/audit-catalog.test.ts` varre todo `action:` do código e quebra antes disso. A tela mostra os nomes dos campos, nunca valores, nem o antes/depois que algumas entradas guardam (configurações, renomear plano). Exportar a bitácora é ela mesma uma entrada (`audit_log.exported`, com os filtros e quantas linhas), gravada antes da primeira linha sair, com rate limit próprio (`auditExport`, 10/h).
- **`audit_log` guarda o que mudou, nunca o valor (OOC-74, 07/10/2026).** Edição grava os **nomes** dos campos alterados (`{ fields: [...] }`), não antes/depois: o log é append-only, e um documento ou e-mail antigo copiado ali nunca poderia ser apagado num pedido de exclusão (Ley 29733). Mesma convenção dos updates do catálogo.
- Ley 29733: consentimento com timestamp, versão do texto e IP; política de retenção; exclusão a pedido

**Papéis (quadro redefinido pelo dono, 07/09/2026):** `master`, `admin`, `analyst`, `enrollment_supervisor`, `academic_supervisor`, `teacher`, `sales`, `support`, `billing`. Aluno e apoderado: `student`, `guardian`. Substituiu o quadro antigo (`coordinator`, `treasury`, `mass_approver` deixaram de existir; grosso modo: coordinator → enrollment_supervisor, treasury → billing, mass_approver extinto — aprovação é de admin/billing).

- **`master`** é o cargo dos donos da plataforma: vê e faz tudo, e **só conta em `@nrlabsdigital.com` ou `@admin.com`** pode carregá-lo (`canHoldMaster`, `apps/app/src/lib/backoffice/permissions.ts`). Os mesmos domínios — e não o cargo — são o que abre a seção **Funcionalidades** (§5): lá quem decide é `isOwnerEmail`, então um `admin` da Asociación é recusado e um dono passa com qualquer cargo.
  - **`admin.com` entrou na lista em 17/09/2026**, decisão do dono, junto do fix do incidente de Funcionalidades (§5): a conta que a equipe de fato usa como login de produção carrega esse domínio, não `nrlabsdigital.com`, e sem isso ela nunca teria como abrir Funcionalidades — nem pra reverter um flag que ela mesma derrubou. `MASTER_EMAIL_DOMAINS` (plural agora, `packages/domain/src/identity/Role.ts` e o espelho em `apps/app/src/lib/backoffice/permissions.ts`) é lista, não string única. Isso não reabre `docs/REGRAS-NEGOCIO.md`/seed: `admin@admin.com` **continua** sendo a credencial do script `seed-admin.ts` (§8, "Bootstrap"), que segue proibido apontar pra staging/produção.
  - **Correção (14/10/2026, dono):** a conta de produção em `admin.com` descrita acima **não existe** — não há conta nesse domínio em produção. O domínio continua na lista. Desde o MFA (OOC-29), conta de `master`/`admin`/`billing` precisa de uma caixa de e-mail real para receber o código, e em produção não há redirecionamento para a allowlist: uma conta futura em `admin.com` só funciona se esse endereço receber e-mail.
- **`admin`** vê tudo e autoriza. **`analyst`** (assistente/analista da administração) observa todas as áreas e propõe solução, mas **não aprova nem edita nada**.
- **`enrollment_supervisor`** cuida do lado acadêmico das matrículas (alunos, matrículas manuais, cursos/turmas); **`academic_supervisor`** supervisiona os docentes.
- **`sales`** (vendedor) e **`support`** (atenção ao cliente) leem alunos/matrículas; **`billing`** (facturación) liquida dinheiro e não vê dado acadêmico não financeiro.
- A matriz tela-a-tela vive em `apps/app/src/lib/backoffice/permissions.ts`. O backend já fala o quadro novo: `Role` em `packages/domain/src/identity/Role.ts` (com `MASTER_EMAIL_DOMAINS`/`canHoldMaster`), as rotas de `apps/api` declaram os cargos novos, e a migration `0009` troca os CHECKs de `user.role` e `staff_invites.role`. O convite recusa `master` fora dos domínios dos donos na própria rota (`CreateStaffInviteRoute`). Pendente: a tabela RBAC de `docs/ARCHITECTURE.md` §3 ainda descreve o quadro antigo.

Emitem documento (constancia, certificado) e disparam o lote de uma turma: `master`, `admin`, `enrollment_supervisor`, `academic_supervisor`, `teacher` — o docente **só nas próprias turmas**, checado no usecase. `billing` não emite. Toda emissão e todo reenvio de e-mail vão para o `audit_log`.

Aluno entra no portal só por `POST /api/v1/portal/sign-in` (e-mail ou documento resolvidos no servidor, resposta única 204/401); `GET /portal/me` é a primeira rota com `.roles("student")`.

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
- **`README.md`** é curto de propósito: o que é o projeto, como rodar e onde estão os docs. **Não guarda estado.** O estado vive em dois lugares, e doc desatualizada ali é bug, tratado como bug de código: por sessão em `docs/ROADMAP.md`, tela a tela em `apps/app/README.md` ("Estado por tela").
- **`docs/ROADMAP.md`** é atrelado ao contrato e tem duas partes com regras diferentes:
  - **Coluna Estado — sempre atualizada, sem pedir.** Toda tarefa que fecha, avança ou destrava uma sessão atualiza a linha dela no mesmo PR (✅/🟡/⬜, o que falta, o ticket do Linear) e o quadro "Resumo" no topo. Ticket do Linear que não cabe em nenhuma sessão entra em "Trabalho no Linear fora das sessões do contrato".
  - **Sessão, Entregável e Pronto quando — só com confirmação minha.** É o texto do contrato: sinalizar quando ficar desatualizado, nunca reescrever sozinho.
  - **Não confundir as duas.** "Precisa de confirmação" **nunca** é motivo para deixar a coluna Estado (nem o "Estado por tela" de `apps/app/README.md`) de fora do PR. PR que cria ou muda tela e não toca nenhum dos dois está incompleto — foi o que aconteceu no PR #136, que deixou o roadmap de lado "por precisar de confirmação".
- Doc nova (ex.: `docs/ARCHITECTURE.md`) é linkada na seção "Documentos" do `README.md` no mesmo commit que a cria — doc órfã não existe pra quem não sabe procurar.

Antes de considerar uma sessão pronta: **o Estado no `docs/ROADMAP.md` reflete o que acabei de fazer? Alguma outra doc ficou desatualizada?** Se sim, atualiza antes de terminar, não depois.
