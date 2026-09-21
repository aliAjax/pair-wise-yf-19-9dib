// =============================================================
// 业务文件 2：盘点规则
// 纯业务规则：单柜冻结、整柜暂挂、差异双人确认、结项、
// 失联标本禁止导出等。全部函数不可变地返回新状态。
// =============================================================

import type {
  Disposition,
  Discrepancy,
  HerbariumState,
  Specimen,
  SpecimenDraft,
  Stocktake,
  StocktakeItem,
} from "./model";
import { uid } from "./model";

export type ApplyResult =
  | { ok: true; state: HerbariumState }
  | { ok: false; state: HerbariumState; message: string; field?: "reason" | "confirmer" };

// -------------------------------------------------------------
// 查询类规则
// -------------------------------------------------------------

/** 找到某柜位正在进行的盘点（未结项）；同一柜位同时只允许一张盘点单 */
export function activeStocktakeOf(state: HerbariumState, cabinetId: string): Stocktake | undefined {
  return state.stocktakes.find((s) => s.cabinetId === cabinetId && s.closedAt === null);
}

/** 规则：单柜盘点开始后该柜位冻结，禁止新上柜；其他柜位照常 */
export function isCabinetFrozen(state: HerbariumState, cabinetId: string): boolean {
  return activeStocktakeOf(state, cabinetId) !== undefined;
}

export function canShelve(state: HerbariumState, cabinetId: string): { ok: boolean; reason: string } {
  if (!state.cabinets.some((c) => c.id === cabinetId)) {
    return { ok: false, reason: "柜位不存在" };
  }
  if (isCabinetFrozen(state, cabinetId)) {
    return { ok: false, reason: `柜位 ${cabinetId} 正在盘点，已冻结新上柜` };
  }
  return { ok: true, reason: "" };
}

export function itemsOf(stocktake: Stocktake): StocktakeItem[] {
  return stocktake.items;
}

export function allChecked(stocktake: Stocktake): boolean {
  return stocktake.items.every((item) => item.result !== "pending");
}

export function unresolvedItems(stocktake: Stocktake): StocktakeItem[] {
  return stocktake.items.filter(
    (item) => item.discrepancies.length > 0 && item.discrepancies.some((d) => d.releasedAt === null),
  );
}

/**
 * 规则：任一份失联或柜位不符就整柜暂挂，不能结项。
 * 差异必须登记原因，并经另一名盘点员确认（且与发起人不是同一人）才能放行；
 * 缺任一项均拒绝。
 */
export function canClose(stocktake: Stocktake): { ok: boolean; reason: string } {
  if (stocktake.closedAt !== null) return { ok: false, reason: "盘点已结项" };
  if (!allChecked(stocktake)) {
    const pending = stocktake.items.filter((i) => i.result === "pending").length;
    return { ok: false, reason: `还有 ${pending} 份标本未盘点，整柜暂挂，不能结项` };
  }
  const bad = unresolvedItems(stocktake);
  if (bad.length > 0) {
    return { ok: false, reason: `存在 ${bad.length} 条未放行差异，整柜暂挂，不能结项` };
  }
  return { ok: true, reason: "" };
}

/** 差异放行校验：缺原因、缺确认人、确认人与发起人为同一人，一律拒绝 */
export function validateRelease(
  state: HerbariumState,
  stocktake: Stocktake,
  discrepancy: Discrepancy,
): { ok: true } | { ok: false; field?: "reason" | "confirmer"; message: string } {
  if (discrepancy.releasedAt !== null) {
    return { ok: false, message: "该差异已放行，记录已固化" };
  }
  if (!discrepancy.reasonDraft.trim()) {
    return { ok: false, field: "reason", message: "请先登记差异原因，否则拒绝放行" };
  }
  if (!discrepancy.confirmerDraft.trim()) {
    return { ok: false, field: "confirmer", message: "必须由另一名盘点员确认，否则拒绝放行" };
  }
  if (discrepancy.confirmerDraft.trim() === stocktake.starter.trim()) {
    return { ok: false, field: "confirmer", message: "确认人不能与盘点发起人是同一人" };
  }
  if (discrepancy.kind === "柜位不符" && !discrepancy.actualCabinetId) {
    return { ok: false, message: "请登记实际所在柜位，否则拒绝放行" };
  }
  // 更正到其他柜位时，目标柜不能正处于冻结盘点，否则会凭空插入在柜标本、破坏其盘点快照
  if (
    discrepancy.kind === "柜位不符" &&
    discrepancy.disposition === "relocate" &&
    discrepancy.actualCabinetId &&
    discrepancy.actualCabinetId !== stocktake.cabinetId &&
    activeStocktakeOf(state, discrepancy.actualCabinetId)
  ) {
    return { ok: false, message: `目标柜位 ${discrepancy.actualCabinetId} 正在盘点（冻结），不能更正移入` };
  }
  return { ok: true };
}

