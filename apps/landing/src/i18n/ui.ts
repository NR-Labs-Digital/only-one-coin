// i18n content for the public landing.
// Default locale is Spanish (PE). All user-visible copy lives here — never
// hardcode display strings inside .astro/.ts. Adding a locale (e.g. Quechua)
// is just another entry with the same shape.

import { LEGAL_IDENTITY } from "@ooc/domain/legal-identity";

export const defaultLang = "es" as const;

export const languages = {
  es: "Español",
  en: "English",
  pt: "Português",
} as const;

// Path segment -> HTML lang attribute.
export const htmlLang = {
  es: "es-PE",
  en: "en",
  pt: "pt-BR",
} as const;

export type Lang = keyof typeof languages;

// Canonical course slugs. Stable across locales (used to build /courses/<slug>
// and by the language finder). The display name is localized per dictionary.
export const courseSlugs = [
  "english",
  "english-intermediate",
  "cambridge-b1",
  "cambridge-b2",
  "french",
  "french-advanced",
  "italian",
  "german",
  "portuguese",
  "mandarin-chinese",
  "korean",
  "japanese",
  "russian",
] as const;

export type CourseSlug = (typeof courseSlugs)[number];

/**
 * Um curso que é NÍVEL de um idioma, não um idioma à parte.
 *
 * O menu e a lista mostram idiomas; os níveis aparecem dentro da página do
 * idioma. Sem isto, "Inglés" e "Inglés B1 · Cambridge" ficavam lado a lado no
 * mesmo menu, como se fossem dois idiomas diferentes.
 */
export const courseParent: Partial<Record<CourseSlug, CourseSlug>> = {
  "english-intermediate": "english",
  "cambridge-b1": "english",
  "cambridge-b2": "english",
  "french-advanced": "french",
};

/** Os idiomas — o que entra no menu, na lista e no seletor por geo. */
export const languageSlugs = courseSlugs.filter((slug) => !courseParent[slug]);

/** Níveis de um idioma, na ordem em que aparecem. */
export function levelsOf(slug: CourseSlug): CourseSlug[] {
  return courseSlugs.filter((candidate) => courseParent[candidate] === slug);
}

// Anchor names for the two audience blocks on a course page, in the order they
// are listed in `courses.detail.audiences`. They end up in the address bar, so
// they read as words, never as an index (CLAUDE.md §4: no technical id ever
// reaches the user). The homepage "Programas" cards link straight to them.
export const audienceAnchors = ["kids", "teens-and-adults"] as const;

// Idade de entrada, por curso. Todo idioma é de jovens e adultos — 13 anos em
// diante; a faixa de 6 a 12 existe só no OOC Kids, que é inglês para crianças
// (palavra do dono, 05/09/2026). A lista existe para o dia em que outro idioma
// abrir turma de crianças: a página lê daqui, não de um `if` com "english"
// escrito no meio do componente.
const kidsCourses: CourseSlug[] = ["english"];

/** O curso tem faixa de crianças (6 a 12) além da de jovens e adultos? */
export function hasKidsProgram(slug: CourseSlug): boolean {
  return kidsCourses.includes(slug);
}

// Full-package ("paquete completo", pago único) price per course, in PEN.
// Source: the merchant e-commerce catalog.
//
// Displayed ONLY inside the modality block of a course page (2026-09-04): the
// headline of every page is the per-session price, and the package total shows
// up next to it as one of the ways to pay — never as the number the page
// leads with. Display copy only; the payment system is the source of truth for
// charged amounts. A course whose price is `null` simply loses that modality
// card instead of showing an invented number.
export const coursePrices: Record<CourseSlug, number | null> = {
  // Tabela de preços da coordenação, 29/09/2026 (Actualizacion_de_Precios.docx).
  "english": 79.9,
  // Nível Intermedio/Avanzado = livros 5 e 6, 80 sessões.
  "english-intermediate": 94.9,
  // Cambridge: dois cursos diferentes (B1 e B2), mesmo preço, 80 horas cada.
  "cambridge-b1": 140,
  "cambridge-b2": 140,
  "french": 95,
  // `null` = preço ainda não definido pela coordenação. A página omite o valor
  // em vez de inventar um: preço é dado de negócio, nunca chute (CLAUDE.md §9).
  "french-advanced": 140,
  "italian": 89.9,
  // "Alemán Regular (1 mes – 20 horas)". O Intensivo é outro card, em
  // `extraPlans`.
  "german": 40,
  "portuguese": 89.9,
  "mandarin-chinese": 109.9,
  "korean": 70,
  "japanese": 50,
  "russian": 50,
};

/**
 * Preço POR SESSÃO de cada curso, em PEN — o gancho da marca, e o número que
 * a landing mostra maior que qualquer outro.
 *
 * Não é o total dividido pelas sessões: é o valor que a coordenação anuncia
 * (planilha de 07/10/2026), e as duas contas nem sempre fecham. Quem manda é
 * a tabela, nunca a divisão.
 *
 * `null` = sem valor anunciado; o card então mostra só o total, sem a
 * equivalência por sessão.
 */
export const sessionPrices: Record<CourseSlug, number | null> = {
  // Coluna "Precio por sesión" da planilha da coordenação (Hoja OOC,
  // 07/10/2026). O S/0.60 é só do Inglés Total, em `bundles`.
  "english": 1,
  "english-intermediate": 1.2,
  "cambridge-b1": 1.8,
  "cambridge-b2": 1.8,
  "french": 1.2,
  "french-advanced": 1.8,
  "italian": 1.5,
  // Alemán 1 mes: S/40, 20 horas.
  "german": 2,
  "portuguese": 1.1,
  "mandarin-chinese": 1.8,
  "korean": 1.8,
  // 8 horas a S/50.
  "japanese": 6.3,
  // 12 horas a S/50.
  "russian": 4.2,
};

// Monthly ("mensual") modality — price per module, in PEN. Only English
// courses have it (CLAUDE.md §1, decision 2026-09-02): the student pays
// module by module instead of the full package. Absent slug = no monthly
// option; the course page then shows the package alone. Same caveat as
// `coursePrices`: display copy only, the payment system is the source of
// truth for charged amounts.
export const monthlyPrices: Partial<Record<CourseSlug, number>> = {
  "english": 25,
};

/**
 * Formas de pagar um nível que não são nem o mensual, nem o paquete, nem um
 * pacote de vários níveis (tabela de 29/09/2026): dois ou três módulos do
 * inglês básico de uma vez, e o alemão intensivo ao lado do regular.
 *
 * Cada uma vira um card no bloco de modalidades do próprio curso. Nome e
 * linha de benefícios saem do locale (`paymentExtraNames` /
 * `paymentExtraPerks`) — nada de texto aqui. Mesma ressalva do resto do
 * arquivo: é copy de vitrine, quem manda no valor cobrado é o sistema de
 * pagamento.
 */
export const extraPlans = {
  "english-2-modules": { course: "english" as CourseSlug, price: 35.9, perSession: null as number | null },
  "english-3-modules": { course: "english" as CourseSlug, price: 58.9, perSession: null as number | null },
  // "2 horas diarias – 40 horas en total", S/80: S/2 a hora, como o regular.
  "german-intensive": { course: "german" as CourseSlug, price: 80, perSession: 2 as number | null },
  // "Ruso dos módulos": 24 horas, S/4.2 a hora (planilha de 07/10/2026).
  "russian-2-modules": { course: "russian" as CourseSlug, price: 99.9, perSession: 4.2 as number | null },
};

export type ExtraPlanId = keyof typeof extraPlans;

/**
 * Pacotes que cobrem MAIS DE UM nível de um idioma, pagos de uma vez.
 *
 * Não são cursos: não têm slug de catálogo, não entram no menu nem viram
 * página. São uma FORMA DE PAGAR (decisão do dono, 04/09/2026) — um terceiro
 * card no bloco de modalidades, ao lado do mensual e do paquete do nível.
 *
 * `covers` diz em quais painéis o card aparece, e é também o que a lista do
 * card mostra ("Básico + Intermedio/Avanzado"), montado a partir do nome curto
 * de cada nível — nada de escrever a combinação à mão em três idiomas.
 */
export const bundles = {
  // INGLÉS TOTAL: Básico + Intermedio + Avanzado, 160 sessões + reforzamiento
  // + talleres. É o ÚNICO programa a S/0.60 a hora (tabela de 29/09/2026) —
  // o "desde S/0.60" do site inteiro mora aqui.
  "english-total": {
    price: 149.9,
    perSession: 0.6 as number | null,
    covers: ["english", "english-intermediate"] as CourseSlug[],
  },
  // "Francés Completo": 200 horas, S/1.0 a hora (planilha de 07/10/2026).
  "french-full": {
    price: 199.9,
    perSession: 1 as number | null,
    covers: ["french", "french-advanced"] as CourseSlug[],
  },
};

export type BundleId = keyof typeof bundles;

/**
 * O "desde" de um curso: o menor preço por sessão entre TODAS as formas de
 * pagar que a página dele oferece — o paquete do nível, os pacotes que o
 * cobrem e os planos extras. No inglés é o Inglés Total (S/0.60) que dá o
 * número, não o básico (tabela de 29/09/2026: "el precio desde S/0.60 la hora
 * corresponde únicamente al programa INGLÉS TOTAL"). `null` quando nenhuma
 * delas tem valor por sessão anunciado.
 */
export function lowestSessionPrice(slug: CourseSlug): number | null {
  const candidates = [
    sessionPrices[slug],
    ...Object.values(bundles)
      .filter((bundle) => bundle.covers.includes(slug))
      .map((bundle) => bundle.perSession),
    ...Object.values(extraPlans)
      .filter((plan) => plan.course === slug)
      .map((plan) => plan.perSession),
  ].filter((value): value is number => value !== null);
  return candidates.length === 0 ? null : Math.min(...candidates);
}

/**
 * Preço por sessão DENTRO da modalidade mensual — o contraste que faz o
 * paquete valer a pena: no inglés básico, S/1 por classe pagando mês a mês
 * contra S/0.60 pagando tudo de uma vez. Mesma regra do `sessionPrices`:
 * valor anunciado, não conta derivada.
 */
export const monthlySessionPrices: Partial<Record<CourseSlug, number>> = {
  // S/25 por módulo de 20 horas (planilha de 07/10/2026).
  "english": 1.3,
};

