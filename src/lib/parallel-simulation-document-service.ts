import type Database from "better-sqlite3";
import { audit, getUser, now, serial, uid } from "./erp-service";
import { requireParallelPermission } from "./parallel-ledger-service";

export type ParallelSimulationDocumentType =
  | "bom_change"
  | "purchase_requisition"
  | "purchase_order"
  | "purchase_arrival"
  | "purchase_receipt"
  | "material_return"
  | "material_supplement"
  | "production_cost_adjustment";

export type ParallelSimulationDocumentSpec = {
  generationKey: string;
  documentType: ParallelSimulationDocumentType;
  businessDate: string;
  sequenceNo: number;
  dependencyKeys?: string[];
  title: string;
  payload: Record<string, unknown>;
  requiredFields?: string[];
  blockingReason?: string;
  sourceAdjustmentId?: string | null;
  sourceSuggestionId?: string | null;
};

type SimulationDocumentRow = {
  id: string;
  ledger_id: string;
  run_id: string | null;
  generation_key: string;
  document_type: ParallelSimulationDocumentType;
  document_no: string;
  business_date: string;
  sequence_no: number;
  dependency_keys_json: string;
  status: string;
  title: string;
  payload_json: string;
  required_fields_json: string;
  missing_fields_json: string;
  blocking_reason: string;
  completed_by: string | null;
  completed_at: string | null;
};

const DOCUMENT_PREFIX: Record<ParallelSimulationDocumentType, string> = {
  bom_change: "BG",
  purchase_requisition: "QS",
  purchase_order: "CG",
  purchase_arrival: "DH",
  purchase_receipt: "RK",
  material_return: "TL",
  material_supplement: "BL",
  production_cost_adjustment: "CB",
};

const EDITABLE_FIELDS: Record<ParallelSimulationDocumentType, ReadonlySet<string>> = {
  bom_change: new Set(["effective_date", "version", "remark"]),
  purchase_requisition: new Set(["required_date", "reason"]),
  purchase_order: new Set(["supplier_id", "unit_price", "planned_arrival_date", "quantity", "remark"]),
  purchase_arrival: new Set(["arrival_date", "actual_qty", "vehicle_no", "remark"]),
  purchase_receipt: new Set(["receipt_date", "actual_qty", "batch_no", "warehouse_id", "unit_cost", "remark"]),
  material_return: new Set(["business_date", "batch_no", "quantity", "warehouse_id", "remark"]),
  material_supplement: new Set(["business_date", "batch_no", "quantity", "warehouse_id", "remark"]),
  production_cost_adjustment: new Set(["business_date", "adjustment_amount", "remark"]),
};

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isFilled(value: unknown) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return true;
}

function missingFields(payload: Record<string, unknown>, requiredFields: string[]) {
  return requiredFields.filter((field) => !isFilled(payload[field]));
}

function documentById(database: Database.Database, ledgerId: string, documentId: string) {
  const row = database
    .prepare("SELECT * FROM parallel_simulation_documents WHERE id = ? AND ledger_id = ? AND is_active = 1")
    .get(documentId, ledgerId) as SimulationDocumentRow | undefined;
  if (!row) throw new Error("平行账业务单据不存在。");
  return row;
}

function dependencyRows(database: Database.Database, ledgerId: string, row: SimulationDocumentRow) {
  const keys = parseStringArray(row.dependency_keys_json);
  if (keys.length === 0) return [];
  return database
    .prepare(`SELECT generation_key, document_no, status FROM parallel_simulation_documents WHERE ledger_id = ? AND generation_key IN (${keys.map(() => "?").join(",")}) AND is_active = 1`)
    .all(ledgerId, ...keys) as Array<{ generation_key: string; document_no: string; status: string }>;
}

function calculatedState(database: Database.Database, ledgerId: string, row: SimulationDocumentRow) {
  if (row.status === "completed" || row.status === "needs_review") {
    return { status: row.status, missing: parseStringArray(row.missing_fields_json), reason: row.blocking_reason };
  }
  const payload = parseJsonObject(row.payload_json);
  const required = parseStringArray(row.required_fields_json);
  const missing = missingFields(payload, required);
  if (missing.length > 0) {
    return { status: "waiting_input", missing, reason: `缺少必填信息：${missing.join("、")}` };
  }
  const dependencies = dependencyRows(database, ledgerId, row);
  const expectedDependencyCount = parseStringArray(row.dependency_keys_json).length;
  const unfinished = dependencies.filter((dependency) => dependency.status !== "completed");
  if (dependencies.length < expectedDependencyCount || unfinished.length > 0) {
    return {
      status: "waiting_dependency",
      missing,
      reason: unfinished.length > 0
        ? `等待上游单据：${unfinished.map((item) => item.document_no).join("、")}`
        : "等待上游单据生成",
    };
  }
  if (row.document_type === "material_supplement" && payload.inventory_sufficient === false) {
    return { status: "waiting_inventory", missing, reason: "模拟可用库存不足，请先完成采购入库并重新计算。" };
  }
  return { status: "ready", missing, reason: "" };
}

export function refreshParallelSimulationDocumentStates(database: Database.Database, ledgerId: string) {
  const rows = database
    .prepare("SELECT * FROM parallel_simulation_documents WHERE ledger_id = ? AND is_active = 1 ORDER BY sequence_no")
    .all(ledgerId) as SimulationDocumentRow[];
  for (const row of rows) {
    const state = calculatedState(database, ledgerId, row);
    database
      .prepare("UPDATE parallel_simulation_documents SET status = ?, missing_fields_json = ?, blocking_reason = ?, updated_at = ? WHERE id = ?")
      .run(state.status, JSON.stringify(state.missing), state.reason, now(), row.id);
  }
}

