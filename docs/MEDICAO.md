# Medição — PostHog e píxeis de mídia paga (OOC-47)

O que mede o funil de matrícula, onde roda, o que **nunca** sai daqui e o que falta configurar para ligar em produção.

## Onde roda

| Superfície | PostHog | Meta / TikTok |
| --- | --- | --- |
| Landing (`apps/landing`, toda página) | sim | só com o banner aceito |
| Checkout público (`apps/app`, `/enrollment` e `/enrollment/wa`) | sim | só com o banner aceito |
| Portal do aluno, backoffice, portal do docente, Libro de Reclamaciones | **não** | **não** |

Fora do checkout o `apps/app` não importa nada de medição, e a CSP dessas telas não tem nenhum host de terceiro (`apps/app/src/lib/analytics/measured-path.ts`, lido pelo `middleware.ts`).

## Consentimento (decisão de 27/11/2026 com o Miguel — a confirmar com o dono)

Ley 29733, e boa parte do público é menor de idade. Duas camadas:

- **PostHog carrega para todos, sem cookie.** O id anônimo vive no `sessionStorage` da aba (some ao fechar), sem perfil de pessoa (`person_profiles: identified_only`, e ninguém é identificado), sem autocapture, sem gravação de sessão, sem pesquisa, sem nada lido de formulário. Os ids de clique de anúncio (`fbclid`, `gclid`…) são mascarados nas URLs. Os eventos vão pelo próprio domínio (`/ooc-ev`, rewrite na Vercel para o EU Cloud do PostHog) — a CSP continua `connect-src 'self'` para ele.
- **Meta e TikTok só depois de "Aceptar"** num banner trilíngue, na landing e no checkout. Recusar é um botão do mesmo tamanho. A resposta fica no cookie `ooc_ad_consent` (`granted`/`denied`, 180 dias — número provisório), no domínio-pai quando configurado, para a landing e o checkout perguntarem uma vez só. O rodapé da landing (*Cookies*) e o rodapé do checkout reabrem o banner; retirar um "sim" recarrega a página, e o píxel não carrega de novo.

Vocabulário único (nome do cookie, eventos, parâmetro do hand-off): `packages/domain/src/analytics/adConsent.ts` (`@ooc/domain/analytics`).

## O funil no PostHog

Eventos, em ordem (`FUNNEL_EVENTS`):

| Evento | Onde | Propriedades |
| --- | --- | --- |
| `$pageview` | landing e checkout | as do PostHog (URL com UTM, referrer) |
| `enrollment_cta_clicked` | landing, clique em qualquer link para `/enrollment` | `content` (`utm_content` do botão), `course` (chave da página) |
| `checkout_started` | checkout aberto | — |
| `checkout_step_viewed` | cada passo que entra na tela | `step`: `course` · `student` · `payment` · `review` |
| `checkout_submitted` | a API aceitou o comprovante | `courses`, `value` (soma dos preços vigentes, em soles), `currency: PEN`, `source` (`web`/`whatsapp`/`whatsapp_ai`) |

**Landing → checkout é um funil só:** são subdomínios diferentes e o PostHog não usa cookie, então o clique no botão de matrícula leva o id anônimo no fragmento da URL (`/enrollment#ph_id=<uuid>`). O fragmento passa pelo 302 da landing para o app, nunca chega a log de servidor, não se mistura com os parâmetros de pré-seleção e atribuição, e o checkout o tira da barra de endereço assim que lê.

**Insight a criar no PostHog** (Product analytics → New insight → Funnel, janela de 1 dia): `$pageview` (landing) → `enrollment_cta_clicked` → `checkout_started` → `checkout_step_viewed` (`step = student`) → `checkout_step_viewed` (`step = payment`) → `checkout_step_viewed` (`step = review`) → `checkout_submitted`. Quem chega pelo link do vendedor entra direto em `checkout_started`.

**Nunca sai:** nome, documento, e-mail, celular, data de nascimento, comprovante, número de operação. O que vai é o passo, o curso (chave da página) e a forma da compra.

## Os píxeis

Eventos padrão de cada rede (o vocabulário que a otimização de campanha entende):

| Momento | Meta | TikTok |
| --- | --- | --- |
| Toda página da landing e o checkout aberto | `PageView` | `page()` |
| Checkout aberto | `InitiateCheckout` | `InitiateCheckout` |
| Comprovante aceito | `Purchase` (`value`, `currency: PEN`, `num_items`) | `CompletePayment` (`value`, `currency`, `quantity`) |

