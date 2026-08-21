import { describe, expect, it } from "vitest";
import {
  flatNavigationForRole,
  isModuleAccessible,
  navigationForRole,
  resolveAccessibleModule,
  type ErpRole,
} from "./erp-navigation";

const dailyRoles: ErpRole[] = [
  "sales",
  "assistant",
  "production",
  "warehouse",
  "purchasing",
  "quality",
  "technical",
  "manager",
  "finance",
];

describe("role-task navigation", () => {
  it("gives every daily role a focused navigation with no more than six entries", () => {
    for (const role of dailyRoles) {
      const navigation = flatNavigationForRole(role);
      expect(navigation[0]?.key).toBe("workbench");
      expect(navigation.length).toBeLessThanOrEqual(6);
    }
  });

  it("shows sales only the modules needed for sales work", () => {
    const keys = flatNavigationForRole("sales").map((item) => item.key);

    expect(keys).toEqual(["workbench", "sales", "master", "approval", "reports"]);
    expect(keys).not.toContain("finance");
    expect(keys).not.toContain("system");
    expect(keys).not.toContain("parallel");
  });

  it("separates purchasing, warehouse, and supplier work", () => {
    const purchasing = flatNavigationForRole("purchasing").map((item) => item.key);
    const warehouse = flatNavigationForRole("warehouse").map((item) => item.key);

    expect(purchasing).toEqual(["workbench", "purchase", "suppliers", "warehouse", "approval"]);
    expect(warehouse).toEqual(["workbench", "warehouse", "quality", "production", "approval"]);
    expect(warehouse).not.toContain("purchase");
    expect(warehouse).not.toContain("suppliers");
  });

  it("keeps administrator capabilities grouped without granting implicit parallel-ledger access", () => {
    const groups = navigationForRole("admin");
    const keys = groups.flatMap((group) => group.items.map((item) => item.key));

    expect(groups.map((group) => group.label)).toEqual([
      "工作",
      "业务运营",
      "供应链",
      "财务与分析",
      "基础与协作",
      "系统管理",
    ]);
    expect(keys).toContain("system");
    expect(keys).not.toContain("parallel");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("falls back to the workbench when a role requests an inaccessible module", () => {
    expect(isModuleAccessible("sales", "finance")).toBe(false);
    expect(resolveAccessibleModule("sales", "finance")).toBe("workbench");
    expect(resolveAccessibleModule("finance", "finance")).toBe("finance");
  });
});
