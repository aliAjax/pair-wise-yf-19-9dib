// 业务文件二：库房盘点规则
// 纯函数形式的盘点业务规则，不依赖 React/DOM，输入旧状态输出新状态。
//
// 闭环规则：
// 1. 单柜盘点开始后，该柜冻结新上柜；其他柜位照常。
// 2. 任一份标本“失联”或“柜位不符”，整柜自动暂挂，不能结项。
// 3. 每份差异必须登记原因，并由另一名盘点员（与发起人不同）确认才能放行；缺一项一律拒绝。
// 4. 只有全部应盘标本已清点、且无未放行差异，才允许结项。
// 5. 结项后解冻该柜并更新盘点时间；失联标本禁止导出，其历史轨迹永久保留。

import type {
  AppState,
  CheckResult,
  Discrepancy,
  DiscrepancyType,
  HistoryEvent,
  InventorySession,
  Specimen,
} from "./model";
import { formatLocation, nowText } from "./model";

export interface RuleResult {
  ok: boolean;
  error?: string;
  state: AppState;
}

const ok = (state: AppState): RuleResult => ({ ok: true, state });
const fail = (state: AppState, error: string): RuleResult => ({ ok: false, error, state });

function event(text: string): HistoryEvent {
  return { at: nowText(), text };
}

function appendHistory(specimen: Specimen, text: string): Specimen {
  return { ...specimen, history: [...specimen.history, event(text)] };
}

function patchSpecimen(state: AppState, id: string, patch: (s: Specimen) => Specimen): AppState {
  return { ...state, specimens: state.specimens.map((s) => (s.id === id ? patch(s) : s)) };
}

function nextId(state: AppState, prefix: string): { id: string; state: AppState } {
  const seq = state.seq + 1;
  return { id: `${prefix}-${String(seq).padStart(5, "0")}`, state: { ...state, seq } };
}

// 某柜是否有进行中的盘点（进行中/暂挂均冻结新上柜）
export function getActiveSession(state: AppState, cabinetId: string): InventorySession | undefined {
  return state.sessions.find((s) => s.cabinetId === cabinetId && s.status !== "已结项");
}

export function isCabinetFrozen(state: AppState, cabinetId: string): boolean {
  return Boolean(getActiveSession(state, cabinetId));
}

function isPositionTaken(state: AppState, cabinetId: string, position: string, exceptId?: string): boolean {
  const pos = position.trim();
  return state.specimens.some(
    (s) =>
      s.shelfStatus !== "失联" &&
      s.cabinetId === cabinetId &&
      (s.position ?? "") === pos &&
      s.id !== exceptId,
  );
}

// 根据差异与清点结果重算会话/柜位状态：有任何异常即整柜暂挂
function syncSessionStatus(session: InventorySession, discrepancies: Discrepancy[]): InventorySession {
  const pending = discrepancies.some(
    (d) => d.sessionId === session.id && d.status === "待处理",
  );
  const releasedIds = new Set(
    discrepancies.filter((d) => d.sessionId === session.id && d.status === "已放行").map((d) => d.specimenId),
  );
  const hasUnchecked = session.manifest.some((m) => !m.checked && !releasedIds.has(m.specimenId));
  const status: InventorySession["status"] =
    pending || hasUnchecked ? (session.status === "已结项" ? "已结项" : "暂挂") : "进行中";
  return { ...session, status };
}

function syncStateSession(state: AppState, sessionId: string): AppState {
  return {
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? syncSessionStatus(s, state.discrepancies) : s,
    ),
  };
}

// ---- 开始单柜盘点：冻结该柜新上柜 ----

export interface StartInventoryInput {
  cabinetId: string;
  leader: string;
}

export function startInventory(state: AppState, input: StartInventoryInput): RuleResult {
  const cabinet = state.cabinets.find((c) => c.id === input.cabinetId);
  if (!cabinet) return fail(state, "请选择要盘点的柜位");
  const leader = input.leader.trim();
  if (!leader) return fail(state, "请填写发起盘点的盘点员姓名");
  if (getActiveSession(state, input.cabinetId)) {
    return fail(state, `柜位 ${input.cabinetId} 已有进行中的盘点，不能重复发起`);
  }

  const at = nowText();
  const idAlloc = nextId(state, "PD");
  const session: InventorySession = {
    id: idAlloc.id,
    cabinetId: input.cabinetId,
    leader,
    startedAt: at,
    finishedAt: null,
    status: "进行中",
    lastInventoryAt: null,
    manifest: state.specimens
      .filter((s) => s.shelfStatus === "已上柜" && s.cabinetId === input.cabinetId)
      .map((s) => ({
        specimenId: s.id,
        checked: false,
        result: null,
        checkedBy: null,
        checkedAt: null,
      })),
  };
  return ok({ ...idAlloc.state, sessions: [session, ...state.sessions] });
}

