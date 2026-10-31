import { describe, expect, it, vi } from "vitest";
import { defaultStrategy } from "../src/domain/strategy";
import { FuyaoClient, liveSnapshot } from "../src/server/fuyao";
const ok = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, request_id: "fixture-request", data }),
    { headers: { "Content-Type": "application/json" } },
  );
describe("Fuyao transport", () => {
  it("requires key before attempting a network request", async () => {
    const fetcher = vi.fn();
    await expect(
      new FuyaoClient("", fetcher).get("a-share/prices/snapshot", {}),
    ).rejects.toMatchObject({ code: "DATA_UNCONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("handles nonzero business code even on HTTP 200 and redacts raw error", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 2003,
            message: "sensitive upstream text",
            request_id: "trace-1",
            data: null,
          }),
        ),
    );
    await expect(
      new FuyaoClient("fixture-key", fetcher, 0).get(
        "a-share/prices/snapshot",
        {},
      ),
    ).rejects.toMatchObject({ code: "FUYAO_2003", requestId: "trace-1" });
  });
  it("handles non-JSON, HTTP failure and network failure", async () => {
    for (const [fetcher, code] of [
      [async () => new Response("invalid"), "DATA_SCHEMA"],
      [async () => new Response("", { status: 503 }), "DATA_HTTP"],
      [
        async () => {
          throw new Error("secret");
        },
        "DATA_NETWORK",
      ],
    ] as const)
      await expect(
        new FuyaoClient("fixture-key", fetcher, 0).get(
          "a-share/prices/snapshot",
          {},
        ),
      ).rejects.toMatchObject({ code });
  });
  it("passes auth only in header, never in evidence URL", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => ok({ item: [] }));
    const result = await new FuyaoClient("fixture-key", fetcher, 0).get(
      "a-share/prices/snapshot",
      { thscodes: "600519.SH" },
    );
    expect(
      new Headers(fetcher.mock.calls[0][1]?.headers).get("X-api-key"),
    ).toBe("fixture-key");
    expect(result.url).not.toContain("fixture-key");
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  });
  it("recovers one prerequisite connection failure when explicitly enabled", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException("fixture only", "TimeoutError"))
      .mockResolvedValueOnce(ok({ item: [] }));
    const result = await new FuyaoClient("fixture-key", fetcher, 0).get(
      "a-share/calendar/trading-days",
      {},
      { retryNetwork: true },
    );
    expect(result.data.item).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.every(([, init]) => init?.redirect === "manual"),
    ).toBe(true);
  });
  it("bounds connection retries and never retries HTTP or business failures", async () => {
    for (const [response, expected, calls] of [
      [new Error("fixture-key must remain private"), "DATA_NETWORK", 2],
      [new Response(null, { status: 503 }), "DATA_HTTP", 1],
      [
        new Response(JSON.stringify({ code: 4001, data: null })),
        "FUYAO_4001",
        1,
      ],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (response instanceof Error) throw response;
        return response;
      });
      const promise = new FuyaoClient("fixture-key", fetcher, 0).get(
        "a-share/calendar/trading-days",
        {},
        { retryNetwork: true },
      );
      await expect(promise).rejects.toMatchObject({ code: expected });
      expect(fetcher).toHaveBeenCalledTimes(calls);
    }
  });
  it("rejects redirects instead of following them with credentials", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://other.invalid/" },
        }),
    );
    await expect(
      new FuyaoClient("fixture-key", fetcher, 0).get(
        "a-share/prices/snapshot",
        {},
      ),
    ).rejects.toMatchObject({ code: "DATA_HTTP" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  });
});
describe("provider normalization (synthetic response fixtures, not live validation)", () => {
  const now = Date.parse("2026-10-30T10:00:00+08:00");
  const last = Date.parse("2026-10-29T00:00:00+08:00");
  const dates = Array.from(
    { length: 70 },
    (_, i) => last - (69 - i) * 86400_000,
  );
  function transport(
    options: {
      missingHistory?: boolean;
      negativeEPS?: boolean;
      oldReports?: boolean;
      futureReport?: boolean;
      partialFailure?: boolean;
    } = {},
  ): typeof fetch {
    return async (input) => {
      const url = String(input);
      if (url.includes("constituents"))
        return ok({
          timestamp: last,
          item: [{ thscode: "600001.SH", name: "合成响应样本" }],
        });
      if (url.includes("trading-days"))
        return ok({ item: dates.map((date_ms) => ({ date_ms })) });
      if (url.includes("prices/snapshot"))
        return ok({
          timestamp: now,
          item: [{ thscode: "600001.SH", last_price: 20 }],
        });
      if (url.includes("income-statements"))
        return ok({
          item: [0, 1].map((i) => ({
            thscode: "600001.SH",
            period: "annual",
            fiscal_year: (options.oldReports ? 2023 : 2025) - i,
            report_date_ms: options.futureReport
              ? now + 86400_000
              : Date.parse(`${2026 - i}-03-20T00:00:00+08:00`),
            period_end_ms: Date.parse(`${2025 - i}-12-31T00:00:00+08:00`),
            currency: "CNY",
            operating_income: 120 - 20 * i,
            parent_holder_net_profit: 12 - 2 * i,
            basic_eps: options.negativeEPS ? -2 : 2,
          })),
        });
      if (options.partialFailure)
        return new Response(
          JSON.stringify({
            code: 5002,
            request_id: "timeout-fixture",
            data: null,
          }),
        );
      return ok({
        timestamp: last,
        item: (options.missingHistory ? dates.slice(0, -1) : dates).map(
          (date_ms) => ({ date_ms, close_price: 100, volume: 100 }),
        ),
      });
    };
  }
  it("normalizes evidence with raw fields, units via catalog, dates and request references", async () => {
    const s = await liveSnapshot(
      defaultStrategy,
      new FuyaoClient("fixture-key", transport(), 0),
      now,
    );
    const stock = s.stocks[0];
    expect(stock.evidence.revenue_yoy.value).toBeCloseTo(20);
    expect(stock.evidence.pe_static.value).toBe(10);
    expect(stock.evidence.volatility_60.value).toBe(0);
    expect(stock.evidence.revenue_yoy.requestIds).toEqual(["fixture-request"]);
    expect(stock.evidence.revenue_yoy.raw).toMatchObject({
      current: 120,
      prior: 100,
    });
    expect(JSON.stringify(s)).not.toContain("fixture-key");
  });
  it("handles negative EPS without calling it cheap", async () => {
    const s = await liveSnapshot(
      defaultStrategy,
      new FuyaoClient("fixture-key", transport({ negativeEPS: true }), 0),
      now,
    );
    expect(s.stocks[0].evidence.pe_static.status).toBe("missing");
    expect(s.stocks[0].evidence.pe_static.value).toBeNull();
  });
  it("checks freshness separately for each stock rather than sharing newest batch timestamp", async () => {
    const original = transport();
    const quoteQueries: string[] = [];
    const multi: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes("constituents"))
        return ok({
          timestamp: last,
          item: [
            { thscode: "600001.SH", name: "旧行情样本" },
            { thscode: "600002.SH", name: "新行情样本" },
          ],
        });
      if (url.pathname.includes("prices/snapshot")) {
        const code = url.searchParams.get("thscodes")!;
        quoteQueries.push(code);
        return ok({
          timestamp: code === "600001.SH" ? now - 20 * 86400_000 : now,
          item: [{ thscode: code, last_price: 20 }],
        });
      }
      const response = await original(input, init);
      const body = (await response.json()) as {
        data: { item: Record<string, unknown>[] };
      };
      if (url.pathname.includes("income-statements"))
        body.data.item.forEach((row) => {
          row.thscode = url.searchParams.get("thscode");
        });
      return new Response(JSON.stringify(body));
    };
    const s = await liveSnapshot(
      defaultStrategy,
      new FuyaoClient("fixture-key", multi, 0),
      now,
    );
    expect(quoteQueries).toEqual(["600001.SH", "600002.SH"]);
    expect(s.stocks[0].evidence.pe_static.status).toBe("stale");
    expect(s.stocks[1].evidence.pe_static.status).toBe("valid");
  });
  it("requires complete trading-day window", async () => {
    const s = await liveSnapshot(
      defaultStrategy,
      new FuyaoClient("fixture-key", transport({ missingHistory: true }), 0),
      now,
    );
    expect(s.stocks[0].evidence.volatility_60.status).toBe("missing");
  });
  it("marks old financial reports stale", async () => {
    const s = await liveSnapshot(
      defaultStrategy,
      new FuyaoClient("fixture-key", transport({ oldReports: true }), 0),
      now,
    );
    expect(s.stocks[0].evidence.revenue_yoy.status).toBe("stale");
  });
  it("does not use reports disclosed after acquisition time", async () => {
    const s = await liveSnapshot(
      defaultStrategy,
      new FuyaoClient("fixture-key", transport({ futureReport: true }), 0),
      now,
    );
    expect(s.stocks[0].evidence.revenue_yoy.status).toBe("missing");
  });
  it("retains other evidence when history call fails", async () => {
    const s = await liveSnapshot(
      defaultStrategy,
      new FuyaoClient("fixture-key", transport({ partialFailure: true }), 0),
      now,
    );
    expect(s.stocks[0].evidence.volatility_60.status).toBe("error");
    expect(s.stocks[0].evidence.revenue_yoy.status).toBe("valid");
    expect(s.warnings).not.toHaveLength(0);
  });
});
