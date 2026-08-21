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
} from "@/lib/parallel-ledger-service";
import {
  approveParallelMerge,
  publishParallelMerge,
  submitParallelMerge,
} from "@/lib/parallel-merge-service";

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-par-execution-"));
  process.env.ERP_DATA_DIR = dir;
  return dir;
}

describe("平行账套正式纠错执行闸门", () => {
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

    ({ ledgerId } = createParallelLedger(database, ownerId, {
      name: "缺料发布执行闸门",
      purpose: "验证生成单据不等于已合并",
      base_as_of: baseAsOf,
      scope_type: "company",
      merge_allowed: 1,
      allowed_user_ids: [publisherId],
      seed_demo: true,
    }));
    database.prepare(`
      UPDATE parallel_ledger_members
      SET can_approve_merge = 1, can_publish_merge = 1
      WHERE ledger_id = ? AND user_id = ?
    `).run(ledgerId, publisherId);

    addParallelAdjustment(database, ownerId, ledgerId, {
      adjustment_type: "bom_ratio",
      effective_at: baseAsOf,
      reason: "A6+B2+C2",
      lines: [
        { entity_type: "product", entity_id: "P-PAL-DEMO", field_code: "qty_per", target_material_id: "M-PAL-A", quantity: 0.6 },
        { entity_type: "product", entity_id: "P-PAL-DEMO", field_code: "qty_per", target_material_id: "M-PAL-B", quantity: 0.2 },
      ],
    });
    addParallelAdjustment(database, ownerId, ledgerId, {
      adjustment_type: "purchase_price",
      effective_at: baseAsOf,
      reason: "B 采购价 13000",
      lines: [
        { entity_type: "material", entity_id: "M-PAL-B", field_code: "purchase_price", target_material_id: "M-PAL-B", unit_price: 13000 },
      ],
    });
    runParallelCalculation(database, ownerId, ledgerId);
    const suggestion = database.prepare(`
      SELECT id FROM parallel_suggestions
      WHERE ledger_id = ? AND suggestion_type = 'purchase_requisition'
    `).get(ledgerId) as { id: string };
    confirmParallelSuggestion(database, ownerId, suggestion.id, { decision: "accept" });
    freezeParallelLedger(database, ownerId, ledgerId);
    ({ mergeRequestId } = submitParallelMerge(database, ownerId, ledgerId));
    approveParallelMerge(database, publisherId, mergeRequestId, { approval_note: "同意进入正式执行" });
  });

  it("生成正式单据后保持执行中，并记录采购到货前的阻断对账", () => {
    const result = publishParallelMerge(database, publisherId, mergeRequestId);
    expect(result).toMatchObject({
      publishedCount: 3,
      completed: false,
      status: "execution_pending",
    });

    const ledger = database.prepare("SELECT status, merged_at FROM parallel_ledgers WHERE id = ?").get(ledgerId) as {
      status: string;
      merged_at: string | null;
    };
    const merge = database.prepare("SELECT status, published_at FROM parallel_merge_requests WHERE id = ?").get(mergeRequestId) as {
      status: string;
      published_at: string | null;
    };
    const execution = database.prepare("SELECT status, waiting_steps FROM correction_execution_runs WHERE merge_request_id = ?").get(mergeRequestId) as {
      status: string;
      waiting_steps: number;
    };
    const reconciliation = database.prepare(`
      SELECT status, blocking, message
      FROM reconciliation_results
      WHERE merge_request_id = ? AND rule_code = 'inventory_procurement_readiness'
    `).get(mergeRequestId) as { status: string; blocking: number; message: string };

    expect(ledger).toEqual({ status: "publishing", merged_at: null });
    expect(merge.status).toBe("execution_pending");
    expect(merge.published_at).toBeNull();
    expect(execution.status).toBe("waiting_external");
    expect(execution.waiting_steps).toBeGreaterThan(0);
    expect(reconciliation).toMatchObject({ status: "failed", blocking: 1 });
    expect(reconciliation.message).toMatch(/原料B|M-PAL-B|到货/);
    expect((database.prepare("SELECT COUNT(*) AS count FROM formal_correction_orders WHERE source_merge_request_id = ? AND status = 'pending_execution'").get(mergeRequestId) as { count: number }).count).toBe(2);
    expect((database.prepare("SELECT COUNT(*) AS count FROM purchase_requisitions WHERE source_type = 'parallel_merge' AND source_document_id = ?").get(ledgerId) as { count: number }).count).toBe(1);
  });

  it("重复发布返回同一执行结果，不重复创建正式单据", () => {
    const correctionCount = (database.prepare("SELECT COUNT(*) AS count FROM formal_correction_orders WHERE source_merge_request_id = ?").get(mergeRequestId) as { count: number }).count;
    const purchaseCount = (database.prepare("SELECT COUNT(*) AS count FROM purchase_requisitions WHERE source_type = 'parallel_merge' AND source_document_id = ?").get(ledgerId) as { count: number }).count;

    const repeated = publishParallelMerge(database, publisherId, mergeRequestId);

    expect(repeated).toMatchObject({
      publishedCount: 3,
      completed: false,
      status: "execution_pending",
      idempotent: true,
    });
    expect((database.prepare("SELECT COUNT(*) AS count FROM formal_correction_orders WHERE source_merge_request_id = ?").get(mergeRequestId) as { count: number }).count).toBe(correctionCount);
    expect((database.prepare("SELECT COUNT(*) AS count FROM purchase_requisitions WHERE source_type = 'parallel_merge' AND source_document_id = ?").get(ledgerId) as { count: number }).count).toBe(purchaseCount);
  });
});
