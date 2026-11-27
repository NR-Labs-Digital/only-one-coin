import type { IRestoreTarget } from "@ooc/domain";

const NEON_API = "https://console.neon.tech/api/v2";
const OPERATION_WAIT_MS = 120_000;
const OPERATION_POLL_MS = 2_000;

interface NeonOperation {
  id: string;
  status: string;
}

/**
 * Restores land in a NEW database on a Neon branch kept for them (OOC-153) —
 * never the production branch, whose compute the restore would share, and
 * never an existing database: this only creates by a name the restore row
 * chose, and drops only that name.
 *
 * A Neon branch cannot serve: it is born with its parent's data, and the
 * restorer refuses a database that is not empty (docs/RESTAURAR-BACKUP.md).
 */
export class NeonRestoreTarget implements IRestoreTarget {
  constructor(
    private readonly config: { apiKey: string; projectId: string; branchId: string; role: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async create(databaseName: string): Promise<{ connectionUri: string }> {
    const { projectId, branchId, role } = this.config;
    const created = await this.call<{ operations?: NeonOperation[] }>(
      "POST",
      `/projects/${projectId}/branches/${branchId}/databases`,
      { database: { name: databaseName, owner_name: role } },
    );
    await this.waitFor(created?.operations ?? []);
    return { connectionUri: await this.connectionUri(databaseName) };
  }

  async connectionUri(databaseName: string): Promise<string> {
    const { projectId, branchId, role } = this.config;
    const query = new URLSearchParams({
      branch_id: branchId,
      database_name: databaseName,
      role_name: role,
      // The restore holds one long transaction: no connection pooler between.
      pooled: "false",
    });
    const result = await this.call<{ uri: string }>("GET", `/projects/${projectId}/connection_uri?${query.toString()}`);
    if (!result?.uri) throw new Error("Neon returned no connection URI");
    return result.uri;
  }

  async drop(databaseName: string): Promise<void> {
    const { projectId, branchId } = this.config;
    const dropped = await this.call<{ operations?: NeonOperation[] }>(
      "DELETE",
      `/projects/${projectId}/branches/${branchId}/databases/${encodeURIComponent(databaseName)}`,
      undefined,
      { allowNotFound: true },
    );
    await this.waitFor(dropped?.operations ?? []);
  }

  private async waitFor(operations: NeonOperation[]): Promise<void> {
    const deadline = Date.now() + OPERATION_WAIT_MS;
    for (const operation of operations) {
      let status = operation.status;
      while (status !== "finished" && status !== "skipped") {
        if (status === "failed" || status === "error" || status === "cancelled") {
          throw new Error(`Neon operation ${operation.id} ended ${status}`);
        }
        if (Date.now() > deadline) throw new Error(`Neon operation ${operation.id} still ${status}`);
        await new Promise((resolve) => setTimeout(resolve, OPERATION_POLL_MS));
        const read = await this.call<{ operation: NeonOperation }>(
          "GET",
          `/projects/${this.config.projectId}/operations/${operation.id}`,
        );
        status = read?.operation.status ?? "error";
      }
    }
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { allowNotFound?: boolean } = {},
  ): Promise<T | null> {
    const response = await this.fetchImpl(`${NEON_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (options.allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      // Status only: Neon's error body can repeat the request.
      throw new Error(`Neon API ${method} ${path.split("?")[0]} answered ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
