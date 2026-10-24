import { classGroups, documentTemplateVersions, teacherContracts, teacherLanguages, teachers } from "@ooc/db";
import type { IPlatformSettingsRepository, TeacherStatus } from "@ooc/domain";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/** One screen of the roster (`teachers-view.tsx` shows exactly this many). */
export const TEACHER_DIRECTORY_PAGE_SIZE = 15;

export interface TeacherContractSummary {
  id: string;
  /** When it was recorded — generated (OOC-124) or filed (OOC-81). */
  recordedAt: Date;
  startsOn: Date;
  endsOn: Date;
  /** The uploaded PDF of a contract filed under OOC-81; null for a generated one. */
  file: { name: string; sizeBytes: number } | null;
  /** The template version a generated contract prints from; null for a filed one. */
  templateVersion: number | null;
}

/** The columns a contract summary is read from, for the roster and the file alike. */
export function contractSummaryColumns() {
  return {
    id: teacherContracts.id,
    recordedAt: teacherContracts.createdAt,
    startsOn: teacherContracts.startsOn,
    endsOn: teacherContracts.endsOn,
    fileName: teacherContracts.fileName,
    fileSizeBytes: teacherContracts.fileSizeBytes,
    templateVersion: documentTemplateVersions.version,
  };
}

export function toContractSummary(row: {
  id: string;
  recordedAt: Date;
  startsOn: Date;
  endsOn: Date;
  fileName: string | null;
  fileSizeBytes: number | null;
  templateVersion: number | null;
}): TeacherContractSummary {
  return {
    id: row.id,
    recordedAt: row.recordedAt,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    file: row.fileName !== null && row.fileSizeBytes !== null ? { name: row.fileName, sizeBytes: row.fileSizeBytes } : null,
    templateVersion: row.templateVersion,
  };
}

export interface TeacherListRow {
  id: string;
  firstName: string;
  lastName: string;
  nationalIdType: string;
  nationalId: string;
  email: string;
  phone: string;
  status: TeacherStatus;
  /** Catalog text, the same as `courses.language`. */
  languages: string[];
  nationality: string;
  country: string;
  region: string | null;
  city: string;
  addressLine: string;
  /** The latest filing; null when none was ever filed. */
  contract: TeacherContractSummary | null;
  /** Whole days to the contract's end, negative once it passed; null without one. */
  contractDaysLeft: number | null;
  /** Class groups enrolling or running with this teacher on them. */
  activeClassGroups: number;
  /** Seats taken across those class groups. */
  studentCount: number;
  joinedAt: Date;
}

/**
 * What the roster was narrowed to (OOC-78). Every filter runs in Postgres —
 * a filter over the loaded page answers the wrong question.
 */
export interface TeacherDirectoryFilters {
  /** On the roster or off it. */
  status?: TeacherStatus;
  /** Partial name, e-mail, phone, document or language. */
  q?: string;
  /** Exact catalog language text. */
  language?: string;
  /** Only teachers running nothing right now. */
  free?: boolean;
  /** Only contracts lapsing, lapsed or never filed. */
  contract?: boolean;
  /** 1-based. */
  page?: number;
}

export interface TeacherDirectoryPage {
  items: TeacherListRow[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * The tabs count over the search and language; the two chips count over
   * those plus the tab — so each says what choosing it would give.
   */
  counts: { active: number; inactive: number; free: number; contract: number };
  /** The alert window the `contract` filter used (OOC-41) — the badge on
   * screen reads this same number, so the two never disagree. */
  contractAlertDays: number;
}

/** `%`, `_` and the escape character itself are literal in what a person types. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * The teacher roster and the figures every teacher row carries (OOC-78).
 * Read-only shaping, so it lives beside the repository and not in the domain.
 */
export class ListTeachersQuery {
  constructor(
    private readonly db: Db,
    private readonly settings: IPlatformSettingsRepository,
  ) {}

