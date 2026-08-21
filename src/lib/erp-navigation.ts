export const erpRoles = [
  "sales",
  "assistant",
  "production",
  "warehouse",
  "purchasing",
  "quality",
  "technical",
  "manager",
  "finance",
  "admin",
] as const;

export type ErpRole = (typeof erpRoles)[number];

export type ModuleKey =
  | "workbench"
  | "process"
  | "master"
  | "sales"
  | "production"
  | "purchase"
  | "warehouse"
  | "suppliers"
  | "quality"
  | "finance"
  | "reports"
  | "alerts"
  | "approval"
  | "archive"
  | "system"
  | "parallel";

export type NavigationGroupKey = "work" | "operations" | "supply" | "finance" | "foundation" | "system" | "isolated";

export type NavigationItem = {
  key: ModuleKey;
  label: string;
  title: string;
  subtitle: string;
  group: NavigationGroupKey;
  icon: "workbench" | "process" | "database" | "sales" | "production" | "purchase" | "warehouse" | "supplier" | "quality" | "finance" | "report" | "alert" | "approval" | "archive" | "system" | "parallel";
};

export type NavigationGroup = {
  key: NavigationGroupKey;
  label: string;
  items: NavigationItem[];
};

export type NavigationAccess = {
  hasParallelAccess?: boolean;
};

const navigationGroups: Array<{ key: NavigationGroupKey; label: string }> = [
  { key: "work", label: "工作" },
  { key: "operations", label: "业务运营" },
  { key: "supply", label: "供应链" },
  { key: "finance", label: "财务与分析" },
  { key: "foundation", label: "基础与协作" },
  { key: "system", label: "系统管理" },
  { key: "isolated", label: "隔离工作区" },
];

export const moduleCatalog: Record<ModuleKey, NavigationItem> = {
  workbench: {
    key: "workbench",
    label: "我的工作台",
    title: "我的工作台",
    subtitle: "待办、异常与下一步动作",
    group: "work",
    icon: "workbench",
  },
  process: {
    key: "process",
    label: "流程监控",
    title: "流程监控",
    subtitle: "订单主线、阻塞节点与部门责任",
    group: "operations",
    icon: "process",
  },
  master: {
    key: "master",
    label: "主数据",
    title: "主数据",
    subtitle: "客户、供应商、物料、产品与 BOM",
    group: "foundation",
    icon: "database",
  },
  sales: {
    key: "sales",
    label: "销售管理",
    title: "销售管理",
    subtitle: "待处理、报价、订单、交付与退货",
    group: "operations",
    icon: "sales",
  },
  production: {
    key: "production",
    label: "生产管理",
    title: "生产管理",
    subtitle: "生产任务、计划、执行、日报与成本",
    group: "operations",
    icon: "production",
  },
  purchase: {
    key: "purchase",
    label: "采购管理",
    title: "采购管理",
    subtitle: "采购待办、MRP、申请、订单、合同与到货",
    group: "supply",
    icon: "purchase",
  },
  warehouse: {
    key: "warehouse",
    label: "库存仓储",
    title: "库存仓储",
    subtitle: "今日作业、收货、发料、库存、批次与盘点",
    group: "supply",
    icon: "warehouse",
  },
  suppliers: {
    key: "suppliers",
    label: "供应商管理",
    title: "供应商管理",
    subtitle: "资质、准入、绩效、复评与整改",
    group: "supply",
    icon: "supplier",
  },
  quality: {
    key: "quality",
    label: "质量管理",
    title: "质量管理",
    subtitle: "待检任务、IQC、成品检验与技术处置",
    group: "operations",
    icon: "quality",
  },
  finance: {
    key: "finance",
    label: "应收应付",
    title: "财务工作台",
    subtitle: "应收、应付、收付款、退款与冲销",
    group: "finance",
    icon: "finance",
  },
  reports: {
    key: "reports",
    label: "报表中心",
    title: "报表中心",
    subtitle: "经营分析、业务对账与报表导出",
    group: "finance",
    icon: "report",
  },
  alerts: {
    key: "alerts",
    label: "预警与整改",
    title: "预警与整改",
    subtitle: "经营预警、成本异常、整改任务与规则",
    group: "finance",
    icon: "alert",
  },
  approval: {
    key: "approval",
    label: "审批中心",
    title: "审批中心",
    subtitle: "我的待审批、我发起的、审批历史与规则",
    group: "foundation",
    icon: "approval",
  },
  archive: {
    key: "archive",
    label: "档案中心",
    title: "档案中心",
    subtitle: "附件、导出记录与冷备份",
    group: "foundation",
    icon: "archive",
  },
  system: {
    key: "system",
    label: "系统管理",
    title: "系统管理",
    subtitle: "账号权限、系统参数、编号与审计",
    group: "system",
    icon: "system",
  },
  parallel: {
    key: "parallel",
    label: "平行账套",
    title: "平行账套",
    subtitle: "独立测算、影响评估与合并预览",
    group: "isolated",
    icon: "parallel",
  },
};

const roleModules: Record<ErpRole, ModuleKey[]> = {
  sales: ["workbench", "sales", "master", "approval", "reports"],
  assistant: ["workbench", "sales", "warehouse", "approval", "archive"],
  production: ["workbench", "production", "quality", "master", "approval", "reports"],
  warehouse: ["workbench", "warehouse", "quality", "production", "approval"],
  purchasing: ["workbench", "purchase", "suppliers", "warehouse", "approval"],
  quality: ["workbench", "quality", "production", "approval", "reports"],
  technical: ["workbench", "quality", "production", "master", "approval"],
  manager: ["workbench", "process", "alerts", "approval", "reports", "finance"],
  finance: ["workbench", "finance", "alerts", "approval", "reports"],
  admin: [
    "workbench",
    "process",
    "sales",
    "production",
    "quality",
    "purchase",
    "warehouse",
    "suppliers",
    "finance",
    "reports",
    "alerts",
    "master",
    "approval",
    "archive",
    "system",
  ],
};

function knownRole(role: string): ErpRole | undefined {
  return erpRoles.find((candidate) => candidate === role);
}

export function flatNavigationForRole(role: string, access: NavigationAccess = {}): NavigationItem[] {
  const normalizedRole = knownRole(role);
  const baseKeys = normalizedRole ? roleModules[normalizedRole] : ["workbench" as const];
  const keys = access.hasParallelAccess && !baseKeys.includes("parallel")
    ? [...baseKeys, "parallel" as const]
    : baseKeys;
  return keys.map((key) => moduleCatalog[key]);
}

export function navigationForRole(role: string, access: NavigationAccess = {}): NavigationGroup[] {
  const items = flatNavigationForRole(role, access);
  return navigationGroups
    .map((group) => ({
      ...group,
      items: items.filter((item) => item.group === group.key),
    }))
    .filter((group) => group.items.length > 0);
}

export function isModuleAccessible(role: string, module: ModuleKey, access: NavigationAccess = {}): boolean {
  return flatNavigationForRole(role, access).some((item) => item.key === module);
}

export function resolveAccessibleModule(role: string, requested: ModuleKey, access: NavigationAccess = {}): ModuleKey {
  return isModuleAccessible(role, requested, access) ? requested : "workbench";
}
