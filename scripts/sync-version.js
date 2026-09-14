/**
 * @file Regenerate `src/version.js` from the `version` field in
 * `package.json`. Wired into `prepack` so every published tarball carries the
 * matching version. `src/version.js` is also committed so a fresh clone runs
 * straight from source. `test/version.test.js` fails if the two ever drift.
 */

const pkgUrl = new URL("../package.json", import.meta.url);
const pkg = await Bun.file(pkgUrl).json();

const out = `/**
 * @file SDK version constant.
 *
 * Auto-generated from package.json by scripts/sync-version.js. Do not edit
 * by hand. Bump package.json's "version" field and rerun the script.
 */
export const VERSION = ${JSON.stringify(pkg.version)};
`;

await Bun.write(new URL("../src/version.js", import.meta.url), out);
console.log(`sync-version: src/version.js -> ${pkg.version}`);
