import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { buildManifest } from "./manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Content scripts cannot be ES modules, so every entry is built as a standalone IIFE.
const entries = {
  content: "src/content/index.ts",
  background: "src/background/index.ts",
  options: "src/options/index.ts",
  popup: "src/popup/index.ts",
};

async function buildTarget(target) {
  const outDir = resolve(root, "dist", target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const [name, entry] of Object.entries(entries)) {
    await build({
      root,
      configFile: false,
      logLevel: "warn",
      build: {
        outDir,
        emptyOutDir: false,
        target: "es2022",
        minify: false,
        lib: {
          entry: resolve(root, entry),
          formats: ["iife"],
          name: `colorVmui_${name}`,
          fileName: () => `${name}.js`,
        },
      },
    });
  }

  await cp(resolve(root, "public"), outDir, { recursive: true });
  await writeFile(
    resolve(outDir, "manifest.json"),
    `${JSON.stringify(buildManifest(target), null, 2)}\n`,
  );
  console.log(`built ${outDir}`);
}

for (const target of ["chrome", "firefox"]) {
  await buildTarget(target);
}
