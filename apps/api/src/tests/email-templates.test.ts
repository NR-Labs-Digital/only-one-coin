import { EMAIL_TEMPLATE_KEYS, LocaleSchema, type EmailTemplateVars, type Locale } from "@ooc/domain";
import { LOCALE_CATALOGS, TemplateRenderError, renderEmail, type OutgoingEmail } from "@ooc/notifications";
import { describe, expect, it } from "vitest";

/**
 * The e-mail templates versioned in packages/notifications (apps/api/CLAUDE.md,
 * "Notificações"). What typecheck cannot promise: that the three locale files
 * carry the same keys in both directions (CLAUDE.md §4), that every
 * placeholder a template uses has a value, and that a var can never inject
 * markup into the HTML.
 */

const SAMPLE_VARS: EmailTemplateVars = {
  enrollment_received: {
    recipientName: "Rosa",
    studentName: "Rosa Quispe",
    courseName: "Inglés Básico",
    startsOn: "2026-10-05T05:00:00.000Z",
    amountCents: 25000,
  },
  payment_under_review: { recipientName: "Rosa", studentName: "Rosa Quispe", courseName: "Inglés Básico" },
  payment_approved: {
    recipientName: "Rosa",
    studentName: "Rosa Quispe",
    courseName: "Inglés Básico",
    startsOn: "2026-10-05T05:00:00.000Z",
  },
  payment_rejected: { recipientName: "Rosa", studentName: "Rosa Quispe", courseName: "Inglés Básico" },
  portal_credentials: {
    recipientName: "Rosa",
    loginEmail: "rosa.quispe@gmail.com",
    accessUrl: "https://aula.onlyonecoin.edu.pe/portal",
  },
  portal_password_reset: {
    recipientName: "Ana Quispe",
    resetUrl: "https://student.onlyonecoin.edu.pe/access/abc123",
  },
  staff_password_reset: {
    recipientName: "Rosa Quispe",
    resetUrl: "https://backoffice.onlyonecoin.edu.pe/backoffice/reset-password/abc123",
  },
  email_verification_code: { recipientName: "Rosa", code: "042137" },
  staff_mfa_code: { recipientName: "Rosa Quispe", code: "042137" },
};

const LOCALES = LocaleSchema.options;

function sample<K extends keyof EmailTemplateVars>(templateKey: K, locale: Locale): OutgoingEmail {
  return { to: "rosa.quispe@gmail.com", templateKey, locale, vars: SAMPLE_VARS[templateKey] } as OutgoingEmail;
}

/** Every key path in a JSON value, arrays by index. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => keyPaths(item, `${prefix}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

describe("e-mail locale files", () => {
  it("carry exactly the same keys in all three locales", () => {
    const reference = keyPaths(LOCALE_CATALOGS["es-PE"]).sort();
    for (const locale of LOCALES) {
      expect(keyPaths(LOCALE_CATALOGS[locale]).sort(), locale).toEqual(reference);
    }
  });

  it("have a template for every key the domain can emit, and nothing else", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(LOCALE_CATALOGS[locale].templates).sort()).toEqual([...EMAIL_TEMPLATE_KEYS].sort());
    }
  });
});

describe("renderEmail", () => {
  for (const templateKey of EMAIL_TEMPLATE_KEYS) {
    for (const locale of LOCALES) {
      it(`renders ${templateKey} in ${locale} with every placeholder filled`, () => {
        const rendered = renderEmail(sample(templateKey, locale));

        expect(rendered.subject.length).toBeGreaterThan(0);
        for (const part of [rendered.subject, rendered.text, rendered.html]) {
          expect(part).not.toMatch(/\{\w+\}/);
        }
        expect(rendered.html).toContain(`lang="${locale}"`);
      });
    }
  }

  it("puts the verification code in the subject and body, in every locale", () => {
    for (const locale of LOCALES) {
      const rendered = renderEmail(sample("email_verification_code", locale));
      expect(rendered.subject).toContain("042137");
      expect(rendered.text).toContain("042137");
      expect(rendered.html).toContain("042137");
    }
  });

  it("formats money as PEN and the start date in America/Lima, in the reader's locale", () => {
    const es = renderEmail(sample("enrollment_received", "es-PE"));
    expect(es.text).toContain("S/");
    expect(es.text).toContain("250.00");
    // 05:00Z is midnight in Lima — still the 5th there.
    expect(es.text).toContain("5 de octubre de 2026");

    const en = renderEmail(sample("enrollment_received", "en"));
    expect(en.text).toContain("October 5, 2026");
  });

  it("escapes vars in the HTML so a name cannot inject markup", () => {
    const email = {
      to: "x@gmail.com",
      templateKey: "payment_rejected",
      locale: "es-PE",
      vars: { recipientName: "<script>alert(1)</script>", studentName: "A & B", courseName: '"Curso"' },
    } as OutgoingEmail;

    const { html } = renderEmail(email);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
  });

  it("refuses a button URL that is not http(s)", () => {
    const email = {
      ...sample("portal_credentials", "es-PE"),
      vars: { ...SAMPLE_VARS.portal_credentials, accessUrl: "javascript:alert(1)" },
    } as OutgoingEmail;

    expect(() => renderEmail(email)).toThrow(TemplateRenderError);
  });

  it("refuses to send a template with a placeholder left unfilled", () => {
    const email = {
      to: "x@gmail.com",
      templateKey: "payment_rejected",
      locale: "es-PE",
      vars: { recipientName: "Rosa", studentName: "Rosa Quispe" },
    } as OutgoingEmail;

    expect(() => renderEmail(email)).toThrow(TemplateRenderError);
  });
});
