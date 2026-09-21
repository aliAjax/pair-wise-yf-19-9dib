// 业务文件一：数据模型
// 标本、柜位、差异、盘点会话的类型定义，以及只依赖浏览器 localStorage 的本地数据仓库。
// 所有数据保存在浏览器本地，刷新页面后保留；不依赖任何后端服务。

export type PressStatus = "待压制" | "已压制";
export type IdentStatus = "待鉴定" | "已鉴定";
export type ShelfStatus = "待上柜" | "已上柜" | "失联";

export interface HistoryEvent {
  at: string;
  text: string;
}

export interface Specimen {
  id: string; // 馆内编号
  collectingNo: string; // 采集号
  species: string; // 物种名称
  locality: string; // 采集地点
  altitude: string; // 海拔
  habitat: string; // 生境描述
  collector: string; // 采集人
  pressStatus: PressStatus; // 压制状态
  identStatus: IdentStatus; // 鉴定状态
  shelfStatus: ShelfStatus; // 上柜/失联状态
  cabinetId: string | null; // 馆藏柜位
  position: string | null; // 柜内格位，如 3-02
  needPhoto: boolean; // 需补照
  createdAt: string;
  history: HistoryEvent[]; // 历史轨迹，永久保留
}

export interface Cabinet {
  id: string; // 柜号，如 A-12
  name: string;
  room: string; // 库房/房间
}

export type DiscrepancyType = "失联" | "柜位不符";
export type CheckResult = "一致" | DiscrepancyType;
export type DiscrepancyStatus = "待处理" | "已放行";

export interface Discrepancy {
  id: string;
  sessionId: string;
  cabinetId: string;
  specimenId: string;
  type: DiscrepancyType;
  expectedPosition: string | null; // 台账位置
  foundPosition: string | null; // 实查位置（柜位不符时登记）
  reason: string; // 差异原因
  confirmer: string; // 另一名盘点员
  confirmedAt: string | null;
  status: DiscrepancyStatus;
  releasedAt: string | null;
  resolution: string | null; // 放行处理说明（原位挂失联 / 已移至…）
}

// manifest: 本次盘点应清点的标本快照（开始时已在该柜的标本）
export interface ManifestItem {
  specimenId: string;
  checked: boolean;
  result: CheckResult | null;
  checkedBy: string | null;
  checkedAt: string | null;
}

export type SessionStatus = "进行中" | "暂挂" | "已结项";

export interface InventorySession {
  id: string;
  cabinetId: string;
  leader: string; // 发起盘点的盘点员
  startedAt: string;
  finishedAt: string | null;
  status: SessionStatus;
  lastInventoryAt: string | null; // 结项时写入柜位的盘点时间
  manifest: ManifestItem[];
}

export interface AppState {
  specimens: Specimen[];
  cabinets: Cabinet[];
  discrepancies: Discrepancy[];
  sessions: InventorySession[];
  seq: number;
}

export interface SpecimenInput {
  collectingNo: string;
  species: string;
  locality: string;
  altitude: string;
  habitat: string;
  collector: string;
  pressStatus: PressStatus;
  identStatus: IdentStatus;
  needPhoto: boolean;
  cabinetId: string | null;
  position: string | null;
}

const STORAGE_KEY = "herbarium.store.v1";

