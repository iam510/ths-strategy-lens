import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

if (!process.argv.includes("--live"))
  throw new Error("Pass --live to invoke the configured hosted services.");
const deployment = JSON.parse(
  readFileSync(
    new URL("../artifacts/deployment.json", import.meta.url),
    "utf8",
  ),
);
const origin = new URL(deployment.url);
assert.equal(origin.protocol, "https:");
assert.equal(
  origin.hostname,
  "strategy-lens-ths-510.green-trout-2026.chatgpt.site",
);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdout.write("Ready for Site service token on stdin (input hidden).\n");
const token = await new Promise((resolve) => {
  let input = "";
  process.stdin.on("data", (data) => {
    input += data;
    if (/[\n\r]/.test(input)) {
      process.stdin.pause();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      resolve(input.trim());
    }
  });
});
assert.ok(typeof token === "string" && token.length > 0);
const raw = [],
  records = [];
async function call(path, payload) {
  const start = Date.now();
  const response = await fetch(new URL(path, origin), {
    method: payload ? "POST" : "GET",
    headers: {
      "OAI-Sites-Authorization": `Bearer ${token}`,
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json();
  const result = {
    path,
    status: response.status,
    elapsedMs: Date.now() - start,
    body,
  };
  raw.push(result);
  mkdirSync(new URL("../artifacts/private/", import.meta.url), {
    recursive: true,
  });
  writeFileSync(
    new URL("../artifacts/private/hosted-live-responses.json", import.meta.url),
    JSON.stringify(raw, null, 2),
  );
  return result;
}
const config = await call("/api/config");
assert.equal(config.status, 200);
assert.equal(config.body.dataConfigured, true);
assert.equal(config.body.aiConfigured, true);
records.push({
  id: "runtime-configuration",
  status: config.status,
  passed: true,
  dataConfigured: true,
  aiConfigured: true,
});
console.log("Hosted configuration: passed.");
const explicit = await call("/api/intent", {
  text: "年报营收同比大于5%、参考静态PE不超过30倍、60个日收益年化波动率不超过35%。",
});
assert.equal(explicit.status, 200, explicit.body.error?.code);
assert.equal(explicit.body.mode, "model");
assert.equal(explicit.body.promptVersion, "intent-v1.2");
assert.deepEqual(
  explicit.body.conditions.map((c) => [c.metric, c.op, c.value]).sort(),
  [
    ["revenue_yoy", "gt", 5],
    ["pe_static", "lte", 30],
    ["volatility_60", "lte", 35],
  ].sort(),
);
assert.equal(explicit.body.questions.length, 0);
assert.equal(explicit.body.unsupported.length, 0);
records.push({
  id: "hosted-real-model-explicit",
  status: explicit.status,
  passed: true,
  elapsedMs: explicit.elapsedMs,
  model: explicit.body.model,
  promptVersion: explicit.body.promptVersion,
});
console.log("Hosted explicit model parsing: passed.");
const ambiguous = await call("/api/intent", {
  text: "经营改善、估值合理、走势稳健。请给出需要我确认的定义和阈值。",
});
assert.equal(ambiguous.status, 200, ambiguous.body.error?.code);
assert.equal(ambiguous.body.mode, "model");
assert.ok(ambiguous.body.questions.length > 0);
assert.equal(ambiguous.body.unsupported.length, 0);
for (const q of ambiguous.body.questions)
  for (const o of q.options)
    assert.ok(ambiguous.body.conditions.some((c) => c.id === o.condition.id));
records.push({
  id: "hosted-real-model-clarification",
  status: ambiguous.status,
  passed: true,
  elapsedMs: ambiguous.elapsedMs,
  questionCount: ambiguous.body.questions.length,
  unsupportedCount: 0,
});
console.log("Hosted model clarification: passed.");
const strategy = {
  version: 1,
  name: "线上真实链路验收",
  universe: "000300.SH",
  conditions: explicit.body.conditions,
};
const screened = await call("/api/screen", { strategy, mode: "live" });
assert.equal(screened.status, 200, screened.body.error?.code);
assert.equal(screened.body.snapshot.mode, "live");
assert.equal(screened.body.snapshot.stocks.length, 12);
assert.equal(
  Object.values(screened.body.counts).reduce((a, b) => a + b, 0),
  12,
);
assert.ok(
  screened.body.snapshot.stocks.every(
    (s) => Object.keys(s.evidence).length > 0,
  ),
);
records.push({
  id: "hosted-model-to-real-financial-data",
  status: screened.status,
  passed: true,
  elapsedMs: screened.elapsedMs,
  snapshotId: screened.body.snapshot.id,
  asOf: screened.body.snapshot.asOf,
  evaluated: screened.body.snapshot.stocks.length,
  counts: screened.body.counts,
});
writeFileSync(
  new URL("../artifacts/hosted-live-verification.json", import.meta.url),
  JSON.stringify(
    {
      time: new Date().toISOString(),
      deploymentId: deployment.id,
      versionId: deployment.version_id,
      environmentRevision: deployment.env_set_revision,
      origin: origin.origin,
      authentication:
        "Official Sites service credential via stdin; not a browser visitor login",
      records,
      limitation:
        "Hosted HTTP integration only. Browser visitor flow and recruiting-reviewer access are separate. Raw market/model responses remain in excluded private artifacts.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `${records.length} hosted real integration checks passed. No credential persisted.`,
);
