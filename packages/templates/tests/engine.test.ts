import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTemplateKind, placeholdersOf, TemplateEngine, TemplateRenderError } from "../src/index.js";

/**
 * The engine against a kind shaped like the teacher contract (OOC-123): only
 * the kind's placeholders, no file access, escaped values, our formatting.
 */

const contract = defineTemplateKind({
  key: "teacher_contract_test",
  format: "html",
  variables: z.object({
    teacher: z.object({
      fullName: z.string().describe("Nombre completo del docente"),
      nationalId: z.string(),
      phone: z.string().optional(),
      region: z.string().nullable(),
    }),
    org: z.object({ legalName: z.string(), ruc: z.string() }),
    contract: z.object({ startsOn: z.string(), endsOn: z.string(), feeCents: z.number().int() }),
    groups: z.array(z.object({ code: z.string(), schedule: z.string() })),
    signedAt: z.coerce.date(),
  }),
  sample: {
    teacher: { fullName: "Ana Quispe", nationalId: "12345678", region: null },
    org: { legalName: "INGLES POR UN SOL S.A.C.", ruc: "20613918028" },
    contract: { startsOn: "2026-11-01", endsOn: "2026-12-31", feeCents: 150000 },
    groups: [
      { code: "ENG-A1-01", schedule: "Lun y Mié 19:00" },
      { code: "ENG-A1-02", schedule: "Sáb 09:00" },
    ],
    signedAt: new Date("2026-10-31T23:30:00Z"),
  },
});

const subject = defineTemplateKind({
  key: "subject_test",
  format: "text",
  variables: z.object({ teacher: z.object({ fullName: z.string() }) }),
  sample: { teacher: { fullName: "Ana & Luis" } },
});

const engine = new TemplateEngine();

describe("check", () => {
  it("accepts a template that only reads the kind's placeholders, and lists them", () => {
    const result = engine.check(
      contract,
      `{{ teacher.fullName }} · {{ org.ruc }}
{% for group in groups %}{{ group.code }} {{ forloop.index }}{% endfor %}
{% if groups.size > 1 %}{{ groups.first.code }}{% endif %}
{% assign name = teacher.fullName | upcase %}{{ name }}`,
    );

    expect(result).toEqual({
      ok: true,
      variables: ["groups", "groups.first.code", "groups.size", "org.ruc", "teacher.fullName"],
    });
  });

  it("refuses a placeholder the kind does not offer, with where it is", () => {
    const result = engine.check(contract, "Hola\n  {{ teacher.fullname }} y {{ student.name }}");

    expect(result).toEqual({
      ok: false,
      issues: [
        { code: "unknown_variable", variable: "teacher.fullname", line: 2, column: 6 },
        { code: "unknown_variable", variable: "student.name", line: 2, column: 31 },
      ],
    });
  });

  it("refuses a field read past a value that has none", () => {
    expect(engine.check(contract, "{{ contract.feeCents.amount }}").ok).toBe(false);
    expect(engine.check(contract, "{{ groups.code }}").ok).toBe(false);
  });

  it("refuses an unknown filter", () => {
    expect(engine.check(contract, "{{ teacher.fullName | shout }}")).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "unknown_filter", filter: "shout" })],
    });
  });

  it.each(["include", "render", "layout", "block"])("refuses %s — templates never read files", (tag) => {
    const source = tag === "block" ? "{% block x %}{% endblock %}" : `{% ${tag} 'secrets' %}`;
    expect(engine.check(contract, source)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "forbidden_tag" })],
    });
  });

  it("refuses broken Liquid with a position", () => {
    const result = engine.check(contract, "ok\n{% if teacher.fullName %}no end");
    expect(result).toEqual({ ok: false, issues: [expect.objectContaining({ code: "syntax_error", line: 2 })] });
  });

  it("refuses a source over the limit", () => {
    const small = new TemplateEngine({ maxSourceLength: 10 });
    expect(small.check(contract, "x".repeat(11))).toEqual({ ok: false, issues: [{ code: "too_large" }] });
  });
});

