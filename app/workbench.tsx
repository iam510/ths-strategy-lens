"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Database,
  Download,
  FileCheck2,
  FlaskConical,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  conflicts,
  defaultStrategy,
  difference,
  metricKeys,
  metrics,
  operators,
  screen,
  snapshotSchema,
  strategySchema,
  universeNames,
  type Condition,
  type Evaluation,
  type Metric,
  type Snapshot,
  type Status,
  type Strategy,
} from "@/src/domain/strategy";
import { demoIntent, type IntentOutput } from "@/src/domain/intent";

type Saved = {
  id: string;
  savedAt: string;
  strategy: Strategy;
  mode: "live" | "demo";
};
type Execution = { strategy: Strategy; rows: Evaluation[]; snapshotId: string };
const STORAGE = "strategy-lens.saved.v1";
const REVIEW_STORAGE = "strategy-lens.review-access.v1";
let activeReviewCode = "";
const labels: Record<Status, string> = {
  pass: "入选",
  fail: "排除",
  unknown: "无法判断",
};
const dateTime = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const display = (v: number | null, unit = "") =>
  v === null ? "—" : `${v.toFixed(2)}${unit}`;
async function request<T>(url: string, body?: unknown): Promise<T> {
  const headers = new Headers(
    body ? { "Content-Type": "application/json" } : {},
  );
  if (typeof window !== "undefined") {
    try {
      activeReviewCode ||= sessionStorage.getItem(REVIEW_STORAGE) || "";
    } catch {}
    if (activeReviewCode) headers.set("X-Review-Access", activeReviewCode);
  }
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(url.includes("screen") ? 210_000 : 45_000),
  });
  const result: unknown = await response.json();
  const problem =
    result && typeof result === "object" && "error" in result
      ? (result as { error: { message?: string; code?: string } }).error
      : null;
  if (problem?.code === "REVIEW_ACCESS" && typeof window !== "undefined") {
    activeReviewCode = "";
    try {
      sessionStorage.removeItem(REVIEW_STORAGE);
    } catch {}
    window.dispatchEvent(new Event("review-access-locked"));
  }
  if (!response.ok || problem)
    throw new Error(problem?.message || `请求失败（HTTP ${response.status}）`);
  return result as T;
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="关闭弹窗">
          <X size={19} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export default function Workbench() {
  const [strategy, setStrategy] = useState<Strategy>(copy(defaultStrategy));
  const [text, setText] = useState("经营改善、估值合理、走势相对稳定的 A 股");
  const [analysis, setAnalysis] = useState<
    (IntentOutput & { mode?: string; model?: string }) | null
  >(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [config, setConfig] = useState<{
    dataConfigured: boolean;
    aiConfigured: boolean;
    reviewAccessRequired: boolean;
    reviewAccessGranted: boolean;
  } | null>(null);
  const [configError, setConfigError] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [comparison, setComparison] = useState<{
    before: Strategy;
    after: Strategy;
    changes: ReturnType<typeof difference>;
  } | null>(null);
  const [filter, setFilter] = useState<Status | "all">("pass");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<"ai" | "screen" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [dialog, setDialog] = useState<
    "settings" | "save" | "saved" | "compare" | "about" | "review" | null
  >(null);
  const [saveName, setSaveName] = useState("");
  const [reviewCode, setReviewCode] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewLocked = Boolean(
    config?.reviewAccessRequired && !config.reviewAccessGranted,
  );
  const [selected, setSelected] = useState<Evaluation | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const issues = conflicts(strategy.conditions);
  const valid = strategySchema.safeParse(strategy).success;
  const unanswered =
    analysis?.questions.some((q) => answers[q.id] === undefined) ?? false;
  const unsupported = Boolean(analysis?.unsupported.length);
  const dirty =
    !!execution &&
    (execution.strategy.universe !== strategy.universe ||
      JSON.stringify(execution.strategy.conditions) !==
        JSON.stringify(strategy.conditions));
  const counts = {
    pass: execution?.rows.filter((r) => r.status === "pass").length ?? 0,
    fail: execution?.rows.filter((r) => r.status === "fail").length ?? 0,
    unknown: execution?.rows.filter((r) => r.status === "unknown").length ?? 0,
  };
  const rows =
    execution?.rows.filter(
      (r) =>
        (filter === "all" || r.status === filter) &&
        `${r.stock.code}${r.stock.name}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const columns = [
    ...new Set(
      execution?.strategy.conditions.map((c) => c.metric) ??
        strategy.conditions.map((c) => c.metric),
    ),
  ];
  async function refreshConfig() {
    try {
      setConfig(await request("/api/config"));
      setConfigError(false);
    } catch {
      setConfigError(true);
    }
  }
  useEffect(() => {
    const onReviewLocked = () => {
      void refreshConfig();
    };
    window.addEventListener("review-access-locked", onReviewLocked);
    void refreshConfig();
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE) || "[]");
      if (!Array.isArray(stored) || stored.length > 20) throw new Error();
      setSaved(
        stored.map((v) => ({
          id: String(v.id).slice(0, 100),
          savedAt: String(v.savedAt),
          strategy: strategySchema.parse(v.strategy),
          mode: v.mode === "demo" ? ("demo" as const) : ("live" as const),
        })),
      );
    } catch {
      setNotice(
        "本地策略记录不可读取，已保留原始存储；可导入有效策略文件继续。",
      );
    }
    return () =>
      window.removeEventListener("review-access-locked", onReviewLocked);
  }, []);
  async function unlockReview() {
    setReviewBusy(true);
    setReviewError("");
    const code = reviewCode.trim();
    try {
      await request("/api/review-access", { code });
      activeReviewCode = code;
      try {
        sessionStorage.setItem(REVIEW_STORAGE, code);
      } catch {}
      await refreshConfig();
      setReviewCode("");
      setDialog(null);
      setError("");
      setNotice("评审访问已解锁，可使用 AI 与真实数据服务。");
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "访问码验证失败。");
    } finally {
      setReviewBusy(false);
    }
  }
  function update(next: Strategy) {
    setStrategy(next);
    setConfirmed(false);
    setError("");
  }
  function change(id: string, patch: Partial<Condition>) {
    update({
      ...strategy,
      conditions: strategy.conditions.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  }
  function persist(items: Saved[]) {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(items));
      setSaved(items);
      return true;
    } catch {
      setError("浏览器存储不可用，保存未成功。请使用 JSON 导出。");
      return false;
    }
  }
  async function parse() {
    if (reviewLocked) {
      setDialog("review");
      return;
    }
    setBusy("ai");
    setError("");
    setNotice("");
    try {
      const result = await request<
        IntentOutput & { mode: string; model: string }
      >("/api/intent", { text });
      setAnalysis(result);
      setAnswers({});
      update({ ...strategy, conditions: result.conditions });
      setNotice("模型已提出条件，请完成必要澄清并核对阈值。尚未执行筛选。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "模型请求失败。");
    } finally {
      setBusy(null);
    }
  }
  function preset() {
    setMode("demo");
    setSnapshot(null);
    setExecution(null);
    setComparison(null);
    setSelected(null);
    setAnalysis(copy(demoIntent));
    setAnswers({});
    setStrategy(copy(defaultStrategy));
    setConfirmed(false);
    setError("");
    setNotice("已进入构造数据体验，问题和条件均为预设，不是模型输出。");
  }
  async function run(refresh = false) {
    if (mode === "live" && reviewLocked) {
      setDialog("review");
      return;
    }
    if (!confirmed || issues.length || unanswered || unsupported) return;
    setBusy("screen");
    setError("");
    setNotice("");
    try {
      const checked = strategySchema.parse(strategy);
      let next = snapshot;
      if (
        !next ||
        next.mode !== mode ||
        next.universe !== strategy.universe ||
        refresh
      )
        next = snapshotSchema.parse(
          (
            await request<{ snapshot: Snapshot }>("/api/screen", {
              strategy: checked,
              mode,
            })
          ).snapshot,
        );
      const evaluated = screen(next, checked);
      setComparison(
        execution && execution.snapshotId === next.id
          ? {
              before: execution.strategy,
              after: copy(checked),
              changes: difference(execution.rows, evaluated),
            }
          : null,
      );
      setSnapshot(next);
      setExecution({
        strategy: copy(checked),
        rows: evaluated,
        snapshotId: next.id,
      });
      setSelected(null);
      setFilter("pass");
      setNotice(
        execution?.snapshotId === next.id
          ? "已使用同一快照重新筛选，可查看条件修改的影响。"
          : `${mode === "demo" ? "构造数据体验" : "真实数据筛选"}已完成；新快照不与旧数据混合比较。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "筛选失败，未生成正常结论。");
    } finally {
      setBusy(null);
    }
  }
  function clearResults() {
    setSnapshot(null);
    setExecution(null);
    setComparison(null);
    setSelected(null);
  }
  function download() {
    try {
      const blob = new Blob(
        [JSON.stringify(strategySchema.parse(strategy), null, 2)],
        { type: "application/json;charset=utf-8" },
      );
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "strategy-lens-v1.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("已导出条件，不包含密钥或行情数据。");
    } catch {
      setError("条件无效，无法导出。");
    }
  }
  async function importStrategy(input?: File) {
    if (!input) return;
    try {
      if (input.size > 50_000) throw new Error("文件超过 50 KB 限制。");
      const next = strategySchema.parse(JSON.parse(await input.text()));
      if (conflicts(next.conditions).length)
        throw new Error("导入条件存在冲突。");
      update(next);
      setAnalysis(null);
      setAnswers({});
      clearResults();
      setNotice("已导入条件，请确认数据模式、核对口径并重新执行。");
      setDialog(null);
    } catch {
      setError(
        "文件无法导入：请检查 JSON 格式、版本、指标、条件冲突或 50 KB 大小限制。",
      );
    } finally {
      if (file.current) file.current.value = "";
    }
  }
  return (
    <div className="app-shell">
      <aside className="navigation">
        <a className="brand" href="/" aria-label="析选首页">
          <span className="brand-symbol">
            <Layers3 size={23} />
          </span>
          <span>
            析选<span className="brand-en">STRATEGY LENS</span>
          </span>
        </a>
        <div className="nav-section">研究空间</div>
        <button
          className="nav-item active"
          onClick={() => {
            setDialog(null);
            document.getElementById("intent-input")?.focus();
          }}
        >
          <SlidersHorizontal size={18} />
          条件工作台
          <span className="nav-dot" />
        </button>
        <button className="nav-item" onClick={() => setDialog("saved")}>
          <Bookmark size={18} />
          已存策略<span className="nav-count">{saved.length}</span>
        </button>
        <button className="nav-item" onClick={() => setDialog("compare")}>
          <Layers3 size={18} />
          条件比较
        </button>
        <div className="nav-bottom">
          <div className="nav-note">
            <ShieldCheck size={20} />
            <strong>每个结论，都有依据</strong>
            <p>
              看清条件、数据与边界，
              <br />
              让研究过程可以复核。
            </p>
          </div>
          <button className="nav-item" onClick={() => setDialog("about")}>
            <CircleHelp size={18} />
            产品说明
          </button>
          <span className="nav-version">同花顺 AI 笔试 · 第一题</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            研究空间
            <ChevronRight size={13} />
            <span>条件工作台</span>
          </div>
          <button
            className="connection-button"
            onClick={() => setDialog("settings")}
          >
            <span
              className={`connection-dot ${config?.dataConfigured ? "configured" : ""}`}
            />
            {configError
              ? "接入状态读取失败"
              : snapshot?.mode === "live" && execution
                ? "已获取真实快照"
                : config?.dataConfigured
                  ? "数据密钥已配置 · 待实测"
                  : "真实数据未接入"}
            <Settings2 size={14} />
          </button>
        </header>
        <main className="workspace">
          <div className="page-heading">
            <div>
              <div className="eyebrow">FROM INTENT TO EVIDENCE</div>
              <h1>
                把选股想法，变成可核验的条件<span>。</span>
              </h1>
              <p>先定义你想找什么，再看数据是否支持。</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => setDialog("saved")}
            >
              <FolderOpen size={16} />
              我的策略
            </button>
          </div>
          {reviewLocked && (
            <div className="banner review-banner">
              <ShieldCheck size={18} />
              <span>
                评审体验无需登录。输入提交说明中的访问码，即可使用 AI
                与真实数据；构造体验可直接使用。
              </span>
              <button
                className="secondary-button small"
                onClick={() => {
                  setReviewError("");
                  setDialog("review");
                }}
              >
                输入评审访问码
              </button>
            </div>
          )}
          <div className="context-bar">
            <span className="context-label">
              <Database size={15} />
              数据模式
            </span>
            <div className="mode-switch" role="group" aria-label="数据模式">
              {(["live", "demo"] as const).map((m) => (
                <button
                  key={m}
                  className={
                    mode === m
                      ? `selected ${m === "demo" ? "demo-selected" : ""}`
                      : ""
                  }
                  disabled={!!busy}
                  onClick={() => {
                    setMode(m);
                    clearResults();
                  }}
                >
                  {m === "live" ? "真实数据" : "构造数据体验"}
                </button>
              ))}
            </div>
            <span className="context-divider" />
            <label className="universe-label" htmlFor="universe">
              研究范围
            </label>
            <select
              id="universe"
              value={strategy.universe}
              disabled={!!busy}
              onChange={(e) => {
                update({
                  ...strategy,
                  universe: e.target.value as Strategy["universe"],
                });
                clearResults();
              }}
            >
              <option value="000300.SH">沪深 300 · 前 12 只样本</option>
              <option value="000016.SH">上证 50 · 前 12 只样本</option>
            </select>
            <span className="context-end">
              {mode === "demo"
                ? "虚构样本，不构成选股结论"
                : "成分按代码升序取样，非全市场筛选"}
            </span>
          </div>
          {mode === "demo" && (
            <div className="banner demo-banner">
              <FlaskConical size={17} />
              <span>
                <strong>构造数据体验</strong> ·
                所有名称和数字均为构造；真实数据和模型能力需单独接入验证。
              </span>
            </div>
          )}
          {error && (
            <div className="banner error-banner" role="alert">
              <CircleHelp size={18} />
              <span>
                {error}
                {execution && " 当前表格仍为上次成功结果，未生成新结论。"}
              </span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="关闭错误提示"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <CheckCheck size={15} />
              {notice}
            </div>
          )}
          <div className="work-grid">
            <section className="condition-panel" aria-label="意图与条件">
              <div className="section-heading">
                <span className="step-number">01</span>
                <h2>描述你的选股想法</h2>
                <Sparkles size={16} className="blue-icon" />
              </div>
              <label htmlFor="intent-input" className="sr-only">
                选股意图
              </label>
              <textarea
                id="intent-input"
                maxLength={1500}
                value={text}
                disabled={!!busy}
                onChange={(e) => setText(e.target.value)}
                placeholder="例如：营收在增长，估值别太高，走势平稳一些……"
              />
              <div className="input-meta">
                <span>自然语言 → 可执行条件</span>
                <span>{text.length}/1500</span>
              </div>
              <button
                className="primary-button parse-button"
                disabled={!!busy || text.trim().length < 2}
                onClick={parse}
              >
                {busy === "ai" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
                {busy === "ai"
                  ? "正在理解意图…"
                  : reviewLocked
                    ? "输入评审访问码"
                    : "用 AI 拆解条件"}
                <ArrowRight size={15} />
              </button>
              <div className="input-alternatives">
                <button
                  className="text-button"
                  onClick={preset}
                  disabled={!!busy}
                >
                  试用预设构造场景
                </button>
                <span>或</span>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => {
                    setAnalysis(null);
                    setAnswers({});
                    setConfirmed(false);
                    setNotice("已切换手动配置，请逐项核对建议值。");
                  }}
                >
                  手动配置
                </button>
              </div>
              {analysis && (
                <div className="analysis-box">
                  <span className="tiny-tag">
                    {analysis.mode === "model"
                      ? `模型解析 · ${analysis.model}`
                      : "预设示例 · 非 AI 解析"}
                  </span>
                  <p>{analysis.summary}</p>
                  {analysis.questions.map((q) => (
                    <fieldset className="clarification" key={q.id}>
                      <legend>{q.question}</legend>
                      {q.options.map((o, i) => (
                        <label key={i}>
                          <input
                            type="radio"
                            name={q.id}
                            checked={answers[q.id] === i}
                            disabled={!!busy}
                            onChange={() => {
                              setAnswers({ ...answers, [q.id]: i });
                              change(o.condition.id, o.condition);
                            }}
                          />
                          {o.label}
                        </label>
                      ))}
                    </fieldset>
                  ))}
                  {unsupported && (
                    <div className="unsupported">
                      <strong>以下意图尚不支持：</strong>
                      <ul>
                        {analysis.unsupported.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                      <p>请改写后重新解析，或选择“手动配置”明确条件。</p>
                    </div>
                  )}
                </div>
              )}
              <div className="conditions-heading">
                <div className="section-heading">
                  <span className="step-number">02</span>
                  <h2>核对筛选条件</h2>
                </div>
                <span className="count-badge">
                  {strategy.conditions.length} 条 · AND
                </span>
              </div>
              <p className="helper">
                以下为可修改的建议值，全部条件同时满足才入选。
              </p>
              <fieldset className="conditions-fieldset" disabled={!!busy}>
                {strategy.conditions.map((c, index) => (
                  <div className="condition-card" key={c.id}>
                    <div className="condition-top">
                      <span className="condition-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <label className="sr-only" htmlFor={`metric-${c.id}`}>
                        条件 {index + 1} 指标
                      </label>
                      <select
                        id={`metric-${c.id}`}
                        value={c.metric}
                        onChange={(e) =>
                          change(c.id, { metric: e.target.value as Metric })
                        }
                      >
                        {metricKeys.map((k) => (
                          <option key={k} value={k}>
                            {metrics[k].label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="icon-button"
                        aria-label={`删除条件 ${index + 1}`}
                        disabled={strategy.conditions.length <= 1}
                        onClick={() =>
                          update({
                            ...strategy,
                            conditions: strategy.conditions.filter(
                              (p) => p.id !== c.id,
                            ),
                          })
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="condition-values">
                      <span>条件</span>
                      <label className="sr-only" htmlFor={`op-${c.id}`}>
                        条件 {index + 1} 运算符
                      </label>
                      <select
                        id={`op-${c.id}`}
                        value={c.op}
                        onChange={(e) =>
                          change(c.id, {
                            op: e.target.value as Condition["op"],
                          })
                        }
                      >
                        {Object.entries(operators).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor={`value-${c.id}`}>
                        条件 {index + 1} 阈值
                      </label>
                      <input
                        id={`value-${c.id}`}
                        type="number"
                        step="0.1"
                        min="-100000"
                        max="100000"
                        value={Number.isNaN(c.value) ? "" : c.value}
                        onChange={(e) =>
                          change(c.id, {
                            value:
                              e.target.value === ""
                                ? NaN
                                : Number(e.target.value),
                          })
                        }
                      />
                      <span className="unit">{metrics[c.metric].unit}</span>
                    </div>
                    <details className="basis">
                      <summary>
                        <CircleHelp size={12} />
                        查看指标口径
                      </summary>
                      <p>{metrics[c.metric].basis}</p>
                    </details>
                  </div>
                ))}
                <button
                  className="add-condition"
                  disabled={strategy.conditions.length >= 12}
                  onClick={() =>
                    update({
                      ...strategy,
                      conditions: [
                        ...strategy.conditions,
                        {
                          id: crypto.randomUUID(),
                          metric: "profit_yoy",
                          op: "gt",
                          value: 0,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={15} />
                  添加条件
                </button>
              </fieldset>
              {(issues.length > 0 || !valid) && (
                <div className="inline-error" role="alert">
                  {issues.length
                    ? issues.map((i) => <p key={i}>{i}</p>)
                    : "请填写有效阈值（−100000 至 100000）。"}
                </div>
              )}
              <label className="confirm-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!!busy || unanswered || unsupported}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  我已核对条件、阈值与统计口径
                  {unanswered && "（请先完成上方澄清）"}
                </span>
              </label>
              <button
                className="primary-button run-button"
                disabled={
                  !!busy ||
                  !confirmed ||
                  unanswered ||
                  unsupported ||
                  issues.length > 0 ||
                  !valid
                }
                onClick={() => run()}
              >
                {busy === "screen" ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <SlidersHorizontal size={17} />
                )}
                {busy === "screen"
                  ? "正在获取并核验数据…"
                  : snapshot
                    ? "应用条件 · 比较变化"
                    : "执行筛选"}
                <ArrowRight size={16} />
              </button>
              <div className="engine-note">
                <ShieldCheck size={13} />
                由确定性引擎计算 · 不预测涨跌
              </div>
            </section>
            <section className="results-panel" aria-label="筛选结果">
              <div className="results-heading">
                <div>
                  <div className="section-heading">
                    <span className="step-number">03</span>
                    <h2>筛选结果</h2>
                    {execution && (
                      <span
                        className={`tiny-tag ${snapshot?.mode === "demo" ? "amber" : ""}`}
                      >
                        {snapshot?.mode === "demo" ? "构造数据" : "真实数据"}
                      </span>
                    )}
                  </div>
                  <p>
                    {execution
                      ? `${universeNames[execution.strategy.universe]} · ${snapshot?.mode === "demo" ? "虚构样本体验" : "代码升序样本"}`
                      : "确认条件后，在这里查看逐项依据"}
                  </p>
                </div>
                <div className="result-actions">
                  <button
                    className="icon-button"
                    aria-label="刷新数据并重新筛选"
                    title="刷新数据后重建基线"
                    disabled={
                      !!busy ||
                      !execution ||
                      !confirmed ||
                      !valid ||
                      issues.length > 0 ||
                      unanswered ||
                      unsupported
                    }
                    onClick={() => run(true)}
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    className="secondary-button small"
                    disabled={!!busy || !valid || issues.length > 0}
                    onClick={() => {
                      setSaveName(strategy.name);
                      setDialog("save");
                    }}
                  >
                    <Bookmark size={14} />
                    保存策略
                  </button>
                </div>
              </div>
              {dirty && (
                <div className="pending-banner">
                  <Settings2 size={15} />
                  条件有未执行修改。下方仍为上次结果，核对后点击“应用条件”。
                </div>
              )}
              {comparison && (
                <button
                  className="comparison-banner"
                  onClick={() => setDialog("compare")}
                >
                  <Layers3 size={16} />
                  <span>
                    同一快照 · {comparison.changes.length} 个样本的入选状态改变
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              )}
              <div className="result-summary">
                {(["pass", "fail", "unknown"] as const).map((s) => (
                  <button
                    key={s}
                    className={`summary-card ${s} ${filter === s ? "chosen" : ""}`}
                    onClick={() => setFilter(s)}
                  >
                    <span>
                      <i />
                      {labels[s]}
                    </span>
                    <strong>
                      {execution ? String(counts[s]).padStart(2, "0") : "—"}
                    </strong>
                    <small>
                      {s === "pass"
                        ? "全部条件满足"
                        : s === "fail"
                          ? "至少一项明确不满足"
                          : "缺失或失效项待核实"}
                    </small>
                  </button>
                ))}
              </div>
              <div className="table-tools">
                <div className="result-tabs" role="group" aria-label="结果分类">
                  {(["pass", "fail", "unknown", "all"] as const).map((s) => (
                    <button
                      key={s}
                      className={filter === s ? "selected" : ""}
                      onClick={() => setFilter(s)}
                    >
                      {s === "all" ? "全部" : labels[s]}
                      {execution && (
                        <span>
                          {s === "all" ? execution.rows.length : counts[s]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <label className="search-field">
                  <Search size={14} />
                  <input
                    aria-label="搜索股票代码或名称"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="代码 / 名称"
                  />
                </label>
              </div>
              {execution ? (
                <>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>样本 / 股票</th>
                          {columns.map((m) => (
                            <th key={m}>
                              {metrics[m].label}
                              <small>{metrics[m].unit}</small>
                            </th>
                          ))}
                          <th>判定</th>
                          <th>
                            <span className="sr-only">证据</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.stock.code}>
                            <td>
                              <button
                                className="stock-name"
                                onClick={() => setSelected(row)}
                              >
                                {row.stock.name}
                              </button>
                              <span className="stock-code">
                                {row.stock.code}
                              </span>
                            </td>
                            {columns.map((m) => (
                              <td
                                key={m}
                                className={`numeric ${row.stock.evidence[m].status !== "valid" ? "unavailable" : ""}`}
                              >
                                {row.stock.evidence[m].status === "valid"
                                  ? display(row.stock.evidence[m].value)
                                  : "—"}
                                {row.stock.evidence[m].status !== "valid" && (
                                  <small>待核实</small>
                                )}
                              </td>
                            ))}
                            <td>
                              <span className={`status-tag ${row.status}`}>
                                {labels[row.status]}
                              </span>
                            </td>
                            <td>
                              <button
                                className="evidence-button"
                                aria-label={`查看${row.stock.name}证据`}
                                onClick={() => setSelected(row)}
                              >
                                <ArrowUpRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!rows.length && (
                      <div className="empty-filter">
                        <Search size={24} />
                        <h3>当前视图没有结果</h3>
                        <p>
                          {search
                            ? "尝试其他代码或名称，或清空搜索。"
                            : "切换其他分类查看原因，或修改阈值后再执行。"}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    <span>
                      已评估 {execution.rows.length} 个
                      {snapshot?.mode === "demo"
                        ? "构造样本"
                        : `样本 / 共 ${snapshot?.universeTotal} 只当前成分`}
                    </span>
                    <span>
                      点击样本查看证据
                      <ArrowUpRight size={12} />
                    </span>
                  </div>
                  <div className="snapshot-box">
                    <div>
                      <Database size={15} />
                      <strong>本次数据快照</strong>
                      <span className="tiny-tag">
                        {snapshot?.mode === "demo" ? "构造" : "实时获取"}
                      </span>
                    </div>
                    <dl>
                      <dt>市场数据截至</dt>
                      <dd>{snapshot?.asOf}</dd>
                      <dt>获取完成时间</dt>
                      <dd>
                        {snapshot && dateTime(snapshot.createdAt)}（北京时间）
                      </dd>
                      <dt>快照 ID</dt>
                      <dd className="mono">{snapshot?.id}</dd>
                      <dt>研究范围</dt>
                      <dd>{snapshot?.scopeNote}</dd>
                      <dt>成分时点</dt>
                      <dd>{snapshot?.universeAsOf}</dd>
                    </dl>
                    {snapshot && snapshot.warnings.length > 0 && (
                      <details className="data-warnings">
                        <summary>
                          {snapshot.warnings.length} 项数据说明 / 异常
                        </summary>
                        <ul>
                          {snapshot.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </>
              ) : (
                <div className="results-empty">
                  <div className="empty-illustration">
                    {[0, 1, 2].map((i) => (
                      <div
                        className={`illustration-line ${i === 2 ? "muted" : ""}`}
                        key={i}
                      >
                        {i === 2 ? (
                          <CircleHelp size={15} />
                        ) : (
                          <Check size={15} />
                        )}
                        <span />
                        <span />
                      </div>
                    ))}
                    <div className="illustration-lens">
                      <Search size={25} />
                    </div>
                  </div>
                  <h3>好结果，始于清晰的条件</h3>
                  <p>
                    执行筛选后，查看每个样本的入选或排除原因，
                    <br />
                    以及可追溯的数据来源和统计口径。
                  </p>
                  <div className="empty-steps">
                    <span>
                      <span>1</span>确认条件
                    </span>
                    <ArrowRight size={12} />
                    <span>
                      <span>2</span>确定性筛选
                    </span>
                    <ArrowRight size={12} />
                    <span>
                      <span>3</span>核验证据
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={!!busy}
                    onClick={preset}
                  >
                    <FlaskConical size={15} />
                    先体验完整交互
                  </button>
                </div>
              )}
              <div className="research-note">
                <ShieldCheck size={17} />
                <p>
                  <strong>研究依据，不是买卖建议。</strong>{" "}
                  筛选只表示数据符合所选条件，不代表未来表现；缺失和异常不会被视为满足条件。
                </p>
              </div>
            </section>
          </div>
          <footer className="workspace-footer">
            <span>析选 · 每一步都可检查</span>
            <span>AI 理解意图 · 引擎执行条件 · 数据支持结论</span>
          </footer>
        </main>
      </div>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => importStrategy(e.target.files?.[0])}
      />
      {dialog === "settings" && (
        <Modal title="数据与模型接入" close={() => setDialog(null)}>
          <p>模型和金融数据密钥仅配置在服务端。评审访问码由提交说明提供。</p>
          {config?.reviewAccessRequired && (
            <button
              className="secondary-button"
              onClick={() => {
                setReviewError("");
                setDialog("review");
              }}
            >
              {config.reviewAccessGranted ? "更新评审访问码" : "输入评审访问码"}
            </button>
          )}
          <div className="connection-row">
            <Database size={19} />
            <div>
              <strong>扶摇金融数据</strong>
              <p>
                {config?.dataConfigured
                  ? "密钥已配置，需执行筛选验证接口权限与字段。"
                  : "尚未配置 FUYAO_API_KEY，无法验证真实数据。"}
              </p>
            </div>
          </div>
          <div className="connection-row">
            <Sparkles size={19} />
            <div>
              <strong>模型意图解析</strong>
              <p>
                {config?.aiConfigured
                  ? "连接参数已配置，需实际解析确认可用。"
                  : "尚未配置 AI_BASE_URL、AI_API_KEY、AI_MODEL。"}
              </p>
            </div>
          </div>
          <p>
            本地：复制 <code>web/.env.example</code> 为{" "}
            <code>web/.env.local</code>
            ，配置后重启服务。托管版需由拥有者配置运行时密钥并重新部署。
          </p>
          <div className="modal-links">
            <a
              href="https://fuyao.aicubes.cn/admin/"
              target="_blank"
              rel="noreferrer"
            >
              扶摇密钥管理
              <ArrowUpRight size={14} />
            </a>
            <a
              href="https://api-docs.deepseek.com/"
              target="_blank"
              rel="noreferrer"
            >
              兼容模型接入示例
              <ArrowUpRight size={14} />
            </a>
          </div>
          <button className="secondary-button" onClick={refreshConfig}>
            <RefreshCw size={14} />
            重新读取状态
          </button>
        </Modal>
      )}
      {dialog === "review" && (
        <Modal title="评审访问" close={() => setDialog(null)}>
          <p>
            输入提交说明中的访问码，解锁 AI 解析和真实数据筛选。无需注册或登录。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlockReview();
            }}
          >
            <label className="form-label" htmlFor="review-access-code">
              评审访问码
            </label>
            <input
              className="full-input"
              id="review-access-code"
              type="password"
              autoComplete="off"
              maxLength={128}
              value={reviewCode}
              disabled={reviewBusy}
              onChange={(e) => setReviewCode(e.target.value)}
            />
            {reviewError && (
              <p role="alert" className="review-error">
                {reviewError}
              </p>
            )}
            <p className="helper">
              访问状态仅保留在当前标签页；模型和金融接口密钥不会发送到浏览器。
            </p>
            <div className="modal-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={reviewBusy || !reviewCode.trim()}
              >
                {reviewBusy ? "正在验证…" : "解锁真实服务"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "save" && (
        <Modal title="保存当前策略" close={() => setDialog(null)}>
          <p>仅保存条件，保存在当前浏览器，不跨设备同步。建议同时导出 JSON。</p>
          <label className="form-label" htmlFor="strategy-name">
            策略名称
          </label>
          <input
            className="full-input"
            id="strategy-name"
            maxLength={80}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <p className="helper">
            {mode === "demo"
              ? "此记录标记为构造模式。"
              : "载入时需要重新获取真实数据。"}
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={download}>
              <Download size={15} />
              导出条件
            </button>
            <button
              className="primary-button"
              disabled={!saveName.trim() || saved.length >= 20}
              onClick={() => {
                const next = { ...strategy, name: saveName.trim() };
                if (
                  persist([
                    {
                      id: crypto.randomUUID(),
                      savedAt: new Date().toISOString(),
                      strategy: copy(next),
                      mode,
                    },
                    ...saved,
                  ])
                ) {
                  setStrategy(next);
                  setDialog(null);
                  setNotice("策略已保存，可从“已存策略”重新载入。");
                }
              }}
            >
              <Bookmark size={15} />
              保存到此浏览器
            </button>
          </div>
          {saved.length >= 20 && (
            <p className="inline-error">最多保存 20 个，请先删除旧记录。</p>
          )}
        </Modal>
      )}
      {dialog === "saved" && (
        <Modal title="已存策略" close={() => setDialog(null)}>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => file.current?.click()}
            >
              <Upload size={15} />
              导入策略 JSON
            </button>
            <button className="secondary-button" onClick={download}>
              <Download size={15} />
              导出当前条件
            </button>
          </div>
          <p className="helper">仅保存条件，不包含行情或密钥。</p>
          {saved.length ? (
            saved.map((item) => (
              <div className="saved-item" key={item.id}>
                <div>
                  <strong>{item.strategy.name}</strong>
                  <p>
                    {item.strategy.conditions.length} 条条件 ·{" "}
                    {universeNames[item.strategy.universe]} ·{" "}
                    {item.mode === "demo" ? "构造模式" : "真实数据模式"}
                  </p>
                  <small>{dateTime(item.savedAt)}</small>
                </div>
                <button
                  className="secondary-button small"
                  onClick={() => {
                    update(copy(item.strategy));
                    setMode(item.mode);
                    setAnalysis(null);
                    setAnswers({});
                    clearResults();
                    setDialog(null);
                    setNotice("策略已载入，请核对后重新执行。");
                  }}
                >
                  载入
                </button>
                <button
                  className="icon-button"
                  aria-label={`删除策略${item.strategy.name}`}
                  onClick={() => persist(saved.filter((s) => s.id !== item.id))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          ) : (
            <div className="compact-empty">
              <Bookmark size={30} />
              <h3>还没有保存的策略</h3>
              <p>在工作台编辑条件后点击“保存策略”。</p>
            </div>
          )}
        </Modal>
      )}
      {dialog === "compare" && (
        <Modal title="条件变化与结果影响" close={() => setDialog(null)} wide>
          {comparison ? (
            <>
              <p>
                使用同一快照 <code>{execution?.snapshotId}</code>
                ；变化只来自条件修改。
              </p>
              <div className="condition-diff">
                <div>
                  <strong>修改前</strong>
                  {comparison.before.conditions.map((c) => (
                    <p key={c.id}>
                      {metrics[c.metric].label} {operators[c.op]} {c.value}
                      {metrics[c.metric].unit}
                    </p>
                  ))}
                </div>
                <ArrowRight size={18} />
                <div>
                  <strong>修改后</strong>
                  {comparison.after.conditions.map((c) => (
                    <p key={c.id}>
                      {metrics[c.metric].label} {operators[c.op]} {c.value}
                      {metrics[c.metric].unit}
                    </p>
                  ))}
                </div>
              </div>
              {comparison.changes.length ? (
                comparison.changes.map((c) => (
                  <div key={c.code} className="change-item">
                    <div>
                      <strong>{c.name}</strong>
                      <span className={`status-tag ${c.before}`}>
                        {labels[c.before]}
                      </span>
                      <ArrowRight size={13} />
                      <span className={`status-tag ${c.after}`}>
                        {labels[c.after]}
                      </span>
                    </div>
                    <p>
                      {c.reasons.join("；") ||
                        "移除原先不满足或无法判断的条件后，其余条件均满足。"}
                    </p>
                  </div>
                ))
              ) : (
                <div className="compact-empty">
                  <CheckCheck size={28} />
                  <h3>入选状态没有变化</h3>
                  <p>条件已重新计算，当前样本状态保持一致。</p>
                </div>
              )}
            </>
          ) : (
            <div className="compact-empty">
              <Layers3 size={32} />
              <h3>先完成一次筛选</h3>
              <p>
                修改条件并确认后，点击“应用条件 · 比较变化”。
                <br />
                刷新数据会建立新基线，不能与旧快照混合比较。
              </p>
            </div>
          )}
        </Modal>
      )}
      {dialog === "about" && (
        <Modal title="关于析选" close={() => setDialog(null)}>
          <p>把自然语言意图转成可检查的条件，核验依据与限制。</p>
          {[
            [
              Sparkles,
              "AI 解释意图",
              "只建议条件与必要澄清，不编造数据、不决定入选。",
            ],
            [
              SlidersHorizontal,
              "引擎执行条件",
              "同条件、同快照得到一致结果；缺失与异常单独表达。",
            ],
            [
              FileCheck2,
              "证据可追溯",
              "逐项展示原始字段、公式、时点与请求编号。构造模式仅供体验。",
            ],
          ].map(([Icon, title, content], i) => {
            const Component = Icon as typeof Sparkles;
            return (
              <div className="about-item" key={i}>
                <Component size={18} />
                <div>
                  <strong>{title as string}</strong>
                  <p>{content as string}</p>
                </div>
              </div>
            );
          })}
          <p>
            限制：指数成分代码升序前 12 只、AND 条件、年度同比、60
            日走势。参考静态 PE 非
            TTM，未处理股本变化。暂不支持全市场筛选、回测、跨设备保存和定时监控。
          </p>
          <p className="helper">
            不提供直接买卖建议、确定性涨跌预测或收益承诺。
          </p>
        </Modal>
      )}
      {selected && (
        <Modal
          title={`${selected.stock.name} · 条件证据`}
          close={() => setSelected(null)}
          wide
        >
          <div className="evidence-overview">
            <span className="mono">{selected.stock.code}</span>
            <span className={`status-tag ${selected.status}`}>
              {labels[selected.status]}
            </span>
            <span className="tiny-tag">
              {snapshot?.mode === "demo"
                ? "构造数据 · 非真实结论"
                : "真实接口数据"}
            </span>
          </div>
          <p>
            全部通过才入选；至少一项明确失败则排除，其余缺失项仍展示；没有失败但有缺失时无法判断。
          </p>
          {selected.checks.map((check, index) => (
            <article className="evidence-card" key={check.condition.id}>
              <header>
                <h3>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {metrics[check.condition.metric].label}
                </h3>
                <span className={`status-tag ${check.status}`}>
                  {check.status === "pass"
                    ? "满足"
                    : check.status === "fail"
                      ? "不满足"
                      : "无法判断"}
                </span>
              </header>
              <div className="evidence-numbers">
                <div>
                  <small>实际值</small>
                  <strong>
                    {check.evidence.status === "valid"
                      ? display(
                          check.evidence.value,
                          metrics[check.condition.metric].unit,
                        )
                      : "不可用"}
                  </strong>
                </div>
                <ArrowRight size={17} />
                <div>
                  <small>筛选条件</small>
                  <strong>
                    {operators[check.condition.op]} {check.condition.value}
                    {metrics[check.condition.metric].unit}
                  </strong>
                </div>
              </div>
              <p
                className={check.status === "unknown" ? "evidence-warning" : ""}
              >
                {check.reason}
              </p>
              <dl>
                <dt>统计口径</dt>
                <dd>{metrics[check.condition.metric].basis}</dd>
                <dt>数据时点</dt>
                <dd>{check.evidence.asOf}</dd>
                <dt>获取时间</dt>
                <dd>{dateTime(check.evidence.fetchedAt)}（北京时间）</dd>
                <dt>数据来源</dt>
                <dd>
                  {check.evidence.source}
                  {check.evidence.sourceUrl.startsWith("https://") && (
                    <a
                      href={check.evidence.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      原始接口
                      <ArrowUpRight size={12} />
                    </a>
                  )}
                </dd>
                <dt>字段状态</dt>
                <dd>
                  {check.evidence.status} · {check.evidence.reason}
                </dd>
                <dt>请求编号</dt>
                <dd className="mono">
                  {check.evidence.requestIds.join(" / ") ||
                    "构造场景或未获得响应，无真实请求编号"}
                </dd>
              </dl>
              <details className="raw-data">
                <summary>原始字段与计算依据</summary>
                <pre>{JSON.stringify(check.evidence.raw, null, 2)}</pre>
              </details>
            </article>
          ))}
        </Modal>
      )}
    </div>
  );
}
