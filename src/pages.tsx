// =============================================================
// 业务文件 3：页面
// 入库队列、鉴定/状态筛选、采集地点信息卡、馆藏柜位记录、
// 单柜盘点台、单份标本详情页。状态经 Context 共享，全部落本地。
// =============================================================

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
  CheckResult,
  HerbariumState,
  IdentifyStatus,
  PressStatus,
  Specimen,
  SpecimenDraft,
  Stocktake,
} from "./model";
import { formatTime, loadState, resetState, saveState, STORAGE_KEY } from "./model";
import {
  activeStocktakeOf,
  addSpecimen,
  buildCsv,
  canClose,
  closeStocktake,
  exportableSpecimens,
  isCabinetFrozen,
  lastCheckedAtOf,
  markMismatch,
  markMissing,
  markPresent,
  releaseDiscrepancy,
  setOperator,
  shelve,
  stocktakeHistoryOf,
  toggleNeedsPhoto,
  startStocktake,
  updateDiscrepancyDraft,
  type ApplyResult,
} from "./stocktake";

const nowIso = (): string => new Date().toISOString();

// -------------------------------------------------------------
// 全局状态：所有变更统一落 localStorage，刷新后保留
// -------------------------------------------------------------

interface StoreValue {
  state: HerbariumState;
  notice: string;
  error: string;
  setNotice: (message: string) => void;
  setError: (message: string) => void;
  apply: (result: ApplyResult, success?: string) => boolean;
  run: (fn: () => ApplyResult, success?: string) => boolean;
}

const StoreContext = createContext<StoreValue | null>(null);

function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("StoreContext missing");
  return ctx;
}

const FILTERS = ["全部", "待压制", "待鉴定", "已入库", "需补照", "待入库", "已上柜", "失联", "冻结柜位标本"] as const;
type FilterKey = (typeof FILTERS)[number];
const TABS = ["入库队列", "馆藏柜位", "盘点台", "标本浏览"] as const;
type TabKey = (typeof TABS)[number];

function cabinetNameOf(state: HerbariumState, cabinetId: string | null): string {
  if (!cabinetId) return "—";
  return state.cabinets.find((c) => c.id === cabinetId)?.name ?? cabinetId;
}

function statusBadgeClass(status: Specimen["status"]): string {
  return status === "失联" ? "badge bad" : status === "已上柜" ? "badge ok" : "badge wait";
}

const RESULT_LABEL: Record<CheckResult, string> = {
  pending: "未盘",
  present: "在位",
  missing: "失联",
  mismatch: "柜位不符",
};

export default function HerbariumPage() {
  const [state, setState] = useState<HerbariumState>(() => loadState());
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const apply = (result: ApplyResult, success?: string): boolean => {
    if (result.ok) {
      setState(result.state);
      setError("");
      if (success) setNotice(success);
      return true;
    }
    setError(result.message);
    return false;
  };
  const run = (fn: () => ApplyResult, success?: string): boolean => apply(fn(), success);

  const store: StoreValue = { state, notice, error, setNotice, setError, apply, run };

  const [tab, setTab] = useState<TabKey>("入库队列");
  const [filter, setFilter] = useState<FilterKey>("全部");
  const [keyword, setKeyword] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const detailSpecimen = detailId ? state.specimens.find((s) => s.id === detailId) ?? null : null;

  return (
    <StoreContext.Provider value={store}>
      <main className="app">
        <section className="hero compact">
          <p>hxyfront-62007 · 库房盘点闭环 · 数据仅存本浏览器（localStorage）</p>
          <h1>植物标本馆入库与盘点</h1>
          <span>
            录入压制标本并安排上柜；单柜盘点期间该柜冻结新上柜，任一份失联或柜位不符即整柜暂挂，
            差异须登记原因并经另一名盘点员确认方可放行；结项后解冻、更新盘点时间，失联标本禁止导出且历史保留。
          </span>
        </section>

        <OperatorBar />
        <MetricStrip />

        <nav className="tabs" aria-label="业务页签">
          {TABS.map((item) => (
            <button key={item} className={tab === item && !detailSpecimen ? "tab active" : "tab"} onClick={() => { setTab(item); setDetailId(null); }}>
              {item}
            </button>
          ))}
        </nav>

        {notice && <div className="toast ok" role="status">{notice}</div>}
        {error && <div className="toast bad" role="alert">{error}</div>}

        {detailSpecimen ? (
          <DetailPanel specimen={detailSpecimen} onBack={() => setDetailId(null)} />
        ) : (
          <>
            {tab === "入库队列" && <IntakeTab onOpenDetail={setDetailId} onGoCabinets={() => setTab("馆藏柜位")} />}
            {tab === "馆藏柜位" && <CabinetTab onOpenDetail={setDetailId} onGoStocktake={() => setTab("盘点台")} />}
            {tab === "盘点台" && <StocktakeTab onOpenDetail={setDetailId} />}
            {tab === "标本浏览" && (
              <BrowseTab filter={filter} setFilter={setFilter} keyword={keyword} setKeyword={setKeyword} onOpenDetail={setDetailId} />
            )}
          </>
        )}

        <footer className="footnote">
          <span>存储键：{STORAGE_KEY}；刷新页面数据不丢失。</span>
          <button
            className="ghost"
            onClick={() => {
              if (window.confirm("确认清空本地数据并恢复演示数据？此操作不可撤销。")) {
                setState(resetState());
                setDetailId(null);
                setNotice("已恢复演示数据");
              }
            }}
          >
            恢复演示数据
          </button>
        </footer>
      </main>
    </StoreContext.Provider>
  );
}

