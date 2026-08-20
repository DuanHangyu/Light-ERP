import type Database from "better-sqlite3";
import crypto from "node:crypto";
import { audit, getUser, now, uid } from "./erp-service";
import { loadSnapshotStore } from "./parallel-snapshot-service";
import { requireParallelPermission } from "./parallel-ledger-service";

export function confirmParallelSuggestion(database: Database.Database, actorId: string, suggestionId: string, payload: Record<string, unknown>) {
  const user = getUser(database, actorId);
  void user;
  const suggestion = database.prepare("SELECT * FROM parallel_suggestions WHERE id = ?").get(suggestionId) as { id: string; gap_id: string; ledger_id: string; status: string; suggestion_type: string } | undefined;
  if (!suggestion) throw new Error("建议不存在。");
  requireParallelPermission(database, actorId, suggestion.ledger_id, "adjust");
  if (suggestion.status !== "pending") throw new Error("该建议已处理。");
  const decision = String(payload.decision ?? "accept");
  const note = String(payload.note ?? "");
  const status = decision === "reject" ? "rejected" : "accepted";
  const confirmedAt = now();
  database.prepare("UPDATE parallel_suggestions SET status = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?").run(status, actorId, confirmedAt, suggestionId);
  if (status === "accepted") {
    database.prepare("UPDATE parallel_gaps SET resolution_status = 'suggested', selected_suggestion_id = ? WHERE id = ?").run(suggestionId, suggestion.gap_id);
  } else {
    database.prepare("UPDATE parallel_gaps SET resolution_status = 'rejected' WHERE id = ?").run(suggestion.gap_id);
  }
  audit(database, actorId, "parallelLedgerConfirmSuggestion", "parallel_suggestion", suggestionId, `${status === "accepted" ? "接受" : "拒绝"}建议 ${suggestion.suggestion_type}${note ? `：${note}` : ""}`);
}

export type MergeDiff = {
  ledgerId: string;
  ledgerVersion: number;
  conflicts: Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    conflict_type: string;
    base_hash: string | null;
    current_hash: string | null;
    message: string;
  }>;
  diffItems: Array<{
    entity_type: string;
    entity_id: string;
    field: string;
    base_value: string | null;
    parallel_value: string | null;
    delta: string | null;
  }>;
  blocking: boolean;
};

export function previewParallelMerge(database: Database.Database, actorId: string, ledgerId: string): MergeDiff {
  const ledger = database.prepare("SELECT * FROM parallel_ledgers WHERE id = ?").get(ledgerId) as { id: string; ledger_code: string; status: string; working_version: number; base_as_of: string; base_revision: string | null } | undefined;
  if (!ledger) throw new Error("平行账套不存在。");
  if (!["frozen", "merge_pending", "merge_rejected"].includes(ledger.status)) throw new Error("只有已冻结或待发布的账套可以预览合并。");

  const snapshotRows = database.prepare("SELECT entity_type, entity_id, content_hash, payload_json FROM parallel_entity_snapshots WHERE ledger_id = ?").all(ledgerId) as Array<{ entity_type: string; entity_id: string; content_hash: string; payload_json: string }>;
  const conflicts: MergeDiff["conflicts"] = [];
  const diffItems: MergeDiff["diffItems"] = [];
  const nowIso = now();

  const currentByEntity = new Map<string, Map<string, { hash: string; payload: string; row_version: number; updated_at: string | null }>>();
  for (const snap of snapshotRows) {
    let bucket = currentByEntity.get(snap.entity_type);
    if (!bucket) {
      bucket = new Map();
      currentByEntity.set(snap.entity_type, bucket);
    }
    const tableMap: Record<string, string> = { material: "materials", material_batch: "material_batches", product: "products", bom: "boms", bom_line: "bom_lines", quote: "quotes", order: "orders", production_order: "production_orders", requisition: "requisitions", requisition_line: "requisition_lines", finished_batch: "finished_batches", receivable: "receivables", payable: "payables" };
    const table = tableMap[snap.entity_type];
    if (!table) continue;
    if (bucket.size === 0) {
      const rows = database.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const id = String(row.id ?? "");
        const hash = computeHash(row);
        bucket.set(id, { hash, payload: JSON.stringify(row), row_version: Number(row.row_version ?? 0), updated_at: (row.updated_at as string | null) ?? null });
      }
    }
    const current = bucket.get(snap.entity_id);
    if (!current) {
      conflicts.push({ id: uid("PMC"), entity_type: snap.entity_type, entity_id: snap.entity_id, conflict_type: "entity_removed", base_hash: snap.content_hash, current_hash: null, message: `基准中的 ${snap.entity_type} ${snap.entity_id} 在正式账套已不存在。` });
      continue;
    }
    if (current.hash !== snap.content_hash) {
      conflicts.push({ id: uid("PMC"), entity_type: snap.entity_type, entity_id: snap.entity_id, conflict_type: "entity_modified", base_hash: snap.content_hash, current_hash: current.hash, message: `${snap.entity_type} ${snap.entity_id} 在正式账套创建平行账套后发生了变化。` });
    }
  }

  const adjustments = database.prepare("SELECT id, adjustment_no, adjustment_type FROM parallel_adjustments WHERE ledger_id = ? AND status = 'active'").all(ledgerId) as Array<{ id: string; adjustment_no: string; adjustment_type: string }>;
  for (const adj of adjustments) {
    diffItems.push({ entity_type: "adjustment", entity_id: adj.id, field: "adjustment_type", base_value: null, parallel_value: adj.adjustment_type, delta: adj.adjustment_no });
  }

  const blocking = conflicts.length > 0;
  audit(database, actorId, "parallelLedgerMergePreview", "parallel_ledger", ledgerId, `合并预览 ${ledger.ledger_code}：${conflicts.length} 个冲突，${diffItems.length} 个差异${blocking ? "（存在阻断）" : ""}`);
  void ledger.base_revision;
  void nowIso;
  void loadSnapshotStore;
  return { ledgerId, ledgerVersion: ledger.working_version, conflicts, diffItems, blocking };
}

function computeHash(row: Record<string, unknown>): string {
  const stable = JSON.stringify(
    Object.keys(row)
      .sort()
      .reduce((acc, key) => {
        acc[key] = row[key];
        return acc;
      }, {} as Record<string, unknown>),
  );
  return crypto.createHash("sha256").update(stable, "utf8").digest("hex");
}
