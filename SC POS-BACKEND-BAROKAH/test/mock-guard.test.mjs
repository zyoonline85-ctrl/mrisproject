import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const nodeEval = (script, env = {}) =>
  execFileSync(process.execPath, ["-e", script], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...env },
    encoding: "utf8"
  }).trim();

describe("mock data guard", () => {
  it("does not load demo JSON when DATA_MODE=mysql imports services", () => {
    const output = nodeEval(
      "require('./src/services/admin-mock-api'); require('./src/services/data-service'); console.log('ok')",
      { DATA_MODE: "mysql", SEED_MODE: "clean" }
    );

    expect(output).toBe("ok");
  });

  it("throws a clear error when mock data is accessed in DATA_MODE=mysql", () => {
    const output = nodeEval(
      "const api = require('./src/services/admin-mock-api'); try { api.getStaticData(); } catch (error) { console.log(`${error.code}:${error.message}`); }",
      { DATA_MODE: "mysql", SEED_MODE: "clean" }
    );

    expect(output).toContain("MOCK_DATA_DISABLED:Mock data access is disabled in DATA_MODE=mysql");
  });

  it("ignores ALLOW_DEMO_JSON when DATA_MODE=mysql", () => {
    const output = nodeEval(
      "const api = require('./src/services/admin-mock-api'); try { api.getStaticData(); } catch (error) { console.log(error.code + ':' + error.message); }",
      { DATA_MODE: "mysql", SEED_MODE: "clean", ALLOW_DEMO_JSON: "true" }
    );

    expect(output).toContain("MOCK_DATA_DISABLED:Mock data access is disabled in DATA_MODE=mysql");
  });
});
