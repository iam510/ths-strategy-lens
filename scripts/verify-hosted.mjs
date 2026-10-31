import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const deployment = JSON.parse(readFileSync(new URL("../artifacts/deployment.json", import.meta.url), "utf8"));
const origin = new URL(deployment.url);
if (origin.protocol !== "https:" || !origin.hostname.endsWith(".chatgpt.site")) throw new Error("Unexpected Site origin.");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8"); process.stdin.resume();
process.stdout.write("Ready for Site service token on stdin (input hidden).\n");
const token = await new Promise(resolve => { let input = ""; process.stdin.on("data", data => { input += data; if (input.includes("\n") || input.includes("\r")) { process.stdin.pause(); if (process.stdin.isTTY) process.stdin.setRawMode(false); resolve(input.trim()); } }); });
if (typeof token !== "string" || !token) throw new Error("Missing service credential.");
const records = [];
async function call(path, body) {
  return fetch(new URL(path, origin), { method: body ? "POST" : "GET", headers: { "OAI-Sites-Authorization": `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25_000), redirect: "error" });
}
const page = await call("/");
const html = await page.text();
if (!page.ok || !html.includes("Strategy Lens") && !html.includes("\u6790\u9009")) throw new Error(`Hosted page verification failed (HTTP ${page.status}).`);
records.push({ name: "Hosted HTML with platform service authentication", httpStatus: page.status, passed: true });
const configResponse = await call("/api/config"); const config = await configResponse.json();
if (!configResponse.ok || typeof config.dataConfigured !== "boolean") throw new Error("Hosted config endpoint failed.");
records.push({ name: "Hosted config", httpStatus: configResponse.status, dataConfigured: config.dataConfigured, aiConfigured: config.aiConfigured, passed: true });
const strategy = { version: 1, name: "Hosted synthetic verification", universe: "000300.SH", conditions: [{ id: "r", metric: "revenue_yoy", op: "gt", value: 5 }, { id: "p", metric: "pe_static", op: "lte", value: 30 }, { id: "v", metric: "volatility_60", op: "lte", value: 35 }] };
const response = await call("/api/screen", { strategy, mode: "demo" }); const result = await response.json();
if (!response.ok || result.snapshot?.mode !== "demo" || result.counts?.pass !== 2 || result.counts?.fail !== 4 || result.counts?.unknown !== 2) throw new Error("Hosted demo screening failed.");
records.push({ name: "Hosted explicit demo screening", httpStatus: response.status, counts: result.counts, passed: true });
writeFileSync(new URL("../artifacts/hosted-api-smoke.json", import.meta.url), JSON.stringify({ time: new Date().toISOString(), deploymentId: deployment.id, versionId: deployment.version_id, origin: origin.origin, authentication: "Sites platform service credential via stdin; no visitor identity or app consent", records, limitation: "HTTP checks only. Browser visitor gate requires manual ChatGPT login; real financial and model services remain unverified." }, null, 2) + "\n");
console.log(`${records.length} hosted HTTP checks passed. No credential persisted.`);
