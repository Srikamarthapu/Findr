#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const hosting = path.join(root, ".openai", "hosting.json");

for (const file of [index, worker, hosting]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

await build({
  configFile: false,
  root,
  publicDir: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    target: "es2022",
    outDir: path.join(dist, "server"),
    emptyOutDir: true,
    minify: "esbuild",
    sourcemap: false,
    lib: {
      entry: worker,
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

const builtWorker = path.join(dist, "server", "index.js");
if (!existsSync(builtWorker)) {
  throw new Error("Sites worker bundle was not emitted: " + builtWorker);
}

mkdirSync(path.join(dist, ".openai"), { recursive: true });
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

console.log(
  "Prepared Sites build: bundled dist/server/index.js and dist/.openai/hosting.json",
);
