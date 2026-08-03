// Build a clean source archive for AMO reviewers: everything needed to reproduce the
// build (src, public, scripts, configs, package.json, yarn.lock, .yarnrc.yml) — but no
// node_modules and no builds.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { root, version } from "./version.mjs";

mkdirSync(join(root, "release"), { recursive: true });

const zipPath = join("release", `colorway-source-${version}.zip`);
rmSync(join(root, zipPath), { force: true });

const excludes = [
  "node_modules/*",
  "dist/*",
  "release/*",
  ".yarn/*",
  ".git/*",
  ".superpowers/*",
  "*.zip",
  "**/.DS_Store",
];

execFileSync("zip", ["-rq", zipPath, ".", "-x", ...excludes], { cwd: root, stdio: "inherit" });
console.log(`packaged ${zipPath}`);