// ---- 新上柜：盘点冻结柜拒绝，其他柜位照常 ----

export interface ShelfInput {
  specimenId: string;
  cabinetId: string;
  position: string;
}

export function shelfSpecimen(state: AppState, input: ShelfInput): RuleResult {
  const specimen = state.specimens.find((s) => s.id === input.specimenId);
  if (!specimen) return fail(state, "标本不存在");
  if (!state.cabinets.some((c) => c.id === input.cabinetId)) {
    return fail(state, "请选择柜位");
  }
  const position = input.position.trim();
  if (!position) return fail(state, "请填写柜内格位");
  if (isCabinetFrozen(state, input.cabinetId)) {
    return fail(state, `柜位 ${input.cabinetId} 正在盘点，已冻结新上柜`);
  }
  if (isPositionTaken(state, input.cabinetId, position, input.specimenId)) {
    return fail(state, `格位 ${input.cabinetId}-${position} 已有其他标本`);
  }

  let next = patchSpecimen(state, input.specimenId, (s) => ({
    ...appendHistory(s, `上柜至${formatLocation(input.cabinetId, position)}`),
    shelfStatus: "已上柜" as const,
    cabinetId: input.cabinetId,
    position,
  }));
  return ok(next);
}

// ---- 清点登记：一致 / 失联 / 柜位不符 ----

export interface CheckInput {
  sessionId: string;
  specimenId: string;
  result: CheckResult;
  checker: string;
  foundPosition?: string;
}

export function recordCheck(state: AppState, input: CheckInput): RuleResult {
  const session = state.sessions.find((s) => s.id === input.sessionId);
  if (!session) return fail(state, "盘点任务不存在");
  if (session.status === "已结项") return fail(state, "盘点已结项，不能再登记清点结果");
  const item = session.manifest.find((m) => m.specimenId === input.specimenId);
  if (!item) return fail(state, "该标本不在本柜盘点清单中");
  const checker = input.checker.trim();
  if (!checker) return fail(state, "请填写清点人姓名");

  const specimen = state.specimens.find((s) => s.id === input.specimenId)!;
  const foundPosition = (input.foundPosition ?? "").trim() || null;
  if (input.result === "柜位不符" && !foundPosition) {
    return fail(state, "登记柜位不符须填写实见格位");
  }
  const at = nowText();

  let next: AppState = {
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === input.sessionId
        ? {
            ...s,
            manifest: s.manifest.map((m) =>
              m.specimenId === input.specimenId
                ? { ...m, checked: true, result: input.result, checkedBy: checker, checkedAt: at }
                : m,
            ),
          }
        : s,
    ),
  };

  // 重新清点为“一致”：删除该标本本次盘点尚未放行的差异并还原台账位置
  if (input.result === "一致") {
    const removed = next.discrepancies.filter(
      (d) => d.sessionId === input.sessionId && d.specimenId === input.specimenId && d.status === "待处理",
    );
    next = {
      ...next,
      discrepancies: next.discrepancies.filter(
        (d) => !(d.sessionId === input.sessionId && d.specimenId === input.specimenId && d.status === "待处理"),
      ),
    };
    const oldResult = item.result;
    next = patchSpecimen(next, input.specimenId, (s) => {
      let updated: Specimen = { ...s };
      if (oldResult === "失联") {
        updated.shelfStatus = "已上柜";
      }
      if (oldResult === "柜位不符") {
        updated.shelfStatus = "已上柜";
      }
      updated.cabinetId = session.cabinetId;
      updated.position = specimen.position;
      if (removed.length > 0 || oldResult !== "一致") {
        updated = appendHistory(updated, `盘点复核一致（清点人 ${checker}）`);
      }
      return updated;
    });
    return ok(syncStateSession(next, input.sessionId));
  }

  // 已存在未放行差异则改为更新，避免重复登记
  const existing = next.discrepancies.find(
    (d) => d.sessionId === input.sessionId && d.specimenId === input.specimenId && d.status === "待处理",
  );
  const discrepancyType: DiscrepancyType = input.result === "失联" ? "失联" : "柜位不符";
  if (existing) {
    next = {
      ...next,
      discrepancies: next.discrepancies.map((d) =>
        d.id === existing.id
          ? { ...d, type: discrepancyType, foundPosition: input.result === "柜位不符" ? foundPosition : null }
          : d,
      ),
    };
  } else {
    const idAlloc = nextId(next, "DI");
    next = idAlloc.state;
    const discrepancy: Discrepancy = {
      id: idAlloc.id,
      sessionId: input.sessionId,
      cabinetId: session.cabinetId,
      specimenId: input.specimenId,
      type: discrepancyType,
      expectedPosition: specimen.position,
      foundPosition: input.result === "柜位不符" ? foundPosition : null,
      reason: "",
      confirmer: "",
      confirmedAt: null,
      status: "待处理",
      releasedAt: null,
      resolution: null,
    };
    next = { ...next, discrepancies: [discrepancy, ...next.discrepancies] };
  }

  // 差异即刻反映到标本台账：失联 / 柜位不符
  next = patchSpecimen(next, input.specimenId, (s) => {
    if (input.result === "失联") {
      return appendHistory({ ...s, shelfStatus: "失联" as const }, `盘点登记失联（清点人 ${checker}），待差异处理`);
    }
    // 柜位不符：台账仍挂在原柜，格位暂记实见位置，待差异放行时再决定移柜或归位
    return appendHistory(
      { ...s, shelfStatus: "已上柜" as const, cabinetId: session.cabinetId, position: foundPosition },
      `盘点登记柜位不符，实见格位 ${foundPosition || "未登记"}（清点人 ${checker}），待差异处理`,
    );
  });

  return ok(syncStateSession(next, input.sessionId));
}

