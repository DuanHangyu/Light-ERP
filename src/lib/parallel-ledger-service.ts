import type Database from "better-sqlite3";
import { audit, getUser, now, serial, uid } from "./erp-service";
import { captureFormalSnapshot, previewSnapshot } from "./parallel-snapshot-service";
import { runParallelCalculation } from "./parallel-calculation-engine";
import {
  ADJUSTMENT_TYPE_LABELS,
  LEDGER_STATUS_LABELS,
  type AdjustmentType,
  type ParallelAdjustmentLineRow,
  type ParallelAdjustmentRow,
  type ParallelLedgerRow,
} from "./parallel-ledger-types";

function text(payload: Record<string, unknown> | undefined, key: string, label: string, required = true): string {
  if (!payload) throw new Error(`缺少${label}。`);
  const value = payload[key];
  if (value == null || value === "") {
    if (required) throw new Error(`请填写${label}。`);
    return "";
  }
  return String(value);
}

function numberOr(payload: Record<string, unknown> | undefined, key: string, fallback: number): number {
  if (!payload) return fallback;
  const value = payload[key];
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertLedger(database: Database.Database, ledgerId: string, actorId: string): ParallelLedgerRow {
  const ledger = database.prepare("SELECT * FROM parallel_ledgers WHERE id = ?").get(ledgerId) as ParallelLedgerRow | undefined;
  if (!ledger) throw new Error("平行账套不存在。");
  requireParallelPermission(database, actorId, ledgerId, "view");
  return ledger;
}

export type ParallelPermission =
  | "view" | "adjust" | "recalculate" | "export" | "freeze"
  | "submit_merge" | "approve_merge" | "publish_merge" | "archive" | "discard" | "admin";

const PERMISSION_COLUMN: Record<ParallelPermission, string> = {
  view: "can_view",
  adjust: "can_adjust",
  recalculate: "can_recalculate",
  export: "can_export",
  freeze: "can_freeze",
  submit_merge: "can_submit_merge",
  approve_merge: "can_approve_merge",
  publish_merge: "can_publish_merge",
  archive: "can_archive",
  discard: "can_discard",
  admin: "can_admin",
};

const PERMISSION_LABELS: Record<ParallelPermission, string> = {
  view: "查看",
  adjust: "调整",
  recalculate: "重算",
  export: "导出",
  freeze: "冻结",
  submit_merge: "提交合并",
  approve_merge: "审批合并",
  publish_merge: "发布合并",
  archive: "归档",
  discard: "放弃",
  admin: "管理",
};

export function requireParallelPermission(database: Database.Database, actorId: string, ledgerId: string, permission: ParallelPermission) {
  const user = getUser(database, actorId);
  if (user.role === "admin") return;
  const owner = database.prepare("SELECT owner_user_id FROM parallel_ledgers WHERE id = ?").get(ledgerId) as { owner_user_id: string } | undefined;
  if (!owner) throw new Error("平行账套不存在。");
  if (owner.owner_user_id === actorId) return;
  const member = database.prepare(`SELECT ${PERMISSION_COLUMN[permission]} AS granted FROM parallel_ledger_members WHERE ledger_id = ? AND user_id = ?`).get(ledgerId, actorId) as { granted: number } | undefined;
  if (!member || !Number(member.granted)) {
    throw new Error(`无权执行该操作（缺少权限 parallel_ledger.${permission}「${PERMISSION_LABELS[permission]}」）。`);
  }
}

export function seedParallelDemoData(database: Database.Database) {
  const ts = now();
  const upsertMaterial = database.prepare(
    "INSERT INTO materials (id, material_code, name, unit, stock_qty, average_cost, kind, reorder_min_qty, status, created_at, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, 'raw', 0, 'active', ?, ?, 0) ON CONFLICT(id) DO UPDATE SET stock_qty=excluded.stock_qty, average_cost=excluded.average_cost, updated_at=excluded.updated_at",
  );
  const upsertBatch = database.prepare(
    "INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at, status, row_version) VALUES (?, ?, ?, ?, ?, ?, 'available', 0) ON CONFLICT(id) DO UPDATE SET qty=excluded.qty, unit_cost=excluded.unit_cost",
  );
  const A = "M-PAL-A";
  const B = "M-PAL-B";
  const C = "M-PAL-C";
  upsertMaterial.run(A, "PAL-A", "原料A（平行账套演示）", "吨", 10, 10000, ts, ts);
  upsertMaterial.run(B, "PAL-B", "原料B（平行账套演示）", "吨", 1, 12000, ts, ts);
  upsertMaterial.run(C, "PAL-C", "添加剂C（平行账套演示）", "吨", 3, 6000, ts, ts);
  upsertBatch.run("MB-PAL-A", A, "BATCH-PAL-A", 10, 10000, ts);
  upsertBatch.run("MB-PAL-B", B, "BATCH-PAL-B", 1, 12000, ts);
  upsertBatch.run("MB-PAL-C", C, "BATCH-PAL-C", 3, 6000, ts);

  const P = "P-PAL-DEMO";
  database
    .prepare("INSERT INTO products (id, product_code, name, unit, process_fee, default_margin, status, created_at, updated_at) VALUES (?, ?, '成品P（平行账套演示）', '吨', 2000, 0.1, 'active', ?, ?) ON CONFLICT(id) DO UPDATE SET process_fee=excluded.process_fee, updated_at=excluded.updated_at")
    .run(P, "PAL-P", ts, ts);

  const bomId = "BOM-PAL-DEMO";
  database
    .prepare("INSERT INTO boms (id, product_id, version, status, remark, created_at, updated_at, row_version) VALUES (?, ?, '1', 'active', '平行账套演示配方 A8+C2', ?, ?, 0) ON CONFLICT(id) DO UPDATE SET status='active'")
    .run(bomId, P, ts, ts);
  database.prepare("DELETE FROM bom_lines WHERE bom_id = ?").run(bomId);
  database.prepare("INSERT INTO bom_lines (bom_id, parent_product_id, component_type, component_id, qty_per, is_primary, row_version) VALUES (?, ?, 'material', ?, 0.8, 1, 0)").run(bomId, P, A);
  database.prepare("INSERT INTO bom_lines (bom_id, parent_product_id, component_type, component_id, qty_per, is_primary, row_version) VALUES (?, ?, 'material', ?, 0.2, 0, 0)").run(bomId, P, C);

  const customerId = "C-PAL-DEMO";
  database
    .prepare("INSERT INTO customers (id, customer_code, name, contact, phone, status, address, created_at, updated_at) VALUES (?, 'PAL-C', '平行账套演示客户', '演示', '000', 'active', '', ?, ?) ON CONFLICT(id) DO NOTHING")
    .run(customerId, ts, ts);

  const quoteId = "Q-PAL-DEMO";
  const orderQty = 10;
  const materialCost = 8 * 10000 + 2 * 6000;
  const processFee = 2000 * orderQty;
  const total = materialCost + processFee;
  database
    .prepare("INSERT INTO quotes (id, quote_no, customer_id, product_id, qty, version, material_cost, process_fee, margin_rate, total_amount, status, created_at, row_version) VALUES (?, 'BJ-PAL-DEMO', ?, ?, ?, 1, ?, ?, 0, ?, 'confirmed', ?, 0) ON CONFLICT(id) DO UPDATE SET total_amount=excluded.total_amount, material_cost=excluded.material_cost")
    .run(quoteId, customerId, P, orderQty, materialCost, processFee, total, ts);

  const orderId = "O-PAL-DEMO";
  database
    .prepare("INSERT INTO orders (id, order_no, quote_id, customer_id, product_id, qty, due_date, special_requirements, status, created_at, row_version) VALUES (?, 'DD-PAL-DEMO', ?, ?, ?, ?, ?, '按平行账套演示', 'submitted', ?, 0) ON CONFLICT(id) DO NOTHING")
    .run(orderId, quoteId, customerId, P, orderQty, ts.slice(0, 10), ts);

  const prodId = "PO-PAL-DEMO";
  database
    .prepare("INSERT INTO production_orders (id, prod_no, order_id, priority, instruction_note, technical_requirements, status, created_at, row_version) VALUES (?, 'SC-PAL-DEMO', ?, 'normal', '平行账套演示生产单', '按演示BOM', 'material_requested', ?, 0) ON CONFLICT(id) DO NOTHING")
    .run(prodId, orderId, ts);
}

export function createParallelLedger(database: Database.Database, actorId: string, payload: Record<string, unknown>): { ledgerId: string; preview: Record<string, unknown> } {
  const user = getUser(database, actorId);
  void user;
  const name = text(payload, "name", "账套名称");
  const purpose = text(payload, "purpose", "用途说明", false) || "经营数据测算";
  const baseAsOf = text(payload, "base_as_of", "基准日期", false) || new Date().toISOString().slice(0, 10);
  const scopeType = text(payload, "scope_type", "范围类型", false) || "company";
  const mergeAllowed = numberOr(payload, "merge_allowed", 1);
  const allowedUserIds = Array.isArray(payload.allowed_user_ids) ? (payload.allowed_user_ids as unknown[]).map(String) : [];
  const scopeEntities = Array.isArray(payload.scope_entities) ? (payload.scope_entities as Array<Record<string, unknown>>) : [];
  if (payload.seed_demo) seedParallelDemoData(database);

  const ledgerId = uid("PL");
  const ledgerCode = serial(database, "parallel_ledgers", "PX");
  const createdAt = now();
  const baseRevision = `formal-${baseAsOf}`;

  database
    .prepare(
      "INSERT INTO parallel_ledgers (id, ledger_code, name, purpose, base_ledger_id, base_as_of, base_revision, scope_type, status, working_version, engine_version, merge_allowed, owner_user_id, created_by, created_at, updated_at, row_version) VALUES (?, ?, ?, ?, 'formal', ?, ?, ?, 'creating', 1, NULL, ?, ?, ?, ?, ?, 0)",
    )
    .run(ledgerId, ledgerCode, name, purpose, baseAsOf, baseRevision, scopeType, mergeAllowed, actorId, actorId, createdAt, createdAt);

  database
    .prepare("INSERT INTO parallel_ledger_members (id, ledger_id, user_id, member_role, can_view, can_adjust, can_export, can_submit_merge, granted_by, granted_at) VALUES (?, ?, ?, 'owner', 1, 1, 1, 1, ?, ?)")
    .run(uid("PLM"), ledgerId, actorId, actorId, createdAt);
  for (const userId of allowedUserIds) {
    if (userId === actorId) continue;
    database
      .prepare("INSERT OR IGNORE INTO parallel_ledger_members (id, ledger_id, user_id, member_role, can_view, can_adjust, can_export, can_submit_merge, granted_by, granted_at) VALUES (?, ?, ?, 'viewer', 1, 0, 0, 0, ?, ?)")
      .run(uid("PLM"), ledgerId, userId, actorId, createdAt);
  }
  for (const entity of scopeEntities) {
    const entityType = String(entity.scope_entity_type ?? "company");
    const entityId = String(entity.scope_entity_id ?? "ALL");
    database
      .prepare("INSERT INTO parallel_ledger_scopes (id, ledger_id, scope_entity_type, scope_entity_id, include_children, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(uid("PLS"), ledgerId, entityType, entityId, Number(entity.include_children ?? 0), createdAt);
  }

  const { count } = captureFormalSnapshot(database, ledgerId);
  database.prepare("UPDATE parallel_ledgers SET status = 'draft', updated_at = ? WHERE id = ?").run(now(), ledgerId);
  audit(database, actorId, "parallelLedgerCreate", "parallel_ledger", ledgerId, `创建平行账套 ${ledgerCode}：${name}，快照 ${count} 条`);
  return { ledgerId, preview: previewSnapshot(database) };
}

export function freezeParallelLedger(database: Database.Database, actorId: string, ledgerId: string) {
  const ledger = assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "freeze");
  if (!["ready", "draft"].includes(ledger.status)) throw new Error(`账套状态【${LEDGER_STATUS_LABELS[ledger.status as keyof typeof LEDGER_STATUS_LABELS] ?? ledger.status}】不能冻结。`);
  if (ledger.status === "draft") runParallelCalculation(database, actorId, ledgerId);
  const frozenAt = now();
  database.prepare("UPDATE parallel_ledgers SET status = 'frozen', frozen_at = ?, updated_at = ? WHERE id = ?").run(frozenAt, frozenAt, ledgerId);
  audit(database, actorId, "parallelLedgerFreeze", "parallel_ledger", ledgerId, `冻结平行账套 ${ledger.ledger_code}`);
}

export function unfreezeParallelLedger(database: Database.Database, actorId: string, ledgerId: string) {
  const ledger = assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "freeze");
  if (ledger.status !== "frozen") throw new Error("只有已冻结账套可以解冻。");
  const nextVersion = ledger.working_version + 1;
  database.prepare("UPDATE parallel_ledgers SET status = 'draft', working_version = ?, frozen_at = NULL, updated_at = ? WHERE id = ?").run(nextVersion, now(), ledgerId);
  audit(database, actorId, "parallelLedgerUnfreeze", "parallel_ledger", ledgerId, `解冻平行账套 ${ledger.ledger_code}，版本 ${nextVersion}`);
}

