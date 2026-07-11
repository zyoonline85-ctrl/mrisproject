import { createRequire } from "node:module";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { telegramRequestLogger } = require("../src/middlewares/telegram-request-logger.js");
const { errorHandler } = require("../src/middlewares/error.js");

function testApp(notifier) {
  const app = express();
  app.set("env", "test");
  app.use(telegramRequestLogger({ notifier }));
  app.use(express.json());
  return app;
}

describe("telegram request logger middleware", () => {
  it("logs successful requests without blocking the response", async () => {
    const notifier = vi.fn(async () => {
      throw new Error("telegram down");
    });
    const app = testApp(notifier);

    app.post("/ok/:id", (req, res) => {
      res.status(201).json({ success: true, body: req.body });
    });

    const response = await request(app)
      .post("/ok/123?source=test")
      .set("X-Request-Id", "req-from-client")
      .send({ raw: "body" })
      .expect(201);

    expect(response.headers["x-request-id"]).toBe("req-from-client");
    expect(response.body.success).toBe(true);
    expect(notifier).toHaveBeenCalledTimes(1);

    const log = notifier.mock.calls[0][0];
    expect(log.request_id).toBe("req-from-client");
    expect(log.status_code).toBe(201);
    expect(log.body.raw).toBe("body");
    expect(log.query.source).toBe("test");
    expect(log.params.id).toBe("123");
    expect(log.response.body.success).toBe(true);
    expect(log.response.body.body.raw).toBe("body");
    expect(log.response.body_type).toBe("json");
  });

  it("logs raw errors captured by the error handler", async () => {
    const notifier = vi.fn(async () => null);
    const app = testApp(notifier);

    app.get("/fail", () => {
      const error = new Error("raw failure");
      error.status = 500;
      error.details = { raw: "detail" };
      throw error;
    });
    app.use(errorHandler);

    await request(app).get("/fail").expect(500);

    expect(notifier).toHaveBeenCalledTimes(1);
    const log = notifier.mock.calls[0][0];
    expect(log.status_code).toBe(500);
    expect(log.error.message).toBe("raw failure");
    expect(log.error.details.raw).toBe("detail");
    expect(log.error.stack).toContain("raw failure");
    expect(log.response.body.success).toBe(false);
    expect(log.response.body.message).toBe("raw failure");
  });
});
