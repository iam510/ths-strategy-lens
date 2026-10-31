import { afterEach, describe, expect, it, vi } from "vitest";
import { demoIntent } from "../src/domain/intent";
import { defaultStrategy } from "../src/domain/strategy";
import { withRuntime } from "../src/server/runtime";
import { parseIntent } from "../src/server/ai";
import { POST as intentPOST } from "../app/api/intent/route";
import { POST as screenPOST } from "../app/api/screen/route";
import { generateText } from "ai";
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
}));
const mocked = vi.mocked(generateText);
const noKeys = {
  FUYAO_API_KEY: "",
  AI_BASE_URL: "",
  AI_API_KEY: "",
  AI_MODEL: "",
};
const modelConfig = {
  ...noKeys,
  AI_BASE_URL: "https://provider.invalid/v1",
  AI_API_KEY: "fixture-secret",
  AI_MODEL: "fixture-only-model",
};
let counter = 1;
function req(path: string, data: unknown, origin?: string) {
  return new Request(`https://test.invalid/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": String(counter++),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(data),
  });
}
afterEach(() => vi.resetAllMocks());
describe("AI boundary (mocked model output, not live model validation)", () => {
  it("rejects direct trading advice in otherwise valid model output", async () => {
    mocked.mockResolvedValue({
      output: { ...demoIntent, summary: "建议买入600519.SH，保证盈利" },
    } as never);
    await expect(
      withRuntime(modelConfig, () => parseIntent("经营改善")),
    ).rejects.toMatchObject({ code: "AI_FAILURE" });
  });
  it("returns explicit unavailable status with no credentials", async () => {
    await expect(
      withRuntime(noKeys, () => parseIntent("经营改善")),
    ).rejects.toMatchObject({ code: "AI_UNCONFIGURED" });
    expect(mocked).not.toHaveBeenCalled();
  });
  it("blocks prohibited intent before using a model", async () => {
    await expect(
      withRuntime(modelConfig, () => parseIntent("保证明天涨停")),
    ).rejects.toMatchObject({ code: "BOUNDARY" });
    expect(mocked).not.toHaveBeenCalled();
  });
  it("returns validated model metadata and conditions", async () => {
    mocked.mockResolvedValue({ output: demoIntent } as never);
    const parsed = await withRuntime(modelConfig, () =>
      parseIntent("经营改善"),
    );
    expect(parsed.mode).toBe("model");
    expect(parsed.promptVersion).toBe("intent-v1.2");
    expect(parsed.conditions).toHaveLength(3);
    expect(mocked.mock.calls[0][0].maxRetries).toBe(0);
    expect(mocked.mock.calls[0][0].system).toContain(
      '"required":["id","question","options"]',
    );
  });
  it("rejects invented metrics without leaking raw provider error", async () => {
    mocked.mockResolvedValue({
      output: {
        ...demoIntent,
        conditions: [{ id: "x", metric: "future_profit", op: "gt", value: 1 }],
      },
    } as never);
    await expect(
      withRuntime(modelConfig, () => parseIntent("经营改善")),
    ).rejects.toMatchObject({ code: "AI_FAILURE" });
  });
  it("budgets reasoning for the configured MiniMax Flash model", async () => {
    mocked.mockResolvedValue({ output: demoIntent } as never);
    await withRuntime(
      {
        ...modelConfig,
        AI_BASE_URL: "https://api.minimax.cn/v1",
        AI_MODEL: "MiniMax-M3.1-Flash",
      },
      () => parseIntent("经营改善"),
    );
    expect(mocked.mock.calls[0][0]).toMatchObject({
      maxOutputTokens: 6000,
      providerOptions: { openaiCompatible: { reasoningEffort: "low" } },
    });
  });
  it("rejects broken clarification references", async () => {
    const bad = structuredClone(demoIntent);
    bad.questions[0].options[0].condition.id = "not-in-conditions";
    mocked.mockResolvedValue({ output: bad } as never);
    await expect(
      withRuntime(modelConfig, () => parseIntent("经营改善")),
    ).rejects.toMatchObject({ code: "AI_FAILURE" });
  });
  it("handles timeout/provider error without exposing details", async () => {
    mocked.mockRejectedValue(new Error("provider echoed fixture-secret"));
    await expect(
      withRuntime(modelConfig, () => parseIntent("经营改善")),
    ).rejects.toThrow("模型调用失败");
  });
});
describe("API contracts", () => {
  it("rejects cross-origin and oversized requests", async () => {
    expect(
      (
        await intentPOST(
          req("intent", { text: "经营改善" }, "https://other.invalid"),
        )
      ).status,
    ).toBe(403);
    expect(
      (await intentPOST(req("intent", { text: "x".repeat(13000) }))).status,
    ).toBe(413);
  });
  it("rejects empty and too-long intent", async () => {
    expect((await intentPOST(req("intent", { text: " " }))).status).toBe(400);
    expect(
      (await intentPOST(req("intent", { text: "x".repeat(1501) }))).status,
    ).toBe(400);
  });
  it("returns JSON 503 for unconfigured model", async () => {
    const response = await withRuntime(noKeys, () =>
      intentPOST(req("intent", { text: "经营改善" })),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("runs explicit demo mode and never silently falls back in live mode", async () => {
    const demo = await withRuntime(noKeys, () =>
      screenPOST(req("screen", { strategy: defaultStrategy, mode: "demo" })),
    );
    expect(demo.status).toBe(200);
    expect(await demo.json()).toMatchObject({
      snapshot: { mode: "demo" },
      counts: { pass: 2, fail: 4, unknown: 2 },
    });
    const live = await withRuntime(noKeys, () =>
      screenPOST(req("screen", { strategy: defaultStrategy, mode: "live" })),
    );
    expect(live.status).toBe(503);
    expect(await live.json()).toMatchObject({
      error: { code: "DATA_UNCONFIGURED" },
    });
  });
  it("rejects conflicts before touching data", async () => {
    const cs = [
      { id: "a", metric: "pe_static", op: "gt", value: 20 },
      { id: "b", metric: "pe_static", op: "lt", value: 10 },
    ];
    const result = await screenPOST(
      req("screen", {
        strategy: { ...defaultStrategy, conditions: cs },
        mode: "live",
      }),
    );
    expect(result.status).toBe(422);
  });
});
