import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureDataDirs } from "./paths";

export const PARALLEL_DEMO_RESET_CONFIRMATION = "清空平行账";

type CountRow = { count: number };

export type ParallelDemoResetResult = {
  backupName: string;
  deleted: {
    ledgers: number;
    simulationDocuments: number;
    mergeRequests: number;
    formalCorrections: number;
    purchaseRequisitions: number;
  };
};

function count(database: Database.Database, sql: string) {
  return (database.prepare(sql).get() as CountRow).count;
}

function assertAdmin(database: Database.Database, actorId: string) {
  const user = database.prepare("SELECT role, status FROM users WHERE id = ?").get(actorId) as {
    role: string;
    status: string;
  } | undefined;
  if (!user || user.status !== "active" || user.role !== "admin") {
    throw new Error("仅系统管理员有权清空平行账套演示数据。");
  }
}

function assertNoExecutedFormalBusiness(database: Database.Database) {
  const convertedRequisitions = count(database, `
    SELECT COUNT(*) AS count
    FROM purchase_requisitions
    WHERE source_type = 'parallel_merge'
      AND source_document_type = 'parallel_ledger'
      AND converted_order_id IS NOT NULL
  `);
  const executedCorrections = count(database, `
    SELECT COUNT(*) AS count
    FROM formal_correction_orders
    WHERE source_type = 'parallel_merge'
      AND status NOT IN ('pending_execution', 'waiting_external')
  `);
  if (convertedRequisitions > 0 || executedCorrections > 0) {
    throw new Error("部分平行账结果已经进入正式业务，不能使用演示重置；请先按正式业务冲销流程处理。");
  }
}

function backupName() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  const suffix = crypto.randomBytes(3).toString("hex");
  return `erp-before-parallel-demo-reset-${stamp}-${suffix}.sqlite`;
}

function createVerifiedBackup(database: Database.Database) {
  const paths = ensureDataDirs();
  const name = backupName();
  const backupPath = path.join(paths.backups, name);
  const escapedPath = backupPath.replaceAll("'", "''");
  database.exec(`VACUUM INTO '${escapedPath}'`);
  const backup = new Database(backupPath, { readonly: true });
  const integrity = backup.pragma("integrity_check", { simple: true });
  backup.close();
  if (integrity !== "ok") throw new Error("重置前数据库备份校验失败，操作已取消。");
  return name;
}

function auditReset(database: Database.Database, actorId: string, result: ParallelDemoResetResult) {
  database.prepare(`
    INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, message, created_at)
    VALUES (?, ?, 'resetParallelDemoData', 'system', 'parallel_demo', ?, ?)
  `).run(
    `A-${crypto.randomUUID()}`,
    actorId,
    `清空平行账套客户演示数据；备份 ${result.backupName}；删除账套 ${result.deleted.ledgers} 套、模拟单据 ${result.deleted.simulationDocuments} 张、合并申请 ${result.deleted.mergeRequests} 个。`,
    new Date().toISOString(),
  );
}

export function resetParallelDemoData(
  database: Database.Database,
  actorId: string,
  confirmation: string,
): ParallelDemoResetResult {
  assertAdmin(database, actorId);
  if (confirmation !== PARALLEL_DEMO_RESET_CONFIRMATION) {
    throw new Error(`请输入“${PARALLEL_DEMO_RESET_CONFIRMATION}”确认操作。`);
  }
  assertNoExecutedFormalBusiness(database);

  const deleted = {
    ledgers: count(database, "SELECT COUNT(*) AS count FROM parallel_ledgers"),
    simulationDocuments: count(database, "SELECT COUNT(*) AS count FROM parallel_simulation_documents"),
    mergeRequests: count(database, "SELECT COUNT(*) AS count FROM parallel_merge_requests"),
    formalCorrections: count(database, "SELECT COUNT(*) AS count FROM formal_correction_orders WHERE source_type = 'parallel_merge'"),
    purchaseRequisitions: count(database, "SELECT COUNT(*) AS count FROM purchase_requisitions WHERE source_type = 'parallel_merge' AND source_document_type = 'parallel_ledger'"),
  };
  const name = createVerifiedBackup(database);

  const result: ParallelDemoResetResult = { backupName: name, deleted };
  database.transaction(() => {
    database.exec(`
      DELETE FROM audit_logs
      WHERE action LIKE 'parallel%'
         OR (entity_type = 'approval' AND entity_id IN (
           SELECT id FROM approval_requests WHERE entity_type = 'parallel_merge'
         ));
      DELETE FROM document_exports
      WHERE entity_type = 'parallel_ledger' OR ledger_type = 'parallel';
      DELETE FROM purchase_requisition_lines
      WHERE purchase_requisition_id IN (
        SELECT id FROM purchase_requisitions
        WHERE source_type = 'parallel_merge'
          AND source_document_type = 'parallel_ledger'
          AND converted_order_id IS NULL
      );
      DELETE FROM purchase_requisitions
      WHERE source_type = 'parallel_merge'
        AND source_document_type = 'parallel_ledger'
        AND converted_order_id IS NULL;
      DELETE FROM approval_requests WHERE entity_type = 'parallel_merge';
      DELETE FROM reconciliation_results;
      DELETE FROM correction_recovery_points;
      DELETE FROM correction_execution_steps;
      DELETE FROM correction_execution_runs;
      DELETE FROM formal_correction_orders WHERE source_type = 'parallel_merge';
      DELETE FROM parallel_merge_conflicts;
      DELETE FROM parallel_merge_items;
      DELETE FROM parallel_merge_requests;
      DELETE FROM parallel_simulation_documents;
      DELETE FROM parallel_suggestions;
      DELETE FROM parallel_gaps;
      DELETE FROM parallel_impacts;
      DELETE FROM parallel_material_allocations;
      DELETE FROM parallel_inventory_projections;
      DELETE FROM parallel_cost_projections;
      DELETE FROM parallel_calculation_runs;
      DELETE FROM parallel_adjustment_lines;
      DELETE FROM parallel_adjustments;
      DELETE FROM parallel_snapshot_manifests;
      DELETE FROM parallel_entity_snapshots;
      DELETE FROM parallel_ledger_scopes;
      DELETE FROM parallel_ledger_members;
      DELETE FROM parallel_ledgers;
    `);
    auditReset(database, actorId, result);
  })();

  return result;
}
