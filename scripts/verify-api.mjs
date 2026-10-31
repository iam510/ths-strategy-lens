import { writeFileSync, mkdirSync } from "node:fs";
const origin = process.argv[2] || "http://127.0.0.1:5186";
const output = process.argv[3] || "artifacts/api-smoke.json";
const strategy = {
  version: 1,
  name: "API verification fixture",
  universe: "000300.SH",
  conditions: [
    { id: "r", metric: "revenue_yoy", op: "gt", value: 5 },
    { id: "p", metric: "pe_static", op: "lte", value: 30 },
    { id: "v", metric: "volatility_60", op: "lte", value: 35 },
  ],
};
const records = [];
async function check(name, path, body, verify) {
  const response = await fetch(new URL(path, origin), {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!verify(response, result))
    throw new Error(`Verification failed: ${name}`);
  records.push({
    name,
    httpStatus: response.status,
    passed: true,
    ...(result.counts ? { counts: result.counts } : {}),
    ...(result.error ? { error: result.error } : {}),
  });
  return result;
}
const config = await check(
  "Configuration is visible without secret values",
  "/api/config",
  null,
  (r, b) =>
    r.ok &&
    typeof b.dataConfigured === "boolean" &&
    !JSON.stringify(b).includes("API_KEY"),
);
await check(
  "Explicit demo returns 2 pass, 4 fail, 2 unknown",
  "/api/screen",
  { strategy, mode: "demo" },
  (r, b) =>
    r.ok &&
    b.snapshot.mode === "demo" &&
    b.counts.pass === 2 &&
    b.counts.fail === 4 &&
    b.counts.unknown === 2,
);
await check(
  "Conflicting conditions fail before data access",
  "/api/screen",
  {
    strategy: {
      ...strategy,
      conditions: [
        { id: "a", metric: "revenue_yoy", op: "gt", value: 20 },
        { id: "b", metric: "revenue_yoy", op: "lt", value: 10 },
      ],
    },
    mode: "live",
  },
  (r, b) => r.status === 422 && b.error.code === "CONFLICT",
);
await check(
  "Guaranteed-return intent is blocked",
  "/api/intent",
  { text: "保证明天涨停" },
  (r, b) => r.status === 422 && b.error.code === "BOUNDARY",
);
if (!config.dataConfigured)
  await check(
    "Missing data credentials never fall back to demo",
    "/api/screen",
    { strategy, mode: "live" },
    (r, b) =>
      r.status === 503 && b.error.code === "DATA_UNCONFIGURED" && !b.snapshot,
  );
if (!config.aiConfigured)
  await check(
    "Missing model configuration is explicit",
    "/api/intent",
    { text: "经营改善" },
    (r, b) => r.status === 503 && b.error.code === "AI_UNCONFIGURED",
  );
const report = {
  time: new Date().toISOString(),
  origin,
  config,
  records,
  limitation:
    "Demo and failure-path checks only. No authenticated financial data or live model generation verified.",
};
mkdirSync(new URL("../", `file://${process.cwd()}/${output}`).pathname, {
  recursive: true,
});
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(`${records.length} API checks passed; report: ${output}`);
