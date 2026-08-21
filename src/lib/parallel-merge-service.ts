import type Database from "better-sqlite3";
import { audit, decideApproval, getUser, matchApprovalRule, now, serial, uid } from "./erp-service";
import { roundMoney, roundQty } from "./domain";
import { previewParallelMerge } from "./parallel-impact-service";
import { requireParallelPermission } from "./parallel-ledger-service";

function assertLedger(database: Database.Database, ledgerId: string, actorId: string) {
  const ledger = database.prepare("SELECT * FROM parallel_ledgers WHERE id = ?").get(ledgerId) as
    | { id: string; ledger_code: string; status: string; working_version: number; base_revision: string | null; base_as_of: string; merge_allowed: number }
    | undefined;
  if (!ledger) throw new Error("平行账套不存在。");
  const member = database.prepare("SELECT owner_user_id FROM parallel_ledgers WHERE id = ?").get(ledgerId) as { owner_user_id: string };
  if (member.owner_user_id !== actorId) {
    const ok = database.prepare("SELECT 1 FROM parallel_ledger_members WHERE ledger_id = ? AND user_id = ?").get(ledgerId, actorId);
    if (!ok) throw new Error("您不是该平行账套的成员，无权操作。");
  }
  return ledger;
}

function adjustmentDocumentType(adjustmentType: string) {
  if (["bom_ratio", "material_substitute"].includes(adjustmentType)) return "bom_change";
  if (["inventory_qty", "batch_adjust"].includes(adjustmentType)) return "inventory_adjustment";
  if (["purchase_price", "purchase_qty"].includes(adjustmentType)) return "purchase_plan_adjustment";
  if (["issue_qty", "production_qty"].includes(adjustmentType)) return "production_adjustment";
  if (adjustmentType === "process_fee_loss") return "product_cost_adjustment";
  return "effective_date_adjustment";
}

function activeAdjustmentItems(database: Database.Database, ledgerId: string) {
  const adjustments = database
    .prepare("SELECT * FROM parallel_adjustments WHERE ledger_id = ? AND status = 'active' ORDER BY created_at, id")
    .all(ledgerId) as Array<Record<string, unknown>>;
  return adjustments.map((adjustment) => {
    const lines = database
      .prepare("SELECT * FROM parallel_adjustment_lines WHERE adjustment_id = ? ORDER BY id")
      .all(String(adjustment.id)) as Array<Record<string, unknown>>;
    return {
      id: String(adjustment.id),
      documentType: adjustmentDocumentType(String(adjustment.adjustment_type)),
      payload: { ...adjustment, lines },
    };
  });
}

function acceptedSuggestions(database: Database.Database, ledgerId: string) {
  return database
    .prepare("SELECT * FROM parallel_suggestions WHERE ledger_id = ? AND status = 'accepted' ORDER BY confirmed_at")
    .all(ledgerId) as Array<{ id: string; gap_id: string; suggestion_type: string; document_type: string; payload_json: string }>;
}

export function submitParallelMerge(database: Database.Database, actorId: string, ledgerId: string): { mergeRequestId: string } {
  const ledger = assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "submit_merge");
  if (!Number(ledger.merge_allowed)) throw new Error("该平行账套为仅测算方案，不允许合并到正式账套。");
  if (ledger.status !== "frozen") throw new Error("只有已冻结账套可以提交合并申请。请先冻结版本。");

  // 提交前必须重新测算，确保结果为最新
  const hasFreshRun = database
    .prepare("SELECT 1 FROM parallel_calculation_runs WHERE ledger_id = ? AND status = 'succeeded' AND stale = 0")
    .get(ledgerId);
  if (!hasFreshRun) throw new Error("账套无有效测算结果，请先重新测算后再提交合并。");

  // 冲突检查（阻断冲突必须先解决）
  const preview = previewParallelMerge(database, actorId, ledgerId);
  if (preview.blocking) throw new Error(`存在 ${preview.conflicts.length} 个阻断冲突，请先解决冲突或重新基线后再提交合并。`);

  const suggestions = acceptedSuggestions(database, ledgerId);
  const unresolvedGapCount = (database.prepare(`
    SELECT COUNT(*) AS count
    FROM parallel_gaps g
    JOIN parallel_calculation_runs r ON r.id = g.run_id
    WHERE r.ledger_id = ? AND r.stale = 0 AND g.blocking = 1
      AND g.resolution_status NOT IN ('suggested', 'resolved')
  `).get(ledgerId) as { count: number }).count;
  if (unresolvedGapCount > 0) throw new Error(`仍有 ${unresolvedGapCount} 个阻断缺口未确认处理，不能提交合并。`);
  const coveredAdjustmentIds = new Set(
    suggestions
      .map((suggestion) => JSON.parse(suggestion.payload_json) as Record<string, unknown>)
      .map((payload) => String(payload.source_adjustment_id ?? ""))
      .filter(Boolean),
  );
  const adjustmentItems = activeAdjustmentItems(database, ledgerId)
    .filter((adjustment) => !coveredAdjustmentIds.has(adjustment.id));
  if (suggestions.length === 0 && adjustmentItems.length === 0) throw new Error("当前账套没有可发布的调整或纠错建议。");

  const mergeRequestId = uid("PMR");
  const mergeNo = serial(database, "parallel_merge_requests", "PHB");
  const idempotencyKey = `pmr-${mergeRequestId}`;
  const submittedAt = now();
  const totalAmount = suggestions.reduce((sum, s) => {
    const payload = JSON.parse(s.payload_json) as { line_amount?: number };
    return sum + Number(payload.line_amount ?? 0);
  }, 0);

  database
    .prepare(
      "INSERT INTO parallel_merge_requests (id, merge_no, ledger_id, ledger_version, base_revision, target_revision, status, idempotency_key, submitted_by, submitted_at, approved_by, approved_at, published_by, published_at, failure_reason) VALUES (?, ?, ?, ?, ?, 'formal-current', 'merge_pending', ?, ?, ?, NULL, NULL, NULL, NULL, NULL)",
    )
    .run(mergeRequestId, mergeNo, ledgerId, ledger.working_version, ledger.base_revision ?? "formal", idempotencyKey, actorId, submittedAt);

  // 生成纠错单据包（merge_items）
  const insertItem = database.prepare(
    "INSERT INTO parallel_merge_items (id, merge_request_id, sequence_no, document_type, source_entity_type, source_entity_id, action_type, document_payload_json, publish_status, published_document_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL)",
  );
  let sequence = 1;
  for (const suggestion of suggestions) {
    const payload = JSON.parse(suggestion.payload_json) as Record<string, unknown>;
    insertItem.run(
      uid("PMI"),
      mergeRequestId,
      sequence++,
      suggestion.document_type,
      "parallel_suggestion",
      suggestion.id,
      "new",
      JSON.stringify({ ...payload, suggestion_id: suggestion.id, gap_id: suggestion.gap_id }),
    );
  }
  for (const adjustment of adjustmentItems) {
    insertItem.run(
      uid("PMI"),
      mergeRequestId,
      sequence++,
      adjustment.documentType,
      "parallel_adjustment",
      adjustment.id,
      "new",
      JSON.stringify(adjustment.payload),
    );
  }

  // 走审批流（复用 approval_requests + matchApprovalRule）
  const approvalId = uid("OA");
  const approvalNo = serial(database, "approval_requests", "SP");
  const approvalRule = matchApprovalRule(database, "parallel_ledger", totalAmount);
  database
    .prepare(
      "INSERT INTO approval_requests (id, request_no, type, title, applicant_id, status, amount, reason, rule_id, approver_role, sla_hours, entity_type, entity_id, created_at, decided_by, decided_at, decision_note) VALUES (?, ?, '平行账套合并', ?, ?, 'pending', ?, ?, ?, ?, ?, 'parallel_merge', ?, ?, NULL, NULL, NULL)",
    )
    .run(
      approvalId,
      approvalNo,
      `平行账套合并审批 ${mergeNo}`,
      actorId,
      totalAmount,
      `账套 ${ledger.ledger_code} 合并发布：${suggestions.length + adjustmentItems.length} 个纠错单据，预估金额 ${totalAmount}`,
      approvalRule?.id ?? null,
      approvalRule?.approver_role ?? "manager",
      approvalRule?.sla_hours ?? 24,
      mergeRequestId,
      submittedAt,
    );

  database.prepare("UPDATE parallel_ledgers SET status = 'merge_pending', updated_at = ? WHERE id = ?").run(submittedAt, ledgerId);
  audit(database, actorId, "parallelLedgerSubmitMerge", "parallel_merge", mergeRequestId, `提交合并 ${mergeNo}：${suggestions.length + adjustmentItems.length} 个纠错单据，审批 ${approvalNo}`);
  return { mergeRequestId };
}