export function archiveParallelLedger(database: Database.Database, actorId: string, ledgerId: string) {
  const ledger = assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "archive");
  if (!["ready", "frozen", "merged"].includes(ledger.status)) throw new Error("当前状态不允许归档。");
  const archivedAt = now();
  database.prepare("UPDATE parallel_ledgers SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?").run(archivedAt, archivedAt, ledgerId);
  audit(database, actorId, "parallelLedgerArchive", "parallel_ledger", ledgerId, `归档平行账套 ${ledger.ledger_code}`);
}

export function discardParallelLedger(database: Database.Database, actorId: string, ledgerId: string) {
  const ledger = assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "discard");
  if (["merged", "archived"].includes(ledger.status)) throw new Error("已合并或已归档账套不能放弃，请改用归档。");
  database.prepare("UPDATE parallel_ledgers SET status = 'discarded', updated_at = ? WHERE id = ?").run(now(), ledgerId);
  audit(database, actorId, "parallelLedgerDiscard", "parallel_ledger", ledgerId, `放弃平行账套 ${ledger.ledger_code}`);
}

export function addParallelAdjustment(database: Database.Database, actorId: string, ledgerId: string, payload: Record<string, unknown>): { adjustmentId: string } {
  const ledger = assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "adjust");
  if (!["draft", "ready"].includes(ledger.status)) throw new Error("账套当前状态不允许新增调整。");
  const adjustmentType = text(payload, "adjustment_type", "调整类型") as AdjustmentType;
  if (!ADJUSTMENT_TYPE_LABELS[adjustmentType]) throw new Error(`不支持的调整类型：${adjustmentType}`);
  const effectiveAt = text(payload, "effective_at", "生效日期", false) || ledger.base_as_of;
  const reason = text(payload, "reason", "调整原因", false) || ADJUSTMENT_TYPE_LABELS[adjustmentType];
  const referenceType = text(payload, "reference_type", "关联类型", false) || null;
  const referenceId = text(payload, "reference_id", "关联编号", false) || null;

  const adjustmentId = uid("PAD");
  const adjustmentNo = serial(database, "parallel_adjustments", "PT");
  const nextVersion = ledger.working_version + 1;
  const createdAt = now();
  database
    .prepare(
      "INSERT INTO parallel_adjustments (id, adjustment_no, ledger_id, ledger_version, adjustment_type, effective_at, reason, reference_type, reference_id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
    )
    .run(adjustmentId, adjustmentNo, ledgerId, nextVersion, adjustmentType, effectiveAt, reason, referenceType, referenceId, actorId, createdAt, createdAt);
  database.prepare("UPDATE parallel_ledgers SET working_version = ?, status = 'draft', updated_at = ? WHERE id = ?").run(nextVersion, createdAt, ledgerId);
  database.prepare("UPDATE parallel_calculation_runs SET stale = 1 WHERE ledger_id = ?").run(ledgerId);

  const lines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
  const insertLine = database.prepare(
    "INSERT INTO parallel_adjustment_lines (id, adjustment_id, entity_type, entity_id, field_code, before_value, after_value, delta_value, source_material_id, target_material_id, quantity, unit_price, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const line of lines) {
    insertLine.run(
      uid("PAL"),
      adjustmentId,
      String(line.entity_type ?? ""),
      String(line.entity_id ?? ""),
      String(line.field_code ?? ""),
      line.before_value == null ? null : String(line.before_value),
      line.after_value == null ? null : String(line.after_value),
      line.delta_value == null ? null : String(line.delta_value),
      line.source_material_id ? String(line.source_material_id) : null,
      line.target_material_id ? String(line.target_material_id) : null,
      line.quantity == null ? null : Number(line.quantity),
      line.unit_price == null ? null : Number(line.unit_price),
      String(line.remark ?? ""),
    );
  }
  audit(database, actorId, "parallelLedgerAddAdjustment", "parallel_adjustment", adjustmentId, `新增调整 ${adjustmentNo}：${ADJUSTMENT_TYPE_LABELS[adjustmentType]}`);
  return { adjustmentId };
}

