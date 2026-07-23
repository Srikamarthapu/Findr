import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const secretNames = [
  "NVIDIA_NIM_API_KEY",
  "ZAI_API_KEY",
  "DEEPSEEK_API_KEY",
];

async function readLocalEnv() {
  try {
    const content = await readFile(
      new URL("../.env.local", import.meta.url),
      "utf8",
    );
    return Object.fromEntries(
      content
        .split(/\r?\n/)
        .filter((line) => line && !line.trimStart().startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return separator < 0
            ? [line.trim(), ""]
            : [line.slice(0, separator).trim(), line.slice(separator + 1)];
        }),
    );
  } catch {
    return {};
  }
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(target) : [target];
    }),
  );
  return nested.flat();
}

const env = await readLocalEnv();
const files = await filesUnder(
  fileURLToPath(new URL("../dist/client/", import.meta.url)),
);
const textFiles = files.filter((file) =>
  /\.(?:html|js|css|json|map|txt|svg)$/i.test(file),
);
const leaks = [];

for (const name of secretNames) {
  const value = env[name];
  if (!value) continue;
  for (const file of textFiles) {
    const content = await readFile(file, "utf8");
    if (content.includes(value)) {
      leaks.push({ name, file });
    }
  }
}

if (leaks.length) {
  for (const leak of leaks) {
    console.error(
      `Server secret ${leak.name} was found in ${path.relative(process.cwd(), leak.file)}.`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("No configured provider credentials were found in dist/client.");
}