function findApprovalForMerge(database: Database.Database, mergeRequestId: string) {
  const approval = database.prepare("SELECT * FROM approval_requests WHERE entity_type = 'parallel_merge' AND entity_id = ? ORDER BY created_at DESC LIMIT 1").get(mergeRequestId) as { id: string; status: string; request_no: string } | undefined;
  if (!approval) throw new Error("未找到该合并申请对应的审批单。");
  return approval;
}

export function approveParallelMerge(database: Database.Database, actorId: string, mergeRequestId: string, payload: Record<string, unknown>) {
  const ledgerId = mergeRequestIdToLedgerId(database, mergeRequestId);
  assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "approve_merge");
  const mergeRequest = database.prepare("SELECT submitted_by FROM parallel_merge_requests WHERE id = ?").get(mergeRequestId) as { submitted_by: string | null } | undefined;
  if (mergeRequest?.submitted_by === actorId) throw new Error("合并申请人不能审批自己的申请，请由另一名授权管理人员复核。");
  const approval = findApprovalForMerge(database, mergeRequestId);
  if (approval.status !== "pending") throw new Error(`审批单状态为 ${approval.status}，不能重复审批。`);
  decideApproval(database, actorId, approval.id, "approved", payload);
  const decidedAt = now();
  database.prepare("UPDATE parallel_merge_requests SET approved_by = ?, approved_at = ?, status = 'approved' WHERE id = ?").run(actorId, decidedAt, mergeRequestId);
  audit(database, actorId, "parallelLedgerApproveMerge", "parallel_merge", mergeRequestId, `同意合并审批 ${approval.request_no}`);
}

function publishFormalCorrectionOrder(
  database: Database.Database,
  actorId: string,
  ledgerId: string,
  mergeRequestId: string,
  item: MergeItem,
  payload: Record<string, unknown>,
) {
  const correctionId = uid("FCO");
  const correctionNo = serial(database, "formal_correction_orders", "JZ");
  const firstLine = Array.isArray(payload.lines) ? (payload.lines[0] as Record<string, unknown> | undefined) : undefined;
  const targetEntityType = String(firstLine?.entity_type ?? payload.reference_type ?? "");
  const targetEntityId = String(firstLine?.entity_id ?? payload.reference_id ?? "");
  database.prepare(`
    INSERT INTO formal_correction_orders (
      id, correction_no, correction_type, source_type, source_ledger_id,
      source_merge_request_id, source_merge_item_id, target_entity_type,
      target_entity_id, payload_json, status, created_by, created_at
    ) VALUES (?, ?, ?, 'parallel_merge', ?, ?, ?, ?, ?, ?, 'pending_execution', ?, ?)
  `).run(
    correctionId,
    correctionNo,
    item.document_type,
    ledgerId,
    mergeRequestId,
    item.id,
    targetEntityType,
    targetEntityId,
    JSON.stringify(payload),
    actorId,
    now(),
  );
  audit(database, actorId, "parallelMergePublishCorrection", "formal_correction_order", correctionId, `平行账套发布正式纠错单 ${correctionNo}：${item.document_type}`);
  return correctionId;
}

export function rejectParallelMerge(database: Database.Database, actorId: string, mergeRequestId: string, payload: Record<string, unknown>) {
  const ledgerId = mergeRequestIdToLedgerId(database, mergeRequestId);
  assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "approve_merge");
  const approval = findApprovalForMerge(database, mergeRequestId);
  if (approval.status !== "pending") throw new Error(`审批单状态为 ${approval.status}，不能重复处理。`);
  decideApproval(database, actorId, approval.id, "rejected", payload);
  const decidedAt = now();
  database.prepare("UPDATE parallel_merge_requests SET status = 'rejected', failure_reason = ? WHERE id = ?").run(String(payload.approval_note ?? "驳回"), mergeRequestId);
  database.prepare("UPDATE parallel_ledgers SET status = 'merge_rejected', updated_at = ? WHERE id = ?").run(decidedAt, ledgerId);
  audit(database, actorId, "parallelLedgerRejectMerge", "parallel_merge", mergeRequestId, `驳回合并审批 ${approval.request_no}`);
}

function mergeRequestIdToLedgerId(database: Database.Database, mergeRequestId: string): string {
  const row = database.prepare("SELECT ledger_id FROM parallel_merge_requests WHERE id = ?").get(mergeRequestId) as { ledger_id: string } | undefined;
  if (!row) throw new Error("合并申请不存在。");
  return row.ledger_id;
}

