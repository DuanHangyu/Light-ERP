import { describe, expect, it } from "vitest";
import { buildWorkbenchModel } from "./erp-workbench";

describe("role workbench model", () => {
  it("puts urgent tasks first and limits the first screen to six", () => {
    const tasks = [
      { id: "1", title: "普通", detail: "", entityType: "order", tone: "neutral" as const },
      { id: "2", title: "紧急", detail: "", entityType: "order", tone: "rose" as const },
      { id: "3", title: "等待", detail: "", entityType: "order", tone: "amber" as const },
      { id: "4", title: "处理中", detail: "", entityType: "order", tone: "blue" as const },
      { id: "5", title: "完成", detail: "", entityType: "order", tone: "green" as const },
      { id: "6", title: "普通2", detail: "", entityType: "order", tone: "neutral" as const },
      { id: "7", title: "普通3", detail: "", entityType: "order", tone: "neutral" as const },
    ];

    const model = buildWorkbenchModel("sales", tasks, [], { pendingTasks: 7 });

    expect(model.tasks).toHaveLength(6);
    expect(model.tasks.map((task) => task.title).slice(0, 3)).toEqual(["紧急", "等待", "处理中"]);
    expect(model.priorityTaskCount).toBe(2);
    expect(model.headline).toBe("今天有 7 项待办，其中 2 项需要优先处理");
  });

  it("limits and sorts alerts by severity", () => {
    const alerts = [
      { id: "1", severity: "low", title: "低" },
      { id: "2", severity: "critical", title: "紧急" },
      { id: "3", severity: "medium", title: "中" },
      { id: "4", severity: "high", title: "高" },
      { id: "5", severity: "low", title: "低2" },
      { id: "6", severity: "critical", title: "紧急2" },
    ];

    const model = buildWorkbenchModel("manager", [], alerts, {});

    expect(model.alerts).toHaveLength(5);
    expect(model.alerts.map((alert) => alert.title).slice(0, 3)).toEqual(["紧急", "紧急2", "高"]);
  });

  it("selects at most four metrics that match the current role", () => {
    const summary = {
      pendingTasks: 3,
      inventoryValue: 9243.7,
      lowStockCount: 2,
      overstockCount: 4,
      receivableBalance: 7000,
      payableBalance: 3160,
    };

    const warehouse = buildWorkbenchModel("warehouse", [], [], summary);
    const finance = buildWorkbenchModel("finance", [], [], summary);

    expect(warehouse.metrics.map((metric) => metric.key)).toEqual([
      "pendingTasks",
      "lowStockCount",
      "overstockCount",
      "inventoryValue",
    ]);
    expect(finance.metrics.map((metric) => metric.key)).toEqual([
      "pendingTasks",
      "receivableBalance",
      "payableBalance",
      "alertCount",
    ]);
    expect(warehouse.metrics).toHaveLength(4);
    expect(finance.metrics).toHaveLength(4);
  });
});
