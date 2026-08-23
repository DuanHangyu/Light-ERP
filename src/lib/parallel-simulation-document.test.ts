import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { runParallelCalculation } from "@/lib/parallel-calculation-engine";
import {
  addParallelAdjustment,
  buildParallelSnapshotData,
  createParallelLedger,
  seedParallelDemoData,
} from "@/lib/parallel-ledger-service";
import {
  completeParallelSimulationDocument,
  updateParallelSimulationDocument,
} from "@/lib/parallel-simulation-document-service";

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-parallel-documents-"));
  process.env.ERP_DATA_DIR = dir;
  return dir;
}

type SimulationDocument = {
  id: string;
  generation_key: string;
  document_type: string;
  document_no: string;
  title: string;
  status: string;
  payload_json: string;
  missing_fields_json: string;
};

describe("平行账套原生历史业务单据链", () => {
  let database: ReturnType<typeof getDb>;
  let ledgerId: string;
  let adminId: string;
  const baseAsOf = new Date().toISOString().slice(0, 10);
  const businessDate = "2026-06-10";

  beforeAll(() => {
    freshDataDir();
    database = getDb();
    adminId = (database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string }).id;
    seedParallelDemoData(database);

    database.prepare(`
      INSERT INTO requisitions (
        id, req_no, production_order_id, bom_id, bom_version,
        requisition_note, status, created_at, issue_no, issued_by, issued_at
      ) VALUES (
        'REQ-PAL-HISTORY', 'LL-20260608-001', 'PO-PAL-DEMO', 'BOM-PAL-DEMO', '1',
        '正常历史领料', 'issued', ?, 'CK-20260608-001', ?, ?
      )
    `).run(`${businessDate}T08:00:00.000Z`, adminId, `${businessDate}T09:00:00.000Z`);
    database.prepare(`
      INSERT INTO requisition_lines (
        id, requisition_id, material_id, required_qty, issued_qty, is_primary, status
      ) VALUES
        ('RL-PAL-HISTORY-A', 'REQ-PAL-HISTORY', 'M-PAL-A', 8, 8, 1, 'issued'),
        ('RL-PAL-HISTORY-C', 'REQ-PAL-HISTORY', 'M-PAL-C', 2, 2, 0, 'issued')
    `).run();

    ({ ledgerId } = createParallelLedger(database, adminId, {
      name: "A换B历史业务模拟",
      purpose: "自动生成正常历史业务单据",
      base_as_of: baseAsOf,
      scope_type: "production_order",
      scope_entities: [
        { scope_entity_type: "production_order", scope_entity_id: "PO-PAL-DEMO" },
      ],
      merge_allowed: 1,
    }));

    addParallelAdjustment(database, adminId, ledgerId, {
      adjustment_type: "material_substitute",
      effective_at: businessDate,
      reason: "工单原料A替换为原料B 2吨",
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
    runParallelCalculation(database, adminId, ledgerId);
  });

  function documents() {
    return database
      .prepare("SELECT * FROM parallel_simulation_documents WHERE ledger_id = ? ORDER BY sequence_no")
      .all(ledgerId) as SimulationDocument[];
  }

  it("A换B后自动生成正常形态的完整历史业务单据链", () => {
    const rows = documents();
    expect(rows.map((row) => row.document_type)).toEqual([
      "bom_change",
      "purchase_requisition",
      "purchase_order",
      "purchase_arrival",
      "purchase_receipt",
      "material_return",
      "material_supplement",
      "production_cost_adjustment",
    ]);
    expect(rows.every((row) => row.document_no.length > 0)).toBe(true);
    expect(rows.every((row) => !/补录|纠错/.test(row.title))).toBe(true);

    const purchaseOrder = rows.find((row) => row.document_type === "purchase_order");
    expect(purchaseOrder?.status).toBe("waiting_input");
    expect(JSON.parse(purchaseOrder?.missing_fields_json ?? "[]")).toEqual([
      "supplier_id",
      "unit_price",
      "planned_arrival_date",
    ]);

    const supplement = rows.find((row) => row.document_type === "material_supplement");
    expect(supplement?.status).toBe("waiting_dependency");
  });

  it("重新计算只更新原单据，不重复生成历史单据", () => {
    const before = documents().map((row) => ({ id: row.id, key: row.generation_key }));
    runParallelCalculation(database, adminId, ledgerId);
    const after = documents().map((row) => ({ id: row.id, key: row.generation_key }));
    expect(after).toEqual(before);
  });

  it("缺少字段或上游未完成时不能强行完成业务", () => {
    const rows = documents();
    const purchaseOrder = rows.find((row) => row.document_type === "purchase_order")!;
    expect(() => completeParallelSimulationDocument(database, adminId, ledgerId, purchaseOrder.id)).toThrow(
      /缺少|上游/,
    );

    const bom = rows.find((row) => row.document_type === "bom_change")!;
    const requisition = rows.find((row) => row.document_type === "purchase_requisition")!;
    completeParallelSimulationDocument(database, adminId, ledgerId, bom.id);
    completeParallelSimulationDocument(database, adminId, ledgerId, requisition.id);
    updateParallelSimulationDocument(database, adminId, ledgerId, purchaseOrder.id, {
      supplier_id: "S-PAL-DEMO",
      unit_price: 13000,
      planned_arrival_date: "2026-06-15",
    });
    completeParallelSimulationDocument(database, adminId, ledgerId, purchaseOrder.id);

    const completed = documents().find((row) => row.id === purchaseOrder.id)!;
    expect(completed.status).toBe("completed");
    expect(JSON.parse(completed.payload_json)).toMatchObject({
      supplier_id: "S-PAL-DEMO",
      unit_price: 13000,
      planned_arrival_date: "2026-06-15",
    });
  });

  it("未授权账号不能读取或推进平行账历史单据", () => {
    expect(() => completeParallelSimulationDocument(database, "U-SALES", ledgerId, documents()[0].id)).toThrow(
      /无权|缺少权限/,
    );
    expect(buildParallelSnapshotData(database, "U-SALES").simulationDocuments).toEqual([]);
  });
});
