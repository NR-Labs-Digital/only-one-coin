/* eslint-disable i18next/no-literal-string --
   whole file is technical identifiers (landing course keys, URL query param
   names) that are never rendered to a user — none of it is UI text. */
import { isLandingCourseKey, type LandingCourseKey } from "@ooc/domain/landing-course-keys";
import { courseSlugs, type CourseSlug } from "../i18n/ui";

/**
 * Ponte entre a landing e o checkout de `apps/app`.
 *
 * A landing manda a CHAVE da página (`?course=english-intermediate`), nunca o
 * id do curso (OOC-117). Id é UUID gerado pelo banco de cada ambiente: um mapa
 * de ids gravado neste site estático apontava para nada no dia em que o curso
 * era recriado no backoffice, nunca casava com staging nem com o seed local —
 * e o checkout abria vazio sem ninguém perceber. A chave é vocabulário da
 * própria landing; quem diz qual curso responde por ela é o backoffice (ficha
 * do curso → "Página en la web"), em cada ambiente.
 *
 * O checkout continua tratando o valor como PRÉ-SELEÇÃO, nunca afirmação
 * (`CLAUDE.md` §2 — sem link tokenizado): chave sem curso vivo com turma aberta
 * abre o passo 1 vazio. O que muda é que isso deixou de ser silencioso — o
 * backoffice lista as páginas sem curso ligado.
 */

/**
 * Toda página de curso tem chave na lista do domínio. Roda no build: página
 * nova em `courseSlugs` sem chave em `LANDING_COURSE_KEYS` derruba o
 * `astro build` (e o CI, que builda a landing), em vez de publicar um botão
 * que não leva a curso nenhum.
 */
const missing = courseSlugs.filter((slug) => !isLandingCourseKey(slug));
if (missing.length > 0) {
  throw new Error(
    `Landing course pages without a key in LANDING_COURSE_KEYS (@ooc/domain): ${missing.join(", ")}`,
  );
}

/** A página de curso é a própria chave — checado acima. */
export function courseKeyOf(slug: CourseSlug): LandingCourseKey {
  return slug as LandingCourseKey;
}

/** Inglês para crianças é um curso próprio, não o mesmo com outra idade. */
export const englishKidsCourseKey: LandingCourseKey = "english-kids";

/**
 * Link de matrícula com o curso já escolhido.
 *
 * `content` diz de qual peça da landing a pessoa saiu (herói, card de
 * programa, sugestão por geo). Vai como `utm_content`, que o checkout guarda
 * separado do canal: `source` responde "quem trouxe" (web ou whatsapp) e o
 * `utm_*` responde "de qual peça" (`CLAUDE.md` §5).
 */
export function enrollmentHref(
  basePath: string,
  options: { courseKey?: LandingCourseKey; content: string },
): string {
  const params = new URLSearchParams();
  if (options.courseKey) params.set("course", options.courseKey);
  params.set("utm_source", "landing");
  params.set("utm_content", options.content);
  return `${basePath}?${params.toString()}`;
}