  /** The latest contract per teacher — "contrato vigente" is the most recent (0025). */
  private latestContract() {
    return this.db
      .selectDistinctOn([teacherContracts.teacherId], {
        teacherId: teacherContracts.teacherId,
        ...contractSummaryColumns(),
      })
      .from(teacherContracts)
      .leftJoin(documentTemplateVersions, eq(documentTemplateVersions.id, teacherContracts.templateVersionId))
      .orderBy(teacherContracts.teacherId, desc(teacherContracts.createdAt), desc(teacherContracts.id))
      .as("contract");
  }

  private select(contract: ReturnType<ListTeachersQuery["latestContract"]>) {
    const running = sql`${classGroups.teacherId} = ${teachers.id}
      and ${classGroups.status} in ('enrolling', 'in_progress')
      and ${classGroups.deletedAt} is null`;

    return this.db
      .select({
        teacher: teachers,
        languages: sql<string[]>`coalesce((
          select array_agg(${teacherLanguages.language} order by ${teacherLanguages.language})
          from ${teacherLanguages} where ${teacherLanguages.teacherId} = ${teachers.id}
        ), '{}')`,
        activeClassGroups: sql<number>`(select count(*) from ${classGroups} where ${running})`.mapWith(Number),
        studentCount: sql<number>`(select coalesce(sum(${classGroups.seatsTaken}), 0) from ${classGroups} where ${running})`.mapWith(
          Number,
        ),
        contractId: contract.id,
        contractRecordedAt: contract.recordedAt,
        contractStartsOn: contract.startsOn,
        contractEndsOn: contract.endsOn,
        contractFileName: contract.fileName,
        contractFileSizeBytes: contract.fileSizeBytes,
        contractTemplateVersion: contract.templateVersion,
        contractDaysLeft: this.daysLeft(contract),
      })
      .from(teachers)
      .leftJoin(contract, eq(contract.teacherId, teachers.id));
  }

  /**
   * Calendar days in UTC — the same arithmetic as `daysUntil` in the app, so
   * the badge and the filter never disagree on a boundary day.
   */
  private daysLeft(contract: ReturnType<ListTeachersQuery["latestContract"]>) {
    return sql<number | null>`((${contract.endsOn} at time zone 'UTC')::date - (now() at time zone 'UTC')::date)`.mapWith(
      (value: unknown) => (value === null ? null : Number(value)),
    );
  }

