export type FocusedWorkspaceModule = "production" | "quality" | "approval" | "system";

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
  production: {
    defaultTab: "tasks",
    tabs: [
      { key: "tasks", label: "生产任务", description: "今天要推进的生产单、领料和交期风险" },
      { key: "full", label: "计划与高级操作", description: "排产、变更、报工、打印及完整生产台账" },
    ],
  },
  quality: {
    defaultTab: "queue",
    tabs: [
      { key: "queue", label: "待检与异常", description: "来料、生产检验及技术处置队列" },
      { key: "full", label: "质量全流程", description: "请验、判定、处置、入库及质量分析" },
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
