import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "@/lib/db";
import { runParallelCalculation } from "@/lib/parallel-calculation-engine";
import {
  addParallelAdjustment,
  createParallelLedger,
  seedParallelDemoData,
} from "@/lib/parallel-ledger-service";

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-par-substitute-"));
  process.env.ERP_DATA_DIR = dir;
  return dir;
}

type SuggestionRow = {
  suggestion_type: string;
  document_type: string;
  payload_json: string;
};

describe("平行账套原料 A 替换 B 的整链复盘", () => {
  let database: ReturnType<typeof getDb>;
  let ledgerId: string;
  let substitutionAdjustmentId: string;
  const baseAsOf = new Date().toISOString().slice(0, 10);

  beforeAll(() => {
    freshDataDir();
    database = getDb();
    const adminId = (database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string }).id;
    seedParallelDemoData(database);

    database.prepare(`
      INSERT INTO requisitions (
        id, req_no, production_order_id, bom_id, bom_version,
        requisition_note, status, created_at, issue_no, issued_by, issued_at
      ) VALUES (
        'REQ-PAL-SUB', 'LL-PAL-SUB', 'PO-PAL-DEMO', 'BOM-PAL-DEMO', '1',
        '替代前已按 A8+C2 领料', 'issued', ?, 'CK-PAL-SUB', ?, ?
      )
    `).run(new Date().toISOString(), adminId, new Date().toISOString());
    database.prepare(`
      INSERT INTO requisition_lines (
        id, requisition_id, material_id, required_qty, issued_qty, is_primary, status
      ) VALUES
        ('RL-PAL-SUB-A', 'REQ-PAL-SUB', 'M-PAL-A', 8, 8, 1, 'issued'),
        ('RL-PAL-SUB-C', 'REQ-PAL-SUB', 'M-PAL-C', 2, 2, 0, 'issued')
    `).run();

    ({ ledgerId } = createParallelLedger(database, adminId, {
      name: "A 替换 B 两吨闭环验证",
      purpose: "客户需求 CR-04 / CR-05",
      base_as_of: baseAsOf,
      scope_type: "production_order",
      scope_entities: [
        { scope_entity_type: "production_order", scope_entity_id: "PO-PAL-DEMO" },
      ],
      merge_allowed: 1,
    }));

    ({ adjustmentId: substitutionAdjustmentId } = addParallelAdjustment(database, adminId, ledgerId, {
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
    }));
    addParallelAdjustment(database, adminId, ledgerId, {
      adjustment_type: "purchase_price",
      effective_at: baseAsOf,
      reason: "B 采购价按 13000 元/吨测算",
      lines: [
        {
          entity_type: "material",
          entity_id: "M-PAL-B",
          field_code: "purchase_price",
          target_material_id: "M-PAL-B",
          unit_price: 13000,
        },
      ],
    });

    runParallelCalculation(database, adminId, ledgerId);
  });

  it("只替换指定的 2 吨，而不是把 A 全量替换为 B", () => {
    const issued = database.prepare(`
      SELECT issued_material_id AS material_id, SUM(allocated_qty) AS qty
      FROM parallel_material_allocations
      WHERE run_id IN (
        SELECT id FROM parallel_calculation_runs
        WHERE ledger_id = ? AND stale = 0
      )
      GROUP BY material_id
    `).all(ledgerId) as Array<{ material_id: string; qty: number }>;

    expect(Object.fromEntries(issued.map((row) => [row.material_id, row.qty]))).toMatchObject({
      "M-PAL-A": 6,
      "M-PAL-B": 2,
      "M-PAL-C": 2,
    });
  });

  it("生成采购、配方、补料、退料和成本调整五类待确认建议", () => {
    const suggestions = database.prepare(`
      SELECT suggestion_type, document_type, payload_json
      FROM parallel_suggestions
      WHERE ledger_id = ?
      ORDER BY suggestion_type
    `).all(ledgerId) as SuggestionRow[];

    expect(suggestions.map((row) => row.suggestion_type).sort()).toEqual([
      "bom_change",
      "order_cost_adjust",
      "purchase_requisition",
      "replenish",
      "return_material",
    ]);
    expect(suggestions.map((row) => row.document_type).sort()).toEqual([
      "bom_change",
      "material_return",
      "material_supplement",
      "production_cost_adjustment",
      "purchase_requisition",
    ]);

    const payloadByType = Object.fromEntries(
      suggestions.map((row) => [row.suggestion_type, JSON.parse(row.payload_json) as Record<string, unknown>]),
    );
    expect(payloadByType.purchase_requisition).toMatchObject({
      material_id: "M-PAL-B",
      requested_qty: 1,
      source_adjustment_id: substitutionAdjustmentId,
      affected_entity_type: "material",
      affected_entity_id: "M-PAL-B",
    });
    expect(payloadByType.bom_change).toMatchObject({
      production_order_id: "PO-PAL-DEMO",
      product_id: "P-PAL-DEMO",
      source_material_id: "M-PAL-A",
      target_material_id: "M-PAL-B",
      substitute_qty: 2,
      source_adjustment_id: substitutionAdjustmentId,
    });
    expect(payloadByType.replenish).toMatchObject({
      production_order_id: "PO-PAL-DEMO",
      material_id: "M-PAL-B",
      suggested_qty: 2,
      source_adjustment_id: substitutionAdjustmentId,
    });
    expect(payloadByType.return_material).toMatchObject({
      production_order_id: "PO-PAL-DEMO",
      material_id: "M-PAL-A",
      suggested_qty: 2,
      source_adjustment_id: substitutionAdjustmentId,
    });
    expect(payloadByType.order_cost_adjust).toMatchObject({
      production_order_id: "PO-PAL-DEMO",
      before_total_cost: 112000,
      after_total_cost: 117000,
      delta_amount: 5000,
      source_adjustment_id: substitutionAdjustmentId,
    });

    for (const payload of Object.values(payloadByType)) {
      expect(payload.evidence).toBeTypeOf("object");
    }
  });

  it("拒绝缺少替换数量或原料相同的模糊调整", () => {
    const adminId = (database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string }).id;
    expect(() => addParallelAdjustment(database, adminId, ledgerId, {
      adjustment_type: "material_substitute",
      effective_at: baseAsOf,
      reason: "未填写替换数量",
      lines: [
        {
          entity_type: "production_order",
          entity_id: "PO-PAL-DEMO",
          field_code: "material_id",
          source_material_id: "M-PAL-A",
          target_material_id: "M-PAL-B",
        },
      ],
    })).toThrow(/替换数量/);

    expect(() => addParallelAdjustment(database, adminId, ledgerId, {
      adjustment_type: "material_substitute",
      effective_at: baseAsOf,
      reason: "原料相同",
      lines: [
        {
          entity_type: "production_order",
          entity_id: "PO-PAL-DEMO",
          field_code: "material_id",
          source_material_id: "M-PAL-A",
          target_material_id: "M-PAL-A",
          quantity: 2,
        },
      ],
    })).toThrow(/不能相同/);
  });
});
