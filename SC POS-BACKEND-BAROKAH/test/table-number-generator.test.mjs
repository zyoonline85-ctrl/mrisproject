import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { alphabeticPrefix, generateTableNumbers } = require("../src/modules/master-data/table-number-generator.js");

describe("table number generator", () => {
  it("melanjutkan pola A setelah nomor terbesar tanpa mengisi celah", () => {
    expect(generateTableNumbers({ existingNumbers: ["A1", "A3", "A5"], quantity: 3 })).toMatchObject({
      prefix: "A",
      first_number: "A6",
      last_number: "A8",
      numbers: ["A6", "A7", "A8"]
    });
  });

  it("melanjutkan pola B untuk outlet yang sudah memakai prefix B", () => {
    expect(generateTableNumbers({ existingNumbers: ["B1", "B2", "B3", "B4", "B5"], quantity: 2 }).numbers)
      .toEqual(["B6", "B7"]);
  });

  it("memakai prefix fallback untuk outlet yang belum memiliki meja", () => {
    expect(alphabeticPrefix(2)).toBe("C");
    expect(generateTableNumbers({ existingNumbers: [], fallbackPrefix: alphabeticPrefix(2), quantity: 3 }).numbers)
      .toEqual(["C1", "C2", "C3"]);
  });

  it("melanjutkan nomor meja numerik murni", () => {
    expect(generateTableNumbers({ existingNumbers: ["1", "2", "5"], quantity: 2 }).numbers).toEqual(["6", "7"]);
  });

  it("memilih prefix yang paling dominan", () => {
    expect(generateTableNumbers({ existingNumbers: ["VIP1", "VIP2", "A9"], quantity: 2 }).numbers)
      .toEqual(["VIP3", "VIP4"]);
  });

  it.each([undefined, "", 0, -1, 1.5, 101])("menolak jumlah tidak valid: %s", (quantity) => {
    expect(() => generateTableNumbers({ existingNumbers: [], quantity })).toThrow(/1 sampai 100/);
  });
});
