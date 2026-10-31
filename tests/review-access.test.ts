import { beforeEach, describe, expect, it, vi } from "vitest";
import { withRuntime } from "../src/server/runtime";
import { requireReviewAccess } from "../src/server/review-access";
import { GET as configGET } from "../app/api/config/route";
import { POST as accessPOST } from "../app/api/review-access/route";
import { POST as intentPOST } from "../app/api/intent/route";
import { POST as screenPOST } from "../app/api/screen/route";
import { parseIntent } from "../src/server/ai";
import { liveSnapshot } from "../src/server/fuyao";
import { defaultStrategy } from "../src/domain/strategy";
vi.mock("../src/server/ai", () => ({
  parseIntent: vi.fn(async () => ({
    mode: "model",
    conditions: defaultStrategy.conditions,
  })),
}));
vi.mock("../src/server/fuyao", () => ({ liveSnapshot: vi.fn() }));
const gated = { REVIEW_ACCESS_CODE: "fixture-review-code" };
let n = 0;
function request(path: string, body?: unknown, code?: string, origin?: string) {
  return new Request(`https://review.invalid/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "cf-connecting-ip": `review-${n++}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(code ? { "X-Review-Access": code } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
beforeEach(() => vi.clearAllMocks());
describe("Reviewer capability (synthetic credentials and mocked paid services)", () => {
  it("preserves ungated local development when no review secret is configured", async () => {
    await expect(
      withRuntime({ REVIEW_ACCESS_CODE: "" }, () =>
        requireReviewAccess(request("intent")),
      ),
    ).resolves.toBeUndefined();
  });
  it("rejects missing, wrong and query-string-only capabilities", async () => {
    for (const r of [
      request("intent"),
      request("intent", undefined, "wrong"),
      request("intent?code=fixture-review-code"),
    ])
      await expect(
        withRuntime(gated, () => requireReviewAccess(r)),
      ).rejects.toMatchObject({ status: 401, code: "REVIEW_ACCESS" });
  });
  it("accepts the exact capability in its header", async () => {
    await expect(
      withRuntime(gated, () =>
        requireReviewAccess(
          request("intent", undefined, "fixture-review-code"),
        ),
      ),
    ).resolves.toBeUndefined();
  });
  it("exposes configuration flags without disclosing the review secret", async () => {
    const r = await withRuntime(gated, () => configGET(request("config")));
    const b = await r.json();
    expect(b).toMatchObject({
      reviewAccessRequired: true,
      reviewAccessGranted: false,
    });
    expect(JSON.stringify(b)).not.toContain(gated.REVIEW_ACCESS_CODE);
    const allowed = await withRuntime(gated, () =>
      configGET(request("config", undefined, "fixture-review-code")),
    );
    expect(await allowed.json()).toMatchObject({ reviewAccessGranted: true });
  });
  it("validates entry without echoing credentials and retains request restrictions", async () => {
    const valid = await withRuntime(gated, () =>
      accessPOST(request("review-access", { code: "fixture-review-code" })),
    );
    expect(await valid.json()).toEqual({ granted: true });
    expect(
      (
        await withRuntime(gated, () =>
          accessPOST(request("review-access", { code: "wrong" })),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await withRuntime(gated, () =>
          accessPOST(
            request("review-access", {
              code: "fixture-review-code",
              extra: true,
            }),
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await withRuntime(gated, () =>
          accessPOST(
            request(
              "review-access",
              { code: "fixture-review-code" },
              undefined,
              "https://other.invalid",
            ),
          ),
        )
      ).status,
    ).toBe(403);
  });
  it("blocks paid routes before calling services while keeping explicit demo public", async () => {
    const i = await withRuntime(gated, () =>
      intentPOST(request("intent", { text: "营收增长" })),
    );
    const s = await withRuntime(gated, () =>
      screenPOST(
        request("screen", { strategy: defaultStrategy, mode: "live" }),
      ),
    );
    expect(i.status).toBe(401);
    expect(s.status).toBe(401);
    expect(parseIntent).not.toHaveBeenCalled();
    expect(liveSnapshot).not.toHaveBeenCalled();
    const demo = await withRuntime(gated, () =>
      screenPOST(
        request("screen", { strategy: defaultStrategy, mode: "demo" }),
      ),
    );
    expect(demo.status).toBe(200);
    expect(await demo.json()).toMatchObject({ snapshot: { mode: "demo" } });
  });
  it("permits model parsing only after a valid capability", async () => {
    const r = await withRuntime(gated, () =>
      intentPOST(
        request("intent", { text: "营收增长" }, "fixture-review-code"),
      ),
    );
    expect(r.status).toBe(200);
    expect(parseIntent).toHaveBeenCalledOnce();
  });
  it("revokes an old capability when the server secret changes", async () => {
    await expect(
      withRuntime({ REVIEW_ACCESS_CODE: "rotated-fixture" }, () =>
        requireReviewAccess(
          request("intent", undefined, "fixture-review-code"),
        ),
      ),
    ).rejects.toMatchObject({ code: "REVIEW_ACCESS" });
  });
});
