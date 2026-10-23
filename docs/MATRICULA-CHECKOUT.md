# Checkout de matrícula — o funil público

Como uma pessoa sai de "quero aprender inglês" e chega a uma matrícula
registrada, com o comprovante já na escada de OCR. Detalha o que o
`CLAUDE.md` §1 (fluxo de negócio) e §5 (vagas, pagamento, origem) fecham em
regra; aqui está a tela.

Cobre as Sessões 20–25 do `docs/ROADMAP.md`.

O catálogo de campos do passo 2 é a planilha real do Forms que a Asociación usa
hoje (§2.1), não um formulário inventado.

---

## 1. A decisão: um wizard, dois modos de entrada

O funil de hoje tem **dois públicos** que chegam em estados muito diferentes:

- quem fechou a venda no WhatsApp — **já escolheu curso e turma, já pagou**, e
  só precisa registrar quem é e mandar o comprovante;
- quem chegou sozinho pela landing — **não escolheu nada e não pagou**.

A tentação é fazer duas telas. Não fazemos: seria **um formulário de matrícula
em dois lugares**, com duas validações, dois arquivos de locale e duas chances
de divergir no primeiro campo novo. Em vez disso é **o mesmo wizard, com o
passo 1 pré-preenchido** quando o link já traz curso e turma.

| Entrada | Passo 1 | Passos 2–4 |
| --- | --- | --- |
| Landing (`/enrollment`) | escolhe idioma → curso → turma; o botão de uma página de curso chega com `?course=<chave da página>` e cai no curso ligado a ela (OOC-117) | iguais |
| Link do vendedor (`/enrollment?course=…&group=…&src=whatsapp`) | resumo do que já foi escolhido, confirmável e trocável | iguais |

**A métrica por canal não vem de ter duas telas** — vem do campo `source`
(`CLAUDE.md` §5, "Origem da matrícula"). Com uma tela só medimos o mesmo, e
ainda medimos o que duas telas não medem: **em qual passo cada canal desiste**.

> O link com query string é prefill e atribuição, **não** um link tokenizado
> (`CLAUDE.md` §2): não carrega segredo, não autentica ninguém e não carrega
> preço. Quem abrir o link de outra pessoa vê um formulário em branco com um
> curso pré-selecionado, nada mais.

---

## 2. Os quatro passos

### Passo 1 — Curso, data de início e horário

Segue a ordem que o funil do WhatsApp já usa (`docs/REGRAS-NEGOCIO.md` §7):
**idioma → curso/nível → data de início → horário**, e só então o preço.

**A data de início é escolha própria, não propriedade do horário.** Coordenação
abre o mesmo curso em várias datas — começar esta semana ou com a turma do fim
do mês — e cada data carrega seus três ou quatro horários. Achatar isso numa
lista única de doze linhas é como alguém escolhe uma hora conveniente numa data
em que não pode.

- Só aparecem turmas `enrolling` **com vaga**. Turma cheia continua **visível e
  desabilitada** — saber que a turma das 07:00 existe e está cheia vale mais do
  que ela sumir. Já uma **data** sem nenhuma vaga é omitida: data morta não
  ensina nada a quem lê.
- O preço aparece **depois** do horário escolhido, e é o `plan_price` vigente,
  somente leitura. Não há desconto, nunca (`CLAUDE.md` §1) — campo de valor
  editável é campo de onde se subfatura.
- **Cursos de inglês têm um sub-passo a mais: a modalidade** (decisão
  02/09/2026, `CLAUDE.md` §1). O aluno escolhe entre **mensual** (módulo a
  módulo) e **paquete completo** — dois `plan_price` distintos, cada um somente
  leitura. Os demais idiomas nem veem essa escolha: só existe o paquete. Ainda
  não implementado no wizard — registrar aqui é o que impede o passo 1 de ser
  construído sem esse braço.
- **Um curso por pessoa, por matrícula.** Não existe carrinho nem quantidade
  (`docs/REGRAS-NEGOCIO.md` §5).

### Passo 2 — Quem vai estudar

Os campos são os que a Asociación **já coleta hoje** na planilha do Google
Forms — mapeamento coluna a coluna em §2.1 — mais o bloco do apoderado, que é a
lacuna que a plataforma fecha.

- **Nome completo em um campo só.** É o que o formulário atual pede, e
  re-separar nome peruano depois (dois sobrenomes, nome composto) é adivinhação.
  ⚠️ O `StudentRow` do backoffice ainda guarda `firstName`/`lastName` — quando o
  domínio for escrito, a decisão é uma coluna `full_name` na tabela de aluno, e
  a divisão do painel vira derivada ou some.
