import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "./db";
import { buildExport, getSnapshot } from "./erp-service";
import { flatNavigationForRole } from "./erp-navigation";
import {
  createParallelLedger,
  listParallelLedgersForUser,
  requireParallelPermission,
} from "./parallel-ledger-service";

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-access-control-"));
  process.env.ERP_DATA_DIR = dir;
  return dir;
}

describe("PRD 阶段 0：正式账套数据最小化与平行账套隔离", () => {
  let database: ReturnType<typeof getDb>;
  let managerLedgerId: string;

  beforeAll(() => {
    freshDataDir();
    database = getDb();
    managerLedgerId = createParallelLedger(database, "U-MGR", {
      name: "仅管理层可见账套",
      purpose: "验证平行账套显式成员隔离",
      base_as_of: new Date().toISOString().slice(0, 10),
      scope_type: "company",
      merge_allowed: 1,
    }).ledgerId;
  });

  it("销售快照不返回供应商、应付、材料成本或其他用户账号", () => {
    const snapshot = getSnapshot("U-SALES");

    expect(snapshot.board.suppliers).toEqual([]);
    expect(snapshot.board.payables).toEqual([]);
    expect(snapshot.board.materials.every((material) => !("average_cost" in material))).toBe(true);
    expect(snapshot.users.map((user) => user.id)).toEqual(["U-SALES"]);
    expect(snapshot.security.rolePermissions).toEqual([]);
    expect(snapshot.security.permissionMatrix).toEqual([]);
  });

  it("销售不能通过直接调用导出供应商主档，采购仍可导出授权标准报表", async () => {
    await expect(
      buildExport({ actorId: "U-SALES", type: "master-suppliers", format: "xlsx" }),
    ).rejects.toThrow(/无权导出|无导出权限/);

    const authorized = await buildExport({
      actorId: "U-PUR",
      type: "master-suppliers",
      format: "xlsx",
    });
    expect(authorized.buffer.byteLength).toBeGreaterThan(0);
  });

  it("系统管理员未被指定为成员时，不能查看管理层平行账套", () => {
    expect(() => requireParallelPermission(database, "U-ADMIN", managerLedgerId, "view")).toThrow(
      /缺少权限 parallel_ledger.view/,
    );
    expect(listParallelLedgersForUser(database, "U-ADMIN").map((ledger) => ledger.id)).not.toContain(
      managerLedgerId,
    );
    expect(getSnapshot("U-ADMIN").parallel.ledgers.map((ledger) => ledger.id)).not.toContain(managerLedgerId);
  });

  it("平行账套入口只由显式成员关系开启，不再绑定系统管理员角色", () => {
    expect(flatNavigationForRole("admin").map((item) => item.key)).not.toContain("parallel");
    expect(
      flatNavigationForRole("manager", { hasParallelAccess: true }).map((item) => item.key),
    ).toContain("parallel");
    expect(
      flatNavigationForRole("manager", { hasParallelAccess: false }).map((item) => item.key),
    ).not.toContain("parallel");
  });
});
