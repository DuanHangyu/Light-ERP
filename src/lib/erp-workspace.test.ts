import { describe, expect, it } from "vitest";
import { workspaceFor } from "./erp-workspace";

describe("focused ERP workspaces", () => {
  it("opens operational modules on the task-oriented view", () => {
    expect(workspaceFor("production").defaultTab).toBe("tasks");
    expect(workspaceFor("quality").defaultTab).toBe("queue");
    expect(workspaceFor("approval").defaultTab).toBe("pending");
  });

  it("keeps complete legacy capabilities behind an explicit advanced tab", () => {
    expect(workspaceFor("production").tabs.map((tab) => tab.key)).toEqual(["tasks", "full"]);
    expect(workspaceFor("quality").tabs.map((tab) => tab.key)).toEqual(["queue", "full"]);
    expect(workspaceFor("approval").tabs.map((tab) => tab.key)).toEqual(["pending", "full"]);
  });

  it("separates system administration by intent", () => {
    const system = workspaceFor("system");
    expect(system.defaultTab).toBe("accounts");
    expect(system.tabs.map((tab) => tab.key)).toEqual(["accounts", "settings", "audit", "advanced"]);
  });
});
