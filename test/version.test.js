import { expect, test } from "bun:test";
import pkg from "../package.json";
import { VERSION } from "../src/version.js";

test("src/version.js matches package.json", () => {
  expect(VERSION).toBe(pkg.version);
});

test("the package declares no runtime dependencies", () => {
  expect(/** @type {any} */ (pkg).dependencies).toBeUndefined();
  expect(/** @type {any} */ (pkg).peerDependencies).toBeUndefined();
});