// ---- 差异放行：原因 + 另一名盘点员确认，缺一不可 ----

export interface ReleaseInput {
  discrepancyId: string;
  reason: string;
  confirmer: string;
  // 柜位不符：true=移至实见格位（须给出目标柜位），false=归回台账原位
  moveToFound: boolean;
  targetCabinetId?: string;
}

export function releaseDiscrepancy(state: AppState, input: ReleaseInput): RuleResult {
  const discrepancy = state.discrepancies.find((d) => d.id === input.discrepancyId);
  if (!discrepancy) return fail(state, "差异记录不存在");
  if (discrepancy.status === "已放行") return fail(state, "该差异已放行，不能重复操作");
  const session = state.sessions.find((s) => s.id === discrepancy.sessionId);
  if (!session || session.status === "已结项") return fail(state, "盘点已结项，差异不能再处理");

  const reason = input.reason.trim();
  if (!reason) return fail(state, "请先登记差异原因，缺少原因不能放行");
  const confirmer = input.confirmer.trim();
  if (!confirmer) return fail(state, "须由另一名盘点员确认，缺少确认人不能放行");
  if (confirmer === session.leader) {
    return fail(state, "确认人不能是盘点发起人本人，须由另一名盘点员确认");
  }

  const specimen = state.specimens.find((s) => s.id === discrepancy.specimenId);
  if (!specimen) return fail(state, "标本不存在");

  const at = nowText();
  let next: AppState = {
    ...state,
    discrepancies: state.discrepancies.map((d) =>
      d.id === input.discrepancyId
        ? { ...d, reason, confirmer, confirmedAt: at, status: "已放行" as const, releasedAt: at }
        : d,
    ),
  };

  if (discrepancy.type === "失联") {
    next = patchSpecimen(next, specimen.id, (s) =>
      appendHistory(
        { ...s, shelfStatus: "失联" as const },
        `差异放行：原因「${reason}」，确认人 ${confirmer}；标本保持失联，禁止导出`,
      ),
    );
    const released = next.discrepancies.find((d) => d.id === input.discrepancyId)!;
    next = {
      ...next,
      discrepancies: next.discrepancies.map((d) =>
        d.id === released.id ? { ...d, resolution: "原位挂失联，继续追查" } : d,
      ),
    };
  } else {
    const expectedCabinet = discrepancy.cabinetId;
    if (input.moveToFound) {
      const targetCabinetId = (input.targetCabinetId ?? "").trim();
      if (!targetCabinetId) return fail(state, "请选择实见标本所在的柜位");
      if (!state.cabinets.some((c) => c.id === targetCabinetId)) return fail(state, "目标柜位不存在");
      const foundPos = discrepancy.foundPosition?.trim();
      if (!foundPos) return fail(state, "缺少实见格位，无法移柜更新");
      if (
        targetCabinetId !== expectedCabinet &&
        isCabinetFrozen(state, targetCabinetId)
      ) {
        return fail(state, `目标柜位 ${targetCabinetId} 正在盘点冻结中，暂不能移入`);
      }
      if (isPositionTaken(state, targetCabinetId, foundPos, specimen.id)) {
        return fail(state, `格位 ${targetCabinetId}-${foundPos} 已有其他标本`);
      }
      next = patchSpecimen(next, specimen.id, (s) =>
        appendHistory(
          { ...s, shelfStatus: "已上柜" as const, cabinetId: targetCabinetId, position: foundPos },
          `差异放行并更新柜位至${formatLocation(targetCabinetId, foundPos)}：原因「${reason}」，确认人 ${confirmer}`,
        ),
      );
      next = {
        ...next,
        discrepancies: next.discrepancies.map((d) =>
          d.id === input.discrepancyId
            ? { ...d, resolution: `已移至${formatLocation(targetCabinetId, foundPos)}` }
            : d,
        ),
      };
    } else {
      next = patchSpecimen(next, specimen.id, (s) =>
        appendHistory(
          { ...s, shelfStatus: "已上柜" as const, cabinetId: expectedCabinet, position: discrepancy.expectedPosition },
          `差异放行并归回台账原位${formatLocation(expectedCabinet, discrepancy.expectedPosition)}：原因「${reason}」，确认人 ${confirmer}`,
        ),
      );
      next = {
        ...next,
        discrepancies: next.discrepancies.map((d) =>
          d.id === input.discrepancyId
            ? { ...d, resolution: `归回${formatLocation(expectedCabinet, discrepancy.expectedPosition)}` }
            : d,
        ),
      };
    }
  }

  return ok(syncStateSession(next, session.id));
}

