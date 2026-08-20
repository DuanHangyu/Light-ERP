import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "@/lib/db";
import {
  addParallelAdjustment,
  createParallelLedger,
  freezeParallelLedger,
  seedParallelDemoData,
} from "@/lib/parallel-ledger-service";
import { runParallelCalculation } from "@/lib/parallel-calculation-engine";
import {
  approveParallelMerge,
  publishParallelMerge,
  submitParallelMerge,
} from "@/lib/parallel-merge-service";
import { confirmParallelSuggestion } from "@/lib/parallel-impact-service";

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-par-integration-"));
  process.env.ERP_DATA_DIR = dir;
  return dir;
}

describe("平行账套正式闭环", () => {
  let database: ReturnType<typeof getDb>;
  let adminId: string;
  let managerId: string;
  const baseAsOf = new Date().toISOString().slice(0, 10);

  beforeAll(() => {
    freshDataDir();
    database = getDb();
    adminId = (database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string }).id;
    managerId = (database.prepare("SELECT id FROM users WHERE role = 'manager' LIMIT 1").get() as { id: string }).id;
    seedParallelDemoData(database);

    database.prepare(`
      INSERT INTO quotes (
        id, quote_no, customer_id, product_id, qty, version, material_cost,
        process_fee, margin_rate, total_amount, status, created_at, row_version
      ) VALUES ('Q-PAL-DEMO-2', 'BJ-PAL-DEMO-2', 'C-PAL-DEMO', 'P-PAL-DEMO',
        10, 1, 92000, 20000, 0, 112000, 'confirmed', ?, 0)
    `).run(new Date().toISOString());
    database.prepare(`
      INSERT INTO orders (
        id, order_no, quote_id, customer_id, product_id, qty, due_date,
        special_requirements, status, created_at, row_version
      ) VALUES ('O-PAL-DEMO-2', 'DD-PAL-DEMO-2', 'Q-PAL-DEMO-2', 'C-PAL-DEMO',
        'P-PAL-DEMO', 10, ?, '', 'submitted', ?, 0)
    `).run(baseAsOf, new Date().toISOString());
    database.prepare(`
      INSERT INTO production_orders (
        id, prod_no, order_id, priority, instruction_note,
        technical_requirements, status, created_at, row_version
      ) VALUES ('PO-PAL-DEMO-2', 'SC-PAL-DEMO-2', 'O-PAL-DEMO-2', 'normal',
        '', '', 'material_requested', ?, 0)
    `).run(new Date().toISOString());
  });

  it("按指定工单范围建立快照，并在多工单间连续占用同一批库存", () => {
    const { ledgerId } = createParallelLedger(database, adminId, {
      name: "双工单连续占用验证",
      purpose: "验证范围快照与共享批次池",
      base_as_of: baseAsOf,
      scope_type: "production_order",
      scope_entities: [
        { scope_entity_type: "production_order", scope_entity_id: "PO-PAL-DEMO" },
        { scope_entity_type: "production_order", scope_entity_id: "PO-PAL-DEMO-2" },
      ],
      merge_allowed: 0,
    });

    runParallelCalculation(database, adminId, ledgerId);

    const projectedOrders = database
      .prepare("SELECT production_order_id FROM parallel_cost_projections WHERE run_id IN (SELECT id FROM parallel_calculation_runs WHERE ledger_id = ?)")
      .all(ledgerId) as Array<{ production_order_id: string }>;
    expect(projectedOrders.map((row) => row.production_order_id).sort()).toEqual([
      "PO-PAL-DEMO",
      "PO-PAL-DEMO-2",
    ]);

    const aGap = database
      .prepare("SELECT shortage_qty FROM parallel_gaps WHERE run_id IN (SELECT id FROM parallel_calculation_runs WHERE ledger_id = ?) AND material_id = 'M-PAL-A'")
      .get(ledgerId) as { shortage_qty: number };
    const cGap = database
      .prepare("SELECT shortage_qty FROM parallel_gaps WHERE run_id IN (SELECT id FROM parallel_calculation_runs WHERE ledger_id = ?) AND material_id = 'M-PAL-C'")
      .get(ledgerId) as { shortage_qty: number };
    expect(aGap.shortage_qty).toBeCloseTo(6, 3);
    expect(cGap.shortage_qty).toBeCloseTo(1, 3);

    const ending = database
      .prepare("SELECT material_id, quantity FROM parallel_inventory_projections WHERE run_id IN (SELECT id FROM parallel_calculation_runs WHERE ledger_id = ?) AND material_id IN ('M-PAL-A', 'M-PAL-C')")
      .all(ledgerId) as Array<{ material_id: string; quantity: number }>;
    expect(Object.fromEntries(ending.map((row) => [row.material_id, row.quantity]))).toMatchObject({
      "M-PAL-A": 0,
      "M-PAL-C": 0,
    });
  });

  it("禁止将仅测算账套提交合并", () => {
    const { ledgerId } = createParallelLedger(database, adminId, {
      name: "仅测算账套",
      purpose: "禁止合并验证",
      base_as_of: baseAsOf,
      scope_type: "production_order",
      scope_entities: [{ scope_entity_type: "production_order", scope_entity_id: "PO-PAL-DEMO" }],
      merge_allowed: 0,
    });
    addParallelAdjustment(database, adminId, ledgerId, {
      adjustment_type: "bom_ratio",
      effective_at: baseAsOf,
      reason: "验证禁止合并",
      lines: [{ entity_type: "product", entity_id: "P-PAL-DEMO", field_code: "qty_per", target_material_id: "M-PAL-A", quantity: 0.7 }],
    });
    runParallelCalculation(database, adminId, ledgerId);
    freezeParallelLedger(database, adminId, ledgerId);
    expect(() => submitParallelMerge(database, adminId, ledgerId)).toThrow(/不允许合并/);
  });

  it("合并申请人不能审批自己的申请", () => {
    const { ledgerId } = createParallelLedger(database, adminId, {
      name: "合并职责分离验证",
      purpose: "禁止自批",
      base_as_of: baseAsOf,
      scope_type: "production_order",
      scope_entities: [{ scope_entity_type: "production_order", scope_entity_id: "PO-PAL-DEMO" }],
      merge_allowed: 1,
      allowed_user_ids: [managerId],
    });
    addParallelAdjustment(database, adminId, ledgerId, {
      adjustment_type: "bom_ratio",
      effective_at: baseAsOf,
      reason: "触发采购缺口",
      lines: [
        { entity_type: "product", entity_id: "P-PAL-DEMO", field_code: "qty_per", target_material_id: "M-PAL-A", quantity: 0.6 },
        { entity_type: "product", entity_id: "P-PAL-DEMO", field_code: "qty_per", target_material_id: "M-PAL-B", quantity: 0.2 },
      ],
    });
    addParallelAdjustment(database, adminId, ledgerId, {
      adjustment_type: "purchase_price",
      effective_at: baseAsOf,
      reason: "采购价格测算",
      lines: [{ entity_type: "material", entity_id: "M-PAL-B", field_code: "purchase_price", target_material_id: "M-PAL-B", unit_price: 13000 }],
    });
    runParallelCalculation(database, adminId, ledgerId);
    const suggestion = database
      .prepare("SELECT id FROM parallel_suggestions WHERE ledger_id = ? ORDER BY id LIMIT 1")
      .get(ledgerId) as { id: string };
    confirmParallelSuggestion(database, adminId, suggestion.id, { decision: "accept" });
    freezeParallelLedger(database, adminId, ledgerId);
    const { mergeRequestId } = submitParallelMerge(database, adminId, ledgerId);
    expect(() => approveParallelMerge(database, adminId, mergeRequestId, {})).toThrow(/申请人不能审批/);

    database.prepare(`
      UPDATE parallel_ledger_members
      SET can_approve_merge = 1, can_publish_merge = 1
      WHERE ledger_id = ? AND user_id = ?
    `).run(ledgerId, managerId);
    approveParallelMerge(database, managerId, mergeRequestId, { approval_note: "复核通过" });
    const published = publishParallelMerge(database, managerId, mergeRequestId);
    expect(published).toMatchObject({ publishedCount: 3, advisoryCount: 0 });
    expect((database.prepare("SELECT COUNT(*) AS count FROM formal_correction_orders WHERE source_ledger_id = ?").get(ledgerId) as { count: number }).count).toBe(2);
    expect((database.prepare("SELECT COUNT(*) AS count FROM purchase_requisitions WHERE source_type = 'parallel_merge' AND source_document_id = ?").get(ledgerId) as { count: number }).count).toBe(1);
  });
});