- **Celular é pedido.** A regra "nunca pedir número de telefone"
  (`docs/REGRAS-NEGOCIO.md` §5) governa a **conversa de venda no WhatsApp**,
  onde o número já é conhecido — não o formulário, que sempre teve coluna
  CELULAR.
- **E-mail tem que ser Gmail pessoal do aluno, e isso é trava.** O formulário
  atual recusa em maiúsculas conta institucional e corporativa. O acesso à aula
  chega por Google Classroom, e endereço de colégio que morre em dezembro é
  aluno que perde o curso que pagou. O e-mail do **apoderado** não tem essa
  regra — Classroom é do aluno.
- **Idade mínima por curso** (`courses.min_age`) é trava, não aviso.
- **Menor de idade → bloco do apoderado obrigatório**: nome, documento,
  parentesco, celular, e-mail, e o consentimento com **versão do texto,
  timestamp e IP** (Ley 29733, `CLAUDE.md` §8). Boa parte do público é menor;
  este é o caminho normal, não a exceção.

**Verificação do Gmail (07/10/2026).** Com o e-mail do aluno válido, o passo mostra o bloco "Verifica tu correo": Turnstile, "Enviar código", campo de 6 dígitos com `autocomplete="one-time-code"`, reenviar depois de 60 s (contagem por reserva de vaga — trocar o e-mail não zera) e "Cambiar correo". Continuar exige o selo de verificado. A prova fica no rascunho (`sessionStorage`) presa à reserva e ao endereço — a prova fica no rascunho mas só vale para a mesma reserva e o mesmo endereço — editar o e-mail faz ela deixar de valer, e voltar ao endereço verificado a faz valer de novo. Domínio digitado errado (`gmial.com`, `gmail.co`, …) ganha "¿Quisiste decir…?" com correção de um clique, para aluno e apoderado; o apoderado digita o e-mail duas vezes (sem colar). Spec: `docs/superpowers/specs/2026-10-07-checkout-email-verification-design.md`.

### 2.1 De onde vieram os campos

A planilha que o Forms alimenta hoje, coluna a coluna, e o que cada uma virou:

| Coluna da planilha | No checkout |
| --- | --- |
| NOMBRES | Campo único de nome completo |
| TIPO DE DOCUMENTO | `nationalIdType` (DNI · CE · pasaporte) |
| D.N.I / CARNET DE EXTRANJERIA | `nationalId`, validado por tipo |
| CELULAR | `phone` |
| FECHA DE NACIMIENTO | `birthDate` — abre o bloco do apoderado e testa a idade mínima |
| CORREO ELECTRONICO (GMAIL.COM) | `email`, **travado em `@gmail.com`** |
| FECHA DE INICIO | Escolha própria no passo 1 |
| PROMOCIONES | É o **curso** |
| HORARIOS DISPONIBLES | Turma, dentro da data escolhida |
| NUMERO OPERACION | `operationNumber` |
| APLICA COMPROBANTE (×2) | O bloco do comprovante — um upload só |
| MONTO | **Não é pedido**: mostrado somente leitura, do `plan_price` vigente |
| CUENTA | Meio de pagamento (Yape · BCP) |
| — | **Bloco do apoderado + consentimento**: novo, não existia |

Duas diferenças de propósito, de propósito:

- **MONTO não é digitado.** A planilha pede porque o Forms não sabe o preço. A
  plataforma sabe: o valor é o `plan_price` vigente, e o que o comprovante diz
  é problema da escada de OCR, não do que a pessoa declarou.
- **Sem campo de turma escrito à mão.** A turma vem do catálogo que a
  coordenação abre no painel; quando ela abre uma turma, esta tela passa a
  oferecê-la sozinha.

### Passo 3 — Pagamento e comprovante

Não há pasarela (`CLAUDE.md` §2). A plataforma **mostra onde pagar** e **recebe
a prova**:

- Dados de pagamento da Asociación por meio (Yape, transferência BCP), com o
  **valor exato** a pagar em destaque e botão de copiar.
- A pessoa escolhe o meio e informa o **número de operação**.
- **Comprovante obrigatório.** Sem imagem anexada o passo não avança — é o
  insumo da escada de OCR (`CLAUDE.md` §5), e uma matrícula sem ele é uma linha
  que ninguém consegue liquidar.