export function nowText(): string {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

export function formatLocation(cabinetId: string | null, position: string | null): string {
  if (!cabinetId) return "未上柜";
  return position ? `柜位${cabinetId}-${position}` : `柜位${cabinetId}`;
}

function makeSpecimen(seq: number, data: SpecimenInput): Specimen {
  const at = nowText();
  const shelved = Boolean(data.cabinetId);
  return {
    id: `SP-${String(seq).padStart(4, "0")}`,
    collectingNo: data.collectingNo,
    species: data.species,
    locality: data.locality,
    altitude: data.altitude,
    habitat: data.habitat,
    collector: data.collector,
    pressStatus: data.pressStatus,
    identStatus: data.identStatus,
    shelfStatus: shelved ? "已上柜" : "待上柜",
    cabinetId: shelved ? data.cabinetId : null,
    position: shelved ? data.position : null,
    needPhoto: data.needPhoto,
    createdAt: at,
    history: [
      { at, text: shelved ? `入库并上柜至${formatLocation(data.cabinetId, data.position)}` : "入库，进入待上柜队列" },
    ],
  };
}

function seed(): AppState {
  const cabinets: Cabinet[] = [
    { id: "A-12", name: "蕨类与裸子柜", room: "一号库房" },
    { id: "B-07", name: "菊科专用柜", room: "一号库房" },
    { id: "C-03", name: "槭树科模式柜", room: "二号库房" },
  ];
  const inputs: SpecimenInput[] = [
    { collectingNo: "HX-240615-01", species: "槭属待定", locality: "秦岭光头山西坡", altitude: "1420m", habitat: "落叶阔叶林下阴坡", collector: "周岚", pressStatus: "已压制", identStatus: "待鉴定", needPhoto: true, cabinetId: "C-03", position: "1-02" },
    { collectingNo: "HX-240615-02", species: "中华荚果蕨", locality: "秦岭光头山沟谷", altitude: "1310m", habitat: "溪旁石缝", collector: "李南", pressStatus: "已压制", identStatus: "已鉴定", needPhoto: false, cabinetId: "A-12", position: "2-05" },
    { collectingNo: "HX-240615-03", species: "秦岭槭", locality: "秦岭光头山梁顶", altitude: "1680m", habitat: "针阔混交林缘", collector: "周岚", pressStatus: "已压制", identStatus: "已鉴定", needPhoto: false, cabinetId: "C-03", position: "1-03" },
    { collectingNo: "HX-240615-04", species: "三脉紫菀", locality: "长安沣峪河滩", altitude: "760m", habitat: "河滩砾石地", collector: "李南", pressStatus: "已压制", identStatus: "待鉴定", needPhoto: true, cabinetId: "B-07", position: "3-01" },
    { collectingNo: "HX-240615-05", species: "蹄盖蕨一种", locality: "太平峪桦林湾", altitude: "1180m", habitat: "腐木表面", collector: "陈屿", pressStatus: "已压制", identStatus: "待鉴定", needPhoto: false, cabinetId: "A-12", position: "2-06" },
    { collectingNo: "HX-240615-06", species: "魁蓟", locality: "沣峪分水岭", altitude: "2010m", habitat: "高山灌丛", collector: "周岚", pressStatus: "已压制", identStatus: "已鉴定", needPhoto: false, cabinetId: "B-07", position: "3-02" },
    { collectingNo: "HX-240615-07", species: "东风菜", locality: "朱雀森林公园", altitude: "1500m", habitat: "林缘草坡", collector: "陈屿", pressStatus: "待压制", identStatus: "待鉴定", needPhoto: false, cabinetId: null, position: null },
    { collectingNo: "HX-240615-08", species: "蕨类待定", locality: "太平峪阴湿沟谷", altitude: "980m", habitat: "阴湿沟谷石下", collector: "李南", pressStatus: "待压制", identStatus: "待鉴定", needPhoto: true, cabinetId: null, position: null },
    { collectingNo: "HX-240616-01", species: "蒲儿根", locality: "沣峪罗汉坪", altitude: "890m", habitat: "田边湿地", collector: "周岚", pressStatus: "已压制", identStatus: "已鉴定", needPhoto: false, cabinetId: "B-07", position: "4-04" },
    { collectingNo: "HX-240616-02", species: "银粉背蕨", locality: "太白山回心石", altitude: "1750m", habitat: "干旱岩壁", collector: "陈屿", pressStatus: "已压制", identStatus: "已鉴定", needPhoto: false, cabinetId: "A-12", position: "2-07" },
    { collectingNo: "HX-240616-03", species: "菊科待定", locality: "秦岭鸡窝子", altitude: "1990m", habitat: "路边草丛", collector: "李南", pressStatus: "已压制", identStatus: "待鉴定", needPhoto: true, cabinetId: "B-07", position: "3-03" },
    { collectingNo: "HX-240616-04", species: "青榨槭", locality: "宁陕广货街", altitude: "1220m", habitat: "河谷次生林", collector: "周岚", pressStatus: "已压制", identStatus: "已鉴定", needPhoto: false, cabinetId: "C-03", position: "1-04" },
  ];
  const specimens = inputs.map((input, i) => makeSpecimen(i + 1, input));
  return {
    specimens,
    cabinets,
    discrepancies: [],
    sessions: [],
    seq: specimens.length,
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.specimens) && Array.isArray(parsed.cabinets)) {
        return parsed;
      }
    }
  } catch {
    // 本地数据损坏时回退到演示数据
  }
  return seed();
}

export function addSpecimen(state: AppState, input: SpecimenInput): AppState {
  // 调用方负责校验柜位是否盘点冻结、格位是否冲突
  const specimen = makeSpecimen(state.seq + 1, input);
  return { ...state, specimens: [specimen, ...state.specimens], seq: state.seq + 1 };
}

// ---- 轻量订阅仓库：组件跨页面（筛选/柜位记录/详情）共享同一份状态 ----

export interface Store {
  getState(): AppState;
  setState(updater: (prev: AppState) => AppState): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
}

export function createStore(): Store {
  let state = loadState();
  const listeners = new Set<() => void>();

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储空间不足等情况静默处理，内存中的操作仍然生效
    }
  };

  return {
    getState: () => state,
    setState: (updater) => {
      state = updater(state);
      persist();
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => {
      state = seed();
      persist();
      listeners.forEach((listener) => listener());
    },
  };
}

export function canCollectingNoBeUsed(state: AppState, collectingNo: string, exceptId?: string): boolean {
  const value = collectingNo.trim();
  return !state.specimens.some((s) => s.collectingNo === value && s.id !== exceptId);
}