export function removeParallelAdjustment(database: Database.Database, actorId: string, ledgerId: string, adjustmentId: string) {
  assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "adjust");
  const adjustment = database.prepare("SELECT adjustment_no, status FROM parallel_adjustments WHERE id = ? AND ledger_id = ?").get(adjustmentId, ledgerId) as { adjustment_no: string; status: string } | undefined;
  if (!adjustment) throw new Error("调整项不存在。");
  if (adjustment.status !== "active") throw new Error("只能撤销生效中的调整项。");
  database.prepare("UPDATE parallel_adjustments SET status = 'removed', updated_at = ? WHERE id = ?").run(now(), adjustmentId);
  database.prepare("UPDATE parallel_ledgers SET status = 'draft', updated_at = ? WHERE id = ?").run(now(), ledgerId);
  database.prepare("UPDATE parallel_calculation_runs SET stale = 1 WHERE ledger_id = ?").run(ledgerId);
  audit(database, actorId, "parallelLedgerRemoveAdjustment", "parallel_adjustment", adjustmentId, `撤销调整 ${adjustment.adjustment_no}`);
}

export function listParallelLedgersForUser(database: Database.Database, actorId: string): ParallelLedgerRow[] {
  const role = (database.prepare("SELECT role FROM users WHERE id = ?").get(actorId) as { role: string } | undefined)?.role;
  if (role !== "admin") {
    return database
      .prepare(
        "SELECT l.* FROM parallel_ledgers l LEFT JOIN parallel_ledger_members m ON m.ledger_id = l.id AND m.user_id = ? WHERE l.owner_user_id = ? OR m.user_id = ? ORDER BY l.created_at DESC",
      )
      .all(actorId, actorId, actorId) as ParallelLedgerRow[];
  }
  return database.prepare("SELECT * FROM parallel_ledgers ORDER BY created_at DESC").all() as ParallelLedgerRow[];
}

