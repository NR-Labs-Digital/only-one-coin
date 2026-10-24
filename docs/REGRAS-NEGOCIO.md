# Regras de Negócio — Only One Coin

> **Fonte:** export da configuração do bot de vendas (Yavendio, 15/08/2026 — o
> arquivo saiu do repo em 07/10/2026; está no histórico do Git) que hoje atende pelo WhatsApp. Não é uma especificação de sistema:
> é o retrato do **processo comercial atual**, capturado para servir de base ao
> desenho do catálogo, preços e políticas da nova plataforma (ver `REQUISITOS.md`).
>
> ⚠️ **Conflito com `CLAUDE.md` — parcialmente resolvido em 02/09/2026:** a
> modalidade **mensal por módulo** foi confirmada como regra da nova plataforma,
> **restrita aos cursos de inglês** (qualquer nível) — ver `CLAUDE.md` §1, que
> agora a documenta como exceção ao pagamento único. As **promoções de
> continuação** (S/49.90 / S/29.90, §4) seguem **em aberto**: contradizem o "sem
> descontos" do `CLAUDE.md` e ainda não foram decididas (ver divergência #1 no
> fim deste documento).
>
> Datas de início de turma (ex.: "15 de setiembre") são exemplos de um período de
> venda específico, não uma regra fixa — cada `academic_period` tem as suas.

---

## 1. Idiomas e cursos oferecidos

Segundo a descrição do negócio e as FAQs do bot:

- **Inglês** — único idioma com estrutura em módulos e trilhas kids/básico/intermediário-avançado.
- **Francês**, **Português**, **Coreano**, **Alemão** — citados na descrição oficial do negócio.
- **Chinês Mandarim**, **Italiano** — aparecem nas FAQs com turmas próprias, embora não estejam na descrição curta do negócio (`merchant_description`). Tratar como parte do catálogo real, não como exemplo hipotético.
- **Reforço escolar de matemática** — citado na `merchant_description` ("ofrece cursos de idiomas... además de refuerzo escolar en matemática") como parte do negócio, mas **sem nenhum detalhe** (preço, público, formato) em nenhuma FAQ. Confirmar com o cliente se ainda é oferecido e se entra no catálogo da nova plataforma — hoje é só uma linha na descrição, sem operação visível no restante do config.
- Curso de inglês segue padrão de **inglês americano**, não britânico (relevante para o material didático).

Materiais de referência do catálogo atual (links do Google Drive, para consulta durante o desenho do catálogo — não citar como fonte de preço, que vem sempre da tabela):
- Brochure/malla curricular de Inglês.
- Brochure/malla curricular dos demais idiomas (francês, português, coreano, chinês mandarim, italiano, alemão).

Regra citada nas FAQs: para todo idioma **exceto inglês e chinês mandarim**, a matrícula é **sempre pacote completo** (80h por um único pagamento) — não há venda de módulo avulso. Ou seja, o parcelamento por módulo é uma particularidade do curso de **Inglês Básico** (e, ver §2, também do **Inglês Kids**), não do catálogo inteiro.

**Regra de priorização comercial** (só relevante se a nova plataforma replicar lógica de sugestão/cross-sell): quando um curso não tem vaga disponível, a orientação é oferecer primeiro Inglês e, na sequência, Francês, Português, Coreano, Alemão — não é uma regra de vagas em si (isso é RF09), é uma ordem de oferta comercial.

## 2. Faixas etárias

| Idioma / trilha | Idade |
|---|---|
| Inglês Kids (regular ou intensivo) | 6–12 anos |
| Inglês Básico (jovens e adultos) | 13 anos em diante |
| Inglês Intermediário/Avançado | 13 anos em diante |
| Demais idiomas (francês, português, coreano, alemão, chinês, italiano) | 13 anos em diante — **não há turma kids** |

> Inglês Kids também tem duas modalidades — **regular** e **intensiva** — cada
> uma com seu próprio preço, horário e data de início, no mesmo padrão de
> "pergunte a modalidade antes de responder" usado para os demais níveis de
> inglês. Não confundir com o par Plano Básico/Plano Completo do §4 — ali a
> divisão é por forma de pagamento (por módulo × pacote), aqui é por ritmo de
> aula (regular × intensivo).

