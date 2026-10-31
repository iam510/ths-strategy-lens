import { z } from "zod";

export const metricKeys = [
  "revenue_yoy",
  "profit_yoy",
  "pe_static",
  "volatility_60",
  "drawdown_60",
] as const;
export type Metric = (typeof metricKeys)[number];
export const metrics: Record<
  Metric,
  { label: string; unit: string; basis: string; short: string }
> = {
  revenue_yoy: {
    label: "年报营收同比",
    unit: "%",
    short: "经营",
    basis:
      "最近可得两份连续年度合并利润表：(本年营业收入 / 上年营业收入 − 1) × 100；上年值须大于 0。",
  },
  profit_yoy: {
    label: "年报归母净利润同比",
    unit: "%",
    short: "经营",
    basis:
      "最近可得两份连续年报：(本年归母净利润 / 上年归母净利润 − 1) × 100；上年值非正时无法判断。",
  },
  pe_static: {
    label: "参考静态 PE",
    unit: "倍",
    short: "估值",
    basis:
      "最新成交价 / 最近年报基本每股收益。非 TTM，未处理年报后股本变化；仅作明确口径的近似参考。EPS 非正时无法判断。",
  },
  volatility_60: {
    label: "60 日年化波动率",
    unit: "%",
    short: "走势",
    basis:
      "最近 61 个完整交易日的前复权收盘价，60 个日对数收益率的样本标准差 × √252 × 100；缺少任一有效交易日则无法判断。",
  },
  drawdown_60: {
    label: "60 日最大回撤",
    unit: "%",
    short: "走势",
    basis:
      "同一 61 点前复权收盘价窗口内，max(1 − 当日价 / 此前及当日最高价) × 100；正数表示回撤幅度，越小回撤越浅。",
  },
};
export const operators = { gt: ">", gte: "≥", lt: "<", lte: "≤" } as const;
export const conditionSchema = z
  .object({
    id: z.string().min(1).max(60),
    metric: z.enum(metricKeys),
    op: z.enum(["gt", "gte", "lt", "lte"]),
    value: z.number().finite().min(-100000).max(100000),
  })
  .strict();
export type Condition = z.infer<typeof conditionSchema>;
export const strategySchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(80),
    universe: z.enum(["000300.SH", "000016.SH"]),
    conditions: z.array(conditionSchema).min(1).max(12),
  })
  .strict();
