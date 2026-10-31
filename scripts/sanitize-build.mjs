import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const secrets = [
  process.env.FUYAO_API_KEY,
  process.env.AI_API_KEY,
  process.env.REVIEW_ACCESS_CODE,
].filter((s) => s && s.length >= 8);
let count = 0;
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.name.startsWith(".dev.vars") || item.name.startsWith(".env")) {
      rmSync(file, { recursive: true });
      continue;
    }
    if (item.isDirectory()) walk(file);
    else if (item.isFile()) {
      const bytes = readFileSync(file);
      if (secrets.some((secret) => bytes.includes(Buffer.from(secret))))
        throw new Error(
          "Build contains a local credential value. Publication stopped; no credential value has been printed.",
        );
      count++;
    }
  }
}
if (!existsSync("dist")) throw new Error("No build output to verify.");
walk("dist");
console.log(
  `Build credential check passed: ${count} files; no local env files retained.`,
);