## 3. Estrutura do curso de Inglês (o caso mais detalhado)

- **Inglês Básico**: 4 módulos, cada um com 1 mês / 20h de aula. Duração total do pacote completo: **5 meses e meio** segundo a maioria das FAQs — mas uma FAQ isolada ("Curso de Inglés Básico Jóvenes y Adultos") diz **4 meses**. Fonte inconsistente, ver §11.
- **Descanso entre módulos**: **2 semanas** na maioria das FAQs, mas uma delas diz **1 semana**. Fonte inconsistente, ver §11.
- **Nota mínima para aprovar cada módulo**: 14. Notas publicadas 2 dias após a avaliação, no Classroom.
- **DA (Desaprobação Automática)**: ocorre quando o aluno não rende algum dos exames finais.
- **Reprovação em módulo básico** — duas opções ao aluno:
  1. Exame de rezagados (segunda chamada), custo **S/10** — a nota do exame vira a nota final do módulo.
  2. Repetir o módulo, custo **S/20** — o saldo do pagamento anterior fica para os próximos módulos.
- **Inglês Intermediário/Avançado**: acesso exige exame de classificação prévio (**S/9.90**), resultado em 24–48h. Curso intensivo, 2 níveis (intermediário + avançado, 40h cada = 80h), ~2 meses de duração. **Não é possível trancar** (congelar) este curso.
- **Turmas**: 45 a 50 alunos por sala (inclui bolsistas — a instituição reserva parte das vagas para alunos com bolsa).
- **Metodologia**: "Active Learning" — aprendizagem ativa, foco em participação e aplicação prática.
- **Material didático**: livro "Papayita", PDF virtual (não é livro físico), disponibilizado no Classroom no dia de início das aulas.
- Exemplo de alocação de professor real no catálogo: a turma de Italiano Básico é anunciada com "docente ítalo-peruano" — sinal de que a ficha de professor pode carregar nacionalidade/origem como diferencial de venda, não só disponibilidade de horário (RF03).

## 4. Preços e formas de pagamento (Inglês Básico)

| Plano | Preço | Conteúdo |
|---|---|---|
| Plano Básico (por módulo) | **S/20** / módulo | 20h, material didático, gravações, aulas ao vivo — só aquele módulo |
| Plano Completo | **S/69.90** (único pagamento) | 80h (4 módulos), material, gravações, aulas ao vivo **+ oficinas gratuitas aos domingos** |

O mesmo par Plano Básico/Plano Completo (S/20 por módulo × S/69.90 pacote) **também se aplica ao Inglês Kids**, não só ao básico de jovens/adultos — uma FAQ é explícita: "las modalidades mensual y completa sí aplican solamente para los cursos de inglés básico **y inglés kids**".

Oficinas gratuitas (só para quem paga o Plano Completo de S/69.90): Excel, Quechua, Empreendedorismo, Liderança — 1h30 cada, sem horário fixo (publicado no Classroom). **Exceção — curso Kids**: a única oficina é Arte e Manualidades. Há uma FAQ dizendo que as oficinas são "los domingos" e outras duas dizendo que não têm horário fixo — fonte inconsistente, ver §11.

O Plano Completo também é anunciado como **"S/0.60 por sessão"** (80h / 5 meses e meio), como enquadramento de marketing do mesmo preço de S/69.90 — não é um preço por hora avulso, é o mesmo pacote fatiado por sessão para parecer mais barato. Isso contradiz uma FAQ isolada e genérica que diz "el costo es de S/1.00 por hora de clase" — fonte inconsistente, ver §11. Em nenhum caso isso deve ser lido como "dá pra comprar 1 sessão avulsa" — outra FAQ nega isso explicitamente ("¿Se puede pagar solo por una clase para ver si me gusta?" → não é possível).

