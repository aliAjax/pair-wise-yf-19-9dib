// =============================================================
// 业务文件 1：数据模型
// 只负责类型定义、浏览器本地存储与种子数据，不含任何业务规则。
// =============================================================

export const STORAGE_KEY = "hxyfront-62007-herbarium-v1";

export type PressStatus = "待压制" | "已压制";
export type IdentifyStatus = "待鉴定" | "已鉴定";

/** 标本的馆藏状态：待入库（入库队列）/ 已上柜 / 失联（盘点确认后） */
export type SpecimenStatus = "待入库" | "已上柜" | "失联";

/** 单柜盘点的明细结论 */
export type CheckResult = "pending" | "present" | "missing" | "mismatch";

export type DiscrepancyKind = "失联" | "柜位不符";

/** 差异放行时登记的处置方式 */
export type Disposition =
  | "return" // 柜位不符：已移回登记柜位
  | "relocate" // 柜位不符：按实际位置更正柜位
  | "found" // 失联：标本找回，确认在位
  | "lost"; // 失联：确认失联（禁止导出，历史保留）

export interface Cabinet {
  id: string; // 柜位号，如 B-12-04
  name: string; // 可读名称
}

export interface Specimen {
  id: string;
  collectNo: string; // 采集号
  species: string; // 物种名称
  locality: string; // 采集地点
  altitude: string; // 海拔
  habitat: string; // 生境描述
  collector: string; // 采集人
  pressStatus: PressStatus; // 压制状态
  identifyStatus: IdentifyStatus; // 鉴定状态
  needsPhoto: boolean; // 是否需补照
  status: SpecimenStatus;
  cabinetId: string | null; // 馆藏柜位（失联时保留最后已知柜位）
  createdAt: string;
  shelvedAt: string | null;
}

export interface Discrepancy {
  id: string;
  kind: DiscrepancyKind;
  actualCabinetId: string | null; // 柜位不符时实际所在柜
  /** 登记草稿：刷新后仍保留，但未放行前不生效 */
  reasonDraft: string; // 差异原因
  confirmerDraft: string; // 确认的另一名盘点员
  disposition: Disposition;
  /** 放行后固化的登记内容（历史凭证，不可再改） */
  reason: string;
  confirmer: string;
  releasedAt: string | null;
}

export interface StocktakeItem {
  specimenId: string;
  result: CheckResult;
  discrepancies: Discrepancy[];
}

/** 单柜盘点单 */
export interface Stocktake {
  id: string;
  cabinetId: string;
  starter: string; // 发起盘点的盘点员
  startedAt: string;
  closedAt: string | null; // 结项时间；null 表示进行中
  items: StocktakeItem[];
}

export interface HerbariumState {
  specimens: Specimen[];
  cabinets: Cabinet[];
  stocktakes: Stocktake[];
  operator: string; // 当前操作员（盘点发起人）
}

export interface SpecimenDraft {
  collectNo: string;
  species: string;
  locality: string;
  altitude: string;
  habitat: string;
  collector: string;
  pressStatus: PressStatus;
  identifyStatus: IdentifyStatus;
  needsPhoto: boolean;
  cabinetId: string | null;
}

export function uid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 直接截取 ISO 字符串中的本地时间分量，避免时区造成展示漂移 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

// -------------------------------------------------------------
// 种子数据（首次进入或本地数据损坏时使用）
// -------------------------------------------------------------

