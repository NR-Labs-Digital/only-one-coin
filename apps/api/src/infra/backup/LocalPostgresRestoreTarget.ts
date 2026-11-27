import pg from "pg";
import type { IRestoreTarget } from "@ooc/domain";

const SAFE_NAME = /^ooc_restore_[a-z0-9]+$/;

/**
 * Local only (the config refuses it in production): restores into a new
 * database on the Postgres of `compose.yml`, through a role that may CREATE
 * and DROP DATABASE. Only names the restore row chose (`ooc_restore_*`).
 */
export class LocalPostgresRestoreTarget implements IRestoreTarget {
  constructor(private readonly adminUrl: string) {}

  async create(databaseName: string): Promise<{ connectionUri: string }> {
    await this.admin(`create database ${assertSafe(databaseName)}`);
    return { connectionUri: await this.connectionUri(databaseName) };
  }

  connectionUri(databaseName: string): Promise<string> {
    const url = new URL(this.adminUrl);
    url.pathname = `/${assertSafe(databaseName)}`;
    return Promise.resolve(url.toString());
  }

  async drop(databaseName: string): Promise<void> {
    await this.admin(`drop database if exists ${assertSafe(databaseName)} with (force)`);
  }

  private async admin(statement: string): Promise<void> {
    const client = new pg.Client({ connectionString: this.adminUrl });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  }
}

function assertSafe(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error("Refused: not a restore database name");
  return name;
}