`include_taxes: false` na configuração — os preços acima são tratados como líquidos, sem imposto embutido explicitado. Confirmar se isso é só um flag do bot de vendas ou reflete o tratamento fiscal real da associação (relevante para IGV/RUC ao desenhar faturamento).

Promoções têm **validade declarada de 24 horas** (regra de estilo de vendas do bot) — distinto do prazo de 24h para preencher o formulário de matrícula (§7.6); são dois prazos de 24h com propósitos diferentes, não confundir.

> **O S/20 não é sinal/reserva — é um plano completo à parte.** O config descreve
> "Plan Básico" e "Plan Completo" como duas ofertas lado a lado (*"Ofrecemos dos
> opciones: 1. Plan Básico - 20 soles... 2. Plan Completo - 69.90 soles"*), e a
> modalidade mensal é tratada como pagamento recorrente genuíno (*"el pago es de
> S/20 al mes"*), não como adiantamento parcial do pacote completo. A única frase
> com tom de "reserva" (*"Puedes separar con S/20"*, ao ser perguntado até quando
> dá pra pagar) usa o mesmo valor do módulo 1 e, na prática, é o próprio Plano
> Básico sendo oferecido com outra roupagem — não existe nenhum SKU de depósito
> separado no config, e a regra do bot é explícita: **"Nunca solicitar ningún
> tipo de adelanto."** Tratar como plano modular real ao especificar o domínio de
> preços da nova plataforma, não como taxa de reserva.

### Promoções de continuação (⚠️ ver alerta de conflito no topo)

Aplicáveis **somente a quem já iniciou** o Inglês Básico — nunca oferecidas como opção de entrada:

| Situação | Preço | Cobre |
|---|---|---|
| Aluno avança para o módulo 2 | **S/49.90** | Módulos 2, 3 e 4 restantes |
| Aluno avança para o módulo 3 | **S/29.90** | Módulos 3 e 4 restantes |
| Sem promoção | **S/20** | 1 módulo |

Se o aluno já pagou o pacote completo (S/69.90), não paga nenhuma promoção adicional — já tem acesso aos 4 módulos.

### Outros cursos com preço conhecido

- **Chinês Mandarim Básico Intensivo**: turmas com datas/horários variados (1 a 3 meses), preço não capturado no config.
- **Francês Completo** (básico+intermediário+avançado): 200h, 5 meses, inclui certificado.
- **Alemão — continuação básico**: promoção especial **S/30**.
- **Italiano Básico**: 3 meses.
- **Demais idiomas (regra geral)**: 80h por **S/80**, pagamento único.
- **Inglês Intermediário/Avançado intensivo completo (2 níveis)**: **S/79.90**.

### Meios de pagamento ativos hoje

| Meio | Detalhe |
|---|---|
| Yape | Número 951 153 323 — Razão Social: INGLÉS POR UN SOL SAC |
| Transferência bancária | BCP, conta 1947124724007 / CCI 00219400712472400791 |
| PayPal | Só para alunos no exterior — link `paypal.me/pagosooc`, titular "Leslie Echavarria" — preços convertidos para USD (tabela de câmbio própria, não é câmbio de mercado) |

Tabela de conversão PayPal (preço em soles → USD cobrado):

| Soles | USD |
|---|---|
| S/5 | $1.5 |
| S/7 | $2 |
| S/10 | $3 |
| S/20 | $10 |
| S/24 | $12 |
| S/69.90 | $25 |
| S/80 / S/79.90 | $30 |
| S/95 | $38 |
| S/120 | $45 |
| S/180 | $56 |

> Nota: hoje **não há Plin nem PagoEfectivo** em uso real — são meios previstos no `REQUISITOS.md` como opção de pasarela futura, mas o processo atual só usa Yape, transferência BCP e PayPal (estrangeiros).

## 5. Procedimentos administrativos (taxas pós-matrícula)

Todos pagos à parte, mediante coordenação com Atención al Alumno:

| Procedimento | Custo | Observação |
|---|---|---|
| Exame de rezagados (segunda chamada) | S/10 | Nota do exame = nota final do módulo |
| Repetir módulo | S/20 | Saldo anterior fica para próximos módulos |
| Cambio de e-mail | S/5 | |
| Cambio de horário | S/10 | Só válido para **Inglês Básico Regular**, antes do início do módulo ou até a 3ª aula. **Não disponível** para os demais idiomas (matrícula já registrada define o horário definitivamente). |
| Cambio de data de início | S/7 | **Não disponível** para os demais idiomas (italiano, português, francês, chinês, alemão) — matrícula já registrada. |
| Congelamento (trancamento) | S/10 | **Não disponível** para Inglês Intermediário/Avançado |
| Traspaso (transferência) | **Gratuito** | |
| Constância de matrícula | S/25 | |

**Achado relevante:** quem paga por um desses procedimentos passa pelo **mesmo formulário de matrícula** (`forms.gle/4L7xxsvVRoPLrFsC6`) usado por aluno novo — não é um formulário separado de "procedimento". O bot trata os dois casos ("ALUMNOS DE MATRÍCULA" vs. "ALUMNOS DE PROCEDIMIENTO") como dois roteiros de mensagem quase idênticos que convergem no mesmo link, sempre só depois de receber o comprovante do pagamento da taxa. Isso é um dado não óbvio para o desenho do RF18/outbox: o mesmo formulário coleta tanto dado de matrícula nova quanto dado de solicitação de procedimento — confirmar se a nova plataforma deve unificar os dois em um único fluxo de "solicitação com pagamento associado" ou tratá-los como domínios separados (ver também §7 item 6 e a divergência #2 no fim do documento).

Regras adicionais do fluxo de pagamento/link, válidas tanto para matrícula quanto para procedimento:
- **Nunca pedir número de telefone** do cliente durante o fluxo de venda/pagamento.
- **Quantidade é sempre 1 curso por pessoa** — não existe fluxo de "quantas unidades" (distinto da regra "nunca aula avulsa" do `CLAUDE.md`, que é sobre não vender aula solta; esta é sobre não haver múltiplas unidades numa mesma transação).
- O link do formulário não deve nem ser **mencionado** antes do comprovante — regra mais estrita que só "não enviar ainda": até esse ponto o bot deve agir "como se o link não existisse".

## 6. Certificação

- Emitido **grátis**, em nome da instituição, dentro de **25 dias úteis** após o término do curso.
- **Sem validade** para bacharelado ou titulação — é certificado simples, não convalida estudos. Uma FAQ separada descreve o mesmo certificado como "válido a nivel nacional" — as duas coisas podem coexistir (documento autêntico e reconhecível, mas que não substitui crédito escolar formal), mas vale confirmar a redação exata com o cliente antes de replicar no site — ver §11.
- Nível de referência declarado: **B1**.
- Tempo de atuação da instituição citado nas FAQs como argumento de credibilidade: aparece tanto "4 años" quanto "más de cinco años" — fonte inconsistente, ver §11.
- Consulta/download: site próprio (`ooc.asvnets.com/consultar`), busca por DNI, recomendado abrir de PC/notebook para conseguir baixar.
- Inglês Básico: exige ter concluído os 4 módulos com notas aprobatórias + solicitar exame de certificação (100 perguntas, cobre o nível básico) via formulário próprio.

## 7. Regras de matrícula e formulário (funil atual, pré-sistema)

1. Venda acontece por WhatsApp (humano ou o bot "Leslie").
2. Cliente escolhe idioma → nível/modalidade → recebe horários, preço e data de início (nessa ordem) → tira dúvidas → só então vê promoção, se houver.
3. Cliente paga (Yape / transferência / PayPal) e envia comprovante.
4. Bot envia o link do **formulário de matrícula** (Google Forms) — nunca antes de receber o comprovante.
5. Formulário pede: nome completo, DNI, e-mail Gmail ativo **com espaço disponível**, horário escolhido, curso.
6. Prazo de 24h para completar o formulário. Não completar = perde direito a reclamação/devolução.
7. Cliente envia captura de tela confirmando envio do formulário → bot confirma matrícula.
8. Consulta de acesso: por **DNI + nome completo** na maioria das mensagens do bot, mas uma FAQ descreve o mesmo site como **DNI + código de segurança** — fonte inconsistente, ver §11. Disponível **3 dias antes** do início das aulas, em site próprio (`ooc.asvnets.com/consultar2026`).
9. Acesso ao Classroom chega por e-mail — **3 dias antes** do início na maioria das fontes, mas uma FAQ diz **2 dias antes**. Fonte inconsistente, ver §11.

O campo `restrictions` da configuração afirma "los datos del cliente se recopilan únicamente a través del formulario de matrícula" — mas o próprio fluxo do bot (passo 1 acima, "Formulario de Matrícula") já pede **nome completo e DNI pelo chat do WhatsApp**, antes de qualquer formulário. Ou seja, a coleta real não é só pelo formulário — é uma tensão entre a regra declarada e o fluxo praticado, relevante para a política de minimização de dados (`CLAUDE.md` §8) da nova plataforma.

### Exceção — comprovante ou captura que não chega

Se o aluno afirma ter enviado uma imagem (comprovante ou captura do formulário) e ela não chega ou não abre: **nunca pedir a mesma imagem mais de 2 vezes**. A partir daí:
- Para o pagamento: aceitar por escrito valor exato, número de operação e data — equivale a comprovante recebido.
- Para o formulário: basta a confirmação por escrito de que foi preenchido.

## 8. Regras de aula e acesso

- 100% virtual, via **Google Meet + Classroom**; aulas ficam gravadas.
- Turmas são sempre **grupais** — não há aula personalizada nem grupo de WhatsApp para acompanhar a turma.
- Horário é **fixo** durante todo o módulo (não muda no meio do módulo).
- Dias de avaliação têm presença obrigatória.
- Professor(a) publica seu e-mail de contato no mural "Anúncios" do Classroom.
- **Contrato do docente (regra da plataforma, decisão do dono de 23/10/2026; OOC-124):** a plataforma gera o contrato a partir do modelo publicado e registra só o **período de vigência** — é dele que sai o alerta de vencimento. A cópia **assinada** não é guardada na plataforma: fica no Drive da coordenação, a menos que alguém peça para guardar aqui. Detalhe em `CLAUDE.md` §1.

## 9. Atendimento e reclamações

- **Livro de Reclamações**: formulário próprio (Google Forms) — `forms.gle/55Z6uner33ZZxZ1cA`.
- Não há devolução em dinheiro descrita no processo atual — reclamações e situações de "estafa" (fraude) são sempre encaminhadas ao atendimento humano.
- Contatos: +51 999 193 666 · +51 924 269 676 · +51 962 985 106.
- Horário de atendimento: segunda a sexta, 8h30–17h.
- Sede física: General Murillo 169, Lima — **não faz atendimento presencial**, só pelos canais acima.

### Gatilhos de escalonamento para humano (hoje)

O bot deriva a conversa para atendimento humano nestes casos específicos:
- "No me llegó mi acceso" / "No encuentro mi acceso" (aluno não recebeu ou não acha o acesso às aulas).
- Reclamações com linguagem de fraude — palavras-chave registradas: "estafadora", "devuélveme mi dinero", "ratero".
- "DESEO MI LINK" (cliente exigindo o link diretamente, sem seguir o fluxo).

Depois de escalar, o fluxo automatizado **pausa** (`paused_derivation_config: true`) — o bot não continua respondendo sozinho até um humano assumir. Relevante para o desenho do handoff bot→humano/backoffice na nova plataforma, se algo equivalente for mantido.

## 10. Regras de conteúdo/atendimento do agente de vendas (referência de tom, não de sistema)

Não são regras de sistema, mas documentam como a marca se comunica hoje — úteis para o tom da landing e dos e-mails transacionais:

- Nunca solicitar endereço de entrega (serviço 100% virtual, sem produto físico).
- Regra mais ampla que a anterior: **nunca mencionar** livro físico, envio ou entrega de nenhum tipo na conversa — não é só "não perguntar", é não trazer o assunto à tona (coerente com o livro "Papayita" ser só PDF, ver §3).
- Nunca pedir adiantamento parcial fora do fluxo de pagamento definido.
- Nunca prometer serviço que não existe no catálogo.
- Preço vigente é sempre o do catálogo — anúncios em redes sociais não são fonte de preço.
- Nunca aceitar comprovante com valor abaixo do preço do curso (ex.: pagamento de S/1 ou S/0.60 — valor de "sessão", não da matrícula) sem pedir complemento; a própria IA do bot é instruída a ler o valor na imagem do comprovante e comparar com o catálogo.

## 11. Inconsistências identificadas na fonte (confirmar com o cliente, não escolher um lado sozinho)

O export do bot era um acúmulo de instruções escritas em momentos diferentes por quem opera o bot — várias FAQs se contradizem entre si. Listado aqui para não "resolver" nada por conta própria:

| Tema | Versão A | Versão B |
|---|---|---|
| Duração do Inglês Básico | 5 meses e meio (maioria das FAQs) | 4 meses (1 FAQ) |
| Descanso entre módulos | 2 semanas (maioria) | 1 semana (1 FAQ) |
| Prazo de acesso ao Classroom | 3 dias antes do início (maioria) | 2 dias antes (1 FAQ) |
| Campo de consulta de acesso | DNI + nome e sobrenome (maioria) | DNI + código de segurança (1 FAQ) |
| Validade do certificado | "válido a nível nacional" (1 FAQ) | "sem validade para bacharelado/titulação" (1 FAQ) |
| Tempo de atuação da instituição | 4 anos (1 FAQ) | mais de 5 anos (1 FAQ) |
| Horário das oficinas gratuitas | "aos domingos" (2 FAQs) | "sem horário fixo, publicado no Classroom" (2 FAQs) |
| Preço "por sessão"/hora do Inglês Completo | S/0.60 por sessão (4 FAQs, ligado ao pacote de S/69.90) | S/1.00 por hora de aula (1 FAQ genérica) |
| Coleta de dados do cliente | "somente pelo formulário de matrícula" (`restrictions`) | Nome + DNI já são pedidos pelo bot no chat, antes do formulário |

Nenhuma dessas foi "corrigida" nas seções acima — cada uma tem uma nota apontando para aqui. Antes de travar textos definitivos no site/e-mails da nova plataforma (prazos, validade de certificado, tempo de mercado), confirmar a versão correta com quem opera hoje o WhatsApp.

---

## Divergências a resolver com o cliente antes de fechar o catálogo da nova plataforma

1. ~~Parcelamento por módulo~~ **Resolvido em parte (02/09/2026):** a modalidade mensual **migra** para a nova plataforma como exceção documentada, valendo para **todos os cursos de inglês** (decisão do Rick: "só pra inglês, independente do nível" — mais amplo que o processo atual, que restringia a básico + kids, ver §4). Regras em `CLAUDE.md` §1. **Segue em aberto:** as **promoções de continuação** (S/49.90 módulos 2-4, S/29.90 módulos 3-4) — contradizem o "sem descontos" e não foram decididas.
2. **Procedimentos administrativos com custo** (mudança de horário, congelamento, repetir módulo etc.) reutilizam hoje o mesmo formulário de matrícula do fluxo de aluno novo (ver §5) — confirmar se, na nova plataforma, entram no mesmo `payments`/outbox (RF18) como um sub-fluxo de "solicitação com taxa", ou se merecem um domínio próprio no backoffice.
3. Preço de **PayPal em dólares** usa tabela de conversão própria, não câmbio de mercado — confirmar se isso continua manual/config ou vira taxa fixa por plano.
4. Catálogo real inclui **chinês mandarim**, **italiano** e uma menção a **reforço escolar de matemática**, não citados (ou pouco detalhados) na descrição curta do negócio — confirmar quais seguem ativos no catálogo da nova plataforma.
5. Nove inconsistências factuais na fonte atual (§11) — nenhuma foi decidida por este documento; precisam de confirmação antes de virar texto definitivo em site, e-mail ou constância.