export function listParallelAdjustments(database: Database.Database, ledgerId: string): ParallelAdjustmentRow[] {
  return database.prepare("SELECT * FROM parallel_adjustments WHERE ledger_id = ? ORDER BY created_at").all(ledgerId) as ParallelAdjustmentRow[];
}

export function listParallelAdjustmentLines(database: Database.Database, adjustmentId: string): ParallelAdjustmentLineRow[] {
  return database.prepare("SELECT * FROM parallel_adjustment_lines WHERE adjustment_id = ? ORDER BY id").all(adjustmentId) as ParallelAdjustmentLineRow[];
}

export type ParallelSnapshotData = {
  ledgers: ParallelLedgerRow[];
  adjustments: ParallelAdjustmentRow[];
  adjustmentLines: ParallelAdjustmentLineRow[];
  runs: Array<Record<string, unknown>>;
  costProjections: Array<Record<string, unknown>>;
  inventoryProjections: Array<Record<string, unknown>>;
  materialAllocations: Array<Record<string, unknown>>;
  impacts: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  suggestions: Array<Record<string, unknown>>;
  mergeConflicts: Array<Record<string, unknown>>;
  mergeRequests: Array<Record<string, unknown>>;
  mergeItems: Array<Record<string, unknown>>;
};

export function buildParallelSnapshotData(database: Database.Database, actorId: string): ParallelSnapshotData {
  const ledgers = listParallelLedgersForUser(database, actorId);
  if (ledgers.length === 0) {
    return { ledgers: [], adjustments: [], adjustmentLines: [], runs: [], costProjections: [], inventoryProjections: [], materialAllocations: [], impacts: [], gaps: [], suggestions: [], mergeConflicts: [], mergeRequests: [], mergeItems: [] };
  }
  const ledgerIds = ledgers.map((l) => l.id);
  const placeholders = ledgerIds.map(() => "?").join(",");
  const adjustments = database.prepare(`SELECT * FROM parallel_adjustments WHERE ledger_id IN (${placeholders}) ORDER BY created_at`).all(...ledgerIds) as ParallelAdjustmentRow[];
  const adjustmentIds = adjustments.map((a) => a.id);
  const adjustmentLines: ParallelAdjustmentLineRow[] = adjustmentIds.length === 0 ? [] : (database.prepare(`SELECT * FROM parallel_adjustment_lines WHERE adjustment_id IN (${adjustmentIds.map(() => "?").join(",")}) ORDER BY id`).all(...adjustmentIds) as ParallelAdjustmentLineRow[]);
  const runs = database.prepare(`SELECT * FROM parallel_calculation_runs WHERE ledger_id IN (${placeholders}) AND stale = 0 ORDER BY created_at DESC`).all(...ledgerIds) as Array<Record<string, unknown>>;
  const runIds = runs.map((r) => String(r.id));
  const costProjections: Array<Record<string, unknown>> = [];
  const inventoryProjections: Array<Record<string, unknown>> = [];
  const materialAllocations: Array<Record<string, unknown>> = [];
  const impacts: Array<Record<string, unknown>> = [];
  const gaps: Array<Record<string, unknown>> = [];
  const suggestions: Array<Record<string, unknown>> = [];
  if (runIds.length > 0) {
    const runPlaceholders = runIds.map(() => "?").join(",");
    costProjections.push(...(database.prepare(`SELECT * FROM parallel_cost_projections WHERE run_id IN (${runPlaceholders}) ORDER BY production_order_id`).all(...runIds) as Array<Record<string, unknown>>));
    inventoryProjections.push(...(database.prepare(`SELECT * FROM parallel_inventory_projections WHERE run_id IN (${runPlaceholders}) ORDER BY material_id`).all(...runIds) as Array<Record<string, unknown>>));
    materialAllocations.push(...(database.prepare(`SELECT * FROM parallel_material_allocations WHERE run_id IN (${runPlaceholders}) ORDER BY production_order_id, requirement_material_id`).all(...runIds) as Array<Record<string, unknown>>));
    impacts.push(...(database.prepare(`SELECT * FROM parallel_impacts WHERE run_id IN (${runPlaceholders}) ORDER BY blocking DESC, severity`).all(...runIds) as Array<Record<string, unknown>>));
    gaps.push(...(database.prepare(`SELECT * FROM parallel_gaps WHERE run_id IN (${runPlaceholders}) ORDER BY shortage_qty DESC`).all(...runIds) as Array<Record<string, unknown>>));
    suggestions.push(...(database.prepare(`SELECT * FROM parallel_suggestions WHERE ledger_id IN (${placeholders}) ORDER BY status`).all(...ledgerIds) as Array<Record<string, unknown>>));
  }
  const mergeConflicts = database.prepare(`SELECT c.* FROM parallel_merge_conflicts c JOIN parallel_merge_requests m ON m.id = c.merge_request_id WHERE m.ledger_id IN (${placeholders}) ORDER BY c.resolved_at`).all(...ledgerIds) as Array<Record<string, unknown>>;
  const mergeRequests = database.prepare(`SELECT * FROM parallel_merge_requests WHERE ledger_id IN (${placeholders}) ORDER BY submitted_at DESC`).all(...ledgerIds) as Array<Record<string, unknown>>;
  const mergeRequestIds = mergeRequests.map((r) => String(r.id));
  const mergeItems: Array<Record<string, unknown>> = mergeRequestIds.length === 0 ? [] : (database.prepare(`SELECT * FROM parallel_merge_items WHERE merge_request_id IN (${mergeRequestIds.map(() => "?").join(",")}) ORDER BY sequence_no`).all(...mergeRequestIds) as Array<Record<string, unknown>>);
  return { ledgers, adjustments, adjustmentLines, runs, costProjections, inventoryProjections, materialAllocations, impacts, gaps, suggestions, mergeConflicts, mergeRequests, mergeItems };
}