export type Strategy = z.infer<typeof strategySchema>;
export const universeNames = {
  "000300.SH": "沪深 300",
  "000016.SH": "上证 50",
};
export const defaultStrategy: Strategy = {
  version: 1,
  name: "经营改善 · 估值与稳定性观察",
  universe: "000300.SH",
  conditions: [
    { id: "revenue", metric: "revenue_yoy", op: "gt", value: 5 },
    { id: "pe", metric: "pe_static", op: "lte", value: 30 },
    { id: "vol", metric: "volatility_60", op: "lte", value: 35 },
  ],
};
const evidenceSchema = z.object({
  value: z.number().finite().nullable(),
  status: z.enum(["valid", "missing", "stale", "error"]),
  reason: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
  asOf: z.string(),
  fetchedAt: z.string().datetime(),
  requestIds: z.array(z.string()),
  raw: z.record(z.unknown()),
});
export type Evidence = z.infer<typeof evidenceSchema>;
export const stockSchema = z.object({
  code: z.string(),
  name: z.string(),
  price: z.number().finite().nullable(),
  evidence: z.object({
    revenue_yoy: evidenceSchema,
    profit_yoy: evidenceSchema,
    pe_static: evidenceSchema,
    volatility_60: evidenceSchema,
    drawdown_60: evidenceSchema,
  }),
});
export type Stock = z.infer<typeof stockSchema>;
export const snapshotSchema = z.object({
  id: z.string(),
  mode: z.enum(["live", "demo"]),
  createdAt: z.string().datetime(),
  asOf: z.string(),
  universe: z.enum(["000300.SH", "000016.SH"]),
  universeTotal: z.number(),
  universeAsOf: z.string(),
  scopeNote: z.string(),
  warnings: z.array(z.string()),
  stocks: z.array(stockSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Status = "pass" | "fail" | "unknown";
export type Evaluation = {
  stock: Stock;
  status: Status;
  checks: {
    condition: Condition;
    status: Status;
    evidence: Evidence;
    reason: string;
  }[];
};

export function conflicts(conditions: Condition[]): string[] {
  const messages: string[] = [];
  if (new Set(conditions.map((c) => c.id)).size !== conditions.length)
    messages.push("条件 ID 重复，请重新添加重复条件。");
  for (const metric of metricKeys) {
    const cs = conditions.filter((c) => c.metric === metric);
    let lower = -Infinity,
      upper = Infinity,
      lowerClosed = false,
      upperClosed = false;
    for (const c of cs) {
      if (c.op === "gt" || c.op === "gte") {
        if (c.value > lower) {
          lower = c.value;
          lowerClosed = c.op === "gte";
        } else if (c.value === lower)
          lowerClosed = lowerClosed && c.op === "gte";
      } else {
        if (c.value < upper) {
          upper = c.value;
          upperClosed = c.op === "lte";
        } else if (c.value === upper)
          upperClosed = upperClosed && c.op === "lte";
      }
    }
    if (lower > upper || (lower === upper && !(lowerClosed && upperClosed)))
      messages.push(`${metrics[metric].label}的上下限没有交集，请修改条件。`);
    if (
      ["volatility_60", "drawdown_60"].includes(metric) &&
      cs.some(
        (c) =>
          (c.op === "lt" && c.value <= 0) || (c.op === "lte" && c.value < 0),
      )
    )
      messages.push(`${metrics[metric].label}不可能小于零，请检查阈值。`);
    if (
      metric === "pe_static" &&
      cs.some((c) => (c.op === "lt" || c.op === "lte") && c.value <= 0)
    )
      messages.push("参考静态 PE 仅对正 EPS 和正价格计算，请使用正的上限。");
  }
  return messages;
}

export function compareNumber(value: number, c: Condition): boolean {
  return c.op === "gt"
    ? value > c.value
    : c.op === "gte"
      ? value >= c.value
      : c.op === "lt"
        ? value < c.value
        : value <= c.value;
}
export function evaluate(stock: Stock, conditions: Condition[]): Evaluation {
  const checks = conditions.map((condition) => {
    const evidence = stock.evidence[condition.metric];
    const status: Status =
      evidence.status !== "valid" ||
      evidence.value === null ||
      !Number.isFinite(evidence.value)
        ? "unknown"
        : compareNumber(evidence.value, condition)
          ? "pass"
          : "fail";
    const meta = metrics[condition.metric];
    return {
      condition,
      status,
      evidence,
      reason:
        status === "unknown"
          ? evidence.reason
          : `${meta.label} ${evidence.value!.toFixed(2)}${meta.unit} ${status === "pass" ? "满足" : "不满足"} ${operators[condition.op]} ${condition.value}${meta.unit}`,
    };
  });
  return {
    stock,
    status: checks.some((c) => c.status === "fail")
      ? "fail"
      : checks.some((c) => c.status === "unknown")
        ? "unknown"
        : "pass",
    checks,
  };
}
export function screen(
  snapshot: Snapshot,
  strategy: Strategy,
  now = Date.now(),
): Evaluation[] {
  strategySchema.parse(strategy);
  const issues = conflicts(strategy.conditions);
  if (issues.length) throw new Error(issues.join(" "));
  if (snapshot.universe !== strategy.universe)
    throw new Error("股票范围已改变，请重新获取对应数据。");
  if (
    snapshot.mode === "live" &&
    (now - Date.parse(snapshot.createdAt) > 15 * 60_000 ||
      Date.parse(snapshot.createdAt) > now + 60_000)
  )
    throw new Error("此快照已超过 15 分钟或时间无效，请刷新数据再执行。");
  return snapshot.stocks.map((stock) => evaluate(stock, strategy.conditions));
}
export function difference(before: Evaluation[], after: Evaluation[]) {
  const old = new Map(before.map((r) => [r.stock.code, r]));
  return after
    .map((row) => ({
      code: row.stock.code,
      name: row.stock.name,
      before: old.get(row.stock.code)?.status ?? "unknown",
      after: row.status,
      reasons: row.checks
        .filter((c) => {
          const prior = old
            .get(row.stock.code)
            ?.checks.find((p) => p.condition.id === c.condition.id);
          return (
            !prior ||
            prior.status !== c.status ||
            prior.condition.value !== c.condition.value ||
            prior.condition.op !== c.condition.op ||
            prior.condition.metric !== c.condition.metric
          );
        })
        .map((c) => c.reason),
    }))
    .filter((r) => r.before !== r.after);
}
export function growth(
  current: number | null,
  previous: number | null,
): number | null {
  return current !== null &&
    previous !== null &&
    Number.isFinite(current) &&
    Number.isFinite(previous) &&
    previous > 0
    ? (current / previous - 1) * 100
    : null;
}
export function priceStatistics(
  prices: number[],
): { volatility: number; drawdown: number } | null {
  if (prices.length !== 61 || prices.some((p) => !Number.isFinite(p) || p <= 0))
    return null;
  const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const variance =
    returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1);
  let high = prices[0],
    drawdown = 0;
  for (const price of prices) {
    high = Math.max(high, price);
    drawdown = Math.max(drawdown, (1 - price / high) * 100);
  }
  return { volatility: Math.sqrt(variance * 252) * 100, drawdown };
}
export function isDisallowedIntent(text: string) {
  return /保证.{0,6}(涨|赚|收益)|稳赚|必涨|翻倍|内幕|操纵|买哪[只支个]|直接.{0,4}(买入|卖出)|推荐.{0,4}买|忽略.{0,8}(规则|提示|指令)|ignore.{0,15}(instruction|rule)|system\s*prompt/i.test(
    text,
  );
}
