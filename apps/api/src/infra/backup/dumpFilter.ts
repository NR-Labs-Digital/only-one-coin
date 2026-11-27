import { StringDecoder } from "node:string_decoder";
import { Transform, type TransformCallback } from "node:stream";

/**
 * The lines of a plain `pg_dump` a scratch database cannot run (OOC-153), the
 * same ones `scripts/restore-backup.sh --skip-acl` drops:
 *
 * - `ALTER ... OWNER TO` — the production owner role does not exist there;
 *   every object belongs to whoever restores.
 * - `GRANT` / `REVOKE` / `ALTER DEFAULT PRIVILEGES` — they name `ooc_app`,
 *   which nobody connects as in a scratch database. The append-only triggers
 *   are not grants, so they still come back (and the checks prove it).
 *
 * Unlike the script's `sed`, rows inside a `COPY ... FROM stdin` block pass
 * untouched: a row's text could start with any of those words.
 */
const DROPPED = [/^ALTER .* OWNER TO /, /^(GRANT|REVOKE) /, /^ALTER DEFAULT PRIVILEGES /];
const COPY_START = /^COPY .* FROM stdin;$/;
const COPY_END = "\\.";

export function createDumpFilter(): Transform {
  // A chunk can end in the middle of a multi-byte character.
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let inCopy = false;

  const filterLine = (line: string): string | null => {
    if (inCopy) {
      if (line === COPY_END) inCopy = false;
      return line;
    }
    if (COPY_START.test(line)) {
      inCopy = true;
      return line;
    }
    return DROPPED.some((pattern) => pattern.test(line)) ? null : line;
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      pending += decoder.write(chunk);
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      const kept = lines.map(filterLine).filter((line): line is string => line !== null);
      callback(null, kept.length ? `${kept.join("\n")}\n` : "");
    },
    flush(callback: TransformCallback) {
      pending += decoder.end();
      const last = pending ? filterLine(pending) : null;
      callback(null, last ?? "");
    },
  });
}
