// The single source of truth for the extension version: package.json, overridable by
// COLORWAY_VERSION so a release can stamp the git tag into the build without a commit.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

export const version = process.env.COLORWAY_VERSION || pkg.version;
