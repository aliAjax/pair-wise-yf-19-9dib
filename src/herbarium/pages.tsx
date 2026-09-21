// 业务文件三：页面
// 入库工作台、筛选、馆藏柜位记录、单柜盘点闭环、采集地点信息卡、标本详情等全部界面。
// 三个业务面（筛选 / 柜位记录 / 详情页）共享同一个本地仓库，任何操作即时同步。

import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type {
  AppState,
  CheckResult,
  Discrepancy,
  InventorySession,
  Specimen,
  Store,
} from "./model";
import {
  addSpecimen,
  canCollectingNoBeUsed,
  formatLocation,
  type SpecimenInput,
} from "./model";
import {
  closeInventory,
  exportSpecimensCsv,
  getActiveSession,
  getCloseBlockers,
  getLastInventoryAt,
  getProgress,
  isCabinetFrozen,
  isExportable,
  recordCheck,
  releaseDiscrepancy,
  shelfSpecimen,
  startInventory,
  type RuleResult,
} from "./inventory";

// ---------- 筛选 ----------

type FilterKey = "全部" | "待压制" | "待鉴定" | "已入库" | "需补照" | "待上柜" | "失联";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "全部", label: "全部标本" },
  { key: "待压制", label: "待压制" },
  { key: "待鉴定", label: "待鉴定" },
  { key: "已入库", label: "已入库" },
  { key: "待上柜", label: "待上柜" },
  { key: "需补照", label: "需补照" },
  { key: "失联", label: "盘点失联" },
];

export function filterSpecimens(specimens: Specimen[], filter: FilterKey): Specimen[] {
  switch (filter) {
    case "待压制":
      return specimens.filter((s) => s.pressStatus === "待压制");
    case "待鉴定":
      return specimens.filter((s) => s.identStatus === "待鉴定");
    case "已入库":
      return specimens.filter((s) => s.shelfStatus === "已上柜");
    case "需补照":
      return specimens.filter((s) => s.needPhoto);
    case "待上柜":
      return specimens.filter((s) => s.shelfStatus === "待上柜");
    case "失联":
      return specimens.filter((s) => s.shelfStatus === "失联");
    default:
      return specimens;
  }
}

// ---------- 小组件 ----------

