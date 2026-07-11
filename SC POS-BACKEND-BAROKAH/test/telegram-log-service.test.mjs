import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  TELEGRAM_MESSAGE_LIMIT,
  createRequestLog,
  formatTelegramMessage,
  sendTelegramLog
} = require("../src/services/telegram-log-service.js");

function fakeResponse(statusCode = 200) {
  return {
    statusCode,
    statusMessage: "Created",
    headersSent: true,
    locals: {
      telegramResponseBodyType: "json",
      telegramResponseBody: { success: true, id: "response-1" }
    },
    getHeaders() {
      return { "content-type": "application/json" };
    }
  };
}

describe("telegram log service", () => {
  it("formats success request logs with raw request metadata", () => {
    const req = {
      requestId: "req-success",
      method: "POST",
      originalUrl: "/api/auth/login",
      url: "/api/auth/login",
      path: "/api/auth/login",
      ip: "127.0.0.1",
      headers: {
        authorization: "Bearer raw-token",
        "user-agent": "vitest",
        origin: "http://localhost:5173"
      },
      query: { debug: "1" },
      params: { id: "param-1" },
      body: { username: "owner", password: "admin123" },
      auth: { id: "user-1", username: "owner", role_id: "role_owner" }
    };

    const log = createRequestLog({
      req,
      res: fakeResponse(201),
      durationMs: 17,
      event: "finish"
    });
    const message = formatTelegramMessage(log);

    expect(log.success).toBe(true);
    expect(log.status_code).toBe(201);
    expect(log.headers.authorization).toBe("Bearer raw-token");
    expect(log.body.password).toBe("admin123");
    expect(log.auth.username).toBe("owner");
    expect(log.response.body.success).toBe(true);
    expect(message).toContain("=== REQUEST ===");
    expect(message).toContain("=== PAYLOAD ===");
    expect(message).toContain("=== RESPONSE ===");
    expect(message).toContain("POST /api/auth/login");
    expect(message).toContain('"password": "admin123"');
    expect(message).toContain('"id": "response-1"');
  });

  it("keeps raw error fields in failed request logs", () => {
    const error = new Error("database exploded");
    error.status = 500;
    error.details = { query: "select raw_secret" };
    error.raw_token = "secret-token";

    const log = createRequestLog({
      req: {
        requestId: "req-error",
        method: "GET",
        originalUrl: "/api/fail",
        url: "/api/fail",
        path: "/api/fail",
        ip: "127.0.0.1",
        headers: {},
        query: {},
        params: {},
        body: undefined,
        auth: null
      },
      res: fakeResponse(500),
      durationMs: 3,
      event: "finish",
      error
    });

    expect(log.success).toBe(false);
    expect(log.error.name).toBe("Error");
    expect(log.error.message).toBe("database exploded");
    expect(log.error.stack).toContain("database exploded");
    expect(log.error.details.query).toBe("select raw_secret");
    expect(log.error.raw_token).toBe("secret-token");
  });

  it("skips Telegram fetch when config is disabled", async () => {
    const fetchMock = vi.fn();

    const result = await sendTelegramLog(
      { request_id: "req-disabled", status_code: 200 },
      { enabled: false, botToken: "", chatId: "", timeoutMs: 2500 },
      fetchMock
    );

    expect(result).toEqual({ skipped: true, reason: "telegram_log_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends long logs as a summary message plus JSON document", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const log = {
      timestamp: "2026-06-18T00:00:00.000Z",
      env: { node_env: "test", data_mode: "mock" },
      request_id: "req-long",
      method: "POST",
      url: "/api/long",
      status_code: 200,
      duration_ms: 1,
      ip: "127.0.0.1",
      origin: "http://localhost:5173",
      auth: null,
      headers: { raw: "h".repeat(TELEGRAM_MESSAGE_LIMIT) },
      params: { raw: "p".repeat(TELEGRAM_MESSAGE_LIMIT) },
      query: { raw: "q".repeat(TELEGRAM_MESSAGE_LIMIT) },
      body: { raw: "b".repeat(TELEGRAM_MESSAGE_LIMIT) },
      response: {
        status_code: 200,
        status_message: "OK",
        headers_sent: true,
        headers: { raw: "rh".repeat(TELEGRAM_MESSAGE_LIMIT) },
        body_type: "json",
        body: { raw: "r".repeat(TELEGRAM_MESSAGE_LIMIT) }
      },
      error: {
        message: "long",
        stack: "s".repeat(TELEGRAM_MESSAGE_LIMIT)
      }
    };

    const result = await sendTelegramLog(
      log,
      { enabled: true, botToken: "bot-token", chatId: "chat-id", timeoutMs: 2500 },
      fetchMock
    );

    expect(result).toEqual({ sent: true, mode: "document" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/sendMessage");
    expect(fetchMock.mock.calls[1][0]).toContain("/sendDocument");
  });
});
