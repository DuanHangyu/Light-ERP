import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "@/lib/db";
import { runParallelCalculation } from "@/lib/parallel-calculation-engine";
import { confirmParallelSuggestion } from "@/lib/parallel-impact-service";
import {
  addParallelAdjustment,
  createParallelLedger,
  freezeParallelLedger,
  seedParallelDemoData,
} from "@/lib/parallel-ledger-service";
import {
  approveParallelMerge,
  publishParallelMerge,
  resumeParallelMergeExecution,
  submitParallelMerge,
} from "@/lib/parallel-merge-service";

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-par-recovery-"));
  process.env.ERP_DATA_DIR = dir;
  return dir;
}

describe("平行账套正式纠错失败回滚与恢复", () => {
  let database: ReturnType<typeof getDb>;
  let ledgerId: string;
  let mergeRequestId: string;
  let publisherId: string;
  let originalBomId: string;
  const baseAsOf = new Date().toISOString().slice(0, 10);

  beforeAll(() => {
    freshDataDir();
    database = getDb();
    const ownerId = (database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string }).id;
    publisherId = (database.prepare("SELECT id FROM users WHERE role = 'manager' LIMIT 1").get() as { id: string }).id;
    seedParallelDemoData(database);
    originalBomId = (database.prepare("SELECT id FROM boms WHERE product_id = 'P-PAL-DEMO' AND status = 'active'").get() as { id: string }).id;
    database.prepare(`
      INSERT INTO requisitions (
        id, req_no, production_order_id, bom_id, bom_version,
        requisition_note, status, created_at, issue_no, issued_by, issued_at
      ) VALUES (
        'REQ-PAL-RECOVERY', 'LL-PAL-RECOVERY', 'PO-PAL-DEMO', 'BOM-PAL-DEMO', '1',
        '替换前按 A8+C2 领料', 'issued', ?, 'CK-PAL-RECOVERY', ?, ?
      )
    `).run(new Date().toISOString(), ownerId, new Date().toISOString());
    database.prepare(`
      INSERT INTO requisition_lines (
        id, requisition_id, material_id, required_qty, issued_qty, is_primary, status
      ) VALUES
        ('RL-PAL-RECOVERY-A', 'REQ-PAL-RECOVERY', 'M-PAL-A', 8, 8, 1, 'issued'),
        ('RL-PAL-RECOVERY-C', 'REQ-PAL-RECOVERY', 'M-PAL-C', 2, 2, 0, 'issued')
    `).run();
    ({ ledgerId } = createParallelLedger(database, ownerId, {
      name: "正式执行失败恢复验证",
      purpose: "验证事务回滚、恢复点与幂等重试",
      base_as_of: baseAsOf,
      scope_type: "production_order",
      scope_entities: [{ scope_entity_type: "production_order", scope_entity_id: "PO-PAL-DEMO" }],
      merge_allowed: 1,
      allowed_user_ids: [publisherId],
    }));
    database.prepare(`
      UPDATE parallel_ledger_members
      SET can_approve_merge = 1, can_publish_merge = 1
      WHERE ledger_id = ? AND user_id = ?
    `).run(ledgerId, publisherId);
    addParallelAdjustment(database, ownerId, ledgerId, {
      adjustment_type: "material_substitute",
      effective_at: baseAsOf,
      reason: "将工单中的 2 吨原料 A 替换为 B",
      lines: [{
        entity_type: "production_order",
        entity_id: "PO-PAL-DEMO",
        field_code: "material_id",
        source_material_id: "M-PAL-A",
        target_material_id: "M-PAL-B",
        quantity: 2,
      }],
    });
    runParallelCalculation(database, ownerId, ledgerId);
    const suggestions = database.prepare("SELECT id FROM parallel_suggestions WHERE ledger_id = ?").all(ledgerId) as Array<{ id: string }>;
    for (const suggestion of suggestions) confirmParallelSuggestion(database, ownerId, suggestion.id, { decision: "accept" });
    freezeParallelLedger(database, ownerId, ledgerId);
    ({ mergeRequestId } = submitParallelMerge(database, ownerId, ledgerId));
    approveParallelMerge(database, publisherId, mergeRequestId, { approval_note: "批准执行" });
    publishParallelMerge(database, publisherId, mergeRequestId);
  });

  it("中途批次不足时整体回滚并保留失败对账与恢复点", () => {
    // 故意只提高物料总账数量，不增加批次数量：前置检查通过，补料执行时失败。
    database.prepare("UPDATE materials SET stock_qty = 2, row_version = row_version + 1 WHERE id = 'M-PAL-B'").run();

    expect(() => resumeParallelMergeExecution(database, publisherId, mergeRequestId)).toThrow(/批次数量不足/);

    const activeBom = database.prepare("SELECT id FROM boms WHERE product_id = 'P-PAL-DEMO' AND status = 'active'").get() as { id: string };
    const stocks = database.prepare("SELECT id, stock_qty FROM materials WHERE id IN ('M-PAL-A', 'M-PAL-B') ORDER BY id").all() as Array<{ id: string; stock_qty: number }>;
    expect(activeBom.id).toBe(originalBomId);
    expect(Object.fromEntries(stocks.map((row) => [row.id, row.stock_qty]))).toMatchObject({
      "M-PAL-A": 10,
      "M-PAL-B": 2,
    });
    expect((database.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE source_type = 'parallel_merge' AND source_id = ?").get(mergeRequestId) as { count: number }).count).toBe(0);
    expect((database.prepare("SELECT COUNT(*) AS count FROM production_cost_adjustments WHERE adjustment_note LIKE ?").get(`%${mergeRequestId}%`) as { count: number }).count).toBe(0);
    expect((database.prepare("SELECT COUNT(*) AS count FROM formal_correction_orders WHERE source_merge_request_id = ? AND status = 'executed'").get(mergeRequestId) as { count: number }).count).toBe(0);

    expect(database.prepare("SELECT status FROM parallel_ledgers WHERE id = ?").get(ledgerId)).toEqual({ status: "merge_failed" });
    expect(database.prepare("SELECT status FROM parallel_merge_requests WHERE id = ?").get(mergeRequestId)).toEqual({ status: "execution_failed" });
    expect(database.prepare("SELECT status FROM correction_execution_runs WHERE merge_request_id = ?").get(mergeRequestId)).toEqual({ status: "failed" });
    expect(database.prepare(`
      SELECT status, blocking FROM reconciliation_results
      WHERE merge_request_id = ? AND rule_code = 'execution_transaction_rollback'
    `).get(mergeRequestId)).toEqual({ status: "failed", blocking: 1 });
    expect(database.prepare(`
      SELECT status FROM correction_recovery_points
      WHERE execution_run_id = (
        SELECT id FROM correction_execution_runs WHERE merge_request_id = ?
      ) ORDER BY created_at DESC LIMIT 1
    `).get(mergeRequestId)).toEqual({ status: "rolled_back" });
  });

  it("修复批次后从同一纠错包重试成功，恢复点标记完成", () => {
    database.prepare("UPDATE material_batches SET qty = 2, status = 'available', row_version = row_version + 1 WHERE id = 'MB-PAL-B'").run();
    const result = resumeParallelMergeExecution(database, publisherId, mergeRequestId);
    expect(result).toMatchObject({ completed: true, status: "merged" });
    expect((database.prepare("SELECT COUNT(*) AS count FROM correction_recovery_points WHERE execution_run_id = (SELECT id FROM correction_execution_runs WHERE merge_request_id = ?) AND status = 'completed'").get(mergeRequestId) as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE source_type = 'parallel_merge' AND source_id = ?").get(mergeRequestId) as { count: number }).count).toBe(2);
  });
});
