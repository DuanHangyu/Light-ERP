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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-par-domain-execution-"));
  process.env.ERP_DATA_DIR = dir;
  return dir;
}

describe("原料替换正式纠错包的领域执行与对账", () => {
  let database: ReturnType<typeof getDb>;
  let ledgerId: string;
  let mergeRequestId: string;
  let publisherId: string;
  const baseAsOf = new Date().toISOString().slice(0, 10);

  beforeAll(() => {
    freshDataDir();
    database = getDb();
    const ownerId = (database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string }).id;
    publisherId = (database.prepare("SELECT id FROM users WHERE role = 'manager' LIMIT 1").get() as { id: string }).id;
    seedParallelDemoData(database);

    database.prepare(`
      INSERT INTO requisitions (
        id, req_no, production_order_id, bom_id, bom_version,
        requisition_note, status, created_at, issue_no, issued_by, issued_at
      ) VALUES (
        'REQ-PAL-MERGE', 'LL-PAL-MERGE', 'PO-PAL-DEMO', 'BOM-PAL-DEMO', '1',
        '替换前按 A8+C2 领料', 'issued', ?, 'CK-PAL-MERGE', ?, ?
      )
    `).run(new Date().toISOString(), ownerId, new Date().toISOString());
    database.prepare(`
      INSERT INTO requisition_lines (
        id, requisition_id, material_id, required_qty, issued_qty, is_primary, status
      ) VALUES
        ('RL-PAL-MERGE-A', 'REQ-PAL-MERGE', 'M-PAL-A', 8, 8, 1, 'issued'),
        ('RL-PAL-MERGE-C', 'REQ-PAL-MERGE', 'M-PAL-C', 2, 2, 0, 'issued')
    `).run();

    ({ ledgerId } = createParallelLedger(database, ownerId, {
      name: "A 换 B 正式执行闭环",
      purpose: "验证采购、BOM、补退料、成本同步执行",
      base_as_of: baseAsOf,
      scope_type: "production_order",
      scope_entities: [
        { scope_entity_type: "production_order", scope_entity_id: "PO-PAL-DEMO" },
      ],
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
      reference_type: "production_order",
      reference_id: "PO-PAL-DEMO",
      lines: [
        {
          entity_type: "production_order",
          entity_id: "PO-PAL-DEMO",
          field_code: "material_id",
          source_material_id: "M-PAL-A",
          target_material_id: "M-PAL-B",
          quantity: 2,
        },
      ],
    });
    runParallelCalculation(database, ownerId, ledgerId);
    const suggestions = database.prepare(`
      SELECT id FROM parallel_suggestions WHERE ledger_id = ? ORDER BY suggestion_type
    `).all(ledgerId) as Array<{ id: string }>;
    expect(suggestions).toHaveLength(5);
    for (const suggestion of suggestions) {
      confirmParallelSuggestion(database, ownerId, suggestion.id, { decision: "accept" });
    }
    freezeParallelLedger(database, ownerId, ledgerId);
    ({ mergeRequestId } = submitParallelMerge(database, ownerId, ledgerId));
    approveParallelMerge(database, publisherId, mergeRequestId, { approval_note: "批准正式纠错执行" });
    publishParallelMerge(database, publisherId, mergeRequestId);
  });

  it("同一调整被建议单覆盖后，纠错包只保留五张非重复正式单据", () => {
    const items = database.prepare(`
      SELECT document_type FROM parallel_merge_items
      WHERE merge_request_id = ? ORDER BY sequence_no
    `).all(mergeRequestId) as Array<{ document_type: string }>;
    expect(items.map((item) => item.document_type).sort()).toEqual([
      "bom_change",
      "material_return",
      "material_supplement",
      "production_cost_adjustment",
      "purchase_requisition",
    ]);
  });

  it("采购到货后一次事务执行 BOM、补退料和成本，并在全部对账通过后标记已合并", () => {
    database.prepare("UPDATE materials SET stock_qty = 2, row_version = row_version + 1 WHERE id = 'M-PAL-B'").run();
    database.prepare("UPDATE material_batches SET qty = 2, row_version = row_version + 1 WHERE id = 'MB-PAL-B'").run();

    const result = resumeParallelMergeExecution(database, publisherId, mergeRequestId);
    expect(result).toMatchObject({
      publishedCount: 5,
      completed: true,
      status: "merged",
    });

    const ledger = database.prepare("SELECT status, merged_at FROM parallel_ledgers WHERE id = ?").get(ledgerId) as { status: string; merged_at: string | null };
    const merge = database.prepare("SELECT status, published_at FROM parallel_merge_requests WHERE id = ?").get(mergeRequestId) as { status: string; published_at: string | null };
    const execution = database.prepare(`
      SELECT status, total_steps, succeeded_steps, waiting_steps, failed_steps
      FROM correction_execution_runs WHERE merge_request_id = ?
    `).get(mergeRequestId) as Record<string, unknown>;
    expect(ledger.status).toBe("merged");
    expect(ledger.merged_at).toBeTruthy();
    expect(merge.status).toBe("published");
    expect(merge.published_at).toBeTruthy();
    expect(execution).toMatchObject({
      status: "completed",
      total_steps: 5,
      succeeded_steps: 5,
      waiting_steps: 0,
      failed_steps: 0,
    });
    expect((database.prepare("SELECT COUNT(*) AS count FROM reconciliation_results WHERE merge_request_id = ? AND status <> 'passed'").get(mergeRequestId) as { count: number }).count).toBe(0);

    const activeBom = database.prepare(`
      SELECT id FROM boms WHERE product_id = 'P-PAL-DEMO' AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `).get() as { id: string };
    const bomLines = database.prepare(`
      SELECT component_id, qty_per FROM bom_lines WHERE bom_id = ? ORDER BY component_id
    `).all(activeBom.id) as Array<{ component_id: string; qty_per: number }>;
    expect(Object.fromEntries(bomLines.map((line) => [line.component_id, line.qty_per]))).toMatchObject({
      "M-PAL-A": 0.6,
      "M-PAL-B": 0.2,
      "M-PAL-C": 0.2,
    });

    const requisitionLines = database.prepare(`
      SELECT material_id, required_qty, issued_qty
      FROM requisition_lines WHERE requisition_id = 'REQ-PAL-MERGE'
      ORDER BY material_id
    `).all() as Array<{ material_id: string; required_qty: number; issued_qty: number }>;
    expect(Object.fromEntries(requisitionLines.map((line) => [line.material_id, { required: line.required_qty, issued: line.issued_qty }]))).toMatchObject({
      "M-PAL-A": { required: 6, issued: 6 },
      "M-PAL-B": { required: 2, issued: 2 },
      "M-PAL-C": { required: 2, issued: 2 },
    });

    const stocks = database.prepare("SELECT id, stock_qty FROM materials WHERE id IN ('M-PAL-A', 'M-PAL-B') ORDER BY id").all() as Array<{ id: string; stock_qty: number }>;
    expect(Object.fromEntries(stocks.map((row) => [row.id, row.stock_qty]))).toMatchObject({
      "M-PAL-A": 12,
      "M-PAL-B": 0,
    });
    const movements = database.prepare(`
      SELECT item_id, qty, movement_type
      FROM inventory_movements
      WHERE source_type = 'parallel_merge' AND source_id = ?
      ORDER BY movement_type
    `).all(mergeRequestId) as Array<{ item_id: string; qty: number; movement_type: string }>;
    expect(movements).toEqual(expect.arrayContaining([
      { item_id: "M-PAL-A", qty: 2, movement_type: "parallel_material_return" },
      { item_id: "M-PAL-B", qty: -2, movement_type: "parallel_material_supplement" },
    ]));

    const costAdjustment = database.prepare(`
      SELECT production_order_id, adjustment_amount, previous_total_cost,
             new_total_cost, status
      FROM production_cost_adjustments
      WHERE adjustment_note LIKE ?
    `).get(`%${mergeRequestId}%`) as Record<string, unknown>;
    expect(costAdjustment).toMatchObject({
      production_order_id: "PO-PAL-DEMO",
      adjustment_amount: 4000,
      previous_total_cost: 112000,
      new_total_cost: 116000,
      status: "applied",
    });
    expect((database.prepare("SELECT COUNT(*) AS count FROM formal_correction_orders WHERE source_merge_request_id = ? AND status = 'executed'").get(mergeRequestId) as { count: number }).count).toBe(4);
  });

  it("执行完成后重试保持幂等，不重复过账库存", () => {
    const movementCount = (database.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE source_type = 'parallel_merge' AND source_id = ?").get(mergeRequestId) as { count: number }).count;
    const repeated = resumeParallelMergeExecution(database, publisherId, mergeRequestId);
    expect(repeated).toMatchObject({ completed: true, status: "merged", idempotent: true });
    expect((database.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE source_type = 'parallel_merge' AND source_id = ?").get(mergeRequestId) as { count: number }).count).toBe(movementCount);
  });
});
