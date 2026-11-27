// OOC-45: every URL the old WordPress site had indexed answers 301 to its
// counterpart on the new site — never 404.
//
// The rules live in `vercel.json` (`redirects`), served at the Vercel edge.
// This test compiles that file with `@vercel/routing-utils`, the same library
// Vercel uses, so the matching here is Vercel's: case-sensitive, and strict
// about the trailing slash (`strict: true, sensitive: true`). A rule that reads
// right but misses `/Nosotros` or `/contacto/` fails here, not in production.
import { readFileSync } from "node:fs";
import { getTransformedRoutes } from "@vercel/routing-utils";
import { describe, expect, it } from "vitest";
import { audienceAnchors } from "../src/i18n/ui";
import { indexablePaths } from "../src/seo/routes";

type Route = {
  src: string;
  status?: number;
  headers?: Record<string, string>;
  has?: { type: string; key: string; value?: string }[];
};

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  redirects: unknown[];
};
const transformed = getTransformedRoutes(config as Parameters<typeof getTransformedRoutes>[0]);
const routes = (transformed.routes ?? []) as Route[];

/** What Vercel answers for a request: the first matching redirect, or null. */
function resolve(url: string): { status: number; location: string } | null {
  const { pathname, searchParams } = new URL(url, "https://landing.invalid");
  for (const route of routes) {
    if (!route.headers?.Location || !new RegExp(route.src).test(pathname)) continue;
    const queryOk = (route.has ?? []).every(
      (h) =>
        h.type === "query" &&
        searchParams.has(h.key) &&
        (h.value === undefined || searchParams.get(h.key) === h.value),
    );
    if (queryOk) return { status: route.status ?? 0, location: route.headers.Location };
  }
  return null;
}

/**
 * The old site's URLs, gathered on 27/11/2026 from the Wayback Machine: the
 * Yoast sitemaps (`sitemap_index.xml` and the five it lists), the CDX index of
 * the domain, and the links of the archived pages. `?p=<id>` ids were resolved
 * through the archived `wp-json`. Files (`/wp-content/*`) and WordPress
 * internals (`/wp-admin`, `/wp-json`) are left out on purpose: they have no
 * counterpart, and no search result points a person to them.
 */
