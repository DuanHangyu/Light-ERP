import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "@/lib/db";
import { createParallelLedger, addParallelAdjustment } from "@/lib/parallel-ledger-service";
import { runParallelCalculation } from "@/lib/parallel-calculation-engine";

function freshDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-par-test-"));
  process.env.ERP_DATA_DIR = dir;
  return dir;
}

describe("平行账套复盘引擎 — PRD §18.3 演示场景", () => {
  let database: ReturnType<typeof getDb>;
  let adminId: string;
  let ledgerId: string;
  const baseAsOf = new Date().toISOString().slice(0, 10);

  beforeAll(() => {
    freshDataDir();
    database = getDb();
    adminId = (database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string }).id;
    const created = createParallelLedger(database, adminId, {
      name: "演示账套",
      purpose: "PRD §18.3 验证",
      base_as_of: baseAsOf,
      scope_type: "company",
      merge_allowed: 0,
      seed_demo: true,
    });
    ledgerId = created.ledgerId;

    addParallelAdjustment(database, adminId, ledgerId, {
      adjustment_type: "bom_ratio",
      effective_at: baseAsOf,
      reason: "演示：配方 A6+B2+C2",
      reference_id: "P-PAL-DEMO",
      lines: [
        { entity_type: "product", entity_id: "P-PAL-DEMO", field_code: "qty_per", target_material_id: "M-PAL-A", quantity: 0.6 },
        { entity_type: "product", entity_id: "P-PAL-DEMO", field_code: "qty_per", target_material_id: "M-PAL-B", quantity: 0.2 },
      ],
    });
    addParallelAdjustment(database, adminId, ledgerId, {
      adjustment_type: "purchase_price",
      effective_at: baseAsOf,
      reason: "演示：B 采购价 13000",
      lines: [{ entity_type: "material", entity_id: "M-PAL-B", field_code: "purchase_price", target_material_id: "M-PAL-B", unit_price: 13000 }],
    });

    runParallelCalculation(database, adminId, ledgerId);
  });

  it("B 现有库存 1 吨，缺口 1 吨，建议采购 1 吨", () => {
    const gap = database.prepare("SELECT * FROM parallel_gaps WHERE material_id = 'M-PAL-B'").get() as { required_qty: number; available_qty: number; shortage_qty: number };
    expect(gap.required_qty).toBeCloseTo(2, 3);
    expect(gap.available_qty).toBeCloseTo(1, 3);
    expect(gap.shortage_qty).toBeCloseTo(1, 3);
  });

  it("B 测算移动均价 = 12500 元/吨（1×12000 + 1×13000）/2", () => {
    const inv = database.prepare("SELECT * FROM parallel_inventory_projections WHERE material_id = 'M-PAL-B'").get() as { unit_cost: number; quantity: number };
    expect(inv.unit_cost).toBeCloseTo(12500, 0);
  });

  it("材料成本 92000 → 97000，工单总成本 112000 → 117000", () => {
    const cost = database.prepare("SELECT * FROM parallel_cost_projections WHERE product_id = 'P-PAL-DEMO'").get() as { material_cost: number; total_cost: number };
    expect(cost.material_cost).toBeCloseTo(97000, 0);
    expect(cost.total_cost).toBeCloseTo(117000, 0);
  });

  it("成品单位成本 = 11700 元/吨", () => {
    const cost = database.prepare("SELECT unit_cost FROM parallel_cost_projections WHERE product_id = 'P-PAL-DEMO'").get() as { unit_cost: number };
    expect(cost.unit_cost).toBeCloseTo(11700, 0);
  });

  it("已生成采购建议 B 1 吨", () => {
    const suggestion = database.prepare("SELECT payload_json FROM parallel_suggestions WHERE ledger_id = ? LIMIT 1").get(ledgerId) as { payload_json: string };
    const payload = JSON.parse(suggestion.payload_json) as { material_id: string; requested_qty: number; estimated_unit_cost: number };
    expect(payload.material_id).toBe("M-PAL-B");
    expect(payload.requested_qty).toBeCloseTo(1, 3);
    expect(payload.estimated_unit_cost).toBeCloseTo(13000, 0);
  });
});