  async directory(filters: TeacherDirectoryFilters = {}): Promise<TeacherDirectoryPage> {
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const status = filters.status ?? "active";
    const contract = this.latestContract();

    const running = sql`exists (
      select 1 from ${classGroups}
      where ${classGroups.teacherId} = ${teachers.id}
        and ${classGroups.status} in ('enrolling', 'in_progress')
        and ${classGroups.deletedAt} is null
    )`;
    // When a contract starts being this quarter's errand — the backoffice's
    // number (OOC-41), the same one the badge on screen reads.
    const { contractAlertDays } = await this.settings.get();
    const needsContract = sql`(${contract.endsOn} is null or ${this.daysLeft(contract)} <= ${contractAlertDays})`;

    const base: SQL[] = [isNull(teachers.deletedAt)];
    const q = filters.q?.trim();
    if (q) {
      const needle = `%${escapeLike(q)}%`;
      base.push(
        or(
          ilike(sql`${teachers.firstName} || ' ' || ${teachers.lastName}`, needle),
          ilike(teachers.email, needle),
          ilike(teachers.phone, needle),
          ilike(teachers.nationalId, needle),
          sql`exists (
            select 1 from ${teacherLanguages}
            where ${teacherLanguages.teacherId} = ${teachers.id} and ${teacherLanguages.language} ilike ${needle}
          )`,
        )!,
      );
    }
    if (filters.language) {
      base.push(sql`exists (
        select 1 from ${teacherLanguages}
        where ${teacherLanguages.teacherId} = ${teachers.id} and ${teacherLanguages.language} = ${filters.language}
      )`);
    }

    const inTab: SQL[] = [...base, eq(teachers.status, status)];
    // Both chips are questions about somebody still teaching; off the roster
    // they would narrow the list on a fact that is the same for every row.
    const narrowed: SQL[] = [...inTab];
    if (status === "active" && filters.free) narrowed.push(sql`not ${running}`);
    if (status === "active" && filters.contract) narrowed.push(needsContract);

    const rowsPromise = this.select(contract)
      .where(and(...narrowed))
      .orderBy(asc(teachers.lastName), asc(teachers.firstName), asc(teachers.id))
      .limit(TEACHER_DIRECTORY_PAGE_SIZE)
      .offset((page - 1) * TEACHER_DIRECTORY_PAGE_SIZE);

    const totalPromise = this.db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(teachers)
      .leftJoin(contract, eq(contract.teacherId, teachers.id))
      .where(and(...narrowed));

    const countsPromise = this.db
      .select({
        active: sql<number>`count(*) filter (where ${teachers.status} = 'active')`.mapWith(Number),
        inactive: sql<number>`count(*) filter (where ${teachers.status} = 'inactive')`.mapWith(Number),
        free: sql<number>`count(*) filter (where ${teachers.status} = ${status} and not ${running})`.mapWith(Number),
        contract: sql<number>`count(*) filter (where ${teachers.status} = ${status} and ${needsContract})`.mapWith(
          Number,
        ),
      })
      .from(teachers)
      .leftJoin(contract, eq(contract.teacherId, teachers.id))
      .where(and(...base));

    const [rows, [totalRow], [countsRow]] = await Promise.all([rowsPromise, totalPromise, countsPromise]);

    return {
      items: rows.map(toListRow),
      total: totalRow?.total ?? 0,
      page,
      pageSize: TEACHER_DIRECTORY_PAGE_SIZE,
      counts: countsRow ?? { active: 0, inactive: 0, free: 0, contract: 0 },
      contractAlertDays,
    };
  }

  /** One live teacher with the same figures as their roster row. */
  async byId(id: string): Promise<TeacherListRow | null> {
    const [row] = await this.select(this.latestContract())
      .where(and(eq(teachers.id, id), isNull(teachers.deletedAt)))
      .limit(1);

    return row ? toListRow(row) : null;
  }
}

type SelectedRow = Awaited<ReturnType<ReturnType<ListTeachersQuery["select"]>["execute"]>>[number];

function toListRow(row: SelectedRow): TeacherListRow {
  const { teacher } = row;
  const contract: TeacherContractSummary | null =
    row.contractId !== null &&
    row.contractRecordedAt !== null &&
    row.contractStartsOn !== null &&
    row.contractEndsOn !== null
      ? toContractSummary({
          id: row.contractId,
          recordedAt: row.contractRecordedAt,
          startsOn: row.contractStartsOn,
          endsOn: row.contractEndsOn,
          fileName: row.contractFileName,
          fileSizeBytes: row.contractFileSizeBytes,
          templateVersion: row.contractTemplateVersion,
        })
      : null;

  return {
    id: teacher.id,
    firstName: teacher.firstName,
    lastName: teacher.lastName,
    nationalIdType: teacher.nationalIdType,
    nationalId: teacher.nationalId,
    email: teacher.email,
    phone: teacher.phone,
    status: teacher.status as TeacherStatus,
    languages: row.languages,
    nationality: teacher.nationality,
    country: teacher.country,
    region: teacher.region,
    city: teacher.city,
    addressLine: teacher.addressLine,
    contract,
    contractDaysLeft: contract ? row.contractDaysLeft : null,
    activeClassGroups: row.activeClassGroups,
    studentCount: row.studentCount,
    joinedAt: teacher.createdAt,
  };
}
