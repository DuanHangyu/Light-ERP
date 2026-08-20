import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "@/lib/db";
import { createParallelLedger, freezeParallelLedger, addParallelAdjustment, requireParallelPermission } from "@/lib/parallel-ledger-service";
import { runParallelCalculation } from "@/lib/parallel-calculation-engine";

function freshDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-par-perm-"));
  process.env.ERP_DATA_DIR = dir;
  return dir;
}

describe("平行账套 13 码权限矩阵（M3）", () => {
  let database: ReturnType<typeof getDb>;
  let adminId: string;
  let financeId: string;
  let ledgerId: string;
  const baseAsOf = new Date().toISOString().slice(0, 10);

  beforeAll(() => {
    freshDataDir();
    database = getDb();
    adminId = (database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string }).id;
    financeId = (database.prepare("SELECT id FROM users WHERE role = 'finance' LIMIT 1").get() as { id: string }).id;
    const created = createParallelLedger(database, adminId, { name: "权限验证账套", purpose: "M3", base_as_of: baseAsOf, scope_type: "company", merge_allowed: 1, seed_demo: true, allowed_user_ids: [financeId] });
    ledgerId = created.ledgerId;
    // 给 finance 成员只授予 view，其余关闭
    database.prepare("UPDATE parallel_ledger_members SET can_view = 1, can_adjust = 0, can_recalculate = 0, can_freeze = 0, can_export = 0, can_submit_merge = 0, can_approve_merge = 0, can_publish_merge = 0, can_archive = 0, can_discard = 0, can_admin = 0 WHERE ledger_id = ? AND user_id = ?").run(ledgerId, financeId);
  });

  it("非成员普通员工被 view 权限拒绝", () => {
    const salesId = (database.prepare("SELECT id FROM users WHERE role = 'sales' LIMIT 1").get() as { id: string }).id;
    expect(() => requireParallelPermission(database, salesId, ledgerId, "view")).toThrow(/缺少权限 parallel_ledger.view/);
  });

  it("finance 成员有 view 但无 freeze → 冻结被拒", () => {
    expect(() => requireParallelPermission(database, financeId, ledgerId, "freeze")).toThrow(/缺少权限 parallel_ledger.freeze/);
    expect(() => freezeParallelLedger(database, financeId, ledgerId)).toThrow(/缺少权限 parallel_ledger.freeze/);
  });

  it("finance 成员无 adjust → 新增调整被拒", () => {
    expect(() => requireParallelPermission(database, financeId, ledgerId, "adjust")).toThrow(/缺少权限 parallel_ledger.adjust/);
    expect(() => addParallelAdjustment(database, financeId, ledgerId, { adjustment_type: "bom_ratio", effective_at: baseAsOf, reason: "x", lines: [] })).toThrow(/缺少权限 parallel_ledger.adjust/);
  });

  it("finance 成员无 recalculate → 重算被拒", () => {
    expect(() => requireParallelPermission(database, financeId, ledgerId, "recalculate")).toThrow(/缺少权限 parallel_ledger.recalculate/);
  });

  it("owner（创建人 admin）拥有全部权限，可冻结/重算", () => {
    expect(() => requireParallelPermission(database, adminId, ledgerId, "freeze")).not.toThrow();
    expect(() => requireParallelPermission(database, adminId, ledgerId, "recalculate")).not.toThrow();
    expect(() => runParallelCalculation(database, adminId, ledgerId)).not.toThrow();
    expect(() => freezeParallelLedger(database, adminId, ledgerId)).not.toThrow();
  });

  it("授予 finance freeze 权限后可冻结", () => {
    // 先解冻回 draft（owner 操作）
    database.prepare("UPDATE parallel_ledgers SET status = 'draft', frozen_at = NULL WHERE id = ?").run(ledgerId);
    database.prepare("UPDATE parallel_ledger_members SET can_freeze = 1, can_recalculate = 1 WHERE ledger_id = ? AND user_id = ?").run(ledgerId, financeId);
    expect(() => freezeParallelLedger(database, financeId, ledgerId)).not.toThrow();
  });
});