export function syncParallelSimulationDocuments(
  database: Database.Database,
  ledgerId: string,
  runId: string,
  specs: ParallelSimulationDocumentSpec[],
) {
  const timestamp = now();
  const activeKeys = new Set(specs.map((spec) => spec.generationKey));
  const existingRows = database
    .prepare("SELECT * FROM parallel_simulation_documents WHERE ledger_id = ?")
    .all(ledgerId) as SimulationDocumentRow[];
  const existingByKey = new Map(existingRows.map((row) => [row.generation_key, row]));

  for (const existing of existingRows) {
    if (activeKeys.has(existing.generation_key)) continue;
    if (existing.status === "completed") {
      database
        .prepare("UPDATE parallel_simulation_documents SET status = 'needs_review', blocking_reason = '重新计算后该业务条件已变化，请复核。', updated_at = ? WHERE id = ?")
        .run(timestamp, existing.id);
    } else {
      database.prepare("UPDATE parallel_simulation_documents SET is_active = 0, updated_at = ? WHERE id = ?").run(timestamp, existing.id);
    }
  }

  for (const spec of specs) {
    const existing = existingByKey.get(spec.generationKey);
    const existingPayload = existing ? parseJsonObject(existing.payload_json) : {};
    const payload = { ...spec.payload };
    if (existing) {
      for (const field of EDITABLE_FIELDS[spec.documentType]) {
        if (field in existingPayload) payload[field] = existingPayload[field];
      }
    }
    const requiredFields = spec.requiredFields ?? [];
    const missing = missingFields(payload, requiredFields);
    if (existing) {
      database.prepare(`
        UPDATE parallel_simulation_documents
        SET run_id = ?, business_date = ?, sequence_no = ?, dependency_keys_json = ?,
            title = ?, payload_json = ?, required_fields_json = ?, missing_fields_json = ?,
            blocking_reason = ?, source_adjustment_id = ?, source_suggestion_id = ?,
            is_active = 1, updated_at = ?
        WHERE id = ?
      `).run(
        runId,
        spec.businessDate,
        spec.sequenceNo,
        JSON.stringify(spec.dependencyKeys ?? []),
        spec.title,
        JSON.stringify(payload),
        JSON.stringify(requiredFields),
        JSON.stringify(missing),
        spec.blockingReason ?? "",
        spec.sourceAdjustmentId ?? null,
        spec.sourceSuggestionId ?? null,
        timestamp,
        existing.id,
      );
      continue;
    }
    database.prepare(`
      INSERT INTO parallel_simulation_documents (
        id, ledger_id, run_id, generation_key, document_type, document_no,
        business_date, sequence_no, dependency_keys_json, status, title,
        payload_json, required_fields_json, missing_fields_json, blocking_reason,
        source_adjustment_id, source_suggestion_id, generated_by_engine, is_active,
        completed_by, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, NULL, ?, ?)
    `).run(
      uid("PSD"),
      ledgerId,
      runId,
      spec.generationKey,
      spec.documentType,
      serial(database, "parallel_simulation_documents", DOCUMENT_PREFIX[spec.documentType]),
      spec.businessDate,
      spec.sequenceNo,
      JSON.stringify(spec.dependencyKeys ?? []),
      spec.title,
      JSON.stringify(payload),
      JSON.stringify(requiredFields),
      JSON.stringify(missing),
      spec.blockingReason ?? "",
      spec.sourceAdjustmentId ?? null,
      spec.sourceSuggestionId ?? null,
      timestamp,
      timestamp,
    );
  }
  refreshParallelSimulationDocumentStates(database, ledgerId);
}

export function updateParallelSimulationDocument(
  database: Database.Database,
  actorId: string,
  ledgerId: string,
  documentId: string,
  patch: Record<string, unknown>,
) {
  getUser(database, actorId);
  requireParallelPermission(database, actorId, ledgerId, "adjust");
  const row = documentById(database, ledgerId, documentId);
  if (row.status === "completed") throw new Error("已完成的平行业务单据不能直接修改。");
  const allowed = EDITABLE_FIELDS[row.document_type];
  const payload = parseJsonObject(row.payload_json);
  for (const [field, value] of Object.entries(patch)) {
    if (!allowed.has(field)) throw new Error(`字段 ${field} 不允许在该单据中修改。`);
    payload[field] = value;
  }
  database
    .prepare("UPDATE parallel_simulation_documents SET payload_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(payload), now(), documentId);
  refreshParallelSimulationDocumentStates(database, ledgerId);
  audit(database, actorId, "parallelLedgerUpdateSimulationDocument", "parallel_simulation_document", documentId, `完善平行账业务单据 ${row.document_no}`);
}

export function completeParallelSimulationDocument(
  database: Database.Database,
  actorId: string,
  ledgerId: string,
  documentId: string,
) {
  getUser(database, actorId);
  requireParallelPermission(database, actorId, ledgerId, "adjust");
  refreshParallelSimulationDocumentStates(database, ledgerId);
  const row = documentById(database, ledgerId, documentId);
  if (row.status === "completed") return { idempotent: true };
  if (row.status !== "ready") {
    throw new Error(row.blocking_reason || `单据当前状态 ${row.status}，不能完成。`);
  }
  const timestamp = now();
  database
    .prepare("UPDATE parallel_simulation_documents SET status = 'completed', completed_by = ?, completed_at = ?, blocking_reason = '', updated_at = ? WHERE id = ?")
    .run(actorId, timestamp, timestamp, documentId);
  refreshParallelSimulationDocumentStates(database, ledgerId);
  audit(database, actorId, "parallelLedgerCompleteSimulationDocument", "parallel_simulation_document", documentId, `完成平行账业务单据 ${row.document_no}`);
  return { idempotent: false };
}
