# CLAUDE.md — `apps/landing`

Carregado junto com o `CLAUDE.md` da raiz quando uma sessão trabalha aqui dentro. Regra que vale para mais de um app/pacote vive na raiz — este arquivo só tem o que é específico de `apps/landing`.

---

## Layout da landing — duas larguras de desenho, uma régua em cada

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

Detalhe e histórico da decisão: `docs/ARCHITECTURE.md` §7.

---

Regras de negócio, trilíngue e o resto da arquitetura estão no `CLAUDE.md` da raiz — não duplicadas aqui.
