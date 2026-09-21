// The people the seed invents — pure, so it can be reasoned about and tested
// without a database in sight. The script that writes them lives next door.

export const DEFAULT_COUNT = 300;
export const BATCH_SIZE = 100;

/** Under this age a guardian is mandatory (Student.MAJORITY_AGE). */
const MAJORITY_AGE = 18;

/** Roughly this share of the directory is under age — enough to make the
 * "only minors" filter show something, and to exercise the guardian join. */
const MINOR_SHARE = 0.25;

const FIRST_NAMES = [
  "Rosa", "Luis", "María", "Carlos", "Ana", "José", "Carmen", "Jorge", "Lucía", "Miguel",
  "Sofía", "Diego", "Valeria", "Andrés", "Camila", "Fernando", "Daniela", "Ricardo", "Paola", "Álvaro",
  "Milagros", "Sebastián", "Gabriela", "Renzo", "Fiorella", "Marco", "Alejandra", "Iván", "Claudia", "Bruno",
  "Yesenia", "Mateo", "Pilar", "Hugo", "Elena", "Raúl", "Nayeli", "Óscar", "Ximena", "Julio",
];

const LAST_NAMES = [
  "Quispe", "Mamani", "Huamán", "Flores", "Rojas", "Vargas", "Castillo", "Chávez", "Ramos", "Ríos",
  "Torres", "Espinoza", "Cárdenas", "Salazar", "Paredes", "Ccahuana", "Condori", "Apaza", "Ticona", "Sánchez",
  "Gutiérrez", "Reátegui", "Zegarra", "Bustamante", "Ñahui", "Palomino", "Guevara", "Cabrera", "Silva", "Ordóñez",
];

/** Departamento + a city inside it — the pair the ficha actually shows. */
const PLACES: Array<{ region: string; cities: string[] }> = [
  { region: "Lima", cities: ["Lima", "Chorrillos", "Comas", "Villa El Salvador", "San Juan de Lurigancho"] },
  { region: "Arequipa", cities: ["Arequipa", "Camaná", "Mollendo"] },
  { region: "Cusco", cities: ["Cusco", "Sicuani", "Quillabamba"] },
  { region: "La Libertad", cities: ["Trujillo", "Chepén"] },
  { region: "Piura", cities: ["Piura", "Sullana", "Talara"] },
  { region: "Puno", cities: ["Puno", "Juliaca"] },
  { region: "Loreto", cities: ["Iquitos", "Yurimaguas"] },
  { region: "Junín", cities: ["Huancayo", "Tarma"] },
];

const GUARDIAN_RELATIONSHIPS = ["mother", "father", "legal_guardian"] as const;

/**
 * Deterministic PRNG (mulberry32). `Math.random` would make every run a
 * different 300 people, so a rerun would pile a second directory on top of the
 * first instead of finding the same documents already there.
 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeededPerson {
  firstName: string;
  lastName: string;
  nationalId: string;
  email: string;
  phone: string;
  birthDate: Date;
  region: string;
  city: string;
  createdAt: Date;
  guardian: {
    firstName: string;
    lastName: string;
    relationship: (typeof GUARDIAN_RELATIONSHIPS)[number];
    nationalId: string;
    email: string;
    phone: string;
  } | null;
}

/** Strips accents so a generated e-mail is a plausible address. */
function slug(value: string): string {
  return value
    .normalize("NFD")
    // The combining marks NFD just split off — written as escapes so the
    // range survives a copy/paste through an editor that normalises source.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function buildPeople(count: number, now: Date): SeededPerson[] {
  const random = makeRandom(20260921);
  const people: SeededPerson[] = [];

  for (let index = 0; index < count; index += 1) {
    const firstName = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)]!;
    const lastName = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)]!;
    const place = PLACES[Math.floor(random() * PLACES.length)]!;
    const city = place.cities[Math.floor(random() * place.cities.length)]!;

    // 8 digits, and unique by construction: the index owns its own slice of
    // the range, so two seeded people can never share a document.
    const nationalId = String(70_000_000 + index * 13 + 7);

    const isMinor = random() < MINOR_SHARE;
    // Minors land between 12 and 17, adults between 18 and 45 — the ages a
    // language school actually sees, not a uniform spread over a century.
    const age = isMinor ? 12 + Math.floor(random() * 6) : MAJORITY_AGE + Math.floor(random() * 28);

    /* The date has to make the age come out to exactly `age`, or the seed
       contradicts itself: picking a random month and day put people the
       generator called adults one birthday short of eighteen — a minor with no
       apoderado, which is a row the domain refuses to create
       (GuardianRequiredForMinorError).

       So: walk back `age` years from today, which lands on the birthday, then
       back another few days. Moving the date earlier only means the birthday
       has already passed this year, so the full-years age stays put. */
    const birthday = new Date(
      Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()),
    );
    const birthDate = new Date(birthday.getTime() - Math.floor(random() * 364) * 24 * 60 * 60 * 1000);

    /* Spread over the last four months so the directory's newest-first order
       and its cursor have something to walk. Every tenth row deliberately
       shares the previous row's timestamp to the millisecond: a bulk import
       does collide on DEFAULT NOW(), and `(created_at, id)` is what keeps the
       cursor from skipping or repeating a row there (ListStudentsQuery). */
    const createdAt =
      index % 10 === 0 && people.length > 0
        ? new Date(people[people.length - 1]!.createdAt)
        : new Date(now.getTime() - Math.floor(random() * 120) * 24 * 60 * 60 * 1000 - Math.floor(random() * 86_400_000));

    const handle = `${slug(firstName)}.${slug(lastName)}${index}`;

    people.push({
      firstName,
      lastName,
      nationalId,
      // Gmail on purpose: a student's address has to be a personal Google
      // account, because access to the class arrives through Classroom
      // (CLAUDE.md §1).
      email: `${handle}@gmail.com`,
      phone: `+519${String(10_000_000 + Math.floor(random() * 89_999_999))}`,
      birthDate,
      region: place.region,
      city,
      createdAt,
      guardian: isMinor
        ? {
            firstName: FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)]!,
            // Same surname as the student: the apoderado is usually a parent.
            lastName,
            relationship: GUARDIAN_RELATIONSHIPS[Math.floor(random() * GUARDIAN_RELATIONSHIPS.length)]!,
            nationalId: String(40_000_000 + index * 13 + 7),
            // The guardian's address may be any provider — only the student's
            // has to be Gmail (CLAUDE.md §1).
            email: `apoderado.${handle}@hotmail.com`,
            phone: `+519${String(10_000_000 + Math.floor(random() * 89_999_999))}`,
          }
        : null,
    });
  }

  return people;
}