// ---- 结项门禁 ----

export interface CloseBlockers {
  unchecked: number;
  pendingDiscrepancies: number;
}

export function getCloseBlockers(state: AppState, sessionId: string): CloseBlockers {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { unchecked: 0, pendingDiscrepancies: 0 };
  // 已放行差异的标本视为已处理（如移柜标本已不在本柜），不再要求重登清点
  const releasedIds = new Set(
    state.discrepancies
      .filter((d) => d.sessionId === sessionId && d.status === "已放行")
      .map((d) => d.specimenId),
  );
  return {
    unchecked: session.manifest.filter((m) => !m.checked && !releasedIds.has(m.specimenId)).length,
    pendingDiscrepancies: state.discrepancies.filter(
      (d) => d.sessionId === sessionId && d.status === "待处理",
    ).length,
  };
}

// 清点进度：已清点一致 / 差异已放行 / 待处理
export function getProgress(state: AppState, session: InventorySession) {
  const releasedIds = new Set(
    state.discrepancies
      .filter((d) => d.sessionId === session.id && d.status === "已放行")
      .map((d) => d.specimenId),
  );
  const resolved = session.manifest.filter(
    (m) => (m.checked && m.result === "一致") || releasedIds.has(m.specimenId),
  ).length;
  const total = session.manifest.length;
  return { resolved, total };
}

export function closeInventory(state: AppState, sessionId: string): RuleResult {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return fail(state, "盘点任务不存在");
  if (session.status === "已结项") return fail(state, "该盘点已结项");
  const blockers = getCloseBlockers(state, sessionId);
  if (blockers.unchecked > 0) {
    return fail(state, `仍有 ${blockers.unchecked} 份标本未清点，不能结项`);
  }
  if (blockers.pendingDiscrepancies > 0) {
    return fail(state, `仍有 ${blockers.pendingDiscrepancies} 份差异未放行，整柜暂挂中，不能结项`);
  }

  const at = nowText();
  const next: AppState = {
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId
        ? { ...s, status: "已结项" as const, finishedAt: at, lastInventoryAt: at }
        : s,
    ),
  };
  return ok(next);
}

// 柜位最近一次盘点时间（结项后写入）
export function getLastInventoryAt(state: AppState, cabinetId: string): string | null {
  const finished = state.sessions
    .filter((s) => s.cabinetId === cabinetId && s.status === "已结项")
    .map((s) => s.lastInventoryAt ?? s.finishedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .reverse();
  return finished[0] ?? null;
}

// 失联标本禁止导出
export function isExportable(specimen: Specimen): boolean {
  return specimen.shelfStatus !== "失联";
}

// 导出当前筛选结果（自动剔除失联标本）
export function exportSpecimensCsv(specimens: Specimen[]): string {
  const header = ["馆内编号", "采集号", "物种名称", "采集地点", "海拔", "生境描述", "采集人", "压制状态", "鉴定状态", "馆藏位置", "需补照", "登记时间"];
  const escape = (value: string | null): string => {
    const text = value ?? "";
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = specimens
    .filter(isExportable)
    .map((s) =>
      [
        s.id,
        s.collectingNo,
        s.species,
        s.locality,
        s.altitude,
        s.habitat,
        s.collector,
        s.pressStatus,
        s.identStatus,
        formatLocation(s.cabinetId, s.position),
        s.needPhoto ? "需补照" : "",
        s.createdAt,
      ]
        .map((cell) => escape(cell))
        .join(","),
    );
  return [header.join(","), ...rows].join("\n");
}
