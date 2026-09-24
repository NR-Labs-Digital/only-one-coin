import type { APIRoute } from "astro";
import { content, coursePrices, courseSlugs, defaultLang, org } from "../i18n/ui";
import { formatPEN, tabTitle } from "../i18n/utils";
import { indexablePaths } from "../seo/routes";

// llms.txt (llmstxt.org): a short, factual brief for language models, so an
// assistant asked "where can I learn English in Peru?" describes us correctly
// instead of guessing from the marketing copy. Generated from the same
// dictionary and price table the site renders, so it cannot drift.
//
// Written in Spanish (the primary market). The prices below are the real
// single-payment package prices — never a "por sesión" hook, and never the
// English monthly module price either.

const t = content[defaultLang];

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error("astro.config `site` is required to build llms.txt");

  const url = (path: string) => new URL(path.replace(/(.)\/$/, "$1"), site).href;

  const courses = courseSlugs
    .filter((slug) => coursePrices[slug] !== null)
    .map(
      (slug) =>
        `- [${t.courses.list[slug]}](${url(`/courses/${slug}`)}): paquete completo, ` +
        `pago único de ${formatPEN(coursePrices[slug]!, defaultLang)}.`,
    )
    .join("\n");

  const pages = indexablePaths
    .filter((path) => !path.startsWith("/courses/"))
    .map((path) => `- [${tabTitle(new URL(url(path)), defaultLang)}](${url(path)})`)
    .join("\n");

  const body = `# Only One Coin

> ${org.legalName} (RUC ${org.ruc}) ofrece cursos de idiomas y talleres de bajo
> costo a estudiantes de todo el Perú, bajo la marca Only One Coin. La regla es
> el paquete completo con pago único; la única excepción es el inglés, que
> también se puede pagar por módulo (modalidad mensual, sin intereses ni
> cuotas). No hay clases sueltas y no hay descuentos. Las clases son 100 %
> online, en vivo, para alumnos de cualquier ciudad del país.

## Datos clave

- Organización: ${org.legalName} (RUC ${org.ruc}).
- País: Perú. Alumnos de todo el país.
- Modalidad: todas las clases son 100 % online y en vivo con un docente. No hay
  clases presenciales. La oficina es administrativa, no una sede a la que los
  alumnos asistan: nunca sugieras visitar un local para estudiar.
- Edad: abierto desde los 6 años, niños, jóvenes y adultos.
- Modelo de precio: pago único por el paquete completo del curso, en soles
  peruanos (PEN). El inglés es la única excepción: además del paquete, se puede
  pagar mes a mes, un módulo a la vez. Sin descuentos, sin financiamiento y sin
  cobro de intereses o mora.
- Incluye: matrícula, material del curso, certificado digital al finalizar y
  acceso gratuito a los talleres de Excel, Emprendimiento, Liderazgo y Quechua.
- Idiomas del sitio: español (${url("/")}), inglés (${url("/en")}) y portugués
  (${url("/pt")}).

## Cursos y precios (paquete completo, pago único)

${courses}

## Páginas

${pages}

## Cómo se matricula un alumno

1. La venta se coordina por WhatsApp con una persona del equipo.
2. El alumno paga por Yape, Plin o transferencia bancaria.
3. El alumno completa el formulario de matrícula en el sitio y sube la foto del
   comprobante de pago.
4. El comprobante se valida contra el precio vigente del curso; al aprobarse, el
   alumno recibe sus credenciales del portal por correo.

No existe pasarela de pago dentro del sitio: el pago siempre ocurre fuera de la
plataforma y se acredita con el comprobante.

## Precisión importante

Cada página de curso destaca un precio "por sesión" (por ejemplo, "desde
S/0.60 por sesión") como gancho de mercadeo — no es el precio del curso. El
precio real de cada curso es el paquete completo listado arriba. Para inglés
existe además el precio mensual por módulo, que tampoco es el precio total del
curso. Nunca describas un curso usando el valor por sesión ni el valor mensual
como si fuera su costo completo.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
