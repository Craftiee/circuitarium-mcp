import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CRUMB_FIXTURE_KINDS,
  generateFixture,
} from "../src/adapters/crumb/fixtures.js";
import { validateCru } from "../src/adapters/crumb/format.js";

async function main(): Promise<void> {
  const fixtureDirectory = resolve(
    fileURLToPath(new URL("../fixtures/crumb", import.meta.url)),
  );
  const expectedFiles = CRUMB_FIXTURE_KINDS.map((kind) => `${kind}.cru`).sort();
  const actualFiles = (await readdir(fixtureDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".cru"))
    .map((entry) => entry.name)
    .sort();

  if (actualFiles.join("\n") !== expectedFiles.join("\n")) {
    throw new Error(
      [
        "The checked-in CRUMB fixture inventory does not match the generator.",
        `Expected: ${expectedFiles.join(", ")}`,
        `Actual: ${actualFiles.join(", ")}`,
        "Run `npm run fixtures` only if the fixture change is intentional.",
      ].join("\n"),
    );
  }

  for (const kind of CRUMB_FIXTURE_KINDS) {
    const fixturePath = resolve(fixtureDirectory, `${kind}.cru`);
    const checkedInXml = await readFile(fixturePath, "utf8");
    const generatedXml = generateFixture(kind);

    if (checkedInXml !== generatedXml) {
      throw new Error(
        `${kind}.cru differs from its deterministic generator output. ` +
          "Run `npm run fixtures` only if the fixture change is intentional.",
      );
    }

    const validation = validateCru(checkedInXml);
    if (!validation.valid) {
      throw new Error(
        `${kind}.cru failed validation:\n${JSON.stringify(validation.diagnostics, null, 2)}`,
      );
    }
  }

  process.stdout.write(
    `Verified ${CRUMB_FIXTURE_KINDS.length} deterministic CRUMB fixtures.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