/** 标本的全部盘点历史（进行中 + 已结项，按时间倒序） */
export function stocktakeHistoryOf(state: HerbariumState, specimenId: string): Stocktake[] {
  return state.stocktakes
    .filter((s) => s.items.some((i) => i.specimenId === specimenId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** 柜位最近一次盘点的结项时间（未结项返回 null） */
export function lastCheckedAtOf(state: HerbariumState, cabinetId: string): string | null {
  const closed = state.stocktakes
    .filter((s) => s.cabinetId === cabinetId && s.closedAt !== null)
    .sort((a, b) => (b.closedAt as string).localeCompare(a.closedAt as string));
  return closed[0]?.closedAt ?? null;
}

/** 规则：失联标本禁止导出（历史仍完整保留），其余标本导出 CSV */
export function exportableSpecimens(state: HerbariumState): Specimen[] {
  return state.specimens.filter((s) => s.status !== "失联");
}

export function buildCsv(state: HerbariumState): string {
  const header = ["采集号", "物种名称", "采集地点", "海拔", "生境描述", "采集人", "压制状态", "鉴定状态", "馆藏状态", "馆藏位置"];
  const esc = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = exportableSpecimens(state).map((s) =>
    [s.collectNo, s.species, s.locality, s.altitude, s.habitat, s.collector, s.pressStatus, s.identifyStatus, s.status, s.cabinetId ?? ""]
      .map(esc)
      .join(","),
  );
  return "﻿" + [header.join(","), ...rows].join("\n");
}

// -------------------------------------------------------------
// 变更类规则（均返回新状态，持久化由页面层统一处理）
// -------------------------------------------------------------

export function setOperator(state: HerbariumState, operator: string): HerbariumState {
  return { ...state, operator };
}

export function addSpecimen(state: HerbariumState, draft: SpecimenDraft, now: string): ApplyResult {
  if (!draft.collectNo.trim()) return { ok: false, state, message: "采集号必填" };
  if (!draft.species.trim()) return { ok: false, state, message: "物种名称必填" };
  if (state.specimens.some((s) => s.collectNo === draft.collectNo.trim())) {
    return { ok: false, state, message: `采集号 ${draft.collectNo.trim()} 已存在` };
  }
  // 录入时直接指定柜位等同上柜：冻结柜位同样拒绝；留空则进入入库队列
  const toShelf = draft.cabinetId !== null;
  if (toShelf) {
    const guard = canShelve(state, draft.cabinetId as string);
    if (!guard.ok) return { ok: false, state, message: guard.reason };
  }
  const specimen: Specimen = {
    id: uid("sp"),
    collectNo: draft.collectNo.trim(),
    species: draft.species.trim(),
    locality: draft.locality.trim(),
    altitude: draft.altitude.trim(),
    habitat: draft.habitat.trim(),
    collector: draft.collector.trim(),
    pressStatus: draft.pressStatus,
    identifyStatus: draft.identifyStatus,
    needsPhoto: draft.needsPhoto,
    status: toShelf ? "已上柜" : "待入库",
    cabinetId: toShelf ? draft.cabinetId : null,
    createdAt: now,
    shelvedAt: toShelf ? now : null,
  };
  return { ok: true, state: { ...state, specimens: [specimen, ...state.specimens] } };
}

export function shelve(state: HerbariumState, specimenId: string, cabinetId: string, now: string): ApplyResult {
  const specimen = state.specimens.find((s) => s.id === specimenId);
  if (!specimen) return { ok: false, state, message: "标本不存在" };
  const guard = canShelve(state, cabinetId);
  if (!guard.ok) return { ok: false, state, message: guard.reason };
  const specimens = state.specimens.map((s) =>
    s.id === specimenId
      ? { ...s, status: "已上柜" as const, cabinetId, shelvedAt: now, needsPhoto: false }
      : s,
  );
  return { ok: true, state: { ...state, specimens } };
}

/**
 * 规则：发起单柜盘点即冻结该柜位（其他柜位照常）。
 * 盘点范围 = 发起时该柜位在柜标本的快照。
 */
export function startStocktake(state: HerbariumState, cabinetId: string, now: string): ApplyResult {
  const starter = state.operator.trim();
  if (!starter) {
    return { ok: false, state, message: "请先填写当前盘点员姓名（发起人）" };
  }
  if (!state.cabinets.some((c) => c.id === cabinetId)) {
    return { ok: false, state, message: "柜位不存在" };
  }
  if (activeStocktakeOf(state, cabinetId)) {
    return { ok: false, state, message: `柜位 ${cabinetId} 已有进行中的盘点` };
  }
  const items: StocktakeItem[] = state.specimens
    .filter((s) => s.cabinetId === cabinetId && s.status === "已上柜")
    .map((s) => ({ specimenId: s.id, result: "pending" as const, discrepancies: [] }));
  const stocktake: Stocktake = {
    id: uid("st"),
    cabinetId,
    starter,
    startedAt: now,
    closedAt: null,
    items,
  };
  return { ok: true, state: { ...state, stocktakes: [...state.stocktakes, stocktake] } };
}

function mutateStocktake(state: HerbariumState, stocktakeId: string, fn: (s: Stocktake) => Stocktake): HerbariumState {
  return {
    ...state,
    stocktakes: state.stocktakes.map((s) => (s.id === stocktakeId ? fn(s) : s)),
  };
}

function setCheckResult(state: HerbariumState, stocktakeId: string, specimenId: string, result: StocktakeItem["result"]): ApplyResult {
  const stocktake = state.stocktakes.find((s) => s.id === stocktakeId);
  if (!stocktake || stocktake.closedAt !== null) return { ok: false, state, message: "盘点已结项，记录不可更改" };

  const next = mutateStocktake(state, stocktakeId, (s) => ({
    ...s,
    items: s.items.map((item) => {
      if (item.specimenId !== specimenId) return item;
      let discrepancies = item.discrepancies;
      if (result === "present") discrepancies = item.discrepancies.filter((d) => d.releasedAt !== null); // 改判在位时保留已放行凭证
      if (result === "missing") {
        discrepancies = [
          ...item.discrepancies.filter((d) => d.releasedAt !== null),
          item.discrepancies.find((d) => d.kind === "失联" && d.releasedAt === null) ??
            {
              id: uid("dc"),
              kind: "失联" as const,
              actualCabinetId: null,
              reasonDraft: "",
              confirmerDraft: "",
              disposition: "lost" as Disposition,
              reason: "",
              confirmer: "",
              releasedAt: null,
            },
        ];
      }
      if (result === "mismatch") {
        const existing = item.discrepancies.find((d) => d.kind === "柜位不符" && d.releasedAt === null);
        discrepancies = [
          ...item.discrepancies.filter((d) => d.releasedAt !== null),
          existing ??
            {
              id: uid("dc"),
              kind: "柜位不符" as const,
              actualCabinetId: null,
              reasonDraft: "",
              confirmerDraft: "",
              disposition: "return" as Disposition,
              reason: "",
              confirmer: "",
              releasedAt: null,
            },
        ];
      }
      return { ...item, result, discrepancies };
    }),
  }));
  return { ok: true, state: next };
}

export const markPresent = (state: HerbariumState, stocktakeId: string, specimenId: string): ApplyResult =>
  setCheckResult(state, stocktakeId, specimenId, "present");

export const markMissing = (state: HerbariumState, stocktakeId: string, specimenId: string): ApplyResult =>
  setCheckResult(state, stocktakeId, specimenId, "missing");

export const markMismatch = (
  state: HerbariumState,
  stocktakeId: string,
  specimenId: string,
  actualCabinetId: string,
): ApplyResult => {
  if (!actualCabinetId) return { ok: false, state, message: "请登记实际所在柜位" };
  const stocktake = state.stocktakes.find((s) => s.id === stocktakeId);
  if (!stocktake) return { ok: false, state, message: "盘点单不存在" };
  const result = setCheckResult(state, stocktakeId, specimenId, "mismatch");
  if (!result.ok) return result;
  const next = mutateStocktake(result.state, stocktakeId, (s) => ({
    ...s,
    items: s.items.map((item) =>
      item.specimenId !== specimenId
        ? item
        : {
            ...item,
            discrepancies: item.discrepancies.map((d) =>
              d.kind === "柜位不符" && d.releasedAt === null ? { ...d, actualCabinetId } : d,
            ),
          },
    ),
  }));
  return { ok: true, state: next };
}

/** 更新差异登记草稿（实际柜位 / 原因 / 确认人 / 处置方式），刷新前一直保留 */
export function updateDiscrepancyDraft(
  state: HerbariumState,
  stocktakeId: string,
  discrepancyId: string,
  patch: Partial<Pick<Discrepancy, "actualCabinetId" | "reasonDraft" | "confirmerDraft" | "disposition">>,
): ApplyResult {
  const stocktake = state.stocktakes.find((s) => s.id === stocktakeId);
  if (!stocktake || stocktake.closedAt !== null) return { ok: false, state, message: "盘点已结项" };
  const next = mutateStocktake(state, stocktakeId, (s) => ({
    ...s,
    items: s.items.map((item) => ({
      ...item,
      discrepancies: item.discrepancies.map((d) => (d.id === discrepancyId && d.releasedAt === null ? { ...d, ...patch } : d)),
    })),
  }));
  return { ok: true, state: next };
}

/**
 * 规则：差异登记原因并经另一名盘点员确认才能放行，缺任一项均拒绝。
 * 放行后登记内容固化，作为历史凭证保留。
 */
export function releaseDiscrepancy(
  state: HerbariumState,
  stocktakeId: string,
  discrepancyId: string,
  now: string,
): ApplyResult {
  const stocktake = state.stocktakes.find((s) => s.id === stocktakeId);
  if (!stocktake) return { ok: false, state, message: "盘点单不存在" };
  let target: Discrepancy | undefined;
  for (const item of stocktake.items) {
    target = item.discrepancies.find((d) => d.id === discrepancyId);
    if (target) break;
  }
  if (!target) return { ok: false, state, message: "差异记录不存在" };
  const check = validateRelease(state, stocktake, target);
  if (!check.ok) return { ok: false, state, message: check.message, field: check.field };

  const next = mutateStocktake(state, stocktakeId, (s) => ({
    ...s,
    items: s.items.map((item) => ({
      ...item,
      discrepancies: item.discrepancies.map((d) =>
        d.id === discrepancyId
          ? {
              ...d,
              reason: d.reasonDraft.trim(),
              confirmer: d.confirmerDraft.trim(),
              releasedAt: now,
            }
          : d,
      ),
    })),
  }));
  return { ok: true, state: next };
}

/**
 * 规则：结项后解冻（盘点单关闭即解除冻结）并更新盘点时间；
 * 同时按已放行处置方式落账：
 *  - 失联·确认失联：标本置为“失联”，保留最后已知柜位与全部历史，禁止导出；
 *  - 失联·找回 / 柜位不符·移回：标本维持原柜；
 *  - 柜位不符·更正：标本柜位更新为实际柜。
 */
export function closeStocktake(state: HerbariumState, stocktakeId: string, now: string): ApplyResult {
  const stocktake = state.stocktakes.find((s) => s.id === stocktakeId);
  if (!stocktake) return { ok: false, state, message: "盘点单不存在" };
  const check = canClose(stocktake);
  if (!check.ok) return { ok: false, state, message: check.reason };

  let specimens = state.specimens;
  for (const item of stocktake.items) {
    if (item.result === "present") continue; // 已改判在位的，放行凭证仅作历史保留，不再落账
    const released = item.discrepancies.find((d) => d.releasedAt !== null);
    if (!released) continue;
    specimens = specimens.map((sp) => {
      if (sp.id !== item.specimenId) return sp;
      if (released.kind === "失联") {
        return released.disposition === "lost"
          ? { ...sp, status: "失联" as const }
          : { ...sp, status: "已上柜" as const, cabinetId: stocktake.cabinetId };
      }
      // 柜位不符
      return released.disposition === "relocate" && released.actualCabinetId
        ? { ...sp, status: "已上柜" as const, cabinetId: released.actualCabinetId }
        : { ...sp, status: "已上柜" as const, cabinetId: stocktake.cabinetId };
    });
  }

  const next: HerbariumState = {
    ...state,
    specimens,
    stocktakes: state.stocktakes.map((s) => (s.id === stocktakeId ? { ...s, closedAt: now } : s)),
  };
  return { ok: true, state: next };
}

/** 标记/取消需补照，详情页与筛选同步 */
export function toggleNeedsPhoto(state: HerbariumState, specimenId: string): ApplyResult {
  const specimen = state.specimens.find((s) => s.id === specimenId);
  if (!specimen) return { ok: false, state, message: "标本不存在" };
  return {
    ok: true,
    state: {
      ...state,
      specimens: state.specimens.map((s) => (s.id === specimenId ? { ...s, needsPhoto: !s.needsPhoto } : s)),
    },
  };
}
