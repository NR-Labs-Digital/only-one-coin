import { describe, expect, it } from "vitest";
import {
  ReceiptExtractionError,
  RereadReceiptUseCase,
  type IPlatformSettingsRepository,
  type IReceiptExtractor,
  type IReceiptImageReader,
  type IReceiptRereadRepository,
  type PlatformSettings,
  type ReceiptExtraction,
  type ReceiptImage,
  type ReceiptRereadSubject,
} from "@ooc/domain";

/**
 * Re-reading a receipt (ROADMAP Sessão 32) at the domain level: fakes, no
 * Postgres, no model. The SQL half is
 * DrizzleReceiptRereadRepository.integration.test.ts.
 */

const SUBJECT: ReceiptRereadSubject = {
  rereadId: "018f2b5c-6300-7000-8000-000000000001",
  receiptUploadId: "018f2b5c-6300-7000-8000-000000000002",
  paymentId: "018f2b5c-6300-7000-8000-000000000003",
  tier: 1,
  processedObjectKey: "receipts/processed/hold/upload.jpg",
  expectedCents: 15000,
  declaredOperationNumber: "08312457",
  declaredMethod: "yape",
};

const READING: ReceiptExtraction = {
  modelName: "gemini-3.1-flash-lite",
  modelVersion: "gemini-3.1-flash-lite-001",
  fields: [
    { field: "amount_cents", value: 15000, confidence: 0.97 },
    { field: "operation_number", value: "0831-2457", confidence: 0.92 },
    { field: "payment_method", value: "yape", detail: null, confidence: 0.99 },
  ],
};

const SETTINGS: PlatformSettings = { checkoutHoldMinutes: 15, receiptAmountToleranceCents: 0, receiptRejectBelowPercent: 50 };

class FakeRereads implements IReceiptRereadRepository {
  recorded: Parameters<IReceiptRereadRepository["record"]>[0][] = [];
  constructor(private readonly subject: ReceiptRereadSubject | null) {}
  request(): Promise<{ rereadId: string; receiptUploadId: string }> {
    throw new Error("not used here");
  }
  findPending(): Promise<ReceiptRereadSubject | null> {
    return Promise.resolve(this.subject);
  }
  record(params: Parameters<IReceiptRereadRepository["record"]>[0]): Promise<boolean> {
    this.recorded.push(params);
    return Promise.resolve(true);
  }
}

class FakeImages implements IReceiptImageReader {
  readKeys: string[] = [];
  read(objectKey: string): Promise<Uint8Array> {
    this.readKeys.push(objectKey);
    return Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff]));
  }
}

class FakeExtractor implements IReceiptExtractor {
  readonly modelName = "gemini-3.1-flash-lite";
  constructor(private readonly outcome: ReceiptExtraction | Error) {}
  extract(_image: ReceiptImage): Promise<ReceiptExtraction> {
    return this.outcome instanceof Error ? Promise.reject(this.outcome) : Promise.resolve(this.outcome);
  }
}

class FakeSettings implements IPlatformSettingsRepository {
  constructor(private readonly current: PlatformSettings) {}
  get(): Promise<PlatformSettings> {
    return Promise.resolve(this.current);
  }
  setCheckoutHoldMinutes(): Promise<void> {
    return Promise.resolve();
  }
  setReceiptAmountToleranceCents(): Promise<void> {
    return Promise.resolve();
  }
  setReceiptRejectBelowPercent(): Promise<void> {
    return Promise.resolve();
  }
}

function useCase(rereads: FakeRereads, extractor: IReceiptExtractor, settings: PlatformSettings = SETTINGS) {
  return new RereadReceiptUseCase(rereads, new FakeImages(), extractor, new FakeSettings(settings));
}

describe("RereadReceiptUseCase", () => {
  it("reads the processed image again and judges the new reading with the traffic light's rule", async () => {
    const rereads = new FakeRereads(SUBJECT);
    const result = await useCase(rereads, new FakeExtractor(READING)).run({ rereadId: SUBJECT.rereadId });

    expect(result.outcome).toEqual({ verdict: "approve", reason: "exact" });
    expect(rereads.recorded).toHaveLength(1);
    expect(rereads.recorded[0]).toMatchObject({
      result: { kind: "read", extraction: READING },
      outcome: { verdict: "approve", reason: "exact" },
      detail: { reason: "exact", expectedCents: 15000, readCents: 15000, toleranceCents: 0, rejectBelowPercent: 50 },
    });
  });

  it("judges under today's settings", async () => {
    const rereads = new FakeRereads(SUBJECT);
    const over = { ...READING, fields: [{ field: "amount_cents" as const, value: 15100, confidence: 0.9 }, ...READING.fields.slice(1)] };

    const strict = await useCase(rereads, new FakeExtractor(over)).run({ rereadId: SUBJECT.rereadId });
    const lenient = await useCase(rereads, new FakeExtractor(over), { ...SETTINGS, receiptAmountToleranceCents: 100 }).run({
      rereadId: SUBJECT.rereadId,
    });

    expect(strict.outcome).toEqual({ verdict: "review", reason: "overpaid" });
    expect(lenient.outcome).toEqual({ verdict: "approve", reason: "within_tolerance" });
  });

  it("does nothing for a request already answered", async () => {
    const rereads = new FakeRereads(null);
    const result = await useCase(rereads, new FakeExtractor(READING)).run({ rereadId: SUBJECT.rereadId });

    expect(result).toEqual({ extraction: null, outcome: null });
    expect(rereads.recorded).toHaveLength(0);
  });

  it("lets a failing call throw, so the worker retries it", async () => {
    const rereads = new FakeRereads(SUBJECT);
    await expect(
      useCase(rereads, new FakeExtractor(new ReceiptExtractionError("provider_unavailable", 429))).run({ rereadId: SUBJECT.rereadId }),
    ).rejects.toBeInstanceOf(ReceiptExtractionError);
    expect(rereads.recorded).toHaveLength(0);
  });

  it("records the failure as the answer once the attempts ran out, judged as unread", async () => {
    const rereads = new FakeRereads(SUBJECT);
    const reason = await useCase(rereads, new FakeExtractor(READING)).recordFailure({
      rereadId: SUBJECT.rereadId,
      error: new ReceiptExtractionError("invalid_response"),
    });

    expect(reason).toBe("invalid_response");
    expect(rereads.recorded[0]).toMatchObject({
      result: { kind: "failed", modelName: "gemini-3.1-flash-lite", reason: "invalid_response" },
      outcome: { verdict: "review", reason: "amount_unread" },
    });
  });
});
