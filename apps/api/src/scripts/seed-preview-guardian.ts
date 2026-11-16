import { sql } from "drizzle-orm";
import { container } from "@/container.js";
import { insertCredentialUser, upsertCredentialPassword } from "@/infra/auth/credentialAccount.js";

// Local preview of the guardian's portal (OOC-147): one guardian account that
// reaches two minor children through `guardian_portal_links`, each with a
// confirmed seat and an approved payment, so the profile switcher has two
// profiles to switch between. The children get no account of their own — the
// preview is the guardian's view. Local databases only, like seed:preview: it
// writes rows directly and the password is well known.
const EMAIL = "preview.guardian@example.com";
const PASSWORD = "preview1234";

const CHILDREN = [
  { firstName: "Valentina", lastName: "Preview Quispe", nationalId: "79000001", birthDate: "2013-03-14", gmail: "valentina.preview.q" },
  { firstName: "Mateo", lastName: "Preview Quispe", nationalId: "79000002", birthDate: "2016-07-02", gmail: "mateo.preview.q" },
] as const;

type Row = Record<string, unknown>;

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await container.db.execute(query)).rows as Row[];
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing to seed a preview guardian on ${host}: local databases only.`);
  }
  const db = container.db;

  const existing = await rows(sql`select "id" from "user" where "email" = ${EMAIL}`);
  const userId =
    (existing[0]?.id as string | undefined) ??
    (await insertCredentialUser(db, { email: EMAIL, name: "Rosa Preview Quispe", role: "student", password: PASSWORD }));
  await db.execute(sql`update "user" set role = 'student', banned = false where id = ${userId}`);
  await upsertCredentialPassword(db, userId, PASSWORD);

  // Two different live class groups on sale, each with the plan price in force
  // and its first module group — the same place a new student lands.
  const offers = await rows(sql`
    select distinct on (cg.id) cg.id as class_group_id, pp.id as plan_price_id, pp.amount_cents,
           (select m.id from class_group_modules m
             where m.class_group_id = cg.id and m.deleted_at is null
             order by m.module nulls last limit 1) as module_id
      from class_groups cg
      join plans p on p.course_id = cg.course_id and p.deleted_at is null
      join plan_prices pp on pp.plan_id = p.id and pp.valid_from <= now()
     where cg.deleted_at is null and cg.status in ('enrolling', 'in_progress')
       and cg.seats_taken + cg.seats_over < cg.capacity
     order by cg.id, pp.valid_from desc
     limit 2`);
  if (offers.length === 0) throw new Error("No class group on sale — run `pnpm --filter @ooc/api seed:catalog` first.");

  for (const [index, child] of CHILDREN.entries()) {
    const offer = offers[index % offers.length]!;
    let studentId = (
      await rows(sql`select id from students where national_id_type = 'DNI' and national_id = ${child.nationalId} and deleted_at is null`)
    )[0]?.id as string | undefined;

    if (!studentId) {
      studentId = (
        await rows(sql`
          insert into students (first_name, last_name, national_id_type, national_id, email, phone, birth_date, country, region, city)
          values (${child.firstName}, ${child.lastName}, 'DNI', ${child.nationalId}, ${`${child.gmail}@gmail.com`},
                  '+51987000000', ${child.birthDate}::date, 'PE', 'Lima', 'Lima')
          returning id`)
      )[0]!.id as string;

      const guardianId = (
        await rows(sql`
          insert into guardians (student_id, first_name, last_name, relationship, national_id_type, national_id, email, phone)
          values (${studentId}, 'Rosa', 'Preview Quispe', 'mother', 'DNI', '41000001', ${EMAIL}, '+51987000001')
          returning id`)
      )[0]!.id as string;
      await db.execute(sql`insert into consents (guardian_id, version, accepted_at, ip) values (${guardianId}, 'preview', now(), '127.0.0.1')`);

      const enrollmentId = (
        await rows(sql`
          insert into enrollments (student_id, class_group_id, plan_price_id, seat_status, origin, class_group_module_id)
          values (${studentId}, ${offer.class_group_id as string}, ${offer.plan_price_id as string}, 'confirmed', 'web', ${offer.module_id as string | null})
          returning id`)
      )[0]!.id as string;
      await db.execute(sql`update class_groups set seats_taken = seats_taken + 1 where id = ${offer.class_group_id as string}`);
      await db.execute(sql`
        insert into payments (enrollment_id, idempotency_key, status, method, amount_cents, operation_number, decided_at, decided_by)
        values (${enrollmentId}, ${`preview-guardian-${child.nationalId}`}, 'approved', 'yape', ${offer.amount_cents as number},
                ${`PRV${child.nationalId}`}, now(), ${userId})`);
    }

    await db.execute(sql`
      insert into guardian_portal_links (user_id, student_id) values (${userId}, ${studentId})
      on conflict (user_id, student_id) do nothing`);
  }

  console.log(JSON.stringify({ email: EMAIL, password: PASSWORD, children: CHILDREN.map((c) => c.firstName) }));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