const LEGACY: [old: string, destination: string][] = [
  // Pages (page-sitemap.xml) and the spellings the old menu linked to.
  ["/Inicio", "/"],
  ["/nosotros/", "/about"],
  ["/Nosotros", "/about"],
  ["/Nosotros/", "/about"],
  ["/cursos/", "/courses"],
  ["/Cursos", "/courses"],
  ["/Cursos/", "/courses"],
  ["/contacto/", "/contact"],
  ["/Contactanos", "/contact"],
  ["/Contactanos/", "/contact"],
  ["/terminos-y-condiciones/", "/terms-and-conditions"],
  ["/politicas-de-privacidad/", "/privacy-policy"],
  ["/pagina-de-registro-para-instructores/", "/contact"],
  ["/escritorio/", "/login"],
  ["/escritorio/retrieve-password/", "/login"],
  ["/mi-cuenta/", "/login"],
  ["/mi-cuenta/lost-password/", "/login"],
  ["/registro-de-estudiante/", "/enrollment"],
  ["/tienda/", "/courses"],
  ["/tienda/feed/", "/courses"],
  ["/cart/", "/enrollment"],
  ["/carrito/", "/enrollment"],
  ["/checkout/", "/enrollment"],
  ["/finalizar-compra/", "/enrollment"],
  // Products (product-sitemap.xml) and courses (Tutor LMS): the two old
  // products were the English course for kids and for teens and adults.
  ["/producto/ninos-6-12-anos/", "/courses/english#kids"],
  ["/producto/ninos-6-12-anos/feed/", "/courses/english#kids"],
  ["/producto/jovenes-y-adultos-13-anos-en-adelante/", "/courses/english#teens-and-adults"],
  ["/cursosone/", "/courses"],
  ["/cursosone/ninos-6-12-anos/", "/courses/english#kids"],
  ["/cursosone/ninos-6-12-anos/lecciones/ingles-basico/", "/courses/english#kids"],
  ["/cursosone/jovenes-y-adultos-13-anos-en-adelante/", "/courses/english#teens-and-adults"],
  ["/lesson/", "/courses"],
  ["/lesson/feed/", "/courses"],
  ["/categoria-producto/cursos/", "/courses"],
  ["/categoria-producto/cursos/feed/", "/courses"],
  ["/course-category/cursos/", "/courses"],
  ["/course-category/cursos/?tutor-course-filter-category=23", "/courses"],
  ["/course-tag/ninos/", "/courses"],
  ["/course-tag/cursos-para-adultos/feed/", "/courses"],
  ["/course-tag/13-anos/", "/courses"],
  // Author and instructor profile.
  ["/author/onlyonecoin/", "/about"],
  ["/author/onlyonecoin/feed/", "/about"],
  ["/profile/onlyonecoin/", "/about"],
  ["/profile/onlyonecoin/?view=instructor", "/about"],
  // Theme parts (elementor-hf-sitemap.xml), feeds and the old sitemaps.
  ["/elementor-hf/pie/", "/"],
  ["/elementor-hf/head/", "/"],
  ["/feed/", "/blog"],
  ["/comments/feed/", "/blog"],
  ["/sitemap_index.xml", "/sitemap.xml"],
  ["/page-sitemap.xml", "/sitemap.xml"],
  ["/product-sitemap.xml", "/sitemap.xml"],
  ["/lesson-sitemap.xml", "/sitemap.xml"],
  ["/product_cat-sitemap.xml", "/sitemap.xml"],
  ["/elementor-hf-sitemap.xml", "/sitemap.xml"],
  // WordPress short links (`/?p=<id>`); ids from the archived wp-json.
  ["/?p=262", "/courses"],
  ["/?p=271", "/about"],
  ["/?p=456", "/contact"],
  ["/?p=973", "/privacy-policy"],
  ["/?p=984", "/terms-and-conditions"],
  ["/?p=1411", "/login"],
  ["/?p=1412", "/enrollment"],
  ["/?p=1413", "/contact"],
  ["/?p=1456", "/login"],
  ["/?p=1460", "/courses/english#kids"],
  ["/?p=1531", "/courses/english#teens-and-adults"],
  ["/?post_type=courses&p=1414", "/courses"],
  ["/?post_type=courses&p=1449", "/courses"],
];

/** Paths a redirect may land on: landing pages, plus the app doors the
 * landing's own middleware sends on (`middleware.ts`). */
const LANDING_PATHS = new Set([...indexablePaths, "/blog", "/sitemap.xml"]);
const APP_DOORS = new Set(["/login", "/enrollment"]);
// The kids and teens-and-adults blocks of the English course page.
const ANCHORS: Record<string, readonly string[]> = { "/courses/english": audienceAnchors };

describe("legacy WordPress redirects (OOC-45)", () => {
  it("vercel.json compiles with Vercel's own rules", () => {
    expect(transformed.error).toBeNull();
  });

  it.each(LEGACY)("%s → 301 %s", (old, destination) => {
    expect(resolve(old)).toEqual({ status: 301, location: destination });
  });

  it("every redirect lands on a page that exists", () => {
    for (const route of routes) {
      const location = route.headers?.Location;
      if (!location) continue;
      const [path, anchor] = location.split("#");
      expect(LANDING_PATHS.has(path) || APP_DOORS.has(path), location).toBe(true);
      if (anchor) expect(ANCHORS[path], location).toContain(anchor);
    }
  });

  it("the new site's own pages are not redirected", () => {
    for (const path of [...LANDING_PATHS, "/", "/en", "/pt", "/en/about", "/pt/courses"]) {
      expect(resolve(path), path).toBeNull();
    }
  });
});
