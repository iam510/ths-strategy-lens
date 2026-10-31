import { z } from "zod";
import {
  growth,
  priceStatistics,
  metricKeys,
  snapshotSchema,
  type Evidence,
  type Metric,
  type Snapshot,
  type Stock,
  type Strategy,
} from "../domain/strategy";
import { AppError } from "./http";
import { runtimeValue } from "./runtime";

const ORIGIN = "https://fuyao.aicubes.cn";
const BASE = ORIGIN + "/api/";
const day = (ms: number) =>
  new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const errors: Record<number, string> = {
  1001: "缺少接口必填参数",
  1002: "接口参数格式错误",
  1003: "接口参数越界",
  1004: "接口参数冲突",
  2001: "数据鉴权失败",
  2003: "数据权限不足或缺少密钥",
  3001: "标的不存在",
  3002: "数据未就绪",
  3004: "标的不支持此能力",
  4001: "数据接口配额或频率受限",
  5001: "数据服务内部错误",
  5002: "数据服务超时",
  5003: "上游数据不可用",
};
type Envelope = {
  code: number;
  request_id?: string;
  data: Record<string, unknown> | null;
};
export class FuyaoClient {
  private next = 0;
  constructor(
    private key: string,
    private transport: typeof fetch = fetch,
    private spacing = 550,
  ) {}
  async get(
    path: string,
    query: Record<string, string>,
    options: { retryNetwork?: boolean } = {},
  ): Promise<{
    data: Record<string, unknown>;
    requestId: string;
    url: string;
    fetchedAt: string;
  }> {
    if (!this.key)
      throw new AppError(
        "DATA_UNCONFIGURED",
        "尚未配置扶摇数据密钥。请配置服务端环境变量后重试；本次未使用构造数据替代。",
        503,
      );
    const wait = Math.max(0, this.next - Date.now());
    this.next = Math.max(Date.now(), this.next) + this.spacing;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let response: Response | undefined;
    const attempts = options.retryNetwork ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 750));
      try {
        response = await this.transport(url.toString(), {
          headers: { "X-api-key": this.key, Accept: "application/json" },
          signal: AbortSignal.timeout(options.retryNetwork ? 20_000 : 10_000),
          // Workers supports follow/manual only. Manual also prevents credentials
          // from being forwarded to a redirected destination.
          redirect: "manual",
        });
        break;
      } catch {
        // Only transport failures at the two prerequisite endpoints opt in.
        // HTTP/business/schema failures retain their explicit original errors.
      }
    }
    if (!response) {
      throw new AppError(
        "DATA_NETWORK",
        "扶摇请求超时或网络不可达；本次未产生正常结论。",
        502,
      );
    }
    if (!response.ok)
      throw new AppError(
        "DATA_HTTP",
        `扶摇 HTTP ${response.status}，请检查服务状态。`,
        502,
      );
    let envelope: Envelope;
    try {
      envelope = z
        .object({
          code: z.number(),
          request_id: z.string().optional(),
          data: z.record(z.unknown()).nullable(),
        })
        .parse(await response.json());
    } catch {
      throw new AppError(
        "DATA_SCHEMA",
        "扶摇响应结构异常，无法可靠解释。",
        502,
      );
    }
    const requestId = envelope.request_id?.slice(0, 120) ?? "未返回 request_id";
    if (envelope.code !== 0)
      throw new AppError(
        `FUYAO_${envelope.code}`,
        errors[envelope.code] ?? "数据接口返回业务失败",
        502,
        requestId,
      );
    if (!envelope.data)
      throw new AppError(
        "DATA_EMPTY",
        "数据接口成功但没有数据容器。",
        502,
        requestId,
      );
    return {
      data: envelope.data,
      requestId,
      url: url.toString(),
      fetchedAt: new Date().toISOString(),
    };
  }
}
type Result = Awaited<ReturnType<FuyaoClient["get"]>>;
const items = (r: Result): Record<string, unknown>[] => {
  if (!Array.isArray(r.data.item))
    throw new AppError(
      "DATA_SCHEMA",
      "数据接口缺少记录列表。",
      502,
      r.requestId,
    );
  return r.data.item.filter(
    (x): x is Record<string, unknown> => !!x && typeof x === "object",
  );
};
function empty(
  reason: string,
  status: Evidence["status"] = "missing",
): Evidence {
  return {
    value: null,
    status,
    reason,
    source: "扶摇金融数据 API",
    sourceUrl: "https://fuyao.aicubes.cn/docs/",
    asOf: "未取得有效时点",
    fetchedAt: new Date().toISOString(),
    requestIds: [],
    raw: {},
  };
}
function proof(
  result: Result,
  value: number | null,
  asOf: string,
  raw: Record<string, unknown>,
  reason: string,
): Evidence {
  return {
    value,
    status: value === null ? "missing" : "valid",
    reason,
    source: "扶摇金融数据 API",
    sourceUrl: result.url,
    asOf,
    fetchedAt: result.fetchedAt,
    requestIds: [result.requestId],
    raw,
  };
}
const failureText = (e: unknown) =>
  e instanceof AppError
    ? `${e.message}${e.requestId ? `（request_id: ${e.requestId}）` : ""}`
    : "数据处理失败";

