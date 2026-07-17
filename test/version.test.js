import { describe, expect, test } from "bun:test";
import { VERSION } from "../src/version.js";
import pkg from "../package.json";

describe("version", () => {
  test("src/version.js matches package.json (bump both together)", () => {
    expect(VERSION).toBe(pkg.version);
  });
  test("semver-ish shape", () => {
    expect(/^\d+\.\d+\.\d+$/.test(VERSION)).toBe(true);
  });
});