function Badge({ tone = "gray", children }: { tone?: "green" | "teal" | "amber" | "red" | "gray" | "blue"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function ShelfStatusBadge({ status }: { status: Specimen["shelfStatus"] }) {
  if (status === "已上柜") return <Badge tone="green">已上柜</Badge>;
  if (status === "失联") return <Badge tone="red">盘点失联</Badge>;
  return <Badge tone="amber">待上柜</Badge>;
}

function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}

// ---------- 主应用 ----------

export function HerbariumApp({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [filter, setFilter] = useState<FilterKey>("全部");
  const [keyword, setKeyword] = useState("");
  const [cabinetFilter, setCabinetFilter] = useState("全部");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const notify = (text: string, kind: "ok" | "error" = "ok") => {
    setToast({ text, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };

  const commit = (fn: (s: AppState) => RuleResult, successMsg?: string) => {
    let result: RuleResult | undefined;
    store.setState((prev) => {
      result = fn(prev);
      return result.state;
    });
    if (!result) return false;
    if (result.ok) {
      if (successMsg) notify(successMsg);
    } else {
      notify(result.error ?? "操作被拒绝", "error");
    }
    return result.ok;
  };

  const visibleSpecimens = useMemo(() => {
    const word = keyword.trim().toLowerCase();
    return filterSpecimens(state.specimens, filter).filter((s) => {
      if (cabinetFilter !== "全部") {
        if (cabinetFilter === "未上柜") {
          if (s.shelfStatus === "已上柜") return false;
        } else if (s.cabinetId !== cabinetFilter) {
          return false;
        }
      }
      if (!word) return true;
      return [s.collectingNo, s.species, s.locality, s.collector, s.id, formatLocation(s.cabinetId, s.position)]
        .join(" ")
        .toLowerCase()
        .includes(word);
    });
  }, [state.specimens, filter, cabinetFilter, keyword]);

  const queue = state.specimens.filter((s) => s.shelfStatus === "待上柜");
  const missing = state.specimens.filter((s) => s.shelfStatus === "失联");
  const detail = detailId ? state.specimens.find((s) => s.id === detailId) ?? null : null;

  const handleCreate = (input: SpecimenInput) => {
    if (!input.collectingNo.trim()) return notify("采集号为必填项", "error");
    if (!input.species.trim()) return notify("物种名称为必填项", "error");
    if (!input.locality.trim()) return notify("采集地点为必填项", "error");
    if (!input.collector.trim()) return notify("采集人为必填项", "error");
    if (!canCollectingNoBeUsed(state, input.collectingNo)) {
      return notify("该采集号已存在，不能重复入库", "error");
    }
    if (input.cabinetId && isCabinetFrozen(state, input.cabinetId)) {
      return notify(`柜位 ${input.cabinetId} 正在盘点，已冻结新上柜，请先入队`, "error");
    }
    if (
      input.cabinetId &&
      input.position &&
      state.specimens.some(
        (s) => s.shelfStatus !== "失联" && s.cabinetId === input.cabinetId && s.position === (input.position ?? "").trim(),
      )
    ) {
      return notify(`格位 ${input.cabinetId}-${input.position} 已有其他标本`, "error");
    }
    const normalized: SpecimenInput = {
      ...input,
      position: input.position?.trim() || null,
    };
    store.setState((prev) => addSpecimen(prev, normalized));
    notify(normalized.cabinetId ? "标本已入库并上柜" : "标本已入库，进入待上柜队列");
  };

  const handleExport = () => {
    const exportable = visibleSpecimens.filter(isExportable);
    if (exportable.length === 0) {
      return notify("当前筛选结果没有可导出的标本（失联标本禁止导出）", "error");
    }
    const excluded = visibleSpecimens.length - exportable.length;
    const csv = "﻿" + exportSpecimensCsv(visibleSpecimens);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `标本馆藏清单_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`已导出 ${exportable.length} 份${excluded > 0 ? `，${excluded} 份失联标本已按规定剔除` : ""}`);
  };

  const metrics = [
    { label: "入库队列（待上柜）", value: queue.length, tone: "amber" as const },
    { label: "待鉴定", value: state.specimens.filter((s) => s.identStatus === "待鉴定").length, tone: "blue" as const },
    { label: "已上柜", value: state.specimens.filter((s) => s.shelfStatus === "已上柜").length, tone: "green" as const },
    { label: "采集点", value: new Set(state.specimens.map((s) => s.locality)).size, tone: "teal" as const },
  ];

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p>植物标本馆 · 馆藏管理</p>
          <h1>压制标本入库与库房盘点</h1>
        </div>
        <div className="topbar-actions">
          {missing.length > 0 && <Badge tone="red">失联 {missing.length} 份 · 禁止导出</Badge>}
          <button className="ghost" onClick={() => store.reset()}>
            重置为演示数据
          </button>
        </div>
      </header>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong className={`metric-${m.tone}`}>{m.value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <FilterPanel
          filter={filter}
          setFilter={setFilter}
          cabinets={state.cabinets}
          cabinetFilter={cabinetFilter}
          setCabinetFilter={setCabinetFilter}
          keyword={keyword}
          setKeyword={setKeyword}
          frozenCount={state.cabinets.filter((c) => isCabinetFrozen(state, c.id)).length}
        />
        <EntryForm state={state} onCreate={handleCreate} />
      </section>

      <QueuePanel state={state} onShelf={(input) => commit((s) => shelfSpecimen(s, input), "上柜成功")} onOpen={setDetailId} />

      <CabinetPanel
        state={state}
        onStart={(cabinetId, leader) => commit((s) => startInventory(s, { cabinetId, leader }), `柜位 ${cabinetId} 盘点已开始，新上柜已冻结`)}
        onCheck={(input) => commit((s) => recordCheck(s, input), "清点结果已登记")}
        onRelease={(input) => commit((s) => releaseDiscrepancy(s, input), "差异已放行")}
        onClose={(sessionId) => commit((s) => closeInventory(s, sessionId), "盘点已结项，柜位解冻并更新盘点时间")}
        onOpen={setDetailId}
      />

      <section className="panel">
        <div className="heading">
          <div>
            <p>馆藏清单</p>
            <h2>标本记录</h2>
          </div>
          <div className="heading-actions">
            <span className="hint">失联标本自动禁止导出</span>
            <button className="primary" onClick={handleExport}>
              导出当前筛选（CSV）
            </button>
          </div>
        </div>
        <SpecimenTable specimens={visibleSpecimens} state={state} onOpen={setDetailId} />
      </section>

      <LocalityPanel specimens={state.specimens} />

      <HistoryPanel state={state} onOpen={setDetailId} />

      {detail && <SpecimenDetail state={state} specimen={detail} onClose={() => setDetailId(null)} />}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </main>
  );
}

// ---------- 筛选面板 ----------

function FilterPanel({
  filter,
  setFilter,
  cabinets,
  cabinetFilter,
  setCabinetFilter,
  keyword,
  setKeyword,
  frozenCount,
}: {
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  cabinets: AppState["cabinets"];
  cabinetFilter: string;
  setCabinetFilter: (v: string) => void;
  keyword: string;
  setKeyword: (v: string) => void;
  frozenCount: number;
}) {
  return (
    <aside className="panel filter-panel">
      <h2>筛选</h2>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.key} className={filter === f.key ? "chip active" : "chip"} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      <h3 className="sub-title">按柜位</h3>
      <select value={cabinetFilter} onChange={(e) => setCabinetFilter(e.target.value)}>
        <option value="全部">全部柜位</option>
        {cabinets.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id} · {c.name}
          </option>
        ))}
        <option value="未上柜">未上柜（含失联）</option>
      </select>

      <h3 className="sub-title">关键词</h3>
      <input placeholder="采集号 / 物种 / 地点 / 采集人" value={keyword} onChange={(e) => setKeyword(e.target.value)} />

      <div className="filter-note">
        {frozenCount > 0 ? (
          <Badge tone="red">{frozenCount} 个柜位盘点冻结中</Badge>
        ) : (
          <Badge tone="green">全部柜位正常收发</Badge>
        )}
        <p>盘点冻结仅限新上柜，其他柜位照常。</p>
      </div>
    </aside>
  );
}

// ---------- 入库表单 ----------

function EntryForm({ state, onCreate }: { state: AppState; onCreate: (input: SpecimenInput) => void }) {
  const blank = {
    collectingNo: "",
    species: "",
    locality: "",
    altitude: "",
    habitat: "",
    collector: "",
    pressStatus: "已压制" as SpecimenInput["pressStatus"],
    identStatus: "待鉴定" as SpecimenInput["identStatus"],
    needPhoto: false,
    cabinetId: "" as string,
    position: "",
  };
  const [form, setForm] = useState(blank);
  const set = (key: keyof typeof blank, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const frozen = form.cabinetId ? isCabinetFrozen(state, form.cabinetId) : false;

  const submit = () => {
    onCreate({
      collectingNo: form.collectingNo,
      species: form.species,
      locality: form.locality,
      altitude: form.altitude,
      habitat: form.habitat,
      collector: form.collector,
      pressStatus: form.pressStatus,
      identStatus: form.identStatus,
      needPhoto: form.needPhoto,
      cabinetId: form.cabinetId || null,
      position: form.position || null,
    });
    setForm(blank);
  };

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>专业字段</p>
          <h2>新增标本入库</h2>
        </div>
        <Badge tone="teal">数据仅保存在本浏览器</Badge>
      </div>
      <div className="field-grid">
        <label>
          <span>采集号 *</span>
          <input value={form.collectingNo} placeholder="如 HX-240620-01" onChange={(e) => set("collectingNo", e.target.value)} />
        </label>
        <label>
          <span>物种名称 *</span>
          <input value={form.species} placeholder="如 秦岭槭" onChange={(e) => set("species", e.target.value)} />
        </label>
        <label>
          <span>采集地点 *</span>
          <input value={form.locality} placeholder="如 秦岭光头山西坡" onChange={(e) => set("locality", e.target.value)} />
        </label>
        <label>
          <span>海拔</span>
          <input value={form.altitude} placeholder="如 1420m" onChange={(e) => set("altitude", e.target.value)} />
        </label>
        <label className="span-2">
          <span>生境描述</span>
          <input value={form.habitat} placeholder="如 落叶阔叶林下阴坡" onChange={(e) => set("habitat", e.target.value)} />
        </label>
        <label>
          <span>采集人 *</span>
          <input value={form.collector} placeholder="采集人姓名" onChange={(e) => set("collector", e.target.value)} />
        </label>
        <label>
          <span>压制 / 鉴定状态</span>
          <div className="two-selects">
            <select value={form.pressStatus} onChange={(e) => set("pressStatus", e.target.value)}>
              <option>待压制</option>
              <option>已压制</option>
            </select>
            <select value={form.identStatus} onChange={(e) => set("identStatus", e.target.value)}>
              <option>待鉴定</option>
              <option>已鉴定</option>
            </select>
          </div>
        </label>
        <label>
          <span>馆藏柜位（可选，直接上柜）</span>
          <select value={form.cabinetId} onChange={(e) => set("cabinetId", e.target.value)}>
            <option value="">暂不上柜 · 进入入库队列</option>
            {state.cabinets.map((c) => (
              <option key={c.id} value={c.id} disabled={isCabinetFrozen(state, c.id)}>
                {c.id} · {c.name}{isCabinetFrozen(state, c.id) ? "（盘点冻结）" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>柜内格位</span>
          <input value={form.position} disabled={!form.cabinetId || frozen} placeholder="如 3-02" onChange={(e) => set("position", e.target.value)} />
        </label>
        <label className="check-label">
          <input type="checkbox" checked={form.needPhoto} onChange={(e) => set("needPhoto", e.target.checked)} />
          <span>需补照</span>
        </label>
      </div>
      {frozen && (
        <p className="inline-warn">该柜正在盘点，新上柜已冻结。可清空柜位先入队，盘点结项后再上柜。</p>
      )}
      <div className="form-actions">
        <button className="primary" onClick={submit}>
          确认入库
        </button>
      </div>
    </section>
  );
}

// ---------- 待上柜队列 ----------

function QueuePanel({
  state,
  onShelf,
  onOpen,
}: {
  state: AppState;
  onShelf: (input: { specimenId: string; cabinetId: string; position: string }) => void;
  onOpen: (id: string) => void;
}) {
  const queue = state.specimens.filter((s) => s.shelfStatus === "待上柜");
  const [drafts, setDrafts] = useState<Record<string, { cabinetId: string; position: string }>>({});

  const draftFor = (id: string) => drafts[id] ?? { cabinetId: "", position: "" };
  const update = (id: string, patch: Partial<{ cabinetId: string; position: string }>) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftFor(id), ...patch } }));

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>入库队列</p>
          <h2>待上柜标本 · {queue.length} 份</h2>
        </div>
      </div>
      {queue.length === 0 ? (
        <Empty text="队列已清空，所有标本均已上柜。" />
      ) : (
        <div className="queue-list">
          {queue.map((s) => {
            const draft = draftFor(s.id);
            const frozen = draft.cabinetId ? isCabinetFrozen(state, draft.cabinetId) : false;
            return (
              <article key={s.id} className="queue-card">
                <div className="queue-main" onClick={() => onOpen(s.id)}>
                  <h3>{s.collectingNo} · {s.species}</h3>
                  <p>{s.locality} {s.altitude && `· ${s.altitude}`} · 采集人 {s.collector}</p>
                  <div className="badges">
                    <Badge tone="amber">待上柜</Badge>
                    {s.pressStatus === "待压制" && <Badge tone="gray">待压制</Badge>}
                    {s.identStatus === "待鉴定" && <Badge tone="blue">待鉴定</Badge>}
                    {s.needPhoto && <Badge tone="teal">需补照</Badge>}
                  </div>
                </div>
                <div className="queue-shelf">
                  <select value={draft.cabinetId} onChange={(e) => update(s.id, { cabinetId: e.target.value })}>
                    <option value="">选择柜位</option>
                    {state.cabinets.map((c) => (
                      <option key={c.id} value={c.id} disabled={isCabinetFrozen(state, c.id)}>
                        {c.id}{isCabinetFrozen(state, c.id) ? "（冻结）" : ""}
                      </option>
                    ))}
                  </select>
                  <input placeholder="格位 3-02" value={draft.position} onChange={(e) => update(s.id, { position: e.target.value })} />
                  <button
                    disabled={!draft.cabinetId || frozen}
                    onClick={() => onShelf({ specimenId: s.id, cabinetId: draft.cabinetId, position: draft.position })}
                  >
                    上柜
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- 馆藏柜位记录 + 盘点闭环 ----------

function CabinetPanel({
  state,
  onStart,
  onCheck,
  onRelease,
  onClose,
  onOpen,
}: {
  state: AppState;
  onStart: (cabinetId: string, leader: string) => void;
  onCheck: (input: { sessionId: string; specimenId: string; result: CheckResult; checker: string; foundPosition?: string }) => void;
  onRelease: (input: {
    discrepancyId: string;
    reason: string;
    confirmer: string;
    moveToFound: boolean;
    targetCabinetId?: string;
  }) => void;
  onClose: (sessionId: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="panel cabinet-panel">
      <div className="heading">
        <div>
          <p>馆藏柜位记录</p>
          <h2>库房柜位与单柜盘点</h2>
        </div>
        <span className="hint">盘点开始后仅冻结本柜新上柜；出现任一失联/柜位不符即整柜暂挂</span>
      </div>
      <div className="cabinet-grid">
        {state.cabinets.map((cabinet) => {
          const session = getActiveSession(state, cabinet.id);
          const lastAt = getLastInventoryAt(state, cabinet.id);
          const count = state.specimens.filter((s) => s.shelfStatus === "已上柜" && s.cabinetId === cabinet.id).length;
          return (
            <article key={cabinet.id} className={`cabinet-card${session ? " frozen" : ""}`}>
              <div className="cabinet-head">
                <div>
                  <h3>{cabinet.id} <small>{cabinet.name}</small></h3>
                  <p>{cabinet.room} · 在柜 {count} 份 · 上次盘点：{lastAt ?? "暂无记录"}</p>
                </div>
                {session ? (
                  session.status === "暂挂" ? <Badge tone="red">盘点暂挂</Badge> : <Badge tone="amber">盘点中 · 冻结</Badge>
                ) : (
                  <Badge tone="green">正常收发</Badge>
                )}
              </div>
              {session ? (
                <SessionManager
                  state={state}
                  session={session}
                  onCheck={onCheck}
                  onRelease={onRelease}
                  onClose={onClose}
                  onOpen={onOpen}
                />
              ) : (
                <StartInventory cabinetId={cabinet.id} onStart={onStart} />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StartInventory({ cabinetId, onStart }: { cabinetId: string; onStart: (cabinetId: string, leader: string) => void }) {
  const [leader, setLeader] = useState("");
  return (
    <div className="start-inventory">
      <input placeholder="盘点发起人姓名" value={leader} onChange={(e) => setLeader(e.target.value)} />
      <button className="primary" onClick={() => leader.trim() && onStart(cabinetId, leader)}>
        开始盘点（冻结本柜上柜）
      </button>
    </div>
  );
}

function SessionManager({
  state,
  session,
  onCheck,
  onRelease,
  onClose,
  onOpen,
}: {
  state: AppState;
  session: InventorySession;
  onCheck: (input: { sessionId: string; specimenId: string; result: CheckResult; checker: string; foundPosition?: string }) => void;
  onRelease: (input: {
    discrepancyId: string;
    reason: string;
    confirmer: string;
    moveToFound: boolean;
    targetCabinetId?: string;
  }) => void;
  onClose: (sessionId: string) => void;
  onOpen: (id: string) => void;
}) {
  const [checker, setChecker] = useState("");
  const [foundDrafts, setFoundDrafts] = useState<Record<string, string>>({});
  const [releaseDrafts, setReleaseDrafts] = useState<
    Record<string, { reason: string; confirmer: string; moveToFound: boolean; targetCabinetId: string }>
  >({});

  const blockers = getCloseBlockers(state, session.id);
  const progress = getProgress(state, session);
  const pending = state.discrepancies.filter((d) => d.sessionId === session.id && d.status === "待处理");
  const released = state.discrepancies.filter((d) => d.sessionId === session.id && d.status === "已放行");

  const releaseDraft = (id: string) =>
    releaseDrafts[id] ?? { reason: "", confirmer: "", moveToFound: false, targetCabinetId: "" };
  const setReleaseDraft = (id: string, patch: Partial<{ reason: string; confirmer: string; moveToFound: boolean; targetCabinetId: string }>) =>
    setReleaseDrafts((d) => ({ ...d, [id]: { ...releaseDraft(id), ...patch } }));

  return (
    <div className="session">
      <div className="session-meta">
        <span>发起人：<b>{session.leader}</b></span>
        <span>开始：{session.startedAt}</span>
        <span>进度：{progress.resolved}/{progress.total}</span>
        {session.status === "暂挂" && <Badge tone="red">整柜暂挂 · 差异闭环后才能结项</Badge>}
      </div>
      <div className="checker-row">
        <input placeholder="本次清点人姓名（各份清点共用）" value={checker} onChange={(e) => setChecker(e.target.value)} />
      </div>

      <div className="manifest">
        {session.manifest.length === 0 && <Empty text="开始盘点时该柜没有在柜标本，可直接结项。" />}
        {session.manifest.map((item) => {
          const specimen = state.specimens.find((s) => s.id === item.specimenId);
          if (!specimen) return null;
          const discrepancy = state.discrepancies.find(
            (d) => d.sessionId === session.id && d.specimenId === item.specimenId && d.status === "待处理",
          );
          const releasedDiff = state.discrepancies.find(
            (d) => d.sessionId === session.id && d.specimenId === item.specimenId && d.status === "已放行",
          );
          const foundDraft = foundDrafts[item.specimenId] ?? "";
          const movedAway = releasedDiff?.type === "柜位不符" && specimen.cabinetId !== session.cabinetId;
          return (
            <div
              key={item.specimenId}
              className={`manifest-item${
                releasedDiff
                  ? " is-released"
                  : item.result && item.result !== "一致"
                    ? " has-issue"
                    : item.result === "一致"
                      ? " is-ok"
                      : ""
              }`}
            >
              <div className="manifest-head" onClick={() => onOpen(specimen.id)}>
                <div>
                  <h4>{specimen.collectingNo} · {specimen.species}</h4>
                  <p>
                    台账位置：{formatLocation(specimen.cabinetId, specimen.position)}
                    {item.checkedAt && <> · 清点人 {item.checkedBy} · {item.checkedAt}</>}
                  </p>
                </div>
                {releasedDiff && <Badge tone="teal">{movedAway ? "差异已放行·已移柜" : "差异已放行"}</Badge>}
                {!releasedDiff && item.result === "一致" && <Badge tone="green">一致</Badge>}
                {!releasedDiff && item.result === "失联" && <Badge tone="red">失联</Badge>}
                {!releasedDiff && item.result === "柜位不符" && <Badge tone="amber">柜位不符</Badge>}
                {!releasedDiff && !item.checked && <Badge tone="gray">未清点</Badge>}
              </div>
              {!releasedDiff && (
                <div className="check-actions">
                  {(["一致", "失联", "柜位不符"] as CheckResult[]).map((r) => (
                    <button
                      key={r}
                      className={item.result === r ? `check-btn check-btn-${r === "一致" ? "ok" : "bad"} active` : "check-btn"}
                      onClick={() =>
                        onCheck({
                          sessionId: session.id,
                          specimenId: specimen.id,
                          result: r,
                          checker,
                          foundPosition: r === "柜位不符" ? foundDraft : undefined,
                        })
                      }
                      disabled={!checker.trim()}
                      title={!checker.trim() ? "请先填写清点人" : undefined}
                    >
                      {r}
                    </button>
                  ))}
                  {item.result === "柜位不符" && !discrepancy?.foundPosition && (
                    <input
                      className="found-input"
                      placeholder="实见格位，如 5-11"
                      value={foundDraft}
                      onChange={(e) => setFoundDrafts((d) => ({ ...d, [item.specimenId]: e.target.value }))}
                    />
                  )}
                </div>
              )}

              {discrepancy && (
                <ReleaseCard
                  state={state}
                  session={session}
                  discrepancy={discrepancy}
                  draft={releaseDraft(discrepancy.id)}
                  setDraft={(patch) => setReleaseDraft(discrepancy.id, patch)}
                  onSubmit={(payload) => onRelease(payload)}
                />
              )}
            </div>
          );
        })}
      </div>

      {released.length > 0 && (
        <div className="released-list">
          <h4>已放行差异（{released.length}）</h4>
          {released.map((d) => {
            const s = state.specimens.find((x) => x.id === d.specimenId);
            return (
              <p key={d.id} className="released-item">
                <Badge tone="teal">已放行</Badge>
                {s?.collectingNo} · {d.type} · {d.resolution} · 原因「{d.reason}」 · 确认人 {d.confirmer}
              </p>
            );
          })}
        </div>
      )}

      <div className="close-bar">
        <div className="blockers">
          {blockers.unchecked > 0 && <p className="blocker">▸ 还有 {blockers.unchecked} 份未清点</p>}
          {blockers.pendingDiscrepancies > 0 && <p className="blocker">▸ 还有 {blockers.pendingDiscrepancies} 份差异未登记原因并经另一盘点员确认</p>}
          {blockers.unchecked === 0 && blockers.pendingDiscrepancies === 0 && <p className="ready">全部清点完成且差异闭环，可结项解冻</p>}
        </div>
        <button
          className="primary"
          disabled={blockers.unchecked > 0 || blockers.pendingDiscrepancies > 0}
          onClick={() => onClose(session.id)}
        >
          结项并解冻
        </button>
      </div>
    </div>
  );
}

function ReleaseCard({
  state,
  session,
  discrepancy,
  draft,
  setDraft,
  onSubmit,
}: {
  state: AppState;
  session: InventorySession;
  discrepancy: Discrepancy;
  draft: { reason: string; confirmer: string; moveToFound: boolean; targetCabinetId: string };
  setDraft: (patch: Partial<{ reason: string; confirmer: string; moveToFound: boolean; targetCabinetId: string }>) => void;
  onSubmit: (input: { discrepancyId: string; reason: string; confirmer: string; moveToFound: boolean; targetCabinetId?: string }) => void;
}) {
  const specimen = state.specimens.find((s) => s.id === discrepancy.specimenId);
  return (
    <div className="release-card">
      <h4>差异放行 · 原因登记 + 另一名盘点员确认（缺一拒绝）</h4>
      {discrepancy.type === "失联" ? (
        <p className="warn-text">
          台账位置 {formatLocation(discrepancy.cabinetId, discrepancy.expectedPosition)}，实查未见。放行后标本保持「失联」，
          <b>禁止导出</b>，历史轨迹永久保留。
        </p>
      ) : (
        <p className="warn-text">
          台账位置 {formatLocation(discrepancy.cabinetId, discrepancy.expectedPosition)}，实见格位{" "}
          {discrepancy.foundPosition || "（未登记）"}。放行时须选择更新柜位或归还原位。
        </p>
      )}
      <textarea
        placeholder="差异原因（必填），如：外借修复未登记 / 整柜挪动至 B-07"
        value={draft.reason}
        onChange={(e) => setDraft({ reason: e.target.value })}
        rows={2}
      />
      <input
        placeholder={`确认盘点员姓名（必填，且不能为发起人 ${session.leader}）`}
        value={draft.confirmer}
        onChange={(e) => setDraft({ confirmer: e.target.value })}
      />
      {discrepancy.type === "柜位不符" && (
        <div className="release-options">
          <label className="radio-label">
            <input
              type="radio"
              checked={!draft.moveToFound}
              onChange={() => setDraft({ moveToFound: false })}
            />
            归回台账原位 {formatLocation(discrepancy.cabinetId, discrepancy.expectedPosition)}
          </label>
          <label className="radio-label">
            <input
              type="radio"
              checked={draft.moveToFound}
              onChange={() => setDraft({ moveToFound: true })}
            />
            按实见位置更新柜位：
          </label>
          {draft.moveToFound && (
            <select value={draft.targetCabinetId} onChange={(e) => setDraft({ targetCabinetId: e.target.value })}>
              <option value="">选择实见柜位</option>
              {state.cabinets.map((c) => (
                <option key={c.id} value={c.id} disabled={c.id !== discrepancy.cabinetId && isCabinetFrozen(state, c.id)}>
                  {c.id} · {c.name}{c.id !== discrepancy.cabinetId && isCabinetFrozen(state, c.id) ? "（盘点冻结）" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="release-foot">
        <span className="hint">
          {specimen?.shelfStatus === "失联" ? "当前标本状态：失联" : "差异未放行前，整柜保持暂挂"}
        </span>
        <button
          className="primary"
          onClick={() =>
            onSubmit({
              discrepancyId: discrepancy.id,
              reason: draft.reason,
              confirmer: draft.confirmer,
              moveToFound: draft.moveToFound,
              targetCabinetId: draft.moveToFound ? draft.targetCabinetId || undefined : undefined,
            })
          }
        >
          确认放行
        </button>
      </div>
    </div>
  );
}

// ---------- 标本表格 ----------

function SpecimenTable({ specimens, state, onOpen }: { specimens: Specimen[]; state: AppState; onOpen: (id: string) => void }) {
  if (specimens.length === 0) return <Empty text="当前筛选条件下没有标本。" />;
  return (
    <div className="table-wrap">
      <table className="specimen-table">
        <thead>
          <tr>
            <th>采集号</th>
            <th>物种名称</th>
            <th>采集地点</th>
            <th>采集人</th>
            <th>状态</th>
            <th>馆藏位置</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {specimens.map((s) => {
            const frozenCabinet = s.cabinetId ? isCabinetFrozen(state, s.cabinetId) : false;
            return (
              <tr key={s.id} className={s.shelfStatus === "失联" ? "row-missing" : ""}>
                <td>{s.collectingNo}</td>
                <td>{s.species}</td>
                <td>{s.locality}{s.altitude ? ` · ${s.altitude}` : ""}</td>
                <td>{s.collector}</td>
                <td>
                  <div className="badges">
                    <ShelfStatusBadge status={s.shelfStatus} />
                    {s.identStatus === "待鉴定" && <Badge tone="blue">待鉴定</Badge>}
                    {s.needPhoto && <Badge tone="teal">需补照</Badge>}
                    {frozenCabinet && s.shelfStatus === "已上柜" && <Badge tone="amber">所在柜盘点中</Badge>}
                  </div>
                </td>
                <td>{formatLocation(s.cabinetId, s.position)}</td>
                <td>
                  <button className="link-btn" onClick={() => onOpen(s.id)}>查看</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 采集地点信息卡 ----------

function LocalityPanel({ specimens }: { specimens: Specimen[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, { locality: string; altitudes: Set<string>; collectors: Set<string>; habitats: Set<string>; count: number }>();
    for (const s of specimens) {
      const key = s.locality;
      const g = map.get(key) ?? { locality: key, altitudes: new Set(), collectors: new Set(), habitats: new Set(), count: 0 };
      g.count += 1;
      if (s.altitude) g.altitudes.add(s.altitude);
      if (s.collector) g.collectors.add(s.collector);
      if (s.habitat) g.habitats.add(s.habitat);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [specimens]);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>采集地点信息卡</p>
          <h2>采集点 · {groups.length} 处</h2>
        </div>
      </div>
      <div className="locality-grid">
        {groups.map((g) => (
          <article key={g.locality} className="locality-card">
            <h3>{g.locality}</h3>
            <dl>
              <div><dt>标本数</dt><dd>{g.count} 份</dd></div>
              <div><dt>海拔</dt><dd>{[...g.altitudes].join("、") || "—"}</dd></div>
              <div><dt>采集人</dt><dd>{[...g.collectors].join("、")}</dd></div>
              <div><dt>生境</dt><dd>{[...g.habitats].slice(0, 3).join("；") || "—"}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------- 盘点历史 ----------

function HistoryPanel({ state, onOpen }: { state: AppState; onOpen: (id: string) => void }) {
  const sessions = [...state.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (sessions.length === 0) return null;
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>盘点记录</p>
          <h2>库房盘点历史（本地永久保留）</h2>
        </div>
      </div>
      <div className="history-list">
        {sessions.map((session) => {
          const diffs = state.discrepancies.filter((d) => d.sessionId === session.id);
          const pending = diffs.filter((d) => d.status === "待处理").length;
          return (
            <article key={session.id} className="history-card">
              <div className="history-main">
                <h3>{session.cabinetId} 柜盘点</h3>
                <p>
                  发起人 {session.leader} · 开始 {session.startedAt}
                  {session.finishedAt && <> · 结项 {session.finishedAt}</>}
                </p>
                <p>
                  应盘 {session.manifest.length} 份 · 已处理 {(() => {
                    const ids = new Set(
                      state.discrepancies
                        .filter((d) => d.sessionId === session.id && d.status === "已放行")
                        .map((d) => d.specimenId),
                    );
                    return session.manifest.filter(
                      (item) => (item.checked && item.result === "一致") || ids.has(item.specimenId),
                    ).length;
                  })()} 份 · 差异 {diffs.length} 份
                  {pending > 0 && "（待处理 " + pending + "）"}
                </p>
              </div>
              <div className="history-side">
                {session.status === "已结项" ? <Badge tone="green">已结项</Badge> : session.status === "暂挂" ? <Badge tone="red">暂挂中</Badge> : <Badge tone="amber">进行中</Badge>}
                <div className="history-links">
                  {diffs.map((d) => {
                    const s = state.specimens.find((x) => x.id === d.specimenId);
                    return (
                      <button key={d.id} className="link-btn" onClick={() => onOpen(d.specimenId)}>
                        {s?.collectingNo} · {d.type}{d.status === "已放行" ? "（已放行）" : "（待处理）"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ---------- 标本详情页 ----------

function SpecimenDetail({ state, specimen, onClose }: { state: AppState; specimen: Specimen; onClose: () => void }) {
  const session = specimen.cabinetId ? getActiveSession(state, specimen.cabinetId) : undefined;
  const discrepancyLinks = state.discrepancies.filter((d) => d.specimenId === specimen.id);
  const rows: [string, ReactNode][] = [
    ["馆内编号", specimen.id],
    ["采集号", specimen.collectingNo],
    ["物种名称", specimen.species],
    ["采集地点", specimen.locality],
    ["海拔", specimen.altitude || "—"],
    ["生境描述", specimen.habitat || "—"],
    ["采集人", specimen.collector],
    ["压制状态", specimen.pressStatus],
    ["鉴定状态", specimen.identStatus],
    ["馆藏位置", formatLocation(specimen.cabinetId, specimen.position)],
    ["补照", specimen.needPhoto ? "需补照" : "不需要"],
    ["登记时间", specimen.createdAt],
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p>单份标本详情</p>
            <h2>{specimen.collectingNo} · {specimen.species}</h2>
            <div className="badges">
              <ShelfStatusBadge status={specimen.shelfStatus} />
              {specimen.identStatus === "待鉴定" && <Badge tone="blue">待鉴定</Badge>}
              {specimen.pressStatus === "待压制" && <Badge tone="gray">待压制</Badge>}
              {specimen.needPhoto && <Badge tone="teal">需补照</Badge>}
            </div>
          </div>
          <button onClick={onClose}>关闭</button>
        </div>

        {specimen.shelfStatus === "失联" && (
          <div className="missing-banner">
            该标本在 {discrepancyLinks[0]?.cabinetId ?? specimen.cabinetId} 柜盘点中登记为失联，按规定禁止导出；
            历史轨迹与差异记录在下方永久保留。
          </div>
        )}
        {session && (
          <div className="session-banner">
            所在柜位 {session.cabinetId} 正在盘点（{session.status}，发起人 {session.leader}），本柜已冻结新上柜。
          </div>
        )}

        <dl className="detail-grid">
          {rows.map(([label, value]) => (
            <div key={label} className="detail-cell">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {discrepancyLinks.length > 0 && (
          <div className="detail-diffs">
            <h3>盘点差异记录</h3>
            {discrepancyLinks.map((d) => (
              <div key={d.id} className="detail-diff">
                <div className="badges">
                  {d.status === "已放行" ? <Badge tone="teal">已放行</Badge> : <Badge tone="red">待处理</Badge>}
                  <Badge tone={d.type === "失联" ? "red" : "amber"}>{d.type}</Badge>
                </div>
                <p>台账位置：{formatLocation(d.cabinetId, d.expectedPosition)} · 实见：{d.foundPosition ?? "未见"}</p>
                {d.reason ? (
                  <p>原因：{d.reason} · 确认人：{d.confirmer}（{d.confirmedAt}）</p>
                ) : (
                  <p className="warn-text">尚未登记原因并经另一名盘点员确认。</p>
                )}
                {d.resolution && <p>处理：{d.resolution}</p>}
              </div>
            ))}
          </div>
        )}

        <div className="detail-history">
          <h3>历史轨迹（永久保留）</h3>
          <ul>
            {[...specimen.history].reverse().map((h, i) => (
              <li key={i}>
                <time>{h.at}</time>
                <span>{h.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
