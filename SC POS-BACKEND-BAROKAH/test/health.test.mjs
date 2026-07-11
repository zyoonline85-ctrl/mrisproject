import request from "supertest";
import { describe, expect, it } from "vitest";

process.env.TELEGRAM_LOG_ENABLED = "false";
const { default: app } = await import("../src/app.js");

describe("system endpoints", () => {
  it("GET /api/health returns ok", async () => {
    const response = await request(app).get("/api/health").expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe("ok");
  });

  it("GET /api/docs.json exposes OpenAPI spec", async () => {
    const response = await request(app).get("/api/docs.json").expect(200);

    expect(response.body.openapi).toBe("3.0.0");
    expect(response.body.components.securitySchemes.bearerAuth).toBeTruthy();
  });
});