// Legal identity and contact channels of the operating company.
// Language-agnostic data — the same digits, address and handles in every
// locale — so it lives here once instead of being retyped inside each
// dictionary. The legal pages interpolate these through the {legalName} /
// {ruc} / {address} / {site} / {phones} / {email} tokens in `i18n/legal.ts`.
export const org = {
  // Razão social, RUC e endereço — the same three the documents the API
  // generates print (OOC-123), so they live in `@ooc/domain/legal-identity`
  // and nowhere else. Only the legal name changed to the S.A.C. (04/09/2026):
  // the brand is still "Only One Coin" everywhere in the interface.
  ...LEGAL_IDENTITY,
  site: "onlyonecoin.edu.pe",
  // Stored in display form, country code included: every surface that shows a
  // number shows the same one, and `tel:` links are derived by stripping the
  // separators rather than by re-assembling the number.
  phones: ["+51 968 464 483", "+51 945 713 465", "+51 962 985 106"],
  // The institutional address, given by the Asociación (21/08/2026) — it
  // replaces the "tencionalcliente1@" that appeared in the legal copy we were
  // sent. Institutional on purpose: this is the address printed in the terms
  // and in the privacy policy as the channel for data-rights requests, so it
  // has to outlive whoever is answering it. One constant, so the contact page
  // and both legal pages can never disagree.
  email: "Admin@onlyonecoin.edu.pe",
  /** WhatsApp number in wa.me form (country code + number, digits only). */
  whatsapp: "51951153323",
  // TODO: confirm with the Asociación. Derived, not told to us: the previous
  // WordPress site claimed "4 años" while it was published in 2024, which puts
  // the start at 2020. The /about copy counts from here instead of hardcoding
  // a number, so the page stops aging the moment this value is right.
  foundedYear: 2020,
  /** Profiles the Asociación actually runs. Rendered in the footer AND
      declared as `sameAs` in the Organization JSON-LD, so they live once. */
  social: {
    facebook: "https://www.facebook.com/onlyonecoin",
    instagram: "https://www.instagram.com/onlyonecoin.pe/",
    linkedin: "https://www.linkedin.com/company/organizacion-de-onlyonecoin/",
  },
  /** Strategic technology partner: designed and built this platform and keeps
      it evolving. Name and URL live here once — the footer credit and the
      /about band read them, so a rename or a domain change is a one-line edit. */
  partner: {
    // Written the way the brand writes it: the dot is part of the wordmark.
    name: "NR.Labs",
    url: "https://nrlabsdigital.com",
  },
} as const;

/** Full wa.me link for the floating button and the course CTAs. */
export const whatsappUrl = `https://wa.me/${org.whatsapp}`;

// Country (ISO 3166-1 alpha-2) -> suggested course slug for the geo finder.
// Fallback is always "english" (the flagship). Kept small and legible on
// purpose; unknown countries get the flagship.
export const geoSuggestion: Record<string, CourseSlug> = {
  PE: "english",
  BR: "portuguese",
  PT: "portuguese",
  FR: "french",
  BE: "french",
  IT: "italian",
  DE: "german",
  AT: "german",
  CH: "german",
  CN: "mandarin-chinese",
  TW: "mandarin-chinese",
  KR: "korean",
  JP: "japanese",
  RU: "russian",
  US: "english",
  GB: "english",
};

