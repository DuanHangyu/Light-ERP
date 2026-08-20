import type Database from "better-sqlite3";
import { audit, decideApproval, getUser, matchApprovalRule, now, serial, uid } from "./erp-service";
import { previewParallelMerge } from "./parallel-impact-service";

function assertLedger(database: Database.Database, ledgerId: string, actorId: string) {
  const ledger = database.prepare("SELECT * FROM parallel_ledgers WHERE id = ?").get(ledgerId) as
    | { id: string; ledger_code: string; status: string; working_version: number; base_revision: string | null; base_as_of: string }
    | undefined;
  if (!ledger) throw new Error("平行账套不存在。");
  const member = database.prepare("SELECT owner_user_id FROM parallel_ledgers WHERE id = ?").get(ledgerId) as { owner_user_id: string };
  if (member.owner_user_id !== actorId) {
    const ok = database.prepare("SELECT 1 FROM parallel_ledger_members WHERE ledger_id = ? AND user_id = ?").get(ledgerId, actorId);
    if (!ok) throw new Error("您不是该平行账套的成员，无权操作。");
  }
  return ledger;
}

function acceptedSuggestions(database: Database.Database, ledgerId: string) {
  return database
    .prepare("SELECT * FROM parallel_suggestions WHERE ledger_id = ? AND status = 'accepted' ORDER BY confirmed_at")
    .all(ledgerId) as Array<{ id: string; gap_id: string; suggestion_type: string; document_type: string; payload_json: string }>;
}

export function submitParallelMerge(database: Database.Database, actorId: string, ledgerId: string): { mergeRequestId: string } {
  const ledger = assertLedger(database, ledgerId, actorId);
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
  if (suggestions.length === 0) throw new Error("没有已接受的建议，无法生成纠错单据包。请先在「缺口与建议」中接受建议。");

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
    const isPurchase = suggestion.document_type === "purchase_requisition";
    insertItem.run(
      uid("PMI"),
      mergeRequestId,
      sequence++,
      suggestion.document_type,
      "parallel_suggestion",
      suggestion.id,
      isPurchase ? "new" : "advisory",
      JSON.stringify({ ...payload, suggestion_id: suggestion.id, gap_id: suggestion.gap_id }),
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
      `账套 ${ledger.ledger_code} 合并发布：${suggestions.length} 个纠错单据，预估金额 ${totalAmount}`,
      approvalRule?.id ?? null,
      approvalRule?.approver_role ?? "manager",
      approvalRule?.sla_hours ?? 24,
      mergeRequestId,
      submittedAt,
    );

  database.prepare("UPDATE parallel_ledgers SET status = 'merge_pending', updated_at = ? WHERE id = ?").run(submittedAt, ledgerId);
  audit(database, actorId, "parallelLedgerSubmitMerge", "parallel_merge", mergeRequestId, `提交合并 ${mergeNo}：${suggestions.length} 个纠错单据，审批 ${approvalNo}`);
  return { mergeRequestId };
}

function findApprovalForMerge(database: Database.Database, mergeRequestId: string) {
  const approval = database.prepare("SELECT * FROM approval_requests WHERE entity_type = 'parallel_merge' AND entity_id = ? ORDER BY created_at DESC LIMIT 1").get(mergeRequestId) as { id: string; status: string; request_no: string } | undefined;
  if (!approval) throw new Error("未找到该合并申请对应的审批单。");
  return approval;
}

export function approveParallelMerge(database: Database.Database, actorId: string, mergeRequestId: string, payload: Record<string, unknown>) {
  assertLedger(database, mergeRequestIdToLedgerId(database, mergeRequestId), actorId);
  const approval = findApprovalForMerge(database, mergeRequestId);
  if (approval.status !== "pending") throw new Error(`审批单状态为 ${approval.status}，不能重复审批。`);
  decideApproval(database, actorId, approval.id, "approved", payload);
  const decidedAt = now();
  database.prepare("UPDATE parallel_merge_requests SET approved_by = ?, approved_at = ?, status = 'approved' WHERE id = ?").run(actorId, decidedAt, mergeRequestId);
  audit(database, actorId, "parallelLedgerApproveMerge", "parallel_merge", mergeRequestId, `同意合并审批 ${approval.request_no}`);
}

export function rejectParallelMerge(database: Database.Database, actorId: string, mergeRequestId: string, payload: Record<string, unknown>) {
  const ledgerId = mergeRequestIdToLedgerId(database, mergeRequestId);
  assertLedger(database, ledgerId, actorId);
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

export function publishParallelMerge(database: Database.Database, actorId: string, mergeRequestId: string): { publishedCount: number; advisoryCount: number } {
  const user = getUser(database, actorId);
  void user;
  const ledgerId = mergeRequestIdToLedgerId(database, mergeRequestId);
  const ledger = assertLedger(database, ledgerId, actorId);
  const mergeRequest = database.prepare("SELECT * FROM parallel_merge_requests WHERE id = ?").get(mergeRequestId) as { id: string; status: string; idempotency_key: string } | undefined;
  if (!mergeRequest) throw new Error("合并申请不存在。");
  if (mergeRequest.status === "published") throw new Error("该合并已发布，不可重复发布。");
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
      } else {
        database.prepare("UPDATE parallel_merge_items SET publish_status = 'advisory', published_document_id = NULL WHERE id = ?").run(item.id);
        advisoryCount += 1;
      }
    }
    const publishedAt = now();
    database.prepare("UPDATE parallel_merge_requests SET status = 'published', published_by = ?, published_at = ? WHERE id = ?").run(actorId, publishedAt, mergeRequestId);
    database.prepare("UPDATE parallel_ledgers SET status = 'merged', merged_at = ?, updated_at = ? WHERE id = ?").run(publishedAt, publishedAt, ledgerId);
    audit(database, actorId, "parallelLedgerPublishMerge", "parallel_merge", mergeRequestId, `发布合并到正式账套：${publishedCount} 张正式单据，${advisoryCount} 项建议性记录`);
  });

  try {
    tx();
    return { publishedCount, advisoryCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    database.prepare("UPDATE parallel_merge_requests SET failure_reason = ? WHERE id = ?").run(`发布失败：${message}`, mergeRequestId);
    audit(database, actorId, "parallelLedgerPublishMergeFailed", "parallel_merge", mergeRequestId, `发布失败已回滚：${message}`);
    throw error;
  }
  void ledger;
}

export function listParallelMergeRequests(database: Database.Database, ledgerId: string) {
  return database.prepare("SELECT * FROM parallel_merge_requests WHERE ledger_id = ? ORDER BY submitted_at DESC").all(ledgerId) as Array<Record<string, unknown>>;
}

export function listParallelMergeItems(database: Database.Database, mergeRequestId: string) {
  return database.prepare("SELECT * FROM parallel_merge_items WHERE merge_request_id = ? ORDER BY sequence_no").all(mergeRequestId) as Array<Record<string, unknown>>;
}