type MergeItem = {
  id: string;
  sequence_no: number;
  document_type: string;
  source_entity_id: string;
  action_type: string;
  document_payload_json: string;
  published_document_id: string | null;
};

function publishPurchaseRequisition(database: Database.Database, actorId: string, ledgerId: string, payload: Record<string, unknown>): string {
  const requisitionId = uid("PR");
  const requisitionNo = serial(database, "purchase_requisitions", "QS");
  const createdAt = now();
  const materialId = String(payload.material_id ?? "");
  const requestedQty = Number(payload.requested_qty ?? 0);
  const estimatedUnitCost = Number(payload.estimated_unit_cost ?? 0);
  const lineAmount = Number(payload.line_amount ?? requestedQty * estimatedUnitCost);
  database
    .prepare(
      "INSERT INTO purchase_requisitions (id, requisition_no, source_type, requested_by, approval_request_id, source_document_type, source_document_id, status, total_amount, required_date, reason, created_at, approved_by, approved_at, approval_note, converted_order_id, converted_at) VALUES (?, ?, 'parallel_merge', ?, NULL, 'parallel_ledger', ?, 'approved', ?, ?, ?, ?, ?, ?, '', NULL, NULL)",
    )
    .run(requisitionId, requisitionNo, actorId, ledgerId, lineAmount, createdAt.slice(0, 10), `由平行账套 ${ledgerId} 合并发布生成`, createdAt, actorId, createdAt);
  database
    .prepare("INSERT INTO purchase_requisition_lines (id, purchase_requisition_id, material_id, requested_qty, estimated_unit_cost, line_amount, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(uid("PRL"), requisitionId, materialId, requestedQty, estimatedUnitCost, lineAmount, "平行账套合并纠错");
  audit(database, actorId, "parallelMergePublishPurchaseRequisition", "purchase_requisition", requisitionId, `合并发布生成采购申请 ${requisitionNo}：${materialId} ${requestedQty}`);
  return requisitionId;
}

type PublishParallelMergeResult = {
  publishedCount: number;
  advisoryCount: number;
  completed: boolean;
  status: "execution_pending" | "merged";
  idempotent?: boolean;
};

function existingPublishResult(
  database: Database.Database,
  mergeRequestId: string,
  status: "execution_pending" | "merged",
): PublishParallelMergeResult {
  const publishedCount = (database.prepare(`
    SELECT COUNT(*) AS count
    FROM parallel_merge_items
    WHERE merge_request_id = ? AND publish_status IN ('published', 'executed')
  `).get(mergeRequestId) as { count: number }).count;
  return {
    publishedCount,
    advisoryCount: 0,
    completed: status === "merged",
    status,
    idempotent: true,
  };
}

function dependencyOrder(documentType: string): number {
  if (documentType === "bom_change") return 10;
  if (["purchase_requisition", "purchase_order_change"].includes(documentType)) return 20;
  if (["inventory_adjustment", "batch_adjustment"].includes(documentType)) return 30;
  if (["material_supplement", "material_return", "production_adjustment"].includes(documentType)) return 40;
  if (["production_cost_adjustment", "product_cost_adjustment"].includes(documentType)) return 50;
  return 90;
}

function writeProcurementReadiness(
  database: Database.Database,
  executionRunId: string,
  mergeRequestId: string,
  items: MergeItem[],
) {
  const requirements = items
    .filter((item) => item.document_type === "purchase_requisition")
    .map((item) => {
      const payload = JSON.parse(item.document_payload_json) as Record<string, unknown>;
      const evidence = payload.evidence && typeof payload.evidence === "object"
        ? payload.evidence as Record<string, unknown>
        : {};
      const materialId = String(payload.material_id ?? "");
      const material = database.prepare("SELECT name, stock_qty FROM materials WHERE id = ?").get(materialId) as
        | { name: string; stock_qty: number }
        | undefined;
      return {
        material_id: materialId,
        material_name: material?.name ?? materialId,
        required_qty: Number(evidence.required_qty ?? payload.requested_qty ?? 0),
        available_qty: Number(material?.stock_qty ?? 0),
        requested_qty: Number(payload.requested_qty ?? 0),
      };
    });
  const shortages = requirements.filter((item) => item.available_qty < item.required_qty);
  const checkedAt = now();
  const status = shortages.length > 0 ? "failed" : "passed";
  const message = shortages.length > 0
    ? shortages.map((item) => `${item.material_name || item.material_id} 尚缺 ${Math.max(0, item.required_qty - item.available_qty)}，需采购到货并完成入库后继续执行。`).join("；")
    : requirements.length > 0
      ? "采购相关物料库存已满足正式纠错执行条件。"
      : "本纠错包不包含采购到货前置条件。";
  database.prepare(`
    INSERT INTO reconciliation_results (
      id, execution_run_id, merge_request_id, rule_code, domain, status,
      blocking, expected_json, actual_json, delta_json, message, checked_at
    ) VALUES (?, ?, ?, 'inventory_procurement_readiness', 'inventory_purchase', ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(execution_run_id, rule_code) DO UPDATE SET
      status = excluded.status,
      expected_json = excluded.expected_json,
      actual_json = excluded.actual_json,
      delta_json = excluded.delta_json,
      message = excluded.message,
      checked_at = excluded.checked_at
  `).run(
    uid("RCR"),
    executionRunId,
    mergeRequestId,
    status,
    JSON.stringify(requirements.map((item) => ({ material_id: item.material_id, required_qty: item.required_qty }))),
    JSON.stringify(requirements.map((item) => ({ material_id: item.material_id, available_qty: item.available_qty }))),
    JSON.stringify(shortages.map((item) => ({ material_id: item.material_id, shortage_qty: Math.max(0, item.required_qty - item.available_qty) }))),
    message,
    checkedAt,
  );
  return { ready: shortages.length === 0, message };
}

type FormalCorrectionRow = {
  id: string;
  correction_no: string;
  correction_type: string;
  status: string;
  payload_json: string;
  resulting_document_type: string | null;
  resulting_document_id: string | null;
};

function correctionForItem(database: Database.Database, itemId: string): FormalCorrectionRow {
  const correction = database.prepare(`
    SELECT * FROM formal_correction_orders WHERE source_merge_item_id = ?
  `).get(itemId) as FormalCorrectionRow | undefined;
  if (!correction) throw new Error(`合并项 ${itemId} 缺少正式纠错单。`);
  return correction;
}

function finishCorrection(
  database: Database.Database,
  actorId: string,
  correctionId: string,
  resultType: string,
  resultId: string,
  note: string,
) {
  database.prepare(`
    UPDATE formal_correction_orders
    SET status = 'executed', executed_by = ?, executed_at = ?,
        resulting_document_type = ?, resulting_document_id = ?, execution_note = ?
    WHERE id = ?
  `).run(actorId, now(), resultType, resultId, note, correctionId);
}

function payloadEvidence(payload: Record<string, unknown>) {
  return payload.evidence && typeof payload.evidence === "object"
    ? payload.evidence as Record<string, unknown>
    : {};
}

function executeBomChange(
  database: Database.Database,
  actorId: string,
  mergeRequestId: string,
  correction: FormalCorrectionRow,
  payload: Record<string, unknown>,
) {
  const productId = String(payload.product_id ?? "");
  const productionOrderId = String(payload.production_order_id ?? "");
  const sourceMaterialId = String(payload.source_material_id ?? "");
  const targetMaterialId = String(payload.target_material_id ?? "");
  const evidence = payloadEvidence(payload);
  if (!productId || !productionOrderId || !sourceMaterialId || !targetMaterialId) {
    throw new Error("BOM 变更单缺少产品、工单或替换物料信息。");
  }
  const order = database.prepare(`
    SELECT o.qty
    FROM production_orders po
    JOIN orders o ON o.id = po.order_id
    WHERE po.id = ? AND o.product_id = ?
  `).get(productionOrderId, productId) as { qty: number } | undefined;
  if (!order || Number(order.qty) <= 0) throw new Error("BOM 变更单关联的工单或订单数量无效。");
  const activeBom = database.prepare(`
    SELECT * FROM boms
    WHERE product_id = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).get(productId) as { id: string; version: string } | undefined;
  if (!activeBom) throw new Error(`产品 ${productId} 没有可变更的生效 BOM。`);
  const oldLines = database.prepare(`
    SELECT parent_product_id, component_type, component_id, qty_per, is_primary
    FROM bom_lines WHERE bom_id = ? ORDER BY id
  `).all(activeBom.id) as Array<{
    parent_product_id: string;
    component_type: string;
    component_id: string;
    qty_per: number;
    is_primary: number;
  }>;
  const sourceRequiredAfter = Number(evidence.source_required_after ?? 0);
  const targetRequiredAfter = Number(evidence.target_required_after ?? 0);
  const sourceQtyPer = roundQty(sourceRequiredAfter / Number(order.qty));
  const targetQtyPer = roundQty(targetRequiredAfter / Number(order.qty));
  const nextBomId = uid("BOM");
  const nextVersion = `${activeBom.version}-PX-${correction.correction_no}`;
  const timestamp = now();

  database.prepare("UPDATE boms SET status = 'superseded', updated_at = ?, row_version = row_version + 1 WHERE id = ?")
    .run(timestamp, activeBom.id);
  database.prepare(`
    INSERT INTO boms (id, product_id, version, status, remark, created_at, updated_at, row_version)
    VALUES (?, ?, ?, 'active', ?, ?, ?, 0)
  `).run(nextBomId, productId, nextVersion, `平行账套合并 ${mergeRequestId} 生成`, timestamp, timestamp);
  const insertLine = database.prepare(`
    INSERT INTO bom_lines (
      bom_id, parent_product_id, component_type, component_id, qty_per, is_primary, row_version
    ) VALUES (?, ?, ?, ?, ?, ?, 0)
  `);
  let targetFound = false;
  for (const line of oldLines) {
    let qtyPer = Number(line.qty_per);
    if (line.component_type === "material" && line.component_id === sourceMaterialId) qtyPer = sourceQtyPer;
    if (line.component_type === "material" && line.component_id === targetMaterialId) {
      qtyPer = targetQtyPer;
      targetFound = true;
    }
    if (qtyPer <= 0) continue;
    insertLine.run(nextBomId, line.parent_product_id, line.component_type, line.component_id, qtyPer, line.is_primary);
  }
  if (!targetFound && targetQtyPer > 0) {
    insertLine.run(nextBomId, productId, "material", targetMaterialId, targetQtyPer, 0);
  }
  database.prepare(`
    UPDATE requisitions
    SET bom_id = ?, bom_version = ?, row_version = row_version + 1
    WHERE production_order_id = ?
  `).run(nextBomId, nextVersion, productionOrderId);
  finishCorrection(database, actorId, correction.id, "bom", nextBomId, `已生成并启用 BOM ${nextVersion}`);
  return { document_type: "bom", document_id: nextBomId, version: nextVersion };
}

function requisitionIdFromPayload(payload: Record<string, unknown>) {
  const requisitionIds = Array.isArray(payload.requisition_ids) ? payload.requisition_ids.map(String) : [];
  const requisitionId = requisitionIds[0] ?? "";
  if (!requisitionId) throw new Error("补退料单缺少关联领料单。需人工补充业务依据后再执行。");
  return requisitionId;
}

function executeMaterialReturn(
  database: Database.Database,
  actorId: string,
  mergeRequestId: string,
  correction: FormalCorrectionRow,
  payload: Record<string, unknown>,
) {
  const materialId = String(payload.material_id ?? payload.source_material_id ?? "");
  const qty = roundQty(Number(payload.suggested_qty ?? 0));
  const evidence = payloadEvidence(payload);
  const theoreticalQty = roundQty(Number(evidence.theoretical_required_qty ?? 0));
  const requisitionId = requisitionIdFromPayload(payload);
  if (!materialId || qty <= 0) throw new Error("退料单的物料或数量无效。");
  const material = database.prepare("SELECT stock_qty, average_cost FROM materials WHERE id = ?").get(materialId) as
    | { stock_qty: number; average_cost: number }
    | undefined;
  if (!material) throw new Error(`退料物料 ${materialId} 不存在。`);
  const line = database.prepare(`
    SELECT id, issued_qty FROM requisition_lines
    WHERE requisition_id = ? AND material_id = ?
  `).get(requisitionId, materialId) as { id: string; issued_qty: number } | undefined;
  if (!line || Number(line.issued_qty) < qty) throw new Error(`领料单中 ${materialId} 的已领数量不足以退回 ${qty}。`);
  const batch = database.prepare(`
    SELECT id, batch_no, qty FROM material_batches
    WHERE material_id = ? ORDER BY received_at, id LIMIT 1
  `).get(materialId) as { id: string; batch_no: string; qty: number } | undefined;
  const timestamp = now();
  const batchId = batch?.id ?? uid("MB");
  const batchNo = batch?.batch_no ?? `PX-RET-${mergeRequestId.slice(-8)}`;
  if (batch) {
    database.prepare("UPDATE material_batches SET qty = qty + ?, status = 'available', row_version = row_version + 1 WHERE id = ?")
      .run(qty, batch.id);
  } else {
    database.prepare(`
      INSERT INTO material_batches (
        id, material_id, batch_no, qty, unit_cost, received_at, status, row_version
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', 0)
    `).run(batchId, materialId, batchNo, qty, Number(material.average_cost), timestamp);
  }
  database.prepare("UPDATE materials SET stock_qty = stock_qty + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?")
    .run(qty, timestamp, materialId);
  database.prepare(`
    UPDATE requisition_lines
    SET required_qty = ?, issued_qty = ?, status = 'issued', row_version = row_version + 1
    WHERE id = ?
  `).run(theoreticalQty, roundQty(Number(line.issued_qty) - qty), line.id);
  const movementId = uid("IM");
  database.prepare(`
    INSERT INTO inventory_movements (
      id, item_type, item_id, batch_no, qty, unit_cost, movement_type,
      source_type, source_id, created_at
    ) VALUES (?, 'material', ?, ?, ?, ?, 'parallel_material_return', 'parallel_merge', ?, ?)
  `).run(movementId, materialId, batchNo, qty, Number(material.average_cost), mergeRequestId, timestamp);
  finishCorrection(database, actorId, correction.id, "inventory_movement", movementId, `已执行退料 ${materialId} ${qty}`);
  return { document_type: "inventory_movement", document_id: movementId, material_id: materialId, qty };
}

function executeMaterialSupplement(
  database: Database.Database,
  actorId: string,
  mergeRequestId: string,
  correction: FormalCorrectionRow,
  payload: Record<string, unknown>,
) {
  const materialId = String(payload.material_id ?? payload.target_material_id ?? "");
  const qty = roundQty(Number(payload.suggested_qty ?? 0));
  const evidence = payloadEvidence(payload);
  const theoreticalQty = roundQty(Number(evidence.theoretical_required_qty ?? qty));
  const requisitionId = requisitionIdFromPayload(payload);
  if (!materialId || qty <= 0) throw new Error("补料单的物料或数量无效。");
  const material = database.prepare("SELECT stock_qty, average_cost FROM materials WHERE id = ?").get(materialId) as
    | { stock_qty: number; average_cost: number }
    | undefined;
  if (!material || Number(material.stock_qty) < qty) throw new Error(`物料 ${materialId} 可用库存不足，无法补料 ${qty}。`);
  const batches = database.prepare(`
    SELECT id, batch_no, qty, unit_cost
    FROM material_batches
    WHERE material_id = ? AND qty > 0
    ORDER BY received_at, id
  `).all(materialId) as Array<{ id: string; batch_no: string; qty: number; unit_cost: number }>;
  if (roundQty(batches.reduce((sum, batch) => sum + Number(batch.qty), 0)) < qty) {
    throw new Error(`物料 ${materialId} 的可用批次数量不足，无法补料 ${qty}。`);
  }
  let remaining = qty;
  const movementIds: string[] = [];
  const timestamp = now();
  for (const batch of batches) {
    if (remaining <= 0) break;
    const issued = roundQty(Math.min(remaining, Number(batch.qty)));
    if (issued <= 0) continue;
    database.prepare(`
      UPDATE material_batches
      SET qty = qty - ?, status = CASE WHEN qty - ? <= 0 THEN 'depleted' ELSE status END,
          row_version = row_version + 1
      WHERE id = ?
    `).run(issued, issued, batch.id);
    const movementId = uid("IM");
    database.prepare(`
      INSERT INTO inventory_movements (
        id, item_type, item_id, batch_no, qty, unit_cost, movement_type,
        source_type, source_id, created_at
      ) VALUES (?, 'material', ?, ?, ?, ?, 'parallel_material_supplement', 'parallel_merge', ?, ?)
    `).run(movementId, materialId, batch.batch_no, -issued, Number(batch.unit_cost), mergeRequestId, timestamp);
    movementIds.push(movementId);
    remaining = roundQty(remaining - issued);
  }
  database.prepare("UPDATE materials SET stock_qty = stock_qty - ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?")
    .run(qty, timestamp, materialId);
  const line = database.prepare(`
    SELECT id, issued_qty FROM requisition_lines
    WHERE requisition_id = ? AND material_id = ?
  `).get(requisitionId, materialId) as { id: string; issued_qty: number } | undefined;
  if (line) {
    database.prepare(`
      UPDATE requisition_lines
      SET required_qty = ?, issued_qty = ?, status = 'issued', row_version = row_version + 1
      WHERE id = ?
    `).run(theoreticalQty, roundQty(Number(line.issued_qty) + qty), line.id);
  } else {
    database.prepare(`
      INSERT INTO requisition_lines (
        id, requisition_id, material_id, required_qty, issued_qty, is_primary, status, row_version
      ) VALUES (?, ?, ?, ?, ?, 0, 'issued', 0)
    `).run(uid("RL"), requisitionId, materialId, theoreticalQty, qty);
  }
  const resultId = movementIds[0] ?? correction.id;
  finishCorrection(database, actorId, correction.id, "inventory_movement", resultId, `已执行补料 ${materialId} ${qty}`);
  return { document_type: "inventory_movement", document_id: resultId, movement_ids: movementIds, material_id: materialId, qty };
}

function executeProductionCostAdjustment(
  database: Database.Database,
  actorId: string,
  mergeRequestId: string,
  correction: FormalCorrectionRow,
  payload: Record<string, unknown>,
) {
  const productionOrderId = String(payload.production_order_id ?? "");
  const previousTotalCost = roundMoney(Number(payload.before_total_cost ?? 0));
  const newTotalCost = roundMoney(Number(payload.after_total_cost ?? 0));
  const adjustmentAmount = roundMoney(Number(payload.delta_amount ?? newTotalCost - previousTotalCost));
  const production = database.prepare(`
    SELECT po.order_id, o.qty
    FROM production_orders po JOIN orders o ON o.id = po.order_id
    WHERE po.id = ?
  `).get(productionOrderId) as { order_id: string; qty: number } | undefined;
  if (!production || Number(production.qty) <= 0) throw new Error("成本调整单关联的生产工单无效。");
  const adjustmentId = uid("PCA");
  const adjustmentNo = serial(database, "production_cost_adjustments", "CBTZ");
  const timestamp = now();
  database.prepare(`
    INSERT INTO production_cost_adjustments (
      id, adjustment_no, production_order_id, order_id, cost_summary_id,
      exception_id, adjustment_amount, previous_total_cost, new_total_cost,
      previous_unit_cost, new_unit_cost, status, approval_request_id,
      adjustment_note, created_by, created_at, applied_by, applied_at,
      reversal_id, reversed_by, reversed_at, reversal_reason
    ) VALUES (?, ?, ?, ?, '', NULL, ?, ?, ?, ?, ?, 'applied', NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, '')
  `).run(
    adjustmentId,
    adjustmentNo,
    productionOrderId,
    production.order_id,
    adjustmentAmount,
    previousTotalCost,
    newTotalCost,
    roundMoney(previousTotalCost / Number(production.qty)),
    roundMoney(newTotalCost / Number(production.qty)),
    `平行账套合并 ${mergeRequestId} 成本纠错`,
    actorId,
    timestamp,
    actorId,
    timestamp,
  );
  database.prepare(`
    UPDATE production_cost_summaries
    SET material_cost = material_cost + ?, total_cost = ?, unit_cost = ?
    WHERE production_order_id = ?
  `).run(adjustmentAmount, newTotalCost, roundMoney(newTotalCost / Number(production.qty)), productionOrderId);
  finishCorrection(database, actorId, correction.id, "production_cost_adjustment", adjustmentId, `已执行成本调整 ${adjustmentNo}`);
  return { document_type: "production_cost_adjustment", document_id: adjustmentId, adjustment_amount: adjustmentAmount };
}

function executeMergeItem(
  database: Database.Database,
  actorId: string,
  mergeRequestId: string,
  item: MergeItem,
) {
  if (item.document_type === "purchase_requisition") {
    const purchase = database.prepare("SELECT id, status FROM purchase_requisitions WHERE id = ?").get(item.published_document_id) as
      | { id: string; status: string }
      | undefined;
    if (!purchase) throw new Error("采购申请正式单据不存在。");
    return { document_type: "purchase_requisition", document_id: purchase.id, status: purchase.status };
  }
  const correction = correctionForItem(database, item.id);
  if (correction.status === "executed" && correction.resulting_document_id) {
    return { document_type: correction.resulting_document_type, document_id: correction.resulting_document_id };
  }
  const payload = JSON.parse(item.document_payload_json) as Record<string, unknown>;
  if (item.document_type === "bom_change") return executeBomChange(database, actorId, mergeRequestId, correction, payload);
  if (item.document_type === "material_return") return executeMaterialReturn(database, actorId, mergeRequestId, correction, payload);
  if (item.document_type === "material_supplement") return executeMaterialSupplement(database, actorId, mergeRequestId, correction, payload);
  if (item.document_type === "production_cost_adjustment") return executeProductionCostAdjustment(database, actorId, mergeRequestId, correction, payload);
  throw new Error(`正式纠错单 ${correction.correction_no} 尚无领域执行器：${item.document_type}`);
}

function upsertReconciliation(
  database: Database.Database,
  executionRunId: string,
  mergeRequestId: string,
  input: {
    ruleCode: string;
    domain: string;
    passed: boolean;
    expected: unknown;
    actual: unknown;
    delta?: unknown;
    message: string;
  },
) {
  database.prepare(`
    INSERT INTO reconciliation_results (
      id, execution_run_id, merge_request_id, rule_code, domain, status,
      blocking, expected_json, actual_json, delta_json, message, checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(execution_run_id, rule_code) DO UPDATE SET
      status = excluded.status,
      expected_json = excluded.expected_json,
      actual_json = excluded.actual_json,
      delta_json = excluded.delta_json,
      message = excluded.message,
      checked_at = excluded.checked_at
  `).run(
    uid("RCR"),
    executionRunId,
    mergeRequestId,
    input.ruleCode,
    input.domain,
    input.passed ? "passed" : "failed",
    JSON.stringify(input.expected),
    JSON.stringify(input.actual),
    JSON.stringify(input.delta ?? {}),
    input.message,
    now(),
  );
  return input.passed;
}

function reconcileExecutedPackage(
  database: Database.Database,
  executionRunId: string,
  mergeRequestId: string,
  items: MergeItem[],
) {
  const results: boolean[] = [];
  const succeededSteps = (database.prepare(`
    SELECT COUNT(*) AS count FROM correction_execution_steps
    WHERE execution_run_id = ? AND status = 'succeeded'
  `).get(executionRunId) as { count: number }).count;
  results.push(upsertReconciliation(database, executionRunId, mergeRequestId, {
    ruleCode: "formal_documents_executed",
    domain: "execution",
    passed: succeededSteps === items.length,
    expected: { succeeded_steps: items.length },
    actual: { succeeded_steps: succeededSteps },
    message: succeededSteps === items.length ? "全部正式纠错单据已执行。" : "仍有正式纠错单据未执行。",
  }));

  const materialItemCount = items.filter((item) => ["material_return", "material_supplement"].includes(item.document_type)).length;
  const movementCount = (database.prepare(`
    SELECT COUNT(*) AS count FROM inventory_movements
    WHERE source_type = 'parallel_merge' AND source_id = ?
  `).get(mergeRequestId) as { count: number }).count;
  results.push(upsertReconciliation(database, executionRunId, mergeRequestId, {
    ruleCode: "material_movements_posted",
    domain: "inventory_production",
    passed: movementCount >= materialItemCount,
    expected: { minimum_movement_count: materialItemCount },
    actual: { movement_count: movementCount },
    message: movementCount >= materialItemCount ? "补退料库存流水已完整过账。" : "补退料库存流水不完整。",
  }));

  const bomItemCount = items.filter((item) => item.document_type === "bom_change").length;
  const activeBomCount = (database.prepare(`
    SELECT COUNT(*) AS count
    FROM formal_correction_orders f
    JOIN boms b ON b.id = f.resulting_document_id AND b.status = 'active'
    WHERE f.source_merge_request_id = ? AND f.correction_type = 'bom_change' AND f.status = 'executed'
  `).get(mergeRequestId) as { count: number }).count;
  results.push(upsertReconciliation(database, executionRunId, mergeRequestId, {
    ruleCode: "bom_basis_applied",
    domain: "bom",
    passed: activeBomCount === bomItemCount,
    expected: { active_bom_count: bomItemCount },
    actual: { active_bom_count: activeBomCount },
    message: activeBomCount === bomItemCount ? "正式 BOM 依据已生效。" : "正式 BOM 依据未完整生效。",
  }));

  const costItemCount = items.filter((item) => item.document_type === "production_cost_adjustment").length;
  const costCount = (database.prepare(`
    SELECT COUNT(*) AS count
    FROM formal_correction_orders f
    JOIN production_cost_adjustments c ON c.id = f.resulting_document_id AND c.status = 'applied'
    WHERE f.source_merge_request_id = ? AND f.correction_type = 'production_cost_adjustment'
  `).get(mergeRequestId) as { count: number }).count;
  results.push(upsertReconciliation(database, executionRunId, mergeRequestId, {
    ruleCode: "production_cost_posted",
    domain: "cost",
    passed: costCount === costItemCount,
    expected: { applied_cost_adjustment_count: costItemCount },
    actual: { applied_cost_adjustment_count: costCount },
    message: costCount === costItemCount ? "生产成本调整已入账。" : "生产成本调整未完整入账。",
  }));

  const purchaseItemCount = items.filter((item) => item.document_type === "purchase_requisition").length;
  const purchaseCount = (database.prepare(`
    SELECT COUNT(*) AS count
    FROM parallel_merge_items i
    JOIN purchase_requisitions p ON p.id = i.published_document_id
    WHERE i.merge_request_id = ? AND i.document_type = 'purchase_requisition'
  `).get(mergeRequestId) as { count: number }).count;
  results.push(upsertReconciliation(database, executionRunId, mergeRequestId, {
    ruleCode: "purchase_document_traceable",
    domain: "purchase",
    passed: purchaseCount === purchaseItemCount,
    expected: { purchase_document_count: purchaseItemCount },
    actual: { purchase_document_count: purchaseCount },
    message: purchaseCount === purchaseItemCount ? "采购申请已生成并可反查平行账套来源。" : "采购申请链路不完整。",
  }));
  return results.every(Boolean);
}

export function publishParallelMerge(database: Database.Database, actorId: string, mergeRequestId: string): PublishParallelMergeResult {
  const user = getUser(database, actorId);
  void user;
  const ledgerId = mergeRequestIdToLedgerId(database, mergeRequestId);
  const ledger = assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "publish_merge");
  const mergeRequest = database.prepare("SELECT * FROM parallel_merge_requests WHERE id = ?").get(mergeRequestId) as { id: string; status: string; idempotency_key: string } | undefined;
  if (!mergeRequest) throw new Error("合并申请不存在。");
  if (mergeRequest.status === "execution_pending") return existingPublishResult(database, mergeRequestId, "execution_pending");
  if (mergeRequest.status === "published") return existingPublishResult(database, mergeRequestId, "merged");
  if (mergeRequest.status !== "approved") throw new Error("合并申请尚未审批通过，不能发布。");

  // 发布前再次冲突检查
  const preview = previewParallelMerge(database, actorId, ledgerId);
  if (preview.blocking) {
    database.prepare("UPDATE parallel_ledgers SET status = 'conflicted', updated_at = ? WHERE id = ?").run(now(), ledgerId);
    database.prepare("UPDATE parallel_merge_requests SET failure_reason = ? WHERE id = ?").run(`发布前检测到 ${preview.conflicts.length} 个阻断冲突`, mergeRequestId);
    throw new Error(`发布前检测到 ${preview.conflicts.length} 个阻断冲突，已阻断发布。请解决冲突后重新提交。`);
  }

  const items = database.prepare("SELECT * FROM parallel_merge_items WHERE merge_request_id = ? ORDER BY sequence_no").all(mergeRequestId) as MergeItem[];
  let publishedCount = 0;
  let advisoryCount = 0;

  const tx = database.transaction(() => {
    for (const item of items) {
      const payload = JSON.parse(item.document_payload_json) as Record<string, unknown>;
      if (item.action_type === "new" && item.document_type === "purchase_requisition") {
        const docId = publishPurchaseRequisition(database, actorId, ledgerId, payload);
        database.prepare("UPDATE parallel_merge_items SET publish_status = 'published', published_document_id = ? WHERE id = ?").run(docId, item.id);
        publishedCount += 1;
      } else if (item.action_type === "new") {
        const docId = publishFormalCorrectionOrder(database, actorId, ledgerId, mergeRequestId, item, payload);
        database.prepare("UPDATE parallel_merge_items SET publish_status = 'published', published_document_id = ? WHERE id = ?").run(docId, item.id);
        publishedCount += 1;
      } else {
        throw new Error(`不支持的合并动作：${item.action_type}/${item.document_type}`);
      }
    }
    const startedAt = now();
    const executionRunId = uid("CER");
    database.prepare(`
      INSERT INTO correction_execution_runs (
        id, merge_request_id, idempotency_key, status, attempt_no,
        total_steps, succeeded_steps, waiting_steps, failed_steps,
        failure_reason, started_at, finished_at, created_by, updated_at
      ) VALUES (?, ?, ?, 'preparing', 1, ?, 0, ?, 0, '', ?, NULL, ?, ?)
    `).run(
      executionRunId,
      mergeRequestId,
      `${mergeRequest.idempotency_key}:execution`,
      items.length,
      items.length,
      startedAt,
      actorId,
      startedAt,
    );
    const insertStep = database.prepare(`
      INSERT INTO correction_execution_steps (
        id, execution_run_id, merge_item_id, document_type, dependency_order,
        idempotency_key, status, published_document_id, result_json,
        error_message, executed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', '', NULL, ?)
    `);
    for (const item of items) {
      const published = database.prepare("SELECT published_document_id FROM parallel_merge_items WHERE id = ?").get(item.id) as { published_document_id: string | null };
      insertStep.run(
        uid("CES"),
        executionRunId,
        item.id,
        item.document_type,
        dependencyOrder(item.document_type),
        `${mergeRequest.idempotency_key}:item:${item.id}`,
        item.document_type === "purchase_requisition" ? "waiting_external" : "pending_execution",
        published.published_document_id,
        startedAt,
      );
    }
    const readiness = writeProcurementReadiness(database, executionRunId, mergeRequestId, items);
    database.prepare(`
      UPDATE correction_execution_runs
      SET status = ?, failure_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(readiness.ready ? "pending_execution" : "waiting_external", readiness.ready ? "" : readiness.message, startedAt, executionRunId);
    database.prepare("UPDATE parallel_merge_requests SET status = 'execution_pending', published_by = ?, published_at = NULL, failure_reason = ? WHERE id = ?")
      .run(actorId, readiness.ready ? null : readiness.message, mergeRequestId);
    database.prepare("UPDATE parallel_ledgers SET status = 'publishing', merged_at = NULL, updated_at = ? WHERE id = ?").run(startedAt, ledgerId);
    audit(database, actorId, "parallelLedgerPublishMerge", "parallel_merge", mergeRequestId, `已生成 ${publishedCount} 张正式纠错单据，进入执行与对账；${readiness.message}`);
  });

  try {
    tx();
    return { publishedCount, advisoryCount, completed: false, status: "execution_pending" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    database.prepare("UPDATE parallel_merge_requests SET failure_reason = ? WHERE id = ?").run(`发布失败：${message}`, mergeRequestId);
    audit(database, actorId, "parallelLedgerPublishMergeFailed", "parallel_merge", mergeRequestId, `发布失败已回滚：${message}`);
    throw error;
  }
  void ledger;
}

export function resumeParallelMergeExecution(
  database: Database.Database,
  actorId: string,
  mergeRequestId: string,
): PublishParallelMergeResult {
  getUser(database, actorId);
  const ledgerId = mergeRequestIdToLedgerId(database, mergeRequestId);
  assertLedger(database, ledgerId, actorId);
  requireParallelPermission(database, actorId, ledgerId, "publish_merge");
  const mergeRequest = database.prepare(`
    SELECT id, status, idempotency_key FROM parallel_merge_requests WHERE id = ?
  `).get(mergeRequestId) as { id: string; status: string; idempotency_key: string } | undefined;
  if (!mergeRequest) throw new Error("合并申请不存在。");
  if (mergeRequest.status === "published") return existingPublishResult(database, mergeRequestId, "merged");
  if (!["execution_pending", "execution_failed"].includes(mergeRequest.status)) {
    throw new Error(`合并申请状态 ${mergeRequest.status} 不允许继续执行。`);
  }
  const executionRun = database.prepare(`
    SELECT id, status FROM correction_execution_runs WHERE merge_request_id = ?
  `).get(mergeRequestId) as { id: string; status: string } | undefined;
  if (!executionRun) throw new Error("未找到正式纠错执行批次，请先发布纠错包。");
  if (executionRun.status === "completed") return existingPublishResult(database, mergeRequestId, "merged");

  const items = database.prepare(`
    SELECT * FROM parallel_merge_items WHERE merge_request_id = ? ORDER BY sequence_no
  `).all(mergeRequestId) as MergeItem[];
  const publishedCount = items.filter((item) => Boolean(item.published_document_id)).length;
  const readiness = writeProcurementReadiness(database, executionRun.id, mergeRequestId, items);
  if (!readiness.ready) {
    const timestamp = now();
    database.prepare(`
      UPDATE correction_execution_runs
      SET status = 'waiting_external', failure_reason = ?, attempt_no = attempt_no + 1,
          updated_at = ? WHERE id = ?
    `).run(readiness.message, timestamp, executionRun.id);
    database.prepare("UPDATE parallel_merge_requests SET status = 'execution_pending', failure_reason = ? WHERE id = ?")
      .run(readiness.message, mergeRequestId);
    database.prepare("UPDATE parallel_ledgers SET status = 'publishing', updated_at = ? WHERE id = ?")
      .run(timestamp, ledgerId);
    audit(database, actorId, "parallelLedgerResumeMergeExecution", "parallel_merge", mergeRequestId, `正式纠错执行仍在等待：${readiness.message}`);
    return { publishedCount, advisoryCount: 0, completed: false, status: "execution_pending" };
  }

  const execute = database.transaction(() => {
    const startedAt = now();
    database.prepare(`
      UPDATE correction_execution_runs
      SET status = 'executing', attempt_no = attempt_no + 1, failure_reason = '',
          failed_steps = 0, updated_at = ? WHERE id = ?
    `).run(startedAt, executionRun.id);
    database.prepare("UPDATE parallel_ledgers SET status = 'publishing', updated_at = ? WHERE id = ?")
      .run(startedAt, ledgerId);

    const orderedItems = [...items].sort(
      (a, b) => dependencyOrder(a.document_type) - dependencyOrder(b.document_type) || a.sequence_no - b.sequence_no,
    );
    for (const item of orderedItems) {
      const step = database.prepare(`
        SELECT id, status FROM correction_execution_steps WHERE merge_item_id = ?
      `).get(item.id) as { id: string; status: string } | undefined;
      if (!step) throw new Error(`合并项 ${item.id} 缺少执行步骤。`);
      if (step.status === "succeeded") continue;
      database.prepare("UPDATE correction_execution_steps SET status = 'executing', error_message = '', updated_at = ? WHERE id = ?")
        .run(now(), step.id);
      const result = executeMergeItem(database, actorId, mergeRequestId, item);
      const executedAt = now();
      database.prepare(`
        UPDATE correction_execution_steps
        SET status = 'succeeded', result_json = ?, error_message = '',
            executed_at = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(result), executedAt, executedAt, step.id);
      database.prepare("UPDATE parallel_merge_items SET publish_status = 'executed' WHERE id = ?").run(item.id);
    }

    database.prepare("UPDATE correction_execution_runs SET status = 'reconciling', updated_at = ? WHERE id = ?")
      .run(now(), executionRun.id);
    if (!reconcileExecutedPackage(database, executionRun.id, mergeRequestId, items)) {
      throw new Error("正式纠错执行完成，但跨域对账未全部通过。");
    }
    const completedAt = now();
    database.prepare(`
      UPDATE correction_execution_runs
      SET status = 'completed', succeeded_steps = total_steps,
          waiting_steps = 0, failed_steps = 0, failure_reason = '',
          finished_at = ?, updated_at = ? WHERE id = ?
    `).run(completedAt, completedAt, executionRun.id);
    database.prepare(`
      UPDATE parallel_merge_requests
      SET status = 'published', published_by = ?, published_at = ?, failure_reason = NULL
      WHERE id = ?
    `).run(actorId, completedAt, mergeRequestId);
    database.prepare(`
      UPDATE parallel_ledgers
      SET status = 'merged', merged_at = ?, updated_at = ? WHERE id = ?
    `).run(completedAt, completedAt, ledgerId);
    audit(database, actorId, "parallelLedgerResumeMergeExecution", "parallel_merge", mergeRequestId, `正式纠错单据全部执行并通过对账，账套已合并：${items.length} 个步骤`);
  });

  try {
    execute();
    return { publishedCount: items.length, advisoryCount: 0, completed: true, status: "merged" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedAt = now();
    database.prepare(`
      UPDATE correction_execution_runs
      SET status = 'failed', failed_steps = 1, failure_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(message, failedAt, executionRun.id);
    database.prepare("UPDATE parallel_merge_requests SET status = 'execution_failed', failure_reason = ? WHERE id = ?")
      .run(message, mergeRequestId);
    database.prepare("UPDATE parallel_ledgers SET status = 'merge_failed', updated_at = ? WHERE id = ?")
      .run(failedAt, ledgerId);
    audit(database, actorId, "parallelLedgerResumeMergeExecutionFailed", "parallel_merge", mergeRequestId, `正式纠错执行失败并已回滚：${message}`);
    throw error;
  }
}

export function listParallelMergeRequests(database: Database.Database, ledgerId: string) {
  return database.prepare("SELECT * FROM parallel_merge_requests WHERE ledger_id = ? ORDER BY submitted_at DESC").all(ledgerId) as Array<Record<string, unknown>>;
}

export function listParallelMergeItems(database: Database.Database, mergeRequestId: string) {
  return database.prepare("SELECT * FROM parallel_merge_items WHERE merge_request_id = ? ORDER BY sequence_no").all(mergeRequestId) as Array<Record<string, unknown>>;
}
