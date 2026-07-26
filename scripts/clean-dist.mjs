import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distPath = resolve(repositoryRoot, "dist");

if (dirname(distPath) !== repositoryRoot || basename(distPath) !== "dist") {
  throw new Error(`Refusing to clean unexpected path: ${distPath}`);
}

await rm(distPath, { recursive: true, force: true });