**`Purchase` é proposta, a confirmar com o dono:** no envio o aluno já pagou (o comprovante é a prova), mas o pagamento ainda não foi aprovado em Pagos — uma rejeição posterior não é descontada nas redes. A alternativa é `CompleteRegistration`, sem valor.

O id do evento de conversão é a chave de idempotência do envio, então um reenvio é uma conversão só.

**Sem dado pessoal:** os stubs são módulos do nosso bundle (nunca o snippet inline, que a CSP recusa) — `apps/landing/src/analytics/pixels.ts` e o gêmeo `apps/app/src/lib/analytics/pixels.ts`, mudados juntos. A configuração automática do Meta (que lê botões e campos) é desligada no código (`autoConfig: false`); advanced matching nunca é enviado.

## Para ligar em produção

1. **PostHog:** criar o projeto no EU Cloud; em *Project settings*, ligar **Discard client IP data**. A *Project API key* (`phc_…`) vai em `PUBLIC_POSTHOG_KEY` (landing) e `NEXT_PUBLIC_POSTHOG_KEY` (app), na Vercel, só em Production.
2. **Píxeis — ids do cliente** (pendentes, comentário de 23/11 na OOC-47): `PUBLIC_META_PIXEL_ID`/`NEXT_PUBLIC_META_PIXEL_ID` e `PUBLIC_TIKTOK_PIXEL_ID`/`NEXT_PUBLIC_TIKTOK_PIXEL_ID`. No Events Manager do Meta **e** do TikTok, deixar **desligada** a *correspondência avançada automática* — ela lê os campos do formulário (e-mail, celular), e o código não alcança esse interruptor.
3. **Cookie compartilhado:** `PUBLIC_CONSENT_COOKIE_DOMAIN` e `NEXT_PUBLIC_CONSENT_COOKIE_DOMAIN` = `.onlyonecoin.edu.pe`. Vazio, cada site pergunta por conta própria.
4. **Política de privacidade:** a seção 8 ("Uso de cookies") é o texto assinado pela empresa e **não foi alterada**. Antes de pôr os ids dos píxeis, o dono precisa aprovar o texto abaixo (ou o dele) — o banner linka a política. Proposta em es-PE, a traduzir para en/pt em `apps/landing/src/i18n/legal.ts`:

   > El Sitio usa tres tipos de tecnologías: (a) **necesarias**, que guardan tu respuesta sobre cookies de publicidad y el avance de tu formulario de matrícula; (b) **analítica propia** (PostHog, servidores en la Unión Europea), sin cookies, con un identificador anónimo que se borra al cerrar la pestaña, para saber en qué paso del formulario de matrícula las personas abandonan — nunca registra lo que escribes; y (c) **publicidad** (píxeles de Meta y TikTok), que solo se activan si las aceptas en el aviso de cookies y sirven para medir nuestros anuncios. Nunca enviamos a Meta ni a TikTok tu nombre, documento, correo o teléfono. Puedes cambiar tu decisión en cualquier momento desde el enlace "Cookies" al pie de cada página.

Sem os ids, nada de píxel carrega e o banner não aparece; só o PostHog roda (se a chave estiver configurada).

## CSP

- Landing (`apps/landing/vercel.json`): `script-src` ganha `connect.facebook.net` e `analytics.tiktok.com`; `connect-src` ganha `www.facebook.com`, `connect.facebook.net`, `analytics.tiktok.com`, `analytics-ipv6.tiktokw.us`; `img-src` ganha `www.facebook.com` e `analytics.tiktok.com`. Nada de `'unsafe-inline'`.
- App (`apps/app/src/middleware.ts`): os mesmos hosts, **só nas rotas do checkout**. O script dos píxeis é inserido pelo nosso bundle com nonce, que o `'strict-dynamic'` já confia.
- O `analytics-ipv6.tiktokw.us` não está em documentação oficial que tenhamos achado; vem do comportamento observado do `events.js`. Se o console mostrar violação de CSP de outro host do TikTok ou do Meta depois de ligar os ids, é aqui que se acrescenta.

## Proxy do PostHog

`/ooc-ev/*` → `eu.i.posthog.com` (e `/ooc-ev/static|array/*` → `eu-assets.i.posthog.com`): na landing por `rewrites` do `vercel.json`, no app por `rewrites` do `next.config.ts` (com `skipTrailingSlashRedirect`, que o PostHog exige — as rotas dele terminam em `/`). O caminho fica fora do `middleware.ts` do app. Nome não genérico de propósito: bloqueador de anúncio lista `/ingest`, `/analytics` e afins.
