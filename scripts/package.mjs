// Zip the already-built dist/chrome/ and dist/firefox/ into release/ with versioned
// names, ready for upload to the Chrome Web Store and AMO. Run after `yarn build`
// (see the `package` script).

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { root, version } from "./version.mjs";

const releaseDir = join(root, "release");
mkdirSync(releaseDir, { recursive: true });

for (const target of ["chrome", "firefox"]) {
  const name = `colorway-${target}-${version}.zip`;
  const zipPath = join(releaseDir, name);
  rmSync(zipPath, { force: true });
  // Zip the folder contents, so manifest.json sits at the archive root.
  execFileSync("zip", ["-qr", zipPath, "."], { cwd: join(root, "dist", target), stdio: "inherit" });
  console.log(`packaged release/${name}`);
}
