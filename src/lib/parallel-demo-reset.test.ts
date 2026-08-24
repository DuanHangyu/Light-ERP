import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const CONFIRMATION = "清空平行账";

async function loadHarness() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-parallel-reset-"));
  tempDirs.push(dataDir);
  process.env.ERP_DATA_DIR = dataDir;
  process.env.ERP_SEED_MODE = "demo";
  vi.resetModules();

  const service = await import("./erp-service");
  const { getDb } = await import("./db");
  const parallel = await import("./parallel-ledger-service");
  const { runParallelCalculation } = await import("./parallel-calculation-engine");
  const database = getDb();

  parallel.seedParallelDemoData(database);
  const { ledgerId } = parallel.createParallelLedger(database, "U-ADMIN", {
    name: "客户演示重置测试",
    purpose: "验证只清理平行账数据",
    base_as_of: new Date().toISOString().slice(0, 10),
    scope_type: "production_order",
    scope_entities: [
      { scope_entity_type: "production_order", scope_entity_id: "PO-PAL-DEMO" },
    ],
    merge_allowed: 1,
  });
  parallel.addParallelAdjustment(database, "U-ADMIN", ledgerId, {
    adjustment_type: "material_substitute",
    effective_at: "2026-08-25",
    reason: "将原料A替换为原料B",
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
  runParallelCalculation(database, "U-ADMIN", ledgerId);

  return { service, database, dataDir, ledgerId };
}

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  delete process.env.ERP_DATA_DIR;
  delete process.env.ERP_SEED_MODE;
});

describe("平行账套客户演示一键重置", () => {
  it("管理员确认后先生成可校验备份，再只清除平行账及其未落地正式来源数据", async () => {
    const { service, database, dataDir, ledgerId } = await loadHarness();
    const materialBefore = database
      .prepare("SELECT stock_qty, average_cost FROM materials WHERE id = 'M-PAL-A'")
      .get() as { stock_qty: number; average_cost: number };
    const productionCountBefore = (database.prepare("SELECT COUNT(*) AS count FROM production_orders").get() as { count: number }).count;

    database.prepare(`
      INSERT INTO purchase_requisitions (
        id, requisition_no, source_type, requested_by, source_document_type,
        source_document_id, status, total_amount, required_date, reason, created_at,
        approval_note
      ) VALUES (
        'PR-PARALLEL-RESET', 'QS-PARALLEL-RESET', 'parallel_merge', 'U-ADMIN',
        'parallel_ledger', ?, 'approved', 1200, '2026-08-25', '平行账合并测试',
        '2026-08-25T00:00:00.000Z', ''
      )
    `).run(ledgerId);
    database.prepare(`
      INSERT INTO purchase_requisition_lines (
        id, purchase_requisition_id, material_id, requested_qty,
        estimated_unit_cost, line_amount, note
      ) VALUES ('PRL-PARALLEL-RESET', 'PR-PARALLEL-RESET', 'M-PAL-B', 1, 1200, 1200, '')
    `).run();
    database.prepare(`
      INSERT INTO purchase_requisitions (
        id, requisition_no, source_type, requested_by, status, total_amount,
        required_date, reason, created_at, approval_note
      ) VALUES (
        'PR-FORMAL-KEEP', 'QS-FORMAL-KEEP', 'manual', 'U-ADMIN', 'draft',
        100, '2026-08-25', '正式采购申请必须保留', '2026-08-25T00:00:00.000Z', ''
      )
    `).run();

    const result = service.performAction({
      actorId: "U-ADMIN",
      action: "resetParallelDemoData",
      payload: { confirmation: CONFIRMATION },
    }) as { backupName: string; deleted: Record<string, number> };

    expect(result.backupName).toMatch(/^erp-before-parallel-demo-reset-.*\.sqlite$/);
    const backupPath = path.join(dataDir, "backups", result.backupName);
    expect(fs.existsSync(backupPath)).toBe(true);
    const backup = new Database(backupPath, { readonly: true });
    expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
    expect((backup.prepare("SELECT COUNT(*) AS count FROM parallel_ledgers").get() as { count: number }).count).toBe(1);
    backup.close();

    expect((database.prepare("SELECT COUNT(*) AS count FROM parallel_ledgers").get() as { count: number }).count).toBe(0);
    expect((database.prepare("SELECT COUNT(*) AS count FROM parallel_simulation_documents").get() as { count: number }).count).toBe(0);
    expect((database.prepare("SELECT COUNT(*) AS count FROM purchase_requisitions WHERE source_type = 'parallel_merge'").get() as { count: number }).count).toBe(0);
    expect(database.prepare("SELECT id FROM purchase_requisitions WHERE id = 'PR-FORMAL-KEEP'").get()).toBeTruthy();
    expect(database.prepare("SELECT stock_qty, average_cost FROM materials WHERE id = 'M-PAL-A'").get()).toEqual(materialBefore);
    expect((database.prepare("SELECT COUNT(*) AS count FROM production_orders").get() as { count: number }).count).toBe(productionCountBefore);
    expect(database.prepare("SELECT action FROM audit_logs WHERE action = 'resetParallelDemoData'").get()).toBeTruthy();
  });

  it("非管理员即使知道确认口令也不能执行", async () => {
    const { service, database } = await loadHarness();

    expect(() => service.performAction({
      actorId: "U-MGR",
      action: "resetParallelDemoData",
      payload: { confirmation: CONFIRMATION },
    })).toThrow(/无权/);
    expect((database.prepare("SELECT COUNT(*) AS count FROM parallel_ledgers").get() as { count: number }).count).toBe(1);
  });

  it("确认口令不完全一致时不备份也不删除", async () => {
    const { service, database, dataDir } = await loadHarness();

    expect(() => service.performAction({
      actorId: "U-ADMIN",
      action: "resetParallelDemoData",
      payload: { confirmation: "清空" },
    })).toThrow(/请输入“清空平行账”/);
    expect((database.prepare("SELECT COUNT(*) AS count FROM parallel_ledgers").get() as { count: number }).count).toBe(1);
    expect(fs.readdirSync(path.join(dataDir, "backups"))).toEqual([]);
  });
});
