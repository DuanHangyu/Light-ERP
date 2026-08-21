import { flatNavigationForRole, type ErpRole, type ModuleKey } from "./erp-navigation";

export type WorkbenchTask = {
  id: string;
  title: string;
  detail: string;
  entityType: string;
  tone: "amber" | "green" | "blue" | "rose" | "neutral";
  [key: string]: unknown;
};

export type WorkbenchAlert = {
  id?: unknown;
  severity?: unknown;
  title?: unknown;
  [key: string]: unknown;
};

export type WorkbenchMetric = {
  key: string;
  label: string;
  value: number;
  format: "count" | "currency" | "percent";
};

export type WorkbenchModel<TTask extends WorkbenchTask, TAlert extends WorkbenchAlert> = {
  headline: string;
  priorityTaskCount: number;
  tasks: TTask[];
  alerts: TAlert[];
  metrics: WorkbenchMetric[];
  quickLinks: Array<{ key: ModuleKey; label: string }>;
};

type Summary = Record<string, number | undefined>;

const taskPriority: Record<WorkbenchTask["tone"], number> = {
  rose: 0,
  amber: 1,
  blue: 2,
  green: 3,
  neutral: 4,
};

const alertPriority: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const metricDefinition: Record<ErpRole, Array<Omit<WorkbenchMetric, "value">>> = {
  sales: [
    { key: "pendingTasks", label: "我的待办", format: "count" },
    { key: "orderAmount", label: "销售订单额", format: "currency" },
    { key: "receivableBalance", label: "应收余额", format: "currency" },
    { key: "alertCount", label: "销售相关预警", format: "count" },
  ],
  assistant: [
    { key: "pendingTasks", label: "我的待办", format: "count" },
    { key: "activeProductions", label: "在制订单", format: "count" },
    { key: "receivableBalance", label: "待收款", format: "currency" },
    { key: "alertCount", label: "交付预警", format: "count" },
  ],
  production: [
    { key: "pendingTasks", label: "我的待办", format: "count" },
    { key: "activeProductions", label: "在制生产单", format: "count" },
    { key: "mrpShortageLineCount", label: "缺料项", format: "count" },
    { key: "lowYieldWarningCount", label: "低收率预警", format: "count" },
  ],
  warehouse: [
    { key: "pendingTasks", label: "我的待办", format: "count" },
    { key: "lowStockCount", label: "低库存", format: "count" },
    { key: "overstockCount", label: "积压库存", format: "count" },
    { key: "inventoryValue", label: "库存总值", format: "currency" },
  ],
  purchasing: [
    { key: "pendingTasks", label: "我的待办", format: "count" },
    { key: "mrpShortageLineCount", label: "MRP 缺料项", format: "count" },
    { key: "purchaseAmount", label: "采购金额", format: "currency" },
    { key: "supplierRiskCount", label: "供应商风险", format: "count" },
  ],
  quality: [
    { key: "pendingTasks", label: "待检任务", format: "count" },
    { key: "qualityExceptionCount", label: "质量异常", format: "count" },
    { key: "qualityClosureRate", label: "异常关闭率", format: "percent" },
    { key: "lowYieldWarningCount", label: "低收率预警", format: "count" },
  ],
  technical: [
    { key: "pendingTasks", label: "待处置任务", format: "count" },
    { key: "qualityExceptionCount", label: "质量异常", format: "count" },
    { key: "lowYieldWarningCount", label: "低收率预警", format: "count" },
    { key: "alertCount", label: "相关预警", format: "count" },
  ],
  manager: [
    { key: "pendingTasks", label: "待决策事项", format: "count" },
    { key: "orderAmount", label: "销售订单额", format: "currency" },
    { key: "inventoryValue", label: "库存总值", format: "currency" },
    { key: "alertCount", label: "经营预警", format: "count" },
  ],
  finance: [
    { key: "pendingTasks", label: "我的待办", format: "count" },
    { key: "receivableBalance", label: "应收余额", format: "currency" },
    { key: "payableBalance", label: "应付余额", format: "currency" },
    { key: "alertCount", label: "账款预警", format: "count" },
  ],
  admin: [
    { key: "pendingTasks", label: "系统待办", format: "count" },
    { key: "systemHealthCriticalCount", label: "上线阻断", format: "count" },
    { key: "systemHealthWarningCount", label: "系统关注项", format: "count" },
    { key: "alertCount", label: "全局预警", format: "count" },
  ],
};

function roleOrAdmin(role: string): ErpRole {
  return role in metricDefinition ? (role as ErpRole) : "admin";
}

export function buildWorkbenchModel<TTask extends WorkbenchTask, TAlert extends WorkbenchAlert>(
  role: string,
  tasks: TTask[],
  alerts: TAlert[],
  summary: Summary,
): WorkbenchModel<TTask, TAlert> {
  const indexedTasks = tasks.map((task, index) => ({ task, index }));
  const visibleTasks = indexedTasks
    .sort((a, b) => taskPriority[a.task.tone] - taskPriority[b.task.tone] || a.index - b.index)
    .slice(0, 6)
    .map(({ task }) => task);
  const priorityTaskCount = tasks.filter((task) => task.tone === "rose" || task.tone === "amber").length;
  const taskCount = Math.max(tasks.length, summary.pendingTasks ?? 0);

  const visibleAlerts = alerts
    .map((alert, index) => ({ alert, index }))
    .sort(
      (a, b) =>
        (alertPriority[String(a.alert.severity ?? "")] ?? 9) - (alertPriority[String(b.alert.severity ?? "")] ?? 9) ||
        a.index - b.index,
    )
    .slice(0, 5)
    .map(({ alert }) => alert);

  const normalizedRole = roleOrAdmin(role);
  const metrics = metricDefinition[normalizedRole].map((metric) => ({
    ...metric,
    value: summary[metric.key] ?? 0,
  }));
  const quickLinks = flatNavigationForRole(role)
    .filter((item) => item.key !== "workbench")
    .slice(0, 4)
    .map((item) => ({ key: item.key, label: item.label }));

  return {
    headline: `今天有 ${taskCount} 项待办，其中 ${priorityTaskCount} 项需要优先处理`,
    priorityTaskCount,
    tasks: visibleTasks,
    alerts: visibleAlerts,
    metrics,
    quickLinks,
  };
}
