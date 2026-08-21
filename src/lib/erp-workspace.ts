export type FocusedWorkspaceModule =
  | "master"
  | "sales"
  | "production"
  | "purchase"
  | "warehouse"
  | "suppliers"
  | "quality"
  | "finance"
  | "reports"
  | "approval"
  | "system";

export type WorkspaceTab = {
  key: string;
  label: string;
  description: string;
};

export type WorkspaceDefinition = {
  defaultTab: string;
  tabs: WorkspaceTab[];
};

const workspaceDefinitions: Record<FocusedWorkspaceModule, WorkspaceDefinition> = {
  master: {
    defaultTab: "records",
    tabs: [
      { key: "records", label: "主档查询", description: "客户、物料、产品与 BOM 的统一入口" },
      { key: "full", label: "维护与初始化", description: "新建、导入、版本和期初初始化" },
    ],
  },
  sales: {
    defaultTab: "pending",
    tabs: [
      { key: "pending", label: "销售待办", description: "待确认报价、待转订单、待发货与回款风险" },
      { key: "full", label: "销售全流程", description: "报价、订单、交付、退货与对账" },
    ],
  },
  production: {
    defaultTab: "tasks",
    tabs: [
      { key: "tasks", label: "生产任务", description: "今天要推进的生产单、领料和交期风险" },
      { key: "full", label: "计划与高级操作", description: "排产、变更、报工、打印及完整生产台账" },
    ],
  },
  purchase: {
    defaultTab: "pending",
    tabs: [
      { key: "pending", label: "采购待办", description: "MRP 缺口、采购申请、待下单和待到货" },
      { key: "full", label: "采购全流程", description: "申请、订单、合同、到货与采购台账" },
    ],
  },
  warehouse: {
    defaultTab: "today",
    tabs: [
      { key: "today", label: "今日作业", description: "今天要收、要发、要盘的仓库任务" },
      { key: "full", label: "库存与追溯", description: "库存、批次、盘点、库龄及完整仓储能力" },
    ],
  },
  suppliers: {
    defaultTab: "risks",
    tabs: [
      { key: "risks", label: "风险与整改", description: "资质临期、准入限制、绩效和整改任务" },
      { key: "full", label: "供应商全景", description: "主档、证书、规则、绩效、复评与观察期" },
    ],
  },
  quality: {
    defaultTab: "queue",
    tabs: [
      { key: "queue", label: "待检与异常", description: "来料、生产检验及技术处置队列" },
      { key: "full", label: "质量全流程", description: "请验、判定、处置、入库及质量分析" },
    ],
  },
  finance: {
    defaultTab: "pending",
    tabs: [
      { key: "pending", label: "财务待办", description: "待收、待付、退款和异常账款" },
      { key: "full", label: "收付与对账", description: "登记、退款、导出及完整财务台账" },
    ],
  },
  reports: {
    defaultTab: "catalog",
    tabs: [
      { key: "catalog", label: "报表目录", description: "按业务主题选择报表和最近快照" },
      { key: "full", label: "高级分析", description: "组合筛选、预览、导出及历史分析" },
    ],
  },
  approval: {
    defaultTab: "pending",
    tabs: [
      { key: "pending", label: "待我审批", description: "集中处理有权限的待审批事项" },
      { key: "full", label: "规则与高级功能", description: "审批发起、规则、订阅及价格试算" },
    ],
  },
  system: {
    defaultTab: "accounts",
    tabs: [
      { key: "accounts", label: "账号与权限", description: "用户、角色和权限矩阵" },
      { key: "settings", label: "业务参数", description: "系统设置、编号规则和运行参数" },
      { key: "audit", label: "安全审计", description: "登录记录和关键操作日志" },
      { key: "advanced", label: "高级运维", description: "健康检查、恢复、初始化及全部系统能力" },
    ],
  },
};

export function workspaceFor(module: FocusedWorkspaceModule): WorkspaceDefinition {
  return workspaceDefinitions[module];
}