export const content = {
  es: {
    meta: {
      title: "Cursos de inglés e idiomas online en Perú — Only One Coin",
      description:
        "Clases 100% online para todo el Perú: inglés, francés, italiano, alemán, portugués, chino, coreano, japonés y ruso. Clases desde S/0.60 por sesión, certificado y talleres gratis.",
      siteName: "Only One Coin",
      imageAlt: "Only One Coin Perú — cursos de idiomas online",
      courses: {
        title: "Cursos de idiomas online: precios y paquetes — Only One Coin",
        description:
          "Elige inglés, francés, italiano, alemán, portugués, chino mandarín, coreano, japonés o ruso. Clases online para jóvenes y adultos desde los 13 años, desde S/0.60 por sesión y sin mensualidades.",
      },
      course: {
        titlePre: "Curso de ",
        titleMid: " online en Perú",
        // O separador vive no PEDAÇO do preço: curso sem valor anunciado sai
        // com o título inteiro em vez de terminar num "·" pendurado.
        titlePost: " · {price} por sesión",
        descPre: "Aprende ",
        descPost: " online con Only One Coin Perú: para jóvenes y adultos desde los 13 años, con certificado digital y talleres incluidos en el paquete.",
        descPrice: " Clases desde {price} por sesión.",
      },
      faq: {
        title: "Preguntas frecuentes sobre los cursos online — Only One Coin",
        description:
          "Resolvemos las dudas más comunes sobre matrícula, precios, horarios, certificados y talleres gratuitos de Only One Coin Perú.",
      },
      blog: {
        title: "Blog de idiomas y aprendizaje — Only One Coin",
        description:
          "Consejos para aprender idiomas online, novedades de Only One Coin Perú y recursos gratuitos para nuestros alumnos.",
      },
      community: {
        title: "Comunidad de alumnos en todo el Perú — Only One Coin",
        description:
          "Miles de estudiantes de todo el Perú aprenden idiomas online con Only One Coin. Conoce nuestra comunidad y súmate.",
      },
      terms: {
        title: "Términos y condiciones de uso — Only One Coin",
        description:
          "Términos y condiciones de uso del sitio web de Only One Coin Perú: servicios, registro de usuarios, propiedad intelectual, responsabilidad y ley aplicable.",
      },
      privacy: {
        title: "Política de privacidad — Only One Coin",
        description:
          "Cómo Only One Coin Perú recopila, usa, almacena y protege tus datos personales, y cómo ejercer tus derechos de acceso, rectificación, cancelación y oposición.",
      },
      preuni: {
        title: "Preuniversitario — Only One Coin Perú",
        description:
          "Programa Preuniversitario de Only One Coin: ciclo semestral de 6 meses, 100% virtual, con 18 cursos y temario completo para postular a San Marcos y las universidades más exigentes del Perú. Próximamente.",
      },
      about: {
        title: "Nosotros — Only One Coin Perú",
        description:
          "Conoce a Only One Coin Perú: educación accesible para todos, clases de idiomas desde S/0.60 por sesión, y nuestra misión, visión y valores.",
      },
      contact: {
        title: "Contacto — Only One Coin Perú",
        description:
          "Escríbenos por WhatsApp, llámanos o envíanos un correo. Atención de lunes a viernes para matrícula, horarios y cursos disponibles.",
      },
    },
    nav: {
      about: "Nosotros",
      courses: "Idiomas",
      coursesAll: "Ver todos los idiomas",
      programs: "Cursos",
      preuniversitario: "Preuniversitario",
      soon: "Próximamente",
      resources: "Recursos",
      community: "Comunidad",
      blog: "Blog",
      faq: "Preguntas frecuentes",
      contact: "Contacto",
      benefits: "Beneficios",
      portal: "Área del Alumno",
      portalHint: "¿Ya eres alumno?",
      openMenu: "Abrir menú",
      closeMenu: "Cerrar menú",
    },
    hero: {
      w1: "Aprende idiomas.",
      w2: "Transforma tu futuro.",
      subPre: "Estudia idiomas desde",
      price: "S/0.60",
      priceUnit: "por sesión",
      sub2Html:
        'Clases online para niños, jóvenes y adultos, desde los <span class="accent">6 años</span>.',
      ctaEnroll: "MATRICÚLATE YA",
      ctaCourses: "Conoce nuestros cursos",
      photoCaption: "Juntos por un mejor futuro",
      imgAlt: "Estudiantes de Only One Coin",
      features: [
        { title: "S/0.60", text: "Por sesión" },
        { title: "+ Idiomas", text: "Para elegir" },
        { title: "100% online", text: "Desde cualquier lugar" },
      ],
    },
    why: {
      eyebrow: "Only One Coin",
      titlePre: "¿Por qué estudiar en ",
      titleAccent: "Only One Coin",
      titlePost: "?",
      lead: "Porque no solo te enseñamos un idioma, te damos herramientas para un mejor futuro.",
      cta: "Conoce más",
      cards: [
        {
          title: "Educación accesible",
          text: "Idiomas desde S/0.60 por sesión.",
        },
        {
          title: "100% digital",
          text: "Estudia desde cualquier lugar.",
        },
        {
          title: "Docentes",
          text: "Docentes con soporte en vivo.",
        },
        {
          title: "Comunidad",
          text: "Forma parte de una comunidad educativa.",
        },
        {
          title: "Oportunidades",
          text: "Talleres, actividades y beneficios.",
        },
      ],
    },
    audiences: {
      titlePre: "Encuentra la opción ",
      titleAccent: "ideal para ti",
      titlePost: "",
      lead: "Tenemos cursos para cada etapa de tu vida.",
      more: "Conoce más",
      items: [
        {
          title: "OOC Kids",
          text: "Inglés para niños de 6 a 12 años.",
          href: "/courses/english#kids",
        },
        {
          title: "Jóvenes",
          text: "Aprende, practica y prepárate para tus metas.",
          href: "/courses/english#teens-and-adults",
        },
        {
          title: "Adultos",
          text: "Idiomas para estudios, trabajo y crecimiento personal.",
          href: "/courses",
        },
        {
          title: "Clases online",
          text: "Estudia desde cualquier parte del mundo.",
          href: "/faq",
        },
      ],
    },
    finder: {
      eyebrow: "Encuentra tu idioma",
      titlePre: "Conoce nuestros ",
      titleAccent: "idiomas",
      titlePost: "",
      text: "Elige el idioma que te llevará más lejos. Según desde dónde nos visitas, te sugerimos por dónde empezar.",
      detecting: "Detectando tu ubicación…",
      fromLabel: "Detectamos que nos visitas desde",
      unknownLocation: "tu zona",
      viewCourse: "Ver este curso",
      orChoose: "O elige el idioma que quieres aprender:",
      allCourses: "Ver todos los idiomas",
      prev: "Idioma anterior",
      next: "Siguiente idioma",
    },
    purpose: {
      eyebrow: "Nuestro propósito",
      title: "Más que aprender un idioma, abrimos oportunidades.",
      text: "Only One Coin nació con un propósito: democratizar el acceso a la educación.",
      cta: "Conoce nuestra historia",
      imgAlt: "Una alumna muestra una moneda de un sol",
      priceValue: "S/0.60",
      priceLabel: "por sesión",
      fact2: "Educación accesible",
      fact3: "Impacto social",
    },
    perks: {
      titlePre: "Tu matrícula te ",
      titleAccent: "abre más oportunidades",
      titlePost: "",
      lead: "Beneficio de nuestros alumnos premium: los talleres gratuitos vienen con el paquete completo.",
      allCta: "Ver todos los beneficios",
      items: [
        { title: "Excel" },
        { title: "Emprendimiento" },
        { title: "Liderazgo" },
        { title: "Quechua" },
      ],
    },
    steps: {
      titlePre: "Empieza a estudiar en ",
      titleAccent: "3 pasos",
      titlePost: "",
      lead: "Es fácil, rápido y 100% online.",
      cta: "Quiero matricularme",
      items: [
        { title: "Elige tu idioma", text: "Explora todas las opciones." },
        { title: "Elige tu curso", text: "Según tu nivel y objetivos." },
        { title: "Matricúlate y empieza", text: "¡Tu futuro te espera!" },
      ],
      faqTitle: "¿Tienes dudas? Tenemos respuestas.",
      faqAll: "Ver todas las preguntas",
    },
    cta: {
      title: "Tu próximo idioma empieza aquí.",
      sub: "Aprende. Crece. Conecta.",
      pricePre: "Desde",
      price: "S/0.60",
      priceUnit: "por sesión.",
      imgAlt: "Alumna de Only One Coin en una clase online",
    },
    testimonials: {
      eyebrow: "Testimonios",
      titlePre: "Ellos ya son parte de ",
      titleAccent: "OOC",
      titlePost: "",
      lead: "Historias reales que inspiran.",
      note: "Contenido de ejemplo — se reemplazará con testimonios reales.",
      prev: "Anterior",
      next: "Siguiente",
      items: [
        { name: "María Fernández", role: "Alumna de Inglés", initials: "MF", quote: "Aprendí muchísimo y los profes son súper pacientes. ¡Por un sol no lo pensé dos veces!" },
        { name: "José Ramírez", role: "Alumno de Francés", initials: "JR", quote: "Las clases son dinámicas y prácticas. En pocos meses ya me animo a conversar." },
        { name: "Lucía Quispe", role: "Apoderada", initials: "LQ", quote: "Mi hija espera cada clase con ganas. Una gran oportunidad para las familias." },
        { name: "Carlos Mendoza", role: "Alumno de Italiano", initials: "CM", quote: "Nunca pensé que estudiar un idioma fuera tan accesible. Los talleres gratis son un plus enorme." },
        { name: "Ana Torres", role: "Alumna de Alemán", initials: "AT", quote: "La plataforma del alumno me ayuda a no perder ninguna clase ni material. Todo súper ordenado." },
        { name: "Diego Salas", role: "Alumno de Portugués", initials: "DS", quote: "Excelente relación calidad-precio. Los docentes se nota que aman lo que hacen." },
      ],
    },
    faq: {
      eyebrow: "Preguntas frecuentes",
      titlePre: "Resolvemos tus ",
      titleAccent: "dudas",
      titlePost: "",
      lead: "Todo lo que necesitas saber sobre nuestros cursos, la matrícula y los talleres gratuitos.",
      ctaTitle: "¿No encuentras tu respuesta?",
      ctaText: "Escríbenos por WhatsApp y te ayudamos con la matrícula, los horarios y todo lo demás.",
      ctaButton: "Escríbenos por WhatsApp",
      items: [
        { q: "¿Cuánto cuesta y cómo funciona el pago?", a: "Estudias desde S/0.60 por sesión, con matrícula, material y certificado incluidos; los talleres gratuitos vienen con el paquete completo. Consúltanos por WhatsApp el detalle del curso que te interesa. Sin mensualidades ocultas ni cobros sorpresa." },
        { q: "¿Desde qué edad puedo matricularme?", a: "Los cursos de idiomas son para jóvenes y adultos, desde los 13 años. Para niños de 6 a 12 años tenemos OOC Kids, nuestro programa de inglés para niños." },
        { q: "¿Cómo me matriculo?", a: "Escríbenos por WhatsApp para reservar tu cupo. Luego completas el formulario de matrícula, subes tu comprobante y recibes tus credenciales de acceso." },
        { q: "¿Las clases son presenciales o virtuales?", a: "Todas nuestras clases son 100% online, en vivo con un docente. Puedes estudiar desde cualquier parte del mundo sin moverte de casa. Consúltanos por WhatsApp los horarios disponibles del periodo." },
        { q: "¿Qué incluye la matrícula?", a: "El acceso a tu curso de idioma y la plataforma del alumno. Los talleres gratuitos de Excel, Emprendimiento, Liderazgo y Quechua son el beneficio de nuestros alumnos premium: los que estudian con el paquete completo." },
        { q: "¿Recibo algún certificado?", a: "Sí. Al culminar tu curso recibes un certificado digital que valida tu aprendizaje." },
      ],
    },
    stats: {
      title: "La confianza de miles de familias",
      items: [
        { value: "+5 años", label: "De experiencia" },
        { value: "+1.5 millones", label: "Alumnos registrados" },
        { value: "+350", label: "Docentes calificados" },
        { value: "+2M", label: "Seguidores en redes" },
      ],
    },
    courses: {
      list: {
        "english": "Inglés",
        "french": "Francés",
        "italian": "Italiano",
        "german": "Alemán",
        "portuguese": "Portugués",
        "mandarin-chinese": "Chino Mandarín",
        "korean": "Coreano",
        "japanese": "Japonés",
        "russian": "Ruso",
        "english-intermediate": "Inglés Intermedio/Avanzado",
        "cambridge-b1": "Inglés B1 · Cambridge",
        "cambridge-b2": "Inglés B2 · Cambridge",
        "french-advanced": "Francés Intermedio",
      },
      indexEyebrow: "Nuestros idiomas",
      indexTitlePre: "Elige el idioma que ",
      indexTitleAccent: "quieres aprender",
      indexTitlePost: "",
      indexText: "Cursos para jóvenes y adultos desde los 13 años, desde S/0.60 por sesión. Para niños de 6 a 12 años tenemos OOC Kids, en inglés. Elige un idioma para ver el precio y el detalle.",
      priceUnit: "por sesión",
      viewCourse: "Ver curso",
    },
    courseDetail: {
      backToCourses: "Volver a cursos",
      urgency: "¡Vacantes limitadas por aula! Asegura la tuya hoy.",
      discountAmount: "40%",
      discountLabel: "de descuento",
      priceHookPre: "desde",
      factDuration: "Duración",
      factLevel: "Nivel",
      factModality: "Modalidad",
      liveClasses: "con CLASES EN VIVO",
      perkTeacher: "Interactúas con tu docente",
      perkSchedule: "Una hora diaria de lunes a viernes · más de 6 horarios",
      perkIncludes: "Incluye libro, matrícula y certificado GRATUITO",
      levelsTitle: "Niveles disponibles",
      // O rótulo do quadradinho: curto, porque o contexto ("Inglés") já está
      // no título da página. Sem entrada no mapa, cai no nome completo.
      levelShortNames: {
        "english": "Básico",
        "english-intermediate": "Intermedio/Avanzado",
        "cambridge-b1": "B1 · Cambridge",
        "cambridge-b2": "B2 · Cambridge",
        "french": "Básico",
        "french-advanced": "Intermedio",
        "italian": "Básico",
        "german": "Introductorio",
        "portuguese": "Básico",
        "mandarin-chinese": "Básico",
        "korean": "Básico",
      } as Partial<Record<CourseSlug, string>>,
      // Os 3–4 checks que decidem a escolha do nível — o resto mora no
      // "Ver detalles" do painel.
      levelHighlights: {
        "english": [
          "Empiezas desde cero, sin base previa",
          "4 módulos · Libros 1–4 (A1–A2)",
          "80 sesiones en vivo, una hora diaria",
          "El paquete completo incluye los talleres gratuitos",
        ],
        "english-intermediate": [
          "Continúas después del Básico",
          "2 módulos · Libros 5 y 6 (A2–B1)",
          "80 sesiones en vivo, una hora diaria",
          "Base para exámenes tipo TOEFL",
        ],
        "cambridge-b1": [
          "Te prepara para el examen Cambridge B1 (PET)",
          "Tareas, audios y textos tipo examen",
          "Asesoría gratuita para inscribirte al examen",
        ],
        "cambridge-b2": [
          "Te prepara para el examen Cambridge B2",
          "Tareas, audios y textos tipo examen",
        ],
      } as Partial<Record<CourseSlug, string[]>>,
      parentBack: "Ver todos los niveles de",
      curriculumTitle: "Malla curricular",
      programTitle: "El programa al detalle",
      detailsToggle: "Ver detalles",
      aboutTitle: "Sobre el curso",
      goalsTitle: "Competencias que vas a desarrollar",
      methodTitle: "Cómo se enseña",
      evaluationTitle: "Cómo se evalúa",
      outcomesTitle: "Al finalizar el curso vas a poder",
      eyebrowPre: "Curso de ",
      eyebrowPost: "",
      titlePre: "Aprende ",
      titlePost: "",
      paymentBundleNames: {
        "english-total": "Inglés Total",
        "french-full": "Completo",
      },
      paymentSessionsWith: "{sessions} + reforzamientos",
      paymentWorkshops: "Este paquete incluye {count} talleres gratuitos",
      paymentMonthlyName: "Mensual",
      paymentExtraNames: {
        "english-2-modules": "2 módulos",
        "english-3-modules": "3 módulos",
        "russian-2-modules": "2 módulos",
        "german-intensive": "Intensivo",
      },
      paymentExtraPerks: {
        "english-2-modules": [],
        "english-3-modules": [],
        "german-intensive": ["2 horas diarias · 40 horas en total"],
        "russian-2-modules": ["24 horas"],
      },
      paymentFullName: "Paquete completo",
      paymentRecommended: "Recomendado",
      leadPre: "Un programa completo de ",
      leadPost: " para todas las edades, con enfoque conversacional y docentes comprometidos con tu aprendizaje real.",
      exampleNote: "Contenido de ejemplo — la información detallada de cada curso se completará con los datos reales del periodo.",
      ageBadge: "Jóvenes y adultos · desde los 13 años",
      kidsTitle: "¿El alumno tiene menos de 13 años?",
      kidsTag: "Curso aparte · 6 a 12 años",
      kidsName: "OOC Kids",
      kidsText: "Inglés para niños es un curso propio, con su propia matrícula, sus aulas y su docente — no es un nivel de esta página. El idioma entra por el juego, la música y actividades pensadas para su edad.",
      kidsCta: "Matricular en OOC Kids",
      featuresTitle: "Qué incluye",
      features: [
        { title: "Pago único del paquete", text: "Un solo pago por todo el curso, sin costos ocultos. En inglés también puedes pagar por módulo." },
        { title: "Talleres gratuitos", text: "Excel, Emprendimiento, Liderazgo y Quechua sin costo adicional." },
        { title: "Certificado digital", text: "Al culminar el curso recibes un certificado que valida tu aprendizaje." },
        { title: "Plataforma del alumno", text: "Clases, horarios y materiales en un solo lugar." },
      ],
      ctaTitlePre: "¿List@ para ",
      ctaTitleAccent: "empezar",
      ctaTitlePost: "?",
      ctaText: "Reserva tu cupo por WhatsApp y matricúlate hoy.",
      ctaEnroll: "MATRICÚLATE YA",
      ctaWhatsApp: "Escríbenos por WhatsApp",
    },
    preuni: {
      badge: "Próximamente",
      eyebrow: "Prepárate para ingresar",
      titlePre: "Programa ",
      titleAccent: "Preuniversitario",
      titlePost: "",
      lead: "Una preparación integral para postular a San Marcos y a las universidades más exigentes del país, con el mismo principio de siempre: educación de calidad al alcance de todos.",
      imgAlt: "Dos alumnos de Only One Coin repasando el temario juntos",
      intro: "El programa desarrolla, de forma progresiva, todas las áreas que se evalúan en los exámenes de admisión, con clases en vivo, ejercicios tipo examen y evaluaciones constantes para medir tu avance.",
      facts: [
        { label: "Duración", value: "6 meses · Ciclo Semestral" },
        { label: "Modalidad", value: "100% virtual · clases en vivo" },
        { label: "Plan de estudios", value: "18 cursos" },
        { label: "Enfoque", value: "Examen de admisión San Marcos" },
      ],
      goalTitle: "Objetivo del programa",
      goal: "Que domines los contenidos y las estrategias de resolución necesarias para afrontar con éxito un examen de admisión — no solo memorizar, sino analizar, interpretar y decidir bajo presión.",
      areasTitle: "Qué vas a estudiar",
      areas: [
        { title: "Habilidad Verbal", text: "Comprensión lectora, ideas principales, relaciones semánticas e inferencias." },
        { title: "Habilidad Lógico-Matemática", text: "Razonamiento lógico y resolución de problemas con estrategias inductivas y deductivas." },
        { title: "Matemáticas", text: "Aritmética, Álgebra, Geometría y Trigonometría aplicadas a problemas de admisión." },
        { title: "Ciencias", text: "Física, Química y Biología: principios fundamentales y método científico." },
        { title: "Lenguaje y Literatura", text: "Gramática, sintaxis y normativa, con análisis de textos literarios y no literarios." },
        { title: "Ciencias Sociales", text: "Historia, Geografía, Economía, Educación Cívica y Filosofía, con mirada crítica del Perú y el mundo." },
      ],
      temarioTitle: "Temario completo del ciclo",
      temarioCount: "{n} temas",
      methodTitle: "Cómo se enseña",
      method: [
        "Desarrollo progresivo de contenidos",
        "Resolución de ejercicios tipo examen de admisión",
        "Análisis y discusión de problemas en clase",
        "Evaluaciones constantes para medir el avance",
        "Refuerzo de hábitos de estudio y autonomía",
      ],
      resultsTitle: "Al terminar el programa vas a poder",
      results: [
        "Resolver con eficacia preguntas tipo examen de admisión",
        "Aplicar conocimientos en distintas áreas del saber",
        "Analizar información de manera crítica y estructurada",
        "Sostener tu desempeño académico con seguridad y autonomía",
        "Afrontar la admisión con un nivel competitivo",
      ],
      ctaTitle: "Aún no abrimos matrícula",
      ctaText: "Escríbenos por WhatsApp y te avisamos apenas se abran las vacantes, con fechas, horarios y costo.",
      ctaWhatsApp: "Quiero que me avisen",
    },
    pages: {
      blog: {
        titlePre: "Nuestro ",
        titleAccent: "blog",
        titlePost: "",
        lead: "Consejos para aprender idiomas, novedades de Only One Coin y recursos gratuitos para nuestros alumnos.",
        soonTitle: "Muy pronto",
        soonText: "Estamos preparando nuestros primeros artículos. Vuelve pronto para leer nuestras publicaciones.",
      },
      community: {
        titlePre: "Nuestra ",
        titleAccent: "comunidad",
        titlePost: "",
        lead: "Miles de estudiantes de todo el Perú aprenden con nosotros. Únete, comparte tu experiencia y sigue creciendo.",
        soonTitle: "Muy pronto",
        soonText: "Estamos construyendo el espacio de nuestra comunidad. Mientras tanto, síguenos en nuestras redes sociales.",
      },
      about: {
        titlePre: "Educación accesible ",
        titleAccent: "para todos",
        titlePost: "",
        // {years} is filled from `org.foundedYear` so the claim never goes stale.
        lead: "En Only One Coin creemos firmemente que la educación es un derecho fundamental y no un privilegio. Con esta visión, llevamos {years} años ofreciendo clases de idiomas a precios simbólicos, desde S/0.60 por sesión.",
        lead2: "Nuestro compromiso es brindar a niños, jóvenes y adultos de todas las edades y niveles sociales la oportunidad de aprender y crecer, sin barreras económicas.",
        teamAlt: "Equipo de Only One Coin en su oficina de Lima",
        coinAlt: "Una moneda: el precio simbólico de cada sesión",
        whyTitle: "¿Por qué elegirnos?",
        whyText: "Nuestro equipo de profesores está altamente calificado y comprometido con la enseñanza. Utilizamos métodos innovadores y dinámicos para asegurar que cada estudiante aprenda de manera efectiva y disfrute del proceso.",
        whyText2: "Queremos que cada persona que pase por nuestras clases salga con más que solo conocimientos de idiomas: salga con confianza y preparación para enfrentar los desafíos del futuro.",
        whyAlt: "Docente de Only One Coin dictando una clase online",
        whyAlt2: "Dos integrantes del equipo de Only One Coin resolviendo una consulta",
        missionTitle: "Misión",
        missionText: "Facilitar el acceso al aprendizaje del inglés y otras habilidades fundamentales a través de un modelo educativo innovador y asequible para todos.",
        visionTitle: "Visión",
        visionText: "Ser la academia de idiomas líder en Perú, reconocida por nuestro compromiso con la educación accesible y de calidad, y por nuestro impacto positivo en la vida de nuestros estudiantes.",
        valuesTitlePre: "Nuestros ",
        valuesTitleAccent: "valores",
        valuesTitlePost: "",
        valuesLead: "Nuestros valores son el pilar fundamental de todo lo que hacemos. Creemos en la educación accesible y de calidad, y nos esforzamos por inculcar estos principios en cada aspecto de nuestro servicio. A través de ellos buscamos no solo enseñar inglés, sino también inspirar a nuestros estudiantes a alcanzar su máximo potencial y contribuir positivamente a sus comunidades.",
        valuesAlt: "Dos alumnas de Only One Coin estudiando juntas",
        values: [
          {
            title: "Inclusión",
            text: "Abrimos la puerta a estudiantes de todas las edades y de todo el Perú, sin barreras económicas ni geográficas.",
          },
          {
            title: "Calidad",
            text: "Nos esforzamos por ofrecer lo mejor en enseñanza y recursos educativos.",
          },
          {
            title: "Compromiso",
            text: "Estamos dedicados a la mejora continua y al éxito de nuestros estudiantes.",
          },
          {
            title: "Innovación",
            text: "Apostamos por métodos de enseñanza modernos y creativos que hacen del aprendizaje una experiencia dinámica y efectiva, adaptándonos a las necesidades cambiantes de nuestros estudiantes.",
          },
        ],
        partnerEyebrow: "Socio estratégico",
        // {partner} is filled from `org.partner.name`, so the brand is written
        // once and a rename never leaves a locale behind.
        partnerTitlePre: "Tecnología con propósito, junto a ",
        partnerTitleAccent: "{partner}",
        partnerText: "{partner} es nuestro socio estratégico en tecnología: diseñó y desarrolló la plataforma digital de Only One Coin, y acompaña su evolución para que estudiar con nosotros sea simple desde cualquier lugar del mundo.",
        partnerCta: "Conocer a {partner}",
      },
      contact: {
        eyebrow: "Contacto",
        titlePre: "¿Cómo podemos ",
        titleAccent: "ayudarte",
        titlePost: "?",
        lead: "Resolvemos tus dudas sobre matrícula, horarios y cursos disponibles. Elige el canal que te resulte más cómodo.",
        waTitle: "WhatsApp",
        waText: "La forma más rápida de llegar a nosotros. Te respondemos dentro del horario de atención.",
        waButton: "Escríbenos por WhatsApp",
        phonesTitle: "Teléfonos",
        emailTitle: "Correo electrónico",
        emailText: "Para consultas formales y para ejercer tus derechos sobre tus datos personales.",
        onlineNote: "Todas nuestras clases son 100% online y la atención también es remota: no realizamos atención presencial en nuestra oficina.",
      },
    },
    footer: {
      tagline: "Educación de idiomas de calidad al alcance de todos, en todo el Perú.",
      orgHtml: "{legalName}<br />RUC {ruc}",
      colAbout: "Nosotros",
      aboutHistory: "Nuestra historia",
      aboutMission: "Misión y visión",
      aboutImpact: "Impacto social",
      langsTitle: "Idiomas",
      colStudents: "Alumnos",
      studentsPortal: "Portal del Alumno",
      studentsCourses: "Cursos",
      studentsCertificates: "Certificados",
      studentsFaq: "Preguntas frecuentes",
      colResources: "Recursos",
      resBlog: "Blog",
      resWorkshops: "Talleres",
      resCommunity: "Comunidad",
      colHelp: "Ayuda",
      helpContact: "Contacto",
      helpWhatsapp: "WhatsApp",
      privacy: "Política de privacidad",
      terms: "Términos y condiciones",
      hoursLabel: "Horario de atención",
      hours: "Lunes a viernes · 9:00 AM – 6:00 PM",
      script: "Más idiomas, más oportunidades",
      followTitle: "Síguenos",
      copyOrg: "Only One Coin",
      rights: "Todos los derechos reservados",
      madeIn: "Hecho con ❤ en el Perú",
      partnerLabel: "Plataforma desarrollada por nuestro socio estratégico",
    },
    common: {
      waAria: "Escríbenos por WhatsApp",
      langLabel: "Idioma",
    },
  },

  en: {
    meta: {
      title: "Online language courses in Peru — Only One Coin",
      description:
        "100% online classes across Peru: English, French, Italian, German, Portuguese, Chinese, Korean, Japanese and Russian. Classes from S/0.60 per session, certificate and workshops included in the package.",
      siteName: "Only One Coin",
      imageAlt: "Only One Coin Perú — online language courses",
      courses: {
        title: "Online language courses: prices and packages — Only One Coin",
        description:
          "Choose English, French, Italian, German, Portuguese, Mandarin Chinese, Korean, Japanese or Russian. Online classes for teens and adults from age 13, from S/0.60 per session and no monthly fees.",
      },
      course: {
        titlePre: "Online ",
        titleMid: " course in Peru",
        titlePost: " · {price} per session",
        descPre: "Learn ",
        descPost: " online with Only One Coin Perú: for teens and adults from age 13, with a digital certificate and workshops included in the package.",
        descPrice: " Classes from {price} per session.",
      },
      faq: {
        title: "FAQ about our online courses — Only One Coin",
        description:
          "Answers to the most common questions about enrolment, prices, schedules, certificates and the free workshops of Only One Coin Perú.",
      },
      blog: {
        title: "Language learning blog — Only One Coin",
        description:
          "Tips for learning languages online, news from Only One Coin Perú and free resources for our students.",
      },
      community: {
        title: "Our student community across Peru — Only One Coin",
        description:
          "Thousands of students across Peru learn languages online with Only One Coin. Meet our community and join in.",
      },
      terms: {
        title: "Terms and conditions of use — Only One Coin",
        description:
          "Terms and conditions for using Only One Coin Perú website: services, user registration, intellectual property, liability and governing law.",
      },
      privacy: {
        title: "Privacy policy — Only One Coin",
        description:
          "How Only One Coin Perú collects, uses, stores and protects your personal data, and how to exercise your access, rectification, erasure and objection rights.",
      },
      preuni: {
        title: "University Prep — Only One Coin Perú",
        description:
          "Only One Coin's University Prep Program: a 6-month, 100% online semester cycle with 18 subjects and a full syllabus to prepare for San Marcos and Peru's most demanding universities. Coming soon.",
      },
      about: {
        title: "About us — Only One Coin Perú",
        description:
          "Meet Only One Coin Perú: accessible education for everyone, language classes from S/0.60 a session, and our mission, vision and values.",
      },
      contact: {
        title: "Contact — Only One Coin Perú",
        description:
          "Message us on WhatsApp, call us or send an email. We answer Monday to Friday about enrolment, schedules and available courses.",
      },
    },
    nav: {
      about: "About",
      courses: "Languages",
      coursesAll: "See all languages",
      programs: "Courses",
      preuniversitario: "University prep",
      soon: "Coming soon",
      resources: "Resources",
      community: "Community",
      blog: "Blog",
      faq: "FAQ",
      contact: "Contact",
      benefits: "Benefits",
      portal: "Student Area",
      portalHint: "Already a student?",
      openMenu: "Open menu",
      closeMenu: "Close menu",
    },
    hero: {
      w1: "Learn languages.",
      w2: "Transform your future.",
      subPre: "Study languages from",
      price: "S/0.60",
      priceUnit: "per session",
      sub2Html:
        'Online classes for children, teens and adults, from <span class="accent">age 6</span>.',
      ctaEnroll: "ENROLL NOW",
      ctaCourses: "Explore our courses",
      photoCaption: "Together for a better future",
      imgAlt: "Only One Coin students",
      features: [
        { title: "S/0.60", text: "Per session" },
        { title: "+ Languages", text: "To choose from" },
        { title: "100% online", text: "From anywhere" },
      ],
    },
    why: {
      eyebrow: "Only One Coin",
      titlePre: "Why study at ",
      titleAccent: "Only One Coin",
      titlePost: "?",
      lead: "Because we don't just teach you a language — we give you tools for a better future.",
      cta: "Learn more",
      cards: [
        {
          title: "Accessible education",
          text: "Languages from S/0.60 per session.",
        },
        {
          title: "100% digital",
          text: "Study from anywhere.",
        },
        {
          title: "Teachers",
          text: "Teachers with live support.",
        },
        {
          title: "Community",
          text: "Become part of a learning community.",
        },
        {
          title: "Opportunities",
          text: "Workshops, activities and benefits.",
        },
      ],
    },
    audiences: {
      titlePre: "Find the option ",
      titleAccent: "that fits you",
      titlePost: "",
      lead: "We have courses for every stage of your life.",
      more: "Learn more",
      items: [
        {
          title: "OOC Kids",
          text: "English for children ages 6 to 12.",
          href: "/courses/english#kids",
        },
        {
          title: "Teens",
          text: "Learn, practice and get ready for your goals.",
          href: "/courses/english#teens-and-adults",
        },
        {
          title: "Adults",
          text: "Languages for study, work and personal growth.",
          href: "/courses",
        },
        {
          title: "Online classes",
          text: "Study from anywhere in the world.",
          href: "/faq",
        },
      ],
    },
    finder: {
      eyebrow: "Find your language",
      titlePre: "Meet our ",
      titleAccent: "languages",
      titlePost: "",
      text: "Choose the language that will take you further. Based on where you're visiting from, we suggest where to start.",
      detecting: "Detecting your location…",
      fromLabel: "We detected you're visiting from",
      unknownLocation: "your area",
      viewCourse: "View this course",
      orChoose: "Or choose the language you want to learn:",
      allCourses: "See all languages",
      prev: "Previous language",
      next: "Next language",
    },
    purpose: {
      eyebrow: "Our purpose",
      title: "More than learning a language, we open opportunities.",
      text: "Only One Coin was born with a purpose: to democratize access to education.",
      cta: "Discover our story",
      imgAlt: "A student holds up a one-sol coin",
      priceValue: "S/0.60",
      priceLabel: "per session",
      fact2: "Accessible education",
      fact3: "Social impact",
    },
    perks: {
      titlePre: "Your enrollment ",
      titleAccent: "opens more opportunities",
      titlePost: "",
      lead: "A benefit for our premium students: the free workshops come with the full package.",
      allCta: "See all benefits",
      items: [
        { title: "Excel" },
        { title: "Entrepreneurship" },
        { title: "Leadership" },
        { title: "Quechua" },
      ],
    },
    steps: {
      titlePre: "Start studying in ",
      titleAccent: "3 steps",
      titlePost: "",
      lead: "It's easy, fast and 100% online.",
      cta: "I want to enroll",
      items: [
        { title: "Choose your language", text: "Explore all the options." },
        { title: "Choose your course", text: "Based on your level and goals." },
        { title: "Enroll and start", text: "Your future awaits!" },
      ],
      faqTitle: "Questions? We have answers.",
      faqAll: "See all questions",
    },
    cta: {
      title: "Your next language starts here.",
      sub: "Learn. Grow. Connect.",
      pricePre: "From",
      price: "S/0.60",
      priceUnit: "per session.",
      imgAlt: "Only One Coin student in an online class",
    },
    testimonials: {
      eyebrow: "Testimonials",
      titlePre: "They are already part of ",
      titleAccent: "OOC",
      titlePost: "",
      lead: "Real stories that inspire.",
      note: "Sample content — to be replaced with real testimonials.",
      prev: "Previous",
      next: "Next",
      items: [
        { name: "María Fernández", role: "English student", initials: "MF", quote: "I learned so much and the teachers are super patient. For one sol, I didn't think twice!" },
        { name: "José Ramírez", role: "French student", initials: "JR", quote: "The classes are dynamic and hands-on. In just a few months I already dare to speak." },
        { name: "Lucía Quispe", role: "Guardian", initials: "LQ", quote: "My daughter looks forward to every class. A great opportunity for families." },
        { name: "Carlos Mendoza", role: "Italian student", initials: "CM", quote: "I never thought learning a language could be this accessible. The free workshops are a huge plus." },
        { name: "Ana Torres", role: "German student", initials: "AT", quote: "The student platform helps me never miss a class or material. Everything is well organized." },
        { name: "Diego Salas", role: "Portuguese student", initials: "DS", quote: "Excellent value for money. You can tell the teachers love what they do." },
      ],
    },
    faq: {
      eyebrow: "Frequently asked questions",
      titlePre: "We answer your ",
      titleAccent: "questions",
      titlePost: "",
      lead: "Everything you need to know about our courses, enrollment and free workshops.",
      ctaTitle: "Still have a question?",
      ctaText: "Message us on WhatsApp and we'll help you with enrolment, schedules and anything else.",
      ctaButton: "Message us on WhatsApp",
      items: [
        { q: "How much does it cost and how does payment work?", a: "You study from S/0.60 per session, with enrollment, materials and certificate included; the free workshops come with the full package. Ask us on WhatsApp for the details of the course you are interested in. No hidden monthly fees or surprise charges." },
        { q: "From what age can I enroll?", a: "Our language courses are for teens and adults, from age 13. For children ages 6 to 12 we have OOC Kids, our English program for children." },
        { q: "How do I enroll?", a: "Message us on WhatsApp to reserve your spot. Then you fill out the enrollment form, upload your receipt and receive your access credentials." },
        { q: "Are classes in-person or online?", a: "All our classes are 100% online and live with a teacher. You can study from anywhere in the world without leaving home. Ask us on WhatsApp about the available schedules for the term." },
        { q: "What does enrollment include?", a: "Access to your language course and the student platform. The free Excel, Entrepreneurship, Leadership and Quechua workshops are a benefit for our premium students: the ones studying with the full package." },
        { q: "Do I get a certificate?", a: "Yes. When you complete your course you receive a digital certificate that validates your learning." },
      ],
    },
    stats: {
      title: "Trusted by thousands of families",
      items: [
        { value: "+5 years", label: "Of experience" },
        { value: "+1.5 million", label: "Registered students" },
        { value: "+350", label: "Qualified teachers" },
        { value: "+2M", label: "Followers on social media" },
      ],
    },
    courses: {
      list: {
        "english": "English",
        "french": "French",
        "italian": "Italian",
        "german": "German",
        "portuguese": "Portuguese",
        "mandarin-chinese": "Mandarin Chinese",
        "korean": "Korean",
        "japanese": "Japanese",
        "russian": "Russian",
        "english-intermediate": "Intermediate/Advanced English",
        "cambridge-b1": "English B1 · Cambridge",
        "cambridge-b2": "English B2 · Cambridge",
        "french-advanced": "French Intermediate",
      },
      indexEyebrow: "Our languages",
      indexTitlePre: "Choose the language you ",
      indexTitleAccent: "want to learn",
      indexTitlePost: "",
      indexText: "Courses for teens and adults from age 13, from S/0.60 per session. For children ages 6 to 12 we have OOC Kids, in English. Pick a language to see the price and the details.",
      priceUnit: "per session",
      viewCourse: "View course",
    },
    courseDetail: {
      backToCourses: "Back to courses",
      urgency: "Limited seats per class! Secure yours today.",
      discountAmount: "40%",
      discountLabel: "off",
      priceHookPre: "from",
      factDuration: "Duration",
      factLevel: "Level",
      factModality: "Format",
      liveClasses: "with LIVE CLASSES",
      perkTeacher: "You interact with your teacher",
      perkSchedule: "One hour a day, Monday to Friday · more than 6 time slots",
      perkIncludes: "Includes book, enrollment and FREE certificate",
      levelsTitle: "Available levels",
      levelShortNames: {
        "english": "Basic",
        "english-intermediate": "Intermediate/Advanced",
        "cambridge-b1": "B1 · Cambridge",
        "cambridge-b2": "B2 · Cambridge",
        "french": "Basic",
        "french-advanced": "Intermediate",
        "italian": "Basic",
        "german": "Introductory",
        "portuguese": "Basic",
        "mandarin-chinese": "Basic",
        "korean": "Basic",
      } as Partial<Record<CourseSlug, string>>,
      levelHighlights: {
        "english": [
          "You start from zero — no previous English needed",
          "4 modules · Books 1–4 (A1–A2)",
          "80 live sessions, one hour a day",
          "The full package includes the free workshops",
        ],
        "english-intermediate": [
          "Continues after the Basic level",
          "2 modules · Books 5 and 6 (A2–B1)",
          "80 live sessions, one hour a day",
          "A base for TOEFL-style exams",
        ],
        "cambridge-b1": [
          "Prepares you for the Cambridge B1 exam (PET)",
          "Exam-style tasks, audios and texts",
          "Free guidance to register for the exam",
        ],
        "cambridge-b2": [
          "Prepares you for the Cambridge B2 exam",
          "Exam-style tasks, audios and texts",
        ],
      } as Partial<Record<CourseSlug, string[]>>,
      parentBack: "See all levels of",
      curriculumTitle: "Curriculum",
      programTitle: "The program in detail",
      detailsToggle: "See details",
      aboutTitle: "About the course",
      goalsTitle: "Skills you'll develop",
      methodTitle: "How it is taught",
      evaluationTitle: "How you are assessed",
      outcomesTitle: "By the end of the course you'll be able to",
      eyebrowPre: "",
      eyebrowPost: " course",
      titlePre: "Learn ",
      titlePost: "",
      paymentBundleNames: {
        "english-total": "Total English",
        "french-full": "Full course",
      },
      paymentSessionsWith: "{sessions} + reinforcement classes",
      paymentWorkshops: "This package includes {count} free workshops",
      paymentMonthlyName: "Monthly",
      paymentExtraNames: {
        "english-2-modules": "2 modules",
        "english-3-modules": "3 modules",
        "russian-2-modules": "2 modules",
        "german-intensive": "Intensive",
      },
      paymentExtraPerks: {
        "english-2-modules": [],
        "english-3-modules": [],
        "german-intensive": ["2 hours a day · 40 hours in total"],
        "russian-2-modules": ["24 hours"],
      },
      paymentFullName: "Full package",
      paymentRecommended: "Recommended",
      leadPre: "A complete ",
      leadPost: " program for all ages, with a conversational focus and teachers committed to your real learning.",
      exampleNote: "Sample content — the detailed information for each course will be completed with the real data for the term.",
      ageBadge: "Teens and adults · from age 13",
      kidsTitle: "Is the student under 13?",
      kidsTag: "A separate course · ages 6 to 12",
      kidsName: "OOC Kids",
      kidsText: "English for children is a course of its own, with its own enrollment, its own classes and its own teacher — it is not a level of this page. The language comes in through play, music and age-appropriate activities.",
      kidsCta: "Enroll in OOC Kids",
      featuresTitle: "What's included",
      features: [
        { title: "Single package payment", text: "One payment for the whole course, no hidden costs. English can also be paid per module." },
        { title: "Free workshops", text: "Excel, Entrepreneurship, Leadership and Quechua at no extra cost." },
        { title: "Digital certificate", text: "When you finish the course you get a certificate that validates your learning." },
        { title: "Student platform", text: "Classes, schedules and materials in one place." },
      ],
      ctaTitlePre: "Ready to ",
      ctaTitleAccent: "start",
      ctaTitlePost: "?",
      ctaText: "Reserve your spot on WhatsApp and enroll today.",
      ctaEnroll: "ENROLL NOW",
      ctaWhatsApp: "Message us on WhatsApp",
    },
    preuni: {
      badge: "Coming soon",
      eyebrow: "Get ready to get in",
      titlePre: "University Prep ",
      titleAccent: "Program",
      titlePost: "",
      lead: "Full preparation for the entrance exams of San Marcos and Peru's most demanding universities, with the same principle as always: quality education within everyone's reach.",
      imgAlt: "Two Only One Coin students going over the syllabus together",
      intro: "The program works through every area assessed in admission exams, step by step, with live classes, exam-style exercises and constant assessments to track your progress.",
      facts: [
        { label: "Duration", value: "6 months · semester cycle" },
        { label: "Modality", value: "100% online · live classes" },
        { label: "Study plan", value: "18 subjects" },
        { label: "Focus", value: "San Marcos admission exam" },
      ],
      goalTitle: "Program goal",
      goal: "That you master both the content and the problem-solving strategies an entrance exam demands — not memorising, but analysing, interpreting and deciding under pressure.",
      areasTitle: "What you'll study",
      areas: [
        { title: "Verbal Reasoning", text: "Reading comprehension, main ideas, semantic relationships and inference." },
        { title: "Logical-Mathematical Reasoning", text: "Logical reasoning and problem solving with inductive and deductive strategies." },
        { title: "Mathematics", text: "Arithmetic, Algebra, Geometry and Trigonometry applied to admission problems." },
        { title: "Sciences", text: "Physics, Chemistry and Biology: core principles and the scientific method." },
        { title: "Language & Literature", text: "Grammar, syntax and usage, with analysis of literary and non-literary texts." },
        { title: "Social Sciences", text: "History, Geography, Economics, Civics and Philosophy, with a critical view of Peru and the world." },
      ],
      temarioTitle: "The full syllabus",
      temarioCount: "{n} topics",
      methodTitle: "How it is taught",
      method: [
        "Content built up step by step",
        "Exam-style exercises throughout",
        "Problems analysed and discussed in class",
        "Constant assessments to measure progress",
        "Study habits and independent learning",
      ],
      resultsTitle: "By the end of the program you'll be able to",
      results: [
        "Answer admission-exam questions effectively",
        "Apply knowledge across different subject areas",
        "Analyse information critically and methodically",
        "Sustain your academic performance with confidence",
        "Face the admission process at a competitive level",
      ],
      ctaTitle: "Enrollment is not open yet",
      ctaText: "Message us on WhatsApp and we'll let you know as soon as seats open, with dates, schedules and price.",
      ctaWhatsApp: "Let me know when it opens",
    },
    pages: {
      blog: {
        titlePre: "Our ",
        titleAccent: "blog",
        titlePost: "",
        lead: "Tips for learning languages, news from Only One Coin and free resources for our students.",
        soonTitle: "Coming soon",
        soonText: "We're preparing our first articles. Check back soon to read our posts.",
      },
      community: {
        titlePre: "Our ",
        titleAccent: "community",
        titlePost: "",
        lead: "Thousands of students across Peru learn with us. Join in, share your experience and keep growing.",
        soonTitle: "Coming soon",
        soonText: "We're building our community space. In the meantime, follow us on our social media.",
      },
      about: {
        titlePre: "Accessible education ",
        titleAccent: "for everyone",
        titlePost: "",
        lead: "At Only One Coin we firmly believe that education is a fundamental right, not a privilege. With that in mind, we have spent {years} years offering language classes at symbolic prices, from S/0.60 a session.",
        lead2: "Our commitment is to give children, teenagers and adults of every age and background the chance to learn and grow, with no financial barriers.",
        teamAlt: "The Only One Coin team at their office in Lima",
        coinAlt: "A coin: the symbolic price of each session",
        whyTitle: "Why choose us?",
        whyText: "Our teachers are highly qualified and committed to teaching. We use innovative, dynamic methods so that every student learns effectively and enjoys the process.",
        whyText2: "We want everyone who goes through our classes to leave with more than a language: to leave with the confidence and preparation to face what comes next.",
        whyAlt: "An Only One Coin teacher running an online class",
        whyAlt2: "Two Only One Coin team members working through a question together",
        missionTitle: "Mission",
        missionText: "To open up the learning of English and other fundamental skills through an educational model that is innovative and affordable for everyone.",
        visionTitle: "Vision",
        visionText: "To be the leading language academy in Peru, recognised for our commitment to accessible, quality education and for our positive impact on our students' lives.",
        valuesTitlePre: "Our ",
        valuesTitleAccent: "values",
        valuesTitlePost: "",
        valuesLead: "Our values are the foundation of everything we do. We believe in accessible, quality education, and we work to carry those principles into every part of our service. Through them we aim not only to teach English, but to inspire our students to reach their full potential and give back to their communities.",
        valuesAlt: "Two Only One Coin students studying together",
        values: [
          {
            title: "Inclusion",
            text: "We open the door to students of every age and from every corner of Peru, with no financial or geographic barriers.",
          },
          {
            title: "Quality",
            text: "We strive to offer the best in teaching and educational resources.",
          },
          {
            title: "Commitment",
            text: "We are dedicated to continuous improvement and to our students' success.",
          },
          {
            title: "Innovation",
            text: "We back modern, creative teaching methods that make learning dynamic and effective, adapting to our students' changing needs.",
          },
        ],
        partnerEyebrow: "Strategic partner",
        // {partner} is filled from `org.partner.name`, so the brand is written
        // once and a rename never leaves a locale behind.
        partnerTitlePre: "Technology with purpose, alongside ",
        partnerTitleAccent: "{partner}",
        partnerText: "{partner} is our strategic technology partner: they designed and built Only One Coin's digital platform, and they keep it evolving so that studying with us is simple from anywhere in the world.",
        partnerCta: "Meet {partner}",
      },
      contact: {
        eyebrow: "Contact",
        titlePre: "How can we ",
        titleAccent: "help you",
        titlePost: "?",
        lead: "We answer questions about enrolment, schedules and available courses. Pick whichever channel suits you best.",
        waTitle: "WhatsApp",
        waText: "The fastest way to reach us. We reply within our business hours.",
        waButton: "Message us on WhatsApp",
        phonesTitle: "Phone",
        emailTitle: "Email",
        emailText: "For formal enquiries and to exercise your rights over your personal data.",
        onlineNote: "All our classes are 100% online and support is remote too: we do not receive students at our office.",
      },
    },
    footer: {
      tagline: "Quality language education within everyone's reach, across all of Peru.",
      orgHtml: "{legalName}<br />RUC {ruc}",
      colAbout: "About us",
      aboutHistory: "Our story",
      aboutMission: "Mission & vision",
      aboutImpact: "Social impact",
      langsTitle: "Languages",
      colStudents: "Students",
      studentsPortal: "Student Portal",
      studentsCourses: "Courses",
      studentsCertificates: "Certificates",
      studentsFaq: "FAQ",
      colResources: "Resources",
      resBlog: "Blog",
      resWorkshops: "Workshops",
      resCommunity: "Community",
      colHelp: "Help",
      helpContact: "Contact",
      helpWhatsapp: "WhatsApp",
      privacy: "Privacy policy",
      terms: "Terms & conditions",
      hoursLabel: "Business hours",
      hours: "Monday to Friday · 9:00 AM – 6:00 PM",
      script: "More languages, more opportunities",
      followTitle: "Follow us",
      copyOrg: "Only One Coin",
      rights: "All rights reserved",
      madeIn: "Made with ❤ in Peru",
      partnerLabel: "Platform built by our strategic partner",
    },
    common: {
      waAria: "Message us on WhatsApp",
      langLabel: "Language",
    },
  },

  pt: {
    meta: {
      title: "Cursos de inglês e idiomas online no Peru — Only One Coin",
      description:
        "Aulas 100% online para todo o Peru: inglês, francês, italiano, alemão, português, chinês, coreano, japonês e russo. Aulas a partir de S/0,60 por sessão, certificado e oficinas grátis.",
      siteName: "Only One Coin",
      imageAlt: "Only One Coin Peru — cursos de idiomas online",
      courses: {
        title: "Cursos de idiomas online: preços e pacotes — Only One Coin",
        description:
          "Escolha inglês, francês, italiano, alemão, português, chinês mandarim, coreano, japonês ou russo. Aulas online para jovens e adultos a partir dos 13 anos, a partir de S/0,60 por sessão e sem mensalidades.",
      },
      course: {
        titlePre: "Curso de ",
        titleMid: " online no Peru",
        titlePost: " · {price} por sessão",
        descPre: "Aprenda ",
        descPost: " online com a Only One Coin Peru: para jovens e adultos a partir dos 13 anos, com certificado digital e oficinas incluídas no pacote.",
        descPrice: " Aulas a partir de {price} por sessão.",
      },
      faq: {
        title: "Perguntas frequentes sobre os cursos online — Only One Coin",
        description:
          "Respondemos as dúvidas mais comuns sobre matrícula, preços, horários, certificados e oficinas gratuitas da Only One Coin Peru.",
      },
      blog: {
        title: "Blog de idiomas e aprendizagem — Only One Coin",
        description:
          "Dicas para aprender idiomas online, novidades da Only One Coin Peru e recursos gratuitos para os nossos alunos.",
      },
      community: {
        title: "Comunidade de alunos em todo o Peru — Only One Coin",
        description:
          "Milhares de estudantes de todo o Peru aprendem idiomas online com a Only One Coin. Conheça a nossa comunidade e participe.",
      },
      terms: {
        title: "Termos e condições de uso — Only One Coin",
        description:
          "Termos e condições de uso do site da Only One Coin Peru: serviços, cadastro de usuários, propriedade intelectual, responsabilidade e lei aplicável.",
      },
      privacy: {
        title: "Política de privacidade — Only One Coin",
        description:
          "Como a Only One Coin Peru coleta, usa, armazena e protege seus dados pessoais, e como exercer seus direitos de acesso, retificação, cancelamento e oposição.",
      },
      preuni: {
        title: "Pré-universitário — Only One Coin Perú",
        description:
          "Programa Pré-universitário da Only One Coin: ciclo semestral de 6 meses, 100% virtual, com 18 matérias e conteúdo completo para o vestibular da San Marcos e das universidades mais exigentes do Peru. Em breve.",
      },
      about: {
        title: "Sobre nós — Only One Coin Peru",
        description:
          "Conheça a Only One Coin Peru: educação acessível para todos, aulas de idiomas a partir de S/0,60 por sessão, e nossa missão, visão e valores.",
      },
      contact: {
        title: "Contato — Only One Coin Peru",
        description:
          "Fale com a gente no WhatsApp, ligue ou mande um e-mail. Atendimento de segunda a sexta sobre matrícula, horários e cursos disponíveis.",
      },
    },
    nav: {
      about: "Sobre",
      courses: "Idiomas",
      coursesAll: "Ver todos os idiomas",
      programs: "Cursos",
      preuniversitario: "Pré-universitário",
      soon: "Em breve",
      resources: "Recursos",
      community: "Comunidade",
      blog: "Blog",
      faq: "Perguntas frequentes",
      contact: "Contato",
      benefits: "Benefícios",
      portal: "Área do Aluno",
      portalHint: "Já é aluno?",
      openMenu: "Abrir menu",
      closeMenu: "Fechar menu",
    },
    hero: {
      w1: "Aprenda idiomas.",
      w2: "Transforme seu futuro.",
      subPre: "Estude idiomas a partir de",
      price: "S/0,60",
      priceUnit: "por sessão",
      sub2Html:
        'Aulas online para crianças, jovens e adultos, a partir dos <span class="accent">6 anos</span>.',
      ctaEnroll: "MATRICULE-SE JÁ",
      ctaCourses: "Conheça nossos cursos",
      photoCaption: "Juntos por um futuro melhor",
      imgAlt: "Estudantes da Only One Coin",
      features: [
        { title: "S/0,60", text: "Por sessão" },
        { title: "+ Idiomas", text: "Para escolher" },
        { title: "100% online", text: "De qualquer lugar" },
      ],
    },
    why: {
      eyebrow: "Only One Coin",
      titlePre: "Por que estudar na ",
      titleAccent: "Only One Coin",
      titlePost: "?",
      lead: "Porque não ensinamos só um idioma: damos a você ferramentas para um futuro melhor.",
      cta: "Saiba mais",
      cards: [
        {
          title: "Educação acessível",
          text: "Idiomas a partir de S/0,60 por sessão.",
        },
        {
          title: "100% digital",
          text: "Estude de qualquer lugar.",
        },
        {
          title: "Docentes",
          text: "Docentes com suporte ao vivo.",
        },
        {
          title: "Comunidade",
          text: "Faça parte de uma comunidade educativa.",
        },
        {
          title: "Oportunidades",
          text: "Oficinas, atividades e benefícios.",
        },
      ],
    },
    audiences: {
      titlePre: "Encontre a opção ",
      titleAccent: "ideal para você",
      titlePost: "",
      lead: "Temos cursos para cada etapa da sua vida.",
      more: "Saiba mais",
      items: [
        {
          title: "OOC Kids",
          text: "Inglês para crianças de 6 a 12 anos.",
          href: "/courses/english#kids",
        },
        {
          title: "Jovens",
          text: "Aprenda, pratique e prepare-se para suas metas.",
          href: "/courses/english#teens-and-adults",
        },
        {
          title: "Adultos",
          text: "Idiomas para estudos, trabalho e crescimento pessoal.",
          href: "/courses",
        },
        {
          title: "Aulas online",
          text: "Estude de qualquer parte do mundo.",
          href: "/faq",
        },
      ],
    },
    finder: {
      eyebrow: "Encontre seu idioma",
      titlePre: "Conheça nossos ",
      titleAccent: "idiomas",
      titlePost: "",
      text: "Escolha o idioma que vai levar você mais longe. Com base em onde você nos visita, sugerimos por onde começar.",
      detecting: "Detectando sua localização…",
      fromLabel: "Detectamos que você nos visita de",
      unknownLocation: "sua região",
      viewCourse: "Ver este curso",
      orChoose: "Ou escolha o idioma que quer aprender:",
      allCourses: "Ver todos os idiomas",
      prev: "Idioma anterior",
      next: "Próximo idioma",
    },
    purpose: {
      eyebrow: "Nosso propósito",
      title: "Mais do que aprender um idioma, abrimos oportunidades.",
      text: "A Only One Coin nasceu com um propósito: democratizar o acesso à educação.",
      cta: "Conheça nossa história",
      imgAlt: "Uma aluna mostra uma moeda de um sol",
      priceValue: "S/0,60",
      priceLabel: "por sessão",
      fact2: "Educação acessível",
      fact3: "Impacto social",
    },
    perks: {
      titlePre: "Sua matrícula ",
      titleAccent: "abre mais oportunidades",
      titlePost: "",
      lead: "Benefício dos nossos alunos premium: as oficinas gratuitas vêm com o pacote completo.",
      allCta: "Ver todos os benefícios",
      items: [
        { title: "Excel" },
        { title: "Empreendedorismo" },
        { title: "Liderança" },
        { title: "Quíchua" },
      ],
    },
    steps: {
      titlePre: "Comece a estudar em ",
      titleAccent: "3 passos",
      titlePost: "",
      lead: "É fácil, rápido e 100% online.",
      cta: "Quero me matricular",
      items: [
        { title: "Escolha seu idioma", text: "Explore todas as opções." },
        { title: "Escolha seu curso", text: "De acordo com seu nível e objetivos." },
        { title: "Matricule-se e comece", text: "Seu futuro espera por você!" },
      ],
      faqTitle: "Tem dúvidas? Temos respostas.",
      faqAll: "Ver todas as perguntas",
    },
    cta: {
      title: "Seu próximo idioma começa aqui.",
      sub: "Aprenda. Cresça. Conecte.",
      pricePre: "A partir de",
      price: "S/0,60",
      priceUnit: "por sessão.",
      imgAlt: "Aluna da Only One Coin em uma aula online",
    },
    testimonials: {
      eyebrow: "Depoimentos",
      titlePre: "Eles já fazem parte da ",
      titleAccent: "OOC",
      titlePost: "",
      lead: "Histórias reais que inspiram.",
      note: "Conteúdo de exemplo — será substituído por depoimentos reais.",
      prev: "Anterior",
      next: "Próximo",
      items: [
        { name: "María Fernández", role: "Aluna de Inglês", initials: "MF", quote: "Aprendi muitíssimo e os professores são super pacientes. Por um sol, nem pensei duas vezes!" },
        { name: "José Ramírez", role: "Aluno de Francês", initials: "JR", quote: "As aulas são dinâmicas e práticas. Em poucos meses já me arrisco a conversar." },
        { name: "Lucía Quispe", role: "Responsável", initials: "LQ", quote: "Minha filha espera cada aula com vontade. Uma grande oportunidade para as famílias." },
        { name: "Carlos Mendoza", role: "Aluno de Italiano", initials: "CM", quote: "Nunca pensei que estudar um idioma fosse tão acessível. As oficinas grátis são um baita plus." },
        { name: "Ana Torres", role: "Aluna de Alemão", initials: "AT", quote: "A plataforma do aluno me ajuda a não perder nenhuma aula nem material. Tudo bem organizado." },
        { name: "Diego Salas", role: "Aluno de Português", initials: "DS", quote: "Excelente custo-benefício. Dá para ver que os professores amam o que fazem." },
      ],
    },
    faq: {
      eyebrow: "Perguntas frequentes",
      titlePre: "Tiramos suas ",
      titleAccent: "dúvidas",
      titlePost: "",
      lead: "Tudo o que você precisa saber sobre nossos cursos, a matrícula e as oficinas gratuitas.",
      ctaTitle: "Não achou sua resposta?",
      ctaText: "Fale com a gente no WhatsApp: ajudamos com matrícula, horários e o que mais precisar.",
      ctaButton: "Falar no WhatsApp",
      items: [
        { q: "Quanto custa e como funciona o pagamento?", a: "Você estuda a partir de S/0,60 por sessão, com matrícula, material e certificado incluídos; as oficinas gratuitas vêm com o pacote completo. Consulte no WhatsApp o detalhe do curso que você quer. Sem mensalidades ocultas nem cobranças-surpresa." },
        { q: "A partir de que idade posso me matricular?", a: "Os cursos de idiomas são para jovens e adultos, a partir dos 13 anos. Para crianças de 6 a 12 anos temos o OOC Kids, nosso programa de inglês para crianças." },
        { q: "Como me matriculo?", a: "Fale com a gente no WhatsApp para reservar sua vaga. Depois você preenche o formulário de matrícula, envia seu comprovante e recebe suas credenciais de acesso." },
        { q: "As aulas são presenciais ou online?", a: "Todas as nossas aulas são 100% online e ao vivo com um professor. Você pode estudar de qualquer parte do mundo sem sair de casa. Consulte no WhatsApp os horários disponíveis do período." },
        { q: "O que a matrícula inclui?", a: "O acesso ao seu curso de idioma e a plataforma do aluno. As oficinas gratuitas de Excel, Empreendedorismo, Liderança e Quíchua são o benefício dos nossos alunos premium: os que estudam com o pacote completo." },
        { q: "Recebo algum certificado?", a: "Sim. Ao concluir seu curso você recebe um certificado digital que valida seu aprendizado." },
      ],
    },
    stats: {
      title: "A confiança de milhares de famílias",
      items: [
        { value: "+5 anos", label: "De experiência" },
        { value: "+1,5 milhão", label: "Alunos registrados" },
        { value: "+350", label: "Docentes qualificados" },
        { value: "+2M", label: "Seguidores nas redes" },
      ],
    },
    courses: {
      list: {
        "english": "Inglês",
        "french": "Francês",
        "italian": "Italiano",
        "german": "Alemão",
        "portuguese": "Português",
        "mandarin-chinese": "Chinês Mandarim",
        "korean": "Coreano",
        "japanese": "Japonês",
        "russian": "Russo",
        "english-intermediate": "Inglês Intermediário/Avançado",
        "cambridge-b1": "Inglês B1 · Cambridge",
        "cambridge-b2": "Inglês B2 · Cambridge",
        "french-advanced": "Francês Intermediário",
      },
      indexEyebrow: "Nossos idiomas",
      indexTitlePre: "Escolha o idioma que ",
      indexTitleAccent: "você quer aprender",
      indexTitlePost: "",
      indexText: "Cursos para jovens e adultos a partir dos 13 anos, a partir de S/0,60 por sessão. Para crianças de 6 a 12 anos temos o OOC Kids, em inglês. Escolha um idioma para ver o preço e o detalhe.",
      priceUnit: "por sessão",
      viewCourse: "Ver curso",
    },
    courseDetail: {
      backToCourses: "Voltar aos cursos",
      urgency: "Vagas limitadas por turma! Garanta a sua hoje.",
      discountAmount: "40%",
      discountLabel: "de desconto",
      priceHookPre: "a partir de",
      factDuration: "Duração",
      factLevel: "Nível",
      factModality: "Modalidade",
      liveClasses: "com AULAS AO VIVO",
      perkTeacher: "Você interage com seu docente",
      perkSchedule: "Uma hora por dia, de segunda a sexta · mais de 6 horários",
      perkIncludes: "Inclui livro, matrícula e certificado GRATUITO",
      levelsTitle: "Níveis disponíveis",
      levelShortNames: {
        "english": "Básico",
        "english-intermediate": "Intermediário/Avançado",
        "cambridge-b1": "B1 · Cambridge",
        "cambridge-b2": "B2 · Cambridge",
        "french": "Básico",
        "french-advanced": "Intermediário",
        "italian": "Básico",
        "german": "Introdutório",
        "portuguese": "Básico",
        "mandarin-chinese": "Básico",
        "korean": "Básico",
      } as Partial<Record<CourseSlug, string>>,
      levelHighlights: {
        "english": [
          "Você começa do zero, sem base anterior",
          "4 módulos · Livros 1–4 (A1–A2)",
          "80 sessões ao vivo, uma hora por dia",
          "O pacote completo inclui as oficinas gratuitas",
        ],
        "english-intermediate": [
          "Continuação do nível Básico",
          "2 módulos · Livros 5 e 6 (A2–B1)",
          "80 sessões ao vivo, uma hora por dia",
          "Base para exames tipo TOEFL",
        ],
        "cambridge-b1": [
          "Prepara você para o exame Cambridge B1 (PET)",
          "Tarefas, áudios e textos no formato do exame",
          "Assessoria gratuita para se inscrever no exame",
        ],
        "cambridge-b2": [
          "Prepara você para o exame Cambridge B2",
          "Tarefas, áudios e textos no formato do exame",
        ],
      } as Partial<Record<CourseSlug, string[]>>,
      parentBack: "Ver todos os níveis de",
      curriculumTitle: "Grade curricular",
      programTitle: "O programa em detalhe",
      detailsToggle: "Ver detalhes",
      aboutTitle: "Sobre o curso",
      goalsTitle: "Competências que você vai desenvolver",
      methodTitle: "Como é ensinado",
      evaluationTitle: "Como é avaliado",
      outcomesTitle: "Ao terminar o curso você vai conseguir",
      eyebrowPre: "Curso de ",
      eyebrowPost: "",
      titlePre: "Aprenda ",
      titlePost: "",
      paymentBundleNames: {
        "english-total": "Inglês Total",
        "french-full": "Completo",
      },
      paymentSessionsWith: "{sessions} + reforços",
      paymentWorkshops: "Este pacote inclui {count} oficinas gratuitas",
      paymentMonthlyName: "Mensal",
      paymentExtraNames: {
        "english-2-modules": "2 módulos",
        "english-3-modules": "3 módulos",
        "russian-2-modules": "2 módulos",
        "german-intensive": "Intensivo",
      },
      paymentExtraPerks: {
        "english-2-modules": [],
        "english-3-modules": [],
        "german-intensive": ["2 horas por dia · 40 horas no total"],
        "russian-2-modules": ["24 horas"],
      },
      paymentFullName: "Pacote completo",
      paymentRecommended: "Recomendado",
      leadPre: "Um programa completo de ",
      leadPost: " para todas as idades, com foco conversacional e professores comprometidos com o seu aprendizado real.",
      exampleNote: "Conteúdo de exemplo — a informação detalhada de cada curso será preenchida com os dados reais do período.",
      ageBadge: "Jovens e adultos · a partir dos 13 anos",
      kidsTitle: "O aluno tem menos de 13 anos?",
      kidsTag: "Curso à parte · 6 a 12 anos",
      kidsName: "OOC Kids",
      kidsText: "Inglês para crianças é um curso próprio, com matrícula, turmas e docente próprios — não é um nível desta página. O idioma entra pela brincadeira, pela música e por atividades pensadas para a idade.",
      kidsCta: "Matricular no OOC Kids",
      featuresTitle: "O que inclui",
      features: [
        { title: "Pagamento único do pacote", text: "Um único pagamento por todo o curso, sem custos ocultos. O inglês também pode ser pago por módulo." },
        { title: "Oficinas gratuitas", text: "Excel, Empreendedorismo, Liderança e Quíchua sem custo adicional." },
        { title: "Certificado digital", text: "Ao concluir o curso você recebe um certificado que valida seu aprendizado." },
        { title: "Plataforma do aluno", text: "Aulas, horários e materiais em um só lugar." },
      ],
      ctaTitlePre: "Pronto para ",
      ctaTitleAccent: "começar",
      ctaTitlePost: "?",
      ctaText: "Reserve sua vaga no WhatsApp e matricule-se hoje.",
      ctaEnroll: "MATRICULE-SE JÁ",
      ctaWhatsApp: "Fale conosco no WhatsApp",
    },
    preuni: {
      badge: "Em breve",
      eyebrow: "Prepare-se para entrar",
      titlePre: "Programa ",
      titleAccent: "Pré-universitário",
      titlePost: "",
      lead: "Preparação completa para o vestibular da San Marcos e das universidades mais exigentes do Peru, com o princípio de sempre: educação de qualidade ao alcance de todos.",
      imgAlt: "Dois alunos da Only One Coin revisando o conteúdo juntos",
      intro: "O programa percorre, de forma progressiva, todas as áreas cobradas nos exames de admissão, com aulas ao vivo, exercícios no formato da prova e avaliações constantes para medir seu avanço.",
      facts: [
        { label: "Duração", value: "6 meses · ciclo semestral" },
        { label: "Modalidade", value: "100% virtual · aulas ao vivo" },
        { label: "Plano de estudos", value: "18 matérias" },
        { label: "Foco", value: "Vestibular da San Marcos" },
      ],
      goalTitle: "Objetivo do programa",
      goal: "Que você domine o conteúdo e as estratégias de resolução que um exame de admissão exige — não decorar, mas analisar, interpretar e decidir sob pressão.",
      areasTitle: "O que você vai estudar",
      areas: [
        { title: "Habilidade Verbal", text: "Compreensão de leitura, ideias principais, relações semânticas e inferências." },
        { title: "Raciocínio Lógico-Matemático", text: "Raciocínio lógico e resolução de problemas com estratégias indutivas e dedutivas." },
        { title: "Matemática", text: "Aritmética, Álgebra, Geometria e Trigonometria aplicadas às questões de admissão." },
        { title: "Ciências", text: "Física, Química e Biologia: princípios fundamentais e método científico." },
        { title: "Linguagem e Literatura", text: "Gramática, sintaxe e normas, com análise de textos literários e não literários." },
        { title: "Ciências Sociais", text: "História, Geografia, Economia, Educação Cívica e Filosofia, com olhar crítico sobre o Peru e o mundo." },
      ],
      temarioTitle: "Conteúdo completo do ciclo",
      temarioCount: "{n} temas",
      methodTitle: "Como é ensinado",
      method: [
        "Conteúdo construído de forma progressiva",
        "Exercícios no formato do exame de admissão",
        "Problemas analisados e discutidos em aula",
        "Avaliações constantes para medir o avanço",
        "Hábitos de estudo e autonomia no aprendizado",
      ],
      resultsTitle: "Ao terminar o programa você vai conseguir",
      results: [
        "Resolver com eficácia questões de exame de admissão",
        "Aplicar conhecimento em diferentes áreas",
        "Analisar informação de forma crítica e estruturada",
        "Sustentar seu desempenho acadêmico com segurança",
        "Encarar a admissão em nível competitivo",
      ],
      ctaTitle: "A matrícula ainda não está aberta",
      ctaText: "Fale com a gente no WhatsApp e avisamos assim que as vagas abrirem, com datas, horários e valor.",
      ctaWhatsApp: "Quero ser avisado",
    },
    pages: {
      blog: {
        titlePre: "Nosso ",
        titleAccent: "blog",
        titlePost: "",
        lead: "Dicas para aprender idiomas, novidades da Only One Coin e recursos gratuitos para nossos alunos.",
        soonTitle: "Em breve",
        soonText: "Estamos preparando nossos primeiros artigos. Volte em breve para ler nossas publicações.",
      },
      community: {
        titlePre: "Nossa ",
        titleAccent: "comunidade",
        titlePost: "",
        lead: "Milhares de estudantes de todo o Peru aprendem com a gente. Participe, compartilhe sua experiência e continue crescendo.",
        soonTitle: "Em breve",
        soonText: "Estamos construindo o espaço da nossa comunidade. Enquanto isso, siga a gente nas redes sociais.",
      },
      about: {
        titlePre: "Educação acessível ",
        titleAccent: "para todos",
        titlePost: "",
        lead: "Na Only One Coin acreditamos firmemente que a educação é um direito fundamental, e não um privilégio. Com essa visão, há {years} anos oferecemos aulas de idiomas a preços simbólicos, a partir de S/0,60 por sessão.",
        lead2: "Nosso compromisso é dar a crianças, jovens e adultos de todas as idades e classes sociais a oportunidade de aprender e crescer, sem barreiras econômicas.",
        teamAlt: "Equipe da Only One Coin no escritório em Lima",
        coinAlt: "Uma moeda: o preço simbólico de cada sessão",
        whyTitle: "Por que nos escolher?",
        whyText: "Nosso time de professores é altamente qualificado e comprometido com o ensino. Usamos métodos inovadores e dinâmicos para garantir que cada estudante aprenda de forma efetiva e aproveite o processo.",
        whyText2: "Queremos que cada pessoa que passa pelas nossas turmas saia com mais do que conhecimento de idiomas: saia com confiança e preparo para encarar os desafios que vêm pela frente.",
        whyAlt: "Professora da Only One Coin dando uma aula online",
        whyAlt2: "Dois integrantes da equipe da Only One Coin resolvendo uma dúvida juntos",
        missionTitle: "Missão",
        missionText: "Facilitar o acesso ao aprendizado do inglês e de outras habilidades fundamentais por meio de um modelo educativo inovador e acessível para todos.",
        visionTitle: "Visão",
        visionText: "Ser a academia de idiomas líder no Peru, reconhecida pelo nosso compromisso com a educação acessível e de qualidade, e pelo impacto positivo na vida dos nossos estudantes.",
        valuesTitlePre: "Nossos ",
        valuesTitleAccent: "valores",
        valuesTitlePost: "",
        valuesLead: "Nossos valores são o pilar de tudo o que fazemos. Acreditamos em educação acessível e de qualidade, e nos esforçamos para levar esses princípios a cada aspecto do nosso serviço. Através deles buscamos não só ensinar inglês, mas inspirar nossos estudantes a alcançar seu máximo potencial e a contribuir positivamente com suas comunidades.",
        valuesAlt: "Duas alunas da Only One Coin estudando juntas",
        values: [
          {
            title: "Inclusão",
            text: "Abrimos a porta para estudantes de todas as idades e de todo o Peru, sem barreiras econômicas nem geográficas.",
          },
          {
            title: "Qualidade",
            text: "Nos esforçamos para oferecer o melhor em ensino e recursos educacionais.",
          },
          {
            title: "Compromisso",
            text: "Somos dedicados à melhoria contínua e ao sucesso dos nossos estudantes.",
          },
          {
            title: "Inovação",
            text: "Apostamos em métodos de ensino modernos e criativos, que tornam o aprendizado dinâmico e efetivo, adaptando-se às necessidades em mudança dos nossos estudantes.",
          },
        ],
        partnerEyebrow: "Parceiro estratégico",
        // {partner} is filled from `org.partner.name`, so the brand is written
        // once and a rename never leaves a locale behind.
        partnerTitlePre: "Tecnologia com propósito, ao lado de ",
        partnerTitleAccent: "{partner}",
        partnerText: "{partner} é nosso parceiro estratégico de tecnologia: desenhou e desenvolveu a plataforma digital da Only One Coin e acompanha a sua evolução para que estudar com a gente seja simples de qualquer lugar do mundo.",
        partnerCta: "Conhecer a {partner}",
      },
      contact: {
        eyebrow: "Contato",
        titlePre: "Como podemos ",
        titleAccent: "ajudar você",
        titlePost: "?",
        lead: "Tiramos suas dúvidas sobre matrícula, horários e cursos disponíveis. Escolha o canal que for mais confortável pra você.",
        waTitle: "WhatsApp",
        waText: "O jeito mais rápido de falar com a gente. Respondemos dentro do horário de atendimento.",
        waButton: "Falar no WhatsApp",
        phonesTitle: "Telefones",
        emailTitle: "E-mail",
        emailText: "Para consultas formais e para exercer seus direitos sobre seus dados pessoais.",
        onlineNote: "Todas as nossas aulas são 100% online e o atendimento também é remoto: não recebemos alunos no escritório.",
      },
    },
    footer: {
      tagline: "Educação de idiomas de qualidade ao alcance de todos, em todo o Peru.",
      orgHtml: "{legalName}<br />RUC {ruc}",
      colAbout: "Sobre nós",
      aboutHistory: "Nossa história",
      aboutMission: "Missão e visão",
      aboutImpact: "Impacto social",
      langsTitle: "Idiomas",
      colStudents: "Alunos",
      studentsPortal: "Portal do Aluno",
      studentsCourses: "Cursos",
      studentsCertificates: "Certificados",
      studentsFaq: "Perguntas frequentes",
      colResources: "Recursos",
      resBlog: "Blog",
      resWorkshops: "Oficinas",
      resCommunity: "Comunidade",
      colHelp: "Ajuda",
      helpContact: "Contato",
      helpWhatsapp: "WhatsApp",
      privacy: "Política de privacidade",
      terms: "Termos e condições",
      hoursLabel: "Horário de atendimento",
      hours: "Segunda a sexta · 9:00 – 18:00",
      script: "Mais idiomas, mais oportunidades",
      followTitle: "Siga a gente",
      copyOrg: "Only One Coin",
      rights: "Todos os direitos reservados",
      madeIn: "Feito com ❤ no Peru",
      partnerLabel: "Plataforma desenvolvida pelo nosso parceiro estratégico",
    },
    common: {
      waAria: "Fale conosco no WhatsApp",
      langLabel: "Idioma",
    },
  },
} as const;
