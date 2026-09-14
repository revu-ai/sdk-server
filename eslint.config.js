/**
 * @file ESLint flat config for the REVU Server SDK.
 *
 * Vanilla JS (ESM) that must run unchanged on Node 20+, Bun, Deno and edge
 * runtimes, so the source may only touch platform globals that exist on all of
 * them (fetch, AbortController, URL, timers, crypto). Runtime-specific globals
 * (`process`, `Deno`, `Bun`) are reached through `globalThis` with a typeof
 * guard, never as bare identifiers, which the `src` globals list enforces.
 * We deliberately do not depend on `@eslint/js` to keep dev tooling minimal.
 */

const rules = {
  "no-undef": "error",
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-var": "error",
  "prefer-const": "warn",
  eqeqeq: ["error", "smart"],
  "no-implicit-globals": "error",
  "no-throw-literal": "error",
};

/** Globals available on every supported runtime. */
const portableGlobals = {
  globalThis: "readonly",
  fetch: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  queueMicrotask: "readonly",
  crypto: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  AbortController: "readonly",
  TextEncoder: "readonly",
  Promise: "readonly",
};

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: portableGlobals },
    rules,
  },
  {
    files: ["test/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...portableGlobals, Bun: "readonly", process: "readonly" },
    },
    rules,
  },
];