export function seedState(): HerbariumState {
  const cabinets: Cabinet[] = [
    { id: "A-01-02", name: "A区 1架 02柜" },
    { id: "A-01-05", name: "A区 1架 05柜" },
    { id: "B-12-04", name: "B区 12架 04柜" },
    { id: "B-12-07", name: "B区 12架 07柜" },
    { id: "C-03-01", name: "C区 3架 01柜" },
  ];

  const mk = (
    collectNo: string,
    species: string,
    locality: string,
    altitude: string,
    habitat: string,
    collector: string,
    pressStatus: PressStatus,
    identifyStatus: IdentifyStatus,
    needsPhoto: boolean,
    status: SpecimenStatus,
    cabinetId: string | null,
    createdAt: string,
    shelvedAt: string | null,
  ): Specimen => ({
    id: uid("sp"),
    collectNo,
    species,
    locality,
    altitude,
    habitat,
    collector,
    pressStatus,
    identifyStatus,
    needsPhoto,
    status,
    cabinetId,
    createdAt,
    shelvedAt,
  });

  const specimens: Specimen[] = [
    mk("HX-240619-09", "蔷薇属待定", "浙江清凉峰·千顷塘", "1050m", "灌草丛石隙", "陈济", "已压制", "待鉴定", false, "待入库", null, "2026-09-19T03:10:00.000Z", null),
    mk("HX-240619-02", "冬青属待定", "浙江天目山·三里亭", "640m", "林缘路旁", "陈济", "已压制", "已鉴定", false, "已上柜", "C-03-01", "2026-09-19T01:20:00.000Z", "2026-09-19T02:05:00.000Z"),
    mk("HX-240618-05", "鳞毛蕨属待定", "浙江天目山·阴湿沟谷", "870m", "林下沟边腐殖土", "沈聿青", "已压制", "已鉴定", false, "已上柜", "B-12-07", "2026-09-18T02:40:00.000Z", "2026-09-18T06:30:00.000Z"),
    mk("HX-240618-01", "兰科待定", "浙江天目山·吊水崖", "760m", "溪边阔叶林下", "何映雪", "待压制", "待鉴定", false, "待入库", null, "2026-09-18T01:00:00.000Z", null),
    mk("HX-240617-02", "黄山松", "浙江清凉峰·龙塘山", "1620m", "山顶针叶林", "陆时谦", "已压制", "已鉴定", true, "已上柜", "A-01-02", "2026-09-17T02:30:00.000Z", "2026-09-17T07:10:00.000Z"),
    mk("HX-240616-07", "荚蒾属待定", "浙江天目山·天坪岗", "1350m", "山顶灌丛", "何映雪", "已压制", "已鉴定", false, "已上柜", "A-01-02", "2026-09-16T03:20:00.000Z", "2026-09-16T08:00:00.000Z"),
    mk("HX-240616-03", "菊科待定", "浙江清凉峰·龙塘山", "1100m", "林缘草甸", "陆时谦", "待压制", "待鉴定", false, "已上柜", "B-12-04", "2026-09-16T01:40:00.000Z", "2026-09-16T05:20:00.000Z"),
    mk("HX-240615-08", "蕨类待定", "浙江天目山·阴湿沟谷", "980m", "沟谷阴湿石缝", "沈聿青", "已压制", "已鉴定", false, "待入库", null, "2026-09-15T04:30:00.000Z", null),
    mk("HX-240615-01", "槭属待定", "浙江天目山·三里亭", "1420m", "落叶阔叶疏林缘", "沈聿青", "已压制", "待鉴定", true, "已上柜", "B-12-04", "2026-09-15T01:15:00.000Z", "2026-09-15T03:40:00.000Z"),
  ];

  // 一条已结项的历史盘点，用于展示盘点时间与历史记录
  const stocktakes: Stocktake[] = [
    {
      id: uid("st"),
      cabinetId: "C-03-01",
      starter: "何映雪",
      startedAt: "2026-09-10T02:00:00.000Z",
      closedAt: "2026-09-10T03:02:00.000Z",
      items: [
        {
          specimenId: specimens[1].id,
          result: "present",
          discrepancies: [],
        },
      ],
    },
  ];

  return { specimens, cabinets, stocktakes, operator: "" };
}

export function loadState(): HerbariumState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as HerbariumState;
    if (!Array.isArray(parsed.specimens) || !Array.isArray(parsed.cabinets) || !Array.isArray(parsed.stocktakes)) {
      return seedState();
    }
    return { ...parsed, operator: "" };
  } catch {
    return seedState();
  }
}

export function saveState(state: HerbariumState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式或配额不足时静默降级，不影响当前会话
  }
}

/** 清空本地数据并重新写入种子（页面底部提供的维护入口） */
export function resetState(): HerbariumState {
  const fresh = seedState();
  saveState(fresh);
  return fresh;
}