export async function liveSnapshot(
  strategy: Strategy,
  client = new FuyaoClient(runtimeValue("FUYAO_API_KEY")),
  now = Date.now(),
): Promise<Snapshot> {
  const constituents = await client.get(
    "a-share-index/constituents/ths-stock-list",
    { thscode: strategy.universe },
    { retryNetwork: true },
  );
  const members = items(constituents).filter(
    (x) =>
      typeof x.thscode === "string" && /^\d{6}\.(SH|SZ|BJ)$/.test(x.thscode),
  );
  const unique = [
    ...new Map(members.map((x) => [String(x.thscode), x])).values(),
  ].sort((a, b) => String(a.thscode).localeCompare(String(b.thscode)));
  if (!unique.length)
    throw new AppError(
      "EMPTY_UNIVERSE",
      "指数成分为空或代码无效，不能执行筛选。",
      502,
    );
  const selected = unique.slice(0, 12);
  const calendar = await client.get(
    "a-share/calendar/trading-days",
    {},
    {
      retryNetwork: true,
    },
  );
  const local = new Date(now + 8 * 3600_000);
  const today = local.toISOString().slice(0, 10);
  // Exclude today's incomplete bar before 16:00 Shanghai time.
  const tradingDays = [
    ...new Set(
      items(calendar)
        .map((x) => number(x.date_ms))
        .filter(
          (x): x is number =>
            x !== null &&
            (day(x) < today || (day(x) === today && local.getUTCHours() >= 16)),
        ),
    ),
  ].sort((a, b) => a - b);
  const expectedDays = tradingDays.slice(-61),
    lastDay = tradingDays.at(-1);
  if (!lastDay || expectedDays.length < 61 || now - lastDay > 10 * 86400_000)
    throw new AppError(
      "CALENDAR_STALE",
      "交易日历不足或最新日期过旧，无法确认行情窗口。",
      502,
    );
  const warnings: string[] = [];
  const expectedFY =
    local.getUTCMonth() >= 4
      ? local.getUTCFullYear() - 1
      : local.getUTCFullYear() - 2;
  const stocks: Stock[] = [];
  // Bounded scope and sequential per-stock work avoid unbounded provider fanout.
  for (const member of selected) {
    const code = String(member.thscode);
    const evidence = Object.fromEntries(
      metricKeys.map((k) => [k, empty("尚未获得字段")]),
    ) as Record<Metric, Evidence>;
    // Batch timestamp means the NEWEST item, not every item's timestamp.
    // A single-symbol request makes the envelope timestamp attributable.
    let quotes: Result | undefined,
      price: number | null = null,
      quoteTimestamp: number | null = null,
      quoteError = "";
    try {
      quotes = await client.get("a-share/prices/snapshot", { thscodes: code });
      const records = items(quotes);
      if (records.length !== 1 || records[0].thscode !== code)
        throw new AppError("QUOTE_MISMATCH", "行情响应标的无法唯一核对", 502);
      price = number(records[0].last_price);
      quoteTimestamp = number(quotes.data.timestamp);
    } catch (e) {
      quoteError = failureText(e);
    }
    try {
      const reports = await client.get("a-share/financials/income-statements", {
        thscode: code,
        period: "annual",
        limit: "3",
      });
      const annuals = items(reports)
        .filter(
          (r) =>
            r.thscode === code &&
            r.period === "annual" &&
            Number.isInteger(r.fiscal_year) &&
            Number(r.fiscal_year) > 1990 &&
            number(r.report_date_ms) !== null &&
            Number(r.report_date_ms) > 0 &&
            Number(r.report_date_ms) <= now &&
            number(r.period_end_ms) !== null &&
            Number(r.period_end_ms) > 0 &&
            Number(r.period_end_ms) <= now,
        )
        .sort((a, b) => Number(b.fiscal_year) - Number(a.fiscal_year));
      const current = annuals[0],
        prior =
          current &&
          annuals.find(
            (r) => Number(r.fiscal_year) === Number(current.fiscal_year) - 1,
          );
      if (current) {
        const reportLabel = `${current.fiscal_year} 年报；披露 ${day(Number(current.report_date_ms))}`;
        for (const [metric, field] of [
          ["revenue_yoy", "operating_income"],
          ["profit_yoy", "parent_holder_net_profit"],
        ] as const) {
          const a = number(current[field]),
            b = prior ? number(prior[field]) : null;
          const value =
            current.currency === "CNY" && prior?.currency === "CNY"
              ? growth(a, b)
              : null;
          evidence[metric] = proof(
            reports,
            value,
            reportLabel,
            {
              thscode: code,
              field,
              current: a,
              prior: b,
              currentFY: current.fiscal_year,
              priorFY: prior?.fiscal_year ?? null,
              currency: current.currency ?? null,
              report_date_ms: current.report_date_ms,
              period_end_ms: current.period_end_ms,
              formula: "(current / prior - 1) * 100",
            },
            value === null
              ? "缺少连续年报、币种不匹配或上年基数非正"
              : "连续年报同比，非单季指标",
          );
        }
        const eps = number(current.basic_eps);
        const pe =
          price !== null &&
          price > 0 &&
          eps !== null &&
          eps > 0 &&
          current.currency === "CNY"
            ? price / eps
            : null;
        evidence.pe_static = proof(
          reports,
          pe,
          `${reportLabel}；行情 ${quoteTimestamp ? day(quoteTimestamp) : "未知"}`,
          {
            thscode: code,
            last_price: price,
            basic_eps: eps,
            fiscal_year: current.fiscal_year,
            currency: current.currency ?? null,
            snapshot_timestamp: quoteTimestamp,
            formula: "last_price / basic_eps",
            limitation: "非TTM，未处理年报后股本变化",
          },
          pe === null
            ? "EPS 非正、价格缺失或币种无法核对，PE 无法判断"
            : "参考静态 PE，非 TTM，未处理股本变化",
        );
        if (quotes) {
          evidence.pe_static.requestIds.push(quotes.requestId);
          evidence.pe_static.raw.quoteSourceUrl = quotes.url;
        }
        if (quoteError)
          evidence.pe_static = {
            ...evidence.pe_static,
            value: null,
            status: "error",
            reason: quoteError,
          };
        else if (
          !quoteTimestamp ||
          day(quoteTimestamp) < day(lastDay) ||
          quoteTimestamp > now + 60_000
        )
          evidence.pe_static = {
            ...evidence.pe_static,
            status: "stale",
            reason: "行情时点未知、过期或晚于获取时点，不能作为有效估值依据",
          };
        if (Number(current.fiscal_year) < expectedFY)
          for (const metric of [
            "revenue_yoy",
            "profit_yoy",
            "pe_static",
          ] as const)
            evidence[metric] = {
              ...evidence[metric],
              status: "stale",
              reason: `年报过旧：预期至少 ${expectedFY} 年报，当前仅 ${current.fiscal_year}`,
            };
      } else
        for (const metric of [
          "revenue_yoy",
          "profit_yoy",
          "pe_static",
        ] as const)
          evidence[metric] = empty("没有披露时间有效的年度合并利润表");
    } catch (e) {
      for (const metric of ["revenue_yoy", "profit_yoy", "pe_static"] as const)
        evidence[metric] = empty(failureText(e), "error");
    }
    try {
      const history = await client.get("a-share/prices/historical", {
        thscode: code,
        interval: "1d",
        start: String(expectedDays[0]),
        end: String(lastDay + 86400_000 - 1),
        adjust: "forward",
      });
      const bars = items(history),
        byDay = new Map(bars.map((b) => [day(Number(b.date_ms)), b]));
      const prices = expectedDays.map((d) => {
        const b = byDay.get(day(d));
        return b && Number(b.volume) > 0 ? number(b.close_price) : null;
      });
      const valid = prices.every((p): p is number => p !== null && p > 0);
      const statistics = valid ? priceStatistics(prices as number[]) : null;
      const asOf = `${day(expectedDays[0])} 至 ${day(lastDay)}，61 个完整交易日收盘点`;
      for (const [metric, value] of [
        ["volatility_60", statistics?.volatility ?? null],
        ["drawdown_60", statistics?.drawdown ?? null],
      ] as const) {
        evidence[metric] = proof(
          history,
          value,
          asOf,
          {
            thscode: code,
            adjust: "forward",
            interval: "1d",
            dates: expectedDays.map(day),
            closes: prices,
            volumeChecked: true,
            observations: prices.filter((x) => x !== null).length,
            annualization: 252,
            standardDeviation: "sample, n-1",
          },
          value === null
            ? "61 个交易日窗口有缺失、停牌或无效价格，不能计算"
            : "前复权日收盘价计算；不代表未来波动",
        );
      }
    } catch (e) {
      evidence.volatility_60 = empty(failureText(e), "error");
      evidence.drawdown_60 = empty(failureText(e), "error");
    }
    if (Object.values(evidence).some((e) => e.status !== "valid"))
      warnings.push(`${code} 存在缺失、过期或接口异常，请展开证据查看。`);
    stocks.push({
      code,
      name: typeof member.name === "string" ? member.name : code,
      price,
      evidence,
    });
  }
  return snapshotSchema.parse({
    id: `live-${crypto.randomUUID()}`,
    mode: "live",
    createdAt: new Date().toISOString(),
    asOf: day(lastDay),
    universe: strategy.universe,
    universeTotal: unique.length,
    universeAsOf: number(constituents.data.timestamp)
      ? day(Number(constituents.data.timestamp))
      : "成分时点未返回，仅确认为本次获取的当前成分",
    scopeNote: `当前成分按代码升序取前 ${selected.length} 只，非全指数筛选，不代表全市场；无投资推荐含义。`,
    warnings,
    stocks,
  });
}
