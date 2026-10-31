import {
  metrics,
  metricKeys,
  type Evidence,
  type Metric,
  type Snapshot,
  type Stock,
  type Strategy,
} from "./strategy";

// Deliberately fictional identifiers and values. Never used as a live fallback.
const samples: { name: string; values: (number | null)[] }[] = [
  { name: "构造样本 · 甲", values: [18.6, 22.8, 21.4, 24.2, 8.1] },
  { name: "构造样本 · 乙", values: [8.4, 6.2, 28.7, 31.6, 12.4] },
  { name: "构造样本 · 丙", values: [3.2, -8.2, 18.5, 27.8, 11.2] },
  { name: "构造样本 · 丁", values: [24.5, 31.2, 46.1, 44.7, 21.8] },
  { name: "构造样本 · 戊", values: [12.1, null, null, 29.3, 10.2] },
  { name: "构造样本 · 己", values: [6.8, 4.7, 32.5, 33.1, 14.6] },
  { name: "构造样本 · 庚", values: [15.2, 10.3, 25.8, null, null] },
  { name: "构造样本 · 辛", values: [-2.6, -18.3, 14.2, 22.4, 9.6] },
];
export function demoSnapshot(universe: Strategy["universe"]): Snapshot {
  const fetchedAt = new Date().toISOString();
  const stocks: Stock[] = samples.map((sample, i) => {
    const evidence = {} as Record<Metric, Evidence>;
    metricKeys.forEach((metric, j) => {
      const value = sample.values[j];
      evidence[metric] = {
        value,
        status: value === null ? "missing" : "valid",
        reason:
          value === null
            ? metric === "pe_static"
              ? "构造异常：EPS 非正，PE 不适用"
              : "构造异常：缺失字段或交易日样本不足"
            : "仅用于交互验证的构造值",
        source: "本项目人工构造（非金融数据）",
        sourceUrl: "",
        asOf: "构造场景，无真实市场时点",
        fetchedAt,
        requestIds: [],
        raw: {
          fictional: true,
          fixtureId: `DEMO-${i + 1}`,
          metric,
          value,
          basis: metrics[metric].basis,
        },
      };
    });
    return {
      code: `DEMO-${String(i + 1).padStart(3, "0")}`,
      name: sample.name,
      price: null,
      evidence,
    };
  });
  return {
    id: `demo-${crypto.randomUUID()}`,
    mode: "demo",
    createdAt: fetchedAt,
    asOf: "构造数据 · 无市场时点",
    universe,
    universeTotal: stocks.length,
    universeAsOf: "非实际指数成分",
    scopeNote:
      "8 个虚构样本，仅验证条件、解释、比较和保存交互；不代表实际指数成分或选股结论。",
    warnings: [
      "构造数据体验：所有样本名称、指标数值均为构造；真实数据接入尚未验证。",
    ],
    stocks,
  };
}
