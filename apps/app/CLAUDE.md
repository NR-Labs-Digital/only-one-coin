# CLAUDE.md — `apps/app`

Carregado junto com o `CLAUDE.md` da raiz quando uma sessão trabalha aqui dentro. Regra que vale para mais de um app/pacote vive na raiz — este arquivo só tem o que é específico do Next.js (portal + backoffice).

---

## Layout das telas

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

## Celular — decisão 06/09/2026

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

## Feature flags — o que está no ar em produção (decisão 06/09/2026; interruptor no painel 08/09/2026; leitura pública 09/09/2026; recuperação da tela 17/09/2026)

**As três superfícies de `apps/app` são geridas por feature flag: portal do
aluno, backoffice e painel do docente.** Uma flag ligada significa que a seção
aparece em produção; desligada significa que ela **não existe em produção** —
some da navegação e a URL responde 404 — e continua inteira **para nós**: local,
deploy de preview da Vercel e, em produção, para quem abriu o destravamento
interno (`/api/preview?token=…`, cookie de 12 h, com tarja em toda tela dizendo
que aquilo não está ativo para mais ninguém).

- **Flag não é controle de acesso.** Quem pode o quê continua sendo o papel
  declarado na rota em `apps/api` (`CLAUDE.md` §8). A flag diz se a
  funcionalidade está no ar; o papel diz para quem ela responde.
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
  `@nrlabsdigital.com` ou `@admin.com` (`isOwnerEmail`, os mesmos domínios do
  `master` — o segundo entrou em 17/09/2026, `CLAUDE.md` §8): o que a
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
  construído" (a Área do aluno do portal, `CLAUDE.md` §2), que é uma afirmação
  pública e diferente.

A ponta do backend (rotas `.owners()`, `feature_flag_overrides`) está em `apps/api/CLAUDE.md`. Detalhe — a pilha completa, o destravamento interno, a tabela de flags de hoje, o desenho da tela e a limitação conhecida (links profundos entre seções do backoffice): `docs/ARCHITECTURE.md` §8.

## Pontos de entrada separados (portal ≠ backoffice)

Um **único backend de auth** (um só provedor de auth, um só registro de usuários) — a separação de acesso é a checagem de **`role`** em `apps/api`, nunca a tela. Mas **três telas de login distintas**, pelo mesmo app Next.js (não são dois deploys):

- **Portal do aluno** — `/` ou `/portal`, linkado da landing, indexável, sem MFA. **Sem auto-cadastro**: a aprovação do pagamento cria a conta e o aluno recebe por e-mail um link para definir a senha, não se registra. **Sessão real (05/10/2026):** toda página de `/portal` chama `getStudentSession` (`lib/portal/session.ts` → `GET /api/v1/portal/me`) e qualquer não-OK, inclusive sessão de staff, volta a `/login`. Telas `/login` (proxy same-origin para `/api/v1/portal/sign-in`), `/forgot-password` e `/access/[token]`; logout real por `lib/auth/sign-out.ts`, compartilhado com o backoffice. **Dados reais (OOC-32, 07/10/2026):** as telas leem `getPortalView` (`GET /api/v1/portal/overview`, memoizado por requisição); o que ainda não tem backend chega vazio, nunca como persona de exemplo — não existe mais mock no portal. Para o aluno, `pending` e `under_review` são um estado só (`lib/portal/overview.ts`): "pendente" ao lado de dinheiro já enviado vira "pague de novo", e a diferença é veredito do semáforo, que é do revisor.
- **Backoffice** — path interno `/backoffice`, **nunca linkado na landing nem indexável**, MFA no fluxo (OOC-29): depois da senha, a tela pede o código enviado ao e-mail (ou um código de recuperação); conta de `master`/`admin`/`billing` sem o fator cai no passo de ativação (`/backoffice?mfa=setup`, para onde `getStaffSession` manda quem a API recusa com `auth.mfa_enrollment_required`). Ativar, regenerar códigos e desligar (só onde é opcional) ficam em *Mi cuenta*. A tela só guia — quem exige é a API. Esse caminho todo é defesa em profundidade, não a defesa.
- **Portal do docente** — `/docente`, **porta própria** (antes o docente entrava pelo backoffice com o menu estreitado): login próprio, shell próprio, nunca linkado na landing nem indexável. Mesmo Better Auth, mesmo `/me` e o mesmo formulário de login (com os passos de MFA), que termina em `/docente/home` — a separação é o cargo lido no servidor: `teacher` em `/backoffice` vai para `/docente/home`, qualquer outro cargo em `/docente` volta para `/backoffice/home` (`getTeacherSession()`, `lib/backoffice/session.ts`). **Quem decide a porta é só o cargo, nunca o vínculo com a ficha:** conta `teacher` sem ficha (`teacherId: null`, aberta antes da OOC-79) fica no portal com escopo vazio — mandá-la ao backoffice criaria um loop de redirect, porque o backoffice devolve todo docente pra cá. Vê só as próprias turmas — checagem no usecase, não filtro solto. O portal inteiro responde à flag `teacher`.
- **Redirect por `role` sempre server-side.** O cliente nunca escolhe "sou aluno/sou admin"; o `role` vem do banco, lido por `apps/api`.