- Upload por **signed URL direto ao Storage** (Sessão 23) — a imagem nunca
  passa pela função. Validação por magic bytes, teto de tamanho, e normalização
  no worker (downscale, cinza, strip EXIF, HEIC → JPEG).

### Passo 4 — Revisão e envio

- Tudo o que foi preenchido, em uma tela, com link para voltar a cada passo.
- Envio → resposta em **< 300ms** (Sessão 24): grava aluno + matrícula +
  pagamento `pending`, enfileira o job de OCR e responde. A rota de submit
  **não importa o módulo de IA**.
- Tela de sucesso diz o que acontece agora: comprovante em análise, credenciais
  por e-mail quando aprovado, prazo.

---

## 3. A vaga: dois relógios

A regra está fechada no `CLAUDE.md` §5; aqui está por que ela existe.

```
passo 1 concluído ──► vaga reserved ──┬── comprovante em ≤ 15 min ──► segue reserved (janela de 5 dias)
   (turma escolhida)                  │                                        │
                                      │                                        ├── pagamento aprovado ──► confirmed
                                      └── 15 min sem comprovante ──► released  └── recusado / 5 dias ──► released
```

**Hold de checkout — 15 minutos.** Prende a vaga assim que a turma é escolhida,
antes do pagamento. Existe porque o pagamento é fora da plataforma: a pessoa sai
do navegador, abre o app do banco, paga, tira o print e volta. Sem o hold ela
pode voltar para uma turma cheia — e **não existe fluxo de devolução** no
negócio. O hold transforma um problema de dinheiro num problema de tempo.

**Janela de revisão — 5 dias.** Já existia. Começa quando o comprovante entra e
termina quando o pagamento é aprovado ou recusado.

Consequências de desenho:

- O relógio é **do servidor**, não do navegador. O cliente mostra a contagem; o
  servidor decide se expirou. Um contador de tela é conforto, não autoridade.
- **Expirou não é erro fatal.** A tela diz que a vaga voltou, oferece a mesma
  turma se ainda houver lugar, e preserva tudo o que já foi preenchido.
- **Recarregar a página não perde nada** (Sessão 20). O estado do wizard
  persiste no navegador; o hold persiste no servidor.
- Os dois prazos são **parâmetros no backoffice**
  (`/backoffice/settings`), como a tolerância de valor.

> O prazo começou em 10 minutos e subiu para **15** antes de ir ao ar: Yape
> leva ~1 minuto, mas uma transferência entre bancos leva bem mais, e expirar
> com o dinheiro já enviado é o pior desfecho possível deste fluxo — não há
> devolução. O valor segue configurável no backoffice, e a taxa de expiração em
> produção decide se muda de novo.

---

## 4. Origem do canal

Todo acesso ao checkout carrega uma origem, resolvida **uma vez, no primeiro
acesso**, e carregada até o submit:

| Origem | Como chega |
| --- | --- |
| `whatsapp` | link mandado pelo vendedor, `?src=whatsapp` |
| `web` | qualquer outra entrada — inclusive `src` desconhecido ou ausente |

Vai para a **matrícula**, não para o aluno: a mesma pessoa pode voltar por outro
canal no ciclo seguinte, e um campo no aluno apagaria o histórico. Os `utm_*`
seguem junto, em campo separado, para relatório de peça.

Isso é o que responde, dentro do backoffice e sem depender de analytics de
borda, **quanto do ciclo veio do zap e quanto veio do site** — e é o argumento
que fez o wizard único ganhar de duas telas.

---

## 5. O que este documento **não** decide

- **PayPal.** `docs/REGRAS-NEGOCIO.md` §4 registra PayPal como meio ativo para
  alunos no exterior, com tabela de câmbio própria. O tipo `PaymentMethod` do
  código não tem `paypal`, e a tabela de conversão é regra de preço, não de
  meio. **Confirmar com o cliente** se o checkout público atende estrangeiro
  antes de estender o tipo.
- **Procedimentos administrativos.** Hoje quem paga taxa (constancia, repetir
  módulo, mudança de horário) passa pelo **mesmo formulário** do aluno novo
  (`docs/REGRAS-NEGOCIO.md` §5). Se a nova plataforma unifica os dois num fluxo
  de "solicitação com pagamento associado" ou os separa é divergência aberta —
  não resolver sozinho.
- **Lista de espera.** Sessão 22 do roadmap. O passo 1 já prevê a oferta; o
  domínio (`waitlist_entries`) existe na migration da Sessão 6.
