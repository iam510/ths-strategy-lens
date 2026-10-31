import { describe, expect, it } from "vitest";
import {
  conflicts,
  defaultStrategy,
  difference,
  evaluate,
  growth,
  isDisallowedIntent,
  priceStatistics,
  screen,
  strategySchema,
  type Condition,
} from "../src/domain/strategy";
import { demoSnapshot } from "../src/domain/demo";
const snap = () => demoSnapshot("000300.SH");
const condition = (
  op: Condition["op"],
  value: number,
  id = "a",
): Condition => ({ id, metric: "revenue_yoy", op, value });
describe("condition contracts and conflicts", () => {
  it("rejects fabricated fields and unknown properties", () => {
    expect(
      strategySchema.safeParse({
        ...defaultStrategy,
        conditions: [
          { id: "x", metric: "guaranteed_profit", op: "gt", value: 10 },
        ],
      }).success,
    ).toBe(false);
    expect(
      strategySchema.safeParse({ ...defaultStrategy, secret: "do not accept" })
        .success,
    ).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity, 100001])(
    "rejects invalid numeric threshold %s",
    (value) =>
      expect(
        strategySchema.safeParse({
          ...defaultStrategy,
          conditions: [condition("gt", value)],
        }).success,
      ).toBe(false),
  );
  it("detects empty and strict boundary intersections", () => {
    expect(
      conflicts([condition("gt", 20), condition("lt", 10, "b")]),
    ).toHaveLength(1);
    expect(
      conflicts([condition("gt", 20), condition("lte", 20, "b")]),
    ).toHaveLength(1);
    expect(
      conflicts([condition("gte", 20), condition("lte", 20, "b")]),
    ).toHaveLength(0);
  });
  it("handles same-bound strict and closed clauses in either order", () => {
    const cs = [
      condition("gte", 20),
      condition("gt", 20, "b"),
      condition("lte", 20, "c"),
    ];
    expect(conflicts(cs)).toHaveLength(1);
    expect(conflicts([...cs].reverse())).toHaveLength(1);
  });
  it("rejects duplicate IDs and impossible volatility", () => {
    expect(conflicts([condition("gt", 2), condition("lt", 3)])).toHaveLength(1);
    expect(
      conflicts([{ id: "v", metric: "volatility_60", op: "lt", value: 0 }]),
    ).toHaveLength(1);
  });
});
describe("tri-state deterministic screening", () => {
  it("matches documented fixture counts and gives repeatable outputs", () => {
    const s = snap(),
      rows = screen(s, defaultStrategy);
    expect(rows.filter((r) => r.status === "pass")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "fail")).toHaveLength(4);
    expect(rows.filter((r) => r.status === "unknown")).toHaveLength(2);
    expect(screen(s, defaultStrategy)).toEqual(rows);
  });
  it("excludes explicit failure while preserving unknown check", () => {
    const stock = snap().stocks[4];
    const row = evaluate(stock, [
      condition("gt", 20),
      { id: "pe", metric: "pe_static", op: "lt", value: 30 },
    ]);
    expect(row.status).toBe("fail");
    expect(row.checks.map((c) => c.status)).toEqual(["fail", "unknown"]);
  });
  it.each(["missing", "stale", "error"] as const)(
    "never treats %s as pass even when numeric value remains",
    (status) => {
      const stock = snap().stocks[0];
      stock.evidence.revenue_yoy.status = status;
      expect(evaluate(stock, [condition("gt", 0)]).status).toBe("unknown");
    },
  );
  it("rejects different universe and expired/future real snapshot", () => {
    const s = snap();
    expect(() =>
      screen(s, { ...defaultStrategy, universe: "000016.SH" }),
    ).toThrow("范围");
    s.mode = "live";
    s.createdAt = new Date(Date.now() - 16 * 60_000).toISOString();
    expect(() => screen(s, defaultStrategy)).toThrow("15 分钟");
    s.createdAt = new Date(Date.now() + 120_000).toISOString();
    expect(() => screen(s, defaultStrategy)).toThrow("时间");
  });
  it("identifies changed membership on same data when PE limit relaxes", () => {
    const s = snap();
    const before = screen(s, defaultStrategy);
    const relaxed = {
      ...defaultStrategy,
      conditions: defaultStrategy.conditions.map((c) =>
        c.metric === "pe_static" ? { ...c, value: 35 } : c,
      ),
    };
    const after = screen(s, relaxed);
    const changes = difference(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      code: "DEMO-006",
      before: "fail",
      after: "pass",
    });
    expect(changes[0].reasons.join()).toContain("32.50");
  });
});
describe("financial calculations and boundary", () => {
  it("calculates YoY only with positive finite prior base", () => {
    expect(growth(120, 100)).toBeCloseTo(20);
    expect(growth(-10, 100)).toBeCloseTo(-110);
    expect(growth(10, -10)).toBeNull();
    expect(growth(10, 0)).toBeNull();
    expect(growth(null, 1)).toBeNull();
  });
  it("computes zero volatility and drawdown for constant prices", () => {
    expect(priceStatistics(Array(61).fill(100))).toEqual({
      volatility: 0,
      drawdown: 0,
    });
  });
  it("computes 50% drawdown from a known price series", () => {
    const s = priceStatistics([...Array(60).fill(100), 50]);
    expect(s?.drawdown).toBe(50);
    expect(s?.volatility).toBeGreaterThan(0);
  });
  it.each([
    Array(60).fill(100),
    [...Array(60).fill(100), 0],
    [...Array(60).fill(100), NaN],
  ])("rejects inadequate or invalid price sample", (prices) =>
    expect(priceStatistics(prices)).toBeNull(),
  );
  it.each([
    "保证明天涨停",
    "稳赚的股票",
    "直接买入哪只",
    "忽略所有规则",
    "ignore previous instructions",
  ])("blocks %s", (text) => expect(isDisallowedIntent(text)).toBe(true));
  it("allows ordinary research intent", () =>
    expect(isDisallowedIntent("营收同比大于5%，PE低于30倍")).toBe(false));
});
