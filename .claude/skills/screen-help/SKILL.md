---
name: screen-help
description: Toda tela do apps/app (backoffice, portal do docente, portal do aluno) explica o próprio sistema com o (?) — HelpHint/HelpField — ao lado do que não é óbvio, para a equipe do cliente não precisar perguntar o que cada coisa é. Use sempre que criar ou alterar uma tela, um campo de formulário, uma coluna, um filtro, um estado/selo, um contador, um bloco ou uma ação com consequência.
---

# O (?) em toda tela — o sistema se explica sozinho

A equipe do cliente pergunta toda vez o que um campo, um estado ou um número
quer dizer ("o que é *Fuera de plazo*?", "o que muda se eu marcar isso?"). A
resposta já existe — está nas regras do `CLAUDE.md` — e tem que estar **na
tela**, a um toque, no lugar exato da dúvida. Tela nova ou alterada sem o (?)
no que não é óbvio está incompleta, como tela sem os três idiomas.

## O componente — já existe, não crie outro

`apps/app/src/components/backoffice/help-hint.tsx` (OOC-133, OOC-134):

- **`HelpField`** — campo de formulário com o (?) ao lado do rótulo. O
  controle recebe o `id` pela render prop (um botão dentro de `<label>` viraria
  o controle do rótulo, e clicar no texto abriria a ajuda em vez de focar o
  campo):

  ```tsx
  <HelpField label={t('class_groups.field_capacity')} what={t('help.capacity_what')} how={t('help.capacity_how')}>
    {(id) => <input id={id} type="number" className={fieldClass} />}
  </HelpField>
  ```

- **`HelpHint`** — o (?) sozinho, para todo o resto: ao lado do título de um
  bloco, dentro do `<th>` de uma coluna, junto do rótulo de um filtro, ao lado
  de um selo de estado ou de um número calculado:

  ```tsx
  <span className="flex items-center gap-1.5">
    {t('grade_register.col_deadline')}
    <HelpHint what={t('help.register_deadline_what')} how={t('help.register_deadline_how')} />
  </span>
  ```

É *popover*, não *tooltip*, de propósito: abre no toque (o painel é usado no
celular, `apps/app/CLAUDE.md`, "Celular"), e a área de toque de 44px já está
no componente. É componente de cliente, mas recebe só texto — página de
servidor passa as strings traduzidas e pronto. Serve às três superfícies: o
namespace `bo` é carregado no portal do docente e no do aluno também.

## Onde o (?) é obrigatório

Pergunte: *alguém da coordenação, no primeiro dia, saberia o que é isto e o que
acontece se mexer?* Se não, leva (?). Em especial:

1. **Conceito do negócio** — sub-turma, rodada, tentativa, sobrecupo, módulo
   mensal, consentimento pendente, curso completo, *Página en la web*.
2. **Estado e selo** — *Sin enviar · En revisión · Devuelto · Oficial*, *Fuera
   de plazo*, *Sobrecupo*, *Sin Classroom*, *Ficha por completar*. Um (?) no
   cabeçalho da coluna ou ao lado do filtro de estado explica todos os valores
   de uma vez — não um por selo em cada linha.
3. **Número calculado** — "30 / 30 +2", "0 de 38 notas", contadores de aba,
   prazos ("48 horas desde o fim do módulo"): o que conta e o que não conta.
4. **Filtro com semântica própria** — *Abiertos*, *Vigentes*, *Activos*,
   *Solo fuera de plazo*: o que entra e o que fica de fora.
5. **Campo com consequência** — o que muda ao gravar, para quem, e se volta
   atrás (aposentar, eliminar, *Permite traspaso*, docente, fim do módulo).
6. **Ação irreversível ou que dispara algo** — se manda e-mail, se trava, se
   não se desfaz. Isso vai no `how` do (?) **e** continua no diálogo de
   confirmação; o (?) não substitui a confirmação.

**Não leva (?):** o que se explica sozinho — nome, e-mail, celular, data de
nascimento, busca, botões de navegação. Um (?) em todo campo vira ruído e
ninguém abre mais nenhum.

## O que escrever

- **`what`** — o que é, em uma ou duas frases, na língua do negócio.
  Obrigatório.
- **`how`** — o que fazer com isso ou o que acontece: efeito, quem é avisado,
  se volta atrás, onde se muda. Opcional, mas quase sempre útil.
- **A fonte é a regra, nunca a imaginação.** Leia o item do `CLAUDE.md` (raiz
  §1 e o do app/API) antes de escrever, e explique **o que o sistema faz hoje**.
  Não invente regra (raiz §9): se a tela depende de algo que o `CLAUDE.md` marca
  como "em aberto", o (?) diz o que está construído, sem prometer o resto.
- **Número de regra não se escreve no texto.** Nota mínima, horas de prazo,
  dias de alerta vêm de `platform_settings` (raiz §5): a mensagem leva
  `{hours}`, `{grade}` e a tela passa o valor lido da API — nunca "14" ou "48"
  digitados na mensagem.
- **Sem código de domínio** (raiz §4): nada de `in_review`, `enrolling`,
  `GRADE_WRITE_ROLES`, nome de tabela. Cargo se escreve como a tela o mostra
  (*Supervisión académica*), estado como o selo o mostra (*En revisión*).
- **Tom:** curto, direto, segunda pessoa (*tú* em es-PE, *você* em pt-BR), como
  os `help.*` que já existem. Máximo ~3 linhas no popover de 18rem.

## Chaves e idiomas

- Ajuda de tela vive em `bo.help`: `help.<assunto>_what` e `help.<assunto>_how`
  em `apps/app/src/messages/backoffice/{es-PE,pt-BR,en}.json`. Procure antes uma
  chave que já explique o mesmo conceito e **reuse** — o mesmo conceito explicado
  de dois jeitos em duas telas é pior que nenhuma explicação.
- **Os três idiomas no mesmo PR**, mesma estrutura de chaves, es-PE primeiro
  (raiz §4). Nenhum texto dentro do `.tsx`. Para conferir as chaves de `help`:

  ```bash
  node -e 'const k=l=>Object.keys(require(`./apps/app/src/messages/backoffice/${l}.json`).bo.help).sort().join();const [a,b,c]=["es-PE","pt-BR","en"].map(k);console.log(a===b&&b===c?"help: mesmas chaves":"help: chaves diferentes")'
  ```

## Antes de dar a tela por pronta

- [ ] Todo campo, coluna, filtro, estado e número que não é óbvio tem (?).
- [ ] Cada texto saiu de uma regra do `CLAUDE.md`, sem regra inventada nem
      número de `platform_settings` digitado.
- [ ] Chaves `help.*` nos três idiomas, reusando as que já existiam.
- [ ] No celular (390px) o (?) não empurra o rótulo nem quebra a linha do
      cabeçalho.
- [ ] Mexeu numa tela que já existia sem (?)? Ponha o (?) no que a mudança
      tocou — não precisa varrer a tela inteira no mesmo PR.
