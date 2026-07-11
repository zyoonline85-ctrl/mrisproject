import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeActivityPayload, sanitizeMetadata } = require("../src/modules/activity-logs/activity-log");
const { markActivityWritten, runActivityRequest, wasActivityWritten } = require("../src/modules/activity-logs/activity-request-context");

let api;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SEED_MODE = "demo";
  const module = await import("../src/services/admin-mock-api.js");
  api = module.default;
});

describe("activity log audit contract", () => {
  it("membersihkan metadata sensitif dan mempertahankan konteks aman", () => {
    expect(sanitizeMetadata({
      total: 51000,
      password: "rahasia",
      nested: { pin: "123456", item_count: 2 },
      authorization: "Bearer token"
    })).toEqual({ total: 51000, nested: { item_count: 2 } });
  });

  it("menormalisasi event lokal dengan waktu kejadian dan hasil", () => {
    const occurredAt = "2026-06-23T10:00:00.000Z";
    const event = normalizeActivityPayload({
      id: "activity_local_123",
      eventType: "interaction",
      outcome: "cancelled",
      occurredAt,
      module: "printing",
      action: "print_bill"
    });

    expect(event.client_event_id).toBe("activity_local_123");
    expect(event.event_type).toBe("interaction");
    expect(event.outcome).toBe("cancelled");
    expect(event.occurred_at.toISOString()).toBe(occurredAt);
  });

  it("menganggap retry client event yang sama sebagai idempotent pada mock", async () => {
    const clientEventId = `audit_test_${Date.now()}`;
    const payload = {
      clientEventId,
      eventType: "interaction",
      outcome: "succeeded",
      module: "navigation",
      action: "page_open",
      description: "Membuka halaman pengujian"
    };

    await api.createActivityLogs([payload]);
    await api.createActivityLogs([payload]);

    const matches = api.getStaticData().activity_logs.filter(
      (row) => row.client_event_id === clientEventId
    );
    expect(matches).toHaveLength(1);
  });

  it("menandai request yang sudah mempunyai audit agar fallback tidak menggandakan log", async () => {
    await runActivityRequest(async () => {
      expect(wasActivityWritten()).toBe(false);
      markActivityWritten();
      await Promise.resolve();
      expect(wasActivityWritten()).toBe(true);
    });
  });
});