// -------------------------------------------------------------
// 当前盘点员
// -------------------------------------------------------------

function OperatorBar() {
  const { state, apply } = useStore();
  return (
    <section className="panel operator-bar">
      <label className="inline">
        <span>当前盘点员（发起人）</span>
        <input
          value={state.operator}
          placeholder="输入姓名，例如：何映雪"
          onChange={(e) => apply({ ok: true, state: setOperator(state, e.target.value) })}
        />
      </label>
      <p className="hint">差异放行时的确认人必须与发起人不是同一人。</p>
    </section>
  );
}

// -------------------------------------------------------------
// 指标
// -------------------------------------------------------------

function MetricStrip() {
  const { state } = useStore();
  const queue = state.specimens.filter((s) => s.status === "待入库").length;
  const pendingIdentify = state.specimens.filter((s) => s.identifyStatus === "待鉴定").length;
  const shelved = state.specimens.filter((s) => s.status === "已上柜").length;
  const lost = state.specimens.filter((s) => s.status === "失联").length;
  const sites = new Set(state.specimens.map((s) => s.locality).filter(Boolean)).size;
  const frozen = state.cabinets.filter((c) => isCabinetFrozen(state, c.id)).length;
  const metrics: Array<[string, number, string?]> = [
    ["入库队列", queue],
    ["待鉴定", pendingIdentify],
    ["已上柜", shelved],
    ["失联", lost, lost > 0 ? "bad" : undefined],
    ["采集点", sites],
    ["冻结柜位", frozen, frozen > 0 ? "warn" : undefined],
  ];
  return (
    <section className="metrics">
      {metrics.map(([label, value, tone]) => (
        <article key={label} className={tone === "bad" ? "tone-bad" : tone === "warn" ? "tone-warn" : ""}>
          <small>{label}</small>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

// -------------------------------------------------------------
// 入库队列：新增记录表单 + 队列 + 采集地点信息卡
// -------------------------------------------------------------

const EMPTY_DRAFT: SpecimenDraft = {
  collectNo: "",
  species: "",
  locality: "",
  altitude: "",
  habitat: "",
  collector: "",
  pressStatus: "待压制",
  identifyStatus: "待鉴定",
  needsPhoto: false,
  cabinetId: null,
};

function IntakeTab({ onOpenDetail, onGoCabinets }: { onOpenDetail: (id: string) => void; onGoCabinets: () => void }) {
  const { state, run } = useStore();
  const [draft, setDraft] = useState<SpecimenDraft>(EMPTY_DRAFT);
  const queue = state.specimens.filter((s) => s.status === "待入库");

  const set = <K extends keyof SpecimenDraft>(key: K, value: SpecimenDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = () => {
    const result = addSpecimen(state, draft, nowIso());
    if (result.ok) {
      setDraft(EMPTY_DRAFT);
      run(() => result, draft.cabinetId ? "标本已登记并直接上柜" : "标本已进入入库队列");
    } else {
      run(() => result);
    }
  };

  return (
    <>
      <section className="workspace wide-left">
        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>专业字段</p>
              <h2>新增压制标本</h2>
            </div>
            <button className="primary" onClick={submit}>登记入库</button>
          </div>
          <div className="field-grid">
            <label>
              <span>采集号 *</span>
              <input value={draft.collectNo} placeholder="如 HX-240921-01" onChange={(e) => set("collectNo", e.target.value)} />
            </label>
            <label>
              <span>物种名称 *</span>
              <input value={draft.species} placeholder="如 槭属待定" onChange={(e) => set("species", e.target.value)} />
            </label>
            <label>
              <span>采集地点</span>
              <input value={draft.locality} placeholder="如 浙江天目山·三里亭" onChange={(e) => set("locality", e.target.value)} />
            </label>
            <label>
              <span>海拔</span>
              <input value={draft.altitude} placeholder="如 1420m" onChange={(e) => set("altitude", e.target.value)} />
            </label>
            <label className="full">
              <span>生境描述</span>
              <input value={draft.habitat} placeholder="如 落叶阔叶疏林缘" onChange={(e) => set("habitat", e.target.value)} />
            </label>
            <label>
              <span>采集人</span>
              <input value={draft.collector} placeholder="采集人姓名" onChange={(e) => set("collector", e.target.value)} />
            </label>
            <label>
              <span>馆藏位置（留空进入入库队列）</span>
              <select value={draft.cabinetId ?? ""} onChange={(e) => set("cabinetId", e.target.value || null)}>
                <option value="">暂不上柜（入库队列）</option>
                {state.cabinets.map((c) => (
                  <option key={c.id} value={c.id} disabled={isCabinetFrozen(state, c.id)}>
                    {c.id} {c.name}
                    {isCabinetFrozen(state, c.id) ? "（盘点中·冻结）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>压制状态</span>
              <select value={draft.pressStatus} onChange={(e) => set("pressStatus", e.target.value as PressStatus)}>
                <option>待压制</option>
                <option>已压制</option>
              </select>
            </label>
            <label>
              <span>鉴定状态</span>
              <select value={draft.identifyStatus} onChange={(e) => set("identifyStatus", e.target.value as IdentifyStatus)}>
                <option>待鉴定</option>
                <option>已鉴定</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.needsPhoto} onChange={(e) => set("needsPhoto", e.target.checked)} />
              <span>该标本需补照</span>
            </label>
          </div>
          <p className="hint">
            盘点中的柜位已禁用：单柜盘点开始后冻结新上柜，其他柜位照常。
          </p>
        </section>

        <section className="panel">
          <div className="heading">
            <div>
              <p>入库队列</p>
              <h2>待上柜 {queue.length} 份</h2>
            </div>
            <button onClick={onGoCabinets}>查看柜位记录</button>
          </div>
          <div className="records compact">
            {queue.length === 0 && <p className="empty">队列为空，新标本登记后将出现在这里。</p>}
            {queue.map((s) => (
              <article key={s.id} className="record-row" onClick={() => onOpenDetail(s.id)}>
                <div>
                  <h3>{s.collectNo} <span className="badge wait">待入库</span></h3>
                  <p>{s.species} · {s.locality || "未登记地点"} · {s.identifyStatus}</p>
                </div>
                <ShelvePicker specimen={s} />
              </article>
            ))}
          </div>
        </section>
      </section>

      <LocalityCards />
    </>
  );
}

function ShelvePicker({ specimen }: { specimen: Specimen }) {
  const { state, run } = useStore();
  const [cabinetId, setCabinetId] = useState("");
  const frozen = cabinetId ? isCabinetFrozen(state, cabinetId) : false;
  return (
    <div className="shelve" onClick={(e) => e.stopPropagation()}>
      <select value={cabinetId} onChange={(e) => setCabinetId(e.target.value)}>
        <option value="">选择柜位…</option>
        {state.cabinets.map((c) => (
          <option key={c.id} value={c.id} disabled={isCabinetFrozen(state, c.id)}>
            {c.id}{isCabinetFrozen(state, c.id) ? "（冻结）" : ""}
          </option>
        ))}
      </select>
      <button
        disabled={!cabinetId || frozen}
        title={frozen ? "该柜位盘点中，冻结新上柜" : ""}
        onClick={() => run(() => shelve(state, specimen.id, cabinetId, nowIso()), `已上柜至 ${cabinetId}`)}
      >
        上柜
      </button>
    </div>
  );
}

function LocalityCards() {
  const { state } = useStore();
  const groups = useMemo(() => {
    const map = new Map<string, Specimen[]>();
    for (const s of state.specimens) {
      const key = s.locality.trim() || "未登记采集地点";
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [state.specimens]);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>采集地点信息卡</p>
          <h2>采集点 {groups.length} 处</h2>
        </div>
      </div>
      <div className="locality-grid">
        {groups.map(([locality, list]) => {
          const altitudes = list.map((s) => s.altitude).filter(Boolean);
          const collectors = [...new Set(list.map((s) => s.collector).filter(Boolean))];
          const habitats = [...new Set(list.map((s) => s.habitat).filter(Boolean))];
          return (
            <article key={locality} className="locality-card">
              <h3>{locality}</h3>
              <p className="muted">标本 {list.length} 份{altitudes.length > 0 ? ` · 海拔 ${altitudes.join(" / ")}` : ""}</p>
              {collectors.length > 0 && <p>采集人：{collectors.join("、")}</p>}
              {habitats.length > 0 && <p>生境：{habitats.join("；")}</p>}
              <p className="muted small">
                {list.map((s) => s.collectNo).join("、")}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// -------------------------------------------------------------
// 馆藏柜位记录
// -------------------------------------------------------------

function CabinetTab({ onOpenDetail, onGoStocktake }: { onOpenDetail: (id: string) => void; onGoStocktake: () => void }) {
  const { state, run } = useStore();
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>馆藏柜位记录</p>
          <h2>柜位 {state.cabinets.length} 个</h2>
        </div>
        <button onClick={onGoStocktake}>前往盘点台</button>
      </div>
      <div className="cabinet-grid">
        {state.cabinets.map((cabinet) => {
          const active = activeStocktakeOf(state, cabinet.id);
          const frozen = active !== undefined;
          const held = state.specimens.filter((s) => s.cabinetId === cabinet.id && s.status === "已上柜");
          const lostHere = state.specimens.filter((s) => s.cabinetId === cabinet.id && s.status === "失联");
          const lastChecked = lastCheckedAtOf(state, cabinet.id);
          const pending = active?.items.filter((i) => i.result === "pending").length ?? 0;
          const unresolved = active
            ? active.items.reduce((n, i) => n + i.discrepancies.filter((d) => d.releasedAt === null).length, 0)
            : 0;
          return (
            <article key={cabinet.id} className={frozen ? "cabinet frozen" : "cabinet"}>
              <div className="cabinet-head">
                <div>
                  <h3>{cabinet.id}</h3>
                  <p className="muted">{cabinet.name}</p>
                </div>
                {frozen ? <span className="badge warn">盘点中·冻结</span> : <span className="badge ok">可上柜</span>}
              </div>
              <p className="muted small">
                在柜 {held.length} 份{lostHere.length > 0 ? ` · 历史失联 ${lostHere.length} 份` : ""}
                {" · 最近盘点："}{formatTime(lastChecked)}
              </p>
              {active && (
                <div className="cabinet-active">
                  <p className="small">
                    发起人 {active.starter} · 开始 {formatTime(active.startedAt)}
                    <br />未盘 {pending} 份 · 未放行差异 {unresolved} 条
                  </p>
                  {pending > 0 || unresolved > 0 ? (
                    <p className="hold-flag">整柜暂挂：{pending > 0 ? "尚有标本未盘点" : "差异未全部放行"}，不能结项</p>
                  ) : (
                    <p className="ready-flag">全部在位或差异已放行，可结项</p>
                  )}
                </div>
              )}
              <div className="cabinet-actions">
                <button
                  disabled={frozen}
                  onClick={() =>
                    run(
                      () => startStocktake(state, cabinet.id, nowIso()),
                      `柜位 ${cabinet.id} 盘点已开始，新上柜已冻结`,
                    )
                  }
                >
                  {frozen ? "盘点进行中" : "开始盘点"}
                </button>
                {frozen && <button className="primary" onClick={onGoStocktake}>去盘点</button>}
              </div>
              <div className="cabinet-specimens">
                {[...held, ...lostHere].map((s) => (
                  <button key={s.id} className="chip-link" onClick={() => onOpenDetail(s.id)}>
                    {s.collectNo} {s.species}
                    {s.status === "失联" && <span className="badge bad">失联</span>}
                  </button>
                ))}
                {held.length === 0 && lostHere.length === 0 && <p className="empty small">该柜暂无在柜标本</p>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// -------------------------------------------------------------
// 盘点台
// -------------------------------------------------------------

function StocktakeTab({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const { state } = useStore();
  const active = state.stocktakes.filter((s) => s.closedAt === null);
  const closed = state.stocktakes
    .filter((s) => s.closedAt !== null)
    .sort((a, b) => (b.closedAt as string).localeCompare(a.closedAt as string));

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>单柜盘点</p>
            <h2>进行中的盘点单 {active.length} 张</h2>
          </div>
        </div>
        {active.length === 0 && (
          <p className="empty">当前没有进行中的盘点。可在“馆藏柜位”页对单个柜位发起盘点；盘点期间仅冻结该柜位。</p>
        )}
        <div className="stack-gap">
          {active.map((stocktake) => (
            <StocktakeCard key={stocktake.id} stocktake={stocktake} onOpenDetail={onOpenDetail} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>盘点历史</p>
            <h2>已结项 {closed.length} 张</h2>
          </div>
        </div>
        <div className="history-list">
          {closed.length === 0 && <p className="empty">暂无已结项盘点。</p>}
          {closed.map((stocktake) => {
            const discrepant = stocktake.items.filter((i) => i.discrepancies.some((d) => d.releasedAt !== null));
            return (
              <article key={stocktake.id} className="history-row">
                <div>
                  <h3>{stocktake.cabinetId} · {cabinetNameOf(state, stocktake.cabinetId)}</h3>
                  <p className="muted small">
                    发起人 {stocktake.starter} · 开始 {formatTime(stocktake.startedAt)} · 结项（解冻）{formatTime(stocktake.closedAt)}
                    {" · "}{stocktake.items.length} 份
                    {discrepant.length > 0 ? ` · 放行差异 ${discrepant.length} 条` : " · 全部在位"}
                  </p>
                </div>
                <span className="badge ok">已结项</span>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function StocktakeCard({ stocktake, onOpenDetail }: { stocktake: Stocktake; onOpenDetail: (id: string) => void }) {
  const { state, run } = useStore();
  const pending = stocktake.items.filter((i) => i.result === "pending").length;
  const unresolved = stocktake.items.reduce(
    (n, i) => n + i.discrepancies.filter((d) => d.releasedAt === null).length,
    0,
  );
  const closeCheck = canClose(stocktake);

  return (
    <article className="stock-card">
      <div className="stock-head">
        <div>
          <h3>柜位 {stocktake.cabinetId} · {cabinetNameOf(state, stocktake.cabinetId)}</h3>
          <p className="muted small">
            发起人 {stocktake.starter} · 开始 {formatTime(stocktake.startedAt)} · 盘点 {stocktake.items.length} 份
          </p>
        </div>
        <div className="stock-actions">
          <span className="badge warn">冻结新上柜</span>
          <button
            className="primary"
            disabled={!closeCheck.ok}
            title={closeCheck.ok ? "结项并解冻柜位" : closeCheck.reason}
            onClick={() => run(() => closeStocktake(state, stocktake.id, nowIso()), `柜位 ${stocktake.cabinetId} 已结项并解冻，盘点时间已更新`)}
          >
            结项并解冻
          </button>
        </div>
      </div>

      {!closeCheck.ok && <div className="hold-banner">整柜暂挂：{closeCheck.reason}</div>}
      {pending === 0 && unresolved === 0 && <div className="ready-banner">全部标本在位，柜位相符，可结项。</div>}

      {stocktake.items.length === 0 && <p className="empty">发起盘点时该柜无在柜标本，可直接结项。</p>}

      <div className="check-list">
        {stocktake.items.map((item) => {
          const specimen = state.specimens.find((s) => s.id === item.specimenId);
          if (!specimen) return null;
          const activeDc = item.discrepancies.find((d) => d.releasedAt === null);
          const released = item.discrepancies.filter((d) => d.releasedAt !== null);
          return (
            <div key={item.specimenId} className="check-item">
              <div className="check-line">
                <button className="chip-link" onClick={() => onOpenDetail(specimen.id)}>
                  <b>{specimen.collectNo}</b> {specimen.species}
                </button>
                <span className={item.result === "present" ? "res ok" : item.result === "pending" ? "res" : "res bad"}>
                  {RESULT_LABEL[item.result]}
                </span>
                <div className="check-buttons">
                  <button className={item.result === "present" ? "pick picked" : "pick"} onClick={() => run(() => markPresent(state, stocktake.id, specimen.id))}>在位</button>
                  <button className={item.result === "missing" ? "pick picked-bad" : "pick"} onClick={() => run(() => markMissing(state, stocktake.id, specimen.id))}>失联</button>
                  <MismatchButton stocktakeId={stocktake.id} specimen={specimen} picked={item.result === "mismatch"} />
                </div>
              </div>
              {activeDc && <DiscrepancyForm stocktake={stocktake} discrepancyId={activeDc.id} />}
              {released.map((d) => (
                <div key={d.id} className="released">
                  <span className="badge ok">已放行</span>
                  <span>
                    {d.kind === "柜位不符"
                      ? `实际柜位 ${d.actualCabinetId}（${d.disposition === "relocate" ? "已更正柜位" : "已移回登记柜位"}）`
                      : d.disposition === "lost"
                        ? "确认失联（禁止导出，历史保留）"
                        : "已找回"}
                    {" · 原因："}{d.reason} · 确认人：{d.confirmer} · 时间：{formatTime(d.releasedAt)}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function MismatchButton({ stocktakeId, specimen, picked }: { stocktakeId: string; specimen: Specimen; picked: boolean }) {
  const { state, run } = useStore();
  const [picking, setPicking] = useState(false);
  const [actual, setActual] = useState("");
  return (
    <span className="mismatch-wrap">
      <button
        className={picked ? "pick picked-bad" : "pick"}
        onClick={() => {
          if (picked) {
            // 已登记柜位不符：再次点击直接恢复“未盘”，清掉这条暂挂差异
            run(() => markPresent(state, stocktakeId, specimen.id));
            return;
          }
          setPicking(true);
        }}
      >
        柜位不符
      </button>
      {picking && (
        <span className="inline-pop">
          <select value={actual} onChange={(e) => setActual(e.target.value)}>
            <option value="">实际所在柜…</option>
            {state.cabinets.map((c) => (
              <option key={c.id} value={c.id}>{c.id}</option>
            ))}
          </select>
          <button
            onClick={() => {
              if (!actual) {
                run(() => ({ ok: false, state, message: "请选择实际所在柜位（放行前仍可修改）" }));
                return;
              }
              if (run(() => markMismatch(state, stocktakeId, specimen.id, actual))) setPicking(false);
            }}
          >
            确认
          </button>
          <button onClick={() => setPicking(false)}>取消</button>
        </span>
      )}
    </span>
  );
}

function DiscrepancyForm({ stocktake, discrepancyId }: { stocktake: Stocktake; discrepancyId: string }) {
  const { state, run } = useStore();
  let discrepancy: (typeof stocktake.items)[number]["discrepancies"][number] | undefined;
  for (const item of stocktake.items) {
    const found = item.discrepancies.find((d) => d.id === discrepancyId);
    if (found) {
      discrepancy = found;
      break;
    }
  }
  if (!discrepancy) return null;
  const isMissing = discrepancy.kind === "失联";
  const dc = discrepancy;

  return (
    <div className="discrepancy">
      <div className="dis-head">
        <span className="badge bad">{dc.kind} · 整柜暂挂</span>
        {!isMissing && (
          <label className="inline small-inline">
            <span>实际所在柜</span>
            <select
              value={dc.actualCabinetId ?? ""}
              onChange={(e) =>
                run(() =>
                  updateDiscrepancyDraft(state, stocktake.id, discrepancyId, { actualCabinetId: e.target.value || null }),
                )
              }
            >
              <option value="">请选择实际柜位</option>
              {state.cabinets.map((c) => (
                <option key={c.id} value={c.id}>{c.id} {c.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="inline small-inline">
          <span>处置方式</span>
          <select
            value={dc.disposition}
            onChange={(e) =>
              run(() =>
                updateDiscrepancyDraft(state, stocktake.id, discrepancyId, {
                  disposition: e.target.value as typeof dc.disposition,
                }),
              )
            }
          >
            {isMissing ? (
              <>
                <option value="lost">确认失联（标本留痕，禁止导出）</option>
                <option value="found">标本找回，确认在位</option>
              </>
            ) : (
              <>
                <option value="return">已移回登记柜位 {stocktake.cabinetId}</option>
                <option value="relocate">按实际位置更正柜位</option>
              </>
            )}
          </select>
        </label>
      </div>
      <div className="dis-grid">
        <label>
          <span>差异原因（必填）</span>
          <textarea
            rows={2}
            placeholder={isMissing ? "如：外借未登记 / 鉴定送审中 / 去向待查" : "如：错放至相邻柜 / 归位时看错层号"}
            value={dc.reasonDraft}
            onChange={(e) => run(() => updateDiscrepancyDraft(state, stocktake.id, discrepancyId, { reasonDraft: e.target.value }))}
          />
        </label>
        <label>
          <span>另一名盘点员确认（必填，不得为发起人 {stocktake.starter}）</span>
          <input
            placeholder="输入确认人姓名"
            value={dc.confirmerDraft}
            onChange={(e) => run(() => updateDiscrepancyDraft(state, stocktake.id, discrepancyId, { confirmerDraft: e.target.value }))}
          />
        </label>
      </div>
      <div className="dis-actions">
        <p className="hint">原因与确认人缺任一项均拒绝放行；登记草稿随浏览器本地保存，刷新不丢。</p>
        <button
          className="primary"
          onClick={() => run(() => releaseDiscrepancy(state, stocktake.id, discrepancyId, nowIso()), "差异已放行")}
        >
          放行差异
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 标本浏览 + 筛选 + 导出
// -------------------------------------------------------------

function matchFilter(s: Specimen, filter: FilterKey, state: HerbariumState): boolean {
  switch (filter) {
    case "全部":
      return true;
    case "待压制":
      return s.pressStatus === "待压制";
    case "待鉴定":
      return s.identifyStatus === "待鉴定";
    case "已入库":
      return s.status !== "待入库";
    case "需补照":
      return s.needsPhoto;
    case "待入库":
      return s.status === "待入库";
    case "已上柜":
      return s.status === "已上柜";
    case "失联":
      return s.status === "失联";
    case "冻结柜位标本":
      return s.cabinetId !== null && isCabinetFrozen(state, s.cabinetId);
  }
}

function BrowseTab({
  filter,
  setFilter,
  keyword,
  setKeyword,
  onOpenDetail,
}: {
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  keyword: string;
  setKeyword: (k: string) => void;
  onOpenDetail: (id: string) => void;
}) {
  const { state, setNotice, setError } = useStore();
  const kw = keyword.trim().toLowerCase();
  const list = state.specimens.filter((s) => {
    if (!matchFilter(s, filter, state)) return false;
    if (!kw) return true;
    return [s.collectNo, s.species, s.locality, s.collector, s.cabinetId ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(kw);
  });
  const exportable = exportableSpecimens(state).length;
  const blocked = state.specimens.length - exportable;

  const doExport = () => {
    if (exportable === 0) {
      setError("没有可导出的标本");
      return;
    }
    const csv = buildCsv(state);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `herbarium-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`已导出 ${exportable} 份标本${blocked > 0 ? `；${blocked} 份失联标本按规定禁止导出` : ""}`);
  };

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>鉴定状态与馆藏筛选</p>
          <h2>标本浏览（{list.length} / {state.specimens.length}）</h2>
        </div>
        <button className="primary" onClick={doExport}>导出可交换标本 CSV</button>
      </div>
      <div className="browse-toolbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? "chip on" : "chip"} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <input className="search" placeholder="搜索采集号 / 物种 / 地点 / 采集人 / 柜位" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <p className="hint">失联标本 {blocked} 份禁止导出，但其记录与盘点历史完整保留。</p>
      <div className="browse-list">
        {list.length === 0 && <p className="empty">没有符合条件的标本。</p>}
        {list.map((s) => (
          <article key={s.id} className="browse-row" onClick={() => onOpenDetail(s.id)}>
            <div>
              <h3>
                {s.collectNo} <span className={statusBadgeClass(s.status)}>{s.status}</span>
                {s.needsPhoto && <span className="badge warn">需补照</span>}
                {s.cabinetId && isCabinetFrozen(state, s.cabinetId) && <span className="badge warn">柜位冻结中</span>}
              </h3>
              <p className="muted">
                {s.species} · {s.locality || "地点未登记"} · {s.pressStatus} · {s.identifyStatus}
                {s.cabinetId ? ` · 柜位 ${s.cabinetId}` : ""}
              </p>
            </div>
            <span className="chevron">详情 ›</span>
          </article>
        ))}
      </div>
    </section>
  );
}

// -------------------------------------------------------------
// 单份标本详情页
// -------------------------------------------------------------

function DetailPanel({ specimen, onBack }: { specimen: Specimen; onBack: () => void }) {
  const { state, run } = useStore();
  const history = stocktakeHistoryOf(state, specimen.id);
  const fields: Array<[string, string]> = [
    ["采集号", specimen.collectNo],
    ["物种名称", specimen.species],
    ["采集地点", specimen.locality || "—"],
    ["海拔", specimen.altitude || "—"],
    ["生境描述", specimen.habitat || "—"],
    ["采集人", specimen.collector || "—"],
    ["压制状态", specimen.pressStatus],
    ["鉴定状态", specimen.identifyStatus],
    ["馆藏状态", specimen.status],
    ["馆藏位置", specimen.cabinetId ? `${specimen.cabinetId}（${cabinetNameOf(state, specimen.cabinetId)}）` : "—"],
    ["登记时间", formatTime(specimen.createdAt)],
    ["上柜时间", formatTime(specimen.shelvedAt)],
  ];

  return (
    <section className="panel detail">
      <div className="heading">
        <div>
          <p>单份标本详情</p>
          <h2>
            {specimen.collectNo}
            <span className={statusBadgeClass(specimen.status)}>{specimen.status}</span>
            {specimen.needsPhoto && <span className="badge warn">需补照</span>}
            {specimen.cabinetId && isCabinetFrozen(state, specimen.cabinetId) && <span className="badge warn">所在柜位盘点中</span>}
          </h2>
        </div>
        <button onClick={onBack}>返回列表</button>
      </div>

      <div className="detail-grid">
        {fields.map(([label, value]) => (
          <div key={label} className="detail-field">
            <small>{label}</small>
            <p>{value}</p>
          </div>
        ))}
      </div>

      <div className="detail-actions">
        {specimen.status === "待入库" && (
          <div className="shelve">
            <DetailShelve specimen={specimen} />
          </div>
        )}
        <button onClick={() => run(() => toggleNeedsPhoto(state, specimen.id))}>
          {specimen.needsPhoto ? "取消需补照标记" : "标记需补照"}
        </button>
        {specimen.status === "失联" && (
          <p className="lost-note">该标本已确认失联：禁止导出，最后已知柜位 {specimen.cabinetId ?? "—"}；记录与盘点历史保留备查。</p>
        )}
      </div>

      <h3 className="subhead">盘点历史（{history.length}）</h3>
      <div className="history-list">
        {history.length === 0 && <p className="empty">该标本暂无盘点记录。</p>}
        {history.map((stocktake) => {
          const item = stocktake.items.find((i) => i.specimenId === specimen.id);
          const dc = item?.discrepancies ?? [];
          return (
            <article key={stocktake.id} className="history-row">
              <div>
                <h3>
                  柜位 {stocktake.cabinetId}
                  {stocktake.closedAt ? <span className="badge ok">已结项</span> : <span className="badge warn">盘点中</span>}
                  {item && <span className={item.result === "present" ? "res ok" : item.result === "missing" || item.result === "mismatch" ? "res bad" : "res"}>{RESULT_LABEL[item.result]}</span>}
                </h3>
                <p className="muted small">
                  发起人 {stocktake.starter} · {formatTime(stocktake.startedAt)} ~ {formatTime(stocktake.closedAt)}
                </p>
                {dc.map((d) => (
                  <p key={d.id} className="small">
                    {d.kind}
                    {d.releasedAt
                      ? `（已放行 · ${d.disposition === "lost" ? "确认失联" : d.disposition === "relocate" ? "更正柜位" : d.disposition === "return" ? "移回登记柜位" : "找回"} · 原因：${d.reason} · 确认人：${d.confirmer}）`
                      : "（未放行，整柜暂挂）"}
                  </p>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DetailShelve({ specimen }: { specimen: Specimen }) {
  const { state, run } = useStore();
  const [cabinetId, setCabinetId] = useState("");
  return (
    <>
      <select value={cabinetId} onChange={(e) => setCabinetId(e.target.value)}>
        <option value="">选择柜位上柜…</option>
        {state.cabinets.map((c) => (
          <option key={c.id} value={c.id} disabled={isCabinetFrozen(state, c.id)}>
            {c.id}{isCabinetFrozen(state, c.id) ? "（盘点中·冻结）" : ""}
          </option>
        ))}
      </select>
      <button
        className="primary"
        disabled={!cabinetId}
        onClick={() => run(() => shelve(state, specimen.id, cabinetId, nowIso()), `已上柜至 ${cabinetId}`)}
      >
        上柜
      </button>
    </>
  );
}