### Dois domínios, um deploy (decisão 29/09/2026)

`student.onlyonecoin.edu.pe` e `backoffice.onlyonecoin.edu.pe` são dois domínios
custom apontados pro **mesmo projeto Vercel** (`apps/app`) — não tem deploy
separado por superfície. `student.*` não precisa de tratamento: a raiz do app
já é o portal. `backoffice.*` precisa cair sob `/backoffice`, e isso é feito
por **rewrite baseado em host** em `src/middleware.ts`, antes do
`next-intl` resolver o locale (senão `/en` vira `/backoffice/en` em vez de
`/en/backoffice`) — é rewrite, não redirect: a URL que o navegador mostra
continua no domínio do backoffice, nunca expõe o path interno.

Domínio dedicado não substitui a defesa real (RBAC em `apps/api`) nem some do
Certificate Transparency log só por não estar linkado — é só mais uma camada,
igual o path discreto já era.

### Código compartilhado entre superfícies (23/10/2026)

**Uma superfície nunca importa da pasta de rota de outra.** O que `/portal`, `/backoffice` e `/docente` usam em comum mora em `src/components/` ou `src/lib/` — nunca `import … from '../../../backoffice/(panel)/(gated)/…'` de dentro de `docente/`. A pasta de rota é da tela dela: renomear um segmento, um route group ou mover um arquivo ali não pode quebrar outra porta, e quem lê `backoffice/` não pode precisar saber que o docente depende daquilo. Server action também é por superfície (`backoffice/actions.ts`, `docente/actions.ts`). Peça que passa a servir uma segunda porta **muda de pasta no mesmo PR** — como a tela de conta (`components/backoffice/account/`) quando o portal do docente nasceu.

**Dívida conhecida, a zerar na OOC-82:** `docente/page.tsx` ainda importa `backoffice/backoffice-login-form` (que puxa `backoffice/icons`, usado por mais cinco telas do backoffice) e `docente/(panel)/profile` importa `backoffice/…/teachers/[teacherId]/teacher-file` (que puxa `save-teacher`, `availability-fields` e `students/field-message`). Não acrescentar uma terceira.

## RBAC na UI

A matriz tela-a-tela vive em `apps/app/src/lib/backoffice/permissions.ts` — é gate de UI (esconder/mostrar), **não** o mecanismo de aceite; o mecanismo real é deny-by-default em `apps/api` (`apps/api/CLAUDE.md`). Quadro de papéis, o que cada um pode e o modelo de criação/promoção de staff: `CLAUDE.md` §8 (raiz) e `apps/api/CLAUDE.md` (gestão de cargos).

---

Regras de negócio, stack, i18n e o quadro de papéis/RBAC estão no `CLAUDE.md` da raiz — não duplicadas aqui. Estado real das telas (o que é mock, o que já lê da API): [`README.md`](README.md) deste app, seção "Estado por tela" — atualize a linha no mesmo PR que muda a tela.