describe("render", () => {
  it("fills the template and escapes values in an html kind", async () => {
    const html = await engine.render(
      contract,
      "<p>{{ teacher.fullName }} · RUC {{ org.ruc }}</p>",
      { ...contract.sample, teacher: { fullName: "<script>x</script>", nationalId: "1", region: null } },
      { locale: "es-PE" },
    );
    expect(html).toBe("<p>&lt;script&gt;x&lt;/script&gt; · RUC 20613918028</p>");
  });

  it("does not escape a text kind", async () => {
    expect(await engine.renderSample(subject, "Contrato de {{ teacher.fullName }}", { locale: "es-PE" })).toBe(
      "Contrato de Ana & Luis",
    );
  });

  it("formats money from integer cents, in the render locale", async () => {
    const source = "{{ contract.feeCents | money }}";
    const es = await engine.renderSample(contract, source, { locale: "es-PE" });
    const en = await engine.renderSample(contract, source, { locale: "en" });
    expect(es).toMatch(/S\/\s?1,500\.00/);
    expect(en).toMatch(/PEN\s?1,500\.00/);
  });

  it("shows a calendar day as that day, and an instant in Lima", async () => {
    // 23:30 UTC on the 31st is 18:30 in Lima, still the 31st; a calendar day
    // must never slide to the evening before.
    const out = await engine.renderSample(
      contract,
      '{{ contract.startsOn | local_date: "short" }}|{{ signedAt | local_date: "short" }}',
      { locale: "es-PE" },
    );
    expect(out).toBe("1/11/26|31/10/26");
  });

  it("renders loops over lists", async () => {
    const out = await engine.renderSample(
      contract,
      "{% for g in groups %}{{ g.code }}({{ g.schedule }}){% unless forloop.last %}, {% endunless %}{% endfor %}",
      { locale: "es-PE" },
    );
    expect(out).toBe("ENG-A1-01(Lun y Mié 19:00), ENG-A1-02(Sáb 09:00)");
  });

  it("refuses data that does not match the kind", async () => {
    await expect(
      engine.render(contract, "{{ org.ruc }}", { org: { ruc: 1 } }, { locale: "es-PE" }),
    ).rejects.toMatchObject({ code: "invalid_data" });
  });

  it("refuses to render a template that fails the check", async () => {
    await expect(engine.renderSample(contract, "{{ nope }}", { locale: "es-PE" })).rejects.toMatchObject({
      code: "invalid_template",
    });
  });

  it("fails loudly on an optional value that is absent, instead of a silent blank", async () => {
    const error = await engine
      .renderSample(contract, "Tel: {{ teacher.phone }}", { locale: "es-PE" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TemplateRenderError);
    expect(error).toMatchObject({ code: "missing_value" });
  });

  it("fails on a nullable value left empty too — null is not a value to print", async () => {
    await expect(
      engine.renderSample(contract, "Región: {{ teacher.region }}", { locale: "es-PE" }),
    ).rejects.toMatchObject({ code: "missing_value" });
    expect(
      await engine.renderSample(contract, '{{ teacher.region | default: "—" }}', { locale: "es-PE" }),
    ).toBe("—");
  });

  it("lets the template guard an optional value itself", async () => {
    const out = await engine.renderSample(
      contract,
      "{% if teacher.phone %}Tel: {{ teacher.phone }}{% else %}sin teléfono{% endif %}",
      { locale: "es-PE" },
    );
    expect(out).toBe("sin teléfono");
  });

  it("lets `default` stand in for an absent optional value", async () => {
    expect(
      await engine.renderSample(contract, '{{ teacher.phone | default: "—" }}', { locale: "es-PE" }),
    ).toBe("—");
  });

  it("stops a render that runs too long", async () => {
    const slow = new TemplateEngine({ renderLimitMs: 20 });
    await expect(
      slow.renderSample(
        contract,
        "{% for a in (1..100000) %}{% for b in (1..1000) %}x{% endfor %}{% endfor %}",
        { locale: "es-PE" },
      ),
    ).rejects.toMatchObject({ code: "limit_exceeded" });
  });
});

describe("placeholdersOf", () => {
  it("lists what an editor can insert, with descriptions and list items", () => {
    const list = placeholdersOf(contract);
    expect(list).toContainEqual({
      path: "teacher.fullName",
      type: "string",
      optional: false,
      description: "Nombre completo del docente",
    });
    expect(list).toContainEqual({ path: "teacher.phone", type: "string", optional: true });
    expect(list).toContainEqual({ path: "groups", type: "list", optional: false });
    expect(list).toContainEqual({ path: "groups[].code", type: "string", optional: false });
    expect(list).toContainEqual({ path: "signedAt", type: "date", optional: false });
  });
});

describe("defineTemplateKind", () => {
  it("refuses a sample that drifted from the schema", () => {
    expect(() =>
      defineTemplateKind({
        key: "broken",
        format: "text",
        variables: z.object({ a: z.string() }),
        sample: { a: 1 } as unknown as { a: string },
      }),
    ).toThrow(/broken/);
  });
});
