import { spawn } from "node:child_process";

/** Turns a full HTML document into PDF bytes. */
export interface IPdfRenderer {
  render(html: string): Promise<Uint8Array>;
}

export class PdfRenderError extends Error {
  constructor(public readonly reason: "timeout" | "failed" | "unavailable") {
    super(`PDF render ${reason}`);
    this.name = "PdfRenderError";
  }
}

/**
 * HTML → PDF with WeasyPrint (OOC-123): a print engine, not a browser — no
 * JavaScript, CSS paged media (running header, page counter) done properly,
 * and ~60 MB per render instead of a Chromium's few hundred. It runs as the
 * `weasyprint` command (installed in the API image, `apps/api/Dockerfile`),
 * HTML on stdin and PDF on stdout; ~0.5 s per render in the image.
 *
 * Bounded so a preview storm cannot eat the 512 MB VM: at most
 * `maxConcurrent` processes at a time (the rest wait their turn), each killed
 * after `timeoutMs`. Nothing the document carries is logged — stderr can echo
 * its text.
 */
export class WeasyPrintRenderer implements IPdfRenderer {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly options: { bin?: string; maxConcurrent?: number; timeoutMs?: number } = {},
  ) {}

  async render(html: string): Promise<Uint8Array> {
    await this.acquire();
    try {
      return await this.run(html);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < (this.options.maxConcurrent ?? 2)) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running -= 1;
  }

  private run(html: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      // `-` `-`: read the document from stdin, write the PDF to stdout. No
      // base URL: the document has nothing to resolve against.
      const child = spawn(this.options.bin ?? "weasyprint", ["--encoding", "utf-8", "-", "-"], {
        stdio: ["pipe", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (error: PdfRenderError | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(new Uint8Array(Buffer.concat(chunks)));
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new PdfRenderError("timeout"));
      }, this.options.timeoutMs ?? 20_000);

      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", (error: NodeJS.ErrnoException) =>
        finish(new PdfRenderError(error.code === "ENOENT" ? "unavailable" : "failed")),
      );
      child.on("close", (code) => finish(code === 0 && chunks.length > 0 ? null : new PdfRenderError("failed")));
      child.stdin.on("error", () => finish(new PdfRenderError("failed")));
      child.stdin.end(html, "utf8");
    });
  }
}
