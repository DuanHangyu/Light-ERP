import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import AdmZip from "adm-zip";
import type Database from "better-sqlite3";
import { XMLParser } from "fast-xml-parser";
import {
  allocateFifo,
  calculateAgeDays,
  calculateAverageCostFromRemainingBatches,
  calculateBalance,
  calculateLedgerStatus,
  calculateMaterialNetRequirements,
  calculateMovingAverage,
  calculateSupplierPerformanceScore,
  calculateYieldRate,
  classifyInventoryAging,
  expandBom,
  qaAllowsInbound,
  roundMoney,
  roundQty,
  supplierAdmissionStatusFromScore,
  type BomLineInput,
  type QaResult,
} from "./domain";
import { getDb, resetDemoDatabase } from "./db";
import { ensureDataDirs, getDataPaths } from "./paths";
import { hashPassword, hashSessionToken, randomSessionToken, verifyPassword } from "./security";

export type Role =
  | "sales"
  | "assistant"
  | "production"
  | "warehouse"
  | "purchasing"
  | "quality"
  | "technical"
  | "manager"
  | "finance"
  | "admin";

export type UserRow = {
  id: string;
  username: string;
  name: string;
  role: Role;
  role_label: string;
  password?: string;
  password_hash?: string;
  status: "active" | "inactive";
  last_login_at?: string | null;
  password_changed_at?: string | null;
  title: string;
};

const allRoles: Role[] = [
  "sales",
  "assistant",
  "production",
  "warehouse",
  "purchasing",
  "quality",
  "technical",
  "manager",
  "finance",
  "admin",
];

type ActionInput = {
  actorId: string;
  action: string;
  entityId?: string;
  variant?: string;
  actualQty?: number;
  payload?: Record<string, unknown>;
};

type MasterDataType = "customers" | "suppliers" | "materials" | "products" | "boms";
type FormalReportExportType =
  | "business-daily"
  | "business-weekly"
  | "business-monthly"
  | "inventory-daily"
  | "inventory-overstock"
  | "sales-statement"
  | "purchase-statement"
  | "supplier-performance"
  | "supplier-discrepancy"
  | "material-adjustment-cost-impact"
  | "cost-anomaly-analysis"
  | "quality-exception";

export type ReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  supplierId?: string;
  materialId?: string;
  orderId?: string;
  purchaseOrderId?: string;
};

export type ImportValidationErrorRow = {
  rowNo: number;
  fieldName: string;
  message: string;
  rawData: Record<string, unknown>;
};

export type ImportValidationResult = {
  ok: boolean;
  importId: string;
  importNo: string;
  type: string;
  sourceName: string;
  status: "validated" | "validation_failed" | "completed";
  importedRows: number;
  validRows: number;
  failedRows: number;
  created: number;
  updated: number;
  totalAmount: number;
  errors: ImportValidationErrorRow[];
};

export class ImportValidationError extends Error {
  result: ImportValidationResult;

  constructor(result: ImportValidationResult) {
    super(`导入校验未通过：${result.failedRows} 行存在问题，请先修正错误行。`);
    this.name = "ImportValidationError";
    this.result = result;
  }
}

type Task = {
  id: string;
  title: string;
  detail: string;
  entityType: string;
  entityId?: string;
  action?: string;
  tone: "amber" | "green" | "blue" | "rose" | "neutral";
  primaryLabel?: string;
  secondaryAction?: string;
  secondaryLabel?: string;
  secondaryVariant?: string;
  payload?: Record<string, unknown>;
};

const roleActionMap: Record<string, Role[]> = {
  createQuote: ["sales", "admin"],
  confirmQuote: ["sales", "admin"],
  createOrder: ["sales", "admin"],
  createProductionInstruction: ["assistant", "admin"],
  createShipment: ["assistant"],
  scheduleAndGenerateRequisition: ["production", "admin"],
  updateProductionSchedule: ["production", "admin"],
  lockProductionPlan: ["production", "admin"],
  ackProductionPlanNotification: ["assistant", "warehouse", "quality", "production", "manager", "admin"],
  resolveProductionPlanChangeImpact: ["assistant", "warehouse", "purchasing", "quality", "production", "manager", "admin"],
  confirmMaterialAdjustmentSuggestion: ["production", "admin"],
  executeMaterialAdjustmentOrder: ["warehouse", "admin"],
  reviewMaterialAdjustmentOrder: ["warehouse", "admin"],
  resolveMaterialAdjustmentReviewException: ["production", "warehouse", "finance", "technical", "manager", "admin"],
  requestInspection: ["production"],
  approveMaterialRequisition: ["warehouse", "admin"],
  rejectMaterialRequisition: ["warehouse", "admin"],
  issueMaterials: ["warehouse", "admin"],
  receiveFinishedGoods: ["warehouse", "admin"],
  completeInspection: ["quality", "admin"],
  createProductionDailyReport: ["production", "admin"],
  createTechnicalDisposition: ["technical", "admin"],
  createPurchaseOrder: ["purchasing", "admin"],
  createPurchaseRequisition: ["production", "warehouse", "purchasing", "admin"],
  generateMrpRequirementRun: ["production", "warehouse", "purchasing", "admin"],
  createPurchaseRequisitionFromMrp: ["purchasing", "admin"],
  createPurchaseContract: ["purchasing", "admin"],
  createPurchaseArrivalNotice: ["purchasing", "warehouse", "admin"],
  registerPurchaseArrivalDiscrepancy: ["purchasing", "warehouse", "admin"],
  resolvePurchaseArrivalDiscrepancy: ["purchasing", "warehouse", "admin"],
  createSupplierCorrectiveAction: ["purchasing", "manager", "admin"],
  blacklistSupplier: ["manager", "admin"],
  submitSupplierCorrection: ["purchasing", "manager", "admin"],
  reviewSupplierCorrection: ["manager", "admin"],
  upsertSupplierCertificate: ["purchasing", "manager", "admin"],
  renewSupplierCertificate: ["purchasing", "manager", "admin"],
  recordSupplierAnnualReview: ["purchasing", "manager", "admin"],
  evaluateSupplierAdmissionRules: ["purchasing", "manager", "admin"],
  upsertSupplierAdmissionRule: ["admin"],
  submitSupplierAdmissionRuleChange: ["admin"],
  signPurchaseArrivalNotice: ["warehouse", "admin"],
  createPurchaseOrderFromRequisition: ["purchasing", "admin"],
  createMaterialIqcInspection: ["purchasing", "warehouse", "admin"],
  completeMaterialIqcInspection: ["quality", "admin"],
  receivePurchaseOrder: ["purchasing", "warehouse", "admin"],
  recordPayablePayment: ["purchasing", "finance", "admin"],
  recordReceivableReceipt: ["finance", "assistant", "admin"],
  purchaseInbound: ["admin", "purchasing"],
  submitApproval: ["sales", "assistant", "production", "warehouse", "purchasing", "quality", "technical", "finance", "admin"],
  approveApproval: ["manager", "warehouse", "finance", "purchasing", "admin"],
  rejectApproval: ["manager", "warehouse", "finance", "purchasing", "admin"],
  createFormulaCalculation: ["manager", "admin", "purchasing", "production"],
  upsertApprovalRule: ["admin"],
  deactivateApprovalRule: ["admin"],
  markAlertRead: ["sales", "assistant", "production", "warehouse", "purchasing", "quality", "technical", "manager", "finance", "admin"],
  dismissAlert: ["sales", "assistant", "production", "warehouse", "purchasing", "quality", "technical", "manager", "finance", "admin"],
  upsertAlertSubscription: ["admin"],
  upsertSystemSetting: ["admin"],
  createSystemHealthRemediation: ["manager", "admin"],
  markSystemHealthRemediationReady: ["sales", "assistant", "production", "warehouse", "purchasing", "quality", "technical", "manager", "finance", "admin"],
  rejectSystemHealthRemediationReview: ["manager", "admin"],
  closeSystemHealthRemediation: ["manager", "admin"],
  createCostAnomalyRemediation: ["manager", "finance", "admin"],
  markCostAnomalyRemediationReady: ["production", "warehouse", "technical", "finance", "manager", "admin"],
  rejectCostAnomalyRemediationReview: ["manager", "finance", "admin"],
  closeCostAnomalyRemediation: ["manager", "finance", "admin"],
  upsertCostAnomalyWarningRule: ["admin"],
  voidBusinessDocument: ["manager", "admin"],
  recordInventoryAgingDisposition: ["warehouse", "purchasing", "manager", "admin"],
  createStocktake: ["warehouse", "admin"],
  approveStocktake: ["manager", "admin"],
  rejectStocktake: ["manager", "admin"],
  upsertCustomer: ["admin", "sales", "assistant"],
  deactivateCustomer: ["admin", "sales", "assistant"],
  upsertSupplier: ["admin", "purchasing"],
  deactivateSupplier: ["admin", "purchasing"],
  upsertMaterial: ["admin", "purchasing", "warehouse"],
  deactivateMaterial: ["admin", "purchasing", "warehouse"],
  upsertProduct: ["admin", "production"],
  deactivateProduct: ["admin", "production"],
  createBomVersion: ["admin", "production"],
  deactivateBom: ["admin", "production"],
  changeOwnPassword: ["sales", "assistant", "production", "warehouse", "purchasing", "quality", "technical", "manager", "finance", "admin"],
  upsertUser: ["admin"],
  resetUserPassword: ["admin"],
  updateUserStatus: ["admin"],
  upsertRolePermission: ["admin"],
  resetDemo: ["admin"],
  reverseBusinessDocument: ["manager", "admin"],
  recordSalesReturn: ["assistant", "warehouse", "admin"],
  recordCustomerRefund: ["finance", "admin"],
  createReplacementShipment: ["assistant", "admin"],
};

const actionLabels: Record<string, string> = {
  createQuote: "新建报价",
  confirmQuote: "确认报价",
  createOrder: "转正式订单",
  createProductionInstruction: "下发生产指令",
  createShipment: "生成发货单",
  scheduleAndGenerateRequisition: "排产并生成领料",
  updateProductionSchedule: "调整生产排产",
  lockProductionPlan: "生产计划锁版",
  ackProductionPlanNotification: "确认计划变更通知",
  resolveProductionPlanChangeImpact: "处理计划变更影响",
  confirmMaterialAdjustmentSuggestion: "确认补退料建议",
  executeMaterialAdjustmentOrder: "执行补退料单",
  reviewMaterialAdjustmentOrder: "复核补退料成本",
  resolveMaterialAdjustmentReviewException: "关闭补退料复核异常",
  requestInspection: "生产请验",
  approveMaterialRequisition: "领料审批",
  rejectMaterialRequisition: "驳回领料",
  issueMaterials: "仓库发料",
  receiveFinishedGoods: "成品入库",
  completeInspection: "品控判定",
  createProductionDailyReport: "填报生产日报",
  createTechnicalDisposition: "技术处置意见",
  createPurchaseOrder: "录入采购单",
  createPurchaseRequisition: "录入采购申请",
  generateMrpRequirementRun: "MRP缺料测算",
  createPurchaseRequisitionFromMrp: "MRP转采购申请",
  createPurchaseContract: "采购合同下单",
  createPurchaseArrivalNotice: "到货通知",
  registerPurchaseArrivalDiscrepancy: "登记到货差异",
  resolvePurchaseArrivalDiscrepancy: "处理到货差异",
  createSupplierCorrectiveAction: "创建供应商整改",
  blacklistSupplier: "供应商拉黑",
  submitSupplierCorrection: "提交供应商整改",
  reviewSupplierCorrection: "供应商复评",
  upsertSupplierCertificate: "登记供应商资质",
  renewSupplierCertificate: "供应商资质续证",
  recordSupplierAnnualReview: "供应商年度复评",
  evaluateSupplierAdmissionRules: "评估供应商准入规则",
  upsertSupplierAdmissionRule: "配置供应商准入规则",
  submitSupplierAdmissionRuleChange: "提交供应商准入规则变更",
  signPurchaseArrivalNotice: "仓库签收",
  createPurchaseOrderFromRequisition: "采购申请转采购单",
  createMaterialIqcInspection: "到货请检",
  completeMaterialIqcInspection: "IQC判定",
  receivePurchaseOrder: "采购入库",
  recordPayablePayment: "登记付款",
  recordReceivableReceipt: "登记回款",
  submitApproval: "提交审批",
  approveApproval: "审批同意",
  rejectApproval: "审批驳回",
  createFormulaCalculation: "配方算价",
  upsertApprovalRule: "配置审批规则",
  deactivateApprovalRule: "停用审批规则",
  markAlertRead: "预警标为已读",
  dismissAlert: "忽略预警",
  upsertAlertSubscription: "配置预警订阅",
  upsertSystemSetting: "配置系统参数",
  createSystemHealthRemediation: "创建上线整改任务",
  markSystemHealthRemediationReady: "提交上线整改复核",
  rejectSystemHealthRemediationReview: "驳回上线整改复核",
  closeSystemHealthRemediation: "关闭上线整改任务",
  createCostAnomalyRemediation: "创建成本异常整改",
  markCostAnomalyRemediationReady: "提交成本异常整改复核",
  rejectCostAnomalyRemediationReview: "驳回成本异常整改复核",
  closeCostAnomalyRemediation: "关闭成本异常整改",
  upsertCostAnomalyWarningRule: "配置成本异常预警规则",
  voidBusinessDocument: "作废业务单据",
  recordInventoryAgingDisposition: "登记积压处置",
  createStocktake: "录入库存盘点",
  approveStocktake: "审批盘点调整",
  rejectStocktake: "驳回盘点调整",
  upsertCustomer: "维护客户主档",
  deactivateCustomer: "停用客户主档",
  upsertSupplier: "维护供应商主档",
  deactivateSupplier: "停用供应商主档",
  upsertMaterial: "维护物料主档",
  deactivateMaterial: "停用物料主档",
  upsertProduct: "维护产品主档",
  deactivateProduct: "停用产品主档",
  createBomVersion: "新建 BOM 版本",
  deactivateBom: "停用 BOM",
  changeOwnPassword: "修改本人密码",
  upsertUser: "维护用户账号",
  resetUserPassword: "重置用户密码",
  updateUserStatus: "启停用户",
  upsertRolePermission: "配置角色权限",
  resetDemo: "重置演示数据",
  reverseBusinessDocument: "冲销业务单据",
  recordSalesReturn: "登记销售退货",
  recordCustomerRefund: "登记客户退款",
  createReplacementShipment: "补开发货单",
};

function now() {
  return new Date().toISOString();
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function serial(database: Database.Database, table: string, prefix: string) {
  const dateKey = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const id = `${table}:${prefix}:${dateKey}`;
  const current = database.prepare("SELECT current_no FROM document_sequences WHERE id = ?").get(id) as
    | { current_no: number }
    | undefined;
  const nextNo = current
    ? Number(current.current_no) + 1
    : (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count + 1;
  const timestamp = now();
  if (current) {
    database
      .prepare("UPDATE document_sequences SET current_no = ?, updated_at = ? WHERE id = ?")
      .run(nextNo, timestamp, id);
  } else {
    database
      .prepare(`
        INSERT INTO document_sequences (id, doc_type, prefix, date_key, current_no, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(id, table, prefix, dateKey, nextNo, timestamp);
  }
  return `${prefix}-${dateKey}-${String(nextNo).padStart(3, "0")}`;
}

function getUser(database: Database.Database, actorId: string) {
  const user = database.prepare("SELECT * FROM users WHERE id = ?").get(actorId) as UserRow | undefined;
  if (!user) throw new Error("无效账号，请重新选择演示角色。");
  if (user.status === "inactive") throw new Error("账号已停用，请联系系统管理员。");
  return user;
}

function requireRole(database: Database.Database, actorId: string, allowed: Role[]) {
  const user = getUser(database, actorId);
  if (!allowed.includes(user.role)) {
    throw new Error(`${user.role_label} 无权执行该操作。`);
  }
  return user;
}

function ensureRolePermissionDefaults(database: Database.Database) {
  const timestamp = now();
  const upsert = database.prepare(`
    INSERT INTO role_permissions (
      id, role, action, action_label, module_label, risk_level,
      enabled, description, created_at, updated_by, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, NULL, ?)
    ON CONFLICT(role, action) DO UPDATE SET
      action_label = excluded.action_label,
      module_label = excluded.module_label,
      risk_level = excluded.risk_level
  `);

  Object.entries(roleActionMap).forEach(([action, defaultRoles]) => {
    allRoles.forEach((role) => {
      upsert.run(
        `${role}:${action}`,
        role,
        action,
        actionLabels[action] ?? action,
        actionModuleLabel(action),
        actionRiskLevel(action),
        defaultRoles.includes(role) ? 1 : 0,
        timestamp,
        timestamp,
      );
    });
  });
}

function roleHasPermission(database: Database.Database, role: Role, action: string) {
  ensureRolePermissionDefaults(database);
  const row = database
    .prepare("SELECT enabled FROM role_permissions WHERE role = ? AND action = ?")
    .get(role, action) as { enabled: number } | undefined;
  if (!row) return Boolean(roleActionMap[action]?.includes(role));
  return Number(row.enabled) > 0;
}

function requireActionPermission(database: Database.Database, actorId: string, action: string) {
  const user = getUser(database, actorId);
  if (!roleHasPermission(database, user.role, action)) {
    throw new Error(`${user.role_label} 无权执行该操作。`);
  }
  return user;
}

function audit(
  database: Database.Database,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  message: string,
) {
  database.prepare(`
    INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uid("A"), actorId, action, entityType, entityId, message, now());
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    role_label: user.role_label,
    status: user.status,
    title: user.title,
    last_login_at: user.last_login_at ?? null,
    password_changed_at: user.password_changed_at ?? null,
  };
}

export function authenticateUser(input: { account: string; password: string }) {
  const database = getDb();
  const account = input.account.trim();
  const user = database
    .prepare("SELECT * FROM users WHERE username = ? OR id = ?")
    .get(account, account) as UserRow | undefined;
  if (!user) throw new Error("账号或密码不正确。");
  if (user.status === "inactive") throw new Error("账号已停用，请联系系统管理员。");

  const ok = user.password_hash
    ? verifyPassword(input.password, user.password_hash)
    : input.password === user.password;
  if (!ok) throw new Error("账号或密码不正确。");

  const token = randomSessionToken();
  const createdAt = now();
  const expiresAt = addDays(createdAt.slice(0, 10), 1);
  database.prepare(`
    INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(uid("SES"), user.id, hashSessionToken(token), createdAt, `${expiresAt}T00:00:00.000Z`, createdAt);
  database.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(createdAt, user.id);
  audit(database, user.id, "login", "user", user.id, `用户登录 ${user.username}`);
  return { token, user: publicUser({ ...user, last_login_at: createdAt }) };
}

export function getSessionUser(token: string | undefined) {
  if (!token) return null;
  const database = getDb();
  const tokenHash = hashSessionToken(token);
  const row = database.prepare(`
    SELECT u.*
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
    LIMIT 1
  `).get(tokenHash, now()) as UserRow | undefined;
  if (!row || row.status === "inactive") return null;
  database.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?").run(now(), tokenHash);
  return row;
}

export function revokeSession(token: string | undefined) {
  if (!token) return;
  const database = getDb();
  database.prepare("UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(
    now(),
    hashSessionToken(token),
  );
}

function recalculateMaterialInventory(database: Database.Database, materialId: string, movementAt = now()) {
  const batches = database.prepare(`
    SELECT qty, unit_cost AS unitCost
    FROM material_batches
    WHERE material_id = ? AND qty > 0
  `).all(materialId) as Array<{ qty: number; unitCost: number }>;
  const next = calculateAverageCostFromRemainingBatches(batches);
  database.prepare("UPDATE materials SET stock_qty = ?, average_cost = ?, last_movement_at = ? WHERE id = ?").run(
    next.nextQty,
    next.nextAverageCost,
    movementAt,
    materialId,
  );
  return next;
}

function activeBomLines(database: Database.Database, productId = "P-FINISHED") {
  const rows = database.prepare(`
    SELECT bl.parent_product_id AS parentProductId,
           bl.component_type AS componentType,
           bl.component_id AS componentId,
           bl.qty_per AS qtyPer,
           bl.is_primary AS isPrimary
    FROM bom_lines bl
    JOIN boms b ON b.id = bl.bom_id
    WHERE b.product_id = ? AND b.status = 'active'
    ORDER BY bl.id
  `).all(productId) as Array<{
    parentProductId: string;
    componentType: "material" | "product";
    componentId: string;
    qtyPer: number;
    isPrimary: number;
  }>;

  return rows.map((row) => ({
    parentProductId: row.parentProductId,
    componentType: row.componentType,
    componentId: row.componentId,
    qtyPer: row.qtyPer,
    isPrimary: Boolean(row.isPrimary),
  })) satisfies BomLineInput[];
}

function quoteStatusLabel(status: string) {
  return (
    {
      draft: "待销售确认",
      confirmed: "客户已确认",
      converted: "已转订单",
      voided: "已作废",
    }[status] ?? status
  );
}

function orderStatusLabel(status: string) {
  return (
    {
      submitted: "待下发生产",
      in_production: "生产流转中",
      partial_shipped: "部分发货",
      shipped: "已发货",
      voided: "已作废",
      reversed: "已冲销",
    }[status] ?? status
  );
}

function purchaseOrderStatusLabel(status: string) {
  return (
    {
      pending_approval: "待审批",
      pending_receipt: "待入库",
      iqc_pending: "待 IQC",
      iqc_rejected: "IQC 未通过",
      received: "已入库",
      rejected: "已驳回",
      voided: "已作废",
      reversed: "已冲销",
    }[status] ?? status
  );
}

function materialIqcStatusLabel(status: string) {
  return (
    {
      pending: "待检",
      accepted: "已放行",
      rejected: "已退货",
    }[status] ?? status
  );
}

function materialIqcResultLabel(result: string) {
  return (
    {
      qualified: "合格",
      concession: "让步接收",
      special_accept: "特采接收",
      discount_accept: "降价接收",
      rejected_return: "不合格退货",
    }[result] ?? result
  );
}

function materialIqcResultValue(value: string) {
  if (["qualified", "concession", "special_accept", "discount_accept", "rejected_return"].includes(value)) return value;
  throw new Error("IQC 判定结果不正确。");
}

function materialIqcAllowsInbound(result: string) {
  return result !== "rejected_return";
}

function purchaseRequisitionStatusLabel(status: string) {
  return (
    {
      pending_approval: "待审批",
      approved: "已批准",
      rejected: "已驳回",
      converted: "已转采购单",
      voided: "已作废",
    }[status] ?? status
  );
}

function purchaseRequisitionSourceTypeLabel(sourceType: string) {
  return (
    {
      low_stock: "最低库存触发",
      bom_shortage: "BOM 缺料触发",
      manual: "人工申购",
    }[sourceType] ?? sourceType
  );
}

function purchaseRequisitionSourceTypeValue(value: string) {
  if (["low_stock", "bom_shortage", "manual"].includes(value)) return value;
  throw new Error("采购申请来源类型不正确。");
}

function purchaseContractStatusLabel(status: string) {
  return (
    {
      supplier_ordered: "已向供应商下单",
      confirmed: "供应商已确认",
      closed: "已关闭",
      voided: "已作废",
    }[status] ?? status
  );
}

function purchaseArrivalStatusLabel(status: string) {
  return (
    {
      pending_signoff: "待仓库签收",
      discrepancy_pending: "差异待审批",
      discrepancy_approved: "差异待处理",
      signed: "仓库已签收",
      iqc_created: "已请检",
      inbounded: "已入库",
      rejected: "已退货",
      voided: "已作废",
    }[status] ?? status
  );
}

function purchaseArrivalDiscrepancyStatusLabel(status: string) {
  return (
    {
      pending_approval: "差异待审批",
      approved: "差异已批准",
      rejected: "差异已驳回",
      resolved: "差异已处理",
      voided: "已作废",
    }[status] ?? status
  );
}

function purchaseArrivalDiscrepancyTypeLabel(type: string) {
  return (
    {
      quantity: "数量差异",
      price: "价格差异",
      batch: "批次差异",
      mixed: "复合差异",
    }[type] ?? type
  );
}

function purchaseArrivalHandlingDecisionLabel(value: string) {
  return (
    {
      supplier_replenish: "供应商补货",
      return_supplier: "退回供应商",
      price_adjustment: "价格调整",
      accept_as_is: "让步接收",
    }[value] ?? value
  );
}

function purchaseArrivalHandlingDecisionValue(value: string) {
  if (["supplier_replenish", "return_supplier", "price_adjustment", "accept_as_is"].includes(value)) return value;
  throw new Error("到货差异处理方式不正确。");
}

function mrpRequirementStatusLabel(status: string) {
  return (
    {
      draft: "待生成采购申请",
      covered: "库存与在途已覆盖",
      requisition_created: "已生成采购申请",
      voided: "已作废",
    }[status] ?? status
  );
}

function mrpLineStatusLabel(status: string) {
  return (
    {
      shortage: "需采购",
      covered: "已覆盖",
    }[status] ?? status
  );
}

function productionStatusLabel(status: string) {
  return (
    {
      instructed: "待排产",
      material_requested: "待发料",
      producing: "生产中",
      inspection_requested: "待品控",
      qa_approved: "待入库",
      qa_failed: "检验未通过",
      in_stock: "待发货",
      partial_shipped: "部分发货",
      shipped: "已发货",
      reversed: "已冲销",
    }[status] ?? status
  );
}

function productionPlanStatusLabel(status: string) {
  return (
    {
      pending_approval: "待审批发布",
      published: "已发布",
      rejected: "已驳回",
      superseded: "已被新版替代",
      voided: "已作废",
    }[status] ?? status
  );
}

function productionPlanNotificationStatusLabel(status: string) {
  return (
    {
      pending: "待确认",
      acknowledged: "已确认",
      voided: "已关闭",
    }[status] ?? status
  );
}

function productionPlanChangeImpactTypeLabel(type: string) {
  return (
    {
      material_requisition: "仓库领料影响",
      purchase_arrival: "采购到货影响",
      quality_window: "质检窗口影响",
      delivery_commitment: "交付承诺影响",
    }[type] ?? type
  );
}

function productionPlanChangeImpactStatusLabel(status: string) {
  return (
    {
      pending: "待处理",
      resolved: "已处理",
      voided: "已关闭",
    }[status] ?? status
  );
}

function productionPlanChangeImpactSeverityLabel(severity: string) {
  return (
    {
      low: "低",
      medium: "中",
      high: "高",
      critical: "紧急",
    }[severity] ?? severity
  );
}

function materialAdjustmentTypeLabel(type: string) {
  return (
    {
      supplement: "补料建议",
      return: "退料建议",
      check: "复核建议",
    }[type] ?? type
  );
}

function materialAdjustmentStatusLabel(status: string) {
  return (
    {
      pending_confirmation: "待确认",
      confirmed: "已确认",
      voided: "已关闭",
    }[status] ?? status
  );
}

function materialAdjustmentOrderStatusLabel(status: string) {
  return (
    {
      pending_execution: "待执行",
      executed: "已执行",
      voided: "已关闭",
    }[status] ?? status
  );
}

function materialAdjustmentReviewStatusLabel(status: string) {
  return (
    {
      not_started: "未执行",
      pending_review: "待复核",
      reviewed: "已复核",
    }[status] ?? status
  );
}

function materialAdjustmentReviewResultLabel(result: string) {
  return (
    {
      approved: "复核通过",
      exception: "复核异常",
    }[result] ?? result
  );
}

function materialAdjustmentExceptionStatusLabel(status: string) {
  return (
    {
      open: "待处理",
      closed: "已关闭",
    }[status] ?? status
  );
}

function materialAdjustmentExceptionReasonLabel(reason: string) {
  return (
    {
      cost_mismatch: "成本差异",
      batch_mismatch: "批次差异",
      qty_mismatch: "数量差异",
      document_mismatch: "单据差异",
      other: "其他异常",
    }[reason] ?? reason
  );
}

function materialAdjustmentExceptionResolutionLabel(type: string) {
  return (
    {
      cost_adjustment: "成本调整",
      no_adjustment: "无需调整",
      document_correction: "单据修正",
      process_correction: "流程整改",
      other: "其他处理",
    }[type] ?? type
  );
}

function productionCostAdjustmentStatusLabel(status: string) {
  return (
    {
      applied: "已入账",
      pending_approval: "待审批",
      pending_summary: "待成本归集",
      rejected: "已驳回",
      reversed: "已红冲",
    }[status] ?? status
  );
}

function costAnomalyRemediationStatusLabel(status: string) {
  return (
    {
      pending: "待整改",
      ready_for_review: "待复核",
      rejected: "复核驳回",
      closed: "已关闭",
    }[status] ?? status
  );
}

function costAnomalyRemediationDecisionLabel(decision: string) {
  return (
    {
      submitted: "提交复核",
      rejected: "复核驳回",
      approved: "复核通过",
    }[decision] ?? decision
  );
}

function costAnomalySeverityLabel(severity: string) {
  return (
    {
      low: "低",
      medium: "中",
      high: "高",
      critical: "重大",
    }[severity] ?? severity
  );
}

function costAnomalyWarningMetricLabel(metric: string) {
  return (
    {
      single_adjustment_amount: "单笔调整金额",
      material_anomaly_count: "同物料异常次数",
      work_order_reversal_count: "同工单红冲次数",
    }[metric] ?? metric
  );
}

function costAnomalyWarningEventStatusLabel(status: string) {
  return (
    {
      remediation_created: "已生成整改",
      skipped_existing: "已生成整改",
      recorded: "仅记录",
    }[status] ?? status
  );
}

function qualityInspectionWindowStatusLabel(status: string) {
  return (
    {
      confirmed: "已确认",
      rescheduled: "已调整",
      voided: "已关闭",
    }[status] ?? status
  );
}

function deliveryConfirmationStatusLabel(status: string) {
  return (
    {
      accepted: "客户接受",
      pending_customer: "待客户确认",
      rejected: "客户不接受",
    }[status] ?? status
  );
}

function productionDailyReportStatusLabel(status: string) {
  return (
    {
      submitted: "已提交",
      voided: "已作废",
    }[status] ?? status
  );
}

function technicalDispositionStatusLabel(status: string) {
  return (
    {
      issued: "已下发",
      reinspection_requested: "已转复检",
      reinspection_failed: "复检未通过",
      closed: "已关闭",
      voided: "已作废",
    }[status] ?? status
  );
}

function technicalDispositionTypeLabel(type: string) {
  return (
    {
      rework: "返工返修",
      scrap: "报废处理",
      concession_release: "技术让步放行",
      process_adjustment: "工艺调整复检",
    }[type] ?? type
  );
}

function priorityLabel(priority: string) {
  return (
    {
      normal: "普通",
      urgent: "加急",
      high: "高优先级",
    }[priority] ?? priority
  );
}

function inventoryDispositionStatusLabel(status: string) {
  return (
    {
      pending: "待处理",
      tracking: "跟进中",
      closed: "已关闭",
    }[status] ?? status
  );
}

function stocktakeStatusLabel(status: string) {
  return (
    {
      pending_approval: "待审批",
      approved: "已调整",
      rejected: "已驳回",
    }[status] ?? status
  );
}

function approvalRequestStatusLabel(status: string) {
  return (
    {
      pending: "待审批",
      approved: "已同意",
      rejected: "已驳回",
    }[status] ?? status
  );
}

function approvalSourceTypeLabel(sourceType: string) {
  return (
    {
      office_oa: "办公 OA",
      purchase_requisition: "采购申请",
      purchase_order: "采购订单",
      purchase_arrival_discrepancy: "采购到货差异",
      production_plan: "生产计划发布",
      production_cost_adjustment: "工单成本调整",
      supplier_admission_rule_change: "供应商准入规则变更",
      stocktake: "库存盘点",
      requisition: "领料单",
      formula_price: "配方算价",
    }[sourceType] ?? sourceType
  );
}

function approvalSourceTypeValue(value: string) {
  if (
    [
      "office_oa",
      "purchase_requisition",
      "purchase_order",
      "purchase_arrival_discrepancy",
      "production_plan",
      "production_cost_adjustment",
      "supplier_admission_rule_change",
      "stocktake",
      "requisition",
      "formula_price",
    ].includes(value)
  ) {
    return value;
  }
  throw new Error("审批来源类型不正确。");
}

function approvalRuleStatusLabel(status: string) {
  return (
    {
      active: "启用",
      inactive: "停用",
    }[status] ?? status
  );
}

function shipmentTypeLabel(type: string) {
  return (
    {
      standard: "正式发货单",
      replacement: "补开发货单",
    }[type] ?? type
  );
}

function salesReturnStatusLabel(status: string) {
  return (
    {
      returned: "已退货",
      closed: "已关闭",
    }[status] ?? status
  );
}

function refundStatusLabel(status: string) {
  return (
    {
      none: "无需退款",
      pending_refund: "待退款",
      partial_refunded: "部分退款",
      refunded: "已退款",
    }[status] ?? status
  );
}

function replacementStatusLabel(status: string) {
  return (
    {
      pending_replacement: "待补发",
      replaced: "已补发",
      not_required: "无需补发",
    }[status] ?? status
  );
}

type ApprovalRuleRow = {
  id: string;
  rule_code: string;
  rule_name: string;
  source_type: string;
  min_amount: number;
  max_amount: number | null;
  approver_role: Role;
  sla_hours: number;
  status: string;
  condition_scope: string;
  material_id: string | null;
  material_name?: string | null;
  adjustment_type: string;
  risk_level: string;
  allow_reversal: number;
  reversal_approver_role: Role;
  description: string;
  created_at: string;
  updated_at: string;
};

type ApprovalRuleMatchContext = {
  materialId?: string;
  adjustmentType?: string;
};

function approvalRuleConditionScopeLabel(scope: string) {
  return (
    {
      all: "全部",
      material: "指定物料",
      adjustment_type: "指定场景",
      material_and_adjustment_type: "物料+场景",
    }[scope] ?? scope
  );
}

function approvalRuleConditionSpecificity(rule: Pick<ApprovalRuleRow, "condition_scope">) {
  return (
    {
      material_and_adjustment_type: 3,
      material: 2,
      adjustment_type: 1,
      all: 0,
    }[rule.condition_scope || "all"] ?? 0
  );
}

function approvalRuleAdjustmentTypeLabel(type: string) {
  return (
    {
      supplement: "补料",
      return: "退料",
      check: "复核",
    }[type] ?? type
  );
}

function approvalRiskLevelLabel(level: string) {
  return (
    {
      low: "低风险",
      normal: "普通",
      medium: "中风险",
      high: "高风险",
      critical: "重大风险",
      低: "低风险",
      中: "中风险",
      高: "高风险",
    }[level] ?? level
  );
}

function approvalRuleConditionSummary(rule: ApprovalRuleRow) {
  if (rule.source_type !== "production_cost_adjustment") return approvalRuleConditionScopeLabel(rule.condition_scope || "all");
  const materialName = rule.material_name || rule.material_id || "指定物料";
  const adjustmentTypeLabel = rule.adjustment_type ? approvalRuleAdjustmentTypeLabel(rule.adjustment_type) : "指定场景";
  if (rule.condition_scope === "material_and_adjustment_type") return `${materialName} / ${adjustmentTypeLabel}`;
  if (rule.condition_scope === "material") return String(materialName);
  if (rule.condition_scope === "adjustment_type") return adjustmentTypeLabel;
  return "全部成本调整";
}

function approvalRuleMatchesContext(rule: ApprovalRuleRow, context?: ApprovalRuleMatchContext) {
  const scope = rule.condition_scope || "all";
  if (scope === "all") return true;
  if (scope === "material") return Boolean(context?.materialId) && rule.material_id === context?.materialId;
  if (scope === "adjustment_type") return Boolean(context?.adjustmentType) && rule.adjustment_type === context?.adjustmentType;
  if (scope === "material_and_adjustment_type") {
    return (
      Boolean(context?.materialId) &&
      Boolean(context?.adjustmentType) &&
      rule.material_id === context?.materialId &&
      rule.adjustment_type === context?.adjustmentType
    );
  }
  return false;
}

function approvalRuleView(rule: ApprovalRuleRow): Record<string, unknown> {
  const allowReversal = Number(rule.allow_reversal ?? 1) === 1;
  return {
    ...rule,
    source_type_label: approvalSourceTypeLabel(rule.source_type),
    approver_role_label: roleLabel(rule.approver_role),
    status_label: approvalRuleStatusLabel(rule.status),
    condition_scope_label: approvalRuleConditionScopeLabel(rule.condition_scope || "all"),
    adjustment_type_label: rule.adjustment_type ? approvalRuleAdjustmentTypeLabel(rule.adjustment_type) : "",
    risk_level_label: approvalRiskLevelLabel(rule.risk_level || "normal"),
    reversal_approver_role_label: roleLabel(rule.reversal_approver_role || "manager"),
    condition_summary: approvalRuleConditionSummary(rule),
    reversal_rule_summary: allowReversal
      ? `允许直接红冲，${roleLabel(rule.reversal_approver_role || "manager")}复核`
      : `禁止直接红冲，需${roleLabel(rule.reversal_approver_role || "manager")}复核`,
    amount_scope:
      rule.max_amount == null
        ? `${roundMoney(rule.min_amount)} 以上`
        : `${roundMoney(rule.min_amount)} - ${roundMoney(rule.max_amount)}`,
  };
}

function approvalRuleRows(database: Database.Database) {
  return (database.prepare(`
    SELECT ar.*, m.name AS material_name
    FROM approval_rules ar
    LEFT JOIN materials m ON m.id = ar.material_id
    ORDER BY ar.status ASC, ar.source_type ASC, ar.min_amount ASC, ar.max_amount ASC, ar.created_at ASC
  `).all() as ApprovalRuleRow[]).map(approvalRuleView);
}

function matchApprovalRule(database: Database.Database, sourceType: string, amount: number, context?: ApprovalRuleMatchContext) {
  const rules = database.prepare(`
    SELECT ar.*, m.name AS material_name
    FROM approval_rules ar
    LEFT JOIN materials m ON m.id = ar.material_id
    WHERE ar.status = 'active'
      AND ar.source_type = ?
      AND ar.min_amount <= ?
      AND (ar.max_amount IS NULL OR ar.max_amount >= ?)
  `).all(sourceType, amount, amount) as ApprovalRuleRow[];
  return rules
    .filter((rule) => approvalRuleMatchesContext(rule, context))
    .sort((a, b) => {
      const specificityDelta = approvalRuleConditionSpecificity(b) - approvalRuleConditionSpecificity(a);
      if (specificityDelta !== 0) return specificityDelta;
      const minDelta = Number(b.min_amount ?? 0) - Number(a.min_amount ?? 0);
      if (minDelta !== 0) return minDelta;
      const maxA = a.max_amount == null ? 999999999 : Number(a.max_amount);
      const maxB = b.max_amount == null ? 999999999 : Number(b.max_amount);
      if (maxA !== maxB) return maxA - maxB;
      return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    })[0];
}

function matchApprovalRuleFromRows(rules: Array<Record<string, unknown>>, sourceType: string, amount: number) {
  return rules
    .filter(
      (rule) =>
        rule.status === "active" &&
        rule.source_type === sourceType &&
        Number(rule.min_amount ?? 0) <= amount &&
        (rule.max_amount == null || rule.max_amount === "" || Number(rule.max_amount) >= amount),
    )
    .sort((a, b) => Number(b.min_amount ?? 0) - Number(a.min_amount ?? 0))[0];
}

type OperatingParameters = {
  staleWarningDays: number;
  overstockDays: number;
  yieldWarningRate: number;
  receivableDueWarningDays: number;
  payableDueWarningDays: number;
  purchaseApprovalThreshold: number;
};

type SystemSettingImpactItem = {
  key: string;
  label: string;
  current_count: number;
  preview_count: number;
  delta: number;
  affected_count: number;
  sample_entities: string[];
};

type SystemSettingImpactPreview = {
  setting_key: string;
  setting_label: string;
  category_label: string;
  current_value: string;
  preview_value: string;
  has_change: boolean;
  summary: {
    affected_count: number;
    current_total: number;
    preview_total: number;
    delta_total: number;
    risk_level: string;
  };
  items: SystemSettingImpactItem[];
  summary_text: string;
  generated_at: string;
};

function systemSettingNumber(database: Database.Database, settingKey: string, fallback: number) {
  const row = database.prepare("SELECT setting_value FROM system_settings WHERE setting_key = ?").get(settingKey) as
    | { setting_value?: string }
    | undefined;
  const value = Number(row?.setting_value ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function operatingParameterValues(database: Database.Database): OperatingParameters {
  const staleWarningDays = systemSettingNumber(database, "stale_warning_days", 90);
  const overstockDays = systemSettingNumber(database, "overstock_days", 180);
  return {
    staleWarningDays,
    overstockDays: overstockDays > staleWarningDays ? overstockDays : staleWarningDays + 1,
    yieldWarningRate: systemSettingNumber(database, "yield_warning_rate", 95),
    receivableDueWarningDays: systemSettingNumber(database, "receivable_due_warning_days", 7),
    payableDueWarningDays: systemSettingNumber(database, "payable_due_warning_days", 7),
    purchaseApprovalThreshold: systemSettingNumber(database, "purchase_approval_threshold", 5000),
  };
}

function operatingParametersWithOverride(
  current: OperatingParameters,
  settingKey: string,
  settingValue: string,
): OperatingParameters {
  const value = Number(settingValue);
  if (settingKey === "stale_warning_days") return { ...current, staleWarningDays: value };
  if (settingKey === "overstock_days") return { ...current, overstockDays: value };
  if (settingKey === "yield_warning_rate") return { ...current, yieldWarningRate: value };
  if (settingKey === "receivable_due_warning_days") return { ...current, receivableDueWarningDays: value };
  if (settingKey === "payable_due_warning_days") return { ...current, payableDueWarningDays: value };
  if (settingKey === "purchase_approval_threshold") return { ...current, purchaseApprovalThreshold: value };
  return current;
}

function symmetricDifferenceCount(currentIds: Set<string>, previewIds: Set<string>) {
  const allIds = new Set([...currentIds, ...previewIds]);
  let affected = 0;
  allIds.forEach((id) => {
    if (currentIds.has(id) !== previewIds.has(id)) affected += 1;
  });
  return affected;
}

function impactItem(input: {
  key: string;
  label: string;
  currentIds: Set<string>;
  previewIds: Set<string>;
  namesById: Map<string, string>;
}): SystemSettingImpactItem {
  const changedNames = [...new Set([...input.currentIds, ...input.previewIds])]
    .filter((id) => input.currentIds.has(id) !== input.previewIds.has(id))
    .map((id) => input.namesById.get(id) ?? id)
    .slice(0, 5);
  return {
    key: input.key,
    label: input.label,
    current_count: input.currentIds.size,
    preview_count: input.previewIds.size,
    delta: input.previewIds.size - input.currentIds.size,
    affected_count: symmetricDifferenceCount(input.currentIds, input.previewIds),
    sample_entities: changedNames,
  };
}

function inventoryImpactItems(
  database: Database.Database,
  currentParameters: OperatingParameters,
  previewParameters: OperatingParameters,
) {
  const rows = database.prepare(`
    SELECT id, name, last_movement_at, stock_qty
    FROM materials
    WHERE stock_qty > 0 AND last_movement_at IS NOT NULL
    ORDER BY id
  `).all() as Array<Record<string, unknown>>;
  const namesById = new Map(rows.map((row) => [String(row.id), String(row.name ?? row.id)]));
  const currentStale = new Set<string>();
  const previewStale = new Set<string>();
  const currentOverstock = new Set<string>();
  const previewOverstock = new Set<string>();

  rows.forEach((row) => {
    const current = classifyInventoryAging({
      lastMovementAt: String(row.last_movement_at ?? ""),
      staleWarningDays: currentParameters.staleWarningDays,
      overstockDays: currentParameters.overstockDays,
    }).status;
    const preview = classifyInventoryAging({
      lastMovementAt: String(row.last_movement_at ?? ""),
      staleWarningDays: previewParameters.staleWarningDays,
      overstockDays: previewParameters.overstockDays,
    }).status;
    const id = String(row.id);
    if (current === "stale_warning") currentStale.add(id);
    if (preview === "stale_warning") previewStale.add(id);
    if (current === "overstock") currentOverstock.add(id);
    if (preview === "overstock") previewOverstock.add(id);
  });

  return [
    impactItem({ key: "inventory_stale", label: "呆滞预警物料", currentIds: currentStale, previewIds: previewStale, namesById }),
    impactItem({ key: "inventory_overstock", label: "积压库存物料", currentIds: currentOverstock, previewIds: previewOverstock, namesById }),
  ];
}

function dueImpactItem(input: {
  key: string;
  label: string;
  rows: Array<Record<string, unknown>>;
  currentDays: number;
  previewDays: number;
  nameField: string;
}) {
  const namesById = new Map(input.rows.map((row) => [String(row.id), String(row[input.nameField] ?? row.id)]));
  const currentIds = new Set(
    input.rows.filter((row) => daysUntil(row.due_date) <= input.currentDays).map((row) => String(row.id)),
  );
  const previewIds = new Set(
    input.rows.filter((row) => daysUntil(row.due_date) <= input.previewDays).map((row) => String(row.id)),
  );
  return impactItem({ key: input.key, label: input.label, currentIds, previewIds, namesById });
}

function qualityYieldImpactItem(
  database: Database.Database,
  currentParameters: OperatingParameters,
  previewParameters: OperatingParameters,
) {
  const rows = database.prepare(`
    SELECT i.id, i.inspection_no, i.yield_rate, p.name AS product_name
    FROM inspections i
    JOIN production_orders po ON po.id = i.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN products p ON p.id = o.product_id
    WHERE i.yield_rate IS NOT NULL AND i.yield_rate > 0
    ORDER BY i.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  const namesById = new Map(rows.map((row) => [String(row.id), `${row.inspection_no ?? row.id} / ${row.product_name ?? ""}`]));
  const currentIds = new Set(
    rows.filter((row) => Number(row.yield_rate ?? 0) < currentParameters.yieldWarningRate).map((row) => String(row.id)),
  );
  const previewIds = new Set(
    rows.filter((row) => Number(row.yield_rate ?? 0) < previewParameters.yieldWarningRate).map((row) => String(row.id)),
  );
  return impactItem({ key: "quality_yield", label: "低收率预警批次", currentIds, previewIds, namesById });
}

function purchaseApprovalImpactItem(
  database: Database.Database,
  currentParameters: OperatingParameters,
  previewParameters: OperatingParameters,
) {
  const rows = database.prepare(`
    SELECT id, purchase_no, supplier_id, total_amount
    FROM purchase_orders
    WHERE status NOT IN ('voided', 'reversed')
    ORDER BY created_at DESC
  `).all() as Array<Record<string, unknown>>;
  const namesById = new Map(rows.map((row) => [String(row.id), String(row.purchase_no ?? row.id)]));
  const currentIds = new Set(
    rows.filter((row) => Number(row.total_amount ?? 0) >= currentParameters.purchaseApprovalThreshold).map((row) => String(row.id)),
  );
  const previewIds = new Set(
    rows.filter((row) => Number(row.total_amount ?? 0) >= previewParameters.purchaseApprovalThreshold).map((row) => String(row.id)),
  );
  return impactItem({ key: "purchase_approval", label: "达到采购审批阈值单据", currentIds, previewIds, namesById });
}

function buildSystemSettingImpactPreview(
  database: Database.Database,
  settingKey: string,
  rawSettingValue: string,
): SystemSettingImpactPreview {
  const setting = database.prepare("SELECT * FROM system_settings WHERE setting_key = ?").get(settingKey) as
    | { setting_key: string; setting_value: string; setting_label: string; category: string }
    | undefined;
  if (!setting) throw new Error("系统参数不存在。");
  const previewValue = systemSettingValue(database, settingKey, { setting_value: rawSettingValue });
  const currentParameters = operatingParameterValues(database);
  const previewParameters = operatingParametersWithOverride(currentParameters, settingKey, previewValue);
  const items: SystemSettingImpactItem[] = [];

  if (["stale_warning_days", "overstock_days"].includes(settingKey)) {
    items.push(...inventoryImpactItems(database, currentParameters, previewParameters));
  }
  if (settingKey === "receivable_due_warning_days") {
    const receivables = database.prepare(`
      SELECT id, receivable_no, due_date
      FROM receivables
      WHERE status != 'paid'
      ORDER BY due_date ASC
    `).all() as Array<Record<string, unknown>>;
    items.push(
      dueImpactItem({
        key: "receivable_due",
        label: "应收临期/逾期单据",
        rows: receivables,
        currentDays: currentParameters.receivableDueWarningDays,
        previewDays: previewParameters.receivableDueWarningDays,
        nameField: "receivable_no",
      }),
    );
  }
  if (settingKey === "payable_due_warning_days") {
    const payables = database.prepare(`
      SELECT id, payable_no, due_date
      FROM payables
      WHERE status != 'paid'
      ORDER BY due_date ASC
    `).all() as Array<Record<string, unknown>>;
    items.push(
      dueImpactItem({
        key: "payable_due",
        label: "应付临期/逾期单据",
        rows: payables,
        currentDays: currentParameters.payableDueWarningDays,
        previewDays: previewParameters.payableDueWarningDays,
        nameField: "payable_no",
      }),
    );
  }
  if (settingKey === "yield_warning_rate") {
    items.push(qualityYieldImpactItem(database, currentParameters, previewParameters));
  }
  if (settingKey === "purchase_approval_threshold") {
    items.push(purchaseApprovalImpactItem(database, currentParameters, previewParameters));
  }

  if (items.length === 0) {
    items.push({
      key: "no_direct_business_metric",
      label: "直接业务口径",
      current_count: 0,
      preview_count: 0,
      delta: 0,
      affected_count: 0,
      sample_entities: [],
    });
  }

  const affectedCount = items.reduce((sum, item) => sum + item.affected_count, 0);
  const currentTotal = items.reduce((sum, item) => sum + item.current_count, 0);
  const previewTotal = items.reduce((sum, item) => sum + item.preview_count, 0);
  const riskLevel = affectedCount >= 10 ? "high" : affectedCount > 0 ? "medium" : "low";
  const summaryText =
    affectedCount > 0
      ? `预计影响 ${affectedCount} 项业务结果，当前命中 ${currentTotal} 项，调整后命中 ${previewTotal} 项。`
      : "预计不会改变当前业务预警、报表或审批口径。";

  return {
    setting_key: setting.setting_key,
    setting_label: setting.setting_label,
    category_label: systemSettingCategoryLabel(setting.category),
    current_value: setting.setting_value,
    preview_value: previewValue,
    has_change: setting.setting_value !== previewValue,
    summary: {
      affected_count: affectedCount,
      current_total: currentTotal,
      preview_total: previewTotal,
      delta_total: previewTotal - currentTotal,
      risk_level: riskLevel,
    },
    items,
    summary_text: summaryText,
    generated_at: now(),
  };
}

export function previewSystemSettingImpact(input: {
  actorId: string;
  settingKey: string;
  settingValue: string;
}) {
  const database = getDb();
  requireRole(database, input.actorId, ["admin"]);
  return buildSystemSettingImpactPreview(database, input.settingKey, input.settingValue);
}

function approvalRiskLevel(sourceType: string, amount: number, operatingParameters?: OperatingParameters) {
  const purchaseThreshold = operatingParameters?.purchaseApprovalThreshold ?? 1000;
  if (
    sourceType === "stocktake" ||
    sourceType === "requisition" ||
    sourceType === "purchase_requisition" ||
    sourceType === "production_plan" ||
    sourceType === "supplier_admission_rule_change" ||
    (sourceType === "purchase_order" && amount >= purchaseThreshold) ||
    amount >= 1000
  )
    return "高";
  if (amount > 0) return "中";
  return "低";
}

function approvalCenterRows(input: {
  approvalRequests: Array<Record<string, unknown>>;
  purchaseRequisitions: Array<Record<string, unknown>>;
  stocktakes: Array<Record<string, unknown>>;
  requisitions: Array<Record<string, unknown>>;
  approvalRules: Array<Record<string, unknown>>;
  operatingParameters: OperatingParameters;
}) {
  const requestRows = input.approvalRequests
    .filter((approval) => approval.status === "pending" && approval.entity_type !== "purchase_requisition")
    .map((approval) => {
      const ageDays = calculateAgeDays({ fromDate: String(approval.created_at) });
      const amount = Number(approval.amount ?? 0);
      const isPurchase = approval.entity_type === "purchase_order";
      const isProductionPlan = approval.entity_type === "production_plan";
      const isSupplierRuleChange = approval.entity_type === "supplier_admission_rule_change";
      const isSupplierAnnualReview = approval.entity_type === "supplier_annual_review";
      const meetsPurchaseThreshold = !isPurchase || amount >= input.operatingParameters.purchaseApprovalThreshold;
      const slaHours = Number(approval.sla_hours ?? 48);
      return {
        id: `approval-${approval.id}`,
        source_type: "approval_request",
        source_type_label: isSupplierAnnualReview
          ? "供应商年度复评"
          : isProductionPlan
            ? "生产计划发布"
            : isSupplierRuleChange
              ? "供应商准入规则变更"
              : isPurchase
                ? "采购审批"
                : String(approval.type ?? "办公 OA"),
        module_label: isProductionPlan
          ? "生产执行"
          : isSupplierAnnualReview || isPurchase
            ? "采购仓储"
            : isSupplierRuleChange
              ? "系统管理"
              : "办公 OA",
        entity_id: approval.id,
        business_entity_type: approval.entity_type ?? "approval",
        business_entity_id: approval.entity_id ?? approval.id,
        request_no: approval.request_no,
        title: approval.title,
        applicant_name: approval.applicant_name,
        amount: roundMoney(amount),
        reason: approval.reason,
        created_at: approval.created_at,
        age_days: ageDays,
        rule_id: approval.rule_id ?? "",
        rule_name: approval.rule_name ?? "默认审批规则",
        purchase_approval_threshold: isPurchase ? input.operatingParameters.purchaseApprovalThreshold : null,
        threshold_status: isPurchase ? (meetsPurchaseThreshold ? "reached" : "below") : "",
        threshold_status_label: isPurchase ? (meetsPurchaseThreshold ? "达到审批阈值" : "低于审批阈值") : "",
        approver_role: approval.approver_role ?? "manager",
        approver_role_label: roleLabel(String(approval.approver_role ?? "manager")),
        sla_hours: slaHours,
        is_overdue: ageDays * 24 >= slaHours,
        risk_level:
          approval.risk_level ||
          approvalRiskLevel(
            isSupplierAnnualReview
              ? "supplier_annual_review"
              : isProductionPlan
                ? "production_plan"
                : isSupplierRuleChange
                  ? "supplier_admission_rule_change"
                  : isPurchase
                    ? "purchase_order"
                    : "approval_request",
            amount,
            input.operatingParameters,
          ),
        status: approval.status,
        status_label: approvalRequestStatusLabel(String(approval.status)),
        approve_action: "approveApproval",
        reject_action: "rejectApproval",
      };
    });

  const purchaseRequisitionRows = input.purchaseRequisitions
    .filter((requisition) => requisition.status === "pending_approval")
    .map((requisition) => {
      const ageDays = calculateAgeDays({ fromDate: String(requisition.created_at) });
      const amount = Number(requisition.total_amount ?? 0);
      const rule = matchApprovalRuleFromRows(input.approvalRules, "purchase_requisition", amount);
      const slaHours = Number(rule?.sla_hours ?? 24);
      return {
        id: `purchase-requisition-${requisition.id}`,
        source_type: "purchase_requisition",
        source_type_label: "采购申请",
        module_label: "采购仓储",
        entity_id: requisition.approval_request_id ?? requisition.id,
        business_entity_type: "purchase_requisition",
        business_entity_id: requisition.id,
        request_no: requisition.requisition_no,
        title: requisition.requisition_no,
        applicant_name: requisition.requested_by_name,
        amount: roundMoney(amount),
        reason: requisition.reason || `${requisition.source_type_label}，待管理层确认采购需求。`,
        created_at: requisition.created_at,
        age_days: ageDays,
        rule_id: rule?.id ?? "",
        rule_name: rule?.rule_name ?? "采购申请审批",
        approver_role: rule?.approver_role ?? "manager",
        approver_role_label: roleLabel(String(rule?.approver_role ?? "manager")),
        sla_hours: slaHours,
        is_overdue: ageDays * 24 >= slaHours,
        purchase_approval_threshold: input.operatingParameters.purchaseApprovalThreshold,
        threshold_status: amount >= input.operatingParameters.purchaseApprovalThreshold ? "reached" : "below",
        threshold_status_label: amount >= input.operatingParameters.purchaseApprovalThreshold ? "达到审批阈值" : "低于审批阈值",
        risk_level: approvalRiskLevel("purchase_requisition", amount, input.operatingParameters),
        status: "pending",
        status_label: "待审批",
        approve_action: "approveApproval",
        reject_action: "rejectApproval",
      };
    });

  const stocktakeRows = input.stocktakes
    .filter((stocktake) => stocktake.status === "pending_approval")
    .map((stocktake) => {
      const ageDays = calculateAgeDays({ fromDate: String(stocktake.created_at) });
      const amount = Math.abs(Number(stocktake.adjustment_amount ?? 0));
      const rule = matchApprovalRuleFromRows(input.approvalRules, "stocktake", amount);
      const slaHours = Number(rule?.sla_hours ?? 24);
      return {
        id: `stocktake-${stocktake.id}`,
        source_type: "stocktake",
        source_type_label: "库存盘点",
        module_label: "采购仓储",
        entity_id: stocktake.id,
        business_entity_type: "stocktake",
        business_entity_id: stocktake.id,
        request_no: stocktake.stocktake_no,
        title: stocktake.stocktake_no,
        applicant_name: stocktake.counted_by_name,
        amount: roundMoney(amount),
        reason: stocktake.remark || "库存盘点差异待管理层审批。",
        created_at: stocktake.created_at,
        age_days: ageDays,
        rule_id: rule?.id ?? "",
        rule_name: rule?.rule_name ?? "库存盘点差异审批",
        approver_role: rule?.approver_role ?? "manager",
        approver_role_label: roleLabel(String(rule?.approver_role ?? "manager")),
        sla_hours: slaHours,
        is_overdue: ageDays * 24 >= slaHours,
        risk_level: approvalRiskLevel("stocktake", Number(stocktake.adjustment_amount ?? 0)),
        status: "pending",
        status_label: "待审批",
        approve_action: "approveStocktake",
        reject_action: "rejectStocktake",
      };
    });

  const requisitionRows = input.requisitions
    .filter((requisition) => requisition.status === "pending_approval")
    .map((requisition) => {
      const ageDays = calculateAgeDays({ fromDate: String(requisition.created_at) });
      const rule = matchApprovalRuleFromRows(input.approvalRules, "requisition", 0);
      const slaHours = Number(rule?.sla_hours ?? 12);
      return {
        id: `requisition-${requisition.id}`,
        source_type: "requisition",
        source_type_label: "领料审批",
        module_label: "生产执行",
        entity_id: requisition.id,
        business_entity_type: "requisition",
        business_entity_id: requisition.id,
        request_no: requisition.req_no,
        title: requisition.req_no,
        applicant_name: requisition.owner ?? requisition.customer_name ?? "-",
        amount: 0,
        reason: requisition.requisition_note || "生产领料单待仓库复核 BOM、库存批次与替代料规则。",
        created_at: requisition.created_at,
        age_days: ageDays,
        rule_id: rule?.id ?? "",
        rule_name: rule?.rule_name ?? "领料单发料审批",
        approver_role: rule?.approver_role ?? "warehouse",
        approver_role_label: roleLabel(String(rule?.approver_role ?? "warehouse")),
        sla_hours: slaHours,
        is_overdue: ageDays * 24 >= slaHours,
        risk_level: approvalRiskLevel("requisition", 0),
        status: "pending",
        status_label: "待审批",
        approve_action: "approveMaterialRequisition",
        reject_action: "rejectMaterialRequisition",
      };
    });

  return [...purchaseRequisitionRows, ...stocktakeRows, ...requestRows, ...requisitionRows].sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
    return String(b.created_at).localeCompare(String(a.created_at));
  });
}

const alertSeverityRank: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function alertSeverityLabel(severity: string) {
  return (
    {
      critical: "紧急",
      high: "高",
      medium: "中",
      low: "低",
    }[severity] ?? severity
  );
}

const alertTypes = [
  "low_stock",
  "inventory_stale",
  "inventory_overstock",
  "approval_pending",
  "receivable_due",
  "payable_due",
  "quality_yield_warning",
  "mrp_shortage",
  "system_health_remediation_due",
  "cost_anomaly_warning",
] as const;
const alertMessageStatuses = ["unread", "read", "dismissed", "handled"] as const;

function alertTypeLabel(alertType: string) {
  return (
    {
      low_stock: "低库存预警",
      inventory_stale: "3个月未动库存",
      inventory_overstock: "6个月积压库存",
      approval_pending: "待审批",
      receivable_due: "应收到期",
      payable_due: "应付到期",
      quality_yield_warning: "收率预警",
      mrp_shortage: "MRP缺料建议",
      system_health_remediation_due: "上线整改到期",
      cost_anomaly_warning: "成本异常预警",
    }[alertType] ?? alertType
  );
}

function severityAllows(alertSeverity: unknown, minSeverity: unknown) {
  return (alertSeverityRank[String(alertSeverity)] ?? 9) <= (alertSeverityRank[String(minSeverity)] ?? alertSeverityRank.low);
}

function alertSubscriptionRows(database: Database.Database) {
  return database
    .prepare(
      `
        SELECT *
        FROM alert_subscriptions
        ORDER BY role ASC, alert_type ASC
      `,
    )
    .all()
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        ...item,
        role_label: roleLabel(String(item.role)),
        alert_type_label: alertTypeLabel(String(item.alert_type)),
        min_severity_label: alertSeverityLabel(String(item.min_severity)),
        task_routing_label: Number(item.route_to_tasks ?? 1) ? "进入待办" : "仅预警中心",
      };
    });
}

function alertMessageStateRows(database: Database.Database, actorId: string) {
  return database
    .prepare(
      `
        SELECT *
        FROM alert_message_states
        WHERE user_id = ?
        ORDER BY updated_at DESC
      `,
    )
    .all(actorId) as Array<Record<string, unknown>>;
}

function enrichAlertCenterRows(input: {
  rows: Array<Record<string, unknown>>;
  user: UserRow;
  subscriptions: Array<Record<string, unknown>>;
  messageStates: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  const subscriptionsByRoleAndType = new Map(input.subscriptions.map((item) => [`${item.role}:${item.alert_type}`, item]));
  const statesByAlertKey = new Map(input.messageStates.map((item) => [String(item.alert_key), item]));

  const enrichedRows: Array<Record<string, unknown>> = input.rows
    .filter((row) => {
      const subscription = subscriptionsByRoleAndType.get(`${input.user.role}:${row.alert_type}`);
      const fallbackVisible = input.user.role === "admin" || input.user.role === "manager" || row.owner_role === input.user.role;
      const enabled = subscription ? Number(subscription.enabled ?? 1) === 1 : fallbackVisible;
      const minSeverity = subscription?.min_severity ?? "low";
      return enabled && severityAllows(row.severity, minSeverity);
    })
    .map((row) => {
      const subscription = subscriptionsByRoleAndType.get(`${input.user.role}:${row.alert_type}`);
      const state = statesByAlertKey.get(String(row.id));
      const messageStatus = String(state?.status ?? "unread");
      return {
        ...row,
        subscription_enabled: subscription ? Number(subscription.enabled ?? 1) === 1 : true,
        subscription_min_severity: subscription?.min_severity ?? "low",
        message_status: messageStatus,
        status_label: alertMessageStatusLabel(messageStatus),
        is_unread: messageStatus === "unread",
        read_at: state?.read_at ?? null,
        dismissed_at: state?.dismissed_at ?? null,
        handled_at: state?.handled_at ?? null,
      };
    });

  return enrichedRows
    .filter((row) => row.message_status !== "dismissed")
    .sort((a, b) => {
      const severityDiff = Number(a.severity_rank) - Number(b.severity_rank);
      if (severityDiff !== 0) return severityDiff;
      return Number(a.is_unread === false) - Number(b.is_unread === false) || String(a.title).localeCompare(String(b.title));
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function alertMessageStatusLabel(status: string) {
  return (
    {
      unread: "未读",
      read: "已读",
      dismissed: "已忽略",
      handled: "已处理",
    }[status] ?? status
  );
}

function daysUntil(dateText: unknown) {
  const due = Date.parse(String(dateText ?? ""));
  if (Number.isNaN(due)) return 9999;
  return Math.ceil((due - Date.now()) / (1000 * 60 * 60 * 24));
}

function dateDiffDays(fromDate: unknown, toDate: unknown) {
  const from = Date.parse(String(fromDate ?? ""));
  const to = Date.parse(String(toDate ?? ""));
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.ceil((to - from) / (1000 * 60 * 60 * 24));
}

function productionDeliveryRisk(row: Record<string, unknown>) {
  const status = String(row.status ?? "");
  if (["shipped", "voided", "cancelled"].includes(status)) return { status: "normal", label: "正常" };
  const dueDays = daysUntil(row.due_date);
  const plannedDate = String(row.planned_date ?? "");
  if (!plannedDate && dueDays < 0) return { status: "overdue_unscheduled", label: "逾期未排产" };
  if (!plannedDate && dueDays <= 3) return { status: "due_soon_unscheduled", label: "临期未排产" };
  if (plannedDate && dateDiffDays(row.due_date, plannedDate) > 0) return { status: "delayed", label: "计划晚于交期" };
  if (plannedDate && dueDays <= 3 && ["material_requested", "producing", "inspection_requested", "qa_failed"].includes(status)) {
    return { status: "at_risk", label: "临期未完成" };
  }
  return { status: "normal", label: "正常" };
}

function productionDeliveryWarningRows(productions: Array<Record<string, unknown>>) {
  return productions
    .map((production) => {
      const risk = productionDeliveryRisk(production);
      if (risk.status === "normal") return null;
      const warningType =
        risk.status === "delayed"
          ? "scheduled_after_due"
          : risk.status === "overdue_unscheduled"
            ? "overdue_unscheduled"
            : risk.status === "due_soon_unscheduled"
              ? "due_soon_unscheduled"
              : "due_soon_unfinished";
      const warningLevel = risk.status === "overdue_unscheduled" ? "critical" : "high";
      return {
        id: `production-delivery-risk-${production.id}`,
        production_order_id: production.id,
        prod_no: production.prod_no,
        order_id: production.order_id,
        order_no: production.order_no,
        customer_name: production.customer_name,
        product_name: production.product_name,
        status: production.status,
        status_label: productionStatusLabel(String(production.status)),
        planned_date: production.planned_date ?? "",
        due_date: production.due_date,
        machine: production.machine ?? "",
        owner: production.owner ?? "",
        warning_type: warningType,
        warning_type_label: risk.label,
        warning_level: warningLevel,
        warning_level_label: alertSeverityLabel(warningLevel),
        delay_days: production.planned_date ? Math.max(dateDiffDays(production.due_date, production.planned_date), 0) : Math.max(-daysUntil(production.due_date), 0),
      } satisfies Record<string, unknown>;
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

function alertCenterRows(input: {
  materials: Array<Record<string, unknown>>;
  inventoryAging: Array<Record<string, unknown>>;
  approvalCenter: Array<Record<string, unknown>>;
  receivables: Array<Record<string, unknown>>;
  payables: Array<Record<string, unknown>>;
  inspections: Array<Record<string, unknown>>;
  productionDeliveryWarnings?: Array<Record<string, unknown>>;
  mrpRequirementRuns?: Array<Record<string, unknown>>;
  systemHealthRemediations?: Array<Record<string, unknown>>;
  costAnomalyWarningEvents?: Array<Record<string, unknown>>;
  operatingParameters: OperatingParameters;
}): Array<Record<string, unknown>> {
  const generatedAt = now();
  const rows: Array<Record<string, unknown>> = [];

  input.materials
    .filter((material) => Number(material.reorder_min_qty ?? 0) > 0 && Number(material.stock_qty ?? 0) <= Number(material.reorder_min_qty ?? 0))
    .forEach((material) => {
      const stockQty = Number(material.stock_qty ?? 0);
      const minQty = Number(material.reorder_min_qty ?? 0);
      rows.push({
        id: `alert-low-stock-${material.id}`,
        alert_type: "low_stock",
        alert_type_label: "低库存预警",
        severity: stockQty <= minQty * 0.5 ? "critical" : "high",
        module_label: "采购仓储",
        owner_role: "purchasing",
        owner_role_label: roleLabel("purchasing"),
        title: `${material.name} 低于安全库存`,
        detail: `当前库存 ${roundQty(stockQty)} ${material.unit ?? ""}，安全线 ${roundQty(minQty)} ${material.unit ?? ""}。`,
        entity_type: "material",
        entity_id: material.id,
        action: "createPurchaseRequisition",
        action_label: "创建采购申请",
        generated_at: generatedAt,
      });
    });

  input.inventoryAging.forEach((material) => {
    const isOverstock = material.aging_status === "overstock";
    const thresholdDays = isOverstock ? input.operatingParameters.overstockDays : input.operatingParameters.staleWarningDays;
    rows.push({
      id: `alert-aging-${material.id}`,
      alert_type: isOverstock ? "inventory_overstock" : "inventory_stale",
      alert_type_label: isOverstock ? "积压库存" : "呆滞预警",
      severity: isOverstock ? "critical" : "high",
      module_label: "采购仓储",
      owner_role: "warehouse",
      owner_role_label: roleLabel("warehouse"),
      title: `${material.name} ${isOverstock ? "已纳入积压报表" : "超过呆滞阈值未发生变动"}`,
      detail: `未动 ${material.inactive_days ?? 0} 天，阈值 ${thresholdDays} 天，库存价值 ${roundMoney(Number(material.stock_value ?? 0))}。`,
      entity_type: "material",
      entity_id: material.id,
      action: "recordInventoryAgingDisposition",
      action_label: "登记处置",
      generated_at: generatedAt,
    });
  });

  input.inspections
    .filter((inspection) => {
      const yieldRate = Number(inspection.yield_rate ?? 0);
      return yieldRate > 0 && yieldRate < input.operatingParameters.yieldWarningRate;
    })
    .forEach((inspection) => {
      const yieldRate = Number(inspection.yield_rate ?? 0);
      rows.push({
        id: `alert-yield-${inspection.id}`,
        alert_type: "quality_yield_warning",
        alert_type_label: "收率预警",
        severity: yieldRate <= input.operatingParameters.yieldWarningRate - 5 ? "critical" : "high",
        module_label: "质检收率",
        owner_role: "quality",
        owner_role_label: roleLabel("quality"),
        title: `${inspection.inspection_no ?? inspection.prod_no ?? "生产批次"} 收率低于预警线`,
        detail: `${inspection.product_name ?? "产品"} 收率 ${roundMoney(yieldRate)}%，预警线 ${input.operatingParameters.yieldWarningRate}%，生产单 ${inspection.prod_no ?? "-"}。`,
        entity_type: "inspection",
        entity_id: inspection.id,
        action: "",
        action_label: "复盘分析",
        generated_at: generatedAt,
      });
    });

  (input.productionDeliveryWarnings ?? []).forEach((warning) => {
    rows.push({
      id: `alert-production-delivery-${warning.production_order_id}`,
      alert_type: "production_delivery_risk",
      alert_type_label: "生产交期预警",
      severity: warning.warning_level ?? "high",
      module_label: "生产执行",
      owner_role: "production",
      owner_role_label: roleLabel("production"),
      title: `${warning.prod_no ?? "生产单"} ${warning.warning_type_label ?? "存在交期风险"}`,
      detail: `${warning.customer_name ?? "-"} / ${warning.product_name ?? "-"}，交期 ${warning.due_date ?? "-"}，计划 ${warning.planned_date || "未排产"}。`,
      entity_type: "production",
      entity_id: warning.production_order_id,
      planned_date: warning.planned_date,
      due_date: warning.due_date,
      machine: warning.machine,
      owner: warning.owner,
      action: "updateProductionSchedule",
      action_label: "调整排产",
      generated_at: generatedAt,
    });
  });

  input.approvalCenter.forEach((approval) => {
    rows.push({
      id: `alert-approval-${approval.id}`,
      alert_type: "approval_pending",
      alert_type_label: "待审批",
      severity: approval.is_overdue ? "high" : "medium",
      module_label: "审批算价",
      owner_role: approval.approver_role ?? "manager",
      owner_role_label: approval.approver_role_label ?? roleLabel("manager"),
      title: `待审批 ${approval.request_no ?? approval.title}`,
      detail: `${approval.title ?? "-"}，已等待 ${approval.age_days ?? 0} 天，规则 ${approval.rule_name ?? "默认审批规则"}。`,
      entity_type: approval.source_type,
      entity_id: approval.entity_id,
      action: approval.approve_action,
      action_label: "进入审批",
      generated_at: generatedAt,
    });
  });

  input.receivables
    .filter((receivable) => receivable.status !== "paid" && daysUntil(receivable.due_date) <= input.operatingParameters.receivableDueWarningDays)
    .forEach((receivable) => {
      const dueDays = daysUntil(receivable.due_date);
      rows.push({
        id: `alert-receivable-${receivable.id}`,
        alert_type: "receivable_due",
        alert_type_label: "应收到期",
        severity: dueDays < 0 ? "critical" : "high",
        module_label: "财务台账",
        owner_role: "finance",
        owner_role_label: roleLabel("finance"),
        title: `${receivable.customer_name} 应收待回款`,
        detail: `${receivable.receivable_no} 余额 ${roundMoney(Number(receivable.balance_amount ?? 0))}，到期日 ${receivable.due_date}，提醒窗口 ${input.operatingParameters.receivableDueWarningDays} 天。`,
        entity_type: "receivable",
        entity_id: receivable.id,
        balance_amount: receivable.balance_amount,
        action: "recordReceivableReceipt",
        action_label: "登记回款",
        generated_at: generatedAt,
      });
    });

  input.payables
    .filter((payable) => payable.status !== "paid" && daysUntil(payable.due_date) <= input.operatingParameters.payableDueWarningDays)
    .forEach((payable) => {
      const dueDays = daysUntil(payable.due_date);
      rows.push({
        id: `alert-payable-${payable.id}`,
        alert_type: "payable_due",
        alert_type_label: "应付到期",
        severity: dueDays < 0 ? "critical" : "high",
        module_label: "财务台账",
        owner_role: "finance",
        owner_role_label: roleLabel("finance"),
        title: `${payable.supplier_name} 应付待付款`,
        detail: `${payable.payable_no} 余额 ${roundMoney(Number(payable.balance_amount ?? 0))}，到期日 ${payable.due_date}，提醒窗口 ${input.operatingParameters.payableDueWarningDays} 天。`,
        entity_type: "payable",
        entity_id: payable.id,
        balance_amount: payable.balance_amount,
        action: "recordPayablePayment",
        action_label: "登记付款",
        generated_at: generatedAt,
      });
    });

  (input.mrpRequirementRuns ?? [])
    .filter((run) => String(run.status) === "draft" && Number(run.shortage_line_count ?? 0) > 0)
    .forEach((run) => {
      rows.push({
        id: `alert-mrp-${run.id}`,
        alert_type: "mrp_shortage",
        alert_type_label: "MRP缺料建议",
        severity: Number(run.total_shortage_amount ?? 0) >= input.operatingParameters.purchaseApprovalThreshold ? "high" : "medium",
        module_label: "采购仓储",
        owner_role: "purchasing",
        owner_role_label: roleLabel("purchasing"),
        title: `${run.run_no} 存在 ${run.shortage_line_count} 项缺料建议`,
        detail: `建议采购金额 ${roundMoney(Number(run.total_shortage_amount ?? 0))}，覆盖范围 ${run.source_type_label ?? run.source_type ?? "生产需求"}。`,
        entity_type: "mrp_requirement_run",
        entity_id: run.id,
        balance_amount: run.total_shortage_amount,
        action: "createPurchaseRequisitionFromMrp",
        action_label: "生成采购申请",
        generated_at: generatedAt,
      });
    });

  (input.systemHealthRemediations ?? [])
    .filter((remediation) => String(remediation.status) !== "closed" && daysUntil(remediation.due_date) <= 2)
    .forEach((remediation) => {
      const dueDays = daysUntil(remediation.due_date);
      rows.push({
        id: `alert-remediation-${remediation.id}`,
        alert_type: "system_health_remediation_due",
        alert_type_label: "上线整改到期",
        severity: dueDays < 0 ? "critical" : "high",
        module_label: "系统管理",
        owner_role: remediation.owner_role ?? "admin",
        owner_role_label: remediation.owner_role_label ?? roleLabel(String(remediation.owner_role ?? "admin")),
        title: `${remediation.remediation_no ?? "整改任务"} ${dueDays < 0 ? "已逾期" : "即将到期"}`,
        detail: `${remediation.title ?? "-"}，责任人 ${remediation.owner_name ?? "-"}，到期日 ${remediation.due_date ?? "-"}。`,
        entity_type: "system_health_remediation",
        entity_id: remediation.id,
        due_date: remediation.due_date,
        due_days: dueDays,
        action: String(remediation.status) === "ready_for_review" ? "closeSystemHealthRemediation" : "markSystemHealthRemediationReady",
        action_label: String(remediation.status) === "ready_for_review" ? "复核关闭" : "提交复核",
        generated_at: generatedAt,
      });
    });

  (input.costAnomalyWarningEvents ?? [])
    .filter((event) => String(event.remediation_status ?? "") !== "closed")
    .forEach((event) => {
      const remediationStatus = String(event.remediation_status ?? "");
      const hasRemediation = Boolean(event.remediation_id);
      const action =
        hasRemediation && remediationStatus === "ready_for_review"
          ? "closeCostAnomalyRemediation"
          : hasRemediation && ["pending", "rejected", ""].includes(remediationStatus)
            ? "markCostAnomalyRemediationReady"
            : "";
      rows.push({
        id: `alert-cost-anomaly-warning-${event.id}`,
        alert_type: "cost_anomaly_warning",
        alert_type_label: "成本异常预警",
        severity: event.severity ?? "medium",
        module_label: "报表中心",
        owner_role: event.owner_role ?? "production",
        owner_role_label: event.owner_role_label ?? roleLabel(String(event.owner_role ?? "production")),
        title: `成本异常预警 ${event.event_no ?? event.rule_code}`,
        detail: `${event.prod_no ?? "-"} / ${event.product_name ?? "-"} / ${event.material_name ?? "未指定物料"}，${event.trigger_reason ?? ""}`,
        entity_type: hasRemediation ? "production_cost_anomaly_remediation" : "production_cost_anomaly_warning_event",
        entity_id: hasRemediation ? event.remediation_id : event.id,
        warning_event_id: event.id,
        event_no: event.event_no,
        rule_code: event.rule_code,
        rule_name: event.rule_name,
        remediation_no: event.remediation_no,
        adjustment_no: event.adjustment_no,
        adjustment_amount: event.adjustment_amount,
        action,
        action_label: action === "closeCostAnomalyRemediation" ? "复核关闭" : action ? "提交整改" : "查看预警",
        generated_at: event.triggered_at ?? generatedAt,
      });
    });

  const normalizedRows: Array<Record<string, unknown>> = rows
    .map((row) => ({
      ...row,
      severity_label: alertSeverityLabel(String(row.severity)),
      severity_rank: alertSeverityRank[String(row.severity)] ?? 9,
    }));

  return normalizedRows
    .sort((a, b) => {
      const severityDiff = Number(a.severity_rank) - Number(b.severity_rank);
      if (severityDiff !== 0) return severityDiff;
      return String(a.title).localeCompare(String(b.title));
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function getSnapshot(actorId = "U-SALES") {
  const database = getDb();
  ensureRolePermissionDefaults(database);
  const users = database
    .prepare(`
      SELECT id, username, name, role, role_label, status, title, last_login_at, password_changed_at
      FROM users
      ORDER BY rowid
    `)
    .all() as UserRow[];
  const currentUser = users.find((user) => user.id === actorId) ?? users[0];
  const safeActor = currentUser?.id ?? "U-SALES";

  const quotes = database.prepare(`
    SELECT q.*, c.name AS customer_name, p.name AS product_name
    FROM quotes q
    JOIN customers c ON c.id = q.customer_id
    JOIN products p ON p.id = q.product_id
    ORDER BY q.created_at DESC, q.quote_no DESC
  `).all() as Array<Record<string, unknown>>;

  const orders = database.prepare(`
    SELECT o.*, c.name AS customer_name, p.name AS product_name, q.total_amount
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN quotes q ON q.id = o.quote_id
    ORDER BY o.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const customers = database.prepare(`
    SELECT c.*,
           COALESCE((SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id), 0) AS order_count,
           COALESCE((SELECT SUM(balance_amount) FROM receivables r WHERE r.customer_id = c.id), 0) AS receivable_balance
    FROM customers c
    ORDER BY c.status ASC, c.customer_code ASC, c.name ASC
  `).all() as Array<Record<string, unknown>>;

  const productions = database.prepare(`
    SELECT po.*, o.order_no, o.customer_po_no, o.qty AS order_qty, o.due_date,
           c.name AS customer_name,
           p.name AS product_name, p.unit,
           s.planned_date, s.machine, s.owner, s.shift, s.schedule_note,
           issuer.name AS issued_by_name,
           COALESCE((
             SELECT COUNT(*)
             FROM production_schedule_changes psc
             WHERE psc.production_order_id = po.id
           ), 0) AS schedule_change_count,
           COALESCE((
             SELECT psc.change_reason
             FROM production_schedule_changes psc
             WHERE psc.production_order_id = po.id
             ORDER BY psc.changed_at DESC
             LIMIT 1
           ), '') AS latest_schedule_change_reason
    FROM production_orders po
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN schedules s ON s.production_order_id = po.id
    LEFT JOIN users issuer ON issuer.id = po.issued_by
    ORDER BY po.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  productions.forEach((item) => {
    item.priority_label = priorityLabel(String(item.priority ?? "normal"));
    const risk = productionDeliveryRisk(item);
    item.delivery_risk_status = risk.status;
    item.delivery_risk_label = risk.label;
  });

  const productionScheduleChanges = database.prepare(`
    SELECT psc.*, po.prod_no, o.order_no, o.due_date,
           c.name AS customer_name,
           p.name AS product_name,
           changer.name AS changed_by_name
    FROM production_schedule_changes psc
    JOIN production_orders po ON po.id = psc.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN users changer ON changer.id = psc.changed_by
    ORDER BY psc.changed_at DESC
  `).all() as Array<Record<string, unknown>>;
  const productionDeliveryWarnings = productionDeliveryWarningRows(productions);

  const productionPlanVersions = (database.prepare(`
    SELECT ppv.*,
           locker.name AS locked_by_name,
           publisher.name AS published_by_name,
           ar.request_no AS approval_request_no,
           ar.status AS approval_status,
           ar.decision_note AS approval_decision_note,
           COALESCE((SELECT COUNT(*) FROM production_plan_lines ppl WHERE ppl.plan_id = ppv.id), 0) AS line_count
    FROM production_plan_versions ppv
    JOIN users locker ON locker.id = ppv.locked_by
    LEFT JOIN users publisher ON publisher.id = ppv.published_by
    LEFT JOIN approval_requests ar ON ar.id = ppv.approval_request_id
    ORDER BY ppv.locked_at DESC
  `).all() as Array<Record<string, unknown>>).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      status_label: productionPlanStatusLabel(String(item.status)),
      approval_status_label: item.approval_status ? approvalRequestStatusLabel(String(item.approval_status)) : "",
    };
  });

  const productionPlanLines = database.prepare(`
    SELECT ppl.*, ppv.plan_no, ppv.version_no, ppv.status AS plan_status
    FROM production_plan_lines ppl
    JOIN production_plan_versions ppv ON ppv.id = ppl.plan_id
    ORDER BY ppv.locked_at DESC, ppl.planned_date ASC, ppl.machine ASC, ppl.prod_no ASC
  `).all() as Array<Record<string, unknown>>;

  const productionPlanNotifications = database.prepare(`
    SELECT ppn.*, ppv.plan_no, ppv.version_no,
           po.prod_no, o.order_no, c.name AS customer_name, p.name AS product_name,
           psc.old_planned_date, psc.new_planned_date, psc.old_machine, psc.new_machine,
           psc.change_reason, psc.changed_at, changer.name AS changed_by_name,
           acknowledger.name AS acknowledged_by_name
    FROM production_plan_notifications ppn
    JOIN production_plan_versions ppv ON ppv.id = ppn.plan_id
    JOIN production_orders po ON po.id = ppn.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN production_schedule_changes psc ON psc.id = ppn.schedule_change_id
    LEFT JOIN users changer ON changer.id = psc.changed_by
    LEFT JOIN users acknowledger ON acknowledger.id = ppn.acknowledged_by
    ORDER BY ppn.created_at DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      status_label: productionPlanNotificationStatusLabel(String(item.status)),
      recipient_role_label: roleLabel(String(item.recipient_role)),
    };
  });

  const productionPlanChangeImpacts = database.prepare(`
    SELECT ppci.*, ppv.plan_no, ppv.version_no,
           po.prod_no, o.order_no, o.due_date, c.name AS customer_name, p.name AS product_name,
           psc.old_planned_date, psc.new_planned_date, psc.old_machine, psc.new_machine,
           psc.change_reason, psc.changed_at, changer.name AS changed_by_name,
           resolver.name AS resolved_by_name
    FROM production_plan_change_impacts ppci
    JOIN production_plan_versions ppv ON ppv.id = ppci.plan_id
    JOIN production_orders po ON po.id = ppci.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN production_schedule_changes psc ON psc.id = ppci.schedule_change_id
    LEFT JOIN users changer ON changer.id = psc.changed_by
    LEFT JOIN users resolver ON resolver.id = ppci.resolved_by
    ORDER BY ppci.created_at DESC, ppci.impact_no DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      impact_type_label: productionPlanChangeImpactTypeLabel(String(item.impact_type)),
      affected_role_label: roleLabel(String(item.affected_role)),
      status_label: productionPlanChangeImpactStatusLabel(String(item.status)),
      severity_label: productionPlanChangeImpactSeverityLabel(String(item.severity)),
    };
  });

  const productionMaterialAdjustmentSuggestions = database.prepare(`
    SELECT pmas.*, ppci.impact_no, po.prod_no, r.req_no,
           o.order_no, c.name AS customer_name, p.name AS product_name,
           creator.name AS created_by_name, confirmer.name AS confirmed_by_name
    FROM production_material_adjustment_suggestions pmas
    JOIN production_plan_change_impacts ppci ON ppci.id = pmas.impact_id
    JOIN production_orders po ON po.id = pmas.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN requisitions r ON r.id = pmas.requisition_id
    JOIN users creator ON creator.id = pmas.created_by
    LEFT JOIN users confirmer ON confirmer.id = pmas.confirmed_by
    ORDER BY pmas.created_at DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      adjustment_type_label: materialAdjustmentTypeLabel(String(item.adjustment_type)),
      status_label: materialAdjustmentStatusLabel(String(item.status)),
    };
  });

  const productionMaterialAdjustmentOrders = database.prepare(`
    SELECT pmao.*, pmas.suggestion_no, ppci.impact_no, po.prod_no, r.req_no,
           o.id AS customer_order_id,
           o.order_no AS customer_order_no, c.name AS customer_name, p.name AS product_name,
           creator.name AS created_by_name, executor.name AS executed_by_name,
           COALESCE(cost.cost_impact_amount, 0) AS cost_impact_amount,
           COALESCE(cost.inventory_value_delta, 0) AS inventory_value_delta,
           COALESCE(review.review_no, '') AS review_no,
           COALESCE(review.review_result, '') AS review_result,
           COALESCE(review.review_note, '') AS review_note,
           review.reviewed_at,
           reviewer.name AS reviewed_by_name,
           CASE
             WHEN review.id IS NOT NULL THEN 'reviewed'
             WHEN pmao.status = 'executed' THEN 'pending_review'
             ELSE 'not_started'
           END AS review_status,
           COALESCE((
             SELECT json_group_array(
               json_object(
                 'lineId', pmaol.id,
                 'materialId', pmaol.material_id,
                 'materialCode', m.material_code,
                 'materialName', m.name,
                 'batchId', pmaol.batch_id,
                 'batchNo', pmaol.batch_no,
                 'direction', pmaol.direction,
                 'directionLabel', CASE pmaol.direction WHEN 'out' THEN '补料出库' WHEN 'in' THEN '退料入库' ELSE pmaol.direction END,
                 'qty', pmaol.qty,
                 'unit', m.unit,
                 'unitCost', pmaol.unit_cost,
                 'lineAmount', pmaol.line_amount,
                 'movementId', pmaol.movement_id,
                 'createdAt', pmaol.created_at
               )
             )
             FROM production_material_adjustment_order_lines pmaol
             JOIN materials m ON m.id = pmaol.material_id
             WHERE pmaol.order_id = pmao.id
           ), '[]') AS lines
    FROM production_material_adjustment_orders pmao
    JOIN production_material_adjustment_suggestions pmas ON pmas.id = pmao.suggestion_id
    JOIN production_plan_change_impacts ppci ON ppci.id = pmao.impact_id
    JOIN production_orders po ON po.id = pmao.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN requisitions r ON r.id = pmao.requisition_id
    JOIN users creator ON creator.id = pmao.created_by
    LEFT JOIN users executor ON executor.id = pmao.executed_by
    LEFT JOIN (
      SELECT order_id,
             ROUND(SUM(CASE direction WHEN 'out' THEN line_amount WHEN 'in' THEN -line_amount ELSE 0 END), 2) AS cost_impact_amount,
             ROUND(SUM(CASE direction WHEN 'out' THEN -line_amount WHEN 'in' THEN line_amount ELSE 0 END), 2) AS inventory_value_delta
      FROM production_material_adjustment_order_lines
      GROUP BY order_id
    ) cost ON cost.order_id = pmao.id
    LEFT JOIN production_material_adjustment_order_reviews review ON review.order_id = pmao.id
    LEFT JOIN users reviewer ON reviewer.id = review.reviewed_by
    ORDER BY pmao.created_at DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      adjustment_type_label: materialAdjustmentTypeLabel(String(item.adjustment_type)),
      status_label: materialAdjustmentOrderStatusLabel(String(item.status)),
      review_status_label: materialAdjustmentReviewStatusLabel(String(item.review_status)),
      review_result_label: item.review_result ? materialAdjustmentReviewResultLabel(String(item.review_result)) : "",
      lines: JSON.parse(String(item.lines)) as unknown[],
    };
  });

  const productionMaterialAdjustmentOrderReviews = database.prepare(`
    SELECT review.*, pmao.order_no, pmao.adjustment_type, pmao.status AS order_status,
           po.prod_no, r.req_no, o.order_no AS customer_order_no,
           c.name AS customer_name, p.name AS product_name,
           reviewer.name AS reviewed_by_name
    FROM production_material_adjustment_order_reviews review
    JOIN production_material_adjustment_orders pmao ON pmao.id = review.order_id
    JOIN production_orders po ON po.id = pmao.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN requisitions r ON r.id = pmao.requisition_id
    JOIN users reviewer ON reviewer.id = review.reviewed_by
    ORDER BY review.reviewed_at DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      adjustment_type_label: materialAdjustmentTypeLabel(String(item.adjustment_type)),
      review_result_label: materialAdjustmentReviewResultLabel(String(item.review_result)),
    };
  });

  const productionMaterialAdjustmentReviewExceptions = database.prepare(`
    SELECT exception.*, review.review_no, review.review_result, pmao.order_no, pmao.adjustment_type,
           po.prod_no, r.req_no, o.order_no AS customer_order_no,
           c.name AS customer_name, p.name AS product_name,
           creator.name AS created_by_name, resolver.name AS resolved_by_name
    FROM production_material_adjustment_review_exceptions exception
    JOIN production_material_adjustment_order_reviews review ON review.id = exception.review_id
    JOIN production_material_adjustment_orders pmao ON pmao.id = exception.order_id
    JOIN production_orders po ON po.id = pmao.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN requisitions r ON r.id = pmao.requisition_id
    JOIN users creator ON creator.id = exception.created_by
    LEFT JOIN users resolver ON resolver.id = exception.resolved_by
    ORDER BY CASE exception.status WHEN 'open' THEN 0 ELSE 1 END, exception.created_at DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      adjustment_type_label: materialAdjustmentTypeLabel(String(item.adjustment_type)),
      status_label: materialAdjustmentExceptionStatusLabel(String(item.status)),
      reason_type_label: materialAdjustmentExceptionReasonLabel(String(item.reason_type)),
      owner_role_label: roleLabel(String(item.owner_role)),
      resolution_type_label: item.resolution_type ? materialAdjustmentExceptionResolutionLabel(String(item.resolution_type)) : "",
      review_result_label: materialAdjustmentReviewResultLabel(String(item.review_result)),
    };
  });

  const qualityInspectionWindowConfirmations = database.prepare(`
    SELECT qiwc.*, ppci.impact_no, po.prod_no, i.inspection_no,
           o.order_no, c.name AS customer_name, p.name AS product_name,
           creator.name AS created_by_name
    FROM quality_inspection_window_confirmations qiwc
    JOIN production_plan_change_impacts ppci ON ppci.id = qiwc.impact_id
    JOIN production_orders po ON po.id = qiwc.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN inspections i ON i.id = qiwc.inspection_id
    JOIN users creator ON creator.id = qiwc.created_by
    ORDER BY qiwc.created_at DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      status_label: qualityInspectionWindowStatusLabel(String(item.status)),
    };
  });

  const customerDeliveryConfirmations = database.prepare(`
    SELECT cdc.*, ppci.impact_no, po.prod_no,
           o.order_no, c.name AS customer_name, p.name AS product_name,
           creator.name AS created_by_name
    FROM customer_delivery_confirmations cdc
    JOIN production_plan_change_impacts ppci ON ppci.id = cdc.impact_id
    JOIN production_orders po ON po.id = cdc.production_order_id
    JOIN orders o ON o.id = cdc.order_id
    JOIN customers c ON c.id = cdc.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN users creator ON creator.id = cdc.created_by
    ORDER BY cdc.created_at DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      confirmation_status_label: deliveryConfirmationStatusLabel(String(item.confirmation_status)),
      status_label: String(item.status) === "active" ? "有效" : String(item.status),
    };
  });

  const purchaseArrivalNoticeChangeLogs = database.prepare(`
    SELECT pancl.*, pan.arrival_no, po.purchase_no, s.name AS supplier_name,
           ppci.impact_no, changer.name AS changed_by_name
    FROM purchase_arrival_notice_change_logs pancl
    JOIN purchase_arrival_notices pan ON pan.id = pancl.arrival_notice_id
    JOIN purchase_orders po ON po.id = pancl.purchase_order_id
    JOIN suppliers s ON s.id = pan.supplier_id
    LEFT JOIN production_plan_change_impacts ppci ON ppci.id = pancl.impact_id
    JOIN users changer ON changer.id = pancl.changed_by
    ORDER BY pancl.changed_at DESC
  `).all().map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      change_type_label: String(item.change_type) === "plan_impact_reschedule" ? "生产计划影响调整" : String(item.change_type),
    };
  });

  const requisitions = database.prepare(`
    SELECT r.*, po.prod_no, po.priority, o.order_no, o.qty AS order_qty,
      c.name AS customer_name, p.name AS product_name, p.unit,
      s.planned_date, s.machine, s.owner, s.shift, s.schedule_note,
      approver.name AS approved_by_name,
      issuer.name AS issued_by_name,
      COALESCE(json_group_array(
        json_object(
          'lineId', rl.id,
          'materialId', rl.material_id,
          'materialCode', m.material_code,
          'materialName', m.name,
          'requiredQty', rl.required_qty,
          'issuedQty', rl.issued_qty,
          'unit', m.unit,
          'isPrimary', rl.is_primary,
          'substituteId', (
            SELECT ms.substitute_id
            FROM material_substitutes ms
            WHERE ms.material_id = rl.material_id
            LIMIT 1
          ),
          'substituteName', (
            SELECT sm.name
            FROM material_substitutes ms
            JOIN materials sm ON sm.id = ms.substitute_id
            WHERE ms.material_id = rl.material_id
            LIMIT 1
          )
        )
      ), '[]') AS lines
    FROM requisitions r
    JOIN production_orders po ON po.id = r.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN schedules s ON s.production_order_id = po.id
    LEFT JOIN users approver ON approver.id = r.approved_by
    LEFT JOIN users issuer ON issuer.id = r.issued_by
    JOIN requisition_lines rl ON rl.requisition_id = r.id
    JOIN materials m ON m.id = rl.material_id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const inspections = database.prepare(`
    SELECT i.*, po.prod_no, o.id AS order_id, o.order_no, o.qty AS order_qty,
           c.id AS customer_id, c.name AS customer_name,
           p.name AS product_name, p.unit,
           requester.name AS requested_by_name,
           inspector.name AS completed_by_name,
           parent.inspection_no AS parent_inspection_no,
           td.disposition_no AS technical_disposition_no,
           td.disposition_type AS technical_disposition_type,
           CASE WHEN COALESCE(i.inspection_round, 1) > 1 THEN 1 ELSE 0 END AS is_reinspection
    FROM inspections i
    JOIN production_orders po ON po.id = i.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN users requester ON requester.id = i.requested_by
    LEFT JOIN users inspector ON inspector.id = i.completed_by
    LEFT JOIN inspections parent ON parent.id = i.parent_inspection_id
    LEFT JOIN technical_dispositions td ON td.id = i.technical_disposition_id
    ORDER BY i.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const productionDailyReports = database.prepare(`
    SELECT pdr.*, po.prod_no, po.status AS production_status,
           o.order_no, o.qty AS order_qty, c.name AS customer_name,
           p.name AS product_name, p.unit,
           reporter.name AS reported_by_name
    FROM production_daily_reports pdr
    JOIN production_orders po ON po.id = pdr.production_order_id
    JOIN orders o ON o.id = pdr.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN users reporter ON reporter.id = pdr.reported_by
    ORDER BY pdr.report_date DESC, pdr.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  productionDailyReports.forEach((item) => {
    item.status_label = productionDailyReportStatusLabel(String(item.status));
  });

  const technicalDispositions = database.prepare(`
    SELECT td.*, i.inspection_no, i.result, i.measurements,
           po.prod_no, po.status AS production_status,
           o.id AS order_id, o.order_no, o.qty AS order_qty,
           c.id AS customer_id, c.name AS customer_name,
           p.name AS product_name, p.unit,
           creator.name AS created_by_name
    FROM technical_dispositions td
    JOIN inspections i ON i.id = td.inspection_id
    JOIN production_orders po ON po.id = td.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN users creator ON creator.id = td.created_by
    ORDER BY td.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  technicalDispositions.forEach((item) => {
    item.status_label = technicalDispositionStatusLabel(String(item.status));
    item.disposition_type_label = technicalDispositionTypeLabel(String(item.disposition_type));
  });

  const inventoryAgingDispositions = database.prepare(`
    SELECT iad.*, m.name AS material_name, m.material_code, m.unit,
           owner.name AS owner_name,
           creator.name AS created_by_name
    FROM inventory_aging_dispositions iad
    JOIN materials m ON m.id = iad.material_id
    LEFT JOIN users owner ON owner.id = iad.owner_id
    LEFT JOIN users creator ON creator.id = iad.created_by
    ORDER BY iad.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  inventoryAgingDispositions.forEach((item) => {
    item.status_label = inventoryDispositionStatusLabel(String(item.status));
  });
  const latestDispositionByMaterial = new Map<string, Record<string, unknown>>();
  inventoryAgingDispositions.forEach((item) => {
    const materialId = String(item.material_id);
    if (!latestDispositionByMaterial.has(materialId)) {
      latestDispositionByMaterial.set(materialId, item);
    }
  });
  const operatingParameters = operatingParameterValues(database);

  const materialRows = database.prepare(`
    SELECT m.*,
           COALESCE((SELECT COUNT(*) FROM material_batches mb WHERE mb.material_id = m.id AND mb.qty > 0), 0) AS batch_count
    FROM materials m
    ORDER BY m.id
  `).all() as Array<Record<string, unknown>>;
  const materials: Array<Record<string, unknown>> = materialRows.map((item) => {
    const aging = classifyInventoryAging({
      lastMovementAt: String(item.last_movement_at ?? ""),
      staleWarningDays: operatingParameters.staleWarningDays,
      overstockDays: operatingParameters.overstockDays,
    });
    const disposition = latestDispositionByMaterial.get(String(item.id));
    return {
      ...item,
      inactive_days: aging.inactiveDays,
      aging_status: aging.status,
      aging_status_label:
        aging.status === "overstock" ? "积压库存" : aging.status === "stale_warning" ? "呆滞预警" : "正常",
      disposition_status: disposition?.status ?? "",
      disposition_status_label: disposition ? inventoryDispositionStatusLabel(String(disposition.status)) : "未登记",
      disposition_owner_name: disposition?.owner_name ?? "",
      disposition_action_plan: disposition?.action_plan ?? "",
      stock_value: roundMoney(Number(item.stock_qty ?? 0) * Number(item.average_cost ?? 0)),
    };
  });

  const batchRows = database.prepare(`
    SELECT mb.*, m.name AS material_name, m.unit
    FROM material_batches mb
    JOIN materials m ON m.id = mb.material_id
    WHERE mb.qty > 0
    ORDER BY mb.received_at ASC
  `).all() as Array<Record<string, unknown>>;
  const batches: Array<Record<string, unknown>> = batchRows.map((item) => {
    const aging = classifyInventoryAging({
      lastMovementAt: String(item.last_movement_at ?? item.received_at ?? ""),
      staleWarningDays: operatingParameters.staleWarningDays,
      overstockDays: operatingParameters.overstockDays,
    });
    return {
      ...item,
      inactive_days: aging.inactiveDays,
      aging_status: aging.status,
      aging_status_label:
        aging.status === "overstock" ? "积压库存" : aging.status === "stale_warning" ? "呆滞预警" : "正常",
      stock_value: roundMoney(Number(item.qty ?? 0) * Number(item.unit_cost ?? 0)),
    };
  });

  const stocktakes = database.prepare(`
    SELECT st.*, m.material_code, m.name AS material_name, m.unit,
           counter.name AS counted_by_name,
           approver.name AS approved_by_name
    FROM stocktakes st
    JOIN materials m ON m.id = st.material_id
    JOIN users counter ON counter.id = st.counted_by
    LEFT JOIN users approver ON approver.id = st.approved_by
    ORDER BY st.created_at DESC, st.stocktake_no DESC
  `).all() as Array<Record<string, unknown>>;
  stocktakes.forEach((item) => {
    item.status_label = stocktakeStatusLabel(String(item.status));
  });
  const inventoryTrace = inventoryTraceRows(database, undefined, {}).slice(0, 80);

  const finishedBatches = database.prepare(`
    SELECT fb.*, p.name AS product_name, p.unit,
           fgr.receipt_no, fgr.inbound_note,
           receiver.name AS received_by_name
    FROM finished_batches fb
    JOIN products p ON p.id = fb.product_id
    LEFT JOIN finished_goods_receipts fgr ON fgr.id = fb.receipt_id
    LEFT JOIN users receiver ON receiver.id = fgr.received_by
    ORDER BY fb.received_at DESC
  `).all() as Array<Record<string, unknown>>;

  const finishedReceipts = database.prepare(`
    SELECT fgr.*, po.prod_no, o.order_no, c.name AS customer_name,
           p.name AS product_name, p.unit,
           i.inspection_no, i.result, i.measurements,
           fb.batch_no AS finished_batch_no,
           tb.batch_no AS transition_batch_no,
           receiver.name AS received_by_name
    FROM finished_goods_receipts fgr
    JOIN production_orders po ON po.id = fgr.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = fgr.product_id
    JOIN inspections i ON i.id = fgr.inspection_id
    LEFT JOIN finished_batches fb ON fb.id = fgr.finished_batch_id
    LEFT JOIN finished_batches tb ON tb.id = fgr.transition_batch_id
    LEFT JOIN users receiver ON receiver.id = fgr.received_by
    ORDER BY fgr.received_at DESC
  `).all() as Array<Record<string, unknown>>;

  const productionCostSummaries = database.prepare(`
    SELECT pcs.*, po.prod_no, o.order_no, c.name AS customer_name,
           p.name AS product_name, p.unit, fgr.receipt_no,
           COALESCE(adj.adjustment_count, 0) AS adjustment_count,
           COALESCE(adj.adjustment_amount, 0) AS adjustment_amount
    FROM production_cost_summaries pcs
    JOIN production_orders po ON po.id = pcs.production_order_id
    JOIN orders o ON o.id = pcs.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN finished_goods_receipts fgr ON fgr.id = pcs.receipt_id
    LEFT JOIN (
      SELECT cost_summary_id, COUNT(*) AS adjustment_count, ROUND(SUM(adjustment_amount), 2) AS adjustment_amount
      FROM production_cost_adjustments
      WHERE status = 'applied'
      GROUP BY cost_summary_id
    ) adj ON adj.cost_summary_id = pcs.id
    ORDER BY pcs.aggregated_at DESC
  `).all() as Array<Record<string, unknown>>;

  const productionCostAdjustments: Array<Record<string, unknown>> = (database.prepare(`
    SELECT pca.*, po.prod_no, o.order_no, c.name AS customer_name,
           p.name AS product_name, p.unit, pcs.cost_no, exception.exception_no,
           creator.name AS created_by_name,
           ar.request_no, ar.status AS approval_status, ar.decision_note AS approval_note,
           applier.name AS applied_by_name, reverser.name AS reversed_by_name,
           dr.reversal_no
    FROM production_cost_adjustments pca
    JOIN production_orders po ON po.id = pca.production_order_id
    JOIN orders o ON o.id = pca.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN production_cost_summaries pcs ON pcs.id = pca.cost_summary_id
    LEFT JOIN production_material_adjustment_review_exceptions exception ON exception.id = pca.exception_id
    LEFT JOIN approval_requests ar ON ar.id = pca.approval_request_id
    JOIN users creator ON creator.id = pca.created_by
    LEFT JOIN users applier ON applier.id = pca.applied_by
    LEFT JOIN users reverser ON reverser.id = pca.reversed_by
    LEFT JOIN document_reversals dr ON dr.id = pca.reversal_id
    ORDER BY pca.created_at DESC
  `).all() as Array<Record<string, unknown>>).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      status_label: productionCostAdjustmentStatusLabel(String(item.status)),
      approval_status_label: item.approval_status ? approvalRequestStatusLabel(String(item.approval_status)) : "",
    };
  });
  const costAnomalyRemediations = costAnomalyRemediationRows(database);
  const costAnomalyRemediationReviews = costAnomalyRemediationReviewRows(database);
  const costAnomalyDrilldowns = costAnomalyDrilldownRows(database);
  const costAnomalyAnalytics = costAnomalyAnalyticsRows(database);
  const costAnomalyWarningRules = costAnomalyWarningRuleRows(database);
  const costAnomalyWarningEvents = costAnomalyWarningEventRows(database);
  const costAnomalyWarningDashboard = costAnomalyWarningDashboardRows(costAnomalyWarningEvents);

  const finishedShipmentAllocations = database.prepare(`
    SELECT fsa.*, s.shipment_no, o.order_no, c.name AS customer_name,
           p.name AS product_name, p.unit
    FROM finished_shipment_allocations fsa
    JOIN shipments s ON s.id = fsa.shipment_id
    JOIN orders o ON o.id = s.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    ORDER BY fsa.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const shipments: Array<Record<string, unknown>> = (database.prepare(`
    SELECT s.*,
           '本地化生产流转 ERP 演示公司' AS company_name,
           o.order_no, o.customer_po_no, o.sales_contract_no,
           c.name AS customer_name,
           p.name AS product_name, p.spec, p.unit,
           sr.return_no,
           os.shipment_no AS original_shipment_no,
           shipper.name AS shipped_by_name,
           (
             SELECT fb.batch_no
             FROM finished_batches fb
             WHERE fb.production_order_id = po.id AND fb.kind = 'finished'
             ORDER BY fb.received_at DESC
             LIMIT 1
           ) AS batch_no
    FROM shipments s
    JOIN orders o ON o.id = s.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN production_orders po ON po.id = s.production_order_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN sales_returns sr ON sr.id = s.replacement_for_return_id
    LEFT JOIN shipments os ON os.id = s.original_shipment_id
    LEFT JOIN users shipper ON shipper.id = s.shipped_by
    ORDER BY s.created_at DESC
  `).all() as Array<Record<string, unknown>>).map((item): Record<string, unknown> => ({
    ...item,
    shipment_type_label: shipmentTypeLabel(String(item.shipment_type ?? "standard")),
  }));

  const suppliers = database.prepare(`
    SELECT s.*,
           COALESCE((SELECT SUM(balance_amount) FROM payables p WHERE p.supplier_id = s.id), 0) AS payable_balance
    FROM suppliers s
    ORDER BY s.id
  `).all() as Array<Record<string, unknown>>;
  const supplierPerformance = supplierPerformanceRows(database);
  const supplierAdmissionControls = supplierAdmissionControlRows(database);
  const supplierCorrectiveActions = supplierCorrectiveActionRows(database);
  const supplierReassessments = supplierReassessmentRows(database);
  const supplierAdmissionReleases = supplierAdmissionReleaseRows(database);
  closeExpiredSupplierObservationPeriods(database);
  const supplierObservationPeriods = supplierObservationPeriodRows(database);
  const supplierQualificationCertificates = supplierQualificationCertificateRows(database);
  const supplierQualificationRequirements = supplierQualificationRequirementRows(database);
  const supplierQualificationMatrix = supplierQualificationMatrixRows(database);
  const supplierAnnualReviews = supplierAnnualReviewRows(database);
  const supplierAnnualReviewDue = supplierAnnualReviewDueRows(database);
  const supplierAdmissionRules = supplierAdmissionRuleRows(database);
  const supplierAdmissionRuleEvents = supplierAdmissionRuleEventRows(database);
  const supplierAdmissionRuleChangeRequests = supplierAdmissionRuleChangeRows(database);

  const products = database.prepare(`
    SELECT p.*,
           COALESCE((SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id), 0) AS order_count,
           COALESCE((SELECT COUNT(*) FROM boms b WHERE b.product_id = p.id), 0) AS bom_count
    FROM products p
    ORDER BY p.status ASC, p.product_code ASC, p.name ASC
  `).all() as Array<Record<string, unknown>>;

  const boms = database.prepare(`
    SELECT b.*, p.name AS product_name, p.product_code
    FROM boms b
    JOIN products p ON p.id = b.product_id
    ORDER BY b.updated_at DESC, b.version DESC
  `).all() as Array<Record<string, unknown>>;
  const bomLineRows = database.prepare(`
    SELECT bl.bom_id AS bomId,
           bl.parent_product_id AS parentProductId,
           bl.component_type AS componentType,
           bl.component_id AS componentId,
           COALESCE(m.name, cp.name, bl.component_id) AS componentName,
           COALESCE(m.unit, cp.unit, '') AS unit,
           bl.qty_per AS qtyPer,
           bl.is_primary AS isPrimary
    FROM bom_lines bl
    LEFT JOIN materials m ON bl.component_type = 'material' AND m.id = bl.component_id
    LEFT JOIN products cp ON bl.component_type = 'product' AND cp.id = bl.component_id
    ORDER BY bl.id
  `).all() as Array<Record<string, unknown>>;
  const bomLinesByBom = new Map<string, Record<string, unknown>[]>();
  bomLineRows.forEach((line) => {
    const bomId = String(line.bomId);
    const lines = bomLinesByBom.get(bomId) ?? [];
    lines.push(line);
    bomLinesByBom.set(bomId, lines);
  });

  const purchaseRequisitions = database.prepare(`
    SELECT pr.*,
      requester.name AS requested_by_name,
      approver.name AS approved_by_name,
      ar.request_no AS approval_no,
      ar.status AS approval_status,
      po.purchase_no AS converted_order_no,
      COALESCE(json_group_array(
        json_object(
          'materialId', prl.material_id,
          'materialName', m.name,
          'requestedQty', prl.requested_qty,
          'unit', m.unit,
          'estimatedUnitCost', prl.estimated_unit_cost,
          'lineAmount', prl.line_amount,
          'note', prl.note
        )
      ), '[]') AS lines
    FROM purchase_requisitions pr
    JOIN users requester ON requester.id = pr.requested_by
    LEFT JOIN users approver ON approver.id = pr.approved_by
    LEFT JOIN approval_requests ar ON ar.id = pr.approval_request_id
    LEFT JOIN purchase_orders po ON po.id = pr.converted_order_id
    JOIN purchase_requisition_lines prl ON prl.purchase_requisition_id = pr.id
    JOIN materials m ON m.id = prl.material_id
    GROUP BY pr.id
    ORDER BY pr.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  const purchaseRequisitionRows = purchaseRequisitions.map((item) => ({
    ...item,
    source_type_label: purchaseRequisitionSourceTypeLabel(String(item.source_type)),
    status_label: purchaseRequisitionStatusLabel(String(item.status)),
    lines: JSON.parse(String(item.lines)) as unknown[],
  }));

  const mrpRequirementRuns = database.prepare(`
    SELECT mrr.*,
      generator.name AS generated_by_name,
      pr.requisition_no AS converted_requisition_no,
      COALESCE(json_group_array(
        json_object(
          'lineId', mrl.id,
          'materialId', mrl.material_id,
          'materialCode', m.material_code,
          'materialName', m.name,
          'unit', m.unit,
          'requiredQty', mrl.required_qty,
          'availableQty', mrl.available_qty,
          'safetyStockQty', mrl.safety_stock_qty,
          'incomingPurchaseQty', mrl.incoming_purchase_qty,
          'plannedRequisitionQty', mrl.planned_requisition_qty,
          'netShortageQty', mrl.net_shortage_qty,
          'suggestedPurchaseQty', mrl.suggested_purchase_qty,
          'estimatedUnitCost', mrl.estimated_unit_cost,
          'lineAmount', mrl.line_amount,
          'sourceSummary', mrl.source_summary,
          'status', mrl.status
        )
      ), '[]') AS lines
    FROM mrp_requirement_runs mrr
    JOIN users generator ON generator.id = mrr.generated_by
    LEFT JOIN purchase_requisitions pr ON pr.id = mrr.converted_requisition_id
    LEFT JOIN mrp_requirement_lines mrl ON mrl.run_id = mrr.id
    LEFT JOIN materials m ON m.id = mrl.material_id
    GROUP BY mrr.id
    ORDER BY mrr.generated_at DESC
    LIMIT 30
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    const parsedLines = (JSON.parse(String(row.lines)) as Array<Record<string, unknown>>).filter((line) => line.materialId);
    return {
      ...row,
      source_type_label: row.source_type === "production_order" ? "指定工单" : "全部待生产需求",
      status_label: mrpRequirementStatusLabel(String(row.status)),
      lines: parsedLines.map((line) => ({
        ...line,
        status_label: mrpLineStatusLabel(String(line.status)),
      })),
    };
  }) as Array<Record<string, unknown>>;

  const mrpRequirementLines = database.prepare(`
    SELECT mrl.*,
      mrr.run_no,
      mrr.status AS run_status,
      mrr.generated_at,
      m.material_code,
      m.name AS material_name,
      m.unit
    FROM mrp_requirement_lines mrl
    JOIN mrp_requirement_runs mrr ON mrr.id = mrl.run_id
    JOIN materials m ON m.id = mrl.material_id
    ORDER BY mrr.generated_at DESC, mrl.status DESC, mrl.line_amount DESC
    LIMIT 80
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      status_label: mrpLineStatusLabel(String(row.status)),
      run_status_label: mrpRequirementStatusLabel(String(row.run_status)),
    };
  }) as Array<Record<string, unknown>>;

  const purchaseContracts = database.prepare(`
    SELECT pc.*,
      po.purchase_no,
      s.name AS supplier_name,
      creator.name AS created_by_name,
      COALESCE(json_group_array(
        json_object(
          'lineId', pol.id,
          'materialId', pol.material_id,
          'materialCode', m.material_code,
          'materialName', m.name,
          'spec', m.spec,
          'unit', m.unit,
          'orderedQty', pol.qty,
          'arrivedQty', pol.qty,
          'unitCost', pol.unit_cost,
          'lineAmount', pol.line_amount,
          'batchHint', '',
          'note', ''
        )
      ), '[]') AS lines
    FROM purchase_contracts pc
    JOIN purchase_orders po ON po.id = pc.purchase_order_id
    JOIN suppliers s ON s.id = pc.supplier_id
    JOIN users creator ON creator.id = pc.created_by
    LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    LEFT JOIN materials m ON m.id = pol.material_id
    GROUP BY pc.id
    ORDER BY pc.created_at DESC
    LIMIT 50
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    const parsedLines = (JSON.parse(String(row.lines)) as Array<Record<string, unknown>>).filter((line) => line.materialId);
    return {
      ...row,
      status_label: purchaseContractStatusLabel(String(row.status)),
      lines: parsedLines,
    };
  }) as Array<Record<string, unknown>>;

  const purchaseArrivalNotices = database.prepare(`
    SELECT pan.*,
      po.purchase_no,
      pc.contract_no,
      s.name AS supplier_name,
      creator.name AS created_by_name,
      receiver.name AS warehouse_received_by_name,
      iqc.iqc_no,
      COALESCE(json_group_array(
        json_object(
          'lineId', panl.id,
          'materialId', panl.material_id,
          'materialCode', m.material_code,
          'materialName', m.name,
          'unit', m.unit,
          'orderedQty', panl.ordered_qty,
          'arrivedQty', panl.arrived_qty,
          'unitCost', panl.unit_cost,
          'lineAmount', panl.line_amount,
          'batchHint', panl.batch_hint,
          'note', panl.note
        )
      ), '[]') AS lines
    FROM purchase_arrival_notices pan
    JOIN purchase_orders po ON po.id = pan.purchase_order_id
    LEFT JOIN purchase_contracts pc ON pc.id = pan.purchase_contract_id
    JOIN suppliers s ON s.id = pan.supplier_id
    JOIN users creator ON creator.id = pan.created_by
    LEFT JOIN users receiver ON receiver.id = pan.warehouse_received_by
    LEFT JOIN material_iqc_inspections iqc ON iqc.id = pan.iqc_id
    LEFT JOIN purchase_arrival_notice_lines panl ON panl.arrival_notice_id = pan.id
    LEFT JOIN materials m ON m.id = panl.material_id
    GROUP BY pan.id
    ORDER BY pan.created_at DESC
    LIMIT 50
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    const parsedLines = (JSON.parse(String(row.lines)) as Array<Record<string, unknown>>).filter((line) => line.materialId);
    return {
      ...row,
      status_label: purchaseArrivalStatusLabel(String(row.status)),
      lines: parsedLines,
    };
  }) as Array<Record<string, unknown>>;

  const purchaseArrivalDiscrepancies = database.prepare(`
    SELECT pad.*,
      pan.arrival_no,
      po.purchase_no,
      pc.contract_no,
      s.name AS supplier_name,
      creator.name AS created_by_name,
      approver.name AS approved_by_name,
      resolver.name AS resolved_by_name,
      ar.request_no AS approval_no,
      ar.status AS approval_status,
      COALESCE(json_group_array(
        json_object(
          'lineId', padl.id,
          'arrivalNoticeLineId', padl.arrival_notice_line_id,
          'materialId', padl.material_id,
          'materialCode', m.material_code,
          'materialName', m.name,
          'unit', m.unit,
          'orderedQty', padl.ordered_qty,
          'actualArrivedQty', padl.actual_arrived_qty,
          'varianceQty', padl.variance_qty,
          'orderedUnitCost', padl.ordered_unit_cost,
          'actualUnitCost', padl.actual_unit_cost,
          'priceVarianceAmount', padl.price_variance_amount,
          'expectedBatchHint', padl.expected_batch_hint,
          'actualBatchHint', padl.actual_batch_hint,
          'lineAdjustmentAmount', padl.line_adjustment_amount,
          'note', padl.note
        )
      ), '[]') AS lines
    FROM purchase_arrival_discrepancies pad
    JOIN purchase_arrival_notices pan ON pan.id = pad.arrival_notice_id
    JOIN purchase_orders po ON po.id = pad.purchase_order_id
    LEFT JOIN purchase_contracts pc ON pc.id = pad.purchase_contract_id
    JOIN suppliers s ON s.id = pad.supplier_id
    JOIN users creator ON creator.id = pad.created_by
    LEFT JOIN users approver ON approver.id = pad.approved_by
    LEFT JOIN users resolver ON resolver.id = pad.resolved_by
    LEFT JOIN approval_requests ar ON ar.id = pad.approval_request_id
    LEFT JOIN purchase_arrival_discrepancy_lines padl ON padl.discrepancy_id = pad.id
    LEFT JOIN materials m ON m.id = padl.material_id
    GROUP BY pad.id
    ORDER BY pad.created_at DESC
    LIMIT 50
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    const parsedLines = (JSON.parse(String(row.lines)) as Array<Record<string, unknown>>).filter((line) => line.materialId);
    return {
      ...row,
      status_label: purchaseArrivalDiscrepancyStatusLabel(String(row.status)),
      discrepancy_type_label: purchaseArrivalDiscrepancyTypeLabel(String(row.discrepancy_type)),
      handling_decision_label: purchaseArrivalHandlingDecisionLabel(String(row.handling_decision)),
      resolution_result_label: row.resolution_result ? purchaseArrivalHandlingDecisionLabel(String(row.resolution_result)) : "",
      lines: parsedLines,
    };
  }) as Array<Record<string, unknown>>;

  const purchaseOrders = database.prepare(`
    SELECT po.*, s.name AS supplier_name, ar.request_no AS approval_no, ar.status AS approval_status,
      pr.requisition_no AS source_requisition_no,
      (
        SELECT pc.id
        FROM purchase_contracts pc
        WHERE pc.purchase_order_id = po.id
        ORDER BY pc.created_at DESC
        LIMIT 1
      ) AS contract_id,
      (
        SELECT pc.contract_no
        FROM purchase_contracts pc
        WHERE pc.purchase_order_id = po.id
        ORDER BY pc.created_at DESC
        LIMIT 1
      ) AS contract_no,
      (
        SELECT pc.status
        FROM purchase_contracts pc
        WHERE pc.purchase_order_id = po.id
        ORDER BY pc.created_at DESC
        LIMIT 1
      ) AS contract_status,
      (
        SELECT pan.id
        FROM purchase_arrival_notices pan
        WHERE pan.purchase_order_id = po.id AND pan.status <> 'voided'
        ORDER BY pan.created_at DESC
        LIMIT 1
      ) AS arrival_notice_id,
      (
        SELECT pan.arrival_no
        FROM purchase_arrival_notices pan
        WHERE pan.purchase_order_id = po.id AND pan.status <> 'voided'
        ORDER BY pan.created_at DESC
        LIMIT 1
      ) AS arrival_no,
      (
        SELECT pan.status
        FROM purchase_arrival_notices pan
        WHERE pan.purchase_order_id = po.id AND pan.status <> 'voided'
        ORDER BY pan.created_at DESC
        LIMIT 1
      ) AS arrival_status,
      COALESCE(json_group_array(
        json_object(
          'materialId', pol.material_id,
          'materialName', m.name,
          'qty', pol.qty,
          'unit', m.unit,
          'unitCost', pol.unit_cost,
          'lineAmount', pol.line_amount
        )
      ), '[]') AS lines
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN approval_requests ar ON ar.id = po.approval_request_id
    LEFT JOIN purchase_requisitions pr ON pr.id = po.source_requisition_id
    JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    JOIN materials m ON m.id = pol.material_id
    GROUP BY po.id
    ORDER BY po.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const materialIqcInspections = database.prepare(`
    SELECT iqc.*,
      po.purchase_no,
      s.name AS supplier_name,
      creator.name AS created_by_name,
      inspector.name AS inspected_by_name,
      COALESCE(json_group_array(
        json_object(
          'materialId', iqcl.material_id,
          'materialName', m.name,
          'orderedQty', iqcl.ordered_qty,
          'receivedQty', iqcl.received_qty,
          'acceptedQty', iqcl.accepted_qty,
          'rejectedQty', iqcl.rejected_qty,
          'unit', m.unit,
          'unitCost', iqcl.unit_cost,
          'acceptedUnitCost', iqcl.accepted_unit_cost,
          'lineAmount', iqcl.line_amount,
          'batchNo', iqcl.batch_no
        )
      ), '[]') AS lines
    FROM material_iqc_inspections iqc
    JOIN purchase_orders po ON po.id = iqc.purchase_order_id
    JOIN suppliers s ON s.id = iqc.supplier_id
    JOIN users creator ON creator.id = iqc.created_by
    LEFT JOIN users inspector ON inspector.id = iqc.inspected_by
    JOIN material_iqc_lines iqcl ON iqcl.iqc_id = iqc.id
    JOIN materials m ON m.id = iqcl.material_id
    GROUP BY iqc.id
    ORDER BY iqc.created_at DESC
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    const isOverdue = row.status === "pending" && Date.parse(String(row.due_at)) < Date.now();
    return {
      ...row,
      status_label: materialIqcStatusLabel(String(row.status)),
      result_label: row.result ? materialIqcResultLabel(String(row.result)) : "待判定",
      is_overdue: isOverdue,
      age_days: calculateAgeDays({ fromDate: String(row.arrived_at) }),
      lines: JSON.parse(String(row.lines)) as unknown[],
    };
  }) as Array<Record<string, unknown>>;

  const purchaseReceipts = database.prepare(`
    SELECT im.id,
           im.created_at,
           im.batch_no,
           im.qty,
           im.unit_cost,
           ROUND(im.qty * im.unit_cost, 2) AS line_amount,
           m.name AS material_name,
           m.material_code,
           m.unit,
           po.purchase_no,
           iqc.iqc_no,
           iqc.result AS iqc_result,
           iqc.status AS iqc_status,
           s.name AS supplier_name
    FROM inventory_movements im
    JOIN materials m ON m.id = im.item_id
    LEFT JOIN material_iqc_inspections iqc ON iqc.id = im.source_id AND im.source_type = 'material_iqc_inspection'
    LEFT JOIN purchase_orders po ON (po.id = im.source_id AND im.source_type = 'purchase_order') OR po.id = iqc.purchase_order_id
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE im.item_type = 'material'
      AND im.movement_type = 'purchase_inbound'
    ORDER BY im.created_at DESC
    LIMIT 30
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      iqc_result_label: row.iqc_result ? materialIqcResultLabel(String(row.iqc_result)) : "-",
    };
  }) as Array<Record<string, unknown>>;

  const materialIssues = database.prepare(`
    SELECT ra.id,
           r.req_no,
           po.prod_no,
           o.order_no,
           c.name AS customer_name,
           p.name AS product_name,
           r.issue_no,
           issuer.name AS issued_by_name,
           rl.material_id AS original_material_id,
           om.material_code AS original_material_code,
           om.name AS original_material_name,
           ra.material_id,
           m.material_code,
           m.name AS material_name,
           m.unit,
           mb.batch_no,
           ra.qty,
           ra.unit_cost,
           ROUND(ra.qty * ra.unit_cost, 2) AS line_amount,
           ra.is_substitute,
           COALESCE(ra.issue_mode, 'fifo') AS issue_mode,
           COALESCE(ra.issue_note, '') AS issue_note,
           r.issued_at AS created_at
    FROM requisition_allocations ra
    JOIN requisition_lines rl ON rl.id = ra.requisition_line_id
    JOIN requisitions r ON r.id = rl.requisition_id
    JOIN production_orders po ON po.id = r.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN material_batches mb ON mb.id = ra.batch_id
    JOIN materials m ON m.id = ra.material_id
    JOIN materials om ON om.id = rl.material_id
    LEFT JOIN users issuer ON issuer.id = r.issued_by
    ORDER BY r.issued_at DESC, ra.rowid DESC
    LIMIT 50
  `).all() as Array<Record<string, unknown>>;

  const payables = database.prepare(`
    SELECT p.*, s.name AS supplier_name,
           CAST(julianday('now') - julianday(p.created_at) AS INTEGER) AS age_days
    FROM payables p
    JOIN suppliers s ON s.id = p.supplier_id
    ORDER BY p.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const receivables = database.prepare(`
    SELECT r.*, c.name AS customer_name, o.order_no, s.shipment_no,
           CAST(julianday('now') - julianday(r.created_at) AS INTEGER) AS age_days
    FROM receivables r
    JOIN customers c ON c.id = r.customer_id
    JOIN orders o ON o.id = r.order_id
    LEFT JOIN shipments s ON s.id = r.shipment_id
    ORDER BY r.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const salesReturns: Array<Record<string, unknown>> = (database.prepare(`
    SELECT sr.*, s.shipment_no, o.order_no, c.name AS customer_name,
           p.name AS product_name, p.unit, creator.name AS created_by_name,
           r.receivable_no
    FROM sales_returns sr
    JOIN shipments s ON s.id = sr.shipment_id
    JOIN orders o ON o.id = sr.order_id
    JOIN customers c ON c.id = sr.customer_id
    JOIN products p ON p.id = sr.product_id
    LEFT JOIN users creator ON creator.id = sr.created_by
    LEFT JOIN receivables r ON r.id = sr.receivable_id
    ORDER BY sr.created_at DESC
  `).all() as Array<Record<string, unknown>>).map((item): Record<string, unknown> => ({
    ...item,
    status_label: salesReturnStatusLabel(String(item.status)),
    refund_status_label: refundStatusLabel(String(item.refund_status)),
    replacement_status_label: replacementStatusLabel(String(item.replacement_status)),
  }));

  const salesReturnAllocations = database.prepare(`
    SELECT sra.*, sr.return_no, s.shipment_no, c.name AS customer_name,
           p.name AS product_name, p.unit
    FROM sales_return_allocations sra
    JOIN sales_returns sr ON sr.id = sra.sales_return_id
    JOIN shipments s ON s.id = sr.shipment_id
    JOIN customers c ON c.id = sr.customer_id
    JOIN products p ON p.id = sr.product_id
    ORDER BY sra.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const customerRefunds = database.prepare(`
    SELECT cr.*, sr.return_no, r.receivable_no, c.name AS customer_name,
           refunder.name AS refunded_by_name
    FROM customer_refunds cr
    JOIN sales_returns sr ON sr.id = cr.sales_return_id
    LEFT JOIN receivables r ON r.id = cr.receivable_id
    JOIN customers c ON c.id = cr.customer_id
    LEFT JOIN users refunder ON refunder.id = cr.refunded_by
    ORDER BY cr.refunded_at DESC
  `).all() as Array<Record<string, unknown>>;

  const documentExports = database.prepare(`
    SELECT d.*, u.name AS actor_name
    FROM document_exports d
    LEFT JOIN users u ON u.id = d.actor_id
    ORDER BY d.created_at DESC
    LIMIT 12
  `).all() as Array<Record<string, unknown>>;

  const documentAttachments: Array<Record<string, unknown>> = database.prepare(`
    SELECT da.*,
           u.name AS uploaded_by_name
    FROM document_attachments da
    LEFT JOIN users u ON u.id = da.uploaded_by
    ORDER BY da.uploaded_at DESC
    LIMIT 30
  `).all() as Array<Record<string, unknown>>;
  documentAttachments.forEach((item) => {
    item.entity_type_label = documentTypeLabel(String(item.entity_type));
    item.size_label = formatBytes(Number(item.size_bytes ?? 0));
  });

  const initializationImports: Array<Record<string, unknown>> = database.prepare(`
    SELECT ii.*, u.name AS actor_name
    FROM initialization_imports ii
    LEFT JOIN users u ON u.id = ii.actor_id
    ORDER BY ii.created_at DESC, ii.rowid DESC
    LIMIT 20
  `).all() as Array<Record<string, unknown>>;
  initializationImports.forEach((item) => {
    item.type_label = initializationImportTypeLabel(String(item.type));
    item.status_label = initializationImportStatusLabel(String(item.status));
  });
  const initializationImportErrors: Array<Record<string, unknown>> = database.prepare(`
    SELECT iie.*, ii.import_no, ii.type, ii.source_name, ii.status,
           u.name AS actor_name
    FROM initialization_import_errors iie
    JOIN initialization_imports ii ON ii.id = iie.import_id
    LEFT JOIN users u ON u.id = ii.actor_id
    ORDER BY iie.created_at DESC, ii.rowid DESC, iie.row_no ASC
    LIMIT 60
  `).all() as Array<Record<string, unknown>>;
  initializationImportErrors.forEach((item) => {
    item.type_label = initializationImportTypeLabel(String(item.type));
    item.status_label = initializationImportStatusLabel(String(item.status));
  });

  const documentSequences = database.prepare(`
    SELECT ds.*,
           ds.prefix || '-' || ds.date_key || '-' || printf('%03d', ds.current_no) AS sample_no
    FROM document_sequences ds
    ORDER BY ds.updated_at DESC, ds.doc_type ASC
    LIMIT 60
  `).all() as Array<Record<string, unknown>>;

  const documentCancellations: Array<Record<string, unknown>> = database.prepare(`
    SELECT dc.*, u.name AS cancelled_by_name
    FROM document_cancellations dc
    LEFT JOIN users u ON u.id = dc.cancelled_by
    ORDER BY dc.cancelled_at DESC
    LIMIT 60
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      document_type_label: documentTypeLabel(String(row.document_type)),
      status_label: "已作废",
    };
  });

  const documentReversals: Array<Record<string, unknown>> = database.prepare(`
    SELECT dr.*, u.name AS reversed_by_name
    FROM document_reversals dr
    LEFT JOIN users u ON u.id = dr.reversed_by
    ORDER BY dr.reversed_at DESC
    LIMIT 60
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      document_type_label: documentTypeLabel(String(row.document_type)),
      reversal_type_label: reversalTypeLabel(String(row.reversal_type)),
      status_label: "已冲销",
    };
  });

  const ledgerRedOffsets: Array<Record<string, unknown>> = database.prepare(`
    SELECT lro.*, dr.reversal_no, u.name AS created_by_name
    FROM ledger_red_offsets lro
    JOIN document_reversals dr ON dr.id = lro.reversal_id
    LEFT JOIN users u ON u.id = lro.created_by
    ORDER BY lro.created_at DESC
    LIMIT 80
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      ledger_type_label: ledgerTypeLabel(String(row.ledger_type)),
      source_document_type_label: documentTypeLabel(String(row.source_document_type)),
    };
  });

  const reportSnapshots: Array<Record<string, unknown>> = (database.prepare(`
    SELECT *
    FROM report_snapshots
    ORDER BY created_at DESC
    LIMIT 24
  `).all() as Array<Record<string, unknown>>).map((item) => {
    const metrics = parseJsonRecord(item.metrics_json);
    const generatedBy = users.find((user) => user.id === metrics.actorId);
    return {
      ...item,
      ...metrics,
      generated_by_name: generatedBy?.name ?? metrics.actorId ?? "-",
    };
  });

  const auditLogs = database.prepare(`
    SELECT a.*, u.name AS actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC
    LIMIT 12
  `).all() as Array<Record<string, unknown>>;

  const loginLogs = database.prepare(`
    SELECT a.*, u.name AS actor_name, u.role_label, u.username
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.action = 'login'
    ORDER BY a.created_at DESC
    LIMIT 30
  `).all() as Array<Record<string, unknown>>;

  const systemSettings = database.prepare(`
    SELECT ss.*, updater.name AS updated_by_name
    FROM system_settings ss
    LEFT JOIN users updater ON updater.id = ss.updated_by
    ORDER BY ss.category ASC, ss.setting_key ASC
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      category_label: systemSettingCategoryLabel(String(row.category)),
    };
  });

  const systemSettingEffects = database.prepare(`
    SELECT sse.*, creator.name AS created_by_name
    FROM system_setting_effects sse
    LEFT JOIN users creator ON creator.id = sse.created_by
    ORDER BY sse.created_at DESC
    LIMIT 50
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    const impact = parseJsonRecord(row.impact_json);
    return {
      ...row,
      impact_summary: impact.summary ?? {},
      impact_items: impact.items ?? [],
      summary_text: impact.summary_text ?? "",
      category_label: impact.category_label ?? "",
    };
  });
  const systemHealthRemediations = systemHealthRemediationRows(database);
  const systemHealthRemediationReviews = systemHealthRemediationReviewRows(database);

  const approvalRules = approvalRuleRows(database);

  const approvalRequests = database.prepare(`
    SELECT ar.id, ar.request_no, ar.type, ar.title, ar.applicant_id, ar.status, ar.amount,
           ar.reason, ar.rule_id, COALESCE(ar.approver_role, rule.approver_role, 'manager') AS approver_role,
           COALESCE(ar.sla_hours, rule.sla_hours, 48) AS sla_hours,
           ar.entity_type, ar.entity_id, ar.created_at, ar.decided_by, ar.decided_at, ar.decision_note,
           applicant.name AS applicant_name, approver.name AS decided_by_name,
           rule.rule_code, rule.rule_name, rule.risk_level
    FROM approval_requests ar
    JOIN users applicant ON applicant.id = ar.applicant_id
    LEFT JOIN users approver ON approver.id = ar.decided_by
    LEFT JOIN approval_rules rule ON rule.id = ar.rule_id
    ORDER BY ar.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  approvalRequests.forEach((item) => {
    item.status_label = approvalRequestStatusLabel(String(item.status));
  });

  const cancelledKeys = new Set(documentCancellations.map((item) => `${item.document_type}:${item.document_id}`));
  const reversedKeys = new Set(documentReversals.map((item) => `${item.document_type}:${item.document_id}`));
  const documentVoidCandidates = [
    ...quotes
      .filter((item) => ["draft", "confirmed"].includes(String(item.status)))
      .map((item) => ({
        document_type: "quote",
        document_type_label: documentTypeLabel("quote"),
        document_id: item.id,
        document_no: item.quote_no,
        title: `${item.quote_no} / ${item.customer_name}`,
        original_status: item.status,
        original_status_label: quoteStatusLabel(String(item.status)),
      })),
    ...orders
      .filter((item) => String(item.status) === "submitted")
      .map((item) => ({
        document_type: "sales_order",
        document_type_label: documentTypeLabel("sales_order"),
        document_id: item.id,
        document_no: item.order_no,
        title: `${item.order_no} / ${item.customer_name}`,
        original_status: item.status,
        original_status_label: orderStatusLabel(String(item.status)),
      })),
    ...purchaseOrders
      .filter((item) => ["pending_approval", "pending_receipt", "rejected"].includes(String(item.status)))
      .map((item) => ({
        document_type: "purchase_order",
        document_type_label: documentTypeLabel("purchase_order"),
        document_id: item.id,
        document_no: item.purchase_no,
        title: `${item.purchase_no} / ${item.supplier_name}`,
        original_status: item.status,
        original_status_label: purchaseOrderStatusLabel(String(item.status)),
      })),
    ...approvalRequests
      .filter((item) => String(item.status) === "pending")
      .map((item) => ({
        document_type: "approval_request",
        document_type_label: documentTypeLabel("approval_request"),
        document_id: item.id,
        document_no: item.request_no,
        title: `${item.request_no} / ${item.title}`,
        original_status: item.status,
        original_status_label: approvalRequestStatusLabel(String(item.status)),
      })),
  ].filter((item) => !cancelledKeys.has(`${item.document_type}:${item.document_id}`));

  const documentReversalCandidates = [
    ...purchaseOrders
      .filter((item) => String(item.status) === "received")
      .map((item) => ({
        document_type: "purchase_order",
        document_type_label: documentTypeLabel("purchase_order"),
        document_id: item.id,
        document_no: item.purchase_no,
        title: `${item.purchase_no} / ${item.supplier_name}`,
        original_status: item.status,
        original_status_label: purchaseOrderStatusLabel(String(item.status)),
        reversal_type: "purchase_inbound",
        reversal_type_label: reversalTypeLabel("purchase_inbound"),
      })),
    ...shipments
      .filter((item) => String(item.status) === "shipped")
      .map((item) => ({
        document_type: "shipment",
        document_type_label: documentTypeLabel("shipment"),
        document_id: item.id,
        document_no: item.shipment_no,
        title: `${item.shipment_no} / ${item.customer_name}`,
        original_status: item.status,
        original_status_label: "已发货",
        reversal_type: "sales_shipment",
        reversal_type_label: reversalTypeLabel("sales_shipment"),
      })),
    ...productionCostAdjustments
      .filter((item) => String(item.status) === "applied")
      .map((item) => ({
        document_type: "production_cost_adjustment",
        document_type_label: documentTypeLabel("production_cost_adjustment"),
        document_id: item.id,
        document_no: item.adjustment_no,
        title: `${item.adjustment_no} / ${item.prod_no} / 调整金额 ${roundMoney(Number(item.adjustment_amount ?? 0))}`,
        original_status: item.status,
        original_status_label: productionCostAdjustmentStatusLabel(String(item.status)),
        reversal_type: "production_cost_adjustment",
        reversal_type_label: reversalTypeLabel("production_cost_adjustment"),
      })),
  ].filter((item) => !reversedKeys.has(`${item.document_type}:${item.document_id}`));

  const returnedQtyByShipment = new Map<string, number>();
  salesReturns
    .filter((item) => String(item.status) !== "voided")
    .forEach((item) => {
      const shipmentId = String(item.shipment_id);
      returnedQtyByShipment.set(shipmentId, roundQty((returnedQtyByShipment.get(shipmentId) ?? 0) + Number(item.return_qty ?? 0)));
    });
  const salesReturnCandidates = shipments
    .filter((item) => String(item.status) === "shipped" && String(item.shipment_type ?? "standard") === "standard")
    .map((item) => {
      const returnedQty = returnedQtyByShipment.get(String(item.id)) ?? 0;
      const returnableQty = roundQty(Number(item.shipped_qty ?? 0) - returnedQty);
      return {
        shipment_id: item.id,
        shipment_no: item.shipment_no,
        order_id: item.order_id,
        order_no: item.order_no,
        production_order_id: item.production_order_id,
        customer_name: item.customer_name,
        product_name: item.product_name,
        unit: item.unit,
        shipped_qty: item.shipped_qty,
        returned_qty: returnedQty,
        returnable_qty: returnableQty,
        sales_amount: item.sales_amount,
        financial_status: item.financial_status,
      };
    })
    .filter((item) => Number(item.returnable_qty) > 0);
  const replacementShipmentCandidates = salesReturns.filter(
    (item) => String(item.status) === "returned" && String(item.replacement_status) === "pending_replacement",
  );

  const formulaCalculations = database.prepare(`
    SELECT fc.*, u.name AS created_by_name,
      COALESCE(json_group_array(
        json_object(
          'materialId', fcl.material_id,
          'materialName', fcl.material_name,
          'qty', fcl.qty,
          'unit', fcl.unit,
          'averageCost', fcl.average_cost,
          'lineCost', fcl.line_cost,
          'ratio', fcl.ratio
        )
      ), '[]') AS lines
    FROM formula_price_calculations fc
    JOIN users u ON u.id = fc.created_by
    LEFT JOIN formula_price_lines fcl ON fcl.calculation_id = fc.id
    GROUP BY fc.id
    ORDER BY fc.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const inventoryValue =
    (database.prepare("SELECT COALESCE(SUM(stock_qty * average_cost), 0) AS value FROM materials").get() as {
      value: number;
    }).value +
    (database.prepare("SELECT COALESCE(SUM(qty * unit_cost), 0) AS value FROM finished_batches").get() as {
      value: number;
    }).value;
  const orderAmount = (database.prepare(`
    SELECT COALESCE(SUM(q.total_amount), 0) AS value
    FROM orders o JOIN quotes q ON q.id = o.quote_id
  `).get() as { value: number }).value;
  const purchaseAmount = (database.prepare("SELECT COALESCE(SUM(total_amount), 0) AS value FROM purchase_orders").get() as {
    value: number;
  }).value;
  const receivableBalance = (database.prepare("SELECT COALESCE(SUM(balance_amount), 0) AS value FROM receivables").get() as {
    value: number;
  }).value;
  const payableBalance = (database.prepare("SELECT COALESCE(SUM(balance_amount), 0) AS value FROM payables").get() as {
    value: number;
  }).value;
  const receivedAmount = (database.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM receivable_receipts").get() as {
    value: number;
  }).value;
  const lowStockCount = materials.filter((item) => Number(item.reorder_min_qty ?? 0) > 0 && Number(item.stock_qty ?? 0) <= Number(item.reorder_min_qty)).length;
  const staleWarningCount = materials.filter((item) => item.aging_status === "stale_warning").length;
  const overstockCount = materials.filter((item) => item.aging_status === "overstock").length;
  const overstockValue = materials
    .filter((item) => item.aging_status === "overstock")
    .reduce((sum, item) => sum + Number(item.stock_value ?? 0), 0);
  const mrpShortageLineCount = mrpRequirementLines.filter((item) => item.status === "shortage" && item.run_status === "draft").length;
  const mrpShortageAmount = mrpRequirementRuns
    .filter((item) => item.status === "draft")
    .reduce((sum, item) => sum + Number(item.total_shortage_amount ?? 0), 0);
  const approvalCenter = approvalCenterRows({
    approvalRequests,
    purchaseRequisitions: purchaseRequisitionRows,
    stocktakes,
    requisitions,
    approvalRules,
    operatingParameters,
  });
  const inventoryAging = materials
    .filter((item) => item.aging_status !== "normal")
    .sort((a, b) => Number(b.inactive_days ?? 0) - Number(a.inactive_days ?? 0));
  const alertSubscriptions = alertSubscriptionRows(database);
  const alertMessageStates = alertMessageStateRows(database, safeActor);
  const rawAlertCenter = alertCenterRows({
    materials,
    inventoryAging,
    approvalCenter,
    receivables,
    payables,
    inspections,
    productionDeliveryWarnings,
    mrpRequirementRuns,
    systemHealthRemediations,
    costAnomalyWarningEvents,
    operatingParameters,
  });
  const alertCenter = enrichAlertCenterRows({
    rows: rawAlertCenter,
    user: currentUser,
    subscriptions: alertSubscriptions,
    messageStates: alertMessageStates,
  });
  const pendingApprovalCount = approvalCenter.length;
  const approvalOverdueCount = approvalCenter.filter((item) => item.is_overdue).length;
  const alertCount = alertCenter.length;
  const criticalAlertCount = alertCenter.filter((item) => item.severity === "critical").length;
  const unreadAlertCount = alertCenter.filter((item) => item.is_unread).length;
  const dismissedAlertCount = alertMessageStates.filter((item) => item.status === "dismissed").length;
  const formulaCount = formulaCalculations.length;
  const qualityExceptionAnalytics = buildQualityExceptionAnalytics(inspections, technicalDispositions);
  const lowYieldWarningCount = inspections.filter((item) => {
    const yieldRate = Number(item.yield_rate ?? 0);
    return yieldRate > 0 && yieldRate < operatingParameters.yieldWarningRate;
  }).length;
  const supplierRiskCount = supplierPerformance.filter((item) => String(item.risk_level) === "high").length;
  const supplierAverageScore = supplierPerformance.length
    ? roundMoney(supplierPerformance.reduce((sum, item) => sum + Number(item.performance_score ?? 0), 0) / supplierPerformance.length)
    : 0;
  const supplierRestrictedCount = supplierAdmissionControls.filter((item) => !Number(item.purchase_allowed ?? 1)).length;
  const supplierCorrectiveOpenCount = supplierCorrectiveActions.filter((item) =>
    ["open", "submitted", "rejected"].includes(String(item.status)),
  ).length;
  const supplierCorrectionOverdueCount = supplierCorrectiveActions.filter((item) => Number(item.is_overdue ?? 0) > 0).length;
  const supplierReleaseCount = supplierAdmissionReleases.length;
  const supplierObservationActiveCount = supplierObservationPeriods.filter((item) => String(item.status) === "active").length;
  const supplierCertificateDueCount = supplierQualificationCertificates.filter((item) =>
    ["expired", "expiring"].includes(String(item.expiry_status)),
  ).length;
  const supplierQualificationMissingCount = supplierQualificationMatrix.filter((item) =>
    ["missing", "expired"].includes(String(item.compliance_status)),
  ).length;
  const supplierQualificationBlockingCount = supplierQualificationMatrix.filter((item) => Number(item.purchase_blocking ?? 0) > 0).length;
  const supplierAnnualReviewDueCount = supplierAnnualReviewDue.length;
  const supplierAutoRuleCount = supplierAdmissionRules.filter((item) => String(item.status) === "active").length;
  const supplierAutoTriggerCount = supplierAdmissionRuleEvents.length;
  const supplierRuleChangePendingCount = supplierAdmissionRuleChangeRequests.filter((item) => String(item.status) === "pending_approval").length;
  const processFlow = buildProcessFlowRows({
    quotes,
    orders,
    productions,
    purchaseOrders,
    requisitions,
    inspections,
    technicalDispositions,
    materialIqcInspections,
    productionDailyReports,
    finishedReceipts,
    shipments,
    receivables,
    payables,
  });
  const processFlowSummary = buildProcessFlowSummary(processFlow);

  const tasks = buildTasks(currentUser, {
    quotes,
    orders,
    productions,
    requisitions,
    inspections,
    technicalDispositions,
    materialIqcInspections,
    purchaseOrders,
    productionPlanNotifications,
    productionPlanChangeImpacts,
    productionMaterialAdjustmentSuggestions,
    productionMaterialAdjustmentOrders,
    productionMaterialAdjustmentReviewExceptions,
    purchaseArrivalDiscrepancies,
    mrpRequirementRuns,
    payables,
    receivables,
    materials,
    shipments,
    approvalRequests,
    stocktakes,
    systemHealthRemediations,
    supplierCorrectiveActions,
    supplierQualificationCertificates,
    supplierAnnualReviewDue,
    costAnomalyRemediations,
    costAnomalyWarningEvents,
    alertSubscriptions,
  });
  const storage = getStorageSummary();
  const systemHealthChecks = buildSystemHealthChecks({
    materials,
    batches,
    products,
    customers,
    suppliers,
    boms,
    approvalCenter,
    receivables,
    payables,
    inventoryAging,
    storage,
    lowYieldWarningCount,
    remediations: systemHealthRemediations,
  });
  const systemHealthSummary = buildSystemHealthSummary(systemHealthChecks);

  return {
    dataRoot: getDataPaths().root,
    users: users.map(publicUser),
    currentUser,
    tasks,
    summary: {
      orderAmount: roundMoney(orderAmount),
      purchaseAmount: roundMoney(purchaseAmount),
      inventoryValue: roundMoney(inventoryValue),
      receivableBalance: roundMoney(receivableBalance),
      payableBalance: roundMoney(payableBalance),
      receivedAmount: roundMoney(receivedAmount),
      lowStockCount,
      staleWarningCount,
      overstockCount,
      overstockValue: roundMoney(overstockValue),
      mrpShortageLineCount,
      mrpShortageAmount: roundMoney(mrpShortageAmount),
      pendingApprovalCount,
      approvalOverdueCount,
      alertCount,
      criticalAlertCount,
      unreadAlertCount,
      dismissedAlertCount,
      formulaCount,
      qualityExceptionCount: Number((qualityExceptionAnalytics.totals as Record<string, unknown>).disposition_count ?? 0),
      qualityClosureRate: Number((qualityExceptionAnalytics.totals as Record<string, unknown>).closure_rate ?? 0),
      lowYieldWarningCount,
      supplierRiskCount,
      supplierAverageScore,
      supplierRestrictedCount,
      supplierCorrectiveOpenCount,
      supplierCorrectionOverdueCount,
      supplierReleaseCount,
      supplierObservationActiveCount,
      supplierCertificateDueCount,
      supplierQualificationMissingCount,
      supplierQualificationBlockingCount,
      supplierAnnualReviewDueCount,
      supplierAutoRuleCount,
      supplierAutoTriggerCount,
      supplierRuleChangePendingCount,
      costAnomalyWarningEventCount: Number((costAnomalyWarningDashboard.totals as Record<string, unknown>).total_count ?? 0),
      costAnomalyWarningOpenCount: Number((costAnomalyWarningDashboard.totals as Record<string, unknown>).open_count ?? 0),
      costAnomalyWarningCriticalCount: Number((costAnomalyWarningDashboard.totals as Record<string, unknown>).critical_count ?? 0),
      processNodeCount: processFlowSummary.node_count,
      processPendingCount: processFlowSummary.pending_total,
      processExceptionCount: processFlowSummary.exception_total,
      systemHealthScore: systemHealthSummary.score,
      systemHealthCriticalCount: systemHealthSummary.critical_count,
      systemHealthWarningCount: systemHealthSummary.warning_count,
      activeProductions: productions.filter((item) => item.status !== "shipped").length,
      pendingTasks: tasks.length,
    },
    board: {
      quotes: quotes.map((item) => ({ ...item, status_label: quoteStatusLabel(String(item.status)) })),
      orders: orders.map((item) => ({ ...item, status_label: orderStatusLabel(String(item.status)) })),
      customers,
      productions: productions.map((item) => ({
        ...item,
        status_label: productionStatusLabel(String(item.status)),
      })),
      productionScheduleChanges,
      productionDeliveryWarnings,
      productionPlanVersions,
      productionPlanLines,
      productionPlanNotifications,
      productionPlanChangeImpacts,
      productionMaterialAdjustmentSuggestions,
      productionMaterialAdjustmentOrders,
      productionMaterialAdjustmentOrderReviews,
      productionMaterialAdjustmentReviewExceptions,
      qualityInspectionWindowConfirmations,
      customerDeliveryConfirmations,
      requisitions: requisitions.map((item) => ({
        ...item,
        lines: JSON.parse(String(item.lines)) as unknown[],
      })),
      inspections,
      productionDailyReports,
      technicalDispositions,
      qualityExceptionAnalytics,
      costAnomalyAnalytics,
      costAnomalyDrilldowns,
      costAnomalyRemediations,
      costAnomalyRemediationReviews,
      costAnomalyWarningRules,
      costAnomalyWarningEvents,
      costAnomalyWarningDashboard,
      materials,
      batches,
      inventoryAging,
      finishedBatches,
      finishedReceipts,
      productionCostSummaries,
      productionCostAdjustments,
      finishedShipmentAllocations,
      shipments,
      salesReturns,
      salesReturnAllocations,
      salesReturnCandidates,
      replacementShipmentCandidates,
      customerRefunds,
      suppliers,
      supplierPerformance,
      supplierAdmissionControls,
      supplierCorrectiveActions,
      supplierReassessments,
      supplierAdmissionReleases,
      supplierObservationPeriods,
      supplierQualificationCertificates,
      supplierQualificationRequirements,
      supplierQualificationMatrix,
      supplierAnnualReviews,
      supplierAnnualReviewDue,
      supplierAdmissionRules,
      supplierAdmissionRuleEvents,
      supplierAdmissionRuleChangeRequests,
      products,
      boms: boms.map((item) => ({ ...item, lines: bomLinesByBom.get(String(item.id)) ?? [] })),
      purchaseRequisitions: purchaseRequisitionRows,
      mrpRequirementRuns,
      mrpRequirementLines,
      purchaseContracts,
      purchaseArrivalNotices,
      purchaseArrivalNoticeChangeLogs,
      purchaseArrivalDiscrepancies,
      purchaseOrders: purchaseOrders.map((item) => ({
        ...item,
        status_label: purchaseOrderStatusLabel(String(item.status)),
        contract_status_label: item.contract_status ? purchaseContractStatusLabel(String(item.contract_status)) : "",
        arrival_status_label: item.arrival_status ? purchaseArrivalStatusLabel(String(item.arrival_status)) : "",
        purchase_approval_threshold: operatingParameters.purchaseApprovalThreshold,
        threshold_status: Number(item.total_amount ?? 0) >= operatingParameters.purchaseApprovalThreshold ? "reached" : "below",
        threshold_status_label:
          Number(item.total_amount ?? 0) >= operatingParameters.purchaseApprovalThreshold ? "达到审批阈值" : "低于审批阈值",
        lines: JSON.parse(String(item.lines)) as unknown[],
      })),
      materialIqcInspections,
      purchaseReceipts,
      materialIssues,
      stocktakes,
      inventoryTrace,
      payables,
      receivables,
      processFlow,
      processFlowSummary,
      systemHealthSummary,
      systemHealthChecks,
      systemHealthRemediations,
      systemHealthRemediationReviews,
      approvalRequests,
      approvalCenter,
      alertCenter,
      alertMessageStates,
      alertSubscriptions,
      approvalRules,
      operatingParameters,
      formulaCalculations: formulaCalculations.map((item) => ({
        ...item,
        lines: JSON.parse(String(item.lines)) as unknown[],
      })),
      inventoryAgingDispositions,
      documentSequences,
      documentCancellations,
      documentVoidCandidates,
      documentReversals,
      documentReversalCandidates,
      ledgerRedOffsets,
      documentAttachments,
      initializationImports,
      initializationImportErrors,
      documentExports,
      reportSnapshots,
      systemSettings,
      systemSettingEffects,
      loginLogs,
      auditLogs,
    },
    charts: {
      inventoryByMaterial: materials.map((item) => ({
        name: String(item.name),
        value: Number(item.stock_value ?? 0),
      })),
      productionStages: productions.map((item) => ({
        name: String(item.prod_no),
        stage: productionStageScore(String(item.status)),
        status: productionStatusLabel(String(item.status)),
      })),
      orderFunnel: [
        { name: "报价", value: quotes.length },
        { name: "订单", value: orders.length },
        { name: "生产", value: productions.length },
        { name: "发货", value: shipments.length },
      ],
      cashPosition: [
        { name: "应收余额", value: roundMoney(receivableBalance) },
        { name: "应付余额", value: roundMoney(payableBalance) },
        { name: "已回款", value: roundMoney(receivedAmount) },
      ],
      yieldTrend: inspections
        .filter((item) => item.yield_rate != null)
        .map((item) => ({
          name: String(item.inspection_no),
          value: Number(item.yield_rate),
        })),
    },
    labels: {
      quoteStatusLabel,
      orderStatusLabel,
      productionStatusLabel,
    },
    storage,
    security: {
      currentPermissions: permissionsForRole(database, currentUser.role),
      rolePermissions: rolePermissionRows(database),
      permissionMatrix: rolePermissionMatrixRows(database),
    },
    safeActor,
  };
}

function buildQualityExceptionAnalytics(
  inspections: Array<Record<string, unknown>>,
  technicalDispositions: Array<Record<string, unknown>>,
) {
  const activeDispositions = technicalDispositions.filter((item) => String(item.status) !== "voided");
  const failedCount = inspections.filter((item) => String(item.result) === "failed").length;
  const reinspectionCount = inspections.filter((item) => Number(item.is_reinspection ?? 0) === 1).length;
  const closedCount = activeDispositions.filter((item) => String(item.status) === "closed").length;
  const closureRate = activeDispositions.length ? roundMoney((closedCount / activeDispositions.length) * 100) : 0;
  const rootCauseMap = new Map<string, Record<string, unknown>>();
  const dispositionTypeMap = new Map<string, Record<string, unknown>>();

  activeDispositions.forEach((item) => {
    const rootCause = String(item.root_cause ?? "").trim() || "未填写原因";
    const rootCauseRow =
      rootCauseMap.get(rootCause) ??
      ({
        root_cause: rootCause,
        count: 0,
        closed_count: 0,
        open_count: 0,
        closure_rate: 0,
      } satisfies Record<string, unknown>);
    rootCauseRow.count = Number(rootCauseRow.count ?? 0) + 1;
    if (String(item.status) === "closed") {
      rootCauseRow.closed_count = Number(rootCauseRow.closed_count ?? 0) + 1;
    } else {
      rootCauseRow.open_count = Number(rootCauseRow.open_count ?? 0) + 1;
    }
    rootCauseRow.closure_rate = roundMoney((Number(rootCauseRow.closed_count ?? 0) / Number(rootCauseRow.count ?? 1)) * 100);
    rootCauseMap.set(rootCause, rootCauseRow);

    const dispositionType = String(item.disposition_type_label ?? item.disposition_type ?? "").trim() || "未分类";
    const dispositionRow =
      dispositionTypeMap.get(dispositionType) ??
      ({
        disposition_type_label: dispositionType,
        count: 0,
        closed_count: 0,
        open_count: 0,
        closure_rate: 0,
      } satisfies Record<string, unknown>);
    dispositionRow.count = Number(dispositionRow.count ?? 0) + 1;
    if (String(item.status) === "closed") {
      dispositionRow.closed_count = Number(dispositionRow.closed_count ?? 0) + 1;
    } else {
      dispositionRow.open_count = Number(dispositionRow.open_count ?? 0) + 1;
    }
    dispositionRow.closure_rate = roundMoney((Number(dispositionRow.closed_count ?? 0) / Number(dispositionRow.count ?? 1)) * 100);
    dispositionTypeMap.set(dispositionType, dispositionRow);
  });

  return {
    totals: {
      failed_count: failedCount,
      disposition_count: activeDispositions.length,
      reinspection_count: reinspectionCount,
      closed_count: closedCount,
      open_count: activeDispositions.length - closedCount,
      closure_rate: closureRate,
    },
    rootCauses: Array.from(rootCauseMap.values()).sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0)),
    dispositionTypes: Array.from(dispositionTypeMap.values()).sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0)),
    openExceptions: activeDispositions.filter((item) => String(item.status) !== "closed").slice(0, 8),
  };
}

function buildProcessFlowRows(data: {
  quotes: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  productions: Array<Record<string, unknown>>;
  purchaseOrders: Array<Record<string, unknown>>;
  requisitions: Array<Record<string, unknown>>;
  inspections: Array<Record<string, unknown>>;
  technicalDispositions: Array<Record<string, unknown>>;
  materialIqcInspections: Array<Record<string, unknown>>;
  productionDailyReports: Array<Record<string, unknown>>;
  finishedReceipts: Array<Record<string, unknown>>;
  shipments: Array<Record<string, unknown>>;
  receivables: Array<Record<string, unknown>>;
  payables: Array<Record<string, unknown>>;
}) {
  const count = (rows: Array<Record<string, unknown>>, predicate: (row: Record<string, unknown>) => boolean) =>
    rows.filter(predicate).length;
  const node = (input: {
    sequence: number;
    key: string;
    title: string;
    department: string;
    targetModule: string;
    description: string;
    total: number;
    pending: number;
    done: number;
    exception: number;
    primaryMetric: string;
  }) => {
    const status =
      input.exception > 0 ? "exception" : input.pending > 0 ? "pending" : input.done > 0 ? "completed" : "empty";
    return {
      sequence: input.sequence,
      key: input.key,
      title: input.title,
      department: input.department,
      target_module: input.targetModule,
      description: input.description,
      total_count: input.total,
      pending_count: input.pending,
      done_count: input.done,
      exception_count: input.exception,
      primary_metric: input.primaryMetric,
      status,
      status_label:
        status === "exception" ? "存在异常" : status === "pending" ? "待推进" : status === "completed" ? "已流转" : "暂无数据",
    };
  };

  const activeTechnicalDispositions = data.technicalDispositions.filter((item) => String(item.status) !== "voided");
  const openReceivables = count(data.receivables, (item) => String(item.status) !== "paid");
  const openPayables = count(data.payables, (item) => String(item.status) !== "paid");

  return [
    node({
      sequence: 1,
      key: "quote_pricing",
      title: "报价管理 / BOM+成本",
      department: "商务销售",
      targetModule: "sales",
      description: "按材料移动均价、加工费和利润率生成报价，并留存版本。",
      total: data.quotes.length,
      pending: count(data.quotes, (item) => ["draft", "confirmed"].includes(String(item.status))),
      done: count(data.quotes, (item) => String(item.status) === "converted"),
      exception: count(data.quotes, (item) => ["voided", "reversed"].includes(String(item.status))),
      primaryMetric: "报价单",
    }),
    node({
      sequence: 2,
      key: "sales_order",
      title: "销售订单 / 商务内勤创建",
      department: "商务销售",
      targetModule: "sales",
      description: "客户确认报价后转正式订单，作为生产和交付主线。",
      total: data.orders.length,
      pending: count(data.orders, (item) => ["submitted", "production_released"].includes(String(item.status))),
      done: count(data.orders, (item) => ["shipped", "closed"].includes(String(item.status))),
      exception: count(data.orders, (item) => ["voided", "reversed"].includes(String(item.status))),
      primaryMetric: "订单",
    }),
    node({
      sequence: 3,
      key: "production_plan",
      title: "生产安排计划 / 工令单",
      department: "商务销售",
      targetModule: "production",
      description: "内勤下达生产指令，生产记录人工排产、机台和负责人。",
      total: data.productions.length,
      pending: count(data.productions, (item) =>
        ["instructed", "material_requested", "producing", "inspection_requested"].includes(String(item.status)),
      ),
      done: count(data.productions, (item) => ["in_stock", "partial_shipped", "shipped"].includes(String(item.status))),
      exception: count(data.productions, (item) => String(item.status) === "qa_failed"),
      primaryMetric: "生产单",
    }),
    node({
      sequence: 4,
      key: "material_requisition",
      title: "生产领料 / 仓库出库",
      department: "生产制造",
      targetModule: "inventory",
      description: "BOM 展开后自动生成领料单，仓库按 FIFO 或替代料发料。",
      total: data.requisitions.length,
      pending: count(data.requisitions, (item) => ["pending_approval", "pending", "approved"].includes(String(item.status))),
      done: count(data.requisitions, (item) => String(item.status) === "issued"),
      exception: count(data.requisitions, (item) => String(item.status) === "rejected"),
      primaryMetric: "领料单",
    }),
    node({
      sequence: 5,
      key: "production_daily",
      title: "生产日报 / 统计录入",
      department: "生产制造",
      targetModule: "production",
      description: "生产日报记录完工、良品、不良、报废、工时和异常说明。",
      total: data.productionDailyReports.length,
      pending: count(data.productions, (item) => String(item.status) === "producing"),
      done: count(data.productionDailyReports, (item) => String(item.status) === "submitted"),
      exception: count(data.productionDailyReports, (item) => Number(item.defect_qty ?? 0) + Number(item.scrap_qty ?? 0) > 0),
      primaryMetric: "日报",
    }),
    node({
      sequence: 6,
      key: "material_iqc",
      title: "IQC 原料来料检验",
      department: "采购仓储",
      targetModule: "quality",
      description: "供应商到货后发起来料检验，合格、让步或特采后才允许入库。",
      total: data.materialIqcInspections.length,
      pending: count(data.materialIqcInspections, (item) => String(item.status) === "pending"),
      done: count(data.materialIqcInspections, (item) => String(item.status) === "accepted"),
      exception: count(data.materialIqcInspections, (item) => String(item.status) === "rejected" || Boolean(item.is_overdue)),
      primaryMetric: "IQC",
    }),
    node({
      sequence: 7,
      key: "procurement_payable",
      title: "采购入库 / 应付账款",
      department: "采购仓储",
      targetModule: "inventory",
      description: "采购入库自动生成库存批次、库存流水、移动均价和应付账款。",
      total: data.purchaseOrders.length + data.payables.length,
      pending: count(data.purchaseOrders, (item) => ["pending_approval", "pending_receipt", "iqc_pending"].includes(String(item.status))) + openPayables,
      done: count(data.purchaseOrders, (item) => ["received", "closed"].includes(String(item.status))) + count(data.payables, (item) => String(item.status) === "paid"),
      exception: count(data.purchaseOrders, (item) => ["rejected", "iqc_rejected", "voided", "reversed"].includes(String(item.status))),
      primaryMetric: "采购/应付",
    }),
    node({
      sequence: 8,
      key: "oqc_inspection",
      title: "OQC 成品检验",
      department: "生产制造",
      targetModule: "quality",
      description: "生产完工后发起成品请验，品控判定合格、让步或不合格。",
      total: data.inspections.length,
      pending: count(data.inspections, (item) => String(item.status) === "pending"),
      done: count(data.inspections, (item) => ["qualified", "concession"].includes(String(item.result))),
      exception: count(data.inspections, (item) => String(item.result) === "failed"),
      primaryMetric: "请验单",
    }),
    node({
      sequence: 9,
      key: "technical_disposition",
      title: "技术部不合格处理 / 复检",
      department: "技术质量",
      targetModule: "quality",
      description: "不合格批次必须由技术部出具原因分析和处理意见，并跟踪复检关闭。",
      total: activeTechnicalDispositions.length,
      pending: count(activeTechnicalDispositions, (item) => String(item.status) !== "closed"),
      done: count(activeTechnicalDispositions, (item) => String(item.status) === "closed"),
      exception: count(activeTechnicalDispositions, (item) => String(item.status) === "reinspection_failed"),
      primaryMetric: "技术处置",
    }),
    node({
      sequence: 10,
      key: "finished_inbound",
      title: "成品/过渡料入库",
      department: "仓库成品",
      targetModule: "quality",
      description: "凭合格或让步请验单办理成品和过渡料入库，并归集工单成本。",
      total: data.finishedReceipts.length,
      pending: count(data.productions, (item) => String(item.status) === "qa_approved"),
      done: data.finishedReceipts.length,
      exception: 0,
      primaryMetric: "入库单",
    }),
    node({
      sequence: 11,
      key: "shipment_receivable",
      title: "销售出货 / 应收账款",
      department: "销售财务",
      targetModule: "sales",
      description: "商务安排发货，系统扣减成品库存并自动生成应收账款。",
      total: data.shipments.length + data.receivables.length,
      pending: count(data.productions, (item) => String(item.status) === "in_stock") + openReceivables,
      done: count(data.shipments, (item) => String(item.status) === "shipped") + count(data.receivables, (item) => String(item.status) === "paid"),
      exception: count(data.shipments, (item) => ["voided", "reversed"].includes(String(item.status))),
      primaryMetric: "发货/应收",
    }),
  ];
}

function buildProcessFlowSummary(processFlow: Array<Record<string, unknown>>) {
  const pendingTotal = processFlow.reduce((sum, item) => sum + Number(item.pending_count ?? 0), 0);
  const exceptionTotal = processFlow.reduce((sum, item) => sum + Number(item.exception_count ?? 0), 0);
  const completedNodes = processFlow.filter((item) => String(item.status) === "completed").length;
  return {
    node_count: processFlow.length,
    pending_total: pendingTotal,
    exception_total: exceptionTotal,
    completed_node_count: completedNodes,
    health_rate: processFlow.length ? roundMoney(((processFlow.length - processFlow.filter((item) => Number(item.exception_count ?? 0) > 0).length) / processFlow.length) * 100) : 100,
  };
}

function permissionsForRole(database: Database.Database, role: Role) {
  ensureRolePermissionDefaults(database);
  return (database.prepare(`
    SELECT action
    FROM role_permissions
    WHERE role = ? AND enabled = 1
    ORDER BY action ASC
  `).all(role) as Array<{ action: string }>).map((row) => row.action);
}

function rolePermissionRows(database: Database.Database): Array<Record<string, unknown>> {
  ensureRolePermissionDefaults(database);
  return (database.prepare(`
    SELECT rp.*,
           updater.name AS updated_by_name
    FROM role_permissions rp
    LEFT JOIN users updater ON updater.id = rp.updated_by
    ORDER BY rp.role ASC, rp.module_label ASC, rp.action_label ASC
  `).all() as Array<Record<string, unknown>>).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      role_label: roleLabel(String(item.role)),
      enabled_label: Number(item.enabled ?? 0) > 0 ? "启用" : "停用",
    };
  });
}

function rolePermissionMatrixRows(database: Database.Database) {
  const rows = rolePermissionRows(database);
  const grouped = new Map<string, Record<string, unknown>>();
  rows.forEach((row) => {
    const key = `${row.role}:${row.module_label}`;
    const current =
      grouped.get(key) ??
      ({
        role: row.role,
        role_label: row.role_label,
        module_label: row.module_label,
        action_count: 0,
        enabled_count: 0,
        disabled_count: 0,
        high_risk_count: 0,
        medium_risk_count: 0,
        low_risk_count: 0,
        actions: "",
      } satisfies Record<string, unknown>);
    current.action_count = Number(current.action_count ?? 0) + 1;
    if (Number(row.enabled ?? 0) > 0) {
      current.enabled_count = Number(current.enabled_count ?? 0) + 1;
      if (row.risk_level === "高") current.high_risk_count = Number(current.high_risk_count ?? 0) + 1;
      if (row.risk_level === "中") current.medium_risk_count = Number(current.medium_risk_count ?? 0) + 1;
      if (row.risk_level === "低") current.low_risk_count = Number(current.low_risk_count ?? 0) + 1;
      current.actions = [String(current.actions || ""), row.action_label].filter(Boolean).join("、");
    } else {
      current.disabled_count = Number(current.disabled_count ?? 0) + 1;
    }
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort((a, b) => {
    const roleDiff = String(a.role_label).localeCompare(String(b.role_label));
    if (roleDiff !== 0) return roleDiff;
    return String(a.module_label).localeCompare(String(b.module_label));
  });
}

function actionModuleLabel(action: string) {
  if (
    [
      "createQuote",
      "confirmQuote",
      "createOrder",
      "createShipment",
      "recordReceivableReceipt",
      "recordSalesReturn",
      "recordCustomerRefund",
      "createReplacementShipment",
    ].includes(action)
  ) {
    return "销售订单";
  }
  if (
    [
      "createProductionInstruction",
      "scheduleAndGenerateRequisition",
      "updateProductionSchedule",
      "lockProductionPlan",
      "ackProductionPlanNotification",
      "resolveProductionPlanChangeImpact",
      "confirmMaterialAdjustmentSuggestion",
      "executeMaterialAdjustmentOrder",
      "reviewMaterialAdjustmentOrder",
      "resolveMaterialAdjustmentReviewException",
      "approveMaterialRequisition",
      "issueMaterials",
      "requestInspection",
      "receiveFinishedGoods",
      "createProductionDailyReport",
    ].includes(action)
  ) {
    return "生产执行";
  }
  if (
    [
      "createPurchaseOrder",
      "createPurchaseRequisition",
      "generateMrpRequirementRun",
      "createPurchaseRequisitionFromMrp",
      "createPurchaseContract",
      "createPurchaseArrivalNotice",
      "registerPurchaseArrivalDiscrepancy",
      "resolvePurchaseArrivalDiscrepancy",
      "signPurchaseArrivalNotice",
      "createPurchaseOrderFromRequisition",
      "createMaterialIqcInspection",
      "receivePurchaseOrder",
      "recordPayablePayment",
      "purchaseInbound",
      "recordInventoryAgingDisposition",
      "createStocktake",
      "approveStocktake",
      "upsertSupplier",
      "deactivateSupplier",
      "upsertMaterial",
      "deactivateMaterial",
    ].includes(action)
  ) {
    return "采购仓储";
  }
  if (["completeInspection", "createTechnicalDisposition"].includes(action)) return "质检收率";
  if (["completeMaterialIqcInspection"].includes(action)) return "质检收率";
  if (
    [
      "createCostAnomalyRemediation",
      "markCostAnomalyRemediationReady",
      "rejectCostAnomalyRemediationReview",
      "closeCostAnomalyRemediation",
      "upsertCostAnomalyWarningRule",
    ].includes(action)
  ) {
    return "报表中心";
  }
  if (["submitApproval", "approveApproval", "rejectApproval", "createFormulaCalculation"].includes(action)) return "审批算价";
  if (["markAlertRead", "dismissAlert", "upsertAlertSubscription"].includes(action)) return "经营总览";
  if (["upsertSystemSetting", "voidBusinessDocument", "reverseBusinessDocument", "upsertSupplierAdmissionRule", "submitSupplierAdmissionRuleChange"].includes(action)) return "系统管理";
  if (
    [
      "changeOwnPassword",
      "upsertUser",
      "resetUserPassword",
      "updateUserStatus",
      "upsertRolePermission",
      "resetDemo",
      "upsertCustomer",
      "deactivateCustomer",
      "upsertProduct",
      "deactivateProduct",
      "createBomVersion",
      "deactivateBom",
    ].includes(action)
  ) {
    return "系统管理";
  }
  return "通用权限";
}

function actionRiskLevel(action: string) {
  if (
    [
      "resetDemo",
      "resetUserPassword",
      "updateUserStatus",
      "upsertUser",
      "upsertRolePermission",
      "receivePurchaseOrder",
      "completeMaterialIqcInspection",
      "createTechnicalDisposition",
      "issueMaterials",
      "executeMaterialAdjustmentOrder",
      "reviewMaterialAdjustmentOrder",
      "resolveMaterialAdjustmentReviewException",
      "receiveFinishedGoods",
      "createShipment",
      "recordPayablePayment",
      "recordReceivableReceipt",
      "reverseBusinessDocument",
      "lockProductionPlan",
      "recordSalesReturn",
      "recordCustomerRefund",
      "createReplacementShipment",
      "createCostAnomalyRemediation",
      "closeCostAnomalyRemediation",
    ].includes(action)
  ) {
    return "高";
  }
  if (
    [
      "createPurchaseOrder",
      "createPurchaseRequisition",
      "generateMrpRequirementRun",
      "createPurchaseRequisitionFromMrp",
      "createPurchaseContract",
      "createPurchaseArrivalNotice",
      "registerPurchaseArrivalDiscrepancy",
      "resolvePurchaseArrivalDiscrepancy",
      "signPurchaseArrivalNotice",
      "createPurchaseOrderFromRequisition",
      "createMaterialIqcInspection",
      "recordInventoryAgingDisposition",
      "createStocktake",
      "approveStocktake",
      "rejectStocktake",
      "rejectMaterialRequisition",
      "ackProductionPlanNotification",
      "resolveProductionPlanChangeImpact",
      "confirmMaterialAdjustmentSuggestion",
      "executeMaterialAdjustmentOrder",
      "reviewMaterialAdjustmentOrder",
      "resolveMaterialAdjustmentReviewException",
      "markCostAnomalyRemediationReady",
      "rejectCostAnomalyRemediationReview",
      "upsertCostAnomalyWarningRule",
      "approveApproval",
      "rejectApproval",
      "upsertApprovalRule",
      "deactivateApprovalRule",
      "upsertSupplierAdmissionRule",
      "submitSupplierAdmissionRuleChange",
      "upsertAlertSubscription",
      "upsertSystemSetting",
      "voidBusinessDocument",
      "createBomVersion",
      "deactivateCustomer",
      "deactivateSupplier",
      "deactivateMaterial",
      "deactivateProduct",
      "deactivateBom",
    ].includes(action)
  ) {
    return "中";
  }
  return "低";
}

function roleLabel(role: string) {
  return (
    {
      sales: "销售员",
      assistant: "商务内勤",
      production: "生产主管",
      warehouse: "仓库管理员",
      purchasing: "采购员",
      quality: "品控员",
      technical: "技术部",
      manager: "管理层",
      finance: "财务专员",
      admin: "系统管理员",
    }[role] ?? role
  );
}

function systemSettingCategoryLabel(category: string) {
  return (
    {
      backup: "备份归档",
      security: "安全审计",
      archive: "硬盘归档",
      inventory: "库存策略",
      quality: "质量口径",
      finance: "财务账期",
      approval: "审批规则",
    }[category] ?? category
  );
}

function documentTypeLabel(documentType: string) {
  return (
    {
      quote: "报价单",
      sales_order: "销售订单",
      purchase_requisition: "采购申请单",
      purchase_order: "采购订单",
      purchase_contract: "采购合同",
      purchase_arrival_notice: "到货通知单",
      warehouse_signoff: "仓库签收单",
      approval_request: "审批单",
      production_cost_adjustment: "工单成本调整单",
      shipment: "发货单",
      delivery_note: "送货单",
      sales_return: "销售退货单",
      customer_refund: "客户退款单",
      replacement_shipment: "补开发货单",
      inspection: "质检报告",
      supplier_certificate: "供应商资质证书",
      supplier_annual_review: "供应商年度复评",
      system_health_remediation: "上线整改任务",
      payable: "应付凭证",
      receivable: "应收凭证",
    }[documentType] ?? documentType
  );
}

function initializationImportTypeLabel(type: string) {
  return (
    {
      "master-customers": "客户主数据",
      "master-suppliers": "供应商主数据",
      "master-materials": "物料主数据",
      "master-products": "产品主数据",
      "master-boms": "BOM 主数据",
      "opening-inventory": "期初库存",
      "opening-receivables": "期初应收",
      "opening-payables": "期初应付",
    }[type] ?? type
  );
}

function initializationImportStatusLabel(status: string) {
  return (
    {
      completed: "已导入",
      validated: "校验通过",
      validation_failed: "校验失败",
      failed: "导入失败",
    }[status] ?? status
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function ledgerTypeLabel(ledgerType: string) {
  return (
    {
      payable: "应付账款",
      receivable: "应收账款",
    }[ledgerType] ?? ledgerType
  );
}

function reversalTypeLabel(reversalType: string) {
  return (
    {
      purchase_inbound: "采购入库冲销",
      sales_shipment: "销售发货冲销",
      production_cost_adjustment: "工单成本调整红冲",
    }[reversalType] ?? reversalType
  );
}

function getStorageSummary() {
  const paths = getDataPaths();
  return {
    databaseBytes: fileSize(paths.database),
    attachmentsBytes: directorySize(paths.attachments),
    exportsBytes: directorySize(paths.exports),
    backupsBytes: directorySize(paths.backups),
    latestBackup: latestFile(paths.backups),
    restoreCommand: "npm run restore -- <backup.zip>",
    archiveNote: "更换硬盘时先生成冷备份，再将旧数据盘作为公司资产物理归档。",
  };
}

const systemHealthSeverityRank: Record<string, number> = {
  critical: 1,
  warning: 2,
  passed: 3,
};

function systemHealthStatusLabel(status: string) {
  return (
    {
      healthy: "具备上线条件",
      attention: "存在关注项",
      blocked: "存在上线阻断项",
      passed: "通过",
      warning: "关注",
      failed: "阻断",
    }[status] ?? status
  );
}

function systemHealthSeverityLabel(severity: string) {
  return (
    {
      critical: "阻断",
      warning: "关注",
      passed: "通过",
    }[severity] ?? severity
  );
}

function systemHealthRemediationStatusLabel(status: string) {
  return (
    {
      pending: "待整改",
      ready_for_review: "待复核",
      rejected: "复核驳回",
      closed: "已关闭",
      none: "未生成",
    }[status] ?? status
  );
}

function systemHealthReviewDecisionLabel(decision: string) {
  return (
    {
      submitted: "提交复核",
      rejected: "复核驳回",
      approved: "复核通过",
    }[decision] ?? decision
  );
}

function sampleNames(rows: Array<Record<string, unknown>>, fields: string[]) {
  return rows
    .slice(0, 5)
    .map((row) => fields.map((field) => row[field]).find((value) => value != null && String(value).trim() !== ""))
    .map((value) => String(value ?? "-"));
}

function buildSystemHealthChecks(input: {
  materials: Array<Record<string, unknown>>;
  batches: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
  suppliers: Array<Record<string, unknown>>;
  boms: Array<Record<string, unknown>>;
  approvalCenter: Array<Record<string, unknown>>;
  receivables: Array<Record<string, unknown>>;
  payables: Array<Record<string, unknown>>;
  inventoryAging: Array<Record<string, unknown>>;
  storage: Record<string, unknown>;
  lowYieldWarningCount: number;
  remediations?: Array<Record<string, unknown>>;
}) {
  const remediations = input.remediations ?? [];
  const remediationByHealthKey = new Map<string, Record<string, unknown>>();
  remediations.forEach((remediation) => {
    const healthKey = String(remediation.health_key ?? "");
    if (!healthKey) return;
    const existing = remediationByHealthKey.get(healthKey);
    if (!existing) {
      remediationByHealthKey.set(healthKey, remediation);
      return;
    }
    if (String(existing.status) === "closed" && String(remediation.status) !== "closed") {
      remediationByHealthKey.set(healthKey, remediation);
    }
  });
  const checks: Array<Record<string, unknown>> = [];
  const addCheck = (check: {
    key: string;
    category: string;
    title: string;
    description: string;
    count: number;
    severityWhenActive: "critical" | "warning";
    actionLabel: string;
    targetModule: string;
    sampleEntities?: string[];
  }) => {
    const active = check.count > 0;
    const severity = active ? check.severityWhenActive : "passed";
    const status = !active ? "passed" : severity === "critical" ? "failed" : "warning";
    const remediation = remediationByHealthKey.get(check.key);
    const remediationStatus = remediation ? String(remediation.status) : "none";
    checks.push({
      id: `health-${check.key}`,
      key: check.key,
      category: check.category,
      title: check.title,
      description: check.description,
      count: check.count,
      severity,
      severity_label: systemHealthSeverityLabel(severity),
      status,
      status_label: systemHealthStatusLabel(status),
      action_label: check.actionLabel,
      target_module: check.targetModule,
      sample_entities: check.sampleEntities ?? [],
      remediation_id: remediation?.id ?? "",
      remediation_no: remediation?.remediation_no ?? "",
      remediation_status: remediationStatus,
      remediation_status_label: systemHealthRemediationStatusLabel(remediationStatus),
      remediation_owner_name: remediation?.owner_name ?? "",
      remediation_action_plan: remediation?.action_plan ?? "",
      remediation_result_note: remediation?.result_note ?? "",
      rank: 0,
    });
  };

  const negativeMaterials = input.materials.filter((item) => Number(item.stock_qty ?? 0) < 0);
  const negativeBatches = input.batches.filter((item) => Number(item.qty ?? 0) < 0);
  const missingProductCodes = input.products.filter(
    (item) => String(item.status ?? "active") === "active" && !String(item.product_code ?? "").trim(),
  );
  const missingMaterialCodes = input.materials.filter(
    (item) => String(item.status ?? "active") === "active" && !String(item.material_code ?? "").trim(),
  );
  const missingCustomerCodes = input.customers.filter(
    (item) => String(item.status ?? "active") === "active" && !String(item.customer_code ?? "").trim(),
  );
  const missingSupplierCodes = input.suppliers.filter(
    (item) => String(item.status ?? "active") === "active" && !String(item.supplier_code ?? "").trim(),
  );
  const activeProducts = input.products.filter((item) => String(item.status ?? "active") === "active");
  const productsWithActiveBom = new Set(input.boms.filter((item) => String(item.status) === "active").map((item) => String(item.product_id)));
  const missingBomProducts = activeProducts.filter((item) => !productsWithActiveBom.has(String(item.id)));
  const overstockWithoutDisposition = input.inventoryAging.filter(
    (item) =>
      String(item.aging_status) === "overstock" &&
      !["closed", "disposed"].includes(String(item.disposition_status ?? "")),
  );
  const overdueReceivables = input.receivables.filter((item) => String(item.status) !== "paid" && daysUntil(item.due_date) < 0);
  const overduePayables = input.payables.filter((item) => String(item.status) !== "paid" && daysUntil(item.due_date) < 0);
  const overdueApprovals = input.approvalCenter.filter((item) => Boolean(item.is_overdue));
  const latestBackup = String(input.storage.latestBackup ?? "暂无备份");

  addCheck({
    key: "negative_inventory",
    category: "库存成本",
    title: "库存数量不得为负",
    description: "原材料批次、物料库存和成品库存上线前必须全部为非负数。",
    count: negativeMaterials.length + negativeBatches.length,
    severityWhenActive: "critical",
    actionLabel: "核查库存流水",
    targetModule: "采购仓储",
    sampleEntities: sampleNames([...negativeMaterials, ...negativeBatches], ["name", "material_name", "id"]),
  });
  addCheck({
    key: "product_code_missing",
    category: "主数据",
    title: "产品编码完整性",
    description: "启用产品必须具备正式编码，避免销售、生产、报表口径无法对齐。",
    count: missingProductCodes.length,
    severityWhenActive: "critical",
    actionLabel: "补齐产品编码",
    targetModule: "主数据",
    sampleEntities: sampleNames(missingProductCodes, ["name", "id"]),
  });
  addCheck({
    key: "material_code_missing",
    category: "主数据",
    title: "物料编码完整性",
    description: "启用物料必须具备正式编码，保证采购、仓储、BOM 和成本归集可追溯。",
    count: missingMaterialCodes.length,
    severityWhenActive: "critical",
    actionLabel: "补齐物料编码",
    targetModule: "主数据",
    sampleEntities: sampleNames(missingMaterialCodes, ["name", "id"]),
  });
  addCheck({
    key: "partner_code_missing",
    category: "主数据",
    title: "客户/供应商编码完整性",
    description: "正式客户和供应商建议全部具备编码，便于对账和外部财务系统导入。",
    count: missingCustomerCodes.length + missingSupplierCodes.length,
    severityWhenActive: "warning",
    actionLabel: "补齐往来单位编码",
    targetModule: "主数据",
    sampleEntities: sampleNames([...missingCustomerCodes, ...missingSupplierCodes], ["name", "id"]),
  });
  addCheck({
    key: "active_bom_missing",
    category: "生产基础",
    title: "启用产品 BOM 完整性",
    description: "启用产品上线前应具备有效 BOM，否则无法自动展开领料和成本核算。",
    count: missingBomProducts.length,
    severityWhenActive: "critical",
    actionLabel: "维护产品 BOM",
    targetModule: "生产执行",
    sampleEntities: sampleNames(missingBomProducts, ["name", "id"]),
  });
  addCheck({
    key: "overstock_disposition",
    category: "库存成本",
    title: "积压库存处置登记",
    description: "纳入积压报表的库存应登记责任人、处理计划和跟进状态。",
    count: overstockWithoutDisposition.length,
    severityWhenActive: "warning",
    actionLabel: "登记处置计划",
    targetModule: "采购仓储",
    sampleEntities: sampleNames(overstockWithoutDisposition, ["name", "id"]),
  });
  addCheck({
    key: "overdue_approval",
    category: "审批内控",
    title: "逾期审批清理",
    description: "上线切换前建议清理逾期审批，避免业务流转长时间停滞。",
    count: overdueApprovals.length,
    severityWhenActive: "warning",
    actionLabel: "处理逾期审批",
    targetModule: "审批算价",
    sampleEntities: sampleNames(overdueApprovals, ["request_no", "title", "id"]),
  });
  addCheck({
    key: "overdue_receivable",
    category: "财务台账",
    title: "逾期应收跟进",
    description: "逾期应收应纳入上线前经营关注，保证销售交付和现金流台账一致。",
    count: overdueReceivables.length,
    severityWhenActive: "warning",
    actionLabel: "跟进回款",
    targetModule: "财务台账",
    sampleEntities: sampleNames(overdueReceivables, ["receivable_no", "id"]),
  });
  addCheck({
    key: "overdue_payable",
    category: "财务台账",
    title: "逾期应付跟进",
    description: "逾期应付应在上线前确认付款计划和供应商对账状态。",
    count: overduePayables.length,
    severityWhenActive: "warning",
    actionLabel: "确认付款计划",
    targetModule: "财务台账",
    sampleEntities: sampleNames(overduePayables, ["payable_no", "id"]),
  });
  addCheck({
    key: "low_yield_warning",
    category: "质量收率",
    title: "低收率批次复盘",
    description: "低于系统收率预警线的批次应进入生产和质量复盘。",
    count: input.lowYieldWarningCount,
    severityWhenActive: "warning",
    actionLabel: "复盘收率异常",
    targetModule: "质检收率",
  });
  addCheck({
    key: "backup_status",
    category: "本地归档",
    title: "冷备份状态",
    description: "正式上线前必须至少生成一次完整冷备份，验证数据库、附件、导出文件可归档。",
    count: latestBackup === "暂无备份" ? 1 : 0,
    severityWhenActive: "warning",
    actionLabel: "生成冷备份",
    targetModule: "本地归档",
    sampleEntities: latestBackup === "暂无备份" ? ["暂无备份"] : [latestBackup],
  });

  return checks
    .sort((a, b) => {
      const severityDiff = systemHealthSeverityRank[String(a.severity)] - systemHealthSeverityRank[String(b.severity)];
      if (severityDiff !== 0) return severityDiff;
      return Number(b.count ?? 0) - Number(a.count ?? 0) || String(a.category).localeCompare(String(b.category));
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildSystemHealthSummary(checks: Array<Record<string, unknown>>) {
  const criticalCount = checks.filter((item) => item.severity === "critical").reduce((sum, item) => sum + Number(item.count ?? 0), 0);
  const warningCount = checks.filter((item) => item.severity === "warning").reduce((sum, item) => sum + Number(item.count ?? 0), 0);
  const passedCount = checks.filter((item) => item.status === "passed").length;
  const openRemediationCount = new Set(
    checks
      .filter((item) => item.remediation_id && item.remediation_status !== "closed")
      .map((item) => String(item.remediation_id)),
  ).size;
  const closedRemediationCount = new Set(
    checks
      .filter((item) => item.remediation_id && item.remediation_status === "closed")
      .map((item) => String(item.remediation_id)),
  ).size;
  const score = Math.max(0, Math.round(100 - criticalCount * 20 - warningCount * 8));
  const status = criticalCount > 0 ? "blocked" : warningCount > 0 ? "attention" : "healthy";
  return {
    status,
    status_label: systemHealthStatusLabel(status),
    score,
    critical_count: criticalCount,
    warning_count: warningCount,
    passed_count: passedCount,
    total_count: checks.length,
    open_remediation_count: openRemediationCount,
    closed_remediation_count: closedRemediationCount,
    generated_at: now(),
  };
}

function systemHealthRemediationRows(database: Database.Database) {
  return database.prepare(`
    SELECT shr.*,
           owner.name AS owner_name,
           owner.role AS owner_role,
           owner.role_label AS owner_role_label,
           creator.name AS created_by_name,
           submitter.name AS submitted_by_name,
           closer.name AS closed_by_name,
           latest.decision AS latest_review_decision,
           latest.review_note AS latest_review_note,
           latest.reviewed_at AS latest_reviewed_at,
           latestReviewer.name AS latest_reviewer_name,
           COALESCE(reviewCounts.review_record_count, 0) AS review_record_count
    FROM system_health_remediations shr
    LEFT JOIN users owner ON owner.id = shr.owner_id
    LEFT JOIN users creator ON creator.id = shr.created_by
    LEFT JOIN users submitter ON submitter.id = shr.submitted_by
    LEFT JOIN users closer ON closer.id = shr.closed_by
    LEFT JOIN (
      SELECT r.*
      FROM system_health_remediation_reviews r
      JOIN (
        SELECT remediation_id, MAX(reviewed_at) AS max_reviewed_at
        FROM system_health_remediation_reviews
        GROUP BY remediation_id
      ) latestRows ON latestRows.remediation_id = r.remediation_id AND latestRows.max_reviewed_at = r.reviewed_at
    ) latest ON latest.remediation_id = shr.id
    LEFT JOIN users latestReviewer ON latestReviewer.id = latest.reviewer_id
    LEFT JOIN (
      SELECT remediation_id, COUNT(*) AS review_record_count
      FROM system_health_remediation_reviews
      GROUP BY remediation_id
    ) reviewCounts ON reviewCounts.remediation_id = shr.id
    ORDER BY CASE WHEN shr.status = 'closed' THEN 1 ELSE 0 END ASC, shr.created_at DESC
    LIMIT 80
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      status_label: systemHealthRemediationStatusLabel(String(row.status)),
      severity_label: systemHealthSeverityLabel(String(row.severity)),
      latest_review_decision_label: row.latest_review_decision
        ? systemHealthReviewDecisionLabel(String(row.latest_review_decision))
        : "",
      age_days: calculateAgeDays({ fromDate: String(row.created_at) }),
      due_days: daysUntil(row.due_date),
      is_overdue: daysUntil(row.due_date) < 0,
      review_attachment_count: Number(
        (database.prepare(`
          SELECT COUNT(*) AS count
          FROM document_attachments
          WHERE entity_type = 'system_health_remediation' AND entity_id = ?
        `).get(row.id) as { count: number }).count,
      ),
      source_snapshot: parseJsonRecord(row.source_snapshot_json),
    };
  });
}

function systemHealthRemediationReviewRows(database: Database.Database) {
  return database.prepare(`
    SELECT r.*,
           remediation.title AS remediation_title,
           remediation.health_key,
           reviewer.name AS reviewer_name,
           reviewer.role_label AS reviewer_role_label
    FROM system_health_remediation_reviews r
    JOIN system_health_remediations remediation ON remediation.id = r.remediation_id
    JOIN users reviewer ON reviewer.id = r.reviewer_id
    ORDER BY r.reviewed_at DESC
    LIMIT 120
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      decision_label: systemHealthReviewDecisionLabel(String(row.decision)),
    };
  });
}

function costAnomalyRemediationRows(database: Database.Database) {
  return database.prepare(`
    SELECT car.*,
           pca.adjustment_no,
           pca.adjustment_amount,
           pca.status AS adjustment_status,
           po.prod_no,
           o.order_no,
           c.name AS customer_name,
           p.name AS product_name,
           exception.exception_no,
           owner.name AS owner_name,
           owner.role AS owner_role,
           owner.role_label AS owner_role_label,
           creator.name AS created_by_name,
           submitter.name AS submitted_by_name,
           closer.name AS closed_by_name,
           latest.decision AS latest_review_decision,
           latest.review_note AS latest_review_note,
           latest.reviewed_at AS latest_reviewed_at,
           latestReviewer.name AS latest_reviewer_name,
           COALESCE(reviewCounts.review_record_count, 0) AS review_record_count
    FROM production_cost_anomaly_remediations car
    JOIN production_cost_adjustments pca ON pca.id = car.adjustment_id
    JOIN production_orders po ON po.id = car.production_order_id
    JOIN orders o ON o.id = car.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN production_material_adjustment_review_exceptions exception ON exception.id = car.exception_id
    LEFT JOIN users owner ON owner.id = car.owner_id
    LEFT JOIN users creator ON creator.id = car.created_by
    LEFT JOIN users submitter ON submitter.id = car.submitted_by
    LEFT JOIN users closer ON closer.id = car.closed_by
    LEFT JOIN (
      SELECT r.*
      FROM production_cost_anomaly_remediation_reviews r
      JOIN (
        SELECT remediation_id, MAX(reviewed_at) AS max_reviewed_at
        FROM production_cost_anomaly_remediation_reviews
        GROUP BY remediation_id
      ) latestRows ON latestRows.remediation_id = r.remediation_id AND latestRows.max_reviewed_at = r.reviewed_at
    ) latest ON latest.remediation_id = car.id
    LEFT JOIN users latestReviewer ON latestReviewer.id = latest.reviewer_id
    LEFT JOIN (
      SELECT remediation_id, COUNT(*) AS review_record_count
      FROM production_cost_anomaly_remediation_reviews
      GROUP BY remediation_id
    ) reviewCounts ON reviewCounts.remediation_id = car.id
    ORDER BY CASE WHEN car.status = 'closed' THEN 1 ELSE 0 END ASC, car.created_at DESC
    LIMIT 120
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      status_label: costAnomalyRemediationStatusLabel(String(row.status)),
      severity_label: costAnomalySeverityLabel(String(row.severity)),
      adjustment_status_label: productionCostAdjustmentStatusLabel(String(row.adjustment_status)),
      latest_review_decision_label: row.latest_review_decision
        ? costAnomalyRemediationDecisionLabel(String(row.latest_review_decision))
        : "",
      age_days: calculateAgeDays({ fromDate: String(row.created_at) }),
      due_days: daysUntil(row.due_date),
      is_overdue: daysUntil(row.due_date) < 0 && String(row.status) !== "closed",
      source_snapshot: parseJsonRecord(row.source_snapshot_json),
    };
  });
}

function costAnomalyRemediationReviewRows(database: Database.Database) {
  return database.prepare(`
    SELECT r.*,
           remediation.adjustment_id,
           remediation.root_cause,
           remediation.corrective_action,
           pca.adjustment_no,
           po.prod_no,
           o.order_no,
           c.name AS customer_name,
           reviewer.name AS reviewer_name,
           reviewer.role_label AS reviewer_role_label
    FROM production_cost_anomaly_remediation_reviews r
    JOIN production_cost_anomaly_remediations remediation ON remediation.id = r.remediation_id
    JOIN production_cost_adjustments pca ON pca.id = remediation.adjustment_id
    JOIN production_orders po ON po.id = remediation.production_order_id
    JOIN orders o ON o.id = remediation.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN users reviewer ON reviewer.id = r.reviewer_id
    ORDER BY r.reviewed_at DESC
    LIMIT 160
  `).all().map((item) => {
    const row = item as Record<string, unknown>;
    return {
      ...row,
      decision_label: costAnomalyRemediationDecisionLabel(String(row.decision)),
    };
  });
}

type CostAnomalyWarningRuleRow = {
  id: string;
  rule_code: string;
  rule_name: string;
  metric_key: string;
  operator: string;
  threshold_value: number;
  window_days: number;
  severity: string;
  owner_id: string;
  auto_create_remediation: number;
  priority: number;
  status: string;
  description: string;
};

type CostAnomalyWarningRuleInput = ReturnType<typeof costAnomalyWarningRulePayload>;

function costAnomalyWarningRuleStatusValue(value: string) {
  if (["active", "inactive"].includes(value)) return value;
  throw new Error("成本异常预警规则状态不正确。");
}

function costAnomalyWarningMetricValue(value: string) {
  if (["single_adjustment_amount", "material_anomaly_count", "work_order_reversal_count"].includes(value)) return value;
  throw new Error("成本异常预警规则指标不正确。");
}

function costAnomalyWarningRulePayload(rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const ruleCode = payloadText(payload, "rule_code", "规则编号");
  if (!/^[A-Z0-9][A-Z0-9_-]{2,40}$/.test(ruleCode)) throw new Error("规则编号需为 3-41 位大写字母、数字、横线或下划线。");
  const ruleName = payloadText(payload, "rule_name", "规则名称");
  const metricKey = costAnomalyWarningMetricValue(payloadText(payload, "metric_key", "预警指标"));
  const operator = supplierAdmissionRuleOperatorValue(payloadText(payload, "operator", "触发条件"));
  const thresholdValue = roundMoney(payloadNumber(payload, "threshold_value", "阈值", { min: 0 }));
  const windowDays = Math.round(payloadNumber(payload, "window_days", "统计窗口天数", { min: 0 }));
  const severity = costAnomalySeverityValue(payloadText(payload, "severity", "整改等级", false) || "medium");
  const ownerId = payloadText(payload, "owner_id", "整改责任人");
  const autoCreateRemediation = booleanPayload(payload, "auto_create_remediation", true) ? 1 : 0;
  const priority = Math.round(payloadNumber(payload, "priority", "规则优先级", { min: 0 }));
  const status = costAnomalyWarningRuleStatusValue(payloadText(payload, "status", "规则状态", false) || "active");
  return {
    ruleCode,
    ruleName,
    metricKey,
    operator,
    thresholdValue,
    windowDays,
    severity,
    ownerId,
    autoCreateRemediation,
    priority,
    status,
    description: payloadText(payload, "description", "规则说明", false),
  };
}

function costAnomalyWarningRuleRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT cawr.*,
           owner.name AS owner_name,
           owner.role AS owner_role,
           owner.role_label AS owner_role_label,
           creator.name AS created_by_name,
           updater.name AS updated_by_name,
           COALESCE(eventCounts.event_count, 0) AS event_count,
           COALESCE(eventCounts.remediation_event_count, 0) AS remediation_event_count
    FROM production_cost_anomaly_warning_rules cawr
    LEFT JOIN users owner ON owner.id = cawr.owner_id
    LEFT JOIN users creator ON creator.id = cawr.created_by
    LEFT JOIN users updater ON updater.id = cawr.updated_by
    LEFT JOIN (
      SELECT rule_id,
             COUNT(*) AS event_count,
             SUM(CASE WHEN remediation_id IS NOT NULL THEN 1 ELSE 0 END) AS remediation_event_count
      FROM production_cost_anomaly_warning_events
      GROUP BY rule_id
    ) eventCounts ON eventCounts.rule_id = cawr.id
    ORDER BY CASE WHEN cawr.status = 'active' THEN 0 ELSE 1 END ASC, cawr.priority DESC, cawr.rule_code ASC
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    metric_label: costAnomalyWarningMetricLabel(String(row.metric_key)),
    operator_label: supplierAdmissionOperatorLabel(String(row.operator)),
    severity_label: costAnomalySeverityLabel(String(row.severity)),
    status_label: supplierAdmissionRuleStatusLabel(String(row.status)),
    auto_create_remediation_label: Number(row.auto_create_remediation) ? "自动生成整改" : "仅记录事件",
    window_label: Number(row.window_days ?? 0) > 0 ? `${Number(row.window_days)} 天` : "不限定",
  }));
}

function costAnomalyWarningEventRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT event.*,
           rule.severity,
           rule.owner_id,
           owner.name AS owner_name,
           owner.role AS owner_role,
           owner.role_label AS owner_role_label,
           pca.adjustment_no,
           pca.adjustment_amount,
           pca.status AS adjustment_status,
           po.prod_no,
           o.order_no,
           c.name AS customer_name,
           p.name AS product_name,
           m.material_code,
           m.name AS material_name,
           remediation.remediation_no,
           remediation.status AS remediation_status,
           triggerUser.name AS triggered_by_name
    FROM production_cost_anomaly_warning_events event
    JOIN production_cost_anomaly_warning_rules rule ON rule.id = event.rule_id
    JOIN production_cost_adjustments pca ON pca.id = event.adjustment_id
    JOIN production_orders po ON po.id = event.production_order_id
    JOIN orders o ON o.id = event.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN materials m ON m.id = event.material_id
    LEFT JOIN production_cost_anomaly_remediations remediation ON remediation.id = event.remediation_id
    LEFT JOIN users owner ON owner.id = rule.owner_id
    JOIN users triggerUser ON triggerUser.id = event.triggered_by
    ORDER BY event.triggered_at DESC
    LIMIT 180
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    metric_label: costAnomalyWarningMetricLabel(String(row.metric_key)),
    event_status_label: costAnomalyWarningEventStatusLabel(String(row.event_status)),
    severity_label: costAnomalySeverityLabel(String(row.severity)),
    adjustment_status_label: productionCostAdjustmentStatusLabel(String(row.adjustment_status)),
    remediation_status_label: row.remediation_status ? costAnomalyRemediationStatusLabel(String(row.remediation_status)) : "",
  }));
}

function costAnomalyWarningDashboardRows(events: Array<Record<string, unknown>>) {
  const openEvents = events.filter((event) => String(event.remediation_status ?? "") !== "closed");
  const bySeverityMap = new Map<string, Record<string, unknown>>();
  events.forEach((event) => {
    const severity = String(event.severity ?? "medium");
    const current =
      bySeverityMap.get(severity) ??
      ({
        severity,
        severity_label: costAnomalySeverityLabel(severity),
        count: 0,
        open_count: 0,
        adjustment_amount: 0,
      } satisfies Record<string, unknown>);
    current.count = Number(current.count ?? 0) + 1;
    if (String(event.remediation_status ?? "") !== "closed") current.open_count = Number(current.open_count ?? 0) + 1;
    current.adjustment_amount = roundMoney(Number(current.adjustment_amount ?? 0) + Math.abs(Number(event.adjustment_amount ?? 0)));
    bySeverityMap.set(severity, current);
  });
  const bySeverity = Array.from(bySeverityMap.values()).sort(
    (a, b) => (alertSeverityRank[String(a.severity)] ?? 9) - (alertSeverityRank[String(b.severity)] ?? 9),
  );
  return {
    totals: {
      total_count: events.length,
      open_count: openEvents.length,
      critical_count: events.filter((event) => String(event.severity) === "critical").length,
      high_count: events.filter((event) => String(event.severity) === "high").length,
      remediation_count: events.filter((event) => event.remediation_id).length,
      unresolved_amount: roundMoney(openEvents.reduce((sum, event) => sum + Math.abs(Number(event.adjustment_amount ?? 0)), 0)),
    },
    bySeverity,
    recentEvents: events.slice(0, 8),
  };
}

function buildSystemHealthChecksFromDatabase(database: Database.Database, remediations: Array<Record<string, unknown>> = []) {
  const operatingParameters = operatingParameterValues(database);
  const dispositions = database.prepare(`
    SELECT iad.*, owner.name AS owner_name
    FROM inventory_aging_dispositions iad
    LEFT JOIN users owner ON owner.id = iad.owner_id
    ORDER BY iad.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  const latestDispositionByMaterial = new Map<string, Record<string, unknown>>();
  dispositions.forEach((disposition) => {
    const materialId = String(disposition.material_id);
    if (!latestDispositionByMaterial.has(materialId)) latestDispositionByMaterial.set(materialId, disposition);
  });
  const materials = (database.prepare(`
    SELECT m.*,
           COALESCE((SELECT COUNT(*) FROM material_batches mb WHERE mb.material_id = m.id AND mb.qty > 0), 0) AS batch_count
    FROM materials m
    ORDER BY m.id
  `).all() as Array<Record<string, unknown>>).map((item) => {
    const aging = classifyInventoryAging({
      lastMovementAt: String(item.last_movement_at ?? ""),
      staleWarningDays: operatingParameters.staleWarningDays,
      overstockDays: operatingParameters.overstockDays,
    });
    const disposition = latestDispositionByMaterial.get(String(item.id));
    return {
      ...item,
      inactive_days: aging.inactiveDays,
      aging_status: aging.status,
      disposition_status: disposition?.status ?? "",
    };
  });
  const batches = database.prepare(`
    SELECT mb.*, m.name AS material_name, m.unit
    FROM material_batches mb
    JOIN materials m ON m.id = mb.material_id
    ORDER BY mb.received_at ASC
  `).all() as Array<Record<string, unknown>>;
  const products = database.prepare("SELECT * FROM products").all() as Array<Record<string, unknown>>;
  const customers = database.prepare("SELECT * FROM customers").all() as Array<Record<string, unknown>>;
  const suppliers = database.prepare("SELECT * FROM suppliers").all() as Array<Record<string, unknown>>;
  const boms = database.prepare("SELECT * FROM boms").all() as Array<Record<string, unknown>>;
  const approvalRules = approvalRuleRows(database);
  const approvalRequests = database.prepare(`
    SELECT ar.id, ar.request_no, ar.type, ar.title, ar.applicant_id, ar.status, ar.amount,
           ar.reason, ar.rule_id, COALESCE(ar.approver_role, rule.approver_role, 'manager') AS approver_role,
           COALESCE(ar.sla_hours, rule.sla_hours, 48) AS sla_hours,
           ar.entity_type, ar.entity_id, ar.created_at,
           applicant.name AS applicant_name, rule.rule_code, rule.rule_name
    FROM approval_requests ar
    JOIN users applicant ON applicant.id = ar.applicant_id
    LEFT JOIN approval_rules rule ON rule.id = ar.rule_id
    ORDER BY ar.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  const approvalCenter = approvalCenterRows({
    approvalRequests,
    purchaseRequisitions: [],
    stocktakes: [],
    requisitions: [],
    approvalRules,
    operatingParameters,
  });
  const receivables = database.prepare("SELECT * FROM receivables").all() as Array<Record<string, unknown>>;
  const payables = database.prepare("SELECT * FROM payables").all() as Array<Record<string, unknown>>;
  const inventoryAging = materials.filter((item) => item.aging_status !== "normal");
  const lowYieldWarningCount = (
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM inspections
      WHERE COALESCE(yield_rate, 0) > 0 AND yield_rate < ?
    `).get(operatingParameters.yieldWarningRate) as { count: number }
  ).count;
  return buildSystemHealthChecks({
    materials,
    batches,
    products,
    customers,
    suppliers,
    boms,
    approvalCenter,
    receivables,
    payables,
    inventoryAging,
    storage: getStorageSummary(),
    lowYieldWarningCount,
    remediations,
  });
}

function fileSize(filePath: string) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function directorySize(dirPath: string): number {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true }).reduce((sum, entry) => {
      const fullPath = path.join(dirPath, entry.name);
      return sum + (entry.isDirectory() ? directorySize(fullPath) : fileSize(fullPath));
    }, 0);
  } catch {
    return 0;
  }
}

function latestFile(dirPath: string) {
  try {
    const files = fs
      .readdirSync(dirPath)
      .map((name) => ({ name, fullPath: path.join(dirPath, name), mtimeMs: fs.statSync(path.join(dirPath, name)).mtimeMs }))
      .filter((item) => fs.statSync(item.fullPath).isFile())
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.name ?? "暂无备份";
  } catch {
    return "暂无备份";
  }
}

function productionStageScore(status: string) {
  const score: Record<string, number> = {
    instructed: 20,
    material_requested: 35,
    producing: 55,
    inspection_requested: 70,
    qa_approved: 82,
    in_stock: 92,
    shipped: 100,
    qa_failed: 68,
  };
  return score[status] ?? 0;
}

function buildTasks(
  user: UserRow,
  data: {
    quotes: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
    productions: Array<Record<string, unknown>>;
    requisitions: Array<Record<string, unknown>>;
    inspections: Array<Record<string, unknown>>;
    technicalDispositions: Array<Record<string, unknown>>;
    materialIqcInspections: Array<Record<string, unknown>>;
    purchaseOrders: Array<Record<string, unknown>>;
    productionPlanNotifications: Array<Record<string, unknown>>;
    productionPlanChangeImpacts: Array<Record<string, unknown>>;
    productionMaterialAdjustmentSuggestions: Array<Record<string, unknown>>;
    productionMaterialAdjustmentOrders: Array<Record<string, unknown>>;
    productionMaterialAdjustmentReviewExceptions?: Array<Record<string, unknown>>;
    purchaseArrivalDiscrepancies: Array<Record<string, unknown>>;
    mrpRequirementRuns?: Array<Record<string, unknown>>;
    payables: Array<Record<string, unknown>>;
    receivables: Array<Record<string, unknown>>;
    materials: Array<Record<string, unknown>>;
    shipments: Array<Record<string, unknown>>;
    approvalRequests: Array<Record<string, unknown>>;
    stocktakes: Array<Record<string, unknown>>;
    systemHealthRemediations?: Array<Record<string, unknown>>;
    supplierCorrectiveActions?: Array<Record<string, unknown>>;
    supplierQualificationCertificates?: Array<Record<string, unknown>>;
    supplierAnnualReviewDue?: Array<Record<string, unknown>>;
    costAnomalyRemediations?: Array<Record<string, unknown>>;
    costAnomalyWarningEvents?: Array<Record<string, unknown>>;
    alertSubscriptions?: Array<Record<string, unknown>>;
  },
): Task[] {
  const costWarningSubscription = (data.alertSubscriptions ?? []).find(
    (item) => String(item.role) === user.role && String(item.alert_type) === "cost_anomaly_warning",
  );
  const shouldRouteCostWarningToTasks = (event: Record<string, unknown>) => {
    if (!costWarningSubscription) return ["manager", "finance", "admin"].includes(user.role);
    return (
      Number(costWarningSubscription.enabled ?? 1) === 1 &&
      Number(costWarningSubscription.route_to_tasks ?? 1) === 1 &&
      severityAllows(event.severity, costWarningSubscription.min_severity ?? "low")
    );
  };
  const costAnomalyWarningNoticeTasks = (data.costAnomalyWarningEvents ?? [])
    .filter((item) => String(item.remediation_status ?? "") !== "closed" && shouldRouteCostWarningToTasks(item))
    .slice(0, 5)
    .map((item) => ({
      id: `task-cost-anomaly-warning-${item.id}`,
      title: `成本异常预警 ${item.event_no}`,
      detail: `${item.rule_name} / ${item.prod_no ?? "-"} / ${item.trigger_reason ?? ""}`,
      entityType: "cost_anomaly_warning",
      entityId: `alert-cost-anomaly-warning-${item.id}`,
      action: "markAlertRead",
      tone: ["critical", "high"].includes(String(item.severity)) ? ("rose" as const) : ("amber" as const),
      primaryLabel: "标记已读",
      payload: { alert_type: "cost_anomaly_warning" },
    }));
  const costAnomalyOwnerTasks = (data.costAnomalyRemediations ?? [])
    .filter((item) => String(item.owner_id) === user.id && ["pending", "rejected"].includes(String(item.status)))
    .slice(0, 6)
    .map((item) => ({
      id: `task-cost-anomaly-remediation-owner-${item.id}`,
      title: `成本异常整改 ${item.remediation_no}`,
      detail: `${item.adjustment_no} / ${item.prod_no} / 到期日 ${item.due_date ?? "-"}${item.is_overdue ? " / 已逾期" : ""}`,
      entityType: "production_cost_anomaly_remediation",
      entityId: String(item.id),
      action: "markCostAnomalyRemediationReady",
      tone: item.is_overdue ? ("rose" as const) : ("amber" as const),
      primaryLabel: String(item.status) === "rejected" ? "重新提交" : "提交复核",
      payload: {
        result_note: "已完成原因分析、纠正措施和预防措施，提交复核。",
      },
    }));
  const costAnomalyReviewTasks = (data.costAnomalyRemediations ?? [])
    .filter((item) => String(item.status) === "ready_for_review" && ["manager", "finance", "admin"].includes(user.role))
    .slice(0, 6)
    .map((item) => ({
      id: `task-cost-anomaly-remediation-review-${item.id}`,
      title: `复核成本异常整改 ${item.remediation_no}`,
      detail: `${item.adjustment_no} / ${item.prod_no} / ${item.owner_name ?? "-"}`,
      entityType: "production_cost_anomaly_remediation",
      entityId: String(item.id),
      action: "closeCostAnomalyRemediation",
      tone: "blue" as const,
      primaryLabel: "关闭整改",
      payload: { result_note: "整改资料完整，成本异常闭环。" },
    }));
  const costAnomalyTasks = [...costAnomalyWarningNoticeTasks, ...costAnomalyOwnerTasks, ...costAnomalyReviewTasks];
  const remediationOwnerTasks = (data.systemHealthRemediations ?? [])
    .filter((remediation) => String(remediation.owner_id) === user.id && ["pending", "rejected"].includes(String(remediation.status)))
    .map((remediation) => ({
      id: `task-remediation-owner-${remediation.id}`,
      title: `整改提交复核 ${remediation.remediation_no}`,
      detail: `${remediation.title} / 到期日 ${remediation.due_date ?? "-"}${remediation.latest_review_note ? ` / ${remediation.latest_review_note}` : ""}${remediation.is_overdue ? " / 已逾期" : ""}`,
      entityType: "system_health_remediation",
      entityId: String(remediation.id),
      action: "markSystemHealthRemediationReady",
      tone: remediation.is_overdue ? ("rose" as const) : ("amber" as const),
      primaryLabel: String(remediation.status) === "rejected" ? "重新提交" : "提交复核",
    }));
  const remediationReviewTasks = (data.systemHealthRemediations ?? [])
    .filter((remediation) => String(remediation.status) === "ready_for_review" && ["manager", "admin"].includes(user.role))
    .map((remediation) => ({
      id: `task-remediation-review-${remediation.id}`,
      title: `复核整改 ${remediation.remediation_no}`,
      detail: `${remediation.title} / 附件 ${Number(remediation.review_attachment_count ?? 0)} 个`,
      entityType: "system_health_remediation",
      entityId: String(remediation.id),
      action: "closeSystemHealthRemediation",
      tone: "blue" as const,
      primaryLabel: "关闭整改",
      payload: { result_note: "整改复核通过，关闭问题。" },
    }));
  const remediationTasks = [...remediationOwnerTasks, ...remediationReviewTasks];
  const supplierCorrectionOwnerTasks = (data.supplierCorrectiveActions ?? [])
    .filter(
      (item) =>
        String(item.owner_id) === user.id &&
        ["open", "rejected"].includes(String(item.status)),
    )
    .map((item) => ({
      id: `task-supplier-correction-owner-${item.id}`,
      title: `供应商整改 ${item.action_no}`,
      detail: `${item.supplier_name} / ${item.due_date}${item.is_overdue ? " / 已逾期" : ""}`,
      entityType: "supplier_corrective_action",
      entityId: String(item.id),
      action: "submitSupplierCorrection",
      tone: item.is_overdue ? ("rose" as const) : ("amber" as const),
      primaryLabel: String(item.status) === "rejected" ? "重新提交" : "提交整改",
      payload: {
        evidence_note: "供应商已提交整改材料，采购责任人完成初审，提交管理层复评。",
      },
    }));
  const supplierCorrectionReviewTasks = (data.supplierCorrectiveActions ?? [])
    .filter((item) => String(item.status) === "submitted" && ["manager", "admin"].includes(user.role))
    .map((item) => ({
      id: `task-supplier-correction-review-${item.id}`,
      title: `供应商复评 ${item.action_no}`,
      detail: `${item.supplier_name} / ${item.control_status_label}`,
      entityType: "supplier_corrective_action",
      entityId: String(item.id),
      action: "reviewSupplierCorrection",
      tone: "blue" as const,
      primaryLabel: "复评通过",
      payload: {
        result: "passed",
        reassessment_score: "85",
        review_note: "整改资料齐全，恢复采购准入并纳入观察。",
      },
    }));
  const supplierCertificateTasks = (data.supplierQualificationCertificates ?? [])
    .filter(
      (item) =>
        ["expired", "expiring"].includes(String(item.expiry_status)) &&
        ["purchasing", "manager", "admin"].includes(user.role),
    )
    .slice(0, 5)
    .map((item) => ({
      id: `task-supplier-certificate-${item.id}`,
      title: `资质到期 ${item.certificate_name}`,
      detail: `${item.supplier_name} / ${item.expiry_status_label} / 到期日 ${item.expires_at}`,
      entityType: "supplier_qualification_certificate",
      entityId: String(item.id),
      action: "renewSupplierCertificate",
      tone: String(item.expiry_status) === "expired" ? ("rose" as const) : ("amber" as const),
      primaryLabel: "续证",
      payload: {
        certificate_type: String(item.certificate_type || "other"),
        certificate_name: String(item.certificate_name || "供应商资质证书"),
        certificate_no: `${String(item.certificate_no || "CERT")}-NEW`,
        issued_at: new Date().toISOString().slice(0, 10),
        expires_at: `${new Date().getFullYear() + 1}-12-31`,
        remind_days: String(item.remind_days || 90),
        note: "供应商已补充新版资质证书，系统更新到期提醒。",
      },
    }));
  const supplierAnnualReviewTasks = (data.supplierAnnualReviewDue ?? [])
    .filter(() => ["purchasing", "manager", "admin"].includes(user.role))
    .slice(0, 5)
    .map((item) => ({
      id: `task-supplier-annual-review-${item.supplier_id}`,
      title: `年度复评 ${item.supplier_name}`,
      detail: `${item.due_reason} / 最近年度 ${item.latest_review_year || "无"}`,
      entityType: "supplier_annual_review",
      entityId: String(item.supplier_id),
      action: "recordSupplierAnnualReview",
      tone: "blue" as const,
      primaryLabel: "完成复评",
      payload: {
        review_year: String(new Date().getFullYear()),
        quality_score: "86",
        delivery_score: "86",
        certificate_score: "86",
        cooperation_score: "86",
        final_score: "86",
        conclusion: "年度复评通过，供应商表现稳定，维持准入。",
        next_review_due_at: `${new Date().getFullYear() + 1}-12-31`,
      },
    }));
  const supplierGovernanceTasks = [
    ...supplierCorrectionOwnerTasks,
    ...supplierCorrectionReviewTasks,
    ...supplierCertificateTasks,
    ...supplierAnnualReviewTasks,
  ];
  const productionPlanNotificationTasks = data.productionPlanNotifications
    .filter(
      (item) =>
        String(item.status) === "pending" &&
        (String(item.recipient_role) === user.role || user.role === "admin" || (user.role === "manager" && String(item.recipient_role) === "manager")),
    )
    .slice(0, 6)
    .map((item) => ({
      id: `task-production-plan-notification-${item.id}`,
      title: `生产计划变更 ${item.prod_no}`,
      detail: `${item.plan_no} / ${item.product_name} / ${item.old_planned_date || "未排产"} -> ${item.new_planned_date}`,
      entityType: "production_plan_notification",
      entityId: String(item.id),
      action: "ackProductionPlanNotification",
      tone: "amber" as const,
      primaryLabel: "确认变更",
      payload: {
        acknowledge_note: "已同步生产计划变更。",
      },
    }));
  const productionPlanChangeImpactTasks = data.productionPlanChangeImpacts
    .filter((item) => {
      if (String(item.status) !== "pending") return false;
      if (String(item.affected_role) === user.role || user.role === "admin") return true;
      return user.role === "manager" && ["high", "critical"].includes(String(item.severity));
    })
    .slice(0, 8)
    .map((item) => ({
      id: `task-production-plan-impact-${item.id}`,
      title: String(item.impact_type_label ?? "生产计划变更影响"),
      detail: `${item.prod_no} / ${item.product_name} / ${item.summary}`,
      entityType: "production_plan_change_impact",
      entityId: String(item.id),
      action: "resolveProductionPlanChangeImpact",
      tone: ["high", "critical"].includes(String(item.severity)) ? ("rose" as const) : ("amber" as const),
      primaryLabel: "处理影响",
      payload: {
        resolution_note: "已确认影响并同步调整责任事项。",
      },
    }));
  const materialAdjustmentSuggestionTasks = data.productionMaterialAdjustmentSuggestions
    .filter((item) => String(item.status) === "pending_confirmation" && ["production", "admin"].includes(user.role))
    .slice(0, 6)
    .map((item) => ({
      id: `task-material-adjustment-suggestion-${item.id}`,
      title: `确认补退料建议 ${item.suggestion_no}`,
      detail: `${item.prod_no} / ${item.adjustment_type_label} / ${item.suggested_qty}`,
      entityType: "material_adjustment_suggestion",
      entityId: String(item.id),
      action: "confirmMaterialAdjustmentSuggestion",
      tone: "blue" as const,
      primaryLabel: "确认转正式单",
      payload: {
        confirmation_note: "生产确认补退料建议，转正式补退料单执行。",
      },
    }));
  const materialAdjustmentOrderTasks = data.productionMaterialAdjustmentOrders
    .filter((item) => String(item.status) === "pending_execution" && ["warehouse", "admin"].includes(user.role))
    .slice(0, 6)
    .map((item) => ({
      id: `task-material-adjustment-order-${item.id}`,
      title: `执行补退料单 ${item.order_no}`,
      detail: `${item.prod_no} / ${item.adjustment_type_label} / ${item.qty}`,
      entityType: "material_adjustment_order",
      entityId: String(item.id),
      action: "executeMaterialAdjustmentOrder",
      tone: "amber" as const,
      primaryLabel: "执行补退料",
      payload: {
        execution_note: "仓库按正式补退料单完成库存执行。",
      },
    }));
  const materialAdjustmentReviewTasks = data.productionMaterialAdjustmentOrders
    .filter(
      (item) =>
        String(item.status) === "executed" &&
        String(item.review_status) === "pending_review" &&
        ["warehouse", "admin"].includes(user.role),
    )
    .slice(0, 6)
    .map((item) => ({
      id: `task-material-adjustment-review-${item.id}`,
      title: `复核补退料成本 ${item.order_no}`,
      detail: `${item.prod_no} / 成本影响 ¥${Number(item.cost_impact_amount ?? 0).toLocaleString("zh-CN")}`,
      entityType: "material_adjustment_order",
      entityId: String(item.id),
      action: "reviewMaterialAdjustmentOrder",
      tone: "blue" as const,
      primaryLabel: "复核成本影响",
      payload: {
        review_result: "approved",
        review_note: "仓库复核补退料执行明细、库存流水与成本影响一致。",
      },
    }));
  const materialAdjustmentReviewExceptionTasks = (data.productionMaterialAdjustmentReviewExceptions ?? [])
    .filter(
      (item) =>
        String(item.status) === "open" &&
        (String(item.owner_role) === user.role || user.role === "admin" || user.role === "manager"),
    )
    .slice(0, 6)
    .map((item) => ({
      id: `task-material-adjustment-review-exception-${item.id}`,
      title: `处理补退料复核异常 ${item.exception_no}`,
      detail: `${item.order_no} / ${item.reason_type_label} / ${item.product_name}`,
      entityType: "material_adjustment_review_exception",
      entityId: String(item.id),
      action: "resolveMaterialAdjustmentReviewException",
      tone: "rose" as const,
      primaryLabel: "关闭异常",
      payload: {
        resolution_type: "cost_adjustment",
        final_cost_adjustment_amount: String(item.cost_adjustment_amount ?? 0),
        resolution_note: "责任岗位已核对执行批次、成本影响和业务单据，关闭复核异常。",
      },
    }));
  const commonTasks = [
    ...costAnomalyTasks,
    ...remediationTasks,
    ...supplierGovernanceTasks,
    ...productionPlanNotificationTasks,
    ...productionPlanChangeImpactTasks,
    ...materialAdjustmentSuggestionTasks,
    ...materialAdjustmentOrderTasks,
    ...materialAdjustmentReviewTasks,
    ...materialAdjustmentReviewExceptionTasks,
  ];

  if (user.role === "sales") {
    return [
      ...commonTasks,
      ...data.quotes
        .filter((quote) => quote.status === "draft")
        .map((quote) => ({
          id: `task-${quote.id}`,
          title: `确认报价 ${quote.quote_no}`,
          detail: `${quote.customer_name} / ${quote.product_name} / ${quote.qty} 件`,
          entityType: "quote",
          entityId: String(quote.id),
          action: "confirmQuote",
          tone: "amber" as const,
          primaryLabel: "确认报价",
        })),
      ...data.quotes
        .filter((quote) => quote.status === "confirmed")
        .map((quote) => ({
          id: `task-${quote.id}`,
          title: `转正式订单 ${quote.quote_no}`,
          detail: `客户已确认，金额 ¥${Number(quote.total_amount).toLocaleString("zh-CN")}`,
          entityType: "quote",
          entityId: String(quote.id),
          action: "createOrder",
          tone: "green" as const,
          primaryLabel: "生成订单",
        })),
    ];
  }

  if (user.role === "assistant") {
    return [
      ...commonTasks,
      ...data.orders
        .filter((order) => order.status === "submitted")
        .map((order) => ({
          id: `task-${order.id}`,
          title: `下发生产 ${order.order_no}`,
          detail: `${order.customer_name} / 交期 ${order.due_date}`,
          entityType: "order",
          entityId: String(order.id),
          action: "createProductionInstruction",
          tone: "blue" as const,
          primaryLabel: "下发指令",
        })),
      ...data.productions
        .filter((production) => production.status === "in_stock")
        .map((production) => ({
          id: `task-${production.id}`,
          title: `安排发货 ${production.order_no}`,
          detail: `${production.product_name} 已入库，生成发货单`,
          entityType: "production",
          entityId: String(production.id),
          action: "createShipment",
          tone: "green" as const,
          primaryLabel: "生成发货单",
        })),
      ...data.shipments.slice(0, 2).map((shipment) => ({
        id: `task-doc-${shipment.id}`,
        title: `下载送货单 ${shipment.shipment_no}`,
        detail: `${shipment.order_no} / ${shipment.product_name}`,
        entityType: "shipment",
        entityId: String(shipment.id),
        action: "downloadDeliveryNote",
        secondaryAction: "downloadSalesStatement",
        tone: "blue" as const,
        primaryLabel: "送货单",
        secondaryLabel: "销售对账单",
      })),
    ];
  }

  if (user.role === "production") {
    return [
      ...commonTasks,
      ...data.productions
        .filter((production) => production.status === "instructed")
        .map((production) => ({
          id: `task-${production.id}`,
          title: `排产并生成领料单 ${production.prod_no}`,
          detail: `${production.product_name} / ${production.order_qty} 件`,
          entityType: "production",
          entityId: String(production.id),
          action: "scheduleAndGenerateRequisition",
          tone: "blue" as const,
          primaryLabel: "排产领料",
        })),
      ...data.productions
        .filter((production) => production.status === "producing")
        .map((production) => ({
          id: `task-report-${production.id}`,
          title: `填写日报 ${production.prod_no}`,
          detail: `${production.product_name} / ${production.order_qty} ${production.unit ?? ""}`,
          entityType: "production",
          entityId: String(production.id),
          action: "createProductionDailyReport",
          tone: "blue" as const,
          primaryLabel: "填写日报",
        })),
      ...data.productions
        .filter((production) => production.status === "producing")
        .map((production) => ({
          id: `task-${production.id}`,
          title: `完工请验 ${production.prod_no}`,
          detail: `${production.machine ?? "未指定机台"} / ${production.owner ?? "未指定负责人"}`,
          entityType: "production",
          entityId: String(production.id),
          action: "requestInspection",
          tone: "amber" as const,
          primaryLabel: "发起请验",
        })),
    ];
  }

  if (user.role === "technical") {
    const handledInspectionIds = new Set(
      data.technicalDispositions
        .filter((item) => item.status !== "voided")
        .map((item) => String(item.inspection_id)),
    );
    return [
      ...commonTasks,
      ...data.inspections
      .filter((inspection) => inspection.result === "failed" && !handledInspectionIds.has(String(inspection.id)))
      .map((inspection) => ({
        id: `task-tech-${inspection.id}`,
        title: `不合格处理 ${inspection.inspection_no}`,
        detail: `${inspection.prod_no} / ${inspection.product_name}，需技术部出具处置意见`,
        entityType: "inspection",
        entityId: String(inspection.id),
        action: "createTechnicalDisposition",
        tone: "rose" as const,
        primaryLabel: "出具意见",
      })),
    ];
  }

  if (user.role === "warehouse") {
    return [
      ...commonTasks,
      ...data.requisitions
        .filter((req) => req.status === "pending_approval")
        .map((req) => ({
          id: `task-${req.id}`,
          title: `领料审批 ${req.req_no}`,
          detail: `生产单 ${req.prod_no}，复核 BOM、库存批次与替代料规则`,
          entityType: "requisition",
          entityId: String(req.id),
          action: "approveMaterialRequisition",
          tone: "amber" as const,
          primaryLabel: "批准领料",
        })),
      ...data.requisitions
        .filter((req) => req.status === "approved" || req.status === "pending")
        .map((req) => ({
          id: `task-issue-${req.id}`,
          title: `待发料 ${req.req_no}`,
          detail: `生产单 ${req.prod_no}，默认先进先出`,
          entityType: "requisition",
          entityId: String(req.id),
          action: "issueMaterials",
          secondaryAction: "issueMaterials",
          secondaryVariant: "substitute",
          tone: "amber" as const,
          primaryLabel: "FIFO 发料",
          secondaryLabel: "替代料发料",
        })),
      ...data.purchaseOrders
        .filter((purchase) => purchase.status === "pending_receipt" && purchase.arrival_status === "pending_signoff")
        .map((purchase) => ({
          id: `task-arrival-sign-${purchase.arrival_notice_id}`,
          title: `到货签收 ${purchase.arrival_no}`,
          detail: `${purchase.purchase_no} / ${purchase.supplier_name}`,
          entityType: "purchase_arrival_notice",
          entityId: String(purchase.arrival_notice_id),
          action: "signPurchaseArrivalNotice",
          tone: "amber" as const,
          primaryLabel: "仓库签收",
        })),
      ...data.productions
        .filter((production) => production.status === "qa_approved")
        .map((production) => ({
          id: `task-${production.id}`,
          title: `合格入库 ${production.prod_no}`,
          detail: `${production.product_name} 可办理成品与过渡料入库`,
          entityType: "production",
          entityId: String(production.id),
          action: "receiveFinishedGoods",
          tone: "green" as const,
          primaryLabel: "办理入库",
        })),
    ];
  }

  if (user.role === "quality") {
    return [
      ...commonTasks,
      ...((data.materialIqcInspections ?? []) as Array<Record<string, unknown>>)
        .filter((iqc) => iqc.status === "pending")
        .map((iqc) => ({
          id: `task-iqc-${iqc.id}`,
          title: `原料 IQC ${iqc.iqc_no}`,
          detail: `${iqc.purchase_no} / ${iqc.supplier_name}`,
          entityType: "material_iqc",
          entityId: String(iqc.id),
          action: "completeMaterialIqcInspection",
          tone: "amber" as const,
          primaryLabel: "IQC判定",
        })),
      ...data.inspections
        .filter((inspection) => inspection.status === "pending")
        .map((inspection) => ({
        id: `task-${inspection.id}`,
        title: `检验判定 ${inspection.inspection_no}`,
        detail: `${inspection.prod_no} / ${inspection.product_name}`,
        entityType: "inspection",
        entityId: String(inspection.id),
        action: "completeInspection",
        secondaryAction: "completeInspection",
        secondaryVariant: "concession",
        tone: "rose" as const,
        primaryLabel: "合格",
        secondaryLabel: "让步接收",
      })),
    ];
  }

  if (user.role === "admin") {
    return [
      ...commonTasks,
      {
        id: "task-admin-backup",
        title: "系统冷备份",
        detail: "打包 SQLite、附件、导出目录与 manifest",
        entityType: "system",
        action: "downloadBackup",
        tone: "blue",
        primaryLabel: "生成备份包",
      },
      {
        id: "task-admin-purchase",
        title: "模拟采购入库",
        detail: "42CrMo 圆钢 +20kg，触发移动加权平均",
        entityType: "material",
        entityId: "M-STEEL",
        action: "purchaseInbound",
        tone: "green",
        primaryLabel: "采购入库",
      },
      {
        id: "task-admin-reset",
        title: "重置演示数据",
        detail: "恢复到初始报价和库存状态",
        entityType: "system",
        action: "resetDemo",
        tone: "neutral",
        primaryLabel: "重置",
      },
    ];
  }

  if (user.role === "purchasing") {
    return [
      ...commonTasks,
      {
        id: "task-purchase-approval",
        title: "发起采购特采审批",
        detail: "演示低库存紧急补货的简单 OA 审批",
        entityType: "approval",
        action: "submitApproval",
        tone: "blue",
        primaryLabel: "发起审批",
      },
      ...data.materials
        .filter((material) => Number(material.reorder_min_qty ?? 0) > 0 && Number(material.stock_qty ?? 0) <= Number(material.reorder_min_qty))
        .slice(0, 2)
        .map((material) => ({
          id: `task-low-stock-${material.id}`,
          title: `库存预警 ${material.name}`,
          detail: `当前 ${material.stock_qty}${material.unit}，安全线 ${material.reorder_min_qty}${material.unit}`,
          entityType: "material",
          entityId: String(material.id),
          action: "createPurchaseRequisition",
          tone: "amber" as const,
          primaryLabel: "生成申请",
        })),
      ...(data.mrpRequirementRuns ?? [])
        .filter((run) => String(run.status) === "draft" && Number(run.shortage_line_count ?? 0) > 0)
        .slice(0, 2)
        .map((run) => ({
          id: `task-mrp-${run.id}`,
          title: `MRP 缺料转申请 ${run.run_no}`,
          detail: `${run.shortage_line_count} 项缺料 / 建议金额 ¥${Number(run.total_shortage_amount ?? 0).toLocaleString("zh-CN")}`,
          entityType: "mrp_requirement_run",
          entityId: String(run.id),
          action: "createPurchaseRequisitionFromMrp",
          tone: "amber" as const,
          primaryLabel: "生成申请",
        })),
      ...data.purchaseArrivalDiscrepancies
        .filter((discrepancy) => discrepancy.status === "approved")
        .map((discrepancy) => ({
          id: `task-arrival-discrepancy-${discrepancy.id}`,
          title: `处理到货差异 ${discrepancy.discrepancy_no}`,
          detail: `${discrepancy.arrival_no} / ${discrepancy.supplier_name} / ${discrepancy.handling_decision_label}`,
          entityType: "purchase_arrival_discrepancy",
          entityId: String(discrepancy.id),
          action: "resolvePurchaseArrivalDiscrepancy",
          tone: "amber" as const,
          primaryLabel: "处理完成",
          payload: {
            resolution_result: String(discrepancy.handling_decision || "supplier_replenish"),
            resolution_note: "采购已完成到货差异处置，恢复仓库签收流程。",
          },
        })),
      ...data.purchaseOrders
        .filter(
          (purchase) =>
            purchase.status === "pending_receipt" &&
            (!purchase.contract_no || !purchase.arrival_no || purchase.arrival_status === "signed"),
        )
        .map((purchase) => ({
          id: `task-purchase-${purchase.id}`,
          title: purchase.contract_no
            ? purchase.arrival_no
              ? `提交 IQC ${purchase.arrival_no}`
              : `生成到货通知 ${purchase.purchase_no}`
            : `采购合同下单 ${purchase.purchase_no}`,
          detail: `${purchase.supplier_name} / ¥${Number(purchase.total_amount).toLocaleString("zh-CN")}`,
          entityType: purchase.arrival_status === "signed" ? "purchase_arrival_notice" : "purchase_order",
          entityId: String(purchase.arrival_status === "signed" ? purchase.id : purchase.id),
          action: purchase.contract_no
            ? purchase.arrival_status === "signed"
              ? "createMaterialIqcInspection"
              : "createPurchaseArrivalNotice"
            : "createPurchaseContract",
          tone: "green" as const,
          primaryLabel: purchase.contract_no
            ? purchase.arrival_status === "signed"
              ? "提交IQC"
              : "到货通知"
            : "签订合同",
          payload: purchase.arrival_status === "signed" ? { arrival_notice_id: purchase.arrival_notice_id } : undefined,
        })),
      ...data.payables
        .filter((payable) => payable.status !== "paid")
        .slice(0, 2)
        .map((payable) => ({
          id: `task-payable-${payable.id}`,
          title: `供应商付款 ${payable.payable_no}`,
          detail: `${payable.supplier_name} / 余额 ¥${Number(payable.balance_amount).toLocaleString("zh-CN")}`,
          entityType: "payable",
          entityId: String(payable.id),
          action: "recordPayablePayment",
          secondaryAction: "downloadPurchaseStatement",
          tone: "blue" as const,
          primaryLabel: "登记付款",
          secondaryLabel: "采购对账单",
        })),
      {
        id: "task-formula-calc",
        title: "按当前原料均价试算配方",
        detail: "使用采购入库后的移动均价计算配方价格",
        entityType: "formula",
        action: "createFormulaCalculation",
        tone: "green",
        primaryLabel: "试算配方",
      },
    ];
  }

  if (user.role === "finance") {
    return [
      ...commonTasks,
      ...data.receivables
        .filter((receivable) => receivable.status !== "paid")
        .slice(0, 2)
        .map((receivable) => ({
          id: `task-receivable-${receivable.id}`,
          title: `登记回款 ${receivable.receivable_no}`,
          detail: `${receivable.customer_name} / 余额 ¥${Number(receivable.balance_amount).toLocaleString("zh-CN")}`,
          entityType: "receivable",
          entityId: String(receivable.id),
          action: "recordReceivableReceipt",
          secondaryAction: "downloadSalesStatement",
          tone: "green" as const,
          primaryLabel: "登记回款",
          secondaryLabel: "销售对账单",
        })),
      ...data.payables
        .filter((payable) => payable.status !== "paid")
        .slice(0, 2)
        .map((payable) => ({
          id: `task-fin-payable-${payable.id}`,
          title: `登记付款 ${payable.payable_no}`,
          detail: `${payable.supplier_name} / 余额 ¥${Number(payable.balance_amount).toLocaleString("zh-CN")}`,
          entityType: "payable",
          entityId: String(payable.id),
          action: "recordPayablePayment",
          tone: "amber" as const,
          primaryLabel: "登记付款",
        })),
      {
        id: "task-finance-export",
        title: "财务原始数据提取",
        detail: "订单、物料流水、批次成本、发货清单",
        entityType: "report",
        action: "downloadFinance",
        tone: "green",
        primaryLabel: "导出 Excel",
      },
      {
        id: "task-finance-ledger",
        title: "导出应收应付台账",
        detail: "应收、应付、收付款和账龄",
        entityType: "report",
        action: "downloadLedger",
        tone: "blue",
        primaryLabel: "导出台账",
      },
    ];
  }

  return [
    ...commonTasks,
    ...data.stocktakes
      .filter((stocktake) => stocktake.status === "pending_approval")
      .slice(0, 3)
      .map((stocktake) => ({
        id: `task-stocktake-${stocktake.id}`,
        title: `盘点审批 ${stocktake.stocktake_no}`,
        detail: `${stocktake.material_name} / 差异 ${stocktake.difference_qty}${stocktake.unit}`,
        entityType: "stocktake",
        entityId: String(stocktake.id),
        action: "approveStocktake",
        tone: "amber" as const,
        primaryLabel: "审批调整",
      })),
    ...data.approvalRequests
      .filter((approval) => approval.status === "pending")
      .slice(0, 3)
      .map((approval) => ({
        id: `task-approval-${approval.id}`,
        title: `审批 ${approval.request_no}`,
        detail: `${approval.title} / ¥${Number(approval.amount).toLocaleString("zh-CN")}`,
        entityType: "approval",
        entityId: String(approval.id),
        action: "approveApproval",
        secondaryAction: "rejectApproval",
        tone: "amber" as const,
        primaryLabel: "同意",
        secondaryLabel: "驳回",
      })),
    {
      id: "task-manager-formula-calc",
      title: "授权配方价格试算",
      detail: "按系统现有原材料移动均价计算配方成本和报价",
      entityType: "formula",
      action: "createFormulaCalculation",
      tone: "green",
      primaryLabel: "试算配方",
    },
    {
      id: "task-manager-dashboard",
      title: "实时经营看板",
      detail: "订单额、生产进度、库存价值、应收应付与待办",
      entityType: "dashboard",
      action: "downloadFinance",
      tone: "blue",
      primaryLabel: "导出管理数据",
    },
    {
      id: "task-manager-report",
      title: "经营日报 / 周报 / 月报",
      detail: "按内置模板导出经营数据",
      entityType: "report",
      action: "downloadDailyReport",
      secondaryAction: "downloadMonthlyReport",
      tone: "green",
      primaryLabel: "日报",
      secondaryLabel: "月报",
    },
  ];
}

export function performAction(input: ActionInput) {
  const database = getDb();
  if (!roleActionMap[input.action]) throw new Error("未知操作。");
  requireActionPermission(database, input.actorId, input.action);

  if (input.action === "resetDemo") {
    resetDemoDatabase();
    return { ok: true };
  }

  database.transaction(() => {
    switch (input.action) {
      case "confirmQuote":
        confirmQuote(database, input.actorId, mustEntity(input.entityId));
        break;
      case "createQuote":
        createQuote(database, input.actorId, input.payload);
        break;
      case "createOrder":
        createOrder(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createProductionInstruction":
        createProductionInstruction(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "scheduleAndGenerateRequisition":
        scheduleAndGenerateRequisition(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "updateProductionSchedule":
        updateProductionSchedule(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "lockProductionPlan":
        lockProductionPlan(database, input.actorId, input.payload);
        break;
      case "ackProductionPlanNotification":
        acknowledgeProductionPlanNotification(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "resolveProductionPlanChangeImpact":
        resolveProductionPlanChangeImpact(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "confirmMaterialAdjustmentSuggestion":
        confirmMaterialAdjustmentSuggestion(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "executeMaterialAdjustmentOrder":
        executeMaterialAdjustmentOrder(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "reviewMaterialAdjustmentOrder":
        reviewMaterialAdjustmentOrder(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "resolveMaterialAdjustmentReviewException":
        resolveMaterialAdjustmentReviewException(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "approveMaterialRequisition":
        approveMaterialRequisition(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "rejectMaterialRequisition":
        rejectMaterialRequisition(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "issueMaterials":
        issueMaterials(database, input.actorId, mustEntity(input.entityId), input.variant, input.payload);
        break;
      case "requestInspection":
        requestInspection(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "completeInspection":
        completeInspection(database, input.actorId, mustEntity(input.entityId), input.variant, input.actualQty, input.payload);
        break;
      case "createProductionDailyReport":
        createProductionDailyReport(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createTechnicalDisposition":
        createTechnicalDisposition(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "receiveFinishedGoods":
        receiveFinishedGoods(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createShipment":
        createShipment(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createPurchaseOrder":
        createPurchaseOrder(database, input.actorId, input.entityId, input.payload);
        break;
      case "createPurchaseRequisition":
        createPurchaseRequisition(database, input.actorId, input.entityId, input.payload);
        break;
      case "generateMrpRequirementRun":
        generateMrpRequirementRun(database, input.actorId, input.entityId, input.payload);
        break;
      case "createPurchaseRequisitionFromMrp":
        createPurchaseRequisitionFromMrp(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createPurchaseContract":
        createPurchaseContract(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createPurchaseArrivalNotice":
        createPurchaseArrivalNotice(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "registerPurchaseArrivalDiscrepancy":
        registerPurchaseArrivalDiscrepancy(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "resolvePurchaseArrivalDiscrepancy":
        resolvePurchaseArrivalDiscrepancy(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createSupplierCorrectiveAction":
        createSupplierCorrectiveAction(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "blacklistSupplier":
        blacklistSupplier(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "submitSupplierCorrection":
        submitSupplierCorrection(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "reviewSupplierCorrection":
        reviewSupplierCorrection(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "upsertSupplierCertificate":
        upsertSupplierCertificate(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "renewSupplierCertificate":
        renewSupplierCertificate(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "recordSupplierAnnualReview":
        recordSupplierAnnualReview(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "evaluateSupplierAdmissionRules":
        evaluateSupplierAdmissionRules(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "upsertSupplierAdmissionRule":
        upsertSupplierAdmissionRule(database, input.actorId, input.entityId, input.payload);
        break;
      case "submitSupplierAdmissionRuleChange":
        submitSupplierAdmissionRuleChange(database, input.actorId, input.entityId, input.payload);
        break;
      case "signPurchaseArrivalNotice":
        signPurchaseArrivalNotice(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createPurchaseOrderFromRequisition":
        createPurchaseOrderFromRequisition(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createMaterialIqcInspection":
        createMaterialIqcInspection(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "completeMaterialIqcInspection":
        completeMaterialIqcInspection(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "receivePurchaseOrder":
        receivePurchaseOrder(database, input.actorId, mustEntity(input.entityId));
        break;
      case "recordPayablePayment":
        recordPayablePayment(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "recordReceivableReceipt":
        recordReceivableReceipt(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "purchaseInbound":
        purchaseInbound(database, input.actorId, mustEntity(input.entityId));
        break;
      case "submitApproval":
        submitApproval(database, input.actorId, input.payload);
        break;
      case "approveApproval":
        decideApproval(database, input.actorId, mustEntity(input.entityId), "approved", input.payload);
        break;
      case "rejectApproval":
        decideApproval(database, input.actorId, mustEntity(input.entityId), "rejected", input.payload);
        break;
      case "createFormulaCalculation":
        createFormulaCalculation(database, input.actorId);
        break;
      case "upsertApprovalRule":
        upsertApprovalRule(database, input.actorId, input.entityId, input.payload);
        break;
      case "deactivateApprovalRule":
        deactivateApprovalRule(database, input.actorId, mustEntity(input.entityId));
        break;
      case "markAlertRead":
        upsertAlertMessageState(database, input.actorId, mustEntity(input.entityId), "read", input.payload);
        break;
      case "dismissAlert":
        upsertAlertMessageState(database, input.actorId, mustEntity(input.entityId), "dismissed", input.payload);
        break;
      case "upsertAlertSubscription":
        upsertAlertSubscription(database, input.actorId, input.payload);
        break;
      case "upsertSystemSetting":
        upsertSystemSetting(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createSystemHealthRemediation":
        createSystemHealthRemediation(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "markSystemHealthRemediationReady":
        markSystemHealthRemediationReady(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "rejectSystemHealthRemediationReview":
        rejectSystemHealthRemediationReview(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "closeSystemHealthRemediation":
        closeSystemHealthRemediation(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createCostAnomalyRemediation":
        createCostAnomalyRemediation(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "upsertCostAnomalyWarningRule":
        upsertCostAnomalyWarningRule(database, input.actorId, input.entityId, input.payload);
        break;
      case "markCostAnomalyRemediationReady":
        markCostAnomalyRemediationReady(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "rejectCostAnomalyRemediationReview":
        rejectCostAnomalyRemediationReview(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "closeCostAnomalyRemediation":
        closeCostAnomalyRemediation(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "voidBusinessDocument":
        voidBusinessDocument(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "reverseBusinessDocument":
        reverseBusinessDocument(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "recordSalesReturn":
        recordSalesReturn(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "recordCustomerRefund":
        recordCustomerRefund(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createReplacementShipment":
        createReplacementShipment(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "recordInventoryAgingDisposition":
        recordInventoryAgingDisposition(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "createStocktake":
        createStocktake(database, input.actorId, input.payload);
        break;
      case "approveStocktake":
        approveStocktake(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "rejectStocktake":
        rejectStocktake(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "changeOwnPassword":
        changeOwnPassword(database, input.actorId, input.payload);
        break;
      case "upsertUser":
        upsertUser(database, input.actorId, input.entityId, input.payload);
        break;
      case "resetUserPassword":
        resetUserPassword(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "updateUserStatus":
        updateUserStatus(database, input.actorId, mustEntity(input.entityId), input.payload);
        break;
      case "upsertRolePermission":
        upsertRolePermission(database, input.actorId, input.payload);
        break;
      case "upsertCustomer":
        upsertCustomer(database, input.actorId, input.entityId, input.payload);
        break;
      case "deactivateCustomer":
        deactivateMaster(database, input.actorId, "customers", mustEntity(input.entityId), "customer");
        break;
      case "upsertSupplier":
        upsertSupplier(database, input.actorId, input.entityId, input.payload);
        break;
      case "deactivateSupplier":
        deactivateMaster(database, input.actorId, "suppliers", mustEntity(input.entityId), "supplier");
        break;
      case "upsertMaterial":
        upsertMaterial(database, input.actorId, input.entityId, input.payload);
        break;
      case "deactivateMaterial":
        deactivateMaster(database, input.actorId, "materials", mustEntity(input.entityId), "material");
        break;
      case "upsertProduct":
        upsertProduct(database, input.actorId, input.entityId, input.payload);
        break;
      case "deactivateProduct":
        deactivateMaster(database, input.actorId, "products", mustEntity(input.entityId), "product");
        break;
      case "createBomVersion":
        createBomVersion(database, input.actorId, input.payload);
        break;
      case "deactivateBom":
        deactivateMaster(database, input.actorId, "boms", mustEntity(input.entityId), "bom");
        break;
    }
  })();

  return { ok: true };
}

function mustEntity(entityId?: string) {
  if (!entityId) throw new Error("缺少单据编号。");
  return entityId;
}

export type DocumentAttachmentEntityType =
  | "quote"
  | "sales_order"
  | "purchase_requisition"
  | "purchase_order"
  | "purchase_contract"
  | "purchase_arrival_notice"
  | "warehouse_signoff"
  | "material_iqc"
  | "approval_request"
  | "shipment"
  | "delivery_note"
  | "sales_return"
  | "customer_refund"
  | "replacement_shipment"
  | "inspection"
  | "technical_disposition"
  | "supplier_certificate"
  | "supplier_annual_review"
  | "system_health_remediation"
  | "payable"
  | "receivable"
  | "other";

const attachmentEntityTypes = new Set<DocumentAttachmentEntityType>([
  "quote",
  "sales_order",
  "purchase_requisition",
  "purchase_order",
  "purchase_contract",
  "purchase_arrival_notice",
  "warehouse_signoff",
  "material_iqc",
  "approval_request",
  "shipment",
  "delivery_note",
  "sales_return",
  "customer_refund",
  "replacement_shipment",
  "inspection",
  "technical_disposition",
  "supplier_certificate",
  "supplier_annual_review",
  "system_health_remediation",
  "payable",
  "receivable",
  "other",
]);

export async function createDocumentAttachment(input: {
  actorId: string;
  entityType: DocumentAttachmentEntityType | string;
  entityId?: string;
  entityNo?: string;
  category: string;
  fileName: string;
  mimeType?: string;
  note?: string;
  buffer: Buffer | Uint8Array | ArrayBuffer;
}) {
  const database = getDb();
  const user = getUser(database, input.actorId);
  if (!attachmentEntityTypes.has(input.entityType as DocumentAttachmentEntityType)) {
    throw new Error("附件关联单据类型不正确。");
  }
  const category = String(input.category ?? "").trim();
  if (!category) throw new Error("附件分类不能为空。");
  const entityNo = String(input.entityNo ?? input.entityId ?? "").trim();
  if (!entityNo) throw new Error("附件关联单号不能为空。");

  const originalName = sanitizeAttachmentFileName(input.fileName);
  const data = input.buffer instanceof ArrayBuffer ? Buffer.from(new Uint8Array(input.buffer)) : Buffer.from(input.buffer);
  if (data.length === 0) throw new Error("附件文件不能为空。");
  if (data.length > 20 * 1024 * 1024) throw new Error("附件文件不能超过 20MB。");

  const paths = ensureDataDirs();
  const attachmentNo = serial(database, "document_attachments", "FJ");
  const dateFolder = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const storageFolder = path.join(paths.attachments, dateFolder);
  fs.mkdirSync(storageFolder, { recursive: true });
  const storageFileName = `${attachmentNo}-${originalName}`;
  const relativeStorageName = path.join(dateFolder, storageFileName);
  const absolutePath = path.join(paths.attachments, relativeStorageName);
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  fs.writeFileSync(absolutePath, data);

  const id = uid("ATT");
  const uploadedAt = now();
  try {
    database.prepare(`
      INSERT INTO document_attachments (
        id, attachment_no, entity_type, entity_id, entity_no, category,
        file_name, storage_name, storage_path, mime_type, size_bytes, sha256,
        note, uploaded_by, uploaded_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      attachmentNo,
      input.entityType,
      input.entityId ?? null,
      entityNo,
      category,
      originalName,
      relativeStorageName,
      absolutePath,
      input.mimeType || "application/octet-stream",
      data.length,
      sha256,
      String(input.note ?? "").trim(),
      input.actorId,
      uploadedAt,
    );
  } catch (error) {
    fs.rmSync(absolutePath, { force: true });
    throw error;
  }

  audit(database, input.actorId, "createDocumentAttachment", "document_attachment", id, `上传归档附件 ${attachmentNo}：${entityNo} / ${originalName}`);
  return {
    id,
    attachment_no: attachmentNo,
    entity_type: input.entityType,
    entity_type_label: documentTypeLabel(String(input.entityType)),
    entity_id: input.entityId ?? null,
    entity_no: entityNo,
    category,
    file_name: originalName,
    storage_name: relativeStorageName,
    storage_path: absolutePath,
    absolute_path: absolutePath,
    mime_type: input.mimeType || "application/octet-stream",
    size_bytes: data.length,
    size_label: formatBytes(data.length),
    sha256,
    note: String(input.note ?? "").trim(),
    uploaded_by: input.actorId,
    uploaded_by_name: user.name,
    uploaded_at: uploadedAt,
  };
}

export function getDocumentAttachmentFile(actorId: string, attachmentId: string) {
  getUser(getDb(), actorId);
  const database = getDb();
  const row = database.prepare("SELECT * FROM document_attachments WHERE id = ?").get(attachmentId) as
    | {
        id: string;
        file_name: string;
        storage_path: string;
        mime_type: string;
      }
    | undefined;
  if (!row) throw new Error("附件不存在。");
  if (!fs.existsSync(row.storage_path)) throw new Error("附件文件不存在，请检查本地数据盘。");
  return {
    fileName: row.file_name,
    contentType: row.mime_type || "application/octet-stream",
    buffer: fs.readFileSync(row.storage_path),
  };
}

function sanitizeAttachmentFileName(fileName: string) {
  const baseName = path.basename(String(fileName ?? "").trim()).replace(/[\\/:*?"<>|]/g, "_");
  if (!baseName || baseName === "." || baseName === "..") throw new Error("附件文件名不能为空。");
  return baseName.slice(0, 120);
}

function payloadDate(payload: Record<string, unknown>, key: string, label: string, fallback?: string) {
  const value = payloadText(payload, key, label, false) || fallback || "";
  if (!value) throw new Error(`${label}不能为空。`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label}格式应为 YYYY-MM-DD。`);
  }
  return value;
}

function payloadObject(payload?: Record<string, unknown>) {
  if (!payload || typeof payload !== "object") throw new Error("缺少表单内容。");
  return payload;
}

function payloadText(payload: Record<string, unknown>, key: string, label: string, required = true) {
  const value = String(payload[key] ?? "").trim();
  if (required && !value) throw new Error(`${label}不能为空。`);
  return value;
}

function payloadNumber(payload: Record<string, unknown>, key: string, label: string, options?: { min?: number }) {
  const raw = payload[key];
  const value = raw === "" || raw == null ? 0 : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有效数字。`);
  if (options?.min != null && value < options.min) throw new Error(`${label}不能小于 ${options.min}。`);
  return value;
}

function payloadPositiveNumber(payload: Record<string, unknown>, key: string, label: string, fallback?: number) {
  const value = payload[key] == null || payload[key] === "" ? fallback : payloadNumber(payload, key, label, { min: 0 });
  if (value == null || value <= 0) throw new Error(`${label}必须大于 0。`);
  return roundQty(value);
}

function payloadStatus(payload: Record<string, unknown>) {
  const status = payloadText(payload, "status", "状态", false) || "active";
  return status === "inactive" ? "inactive" : "active";
}

function assertUniqueCode(
  database: Database.Database,
  table: "customers" | "suppliers" | "materials" | "products",
  column: "customer_code" | "supplier_code" | "material_code" | "product_code",
  code: string,
  currentId?: string,
) {
  const row = database.prepare(`SELECT id FROM ${table} WHERE ${column} = ? AND id <> ?`).get(code, currentId ?? "") as
    | { id: string }
    | undefined;
  if (row) throw new Error(`编码 ${code} 已存在，请更换编码。`);
}

function deactivateMaster(
  database: Database.Database,
  actorId: string,
  table: "customers" | "suppliers" | "materials" | "products" | "boms",
  id: string,
  entityType: string,
) {
  const existing = database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id) as { id: string } | undefined;
  if (!existing) throw new Error("主数据不存在。");
  const timestamp = now();
  database.prepare(`UPDATE ${table} SET status = 'inactive', updated_at = ? WHERE id = ?`).run(timestamp, id);
  audit(database, actorId, "deactivate", entityType, id, "停用主数据");
}

function upsertCustomer(database: Database.Database, actorId: string, entityId?: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const code = payloadText(payload, "customer_code", "客户编码");
  const name = payloadText(payload, "name", "客户名称");
  const contact = payloadText(payload, "contact", "联系人");
  const phone = payloadText(payload, "phone", "电话");
  const status = payloadStatus(payload);
  const address = payloadText(payload, "address", "地址", false);
  const taxNo = payloadText(payload, "tax_no", "税号", false);
  const remark = payloadText(payload, "remark", "备注", false);
  const timestamp = now();

  assertUniqueCode(database, "customers", "customer_code", code, entityId);

  if (entityId) {
    const existing = database.prepare("SELECT id FROM customers WHERE id = ?").get(entityId);
    if (!existing) throw new Error("客户不存在。");
    database.prepare(`
      UPDATE customers
      SET customer_code = ?, name = ?, contact = ?, phone = ?, status = ?,
          address = ?, tax_no = ?, remark = ?, updated_at = ?
      WHERE id = ?
    `).run(code, name, contact, phone, status, address, taxNo, remark, timestamp, entityId);
    audit(database, actorId, "update", "customer", entityId, `更新客户 ${name}`);
    return;
  }

  const id = uid("CUST");
  database.prepare(`
    INSERT INTO customers (
      id, customer_code, name, contact, phone, status, address, tax_no, remark, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, code, name, contact, phone, status, address, taxNo, remark, timestamp, timestamp);
  audit(database, actorId, "create", "customer", id, `新增客户 ${name}`);
}

function upsertSupplier(database: Database.Database, actorId: string, entityId?: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const code = payloadText(payload, "supplier_code", "供应商编码");
  const name = payloadText(payload, "name", "供应商名称");
  const contact = payloadText(payload, "contact", "联系人");
  const phone = payloadText(payload, "phone", "电话");
  const paymentTerms = payloadText(payload, "payment_terms", "付款条件");
  const status = payloadStatus(payload);
  const address = payloadText(payload, "address", "地址", false);
  const taxNo = payloadText(payload, "tax_no", "税号", false);
  const remark = payloadText(payload, "remark", "备注", false);
  const timestamp = now();

  assertUniqueCode(database, "suppliers", "supplier_code", code, entityId);

  if (entityId) {
    const existing = database.prepare("SELECT id FROM suppliers WHERE id = ?").get(entityId);
    if (!existing) throw new Error("供应商不存在。");
    database.prepare(`
      UPDATE suppliers
      SET supplier_code = ?, name = ?, contact = ?, phone = ?, payment_terms = ?, status = ?,
          address = ?, tax_no = ?, remark = ?, updated_at = ?
      WHERE id = ?
    `).run(code, name, contact, phone, paymentTerms, status, address, taxNo, remark, timestamp, entityId);
    audit(database, actorId, "update", "supplier", entityId, `更新供应商 ${name}`);
    return;
  }

  const id = uid("SUP");
  database.prepare(`
    INSERT INTO suppliers (
      id, supplier_code, name, contact, phone, payment_terms, status, address, tax_no, remark, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, code, name, contact, phone, paymentTerms, status, address, taxNo, remark, timestamp, timestamp);
  audit(database, actorId, "create", "supplier", id, `新增供应商 ${name}`);
}

function upsertMaterial(database: Database.Database, actorId: string, entityId?: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const code = payloadText(payload, "material_code", "物料编码");
  const name = payloadText(payload, "name", "物料名称");
  const spec = payloadText(payload, "spec", "规格", false);
  const unit = payloadText(payload, "unit", "单位");
  const kind = payloadText(payload, "kind", "物料分类", false) || "raw";
  const reorderMinQty = payloadNumber(payload, "reorder_min_qty", "安全库存", { min: 0 });
  const status = payloadStatus(payload);
  const remark = payloadText(payload, "remark", "备注", false);
  const timestamp = now();

  assertUniqueCode(database, "materials", "material_code", code, entityId);

  if (entityId) {
    const existing = database.prepare("SELECT id FROM materials WHERE id = ?").get(entityId);
    if (!existing) throw new Error("物料不存在。");
    database.prepare(`
      UPDATE materials
      SET material_code = ?, name = ?, spec = ?, unit = ?, kind = ?, reorder_min_qty = ?,
          status = ?, remark = ?, updated_at = ?
      WHERE id = ?
    `).run(code, name, spec, unit, kind, reorderMinQty, status, remark, timestamp, entityId);
    audit(database, actorId, "update", "material", entityId, `更新物料 ${name}`);
    return;
  }

  const id = uid("MAT");
  database.prepare(`
    INSERT INTO materials (
      id, material_code, name, spec, unit, stock_qty, average_cost, kind,
      reorder_min_qty, status, remark, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
  `).run(id, code, name, spec, unit, kind, reorderMinQty, status, remark, timestamp, timestamp);
  audit(database, actorId, "create", "material", id, `新增物料 ${name}`);
}

function upsertProduct(database: Database.Database, actorId: string, entityId?: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const code = payloadText(payload, "product_code", "产品编码");
  const name = payloadText(payload, "name", "产品名称");
  const spec = payloadText(payload, "spec", "规格", false);
  const unit = payloadText(payload, "unit", "单位");
  const processFee = payloadNumber(payload, "process_fee", "加工费", { min: 0 });
  const defaultMargin = payloadNumber(payload, "default_margin", "默认利润率", { min: 0 });
  const status = payloadStatus(payload);
  const remark = payloadText(payload, "remark", "备注", false);
  const timestamp = now();

  assertUniqueCode(database, "products", "product_code", code, entityId);

  if (entityId) {
    const existing = database.prepare("SELECT id FROM products WHERE id = ?").get(entityId);
    if (!existing) throw new Error("产品不存在。");
    database.prepare(`
      UPDATE products
      SET product_code = ?, name = ?, spec = ?, unit = ?, process_fee = ?, default_margin = ?,
          status = ?, remark = ?, updated_at = ?
      WHERE id = ?
    `).run(code, name, spec, unit, processFee, defaultMargin, status, remark, timestamp, entityId);
    audit(database, actorId, "update", "product", entityId, `更新产品 ${name}`);
    return;
  }

  const id = uid("PROD");
  database.prepare(`
    INSERT INTO products (
      id, product_code, name, spec, unit, process_fee, default_margin,
      status, remark, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, code, name, spec, unit, processFee, defaultMargin, status, remark, timestamp, timestamp);
  audit(database, actorId, "create", "product", id, `新增产品 ${name}`);
}

function createBomVersion(database: Database.Database, actorId: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const productId = payloadText(payload, "product_id", "产品");
  const version = payloadText(payload, "version", "BOM 版本");
  const materialId = payloadText(payload, "material_id", "物料");
  const qtyPer = payloadNumber(payload, "qty_per", "单位用量", { min: 0.000001 });
  const isPrimary = payload["is_primary"] === true || payload["is_primary"] === "true" ? 1 : 0;
  const remark = payloadText(payload, "remark", "备注", false);
  const timestamp = now();

  const product = database.prepare("SELECT id, name FROM products WHERE id = ? AND status = 'active'").get(productId) as
    | { id: string; name: string }
    | undefined;
  if (!product) throw new Error("请选择有效的启用产品。");
  const material = database.prepare("SELECT id, name FROM materials WHERE id = ? AND status = 'active'").get(materialId) as
    | { id: string; name: string }
    | undefined;
  if (!material) throw new Error("请选择有效的启用物料。");

  database.prepare("UPDATE boms SET status = 'inactive', updated_at = ? WHERE product_id = ? AND status = 'active'").run(
    timestamp,
    productId,
  );
  const id = uid("BOM");
  database.prepare(`
    INSERT INTO boms (id, product_id, version, status, remark, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)
  `).run(id, productId, version, remark, timestamp, timestamp);
  database.prepare(`
    INSERT INTO bom_lines (bom_id, parent_product_id, component_type, component_id, qty_per, is_primary)
    VALUES (?, ?, 'material', ?, ?, ?)
  `).run(id, productId, materialId, qtyPer, isPrimary);
  audit(database, actorId, "create", "bom", id, `新增 ${product.name} ${version}，首行物料 ${material.name}`);
}

function createQuote(database: Database.Database, actorId: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const customerId = payloadText(payload, "customer_id", "客户");
  const productId = payloadText(payload, "product_id", "产品");
  const qty = payloadNumber(payload, "qty", "报价数量", { min: 0.000001 });
  const marginRate = payloadNumber(payload, "margin_rate", "利润率", { min: 0 });

  const customer = database.prepare("SELECT id, name FROM customers WHERE id = ? AND status = 'active'").get(customerId) as
    | { id: string; name: string }
    | undefined;
  if (!customer) throw new Error("请选择启用状态的客户。");
  const product = database.prepare(`
    SELECT id, name, process_fee, default_margin
    FROM products
    WHERE id = ? AND status = 'active'
  `).get(productId) as { id: string; name: string; process_fee: number; default_margin: number } | undefined;
  if (!product) throw new Error("请选择启用状态的产品。");

  const bomLines = activeBomLines(database, product.id);
  const expansion = expandBom({
    rootProductId: product.id,
    quantity: qty,
    lines: bomLines,
  });
  if (expansion.materials.length === 0) throw new Error("当前产品没有启用 BOM，无法自动报价。");

  const materialCost = roundMoney(
    expansion.materials.reduce((sum, line) => {
      const material = database.prepare("SELECT average_cost FROM materials WHERE id = ?").get(line.materialId) as
        | { average_cost: number }
        | undefined;
      if (!material) throw new Error(`BOM 物料 ${line.materialId} 不存在。`);
      return sum + line.requiredQty * Number(material.average_cost ?? 0);
    }, 0),
  );
  const processFee = roundMoney(Number(product.process_fee ?? 0) * qty);
  const totalAmount = roundMoney((materialCost + processFee) * (1 + marginRate));
  const quoteId = uid("Q");
  const quoteNo = serial(database, "quotes", "BJ");
  const version = (
    database.prepare("SELECT COUNT(*) AS count FROM quotes WHERE customer_id = ? AND product_id = ?").get(customer.id, product.id) as {
      count: number;
    }
  ).count + 1;

  database.prepare(`
    INSERT INTO quotes (
      id, quote_no, customer_id, product_id, qty, version, material_cost,
      process_fee, margin_rate, total_amount, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(
    quoteId,
    quoteNo,
    customer.id,
    product.id,
    qty,
    version,
    materialCost,
    processFee,
    marginRate,
    totalAmount,
    now(),
  );
  audit(database, actorId, "createQuote", "quote", quoteId, `新建报价单 ${quoteNo}：${customer.name} / ${product.name}`);
}

function confirmQuote(database: Database.Database, actorId: string, quoteId: string) {
  const quote = database.prepare("SELECT * FROM quotes WHERE id = ?").get(quoteId) as
    | { id: string; status: string; quote_no: string }
    | undefined;
  if (!quote || quote.status !== "draft") throw new Error("报价单不是待确认状态。");
  database.prepare("UPDATE quotes SET status = 'confirmed' WHERE id = ?").run(quoteId);
  audit(database, actorId, "confirmQuote", "quote", quoteId, `确认报价单 ${quote.quote_no}`);
}

function createOrder(database: Database.Database, actorId: string, quoteId: string, rawPayload?: Record<string, unknown>) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const quote = database.prepare(`
    SELECT q.*, c.address AS customer_address, c.contact AS customer_contact, c.phone AS customer_phone
    FROM quotes q
    JOIN customers c ON c.id = q.customer_id
    WHERE q.id = ?
  `).get(quoteId) as
    | {
        id: string;
        status: string;
        quote_no: string;
        customer_id: string;
        product_id: string;
        qty: number;
        customer_address?: string;
        customer_contact?: string;
        customer_phone?: string;
      }
    | undefined;
  if (!quote || quote.status !== "confirmed") throw new Error("只有已确认报价单可转订单。");
  const orderId = uid("O");
  const orderNo = serial(database, "orders", "DD");
  const due = payloadDate(
    payload,
    "due_date",
    "交付日期",
    new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10),
  );
  const specialRequirements =
    payloadText(payload, "special_requirements", "特殊要求", false) || "客户要求批次可追溯，随货提供检验记录";
  const customerPoNo = payloadText(payload, "customer_po_no", "客户订单号", false);
  const salesContractNo = payloadText(payload, "sales_contract_no", "销售合同号", false);
  const deliveryAddress = payloadText(payload, "delivery_address", "交付地址", false) || quote.customer_address || "";
  const consignee = payloadText(payload, "consignee", "收货人", false) || quote.customer_contact || "";
  const contactPhone = payloadText(payload, "contact_phone", "联系电话", false) || quote.customer_phone || "";
  const paymentTermsDays = Math.trunc(
    payload.payment_terms_days == null || payload.payment_terms_days === ""
      ? 30
      : payloadNumber(payload, "payment_terms_days", "账期天数", { min: 0 }),
  );
  const remark = payloadText(payload, "remark", "备注", false);
  database.prepare(`
    INSERT INTO orders (
      id, order_no, quote_id, customer_id, product_id, qty, due_date,
      special_requirements, customer_po_no, sales_contract_no, delivery_address,
      consignee, contact_phone, payment_terms_days, remark, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)
  `).run(
    orderId,
    orderNo,
    quote.id,
    quote.customer_id,
    quote.product_id,
    quote.qty,
    due,
    specialRequirements,
    customerPoNo,
    salesContractNo,
    deliveryAddress,
    consignee,
    contactPhone,
    paymentTermsDays,
    remark,
    now(),
  );
  database.prepare("UPDATE quotes SET status = 'converted' WHERE id = ?").run(quoteId);
  audit(database, actorId, "createOrder", "order", orderId, `由 ${quote.quote_no} 生成正式订单 ${orderNo}`);
}

function productionPriority(payload: Record<string, unknown>) {
  const priority = payloadText(payload, "priority", "优先级", false) || "normal";
  if (["normal", "urgent", "high"].includes(priority)) return priority;
  throw new Error("优先级只能是普通、加急或高优先级。");
}

function createProductionInstruction(
  database: Database.Database,
  actorId: string,
  orderId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const order = database.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as
    | { id: string; status: string; order_no: string }
    | undefined;
  if (!order || order.status !== "submitted") throw new Error("订单不是待下发生产状态。");
  const productionId = uid("PO");
  const prodNo = serial(database, "production_orders", "SC");
  const timestamp = now();
  const priority = productionPriority(payload);
  const instructionNote =
    payloadText(payload, "instruction_note", "生产指令说明", false) || "按客户订单要求组织生产，并保留批次追溯。";
  const technicalRequirements =
    payloadText(payload, "technical_requirements", "技术要求", false) || "按系统当前启用 BOM 和工艺要求执行。";
  database.prepare(`
    INSERT INTO production_orders (
      id, prod_no, order_id, priority, instruction_note, technical_requirements,
      issued_by, issued_at, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'instructed', ?)
  `).run(productionId, prodNo, order.id, priority, instructionNote, technicalRequirements, actorId, timestamp, timestamp);
  database.prepare("UPDATE orders SET status = 'in_production' WHERE id = ?").run(order.id);
  audit(database, actorId, "createProductionInstruction", "production_order", productionId, `下发生产指令 ${prodNo}`);
}

function scheduleAndGenerateRequisition(
  database: Database.Database,
  actorId: string,
  productionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const production = database.prepare(`
    SELECT po.*, o.product_id, o.qty, o.order_no
    FROM production_orders po JOIN orders o ON o.id = po.order_id
    WHERE po.id = ?
  `).get(productionId) as
    | { id: string; status: string; product_id: string; qty: number; prod_no: string; order_no: string }
    | undefined;
  if (!production || production.status !== "instructed") throw new Error("生产单不是待排产状态。");

  const bom = database.prepare(`
    SELECT id, version
    FROM boms
    WHERE product_id = ? AND status = 'active'
    ORDER BY version DESC
    LIMIT 1
  `).get(production.product_id) as { id: string; version: string } | undefined;
  const bomLines = activeBomLines(database, production.product_id);
  const expansion = expandBom({
    rootProductId: production.product_id,
    quantity: production.qty,
    lines: bomLines,
  });
  if (expansion.materials.length === 0) throw new Error("当前产品没有可用 BOM。");

  const scheduleId = uid("SCH");
  const plannedDate = payloadDate(
    payload,
    "planned_date",
    "计划生产日期",
    new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString().slice(0, 10),
  );
  const machine = payloadText(payload, "machine", "机台", false) || "未指定机台";
  const owner = payloadText(payload, "owner", "负责人", false) || "未指定负责人";
  const shift = payloadText(payload, "shift", "班次", false) || "白班";
  const scheduleNote = payloadText(payload, "schedule_note", "排产备注", false);
  const requisitionNote = payloadText(payload, "requisition_note", "领料说明", false) || "按系统计算需求量领料，仓库默认 FIFO 发料。";
  database.prepare(`
    INSERT INTO schedules (id, production_order_id, planned_date, machine, owner, shift, schedule_note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'planned')
  `).run(scheduleId, production.id, plannedDate, machine, owner, shift, scheduleNote);

  const requisitionId = uid("REQ");
  const reqNo = serial(database, "requisitions", "LL");
  database.prepare(`
    INSERT INTO requisitions (
      id, req_no, production_order_id, bom_id, bom_version, requisition_note, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending_approval', ?)
  `).run(requisitionId, reqNo, production.id, bom?.id ?? "", bom?.version ?? "", requisitionNote, now());

  const insertLine = database.prepare(`
    INSERT INTO requisition_lines (id, requisition_id, material_id, required_qty, issued_qty, is_primary, status)
    VALUES (?, ?, ?, ?, 0, ?, 'pending')
  `);
  for (const material of expansion.materials) {
    insertLine.run(uid("RL"), requisitionId, material.materialId, material.requiredQty, material.isPrimary ? 1 : 0);
  }

  database.prepare("UPDATE production_orders SET status = 'material_requested' WHERE id = ?").run(production.id);
  audit(database, actorId, "scheduleAndGenerateRequisition", "requisition", requisitionId, `排产并生成领料单 ${reqNo}`);
}

function updateProductionSchedule(
  database: Database.Database,
  actorId: string,
  productionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const schedule = database.prepare(`
    SELECT s.*, po.prod_no, po.status AS production_status
    FROM schedules s
    JOIN production_orders po ON po.id = s.production_order_id
    WHERE po.id = ?
    ORDER BY s.rowid DESC
    LIMIT 1
  `).get(productionId) as
    | {
        id: string;
        production_order_id: string;
        planned_date: string;
        machine: string;
        owner: string;
        shift: string;
        schedule_note: string;
        prod_no: string;
        production_status: string;
      }
    | undefined;
  if (!schedule) throw new Error("生产单尚未排产，不能执行排产变更。");
  if (["shipped", "voided", "cancelled"].includes(schedule.production_status)) {
    throw new Error("生产单已完成或关闭，不能调整排产。");
  }

  const plannedDate = payloadDate(payload, "planned_date", "计划生产日期", schedule.planned_date);
  const machine = payloadText(payload, "machine", "机台", false) || schedule.machine;
  const owner = payloadText(payload, "owner", "负责人", false) || schedule.owner;
  const shift = payloadText(payload, "shift", "班次", false) || schedule.shift || "白班";
  const scheduleNote = payloadText(payload, "schedule_note", "排产备注", false) || schedule.schedule_note || "";
  const changeReason = payloadText(payload, "change_reason", "变更原因", true);
  const changedAt = now();
  const changeId = uid("SCHC");

  database.prepare(`
    INSERT INTO production_schedule_changes (
      id, schedule_id, production_order_id,
      old_planned_date, new_planned_date,
      old_machine, new_machine,
      old_owner, new_owner,
      old_shift, new_shift,
      old_schedule_note, new_schedule_note,
      change_reason, changed_by, changed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    changeId,
    schedule.id,
    schedule.production_order_id,
    schedule.planned_date,
    plannedDate,
    schedule.machine,
    machine,
    schedule.owner,
    owner,
    schedule.shift,
    shift,
    schedule.schedule_note,
    scheduleNote,
    changeReason,
    actorId,
    changedAt,
  );

  database.prepare(`
    UPDATE schedules
    SET planned_date = ?, machine = ?, owner = ?, shift = ?, schedule_note = ?, status = 'revised'
    WHERE id = ?
  `).run(plannedDate, machine, owner, shift, scheduleNote, schedule.id);

  createProductionPlanChangeNotifications(database, actorId, changeId);
  createProductionPlanChangeImpacts(database, actorId, changeId);
  audit(database, actorId, "updateProductionSchedule", "production_order", productionId, `调整生产排产 ${schedule.prod_no}：${changeReason}`);
}

function productionPlanFiltersFromPayload(rawPayload?: Record<string, unknown>) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  return normalizeReportFilters({
    dateFrom: payloadText(payload, "date_from", "计划开始日期", false) || payloadText(payload, "dateFrom", "计划开始日期", false),
    dateTo: payloadText(payload, "date_to", "计划结束日期", false) || payloadText(payload, "dateTo", "计划结束日期", false),
    customerId: payloadText(payload, "customer_id", "客户", false) || payloadText(payload, "customerId", "客户", false),
    orderId: payloadText(payload, "order_id", "订单", false) || payloadText(payload, "orderId", "订单", false),
  });
}

function lockProductionPlan(database: Database.Database, actorId: string, rawPayload?: Record<string, unknown>) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const pending = database
    .prepare("SELECT plan_no FROM production_plan_versions WHERE status = 'pending_approval' ORDER BY locked_at DESC LIMIT 1")
    .get() as { plan_no?: string } | undefined;
  if (pending) throw new Error(`已有生产计划锁版待审批：${pending.plan_no}。`);

  const filters = productionPlanFiltersFromPayload(payload);
  const note = payloadText(payload, "note", "锁版说明", false) || "生产计划锁版，提交管理层审批发布。";
  const sourceRows = productionPlanSourceRows(database, filters).filter((row) => row.planned_date);
  if (sourceRows.length === 0) throw new Error("当前筛选范围没有已排产生产单，不能锁版发布。");

  const planId = uid("PPV");
  const approvalId = uid("OA");
  const planNo = serial(database, "production_plan_versions", "SCJH");
  const approvalNo = serial(database, "approval_requests", "SP");
  const versionNo =
    Number((database.prepare("SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no FROM production_plan_versions").get() as { next_no: number }).next_no ?? 1);
  const lockedAt = now();
  const machineCount = new Set(sourceRows.map((row) => String(row.machine ?? "")).filter(Boolean)).size;
  const warningCount = sourceRows.filter((row) => String(row.delivery_risk_status ?? "normal") !== "normal").length;
  const filterSummary = reportFilterSummary(database, filters);
  const approvalRule = matchApprovalRule(database, "production_plan", 0);

  database.prepare(`
    INSERT INTO approval_requests (
      id, request_no, type, title, applicant_id, status, amount,
      reason, rule_id, approver_role, sla_hours, entity_type, entity_id,
      created_at, decided_by, decided_at, decision_note
    )
    VALUES (?, ?, '生产计划发布', ?, ?, 'pending', 0, ?, ?, ?, ?, 'production_plan', ?, ?, NULL, NULL, NULL)
  `).run(
    approvalId,
    approvalNo,
    `生产计划 ${planNo} 锁版发布审批`,
    actorId,
    `${note}；范围：${filterSummary}；计划单数：${sourceRows.length}。`,
    approvalRule?.id ?? null,
    approvalRule?.approver_role ?? "manager",
    approvalRule?.sla_hours ?? 24,
    planId,
    lockedAt,
  );

  database.prepare(`
    INSERT INTO production_plan_versions (
      id, plan_no, version_no, status, filter_summary, filters_json, note,
      production_count, machine_count, warning_count, approval_request_id,
      locked_by, locked_at, published_by, published_at, approval_note
    )
    VALUES (?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '')
  `).run(
    planId,
    planNo,
    versionNo,
    filterSummary,
    JSON.stringify(filters),
    note,
    sourceRows.length,
    machineCount,
    warningCount,
    approvalId,
    actorId,
    lockedAt,
  );

  const insertLine = database.prepare(`
    INSERT INTO production_plan_lines (
      id, plan_id, production_order_id, schedule_id, prod_no, order_no,
      customer_name, product_name, planned_date, due_date, machine, owner, shift,
      order_qty, unit, status, delivery_risk_status, delivery_risk_label, schedule_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  sourceRows.forEach((row) => {
    insertLine.run(
      uid("PPL"),
      planId,
      row.id,
      row.schedule_id ?? null,
      row.prod_no,
      row.order_no,
      row.customer_name ?? "",
      row.product_name ?? "",
      row.planned_date,
      row.due_date ?? "",
      row.machine ?? "",
      row.owner ?? "",
      row.shift ?? "",
      Number(row.order_qty ?? 0),
      row.unit ?? "",
      row.status ?? "",
      row.delivery_risk_status ?? "normal",
      row.delivery_risk_label ?? "正常",
      row.schedule_note ?? "",
    );
  });

  audit(database, actorId, "lockProductionPlan", "production_plan", planId, `生产计划 ${planNo} 锁版并提交审批 ${approvalNo}`);
}

function decideProductionPlanApproval(
  database: Database.Database,
  actorId: string,
  planId: string,
  status: "approved" | "rejected",
  note: string,
  decidedAt: string,
) {
  const plan = database.prepare("SELECT * FROM production_plan_versions WHERE id = ?").get(planId) as
    | { id: string; plan_no: string; status: string }
    | undefined;
  if (!plan || plan.status !== "pending_approval") return;
  if (status === "approved") {
    database.prepare("UPDATE production_plan_versions SET status = 'superseded' WHERE status = 'published' AND id <> ?").run(plan.id);
    database.prepare(`
      UPDATE production_plan_versions
      SET status = 'published', published_by = ?, published_at = ?, approval_note = ?
      WHERE id = ?
    `).run(actorId, decidedAt, note, plan.id);
  } else {
    database.prepare(`
      UPDATE production_plan_versions
      SET status = 'rejected', approval_note = ?
      WHERE id = ?
    `).run(note, plan.id);
  }
  audit(
    database,
    actorId,
    status === "approved" ? "publishProductionPlan" : "rejectProductionPlan",
    "production_plan",
    plan.id,
    `${status === "approved" ? "发布" : "驳回"}生产计划 ${plan.plan_no}`,
  );
}

function createProductionPlanChangeNotifications(database: Database.Database, actorId: string, scheduleChangeId: string) {
  const change = database.prepare(`
    SELECT psc.*, po.prod_no, o.order_no, c.name AS customer_name, p.name AS product_name
    FROM production_schedule_changes psc
    JOIN production_orders po ON po.id = psc.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    WHERE psc.id = ?
  `).get(scheduleChangeId) as Record<string, unknown> | undefined;
  if (!change) return;

  const plan = database.prepare(`
    SELECT ppv.*
    FROM production_plan_versions ppv
    JOIN production_plan_lines ppl ON ppl.plan_id = ppv.id
    WHERE ppv.status = 'published'
      AND ppl.production_order_id = ?
    ORDER BY ppv.published_at DESC, ppv.locked_at DESC
    LIMIT 1
  `).get(change.production_order_id) as Record<string, unknown> | undefined;
  if (!plan) return;

  const actor = getUser(database, actorId);
  const recipients: Role[] = ["assistant", "warehouse", "quality", "manager"];
  const createdAt = now();
  const title = `生产计划变更 ${change.prod_no}`;
  const detail = `${plan.plan_no} 已发布后发生排产变更：${change.old_planned_date || "未排产"} / ${change.old_machine || "未指定机台"} -> ${change.new_planned_date} / ${change.new_machine}；原因：${change.change_reason}；变更人：${actor.name}。`;
  const insert = database.prepare(`
    INSERT INTO production_plan_notifications (
      id, notification_no, plan_id, schedule_change_id, production_order_id,
      recipient_role, title, detail, status, created_at,
      acknowledged_by, acknowledged_at, acknowledge_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, '')
  `);
  recipients.forEach((role) => {
    insert.run(uid("PPN"), serial(database, "production_plan_notifications", "TZ"), plan.id, scheduleChangeId, change.production_order_id, role, title, detail, createdAt);
  });
}

function createProductionPlanChangeImpacts(database: Database.Database, actorId: string, scheduleChangeId: string) {
  const change = database.prepare(`
    SELECT psc.*, po.prod_no, po.status AS production_status,
           o.id AS order_id, o.order_no, o.due_date, o.qty AS order_qty,
           c.name AS customer_name, p.name AS product_name, p.unit
    FROM production_schedule_changes psc
    JOIN production_orders po ON po.id = psc.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    WHERE psc.id = ?
  `).get(scheduleChangeId) as Record<string, unknown> | undefined;
  if (!change) return;

  const plan = database.prepare(`
    SELECT ppv.*
    FROM production_plan_versions ppv
    JOIN production_plan_lines ppl ON ppl.plan_id = ppv.id
    WHERE ppv.status = 'published'
      AND ppl.production_order_id = ?
    ORDER BY ppv.published_at DESC, ppv.locked_at DESC
    LIMIT 1
  `).get(change.production_order_id) as Record<string, unknown> | undefined;
  if (!plan) return;

  const oldValue = `${change.old_planned_date || "未排产"} / ${change.old_machine || "未指定机台"}`;
  const newValue = `${change.new_planned_date || "未排产"} / ${change.new_machine || "未指定机台"}`;
  const createdAt = now();
  const changedDays = Math.abs(dateDiffDays(change.old_planned_date, change.new_planned_date));
  const deliveryDelayDays = dateDiffDays(change.due_date, change.new_planned_date);
  const insertImpact = database.prepare(`
    INSERT INTO production_plan_change_impacts (
      id, impact_no, plan_id, schedule_change_id, production_order_id,
      impact_type, affected_role, severity, summary, suggested_action,
      source_document_type, source_document_id, source_document_no,
      old_value, new_value, status, created_at,
      resolved_by, resolved_at, resolution_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, '')
  `);
  const exists = database.prepare(`
    SELECT id
    FROM production_plan_change_impacts
    WHERE schedule_change_id = ?
      AND impact_type = ?
      AND affected_role = ?
      AND COALESCE(source_document_id, '') = COALESCE(?, '')
    LIMIT 1
  `);
  const addImpact = (input: {
    impactType: string;
    affectedRole: Role;
    severity: "low" | "medium" | "high" | "critical";
    summary: string;
    suggestedAction: string;
    sourceDocumentType?: string;
    sourceDocumentId?: string | null;
    sourceDocumentNo?: string;
  }) => {
    if (exists.get(scheduleChangeId, input.impactType, input.affectedRole, input.sourceDocumentId ?? "")) return;
    insertImpact.run(
      uid("PPI"),
      serial(database, "production_plan_change_impacts", "YX"),
      plan.id,
      scheduleChangeId,
      change.production_order_id,
      input.impactType,
      input.affectedRole,
      input.severity,
      input.summary,
      input.suggestedAction,
      input.sourceDocumentType ?? "",
      input.sourceDocumentId ?? null,
      input.sourceDocumentNo ?? "",
      oldValue,
      newValue,
      createdAt,
    );
  };

  const requisitions = database.prepare(`
    SELECT *
    FROM requisitions
    WHERE production_order_id = ?
    ORDER BY created_at DESC
  `).all(change.production_order_id) as Array<Record<string, unknown>>;
  const latestRequisition = requisitions[0];
  if (latestRequisition) {
    const requisitionStatus = String(latestRequisition.status ?? "");
    const issued = requisitionStatus === "issued";
    addImpact({
      impactType: "material_requisition",
      affectedRole: "warehouse",
      severity: issued ? "high" : "medium",
      summary: `生产计划由 ${oldValue} 调整为 ${newValue}，领料单 ${latestRequisition.req_no} 需同步备料和发料窗口。`,
      suggestedAction: issued
        ? "复核已发料批次、现场库存和退补料需求，必要时发起补料或退料处理。"
        : "按新计划日期调整备料窗口，复核 FIFO 批次和替代料安排。",
      sourceDocumentType: "requisition",
      sourceDocumentId: String(latestRequisition.id),
      sourceDocumentNo: String(latestRequisition.req_no),
    });
  }

  const requisitionIds = requisitions.map((item) => String(item.id));
  const materialIds =
    requisitionIds.length > 0
      ? (
          database
            .prepare(`SELECT DISTINCT material_id FROM requisition_lines WHERE requisition_id IN (${requisitionIds.map(() => "?").join(",")})`)
            .all(...requisitionIds) as Array<{ material_id: string }>
        ).map((item) => item.material_id)
      : [];
  if (materialIds.length > 0) {
    const purchaseRows = database.prepare(`
      SELECT po.id, po.purchase_no, po.status, po.due_date, s.name AS supplier_name,
             GROUP_CONCAT(DISTINCT m.name) AS material_names
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
      JOIN materials m ON m.id = pol.material_id
      WHERE po.status IN ('pending_approval', 'pending_receipt', 'iqc_pending')
        AND pol.material_id IN (${materialIds.map(() => "?").join(",")})
      GROUP BY po.id
      ORDER BY po.due_date ASC, po.created_at ASC
    `).all(...materialIds) as Array<Record<string, unknown>>;
    purchaseRows.forEach((purchase) => {
      const purchaseLateDays = dateDiffDays(change.new_planned_date, purchase.due_date);
      addImpact({
        impactType: "purchase_arrival",
        affectedRole: "purchasing",
        severity: purchaseLateDays > 0 ? "high" : changedDays >= 3 ? "medium" : "low",
        summary:
          purchaseLateDays > 0
            ? `采购单 ${purchase.purchase_no} 预计到货 ${purchase.due_date}，晚于新计划 ${change.new_planned_date} ${purchaseLateDays} 天，需协调供应商。`
            : `采购单 ${purchase.purchase_no} 与生产计划同步变更，需复核到货和仓库签收节奏。`,
        suggestedAction: "确认供应商到货日期、合同交付承诺和仓库签收计划，必要时调整采购到货通知。",
        sourceDocumentType: "purchase_order",
        sourceDocumentId: String(purchase.id),
        sourceDocumentNo: String(purchase.purchase_no),
      });
    });
  }

  const inspection = database.prepare(`
    SELECT *
    FROM inspections
    WHERE production_order_id = ?
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(change.production_order_id) as Record<string, unknown> | undefined;
  addImpact({
    impactType: "quality_window",
    affectedRole: "quality",
    severity: String(change.production_status) === "inspection_requested" ? "high" : "medium",
    summary: `生产计划调整为 ${newValue}，质检请验和检验资源窗口需同步更新。`,
    suggestedAction: "同步调整 OQC 请验排队、检验人员和检验设备安排，确保合格后及时入库。",
    sourceDocumentType: inspection ? "inspection" : "production_order",
    sourceDocumentId: inspection ? String(inspection.id) : String(change.production_order_id),
    sourceDocumentNo: inspection ? String(inspection.inspection_no) : String(change.prod_no),
  });

  addImpact({
    impactType: "delivery_commitment",
    affectedRole: "assistant",
    severity: deliveryDelayDays > 0 ? (deliveryDelayDays >= 7 ? "critical" : "high") : changedDays >= 3 ? "medium" : "low",
    summary:
      deliveryDelayDays > 0
        ? `新计划 ${change.new_planned_date} 晚于订单交期 ${change.due_date} ${deliveryDelayDays} 天，交付承诺存在风险。`
        : `生产计划由 ${oldValue} 调整为 ${newValue}，商务需确认发货排期和客户沟通口径。`,
    suggestedAction: "复核客户交付期限、成品入库后发货窗口和送货单安排，必要时同步客户并更新订单备注。",
    sourceDocumentType: "order",
    sourceDocumentId: String(change.order_id),
    sourceDocumentNo: String(change.order_no),
  });

  audit(database, actorId, "createProductionPlanChangeImpacts", "production_schedule_change", scheduleChangeId, `生成生产计划变更影响清单 ${change.prod_no}`);
}

function acknowledgeProductionPlanNotification(
  database: Database.Database,
  actorId: string,
  notificationId: string,
  rawPayload?: Record<string, unknown>,
) {
  const notification = database.prepare("SELECT * FROM production_plan_notifications WHERE id = ?").get(notificationId) as
    | { id: string; notification_no: string; recipient_role: Role; status: string }
    | undefined;
  if (!notification) throw new Error("生产计划变更通知不存在。");
  if (notification.status !== "pending") throw new Error("生产计划变更通知已处理。");
  const actor = getUser(database, actorId);
  if (actor.role !== notification.recipient_role && actor.role !== "admin" && actor.role !== "manager") {
    throw new Error(`${actor.role_label} 不是该生产计划变更通知的责任角色。`);
  }
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const note = payloadText(payload, "acknowledge_note", "确认说明", false) || "已确认生产计划变更。";
  const acknowledgedAt = now();
  database.prepare(`
    UPDATE production_plan_notifications
    SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?, acknowledge_note = ?
    WHERE id = ?
  `).run(actorId, acknowledgedAt, note, notification.id);
  audit(database, actorId, "ackProductionPlanNotification", "production_plan_notification", notification.id, `确认生产计划变更通知 ${notification.notification_no}`);
}

function resolveProductionPlanChangeImpact(
  database: Database.Database,
  actorId: string,
  impactId: string,
  rawPayload?: Record<string, unknown>,
) {
  const impact = database.prepare(`
    SELECT ppci.*, psc.old_planned_date, psc.new_planned_date, psc.old_machine, psc.new_machine,
           po.prod_no, o.id AS order_id, o.order_no, o.customer_id, o.due_date,
           c.name AS customer_name, p.name AS product_name
    FROM production_plan_change_impacts ppci
    JOIN production_schedule_changes psc ON psc.id = ppci.schedule_change_id
    JOIN production_orders po ON po.id = ppci.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    WHERE ppci.id = ?
  `).get(impactId) as
    | {
        id: string;
        impact_no: string;
        impact_type: string;
        affected_role: Role;
        status: string;
        production_order_id: string;
        source_document_type?: string | null;
        source_document_id?: string | null;
        source_document_no?: string | null;
        new_planned_date?: string | null;
        prod_no: string;
        order_id: string;
        order_no: string;
        customer_id: string;
        due_date: string;
        customer_name: string;
        product_name: string;
      }
    | undefined;
  if (!impact) throw new Error("生产计划变更影响记录不存在。");
  if (impact.status !== "pending") throw new Error("生产计划变更影响记录已处理。");
  const actor = getUser(database, actorId);
  if (actor.role !== impact.affected_role && actor.role !== "admin" && actor.role !== "manager") {
    throw new Error(`${actor.role_label} 不是该影响事项的责任角色。`);
  }
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const note = payloadText(payload, "resolution_note", "处理说明", false) || "已确认影响并同步调整责任事项。";
  const linkedDocument = createProductionPlanImpactLinkedDocument(database, actorId, impact, payload, note);
  const resolvedAt = now();
  database.prepare(`
    UPDATE production_plan_change_impacts
    SET status = 'resolved',
        resolved_by = ?,
        resolved_at = ?,
        resolution_note = ?,
        linked_document_type = ?,
        linked_document_id = ?,
        linked_document_no = ?
    WHERE id = ?
  `).run(
    actorId,
    resolvedAt,
    note,
    linkedDocument.documentType,
    linkedDocument.documentId,
    linkedDocument.documentNo,
    impact.id,
  );
  audit(database, actorId, "resolveProductionPlanChangeImpact", "production_plan_change_impact", impact.id, `处理生产计划变更影响 ${impact.impact_no}，联动 ${linkedDocument.documentNo}`);
}

function createProductionPlanImpactLinkedDocument(
  database: Database.Database,
  actorId: string,
  impact: {
    id: string;
    impact_no: string;
    impact_type: string;
    production_order_id: string;
    source_document_id?: string | null;
    source_document_no?: string | null;
    new_planned_date?: string | null;
    prod_no: string;
    order_id: string;
    customer_id: string;
    due_date: string;
  },
  payload: Record<string, unknown>,
  resolutionNote: string,
) {
  if (impact.impact_type === "purchase_arrival") {
    return linkPurchaseArrivalNoticeFromPlanImpact(database, actorId, impact, payload, resolutionNote);
  }
  if (impact.impact_type === "material_requisition") {
    return linkMaterialAdjustmentSuggestionFromPlanImpact(database, actorId, impact, payload, resolutionNote);
  }
  if (impact.impact_type === "quality_window") {
    return linkQualityInspectionWindowFromPlanImpact(database, actorId, impact, payload, resolutionNote);
  }
  if (impact.impact_type === "delivery_commitment") {
    return linkCustomerDeliveryConfirmationFromPlanImpact(database, actorId, impact, payload, resolutionNote);
  }
  return {
    documentType: "production_plan_change_impact",
    documentId: impact.id,
    documentNo: impact.impact_no,
  };
}

function linkPurchaseArrivalNoticeFromPlanImpact(
  database: Database.Database,
  actorId: string,
  impact: {
    id: string;
    impact_no: string;
    source_document_id?: string | null;
    source_document_no?: string | null;
    new_planned_date?: string | null;
  },
  payload: Record<string, unknown>,
  resolutionNote: string,
) {
  const purchaseOrderId = impact.source_document_id;
  if (!purchaseOrderId) throw new Error("采购到货影响缺少关联采购订单，不能联动到货通知单。");
  const arrivalDate = payloadDate(
    payload,
    "new_arrival_date",
    "调整后到货日期",
    payloadText(payload, "arrival_date", "调整后到货日期", false) || String(impact.new_planned_date ?? new Date().toISOString().slice(0, 10)),
  );
  const note =
    payloadText(payload, "arrival_note", "到货通知说明", false) ||
    `生产计划变更影响 ${impact.impact_no} 已处理：${resolutionNote}`;
  const purchase = database.prepare("SELECT due_date FROM purchase_orders WHERE id = ?").get(purchaseOrderId) as
    | { due_date: string }
    | undefined;
  const contractBefore = database.prepare(`
    SELECT id, delivery_date
    FROM purchase_contracts
    WHERE purchase_order_id = ?
    LIMIT 1
  `).get(purchaseOrderId) as { id: string; delivery_date: string } | undefined;
  const fallbackOldArrivalDate = String(contractBefore?.delivery_date ?? purchase?.due_date ?? "");

  database.prepare(`
    UPDATE purchase_contracts
    SET delivery_date = ?,
        note = TRIM(COALESCE(note, '') || CASE WHEN COALESCE(note, '') = '' THEN '' ELSE '；' END || ?)
    WHERE purchase_order_id = ?
  `).run(arrivalDate, `生产计划变更后供应商到货日调整为 ${arrivalDate}`, purchaseOrderId);

  if (!contractBefore) {
    createPurchaseContract(database, actorId, purchaseOrderId, {
      delivery_date: arrivalDate,
      note: `生产计划变更影响 ${impact.impact_no} 处理时自动生成采购合同，并同步到货计划。`,
    });
  }

  const existing = database.prepare(`
    SELECT id, arrival_no, arrived_at, note
    FROM purchase_arrival_notices
    WHERE purchase_order_id = ?
      AND status IN ('pending_signoff', 'signed', 'iqc_created', 'discrepancy_pending', 'discrepancy_approved')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(purchaseOrderId) as { id: string; arrival_no: string; arrived_at: string; note: string } | undefined;
  if (existing) {
    database.prepare(`
      UPDATE purchase_arrival_notices
      SET arrived_at = ?,
          note = TRIM(COALESCE(note, '') || CASE WHEN COALESCE(note, '') = '' THEN '' ELSE '；' END || ?)
      WHERE id = ?
    `).run(arrivalDate, note, existing.id);
    createPurchaseArrivalNoticeChangeLog(database, actorId, {
      arrivalNoticeId: existing.id,
      purchaseOrderId,
      impactId: impact.id,
      oldArrivedAt: String(existing.arrived_at ?? fallbackOldArrivalDate),
      newArrivedAt: arrivalDate,
      oldNote: String(existing.note ?? ""),
      newNote: note,
      reason: resolutionNote,
    });
    return {
      documentType: "purchase_arrival_notice",
      documentId: existing.id,
      documentNo: existing.arrival_no,
    };
  }

  const created = createPurchaseArrivalNotice(database, actorId, purchaseOrderId, {
    arrived_at: arrivalDate,
    note,
  });
  createPurchaseArrivalNoticeChangeLog(database, actorId, {
    arrivalNoticeId: created.id,
    purchaseOrderId,
    impactId: impact.id,
    oldArrivedAt: fallbackOldArrivalDate,
    newArrivedAt: arrivalDate,
    oldNote: "",
    newNote: note,
    reason: resolutionNote,
  });
  return {
    documentType: "purchase_arrival_notice",
    documentId: created.id,
    documentNo: created.documentNo,
  };
}

function createPurchaseArrivalNoticeChangeLog(
  database: Database.Database,
  actorId: string,
  input: {
    arrivalNoticeId: string;
    purchaseOrderId: string;
    impactId?: string | null;
    oldArrivedAt: string;
    newArrivedAt: string;
    oldNote: string;
    newNote: string;
    reason: string;
  },
) {
  const changeId = uid("PANCL");
  const changeNo = serial(database, "purchase_arrival_notice_change_logs", "DHB");
  const changedAt = now();
  database.prepare(`
    INSERT INTO purchase_arrival_notice_change_logs (
      id, change_no, arrival_notice_id, purchase_order_id, impact_id,
      change_type, old_arrived_at, new_arrived_at, old_note, new_note,
      reason, changed_by, changed_at
    )
    VALUES (?, ?, ?, ?, ?, 'plan_impact_reschedule', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    changeId,
    changeNo,
    input.arrivalNoticeId,
    input.purchaseOrderId,
    input.impactId ?? null,
    input.oldArrivedAt,
    input.newArrivedAt,
    input.oldNote,
    input.newNote,
    input.reason,
    actorId,
    changedAt,
  );
  audit(database, actorId, "createPurchaseArrivalNoticeChangeLog", "purchase_arrival_notice", input.arrivalNoticeId, `到货通知变更留痕 ${changeNo}`);
  return { id: changeId, changeNo };
}

function linkMaterialAdjustmentSuggestionFromPlanImpact(
  database: Database.Database,
  actorId: string,
  impact: {
    id: string;
    impact_no: string;
    production_order_id: string;
    source_document_id?: string | null;
  },
  payload: Record<string, unknown>,
  resolutionNote: string,
) {
  const adjustmentTypeRaw = payloadText(payload, "adjustment_type", "补退料类型", false) || "check";
  const adjustmentType = ["supplement", "return", "check"].includes(adjustmentTypeRaw) ? adjustmentTypeRaw : "check";
  const suggestedQty =
    payloadText(payload, "suggested_qty", "建议数量", false) === ""
      ? 0
      : roundQty(payloadNumber(payload, "suggested_qty", "建议数量", { min: 0 }));
  const requisition =
    (impact.source_document_id
      ? (database.prepare("SELECT * FROM requisitions WHERE id = ?").get(impact.source_document_id) as Record<string, unknown> | undefined)
      : undefined) ??
    (database.prepare(`
      SELECT *
      FROM requisitions
      WHERE production_order_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(impact.production_order_id) as Record<string, unknown> | undefined);
  const materialSummary = requisition
    ? ((database.prepare(`
        SELECT GROUP_CONCAT(m.name || ' ' || rl.required_qty || m.unit, '、') AS summary
        FROM requisition_lines rl
        JOIN materials m ON m.id = rl.material_id
        WHERE rl.requisition_id = ?
      `).get(requisition.id) as { summary?: string | null }).summary ?? "")
    : "";
  const suggestionId = uid("PMAS");
  const suggestionNo = serial(database, "production_material_adjustment_suggestions", "BT");
  const createdAt = now();
  database.prepare(`
    INSERT INTO production_material_adjustment_suggestions (
      id, suggestion_no, impact_id, production_order_id, requisition_id,
      adjustment_type, suggested_qty, material_summary, reason, status,
      created_by, created_at, confirmed_by, confirmed_at, confirmation_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, ?, NULL, NULL, '')
  `).run(
    suggestionId,
    suggestionNo,
    impact.id,
    impact.production_order_id,
    requisition?.id ?? null,
    adjustmentType,
    suggestedQty,
    payloadText(payload, "material_summary", "物料摘要", false) || materialSummary,
    resolutionNote,
    actorId,
    createdAt,
  );
  return {
    documentType: "material_adjustment_suggestion",
    documentId: suggestionId,
    documentNo: suggestionNo,
  };
}

function linkQualityInspectionWindowFromPlanImpact(
  database: Database.Database,
  actorId: string,
  impact: {
    id: string;
    impact_no: string;
    production_order_id: string;
    source_document_id?: string | null;
    new_planned_date?: string | null;
  },
  payload: Record<string, unknown>,
  resolutionNote: string,
) {
  const actor = getUser(database, actorId);
  const inspection =
    (impact.source_document_id
      ? (database.prepare("SELECT * FROM inspections WHERE id = ?").get(impact.source_document_id) as Record<string, unknown> | undefined)
      : undefined) ??
    (database.prepare(`
      SELECT *
      FROM inspections
      WHERE production_order_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(impact.production_order_id) as Record<string, unknown> | undefined);
  const windowDate = payloadDate(
    payload,
    "inspection_window_date",
    "检验窗口日期",
    addDays(String(impact.new_planned_date ?? new Date().toISOString().slice(0, 10)), 1),
  );
  const windowId = uid("QIW");
  const windowNo = serial(database, "quality_inspection_window_confirmations", "ZJ");
  const createdAt = now();
  database.prepare(`
    INSERT INTO quality_inspection_window_confirmations (
      id, window_no, impact_id, production_order_id, inspection_id,
      inspection_window_date, inspector, status, note, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
  `).run(
    windowId,
    windowNo,
    impact.id,
    impact.production_order_id,
    inspection?.id ?? null,
    windowDate,
    payloadText(payload, "inspector", "检验员", false) || actor.name,
    resolutionNote,
    actorId,
    createdAt,
  );
  return {
    documentType: "quality_inspection_window",
    documentId: windowId,
    documentNo: windowNo,
  };
}

function linkCustomerDeliveryConfirmationFromPlanImpact(
  database: Database.Database,
  actorId: string,
  impact: {
    id: string;
    impact_no: string;
    production_order_id: string;
    order_id: string;
    customer_id: string;
    due_date: string;
    new_planned_date?: string | null;
  },
  payload: Record<string, unknown>,
  resolutionNote: string,
) {
  const proposedDate = payloadDate(
    payload,
    "proposed_delivery_date",
    "建议交付日期",
    addDays(String(impact.new_planned_date ?? new Date().toISOString().slice(0, 10)), 3),
  );
  const customerFeedback = payloadText(payload, "customer_feedback", "客户反馈", false);
  const confirmationStatus =
    payloadText(payload, "confirmation_status", "确认状态", false) || (customerFeedback ? "accepted" : "pending_customer");
  const confirmationId = uid("CDC");
  const confirmationNo = serial(database, "customer_delivery_confirmations", "JQ");
  const createdAt = now();
  database.prepare(`
    INSERT INTO customer_delivery_confirmations (
      id, confirmation_no, impact_id, order_id, production_order_id, customer_id,
      original_due_date, proposed_delivery_date, confirmation_status, contact_method,
      customer_feedback, status, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    confirmationId,
    confirmationNo,
    impact.id,
    impact.order_id,
    impact.production_order_id,
    impact.customer_id,
    impact.due_date,
    proposedDate,
    ["accepted", "pending_customer", "rejected"].includes(confirmationStatus) ? confirmationStatus : "pending_customer",
    payloadText(payload, "contact_method", "沟通方式", false) || "系统记录",
    customerFeedback || resolutionNote,
    actorId,
    createdAt,
  );
  return {
    documentType: "customer_delivery_confirmation",
    documentId: confirmationId,
    documentNo: confirmationNo,
  };
}

function confirmMaterialAdjustmentSuggestion(
  database: Database.Database,
  actorId: string,
  suggestionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const suggestion = database.prepare(`
    SELECT pmas.*, po.prod_no, r.req_no
    FROM production_material_adjustment_suggestions pmas
    JOIN production_orders po ON po.id = pmas.production_order_id
    LEFT JOIN requisitions r ON r.id = pmas.requisition_id
    WHERE pmas.id = ?
  `).get(suggestionId) as
    | {
        id: string;
        suggestion_no: string;
        impact_id: string;
        production_order_id: string;
        requisition_id?: string | null;
        adjustment_type: string;
        suggested_qty: number;
        material_summary: string;
        status: string;
      }
    | undefined;
  if (!suggestion) throw new Error("补退料建议单不存在。");
  if (suggestion.status !== "pending_confirmation") throw new Error("补退料建议单不是待确认状态。");
  const existingOrder = database.prepare(`
    SELECT order_no
    FROM production_material_adjustment_orders
    WHERE suggestion_id = ?
    LIMIT 1
  `).get(suggestion.id) as { order_no: string } | undefined;
  if (existingOrder) throw new Error(`补退料建议单已转正式单：${existingOrder.order_no}。`);

  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const confirmationNote = payloadText(payload, "confirmation_note", "确认说明", false) || "生产确认补退料建议，转正式补退料单执行。";
  const confirmedAt = now();
  const orderId = uid("PMAO");
  const orderNo = serial(database, "production_material_adjustment_orders", "BTD");
  database.prepare(`
    INSERT INTO production_material_adjustment_orders (
      id, order_no, suggestion_id, impact_id, production_order_id, requisition_id,
      adjustment_type, qty, material_summary, status, created_by, created_at,
      executed_by, executed_at, execution_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_execution', ?, ?, NULL, NULL, '')
  `).run(
    orderId,
    orderNo,
    suggestion.id,
    suggestion.impact_id,
    suggestion.production_order_id,
    suggestion.requisition_id ?? null,
    suggestion.adjustment_type,
    roundQty(Number(suggestion.suggested_qty ?? 0)),
    suggestion.material_summary ?? "",
    actorId,
    confirmedAt,
  );
  database.prepare(`
    UPDATE production_material_adjustment_suggestions
    SET status = 'confirmed',
        confirmed_by = ?,
        confirmed_at = ?,
        confirmation_note = ?
    WHERE id = ?
  `).run(actorId, confirmedAt, confirmationNote, suggestion.id);
  audit(database, actorId, "confirmMaterialAdjustmentSuggestion", "production_material_adjustment_order", orderId, `补退料建议 ${suggestion.suggestion_no} 转正式单 ${orderNo}`);
}

function materialForAdjustmentOrder(
  database: Database.Database,
  order: { requisition_id?: string | null },
  payload: Record<string, unknown>,
) {
  const requestedMaterialId = payloadText(payload, "material_id", "执行物料", false);
  const material =
    (requestedMaterialId
      ? (database.prepare("SELECT * FROM materials WHERE id = ?").get(requestedMaterialId) as
          | { id: string; name: string; average_cost: number }
          | undefined)
      : undefined) ??
    (order.requisition_id
      ? (database.prepare(`
          SELECT m.*
          FROM requisition_lines rl
          JOIN materials m ON m.id = rl.material_id
          WHERE rl.requisition_id = ?
          ORDER BY rl.is_primary DESC, rl.rowid ASC
          LIMIT 1
        `).get(order.requisition_id) as { id: string; name: string; average_cost: number } | undefined)
      : undefined);
  if (!material) throw new Error("补退料单缺少可执行物料，请选择物料后再执行。");
  return material;
}

function adjustmentExecutionQty(orderQty: number, payload: Record<string, unknown>) {
  const raw = payload.qty;
  const qty = raw == null || raw === "" ? Number(orderQty ?? 0) : payloadNumber(payload, "qty", "执行数量", { min: 0 });
  if (qty <= 0) throw new Error("执行数量必须大于 0。");
  return roundQty(qty);
}

function insertMaterialAdjustmentOrderLine(
  database: Database.Database,
  input: {
    orderId: string;
    materialId: string;
    batchId?: string | null;
    batchNo: string;
    direction: "in" | "out";
    qty: number;
    unitCost: number;
    movementId: string;
    createdAt: string;
  },
) {
  database.prepare(`
    INSERT INTO production_material_adjustment_order_lines (
      id, order_id, material_id, batch_id, batch_no, direction, qty, unit_cost, line_amount, movement_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid("PMAOL"),
    input.orderId,
    input.materialId,
    input.batchId ?? null,
    input.batchNo,
    input.direction,
    input.qty,
    input.unitCost,
    roundMoney(input.qty * input.unitCost),
    input.movementId,
    input.createdAt,
  );
}

function executeMaterialAdjustmentOrder(
  database: Database.Database,
  actorId: string,
  orderId: string,
  rawPayload?: Record<string, unknown>,
) {
  const order = database.prepare(`
    SELECT pmao.*, po.prod_no, pmas.suggestion_no
    FROM production_material_adjustment_orders pmao
    JOIN production_orders po ON po.id = pmao.production_order_id
    JOIN production_material_adjustment_suggestions pmas ON pmas.id = pmao.suggestion_id
    WHERE pmao.id = ?
  `).get(orderId) as
    | {
        id: string;
        order_no: string;
        suggestion_no: string;
        production_order_id: string;
        requisition_id?: string | null;
        adjustment_type: string;
        qty: number;
        status: string;
      }
    | undefined;
  if (!order) throw new Error("补退料单不存在。");
  if (order.status !== "pending_execution") throw new Error("补退料单不是待执行状态。");

  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const executionDate = payloadDate(payload, "execution_date", "执行日期", new Date().toISOString().slice(0, 10));
  const executedAt = `${executionDate}T00:00:00.000Z`;
  const executionNote = payloadText(payload, "execution_note", "执行说明", false) || "仓库按正式补退料单完成库存执行。";
  const qty = adjustmentExecutionQty(Number(order.qty ?? 0), payload);

  if (order.adjustment_type === "check") {
    database.prepare(`
      UPDATE production_material_adjustment_orders
      SET status = 'executed',
          executed_by = ?,
          executed_at = ?,
          execution_note = ?
      WHERE id = ?
    `).run(actorId, executedAt, executionNote, order.id);
    audit(database, actorId, "executeMaterialAdjustmentOrder", "production_material_adjustment_order", order.id, `复核补退料单 ${order.order_no}`);
    return;
  }

  const material = materialForAdjustmentOrder(database, order, payload);
  if (order.adjustment_type === "supplement") {
    const manualBatchId = payloadText(payload, "batch_id", "补料批次", false);
    const batches = manualBatchId
      ? (database.prepare(`
          SELECT id AS batchId, qty AS availableQty, received_at AS receivedAt, unit_cost AS unitCost, batch_no AS batchNo
          FROM material_batches
          WHERE id = ? AND material_id = ? AND qty > 0
        `).all(manualBatchId, material.id) as Array<{
          batchId: string;
          availableQty: number;
          receivedAt: string;
          unitCost: number;
          batchNo: string;
        }>)
      : (database.prepare(`
          SELECT id AS batchId, qty AS availableQty, received_at AS receivedAt, unit_cost AS unitCost, batch_no AS batchNo
          FROM material_batches
          WHERE material_id = ? AND qty > 0
          ORDER BY received_at ASC, rowid ASC
        `).all(material.id) as Array<{
          batchId: string;
          availableQty: number;
          receivedAt: string;
          unitCost: number;
          batchNo: string;
        }>);
    if (manualBatchId && batches.length === 0) throw new Error(`补料批次 ${manualBatchId} 不存在或库存不足。`);
    const allocation = allocateFifo(batches, qty);
    if (allocation.shortage > 0) throw new Error(`物料 ${material.id} 库存不足，缺口 ${allocation.shortage}。`);

    for (const item of allocation.allocations) {
      const batch = batches.find((candidate) => candidate.batchId === item.batchId);
      if (!batch) throw new Error("补料批次分配异常。");
      database.prepare("UPDATE material_batches SET qty = ROUND(qty - ?, 3), last_movement_at = ? WHERE id = ?").run(
        item.qty,
        executedAt,
        item.batchId,
      );
      const movementId = uid("MV");
      database.prepare(`
        INSERT INTO inventory_movements (
          id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
        )
        VALUES (?, 'material', ?, ?, ?, ?, 'material_adjustment_issue', 'material_adjustment_order', ?, ?)
      `).run(movementId, material.id, batch.batchNo, -item.qty, batch.unitCost, order.id, executedAt);
      insertMaterialAdjustmentOrderLine(database, {
        orderId: order.id,
        materialId: material.id,
        batchId: item.batchId,
        batchNo: batch.batchNo,
        direction: "out",
        qty: item.qty,
        unitCost: batch.unitCost,
        movementId,
        createdAt: executedAt,
      });
    }
    recalculateMaterialInventory(database, material.id, executedAt);
  } else if (order.adjustment_type === "return") {
    const unitCost =
      payload.unit_cost == null || payload.unit_cost === ""
        ? roundMoney(Number(material.average_cost ?? 0))
        : roundMoney(payloadNumber(payload, "unit_cost", "退料单价", { min: 0 }));
    const batchNo =
      payloadText(payload, "batch_no", "退料批次", false) ||
      `TL-${order.order_no}-${String(material.id).replace(/[^A-Z0-9]/gi, "")}`;
    const batchId = uid("B");
    database.prepare(`
      INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at, last_movement_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'available')
    `).run(batchId, material.id, batchNo, qty, unitCost, executedAt, executedAt);
    const movementId = uid("MV");
    database.prepare(`
      INSERT INTO inventory_movements (
        id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
      )
      VALUES (?, 'material', ?, ?, ?, ?, 'material_adjustment_return', 'material_adjustment_order', ?, ?)
    `).run(movementId, material.id, batchNo, qty, unitCost, order.id, executedAt);
    insertMaterialAdjustmentOrderLine(database, {
      orderId: order.id,
      materialId: material.id,
      batchId,
      batchNo,
      direction: "in",
      qty,
      unitCost,
      movementId,
      createdAt: executedAt,
    });
    recalculateMaterialInventory(database, material.id, executedAt);
  } else {
    throw new Error("补退料类型不正确。");
  }

  database.prepare(`
    UPDATE production_material_adjustment_orders
    SET status = 'executed',
        executed_by = ?,
        executed_at = ?,
        execution_note = ?
    WHERE id = ?
  `).run(actorId, executedAt, executionNote, order.id);
  audit(database, actorId, "executeMaterialAdjustmentOrder", "production_material_adjustment_order", order.id, `执行补退料单 ${order.order_no}`);
}

function materialAdjustmentCostSummary(database: Database.Database, orderId: string) {
  const summary = database.prepare(`
    SELECT COUNT(*) AS line_count,
           ROUND(COALESCE(SUM(CASE direction WHEN 'out' THEN line_amount WHEN 'in' THEN -line_amount ELSE 0 END), 0), 2) AS cost_impact_amount,
           ROUND(COALESCE(SUM(CASE direction WHEN 'out' THEN -line_amount WHEN 'in' THEN line_amount ELSE 0 END), 0), 2) AS inventory_value_delta
    FROM production_material_adjustment_order_lines
    WHERE order_id = ?
  `).get(orderId) as { line_count: number; cost_impact_amount: number; inventory_value_delta: number };
  return summary;
}

function materialAdjustmentReviewResultValue(value: string) {
  if (["approved", "exception"].includes(value)) return value;
  throw new Error("补退料复核结果不正确。");
}

function materialAdjustmentExceptionReasonValue(value: string) {
  if (["cost_mismatch", "batch_mismatch", "qty_mismatch", "document_mismatch", "other"].includes(value)) return value;
  throw new Error("补退料复核异常原因不正确。");
}

function materialAdjustmentExceptionResolutionValue(value: string) {
  if (["cost_adjustment", "no_adjustment", "document_correction", "process_correction", "other"].includes(value)) {
    return value;
  }
  throw new Error("补退料复核异常处理方式不正确。");
}

function materialAdjustmentExceptionOwnerRoleValue(value: string): Role {
  if (["production", "warehouse", "finance", "technical", "manager"].includes(value)) return value as Role;
  throw new Error("补退料复核异常责任岗位不正确。");
}

function defaultDueDate(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function createMaterialAdjustmentReviewException(
  database: Database.Database,
  actorId: string,
  orderId: string,
  reviewId: string,
  rawPayload: Record<string, unknown>,
) {
  const reasonType = materialAdjustmentExceptionReasonValue(
    payloadText(rawPayload, "exception_reason_type", "异常原因", false) || "other",
  );
  const ownerRole = materialAdjustmentExceptionOwnerRoleValue(
    payloadText(rawPayload, "owner_role", "责任岗位", false) || "production",
  );
  const description =
    payloadText(rawPayload, "exception_description", "异常说明", false) ||
    payloadText(rawPayload, "review_note", "复核说明", false) ||
    materialAdjustmentExceptionReasonLabel(reasonType);
  const dueDate = payloadText(rawPayload, "due_date", "处理到期日", false) || defaultDueDate(3);
  const costAdjustmentAmount = roundMoney(payloadNumber(rawPayload, "cost_adjustment_amount", "成本调整金额"));
  const exceptionId = uid("PMAE");
  const exceptionNo = serial(database, "production_material_adjustment_review_exceptions", "BTYC");
  database.prepare(`
    INSERT INTO production_material_adjustment_review_exceptions (
      id, exception_no, review_id, order_id, reason_type, exception_description,
      owner_role, status, due_date, cost_adjustment_amount, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
  `).run(
    exceptionId,
    exceptionNo,
    reviewId,
    orderId,
    reasonType,
    description,
    ownerRole,
    dueDate,
    costAdjustmentAmount,
    actorId,
    now(),
  );
  audit(database, actorId, "createMaterialAdjustmentReviewException", "production_material_adjustment_review_exception", exceptionId, `生成补退料复核异常 ${exceptionNo}：${materialAdjustmentExceptionReasonLabel(reasonType)}`);
}

function reviewMaterialAdjustmentOrder(
  database: Database.Database,
  actorId: string,
  orderId: string,
  rawPayload?: Record<string, unknown>,
) {
  const order = database.prepare("SELECT * FROM production_material_adjustment_orders WHERE id = ?").get(orderId) as
    | { id: string; order_no: string; status: string }
    | undefined;
  if (!order) throw new Error("补退料单不存在。");
  if (order.status !== "executed") throw new Error("只有已执行的补退料单可以复核。");
  const existing = database.prepare("SELECT review_no FROM production_material_adjustment_order_reviews WHERE order_id = ?").get(order.id) as
    | { review_no: string }
    | undefined;
  if (existing) throw new Error(`补退料单已复核：${existing.review_no}。`);
  const summary = materialAdjustmentCostSummary(database, order.id);
  if (Number(summary.line_count ?? 0) <= 0) throw new Error("补退料单缺少执行明细，不能复核成本影响。");
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const reviewResult = materialAdjustmentReviewResultValue(payloadText(payload, "review_result", "复核结果", false) || "approved");
  const reviewNote = payloadText(payload, "review_note", "复核说明", false) || materialAdjustmentReviewResultLabel(reviewResult);
  const reviewedAt = now();
  const reviewId = uid("PMAOR");
  const reviewNo = serial(database, "production_material_adjustment_order_reviews", "BTFH");
  database.prepare(`
    INSERT INTO production_material_adjustment_order_reviews (
      id, review_no, order_id, review_result, review_note,
      cost_impact_amount, inventory_value_delta, reviewed_by, reviewed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reviewId,
    reviewNo,
    order.id,
    reviewResult,
    reviewNote,
    roundMoney(Number(summary.cost_impact_amount ?? 0)),
    roundMoney(Number(summary.inventory_value_delta ?? 0)),
    actorId,
    reviewedAt,
  );
  if (reviewResult === "exception") {
    createMaterialAdjustmentReviewException(database, actorId, order.id, reviewId, payload);
  }
  audit(database, actorId, "reviewMaterialAdjustmentOrder", "production_material_adjustment_order_review", reviewId, `复核补退料单 ${order.order_no}：${materialAdjustmentReviewResultLabel(reviewResult)}`);
}

function resolveMaterialAdjustmentReviewException(
  database: Database.Database,
  actorId: string,
  exceptionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const exception = database.prepare(`
    SELECT exception.*, pmao.order_no, pmao.production_order_id, po.order_id
    FROM production_material_adjustment_review_exceptions exception
    JOIN production_material_adjustment_orders pmao ON pmao.id = exception.order_id
    JOIN production_orders po ON po.id = pmao.production_order_id
    WHERE exception.id = ?
  `).get(exceptionId) as
    | {
        id: string;
        exception_no: string;
        order_no: string;
        production_order_id: string;
        order_id: string;
        owner_role: Role;
        status: string;
        cost_adjustment_amount: number;
      }
    | undefined;
  if (!exception) throw new Error("补退料复核异常不存在。");
  if (exception.status === "closed") throw new Error("补退料复核异常已关闭。");
  const actor = getUser(database, actorId);
  if (actor.role !== exception.owner_role && actor.role !== "admin" && actor.role !== "manager") {
    throw new Error(`${actor.role_label} 不是该补退料复核异常的责任岗位。`);
  }
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const resolutionType = materialAdjustmentExceptionResolutionValue(
    payloadText(payload, "resolution_type", "处理方式", false) || "no_adjustment",
  );
  const resolutionNote = payloadText(payload, "resolution_note", "处理说明");
  const finalCostAdjustmentAmount =
    payload.final_cost_adjustment_amount == null || payload.final_cost_adjustment_amount === ""
      ? roundMoney(Number(exception.cost_adjustment_amount ?? 0))
      : roundMoney(payloadNumber(payload, "final_cost_adjustment_amount", "最终成本调整金额"));
  const resolvedAt = now();
  database.prepare(`
    UPDATE production_material_adjustment_review_exceptions
    SET status = 'closed',
        resolution_type = ?,
        resolution_note = ?,
        final_cost_adjustment_amount = ?,
        resolved_by = ?,
        resolved_at = ?
    WHERE id = ?
  `).run(resolutionType, resolutionNote, finalCostAdjustmentAmount, actorId, resolvedAt, exception.id);
  if (resolutionType === "cost_adjustment" && finalCostAdjustmentAmount !== 0) {
    postProductionCostAdjustment(database, {
      actorId,
      exceptionId: exception.id,
      productionId: exception.production_order_id,
      orderId: exception.order_id,
      adjustmentAmount: finalCostAdjustmentAmount,
      note: resolutionNote,
      postedAt: resolvedAt,
    });
  }
  audit(database, actorId, "resolveMaterialAdjustmentReviewException", "production_material_adjustment_review_exception", exception.id, `关闭补退料复核异常 ${exception.exception_no}：${materialAdjustmentExceptionResolutionLabel(resolutionType)}`);
}

function postProductionCostAdjustment(
  database: Database.Database,
  input: {
    actorId: string;
    exceptionId: string;
    productionId: string;
    orderId: string;
    adjustmentAmount: number;
    note: string;
    postedAt: string;
  },
) {
  const existing = database.prepare("SELECT id FROM production_cost_adjustments WHERE exception_id = ?").get(input.exceptionId) as
    | { id: string }
    | undefined;
  if (existing) return;
  const summary = database.prepare("SELECT * FROM production_cost_summaries WHERE production_order_id = ?").get(input.productionId) as
    | {
        id: string;
        material_cost: number;
        total_cost: number;
        unit_cost: number;
        finished_qty: number;
      }
    | undefined;
  const adjustmentId = uid("PCA");
  const adjustmentNo = serial(database, "production_cost_adjustments", "CBTZ");
  const ruleContext = productionCostAdjustmentRuleContext(database, input.exceptionId);
  const approvalRule = matchApprovalRule(database, "production_cost_adjustment", Math.abs(input.adjustmentAmount), ruleContext);
  const previousTotalCost = summary ? roundMoney(Number(summary.total_cost ?? 0)) : 0;
  const previousUnitCost = summary ? roundMoney(Number(summary.unit_cost ?? 0)) : 0;
  const previewTotalCost = roundMoney(previousTotalCost + input.adjustmentAmount);
  const previewUnitCost =
    summary && Number(summary.finished_qty ?? 0) > 0 ? roundMoney(previewTotalCost / Number(summary.finished_qty)) : previousUnitCost;
  const initialStatus = approvalRule ? "pending_approval" : "pending_summary";

  database.prepare(`
    INSERT INTO production_cost_adjustments (
      id, adjustment_no, production_order_id, order_id, cost_summary_id, exception_id,
      adjustment_amount, previous_total_cost, new_total_cost, previous_unit_cost, new_unit_cost,
      status, adjustment_note, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    adjustmentId,
    adjustmentNo,
    input.productionId,
    input.orderId,
    summary?.id ?? "",
    input.exceptionId,
    input.adjustmentAmount,
    previousTotalCost,
    previewTotalCost,
    previousUnitCost,
    previewUnitCost,
    initialStatus,
    input.note,
    input.actorId,
    input.postedAt,
  );
  if (approvalRule) {
    const approvalId = uid("OA");
    const approvalNo = serial(database, "approval_requests", "SP");
    database.prepare(`
      INSERT INTO approval_requests (
        id, request_no, type, title, applicant_id, status, amount,
        reason, rule_id, approver_role, sla_hours, entity_type, entity_id,
        created_at, decided_by, decided_at, decision_note
      )
      VALUES (?, ?, '工单成本调整', ?, ?, 'pending', ?, ?, ?, ?, ?, 'production_cost_adjustment', ?, ?, NULL, NULL, NULL)
    `).run(
      approvalId,
      approvalNo,
      `工单成本调整审批 ${adjustmentNo}`,
      input.actorId,
      Math.abs(input.adjustmentAmount),
      `${input.note}；调整金额：${input.adjustmentAmount}`,
      approvalRule.id,
      approvalRule.approver_role,
      approvalRule.sla_hours,
      adjustmentId,
      input.postedAt,
    );
    database
      .prepare("UPDATE production_cost_adjustments SET approval_request_id = ? WHERE id = ?")
      .run(approvalId, adjustmentId);
    audit(database, input.actorId, "submitProductionCostAdjustmentApproval", "production_cost_adjustment", adjustmentId, `发起工单成本调整审批 ${approvalNo}：${adjustmentNo}`);
    evaluateCostAnomalyWarningRules(database, input.actorId, adjustmentId, "cost_adjustment_created");
    return;
  }

  evaluateCostAnomalyWarningRules(database, input.actorId, adjustmentId, "cost_adjustment_created");

  if (!summary) {
    audit(database, input.actorId, "postProductionCostAdjustment", "production_cost_adjustment", adjustmentId, `登记待归集工单成本调整 ${adjustmentNo}`);
    return;
  }

  applyProductionCostAdjustment(database, adjustmentId, input.actorId, input.postedAt);
}

function productionCostAdjustmentRuleContext(database: Database.Database, exceptionId: string): ApprovalRuleMatchContext {
  const context = database.prepare(`
    SELECT pmao.adjustment_type, pmaol.material_id
    FROM production_material_adjustment_review_exceptions exception
    JOIN production_material_adjustment_orders pmao ON pmao.id = exception.order_id
    LEFT JOIN production_material_adjustment_order_lines pmaol ON pmaol.order_id = pmao.id
    WHERE exception.id = ?
    ORDER BY pmaol.created_at ASC, pmaol.rowid ASC
    LIMIT 1
  `).get(exceptionId) as { adjustment_type?: string; material_id?: string } | undefined;
  return {
    adjustmentType: context?.adjustment_type || undefined,
    materialId: context?.material_id || undefined,
  };
}

function applyProductionCostAdjustment(
  database: Database.Database,
  adjustmentId: string,
  actorId: string,
  appliedAt: string,
  costSummaryId?: string,
) {
  const adjustment = database.prepare("SELECT * FROM production_cost_adjustments WHERE id = ?").get(adjustmentId) as
    | {
        id: string;
        adjustment_no: string;
        production_order_id: string;
        order_id: string;
        cost_summary_id: string;
        adjustment_amount: number;
        status: string;
      }
    | undefined;
  if (!adjustment) throw new Error("工单成本调整单不存在。");
  if (adjustment.status === "applied") return;
  if (adjustment.status === "reversed") throw new Error("工单成本调整单已红冲，不能重复入账。");
  if (adjustment.status === "rejected") throw new Error("工单成本调整单已驳回，不能入账。");
  if (!["pending_approval", "pending_summary"].includes(adjustment.status)) {
    throw new Error("工单成本调整单状态不允许入账。");
  }

  const summary = database.prepare(`
    SELECT *
    FROM production_cost_summaries
    WHERE id = ?
       OR production_order_id = ?
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, aggregated_at DESC
    LIMIT 1
  `).get(costSummaryId || adjustment.cost_summary_id || "", adjustment.production_order_id, costSummaryId || adjustment.cost_summary_id || "") as
    | { id: string; material_cost: number; total_cost: number; unit_cost: number; finished_qty: number }
    | undefined;
  if (!summary) {
    database.prepare("UPDATE production_cost_adjustments SET status = 'pending_summary' WHERE id = ?").run(adjustment.id);
    audit(database, actorId, "deferProductionCostAdjustment", "production_cost_adjustment", adjustment.id, `工单成本调整 ${adjustment.adjustment_no} 已审批，等待成本归集后入账`);
    return;
  }

  const previousTotalCost = roundMoney(Number(summary.total_cost ?? 0));
  const previousUnitCost = roundMoney(Number(summary.unit_cost ?? 0));
  const amount = roundMoney(Number(adjustment.adjustment_amount ?? 0));
  const newMaterialCost = roundMoney(Number(summary.material_cost ?? 0) + amount);
  const newTotalCost = roundMoney(previousTotalCost + amount);
  const newUnitCost = Number(summary.finished_qty ?? 0) > 0 ? roundMoney(newTotalCost / Number(summary.finished_qty)) : previousUnitCost;
  database.prepare(`
    UPDATE production_cost_summaries
    SET material_cost = ?,
        total_cost = ?,
        unit_cost = ?,
        status = 'adjusted',
        aggregated_at = ?
    WHERE id = ?
  `).run(newMaterialCost, newTotalCost, newUnitCost, appliedAt, summary.id);
  database.prepare(`
    UPDATE production_cost_adjustments
    SET cost_summary_id = ?,
        previous_total_cost = ?,
        new_total_cost = ?,
        previous_unit_cost = ?,
        new_unit_cost = ?,
        status = 'applied',
        applied_by = ?,
        applied_at = ?
    WHERE id = ?
  `).run(summary.id, previousTotalCost, newTotalCost, previousUnitCost, newUnitCost, actorId, appliedAt, adjustment.id);
  audit(database, actorId, "applyProductionCostAdjustment", "production_cost_adjustment", adjustment.id, `工单成本调整入账 ${adjustment.adjustment_no}：${amount}`);
}

function applyPendingProductionCostAdjustments(
  database: Database.Database,
  productionId: string,
  costSummaryId: string,
  appliedAt: string,
) {
  const pending = database.prepare(`
    SELECT *
    FROM production_cost_adjustments
    WHERE production_order_id = ? AND status = 'pending_summary'
    ORDER BY created_at ASC
  `).all(productionId) as Array<{ id: string; created_by: string }>;
  pending.forEach((adjustment) => {
    applyProductionCostAdjustment(database, adjustment.id, adjustment.created_by, appliedAt, costSummaryId);
  });
}

function approveMaterialRequisition(
  database: Database.Database,
  actorId: string,
  requisitionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const req = database.prepare("SELECT * FROM requisitions WHERE id = ?").get(requisitionId) as
    | { id: string; req_no: string; status: string }
    | undefined;
  if (!req) throw new Error("领料单不存在。");
  if (req.status === "issued") throw new Error("领料单已发料，不能重复审批。");
  if (!["pending_approval", "pending"].includes(req.status)) throw new Error("领料单不是待审批状态。");

  const approvalNote =
    payloadText(payload, "approval_note", "审批意见", false) || "仓库已复核库存批次、BOM需求和替代料规则，批准发料。";
  const approvedAt = now();
  database.prepare(`
    UPDATE requisitions
    SET status = 'approved',
        approved_by = ?,
        approved_at = ?,
        approval_note = ?
    WHERE id = ?
  `).run(actorId, approvedAt, approvalNote, req.id);
  audit(database, actorId, "approveMaterialRequisition", "requisition", req.id, `批准领料单 ${req.req_no}`);
}

function rejectMaterialRequisition(
  database: Database.Database,
  actorId: string,
  requisitionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const req = database.prepare("SELECT * FROM requisitions WHERE id = ?").get(requisitionId) as
    | { id: string; req_no: string; production_order_id: string; status: string }
    | undefined;
  if (!req) throw new Error("领料单不存在。");
  if (req.status !== "pending_approval") throw new Error("领料单不是待审批状态，不能驳回。");

  const approvalNote =
    payloadText(payload, "approval_note", "驳回意见", false) || "领料依据不充分，退回生产复核 BOM、数量或替代料规则。";
  const rejectedAt = now();
  database.prepare(`
    UPDATE requisitions
    SET status = 'rejected',
        approved_by = ?,
        approved_at = ?,
        approval_note = ?
    WHERE id = ?
  `).run(actorId, rejectedAt, approvalNote, req.id);
  database
    .prepare("UPDATE production_orders SET status = 'instructed' WHERE id = ? AND status = 'material_requested'")
    .run(req.production_order_id);
  audit(database, actorId, "rejectMaterialRequisition", "requisition", req.id, `驳回领料单 ${req.req_no}`);
}

function issueMaterials(
  database: Database.Database,
  actorId: string,
  requisitionId: string,
  variant?: string,
  rawPayload?: Record<string, unknown>,
) {
  const req = database.prepare("SELECT * FROM requisitions WHERE id = ?").get(requisitionId) as
    | { id: string; req_no: string; issue_no?: string; production_order_id: string; status: string }
    | undefined;
  if (!req) throw new Error("领料单不存在。");
  if (req.status === "pending_approval") throw new Error("领料单尚未审批，不能发料。");
  if (!["approved", "pending"].includes(req.status)) throw new Error("领料单不是待发料状态。");
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const issueDate = payloadDate(payload, "issue_date", "发料日期", new Date().toISOString().slice(0, 10));
  const headerIssueNote = payloadText(payload, "issue_note", "发料说明", false) || "仓库按系统领料单完成发料。";
  const issueNo = req.issue_no || serial(database, "requisitions", "CK");

  const lines = database.prepare("SELECT * FROM requisition_lines WHERE requisition_id = ? ORDER BY rowid").all(req.id) as Array<{
    id: string;
    material_id: string;
    required_qty: number;
  }>;
  const selections = issueSelectionMap(rawPayload, lines);

  const touchedMaterialIds = new Set<string>();
  const movementAt = `${issueDate}T00:00:00.000Z`;

  for (const line of lines) {
    const selection = selections.get(line.id);
    let issueMaterialId = line.material_id;
    let isSubstitute = 0;
    let issueMode = "fifo";
    let lineIssueNote = headerIssueNote;
    if (selection?.materialId) {
      issueMaterialId = selection.materialId;
      issueMode = selection.batchId ? "manual_batch" : "manual";
      lineIssueNote = selection.reason || headerIssueNote;
      if (issueMaterialId !== line.material_id) {
        assertSubstituteMaterial(database, line.material_id, issueMaterialId);
        isSubstitute = 1;
      }
    } else if (variant === "substitute") {
      const substitute = database
        .prepare("SELECT substitute_id FROM material_substitutes WHERE material_id = ? LIMIT 1")
        .get(line.material_id) as { substitute_id: string } | undefined;
      if (substitute) {
        issueMaterialId = substitute.substitute_id;
        isSubstitute = 1;
        issueMode = "substitute_fifo";
        lineIssueNote = "系统按预设替代料发料";
      }
    }

    const batches = selection?.batchId
      ? (database.prepare(`
      SELECT id AS batchId, qty AS availableQty, received_at AS receivedAt, unit_cost AS unitCost, batch_no AS batchNo
      FROM material_batches
      WHERE id = ? AND material_id = ? AND qty > 0
    `).all(selection.batchId, issueMaterialId) as Array<{
          batchId: string;
          availableQty: number;
          receivedAt: string;
          unitCost: number;
          batchNo: string;
        }>)
      : (database.prepare(`
      SELECT id AS batchId, qty AS availableQty, received_at AS receivedAt, unit_cost AS unitCost, batch_no AS batchNo
      FROM material_batches
      WHERE material_id = ? AND qty > 0
      ORDER BY received_at ASC
    `).all(issueMaterialId) as Array<{
          batchId: string;
          availableQty: number;
          receivedAt: string;
          unitCost: number;
          batchNo: string;
        }>);
    if (selection?.batchId && batches.length === 0) throw new Error(`发料批次 ${selection.batchId} 不存在或库存不足。`);
    const allocation = allocateFifo(batches, line.required_qty);
    if (allocation.shortage > 0) throw new Error(`物料 ${line.material_id} 库存不足，缺口 ${allocation.shortage}。`);

    for (const item of allocation.allocations) {
      const batch = batches.find((candidate) => candidate.batchId === item.batchId);
      if (!batch) throw new Error("批次分配异常。");
      database.prepare(`
        INSERT INTO requisition_allocations (
          id, requisition_line_id, batch_id, material_id, qty, unit_cost, is_substitute, issue_mode, issue_note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uid("RA"), line.id, item.batchId, issueMaterialId, item.qty, batch.unitCost, isSubstitute, issueMode, lineIssueNote);
      database.prepare("UPDATE material_batches SET qty = ROUND(qty - ?, 3), last_movement_at = ? WHERE id = ?").run(
        item.qty,
        movementAt,
        item.batchId,
      );
      database.prepare(`
        INSERT INTO inventory_movements (
          id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
        )
        VALUES (?, 'material', ?, ?, ?, ?, 'issue', 'requisition', ?, ?)
      `).run(uid("MV"), issueMaterialId, batch.batchNo, -item.qty, batch.unitCost, req.id, movementAt);
      touchedMaterialIds.add(issueMaterialId);
    }

    database.prepare("UPDATE requisition_lines SET issued_qty = ?, status = 'issued' WHERE id = ?").run(
      line.required_qty,
      line.id,
    );
  }

  for (const materialId of touchedMaterialIds) {
    recalculateMaterialInventory(database, materialId, movementAt);
  }

  database.prepare(`
    UPDATE requisitions
    SET status = 'issued',
        issue_no = ?,
        issued_by = ?,
        issued_at = ?,
        issue_note = ?
    WHERE id = ?
  `).run(issueNo, actorId, movementAt, headerIssueNote, req.id);
  database.prepare("UPDATE production_orders SET status = 'producing' WHERE id = ?").run(req.production_order_id);
  audit(
    database,
    actorId,
    "issueMaterials",
    "requisition",
    req.id,
    `${selections.size > 0 ? "手动批次/替代料" : variant === "substitute" ? "替代料" : "FIFO"} 发料 ${req.req_no}`,
  );
}

function issueSelectionMap(
  rawPayload: Record<string, unknown> | undefined,
  lines: Array<{ id: string; material_id: string }>,
) {
  const result = new Map<string, { materialId: string; batchId: string; reason: string }>();
  if (!rawPayload || !Array.isArray(rawPayload.selections)) return result;
  const lineIds = new Set(lines.map((line) => line.id));
  for (const [index, rawSelection] of rawPayload.selections.entries()) {
    if (!rawSelection || typeof rawSelection !== "object") throw new Error(`发料选择第 ${index + 1} 行格式不正确。`);
    const selection = rawSelection as Record<string, unknown>;
    const lineId = payloadText(selection, "line_id", `第 ${index + 1} 行领料明细`);
    if (!lineIds.has(lineId)) throw new Error(`第 ${index + 1} 行领料明细不属于当前领料单。`);
    result.set(lineId, {
      materialId: payloadText(selection, "material_id", `第 ${index + 1} 行发料物料`, false),
      batchId: payloadText(selection, "batch_id", `第 ${index + 1} 行发料批次`, false),
      reason: payloadText(selection, "reason", `第 ${index + 1} 行发料原因`, false),
    });
  }
  return result;
}

function assertSubstituteMaterial(database: Database.Database, materialId: string, substituteId: string) {
  const row = database
    .prepare("SELECT 1 FROM material_substitutes WHERE material_id = ? AND substitute_id = ?")
    .get(materialId, substituteId) as { 1: number } | undefined;
  if (!row) throw new Error(`物料 ${substituteId} 不是 ${materialId} 的预设替代料。`);
}

function requestInspection(
  database: Database.Database,
  actorId: string,
  productionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const production = database.prepare(`
    SELECT po.*, o.qty AS order_qty
    FROM production_orders po
    JOIN orders o ON o.id = po.order_id
    WHERE po.id = ?
  `).get(productionId) as
    | { id: string; status: string; prod_no: string; order_qty: number }
    | undefined;
  if (!production || production.status !== "producing") throw new Error("生产单不是生产中状态。");
  const completionQty = payloadPositiveNumber(payload, "completion_qty", "完工数量", Number(production.order_qty));
  if (completionQty > Number(production.order_qty)) throw new Error("完工数量不能大于订单生产数量。");
  const sampleQty = payloadPositiveNumber(payload, "sample_qty", "抽样数量", Math.min(3, completionQty));
  if (sampleQty > completionQty) throw new Error("抽样数量不能大于完工数量。");
  const requestNote =
    payloadText(payload, "request_note", "请验说明", false) || "生产已完工，随单提交自检记录和批次追溯。";
  const activeDisposition = database.prepare(`
    SELECT td.*, i.id AS parent_inspection_id, i.inspection_no AS parent_inspection_no
    FROM technical_dispositions td
    JOIN inspections i ON i.id = td.inspection_id
    WHERE td.production_order_id = ?
      AND td.status IN ('issued', 'reinspection_failed')
      AND td.disposition_type IN ('rework', 'process_adjustment')
    ORDER BY td.created_at DESC
    LIMIT 1
  `).get(production.id) as
    | {
        id: string;
        disposition_no: string;
        parent_inspection_id: string;
        parent_inspection_no: string;
      }
    | undefined;
  const maxRound = (database
    .prepare("SELECT COALESCE(MAX(inspection_round), 0) AS max_round FROM inspections WHERE production_order_id = ?")
    .get(production.id) as { max_round: number }).max_round;
  const inspectionRound = activeDisposition ? Math.max(Number(maxRound) + 1, 2) : 1;
  const inspectionId = uid("QA");
  const inspectionNo = serial(database, "inspections", "QY");
  database.prepare(`
    INSERT INTO inspections (
      id, inspection_no, production_order_id, status, requested_by,
      request_note, completion_qty, sample_qty, parent_inspection_id,
      technical_disposition_id, inspection_round, reinspection_reason, created_at
    )
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    inspectionId,
    inspectionNo,
    production.id,
    actorId,
    requestNote,
    completionQty,
    sampleQty,
    activeDisposition?.parent_inspection_id ?? null,
    activeDisposition?.id ?? null,
    inspectionRound,
    activeDisposition ? requestNote : "",
    now(),
  );
  if (activeDisposition) {
    database
      .prepare("UPDATE technical_dispositions SET status = 'reinspection_requested' WHERE id = ?")
      .run(activeDisposition.id);
  }
  database.prepare("UPDATE production_orders SET status = 'inspection_requested' WHERE id = ?").run(production.id);
  audit(
    database,
    actorId,
    "requestInspection",
    "inspection",
    inspectionId,
    activeDisposition ? `发起复检单 ${inspectionNo}，关联技术处置 ${activeDisposition.disposition_no}` : `发起请验单 ${inspectionNo}`,
  );
}

function completeInspection(
  database: Database.Database,
  actorId: string,
  inspectionId: string,
  variant?: string,
  actualQty?: number,
  rawPayload?: Record<string, unknown>,
) {
  const inspection = database.prepare("SELECT * FROM inspections WHERE id = ?").get(inspectionId) as
    | {
        id: string;
        status: string;
        inspection_no: string;
        production_order_id: string;
        technical_disposition_id?: string | null;
        inspection_round?: number | null;
      }
    | undefined;
  if (!inspection || inspection.status !== "pending") throw new Error("请验单不是待检验状态。");
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : undefined;
  const result = qaResultFromInput(payload, variant);
  const order = database.prepare(`
    SELECT o.qty
    FROM production_orders po JOIN orders o ON o.id = po.order_id
    WHERE po.id = ?
  `).get(inspection.production_order_id) as { qty: number };
  const primaryIssuedQty = (database.prepare(`
    SELECT COALESCE(SUM(ra.qty), 0) AS qty
    FROM requisition_allocations ra
    JOIN requisition_lines rl ON rl.id = ra.requisition_line_id
    JOIN requisitions r ON r.id = rl.requisition_id
    WHERE r.production_order_id = ? AND rl.is_primary = 1
  `).get(inspection.production_order_id) as { qty: number }).qty;
  const payloadActualQty = payload ? payloadNumber(payload, "actual_qty", "实测入库量", { min: 0 }) : undefined;
  const inboundQty = result === "failed" ? 0 : roundQty(payloadActualQty ?? actualQty ?? Math.max(order.qty - 4, 1));
  if (result !== "failed" && inboundQty <= 0) throw new Error("合格或让步接收的实测入库量必须大于 0。");
  if (inboundQty > order.qty) throw new Error("实测入库量不能大于订单生产数量。");
  const yieldRate = calculateYieldRate({ actualInboundQty: inboundQty, primaryIssuedQty });
  const measurements =
    payloadText(payload ?? {}, "measurements", "检验记录", false) ||
    (result === "failed" ? "关键尺寸超差，退回生产复核" : "尺寸、外观、批次追溯记录符合演示标准");
  const inspectionStandard =
    payloadText(payload ?? {}, "inspection_standard", "检验标准", false) || "客户图纸、BOM批次追溯和企业内控检验标准";
  const dispositionNote =
    payloadText(payload ?? {}, "disposition_note", "处置意见", false) ||
    (result === "failed" ? "不合格，退回生产复核。" : "准予进入仓库入库环节。");

  database.prepare(`
    UPDATE inspections
    SET status = 'completed',
        result = ?,
        actual_qty = ?,
        primary_issued_qty = ?,
        yield_rate = ?,
        measurements = ?,
        completed_by = ?,
        inspection_standard = ?,
        disposition_note = ?,
        completed_at = ?
    WHERE id = ?
  `).run(
    result,
    inboundQty,
    primaryIssuedQty,
    yieldRate,
    measurements,
    actorId,
    inspectionStandard,
    dispositionNote,
    now(),
    inspection.id,
  );
  database
    .prepare("UPDATE production_orders SET status = ? WHERE id = ?")
    .run(qaAllowsInbound(result) ? "qa_approved" : "qa_failed", inspection.production_order_id);
  if (inspection.technical_disposition_id) {
    const closedAt = qaAllowsInbound(result) ? now() : null;
    database
      .prepare("UPDATE technical_dispositions SET status = ?, closed_at = ? WHERE id = ?")
      .run(qaAllowsInbound(result) ? "closed" : "reinspection_failed", closedAt, inspection.technical_disposition_id);
  }
  audit(database, actorId, "completeInspection", "inspection", inspection.id, `检验判定：${result}`);
}

function createProductionDailyReport(
  database: Database.Database,
  actorId: string,
  productionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const production = database.prepare(`
    SELECT po.*, o.id AS order_id, o.qty AS order_qty, p.name AS product_name
    FROM production_orders po
    JOIN orders o ON o.id = po.order_id
    JOIN products p ON p.id = o.product_id
    WHERE po.id = ?
  `).get(productionId) as
    | {
        id: string;
        prod_no: string;
        status: string;
        order_id: string;
        order_qty: number;
        product_name: string;
      }
    | undefined;
  if (!production) throw new Error("生产工单不存在。");
  if (!["producing", "inspection_requested", "qa_failed", "qa_approved", "in_stock"].includes(production.status)) {
    throw new Error("生产日报只能在已发料后的工单上填报。");
  }

  const reportDate = payloadDate(payload, "report_date", "日报日期", new Date().toISOString().slice(0, 10));
  const shift = payloadText(payload, "shift", "班次", false) || "白班";
  const plannedQty = payloadPositiveNumber(payload, "planned_qty", "计划产量", Number(production.order_qty));
  const finishedQty = payloadPositiveNumber(payload, "finished_qty", "完成数量");
  const goodQty = payloadNumber(payload, "good_qty", "合格数量", { min: 0 });
  const defectQty = payloadNumber(payload, "defect_qty", "不合格数量", { min: 0 });
  const scrapQty = payloadNumber(payload, "scrap_qty", "报废数量", { min: 0 });
  const workHours = payloadNumber(payload, "work_hours", "工时", { min: 0 });
  if (goodQty + defectQty + scrapQty - finishedQty > 0.001) throw new Error("合格、不合格和报废数量合计不能大于完成数量。");
  const yieldRate = finishedQty > 0 ? roundMoney((goodQty * 100) / finishedQty) : 0;
  const abnormalNote = payloadText(payload, "abnormal_note", "异常说明", false);
  const reportNo = serial(database, "production_daily_reports", "RB");
  const reportId = uid("PDR");

  database.prepare(`
    INSERT INTO production_daily_reports (
      id, report_no, production_order_id, order_id, report_date, shift,
      planned_qty, finished_qty, good_qty, defect_qty, scrap_qty,
      work_hours, yield_rate, status, abnormal_note, reported_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)
  `).run(
    reportId,
    reportNo,
    production.id,
    production.order_id,
    reportDate,
    shift,
    roundQty(plannedQty),
    roundQty(finishedQty),
    roundQty(goodQty),
    roundQty(defectQty),
    roundQty(scrapQty),
    roundMoney(workHours),
    yieldRate,
    abnormalNote,
    actorId,
    now(),
  );
  audit(database, actorId, "createProductionDailyReport", "production_daily_report", reportId, `填报生产日报 ${reportNo}`);
}

function createTechnicalDisposition(
  database: Database.Database,
  actorId: string,
  inspectionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const inspection = database.prepare(`
    SELECT i.*, po.status AS production_status, po.prod_no
    FROM inspections i
    JOIN production_orders po ON po.id = i.production_order_id
    WHERE i.id = ?
  `).get(inspectionId) as
    | {
        id: string;
        inspection_no: string;
        status: string;
        result: string | null;
        production_order_id: string;
        production_status: string;
        prod_no: string;
      }
    | undefined;
  if (!inspection) throw new Error("请验单不存在。");
  if (inspection.status !== "completed" || inspection.result !== "failed") {
    throw new Error("只有 OQC 不合格且已完成判定的请验单才能出具技术处置意见。");
  }
  const existing = database
    .prepare("SELECT id FROM technical_dispositions WHERE inspection_id = ? AND status <> 'voided' LIMIT 1")
    .get(inspection.id) as { id: string } | undefined;
  if (existing) throw new Error("该不合格请验单已存在技术处置意见。");

  const dispositionType = technicalDispositionTypeValue(
    payloadText(payload, "disposition_type", "处理方式", false) || "rework",
  );
  const rootCause = payloadText(payload, "root_cause", "原因分析");
  const correctiveAction = payloadText(payload, "corrective_action", "处理意见");
  const dueDate = payloadText(payload, "due_date", "要求完成日期", false);
  if (dueDate) payloadDate(payload, "due_date", "要求完成日期");
  const note = payloadText(payload, "note", "备注", false);
  const dispositionNo = serial(database, "technical_dispositions", "JS");
  const dispositionId = uid("TD");

  database.prepare(`
    INSERT INTO technical_dispositions (
      id, disposition_no, inspection_id, production_order_id, disposition_type,
      root_cause, corrective_action, due_date, status, note, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)
  `).run(
    dispositionId,
    dispositionNo,
    inspection.id,
    inspection.production_order_id,
    dispositionType,
    rootCause,
    correctiveAction,
    dueDate || null,
    note,
    actorId,
    now(),
  );

  const nextProductionStatus =
    dispositionType === "rework" || dispositionType === "process_adjustment"
      ? "producing"
      : dispositionType === "concession_release"
        ? "qa_approved"
        : "qa_failed";
  database.prepare("UPDATE production_orders SET status = ? WHERE id = ?").run(
    nextProductionStatus,
    inspection.production_order_id,
  );
  if (dispositionType === "concession_release") {
    database.prepare(`
      UPDATE inspections
      SET result = 'concession',
          actual_qty = COALESCE(NULLIF(completion_qty, 0), actual_qty, 0),
          disposition_note = ?
      WHERE id = ?
    `).run(`技术部让步放行：${correctiveAction}`, inspection.id);
  }
  audit(database, actorId, "createTechnicalDisposition", "technical_disposition", dispositionId, `出具技术处置 ${dispositionNo}`);
}

function technicalDispositionTypeValue(value: string) {
  if (["rework", "scrap", "concession_release", "process_adjustment"].includes(value)) return value;
  throw new Error("技术处理方式不正确。");
}

function qaResultFromInput(payload?: Record<string, unknown>, variant?: string): QaResult {
  const raw = payloadText(payload ?? {}, "result", "检验判定", false) || variant || "qualified";
  if (raw === "qualified" || raw === "concession" || raw === "failed") return raw;
  throw new Error("检验判定只能是合格、让步接收或不合格。");
}

function receiveFinishedGoods(
  database: Database.Database,
  actorId: string,
  productionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const production = database.prepare(`
    SELECT po.*, o.product_id, o.qty AS order_qty, p.process_fee, p.name AS product_name
    FROM production_orders po
    JOIN orders o ON o.id = po.order_id
    JOIN products p ON p.id = o.product_id
    WHERE po.id = ?
  `).get(productionId) as
    | {
        id: string;
        status: string;
        prod_no: string;
        order_id: string;
        product_id: string;
        order_qty: number;
        process_fee: number;
        product_name: string;
      }
    | undefined;
  if (!production || production.status !== "qa_approved") throw new Error("生产单未通过品控，不能入库。");
  const inboundDate = payloadDate(payload, "inbound_date", "入库日期", new Date().toISOString().slice(0, 10));
  const inboundNote =
    payloadText(payload, "inbound_note", "入库说明", false) || "仓库已核对请验单、实物数量和批次成本，办理成品入库。";
  const inspection = database.prepare(`
    SELECT * FROM inspections
    WHERE production_order_id = ? AND status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 1
  `).get(production.id) as
    | { id: string; result: QaResult; actual_qty: number; yield_rate: number }
    | undefined;
  if (!inspection || !qaAllowsInbound(inspection.result)) throw new Error("缺少合格或让步接收检验单。");

  const existing = database
    .prepare("SELECT COUNT(*) AS count FROM finished_goods_receipts WHERE production_order_id = ?")
    .get(production.id) as { count: number };
  if (existing.count > 0) throw new Error("该生产单已入库。");

  const materialCost = (database.prepare(`
    SELECT COALESCE(SUM(ra.qty * ra.unit_cost), 0) AS cost
    FROM requisition_allocations ra
    JOIN requisition_lines rl ON rl.id = ra.requisition_line_id
    JOIN requisitions r ON r.id = rl.requisition_id
    WHERE r.production_order_id = ?
  `).get(production.id) as { cost: number }).cost;
  const processCost = roundMoney(production.process_fee * production.order_qty);
  const totalCost = roundMoney(materialCost + processCost);
  const unitCost = inspection.actual_qty > 0 ? roundMoney(totalCost / inspection.actual_qty) : 0;
  const receiptId = uid("FGR");
  const receiptNo = serial(database, "finished_goods_receipts", "RK");
  const finishedBatchId = uid("FB");
  const transitionBatchId = uid("FB");
  const receivedAt = `${inboundDate}T00:00:00.000Z`;
  const batchNo = `CP-${inboundDate.replaceAll("-", "")}-${production.prod_no.split("-").at(-1)}`;
  const transitionQty = roundQty(Math.max(production.order_qty - inspection.actual_qty, 0));

  database.prepare(`
    INSERT INTO finished_goods_receipts (
      id, receipt_no, production_order_id, inspection_id, product_id,
      finished_batch_id, transition_batch_id, finished_qty, transition_qty,
      material_cost, process_cost, total_cost, unit_cost, yield_rate,
      received_by, received_at, inbound_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receiptId,
    receiptNo,
    production.id,
    inspection.id,
    production.product_id,
    finishedBatchId,
    transitionQty > 0 ? transitionBatchId : "",
    inspection.actual_qty,
    transitionQty,
    roundMoney(materialCost),
    processCost,
    totalCost,
    unitCost,
    inspection.yield_rate,
    actorId,
    receivedAt,
    inboundNote,
  );

  database.prepare(`
    INSERT INTO finished_batches (
      id, product_id, production_order_id, receipt_id, batch_no, qty, unit_cost, kind, status, received_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'finished', 'available', ?)
  `).run(finishedBatchId, production.product_id, production.id, receiptId, batchNo, inspection.actual_qty, unitCost, receivedAt);
  database.prepare(`
    INSERT INTO inventory_movements (
      id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
    )
    VALUES (?, 'product', ?, ?, ?, ?, 'finished_inbound', 'finished_receipt', ?, ?)
  `).run(uid("MV"), production.product_id, batchNo, inspection.actual_qty, unitCost, receiptId, receivedAt);

  if (transitionQty > 0) {
    database.prepare(`
      INSERT INTO finished_batches (
        id, product_id, production_order_id, receipt_id, batch_no, qty, unit_cost, kind, status, received_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'transition', 'available', ?)
    `).run(transitionBatchId, production.product_id, production.id, receiptId, `${batchNo}-GY`, transitionQty, roundMoney(unitCost * 0.15), receivedAt);
  }

  createProductionCostSummary(database, {
    productionId: production.id,
    orderId: production.order_id,
    receiptId,
    materialCost: roundMoney(materialCost),
    processCost,
    transitionCost: transitionQty > 0 ? roundMoney(transitionQty * unitCost * 0.15) : 0,
    totalCost,
    finishedQty: inspection.actual_qty,
    transitionQty,
    unitCost,
    aggregatedAt: receivedAt,
  });

  database.prepare("UPDATE inspections SET status = 'inbounded' WHERE id = ?").run(inspection.id);
  database.prepare("UPDATE production_orders SET status = 'in_stock' WHERE id = ?").run(production.id);
  audit(database, actorId, "receiveFinishedGoods", "finished_receipt", receiptId, `成品入库 ${receiptNo}：${production.product_name}，收率 ${inspection.yield_rate}%`);
}

function createProductionCostSummary(
  database: Database.Database,
  input: {
    productionId: string;
    orderId: string;
    receiptId: string;
    materialCost: number;
    processCost: number;
    transitionCost: number;
    totalCost: number;
    finishedQty: number;
    transitionQty: number;
    unitCost: number;
    aggregatedAt: string;
  },
) {
  const existing = database
    .prepare("SELECT id FROM production_cost_summaries WHERE production_order_id = ?")
    .get(input.productionId) as { id: string } | undefined;
  if (existing) return;
  const costSummaryId = uid("PCS");
  database.prepare(`
    INSERT INTO production_cost_summaries (
      id, cost_no, production_order_id, order_id, receipt_id,
      material_cost, process_cost, transition_cost, total_cost,
      finished_qty, transition_qty, unit_cost, status, aggregated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?)
  `).run(
    costSummaryId,
    serial(database, "production_cost_summaries", "CB"),
    input.productionId,
    input.orderId,
    input.receiptId,
    input.materialCost,
    input.processCost,
    input.transitionCost,
    input.totalCost,
    input.finishedQty,
    input.transitionQty,
    input.unitCost,
    input.aggregatedAt,
  );
  applyPendingProductionCostAdjustments(database, input.productionId, costSummaryId, input.aggregatedAt);
}

function createShipment(database: Database.Database, actorId: string, productionId: string, rawPayload?: Record<string, unknown>) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const production = database.prepare(`
    SELECT po.*, o.id AS order_id, o.order_no, o.product_id, o.qty AS order_qty,
           o.delivery_address, o.consignee, o.contact_phone, o.payment_terms_days
    FROM production_orders po JOIN orders o ON o.id = po.order_id
    WHERE po.id = ?
  `).get(productionId) as
    | {
        id: string;
        status: string;
        order_id: string;
        order_no: string;
        product_id: string;
        order_qty: number;
        delivery_address?: string;
        consignee?: string;
        contact_phone?: string;
        payment_terms_days?: number;
      }
    | undefined;
  if (!production || !["in_stock", "partial_shipped"].includes(production.status)) throw new Error("生产单不是待发货状态。");

  const available = (database.prepare(`
    SELECT COALESCE(SUM(qty), 0) AS qty FROM finished_batches
    WHERE production_order_id = ? AND kind = 'finished' AND status = 'available'
  `).get(production.id) as { qty: number }).qty;
  if (available <= 0) throw new Error("没有可发货成品库存。");
  const alreadyShipped = (database.prepare(`
    SELECT COALESCE(SUM(shipped_qty), 0) AS qty FROM shipments
    WHERE production_order_id = ?
      AND status = 'shipped'
      AND COALESCE(shipment_type, 'standard') = 'standard'
  `).get(production.id) as { qty: number }).qty;
  const remainingOrderQty = roundQty(Math.max(production.order_qty - alreadyShipped, 0));
  if (remainingOrderQty <= 0) throw new Error("该生产单已完成发货。");
  const shippedQty = payloadPositiveNumber(payload, "shipped_qty", "发货数量", Math.min(available, remainingOrderQty));
  if (shippedQty > available) throw new Error("发货数量不能大于可用成品库存。");
  if (shippedQty > remainingOrderQty) throw new Error("发货数量不能大于订单未发数量。");
  const shippedAt = payloadDate(payload, "shipped_at", "发货日期", new Date().toISOString().slice(0, 10));
  const deliveryAddress = payloadText(payload, "delivery_address", "送货地址", false) || production.delivery_address || "";
  const consignee = payloadText(payload, "consignee", "收货人", false) || production.consignee || "";
  const contactPhone = payloadText(payload, "contact_phone", "联系电话", false) || production.contact_phone || "";
  const logisticsCompany = payloadText(payload, "logistics_company", "物流公司", false);
  const vehicleNo = payloadText(payload, "vehicle_no", "车牌号", false);
  const trackingNo = payloadText(payload, "tracking_no", "物流单号", false);
  const remark = payloadText(payload, "remark", "备注", false);
  const salesAmount = calculateShipmentSalesAmount(database, production.order_id, shippedQty);
  const shipmentId = uid("SHP");
  const shipmentNo = serial(database, "shipments", "FH");
  database.prepare(`
    INSERT INTO shipments (
      id, shipment_no, order_id, production_order_id, shipped_qty,
      sales_amount, cost_amount, gross_profit, gross_margin, financial_status, shipped_by, status,
      delivery_address, consignee, contact_phone, logistics_company, vehicle_no,
      tracking_no, remark, shipment_type, replacement_for_return_id, original_shipment_id, created_at, shipped_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 'unpaid', ?, 'shipped', ?, ?, ?, ?, ?, ?, ?, 'standard', NULL, NULL, ?, ?)
  `).run(
    shipmentId,
    shipmentNo,
    production.order_id,
    production.id,
    shippedQty,
    salesAmount,
    actorId,
    deliveryAddress,
    consignee,
    contactPhone,
    logisticsCompany,
    vehicleNo,
    trackingNo,
    remark,
    now(),
    shippedAt,
  );

  const costAmount = allocateFinishedStockForShipment(database, {
    shipmentId,
    productionId: production.id,
    productId: production.product_id,
    shippedQty,
    shippedAt,
  });
  const grossProfit = roundMoney(salesAmount - costAmount);
  const grossMargin = salesAmount > 0 ? roundMoney((grossProfit / salesAmount) * 100) : 0;
  database.prepare(`
    UPDATE shipments
    SET cost_amount = ?, gross_profit = ?, gross_margin = ?
    WHERE id = ?
  `).run(costAmount, grossProfit, grossMargin, shipmentId);

  const nextTotalShipped = roundQty(alreadyShipped + shippedQty);
  const nextStatus = nextTotalShipped >= production.order_qty ? "shipped" : "partial_shipped";
  database.prepare("UPDATE orders SET status = ? WHERE id = ?").run(nextStatus, production.order_id);
  database.prepare("UPDATE production_orders SET status = ? WHERE id = ?").run(nextStatus, production.id);
  createReceivableForShipment(database, production.order_id, shipmentId, shippedQty, shippedAt, salesAmount);
  audit(database, actorId, "createShipment", "shipment", shipmentId, `生成发货单 ${shipmentNo}，数量 ${shippedQty}`);
}

function allocateFinishedStockForShipment(
  database: Database.Database,
  input: {
    shipmentId: string;
    productionId: string;
    productId: string;
    shippedQty: number;
    shippedAt: string;
    movementType?: string;
  },
) {
  let remaining = input.shippedQty;
  let costAmount = 0;
  const batches = database.prepare(`
    SELECT id, batch_no, qty, unit_cost
    FROM finished_batches
    WHERE production_order_id = ? AND kind = 'finished' AND status = 'available' AND qty > 0
    ORDER BY received_at ASC
  `).all(input.productionId) as Array<{ id: string; batch_no: string; qty: number; unit_cost: number }>;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const issuedQty = roundQty(Math.min(batch.qty, remaining));
    const lineCost = roundMoney(issuedQty * batch.unit_cost);
    const nextQty = roundQty(batch.qty - issuedQty);
    database.prepare(`
      INSERT INTO finished_shipment_allocations (
        id, shipment_id, finished_batch_id, production_order_id,
        batch_no, qty, unit_cost, cost_amount, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid("FSA"),
      input.shipmentId,
      batch.id,
      input.productionId,
      batch.batch_no,
      issuedQty,
      batch.unit_cost,
      lineCost,
      input.shippedAt,
    );
    database.prepare(`
      UPDATE finished_batches
      SET qty = ?, status = CASE WHEN ? <= 0 THEN 'shipped' ELSE 'available' END
      WHERE id = ?
    `).run(nextQty, nextQty, batch.id);
    database.prepare(`
      INSERT INTO inventory_movements (
        id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
      )
      VALUES (?, 'product', ?, ?, ?, ?, ?, 'shipment', ?, ?)
    `).run(
      uid("MV"),
      input.productId,
      batch.batch_no,
      -issuedQty,
      batch.unit_cost,
      input.movementType ?? "shipment_outbound",
      input.shipmentId,
      input.shippedAt,
    );
    costAmount = roundMoney(costAmount + lineCost);
    remaining = roundQty(remaining - issuedQty);
  }
  if (remaining > 0) throw new Error("成品批次库存不足，无法完成发货。");
  return costAmount;
}

function calculateShipmentSalesAmount(database: Database.Database, orderId: string, shippedQty: number) {
  const order = database.prepare(`
    SELECT o.qty, q.total_amount
    FROM orders o
    JOIN quotes q ON q.id = o.quote_id
    WHERE o.id = ?
  `).get(orderId) as { qty: number; total_amount: number } | undefined;
  if (!order) throw new Error("发货订单不存在，无法计算销售金额。");
  return roundMoney(Number(order.total_amount) * (shippedQty / Number(order.qty || shippedQty)));
}

function createReceivableForShipment(
  database: Database.Database,
  orderId: string,
  shipmentId: string,
  shippedQty: number,
  shippedAt: string,
  salesAmount?: number,
) {
  const existing = database.prepare("SELECT COUNT(*) AS count FROM receivables WHERE shipment_id = ?").get(shipmentId) as {
    count: number;
  };
  if (existing.count > 0) return;

  const order = database.prepare(`
    SELECT o.id, o.customer_id, o.order_no, o.qty, o.payment_terms_days, q.total_amount
    FROM orders o
    JOIN quotes q ON q.id = o.quote_id
    WHERE o.id = ?
  `).get(orderId) as
    | { id: string; customer_id: string; order_no: string; qty: number; payment_terms_days: number; total_amount: number }
    | undefined;
  if (!order) throw new Error("发货订单不存在，无法生成应收。");

  const receivableId = uid("AR");
  const receivableNo = serial(database, "receivables", "YS");
  const receivableAmount =
    salesAmount ?? roundMoney(Number(order.total_amount) * (shippedQty / Number(order.qty || shippedQty)));
  const dueDate = addDays(shippedAt, Number(order.payment_terms_days ?? 30));
  database.prepare(`
    INSERT INTO receivables (
      id, receivable_no, customer_id, order_id, shipment_id, total_amount, received_amount,
      balance_amount, status, due_date, created_at, settled_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, NULL)
  `).run(receivableId, receivableNo, order.customer_id, order.id, shipmentId, receivableAmount, receivableAmount, dueDate, now());
}

function receivableStatusFromAmounts(input: {
  adjustedTotal: number;
  receivedAmount: number;
  balanceAmount: number;
  refundDueAmount: number;
}) {
  if (input.refundDueAmount > 0) return "refund_due";
  if (input.balanceAmount <= 0) return "paid";
  if (input.receivedAmount > 0) return "partial";
  return "unpaid";
}

function recordSalesReturn(database: Database.Database, actorId: string, shipmentId: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const shipment = database.prepare(`
    SELECT s.*, o.customer_id, o.product_id, p.unit
    FROM shipments s
    JOIN orders o ON o.id = s.order_id
    JOIN products p ON p.id = o.product_id
    WHERE s.id = ?
  `).get(shipmentId) as
    | {
        id: string;
        shipment_no: string;
        order_id: string;
        production_order_id: string;
        customer_id: string;
        product_id: string;
        shipped_qty: number;
        sales_amount: number;
        cost_amount: number;
        status: string;
        shipment_type?: string | null;
      }
    | undefined;
  if (!shipment) throw new Error("发货单不存在。");
  if (shipment.status !== "shipped" || String(shipment.shipment_type ?? "standard") !== "standard") {
    throw new Error("只有已发货的正式发货单可以登记退货。");
  }

  const returnedQty = (database.prepare(`
    SELECT COALESCE(SUM(return_qty), 0) AS qty
    FROM sales_returns
    WHERE shipment_id = ? AND status <> 'voided'
  `).get(shipment.id) as { qty: number }).qty;
  const returnableQty = roundQty(Number(shipment.shipped_qty) - returnedQty);
  const returnQty = roundQty(payloadNumber(payload, "return_qty", "退货数量", { min: 0.000001 }));
  if (returnQty > returnableQty) throw new Error(`退货数量不能大于可退数量 ${returnableQty}。`);

  const disposition = payloadText(payload, "disposition", "退货处置", false) || "return_to_stock";
  if (!["return_to_stock", "rework", "scrap"].includes(disposition)) throw new Error("退货处置只能是入库、返工或报废。");
  const reason = payloadText(payload, "reason", "退货原因");
  const note = payloadText(payload, "note", "退货备注", false);
  const receivedDate = payloadDate(payload, "received_at", "退货日期", new Date().toISOString().slice(0, 10));
  const receivedAt = `${receivedDate}T00:00:00.000Z`;
  const returnAmount = roundMoney(Number(shipment.sales_amount) * (returnQty / Number(shipment.shipped_qty || returnQty)));
  const returnCostAmount = roundMoney(Number(shipment.cost_amount) * (returnQty / Number(shipment.shipped_qty || returnQty)));

  const receivable = database.prepare("SELECT * FROM receivables WHERE shipment_id = ?").get(shipment.id) as
    | {
        id: string;
        receivable_no: string;
        total_amount: number;
        received_amount: number;
        adjusted_amount: number;
        refund_due_amount: number;
        balance_amount: number;
      }
    | undefined;
  const previousBalance = Number(receivable?.balance_amount ?? 0);
  const offsetAmount = roundMoney(Math.min(previousBalance, returnAmount));
  const totalRefunded = receivable
    ? ((database.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM customer_refunds
      WHERE receivable_id = ?
    `).get(receivable.id) as { amount: number }).amount ?? 0)
    : 0;
  const nextAdjustedAmount = roundMoney(Number(receivable?.adjusted_amount ?? 0) + returnAmount);
  const adjustedTotal = roundMoney(Number(receivable?.total_amount ?? returnAmount) - nextAdjustedAmount);
  const nextBalanceAmount = receivable
    ? roundMoney(Math.max(adjustedTotal - Number(receivable.received_amount), 0))
    : 0;
  const nextRefundDueAmount = receivable
    ? roundMoney(Math.max(Number(receivable.received_amount) - adjustedTotal - Number(totalRefunded), 0))
    : 0;
  const refundDueForReturn = roundMoney(Math.max(returnAmount - offsetAmount, 0));

  const returnId = uid("RET");
  const returnNo = serial(database, "sales_returns", "TH");
  database.prepare(`
    INSERT INTO sales_returns (
      id, return_no, shipment_id, order_id, production_order_id, customer_id, product_id, receivable_id,
      return_qty, return_amount, cost_amount, offset_amount, refund_due_amount, refunded_amount,
      reason, disposition, status, refund_status, replacement_status,
      created_by, created_at, received_at, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'returned', ?, 'pending_replacement', ?, ?, ?, ?)
  `).run(
    returnId,
    returnNo,
    shipment.id,
    shipment.order_id,
    shipment.production_order_id,
    shipment.customer_id,
    shipment.product_id,
    receivable?.id ?? null,
    returnQty,
    returnAmount,
    returnCostAmount,
    offsetAmount,
    refundDueForReturn,
    reason,
    disposition,
    refundDueForReturn > 0 ? "pending_refund" : "none",
    actorId,
    now(),
    receivedAt,
    note,
  );

  if (disposition === "return_to_stock") {
    receiveSalesReturnStock(database, {
      salesReturnId: returnId,
      shipmentId: shipment.id,
      productId: shipment.product_id,
      returnQty,
      receivedAt,
    });
  }

  if (receivable) {
    const nextStatus = receivableStatusFromAmounts({
      adjustedTotal,
      receivedAmount: Number(receivable.received_amount),
      balanceAmount: nextBalanceAmount,
      refundDueAmount: nextRefundDueAmount,
    });
    database.prepare(`
      UPDATE receivables
      SET adjusted_amount = ?,
          refund_due_amount = ?,
          balance_amount = ?,
          status = ?,
          settled_at = CASE WHEN ? IN ('paid', 'refund_due') THEN COALESCE(settled_at, ?) ELSE NULL END
      WHERE id = ?
    `).run(nextAdjustedAmount, nextRefundDueAmount, nextBalanceAmount, nextStatus, nextStatus, receivedAt, receivable.id);
    if (receivable.id) {
      database.prepare("UPDATE shipments SET financial_status = ? WHERE id = ?").run(nextStatus, shipment.id);
    }
  }

  audit(database, actorId, "recordSalesReturn", "sales_return", returnId, `登记销售退货 ${returnNo}：${shipment.shipment_no} / ${returnQty}`);
}

function receiveSalesReturnStock(
  database: Database.Database,
  input: {
    salesReturnId: string;
    shipmentId: string;
    productId: string;
    returnQty: number;
    receivedAt: string;
  },
) {
  let remaining = input.returnQty;
  const allocations = database.prepare(`
    SELECT *
    FROM finished_shipment_allocations
    WHERE shipment_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(input.shipmentId) as Array<{
    id: string;
    finished_batch_id: string;
    batch_no: string;
    qty: number;
    unit_cost: number;
  }>;
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    const alreadyReturned = (database.prepare(`
      SELECT COALESCE(SUM(sra.qty), 0) AS qty
      FROM sales_return_allocations sra
      JOIN sales_returns sr ON sr.id = sra.sales_return_id
      WHERE sr.shipment_id = ?
        AND sra.finished_batch_id = ?
        AND sr.status <> 'voided'
    `).get(input.shipmentId, allocation.finished_batch_id) as { qty: number }).qty;
    const availableToReturn = roundQty(Number(allocation.qty) - alreadyReturned);
    if (availableToReturn <= 0) continue;
    const qty = roundQty(Math.min(availableToReturn, remaining));
    const costAmount = roundMoney(qty * Number(allocation.unit_cost));
    database.prepare(`
      INSERT INTO sales_return_allocations (
        id, sales_return_id, finished_batch_id, batch_no, qty, unit_cost, cost_amount, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uid("SRA"), input.salesReturnId, allocation.finished_batch_id, allocation.batch_no, qty, allocation.unit_cost, costAmount, input.receivedAt);
    database.prepare(`
      UPDATE finished_batches
      SET qty = ROUND(qty + ?, 3),
          status = 'available'
      WHERE id = ?
    `).run(qty, allocation.finished_batch_id);
    database.prepare(`
      INSERT INTO inventory_movements (
        id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
      )
      VALUES (?, 'product', ?, ?, ?, ?, 'sales_return_inbound', 'sales_return', ?, ?)
    `).run(uid("MV"), input.productId, allocation.batch_no, qty, allocation.unit_cost, input.salesReturnId, input.receivedAt);
    remaining = roundQty(remaining - qty);
  }
  if (remaining > 0) throw new Error("原发货批次可退数量不足，不能登记退货。");
}

function recordCustomerRefund(database: Database.Database, actorId: string, salesReturnId: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const salesReturn = database.prepare("SELECT * FROM sales_returns WHERE id = ?").get(salesReturnId) as
    | {
        id: string;
        return_no: string;
        receivable_id?: string | null;
        customer_id: string;
        refund_due_amount: number;
        refunded_amount: number;
        refund_status: string;
      }
    | undefined;
  if (!salesReturn) throw new Error("销售退货单不存在。");
  const remainingRefund = roundMoney(Number(salesReturn.refund_due_amount) - Number(salesReturn.refunded_amount));
  if (remainingRefund <= 0 || salesReturn.refund_status === "refunded") throw new Error("该退货单没有待退款金额。");
  const amount = roundMoney(payloadPositiveNumber(payload, "amount", "退款金额", remainingRefund));
  if (amount > remainingRefund) throw new Error("退款金额不能大于待退款金额。");
  const method = payloadText(payload, "method", "退款方式", false) || "银行转账";
  const note = payloadText(payload, "note", "退款备注", false) || "客户退货退款";
  const refundedDate = payloadDate(payload, "refunded_at", "退款日期", new Date().toISOString().slice(0, 10));
  const refundedAt = `${refundedDate}T00:00:00.000Z`;
  const refundId = uid("CRF");
  const refundNo = serial(database, "customer_refunds", "TK");
  database.prepare(`
    INSERT INTO customer_refunds (
      id, refund_no, sales_return_id, receivable_id, customer_id, amount,
      method, note, status, refunded_by, refunded_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)
  `).run(
    refundId,
    refundNo,
    salesReturn.id,
    salesReturn.receivable_id ?? null,
    salesReturn.customer_id,
    amount,
    method,
    note,
    actorId,
    refundedAt,
    now(),
  );

  const nextRefunded = roundMoney(Number(salesReturn.refunded_amount) + amount);
  const nextRefundStatus = nextRefunded >= Number(salesReturn.refund_due_amount) ? "refunded" : "partial_refunded";
  database.prepare("UPDATE sales_returns SET refunded_amount = ?, refund_status = ? WHERE id = ?").run(
    nextRefunded,
    nextRefundStatus,
    salesReturn.id,
  );

  if (salesReturn.receivable_id) {
    const receivable = database.prepare("SELECT * FROM receivables WHERE id = ?").get(salesReturn.receivable_id) as
      | { id: string; refund_due_amount: number; balance_amount: number; received_amount: number; total_amount: number; adjusted_amount: number; shipment_id?: string | null }
      | undefined;
    if (receivable) {
      const nextRefundDue = roundMoney(Math.max(Number(receivable.refund_due_amount) - amount, 0));
      const adjustedTotal = roundMoney(Number(receivable.total_amount) - Number(receivable.adjusted_amount ?? 0));
      const nextStatus = receivableStatusFromAmounts({
        adjustedTotal,
        receivedAmount: Number(receivable.received_amount),
        balanceAmount: Number(receivable.balance_amount),
        refundDueAmount: nextRefundDue,
      });
      database.prepare("UPDATE receivables SET refund_due_amount = ?, status = ? WHERE id = ?").run(
        nextRefundDue,
        nextStatus,
        receivable.id,
      );
      if (receivable.shipment_id) {
        database.prepare("UPDATE shipments SET financial_status = ? WHERE id = ?").run(nextStatus, receivable.shipment_id);
      }
    }
  }

  audit(database, actorId, "recordCustomerRefund", "customer_refund", refundId, `登记客户退款 ${refundNo}：${salesReturn.return_no} / ${amount}`);
}

function createReplacementShipment(database: Database.Database, actorId: string, salesReturnId: string, rawPayload?: Record<string, unknown>) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const salesReturn = database.prepare(`
    SELECT sr.*, o.delivery_address, o.consignee, o.contact_phone
    FROM sales_returns sr
    JOIN orders o ON o.id = sr.order_id
    WHERE sr.id = ?
  `).get(salesReturnId) as
    | {
        id: string;
        return_no: string;
        shipment_id: string;
        order_id: string;
        production_order_id: string;
        product_id: string;
        return_qty: number;
        replacement_status: string;
        status: string;
        delivery_address?: string;
        consignee?: string;
        contact_phone?: string;
      }
    | undefined;
  if (!salesReturn) throw new Error("销售退货单不存在。");
  if (salesReturn.status !== "returned") throw new Error("退货单不是已退货状态，不能补发。");
  if (salesReturn.replacement_status === "replaced") throw new Error("该退货单已补发。");

  const available = (database.prepare(`
    SELECT COALESCE(SUM(qty), 0) AS qty
    FROM finished_batches
    WHERE production_order_id = ? AND kind = 'finished' AND status = 'available'
  `).get(salesReturn.production_order_id) as { qty: number }).qty;
  const shippedQty = roundQty(payloadPositiveNumber(payload, "shipped_qty", "补发数量", Number(salesReturn.return_qty)));
  if (shippedQty > Number(salesReturn.return_qty)) throw new Error("补发数量不能大于退货数量。");
  if (shippedQty > available) throw new Error("可用成品库存不足，不能补发。");
  const shippedDate = payloadDate(payload, "shipped_at", "补发日期", new Date().toISOString().slice(0, 10));
  const deliveryAddress = payloadText(payload, "delivery_address", "送货地址", false) || salesReturn.delivery_address || "";
  const consignee = payloadText(payload, "consignee", "收货人", false) || salesReturn.consignee || "";
  const contactPhone = payloadText(payload, "contact_phone", "联系电话", false) || salesReturn.contact_phone || "";
  const logisticsCompany = payloadText(payload, "logistics_company", "物流公司", false);
  const vehicleNo = payloadText(payload, "vehicle_no", "车牌号", false);
  const trackingNo = payloadText(payload, "tracking_no", "物流单号", false);
  const remark = payloadText(payload, "remark", "备注", false) || "售后补开发货单，不重复生成应收。";
  const shipmentId = uid("SHP");
  const shipmentNo = serial(database, "shipments", "FH");
  const shippedAt = `${shippedDate}T00:00:00.000Z`;

  database.prepare(`
    INSERT INTO shipments (
      id, shipment_no, order_id, production_order_id, shipped_qty,
      sales_amount, cost_amount, gross_profit, gross_margin, financial_status, shipped_by, status,
      delivery_address, consignee, contact_phone, logistics_company, vehicle_no,
      tracking_no, remark, shipment_type, replacement_for_return_id, original_shipment_id, created_at, shipped_at
    )
    VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 'no_charge', ?, 'shipped', ?, ?, ?, ?, ?, ?, ?, 'replacement', ?, ?, ?, ?)
  `).run(
    shipmentId,
    shipmentNo,
    salesReturn.order_id,
    salesReturn.production_order_id,
    shippedQty,
    actorId,
    deliveryAddress,
    consignee,
    contactPhone,
    logisticsCompany,
    vehicleNo,
    trackingNo,
    remark,
    salesReturn.id,
    salesReturn.shipment_id,
    now(),
    shippedAt,
  );

  const costAmount = allocateFinishedStockForShipment(database, {
    shipmentId,
    productionId: salesReturn.production_order_id,
    productId: salesReturn.product_id,
    shippedQty,
    shippedAt,
    movementType: "replacement_shipment_outbound",
  });
  database.prepare("UPDATE shipments SET cost_amount = ?, gross_profit = ? WHERE id = ?").run(
    costAmount,
    -costAmount,
    shipmentId,
  );
  database.prepare("UPDATE sales_returns SET replacement_status = 'replaced' WHERE id = ?").run(salesReturn.id);
  audit(database, actorId, "createReplacementShipment", "shipment", shipmentId, `补开发货单 ${shipmentNo}：${salesReturn.return_no} / ${shippedQty}`);
}

function purchaseRequisitionLineDrafts(database: Database.Database, payload?: Record<string, unknown>, materialId?: string) {
  const rawLines =
    payload && Array.isArray(payload.lines)
      ? payload.lines
      : payload
        ? [
            {
              material_id: payload.material_id,
              requested_qty: payload.requested_qty ?? payload.qty,
              estimated_unit_cost: payload.estimated_unit_cost ?? payload.unit_cost,
              note: payload.note,
            },
          ]
        : [{ material_id: mustEntity(materialId) }];
  if (rawLines.length === 0) throw new Error("采购申请至少需要一行明细。");

  return rawLines.map((rawLine, index) => {
    if (!rawLine || typeof rawLine !== "object") throw new Error(`采购申请明细第 ${index + 1} 行格式不正确。`);
    const sourceLine = rawLine as Record<string, unknown>;
    const line = {
      ...sourceLine,
      requested_qty: sourceLine.requested_qty ?? sourceLine.qty,
      estimated_unit_cost: sourceLine.estimated_unit_cost ?? sourceLine.unit_cost,
    };
    const selectedMaterialId = payloadText(line, "material_id", `第 ${index + 1} 行物料`);
    const material = database
      .prepare("SELECT * FROM materials WHERE id = ? AND status = 'active'")
      .get(selectedMaterialId) as
      | { id: string; name: string; unit: string; stock_qty: number; average_cost: number; reorder_min_qty: number }
      | undefined;
    if (!material) throw new Error(`第 ${index + 1} 行请选择启用状态的物料。`);

    const qty = payload
      ? roundQty(payloadNumber(line, "requested_qty", `第 ${index + 1} 行申请数量`, { min: 0.000001 }))
      : roundQty(Math.max(material.reorder_min_qty * 2 - material.stock_qty, material.reorder_min_qty || 50));
    const estimatedUnitCost = payload
      ? roundMoney(
          line.estimated_unit_cost == null || line.estimated_unit_cost === ""
            ? Number(material.average_cost ?? 0)
            : payloadNumber(line, "estimated_unit_cost", `第 ${index + 1} 行预计单价`, { min: 0 }),
        )
      : roundMoney(Math.max(material.average_cost * 1.08, material.id === "M-COATING" ? 50 : 8));

    return {
      materialId: material.id,
      materialName: material.name,
      unit: material.unit,
      requestedQty: qty,
      estimatedUnitCost,
      lineAmount: roundMoney(qty * estimatedUnitCost),
      note: payloadText(line, "note", `第 ${index + 1} 行备注`, false),
    };
  });
}

function sumByMaterial(rows: Array<{ material_id: string; qty: number }>) {
  const result = new Map<string, number>();
  rows.forEach((row) => {
    result.set(row.material_id, roundQty((result.get(row.material_id) ?? 0) + Number(row.qty ?? 0)));
  });
  return result;
}

function openPurchaseQtyByMaterial(database: Database.Database) {
  return sumByMaterial(
    database.prepare(`
      SELECT pol.material_id, SUM(pol.qty) AS qty
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      WHERE po.status IN ('pending_approval', 'pending_receipt', 'iqc_pending')
      GROUP BY pol.material_id
    `).all() as Array<{ material_id: string; qty: number }>,
  );
}

function openPurchaseRequisitionQtyByMaterial(database: Database.Database) {
  return sumByMaterial(
    database.prepare(`
      SELECT prl.material_id, SUM(prl.requested_qty) AS qty
      FROM purchase_requisition_lines prl
      JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
      WHERE pr.status IN ('pending_approval', 'approved')
        AND pr.converted_order_id IS NULL
      GROUP BY prl.material_id
    `).all() as Array<{ material_id: string; qty: number }>,
  );
}

function generateMrpRequirementRun(
  database: Database.Database,
  actorId: string,
  productionOrderId?: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const sourceType = productionOrderId ? "production_order" : "active_productions";
  const generatedAt = now();
  const horizonDate = payloadDate(payload, "horizon_date", "需求截止日期", addDays(generatedAt, 30));
  const note =
    payloadText(payload, "note", "MRP测算说明", false) ||
    "按待排产/待发料生产工单展开 BOM，扣减当前库存、在途采购、未转单采购申请和安全库存后形成净需求。";
  const params: unknown[] = [horizonDate];
  let productionFilter = "";
  if (productionOrderId) {
    productionFilter = "AND po.id = ?";
    params.push(productionOrderId);
  }
  const productions = database.prepare(`
    SELECT po.id, po.prod_no, po.status, o.id AS order_id, o.order_no,
           o.product_id, o.qty, o.due_date, p.name AS product_name, p.unit
    FROM production_orders po
    JOIN orders o ON o.id = po.order_id
    JOIN products p ON p.id = o.product_id
    WHERE po.status IN ('instructed', 'material_requested')
      AND o.due_date <= ?
      ${productionFilter}
    ORDER BY o.due_date ASC, po.created_at ASC
  `).all(...params) as Array<{
    id: string;
    prod_no: string;
    status: string;
    order_id: string;
    order_no: string;
    product_id: string;
    product_name: string;
    qty: number;
    due_date: string;
    unit: string;
  }>;
  if (productions.length === 0) {
    throw new Error(productionOrderId ? "指定生产工单不在待排产/待发料状态。" : "当前没有需要 MRP 测算的待生产工单。");
  }

  const demands: Array<{ materialId: string; requiredQty: number; sourceSummary: string }> = [];
  const missingBomProducts: string[] = [];
  for (const production of productions) {
    const bomLines = activeBomLines(database, production.product_id);
    if (bomLines.length === 0) {
      missingBomProducts.push(`${production.prod_no}/${production.product_name}`);
      continue;
    }
    const expansion = expandBom({
      rootProductId: production.product_id,
      quantity: Number(production.qty),
      lines: bomLines,
    });
    expansion.materials.forEach((material) => {
      demands.push({
        materialId: material.materialId,
        requiredQty: material.requiredQty,
        sourceSummary: `${production.prod_no}/${production.order_no}/${production.product_name} ${production.qty}${production.unit}`,
      });
    });
  }
  if (demands.length === 0) throw new Error(`没有可用于 MRP 的有效 BOM。${missingBomProducts.join("、")}`);

  const materialRows = database.prepare(`
    SELECT id, name, unit, stock_qty, average_cost, reorder_min_qty
    FROM materials
    WHERE status = 'active'
  `).all() as Array<{
    id: string;
    name: string;
    unit: string;
    stock_qty: number;
    average_cost: number;
    reorder_min_qty: number;
  }>;
  const incomingPurchaseQty = openPurchaseQtyByMaterial(database);
  const plannedRequisitionQty = openPurchaseRequisitionQtyByMaterial(database);
  const supplyRows = materialRows.map((material) => ({
    materialId: material.id,
    availableQty: Number(material.stock_qty ?? 0),
    safetyStockQty: Number(material.reorder_min_qty ?? 0),
    incomingPurchaseQty: incomingPurchaseQty.get(material.id) ?? 0,
    plannedRequisitionQty: plannedRequisitionQty.get(material.id) ?? 0,
    estimatedUnitCost: Number(material.average_cost ?? 0),
  }));
  const lines = calculateMaterialNetRequirements({ demands, supplies: supplyRows });
  const shortageLines = lines.filter((line) => line.netShortageQty > 0);

  const runId = uid("MRP");
  const runNo = serial(database, "mrp_requirement_runs", "MRP");
  const totalGrossQty = roundQty(lines.reduce((sum, line) => sum + Number(line.requiredQty ?? 0), 0));
  const totalShortageQty = roundQty(shortageLines.reduce((sum, line) => sum + Number(line.netShortageQty ?? 0), 0));
  const totalShortageAmount = roundMoney(shortageLines.reduce((sum, line) => sum + Number(line.lineAmount ?? 0), 0));
  database.prepare(`
    INSERT INTO mrp_requirement_runs (
      id, run_no, source_type, source_document_id, horizon_date, status,
      line_count, shortage_line_count, total_gross_qty, total_shortage_qty,
      total_shortage_amount, note, generated_by, generated_at,
      converted_requisition_id, converted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(
    runId,
    runNo,
    sourceType,
    productionOrderId ?? null,
    horizonDate,
    shortageLines.length > 0 ? "draft" : "covered",
    lines.length,
    shortageLines.length,
    totalGrossQty,
    totalShortageQty,
    totalShortageAmount,
    missingBomProducts.length ? `${note} 未纳入BOM：${missingBomProducts.join("、")}` : note,
    actorId,
    generatedAt,
  );

  const insertLine = database.prepare(`
    INSERT INTO mrp_requirement_lines (
      id, run_id, material_id, required_qty, available_qty, safety_stock_qty,
      incoming_purchase_qty, planned_requisition_qty, net_shortage_qty,
      suggested_purchase_qty, estimated_unit_cost, line_amount,
      source_summary, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  lines.forEach((line) => {
    insertLine.run(
      uid("MRPL"),
      runId,
      line.materialId,
      line.requiredQty,
      line.availableQty,
      line.safetyStockQty,
      line.incomingPurchaseQty,
      line.plannedRequisitionQty,
      line.netShortageQty,
      line.suggestedPurchaseQty,
      line.estimatedUnitCost,
      line.lineAmount,
      line.sourceSummary,
      line.status,
    );
  });

  audit(
    database,
    actorId,
    "generateMrpRequirementRun",
    "mrp_requirement_run",
    runId,
    `生成 MRP 缺料净需求 ${runNo}：${shortageLines.length} 项需采购 / ${totalShortageAmount}`,
  );
}

function createPurchaseRequisition(
  database: Database.Database,
  actorId: string,
  materialId?: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : undefined;
  const sourceType = purchaseRequisitionSourceTypeValue(
    payload ? payloadText(payload, "source_type", "采购申请来源", false) || (materialId ? "low_stock" : "manual") : "low_stock",
  );
  const lines = purchaseRequisitionLineDrafts(database, payload, materialId);
  const totalAmount = roundMoney(lines.reduce((sum, line) => sum + line.lineAmount, 0));
  const requisitionId = uid("PR");
  const requisitionNo = serial(database, "purchase_requisitions", "QS");
  const approvalId = uid("OA");
  const approvalNo = serial(database, "approval_requests", "SP");
  const createdAt = now();
  const requiredDate = payload ? payloadDate(payload, "required_date", "需求日期", addDays(createdAt, 7)) : addDays(createdAt, 7);
  const reason =
    payloadText(payload ?? {}, "reason", "申请原因", false) ||
    `${purchaseRequisitionSourceTypeLabel(sourceType)}：${lines.map((line) => `${line.materialName} ${line.requestedQty}${line.unit}`).join("、")}。`;
  const approvalRule = matchApprovalRule(database, "purchase_requisition", totalAmount);

  database.prepare(`
    INSERT INTO approval_requests (
      id, request_no, type, title, applicant_id, status, amount,
      reason, rule_id, approver_role, sla_hours, entity_type, entity_id,
      created_at, decided_by, decided_at, decision_note
    )
    VALUES (?, ?, '采购申请', ?, ?, 'pending', ?, ?, ?, ?, ?, 'purchase_requisition', ?, ?, NULL, NULL, NULL)
  `).run(
    approvalId,
    approvalNo,
    `采购申请 ${requisitionNo} 审批`,
    actorId,
    totalAmount,
    reason,
    approvalRule?.id ?? null,
    approvalRule?.approver_role ?? "manager",
    approvalRule?.sla_hours ?? 24,
    requisitionId,
    createdAt,
  );
  database.prepare(`
    INSERT INTO purchase_requisitions (
      id, requisition_no, source_type, requested_by, approval_request_id,
      source_document_type, source_document_id, status, total_amount,
      required_date, reason, created_at, approved_by, approved_at,
      approval_note, converted_order_id, converted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, NULL, NULL, '', NULL, NULL)
  `).run(
    requisitionId,
    requisitionNo,
    sourceType,
    actorId,
    approvalId,
    payloadText(payload ?? {}, "source_document_type", "来源单据类型", false) || null,
    payloadText(payload ?? {}, "source_document_id", "来源单据编号", false) || null,
    totalAmount,
    requiredDate,
    reason,
    createdAt,
  );
  const insertLine = database.prepare(`
    INSERT INTO purchase_requisition_lines (
      id, purchase_requisition_id, material_id, requested_qty, estimated_unit_cost, line_amount, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  lines.forEach((line) => {
    insertLine.run(uid("PRL"), requisitionId, line.materialId, line.requestedQty, line.estimatedUnitCost, line.lineAmount, line.note);
  });
  audit(
    database,
    actorId,
    "createPurchaseRequisition",
    "purchase_requisition",
    requisitionId,
    `录入采购申请 ${requisitionNo}：${purchaseRequisitionSourceTypeLabel(sourceType)} / ${lines.length} 行 / ${totalAmount}`,
  );
  audit(database, actorId, "submitPurchaseRequisitionApproval", "approval", approvalId, `采购申请 ${requisitionNo} 自动提交审批 ${approvalNo}`);
  return requisitionId;
}

function createPurchaseRequisitionFromMrp(
  database: Database.Database,
  actorId: string,
  runId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const run = database.prepare("SELECT * FROM mrp_requirement_runs WHERE id = ?").get(runId) as
    | {
        id: string;
        run_no: string;
        status: string;
        shortage_line_count: number;
        total_shortage_amount: number;
        converted_requisition_id?: string | null;
      }
    | undefined;
  if (!run) throw new Error("MRP 测算记录不存在。");
  if (run.converted_requisition_id || run.status === "requisition_created") throw new Error("该 MRP 测算已生成采购申请。");
  if (run.status !== "draft" || Number(run.shortage_line_count ?? 0) <= 0) throw new Error("该 MRP 测算没有可转采购申请的缺料行。");

  const lines = database.prepare(`
    SELECT mrl.*, m.name AS material_name, m.unit
    FROM mrp_requirement_lines mrl
    JOIN materials m ON m.id = mrl.material_id
    WHERE mrl.run_id = ?
      AND mrl.status = 'shortage'
      AND mrl.suggested_purchase_qty > 0
    ORDER BY mrl.line_amount DESC
  `).all(run.id) as Array<{
    material_id: string;
    material_name: string;
    unit: string;
    suggested_purchase_qty: number;
    estimated_unit_cost: number;
    line_amount: number;
    source_summary: string;
  }>;
  if (lines.length === 0) throw new Error("MRP 测算缺少有效缺料明细。");

  const requiredDate = payloadDate(payload, "required_date", "需求日期", addDays(now(), 7));
  const requisitionId = createPurchaseRequisition(database, actorId, undefined, {
    source_type: "bom_shortage",
    source_document_type: "mrp_requirement_run",
    source_document_id: run.id,
    required_date: requiredDate,
    reason:
      payloadText(payload, "reason", "申请原因", false) ||
      `由 MRP 缺料净需求 ${run.run_no} 自动生成，建议采购金额 ${roundMoney(Number(run.total_shortage_amount ?? 0))}。`,
    lines: lines.map((line) => ({
      material_id: line.material_id,
      requested_qty: line.suggested_purchase_qty,
      estimated_unit_cost: line.estimated_unit_cost,
      note: `MRP来源：${line.source_summary}`,
    })),
  });
  const convertedAt = now();
  database.prepare(`
    UPDATE mrp_requirement_runs
    SET status = 'requisition_created',
        converted_requisition_id = ?,
        converted_at = ?
    WHERE id = ?
  `).run(requisitionId, convertedAt, run.id);
  audit(
    database,
    actorId,
    "createPurchaseRequisitionFromMrp",
    "mrp_requirement_run",
    run.id,
    `MRP ${run.run_no} 已生成采购申请 ${requisitionId}`,
  );
}

function assertSupplierPurchaseAllowed(database: Database.Database, supplierId: string, materialIds: string[] = []) {
  const control = database.prepare(`
    SELECT control_status, reason
    FROM supplier_admission_controls
    WHERE supplier_id = ?
  `).get(supplierId) as { control_status: string; reason?: string } | undefined;
  if (control && !supplierAdmissionPurchaseAllowed(control.control_status)) {
    throw new Error(
      `供应商准入状态为【${supplierAdmissionStatusLabel(control.control_status)}】，需完成整改复评后才能新增采购订单。${control.reason ? ` 原因：${control.reason}` : ""}`,
    );
  }
  assertSupplierQualificationRequirements(database, supplierId, materialIds);
}

function supplierControlPayload(rawPayload?: Record<string, unknown>) {
  return rawPayload && typeof rawPayload === "object" ? rawPayload : {};
}

function upsertSupplierAdmissionControl(input: {
  database: Database.Database;
  actorId: string;
  supplierId: string;
  status: string;
  reason: string;
  sourceType: string;
  sourceId?: string | null;
  performanceScore: number;
  riskLevel: string;
  releaseNote?: string;
}) {
  const timestamp = now();
  const existing = input.database.prepare("SELECT * FROM supplier_admission_controls WHERE supplier_id = ?").get(input.supplierId) as
    | { id: string; control_no: string; control_status: string }
    | undefined;
  const purchaseAllowed = supplierAdmissionPurchaseAllowed(input.status);
  if (existing) {
    input.database.prepare(`
      UPDATE supplier_admission_controls
      SET control_status = ?,
          purchase_allowed = ?,
          reason = ?,
          source_type = ?,
          source_id = ?,
          performance_score = ?,
          risk_level = ?,
          updated_by = ?,
          updated_at = ?,
          released_at = ?,
          release_note = ?
      WHERE id = ?
    `).run(
      input.status,
      purchaseAllowed,
      input.reason,
      input.sourceType,
      input.sourceId ?? null,
      roundMoney(input.performanceScore),
      input.riskLevel,
      input.actorId,
      timestamp,
      purchaseAllowed ? timestamp : null,
      purchaseAllowed ? input.releaseNote ?? "" : "",
      existing.id,
    );
    return existing.id;
  }

  const controlId = uid("SAC");
  const controlNo = serial(input.database, "supplier_admission_controls", "ZR");
  input.database.prepare(`
    INSERT INTO supplier_admission_controls (
      id, control_no, supplier_id, control_status, purchase_allowed,
      reason, source_type, source_id, performance_score, risk_level,
      created_by, created_at, updated_by, updated_at, released_at, release_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    controlId,
    controlNo,
    input.supplierId,
    input.status,
    purchaseAllowed,
    input.reason,
    input.sourceType,
    input.sourceId ?? null,
    roundMoney(input.performanceScore),
    input.riskLevel,
    input.actorId,
    timestamp,
    input.actorId,
    timestamp,
    purchaseAllowed ? timestamp : null,
    purchaseAllowed ? input.releaseNote ?? "" : "",
  );
  return controlId;
}

function createSupplierCorrectiveAction(
  database: Database.Database,
  actorId: string,
  supplierId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = supplierControlPayload(rawPayload);
  const supplier = database.prepare("SELECT id, name FROM suppliers WHERE id = ? AND status = 'active'").get(supplierId) as
    | { id: string; name: string }
    | undefined;
  if (!supplier) throw new Error("供应商不存在或未启用。");
  const actor = database.prepare("SELECT id, role FROM users WHERE id = ?").get(actorId) as { id: string; role: Role };
  const performance = supplierPerformanceRows(database, { supplierId })[0] ?? {};
  const derivedStatus = supplierAdmissionStatusFromRisk(String(performance.risk_level ?? "low"));
  const controlStatus = supplierAdmissionStatusValue(
    payloadText(payload, "control_status", "准入状态", false) || derivedStatus,
    derivedStatus,
  );
  if (controlStatus === "blacklisted" && !["manager", "admin"].includes(actor.role)) {
    throw new Error("供应商拉黑必须由管理层或系统管理员执行。");
  }
  const reason =
    payloadText(payload, "reason", "整改原因", false) ||
    String(performance.recommendation ?? `${supplier.name} 需完成供应商整改和复评。`);
  const requiredAction =
    payloadText(payload, "required_action", "整改要求", false) ||
    (controlStatus === "blacklisted"
      ? "提交8D整改报告、批次追溯资料、交付改善计划和下一批来料自检证明。"
      : "提交交付和质量改善计划，采购复核后提交管理层复评。");
  const dueDate = payloadDate(
    payload,
    "due_date",
    "整改到期日",
    addDays(new Date().toISOString().slice(0, 10), controlStatus === "blacklisted" ? 7 : 14),
  );
  const ownerId = payloadText(payload, "owner_id", "整改责任人", false) || "U-PUR";
  const owner = database.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(ownerId) as
    | { id: string }
    | undefined;
  if (!owner) throw new Error("整改责任人不存在或未启用。");

  const controlId = upsertSupplierAdmissionControl({
    database,
    actorId,
    supplierId: supplier.id,
    status: controlStatus,
    reason,
    sourceType: "supplier_performance",
    sourceId: String(performance.admission_control_id || ""),
    performanceScore: Number(performance.performance_score ?? 0),
    riskLevel: String(performance.risk_level ?? ""),
  });
  const actionId = uid("SCA");
  const actionNo = serial(database, "supplier_corrective_actions", "ZG");
  const createdAt = now();
  database.prepare(`
    INSERT INTO supplier_corrective_actions (
      id, action_no, supplier_id, control_id, status, severity,
      required_action, due_date, owner_id, created_by, created_at
    )
    VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
  `).run(
    actionId,
    actionNo,
    supplier.id,
    controlId,
    supplierCorrectionSeverity(controlStatus),
    requiredAction,
    dueDate,
    owner.id,
    actorId,
    createdAt,
  );
  audit(database, actorId, "createSupplierCorrectiveAction", "supplier_corrective_action", actionId, `创建供应商整改 ${actionNo}：${supplier.name} / ${supplierAdmissionStatusLabel(controlStatus)}`);
}

function blacklistSupplier(
  database: Database.Database,
  actorId: string,
  supplierId: string,
  rawPayload?: Record<string, unknown>,
) {
  createSupplierCorrectiveAction(database, actorId, supplierId, {
    ...(rawPayload ?? {}),
    control_status: "blacklisted",
  });
  audit(database, actorId, "blacklistSupplier", "supplier", supplierId, "供应商纳入黑名单并生成整改任务");
}

function submitSupplierCorrection(
  database: Database.Database,
  actorId: string,
  correctiveActionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = supplierControlPayload(rawPayload);
  const corrective = database.prepare(`
    SELECT sca.*, s.name AS supplier_name
    FROM supplier_corrective_actions sca
    JOIN suppliers s ON s.id = sca.supplier_id
    WHERE sca.id = ?
  `).get(correctiveActionId) as
    | { id: string; action_no: string; supplier_name: string; status: string }
    | undefined;
  if (!corrective) throw new Error("供应商整改任务不存在。");
  if (!["open", "rejected"].includes(corrective.status)) throw new Error("当前整改任务不能提交复评。");
  const evidenceNote = payloadText(payload, "evidence_note", "整改证据说明");
  const submittedAt = now();
  database.prepare(`
    UPDATE supplier_corrective_actions
    SET status = 'submitted',
        submitted_by = ?,
        submitted_at = ?,
        evidence_note = ?
    WHERE id = ?
  `).run(actorId, submittedAt, evidenceNote, corrective.id);
  audit(database, actorId, "submitSupplierCorrection", "supplier_corrective_action", corrective.id, `提交供应商整改复评 ${corrective.action_no}：${corrective.supplier_name}`);
}

function recordSupplierAdmissionRelease(
  database: Database.Database,
  actorId: string,
  input: {
    supplierId: string;
    supplierName: string;
    controlId: string;
    correctiveActionId: string;
    reassessmentId: string;
    previousStatus: string;
    nextStatus: string;
    releaseReason: string;
    releasedAt: string;
  },
) {
  const previousAllowed = supplierAdmissionPurchaseAllowed(input.previousStatus);
  const nextAllowed = supplierAdmissionPurchaseAllowed(input.nextStatus);
  if (previousAllowed || !nextAllowed) return;
  const existing = database.prepare("SELECT id FROM supplier_admission_releases WHERE reassessment_id = ?").get(input.reassessmentId) as
    | { id: string }
    | undefined;
  if (existing) return;

  const releaseId = uid("SAR");
  const releaseNo = serial(database, "supplier_admission_releases", "HF");
  database.prepare(`
    INSERT INTO supplier_admission_releases (
      id, release_no, supplier_id, control_id, corrective_action_id, reassessment_id,
      previous_status, next_status, purchase_allowed_before, purchase_allowed_after,
      release_result, release_reason, released_by, released_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'restored', ?, ?, ?, ?)
  `).run(
    releaseId,
    releaseNo,
    input.supplierId,
    input.controlId,
    input.correctiveActionId,
    input.reassessmentId,
    input.previousStatus,
    input.nextStatus,
    previousAllowed,
    nextAllowed,
    input.releaseReason,
    actorId,
    input.releasedAt,
    input.releasedAt,
  );
  audit(
    database,
    actorId,
    "releaseSupplierAdmission",
    "supplier_admission_release",
    releaseId,
    `供应商恢复采购 ${releaseNo}：${input.supplierName} / ${supplierAdmissionStatusLabel(input.previousStatus)} -> ${supplierAdmissionStatusLabel(input.nextStatus)}`,
  );
  createSupplierObservationPeriod(database, actorId, {
    supplierId: input.supplierId,
    releaseId,
    reassessmentId: input.reassessmentId,
    controlId: input.controlId,
    startAt: input.releasedAt,
    closeReason: `复评通过后恢复采购，进入 30 天或首批采购合格的观察期。${input.releaseReason}`,
  });
}

function createSupplierObservationPeriod(
  database: Database.Database,
  actorId: string,
  input: {
    supplierId: string;
    releaseId: string;
    reassessmentId: string;
    controlId: string;
    startAt: string;
    closeReason: string;
  },
) {
  const existing = database.prepare("SELECT id FROM supplier_observation_periods WHERE release_id = ?").get(input.releaseId) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const observationId = uid("SOP");
  const observationNo = serial(database, "supplier_observation_periods", "GC");
  const startDate = input.startAt.slice(0, 10);
  const plannedEndAt = `${addDays(startDate, 30)}T00:00:00.000Z`;
  database.prepare(`
    INSERT INTO supplier_observation_periods (
      id, observation_no, supplier_id, release_id, reassessment_id, control_id,
      status, start_at, planned_end_at, required_batch_count, completed_batch_count,
      last_batch_source_type, last_batch_source_id, breach_source_type, breach_source_id,
      breach_reason, close_reason, created_by, created_at, updated_by, updated_at, closed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, 0, '', NULL, '', NULL, '', ?, ?, ?, ?, ?, NULL)
  `).run(
    observationId,
    observationNo,
    input.supplierId,
    input.releaseId,
    input.reassessmentId,
    input.controlId,
    input.startAt,
    plannedEndAt,
    input.closeReason,
    actorId,
    input.startAt,
    actorId,
    input.startAt,
  );
  audit(database, actorId, "createSupplierObservationPeriod", "supplier_observation_period", observationId, `供应商恢复采购进入观察期 ${observationNo}`);
  return observationId;
}

function activeSupplierObservationPeriod(database: Database.Database, supplierId: string) {
  return database.prepare(`
    SELECT *
    FROM supplier_observation_periods
    WHERE supplier_id = ?
      AND status = 'active'
    ORDER BY start_at DESC
    LIMIT 1
  `).get(supplierId) as
    | {
        id: string;
        observation_no: string;
        supplier_id: string;
        control_id: string;
        status: string;
        required_batch_count: number;
        completed_batch_count: number;
      }
    | undefined;
}

function closeSupplierObservationBatch(
  database: Database.Database,
  actorId: string,
  supplierId: string,
  sourceType: string,
  sourceId: string,
  closeReason: string,
) {
  const observation = activeSupplierObservationPeriod(database, supplierId);
  if (!observation) return;
  const completedCount = Number(observation.completed_batch_count ?? 0) + 1;
  const requiredCount = Math.max(1, Number(observation.required_batch_count ?? 1));
  const completed = completedCount >= requiredCount;
  const updatedAt = now();
  database.prepare(`
    UPDATE supplier_observation_periods
    SET completed_batch_count = ?,
        last_batch_source_type = ?,
        last_batch_source_id = ?,
        status = ?,
        close_reason = ?,
        updated_by = ?,
        updated_at = ?,
        closed_at = ?
    WHERE id = ?
  `).run(
    completedCount,
    sourceType,
    sourceId,
    completed ? "completed" : "active",
    closeReason,
    actorId,
    updatedAt,
    completed ? updatedAt : null,
    observation.id,
  );
  audit(
    database,
    actorId,
    "completeSupplierObservationBatch",
    "supplier_observation_period",
    observation.id,
    `供应商观察期首批采购完成：${observation.observation_no}`,
  );
}

function breachSupplierObservationPeriod(
  database: Database.Database,
  actorId: string,
  supplierId: string,
  sourceType: string,
  sourceId: string,
  reason: string,
) {
  const observation = activeSupplierObservationPeriod(database, supplierId);
  if (!observation) return;
  const supplier = database.prepare("SELECT id, name FROM suppliers WHERE id = ?").get(supplierId) as
    | { id: string; name: string }
    | undefined;
  if (!supplier) return;
  const breachedAt = now();
  database.prepare(`
    UPDATE supplier_observation_periods
    SET status = 'breached',
        breach_source_type = ?,
        breach_source_id = ?,
        breach_reason = ?,
        close_reason = ?,
        updated_by = ?,
        updated_at = ?,
        closed_at = ?
    WHERE id = ?
  `).run(sourceType, sourceId, reason, reason, actorId, breachedAt, breachedAt, observation.id);

  const performance = supplierPerformanceRows(database, { supplierId })[0] ?? {};
  const currentControl = database.prepare("SELECT control_status FROM supplier_admission_controls WHERE supplier_id = ?").get(supplierId) as
    | { control_status: string }
    | undefined;
  const nextStatus = strongerSupplierAdmissionStatus(String(currentControl?.control_status ?? "normal"), "restricted");
  const controlId = upsertSupplierAdmissionControl({
    database,
    actorId,
    supplierId,
    status: nextStatus,
    reason,
    sourceType: "supplier_observation_period",
    sourceId: observation.id,
    performanceScore: Number(performance.performance_score ?? 0),
    riskLevel: supplierAdmissionRiskFromStatus(nextStatus),
  });
  const existingAction = database.prepare(`
    SELECT id
    FROM supplier_corrective_actions
    WHERE supplier_id = ?
      AND status IN ('open', 'submitted', 'rejected')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(supplierId) as { id: string } | undefined;
  const requiredAction = "恢复采购观察期内发生异常，暂停新增采购；供应商需提交观察期异常原因分析、纠正预防措施、批次追溯和重新复评资料。";
  if (existingAction) {
    database.prepare(`
      UPDATE supplier_corrective_actions
      SET control_id = ?,
          status = CASE WHEN status = 'submitted' THEN 'open' ELSE status END,
          severity = 'high',
          required_action = ?,
          due_date = ?,
          reviewed_by = NULL,
          reviewed_at = NULL,
          review_result = '',
          review_note = '',
          closed_at = NULL
      WHERE id = ?
    `).run(controlId, requiredAction, addDays(new Date().toISOString().slice(0, 10), 7), existingAction.id);
  } else {
    const actionId = uid("SCA");
    const actionNo = serial(database, "supplier_corrective_actions", "ZG");
    database.prepare(`
      INSERT INTO supplier_corrective_actions (
        id, action_no, supplier_id, control_id, status, severity,
        required_action, due_date, owner_id, created_by, created_at
      )
      VALUES (?, ?, ?, ?, 'open', 'high', ?, ?, 'U-PUR', ?, ?)
    `).run(actionId, actionNo, supplierId, controlId, requiredAction, addDays(new Date().toISOString().slice(0, 10), 7), actorId, breachedAt);
  }
  audit(
    database,
    actorId,
    "breachSupplierObservationPeriod",
    "supplier_observation_period",
    observation.id,
    `供应商观察期异常 ${observation.observation_no}：${supplier.name} 已重新限制采购`,
  );
}

function reviewSupplierCorrection(
  database: Database.Database,
  actorId: string,
  correctiveActionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = supplierControlPayload(rawPayload);
  const corrective = database.prepare(`
    SELECT sca.*, s.name AS supplier_name, sac.control_status, sac.id AS control_id
    FROM supplier_corrective_actions sca
    JOIN suppliers s ON s.id = sca.supplier_id
    JOIN supplier_admission_controls sac ON sac.id = sca.control_id
    WHERE sca.id = ?
  `).get(correctiveActionId) as
    | {
        id: string;
        action_no: string;
        supplier_id: string;
        supplier_name: string;
        control_id: string;
        control_status: string;
        status: string;
      }
    | undefined;
  if (!corrective) throw new Error("供应商整改任务不存在。");
  if (corrective.status !== "submitted") throw new Error("整改任务尚未提交复评。");
  const result = payloadText(payload, "result", "复评结果") === "failed" ? "failed" : "passed";
  const reassessmentScore = roundMoney(payloadNumber(payload, "reassessment_score", "复评分数", { min: 0 }));
  if (reassessmentScore > 100) throw new Error("复评分数不能超过 100。");
  const reviewNote = payloadText(payload, "review_note", "复评意见", false) || supplierCorrectionResultLabel(result);
  const previousStatus = supplierAdmissionStatusValue(corrective.control_status, "restricted");
  const scoredStatus = supplierAdmissionStatusFromScore(reassessmentScore);
  const nextStatus =
    result === "passed"
      ? scoredStatus
      : ["restricted", "blacklisted"].includes(previousStatus)
        ? previousStatus
        : scoredStatus === "normal" || scoredStatus === "watch"
          ? "restricted"
          : scoredStatus;
  const reviewedAt = now();
  const reassessmentId = uid("SRA");
  const reassessmentNo = serial(database, "supplier_reassessments", "FP");

  database.prepare(`
    UPDATE supplier_corrective_actions
    SET status = ?,
        reviewed_by = ?,
        reviewed_at = ?,
        review_result = ?,
        review_note = ?,
        closed_at = ?
    WHERE id = ?
  `).run(result === "passed" ? "closed" : "rejected", actorId, reviewedAt, result, reviewNote, result === "passed" ? reviewedAt : null, corrective.id);

  upsertSupplierAdmissionControl({
    database,
    actorId,
    supplierId: corrective.supplier_id,
    status: nextStatus,
    reason: result === "passed" ? `供应商复评通过，复评分 ${reassessmentScore}。` : `供应商复评不通过，复评分 ${reassessmentScore}。`,
    sourceType: "supplier_reassessment",
    sourceId: reassessmentId,
    performanceScore: reassessmentScore,
    riskLevel: nextStatus === "normal" ? "low" : nextStatus === "watch" ? "medium" : "high",
    releaseNote: result === "passed" ? reviewNote : "",
  });

  database.prepare(`
    INSERT INTO supplier_reassessments (
      id, reassessment_no, supplier_id, control_id, corrective_action_id,
      previous_status, next_status, result, reassessment_score, conclusion,
      reviewer_id, reviewed_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reassessmentId,
    reassessmentNo,
    corrective.supplier_id,
    corrective.control_id,
    corrective.id,
    previousStatus,
    nextStatus,
    result,
    reassessmentScore,
    reviewNote,
    actorId,
    reviewedAt,
    reviewedAt,
  );
  recordSupplierAdmissionRelease(database, actorId, {
    supplierId: corrective.supplier_id,
    supplierName: corrective.supplier_name,
    controlId: corrective.control_id,
    correctiveActionId: corrective.id,
    reassessmentId,
    previousStatus,
    nextStatus,
    releaseReason: reviewNote,
    releasedAt: reviewedAt,
  });
  audit(database, actorId, "reviewSupplierCorrection", "supplier_reassessment", reassessmentId, `供应商复评 ${reassessmentNo}：${corrective.supplier_name} / ${supplierCorrectionResultLabel(result)} / ${supplierAdmissionStatusLabel(nextStatus)}`);
}

function createPurchaseOrderFromRequisition(
  database: Database.Database,
  actorId: string,
  requisitionId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const requisition = database.prepare("SELECT * FROM purchase_requisitions WHERE id = ?").get(requisitionId) as
    | {
        id: string;
        requisition_no: string;
        status: string;
        total_amount: number;
        converted_order_id?: string | null;
      }
    | undefined;
  if (!requisition) throw new Error("采购申请不存在。");
  if (requisition.status === "converted" || requisition.converted_order_id) throw new Error("采购申请已转采购订单。");
  if (requisition.status !== "approved") throw new Error("采购申请尚未审批通过。");

  const supplierId = payloadText(payload, "supplier_id", "供应商");
  const supplier = database.prepare("SELECT id, name FROM suppliers WHERE id = ? AND status = 'active'").get(supplierId) as
    | { id: string; name: string }
    | undefined;
  if (!supplier) throw new Error("请选择启用状态的供应商。");

  const lines = database.prepare(`
    SELECT prl.*, m.name AS material_name, m.unit
    FROM purchase_requisition_lines prl
    JOIN materials m ON m.id = prl.material_id
    WHERE prl.purchase_requisition_id = ?
    ORDER BY prl.id
  `).all(requisition.id) as Array<{
    material_id: string;
    material_name: string;
    unit: string;
    requested_qty: number;
    estimated_unit_cost: number;
    line_amount: number;
  }>;
  if (lines.length === 0) throw new Error("采购申请缺少明细，不能转采购订单。");
  assertSupplierPurchaseAllowed(
    database,
    supplier.id,
    lines.map((line) => line.material_id),
  );

  const totalAmount = roundMoney(lines.reduce((sum, line) => sum + Number(line.line_amount ?? 0), 0));
  const purchaseId = uid("PO");
  const purchaseNo = serial(database, "purchase_orders", "CG");
  const approvalId = uid("OA");
  const approvalNo = serial(database, "approval_requests", "SP");
  const createdAt = now();
  const dueDate = payloadDate(payload, "due_date", "到期付款日", addDays(createdAt, 30));
  const approvalRule = matchApprovalRule(database, "purchase_order", totalAmount);
  database.prepare(`
    INSERT INTO approval_requests (
      id, request_no, type, title, applicant_id, status, amount,
      reason, rule_id, approver_role, sla_hours, entity_type, entity_id,
      created_at, decided_by, decided_at, decision_note
    )
    VALUES (?, ?, '采购订单', ?, ?, 'pending', ?, ?, ?, ?, ?, 'purchase_order', ?, ?, NULL, NULL, NULL)
  `).run(
    approvalId,
    approvalNo,
    `采购订单 ${purchaseNo} 审批`,
    actorId,
    totalAmount,
    `由采购申请 ${requisition.requisition_no} 转入；供应商：${supplier.name}；明细：${lines
      .map((line) => `${line.material_name} ${line.requested_qty}${line.unit}`)
      .join("、")}。`,
    approvalRule?.id ?? null,
    approvalRule?.approver_role ?? "manager",
    approvalRule?.sla_hours ?? 24,
    purchaseId,
    createdAt,
  );
  database.prepare(`
    INSERT INTO purchase_orders (
      id, purchase_no, supplier_id, approval_request_id, source_requisition_id, status, total_amount, due_date, created_at, received_at
    )
    VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, NULL)
  `).run(purchaseId, purchaseNo, supplier.id, approvalId, requisition.id, totalAmount, dueDate, createdAt);
  const insertLine = database.prepare(`
    INSERT INTO purchase_order_lines (
      id, purchase_order_id, material_id, qty, unit_cost, line_amount
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  lines.forEach((line) => {
    insertLine.run(
      uid("POL"),
      purchaseId,
      line.material_id,
      roundQty(Number(line.requested_qty)),
      roundMoney(Number(line.estimated_unit_cost)),
      roundMoney(Number(line.line_amount)),
    );
  });
  database.prepare(`
    UPDATE purchase_requisitions
    SET status = 'converted', converted_order_id = ?, converted_at = ?
    WHERE id = ?
  `).run(purchaseId, createdAt, requisition.id);
  audit(
    database,
    actorId,
    "createPurchaseOrderFromRequisition",
    "purchase_order",
    purchaseId,
    `采购申请 ${requisition.requisition_no} 转采购订单 ${purchaseNo}：${supplier.name} / ${totalAmount}`,
  );
  audit(database, actorId, "submitPurchaseApproval", "approval", approvalId, `采购单 ${purchaseNo} 自动提交审批 ${approvalNo}`);
}

function createPurchaseOrder(
  database: Database.Database,
  actorId: string,
  materialId?: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : undefined;
  const supplierId = payload
    ? payloadText(payload, "supplier_id", "供应商")
    : materialId === "M-COATING"
      ? "SUP-002"
      : "SUP-001";
  const supplier = database.prepare("SELECT id, name FROM suppliers WHERE id = ? AND status = 'active'").get(supplierId) as
    | { id: string; name: string }
    | undefined;
  if (!supplier) throw new Error("请选择启用状态的供应商。");

  const purchaseLines = purchaseLineDrafts(database, payload, materialId);
  assertSupplierPurchaseAllowed(
    database,
    supplier.id,
    purchaseLines.map((line) => line.materialId),
  );
  const totalAmount = roundMoney(purchaseLines.reduce((sum, line) => sum + line.lineAmount, 0));
  const purchaseId = uid("PO");
  const purchaseNo = serial(database, "purchase_orders", "CG");
  const approvalId = uid("OA");
  const approvalNo = serial(database, "approval_requests", "SP");
  const createdAt = now();
  const approvalRule = matchApprovalRule(database, "purchase_order", totalAmount);
  const dueDate = payload
    ? payloadDate(payload, "due_date", "到期付款日")
    : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
  database.prepare(`
    INSERT INTO approval_requests (
      id, request_no, type, title, applicant_id, status, amount,
      reason, rule_id, approver_role, sla_hours, entity_type, entity_id,
      created_at, decided_by, decided_at, decision_note
    )
    VALUES (?, ?, '采购订单', ?, ?, 'pending', ?, ?, ?, ?, ?, 'purchase_order', ?, ?, NULL, NULL, NULL)
  `).run(
    approvalId,
    approvalNo,
    `采购订单 ${purchaseNo} 审批`,
    actorId,
    totalAmount,
    `供应商：${supplier.name}；明细：${purchaseLines.map((line) => `${line.materialName} ${line.qty}${line.unit}`).join("、")}。`,
    approvalRule?.id ?? null,
    approvalRule?.approver_role ?? "manager",
    approvalRule?.sla_hours ?? 24,
    purchaseId,
    createdAt,
  );
  database.prepare(`
    INSERT INTO purchase_orders (
      id, purchase_no, supplier_id, approval_request_id, status, total_amount, due_date, created_at, received_at
    )
    VALUES (?, ?, ?, ?, 'pending_approval', ?, ?, ?, NULL)
  `).run(purchaseId, purchaseNo, supplier.id, approvalId, totalAmount, dueDate, createdAt);
  const insertLine = database.prepare(`
    INSERT INTO purchase_order_lines (
      id, purchase_order_id, material_id, qty, unit_cost, line_amount
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  purchaseLines.forEach((line) => {
    insertLine.run(uid("POL"), purchaseId, line.materialId, line.qty, line.unitCost, line.lineAmount);
  });
  audit(
    database,
    actorId,
    "createPurchaseOrder",
    "purchase_order",
    purchaseId,
    `录入采购单 ${purchaseNo}：${supplier.name} / ${purchaseLines.length} 行 / ${totalAmount}`,
  );
  audit(database, actorId, "submitPurchaseApproval", "approval", approvalId, `采购单 ${purchaseNo} 自动提交审批 ${approvalNo}`);
}

function purchaseLineDrafts(database: Database.Database, payload?: Record<string, unknown>, materialId?: string) {
  const rawLines =
    payload && Array.isArray(payload.lines)
      ? payload.lines
      : payload
        ? [
            {
              material_id: payload.material_id,
              qty: payload.qty,
              unit_cost: payload.unit_cost,
            },
          ]
        : [{ material_id: mustEntity(materialId) }];
  if (rawLines.length === 0) throw new Error("采购订单至少需要一行明细。");

  return rawLines.map((rawLine, index) => {
    if (!rawLine || typeof rawLine !== "object") throw new Error(`采购明细第 ${index + 1} 行格式不正确。`);
    const line = rawLine as Record<string, unknown>;
    const selectedMaterialId = payloadText(line, "material_id", `第 ${index + 1} 行物料`);
    const material = database
      .prepare("SELECT * FROM materials WHERE id = ? AND status = 'active'")
      .get(selectedMaterialId) as
      | { id: string; name: string; unit: string; stock_qty: number; average_cost: number; reorder_min_qty: number }
      | undefined;
    if (!material) throw new Error(`第 ${index + 1} 行请选择启用状态的物料。`);

    const qty = payload
      ? roundQty(payloadNumber(line, "qty", `第 ${index + 1} 行采购数量`, { min: 0.000001 }))
      : roundQty(Math.max(material.reorder_min_qty * 2 - material.stock_qty, material.reorder_min_qty || 50));
    const unitCost = payload
      ? roundMoney(payloadNumber(line, "unit_cost", `第 ${index + 1} 行采购单价`, { min: 0.000001 }))
      : roundMoney(Math.max(material.average_cost * 1.08, material.id === "M-COATING" ? 50 : 8));

    return {
      materialId: material.id,
      materialName: material.name,
      unit: material.unit,
      qty,
      unitCost,
      lineAmount: roundMoney(qty * unitCost),
    };
  });
}

function createPurchaseContract(
  database: Database.Database,
  actorId: string,
  purchaseOrderId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const purchase = database.prepare(`
    SELECT po.*, s.name AS supplier_name, s.payment_terms
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).get(purchaseOrderId) as
    | {
        id: string;
        purchase_no: string;
        supplier_id: string;
        supplier_name: string;
        payment_terms: string;
        status: string;
        total_amount: number;
      }
    | undefined;
  if (!purchase) throw new Error("采购订单不存在。");
  if (purchase.status !== "pending_receipt") throw new Error("采购订单需审批通过后才能生成采购合同。");
  const purchaseMaterialIds = (
    database.prepare("SELECT material_id FROM purchase_order_lines WHERE purchase_order_id = ?").all(purchase.id) as Array<{
      material_id: string;
    }>
  ).map((line) => line.material_id);
  assertSupplierPurchaseAllowed(database, purchase.supplier_id, purchaseMaterialIds);
  const existing = database.prepare("SELECT id FROM purchase_contracts WHERE purchase_order_id = ?").get(purchase.id) as
    | { id: string }
    | undefined;
  if (existing) throw new Error("该采购订单已生成采购合同。");

  const contractId = uid("PC");
  const contractNo = serial(database, "purchase_contracts", "HT");
  const contractDate = payloadDate(payload, "contract_date", "合同日期", new Date().toISOString().slice(0, 10));
  const deliveryDate = payloadDate(payload, "delivery_date", "约定到货日", addDays(contractDate, 7));
  const supplierOrderNo = payloadText(payload, "supplier_order_no", "供应商订单号", false) || `${contractNo}-SUP`;
  const paymentTerms = payloadText(payload, "payment_terms", "付款条款", false) || purchase.payment_terms || "按采购合同约定付款";
  const note =
    payloadText(payload, "note", "合同备注", false) ||
    `采购订单 ${purchase.purchase_no} 已转采购合同并向 ${purchase.supplier_name} 下单。`;
  const createdAt = now();

  database.prepare(`
    INSERT INTO purchase_contracts (
      id, contract_no, purchase_order_id, supplier_id, supplier_order_no,
      contract_date, delivery_date, payment_terms, total_amount, status,
      note, created_by, created_at, supplier_confirmed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'supplier_ordered', ?, ?, ?, ?)
  `).run(
    contractId,
    contractNo,
    purchase.id,
    purchase.supplier_id,
    supplierOrderNo,
    contractDate,
    deliveryDate,
    paymentTerms,
    roundMoney(Number(purchase.total_amount ?? 0)),
    note,
    actorId,
    createdAt,
    createdAt,
  );
  audit(
    database,
    actorId,
    "createPurchaseContract",
    "purchase_contract",
    contractId,
    `采购合同 ${contractNo} 已向供应商下单：${purchase.purchase_no} / ${purchase.supplier_name}`,
  );
}

function createPurchaseArrivalNotice(
  database: Database.Database,
  actorId: string,
  purchaseOrderId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const purchase = database.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).get(purchaseOrderId) as
    | { id: string; purchase_no: string; supplier_id: string; supplier_name: string; status: string }
    | undefined;
  if (!purchase) throw new Error("采购订单不存在。");
  if (purchase.status !== "pending_receipt") throw new Error("采购订单不是待到货状态，不能生成到货通知。");

  const contract = database.prepare(`
    SELECT *
    FROM purchase_contracts
    WHERE purchase_order_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(purchase.id) as { id: string; contract_no: string; status: string } | undefined;
  if (!contract) throw new Error("请先生成采购合同并完成供应商下单。");

  const existing = database.prepare(`
    SELECT id
    FROM purchase_arrival_notices
    WHERE purchase_order_id = ?
      AND status IN ('pending_signoff', 'signed', 'iqc_created')
    LIMIT 1
  `).get(purchase.id) as { id: string } | undefined;
  if (existing) throw new Error("该采购订单已有未关闭的到货通知单。");

  const orderLines = database.prepare(`
    SELECT pol.*, m.name AS material_name, m.unit
    FROM purchase_order_lines pol
    JOIN materials m ON m.id = pol.material_id
    WHERE pol.purchase_order_id = ?
    ORDER BY pol.id
  `).all(purchase.id) as Array<{
    id: string;
    material_id: string;
    material_name: string;
    unit: string;
    qty: number;
    unit_cost: number;
    line_amount: number;
  }>;
  if (orderLines.length === 0) throw new Error("采购订单缺少明细，不能生成到货通知。");

  const arrivedAt = payloadDate(payload, "arrived_at", "到货日期", new Date().toISOString().slice(0, 10));
  const noticeId = uid("PAN");
  const arrivalNo = serial(database, "purchase_arrival_notices", "DH");
  const createdAt = now();
  const lineCount = orderLines.length;
  const totalArrivedQty = roundQty(orderLines.reduce((sum, line) => sum + Number(line.qty ?? 0), 0));
  const totalAmount = roundMoney(orderLines.reduce((sum, line) => sum + Number(line.line_amount ?? 0), 0));
  const note =
    payloadText(payload, "note", "到货说明", false) ||
    `供应商 ${purchase.supplier_name} 按采购合同 ${contract.contract_no} 到货，待仓库签收。`;

  database.prepare(`
    INSERT INTO purchase_arrival_notices (
      id, arrival_no, purchase_order_id, purchase_contract_id, supplier_id,
      status, arrived_at, line_count, total_arrived_qty, total_amount,
      note, created_by, created_at, warehouse_received_by,
      warehouse_received_at, warehouse_note, iqc_id
    )
    VALUES (?, ?, ?, ?, ?, 'pending_signoff', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', NULL)
  `).run(
    noticeId,
    arrivalNo,
    purchase.id,
    contract.id,
    purchase.supplier_id,
    arrivedAt,
    lineCount,
    totalArrivedQty,
    totalAmount,
    note,
    actorId,
    createdAt,
  );

  const insertLine = database.prepare(`
    INSERT INTO purchase_arrival_notice_lines (
      id, arrival_notice_id, purchase_order_line_id, material_id,
      ordered_qty, arrived_qty, unit_cost, line_amount, batch_hint, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  orderLines.forEach((line) => {
    insertLine.run(
      uid("PANL"),
      noticeId,
      line.id,
      line.material_id,
      roundQty(Number(line.qty)),
      roundQty(Number(line.qty)),
      roundMoney(Number(line.unit_cost)),
      roundMoney(Number(line.line_amount)),
      `${arrivalNo}-${line.material_id.replace("M-", "")}`,
      "",
    );
  });
  audit(database, actorId, "createPurchaseArrivalNotice", "purchase_arrival_notice", noticeId, `生成到货通知单 ${arrivalNo}：${purchase.purchase_no}`);
  return { id: noticeId, documentNo: arrivalNo };
}

function registerPurchaseArrivalDiscrepancy(
  database: Database.Database,
  actorId: string,
  arrivalNoticeId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const notice = database.prepare(`
    SELECT pan.*, po.purchase_no, pc.contract_no, s.name AS supplier_name
    FROM purchase_arrival_notices pan
    JOIN purchase_orders po ON po.id = pan.purchase_order_id
    LEFT JOIN purchase_contracts pc ON pc.id = pan.purchase_contract_id
    JOIN suppliers s ON s.id = pan.supplier_id
    WHERE pan.id = ?
  `).get(arrivalNoticeId) as
    | {
        id: string;
        arrival_no: string;
        purchase_order_id: string;
        purchase_contract_id?: string | null;
        supplier_id: string;
        supplier_name: string;
        purchase_no: string;
        contract_no?: string | null;
        status: string;
      }
    | undefined;
  if (!notice) throw new Error("到货通知单不存在。");
  if (notice.status !== "pending_signoff") throw new Error("只有待签收的到货通知单可以登记到货差异。");
  const existing = database.prepare(`
    SELECT id
    FROM purchase_arrival_discrepancies
    WHERE arrival_notice_id = ?
      AND status IN ('pending_approval', 'approved')
    LIMIT 1
  `).get(notice.id) as { id: string } | undefined;
  if (existing) throw new Error("该到货通知单已有未关闭的差异单。");

  const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
  if (rawLines.length === 0) throw new Error("到货差异至少需要一行差异明细。");
  const sourceLines = database.prepare(`
    SELECT panl.*, m.material_code, m.name AS material_name
    FROM purchase_arrival_notice_lines panl
    JOIN materials m ON m.id = panl.material_id
    WHERE panl.arrival_notice_id = ?
  `).all(notice.id) as Array<{
    id: string;
    purchase_order_line_id: string;
    material_id: string;
    material_code: string;
    material_name: string;
    ordered_qty: number;
    arrived_qty: number;
    unit_cost: number;
    line_amount: number;
    batch_hint: string;
  }>;

  const lineDrafts = rawLines.map((rawLine, index) => {
    if (!rawLine || typeof rawLine !== "object") throw new Error(`差异明细第 ${index + 1} 行格式不正确。`);
    const line = rawLine as Record<string, unknown>;
    const sourceLineId = payloadText(line, "arrival_notice_line_id", `第 ${index + 1} 行到货明细`, false);
    const materialId = payloadText(line, "material_id", `第 ${index + 1} 行物料`, false);
    const source =
      sourceLines.find((item) => sourceLineId && item.id === sourceLineId) ??
      sourceLines.find((item) => materialId && item.material_id === materialId);
    if (!source) throw new Error(`差异明细第 ${index + 1} 行未匹配到到货通知明细。`);
    const actualArrivedQty = roundQty(payloadNumber(line, "actual_arrived_qty", `第 ${index + 1} 行实到数量`, { min: 0 }));
    const actualUnitCost =
      payloadText(line, "actual_unit_cost", `第 ${index + 1} 行实际单价`, false) === ""
        ? roundMoney(Number(source.unit_cost))
        : roundMoney(payloadNumber(line, "actual_unit_cost", `第 ${index + 1} 行实际单价`, { min: 0 }));
    const actualBatchHint = payloadText(line, "actual_batch_hint", `第 ${index + 1} 行实际批次`, false) || source.batch_hint;
    const varianceQty = roundQty(actualArrivedQty - Number(source.ordered_qty ?? 0));
    const priceVarianceAmount = roundMoney((actualUnitCost - Number(source.unit_cost ?? 0)) * actualArrivedQty);
    const lineAdjustmentAmount = roundMoney(actualArrivedQty * actualUnitCost - Number(source.ordered_qty ?? 0) * Number(source.unit_cost ?? 0));
    const batchChanged = actualBatchHint !== source.batch_hint;
    if (varianceQty === 0 && priceVarianceAmount === 0 && !batchChanged) {
      throw new Error(`差异明细第 ${index + 1} 行没有数量、价格或批次差异。`);
    }
    return {
      source,
      actualArrivedQty,
      actualUnitCost,
      actualBatchHint,
      varianceQty,
      priceVarianceAmount,
      lineAdjustmentAmount,
      note: payloadText(line, "note", `第 ${index + 1} 行说明`, false),
      hasQuantity: varianceQty !== 0,
      hasPrice: priceVarianceAmount !== 0,
      hasBatch: batchChanged,
    };
  });

  const typeSet = new Set<string>();
  lineDrafts.forEach((line) => {
    if (line.hasQuantity) typeSet.add("quantity");
    if (line.hasPrice) typeSet.add("price");
    if (line.hasBatch) typeSet.add("batch");
  });
  const discrepancyType = typeSet.size === 1 ? Array.from(typeSet)[0] : "mixed";
  const handlingDecision = purchaseArrivalHandlingDecisionValue(
    payloadText(payload, "handling_decision", "处理方式", false) || "supplier_replenish",
  );
  const quantityVarianceQty = roundQty(lineDrafts.reduce((sum, line) => sum + line.varianceQty, 0));
  const priceVarianceAmount = roundMoney(lineDrafts.reduce((sum, line) => sum + line.priceVarianceAmount, 0));
  const totalAdjustmentAmount = roundMoney(lineDrafts.reduce((sum, line) => sum + line.lineAdjustmentAmount, 0));
  const discrepancyId = uid("PAD");
  const discrepancyNo = serial(database, "purchase_arrival_discrepancies", "CY");
  const approvalId = uid("OA");
  const approvalNo = serial(database, "approval_requests", "SP");
  const createdAt = now();
  const reason =
    payloadText(payload, "reason", "差异原因", false) ||
    `${notice.arrival_no} 存在${purchaseArrivalDiscrepancyTypeLabel(discrepancyType)}。`;
  const proposedAction =
    payloadText(payload, "proposed_action", "建议处理", false) ||
    purchaseArrivalHandlingDecisionLabel(handlingDecision);
  const approvalRule = matchApprovalRule(database, "purchase_arrival_discrepancy", Math.abs(totalAdjustmentAmount));

  database.prepare(`
    INSERT INTO approval_requests (
      id, request_no, type, title, applicant_id, status, amount,
      reason, rule_id, approver_role, sla_hours, entity_type, entity_id,
      created_at, decided_by, decided_at, decision_note
    )
    VALUES (?, ?, '采购到货差异', ?, ?, 'pending', ?, ?, ?, ?, ?, 'purchase_arrival_discrepancy', ?, ?, NULL, NULL, NULL)
  `).run(
    approvalId,
    approvalNo,
    `到货差异审批 ${notice.arrival_no}`,
    actorId,
    Math.abs(totalAdjustmentAmount),
    `${reason} 建议处理：${proposedAction}`,
    approvalRule?.id ?? null,
    approvalRule?.approver_role ?? "manager",
    approvalRule?.sla_hours ?? 48,
    discrepancyId,
    createdAt,
  );

  database.prepare(`
    INSERT INTO purchase_arrival_discrepancies (
      id, discrepancy_no, arrival_notice_id, purchase_order_id, purchase_contract_id,
      supplier_id, approval_request_id, discrepancy_type, handling_decision, status,
      line_count, quantity_variance_qty, price_variance_amount, total_adjustment_amount,
      reason, proposed_action, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    discrepancyId,
    discrepancyNo,
    notice.id,
    notice.purchase_order_id,
    notice.purchase_contract_id ?? null,
    notice.supplier_id,
    approvalId,
    discrepancyType,
    handlingDecision,
    lineDrafts.length,
    quantityVarianceQty,
    priceVarianceAmount,
    totalAdjustmentAmount,
    reason,
    proposedAction,
    actorId,
    createdAt,
  );

  const insertLine = database.prepare(`
    INSERT INTO purchase_arrival_discrepancy_lines (
      id, discrepancy_id, arrival_notice_line_id, purchase_order_line_id, material_id,
      ordered_qty, actual_arrived_qty, variance_qty, ordered_unit_cost, actual_unit_cost,
      price_variance_amount, expected_batch_hint, actual_batch_hint, line_adjustment_amount, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateLine = database.prepare(`
    UPDATE purchase_arrival_notice_lines
    SET arrived_qty = ?,
        unit_cost = ?,
        line_amount = ?,
        batch_hint = ?,
        note = ?
    WHERE id = ?
  `);
  lineDrafts.forEach((line) => {
    insertLine.run(
      uid("PADL"),
      discrepancyId,
      line.source.id,
      line.source.purchase_order_line_id,
      line.source.material_id,
      line.source.ordered_qty,
      line.actualArrivedQty,
      line.varianceQty,
      line.source.unit_cost,
      line.actualUnitCost,
      line.priceVarianceAmount,
      line.source.batch_hint,
      line.actualBatchHint,
      line.lineAdjustmentAmount,
      line.note,
    );
    updateLine.run(
      line.actualArrivedQty,
      line.actualUnitCost,
      roundMoney(line.actualArrivedQty * line.actualUnitCost),
      line.actualBatchHint,
      line.note,
      line.source.id,
    );
  });
  refreshPurchaseArrivalNoticeTotals(database, notice.id);
  database.prepare("UPDATE purchase_arrival_notices SET status = 'discrepancy_pending' WHERE id = ?").run(notice.id);
  audit(database, actorId, "registerPurchaseArrivalDiscrepancy", "purchase_arrival_discrepancy", discrepancyId, `登记到货差异 ${discrepancyNo}：${notice.arrival_no}`);
  evaluateSupplierAdmissionRules(database, actorId, notice.supplier_id, {
    source_type: "purchase_arrival_discrepancy",
    source_id: discrepancyId,
  });
  breachSupplierObservationPeriod(
    database,
    actorId,
    notice.supplier_id,
    "purchase_arrival_discrepancy",
    discrepancyId,
    `恢复采购观察期内发生到货差异 ${discrepancyNo}，暂停新增采购并要求重新整改复评。`,
  );
}

function resolvePurchaseArrivalDiscrepancy(
  database: Database.Database,
  actorId: string,
  discrepancyId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const discrepancy = database.prepare("SELECT * FROM purchase_arrival_discrepancies WHERE id = ?").get(discrepancyId) as
    | {
        id: string;
        discrepancy_no: string;
        arrival_notice_id: string;
        status: string;
        handling_decision: string;
      }
    | undefined;
  if (!discrepancy) throw new Error("到货差异单不存在。");
  if (discrepancy.status !== "approved") throw new Error("到货差异单需审批通过后才能处理。");
  const resolutionResult = purchaseArrivalHandlingDecisionValue(
    payloadText(payload, "resolution_result", "处理结果", false) || discrepancy.handling_decision,
  );
  const resolutionNote = payloadText(payload, "resolution_note", "处理说明", false) || purchaseArrivalHandlingDecisionLabel(resolutionResult);
  const resolvedAt = now();
  database.prepare(`
    UPDATE purchase_arrival_discrepancies
    SET status = 'resolved',
        resolved_by = ?,
        resolved_at = ?,
        resolution_result = ?,
        resolution_note = ?
    WHERE id = ?
  `).run(actorId, resolvedAt, resolutionResult, resolutionNote, discrepancy.id);
  refreshPurchaseArrivalNoticeTotals(database, discrepancy.arrival_notice_id);
  const pendingCount = (database.prepare(`
    SELECT COUNT(*) AS count
    FROM purchase_arrival_discrepancies
    WHERE arrival_notice_id = ?
      AND status IN ('pending_approval', 'approved')
  `).get(discrepancy.arrival_notice_id) as { count: number }).count;
  database
    .prepare("UPDATE purchase_arrival_notices SET status = ? WHERE id = ?")
    .run(pendingCount > 0 ? "discrepancy_pending" : "pending_signoff", discrepancy.arrival_notice_id);
  audit(database, actorId, "resolvePurchaseArrivalDiscrepancy", "purchase_arrival_discrepancy", discrepancy.id, `处理到货差异 ${discrepancy.discrepancy_no}：${resolutionNote}`);
}

function refreshPurchaseArrivalNoticeTotals(database: Database.Database, arrivalNoticeId: string) {
  const totals = database.prepare(`
    SELECT COUNT(*) AS line_count,
           COALESCE(SUM(arrived_qty), 0) AS total_arrived_qty,
           COALESCE(SUM(line_amount), 0) AS total_amount
    FROM purchase_arrival_notice_lines
    WHERE arrival_notice_id = ?
  `).get(arrivalNoticeId) as { line_count: number; total_arrived_qty: number; total_amount: number };
  database.prepare(`
    UPDATE purchase_arrival_notices
    SET line_count = ?,
        total_arrived_qty = ?,
        total_amount = ?
    WHERE id = ?
  `).run(
    Number(totals.line_count ?? 0),
    roundQty(Number(totals.total_arrived_qty ?? 0)),
    roundMoney(Number(totals.total_amount ?? 0)),
    arrivalNoticeId,
  );
}

function signPurchaseArrivalNotice(
  database: Database.Database,
  actorId: string,
  arrivalNoticeId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const notice = database.prepare(`
    SELECT pan.*, po.purchase_no
    FROM purchase_arrival_notices pan
    JOIN purchase_orders po ON po.id = pan.purchase_order_id
    WHERE pan.id = ?
  `).get(arrivalNoticeId) as
    | { id: string; arrival_no: string; purchase_no: string; status: string; arrived_at: string }
      | undefined;
  if (!notice) throw new Error("到货通知单不存在。");
  if (["discrepancy_pending", "discrepancy_approved"].includes(notice.status)) {
    throw new Error("到货差异尚未处理完成，不能仓库签收。");
  }
  if (notice.status !== "pending_signoff") throw new Error("到货通知单不是待仓库签收状态。");

  const receivedAt = payloadDate(payload, "warehouse_received_at", "仓库签收日期", String(notice.arrived_at).slice(0, 10));
  const warehouseNote =
    payloadText(payload, "warehouse_note", "仓库签收说明", false) || "仓库已核对到货外包装、数量和采购单号，允许提交 IQC 来料检验。";
  database.prepare(`
    UPDATE purchase_arrival_notices
    SET status = 'signed',
        warehouse_received_by = ?,
        warehouse_received_at = ?,
        warehouse_note = ?
    WHERE id = ?
  `).run(actorId, `${receivedAt}T00:00:00.000Z`, warehouseNote, notice.id);
  audit(database, actorId, "signPurchaseArrivalNotice", "purchase_arrival_notice", notice.id, `仓库签收到货通知单 ${notice.arrival_no}`);
}

function createMaterialIqcInspection(
  database: Database.Database,
  actorId: string,
  purchaseOrderId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const purchase = database.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(purchaseOrderId) as
    | { id: string; purchase_no: string; supplier_id: string; status: string }
    | undefined;
  if (purchase?.status === "pending_approval") throw new Error("采购单尚未审批通过，不能发起 IQC。");
  if (purchase?.status === "rejected") throw new Error("采购单已被驳回，不能发起 IQC。");
  if (!purchase || purchase.status !== "pending_receipt") throw new Error("采购单不是待到货请检状态。");
  const arrivalNoticeId = payloadText(payload, "arrival_notice_id", "到货通知单", false);
  const arrivalNotice = arrivalNoticeId
    ? (database.prepare(`
        SELECT *
        FROM purchase_arrival_notices
        WHERE id = ?
      `).get(arrivalNoticeId) as
        | {
            id: string;
            arrival_no: string;
            purchase_order_id: string;
            status: string;
            arrived_at: string;
          }
        | undefined)
    : undefined;
  if (arrivalNoticeId && !arrivalNotice) throw new Error("到货通知单不存在。");
  if (arrivalNotice && arrivalNotice.purchase_order_id !== purchase.id) throw new Error("到货通知单与采购订单不匹配。");
  if (arrivalNotice && arrivalNotice.status !== "signed") throw new Error("到货通知单必须先由仓库签收，才能提交 IQC。");
  const existing = database.prepare(`
    SELECT id
    FROM material_iqc_inspections
    WHERE purchase_order_id = ? AND status IN ('pending', 'accepted')
    LIMIT 1
  `).get(purchase.id) as { id: string } | undefined;
  if (existing) throw new Error("采购单已生成 IQC 检验单。");

  const lines = arrivalNotice
    ? (database.prepare(`
        SELECT panl.purchase_order_line_id AS id,
               panl.material_id,
               panl.arrived_qty AS qty,
               panl.unit_cost,
               panl.line_amount,
               m.name AS material_name,
               m.unit
        FROM purchase_arrival_notice_lines panl
        JOIN materials m ON m.id = panl.material_id
        WHERE panl.arrival_notice_id = ?
        ORDER BY panl.id
      `).all(arrivalNotice.id) as Array<{
        id: string;
        material_id: string;
        material_name: string;
        unit: string;
        qty: number;
        unit_cost: number;
        line_amount: number;
      }>)
    : (database.prepare(`
        SELECT pol.*, m.name AS material_name, m.unit
        FROM purchase_order_lines pol
        JOIN materials m ON m.id = pol.material_id
        WHERE pol.purchase_order_id = ?
      `).all(purchase.id) as Array<{
    id: string;
    material_id: string;
    material_name: string;
    unit: string;
    qty: number;
    unit_cost: number;
    line_amount: number;
  }>);
  if (lines.length === 0) throw new Error("采购单缺少明细，不能发起 IQC。");

  const arrivedAt = arrivalNotice
    ? String(arrivalNotice.arrived_at).slice(0, 10)
    : payloadDate(payload, "arrived_at", "到货日期", new Date().toISOString().slice(0, 10));
  const iqcId = uid("IQC");
  const iqcNo = serial(database, "material_iqc_inspections", "IQC");
  const createdAt = now();
  database.prepare(`
    INSERT INTO material_iqc_inspections (
      id, iqc_no, purchase_order_id, supplier_id, status, result,
      arrival_no, arrived_at, due_at, note, created_by, created_at,
      inspected_by, inspected_at, inspection_standard, measurements,
      disposition_note, discount_rate, accepted_amount
    )
    VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, '', '', '', 0, 0)
  `).run(
    iqcId,
    iqcNo,
    purchase.id,
    purchase.supplier_id,
    arrivalNotice?.arrival_no ?? payloadText(payload, "arrival_no", "到货通知单号", false),
    arrivedAt,
    addDays(arrivedAt, 3),
    payloadText(payload, "note", "请检说明", false),
    actorId,
    createdAt,
  );

  const insertLine = database.prepare(`
    INSERT INTO material_iqc_lines (
      id, iqc_id, purchase_order_line_id, material_id, ordered_qty, received_qty,
      accepted_qty, rejected_qty, unit_cost, accepted_unit_cost, line_amount, batch_no, note
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, '', '')
  `);
  lines.forEach((line) => {
    insertLine.run(uid("IQL"), iqcId, line.id, line.material_id, line.qty, line.qty, line.unit_cost, line.unit_cost);
  });
  if (arrivalNotice) {
    database.prepare(`
      UPDATE purchase_arrival_notices
      SET status = 'iqc_created',
          iqc_id = ?
      WHERE id = ?
    `).run(iqcId, arrivalNotice.id);
  }
  database.prepare("UPDATE purchase_orders SET status = 'iqc_pending' WHERE id = ?").run(purchase.id);
  audit(database, actorId, "createMaterialIqcInspection", "material_iqc_inspection", iqcId, `采购到货请检 ${iqcNo}：${purchase.purchase_no}`);
}

function completeMaterialIqcInspection(
  database: Database.Database,
  actorId: string,
  iqcId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const iqc = database.prepare("SELECT * FROM material_iqc_inspections WHERE id = ?").get(iqcId) as
    | {
        id: string;
        iqc_no: string;
        purchase_order_id: string;
        supplier_id: string;
        status: string;
      }
    | undefined;
  if (!iqc || iqc.status !== "pending") throw new Error("IQC 检验单不是待检状态。");
  const purchase = database.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(iqc.purchase_order_id) as
    | { id: string; purchase_no: string; due_date: string; status: string }
    | undefined;
  if (!purchase || purchase.status !== "iqc_pending") throw new Error("采购单不是 IQC 待判定状态。");

  const result = materialIqcResultValue(payloadText(payload, "result", "IQC 判定结果"));
  const inspectedAt = payloadDate(payload, "inspected_at", "检验日期", new Date().toISOString().slice(0, 10));
  const discountRate = result === "discount_accept" ? roundMoney(payloadNumber(payload, "discount_rate", "降价比例", { min: 0 })) : 0;
  if (discountRate >= 1) throw new Error("降价比例必须小于 1。");
  const measurements = payloadText(payload, "measurements", "实测记录", false);
  const inspectionStandard =
    payloadText(payload, "inspection_standard", "检验标准", false) || "原材料来料检验规范 IQC-2026-01";
  const dispositionNote =
    payloadText(payload, "disposition_note", "处置意见", false) ||
    (materialIqcAllowsInbound(result) ? "IQC 放行，允许办理原材料入库。" : "IQC 不合格，整批退货，不进入库存。");

  const lines = database.prepare(`
    SELECT iqcl.*, m.name AS material_name, m.stock_qty, m.average_cost
    FROM material_iqc_lines iqcl
    JOIN materials m ON m.id = iqcl.material_id
    WHERE iqcl.iqc_id = ?
    ORDER BY iqcl.id
  `).all(iqc.id) as Array<{
    id: string;
    material_id: string;
    material_name: string;
    received_qty: number;
    unit_cost: number;
    stock_qty: number;
    average_cost: number;
  }>;

  if (!materialIqcAllowsInbound(result)) {
    lines.forEach((line) => {
      database.prepare(`
        UPDATE material_iqc_lines
        SET accepted_qty = 0,
            rejected_qty = ?,
            accepted_unit_cost = 0,
            line_amount = 0,
            note = ?
        WHERE id = ?
      `).run(line.received_qty, dispositionNote, line.id);
    });
    database.prepare(`
      UPDATE material_iqc_inspections
      SET status = 'rejected',
          result = ?,
          inspected_by = ?,
          inspected_at = ?,
          inspection_standard = ?,
          measurements = ?,
          disposition_note = ?,
          discount_rate = 0,
          accepted_amount = 0
      WHERE id = ?
    `).run(result, actorId, inspectedAt, inspectionStandard, measurements, dispositionNote, iqc.id);
    database.prepare("UPDATE purchase_orders SET status = 'iqc_rejected' WHERE id = ?").run(purchase.id);
    database.prepare("UPDATE purchase_arrival_notices SET status = 'rejected' WHERE iqc_id = ?").run(iqc.id);
    audit(database, actorId, "completeMaterialIqcInspection", "material_iqc_inspection", iqc.id, `IQC 判定 ${iqc.iqc_no}：${materialIqcResultLabel(result)}`);
    evaluateSupplierAdmissionRules(database, actorId, iqc.supplier_id, {
      source_type: "material_iqc_inspection",
      source_id: iqc.id,
    });
    breachSupplierObservationPeriod(
      database,
      actorId,
      iqc.supplier_id,
      "material_iqc_inspection",
      iqc.id,
      `恢复采购观察期内 IQC 判定为${materialIqcResultLabel(result)}，暂停新增采购并要求重新整改复评。`,
    );
    return;
  }

  const movementAt = new Date(`${inspectedAt}T00:00:00.000Z`).toISOString();
  let acceptedAmount = 0;
  for (const line of lines) {
    const acceptedUnitCost = roundMoney(line.unit_cost * (1 - discountRate));
    const lineAmount = roundMoney(line.received_qty * acceptedUnitCost);
    acceptedAmount = roundMoney(acceptedAmount + lineAmount);
    const next = calculateMovingAverage({
      currentQty: line.stock_qty,
      currentAverageCost: line.average_cost,
      incomingQty: line.received_qty,
      incomingUnitCost: acceptedUnitCost,
    });
    const batchNo = `${iqc.iqc_no}-${line.material_id.replace("M-", "")}`;
    database.prepare("UPDATE materials SET stock_qty = ?, average_cost = ?, last_movement_at = ? WHERE id = ?").run(
      next.nextQty,
      next.nextAverageCost,
      movementAt,
      line.material_id,
    );
    database.prepare(`
      INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at, last_movement_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uid("B"), line.material_id, batchNo, line.received_qty, acceptedUnitCost, movementAt, movementAt);
    database.prepare(`
      INSERT INTO inventory_movements (
        id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
      )
      VALUES (?, 'material', ?, ?, ?, ?, 'purchase_inbound', 'material_iqc_inspection', ?, ?)
    `).run(uid("MV"), line.material_id, batchNo, line.received_qty, acceptedUnitCost, iqc.id, movementAt);
    database.prepare(`
      UPDATE material_iqc_lines
      SET accepted_qty = ?,
          rejected_qty = 0,
          accepted_unit_cost = ?,
          line_amount = ?,
          batch_no = ?,
          note = ?
      WHERE id = ?
    `).run(line.received_qty, acceptedUnitCost, lineAmount, batchNo, dispositionNote, line.id);
  }

  database.prepare(`
    UPDATE material_iqc_inspections
    SET status = 'accepted',
        result = ?,
        inspected_by = ?,
        inspected_at = ?,
        inspection_standard = ?,
        measurements = ?,
        disposition_note = ?,
        discount_rate = ?,
        accepted_amount = ?
    WHERE id = ?
  `).run(result, actorId, inspectedAt, inspectionStandard, measurements, dispositionNote, discountRate, acceptedAmount, iqc.id);
  database.prepare("UPDATE purchase_orders SET status = 'received', total_amount = ?, received_at = ? WHERE id = ?").run(
    acceptedAmount,
    movementAt,
    purchase.id,
  );
  database.prepare("UPDATE purchase_arrival_notices SET status = 'inbounded' WHERE iqc_id = ?").run(iqc.id);
  const payableId = uid("AP");
  const payableNo = serial(database, "payables", "YF");
  database.prepare(`
    INSERT INTO payables (
      id, payable_no, supplier_id, purchase_order_id, total_amount, paid_amount,
      balance_amount, status, due_date, created_at, settled_at
    )
    VALUES (?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, NULL)
  `).run(payableId, payableNo, iqc.supplier_id, purchase.id, acceptedAmount, acceptedAmount, purchase.due_date, movementAt);
  audit(database, actorId, "completeMaterialIqcInspection", "material_iqc_inspection", iqc.id, `IQC 判定 ${iqc.iqc_no}：${materialIqcResultLabel(result)}，生成应付 ${payableNo}`);
  closeSupplierObservationBatch(
    database,
    actorId,
    iqc.supplier_id,
    "material_iqc_inspection",
    iqc.id,
    `首批采购 IQC 合格并完成入库，供应商恢复采购观察期自动结案。`,
  );
  evaluateSupplierAdmissionRules(database, actorId, iqc.supplier_id, {
    source_type: "material_iqc_inspection",
    source_id: iqc.id,
  });
}

function receivePurchaseOrder(database: Database.Database, actorId: string, purchaseOrderId: string) {
  const purchase = database.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(purchaseOrderId) as
    | { id: string; purchase_no: string; supplier_id: string; status: string; total_amount: number; due_date: string }
    | undefined;
  if (purchase?.status === "pending_approval") throw new Error("采购单尚未审批通过，不能办理入库。");
  if (purchase?.status === "rejected") throw new Error("采购单已被驳回，不能办理入库。");
  if (!purchase || purchase.status !== "pending_receipt") throw new Error("采购单不是待入库状态。");

  const lines = database.prepare(`
    SELECT pol.*, m.name AS material_name, m.stock_qty, m.average_cost
    FROM purchase_order_lines pol
    JOIN materials m ON m.id = pol.material_id
    WHERE pol.purchase_order_id = ?
  `).all(purchase.id) as Array<{
    material_id: string;
    material_name: string;
    qty: number;
    unit_cost: number;
    stock_qty: number;
    average_cost: number;
  }>;

  const movementAt = now();
  for (const line of lines) {
    const next = calculateMovingAverage({
      currentQty: line.stock_qty,
      currentAverageCost: line.average_cost,
      incomingQty: line.qty,
      incomingUnitCost: line.unit_cost,
    });
    const batchId = uid("B");
    const batchNo = `CG-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${line.material_id.replace("M-", "")}`;
    database.prepare("UPDATE materials SET stock_qty = ?, average_cost = ?, last_movement_at = ? WHERE id = ?").run(
      next.nextQty,
      next.nextAverageCost,
      movementAt,
      line.material_id,
    );
    database.prepare(`
      INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at, last_movement_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, line.material_id, batchNo, line.qty, line.unit_cost, movementAt, movementAt);
    database.prepare(`
      INSERT INTO inventory_movements (
        id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
      )
      VALUES (?, 'material', ?, ?, ?, ?, 'purchase_inbound', 'purchase_order', ?, ?)
    `).run(uid("MV"), line.material_id, batchNo, line.qty, line.unit_cost, purchase.id, movementAt);
  }

  database.prepare("UPDATE purchase_orders SET status = 'received', received_at = ? WHERE id = ?").run(movementAt, purchase.id);
  const payableId = uid("AP");
  const payableNo = serial(database, "payables", "YF");
  database.prepare(`
    INSERT INTO payables (
      id, payable_no, supplier_id, purchase_order_id, total_amount, paid_amount,
      balance_amount, status, due_date, created_at, settled_at
    )
    VALUES (?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, NULL)
  `).run(payableId, payableNo, purchase.supplier_id, purchase.id, purchase.total_amount, purchase.total_amount, purchase.due_date, movementAt);
  audit(database, actorId, "receivePurchaseOrder", "purchase_order", purchase.id, `采购入库 ${purchase.purchase_no}，生成应付 ${payableNo}`);
}

function recordPayablePayment(
  database: Database.Database,
  actorId: string,
  payableId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const payable = database.prepare("SELECT * FROM payables WHERE id = ?").get(payableId) as
    | { id: string; payable_no: string; total_amount: number; paid_amount: number; balance_amount: number; status: string }
    | undefined;
  if (!payable || payable.status === "paid") throw new Error("应付账款不存在或已结清。");
  const amount = roundMoney(payloadPositiveNumber(payload, "amount", "付款金额", payable.balance_amount));
  if (amount > payable.balance_amount) throw new Error("付款金额不能大于应付余额。");
  const method = payloadText(payload, "method", "付款方式", false) || "银行转账";
  const note = payloadText(payload, "note", "备注", false) || "登记付款";
  const paidAt = payloadDate(payload, "paid_at", "付款日期", new Date().toISOString().slice(0, 10));
  const paidAmount = roundMoney(payable.paid_amount + amount);
  const balanceAmount = calculateBalance({ totalAmount: payable.total_amount, settledAmount: paidAmount });
  const status = calculateLedgerStatus({ totalAmount: payable.total_amount, settledAmount: paidAmount });
  database.prepare(`
    INSERT INTO payable_payments (id, payable_id, amount, method, note, paid_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uid("APP"), payable.id, amount, method, note, paidAt);
  database.prepare(`
    UPDATE payables
    SET paid_amount = ?, balance_amount = ?, status = ?, settled_at = ?
    WHERE id = ?
  `).run(paidAmount, balanceAmount, status, status === "paid" ? now() : null, payable.id);
  audit(database, actorId, "recordPayablePayment", "payable", payable.id, `登记付款 ${payable.payable_no}：${amount}`);
}

function recordReceivableReceipt(
  database: Database.Database,
  actorId: string,
  receivableId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const receivable = database.prepare("SELECT * FROM receivables WHERE id = ?").get(receivableId) as
    | {
        id: string;
        receivable_no: string;
        shipment_id?: string | null;
        total_amount: number;
        received_amount: number;
        balance_amount: number;
        status: string;
      }
    | undefined;
  if (!receivable || receivable.status === "paid") throw new Error("应收账款不存在或已结清。");
  const fallbackAmount = receivable.received_amount > 0 ? receivable.balance_amount : receivable.total_amount * 0.5;
  const amount = roundMoney(payloadPositiveNumber(payload, "amount", "回款金额", Math.min(receivable.balance_amount, fallbackAmount)));
  if (amount > receivable.balance_amount) throw new Error("回款金额不能大于应收余额。");
  const method = payloadText(payload, "method", "回款方式", false) || "银行回款";
  const note = payloadText(payload, "note", "备注", false) || "登记回款";
  const receivedAt = payloadDate(payload, "received_at", "回款日期", new Date().toISOString().slice(0, 10));
  const receivedAmount = roundMoney(receivable.received_amount + amount);
  const balanceAmount = calculateBalance({ totalAmount: receivable.total_amount, settledAmount: receivedAmount });
  const status = calculateLedgerStatus({ totalAmount: receivable.total_amount, settledAmount: receivedAmount });
  database.prepare(`
    INSERT INTO receivable_receipts (id, receivable_id, amount, method, note, received_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uid("ARR"), receivable.id, amount, method, note, receivedAt);
  database.prepare(`
    UPDATE receivables
    SET received_amount = ?, balance_amount = ?, status = ?, settled_at = ?
    WHERE id = ?
  `).run(receivedAmount, balanceAmount, status, status === "paid" ? receivedAt : null, receivable.id);
  if (receivable.shipment_id) {
    database.prepare("UPDATE shipments SET financial_status = ? WHERE id = ?").run(status, receivable.shipment_id);
  }
  audit(database, actorId, "recordReceivableReceipt", "receivable", receivable.id, `登记回款 ${receivable.receivable_no}：${amount}`);
}

function purchaseInbound(database: Database.Database, actorId: string, materialId: string) {
  const material = database.prepare("SELECT * FROM materials WHERE id = ?").get(materialId) as
    | { id: string; name: string; stock_qty: number; average_cost: number }
    | undefined;
  if (!material) throw new Error("物料不存在。");
  const incomingQty = 20;
  const incomingUnitCost = 15.8;
  const next = calculateMovingAverage({
    currentQty: material.stock_qty,
    currentAverageCost: material.average_cost,
    incomingQty,
    incomingUnitCost,
  });
  const movementAt = now();
  const batchId = uid("B");
  const batchNo = `CG-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  database.prepare("UPDATE materials SET stock_qty = ?, average_cost = ?, last_movement_at = ? WHERE id = ?").run(
    next.nextQty,
    next.nextAverageCost,
    movementAt,
    material.id,
  );
  database.prepare(`
    INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at, last_movement_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(batchId, material.id, batchNo, incomingQty, incomingUnitCost, movementAt, movementAt);
  database.prepare(`
    INSERT INTO inventory_movements (
      id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
    )
    VALUES (?, 'material', ?, ?, ?, ?, 'purchase_inbound', 'purchase', ?, ?)
  `).run(uid("MV"), material.id, batchNo, incomingQty, incomingUnitCost, batchId, movementAt);
  audit(database, actorId, "purchaseInbound", "material", material.id, `${material.name} 采购入库，移动均价更新为 ${next.nextAverageCost}`);
}

function submitApproval(database: Database.Database, actorId: string, rawPayload?: Record<string, unknown>) {
  const user = getUser(database, actorId);
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const approvalId = uid("OA");
  const approvalNo = serial(database, "approval_requests", "SP");
  const amount =
    payload.amount == null || payload.amount === ""
      ? user.role === "purchasing"
        ? 1680
        : 820
      : roundMoney(payloadNumber(payload, "amount", "审批金额", { min: 0 }));
  const title =
    payloadText(payload, "title", "审批标题", false) || (user.role === "purchasing" ? "原材料紧急补货审批" : "办公费用审批");
  const type = payloadText(payload, "type", "审批类型", false) || (user.role === "purchasing" ? "采购特采" : "办公 OA");
  const reason =
    payloadText(payload, "reason", "审批事由", false) ||
    (user.role === "purchasing"
      ? "采购录入价格后，库存预警触发紧急补货，需要管理层授权。"
      : "部门日常办公事项，提交系统审批并保留流转痕迹。");
  const approvalRule = matchApprovalRule(database, "office_oa", amount);

  database.prepare(`
    INSERT INTO approval_requests (
      id, request_no, type, title, applicant_id, status, amount,
      reason, rule_id, approver_role, sla_hours, created_at, decided_by, decided_at, decision_note
    )
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
  `).run(
    approvalId,
    approvalNo,
    type,
    title,
    user.id,
    amount,
    reason,
    approvalRule?.id ?? null,
    approvalRule?.approver_role ?? "manager",
    approvalRule?.sla_hours ?? 48,
    now(),
  );
  audit(database, actorId, "submitApproval", "approval", approvalId, `发起审批 ${approvalNo}：${title}`);
}

function decideApproval(
  database: Database.Database,
  actorId: string,
  approvalId: string,
  status: "approved" | "rejected",
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const approval = database.prepare("SELECT * FROM approval_requests WHERE id = ?").get(approvalId) as
    | {
        id: string;
        request_no: string;
        title: string;
        status: string;
        entity_type?: string;
        entity_id?: string;
        approver_role?: Role;
      }
    | undefined;
  if (!approval || approval.status !== "pending") throw new Error("审批单不存在或不是待审批状态。");
  const actor = getUser(database, actorId);
  if (approval.approver_role && actor.role !== approval.approver_role && actor.role !== "admin") {
    throw new Error(`${actor.role_label} 不是该审批规则指定的审批角色。`);
  }
  const note =
    payloadText(payload, "approval_note", "审批意见", false) ||
    (status === "approved" ? "同意，按系统流程继续执行。" : "驳回，请补充依据后重新提交。");
  const decidedAt = now();
  database.prepare(`
    UPDATE approval_requests
    SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?
    WHERE id = ?
  `).run(status, actorId, decidedAt, note, approval.id);
  if (approval.entity_type === "purchase_order" && approval.entity_id) {
    database
      .prepare("UPDATE purchase_orders SET status = ? WHERE id = ? AND status = 'pending_approval'")
      .run(status === "approved" ? "pending_receipt" : "rejected", approval.entity_id);
    audit(
      database,
      actorId,
      status === "approved" ? "approvePurchaseOrder" : "rejectPurchaseOrder",
      "purchase_order",
      approval.entity_id,
      `${status === "approved" ? "同意" : "驳回"}采购审批 ${approval.request_no}`,
    );
  }
  if (approval.entity_type === "purchase_requisition" && approval.entity_id) {
    database
      .prepare(`
        UPDATE purchase_requisitions
        SET status = ?,
            approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
            approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
            approval_note = ?
        WHERE id = ? AND status = 'pending_approval'
      `)
      .run(status === "approved" ? "approved" : "rejected", status, actorId, status, decidedAt, note, approval.entity_id);
    audit(
      database,
      actorId,
      status === "approved" ? "approvePurchaseRequisition" : "rejectPurchaseRequisition",
      "purchase_requisition",
      approval.entity_id,
      `${status === "approved" ? "同意" : "驳回"}采购申请审批 ${approval.request_no}`,
    );
  }
  if (approval.entity_type === "purchase_arrival_discrepancy" && approval.entity_id) {
    const discrepancy = database
      .prepare("SELECT * FROM purchase_arrival_discrepancies WHERE id = ?")
      .get(approval.entity_id) as { id: string; discrepancy_no: string; arrival_notice_id: string; status: string } | undefined;
    if (discrepancy && discrepancy.status === "pending_approval") {
      database.prepare(`
        UPDATE purchase_arrival_discrepancies
        SET status = ?,
            approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
            approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
            approval_note = ?
        WHERE id = ?
      `).run(status === "approved" ? "approved" : "rejected", status, actorId, status, decidedAt, note, discrepancy.id);
      database
        .prepare("UPDATE purchase_arrival_notices SET status = ? WHERE id = ?")
        .run(status === "approved" ? "discrepancy_approved" : "pending_signoff", discrepancy.arrival_notice_id);
      audit(
        database,
        actorId,
        status === "approved" ? "approvePurchaseArrivalDiscrepancy" : "rejectPurchaseArrivalDiscrepancy",
        "purchase_arrival_discrepancy",
        discrepancy.id,
        `${status === "approved" ? "同意" : "驳回"}到货差异审批 ${approval.request_no}`,
      );
    }
  }
  if (approval.entity_type === "production_plan" && approval.entity_id) {
    decideProductionPlanApproval(database, actorId, approval.entity_id, status, note, decidedAt);
  }
  if (approval.entity_type === "production_cost_adjustment" && approval.entity_id) {
    if (status === "approved") {
      applyProductionCostAdjustment(database, approval.entity_id, actorId, decidedAt);
    } else {
      database.prepare(`
        UPDATE production_cost_adjustments
        SET status = 'rejected',
            adjustment_note = CASE
              WHEN adjustment_note = '' THEN ?
              ELSE adjustment_note || '；审批驳回：' || ?
            END
        WHERE id = ? AND status = 'pending_approval'
      `).run(note, note, approval.entity_id);
      audit(
        database,
        actorId,
        "rejectProductionCostAdjustment",
        "production_cost_adjustment",
        approval.entity_id,
        `驳回工单成本调整审批 ${approval.request_no}`,
      );
    }
  }
  if (approval.entity_type === "supplier_admission_rule_change" && approval.entity_id) {
    decideSupplierAdmissionRuleChange(database, actorId, approval.entity_id, status, note, decidedAt);
  }
  if (approval.entity_type === "supplier_annual_review" && approval.entity_id) {
    decideSupplierAnnualReviewApproval(database, actorId, approval.entity_id, status, note, decidedAt);
  }
  audit(database, actorId, status === "approved" ? "approveApproval" : "rejectApproval", "approval", approval.id, `${status === "approved" ? "同意" : "驳回"}审批 ${approval.request_no}`);
}

function approvalRulePayload(rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const ruleName = payloadText(payload, "rule_name", "规则名称");
  const sourceType = approvalSourceTypeValue(payloadText(payload, "source_type", "适用来源"));
  const minAmount = roundMoney(payloadNumber(payload, "min_amount", "起始金额", { min: 0 }));
  const rawMaxAmount = payloadText(payload, "max_amount", "截止金额", false);
  const maxAmount = rawMaxAmount ? roundMoney(payloadNumber(payload, "max_amount", "截止金额", { min: 0 })) : null;
  if (maxAmount != null && maxAmount < minAmount) throw new Error("截止金额不能小于起始金额。");
  const approverRole = payloadText(payload, "approver_role", "审批角色") as Role;
  if (!["manager", "warehouse", "finance", "admin", "purchasing"].includes(approverRole)) {
    throw new Error("审批角色不正确。");
  }
  const slaHours = Math.round(payloadNumber(payload, "sla_hours", "处理时限", { min: 1 }));
  const status = payloadText(payload, "status", "状态", false) || "active";
  if (!["active", "inactive"].includes(status)) throw new Error("规则状态不正确。");
  const conditionScope =
    sourceType === "production_cost_adjustment"
      ? payloadText(payload, "condition_scope", "适用条件", false) || "all"
      : "all";
  if (!["all", "material", "adjustment_type", "material_and_adjustment_type"].includes(conditionScope)) {
    throw new Error("适用条件不正确。");
  }
  const rawMaterialId = payloadText(payload, "material_id", "适用物料", false);
  const materialId = sourceType === "production_cost_adjustment" && ["material", "material_and_adjustment_type"].includes(conditionScope) ? rawMaterialId : "";
  if (["material", "material_and_adjustment_type"].includes(conditionScope) && !materialId) {
    throw new Error("物料类成本调整审批规则必须选择适用物料。");
  }
  const rawAdjustmentType = payloadText(payload, "adjustment_type", "补退料场景", false);
  const adjustmentType =
    sourceType === "production_cost_adjustment" && ["adjustment_type", "material_and_adjustment_type"].includes(conditionScope)
      ? rawAdjustmentType
      : "";
  if (["adjustment_type", "material_and_adjustment_type"].includes(conditionScope) && !["supplement", "return", "check"].includes(adjustmentType)) {
    throw new Error("补退料场景不正确。");
  }
  const riskLevel = sourceType === "production_cost_adjustment" ? payloadText(payload, "risk_level", "风险等级", false) || "normal" : "normal";
  if (!["low", "normal", "medium", "high", "critical"].includes(riskLevel)) throw new Error("风险等级不正确。");
  const allowReversal = sourceType === "production_cost_adjustment" ? (booleanPayload(payload, "allow_reversal", true) ? 1 : 0) : 1;
  const reversalApproverRole =
    sourceType === "production_cost_adjustment"
      ? (payloadText(payload, "reversal_approver_role", "红冲复核角色", false) as Role) || "manager"
      : "manager";
  if (!["manager", "warehouse", "finance", "admin", "purchasing"].includes(reversalApproverRole)) {
    throw new Error("红冲复核角色不正确。");
  }
  return {
    ruleName,
    sourceType,
    minAmount,
    maxAmount,
    approverRole,
    slaHours,
    status,
    conditionScope,
    materialId,
    adjustmentType,
    riskLevel,
    allowReversal,
    reversalApproverRole,
    description: payloadText(payload, "description", "规则说明", false),
    ruleCode: payloadText(payload, "rule_code", "规则编码", false),
  };
}

function upsertApprovalRule(
  database: Database.Database,
  actorId: string,
  ruleId?: string,
  rawPayload?: Record<string, unknown>,
) {
  const input = approvalRulePayload(rawPayload);
  const timestamp = now();
  if (ruleId) {
    const existing = database.prepare("SELECT id, rule_code FROM approval_rules WHERE id = ?").get(ruleId) as
      | { id: string; rule_code: string }
      | undefined;
    if (!existing) throw new Error("审批规则不存在。");
    database.prepare(`
      UPDATE approval_rules
      SET rule_name = ?,
          source_type = ?,
          min_amount = ?,
          max_amount = ?,
          approver_role = ?,
          sla_hours = ?,
          status = ?,
          condition_scope = ?,
          material_id = ?,
          adjustment_type = ?,
          risk_level = ?,
          allow_reversal = ?,
          reversal_approver_role = ?,
          description = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.ruleName,
      input.sourceType,
      input.minAmount,
      input.maxAmount,
      input.approverRole,
      input.slaHours,
      input.status,
      input.conditionScope,
      input.materialId || null,
      input.adjustmentType,
      input.riskLevel,
      input.allowReversal,
      input.reversalApproverRole,
      input.description,
      timestamp,
      existing.id,
    );
    audit(database, actorId, "upsertApprovalRule", "approval_rule", existing.id, `更新审批规则 ${input.ruleName}`);
    return;
  }

  const id = uid("APR");
  const ruleCode = input.ruleCode || id;
  database.prepare(`
    INSERT INTO approval_rules (
      id, rule_code, rule_name, source_type, min_amount, max_amount,
      approver_role, sla_hours, status, condition_scope, material_id, adjustment_type,
      risk_level, allow_reversal, reversal_approver_role, description, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ruleCode,
    input.ruleName,
    input.sourceType,
    input.minAmount,
    input.maxAmount,
    input.approverRole,
    input.slaHours,
    input.status,
    input.conditionScope,
    input.materialId || null,
    input.adjustmentType,
    input.riskLevel,
    input.allowReversal,
    input.reversalApproverRole,
    input.description,
    timestamp,
    timestamp,
  );
  audit(database, actorId, "upsertApprovalRule", "approval_rule", id, `新增审批规则 ${input.ruleName}`);
}

function deactivateApprovalRule(database: Database.Database, actorId: string, ruleId: string) {
  const rule = database.prepare("SELECT id, rule_name, status FROM approval_rules WHERE id = ?").get(ruleId) as
    | { id: string; rule_name: string; status: string }
    | undefined;
  if (!rule) throw new Error("审批规则不存在。");
  if (rule.status !== "inactive") {
    database.prepare("UPDATE approval_rules SET status = 'inactive', updated_at = ? WHERE id = ?").run(now(), rule.id);
  }
  audit(database, actorId, "deactivateApprovalRule", "approval_rule", rule.id, `停用审批规则 ${rule.rule_name}`);
}

function roleValue(value: string) {
  if (allRoles.includes(value as Role)) {
    return value as Role;
  }
  throw new Error("角色不正确。");
}

function alertTypeValue(value: string) {
  if ((alertTypes as readonly string[]).includes(value)) return value;
  throw new Error("预警类型不正确。");
}

function alertSeverityValue(value: string) {
  if (Object.keys(alertSeverityRank).includes(value)) return value;
  throw new Error("预警等级不正确。");
}

function alertMessageStatusValue(value: string) {
  if ((alertMessageStatuses as readonly string[]).includes(value)) return value;
  throw new Error("预警消息状态不正确。");
}

function booleanPayload(payload: Record<string, unknown>, key: string, fallback: boolean) {
  const value = payload[key];
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on", "enabled", "启用"].includes(text)) return true;
  if (["0", "false", "no", "n", "off", "disabled", "停用"].includes(text)) return false;
  throw new Error(`${key} 应为布尔值。`);
}

function alertTypeFromKey(alertKey: string, explicitType?: string) {
  if (explicitType) return alertTypeValue(explicitType);
  if (alertKey.startsWith("alert-low-stock-")) return "low_stock";
  if (alertKey.startsWith("alert-receivable-")) return "receivable_due";
  if (alertKey.startsWith("alert-payable-")) return "payable_due";
  if (alertKey.startsWith("alert-approval-")) return "approval_pending";
  if (alertKey.startsWith("alert-aging-")) return "inventory_stale";
  if (alertKey.startsWith("alert-yield-")) return "quality_yield_warning";
  if (alertKey.startsWith("alert-mrp-")) return "mrp_shortage";
  if (alertKey.startsWith("alert-remediation-")) return "system_health_remediation_due";
  if (alertKey.startsWith("alert-cost-anomaly-warning-")) return "cost_anomaly_warning";
  throw new Error("预警消息编号不正确。");
}

function upsertAlertMessageState(
  database: Database.Database,
  actorId: string,
  alertKey: string,
  status: "read" | "dismissed" | "handled",
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const nextStatus = alertMessageStatusValue(status);
  const alertType = alertTypeFromKey(alertKey, payloadText(payload, "alert_type", "预警类型", false));
  const timestamp = now();
  const readAt = nextStatus === "read" || nextStatus === "dismissed" || nextStatus === "handled" ? timestamp : null;
  const dismissedAt = nextStatus === "dismissed" ? timestamp : null;
  const handledAt = nextStatus === "handled" ? timestamp : null;

  database.prepare(`
    INSERT INTO alert_message_states (
      id, user_id, alert_key, alert_type, status, read_at, dismissed_at, handled_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, alert_key) DO UPDATE SET
      alert_type = excluded.alert_type,
      status = excluded.status,
      read_at = CASE
        WHEN excluded.read_at IS NOT NULL THEN COALESCE(alert_message_states.read_at, excluded.read_at)
        ELSE alert_message_states.read_at
      END,
      dismissed_at = excluded.dismissed_at,
      handled_at = excluded.handled_at,
      updated_at = excluded.updated_at
  `).run(uid("AMS"), actorId, alertKey, alertType, nextStatus, readAt, dismissedAt, handledAt, timestamp);

  audit(
    database,
    actorId,
    status === "dismissed" ? "dismissAlert" : "markAlertRead",
    "alert_message",
    alertKey,
    `${status === "dismissed" ? "忽略" : "标记已读"}预警消息 ${alertKey}`,
  );
}

function upsertAlertSubscription(database: Database.Database, actorId: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const role = roleValue(payloadText(payload, "role", "订阅角色"));
  const alertType = alertTypeValue(payloadText(payload, "alert_type", "预警类型"));
  const minSeverity = alertSeverityValue(payloadText(payload, "min_severity", "最低预警等级", false) || "low");
  const enabled = booleanPayload(payload, "enabled", true) ? 1 : 0;
  const routeToTasks = booleanPayload(payload, "route_to_tasks", true) ? 1 : 0;
  const timestamp = now();
  const id = `ALS-${role}-${alertType}`;

  database.prepare(`
    INSERT INTO alert_subscriptions (
      id, role, alert_type, min_severity, enabled, route_to_tasks, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(role, alert_type) DO UPDATE SET
      min_severity = excluded.min_severity,
      enabled = excluded.enabled,
      route_to_tasks = excluded.route_to_tasks,
      updated_at = excluded.updated_at
  `).run(id, role, alertType, minSeverity, enabled, routeToTasks, timestamp, timestamp);

  audit(
    database,
    actorId,
    "upsertAlertSubscription",
    "alert_subscription",
    id,
    `${enabled ? "启用" : "停用"}${roleLabel(role)} ${alertTypeLabel(alertType)} 订阅，最低等级 ${alertSeverityLabel(minSeverity)}，${routeToTasks ? "进入待办" : "仅预警中心"}`,
  );
}

function systemSettingValue(database: Database.Database, settingKey: string, payload: Record<string, unknown>) {
  const value = payloadText(payload, "setting_value", "系统参数值");
  let numberValue: number | undefined;
  if (
    [
      "backup_retention_days",
      "audit_retention_days",
      "session_timeout_hours",
      "stale_warning_days",
      "overstock_days",
      "receivable_due_warning_days",
      "payable_due_warning_days",
      "purchase_approval_threshold",
    ].includes(settingKey)
  ) {
    numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) throw new Error("系统参数值必须为正数。");
  }
  if (settingKey === "yield_warning_rate") {
    numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 100) {
      throw new Error("百分比参数必须在 0-100 之间。");
    }
  }
  if (settingKey === "stale_warning_days" || settingKey === "overstock_days") {
    const stale =
      settingKey === "stale_warning_days"
        ? Number(value)
        : systemSettingNumber(database, "stale_warning_days", 90);
    const overstock =
      settingKey === "overstock_days"
        ? Number(value)
        : systemSettingNumber(database, "overstock_days", 180);
    if (Number.isFinite(stale) && overstock <= stale) throw new Error("积压纳入天数必须大于呆滞预警天数。");
  }
  if (settingKey === "backup_frequency" && !["daily", "weekly", "monthly"].includes(value)) {
    throw new Error("备份频率只能是 daily、weekly 或 monthly。");
  }
  return value;
}

function upsertSystemSetting(
  database: Database.Database,
  actorId: string,
  settingKey: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const existing = database.prepare("SELECT * FROM system_settings WHERE setting_key = ?").get(settingKey) as
    | { setting_key: string; setting_label: string; setting_value: string; description: string }
    | undefined;
  if (!existing) throw new Error("系统参数不存在。");
  const value = systemSettingValue(database, settingKey, payload);
  const impactPreview = buildSystemSettingImpactPreview(database, settingKey, value);
  const description = payloadText(payload, "description", "参数说明", false) || existing.description;
  const timestamp = now();

  database.prepare(`
    UPDATE system_settings
    SET setting_value = ?,
        description = ?,
        updated_by = ?,
        updated_at = ?
    WHERE setting_key = ?
  `).run(value, description, actorId, timestamp, settingKey);

  database.prepare(`
    INSERT INTO system_setting_effects (
      id, setting_key, setting_label, old_value, new_value,
      impact_json, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid("SSE"),
    settingKey,
    existing.setting_label,
    existing.setting_value,
    value,
    JSON.stringify(impactPreview),
    actorId,
    timestamp,
  );

  audit(database, actorId, "upsertSystemSetting", "system_setting", settingKey, `更新系统参数 ${existing.setting_label}：${value}`);
}

function createSystemHealthRemediation(
  database: Database.Database,
  actorId: string,
  healthKey: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const remediations = systemHealthRemediationRows(database);
  const healthChecks = buildSystemHealthChecksFromDatabase(database, remediations) as Array<Record<string, unknown>>;
  const healthCheck = healthChecks.find((item) => String(item.key) === healthKey);
  if (!healthCheck) throw new Error("上线自检项不存在。");
  if (Number(healthCheck.count ?? 0) <= 0) throw new Error("该自检项当前没有问题需要整改。");

  const openExisting = database.prepare(`
    SELECT remediation_no
    FROM system_health_remediations
    WHERE health_key = ? AND status <> 'closed'
    LIMIT 1
  `).get(healthKey) as { remediation_no: string } | undefined;
  if (openExisting) throw new Error(`该自检项已有未关闭整改任务：${openExisting.remediation_no}`);

  const ownerId = payloadText(payload, "owner_id", "整改责任人", false) || actorId;
  const owner = getUser(database, ownerId);
  const actionPlan =
    payloadText(payload, "action_plan", "整改计划", false) ||
    `${String(healthCheck.action_label ?? "处理问题")}：${String(healthCheck.description ?? "")}`;
  const timestamp = now();
  const dueDate = payloadDate(payload, "due_date", "整改到期日", addDays(timestamp, 7));
  const id = uid("SHR");
  const remediationNo = serial(database, "system_health_remediations", "ZG");
  const sourceSnapshot = {
    key: healthCheck.key,
    category: healthCheck.category,
    title: healthCheck.title,
    severity: healthCheck.severity,
    count: healthCheck.count,
    sample_entities: healthCheck.sample_entities,
    generated_at: timestamp,
  };

  database.prepare(`
    INSERT INTO system_health_remediations (
      id, remediation_no, health_key, category, title, severity, status,
      owner_id, action_plan, result_note, source_snapshot_json,
      due_date, submitted_by, submitted_at, review_note,
      created_by, created_at, closed_by, closed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, '', ?, ?, NULL, NULL, '', ?, ?, NULL, NULL)
  `).run(
    id,
    remediationNo,
    healthKey,
    String(healthCheck.category),
    String(healthCheck.title),
    String(healthCheck.severity),
    owner.id,
    actionPlan,
    JSON.stringify(sourceSnapshot),
    dueDate,
    actorId,
    timestamp,
  );

  audit(
    database,
    actorId,
    "创建上线整改任务",
    "system_health_remediation",
    id,
    `${remediationNo} / ${healthCheck.title}，责任人 ${owner.name}`,
  );
}

function closeSystemHealthRemediation(
  database: Database.Database,
  actorId: string,
  remediationId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const remediation = database.prepare(`
    SELECT *
    FROM system_health_remediations
    WHERE id = ?
  `).get(remediationId) as Record<string, unknown> | undefined;
  if (!remediation) throw new Error("整改任务不存在。");
  if (String(remediation.status) === "closed") throw new Error("整改任务已关闭。");
  const resultNote = payloadText(payload, "result_note", "整改结果", false) || "整改完成，已关闭。";
  const timestamp = now();

  database.prepare(`
    UPDATE system_health_remediations
    SET status = 'closed',
        result_note = ?,
        closed_by = ?,
        closed_at = ?
    WHERE id = ?
  `).run(resultNote, actorId, timestamp, remediationId);
  insertSystemHealthRemediationReview(database, {
    remediationId,
    remediationNo: String(remediation.remediation_no),
    decision: "approved",
    reviewNote: resultNote,
    reviewerId: actorId,
    reviewedAt: timestamp,
  });

  audit(
    database,
    actorId,
    "关闭上线整改任务",
    "system_health_remediation",
    remediationId,
    `${remediation.remediation_no} / ${remediation.title}，${resultNote}`,
  );
}

function insertSystemHealthRemediationReview(
  database: Database.Database,
  input: {
    remediationId: string;
    remediationNo: string;
    decision: "submitted" | "rejected" | "approved";
    reviewNote: string;
    reviewerId: string;
    reviewedAt: string;
  },
) {
  database.prepare(`
    INSERT INTO system_health_remediation_reviews (
      id, remediation_id, remediation_no, decision, review_note, reviewer_id, reviewed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid("SHRR"),
    input.remediationId,
    input.remediationNo,
    input.decision,
    input.reviewNote,
    input.reviewerId,
    input.reviewedAt,
  );
}

function markSystemHealthRemediationReady(
  database: Database.Database,
  actorId: string,
  remediationId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const remediation = database.prepare(`
    SELECT *
    FROM system_health_remediations
    WHERE id = ?
  `).get(remediationId) as Record<string, unknown> | undefined;
  if (!remediation) throw new Error("整改任务不存在。");
  if (String(remediation.status) === "closed") throw new Error("整改任务已关闭。");
  if (String(remediation.owner_id) !== actorId) {
    const actor = getUser(database, actorId);
    if (!["manager", "admin"].includes(actor.role)) throw new Error("只有整改责任人或管理员可以提交复核。");
  }
  const reviewNote = payloadText(payload, "review_note", "复核说明", false) || "整改完成，提交复核。";
  const timestamp = now();

  database.prepare(`
    UPDATE system_health_remediations
    SET status = 'ready_for_review',
        review_note = ?,
        submitted_by = ?,
        submitted_at = ?
    WHERE id = ?
  `).run(reviewNote, actorId, timestamp, remediationId);
  insertSystemHealthRemediationReview(database, {
    remediationId,
    remediationNo: String(remediation.remediation_no),
    decision: "submitted",
    reviewNote,
    reviewerId: actorId,
    reviewedAt: timestamp,
  });

  audit(
    database,
    actorId,
    "提交上线整改复核",
    "system_health_remediation",
    remediationId,
    `${remediation.remediation_no} / ${remediation.title}，${reviewNote}`,
  );
}

function rejectSystemHealthRemediationReview(
  database: Database.Database,
  actorId: string,
  remediationId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const remediation = database.prepare(`
    SELECT *
    FROM system_health_remediations
    WHERE id = ?
  `).get(remediationId) as Record<string, unknown> | undefined;
  if (!remediation) throw new Error("整改任务不存在。");
  if (String(remediation.status) !== "ready_for_review") throw new Error("只有待复核的整改任务可以驳回。");
  const reviewNote = payloadText(payload, "review_note", "驳回原因", false) || "复核未通过，请补充整改资料后重新提交。";
  const timestamp = now();

  database.prepare(`
    UPDATE system_health_remediations
    SET status = 'rejected',
        result_note = '',
        review_note = ?,
        submitted_by = NULL,
        submitted_at = NULL
    WHERE id = ?
  `).run(reviewNote, remediationId);
  insertSystemHealthRemediationReview(database, {
    remediationId,
    remediationNo: String(remediation.remediation_no),
    decision: "rejected",
    reviewNote,
    reviewerId: actorId,
    reviewedAt: timestamp,
  });

  audit(
    database,
    actorId,
    "驳回上线整改复核",
    "system_health_remediation",
    remediationId,
    `${remediation.remediation_no} / ${remediation.title}，${reviewNote}`,
  );
}

function costAnomalySeverityValue(value: string) {
  if (["low", "medium", "high", "critical"].includes(value)) return value;
  throw new Error("成本异常整改等级不正确。");
}

function createCostAnomalyRemediation(
  database: Database.Database,
  actorId: string,
  adjustmentId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const adjustment = database.prepare(`
    SELECT pca.*,
           po.prod_no,
           o.order_no,
           c.name AS customer_name,
           p.name AS product_name,
           exception.exception_no,
           exception.reason_type,
           ar.request_no AS approval_request_no,
           ar.status AS approval_status,
           dr.reversal_no
    FROM production_cost_adjustments pca
    JOIN production_orders po ON po.id = pca.production_order_id
    JOIN orders o ON o.id = pca.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN production_material_adjustment_review_exceptions exception ON exception.id = pca.exception_id
    LEFT JOIN approval_requests ar ON ar.id = pca.approval_request_id
    LEFT JOIN document_reversals dr ON dr.id = pca.reversal_id
    WHERE pca.id = ?
  `).get(adjustmentId) as Record<string, unknown> | undefined;
  if (!adjustment) throw new Error("成本异常调整单不存在。");

  const existing = database
    .prepare("SELECT remediation_no FROM production_cost_anomaly_remediations WHERE adjustment_id = ?")
    .get(adjustmentId) as { remediation_no: string } | undefined;
  if (existing) throw new Error(`该成本异常已生成整改任务：${existing.remediation_no}`);

  const severity = costAnomalySeverityValue(payloadText(payload, "severity", "整改等级", false) || "medium");
  const ownerId = payloadText(payload, "owner_id", "整改责任人", false) || String(adjustment.created_by);
  const owner = getUser(database, ownerId);
  const rootCause = payloadText(payload, "root_cause", "原因分析");
  const correctiveAction = payloadText(payload, "corrective_action", "纠正措施");
  const preventiveAction =
    payloadText(payload, "preventive_action", "预防措施", false) ||
    "将该成本异常纳入月度成本复盘，后续同类成本调整必须补齐工单、审批和红冲依据。";
  const timestamp = now();
  const dueDate = payloadDate(payload, "due_date", "整改到期日", addDays(timestamp, 7));
  const id = uid("CBZG");
  const remediationNo = serial(database, "production_cost_anomaly_remediations", "CBZG");
  const sourceSnapshot = {
    adjustment_id: adjustment.id,
    adjustment_no: adjustment.adjustment_no,
    adjustment_amount: adjustment.adjustment_amount,
    adjustment_status: adjustment.status,
    prod_no: adjustment.prod_no,
    order_no: adjustment.order_no,
    customer_name: adjustment.customer_name,
    product_name: adjustment.product_name,
    exception_no: adjustment.exception_no,
    reason_type: adjustment.reason_type,
    approval_request_no: adjustment.approval_request_no,
    approval_status: adjustment.approval_status,
    reversal_no: adjustment.reversal_no,
    generated_at: timestamp,
  };

  database.prepare(`
    INSERT INTO production_cost_anomaly_remediations (
      id, remediation_no, adjustment_id, production_order_id, order_id, exception_id,
      severity, root_cause, corrective_action, preventive_action,
      owner_id, due_date, status, result_note, review_note, source_snapshot_json,
      created_by, created_at, submitted_by, submitted_at, closed_by, closed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '', ?, ?, ?, NULL, NULL, NULL, NULL)
  `).run(
    id,
    remediationNo,
    adjustment.id,
    adjustment.production_order_id,
    adjustment.order_id,
    adjustment.exception_id ?? null,
    severity,
    rootCause,
    correctiveAction,
    preventiveAction,
    owner.id,
    dueDate,
    JSON.stringify(sourceSnapshot),
    actorId,
    timestamp,
  );

  audit(
    database,
    actorId,
    "createCostAnomalyRemediation",
    "production_cost_anomaly_remediation",
    id,
    `${remediationNo} / ${adjustment.adjustment_no}，责任人 ${owner.name}`,
  );
}

function upsertCostAnomalyWarningRule(
  database: Database.Database,
  actorId: string,
  ruleId?: string,
  rawPayload?: Record<string, unknown>,
) {
  const input = costAnomalyWarningRulePayload(rawPayload);
  const owner = getUser(database, input.ownerId);
  const timestamp = now();
  const duplicate = database.prepare(`
    SELECT id
    FROM production_cost_anomaly_warning_rules
    WHERE rule_code = ?
      AND id != COALESCE(?, '')
    LIMIT 1
  `).get(input.ruleCode, ruleId ?? "") as { id: string } | undefined;
  if (duplicate) throw new Error("成本异常预警规则编号已存在。");

  if (ruleId) {
    const existing = database.prepare("SELECT id FROM production_cost_anomaly_warning_rules WHERE id = ?").get(ruleId) as
      | { id: string }
      | undefined;
    if (!existing) throw new Error("成本异常预警规则不存在。");
    database.prepare(`
      UPDATE production_cost_anomaly_warning_rules
      SET rule_code = ?,
          rule_name = ?,
          metric_key = ?,
          operator = ?,
          threshold_value = ?,
          window_days = ?,
          severity = ?,
          owner_id = ?,
          auto_create_remediation = ?,
          priority = ?,
          status = ?,
          description = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.ruleCode,
      input.ruleName,
      input.metricKey,
      input.operator,
      input.thresholdValue,
      input.windowDays,
      input.severity,
      owner.id,
      input.autoCreateRemediation,
      input.priority,
      input.status,
      input.description,
      actorId,
      timestamp,
      existing.id,
    );
    audit(database, actorId, "upsertCostAnomalyWarningRule", "production_cost_anomaly_warning_rule", existing.id, `更新成本异常预警规则 ${input.ruleName}`);
    return;
  }

  const id = uid("CAWR");
  database.prepare(`
    INSERT INTO production_cost_anomaly_warning_rules (
      id, rule_code, rule_name, metric_key, operator, threshold_value,
      window_days, severity, owner_id, auto_create_remediation, priority,
      status, description, created_by, created_at, updated_by, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.ruleCode,
    input.ruleName,
    input.metricKey,
    input.operator,
    input.thresholdValue,
    input.windowDays,
    input.severity,
    owner.id,
    input.autoCreateRemediation,
    input.priority,
    input.status,
    input.description,
    actorId,
    timestamp,
    actorId,
    timestamp,
  );
  audit(database, actorId, "upsertCostAnomalyWarningRule", "production_cost_anomaly_warning_rule", id, `新增成本异常预警规则 ${input.ruleName}`);
}

function costAnomalyAdjustmentContext(database: Database.Database, adjustmentId: string): Record<string, unknown> | undefined {
  return database.prepare(`
    SELECT pca.*,
           po.prod_no,
           o.order_no,
           c.name AS customer_name,
           p.name AS product_name,
           exception.exception_no,
           exception.reason_type,
           pmaol.material_id,
           m.material_code,
           m.name AS material_name,
           ar.request_no AS approval_request_no,
           ar.status AS approval_status,
           dr.reversal_no
    FROM production_cost_adjustments pca
    JOIN production_orders po ON po.id = pca.production_order_id
    JOIN orders o ON o.id = pca.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN production_material_adjustment_review_exceptions exception ON exception.id = pca.exception_id
    LEFT JOIN production_material_adjustment_orders pmao ON pmao.id = exception.order_id
    LEFT JOIN production_material_adjustment_order_lines pmaol ON pmaol.order_id = pmao.id
    LEFT JOIN materials m ON m.id = pmaol.material_id
    LEFT JOIN approval_requests ar ON ar.id = pca.approval_request_id
    LEFT JOIN document_reversals dr ON dr.id = pca.reversal_id
    WHERE pca.id = ?
    ORDER BY pmaol.created_at ASC, pmaol.rowid ASC
    LIMIT 1
  `).get(adjustmentId) as Record<string, unknown> | undefined;
}

function warningWindowCutoff(windowDays: number) {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return "";
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.round(windowDays));
  return date.toISOString();
}

function costAnomalyWarningActualValue(
  database: Database.Database,
  rule: CostAnomalyWarningRuleRow,
  adjustment: Record<string, unknown>,
) {
  if (rule.metric_key === "single_adjustment_amount") {
    return roundMoney(Math.abs(Number(adjustment.adjustment_amount ?? 0)));
  }

  if (rule.metric_key === "material_anomaly_count") {
    const materialId = String(adjustment.material_id ?? "");
    if (!materialId) return 0;
    const conditions = ["pmaol.material_id = ?"];
    const params: unknown[] = [materialId];
    const cutoff = warningWindowCutoff(Number(rule.window_days ?? 0));
    if (cutoff) {
      conditions.push("pca.created_at >= ?");
      params.push(cutoff);
    }
    return scalarNumber(
      database,
      `
        SELECT COUNT(DISTINCT pca.id) AS value
        FROM production_cost_adjustments pca
        JOIN production_material_adjustment_review_exceptions exception ON exception.id = pca.exception_id
        JOIN production_material_adjustment_orders pmao ON pmao.id = exception.order_id
        JOIN production_material_adjustment_order_lines pmaol ON pmaol.order_id = pmao.id
        WHERE ${conditions.join(" AND ")}
      `,
      params,
    );
  }

  if (rule.metric_key === "work_order_reversal_count") {
    const conditions = ["production_order_id = ?", "status = 'reversed'"];
    const params: unknown[] = [String(adjustment.production_order_id ?? "")];
    const cutoff = warningWindowCutoff(Number(rule.window_days ?? 0));
    if (cutoff) {
      conditions.push("reversed_at >= ?");
      params.push(cutoff);
    }
    return scalarNumber(
      database,
      `
        SELECT COUNT(*) AS value
        FROM production_cost_adjustments
        WHERE ${conditions.join(" AND ")}
      `,
      params,
    );
  }

  return 0;
}

function ensureAutomaticCostAnomalyRemediation(input: {
  database: Database.Database;
  actorId: string;
  adjustment: Record<string, unknown>;
  rule: CostAnomalyWarningRuleRow;
  actualValue: number;
}) {
  const existing = input.database
    .prepare("SELECT id, remediation_no FROM production_cost_anomaly_remediations WHERE adjustment_id = ?")
    .get(String(input.adjustment.id)) as { id: string; remediation_no: string } | undefined;
  if (existing) return { id: existing.id, remediationNo: existing.remediation_no, created: false };

  const owner = getUser(input.database, input.rule.owner_id);
  const timestamp = now();
  const id = uid("CBZG");
  const remediationNo = serial(input.database, "production_cost_anomaly_remediations", "CBZG");
  const metricLabel = costAnomalyWarningMetricLabel(input.rule.metric_key);
  const triggerSummary = `${input.rule.rule_code} ${input.rule.rule_name}：${metricLabel}${supplierAdmissionOperatorLabel(input.rule.operator)}${input.rule.threshold_value}，当前值 ${roundMoney(input.actualValue)}。`;
  const sourceSnapshot = {
    generated_by_rule: input.rule.rule_code,
    generated_by_rule_name: input.rule.rule_name,
    metric_key: input.rule.metric_key,
    metric_label: metricLabel,
    threshold_value: input.rule.threshold_value,
    actual_value: roundMoney(input.actualValue),
    adjustment_id: input.adjustment.id,
    adjustment_no: input.adjustment.adjustment_no,
    adjustment_amount: input.adjustment.adjustment_amount,
    adjustment_status: input.adjustment.status,
    prod_no: input.adjustment.prod_no,
    order_no: input.adjustment.order_no,
    customer_name: input.adjustment.customer_name,
    product_name: input.adjustment.product_name,
    material_id: input.adjustment.material_id,
    material_name: input.adjustment.material_name,
    exception_no: input.adjustment.exception_no,
    reason_type: input.adjustment.reason_type,
    approval_request_no: input.adjustment.approval_request_no,
    approval_status: input.adjustment.approval_status,
    reversal_no: input.adjustment.reversal_no,
    generated_at: timestamp,
  };

  input.database.prepare(`
    INSERT INTO production_cost_anomaly_remediations (
      id, remediation_no, adjustment_id, production_order_id, order_id, exception_id,
      severity, root_cause, corrective_action, preventive_action,
      owner_id, due_date, status, result_note, review_note, source_snapshot_json,
      created_by, created_at, submitted_by, submitted_at, closed_by, closed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '', ?, ?, ?, NULL, NULL, NULL, NULL)
  `).run(
    id,
    remediationNo,
    input.adjustment.id,
    input.adjustment.production_order_id,
    input.adjustment.order_id,
    input.adjustment.exception_id ?? null,
    input.rule.severity,
    `系统预警自动生成：${triggerSummary}`,
    "复核生产工单、补退料单、审批记录和红冲记录，补齐成本异常处理依据。",
    "将本规则纳入月度成本复盘；同类物料或同一工单连续异常时提前预警并要求责任人复核。",
    owner.id,
    addDays(timestamp, input.rule.severity === "critical" ? 3 : 7),
    JSON.stringify(sourceSnapshot),
    input.actorId,
    timestamp,
  );
  audit(
    input.database,
    input.actorId,
    "autoCreateCostAnomalyRemediation",
    "production_cost_anomaly_remediation",
    id,
    `${remediationNo} / ${String(input.adjustment.adjustment_no)}，由预警规则 ${input.rule.rule_code} 自动生成`,
  );
  return { id, remediationNo, created: true };
}

function evaluateCostAnomalyWarningRules(
  database: Database.Database,
  actorId: string,
  adjustmentId: string,
  triggerSource: string,
) {
  const adjustment = costAnomalyAdjustmentContext(database, adjustmentId);
  if (!adjustment) return;
  const rules = database.prepare(`
    SELECT *
    FROM production_cost_anomaly_warning_rules
    WHERE status = 'active'
    ORDER BY priority DESC, rule_code ASC
  `).all() as CostAnomalyWarningRuleRow[];
  for (const rule of rules) {
    const existing = database.prepare(`
      SELECT id
      FROM production_cost_anomaly_warning_events
      WHERE rule_id = ?
        AND adjustment_id = ?
      LIMIT 1
    `).get(rule.id, adjustmentId) as { id: string } | undefined;
    if (existing) continue;

    const actualValue = costAnomalyWarningActualValue(database, rule, adjustment);
    if (!supplierAdmissionRuleMatches(actualValue, rule.operator, Number(rule.threshold_value))) continue;

    let remediation: { id: string; remediationNo: string; created: boolean } | null = null;
    if (Number(rule.auto_create_remediation)) {
      remediation = ensureAutomaticCostAnomalyRemediation({
        database,
        actorId,
        adjustment,
        rule,
        actualValue,
      });
    }

    const eventId = uid("CBYJ");
    const eventNo = serial(database, "production_cost_anomaly_warning_events", "CBYJ");
    const triggerReason = `${costAnomalyWarningMetricLabel(rule.metric_key)}${supplierAdmissionOperatorLabel(rule.operator)}${rule.threshold_value}，当前值 ${roundMoney(actualValue)}；来源 ${triggerSource}。`;
    const eventStatus = remediation ? (remediation.created ? "remediation_created" : "skipped_existing") : "recorded";
    database.prepare(`
      INSERT INTO production_cost_anomaly_warning_events (
        id, event_no, rule_id, rule_code, rule_name, metric_key,
        threshold_value, actual_value, adjustment_id, production_order_id, order_id,
        material_id, remediation_id, event_status, trigger_source, trigger_reason,
        triggered_by, triggered_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      eventNo,
      rule.id,
      rule.rule_code,
      rule.rule_name,
      rule.metric_key,
      roundMoney(Number(rule.threshold_value)),
      roundMoney(actualValue),
      adjustment.id,
      adjustment.production_order_id,
      adjustment.order_id,
      adjustment.material_id || null,
      remediation?.id ?? null,
      eventStatus,
      triggerSource,
      triggerReason,
      actorId,
      now(),
    );
    audit(
      database,
      actorId,
      "triggerCostAnomalyWarningRule",
      "production_cost_anomaly_warning_event",
      eventId,
      `${eventNo} / ${rule.rule_code} / ${String(adjustment.adjustment_no)}：${triggerReason}`,
    );
  }
}

function insertCostAnomalyRemediationReview(
  database: Database.Database,
  input: {
    remediationId: string;
    remediationNo: string;
    decision: "submitted" | "rejected" | "approved";
    reviewNote: string;
    reviewerId: string;
    reviewedAt: string;
  },
) {
  database.prepare(`
    INSERT INTO production_cost_anomaly_remediation_reviews (
      id, remediation_id, remediation_no, decision, review_note, reviewer_id, reviewed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid("CBZGR"),
    input.remediationId,
    input.remediationNo,
    input.decision,
    input.reviewNote,
    input.reviewerId,
    input.reviewedAt,
  );
}

function getCostAnomalyRemediation(database: Database.Database, remediationId: string) {
  const remediation = database.prepare(`
    SELECT car.*, pca.adjustment_no, po.prod_no, o.order_no, c.name AS customer_name, p.name AS product_name
    FROM production_cost_anomaly_remediations car
    JOIN production_cost_adjustments pca ON pca.id = car.adjustment_id
    JOIN production_orders po ON po.id = car.production_order_id
    JOIN orders o ON o.id = car.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    WHERE car.id = ?
  `).get(remediationId) as Record<string, unknown> | undefined;
  if (!remediation) throw new Error("成本异常整改任务不存在。");
  return remediation;
}

function markCostAnomalyRemediationReady(
  database: Database.Database,
  actorId: string,
  remediationId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const remediation = getCostAnomalyRemediation(database, remediationId);
  if (String(remediation.status) === "closed") throw new Error("成本异常整改任务已关闭。");
  if (!["pending", "rejected", "ready_for_review"].includes(String(remediation.status))) {
    throw new Error("成本异常整改任务状态不允许提交复核。");
  }
  if (String(remediation.owner_id) !== actorId) {
    const actor = getUser(database, actorId);
    if (!["manager", "finance", "admin"].includes(actor.role)) throw new Error("只有整改责任人、财务、管理层或管理员可以提交复核。");
  }
  const resultNote = payloadText(payload, "result_note", "整改结果", false) || "整改完成，提交复核。";
  const timestamp = now();
  database.prepare(`
    UPDATE production_cost_anomaly_remediations
    SET status = 'ready_for_review',
        result_note = ?,
        review_note = '',
        submitted_by = ?,
        submitted_at = ?
    WHERE id = ?
  `).run(resultNote, actorId, timestamp, remediationId);
  insertCostAnomalyRemediationReview(database, {
    remediationId,
    remediationNo: String(remediation.remediation_no),
    decision: "submitted",
    reviewNote: resultNote,
    reviewerId: actorId,
    reviewedAt: timestamp,
  });
  audit(
    database,
    actorId,
    "markCostAnomalyRemediationReady",
    "production_cost_anomaly_remediation",
    remediationId,
    `${remediation.remediation_no} / ${remediation.adjustment_no} 提交复核`,
  );
}

function rejectCostAnomalyRemediationReview(
  database: Database.Database,
  actorId: string,
  remediationId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const remediation = getCostAnomalyRemediation(database, remediationId);
  if (String(remediation.status) !== "ready_for_review") throw new Error("只有待复核的成本异常整改可以驳回。");
  const reviewNote = payloadText(payload, "review_note", "驳回原因", false) || "复核未通过，请补充整改资料后重新提交。";
  const timestamp = now();
  database.prepare(`
    UPDATE production_cost_anomaly_remediations
    SET status = 'rejected',
        review_note = ?
    WHERE id = ?
  `).run(reviewNote, remediationId);
  insertCostAnomalyRemediationReview(database, {
    remediationId,
    remediationNo: String(remediation.remediation_no),
    decision: "rejected",
    reviewNote,
    reviewerId: actorId,
    reviewedAt: timestamp,
  });
  audit(
    database,
    actorId,
    "rejectCostAnomalyRemediationReview",
    "production_cost_anomaly_remediation",
    remediationId,
    `${remediation.remediation_no} / ${remediation.adjustment_no} 复核驳回`,
  );
}

function closeCostAnomalyRemediation(
  database: Database.Database,
  actorId: string,
  remediationId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const remediation = getCostAnomalyRemediation(database, remediationId);
  if (String(remediation.status) !== "ready_for_review") throw new Error("只有待复核的成本异常整改可以关闭。");
  const resultNote = payloadText(payload, "result_note", "整改结论", false) || "整改复核通过，成本异常闭环。";
  const timestamp = now();
  database.prepare(`
    UPDATE production_cost_anomaly_remediations
    SET status = 'closed',
        result_note = ?,
        review_note = ?,
        closed_by = ?,
        closed_at = ?
    WHERE id = ?
  `).run(resultNote, resultNote, actorId, timestamp, remediationId);
  insertCostAnomalyRemediationReview(database, {
    remediationId,
    remediationNo: String(remediation.remediation_no),
    decision: "approved",
    reviewNote: resultNote,
    reviewerId: actorId,
    reviewedAt: timestamp,
  });
  audit(
    database,
    actorId,
    "closeCostAnomalyRemediation",
    "production_cost_anomaly_remediation",
    remediationId,
    `${remediation.remediation_no} / ${remediation.adjustment_no} 整改关闭`,
  );
}

function documentTypeValue(value: string) {
  if (["quote", "sales_order", "purchase_order", "approval_request"].includes(value)) return value;
  throw new Error("单据类型不正确。");
}

function ensureNotCancelled(database: Database.Database, documentType: string, documentId: string) {
  const existing = database
    .prepare("SELECT cancellation_no FROM document_cancellations WHERE document_type = ? AND document_id = ?")
    .get(documentType, documentId) as { cancellation_no: string } | undefined;
  if (existing) throw new Error(`该单据已作废：${existing.cancellation_no}`);
}

function insertDocumentCancellation(
  database: Database.Database,
  actorId: string,
  input: {
    documentType: string;
    documentId: string;
    documentNo: string;
    originalStatus: string;
    reason: string;
  },
) {
  const cancellationNo = serial(database, "document_cancellations", "ZF");
  const cancelledAt = now();
  database.prepare(`
    INSERT INTO document_cancellations (
      id, cancellation_no, document_type, document_id, document_no,
      original_status, reason, cancelled_by, cancelled_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid("VOID"),
    cancellationNo,
    input.documentType,
    input.documentId,
    input.documentNo,
    input.originalStatus,
    input.reason,
    actorId,
    cancelledAt,
  );
  audit(
    database,
    actorId,
    "voidBusinessDocument",
    "document_void",
    input.documentId,
    `作废${documentTypeLabel(input.documentType)} ${input.documentNo}：${input.reason}`,
  );
}

function voidBusinessDocument(database: Database.Database, actorId: string, documentId: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const documentType = documentTypeValue(payloadText(payload, "document_type", "单据类型"));
  const reason = payloadText(payload, "reason", "作废原因");
  ensureNotCancelled(database, documentType, documentId);

  if (documentType === "purchase_order") {
    const purchase = database.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(documentId) as
      | { id: string; purchase_no: string; status: string; approval_request_id?: string | null }
      | undefined;
    if (!purchase) throw new Error("采购单不存在。");
    if (purchase.status === "received") throw new Error("采购单已入库，不能直接作废，请走采购冲销流程。");
    if (purchase.status === "voided") throw new Error("采购单已作废。");
    if (!["pending_approval", "pending_receipt", "rejected"].includes(purchase.status)) throw new Error("当前采购单状态不允许直接作废。");
    database.prepare("UPDATE purchase_orders SET status = 'voided' WHERE id = ?").run(purchase.id);
    if (purchase.approval_request_id) {
      database.prepare(`
        UPDATE approval_requests
        SET status = 'rejected',
            decided_by = ?,
            decided_at = ?,
            decision_note = ?
        WHERE id = ? AND status = 'pending'
      `).run(actorId, now(), `采购单作废同步关闭：${reason}`, purchase.approval_request_id);
    }
    insertDocumentCancellation(database, actorId, {
      documentType,
      documentId: purchase.id,
      documentNo: purchase.purchase_no,
      originalStatus: purchase.status,
      reason,
    });
    return;
  }

  if (documentType === "sales_order") {
    const order = database.prepare("SELECT * FROM orders WHERE id = ?").get(documentId) as
      | { id: string; order_no: string; quote_id: string; status: string }
      | undefined;
    if (!order) throw new Error("销售订单不存在。");
    if (order.status !== "submitted") throw new Error("订单已进入生产或发货，不能直接作废，请走订单冲销流程。");
    database.prepare("UPDATE orders SET status = 'voided' WHERE id = ?").run(order.id);
    database.prepare("UPDATE quotes SET status = 'confirmed' WHERE id = ? AND status = 'converted'").run(order.quote_id);
    insertDocumentCancellation(database, actorId, {
      documentType,
      documentId: order.id,
      documentNo: order.order_no,
      originalStatus: order.status,
      reason,
    });
    return;
  }

  if (documentType === "quote") {
    const quote = database.prepare("SELECT * FROM quotes WHERE id = ?").get(documentId) as
      | { id: string; quote_no: string; status: string }
      | undefined;
    if (!quote) throw new Error("报价单不存在。");
    if (quote.status === "converted") throw new Error("报价单已转订单，不能直接作废。");
    if (quote.status === "voided") throw new Error("报价单已作废。");
    database.prepare("UPDATE quotes SET status = 'voided' WHERE id = ?").run(quote.id);
    insertDocumentCancellation(database, actorId, {
      documentType,
      documentId: quote.id,
      documentNo: quote.quote_no,
      originalStatus: quote.status,
      reason,
    });
    return;
  }

  const approval = database.prepare("SELECT * FROM approval_requests WHERE id = ?").get(documentId) as
    | { id: string; request_no: string; status: string }
    | undefined;
  if (!approval) throw new Error("审批单不存在。");
  if (approval.status !== "pending") throw new Error("审批单已处理，不能直接作废。");
  database.prepare(`
    UPDATE approval_requests
    SET status = 'rejected',
        decided_by = ?,
        decided_at = ?,
        decision_note = ?
    WHERE id = ?
  `).run(actorId, now(), `审批单作废：${reason}`, approval.id);
  insertDocumentCancellation(database, actorId, {
    documentType,
    documentId: approval.id,
    documentNo: approval.request_no,
    originalStatus: approval.status,
    reason,
  });
}

function reversalDocumentTypeValue(value: string) {
  if (["purchase_order", "shipment", "production_cost_adjustment"].includes(value)) return value;
  throw new Error("冲销单据类型不正确。");
}

function ensureNotReversed(database: Database.Database, documentType: string, documentId: string) {
  const existing = database
    .prepare("SELECT reversal_no FROM document_reversals WHERE document_type = ? AND document_id = ?")
    .get(documentType, documentId) as { reversal_no: string } | undefined;
  if (existing) throw new Error(`该单据已冲销：${existing.reversal_no}`);
}

function insertDocumentReversal(
  database: Database.Database,
  actorId: string,
  input: {
    documentType: string;
    documentId: string;
    documentNo: string;
    originalStatus: string;
    reversalType: string;
    reason: string;
  },
) {
  const reversalId = uid("REV");
  const reversalNo = serial(database, "document_reversals", "CX");
  const reversedAt = now();
  database.prepare(`
    INSERT INTO document_reversals (
      id, reversal_no, document_type, document_id, document_no,
      original_status, reversal_type, reason, status, reversed_by, reversed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reversed', ?, ?)
  `).run(
    reversalId,
    reversalNo,
    input.documentType,
    input.documentId,
    input.documentNo,
    input.originalStatus,
    input.reversalType,
    input.reason,
    actorId,
    reversedAt,
  );
  audit(
    database,
    actorId,
    "reverseBusinessDocument",
    "document_reversal",
    reversalId,
    `冲销${documentTypeLabel(input.documentType)} ${input.documentNo}：${input.reason}`,
  );
  return { reversalId, reversalNo, reversedAt };
}

function insertLedgerRedOffset(
  database: Database.Database,
  actorId: string,
  input: {
    ledgerType: "payable" | "receivable";
    ledgerId: string;
    ledgerNo: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    reversalId: string;
    originalAmount: number;
    settledAmount: number;
    reason: string;
  },
) {
  database.prepare(`
    INSERT INTO ledger_red_offsets (
      id, offset_no, ledger_type, ledger_id, ledger_no,
      source_document_type, source_document_id, reversal_id,
      original_amount, settled_amount, offset_amount, reason,
      created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid("RED"),
    serial(database, "ledger_red_offsets", "HC"),
    input.ledgerType,
    input.ledgerId,
    input.ledgerNo,
    input.sourceDocumentType,
    input.sourceDocumentId,
    input.reversalId,
    roundMoney(input.originalAmount),
    roundMoney(input.settledAmount),
    roundMoney(-Math.abs(input.originalAmount)),
    input.reason,
    actorId,
    now(),
  );
}

function reverseBusinessDocument(database: Database.Database, actorId: string, documentId: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const documentType = reversalDocumentTypeValue(payloadText(payload, "document_type", "冲销单据类型"));
  const reason = payloadText(payload, "reason", "冲销原因");
  ensureNotReversed(database, documentType, documentId);

  if (documentType === "purchase_order") {
    reversePurchaseReceipt(database, actorId, documentId, reason);
    return;
  }

  if (documentType === "production_cost_adjustment") {
    reverseProductionCostAdjustment(database, actorId, documentId, reason);
    return;
  }

  reverseShipment(database, actorId, documentId, reason);
}

function reverseProductionCostAdjustment(database: Database.Database, actorId: string, adjustmentId: string, reason: string) {
  const adjustment = database.prepare(`
    SELECT pca.*, pcs.material_cost, pcs.total_cost, pcs.unit_cost, pcs.finished_qty,
           rule.rule_name AS approval_rule_name,
           COALESCE(rule.allow_reversal, 1) AS allow_reversal
    FROM production_cost_adjustments pca
    LEFT JOIN production_cost_summaries pcs ON pcs.id = pca.cost_summary_id
    LEFT JOIN approval_requests ar ON ar.id = pca.approval_request_id
    LEFT JOIN approval_rules rule ON rule.id = ar.rule_id
    WHERE pca.id = ?
  `).get(adjustmentId) as
    | {
        id: string;
        adjustment_no: string;
        cost_summary_id: string;
        adjustment_amount: number;
        status: string;
        material_cost: number | null;
        total_cost: number | null;
        unit_cost: number | null;
        finished_qty: number | null;
        approval_rule_name: string | null;
        allow_reversal: number | null;
      }
    | undefined;
  if (!adjustment) throw new Error("工单成本调整单不存在。");
  if (adjustment.status !== "applied") throw new Error("工单成本调整单未入账或已处理，不能红冲。");
  if (Number(adjustment.allow_reversal ?? 1) === 0) {
    throw new Error(`当前成本调整审批规则不允许直接红冲：${adjustment.approval_rule_name ?? adjustment.adjustment_no}`);
  }
  if (!adjustment.cost_summary_id || adjustment.total_cost == null) {
    throw new Error("工单成本调整单缺少成本归集信息，不能红冲。");
  }

  const reversal = insertDocumentReversal(database, actorId, {
    documentType: "production_cost_adjustment",
    documentId: adjustment.id,
    documentNo: adjustment.adjustment_no,
    originalStatus: adjustment.status,
    reversalType: "production_cost_adjustment",
    reason,
  });
  const amount = roundMoney(Number(adjustment.adjustment_amount ?? 0));
  const nextMaterialCost = roundMoney(Number(adjustment.material_cost ?? 0) - amount);
  const nextTotalCost = roundMoney(Number(adjustment.total_cost ?? 0) - amount);
  const nextUnitCost = Number(adjustment.finished_qty ?? 0) > 0 ? roundMoney(nextTotalCost / Number(adjustment.finished_qty)) : roundMoney(Number(adjustment.unit_cost ?? 0));
  database.prepare(`
    UPDATE production_cost_summaries
    SET material_cost = ?,
        total_cost = ?,
        unit_cost = ?,
        status = 'adjusted',
        aggregated_at = ?
    WHERE id = ?
  `).run(nextMaterialCost, nextTotalCost, nextUnitCost, reversal.reversedAt, adjustment.cost_summary_id);
  database.prepare(`
    UPDATE production_cost_adjustments
    SET status = 'reversed',
        reversal_id = ?,
        reversed_by = ?,
        reversed_at = ?,
        reversal_reason = ?
    WHERE id = ?
  `).run(reversal.reversalId, actorId, reversal.reversedAt, reason, adjustment.id);
  audit(database, actorId, "reverseProductionCostAdjustment", "production_cost_adjustment", adjustment.id, `红冲工单成本调整 ${adjustment.adjustment_no}：${reason}`);
  evaluateCostAnomalyWarningRules(database, actorId, adjustment.id, "cost_adjustment_reversed");
}

function reversePurchaseReceipt(database: Database.Database, actorId: string, purchaseOrderId: string, reason: string) {
  const purchase = database.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(purchaseOrderId) as
    | { id: string; purchase_no: string; status: string }
    | undefined;
  if (!purchase) throw new Error("采购单不存在。");
  if (purchase.status !== "received") throw new Error("采购单未入库或已处理，不能走采购入库冲销。");

  const movements = database.prepare(`
    SELECT *
    FROM inventory_movements
    WHERE item_type = 'material'
      AND movement_type = 'purchase_inbound'
      AND source_type = 'purchase_order'
      AND source_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(purchase.id) as Array<{
    id: string;
    item_id: string;
    batch_no: string;
    qty: number;
    unit_cost: number;
  }>;
  if (movements.length === 0) throw new Error("采购单缺少入库流水，不能冲销。");

  for (const movement of movements) {
    const batch = database.prepare(`
      SELECT id, qty
      FROM material_batches
      WHERE material_id = ? AND batch_no = ? AND qty >= ?
      ORDER BY received_at DESC
      LIMIT 1
    `).get(movement.item_id, movement.batch_no, movement.qty) as { id: string; qty: number } | undefined;
    if (!batch) throw new Error("采购入库批次已被领用或库存不足，不能直接冲销。");
  }

  const reversal = insertDocumentReversal(database, actorId, {
    documentType: "purchase_order",
    documentId: purchase.id,
    documentNo: purchase.purchase_no,
    originalStatus: purchase.status,
    reversalType: "purchase_inbound",
    reason,
  });

  const touchedMaterialIds = new Set<string>();
  for (const movement of movements) {
    const batch = database.prepare(`
      SELECT id, qty
      FROM material_batches
      WHERE material_id = ? AND batch_no = ? AND qty >= ?
      ORDER BY received_at DESC
      LIMIT 1
    `).get(movement.item_id, movement.batch_no, movement.qty) as { id: string; qty: number };
    const nextQty = roundQty(Number(batch.qty) - Number(movement.qty));
    database.prepare(`
      UPDATE material_batches
      SET qty = ?,
          status = CASE WHEN ? <= 0 THEN 'reversed' ELSE status END,
          last_movement_at = ?
      WHERE id = ?
    `).run(nextQty, nextQty, reversal.reversedAt, batch.id);
    database.prepare(`
      INSERT INTO inventory_movements (
        id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
      )
      VALUES (?, 'material', ?, ?, ?, ?, 'purchase_inbound_reversal', 'document_reversal', ?, ?)
    `).run(
      uid("MV"),
      movement.item_id,
      movement.batch_no,
      -Math.abs(Number(movement.qty)),
      movement.unit_cost,
      reversal.reversalId,
      reversal.reversedAt,
    );
    touchedMaterialIds.add(movement.item_id);
  }
  for (const materialId of touchedMaterialIds) {
    recalculateMaterialInventory(database, materialId, reversal.reversedAt);
  }

  const payable = database.prepare("SELECT * FROM payables WHERE purchase_order_id = ?").get(purchase.id) as
    | {
        id: string;
        payable_no: string;
        total_amount: number;
        paid_amount: number;
        balance_amount: number;
        status: string;
      }
    | undefined;
  if (payable && payable.status !== "reversed") {
    insertLedgerRedOffset(database, actorId, {
      ledgerType: "payable",
      ledgerId: payable.id,
      ledgerNo: payable.payable_no,
      sourceDocumentType: "purchase_order",
      sourceDocumentId: purchase.id,
      reversalId: reversal.reversalId,
      originalAmount: payable.total_amount,
      settledAmount: payable.paid_amount,
      reason,
    });
    database.prepare(`
      UPDATE payables
      SET balance_amount = 0,
          status = 'reversed',
          settled_at = ?
      WHERE id = ?
    `).run(reversal.reversedAt, payable.id);
  }

  database.prepare("UPDATE purchase_orders SET status = 'reversed' WHERE id = ?").run(purchase.id);
}

function reverseShipment(database: Database.Database, actorId: string, shipmentId: string, reason: string) {
  const shipment = database.prepare("SELECT * FROM shipments WHERE id = ?").get(shipmentId) as
    | {
        id: string;
        shipment_no: string;
        status: string;
        order_id: string;
        production_order_id: string;
        shipped_qty: number;
      }
    | undefined;
  if (!shipment) throw new Error("发货单不存在。");
  if (shipment.status !== "shipped") throw new Error("发货单未发货或已处理，不能走销售发货冲销。");

  const allocations = database.prepare(`
    SELECT *
    FROM finished_shipment_allocations
    WHERE shipment_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(shipment.id) as Array<{
    id: string;
    finished_batch_id: string;
    production_order_id: string;
    batch_no: string;
    qty: number;
    unit_cost: number;
  }>;
  if (allocations.length === 0) throw new Error("发货单缺少成品出库分配，不能冲销。");

  const reversal = insertDocumentReversal(database, actorId, {
    documentType: "shipment",
    documentId: shipment.id,
    documentNo: shipment.shipment_no,
    originalStatus: shipment.status,
    reversalType: "sales_shipment",
    reason,
  });

  const product = database.prepare("SELECT product_id FROM orders WHERE id = ?").get(shipment.order_id) as
    | { product_id: string }
    | undefined;
  if (!product) throw new Error("发货订单不存在，不能冲销。");

  for (const allocation of allocations) {
    database.prepare(`
      UPDATE finished_batches
      SET qty = ROUND(qty + ?, 3),
          status = 'available'
      WHERE id = ?
    `).run(allocation.qty, allocation.finished_batch_id);
    database.prepare(`
      INSERT INTO inventory_movements (
        id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
      )
      VALUES (?, 'product', ?, ?, ?, ?, 'shipment_outbound_reversal', 'document_reversal', ?, ?)
    `).run(
      uid("MV"),
      product.product_id,
      allocation.batch_no,
      Math.abs(Number(allocation.qty)),
      allocation.unit_cost,
      reversal.reversalId,
      reversal.reversedAt,
    );
  }

  const receivable = database.prepare("SELECT * FROM receivables WHERE shipment_id = ?").get(shipment.id) as
    | {
        id: string;
        receivable_no: string;
        total_amount: number;
        received_amount: number;
        balance_amount: number;
        status: string;
      }
    | undefined;
  if (receivable && receivable.status !== "reversed") {
    insertLedgerRedOffset(database, actorId, {
      ledgerType: "receivable",
      ledgerId: receivable.id,
      ledgerNo: receivable.receivable_no,
      sourceDocumentType: "shipment",
      sourceDocumentId: shipment.id,
      reversalId: reversal.reversalId,
      originalAmount: receivable.total_amount,
      settledAmount: receivable.received_amount,
      reason,
    });
    database.prepare(`
      UPDATE receivables
      SET balance_amount = 0,
          status = 'reversed',
          settled_at = ?
      WHERE id = ?
    `).run(reversal.reversedAt, receivable.id);
  }

  database.prepare("UPDATE shipments SET status = 'reversed', financial_status = 'reversed' WHERE id = ?").run(shipment.id);
  refreshOrderShipmentStatus(database, shipment.order_id, shipment.production_order_id);
}

function refreshOrderShipmentStatus(database: Database.Database, orderId: string, productionOrderId: string) {
  const order = database.prepare("SELECT qty FROM orders WHERE id = ?").get(orderId) as { qty: number } | undefined;
  if (!order) throw new Error("订单不存在，无法刷新发货状态。");
  const shippedQty = (database.prepare(`
    SELECT COALESCE(SUM(shipped_qty), 0) AS qty
    FROM shipments
    WHERE order_id = ?
      AND status = 'shipped'
      AND COALESCE(shipment_type, 'standard') = 'standard'
  `).get(orderId) as { qty: number }).qty;
  const orderStatus = shippedQty <= 0 ? "in_production" : shippedQty >= Number(order.qty) ? "shipped" : "partial_shipped";
  const productionStatus = shippedQty <= 0 ? "in_stock" : shippedQty >= Number(order.qty) ? "shipped" : "partial_shipped";
  database.prepare("UPDATE orders SET status = ? WHERE id = ?").run(orderStatus, orderId);
  database.prepare("UPDATE production_orders SET status = ? WHERE id = ?").run(productionStatus, productionOrderId);
}

function passwordFromPayload(payload: Record<string, unknown> | undefined, key: string, label: string) {
  const password = payloadText(payload ?? {}, key, label);
  if (password.length < 6) throw new Error(`${label}至少需要 6 位。`);
  return password;
}

function changeOwnPassword(database: Database.Database, actorId: string, rawPayload?: Record<string, unknown>) {
  const user = database.prepare("SELECT * FROM users WHERE id = ?").get(actorId) as UserRow | undefined;
  if (!user) throw new Error("用户不存在。");
  const currentPassword = passwordFromPayload(rawPayload, "current_password", "当前密码");
  const newPassword = passwordFromPayload(rawPayload, "new_password", "新密码");
  const ok = user.password_hash
    ? verifyPassword(currentPassword, user.password_hash)
    : currentPassword === user.password;
  if (!ok) throw new Error("当前密码不正确。");
  const changedAt = now();
  database.prepare("UPDATE users SET password_hash = ?, password = '', password_changed_at = ? WHERE id = ?").run(
    hashPassword(newPassword),
    changedAt,
    user.id,
  );
  audit(database, actorId, "changeOwnPassword", "user", user.id, "用户修改本人密码");
}

function upsertUser(
  database: Database.Database,
  actorId: string,
  userId: string | undefined,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const username = payloadText(payload, "username", "登录账号").toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error("登录账号需为 3-32 位小写字母、数字、点、横线或下划线。");
  }
  const name = payloadText(payload, "name", "姓名");
  const role = roleValue(payloadText(payload, "role", "角色"));
  const status = payloadStatus(payload);
  const title = payloadText(payload, "title", "岗位说明", false) || roleLabel(role);
  const password = payloadText(payload, "new_password", "初始密码", false);
  const timestamp = now();

  const duplicate = database
    .prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?")
    .get(username, userId ?? "") as { id: string } | undefined;
  if (duplicate) throw new Error("登录账号已存在。");

  if (userId) {
    const existing = database.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    if (!existing) throw new Error("用户不存在。");
    if (actorId === userId && (status !== "active" || role !== "admin")) {
      throw new Error("不能停用当前登录账号或移除当前管理员角色。");
    }

    database.prepare(`
      UPDATE users
      SET username = ?, name = ?, role = ?, role_label = ?, status = ?, title = ?
      WHERE id = ?
    `).run(username, name, role, roleLabel(role), status, title, userId);

    if (password) {
      if (password.length < 6) throw new Error("初始密码至少需要 6 位。");
      database.prepare("UPDATE users SET password_hash = ?, password = '', password_changed_at = ? WHERE id = ?").run(
        hashPassword(password),
        timestamp,
        userId,
      );
      database.prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(timestamp, userId);
    }
    if (status === "inactive") {
      database.prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(timestamp, userId);
    }
    audit(database, actorId, "upsertUser", "user", userId, `更新用户 ${name} / ${roleLabel(role)} / ${status === "active" ? "启用" : "停用"}`);
    return;
  }

  const newPassword = password || "Welcome@2026";
  if (newPassword.length < 6) throw new Error("初始密码至少需要 6 位。");
  const id = uid("USR");
  database.prepare(`
    INSERT INTO users (
      id, username, name, role, role_label, password, password_hash,
      status, password_changed_at, title
    )
    VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)
  `).run(id, username, name, role, roleLabel(role), hashPassword(newPassword), status, timestamp, title);
  audit(database, actorId, "upsertUser", "user", id, `新增用户 ${name} / ${roleLabel(role)} / ${status === "active" ? "启用" : "停用"}`);
}

function resetUserPassword(
  database: Database.Database,
  actorId: string,
  userId: string,
  rawPayload?: Record<string, unknown>,
) {
  const user = database.prepare("SELECT id, username, name FROM users WHERE id = ?").get(userId) as
    | { id: string; username: string; name: string }
    | undefined;
  if (!user) throw new Error("用户不存在。");
  const newPassword = passwordFromPayload(rawPayload, "new_password", "新密码");
  const changedAt = now();
  database.prepare("UPDATE users SET password_hash = ?, password = '', password_changed_at = ? WHERE id = ?").run(
    hashPassword(newPassword),
    changedAt,
    user.id,
  );
  database.prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(changedAt, user.id);
  audit(database, actorId, "resetUserPassword", "user", user.id, `重置用户密码 ${user.name}`);
}

function updateUserStatus(
  database: Database.Database,
  actorId: string,
  userId: string,
  rawPayload?: Record<string, unknown>,
) {
  if (actorId === userId) throw new Error("不能停用当前登录账号。");
  const status = payloadText(rawPayload ?? {}, "status", "账号状态");
  if (!["active", "inactive"].includes(status)) throw new Error("账号状态只能是 active 或 inactive。");
  const user = database.prepare("SELECT id, name FROM users WHERE id = ?").get(userId) as
    | { id: string; name: string }
    | undefined;
  if (!user) throw new Error("用户不存在。");
  const timestamp = now();
  database.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, user.id);
  if (status === "inactive") {
    database.prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(timestamp, user.id);
  }
  audit(database, actorId, "updateUserStatus", "user", user.id, `${status === "active" ? "启用" : "停用"}用户 ${user.name}`);
}

const protectedAdminPermissionActions = new Set(["upsertUser", "upsertRolePermission", "resetUserPassword", "updateUserStatus"]);

function upsertRolePermission(database: Database.Database, actorId: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const role = roleValue(payloadText(payload, "role", "角色"));
  const action = payloadText(payload, "action", "权限动作");
  if (!roleActionMap[action]) throw new Error("权限动作不存在。");
  const enabled = booleanPayload(payload, "enabled", true) ? 1 : 0;
  if (role === "admin" && protectedAdminPermissionActions.has(action) && !enabled) {
    throw new Error("系统管理员核心权限不能关闭。");
  }

  ensureRolePermissionDefaults(database);
  const reason = payloadText(payload, "reason", "调整原因", false);
  const timestamp = now();
  database.prepare(`
    UPDATE role_permissions
    SET enabled = ?,
        description = ?,
        updated_by = ?,
        updated_at = ?
    WHERE role = ? AND action = ?
  `).run(enabled, reason, actorId, timestamp, role, action);
  audit(
    database,
    actorId,
    "upsertRolePermission",
    "role_permission",
    `${role}:${action}`,
    `${enabled ? "启用" : "停用"}${roleLabel(role)}权限 ${actionLabels[action] ?? action}${reason ? `：${reason}` : ""}`,
  );
}

function createFormulaCalculation(database: Database.Database, actorId: string) {
  const formulaId = uid("FC");
  const formulaNo = serial(database, "formula_price_calculations", "PF");
  const recipe = [
    { materialId: "M-STEEL", qty: 1 },
    { materialId: "M-COATING", qty: 0.04 },
    { materialId: "M-PACK", qty: 0.1 },
  ];
  const materials = database.prepare(`
    SELECT id, name, unit, average_cost
    FROM materials
    WHERE id IN (${recipe.map(() => "?").join(",")})
  `).all(...recipe.map((item) => item.materialId)) as Array<{
    id: string;
    name: string;
    unit: string;
    average_cost: number;
  }>;
  const byId = new Map(materials.map((material) => [material.id, material]));
  const missing = recipe.find((item) => !byId.has(item.materialId));
  if (missing) throw new Error(`缺少配方物料 ${missing.materialId}。`);

  const totalQty = roundQty(recipe.reduce((sum, item) => sum + item.qty, 0));
  const materialCost = roundMoney(
    recipe.reduce((sum, item) => sum + item.qty * Number(byId.get(item.materialId)?.average_cost ?? 0), 0),
  );
  const processFee = 18;
  const lossRate = 0.03;
  const marginRate = 0.22;
  const quotedUnitPrice = roundMoney((materialCost * (1 + lossRate) + processFee) * (1 + marginRate));
  const totalPrice = roundMoney(quotedUnitPrice * 100);

  database.prepare(`
    INSERT INTO formula_price_calculations (
      id, formula_no, formula_name, total_qty, unit, material_cost,
      process_fee, loss_rate, margin_rate, quoted_unit_price, total_price,
      created_by, created_at, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    formulaId,
    formulaNo,
    "授权试算配方",
    totalQty,
    "件",
    materialCost,
    processFee,
    lossRate,
    marginRate,
    quotedUnitPrice,
    totalPrice,
    actorId,
    now(),
    "按当前系统原材料移动均价自动试算，采购价格变化后重新试算会得到新价格。",
  );

  const insertLine = database.prepare(`
    INSERT INTO formula_price_lines (
      id, calculation_id, material_id, material_name, qty, unit,
      average_cost, line_cost, ratio
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  recipe.forEach((item) => {
    const material = byId.get(item.materialId);
    if (!material) return;
    insertLine.run(
      uid("FCL"),
      formulaId,
      material.id,
      material.name,
      item.qty,
      material.unit,
      material.average_cost,
      roundMoney(item.qty * material.average_cost),
      totalQty > 0 ? item.qty / totalQty : 0,
    );
  });
  audit(database, actorId, "createFormulaCalculation", "formula", formulaId, `试算配方 ${formulaNo}，单价 ${quotedUnitPrice}`);
}

function inventoryDispositionStatus(payload: Record<string, unknown>) {
  const status = payloadText(payload, "status", "处置状态", false) || "tracking";
  if (["pending", "tracking", "closed"].includes(status)) return status;
  throw new Error("处置状态只能是 pending、tracking 或 closed。");
}

function defaultInventoryActionPlan(level: string) {
  if (level === "overstock") {
    return "纳入6个月积压库存报表，安排采购、仓库、生产共同评估替代消耗、退换货或报废处理。";
  }
  return "纳入3个月未动库存预警，优先检查后续订单需求、BOM可替代用量与采购计划。";
}

function recordInventoryAgingDisposition(
  database: Database.Database,
  actorId: string,
  materialId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const material = database.prepare(`
    SELECT id, name, last_movement_at, stock_qty
    FROM materials
    WHERE id = ?
  `).get(materialId) as
    | { id: string; name: string; last_movement_at?: string | null; stock_qty: number }
    | undefined;
  if (!material) throw new Error("库存物料不存在。");
  if (Number(material.stock_qty ?? 0) <= 0) throw new Error("当前物料无库存，不需要登记积压处置。");

  const aging = classifyInventoryAging({ lastMovementAt: material.last_movement_at ?? "" });
  if (aging.status === "normal") throw new Error("该物料未达到3个月未动或6个月积压规则。");

  const status = inventoryDispositionStatus(payload);
  const ownerId = payloadText(payload, "owner_id", "责任人", false) || actorId;
  const owner = database.prepare("SELECT id, name FROM users WHERE id = ? AND status = 'active'").get(ownerId) as
    | { id: string; name: string }
    | undefined;
  if (!owner) throw new Error("请选择有效的处置责任人。");
  const actionPlan = payloadText(payload, "action_plan", "处置方案", false) || defaultInventoryActionPlan(aging.status);
  const note = payloadText(payload, "note", "处置说明", false);
  const timestamp = now();
  const dispositionId = uid("IAD");

  database.prepare(`
    INSERT INTO inventory_aging_dispositions (
      id, material_id, batch_id, aging_level, inactive_days, status,
      owner_id, action_plan, note, created_by, created_at, closed_at
    )
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dispositionId,
    material.id,
    aging.status,
    aging.inactiveDays,
    status,
    owner.id,
    actionPlan,
    note,
    actorId,
    timestamp,
    status === "closed" ? timestamp : null,
  );
  audit(
    database,
    actorId,
    "recordInventoryAgingDisposition",
    "inventory_aging",
    dispositionId,
    `${aging.status === "overstock" ? "积压库存" : "呆滞预警"}处置登记：${material.name}，责任人 ${owner.name}`,
  );
}

function createStocktake(database: Database.Database, actorId: string, rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const materialId = payloadText(payload, "material_id", "盘点物料");
  const material = database.prepare(`
    SELECT id, name, unit, stock_qty, average_cost
    FROM materials
    WHERE id = ? AND status = 'active'
  `).get(materialId) as
    | { id: string; name: string; unit: string; stock_qty: number; average_cost: number }
    | undefined;
  if (!material) throw new Error("请选择有效的启用物料。");

  const actualQty = roundQty(payloadNumber(payload, "actual_qty", "实盘数量", { min: 0 }));
  const countedAt = payloadDate(payload, "counted_at", "盘点日期", new Date().toISOString().slice(0, 10));
  const remark = payloadText(payload, "remark", "盘点说明", false) || "仓库按实物盘点结果录入，待管理层审批后调整库存。";
  const bookQty = roundQty(Number(material.stock_qty ?? 0));
  const unitCost = roundMoney(Number(material.average_cost ?? 0));
  const differenceQty = roundQty(actualQty - bookQty);
  const stocktakeId = uid("ST");
  const stocktakeNo = serial(database, "stocktakes", "PD");
  const createdAt = now();

  database.prepare(`
    INSERT INTO stocktakes (
      id, stocktake_no, material_id, book_qty, actual_qty, difference_qty,
      unit_cost, adjustment_amount, status, counted_by, counted_at,
      remark, created_at, approved_by, approved_at, approval_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, NULL, NULL, '')
  `).run(
    stocktakeId,
    stocktakeNo,
    material.id,
    bookQty,
    actualQty,
    differenceQty,
    unitCost,
    roundMoney(differenceQty * unitCost),
    actorId,
    countedAt,
    remark,
    createdAt,
  );
  audit(database, actorId, "createStocktake", "stocktake", stocktakeId, `录入库存盘点单 ${stocktakeNo}：${material.name}`);
}

function approveStocktake(
  database: Database.Database,
  actorId: string,
  stocktakeId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const stocktake = database.prepare(`
    SELECT st.*, m.name AS material_name, m.average_cost
    FROM stocktakes st
    JOIN materials m ON m.id = st.material_id
    WHERE st.id = ?
  `).get(stocktakeId) as
    | {
        id: string;
        stocktake_no: string;
        material_id: string;
        material_name: string;
        actual_qty: number;
        difference_qty: number;
        unit_cost: number;
        status: string;
        counted_at: string;
      }
    | undefined;
  if (!stocktake || stocktake.status !== "pending_approval") throw new Error("盘点单不存在或不是待审批状态。");

  const approvalNote =
    payloadText(payload, "approval_note", "审批意见", false) || "管理层已复核账实差异，同意按盘点单调整库存。";
  const approvedAt = now();
  const movementAt = `${String(stocktake.counted_at).slice(0, 10)}T00:00:00.000Z`;
  const differenceQty = roundQty(Number(stocktake.difference_qty ?? 0));
  if (differenceQty > 0) {
    applyStocktakeGain(database, stocktake.material_id, stocktake.stocktake_no, differenceQty, Number(stocktake.unit_cost ?? 0), movementAt, stocktake.id);
  } else if (differenceQty < 0) {
    applyStocktakeLoss(database, stocktake.material_id, Math.abs(differenceQty), movementAt, stocktake.id);
  }

  if (differenceQty !== 0) {
    recalculateMaterialInventory(database, stocktake.material_id, movementAt);
  } else {
    database.prepare("UPDATE materials SET last_movement_at = ? WHERE id = ?").run(movementAt, stocktake.material_id);
  }
  database.prepare(`
    UPDATE stocktakes
    SET status = 'approved',
        approved_by = ?,
        approved_at = ?,
        approval_note = ?
    WHERE id = ?
  `).run(actorId, approvedAt, approvalNote, stocktake.id);
  audit(database, actorId, "approveStocktake", "stocktake", stocktake.id, `审批盘点调整 ${stocktake.stocktake_no}`);
}

function rejectStocktake(
  database: Database.Database,
  actorId: string,
  stocktakeId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const stocktake = database.prepare("SELECT * FROM stocktakes WHERE id = ?").get(stocktakeId) as
    | { id: string; stocktake_no: string; status: string }
    | undefined;
  if (!stocktake || stocktake.status !== "pending_approval") throw new Error("盘点单不存在或不是待审批状态。");
  const approvalNote = payloadText(payload, "approval_note", "驳回意见", false) || "盘点差异依据不充分，退回仓库复盘。";
  const rejectedAt = now();
  database.prepare(`
    UPDATE stocktakes
    SET status = 'rejected',
        approved_by = ?,
        approved_at = ?,
        approval_note = ?
    WHERE id = ?
  `).run(actorId, rejectedAt, approvalNote, stocktake.id);
  audit(database, actorId, "rejectStocktake", "stocktake", stocktake.id, `驳回盘点调整 ${stocktake.stocktake_no}`);
}

function applyStocktakeGain(
  database: Database.Database,
  materialId: string,
  stocktakeNo: string,
  qty: number,
  unitCost: number,
  movementAt: string,
  stocktakeId: string,
) {
  const batchId = uid("B");
  const batchNo = `${stocktakeNo}-PY`;
  database.prepare(`
    INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at, last_movement_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(batchId, materialId, batchNo, qty, unitCost, movementAt, movementAt);
  database.prepare(`
    INSERT INTO inventory_movements (
      id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
    )
    VALUES (?, 'material', ?, ?, ?, ?, 'stocktake_gain', 'stocktake', ?, ?)
  `).run(uid("MV"), materialId, batchNo, qty, unitCost, stocktakeId, movementAt);
}

function applyStocktakeLoss(
  database: Database.Database,
  materialId: string,
  qty: number,
  movementAt: string,
  stocktakeId: string,
) {
  let remaining = roundQty(qty);
  const batches = database.prepare(`
    SELECT id, batch_no, qty, unit_cost
    FROM material_batches
    WHERE material_id = ? AND qty > 0
    ORDER BY received_at ASC
  `).all(materialId) as Array<{ id: string; batch_no: string; qty: number; unit_cost: number }>;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const adjustedQty = roundQty(Math.min(batch.qty, remaining));
    const nextQty = roundQty(batch.qty - adjustedQty);
    database.prepare(`
      UPDATE material_batches
      SET qty = ?, last_movement_at = ?, status = CASE WHEN ? <= 0 THEN 'depleted' ELSE status END
      WHERE id = ?
    `).run(nextQty, movementAt, nextQty, batch.id);
    database.prepare(`
      INSERT INTO inventory_movements (
        id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
      )
      VALUES (?, 'material', ?, ?, ?, ?, 'stocktake_loss', 'stocktake', ?, ?)
    `).run(uid("MV"), materialId, batch.batch_no, -adjustedQty, batch.unit_cost, stocktakeId, movementAt);
    remaining = roundQty(remaining - adjustedQty);
  }
  if (remaining > 0) throw new Error(`盘亏数量超过可用批次库存，差额 ${remaining}。`);
}

export function importBomRows(input: {
  actorId: string;
  productId: string;
  rows: Array<Record<string, unknown>>;
}) {
  const database = getDb();
  requireRole(database, input.actorId, ["production", "admin"]);
  const bom = database.prepare("SELECT * FROM boms WHERE product_id = ? AND status = 'active'").get(input.productId) as
    | { id: string }
    | undefined;
  if (!bom) throw new Error("未找到产品的启用 BOM。");
  const lines = input.rows.map((row, index) => {
    const parentProductId = String(row.parentProductId ?? row["父级产品ID"] ?? "").trim();
    const componentType = String(row.componentType ?? row["组件类型"] ?? "").trim() as "material" | "product";
    const componentId = String(row.componentId ?? row["组件ID"] ?? "").trim();
    const qtyPer = Number(row.qtyPer ?? row["单位用量"]);
    const isPrimary = String(row.isPrimary ?? row["主材"] ?? "").toLowerCase();
    if (!parentProductId || !componentId || !["material", "product"].includes(componentType) || !Number.isFinite(qtyPer)) {
      throw new Error(`BOM 第 ${index + 1} 行格式不正确。`);
    }
    return { parentProductId, componentType, componentId, qtyPer, isPrimary: ["1", "true", "是", "yes"].includes(isPrimary) };
  });

  database.transaction(() => {
    database.prepare("DELETE FROM bom_lines WHERE bom_id = ?").run(bom.id);
    const insert = database.prepare(`
      INSERT INTO bom_lines (bom_id, parent_product_id, component_type, component_id, qty_per, is_primary)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const line of lines) {
      insert.run(bom.id, line.parentProductId, line.componentType, line.componentId, line.qtyPer, line.isPrimary ? 1 : 0);
    }
    audit(database, input.actorId, "importBom", "bom", bom.id, `Excel 导入 BOM ${lines.length} 行`);
  })();
}

export async function workbookRowsFromBuffer(buffer: Buffer, fileName = "bom.xlsx") {
  if (fileName.toLowerCase().endsWith(".csv")) {
    return csvToRows(buffer.toString("utf8"));
  }

  const sheetRows = readXlsxRows(buffer);
  if (sheetRows.length === 0) return [];

  const headers = sheetRows[0].map((value) => String(value ?? "").trim());
  const rows: Array<Record<string, unknown>> = [];

  for (const values of sheetRows.slice(1)) {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = xlsxCellToPrimitive(values[index]);
    });
    if (Object.values(record).some((value) => String(value ?? "").trim() !== "")) {
      rows.push(record);
    }
  }

  return rows;
}

export async function buildExport(input: {
  actorId: string;
  type:
    | "finance"
    | "quote"
    | "shipment"
    | "ledger"
    | "delivery-note"
    | "sales-statement"
    | "purchase-statement"
    | "purchase-contract"
    | "purchase-arrival-notice"
    | "purchase-arrival-change-log"
    | "purchase-arrival-discrepancy"
    | "warehouse-signoff"
    | "purchase-receipt"
    | "material-issue"
    | "material-adjustment-order"
    | "stocktake"
    | "production-plan"
    | "sales-return"
    | "customer-refund"
    | "replacement-shipment"
    | "inventory-trace"
    | "business-daily"
    | "inventory-daily"
    | "inventory-overstock"
    | "supplier-discrepancy"
    | "supplier-performance"
    | "material-adjustment-cost-impact"
    | "cost-anomaly-analysis"
    | "quality-exception"
    | "business-weekly"
    | "business-monthly"
    | "master-customers"
    | "master-suppliers"
    | "master-materials"
    | "master-products"
    | "master-boms"
    | "master-template-customers"
    | "master-template-suppliers"
    | "master-template-materials"
    | "master-template-products"
    | "master-template-boms"
    | "opening-template-opening-inventory"
    | "opening-template-opening-receivables"
    | "opening-template-opening-payables";
  format: "xlsx" | "csv";
  entityId?: string;
  filters?: ReportFilters;
}) {
  const database = getDb();
  const user = getUser(database, input.actorId);
  const filters = normalizeReportFilters(input.filters);
  if (!["finance", "manager", "admin", "sales", "assistant", "purchasing", "production", "warehouse", "quality", "technical"].includes(user.role)) {
    throw new Error("当前角色无导出权限。");
  }
  if (["finance", "ledger"].includes(input.type) && !["finance", "manager", "admin"].includes(user.role)) {
    throw new Error("只有财务、管理层或管理员可导出财务数据。");
  }

  const sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }> = [];
  if (input.type === "finance") {
    sheets.push({ name: "orders", rows: rows(database.prepare(`
      SELECT o.order_no, c.name AS customer, p.name AS product, o.qty, o.status, q.total_amount, o.created_at
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN products p ON p.id = o.product_id
      JOIN quotes q ON q.id = o.quote_id
      ORDER BY o.created_at DESC
    `).all()) });
    sheets.push({ name: "material_movements", rows: rows(database.prepare(`
      SELECT movement_type, item_id, batch_no, qty, unit_cost, source_type, source_id, created_at
      FROM inventory_movements
      ORDER BY created_at DESC
    `).all()) });
    sheets.push({ name: "stock", rows: rows(database.prepare(`
      SELECT id, name, unit, stock_qty, average_cost, ROUND(stock_qty * average_cost, 2) AS stock_value
      FROM materials
      ORDER BY id
    `).all()) });
  }

  if (input.type === "quote") {
    sheets.push({ name: "quote", rows: rows(database.prepare(`
      SELECT q.quote_no, c.name AS customer, p.name AS product, q.qty, q.version,
             q.material_cost, q.process_fee, q.margin_rate, q.total_amount, q.status
      FROM quotes q
      JOIN customers c ON c.id = q.customer_id
      JOIN products p ON p.id = q.product_id
      WHERE q.id = COALESCE(?, q.id)
    `).all(input.entityId ?? null)) });
  }

  if (input.type === "shipment") {
    sheets.push({ name: "shipment", rows: rows(database.prepare(`
      SELECT s.shipment_no, o.order_no, c.name AS customer, p.name AS product,
             s.shipped_qty, s.sales_amount, s.cost_amount, s.gross_profit,
             s.gross_margin, s.financial_status,
             s.delivery_address, s.consignee, s.contact_phone,
             s.logistics_company, s.vehicle_no, s.tracking_no, s.remark,
             s.status, s.shipped_at
      FROM shipments s
      JOIN orders o ON o.id = s.order_id
      JOIN customers c ON c.id = o.customer_id
      JOIN production_orders po ON po.id = s.production_order_id
      JOIN products p ON p.id = o.product_id
      WHERE s.id = COALESCE(?, s.id)
      ORDER BY s.created_at DESC
    `).all(input.entityId ?? null)) });
    sheets.push({ name: "finished_allocations", rows: rows(database.prepare(`
      SELECT s.shipment_no, fsa.batch_no, fsa.qty, fsa.unit_cost, fsa.cost_amount, fsa.created_at
      FROM finished_shipment_allocations fsa
      JOIN shipments s ON s.id = fsa.shipment_id
      WHERE s.id = COALESCE(?, s.id)
      ORDER BY fsa.created_at DESC
    `).all(input.entityId ?? null)) });
  }

  if (input.type === "ledger") {
    sheets.push({ name: "receivables", rows: ledgerReceivableRows(database) });
    sheets.push({ name: "payables", rows: ledgerPayableRows(database) });
    sheets.push({ name: "receipts", rows: rows(database.prepare(`
      SELECT rr.received_at, r.receivable_no, rr.amount, rr.method, rr.note
      FROM receivable_receipts rr
      JOIN receivables r ON r.id = rr.receivable_id
      ORDER BY rr.received_at DESC
    `).all()) });
    sheets.push({ name: "payments", rows: rows(database.prepare(`
      SELECT pp.paid_at, p.payable_no, pp.amount, pp.method, pp.note
      FROM payable_payments pp
      JOIN payables p ON p.id = pp.payable_id
      ORDER BY pp.paid_at DESC
    `).all()) });
  }

  if (input.type === "delivery-note") {
    sheets.push({ name: "delivery_note", rows: deliveryNoteRows(database, input.entityId) });
  }

  if (input.type === "sales-statement") {
    sheets.push({ name: "sales_statement", rows: ledgerReceivableRows(database, input.entityId, filters) });
  }

  if (input.type === "purchase-statement") {
    sheets.push({ name: "purchase_statement", rows: ledgerPayableRows(database, input.entityId, filters) });
  }

  if (input.type === "purchase-contract") {
    sheets.push({ name: "purchase_contract", rows: purchaseContractRows(database, input.entityId) });
  }

  if (input.type === "purchase-arrival-notice") {
    sheets.push({ name: "purchase_arrival_notice", rows: purchaseArrivalNoticeRows(database, input.entityId) });
  }

  if (input.type === "purchase-arrival-change-log") {
    sheets.push({ name: "purchase_arrival_change_log", rows: purchaseArrivalNoticeChangeLogRows(database, input.entityId, filters) });
  }

  if (input.type === "purchase-arrival-discrepancy") {
    sheets.push({ name: "purchase_arrival_discrepancy", rows: purchaseArrivalDiscrepancyRows(database, input.entityId, filters) });
  }

  if (input.type === "warehouse-signoff") {
    sheets.push({ name: "warehouse_signoff", rows: warehouseSignoffRows(database, input.entityId) });
  }

  if (input.type === "purchase-receipt") {
    sheets.push({ name: "purchase_receipt", rows: purchaseReceiptRows(database, input.entityId) });
  }

  if (input.type === "material-issue") {
    sheets.push({ name: "material_issue", rows: materialIssueRows(database, input.entityId) });
  }

  if (input.type === "material-adjustment-order") {
    sheets.push({ name: "material_adjustment_order", rows: materialAdjustmentOrderRows(database, input.entityId, filters) });
  }

  if (input.type === "stocktake") {
    sheets.push({ name: "stocktake", rows: stocktakeRows(database, input.entityId) });
    sheets.push({ name: "inventory_trace", rows: inventoryTraceRows(database, input.entityId) });
  }

  if (input.type === "production-plan") {
    sheets.push({ name: "production_plan", rows: productionPlanRows(database, filters) });
    sheets.push({ name: "schedule_calendar", rows: productionScheduleCalendarRows(database, filters) });
    sheets.push({ name: "delivery_warnings", rows: productionDeliveryWarningExportRows(database, filters) });
  }

  if (input.type === "sales-return") {
    sheets.push({ name: "sales_return", rows: salesReturnRows(database, input.entityId) });
    sheets.push({ name: "return_allocations", rows: salesReturnAllocationRows(database, input.entityId) });
  }

  if (input.type === "customer-refund") {
    sheets.push({ name: "customer_refund", rows: customerRefundRows(database, input.entityId) });
  }

  if (input.type === "replacement-shipment") {
    sheets.push({ name: "replacement_shipment", rows: replacementShipmentRows(database, input.entityId) });
    sheets.push({ name: "finished_allocations", rows: replacementShipmentAllocationRows(database, input.entityId) });
  }

  if (input.type === "inventory-trace") {
    sheets.push({ name: "inventory_trace", rows: inventoryTraceRows(database, input.entityId, filters) });
  }

  if (input.type === "inventory-daily") {
    sheets.push({ name: "inventory_daily", rows: inventoryDailyRows(database, filters) });
    sheets.push({ name: "stale_warning", rows: inventoryAgingRows(database, "stale_warning", filters) });
    sheets.push({ name: "overstock", rows: inventoryAgingRows(database, "overstock", filters) });
  }

  if (input.type === "inventory-overstock") {
    sheets.push({ name: "inventory_overstock", rows: inventoryOverstockSummaryRows(database, filters) });
    sheets.push({ name: "stale_warning", rows: inventoryAgingRows(database, "stale_warning", filters) });
    sheets.push({ name: "overstock", rows: inventoryAgingRows(database, "overstock", filters) });
  }

  if (input.type === "business-daily" || input.type === "business-weekly" || input.type === "business-monthly") {
    const reportType = input.type === "business-daily" ? "daily" : input.type === "business-weekly" ? "weekly" : "monthly";
    sheets.push({ name: `business_${reportType}`, rows: businessReportRows(database, reportType, filters) });
    sheets.push({ name: "receivables", rows: ledgerReceivableRows(database, undefined, filters) });
    sheets.push({ name: "payables", rows: ledgerPayableRows(database, undefined, filters) });
    sheets.push({ name: "overstock", rows: inventoryAgingRows(database, "overstock", filters) });
  }

  if (input.type === "quality-exception") {
    sheets.push({ name: "quality_exception", rows: qualityExceptionRows(database, filters) });
    sheets.push({ name: "root_cause", rows: qualityRootCauseRows(database, filters) });
    sheets.push({ name: "disposition_type", rows: qualityDispositionTypeRows(database, filters) });
  }

  if (input.type === "supplier-discrepancy") {
    sheets.push({ name: "supplier_discrepancy_summary", rows: supplierDiscrepancySummaryRows(database, filters) });
    sheets.push({ name: "supplier_discrepancy_detail", rows: supplierDiscrepancyDetailRows(database, filters) });
  }

  if (input.type === "supplier-performance") {
    sheets.push({ name: "supplier_performance", rows: supplierPerformanceRows(database, filters) });
  }

  if (input.type === "material-adjustment-cost-impact") {
    sheets.push({ name: "material_adjustment_cost_impact", rows: materialAdjustmentCostImpactRows(database, input.entityId, filters) });
  }

  if (input.type === "cost-anomaly-analysis") {
    const analytics = costAnomalyAnalyticsRows(database, filters);
    sheets.push({ name: "cost_anomaly_summary", rows: costAnomalySummaryRows(database, filters) });
    sheets.push({ name: "cost_anomaly_detail", rows: analytics.detail });
    sheets.push({ name: "cost_anomaly_reason", rows: analytics.byReason });
    sheets.push({ name: "cost_anomaly_material", rows: analytics.byMaterial });
    sheets.push({ name: "cost_anomaly_responsibility", rows: analytics.byResponsibility });
    sheets.push({ name: "cost_anomaly_remediation", rows: costAnomalyRemediationRows(database) });
  }

  if (input.type.startsWith("master-template-")) {
    const masterType = input.type.replace("master-template-", "") as MasterDataType;
    sheets.push({ name: `${masterType}_template`, rows: masterTemplateRows(masterType) });
  }

  if (input.type.startsWith("opening-template-")) {
    const openingType = input.type.replace("opening-template-", "") as OpeningDataType;
    sheets.push({ name: `${openingType}_template`, rows: openingTemplateRows(openingType) });
  }

  if (input.type.startsWith("master-") && !input.type.startsWith("master-template-")) {
    const masterType = input.type.replace("master-", "") as MasterDataType;
    sheets.push({ name: `${masterType}_master`, rows: masterExportRows(database, masterType) });
  }

  if (isFormalReportExportType(input.type)) {
    upsertReportSnapshot(database, input.type, input.actorId, filters);
    if (input.format === "xlsx") {
      sheets.unshift({ name: "report_cover", rows: formalReportCoverRows(database, input.type, user, filters) });
    }
  }

  const fileBase = `${input.type}-${new Date().toISOString().slice(0, 10)}`;
  const fileName = `${fileBase}.${input.format}`;
  recordDocumentExport(database, {
    actorId: input.actorId,
    type: input.type,
    entityId: input.entityId,
    fileName,
  });
  if (input.format === "csv") {
    return {
      fileName,
      contentType: "text/csv; charset=utf-8",
      buffer: Buffer.from(`\ufeff${rowsToCsv(sheets[0]?.rows ?? [])}`),
    };
  }

  return {
    fileName,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buildXlsxBuffer(sheets),
  };
}

export function importMasterDataRows(input: {
  actorId: string;
  type: MasterDataType;
  rows: Array<Record<string, unknown>>;
  sourceName?: string;
}) {
  const database = getDb();
  const allowed: Record<MasterDataType, Role[]> = {
    customers: ["admin", "sales", "assistant"],
    suppliers: ["admin", "purchasing"],
    materials: ["admin", "purchasing", "warehouse"],
    products: ["admin", "production"],
    boms: ["admin", "production"],
  };
  requireRole(database, input.actorId, allowed[input.type]);
  if (!input.rows.length) throw new Error("导入文件没有可用数据行。");

  const validation = validateMasterDataRowsInternal(database, input);
  if (validation.errors.length > 0) {
    const result = recordInitializationImportBatch(database, {
      actorId: input.actorId,
      type: `master-${input.type}`,
      sourceName: input.sourceName,
      mode: "import",
      status: "validation_failed",
      importedRows: input.rows.length,
      validRows: validation.validRows,
      failedRows: validation.errors.length,
      totalAmount: 0,
      errors: validation.errors,
      note: "主数据导入校验失败，未写入业务数据。",
    });
    throw new ImportValidationError(result);
  }

  if (input.type === "boms") {
    const result = importMasterBomRows(database, input.actorId, input.rows);
    recordInitializationImportBatch(database, {
      actorId: input.actorId,
      type: "master-boms",
      sourceName: input.sourceName,
      mode: "import",
      status: "completed",
      importedRows: input.rows.length,
      validRows: input.rows.length,
      failedRows: 0,
      created: result.created,
      updated: result.updated,
      totalAmount: 0,
      errors: [],
      note: "BOM 主数据正式导入完成。",
    });
    return result;
  }

  const masterType = input.type as Exclude<MasterDataType, "boms">;
  const result = { importedRows: input.rows.length, created: 0, updated: 0 };
  database.transaction(() => {
    input.rows.forEach((row, index) => {
      const payload = masterPayloadFromRow(masterType, row, index);
      const existingId = findMasterExistingId(database, masterType, payload);
      if (masterType === "customers") upsertCustomer(database, input.actorId, existingId, payload);
      if (masterType === "suppliers") upsertSupplier(database, input.actorId, existingId, payload);
      if (masterType === "materials") upsertMaterial(database, input.actorId, existingId, payload);
      if (masterType === "products") upsertProduct(database, input.actorId, existingId, payload);
      if (existingId) result.updated += 1;
      else result.created += 1;
    });
  })();
  recordInitializationImportBatch(database, {
    actorId: input.actorId,
    type: `master-${input.type}`,
    sourceName: input.sourceName,
    mode: "import",
    status: "completed",
    importedRows: input.rows.length,
    validRows: input.rows.length,
    failedRows: 0,
    created: result.created,
    updated: result.updated,
    totalAmount: 0,
    errors: [],
    note: "主数据正式导入完成。",
  });
  return result;
}

export type OpeningDataType = "opening-inventory" | "opening-receivables" | "opening-payables";

type ImportValidationInput = {
  actorId: string;
  rows: Array<Record<string, unknown>>;
  sourceName?: string;
};

function recordInitializationImportBatch(
  database: Database.Database,
  input: {
    actorId: string;
    type: string;
    sourceName?: string;
    mode: "validate" | "import";
    status: "validated" | "validation_failed" | "completed";
    importedRows: number;
    validRows: number;
    failedRows: number;
    created?: number;
    updated?: number;
    totalAmount?: number;
    errors: ImportValidationErrorRow[];
    note?: string;
  },
): ImportValidationResult {
  const importId = uid("INIT");
  const importNo = serial(database, "initialization_imports", "DR");
  const createdAt = now();
  const errorSummary = input.errors
    .slice(0, 5)
    .map((error) => `第${error.rowNo}行 ${error.fieldName}：${error.message}`)
    .join("；");
  database.prepare(`
    INSERT INTO initialization_imports (
      id, import_no, type, status, imported_rows, created_count, updated_count,
      total_amount, actor_id, note, source_name, mode, valid_count, failed_count,
      error_summary, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    importId,
    importNo,
    input.type,
    input.status,
    input.importedRows,
    input.created ?? 0,
    input.updated ?? 0,
    roundMoney(input.totalAmount ?? 0),
    input.actorId,
    input.note ?? initializationImportTypeLabel(input.type),
    input.sourceName ?? "",
    input.mode,
    input.validRows,
    input.failedRows,
    errorSummary,
    createdAt,
  );
  const insertError = database.prepare(`
    INSERT INTO initialization_import_errors (
      id, import_id, row_no, field_name, message, raw_data_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  input.errors.forEach((error) => {
    insertError.run(
      uid("IERR"),
      importId,
      error.rowNo,
      error.fieldName,
      error.message,
      JSON.stringify(error.rawData ?? {}),
      createdAt,
    );
  });
  audit(
    database,
    input.actorId,
    input.mode === "validate" ? "validateInitializationImport" : "importInitializationData",
    "initialization_import",
    importId,
    `${initializationImportTypeLabel(input.type)}${input.mode === "validate" ? "预校验" : "导入"}：${input.validRows} 行通过，${input.failedRows} 行失败`,
  );
  return {
    ok: input.failedRows === 0,
    importId,
    importNo,
    type: input.type,
    sourceName: input.sourceName ?? "",
    status: input.status,
    importedRows: input.importedRows,
    validRows: input.validRows,
    failedRows: input.failedRows,
    created: input.created ?? 0,
    updated: input.updated ?? 0,
    totalAmount: roundMoney(input.totalAmount ?? 0),
    errors: input.errors,
  };
}

export function validateMasterDataRows(input: ImportValidationInput & { type: MasterDataType }) {
  const database = getDb();
  const allowed: Record<MasterDataType, Role[]> = {
    customers: ["admin", "sales", "assistant"],
    suppliers: ["admin", "purchasing"],
    materials: ["admin", "purchasing", "warehouse"],
    products: ["admin", "production"],
    boms: ["admin", "production"],
  };
  requireRole(database, input.actorId, allowed[input.type]);
  if (!input.rows.length) throw new Error("导入文件没有可用数据行。");
  const validation = validateMasterDataRowsInternal(database, input);
  return recordInitializationImportBatch(database, {
    actorId: input.actorId,
    type: `master-${input.type}`,
    sourceName: input.sourceName,
    mode: "validate",
    status: validation.errors.length > 0 ? "validation_failed" : "validated",
    importedRows: input.rows.length,
    validRows: validation.validRows,
    failedRows: validation.errors.length,
    totalAmount: 0,
    errors: validation.errors,
    note: "主数据导入预校验。",
  });
}

function validateMasterDataRowsInternal(
  database: Database.Database,
  input: ImportValidationInput & { type: MasterDataType },
) {
  const errors: ImportValidationErrorRow[] = [];
  const seen = new Set<string>();
  let validRows = 0;

  input.rows.forEach((row, index) => {
    const rowNo = index + 1;
    const rowErrors: ImportValidationErrorRow[] = [];
    try {
      if (input.type === "boms") {
        validateMasterBomRow(database, row, rowNo);
      } else {
        const masterType = input.type as Exclude<MasterDataType, "boms">;
        const payload = masterPayloadFromRow(masterType, row, index);
        validateMasterPayload(masterType, payload, rowNo);
        const payloadRecord = payload as Record<string, unknown>;
        const code = String(
          payloadRecord[
            {
              customers: "customer_code",
              suppliers: "supplier_code",
              materials: "material_code",
              products: "product_code",
            }[masterType]
          ] ?? "",
        );
        const codeKey = `${masterType}:${code.toLowerCase()}`;
        if (seen.has(codeKey)) {
          rowErrors.push({
            rowNo,
            fieldName: masterCodeField(masterType),
            message: `${code} 在本次导入文件中重复。`,
            rawData: row,
          });
        }
        seen.add(codeKey);
      }
    } catch (error) {
      rowErrors.push({
        rowNo,
        fieldName: masterErrorField(input.type, error instanceof Error ? error.message : ""),
        message: error instanceof Error ? error.message : "数据行校验失败。",
        rawData: row,
      });
    }

    if (rowErrors.length > 0) errors.push(...rowErrors);
    else validRows += 1;
  });

  return { validRows, errors };
}

function masterCodeField(type: Exclude<MasterDataType, "boms">) {
  return {
    customers: "customer_code",
    suppliers: "supplier_code",
    materials: "material_code",
    products: "product_code",
  }[type];
}

function validateMasterPayload(type: Exclude<MasterDataType, "boms">, payload: Record<string, unknown>, rowNo: number) {
  if (type === "materials") {
    payloadNumber(payload, "reorder_min_qty", `物料第 ${rowNo} 行安全库存`, { min: 0 });
  }
  if (type === "products") {
    payloadNumber(payload, "process_fee", `产品第 ${rowNo} 行加工费`, { min: 0 });
    payloadNumber(payload, "default_margin", `产品第 ${rowNo} 行默认利润率`, { min: 0 });
  }
}

function masterErrorField(type: MasterDataType, message: string) {
  if (message.includes("客户编码")) return "customer_code";
  if (message.includes("供应商编码")) return "supplier_code";
  if (message.includes("物料编码")) return "material_code";
  if (message.includes("产品编码")) return "product_code";
  if (message.includes("安全库存")) return "reorder_min_qty";
  if (message.includes("加工费")) return "process_fee";
  if (message.includes("利润率")) return "default_margin";
  if (message.includes("单位用量")) return "qty_per";
  if (message.includes("组件")) return "component_code";
  return type === "boms" ? "bom_line" : "row";
}

function validateMasterBomRow(database: Database.Database, row: Record<string, unknown>, rowNo: number) {
  const get = (keys: string[], fallback = "") => {
    for (const key of keys) {
      const value = row[key];
      if (String(value ?? "").trim() !== "") return String(value).trim();
    }
    return fallback;
  };
  const productCodeOrId = get(["product_code", "product_id", "产品编码", "产品ID"]);
  const parentCodeOrId = get(["parent_product_code", "parent_product_id", "父级产品编码", "父级产品ID"], productCodeOrId);
  const componentTypeRaw = get(["component_type", "组件类型"], "material");
  const componentCodeOrId = get(["component_code", "component_id", "组件编码", "组件ID", "物料编码"]);
  const qtyPer = Number(get(["qty_per", "单位用量"], "0"));
  resolveProduct(database, productCodeOrId);
  resolveProduct(database, parentCodeOrId);
  const componentType = componentTypeRaw === "product" || componentTypeRaw === "产品" ? "product" : "material";
  if (componentType === "product") resolveProduct(database, componentCodeOrId);
  else resolveMaterial(database, componentCodeOrId);
  if (!Number.isFinite(qtyPer) || qtyPer <= 0) throw new Error(`BOM 第 ${rowNo} 行单位用量必须大于 0。`);
}

export function importOpeningDataRows(input: {
  actorId: string;
  type: OpeningDataType;
  rows: Array<Record<string, unknown>>;
  note?: string;
  sourceName?: string;
}) {
  const database = getDb();
  const allowed: Record<OpeningDataType, Role[]> = {
    "opening-inventory": ["admin", "warehouse"],
    "opening-receivables": ["admin", "finance"],
    "opening-payables": ["admin", "finance", "purchasing"],
  };
  requireRole(database, input.actorId, allowed[input.type]);
  if (!input.rows.length) throw new Error("初始化导入文件没有可用数据行。");

  const validation = validateOpeningDataRowsInternal(database, input);
  if (validation.errors.length > 0) {
    const result = recordInitializationImportBatch(database, {
      actorId: input.actorId,
      type: input.type,
      sourceName: input.sourceName,
      mode: "import",
      status: "validation_failed",
      importedRows: input.rows.length,
      validRows: validation.validRows,
      failedRows: validation.errors.length,
      totalAmount: validation.totalAmount,
      errors: validation.errors,
      note: "期初数据导入校验失败，未写入业务数据。",
    });
    throw new ImportValidationError(result);
  }

  const importId = uid("INIT");
  const importNo = serial(database, "initialization_imports", "DR");
  const createdAt = now();
  const result = { importedRows: input.rows.length, created: 0, updated: 0, totalAmount: 0 };

  database.transaction(() => {
    if (input.type === "opening-inventory") {
      input.rows.forEach((row, index) => {
        const material = resolveMaterial(database, openingText(row, ["material_code", "material_id", "物料编码", "物料ID"], index, "物料编码"));
        const qty = openingNumber(row, ["qty", "数量", "期初数量"], index, "期初数量", { min: 0.000001 });
        const unitCost = openingNumber(row, ["unit_cost", "单价", "移动均价", "期初单价"], index, "期初单价", { min: 0 });
        const receivedAt = openingDate(row, ["received_at", "入库日期", "期初日期"], index, "期初日期", "2026-01-01");
        const batchNo =
          openingOptionalText(row, ["batch_no", "批次号", "期初批次"]) ||
          `OPEN-${receivedAt.replaceAll("-", "")}-${material.id.replace(/[^A-Z0-9]/gi, "")}`;
        database.prepare(`
          INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at, last_movement_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(uid("B"), material.id, batchNo, qty, unitCost, receivedAt, `${receivedAt}T00:00:00.000Z`);
        database.prepare(`
          INSERT INTO inventory_movements (
            id, item_type, item_id, batch_no, qty, unit_cost, movement_type, source_type, source_id, created_at
          )
          VALUES (?, 'material', ?, ?, ?, ?, 'opening_inventory', 'opening_balance', ?, ?)
        `).run(uid("MV"), material.id, batchNo, qty, unitCost, importId, `${receivedAt}T00:00:00.000Z`);
        recalculateMaterialInventory(database, material.id, `${receivedAt}T00:00:00.000Z`);
        result.created += 1;
        result.totalAmount = roundMoney(result.totalAmount + qty * unitCost);
      });
    }

    if (input.type === "opening-receivables") {
      input.rows.forEach((row, index) => {
        const customer = resolveCustomer(database, openingText(row, ["customer_code", "customer_id", "客户编码", "客户ID"], index, "客户编码"));
        const totalAmount = openingNumber(row, ["total_amount", "应收金额", "期初应收"], index, "应收金额", { min: 0.000001 });
        const receivedAmount = openingNumber(row, ["received_amount", "已收金额"], index, "已收金额", { min: 0, fallback: 0 });
        if (receivedAmount > totalAmount) throw new Error(`期初应收第 ${index + 1} 行已收金额不能大于应收金额。`);
        const createdAtRow = openingDate(row, ["created_at", "发生日期", "期初日期"], index, "发生日期", "2026-01-01");
        const dueDate = openingDate(row, ["due_date", "到期日"], index, "到期日", createdAtRow);
        const receivableNo = openingOptionalText(row, ["receivable_no", "应收单号"]) || serial(database, "receivables", "YS");
        const openingOrderId = ensureOpeningOrder(database, customer.id, totalAmount, createdAtRow);
        const balanceAmount = calculateBalance({ totalAmount, settledAmount: receivedAmount });
        const status = calculateLedgerStatus({ totalAmount, settledAmount: receivedAmount });
        const receivableId = uid("AR");
        database.prepare(`
          INSERT INTO receivables (
            id, receivable_no, customer_id, order_id, shipment_id, total_amount, received_amount,
            balance_amount, status, due_date, created_at, settled_at
          )
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
        `).run(receivableId, receivableNo, customer.id, openingOrderId, totalAmount, receivedAmount, balanceAmount, status, dueDate, createdAtRow, status === "paid" ? createdAtRow : null);
        if (receivedAmount > 0) {
          database.prepare(`
            INSERT INTO receivable_receipts (id, receivable_id, amount, method, note, received_at)
            VALUES (?, ?, ?, '期初导入', ?, ?)
          `).run(uid("ARR"), receivableId, receivedAmount, openingOptionalText(row, ["note", "备注"]) || "上线期初已收金额", createdAtRow);
        }
        result.created += 1;
        result.totalAmount = roundMoney(result.totalAmount + totalAmount);
      });
    }

    if (input.type === "opening-payables") {
      input.rows.forEach((row, index) => {
        const supplier = resolveSupplier(database, openingText(row, ["supplier_code", "supplier_id", "供应商编码", "供应商ID"], index, "供应商编码"));
        const totalAmount = openingNumber(row, ["total_amount", "应付金额", "期初应付"], index, "应付金额", { min: 0.000001 });
        const paidAmount = openingNumber(row, ["paid_amount", "已付金额"], index, "已付金额", { min: 0, fallback: 0 });
        if (paidAmount > totalAmount) throw new Error(`期初应付第 ${index + 1} 行已付金额不能大于应付金额。`);
        const createdAtRow = openingDate(row, ["created_at", "发生日期", "期初日期"], index, "发生日期", "2026-01-01");
        const dueDate = openingDate(row, ["due_date", "到期日"], index, "到期日", createdAtRow);
        const payableNo = openingOptionalText(row, ["payable_no", "应付单号"]) || serial(database, "payables", "YF");
        const balanceAmount = calculateBalance({ totalAmount, settledAmount: paidAmount });
        const status = calculateLedgerStatus({ totalAmount, settledAmount: paidAmount });
        const payableId = uid("AP");
        database.prepare(`
          INSERT INTO payables (
            id, payable_no, supplier_id, purchase_order_id, total_amount, paid_amount,
            balance_amount, status, due_date, created_at, settled_at
          )
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
        `).run(payableId, payableNo, supplier.id, totalAmount, paidAmount, balanceAmount, status, dueDate, createdAtRow, status === "paid" ? createdAtRow : null);
        if (paidAmount > 0) {
          database.prepare(`
            INSERT INTO payable_payments (id, payable_id, amount, method, note, paid_at)
            VALUES (?, ?, ?, '期初导入', ?, ?)
          `).run(uid("APP"), payableId, paidAmount, openingOptionalText(row, ["note", "备注"]) || "上线期初已付金额", createdAtRow);
        }
        result.created += 1;
        result.totalAmount = roundMoney(result.totalAmount + totalAmount);
      });
    }

    database.prepare(`
      INSERT INTO initialization_imports (
        id, import_no, type, status, imported_rows, created_count, updated_count,
        total_amount, actor_id, note, source_name, mode, valid_count, failed_count,
        error_summary, created_at
      )
      VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, 'import', ?, 0, '', ?)
    `).run(
      importId,
      importNo,
      input.type,
      result.importedRows,
      result.created,
      result.updated,
      result.totalAmount,
      input.actorId,
      input.note ?? initializationImportTypeLabel(input.type),
      input.sourceName ?? "",
      result.importedRows,
      createdAt,
    );
    audit(database, input.actorId, "importOpeningData", "initialization_import", importId, `${initializationImportTypeLabel(input.type)}导入 ${result.importedRows} 行`);
  })();

  return result;
}

export function validateOpeningDataRows(input: ImportValidationInput & { type: OpeningDataType; note?: string }) {
  const database = getDb();
  const allowed: Record<OpeningDataType, Role[]> = {
    "opening-inventory": ["admin", "warehouse"],
    "opening-receivables": ["admin", "finance"],
    "opening-payables": ["admin", "finance", "purchasing"],
  };
  requireRole(database, input.actorId, allowed[input.type]);
  if (!input.rows.length) throw new Error("初始化导入文件没有可用数据行。");
  const validation = validateOpeningDataRowsInternal(database, input);
  return recordInitializationImportBatch(database, {
    actorId: input.actorId,
    type: input.type,
    sourceName: input.sourceName,
    mode: "validate",
    status: validation.errors.length > 0 ? "validation_failed" : "validated",
    importedRows: input.rows.length,
    validRows: validation.validRows,
    failedRows: validation.errors.length,
    totalAmount: validation.totalAmount,
    errors: validation.errors,
    note: input.note || "期初数据导入预校验。",
  });
}

function validateOpeningDataRowsInternal(
  database: Database.Database,
  input: ImportValidationInput & { type: OpeningDataType },
) {
  const errors: ImportValidationErrorRow[] = [];
  const seenBatchKeys = new Set<string>();
  let validRows = 0;
  let totalAmount = 0;

  input.rows.forEach((row, index) => {
    const rowNo = index + 1;
    try {
      const amount = validateOpeningRow(database, input.type, row, index, seenBatchKeys);
      validRows += 1;
      totalAmount = roundMoney(totalAmount + amount);
    } catch (error) {
      const message = error instanceof Error ? error.message : "期初数据行校验失败。";
      errors.push({
        rowNo,
        fieldName: openingErrorField(input.type, message),
        message,
        rawData: row,
      });
    }
  });

  return { validRows, totalAmount, errors };
}

function validateOpeningRow(
  database: Database.Database,
  type: OpeningDataType,
  row: Record<string, unknown>,
  index: number,
  seenBatchKeys: Set<string>,
) {
  if (type === "opening-inventory") {
    const material = resolveMaterial(database, openingText(row, ["material_code", "material_id", "物料编码", "物料ID"], index, "物料编码"));
    const qty = openingNumber(row, ["qty", "数量", "期初数量"], index, "期初数量", { min: 0.000001 });
    const unitCost = openingNumber(row, ["unit_cost", "单价", "移动均价", "期初单价"], index, "期初单价", { min: 0 });
    const receivedAt = openingDate(row, ["received_at", "入库日期", "期初日期"], index, "期初日期", "2026-01-01");
    const batchNo =
      openingOptionalText(row, ["batch_no", "批次号", "期初批次"]) ||
      `OPEN-${receivedAt.replaceAll("-", "")}-${material.id.replace(/[^A-Z0-9]/gi, "")}`;
    const batchKey = `${material.id}:${batchNo}`;
    if (seenBatchKeys.has(batchKey)) throw new Error(`初始化导入第 ${index + 1} 行批次号在本次文件中重复。`);
    const existing = database
      .prepare("SELECT id FROM material_batches WHERE material_id = ? AND batch_no = ?")
      .get(material.id, batchNo) as { id: string } | undefined;
    if (existing) throw new Error(`初始化导入第 ${index + 1} 行批次号已存在。`);
    seenBatchKeys.add(batchKey);
    return roundMoney(qty * unitCost);
  }

  if (type === "opening-receivables") {
    resolveCustomer(database, openingText(row, ["customer_code", "customer_id", "客户编码", "客户ID"], index, "客户编码"));
    const totalAmount = openingNumber(row, ["total_amount", "应收金额", "期初应收"], index, "应收金额", { min: 0.000001 });
    const receivedAmount = openingNumber(row, ["received_amount", "已收金额"], index, "已收金额", { min: 0, fallback: 0 });
    if (receivedAmount > totalAmount) throw new Error(`期初应收第 ${index + 1} 行已收金额不能大于应收金额。`);
    openingDate(row, ["created_at", "发生日期", "期初日期"], index, "发生日期", "2026-01-01");
    openingDate(row, ["due_date", "到期日"], index, "到期日", openingOptionalText(row, ["created_at", "发生日期", "期初日期"]) || "2026-01-01");
    return totalAmount;
  }

  resolveSupplier(database, openingText(row, ["supplier_code", "supplier_id", "供应商编码", "供应商ID"], index, "供应商编码"));
  const totalAmount = openingNumber(row, ["total_amount", "应付金额", "期初应付"], index, "应付金额", { min: 0.000001 });
  const paidAmount = openingNumber(row, ["paid_amount", "已付金额"], index, "已付金额", { min: 0, fallback: 0 });
  if (paidAmount > totalAmount) throw new Error(`期初应付第 ${index + 1} 行已付金额不能大于应付金额。`);
  openingDate(row, ["created_at", "发生日期", "期初日期"], index, "发生日期", "2026-01-01");
  openingDate(row, ["due_date", "到期日"], index, "到期日", openingOptionalText(row, ["created_at", "发生日期", "期初日期"]) || "2026-01-01");
  return totalAmount;
}

function openingErrorField(type: OpeningDataType, message: string) {
  if (message.includes("物料")) return "material_code";
  if (message.includes("客户")) return "customer_code";
  if (message.includes("供应商")) return "supplier_code";
  if (message.includes("已收金额")) return "received_amount";
  if (message.includes("已付金额")) return "paid_amount";
  if (message.includes("应收金额")) return "total_amount";
  if (message.includes("应付金额")) return "total_amount";
  if (message.includes("批次")) return "batch_no";
  if (message.includes("日期") || message.includes("到期日")) return "date";
  return type;
}

function masterPayloadFromRow(type: MasterDataType, row: Record<string, unknown>, index: number) {
  const get = (keys: string[], fallback = "") => {
    for (const key of keys) {
      const value = row[key];
      if (String(value ?? "").trim() !== "") return value;
    }
    return fallback;
  };
  const status = normalizeMasterStatus(get(["status", "状态"], "active"));

  if (type === "customers") {
    const payload = {
      customer_code: String(get(["customer_code", "客户编码"])).trim(),
      name: String(get(["name", "客户名称", "客户"])).trim(),
      contact: String(get(["contact", "联系人"])).trim(),
      phone: String(get(["phone", "电话", "手机号"])).trim(),
      status,
      address: String(get(["address", "地址"])).trim(),
      tax_no: String(get(["tax_no", "税号", "纳税人识别号"])).trim(),
      remark: String(get(["remark", "备注"])).trim(),
    };
    if (!payload.customer_code || !payload.name) throw new Error(`客户第 ${index + 1} 行缺少客户编码或客户名称。`);
    return payload;
  }

  if (type === "suppliers") {
    const payload = {
      supplier_code: String(get(["supplier_code", "供应商编码"])).trim(),
      name: String(get(["name", "供应商名称", "供应商"])).trim(),
      contact: String(get(["contact", "联系人"])).trim(),
      phone: String(get(["phone", "电话", "手机号"])).trim(),
      payment_terms: String(get(["payment_terms", "付款条件", "账期"], "月结30天")).trim(),
      status,
      address: String(get(["address", "地址"])).trim(),
      tax_no: String(get(["tax_no", "税号", "纳税人识别号"])).trim(),
      remark: String(get(["remark", "备注"])).trim(),
    };
    if (!payload.supplier_code || !payload.name) throw new Error(`供应商第 ${index + 1} 行缺少供应商编码或供应商名称。`);
    return payload;
  }

  if (type === "materials") {
    const payload = {
      material_code: String(get(["material_code", "物料编码"])).trim(),
      name: String(get(["name", "物料名称", "物料"])).trim(),
      spec: String(get(["spec", "规格", "规格型号"])).trim(),
      unit: String(get(["unit", "单位"], "kg")).trim(),
      kind: String(get(["kind", "分类", "物料分类"], "raw")).trim(),
      reorder_min_qty: String(get(["reorder_min_qty", "安全库存", "预警线"], "0")).trim(),
      status,
      remark: String(get(["remark", "备注"])).trim(),
    };
    if (!payload.material_code || !payload.name) throw new Error(`物料第 ${index + 1} 行缺少物料编码或物料名称。`);
    return payload;
  }

  const payload = {
    product_code: String(get(["product_code", "产品编码"])).trim(),
    name: String(get(["name", "产品名称", "产品"])).trim(),
    spec: String(get(["spec", "规格", "规格型号"])).trim(),
    unit: String(get(["unit", "单位"], "件")).trim(),
    process_fee: String(get(["process_fee", "加工费"], "0")).trim(),
    default_margin: String(get(["default_margin", "默认利润率", "利润率"], "0.2")).trim(),
    status,
    remark: String(get(["remark", "备注"])).trim(),
  };
  if (!payload.product_code || !payload.name) throw new Error(`产品第 ${index + 1} 行缺少产品编码或产品名称。`);
  return payload;
}

function normalizeMasterStatus(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return ["inactive", "停用", "禁用"].includes(text) ? "inactive" : "active";
}

function findMasterExistingId(database: Database.Database, type: Exclude<MasterDataType, "boms">, payload: Record<string, unknown>) {
  const map = {
    customers: ["customers", "customer_code", payload.customer_code],
    suppliers: ["suppliers", "supplier_code", payload.supplier_code],
    materials: ["materials", "material_code", payload.material_code],
    products: ["products", "product_code", payload.product_code],
  } as const;
  const [table, column, code] = map[type];
  const row = database.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`).get(code) as { id: string } | undefined;
  return row?.id;
}

function importMasterBomRows(database: Database.Database, actorId: string, importRows: Array<Record<string, unknown>>) {
  const groups = new Map<
    string,
    {
      productId: string;
      productName: string;
      version: string;
      remark: string;
      lines: Array<{ parentProductId: string; componentType: "material" | "product"; componentId: string; qtyPer: number; isPrimary: boolean }>;
    }
  >();

  importRows.forEach((row, index) => {
    const get = (keys: string[], fallback = "") => {
      for (const key of keys) {
        const value = row[key];
        if (String(value ?? "").trim() !== "") return String(value).trim();
      }
      return fallback;
    };
    const productCodeOrId = get(["product_code", "product_id", "产品编码", "产品ID"]);
    const version = get(["version", "BOM版本", "版本"], "V1.0");
    const parentCodeOrId = get(["parent_product_code", "parent_product_id", "父级产品编码", "父级产品ID"], productCodeOrId);
    const componentTypeRaw = get(["component_type", "组件类型"], "material");
    const componentCodeOrId = get(["component_code", "component_id", "组件编码", "组件ID", "物料编码"]);
    const qtyPer = Number(get(["qty_per", "单位用量"], "0"));
    const isPrimary = ["1", "true", "是", "yes"].includes(get(["is_primary", "主材"], "").toLowerCase());
    const remark = get(["remark", "备注"], "");

    const product = resolveProduct(database, productCodeOrId);
    const parent = resolveProduct(database, parentCodeOrId);
    const componentType = componentTypeRaw === "product" || componentTypeRaw === "产品" ? "product" : "material";
    const component =
      componentType === "product" ? resolveProduct(database, componentCodeOrId) : resolveMaterial(database, componentCodeOrId);
    if (!Number.isFinite(qtyPer) || qtyPer <= 0) throw new Error(`BOM 第 ${index + 1} 行单位用量必须大于 0。`);

    const key = `${product.id}|${version}`;
    const group = groups.get(key) ?? {
      productId: product.id,
      productName: product.name,
      version,
      remark,
      lines: [],
    };
    group.lines.push({
      parentProductId: parent.id,
      componentType,
      componentId: component.id,
      qtyPer,
      isPrimary,
    });
    groups.set(key, group);
  });

  const result = { importedRows: importRows.length, created: groups.size, updated: 0 };
  database.transaction(() => {
    const timestamp = now();
    for (const group of groups.values()) {
      database.prepare("UPDATE boms SET status = 'inactive', updated_at = ? WHERE product_id = ? AND status = 'active'").run(
        timestamp,
        group.productId,
      );
      const bomId = uid("BOM");
      database.prepare(`
        INSERT INTO boms (id, product_id, version, status, remark, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?)
      `).run(bomId, group.productId, group.version, group.remark, timestamp, timestamp);
      const insert = database.prepare(`
        INSERT INTO bom_lines (bom_id, parent_product_id, component_type, component_id, qty_per, is_primary)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      group.lines.forEach((line) => {
        insert.run(bomId, line.parentProductId, line.componentType, line.componentId, line.qtyPer, line.isPrimary ? 1 : 0);
      });
      audit(database, actorId, "importMasterBom", "bom", bomId, `导入 ${group.productName} ${group.version}，${group.lines.length} 行`);
    }
  })();
  return result;
}

function resolveProduct(database: Database.Database, codeOrId: string) {
  const row = database.prepare(`
    SELECT id, name
    FROM products
    WHERE id = ? OR product_code = ?
  `).get(codeOrId, codeOrId) as { id: string; name: string } | undefined;
  if (!row) throw new Error(`产品 ${codeOrId} 不存在。`);
  return row;
}

function resolveCustomer(database: Database.Database, codeOrId: string) {
  const row = database.prepare(`
    SELECT id, name
    FROM customers
    WHERE id = ? OR customer_code = ?
  `).get(codeOrId, codeOrId) as { id: string; name: string } | undefined;
  if (!row) throw new Error(`客户 ${codeOrId} 不存在。`);
  return row;
}

function resolveSupplier(database: Database.Database, codeOrId: string) {
  const row = database.prepare(`
    SELECT id, name
    FROM suppliers
    WHERE id = ? OR supplier_code = ?
  `).get(codeOrId, codeOrId) as { id: string; name: string } | undefined;
  if (!row) throw new Error(`供应商 ${codeOrId} 不存在。`);
  return row;
}

function resolveMaterial(database: Database.Database, codeOrId: string) {
  const row = database.prepare(`
    SELECT id, name
    FROM materials
    WHERE id = ? OR material_code = ?
  `).get(codeOrId, codeOrId) as { id: string; name: string } | undefined;
  if (!row) throw new Error(`物料 ${codeOrId} 不存在。`);
  return row;
}

function ensureOpeningOrder(database: Database.Database, customerId: string, amount: number, createdAt: string) {
  const product = database.prepare("SELECT id, process_fee, default_margin FROM products WHERE status = 'active' ORDER BY product_code LIMIT 1").get() as
    | { id: string; process_fee: number; default_margin: number }
    | undefined;
  if (!product) throw new Error("缺少产品主数据，无法建立期初应收关联订单。");
  const quoteId = uid("Q");
  const quoteNo = serial(database, "quotes", "BJ");
  database.prepare(`
    INSERT INTO quotes (
      id, quote_no, customer_id, product_id, qty, version, material_cost, process_fee,
      margin_rate, total_amount, status, created_at
    )
    VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, 'converted', ?)
  `).run(quoteId, quoteNo, customerId, product.id, amount, 0, 0, amount, createdAt);
  const orderId = uid("O");
  const orderNo = serial(database, "orders", "DD");
  database.prepare(`
    INSERT INTO orders (
      id, order_no, quote_id, customer_id, product_id, qty, due_date, special_requirements,
      customer_po_no, sales_contract_no, delivery_address, consignee, contact_phone,
      payment_terms_days, remark, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, 1, ?, '上线期初应收关联订单', '', '', '', '', '', 0, '系统初始化生成', 'shipped', ?)
  `).run(orderId, orderNo, quoteId, customerId, product.id, createdAt, createdAt);
  return orderId;
}

function openingOptionalText(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function openingText(row: Record<string, unknown>, keys: string[], index: number, label: string) {
  const value = openingOptionalText(row, keys);
  if (!value) throw new Error(`初始化导入第 ${index + 1} 行缺少${label}。`);
  return value;
}

function openingNumber(
  row: Record<string, unknown>,
  keys: string[],
  index: number,
  label: string,
  options: { min?: number; fallback?: number } = {},
) {
  const textValue = openingOptionalText(row, keys);
  const value = textValue ? Number(textValue) : options.fallback;
  if (value == null || !Number.isFinite(value)) throw new Error(`初始化导入第 ${index + 1} 行${label}必须是有效数字。`);
  if (options.min != null && value < options.min) throw new Error(`初始化导入第 ${index + 1} 行${label}不能小于 ${options.min}。`);
  return roundMoney(value);
}

function openingDate(row: Record<string, unknown>, keys: string[], index: number, label: string, fallback: string) {
  const value = openingOptionalText(row, keys) || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`初始化导入第 ${index + 1} 行${label}必须使用 YYYY-MM-DD 格式。`);
  }
  return value;
}

function masterExportRows(database: Database.Database, type: MasterDataType) {
  if (type === "customers") {
    return rows(database.prepare(`
      SELECT customer_code, name, contact, phone, status, address, tax_no, remark, created_at, updated_at
      FROM customers
      ORDER BY status, customer_code
    `).all());
  }
  if (type === "suppliers") {
    return rows(database.prepare(`
      SELECT supplier_code, name, contact, phone, payment_terms, status, address, tax_no, remark, created_at, updated_at
      FROM suppliers
      ORDER BY status, supplier_code
    `).all());
  }
  if (type === "materials") {
    return rows(database.prepare(`
      SELECT material_code, name, spec, unit, kind, reorder_min_qty, stock_qty, average_cost,
             last_movement_at, status, remark, created_at, updated_at
      FROM materials
      ORDER BY status, material_code
    `).all());
  }
  if (type === "products") {
    return rows(database.prepare(`
      SELECT product_code, name, spec, unit, process_fee, default_margin, status, remark, created_at, updated_at
      FROM products
      ORDER BY status, product_code
    `).all());
  }
  return rows(database.prepare(`
    SELECT p.product_code,
           b.version,
           pp.product_code AS parent_product_code,
           bl.component_type,
           COALESCE(m.material_code, cp.product_code, bl.component_id) AS component_code,
           COALESCE(m.name, cp.name, bl.component_id) AS component_name,
           bl.qty_per,
           CASE WHEN bl.is_primary = 1 THEN '是' ELSE '否' END AS is_primary,
           b.status,
           b.remark
    FROM bom_lines bl
    JOIN boms b ON b.id = bl.bom_id
    JOIN products p ON p.id = b.product_id
    JOIN products pp ON pp.id = bl.parent_product_id
    LEFT JOIN materials m ON bl.component_type = 'material' AND m.id = bl.component_id
    LEFT JOIN products cp ON bl.component_type = 'product' AND cp.id = bl.component_id
    ORDER BY p.product_code, b.version, bl.id
  `).all());
}

function masterTemplateRows(type: MasterDataType) {
  const templates: Record<MasterDataType, Array<Record<string, unknown>>> = {
    customers: [
      {
        customer_code: "KH-001",
        name: "示例客户有限公司",
        contact: "联系人",
        phone: "13800000000",
        status: "active",
        address: "客户地址",
        tax_no: "税号",
        remark: "备注",
      },
    ],
    suppliers: [
      {
        supplier_code: "GYS-001",
        name: "示例供应商有限公司",
        contact: "联系人",
        phone: "13800000000",
        payment_terms: "月结30天",
        status: "active",
        address: "供应商地址",
        tax_no: "税号",
        remark: "备注",
      },
    ],
    materials: [
      {
        material_code: "WL-001",
        name: "示例原材料",
        spec: "规格型号",
        unit: "kg",
        kind: "raw",
        reorder_min_qty: 0,
        status: "active",
        remark: "库存数量和均价通过采购入库生成",
      },
    ],
    products: [
      {
        product_code: "CP-001",
        name: "示例产品",
        spec: "规格型号",
        unit: "件",
        process_fee: 0,
        default_margin: 0.2,
        status: "active",
        remark: "备注",
      },
    ],
    boms: [
      {
        product_code: "CP-001",
        version: "V1.0",
        parent_product_code: "CP-001",
        component_type: "material",
        component_code: "WL-001",
        qty_per: 1,
        is_primary: "是",
        remark: "同一产品和版本可填写多行",
      },
    ],
  };
  return templates[type];
}

function openingTemplateRows(type: OpeningDataType) {
  const templates: Record<OpeningDataType, Array<Record<string, unknown>>> = {
    "opening-inventory": [
      {
        material_code: "WL-001",
        batch_no: "OPEN-20260101-WL001",
        qty: 100,
        unit_cost: 12.5,
        received_at: "2026-01-01",
        note: "上线期初库存",
      },
    ],
    "opening-receivables": [
      {
        customer_code: "KH-001",
        receivable_no: "YS-OPEN-001",
        total_amount: 10000,
        received_amount: 2000,
        created_at: "2026-01-01",
        due_date: "2026-02-01",
        note: "上线期初应收",
      },
    ],
    "opening-payables": [
      {
        supplier_code: "GYS-001",
        payable_no: "YF-OPEN-001",
        total_amount: 8000,
        paid_amount: 1000,
        created_at: "2026-01-01",
        due_date: "2026-02-01",
        note: "上线期初应付",
      },
    ],
  };
  return templates[type];
}

function normalizeReportFilters(filters?: ReportFilters): ReportFilters {
  if (!filters) return {};
  const normalized: ReportFilters = {};
  const assignText = (key: keyof ReportFilters) => {
    const value = String(filters[key] ?? "").trim();
    if (value) normalized[key] = value;
  };
  assignText("customerId");
  assignText("supplierId");
  assignText("materialId");
  assignText("orderId");
  assignText("purchaseOrderId");

  const assignDate = (key: "dateFrom" | "dateTo") => {
    const value = String(filters[key] ?? "").trim();
    if (!value) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("报表日期筛选必须使用 YYYY-MM-DD 格式。");
    normalized[key] = value;
  };
  assignDate("dateFrom");
  assignDate("dateTo");
  if (normalized.dateFrom && normalized.dateTo && normalized.dateFrom > normalized.dateTo) {
    throw new Error("报表开始日期不能晚于结束日期。");
  }
  return normalized;
}

function addDateFilter(conditions: string[], params: unknown[], column: string, filters: ReportFilters) {
  if (filters.dateFrom) {
    conditions.push(`date(${column}) >= date(?)`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push(`date(${column}) <= date(?)`);
    params.push(filters.dateTo);
  }
}

function filteredRows(database: Database.Database, sql: string, params: unknown[]) {
  return rows(database.prepare(sql).all(...params));
}

function scalarNumber(database: Database.Database, sql: string, params: unknown[]) {
  const row = database.prepare(sql).get(...params) as { value?: number } | undefined;
  return Number(row?.value ?? 0);
}

function isFormalReportExportType(type: string): type is FormalReportExportType {
  return [
    "business-daily",
    "business-weekly",
    "business-monthly",
    "inventory-daily",
    "inventory-overstock",
    "sales-statement",
    "purchase-statement",
    "supplier-performance",
    "supplier-discrepancy",
    "material-adjustment-cost-impact",
    "cost-anomaly-analysis",
    "quality-exception",
  ].includes(type);
}

function formalReportTitle(type: FormalReportExportType) {
  const titles: Record<FormalReportExportType, string> = {
    "business-daily": "经营日报",
    "business-weekly": "经营周报",
    "business-monthly": "经营月报",
    "inventory-daily": "库存日报",
    "inventory-overstock": "库存积压报表",
    "sales-statement": "销售对账单",
    "purchase-statement": "采购对账单",
    "supplier-performance": "供应商绩效评分报表",
    "supplier-discrepancy": "供应商差异统计报表",
    "material-adjustment-cost-impact": "补退料成本影响报表",
    "cost-anomaly-analysis": "成本异常分析报表",
    "quality-exception": "质量异常分析报表",
  };
  return titles[type];
}

function reportSnapshotType(type: FormalReportExportType) {
  const snapshotTypes: Record<FormalReportExportType, string> = {
    "business-daily": "daily",
    "business-weekly": "weekly",
    "business-monthly": "monthly",
    "inventory-daily": "inventory_daily",
    "inventory-overstock": "inventory_overstock",
    "sales-statement": "sales_statement",
    "purchase-statement": "purchase_statement",
    "supplier-performance": "supplier_performance",
    "supplier-discrepancy": "supplier_discrepancy",
    "material-adjustment-cost-impact": "material_adjustment_cost_impact",
    "cost-anomaly-analysis": "cost_anomaly_analysis",
    "quality-exception": "quality_exception",
  };
  return snapshotTypes[type];
}

function reportPeriod(type: FormalReportExportType) {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (type === "business-weekly") start.setUTCDate(start.getUTCDate() - 6);
  if (type === "business-monthly") start.setUTCDate(1);
  return {
    start: start.toISOString().slice(0, 10),
    end,
  };
}

function formalReportCoverRows(database: Database.Database, type: FormalReportExportType, user: UserRow, filters: ReportFilters = {}) {
  const period = reportPeriod(type);
  const metrics = reportSnapshotMetrics(database, type, filters);
  return [
    { field: "报表名称", value: formalReportTitle(type) },
    { field: "公司抬头", value: "本地化生产流转 ERP" },
    { field: "统计周期", value: `${period.start} 至 ${period.end}` },
    { field: "筛选条件", value: reportFilterSummary(database, filters) },
    { field: "生成时间", value: now() },
    { field: "生成人", value: `${user.name} / ${roleLabel(user.role)}` },
    { field: "报表口径", value: formalReportDescription(type) },
    { field: "订单金额", value: Number(metrics.order_amount ?? 0) },
    { field: "采购金额", value: Number(metrics.purchase_amount ?? 0) },
    { field: "应收余额", value: Number(metrics.receivable_balance ?? 0) },
    { field: "应付余额", value: Number(metrics.payable_balance ?? 0) },
    { field: "库存积压金额", value: Number(metrics.overstock_value ?? 0) },
    { field: "质量异常次数", value: Number(metrics.quality_failed_count ?? 0) },
    { field: "复检关闭率", value: `${Number(metrics.quality_closure_rate ?? 0).toFixed(2)}%` },
    { field: "到货差异单数", value: Number(metrics.supplier_discrepancy_count ?? 0) },
    { field: "到货差异金额", value: Number(metrics.supplier_discrepancy_adjustment_amount ?? 0) },
    { field: "差异处理完成率", value: `${Number(metrics.supplier_discrepancy_resolution_rate ?? 0).toFixed(2)}%` },
    { field: "供应商平均评分", value: Number(metrics.supplier_average_score ?? 0) },
    { field: "高风险供应商", value: Number(metrics.supplier_risk_count ?? 0) },
    { field: "补退料单数", value: Number(metrics.material_adjustment_count ?? 0) },
    { field: "待复核补退料", value: Number(metrics.material_adjustment_pending_review_count ?? 0) },
    { field: "补退料成本影响", value: Number(metrics.material_adjustment_cost_impact_amount ?? 0) },
    { field: "库存价值变动", value: Number(metrics.material_adjustment_inventory_delta ?? 0) },
    { field: "成本异常总数", value: Number(metrics.cost_anomaly_total_count ?? 0) },
    { field: "成本审批驳回", value: Number(metrics.cost_anomaly_rejected_count ?? 0) },
    { field: "成本红冲成功", value: Number(metrics.cost_anomaly_reversed_count ?? 0) },
    { field: "禁止直接红冲", value: Number(metrics.cost_anomaly_red_offset_blocked_count ?? 0) },
    { field: "成本整改未闭环", value: Number(metrics.cost_anomaly_remediation_open_count ?? 0) },
    { field: "成本整改已关闭", value: Number(metrics.cost_anomaly_remediation_closed_count ?? 0) },
    { field: "成本异常金额", value: Number(metrics.cost_anomaly_total_amount ?? 0) },
  ];
}

function formalReportDescription(type: FormalReportExportType) {
  const descriptions: Record<FormalReportExportType, string> = {
    "business-daily": "按当日业务状态汇总销售、采购、库存、应收应付与收率指标。",
    "business-weekly": "按近七日经营周期汇总订单交付、采购付款、库存积压与现金流指标。",
    "business-monthly": "按自然月汇总管理层关注的经营、库存、质量和财务核心数据。",
    "inventory-daily": "按当前实时库存输出数量、移动均价、安全库存和库龄预警。",
    "inventory-overstock": "将 3 个月未变动物料列入呆滞预警，6 个月未变动物料列入积压报表。",
    "sales-statement": "按发货与应收账款生成客户销售对账明细，支持财务核对与客户确认。",
    "purchase-statement": "按采购入库与应付账款生成供应商采购对账明细，支持付款核对。",
    "supplier-performance": "按采购订单、到货准时、IQC合格、到货差异、应付逾期综合评估供应商绩效评分。",
    "supplier-discrepancy": "按到货差异单统计供应商差异频次、数量差异、价格差异、影响金额和处理完成率。",
    "material-adjustment-cost-impact": "按正式补料、退料执行明细统计生产成本影响、库存价值变动、批次来源和仓库复核状态。",
    "cost-anomaly-analysis": "按工单成本调整、审批驳回、红冲成功和红冲受控规则统计成本异常原因、物料分布和责任岗位。",
    "quality-exception": "按不合格请验、技术处置、复检记录和关闭状态统计质量异常、原因分布与处置效率。",
  };
  return descriptions[type];
}

function reportFilterSummary(database: Database.Database, filters: ReportFilters = {}) {
  const parts: string[] = [];
  if (filters.dateFrom || filters.dateTo) parts.push(`日期：${filters.dateFrom ?? "不限"} 至 ${filters.dateTo ?? "不限"}`);
  if (filters.customerId) parts.push(`客户：${lookupName(database, "customers", filters.customerId)}`);
  if (filters.supplierId) parts.push(`供应商：${lookupName(database, "suppliers", filters.supplierId)}`);
  if (filters.materialId) parts.push(`物料：${lookupName(database, "materials", filters.materialId)}`);
  if (filters.orderId) parts.push(`订单：${lookupOrderNo(database, filters.orderId)}`);
  if (filters.purchaseOrderId) parts.push(`采购单：${lookupPurchaseNo(database, filters.purchaseOrderId)}`);
  return parts.length > 0 ? parts.join("；") : "全部数据";
}

function lookupName(database: Database.Database, table: "customers" | "suppliers" | "materials", id: string) {
  const row = database.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as { name?: string } | undefined;
  return row?.name ?? id;
}

function lookupOrderNo(database: Database.Database, id: string) {
  const row = database.prepare("SELECT order_no FROM orders WHERE id = ?").get(id) as { order_no?: string } | undefined;
  return row?.order_no ?? id;
}

function lookupPurchaseNo(database: Database.Database, id: string) {
  const row = database.prepare("SELECT purchase_no FROM purchase_orders WHERE id = ?").get(id) as
    | { purchase_no?: string }
    | undefined;
  return row?.purchase_no ?? id;
}

function reportSnapshotMetrics(database: Database.Database, type: FormalReportExportType, filters: ReportFilters = {}): Record<string, unknown> {
  const snapshotType = reportSnapshotType(type);
  const businessMetrics = businessReportRows(database, snapshotType, filters)[0] ?? {};
  const staleRows = inventoryAgingRows(database, "stale_warning", filters);
  const overstockRows = inventoryAgingRows(database, "overstock", filters);
  const salesRows = ledgerReceivableRows(database, undefined, filters);
  const purchaseRows = ledgerPayableRows(database, undefined, filters);
  const qualityRows = qualityExceptionRows(database, filters);
  const qualityRootCauses = qualityRootCauseRows(database, filters);
  const qualityDispositionTypes = qualityDispositionTypeRows(database, filters);
  const supplierDiscrepancyRows = supplierDiscrepancyDetailRows(database, filters);
  const supplierDiscrepancySummary = supplierDiscrepancySummaryRows(database, filters);
  const supplierPerformance = supplierPerformanceRows(database, filters);
  const materialAdjustmentCostRows = materialAdjustmentCostImpactRows(database, undefined, filters);
  const costAnomaly = costAnomalyAnalyticsRows(database, filters);
  const costAnomalyTotals = costAnomaly.totals as Record<string, unknown>;
  const qualityClosedCount = qualityRows.filter((item) => String(item.closure_status) === "已关闭").length;
  const qualityReinspectionCount = qualityRows.reduce((sum, item) => sum + Number(item.reinspection_count ?? 0), 0);
  const supplierDiscrepancyResolvedCount = supplierDiscrepancyRows.filter((item) => String(item.status_label) === "差异已处理").length;
  const supplierRiskCount = supplierPerformance.filter((item) => String(item.risk_level) === "high").length;
  const materialAdjustmentOrderCount = new Set(materialAdjustmentCostRows.map((item) => String(item.order_no))).size;
  const materialAdjustmentPendingReviewCount = new Set(
    materialAdjustmentCostRows
      .filter((item) => String(item.review_status_label) === "待复核")
      .map((item) => String(item.order_no)),
  ).size;
  return {
    ...businessMetrics,
    report_type: snapshotType,
    report_title: formalReportTitle(type),
    filter_summary: reportFilterSummary(database, filters),
    generated_at: now(),
    stale_warning_count: staleRows.length,
    overstock_count: overstockRows.length,
    overstock_value: roundMoney(overstockRows.reduce((sum, item) => sum + Number(item.stock_value ?? 0), 0)),
    sales_statement_amount: roundMoney(salesRows.reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0)),
    sales_statement_balance: roundMoney(salesRows.reduce((sum, item) => sum + Number(item.balance_amount ?? 0), 0)),
    purchase_statement_amount: roundMoney(purchaseRows.reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0)),
    purchase_statement_balance: roundMoney(purchaseRows.reduce((sum, item) => sum + Number(item.balance_amount ?? 0), 0)),
    quality_failed_count: qualityRows.length,
    quality_closed_count: qualityClosedCount,
    quality_reinspection_count: qualityReinspectionCount,
    quality_closure_rate: qualityRows.length ? roundMoney((qualityClosedCount / qualityRows.length) * 100) : 0,
    quality_root_cause_count: qualityRootCauses.length,
    quality_disposition_type_count: qualityDispositionTypes.length,
    supplier_discrepancy_count: supplierDiscrepancyRows.length,
    supplier_discrepancy_resolved_count: supplierDiscrepancyResolvedCount,
    supplier_discrepancy_pending_count: supplierDiscrepancyRows.length - supplierDiscrepancyResolvedCount,
    supplier_discrepancy_adjustment_amount: roundMoney(
      supplierDiscrepancyRows.reduce((sum, item) => sum + Number(item.total_adjustment_amount ?? 0), 0),
    ),
    supplier_discrepancy_resolution_rate: supplierDiscrepancyRows.length
      ? roundMoney((supplierDiscrepancyResolvedCount / supplierDiscrepancyRows.length) * 100)
      : 0,
    supplier_discrepancy_supplier_count: supplierDiscrepancySummary.length,
    supplier_average_score: supplierPerformance.length
      ? roundMoney(supplierPerformance.reduce((sum, item) => sum + Number(item.performance_score ?? 0), 0) / supplierPerformance.length)
      : 0,
    supplier_risk_count: supplierRiskCount,
    supplier_performance_count: supplierPerformance.length,
    material_adjustment_count: materialAdjustmentOrderCount,
    material_adjustment_pending_review_count: materialAdjustmentPendingReviewCount,
    material_adjustment_cost_impact_amount: roundMoney(
      materialAdjustmentCostRows.reduce((sum, item) => sum + Number(item.cost_impact_amount ?? 0), 0),
    ),
    material_adjustment_inventory_delta: roundMoney(
      materialAdjustmentCostRows.reduce((sum, item) => sum + Number(item.inventory_value_delta ?? 0), 0),
    ),
    cost_anomaly_total_count: Number(costAnomalyTotals.total_count ?? 0),
    cost_anomaly_pending_approval_count: Number(costAnomalyTotals.pending_approval_count ?? 0),
    cost_anomaly_rejected_count: Number(costAnomalyTotals.rejected_count ?? 0),
    cost_anomaly_reversed_count: Number(costAnomalyTotals.reversed_count ?? 0),
    cost_anomaly_red_offset_blocked_count: Number(costAnomalyTotals.red_offset_blocked_count ?? 0),
    cost_anomaly_remediation_count: Number(costAnomalyTotals.remediation_count ?? 0),
    cost_anomaly_remediation_open_count: Number(costAnomalyTotals.remediation_open_count ?? 0),
    cost_anomaly_remediation_closed_count: Number(costAnomalyTotals.remediation_closed_count ?? 0),
    cost_anomaly_total_amount: Number(costAnomalyTotals.total_adjustment_amount ?? 0),
    cost_anomaly_rejected_amount: Number(costAnomalyTotals.rejected_amount ?? 0),
    cost_anomaly_reversed_amount: Number(costAnomalyTotals.reversed_amount ?? 0),
  };
}

function ledgerReceivableRows(database: Database.Database, entityId?: string, filters: ReportFilters = {}) {
  const conditions = ["(r.id = COALESCE(?, r.id) OR r.shipment_id = COALESCE(?, r.shipment_id))"];
  const params: unknown[] = [entityId ?? null, entityId ?? null];
  addDateFilter(conditions, params, "r.created_at", filters);
  if (filters.customerId) {
    conditions.push("r.customer_id = ?");
    params.push(filters.customerId);
  }
  if (filters.orderId) {
    conditions.push("r.order_id = ?");
    params.push(filters.orderId);
  }
  return filteredRows(database, `
    SELECT r.receivable_no, c.name AS customer, o.order_no, s.shipment_no,
           s.sales_amount, s.cost_amount, s.gross_profit, s.gross_margin,
           r.total_amount, r.received_amount,
           r.balance_amount, r.status, r.due_date,
           CAST(julianday('now') - julianday(r.created_at) AS INTEGER) AS age_days
    FROM receivables r
    JOIN customers c ON c.id = r.customer_id
    JOIN orders o ON o.id = r.order_id
    LEFT JOIN shipments s ON s.id = r.shipment_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY r.created_at DESC
  `, params);
}

function ledgerPayableRows(database: Database.Database, entityId?: string, filters: ReportFilters = {}) {
  const conditions = ["(p.id = COALESCE(?, p.id) OR p.purchase_order_id = COALESCE(?, p.purchase_order_id))"];
  const params: unknown[] = [entityId ?? null, entityId ?? null];
  addDateFilter(conditions, params, "p.created_at", filters);
  if (filters.supplierId) {
    conditions.push("p.supplier_id = ?");
    params.push(filters.supplierId);
  }
  if (filters.purchaseOrderId) {
    conditions.push("p.purchase_order_id = ?");
    params.push(filters.purchaseOrderId);
  }
  if (filters.materialId) {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM purchase_order_lines pol
        WHERE pol.purchase_order_id = p.purchase_order_id
          AND pol.material_id = ?
      )
    `);
    params.push(filters.materialId);
  }
  return filteredRows(database, `
    SELECT p.payable_no, s.name AS supplier, po.purchase_no, p.total_amount, p.paid_amount,
           p.balance_amount, p.status, p.due_date,
           CAST(julianday('now') - julianday(p.created_at) AS INTEGER) AS age_days
    FROM payables p
    JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN purchase_orders po ON po.id = p.purchase_order_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.created_at DESC
  `, params);
}

function productionPlanSourceRows(database: Database.Database, filters: ReportFilters = {}): Array<Record<string, unknown>> {
  const conditions = ["po.status NOT IN ('voided', 'cancelled')"];
  const params: unknown[] = [];
  addDateFilter(conditions, params, "COALESCE(s.planned_date, o.due_date, po.created_at)", filters);
  if (filters.customerId) {
    conditions.push("o.customer_id = ?");
    params.push(filters.customerId);
  }
  if (filters.orderId) {
    conditions.push("o.id = ?");
    params.push(filters.orderId);
  }

  const sourceRows = filteredRows(database, `
    SELECT po.id,
           po.prod_no,
           po.status,
           po.priority,
           o.id AS order_id,
           o.order_no,
           o.customer_po_no,
           o.qty AS order_qty,
           o.due_date,
           c.name AS customer_name,
           p.name AS product_name,
           p.spec AS product_spec,
           p.unit,
           s.id AS schedule_id,
           s.planned_date,
           s.machine,
           s.owner,
           s.shift,
           s.schedule_note,
           strftime('%Y-W%W', COALESCE(s.planned_date, o.due_date, po.created_at)) AS plan_week,
           COALESCE((
             SELECT COUNT(*)
             FROM production_schedule_changes psc
             WHERE psc.production_order_id = po.id
           ), 0) AS schedule_change_count,
           COALESCE((
             SELECT psc.change_reason
             FROM production_schedule_changes psc
             WHERE psc.production_order_id = po.id
             ORDER BY psc.changed_at DESC
             LIMIT 1
           ), '') AS latest_schedule_change_reason
    FROM production_orders po
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN schedules s ON s.production_order_id = po.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY COALESCE(s.planned_date, o.due_date, po.created_at) ASC, s.machine ASC, po.prod_no ASC
  `, params);

  return sourceRows.map((row) => {
    const risk = productionDeliveryRisk(row);
    return {
      ...row,
      status_label: productionStatusLabel(String(row.status)),
      priority_label: priorityLabel(String(row.priority ?? "normal")),
      delivery_risk_status: risk.status,
      delivery_risk_label: risk.label,
    };
  });
}

function productionPlanRows(database: Database.Database, filters: ReportFilters = {}) {
  return productionPlanSourceRows(database, filters).map((row) => ({
    计划日期: row.planned_date ?? "未排产",
    周次: row.plan_week ?? "",
    机台: row.machine ?? "",
    班次: row.shift ?? "",
    负责人: row.owner ?? "",
    生产单号: row.prod_no,
    客户订单: row.order_no,
    客户名称: row.customer_name,
    产品名称: row.product_name,
    规格型号: row.product_spec ?? "",
    计划数量: Number(row.order_qty ?? 0),
    单位: row.unit ?? "",
    交付期限: row.due_date ?? "",
    优先级: row.priority_label,
    状态: row.status_label,
    交期风险: row.delivery_risk_label,
    排产变更次数: Number(row.schedule_change_count ?? 0),
    最近变更原因: row.latest_schedule_change_reason ?? "",
    排产备注: row.schedule_note ?? "",
  }));
}

function productionScheduleCalendarRows(database: Database.Database, filters: ReportFilters = {}) {
  const grouped = new Map<
    string,
    {
      计划日期: string;
      机台: string;
      任务数: number;
      计划数量: number;
      负责人: Set<string>;
      生产单号: string[];
      产品摘要: string[];
      交期预警数: number;
      负荷状态: string;
    }
  >();

  productionPlanSourceRows(database, filters).forEach((row) => {
    const plannedDate = String(row.planned_date ?? "未排产");
    const machine = String(row.machine ?? "未指定机台");
    const key = `${plannedDate}::${machine}`;
    const current =
      grouped.get(key) ??
      ({
        计划日期: plannedDate,
        机台: machine,
        任务数: 0,
        计划数量: 0,
        负责人: new Set<string>(),
        生产单号: [],
        产品摘要: [],
        交期预警数: 0,
        负荷状态: "空闲",
      });
    current.任务数 += 1;
    current.计划数量 = roundQty(current.计划数量 + Number(row.order_qty ?? 0));
    if (row.owner) current.负责人.add(String(row.owner));
    current.生产单号.push(String(row.prod_no ?? ""));
    current.产品摘要.push(`${row.product_name ?? "-"} ${roundQty(Number(row.order_qty ?? 0))}${row.unit ?? ""}`);
    if (row.delivery_risk_status !== "normal") current.交期预警数 += 1;
    current.负荷状态 = current.任务数 >= 4 ? "超负荷" : current.任务数 >= 2 ? "正常" : "空闲";
    grouped.set(key, current);
  });

  return Array.from(grouped.values()).map((row) => ({
    计划日期: row.计划日期,
    机台: row.机台,
    任务数: row.任务数,
    计划数量: row.计划数量,
    负责人: Array.from(row.负责人).join("、"),
    负荷状态: row.负荷状态,
    交期预警数: row.交期预警数,
    生产单号: row.生产单号.filter(Boolean).join("、"),
    产品摘要: row.产品摘要.join("；"),
  }));
}

function productionDeliveryWarningExportRows(database: Database.Database, filters: ReportFilters = {}) {
  return productionDeliveryWarningRows(productionPlanSourceRows(database, filters)).map((row) => ({
    生产单号: row.prod_no,
    客户订单: row.order_no,
    客户名称: row.customer_name,
    产品名称: row.product_name,
    状态: row.status_label,
    风险类型: row.warning_type_label,
    风险等级: row.warning_level_label,
    计划日期: row.planned_date || "未排产",
    交付期限: row.due_date,
    影响天数: row.delay_days,
    机台: row.machine ?? "",
    负责人: row.owner ?? "",
  }));
}

function purchaseContractRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT '采购合同' AS template_title,
           '供应商下单' AS document_status,
           '本地化生产流转 ERP' AS company,
           pc.contract_no,
           po.purchase_no,
           s.name AS supplier,
           s.contact AS supplier_contact,
           s.phone AS supplier_phone,
           pc.supplier_order_no,
           pc.contract_date,
           pc.delivery_date,
           pc.payment_terms,
           pc.total_amount,
           pc.status,
           pc.note,
           creator.name AS created_by,
           m.material_code,
           m.name AS material,
           m.spec,
           pol.qty,
           m.unit,
           pol.unit_cost,
           pol.line_amount,
           '正式法律合同以双方盖章扫描件或纸质原件为准，系统记录用于流程追溯、到货跟踪和财务对账。' AS print_note
    FROM purchase_contracts pc
    JOIN purchase_orders po ON po.id = pc.purchase_order_id
    JOIN suppliers s ON s.id = pc.supplier_id
    JOIN users creator ON creator.id = pc.created_by
    JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    JOIN materials m ON m.id = pol.material_id
    WHERE pc.id = COALESCE(?, pc.id)
       OR po.id = COALESCE(?, po.id)
    ORDER BY pc.created_at DESC, pol.rowid
  `).all(entityId ?? null, entityId ?? null));
}

function purchaseArrivalNoticeRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT '到货通知单' AS template_title,
           CASE pan.status
             WHEN 'pending_signoff' THEN '待仓库签收'
             WHEN 'signed' THEN '仓库已签收'
             WHEN 'iqc_created' THEN '已请检'
             WHEN 'inbounded' THEN '已入库'
             WHEN 'rejected' THEN '已退货'
             ELSE pan.status
           END AS document_status,
           '本地化生产流转 ERP' AS company,
           pan.arrival_no,
           po.purchase_no,
           pc.contract_no,
           pc.supplier_order_no,
           s.name AS supplier,
           pan.arrived_at,
           pan.total_arrived_qty,
           pan.total_amount,
           pan.note,
           creator.name AS created_by,
           receiver.name AS warehouse_received_by,
           pan.warehouse_received_at,
           pan.warehouse_note,
           iqc.iqc_no,
           m.material_code,
           m.name AS material,
           m.spec,
           panl.ordered_qty,
           panl.arrived_qty AS qty,
           m.unit,
           panl.unit_cost,
           panl.line_amount,
           panl.batch_hint,
           '仓库签收后才允许提交IQC来料检验；IQC合格或让步接收后才允许采购入库。' AS print_note
    FROM purchase_arrival_notices pan
    JOIN purchase_orders po ON po.id = pan.purchase_order_id
    LEFT JOIN purchase_contracts pc ON pc.id = pan.purchase_contract_id
    JOIN suppliers s ON s.id = pan.supplier_id
    JOIN users creator ON creator.id = pan.created_by
    LEFT JOIN users receiver ON receiver.id = pan.warehouse_received_by
    LEFT JOIN material_iqc_inspections iqc ON iqc.id = pan.iqc_id
    JOIN purchase_arrival_notice_lines panl ON panl.arrival_notice_id = pan.id
    JOIN materials m ON m.id = panl.material_id
    WHERE pan.id = COALESCE(?, pan.id)
       OR po.id = COALESCE(?, po.id)
    ORDER BY pan.created_at DESC, panl.rowid
  `).all(entityId ?? null, entityId ?? null));
}

function purchaseArrivalNoticeChangeLogRows(database: Database.Database, entityId?: string, filters: ReportFilters = {}) {
  const conditions = [
    "(pancl.id = COALESCE(?, pancl.id) OR pan.id = COALESCE(?, pan.id) OR po.id = COALESCE(?, po.id) OR ppci.id = COALESCE(?, ppci.id))",
  ];
  const params: unknown[] = [entityId ?? null, entityId ?? null, entityId ?? null, entityId ?? null];
  addDateFilter(conditions, params, "pancl.changed_at", filters);
  if (filters.supplierId) {
    conditions.push("pan.supplier_id = ?");
    params.push(filters.supplierId);
  }
  if (filters.purchaseOrderId) {
    conditions.push("po.id = ?");
    params.push(filters.purchaseOrderId);
  }

  return filteredRows(database, `
    SELECT '到货通知单变更留痕' AS template_title,
           '已留痕' AS document_status,
           '本地化生产流转 ERP' AS company,
           pancl.change_no,
           pan.arrival_no,
           po.purchase_no,
           pc.contract_no,
           s.name AS supplier,
           ppci.impact_no,
           CASE pancl.change_type
             WHEN 'plan_impact_reschedule' THEN '生产计划影响调整'
             ELSE pancl.change_type
           END AS change_type,
           pancl.old_arrived_at,
           pancl.new_arrived_at,
           pancl.old_note,
           pancl.new_note,
           pancl.reason,
           changer.name AS changed_by,
           pancl.changed_at,
           '到货通知变更留痕用于追溯采购到货计划调整、生产计划影响处理、仓库签收节奏和供应商沟通记录。' AS print_note
    FROM purchase_arrival_notice_change_logs pancl
    JOIN purchase_arrival_notices pan ON pan.id = pancl.arrival_notice_id
    JOIN purchase_orders po ON po.id = pancl.purchase_order_id
    LEFT JOIN purchase_contracts pc ON pc.id = pan.purchase_contract_id
    JOIN suppliers s ON s.id = pan.supplier_id
    LEFT JOIN production_plan_change_impacts ppci ON ppci.id = pancl.impact_id
    JOIN users changer ON changer.id = pancl.changed_by
    WHERE ${conditions.join(" AND ")}
    ORDER BY pancl.changed_at DESC
  `, params);
}

function purchaseArrivalDiscrepancyStatusSql(alias = "pad") {
  return `CASE ${alias}.status
             WHEN 'pending_approval' THEN '差异待审批'
             WHEN 'approved' THEN '差异已批准'
             WHEN 'resolved' THEN '差异已处理'
             WHEN 'rejected' THEN '差异已驳回'
             ELSE ${alias}.status
           END`;
}

function purchaseArrivalDiscrepancyTypeSql(alias = "pad") {
  return `CASE ${alias}.discrepancy_type
             WHEN 'quantity' THEN '数量差异'
             WHEN 'price' THEN '价格差异'
             WHEN 'batch' THEN '批次差异'
             WHEN 'mixed' THEN '混合差异'
             ELSE ${alias}.discrepancy_type
           END`;
}

function purchaseArrivalHandlingSql(alias = "pad", column = "handling_decision") {
  return `CASE ${alias}.${column}
             WHEN 'supplier_replenish' THEN '供应商补货'
             WHEN 'return_goods' THEN '退货/拒收'
             WHEN 'price_adjustment' THEN '价格折让'
             WHEN 'special_accept' THEN '特采接收'
             WHEN 'accept_as_is' THEN '按实接收'
             ELSE ${alias}.${column}
           END`;
}

function purchaseArrivalDiscrepancyRows(database: Database.Database, entityId?: string, filters: ReportFilters = {}) {
  const conditions = ["(pad.id = COALESCE(?, pad.id) OR pan.id = COALESCE(?, pan.id) OR po.id = COALESCE(?, po.id))"];
  const params: unknown[] = [entityId ?? null, entityId ?? null, entityId ?? null];
  addDateFilter(conditions, params, "pad.created_at", filters);
  if (filters.supplierId) {
    conditions.push("pad.supplier_id = ?");
    params.push(filters.supplierId);
  }
  if (filters.purchaseOrderId) {
    conditions.push("pad.purchase_order_id = ?");
    params.push(filters.purchaseOrderId);
  }
  if (filters.materialId) {
    conditions.push("padl.material_id = ?");
    params.push(filters.materialId);
  }

  return filteredRows(database, `
    SELECT '到货差异单' AS template_title,
           ${purchaseArrivalDiscrepancyStatusSql("pad")} AS document_status,
           '本地化生产流转 ERP' AS company,
           pad.discrepancy_no,
           pan.arrival_no,
           po.purchase_no,
           pc.contract_no,
           s.name AS supplier,
           ${purchaseArrivalDiscrepancyTypeSql("pad")} AS discrepancy_type,
           ${purchaseArrivalHandlingSql("pad")} AS handling_decision,
           pad.quantity_variance_qty,
           pad.price_variance_amount,
           pad.total_adjustment_amount,
           pad.reason,
           pad.proposed_action,
           pad.resolution_note,
           creator.name AS created_by,
           approver.name AS approved_by,
           resolver.name AS resolved_by,
           pad.created_at,
           pad.approved_at,
           pad.resolved_at,
           m.material_code,
           m.name AS material,
           m.spec,
           m.unit,
           padl.ordered_qty,
           padl.actual_arrived_qty,
           padl.variance_qty,
           padl.ordered_unit_cost,
           padl.actual_unit_cost,
           padl.price_variance_amount AS line_price_variance_amount,
           padl.expected_batch_hint,
           padl.actual_batch_hint,
           padl.line_adjustment_amount,
           padl.note AS line_note,
           '到货差异单用于冻结签收、审批处置、供应商沟通、后续IQC和采购归档追溯。' AS print_note
    FROM purchase_arrival_discrepancies pad
    JOIN purchase_arrival_notices pan ON pan.id = pad.arrival_notice_id
    JOIN purchase_orders po ON po.id = pad.purchase_order_id
    LEFT JOIN purchase_contracts pc ON pc.id = pad.purchase_contract_id
    JOIN suppliers s ON s.id = pad.supplier_id
    JOIN users creator ON creator.id = pad.created_by
    LEFT JOIN users approver ON approver.id = pad.approved_by
    LEFT JOIN users resolver ON resolver.id = pad.resolved_by
    JOIN purchase_arrival_discrepancy_lines padl ON padl.discrepancy_id = pad.id
    JOIN materials m ON m.id = padl.material_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY pad.created_at DESC, padl.rowid
  `, params);
}

function warehouseSignoffRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT '仓库签收单' AS template_title,
           '已签收' AS document_status,
           '本地化生产流转 ERP' AS company,
           pan.arrival_no,
           po.purchase_no,
           pc.contract_no,
           s.name AS supplier,
           pan.arrived_at,
           receiver.name AS warehouse_received_by,
           pan.warehouse_received_at,
           pan.warehouse_note,
           m.material_code,
           m.name AS material,
           m.spec,
           panl.arrived_qty AS qty,
           m.unit,
           panl.unit_cost,
           panl.line_amount,
           panl.batch_hint,
           '签收仅代表实物交接完成，不代表质量合格；后续由IQC判定是否可入库。' AS print_note
    FROM purchase_arrival_notices pan
    JOIN purchase_orders po ON po.id = pan.purchase_order_id
    LEFT JOIN purchase_contracts pc ON pc.id = pan.purchase_contract_id
    JOIN suppliers s ON s.id = pan.supplier_id
    LEFT JOIN users receiver ON receiver.id = pan.warehouse_received_by
    JOIN purchase_arrival_notice_lines panl ON panl.arrival_notice_id = pan.id
    JOIN materials m ON m.id = panl.material_id
    WHERE (pan.id = COALESCE(?, pan.id) OR po.id = COALESCE(?, po.id))
      AND pan.status IN ('signed', 'iqc_created', 'inbounded', 'rejected')
    ORDER BY pan.warehouse_received_at DESC, panl.rowid
  `).all(entityId ?? null, entityId ?? null));
}

function purchaseReceiptRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT '本地化生产流转 ERP' AS company,
           im.id AS receipt_id,
           po.purchase_no,
           s.name AS supplier,
           s.contact,
           s.phone,
           m.material_code,
           m.name AS material,
           m.spec,
           im.batch_no,
           im.qty,
           m.unit,
           im.unit_cost,
           ROUND(im.qty * im.unit_cost, 2) AS line_amount,
           im.created_at AS received_at,
           '采购入库后自动生成库存批次、库存流水与应付账款' AS note
    FROM inventory_movements im
    JOIN materials m ON m.id = im.item_id
    JOIN purchase_orders po ON po.id = im.source_id AND im.source_type = 'purchase_order'
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE im.item_type = 'material'
      AND im.movement_type = 'purchase_inbound'
      AND (im.id = COALESCE(?, im.id) OR po.id = COALESCE(?, po.id))
    ORDER BY im.created_at DESC
  `).all(entityId ?? null, entityId ?? null));
}

function materialIssueRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT '本地化生产流转 ERP' AS company,
           r.issue_no,
           r.req_no,
           po.prod_no,
           o.order_no,
           c.name AS customer,
           p.name AS product,
           approver.name AS approved_by,
           issuer.name AS issued_by,
           om.name AS bom_material,
           m.name AS issued_material,
           CASE WHEN ra.is_substitute = 1 THEN '是' ELSE '否' END AS is_substitute,
           mb.batch_no,
           ra.qty,
           m.unit,
           ra.unit_cost,
           ROUND(ra.qty * ra.unit_cost, 2) AS line_amount,
           COALESCE(ra.issue_mode, 'fifo') AS issue_mode,
           COALESCE(ra.issue_note, '') AS issue_note,
           COALESCE(r.issue_note, '') AS header_issue_note,
           COALESCE(r.approval_note, '') AS approval_note,
           r.approved_at,
           r.issued_at,
           '原材料出库后扣减批次数量，并按剩余批次重算移动均价' AS note
    FROM requisition_allocations ra
    JOIN requisition_lines rl ON rl.id = ra.requisition_line_id
    JOIN requisitions r ON r.id = rl.requisition_id
    JOIN production_orders po ON po.id = r.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN material_batches mb ON mb.id = ra.batch_id
    JOIN materials m ON m.id = ra.material_id
    JOIN materials om ON om.id = rl.material_id
    LEFT JOIN users approver ON approver.id = r.approved_by
    LEFT JOIN users issuer ON issuer.id = r.issued_by
    WHERE ra.id = COALESCE(?, ra.id) OR r.id = COALESCE(?, r.id)
    ORDER BY r.issued_at DESC, ra.rowid DESC
  `).all(entityId ?? null, entityId ?? null));
}

function materialAdjustmentCostImpactRows(database: Database.Database, entityId?: string, filters: ReportFilters = {}) {
  const conditions = [
    "(pmao.id = COALESCE(?, pmao.id) OR review.id = COALESCE(?, review.id) OR po.id = COALESCE(?, po.id) OR r.id = COALESCE(?, r.id))",
  ];
  const params: unknown[] = [entityId ?? null, entityId ?? null, entityId ?? null, entityId ?? null];
  addDateFilter(conditions, params, "COALESCE(pmao.executed_at, pmao.created_at)", filters);
  if (filters.materialId) {
    conditions.push("pmaol.material_id = ?");
    params.push(filters.materialId);
  }
  if (filters.orderId) {
    conditions.push("o.id = ?");
    params.push(filters.orderId);
  }

  return filteredRows(database, `
    SELECT '补退料成本影响报表' AS template_title,
           '本地化生产流转 ERP' AS company,
           pmao.order_no,
           review.review_no,
           pmas.suggestion_no,
           ppci.impact_no,
           po.prod_no,
           r.req_no,
           o.order_no AS customer_order_no,
           c.name AS customer,
           p.name AS product,
           CASE pmao.adjustment_type
             WHEN 'supplement' THEN '补料'
             WHEN 'return' THEN '退料'
             WHEN 'check' THEN '复核'
             ELSE pmao.adjustment_type
           END AS adjustment_type,
           CASE pmaol.direction
             WHEN 'out' THEN '补料出库'
             WHEN 'in' THEN '退料入库'
             ELSE pmaol.direction
           END AS execution_direction,
           m.material_code,
           m.name AS material,
           m.spec,
           m.unit,
           pmaol.batch_no,
           pmaol.qty,
           pmaol.unit_cost,
           pmaol.line_amount,
           ROUND(CASE pmaol.direction WHEN 'out' THEN pmaol.line_amount WHEN 'in' THEN -pmaol.line_amount ELSE 0 END, 2) AS cost_impact_amount,
           ROUND(CASE pmaol.direction WHEN 'out' THEN -pmaol.line_amount WHEN 'in' THEN pmaol.line_amount ELSE 0 END, 2) AS inventory_value_delta,
           CASE
             WHEN pmaol.direction = 'out' THEN '生产成本增加'
             WHEN pmaol.direction = 'in' THEN '生产成本冲减'
             ELSE '成本复核'
           END AS cost_impact_direction,
           CASE
             WHEN review.id IS NOT NULL THEN '已复核'
             WHEN pmao.status = 'executed' THEN '待复核'
             ELSE '未执行'
           END AS review_status_label,
           CASE review.review_result
             WHEN 'approved' THEN '复核通过'
             WHEN 'exception' THEN '复核异常'
             ELSE ''
           END AS review_result_label,
           reviewer.name AS reviewed_by,
           review.review_note,
           pmao.executed_at,
           executor.name AS executed_by,
           review.reviewed_at,
           '补退料成本影响报表用于复核补料、退料对生产成本和库存价值的影响，并追溯到批次库存流水。' AS print_note
    FROM production_material_adjustment_order_lines pmaol
    JOIN production_material_adjustment_orders pmao ON pmao.id = pmaol.order_id
    JOIN production_material_adjustment_suggestions pmas ON pmas.id = pmao.suggestion_id
    JOIN production_plan_change_impacts ppci ON ppci.id = pmao.impact_id
    JOIN production_orders po ON po.id = pmao.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN materials m ON m.id = pmaol.material_id
    LEFT JOIN requisitions r ON r.id = pmao.requisition_id
    LEFT JOIN users executor ON executor.id = pmao.executed_by
    LEFT JOIN production_material_adjustment_order_reviews review ON review.order_id = pmao.id
    LEFT JOIN users reviewer ON reviewer.id = review.reviewed_by
    WHERE ${conditions.join(" AND ")}
    ORDER BY COALESCE(pmao.executed_at, pmao.created_at) DESC, pmaol.rowid ASC
  `, params);
}

function costAnomalyDetailRows(database: Database.Database, filters: ReportFilters = {}): Array<Record<string, unknown>> {
  const conditions = ["1 = 1"];
  const params: unknown[] = [];
  addDateFilter(conditions, params, "pca.created_at", filters);
  if (filters.customerId) {
    conditions.push("o.customer_id = ?");
    params.push(filters.customerId);
  }
  if (filters.orderId) {
    conditions.push("o.id = ?");
    params.push(filters.orderId);
  }
  if (filters.materialId) {
    conditions.push("pmaol.material_id = ?");
    params.push(filters.materialId);
  }

  const detailRows = filteredRows(database, `
    SELECT '成本异常分析报表' AS template_title,
           '本地化生产流转 ERP' AS company,
           pca.id,
           pca.id AS adjustment_id,
           pca.adjustment_no,
           pca.production_order_id,
           po.prod_no,
           o.id AS order_id,
           o.order_no,
           o.customer_id,
           c.name AS customer_name,
           p.name AS product_name,
           pca.cost_summary_id,
           pcs.cost_no,
           exception.exception_no,
           exception.reason_type,
           pmao.order_no AS material_adjustment_order_no,
           pmao.adjustment_type,
           pmaol.material_id,
           m.material_code,
           m.name AS material_name,
           m.unit AS material_unit,
           review.review_no,
           pca.adjustment_amount,
           pca.previous_total_cost,
           pca.new_total_cost,
           pca.previous_unit_cost,
           pca.new_unit_cost,
           pca.status,
           pca.adjustment_note,
           pca.reversal_reason,
           creator.name AS created_by_name,
           applier.name AS applied_by_name,
           reverser.name AS reversed_by_name,
           pca.created_at,
           pca.applied_at,
           pca.reversed_at,
           ar.request_no AS approval_request_no,
           ar.status AS approval_status,
           ar.created_at AS approval_created_at,
           ar.decided_at AS approval_decided_at,
           ar.decision_note AS approval_note,
           approvalDecider.name AS approval_decided_by_name,
           rule.rule_name,
           rule.risk_level,
           COALESCE(rule.allow_reversal, 1) AS allow_reversal,
           rule.reversal_approver_role,
           dr.reversal_no,
           dr.status AS reversal_status,
           dr.reason AS document_reversal_reason,
           dr.reversed_at AS document_reversed_at,
           reversalUser.name AS document_reversed_by_name,
           exception.owner_role,
           remediation.id AS remediation_id,
           remediation.remediation_no,
           remediation.status AS remediation_status,
           remediation.severity AS remediation_severity,
           remediation.root_cause AS remediation_root_cause,
           remediation.corrective_action AS remediation_corrective_action,
           remediation.preventive_action AS remediation_preventive_action,
           remediation.due_date AS remediation_due_date,
           remediation.result_note AS remediation_result_note,
           remediation.review_note AS remediation_review_note,
           remediationOwner.name AS remediation_owner_name,
           remediationCloser.name AS remediation_closed_by_name,
           remediation.closed_at AS remediation_closed_at
    FROM production_cost_adjustments pca
    JOIN production_orders po ON po.id = pca.production_order_id
    JOIN orders o ON o.id = pca.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN production_cost_summaries pcs ON pcs.id = pca.cost_summary_id
    LEFT JOIN production_material_adjustment_review_exceptions exception ON exception.id = pca.exception_id
    LEFT JOIN production_material_adjustment_orders pmao ON pmao.id = exception.order_id
    LEFT JOIN production_material_adjustment_order_lines pmaol ON pmaol.order_id = pmao.id
    LEFT JOIN materials m ON m.id = pmaol.material_id
    LEFT JOIN production_material_adjustment_order_reviews review ON review.order_id = pmao.id
    LEFT JOIN approval_requests ar ON ar.id = pca.approval_request_id
    LEFT JOIN approval_rules rule ON rule.id = ar.rule_id
    LEFT JOIN users approvalDecider ON approvalDecider.id = ar.decided_by
    LEFT JOIN document_reversals dr ON dr.id = pca.reversal_id
    LEFT JOIN users reversalUser ON reversalUser.id = dr.reversed_by
    LEFT JOIN production_cost_anomaly_remediations remediation ON remediation.adjustment_id = pca.id
    LEFT JOIN users remediationOwner ON remediationOwner.id = remediation.owner_id
    LEFT JOIN users remediationCloser ON remediationCloser.id = remediation.closed_by
    JOIN users creator ON creator.id = pca.created_by
    LEFT JOIN users applier ON applier.id = pca.applied_by
    LEFT JOIN users reverser ON reverser.id = pca.reversed_by
    WHERE ${conditions.join(" AND ")}
    ORDER BY pca.created_at DESC
  `, params);

  return detailRows.map((row): Record<string, unknown> => {
    const status = String(row.status ?? "");
    const allowReversal = Number(row.allow_reversal ?? 1) === 1;
    const blocked = status === "applied" && !allowReversal;
    const anomalyStatusLabel =
      status === "rejected"
        ? "审批驳回"
        : status === "reversed"
          ? "已红冲"
          : status === "pending_approval"
            ? "待审批"
            : status === "pending_summary"
              ? "待成本归集"
              : blocked
                ? "红冲受控"
                : productionCostAdjustmentStatusLabel(status);
    return {
      ...row,
      status_label: productionCostAdjustmentStatusLabel(status),
      anomaly_status_label: anomalyStatusLabel,
      reason_type_label: materialAdjustmentExceptionReasonLabel(String(row.reason_type ?? "other")),
      adjustment_type_label: approvalRuleAdjustmentTypeLabel(String(row.adjustment_type ?? "")),
      approval_status_label: row.approval_status ? approvalRequestStatusLabel(String(row.approval_status)) : "",
      risk_level_label: approvalRiskLevelLabel(String(row.risk_level ?? "normal")),
      red_offset_control_status: allowReversal ? "允许红冲" : "禁止直接红冲",
      red_offset_blocked_flag: blocked ? 1 : 0,
      production_drilldown_label: `生产工单 ${String(row.prod_no ?? "-")} / ${String(row.product_name ?? "-")}`,
      approval_drilldown_label: row.approval_request_no
        ? `${String(row.approval_request_no)} / ${row.approval_status ? approvalRequestStatusLabel(String(row.approval_status)) : "-"}`
        : "未触发审批",
      reversal_status_label: row.reversal_no ? "已冲销" : "",
      remediation_status_label: row.remediation_status
        ? costAnomalyRemediationStatusLabel(String(row.remediation_status))
        : "未生成",
      remediation_severity_label: row.remediation_severity
        ? costAnomalySeverityLabel(String(row.remediation_severity))
        : "",
      drilldown_stage_label: row.remediation_status
        ? String(row.remediation_status) === "closed"
          ? "整改闭环"
          : "已生成整改"
        : "待生成整改",
      reversal_approver_role_label: row.reversal_approver_role ? roleLabel(String(row.reversal_approver_role)) : "",
      owner_role_label: row.owner_role ? roleLabel(String(row.owner_role)) : "",
    };
  });
}

function groupCostAnomalyRows(rows: Array<Record<string, unknown>>, key: string, labelKey: string) {
  const grouped = new Map<string, Record<string, unknown>>();
  rows.forEach((row) => {
    const groupKey = String(row[key] ?? row[labelKey] ?? "未分类");
    const current =
      grouped.get(groupKey) ??
      ({
        [key]: row[key] ?? groupKey,
        [labelKey]: row[labelKey] ?? groupKey,
        count: 0,
        total_adjustment_amount: 0,
        pending_approval_count: 0,
        rejected_count: 0,
        reversed_count: 0,
        red_offset_blocked_count: 0,
      } satisfies Record<string, unknown>);
    current.count = Number(current.count ?? 0) + 1;
    current.total_adjustment_amount = roundMoney(Number(current.total_adjustment_amount ?? 0) + Math.abs(Number(row.adjustment_amount ?? 0)));
    if (String(row.status) === "pending_approval") current.pending_approval_count = Number(current.pending_approval_count ?? 0) + 1;
    if (String(row.status) === "rejected") current.rejected_count = Number(current.rejected_count ?? 0) + 1;
    if (String(row.status) === "reversed") current.reversed_count = Number(current.reversed_count ?? 0) + 1;
    if (Number(row.red_offset_blocked_flag ?? 0) === 1) current.red_offset_blocked_count = Number(current.red_offset_blocked_count ?? 0) + 1;
    grouped.set(groupKey, current);
  });
  return Array.from(grouped.values()).sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
}

function costAnomalyAnalyticsRows(database: Database.Database, filters: ReportFilters = {}) {
  const detail = costAnomalyDetailRows(database, filters);
  const remediationIds = new Set(detail.map((row) => String(row.remediation_id ?? "")).filter(Boolean));
  const closedRemediationIds = new Set(
    detail
      .filter((row) => row.remediation_id && String(row.remediation_status) === "closed")
      .map((row) => String(row.remediation_id)),
  );
  const totals = {
    total_count: detail.length,
    pending_approval_count: detail.filter((row) => String(row.status) === "pending_approval").length,
    rejected_count: detail.filter((row) => String(row.status) === "rejected").length,
    applied_count: detail.filter((row) => String(row.status) === "applied").length,
    reversed_count: detail.filter((row) => String(row.status) === "reversed").length,
    red_offset_blocked_count: detail.filter((row) => Number(row.red_offset_blocked_flag ?? 0) === 1).length,
    remediation_count: remediationIds.size,
    remediation_closed_count: closedRemediationIds.size,
    remediation_open_count: remediationIds.size - closedRemediationIds.size,
    total_adjustment_amount: roundMoney(detail.reduce((sum, row) => sum + Math.abs(Number(row.adjustment_amount ?? 0)), 0)),
    rejected_amount: roundMoney(
      detail.filter((row) => String(row.status) === "rejected").reduce((sum, row) => sum + Math.abs(Number(row.adjustment_amount ?? 0)), 0),
    ),
    reversed_amount: roundMoney(
      detail.filter((row) => String(row.status) === "reversed").reduce((sum, row) => sum + Math.abs(Number(row.adjustment_amount ?? 0)), 0),
    ),
  };
  return {
    totals,
    byReason: groupCostAnomalyRows(detail, "reason_type", "reason_type_label"),
    byMaterial: groupCostAnomalyRows(detail, "material_id", "material_name"),
    byResponsibility: groupCostAnomalyRows(detail, "owner_role", "owner_role_label"),
    detail,
  };
}

function costAnomalyDrilldownRows(database: Database.Database, filters: ReportFilters = {}) {
  return costAnomalyDetailRows(database, filters);
}

function costAnomalySummaryRows(database: Database.Database, filters: ReportFilters = {}) {
  const analytics = costAnomalyAnalyticsRows(database, filters);
  return [
    {
      report_name: "成本异常分析报表",
      generated_at: now(),
      filter_summary: reportFilterSummary(database, filters),
      ...(analytics.totals as Record<string, unknown>),
    },
  ];
}

function materialAdjustmentOrderRows(database: Database.Database, entityId?: string, filters: ReportFilters = {}) {
  const conditions = [
    "(pmao.id = COALESCE(?, pmao.id) OR pmas.id = COALESCE(?, pmas.id) OR ppci.id = COALESCE(?, ppci.id) OR r.id = COALESCE(?, r.id) OR po.id = COALESCE(?, po.id))",
  ];
  const params: unknown[] = [entityId ?? null, entityId ?? null, entityId ?? null, entityId ?? null, entityId ?? null];
  addDateFilter(conditions, params, "pmao.created_at", filters);

  return filteredRows(database, `
    SELECT '正式补退料单' AS template_title,
           CASE pmao.status
             WHEN 'pending_execution' THEN '待执行'
             WHEN 'executed' THEN '已执行'
             WHEN 'voided' THEN '已关闭'
             ELSE pmao.status
           END AS document_status,
           '本地化生产流转 ERP' AS company,
           pmao.order_no,
           pmas.suggestion_no,
           ppci.impact_no,
           po.prod_no,
           r.req_no,
           o.order_no AS customer_order_no,
           c.name AS customer,
           p.name AS product,
           CASE pmao.adjustment_type
             WHEN 'supplement' THEN '补料'
             WHEN 'return' THEN '退料'
             WHEN 'check' THEN '复核'
             ELSE pmao.adjustment_type
           END AS adjustment_type,
           pmao.qty,
           pmao.material_summary,
           pmas.reason AS suggestion_reason,
           pmas.confirmation_note,
           creator.name AS created_by,
           pmao.created_at,
           executor.name AS executed_by,
           pmao.executed_at,
           pmao.execution_note,
           line_material.material_code AS execution_material_code,
           line_material.name AS execution_material,
           line_material.unit AS execution_unit,
           pmaol.batch_no AS execution_batch_no,
           CASE pmaol.direction
             WHEN 'out' THEN '补料出库'
             WHEN 'in' THEN '退料入库'
             ELSE pmaol.direction
           END AS execution_direction,
           pmaol.qty AS execution_qty,
           pmaol.unit_cost AS execution_unit_cost,
           pmaol.line_amount AS execution_line_amount,
           '正式补退料单由生产确认补退料建议后生成，作为仓库补发、退料、盘点复核和生产计划变更追溯依据。' AS print_note
    FROM production_material_adjustment_orders pmao
    JOIN production_material_adjustment_suggestions pmas ON pmas.id = pmao.suggestion_id
    JOIN production_plan_change_impacts ppci ON ppci.id = pmao.impact_id
    JOIN production_orders po ON po.id = pmao.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN requisitions r ON r.id = pmao.requisition_id
    JOIN users creator ON creator.id = pmao.created_by
    LEFT JOIN users executor ON executor.id = pmao.executed_by
    LEFT JOIN production_material_adjustment_order_lines pmaol ON pmaol.order_id = pmao.id
    LEFT JOIN materials line_material ON line_material.id = pmaol.material_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY pmao.created_at DESC, pmaol.rowid ASC
  `, params);
}

function stocktakeRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT '库存盘点单' AS document_type,
           '本地化生产流转 ERP' AS company,
           st.stocktake_no,
           m.material_code,
           m.name AS material,
           m.spec,
           m.unit,
           st.book_qty,
           st.actual_qty,
           st.difference_qty,
           CASE
             WHEN st.difference_qty > 0 THEN '盘点盘盈'
             WHEN st.difference_qty < 0 THEN '盘点盘亏'
             ELSE '账实相符'
           END AS adjustment_type,
           st.unit_cost,
           st.adjustment_amount,
           CASE
             WHEN st.status = 'pending_approval' THEN '待审批'
             WHEN st.status = 'approved' THEN '已调整'
             WHEN st.status = 'rejected' THEN '已驳回'
             ELSE st.status
           END AS status,
           counter.name AS counted_by,
           st.counted_at,
           approver.name AS approved_by,
           st.approved_at,
           st.remark,
           st.approval_note,
           '盘点单经审批后自动生成库存流水，并按剩余批次重算移动均价' AS note
    FROM stocktakes st
    JOIN materials m ON m.id = st.material_id
    JOIN users counter ON counter.id = st.counted_by
    LEFT JOIN users approver ON approver.id = st.approved_by
    WHERE st.id = COALESCE(?, st.id)
    ORDER BY st.created_at DESC
  `).all(entityId ?? null));
}

function salesReturnRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT '销售退货单' AS "单据类型",
           '本地化生产流转 ERP' AS "公司抬头",
           sr.return_no AS "退货单号",
           s.shipment_no AS "原发货单",
           o.order_no AS "销售订单",
           c.name AS "客户名称",
           p.name AS "产品名称",
           p.spec AS "规格型号",
           sr.return_qty AS "退货数量",
           p.unit AS "单位",
           sr.return_amount AS "退货金额",
           sr.cost_amount AS "退货成本",
           sr.offset_amount AS "应收抵减",
           sr.refund_due_amount AS "待退金额",
           sr.refunded_amount AS "已退金额",
           CASE sr.disposition
             WHEN 'return_to_stock' THEN '退货入库'
             WHEN 'rework' THEN '返工处理'
             WHEN 'scrap' THEN '报废处理'
             ELSE sr.disposition
           END AS "退货处置",
           CASE sr.refund_status
             WHEN 'pending_refund' THEN '待退款'
             WHEN 'partial_refunded' THEN '部分退款'
             WHEN 'refunded' THEN '已退款'
             WHEN 'not_required' THEN '无需退款'
             ELSE sr.refund_status
           END AS "退款状态",
           CASE sr.replacement_status
             WHEN 'pending_replacement' THEN '待补发'
             WHEN 'replaced' THEN '已补发'
             WHEN 'not_required' THEN '无需补发'
             ELSE sr.replacement_status
           END AS "补发状态",
           sr.reason AS "退货原因",
           sr.note AS "退货备注",
           creator.name AS "经办人",
           sr.received_at AS "退货日期",
           sr.created_at AS "制单时间",
           '销售退货单用于退货收货、应收调整、客户退款与售后补发归档' AS "单据说明",
           '商务登记 / 仓库收货 / 品控复核 / 财务确认' AS "签字流程"
    FROM sales_returns sr
    JOIN shipments s ON s.id = sr.shipment_id
    JOIN orders o ON o.id = sr.order_id
    JOIN customers c ON c.id = sr.customer_id
    JOIN products p ON p.id = sr.product_id
    LEFT JOIN users creator ON creator.id = sr.created_by
    WHERE sr.id = COALESCE(?, sr.id)
    ORDER BY sr.created_at DESC
  `).all(entityId ?? null));
}

function salesReturnAllocationRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT sr.return_no AS "退货单号",
           s.shipment_no AS "原发货单",
           c.name AS "客户名称",
           p.name AS "产品名称",
           sra.batch_no AS "退回批次",
           sra.qty AS "退回数量",
           p.unit AS "单位",
           sra.unit_cost AS "单位成本",
           sra.cost_amount AS "退货成本",
           sra.created_at AS "退货入库时间"
    FROM sales_return_allocations sra
    JOIN sales_returns sr ON sr.id = sra.sales_return_id
    JOIN shipments s ON s.id = sr.shipment_id
    JOIN customers c ON c.id = sr.customer_id
    JOIN products p ON p.id = sr.product_id
    WHERE sr.id = COALESCE(?, sr.id)
    ORDER BY sra.created_at DESC
  `).all(entityId ?? null));
}

function customerRefundRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT '客户退款单' AS "单据类型",
           '本地化生产流转 ERP' AS "公司抬头",
           cr.refund_no AS "退款单号",
           sr.return_no AS "退货单号",
           r.receivable_no AS "应收单号",
           c.name AS "客户名称",
           cr.amount AS "退款金额",
           cr.method AS "退款方式",
           cr.note AS "退款备注",
           CASE cr.status
             WHEN 'paid' THEN '已登记'
             ELSE cr.status
           END AS "状态",
           refunder.name AS "经办人",
           cr.refunded_at AS "退款日期",
           cr.created_at AS "制单时间",
           '客户退款单用于财务付款、客户对账确认和本地归档，不影响原发货批次追溯' AS "单据说明",
           '财务制单 / 业务确认 / 财务复核 / 管理审批' AS "签字流程"
    FROM customer_refunds cr
    JOIN sales_returns sr ON sr.id = cr.sales_return_id
    LEFT JOIN receivables r ON r.id = cr.receivable_id
    JOIN customers c ON c.id = cr.customer_id
    LEFT JOIN users refunder ON refunder.id = cr.refunded_by
    WHERE cr.id = COALESCE(?, cr.id)
    ORDER BY cr.refunded_at DESC, cr.created_at DESC
  `).all(entityId ?? null));
}

function replacementShipmentRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT '补开发货单' AS "单据类型",
           '本地化生产流转 ERP' AS "公司抬头",
           s.shipment_no AS "补发单号",
           sr.return_no AS "退货单号",
           os.shipment_no AS "原发货单",
           o.order_no AS "销售订单",
           c.name AS "客户名称",
           p.name AS "产品名称",
           p.spec AS "规格型号",
           s.shipped_qty AS "补发数量",
           p.unit AS "单位",
           0 AS "销售金额",
           s.cost_amount AS "出库成本",
           s.financial_status AS "财务状态",
           s.delivery_address AS "送货地址",
           s.consignee AS "收货人",
           s.contact_phone AS "联系电话",
           s.logistics_company AS "物流公司",
           s.vehicle_no AS "车牌号",
           s.tracking_no AS "物流单号",
           s.remark AS "备注",
           s.shipped_at AS "补发日期",
           shipper.name AS "发货人",
           '补开发货单为售后补发，不重复生成应收账款' AS "单据说明",
           '商务制单 / 仓库发货 / 物流承运 / 客户签收' AS "签字流程"
    FROM shipments s
    JOIN sales_returns sr ON sr.id = s.replacement_for_return_id
    LEFT JOIN shipments os ON os.id = s.original_shipment_id
    JOIN orders o ON o.id = s.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN users shipper ON shipper.id = s.shipped_by
    WHERE s.shipment_type = 'replacement'
      AND (s.id = COALESCE(?, s.id) OR sr.id = COALESCE(?, sr.id))
    ORDER BY s.shipped_at DESC, s.created_at DESC
  `).all(entityId ?? null, entityId ?? null));
}

function replacementShipmentAllocationRows(database: Database.Database, entityId?: string) {
  return rows(database.prepare(`
    SELECT s.shipment_no AS "补发单号",
           sr.return_no AS "退货单号",
           os.shipment_no AS "原发货单",
           c.name AS "客户名称",
           p.name AS "产品名称",
           fsa.batch_no AS "出库批次",
           fsa.qty AS "出库数量",
           p.unit AS "单位",
           fsa.unit_cost AS "单位成本",
           fsa.cost_amount AS "出库成本",
           fsa.created_at AS "出库时间"
    FROM finished_shipment_allocations fsa
    JOIN shipments s ON s.id = fsa.shipment_id
    JOIN sales_returns sr ON sr.id = s.replacement_for_return_id
    LEFT JOIN shipments os ON os.id = s.original_shipment_id
    JOIN orders o ON o.id = s.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    WHERE s.shipment_type = 'replacement'
      AND (s.id = COALESCE(?, s.id) OR sr.id = COALESCE(?, sr.id))
    ORDER BY fsa.created_at DESC
  `).all(entityId ?? null, entityId ?? null));
}

function inventoryTraceRows(database: Database.Database, entityId?: string, filters: ReportFilters = {}) {
  const conditions = ["(im.id = COALESCE(?, im.id) OR im.source_id = COALESCE(?, im.source_id))"];
  const params: unknown[] = [entityId ?? null, entityId ?? null];
  if (filters.materialId) {
    conditions.push("im.item_id = ?");
    params.push(filters.materialId);
  }
  if (filters.purchaseOrderId) {
    conditions.push("COALESCE(po.id, po_iqc.id) = ?");
    params.push(filters.purchaseOrderId);
  }
  if (filters.orderId) {
    conditions.push("(o_req.id = ? OR o_fgr.id = ? OR o_shp.id = ?)");
    params.push(filters.orderId, filters.orderId, filters.orderId);
  }
  addDateFilter(conditions, params, "im.created_at", filters);

  return filteredRows(database, `
    SELECT im.id,
           im.item_type,
           im.item_id,
           COALESCE(m.material_code, p.product_code, im.item_id) AS item_code,
           COALESCE(m.name, p.name, im.item_id) AS item_name,
           COALESCE(m.name, p.name, im.item_id) AS material_name,
           COALESCE(m.unit, p.unit, '') AS unit,
           im.batch_no,
           im.qty,
           im.unit_cost,
           ROUND(ABS(im.qty) * im.unit_cost, 2) AS line_amount,
           CASE WHEN im.qty >= 0 THEN 'inbound' ELSE 'outbound' END AS direction,
           im.movement_type,
           CASE im.movement_type
             WHEN 'purchase_inbound' THEN '采购入库'
             WHEN 'issue' THEN '生产发料'
             WHEN 'finished_inbound' THEN '成品入库'
             WHEN 'shipment_outbound' THEN '发货出库'
             WHEN 'purchase_inbound_reversal' THEN '采购入库冲销'
             WHEN 'shipment_outbound_reversal' THEN '发货出库冲销'
             WHEN 'sales_return_inbound' THEN '销售退货入库'
             WHEN 'replacement_shipment_outbound' THEN '售后补发出库'
             WHEN 'stocktake_gain' THEN '盘点盘盈'
             WHEN 'stocktake_loss' THEN '盘点盘亏'
             WHEN 'material_adjustment_issue' THEN '补料出库'
             WHEN 'material_adjustment_return' THEN '退料入库'
             ELSE im.movement_type
           END AS movement_type_label,
           im.source_type,
           im.source_id,
           CASE im.source_type
             WHEN 'purchase_order' THEN '采购订单'
             WHEN 'material_iqc_inspection' THEN 'IQC放行入库'
             WHEN 'requisition' THEN '领料单'
             WHEN 'finished_receipt' THEN '成品入库单'
             WHEN 'shipment' THEN '发货单'
             WHEN 'document_reversal' THEN '冲销单'
             WHEN 'sales_return' THEN '销售退货单'
             WHEN 'stocktake' THEN '库存盘点'
             WHEN 'purchase' THEN '采购入库'
             WHEN 'material_adjustment_order' THEN '补退料单'
             ELSE im.source_type
           END AS source_label,
           COALESCE(
             po.purchase_no,
             iqc.iqc_no,
             NULLIF(r.issue_no, ''),
             r.req_no,
             fgr.receipt_no,
             s.shipment_no,
             dr.reversal_no,
             sr.return_no,
             st.stocktake_no,
             pmao.order_no,
             im.source_id
           ) AS source_no,
           COALESCE(o_req.order_no, o_fgr.order_no, o_shp.order_no, '') AS order_no,
           COALESCE(c_req.name, c_fgr.name, c_shp.name, '') AS customer_name,
           COALESCE(sup.name, sup_iqc.name, '') AS supplier_name,
           im.created_at
    FROM inventory_movements im
    LEFT JOIN materials m ON im.item_type = 'material' AND m.id = im.item_id
    LEFT JOIN products p ON im.item_type = 'product' AND p.id = im.item_id
    LEFT JOIN purchase_orders po ON im.source_type = 'purchase_order' AND po.id = im.source_id
    LEFT JOIN suppliers sup ON sup.id = po.supplier_id
    LEFT JOIN material_iqc_inspections iqc ON im.source_type = 'material_iqc_inspection' AND iqc.id = im.source_id
    LEFT JOIN purchase_orders po_iqc ON po_iqc.id = iqc.purchase_order_id
    LEFT JOIN suppliers sup_iqc ON sup_iqc.id = po_iqc.supplier_id
    LEFT JOIN requisitions r ON im.source_type = 'requisition' AND r.id = im.source_id
    LEFT JOIN production_orders prod_req ON prod_req.id = r.production_order_id
    LEFT JOIN orders o_req ON o_req.id = prod_req.order_id
    LEFT JOIN customers c_req ON c_req.id = o_req.customer_id
    LEFT JOIN finished_goods_receipts fgr ON im.source_type = 'finished_receipt' AND fgr.id = im.source_id
    LEFT JOIN production_orders prod_fgr ON prod_fgr.id = fgr.production_order_id
    LEFT JOIN orders o_fgr ON o_fgr.id = prod_fgr.order_id
    LEFT JOIN customers c_fgr ON c_fgr.id = o_fgr.customer_id
    LEFT JOIN shipments s ON im.source_type = 'shipment' AND s.id = im.source_id
    LEFT JOIN orders o_shp ON o_shp.id = s.order_id
    LEFT JOIN customers c_shp ON c_shp.id = o_shp.customer_id
    LEFT JOIN document_reversals dr ON im.source_type = 'document_reversal' AND dr.id = im.source_id
    LEFT JOIN sales_returns sr ON im.source_type = 'sales_return' AND sr.id = im.source_id
    LEFT JOIN stocktakes st ON im.source_type = 'stocktake' AND st.id = im.source_id
    LEFT JOIN production_material_adjustment_orders pmao ON im.source_type = 'material_adjustment_order' AND pmao.id = im.source_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY im.created_at DESC, im.rowid DESC
  `, params);
}

function deliveryNoteRows(database: Database.Database, shipmentId?: string) {
  return rows(database.prepare(`
    SELECT '本地化生产流转 ERP 演示公司' AS company,
           s.shipment_no, s.shipped_at, c.name AS customer,
           COALESCE(NULLIF(s.consignee, ''), c.contact) AS contact,
           COALESCE(NULLIF(s.contact_phone, ''), c.phone) AS phone,
           COALESCE(NULLIF(s.delivery_address, ''), c.address) AS delivery_address,
           s.logistics_company, s.vehicle_no, s.tracking_no,
           o.order_no, o.customer_po_no, o.sales_contract_no,
           p.name AS product, s.shipped_qty, p.unit,
           fb.batch_no, fb.unit_cost, ROUND(s.shipped_qty * fb.unit_cost, 2) AS reference_cost,
           COALESCE(NULLIF(s.remark, ''), '随货附检验记录，批次可追溯') AS note
    FROM shipments s
    JOIN orders o ON o.id = s.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN production_orders po ON po.id = s.production_order_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN finished_batches fb ON fb.production_order_id = po.id AND fb.kind = 'finished'
    WHERE s.id = COALESCE(?, s.id)
    ORDER BY s.created_at DESC
  `).all(shipmentId ?? null));
}

function inventoryDailyRows(database: Database.Database, filters: ReportFilters = {}) {
  const operatingParameters = operatingParameterValues(database);
  const conditions = ["1 = 1"];
  const params: unknown[] = [];
  if (filters.materialId) {
    conditions.push("m.id = ?");
    params.push(filters.materialId);
  }
  addDateFilter(conditions, params, "m.last_movement_at", filters);
  return filteredRows(database, `
    SELECT m.id, m.name, m.unit, m.stock_qty, m.average_cost,
           ROUND(m.stock_qty * m.average_cost, 2) AS stock_value,
           m.reorder_min_qty,
           m.last_movement_at,
           CAST(julianday('now') - julianday(m.last_movement_at) AS INTEGER) AS inactive_days,
           CASE
             WHEN CAST(julianday('now') - julianday(m.last_movement_at) AS INTEGER) >= ? THEN '积压库存'
             WHEN CAST(julianday('now') - julianday(m.last_movement_at) AS INTEGER) >= ? THEN '呆滞预警'
             WHEN m.reorder_min_qty > 0 AND m.stock_qty <= m.reorder_min_qty THEN '安全库存预警'
             ELSE '正常'
           END AS warning
    FROM materials m
    WHERE ${conditions.join(" AND ")}
    ORDER BY warning DESC, m.id
  `, [operatingParameters.overstockDays, operatingParameters.staleWarningDays, ...params]);
}

function inventoryAgingRows(database: Database.Database, agingStatus: "stale_warning" | "overstock", filters: ReportFilters = {}) {
  const operatingParameters = operatingParameterValues(database);
  const minDays = agingStatus === "overstock" ? operatingParameters.overstockDays : operatingParameters.staleWarningDays;
  const maxDays = agingStatus === "overstock" ? 100000 : operatingParameters.overstockDays - 1;
  const conditions = [
    "m.stock_qty > 0",
    "m.last_movement_at IS NOT NULL",
    "CAST(julianday('now') - julianday(m.last_movement_at) AS INTEGER) BETWEEN ? AND ?",
  ];
  const params: unknown[] = [agingStatus, minDays, maxDays];
  if (filters.materialId) {
    conditions.push("m.id = ?");
    params.push(filters.materialId);
  }
  addDateFilter(conditions, params, "m.last_movement_at", filters);
  return filteredRows(database, `
    SELECT m.id AS material_id,
           m.name AS material_name,
           m.name,
           m.unit,
           m.stock_qty,
           m.average_cost,
           ROUND(m.stock_qty * m.average_cost, 2) AS stock_value,
           m.last_movement_at,
           CAST(julianday('now') - julianday(m.last_movement_at) AS INTEGER) AS inactive_days,
           CASE WHEN ? = 'overstock' THEN '积压库存' ELSE '呆滞预警' END AS aging_status,
           COALESCE(GROUP_CONCAT(mb.batch_no || ':' || mb.qty || m.unit, ' / '), '') AS batches
    FROM materials m
    LEFT JOIN material_batches mb ON mb.material_id = m.id AND mb.qty > 0
    WHERE ${conditions.join(" AND ")}
    GROUP BY m.id
    ORDER BY inactive_days DESC, stock_value DESC
  `, params);
}

function inventoryOverstockSummaryRows(database: Database.Database, filters: ReportFilters = {}) {
  const operatingParameters = operatingParameterValues(database);
  const staleRows = inventoryAgingRows(database, "stale_warning", filters);
  const overstockRows = inventoryAgingRows(database, "overstock", filters);
  return [
    {
      report_type: "inventory_overstock",
      generated_at: now(),
      stale_warning_count: staleRows.length,
      overstock_count: overstockRows.length,
      overstock_value: roundMoney(overstockRows.reduce((sum, item) => sum + Number(item.stock_value ?? 0), 0)),
      rule: `${operatingParameters.staleWarningDays} 天未发生变动为呆滞预警；${operatingParameters.overstockDays} 天未发生变动纳入积压报表`,
    },
  ];
}

function qualityExceptionRows(database: Database.Database, filters: ReportFilters = {}) {
  const conditions = ["td.status != 'voided'"];
  const params: unknown[] = [];
  addDateFilter(conditions, params, "td.created_at", filters);
  if (filters.customerId) {
    conditions.push("o.customer_id = ?");
    params.push(filters.customerId);
  }
  if (filters.orderId) {
    conditions.push("o.id = ?");
    params.push(filters.orderId);
  }
  if (filters.materialId) {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM requisitions r
        JOIN requisition_lines rl ON rl.requisition_id = r.id
        WHERE r.production_order_id = td.production_order_id
          AND rl.material_id = ?
      )
    `);
    params.push(filters.materialId);
  }

  return filteredRows(database, `
    SELECT td.disposition_no,
           i.inspection_no,
           po.prod_no,
           o.order_no,
           c.name AS customer_name,
           p.name AS product_name,
           i.result,
           i.measurements,
           td.disposition_type,
           CASE td.disposition_type
             WHEN 'rework' THEN '返工返修'
             WHEN 'scrap' THEN '报废处理'
             WHEN 'concession_release' THEN '技术让步放行'
             WHEN 'process_adjustment' THEN '工艺调整复检'
             ELSE td.disposition_type
           END AS disposition_type_label,
           td.root_cause,
           td.corrective_action,
           td.status,
           CASE td.status
             WHEN 'issued' THEN '已下发'
             WHEN 'reinspection_requested' THEN '已转复检'
             WHEN 'reinspection_failed' THEN '复检未通过'
             WHEN 'closed' THEN '已关闭'
             ELSE td.status
           END AS status_label,
           CASE WHEN td.status = 'closed' THEN '已关闭' ELSE '未关闭' END AS closure_status,
           td.due_date,
           td.closed_at,
           creator.name AS created_by_name,
           td.created_at,
           COALESCE((
             SELECT COUNT(*)
             FROM inspections ri
             WHERE ri.technical_disposition_id = td.id
           ), 0) AS reinspection_count
    FROM technical_dispositions td
    JOIN inspections i ON i.id = td.inspection_id
    JOIN production_orders po ON po.id = td.production_order_id
    JOIN orders o ON o.id = po.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN users creator ON creator.id = td.created_by
    WHERE ${conditions.join(" AND ")}
    ORDER BY td.created_at DESC, td.disposition_no DESC
  `, params);
}

function qualityRootCauseRows(database: Database.Database, filters: ReportFilters = {}) {
  const grouped = new Map<string, Record<string, unknown>>();
  qualityExceptionRows(database, filters).forEach((row) => {
    const rootCause = String(row.root_cause ?? "").trim() || "未填写原因";
    const current =
      grouped.get(rootCause) ??
      ({
        root_cause: rootCause,
        count: 0,
        closed_count: 0,
        open_count: 0,
        closure_rate: 0,
        latest_disposition_no: "",
      } satisfies Record<string, unknown>);
    current.count = Number(current.count ?? 0) + 1;
    if (String(row.closure_status) === "已关闭") {
      current.closed_count = Number(current.closed_count ?? 0) + 1;
    } else {
      current.open_count = Number(current.open_count ?? 0) + 1;
    }
    current.latest_disposition_no = current.latest_disposition_no || row.disposition_no || "";
    current.closure_rate = roundMoney((Number(current.closed_count ?? 0) / Number(current.count ?? 1)) * 100);
    grouped.set(rootCause, current);
  });
  return Array.from(grouped.values()).sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
}

function qualityDispositionTypeRows(database: Database.Database, filters: ReportFilters = {}) {
  const grouped = new Map<string, Record<string, unknown>>();
  qualityExceptionRows(database, filters).forEach((row) => {
    const dispositionType = String(row.disposition_type_label ?? row.disposition_type ?? "").trim() || "未分类";
    const current =
      grouped.get(dispositionType) ??
      ({
        disposition_type_label: dispositionType,
        count: 0,
        closed_count: 0,
        open_count: 0,
        closure_rate: 0,
      } satisfies Record<string, unknown>);
    current.count = Number(current.count ?? 0) + 1;
    if (String(row.closure_status) === "已关闭") {
      current.closed_count = Number(current.closed_count ?? 0) + 1;
    } else {
      current.open_count = Number(current.open_count ?? 0) + 1;
    }
    current.closure_rate = roundMoney((Number(current.closed_count ?? 0) / Number(current.count ?? 1)) * 100);
    grouped.set(dispositionType, current);
  });
  return Array.from(grouped.values()).sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
}

function buildPurchaseDiscrepancyFilter(filters: ReportFilters, dateColumn: string) {
  const conditions = ["1 = 1"];
  const params: unknown[] = [];
  addDateFilter(conditions, params, dateColumn, filters);
  if (filters.supplierId) {
    conditions.push("pad.supplier_id = ?");
    params.push(filters.supplierId);
  }
  if (filters.purchaseOrderId) {
    conditions.push("pad.purchase_order_id = ?");
    params.push(filters.purchaseOrderId);
  }
  if (filters.materialId) {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM purchase_arrival_discrepancy_lines padl
        WHERE padl.discrepancy_id = pad.id
          AND padl.material_id = ?
      )
    `);
    params.push(filters.materialId);
  }
  return { where: conditions.join(" AND "), params };
}

function supplierDiscrepancySummaryRows(database: Database.Database, filters: ReportFilters = {}) {
  const discrepancyFilter = buildPurchaseDiscrepancyFilter(filters, "pad.created_at");
  return filteredRows(database, `
    SELECT s.id AS supplier_id,
           s.supplier_code,
           s.name AS supplier_name,
           COUNT(*) AS discrepancy_count,
           SUM(CASE WHEN pad.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
           SUM(CASE WHEN pad.status IN ('pending_approval', 'approved') THEN 1 ELSE 0 END) AS pending_count,
           SUM(CASE WHEN pad.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
           SUM(pad.line_count) AS line_count,
           ROUND(SUM(pad.quantity_variance_qty), 4) AS quantity_variance_qty,
           ROUND(SUM(pad.price_variance_amount), 2) AS price_variance_amount,
           ROUND(SUM(pad.total_adjustment_amount), 2) AS total_adjustment_amount,
           ROUND(SUM(CASE WHEN pad.status = 'resolved' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS resolution_rate,
           MAX(pad.created_at) AS latest_discrepancy_at
    FROM purchase_arrival_discrepancies pad
    JOIN suppliers s ON s.id = pad.supplier_id
    WHERE ${discrepancyFilter.where}
    GROUP BY s.id
    ORDER BY discrepancy_count DESC, ABS(total_adjustment_amount) DESC, latest_discrepancy_at DESC
  `, discrepancyFilter.params);
}

function supplierDiscrepancyDetailRows(database: Database.Database, filters: ReportFilters = {}) {
  const discrepancyFilter = buildPurchaseDiscrepancyFilter(filters, "pad.created_at");
  return filteredRows(database, `
    SELECT pad.discrepancy_no,
           pan.arrival_no,
           po.purchase_no,
           pc.contract_no,
           s.name AS supplier_name,
           ${purchaseArrivalDiscrepancyTypeSql("pad")} AS discrepancy_type_label,
           ${purchaseArrivalHandlingSql("pad")} AS handling_decision_label,
           ${purchaseArrivalDiscrepancyStatusSql("pad")} AS status_label,
           pad.quantity_variance_qty,
           pad.price_variance_amount,
           pad.total_adjustment_amount,
           pad.reason,
           pad.proposed_action,
           pad.resolution_note,
           creator.name AS created_by_name,
           approver.name AS approved_by_name,
           resolver.name AS resolved_by_name,
           pad.created_at,
           pad.approved_at,
           pad.resolved_at
    FROM purchase_arrival_discrepancies pad
    JOIN purchase_arrival_notices pan ON pan.id = pad.arrival_notice_id
    JOIN purchase_orders po ON po.id = pad.purchase_order_id
    LEFT JOIN purchase_contracts pc ON pc.id = pad.purchase_contract_id
    JOIN suppliers s ON s.id = pad.supplier_id
    JOIN users creator ON creator.id = pad.created_by
    LEFT JOIN users approver ON approver.id = pad.approved_by
    LEFT JOIN users resolver ON resolver.id = pad.resolved_by
    WHERE ${discrepancyFilter.where}
    ORDER BY pad.created_at DESC, pad.discrepancy_no DESC
  `, discrepancyFilter.params);
}

function supplierRiskLevelLabel(value: string) {
  return (
    {
      low: "低风险",
      medium: "观察风险",
      high: "高风险",
    }[value] ?? value
  );
}

function supplierAdmissionStatusLabel(value: string) {
  return (
    {
      normal: "准入正常",
      watch: "观察准入",
      restricted: "限制采购",
      blacklisted: "黑名单",
    }[value] ?? value
  );
}

function supplierAdmissionStatusValue(value: string, fallback = "watch") {
  if (["normal", "watch", "restricted", "blacklisted"].includes(value)) return value;
  return fallback;
}

function supplierAdmissionPurchaseAllowed(status: string) {
  return ["normal", "watch"].includes(status) ? 1 : 0;
}

function supplierAdmissionStatusFromRisk(riskLevel: string) {
  if (riskLevel === "high") return "restricted";
  if (riskLevel === "medium") return "watch";
  return "normal";
}

function supplierAdmissionRiskFromStatus(status: string) {
  if (status === "blacklisted" || status === "restricted") return "high";
  if (status === "watch") return "medium";
  return "low";
}

function supplierCorrectionStatusLabel(value: string) {
  return (
    {
      open: "待整改",
      submitted: "待复评",
      rejected: "复评驳回",
      closed: "已关闭",
    }[value] ?? value
  );
}

function supplierCorrectionResultLabel(value: string) {
  return (
    {
      passed: "复评通过",
      failed: "复评不通过",
    }[value] ?? value
  );
}

function supplierCorrectionSeverity(status: string) {
  if (status === "blacklisted") return "critical";
  if (status === "restricted") return "high";
  if (status === "watch") return "medium";
  return "low";
}

function supplierPerformanceRows(database: Database.Database, filters: ReportFilters = {}): Array<Record<string, unknown>> {
  const today = new Date().toISOString().slice(0, 10);
  const conditions = ["1 = 1"];
  const params: unknown[] = [];
  if (filters.supplierId) {
    conditions.push("s.id = ?");
    params.push(filters.supplierId);
  }

  return (database.prepare(`
    SELECT s.id AS supplier_id,
           s.supplier_code,
           s.name AS supplier_name,
           s.contact,
           s.phone,
           s.payment_terms,
           COALESCE((SELECT sac.id FROM supplier_admission_controls sac WHERE sac.supplier_id = s.id), '') AS admission_control_id,
           COALESCE((SELECT sac.control_status FROM supplier_admission_controls sac WHERE sac.supplier_id = s.id), 'normal') AS admission_status,
           COALESCE((SELECT sac.purchase_allowed FROM supplier_admission_controls sac WHERE sac.supplier_id = s.id), 1) AS purchase_allowed,
           COALESCE((SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id), 0) AS purchase_order_count,
           COALESCE((SELECT SUM(po.total_amount) FROM purchase_orders po WHERE po.supplier_id = s.id), 0) AS total_purchase_amount,
           COALESCE((SELECT COUNT(*) FROM purchase_arrival_notices pan WHERE pan.supplier_id = s.id), 0) AS arrival_count,
           COALESCE((
             SELECT COUNT(*)
             FROM purchase_arrival_notices pan
             JOIN purchase_orders po ON po.id = pan.purchase_order_id
             LEFT JOIN purchase_contracts pc ON pc.id = pan.purchase_contract_id
             WHERE pan.supplier_id = s.id
               AND date(pan.arrived_at) <= date(COALESCE(pc.delivery_date, po.due_date, pan.arrived_at))
           ), 0) AS on_time_arrival_count,
           COALESCE((
             SELECT COUNT(*)
             FROM material_iqc_inspections iqc
             JOIN purchase_orders po ON po.id = iqc.purchase_order_id
             WHERE po.supplier_id = s.id
           ), 0) AS iqc_count,
           COALESCE((
             SELECT COUNT(*)
             FROM material_iqc_inspections iqc
             JOIN purchase_orders po ON po.id = iqc.purchase_order_id
             WHERE po.supplier_id = s.id
               AND iqc.result IN ('qualified', 'concession')
           ), 0) AS iqc_pass_count,
           COALESCE((SELECT COUNT(*) FROM purchase_arrival_discrepancies pad WHERE pad.supplier_id = s.id), 0) AS discrepancy_count,
           COALESCE((
             SELECT COUNT(*)
             FROM purchase_arrival_discrepancies pad
             WHERE pad.supplier_id = s.id
               AND pad.status IN ('pending_approval', 'approved')
           ), 0) AS open_discrepancy_count,
           COALESCE((SELECT SUM(pad.total_adjustment_amount) FROM purchase_arrival_discrepancies pad WHERE pad.supplier_id = s.id), 0) AS total_adjustment_amount,
           COALESCE((
             SELECT COUNT(*)
             FROM payables p
             WHERE p.supplier_id = s.id
               AND p.balance_amount > 0
               AND date(p.due_date) < date(?)
           ), 0) AS overdue_payable_count,
           COALESCE((SELECT SUM(p.balance_amount) FROM payables p WHERE p.supplier_id = s.id), 0) AS payable_balance
    FROM suppliers s
    WHERE ${conditions.join(" AND ")}
    ORDER BY s.name
  `).all(today, ...params) as Array<Record<string, unknown>>)
    .map((row) => {
      const purchaseOrderCount = Number(row.purchase_order_count ?? 0);
      const arrivalCount = Number(row.arrival_count ?? 0);
      const iqcCount = Number(row.iqc_count ?? 0);
      const discrepancyCount = Number(row.discrepancy_count ?? 0);
      const totalPurchaseAmount = Number(row.total_purchase_amount ?? 0);
      const totalAdjustmentAmount = Number(row.total_adjustment_amount ?? 0);
      const onTimeDeliveryRate = arrivalCount
        ? roundMoney((Number(row.on_time_arrival_count ?? 0) / arrivalCount) * 100)
        : 100;
      const iqcPassRate = iqcCount ? roundMoney((Number(row.iqc_pass_count ?? 0) / iqcCount) * 100) : 100;
      const discrepancyRate = arrivalCount ? roundMoney((discrepancyCount / arrivalCount) * 100) : 0;
      const adjustmentRate = totalPurchaseAmount ? roundMoney((totalAdjustmentAmount / totalPurchaseAmount) * 100) : 0;
      const performance = calculateSupplierPerformanceScore({
        purchaseOrderCount,
        onTimeDeliveryRate,
        iqcPassRate,
        discrepancyRate,
        overduePayableCount: Number(row.overdue_payable_count ?? 0),
        adjustmentRate,
      });
      return {
        ...row,
        on_time_delivery_rate: onTimeDeliveryRate,
        iqc_pass_rate: iqcPassRate,
        discrepancy_rate: discrepancyRate,
        adjustment_rate: adjustmentRate,
        performance_score: performance.score,
        grade: performance.grade,
        grade_label: performance.gradeLabel,
        risk_level: performance.riskLevel,
        risk_level_label: supplierRiskLevelLabel(performance.riskLevel),
        admission_status_label: supplierAdmissionStatusLabel(String(row.admission_status ?? "normal")),
        purchase_allowed_label: Number(row.purchase_allowed ?? 1) ? "允许采购" : "限制下单",
        recommendation: performance.recommendation,
      };
    })
    .sort((a, b) => Number(a.performance_score ?? 0) - Number(b.performance_score ?? 0));
}

function supplierAdmissionControlRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT sac.*,
           s.supplier_code,
           s.name AS supplier_name,
           s.contact,
           s.phone,
           creator.name AS created_by_name,
           updater.name AS updated_by_name,
           COALESCE((
             SELECT COUNT(*)
             FROM supplier_corrective_actions sca
             WHERE sca.control_id = sac.id
               AND sca.status IN ('open', 'submitted', 'rejected')
           ), 0) AS open_action_count,
           COALESCE((
             SELECT sca.action_no
             FROM supplier_corrective_actions sca
             WHERE sca.control_id = sac.id
             ORDER BY sca.created_at DESC
             LIMIT 1
           ), '') AS latest_action_no,
           COALESCE((
             SELECT sr.reassessment_score
             FROM supplier_reassessments sr
             WHERE sr.control_id = sac.id
             ORDER BY sr.reviewed_at DESC
             LIMIT 1
           ), NULL) AS latest_reassessment_score
    FROM supplier_admission_controls sac
    JOIN suppliers s ON s.id = sac.supplier_id
    JOIN users creator ON creator.id = sac.created_by
    LEFT JOIN users updater ON updater.id = sac.updated_by
    ORDER BY sac.purchase_allowed ASC, sac.updated_at DESC
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    control_status_label: supplierAdmissionStatusLabel(String(row.control_status)),
    purchase_allowed_label: Number(row.purchase_allowed ?? 1) ? "允许采购" : "限制下单",
    risk_level_label: supplierRiskLevelLabel(String(row.risk_level ?? "")),
  }));
}

function supplierCorrectiveActionRows(database: Database.Database): Array<Record<string, unknown>> {
  const today = new Date().toISOString().slice(0, 10);
  return (database.prepare(`
    SELECT sca.*,
           s.supplier_code,
           s.name AS supplier_name,
           sac.control_no,
           sac.control_status,
           owner.name AS owner_name,
           creator.name AS created_by_name,
           submitter.name AS submitted_by_name,
           reviewer.name AS reviewed_by_name,
           CASE
             WHEN sca.status IN ('open', 'rejected') AND date(sca.due_date) < date(?) THEN 1
             ELSE 0
           END AS is_overdue
    FROM supplier_corrective_actions sca
    JOIN suppliers s ON s.id = sca.supplier_id
    JOIN supplier_admission_controls sac ON sac.id = sca.control_id
    LEFT JOIN users owner ON owner.id = sca.owner_id
    JOIN users creator ON creator.id = sca.created_by
    LEFT JOIN users submitter ON submitter.id = sca.submitted_by
    LEFT JOIN users reviewer ON reviewer.id = sca.reviewed_by
    ORDER BY
      CASE sca.status
        WHEN 'submitted' THEN 0
        WHEN 'open' THEN 1
        WHEN 'rejected' THEN 2
        ELSE 3
      END,
      sca.due_date ASC,
      sca.created_at DESC
  `).all(today) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    status_label: supplierCorrectionStatusLabel(String(row.status)),
    control_status_label: supplierAdmissionStatusLabel(String(row.control_status)),
    severity_label:
      {
        critical: "严重",
        high: "高",
        medium: "中",
        low: "低",
      }[String(row.severity)] ?? String(row.severity ?? ""),
    review_result_label: row.review_result ? supplierCorrectionResultLabel(String(row.review_result)) : "",
  }));
}

function supplierReassessmentRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT sr.*,
           s.supplier_code,
           s.name AS supplier_name,
           sca.action_no,
           sac.control_no,
           reviewer.name AS reviewer_name
    FROM supplier_reassessments sr
    JOIN suppliers s ON s.id = sr.supplier_id
    JOIN supplier_corrective_actions sca ON sca.id = sr.corrective_action_id
    JOIN supplier_admission_controls sac ON sac.id = sr.control_id
    JOIN users reviewer ON reviewer.id = sr.reviewer_id
    ORDER BY sr.reviewed_at DESC
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    previous_status_label: supplierAdmissionStatusLabel(String(row.previous_status)),
    next_status_label: supplierAdmissionStatusLabel(String(row.next_status)),
    result_label: supplierCorrectionResultLabel(String(row.result)),
  }));
}

function supplierReleaseResultLabel(value: string) {
  return (
    {
      restored: "恢复采购",
    }[value] ?? value
  );
}

function supplierAdmissionReleaseRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT sar.*,
           s.supplier_code,
           s.name AS supplier_name,
           sac.control_no,
           sca.action_no,
           sr.reassessment_no,
           releaser.name AS released_by_name
    FROM supplier_admission_releases sar
    JOIN suppliers s ON s.id = sar.supplier_id
    JOIN supplier_admission_controls sac ON sac.id = sar.control_id
    JOIN supplier_corrective_actions sca ON sca.id = sar.corrective_action_id
    JOIN supplier_reassessments sr ON sr.id = sar.reassessment_id
    JOIN users releaser ON releaser.id = sar.released_by
    ORDER BY sar.released_at DESC
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    previous_status_label: supplierAdmissionStatusLabel(String(row.previous_status)),
    next_status_label: supplierAdmissionStatusLabel(String(row.next_status)),
    release_result_label: supplierReleaseResultLabel(String(row.release_result)),
    purchase_allowed_before_label: Number(row.purchase_allowed_before ?? 0) ? "允许采购" : "限制下单",
    purchase_allowed_after_label: Number(row.purchase_allowed_after ?? 0) ? "允许采购" : "限制下单",
  }));
}

function supplierObservationStatusLabel(value: string) {
  return (
    {
      active: "观察中",
      completed: "观察通过",
      breached: "观察异常",
    }[value] ?? value
  );
}

function supplierObservationSourceLabel(value: string, mode: "breach" | "batch") {
  if (!value) return "-";
  if (value === "purchase_arrival_discrepancy") return "到货差异";
  if (value === "material_iqc_inspection") return mode === "batch" ? "IQC合格批次" : "IQC异常";
  return value;
}

function closeExpiredSupplierObservationPeriods(database: Database.Database) {
  const timestamp = now();
  database.prepare(`
    UPDATE supplier_observation_periods
    SET status = 'completed',
        close_reason = '观察期满 30 天未发生异常，系统自动完成观察。',
        updated_at = ?,
        closed_at = COALESCE(closed_at, planned_end_at)
    WHERE status = 'active'
      AND date(planned_end_at) <= date(?)
  `).run(timestamp, timestamp);
}

function supplierObservationPeriodRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT sop.*,
           s.supplier_code,
           s.name AS supplier_name,
           sar.release_no,
           sr.reassessment_no,
           sac.control_no,
           creator.name AS created_by_name,
           updater.name AS updated_by_name
    FROM supplier_observation_periods sop
    JOIN suppliers s ON s.id = sop.supplier_id
    JOIN supplier_admission_releases sar ON sar.id = sop.release_id
    JOIN supplier_reassessments sr ON sr.id = sop.reassessment_id
    JOIN supplier_admission_controls sac ON sac.id = sop.control_id
    JOIN users creator ON creator.id = sop.created_by
    LEFT JOIN users updater ON updater.id = sop.updated_by
    ORDER BY
      CASE sop.status
        WHEN 'active' THEN 0
        WHEN 'breached' THEN 1
        ELSE 2
      END,
      sop.updated_at DESC
  `).all() as Array<Record<string, unknown>>).map((row) => {
    const plannedEnd = new Date(String(row.planned_end_at)).getTime();
    const daysRemaining = Math.max(0, Math.ceil((plannedEnd - Date.now()) / (1000 * 60 * 60 * 24)));
    return {
      ...row,
      status_label: supplierObservationStatusLabel(String(row.status)),
      breach_source_type_label: supplierObservationSourceLabel(String(row.breach_source_type ?? ""), "breach"),
      last_batch_source_type_label: supplierObservationSourceLabel(String(row.last_batch_source_type ?? ""), "batch"),
      days_remaining: daysRemaining,
      batch_progress: `${Number(row.completed_batch_count ?? 0)} / ${Number(row.required_batch_count ?? 1)}`,
    };
  });
}

function daysUntilDate(dateText: string) {
  const today = new Date(now().slice(0, 10)).getTime();
  const target = new Date(String(dateText).slice(0, 10)).getTime();
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function supplierCertificateTypeLabel(value: string) {
  return (
    {
      quality_system: "质量体系",
      business_license: "营业执照",
      material_license: "材料资质",
      safety_environment: "安环资质",
      other: "其他资质",
    }[value] ?? value
  );
}

function supplierCertificateTypeValue(value: string) {
  if (["quality_system", "business_license", "material_license", "safety_environment", "other"].includes(value)) return value;
  return "other";
}

function supplierCertificateExpiryStatus(expiresAt: string, remindDays: number) {
  const days = daysUntilDate(expiresAt);
  if (days < 0) return "expired";
  if (days <= remindDays) return "expiring";
  return "valid";
}

function supplierCertificateExpiryLabel(value: string) {
  return (
    {
      valid: "有效",
      expiring: "即将到期",
      expired: "已过期",
      renewed: "已续证归档",
    }[value] ?? value
  );
}

function supplierCertificateStatusLabel(value: string) {
  return (
    {
      active: "有效",
      renewed: "已续证",
      voided: "已作废",
    }[value] ?? value
  );
}

function supplierCertificateRiskLabel(value: string) {
  return (
    {
      normal: "资质有效",
      expiring: "存在临期资质",
      expired: "存在过期资质",
      missing: "未登记资质",
    }[value] ?? value
  );
}

function supplierAnnualReviewResultLabel(value: string) {
  return (
    {
      passed: "复评通过",
      watch: "观察通过",
      failed: "复评不通过",
    }[value] ?? value
  );
}

function supplierAnnualReviewStatusLabel(value: string) {
  return (
    {
      pending_approval: "待审批生效",
      approved: "已审批生效",
      rejected: "审批驳回",
    }[value] ?? value
  );
}

function supplierCertificateRisk(database: Database.Database, supplierId: string) {
  const rows = database.prepare(`
    SELECT expires_at, remind_days
    FROM supplier_qualification_certificates
    WHERE supplier_id = ?
      AND status = 'active'
  `).all(supplierId) as Array<{ expires_at: string; remind_days: number }>;
  if (rows.length === 0) return "missing";
  const statuses = rows.map((row) => supplierCertificateExpiryStatus(row.expires_at, Number(row.remind_days ?? 90)));
  if (statuses.includes("expired")) return "expired";
  if (statuses.includes("expiring")) return "expiring";
  return "normal";
}

function supplierQualificationCertificateRows(database: Database.Database): Array<Record<string, unknown>> {
  const latestAttachment = database.prepare(`
    SELECT id, attachment_no, file_name, uploaded_at
    FROM document_attachments
    WHERE entity_type = 'supplier_certificate'
      AND entity_id = ?
    ORDER BY uploaded_at DESC, attachment_no DESC
    LIMIT 1
  `);
  const attachmentCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM document_attachments
    WHERE entity_type = 'supplier_certificate'
      AND entity_id = ?
  `);
  return (database.prepare(`
    SELECT sqc.*,
           s.supplier_code,
           s.name AS supplier_name,
           creator.name AS created_by_name,
           updater.name AS updated_by_name,
           oldc.qualification_no AS renewed_from_no,
           newc.qualification_no AS renewed_to_no
    FROM supplier_qualification_certificates sqc
    JOIN suppliers s ON s.id = sqc.supplier_id
    JOIN users creator ON creator.id = sqc.created_by
    LEFT JOIN users updater ON updater.id = sqc.updated_by
    LEFT JOIN supplier_qualification_certificates oldc ON oldc.id = sqc.renewed_from_id
    LEFT JOIN supplier_qualification_certificates newc ON newc.id = sqc.renewed_to_id
    WHERE sqc.status != 'voided'
    ORDER BY sqc.expires_at ASC, s.name ASC
  `).all() as Array<Record<string, unknown>>).map((row) => {
    const days = daysUntilDate(String(row.expires_at));
    const expiryStatus =
      String(row.status) === "renewed"
        ? "renewed"
        : supplierCertificateExpiryStatus(String(row.expires_at), Number(row.remind_days ?? 90));
    const latest = latestAttachment.get(String(row.id)) as
      | { id: string; attachment_no: string; file_name: string; uploaded_at: string }
      | undefined;
    return {
      ...row,
      status_label: supplierCertificateStatusLabel(String(row.status)),
      certificate_type_label: supplierCertificateTypeLabel(String(row.certificate_type)),
      expiry_status: expiryStatus,
      expiry_status_label: supplierCertificateExpiryLabel(expiryStatus),
      days_until_expiry: days,
      attachment_count: Number((attachmentCount.get(String(row.id)) as { count: number }).count ?? 0),
      latest_attachment_id: latest?.id ?? "",
      latest_attachment_no: latest?.attachment_no ?? "",
      latest_attachment_name: latest?.file_name ?? "",
      latest_attachment_at: latest?.uploaded_at ?? "",
    };
  });
}

function supplierQualificationScopeLabel(value: string) {
  return (
    {
      all_suppliers: "全部供应商",
      material: "指定物料",
    }[value] ?? value
  );
}

function supplierQualificationComplianceLabel(value: string) {
  return (
    {
      compliant: "符合",
      expiring: "临期",
      expired: "已过期",
      missing: "缺失",
    }[value] ?? value
  );
}

function supplierQualificationRequirementRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT sqr.*,
           m.name AS material_name,
           creator.name AS created_by_name,
           updater.name AS updated_by_name
    FROM supplier_qualification_requirements sqr
    LEFT JOIN materials m ON m.id = sqr.material_id
    JOIN users creator ON creator.id = sqr.created_by
    LEFT JOIN users updater ON updater.id = sqr.updated_by
    ORDER BY sqr.status ASC, sqr.scope_type ASC, m.name ASC, sqr.requirement_no ASC
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    scope_type_label: supplierQualificationScopeLabel(String(row.scope_type)),
    certificate_type_label: supplierCertificateTypeLabel(String(row.certificate_type)),
    block_purchase_label: Number(row.block_purchase ?? 0) ? "阻止下单" : "仅预警",
    status_label: String(row.status) === "active" ? "有效" : "停用",
  }));
}

function supplierQualificationMatrixRows(
  database: Database.Database,
  options: { supplierId?: string; materialIds?: string[]; forPurchaseCheck?: boolean } = {},
): Array<Record<string, unknown>> {
  const materialFilter = new Set((options.materialIds ?? []).filter(Boolean).map(String));
  const suppliers = database.prepare(`
    SELECT id, supplier_code, name
    FROM suppliers
    WHERE status = 'active'
      ${options.supplierId ? "AND id = ?" : ""}
    ORDER BY name ASC
  `).all(...(options.supplierId ? [options.supplierId] : [])) as Array<{
    id: string;
    supplier_code: string;
    name: string;
  }>;
  const requirements = supplierQualificationRequirementRows(database)
    .filter((requirement) => String(requirement.status) === "active")
    .filter((requirement) => {
      if (!options.forPurchaseCheck) return true;
      if (String(requirement.scope_type) === "all_suppliers") return true;
      return materialFilter.has(String(requirement.material_id ?? ""));
    });
  const certStatement = database.prepare(`
    SELECT *
    FROM supplier_qualification_certificates
    WHERE supplier_id = ?
      AND status = 'active'
      AND certificate_type = ?
      AND (? = '' OR certificate_name = ?)
    ORDER BY expires_at DESC, qualification_no DESC
  `);
  const rank: Record<string, number> = { valid: 0, expiring: 1, expired: 2 };
  return suppliers.flatMap((supplier) =>
    requirements.map((requirement) => {
      const certificates = certStatement.all(
        supplier.id,
        String(requirement.certificate_type),
        String(requirement.certificate_name ?? ""),
        String(requirement.certificate_name ?? ""),
      ) as Array<Record<string, unknown>>;
      const evaluated = certificates
        .map((certificate) => {
          const days = daysUntilDate(String(certificate.expires_at));
          const remindDays = Math.max(Number(requirement.min_valid_days ?? 0), Number(certificate.remind_days ?? 90));
          const status = supplierCertificateExpiryStatus(String(certificate.expires_at), remindDays);
          return { certificate, days, status };
        })
        .sort((left, right) => (rank[left.status] ?? 9) - (rank[right.status] ?? 9) || right.days - left.days);
      const best = evaluated[0];
      const complianceStatus = best ? (best.status === "valid" ? "compliant" : best.status) : "missing";
      const purchaseBlocking =
        Number(requirement.block_purchase ?? 0) > 0 && ["missing", "expired"].includes(complianceStatus) ? 1 : 0;
      return {
        id: `${supplier.id}-${String(requirement.id)}`,
        supplier_id: supplier.id,
        supplier_code: supplier.supplier_code,
        supplier_name: supplier.name,
        requirement_id: requirement.id,
        requirement_no: requirement.requirement_no,
        scope_type: requirement.scope_type,
        scope_type_label: requirement.scope_type_label,
        material_id: requirement.material_id ?? "",
        material_name: requirement.material_name ?? "",
        certificate_type: requirement.certificate_type,
        certificate_type_label: requirement.certificate_type_label,
        certificate_name: requirement.certificate_name,
        min_valid_days: requirement.min_valid_days,
        block_purchase: requirement.block_purchase,
        matched_certificate_id: best?.certificate.id ?? "",
        matched_certificate_no: best?.certificate.certificate_no ?? "",
        matched_qualification_no: best?.certificate.qualification_no ?? "",
        matched_expires_at: best?.certificate.expires_at ?? "",
        days_until_expiry: best?.days ?? null,
        compliance_status: complianceStatus,
        compliance_status_label: supplierQualificationComplianceLabel(complianceStatus),
        purchase_blocking: purchaseBlocking,
        purchase_blocking_label: purchaseBlocking ? "阻止下单" : "允许下单",
        description: requirement.description,
      };
    }),
  );
}

function assertSupplierQualificationRequirements(database: Database.Database, supplierId: string, materialIds: string[] = []) {
  const blocking = supplierQualificationMatrixRows(database, {
    supplierId,
    materialIds,
    forPurchaseCheck: true,
  }).filter((item) => Number(item.purchase_blocking ?? 0) > 0);
  if (blocking.length === 0) return;
  const detail = blocking
    .map((item) => `${String(item.material_name || "通用")}/${String(item.certificate_name || item.certificate_type_label)}：${String(item.compliance_status_label)}`)
    .join("；");
  throw new Error(`供应商必备资质不符合要求，已阻止下单：${detail}`);
}

function supplierAnnualReviewRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT sar.*,
           s.supplier_code,
           s.name AS supplier_name,
           reviewer.name AS reviewer_name,
           approver.name AS approved_by_name,
           ar.request_no AS approval_no,
           ar.status AS approval_status,
           ar.decision_note
    FROM supplier_annual_reviews sar
    JOIN suppliers s ON s.id = sar.supplier_id
    JOIN users reviewer ON reviewer.id = sar.reviewer_id
    LEFT JOIN users approver ON approver.id = sar.approved_by
    LEFT JOIN approval_requests ar ON ar.id = sar.approval_request_id
    ORDER BY sar.reviewed_at DESC, sar.annual_review_no DESC
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    previous_status_label: supplierAdmissionStatusLabel(String(row.previous_status)),
    next_status_label: supplierAdmissionStatusLabel(String(row.next_status)),
    result_label: supplierAnnualReviewResultLabel(String(row.result)),
    certificate_status_label: supplierCertificateRiskLabel(String(row.certificate_status)),
    status_label: supplierAnnualReviewStatusLabel(String(row.status ?? "approved")),
    approval_status_label: row.approval_status ? approvalRequestStatusLabel(String(row.approval_status)) : "",
  }));
}

function supplierAnnualReviewDueRows(database: Database.Database): Array<Record<string, unknown>> {
  const currentYear = new Date(now()).getFullYear();
  return (database.prepare(`
    SELECT s.id AS supplier_id,
           s.supplier_code,
           s.name AS supplier_name,
           COALESCE(MAX(sar.review_year), 0) AS latest_review_year,
           COALESCE(MAX(sar.next_review_due_at), '') AS next_review_due_at
    FROM suppliers s
    LEFT JOIN supplier_annual_reviews sar ON sar.supplier_id = s.id
    WHERE s.status = 'active'
    GROUP BY s.id
    HAVING latest_review_year < ?
       OR date(COALESCE(next_review_due_at, '1900-01-01')) <= date(?)
    ORDER BY s.name ASC
  `).all(currentYear, now().slice(0, 10)) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    due_reason: Number(row.latest_review_year ?? 0) === 0 ? "尚未年度复评" : "年度复评到期",
  }));
}

function upsertSupplierCertificate(
  database: Database.Database,
  actorId: string,
  supplierId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const supplier = database.prepare("SELECT id, name FROM suppliers WHERE id = ? AND status = 'active'").get(supplierId) as
    | { id: string; name: string }
    | undefined;
  if (!supplier) throw new Error("供应商不存在或未启用。");
  const certificateType = supplierCertificateTypeValue(payloadText(payload, "certificate_type", "资质类型", false) || "other");
  const certificateName = payloadText(payload, "certificate_name", "资质名称");
  const certificateNo = payloadText(payload, "certificate_no", "资质证书编号");
  const issuedAt = payloadDate(payload, "issued_at", "发证日期", new Date().toISOString().slice(0, 10));
  const expiresAt = payloadDate(payload, "expires_at", "到期日期");
  const remindDays = Math.round(payloadNumber(payload, "remind_days", "提醒天数", { min: 1 }) || 90);
  const note = payloadText(payload, "note", "资质说明", false);
  const timestamp = now();
  const existing = database.prepare(`
    SELECT id
    FROM supplier_qualification_certificates
    WHERE supplier_id = ?
      AND certificate_no = ?
      AND status != 'voided'
    LIMIT 1
  `).get(supplier.id, certificateNo) as { id: string } | undefined;

  if (existing) {
    database.prepare(`
      UPDATE supplier_qualification_certificates
      SET certificate_type = ?,
          certificate_name = ?,
          issued_at = ?,
          expires_at = ?,
          remind_days = ?,
          note = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `).run(certificateType, certificateName, issuedAt, expiresAt, remindDays, note, actorId, timestamp, existing.id);
    audit(database, actorId, "upsertSupplierCertificate", "supplier_qualification_certificate", existing.id, `更新供应商资质 ${supplier.name} / ${certificateName}`);
    return;
  }

  const certificateId = uid("SQC");
  const qualificationNo = serial(database, "supplier_qualification_certificates", "ZZ");
  database.prepare(`
    INSERT INTO supplier_qualification_certificates (
      id, qualification_no, supplier_id, certificate_type, certificate_name, certificate_no,
      issued_at, expires_at, remind_days, status, note, created_by, created_at, updated_by, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `).run(
    certificateId,
    qualificationNo,
    supplier.id,
    certificateType,
    certificateName,
    certificateNo,
    issuedAt,
    expiresAt,
    remindDays,
    note,
    actorId,
    timestamp,
    actorId,
    timestamp,
  );
  audit(database, actorId, "upsertSupplierCertificate", "supplier_qualification_certificate", certificateId, `登记供应商资质 ${supplier.name} / ${certificateName}`);
}

function renewSupplierCertificate(
  database: Database.Database,
  actorId: string,
  certificateId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const oldCertificate = database.prepare(`
    SELECT sqc.*, s.name AS supplier_name
    FROM supplier_qualification_certificates sqc
    JOIN suppliers s ON s.id = sqc.supplier_id
    WHERE sqc.id = ?
      AND sqc.status = 'active'
  `).get(certificateId) as
    | {
        id: string;
        qualification_no: string;
        supplier_id: string;
        supplier_name: string;
        certificate_type: string;
        certificate_name: string;
        certificate_no: string;
        issued_at: string;
        expires_at: string;
        remind_days: number;
      }
    | undefined;
  if (!oldCertificate) throw new Error("可续证的供应商资质不存在或已归档。");

  const certificateType = supplierCertificateTypeValue(
    payloadText(payload, "certificate_type", "资质类型", false) || oldCertificate.certificate_type,
  );
  const certificateName = payloadText(payload, "certificate_name", "资质名称", false) || oldCertificate.certificate_name;
  const certificateNo = payloadText(payload, "certificate_no", "新资质证书编号");
  const issuedAt = payloadDate(payload, "issued_at", "新证发证日期", new Date().toISOString().slice(0, 10));
  const expiresAt = payloadDate(payload, "expires_at", "新证到期日期");
  const remindDays = Math.round(payloadNumber(payload, "remind_days", "提醒天数", { min: 1 }) || Number(oldCertificate.remind_days ?? 90));
  const note = payloadText(payload, "note", "续证说明", false);
  if (new Date(expiresAt).getTime() <= new Date(oldCertificate.expires_at).getTime()) {
    throw new Error("新证到期日期必须晚于旧证到期日期。");
  }
  const duplicate = database.prepare(`
    SELECT id
    FROM supplier_qualification_certificates
    WHERE supplier_id = ?
      AND certificate_no = ?
      AND status != 'voided'
    LIMIT 1
  `).get(oldCertificate.supplier_id, certificateNo) as { id: string } | undefined;
  if (duplicate) throw new Error("该供应商已存在相同证书编号的资质记录。");

  const newCertificateId = uid("SQC");
  const newQualificationNo = serial(database, "supplier_qualification_certificates", "ZZ");
  const timestamp = now();
  database.prepare(`
    INSERT INTO supplier_qualification_certificates (
      id, qualification_no, supplier_id, certificate_type, certificate_name, certificate_no,
      issued_at, expires_at, remind_days, status, note, created_by, created_at, updated_by, updated_at,
      renewed_from_id, renewed_to_id, renewed_at, renewal_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    newCertificateId,
    newQualificationNo,
    oldCertificate.supplier_id,
    certificateType,
    certificateName,
    certificateNo,
    issuedAt,
    expiresAt,
    remindDays,
    note,
    actorId,
    timestamp,
    actorId,
    timestamp,
    oldCertificate.id,
    timestamp,
    note || `由旧资质 ${oldCertificate.qualification_no} 续证生成。`,
  );
  database.prepare(`
    UPDATE supplier_qualification_certificates
    SET status = 'renewed',
        renewed_to_id = ?,
        renewed_at = ?,
        renewal_note = ?,
        updated_by = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    newCertificateId,
    timestamp,
    note || `已续证至 ${newQualificationNo}。`,
    actorId,
    timestamp,
    oldCertificate.id,
  );
  audit(
    database,
    actorId,
    "renewSupplierCertificate",
    "supplier_qualification_certificate",
    newCertificateId,
    `供应商资质续证 ${oldCertificate.supplier_name}：${oldCertificate.qualification_no} -> ${newQualificationNo}`,
  );
}

function supplierAnnualReviewResultFromStatus(status: string) {
  if (status === "normal") return "passed";
  if (status === "watch") return "watch";
  return "failed";
}

function ensureSupplierAnnualReviewCorrectiveAction(input: {
  database: Database.Database;
  actorId: string;
  supplierId: string;
  controlId: string;
  nextStatus: string;
  finalScore: number;
  conclusion: string;
}) {
  if (supplierAdmissionPurchaseAllowed(input.nextStatus)) return;
  const existingAction = input.database.prepare(`
    SELECT id
    FROM supplier_corrective_actions
    WHERE supplier_id = ?
      AND status IN ('open', 'submitted', 'rejected')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(input.supplierId) as { id: string } | undefined;
  const requiredAction = `年度复评未通过，当前得分 ${input.finalScore}；供应商需提交年度整改计划、最新资质证书、质量/交付改善措施和重新评审资料。`;
  const dueDate = addDays(new Date().toISOString().slice(0, 10), input.nextStatus === "blacklisted" ? 7 : 14);
  if (existingAction) {
    input.database.prepare(`
      UPDATE supplier_corrective_actions
      SET control_id = ?,
          status = 'open',
          severity = ?,
          required_action = ?,
          due_date = ?,
          reviewed_by = NULL,
          reviewed_at = NULL,
          review_result = '',
          review_note = '',
          closed_at = NULL
      WHERE id = ?
    `).run(input.controlId, supplierCorrectionSeverity(input.nextStatus), requiredAction, dueDate, existingAction.id);
    return;
  }
  const actionId = uid("SCA");
  const actionNo = serial(input.database, "supplier_corrective_actions", "ZG");
  input.database.prepare(`
    INSERT INTO supplier_corrective_actions (
      id, action_no, supplier_id, control_id, status, severity,
      required_action, due_date, owner_id, created_by, created_at
    )
    VALUES (?, ?, ?, ?, 'open', ?, ?, ?, 'U-PUR', ?, ?)
  `).run(
    actionId,
    actionNo,
    input.supplierId,
    input.controlId,
    supplierCorrectionSeverity(input.nextStatus),
    requiredAction,
    dueDate,
    input.actorId,
    now(),
  );
}

function applySupplierAnnualReviewAdmission(input: {
  database: Database.Database;
  actorId: string;
  reviewId: string;
  supplierId: string;
  supplierName: string;
  nextStatus: string;
  result: string;
  finalScore: number;
  conclusion: string;
}) {
  const controlId = upsertSupplierAdmissionControl({
    database: input.database,
    actorId: input.actorId,
    supplierId: input.supplierId,
    status: input.nextStatus,
    reason: `${supplierAnnualReviewResultLabel(input.result)}，年度复评得分 ${input.finalScore}。${input.conclusion}`,
    sourceType: "supplier_annual_review",
    sourceId: input.reviewId,
    performanceScore: input.finalScore,
    riskLevel: supplierAdmissionRiskFromStatus(input.nextStatus),
    releaseNote: supplierAdmissionPurchaseAllowed(input.nextStatus)
      ? `${supplierAnnualReviewResultLabel(input.result)}，年度复评得分 ${input.finalScore}。${input.conclusion}`
      : "",
  });
  ensureSupplierAnnualReviewCorrectiveAction({
    database: input.database,
    actorId: input.actorId,
    supplierId: input.supplierId,
    controlId,
    nextStatus: input.nextStatus,
    finalScore: input.finalScore,
    conclusion: input.conclusion,
  });
  return controlId;
}

function decideSupplierAnnualReviewApproval(
  database: Database.Database,
  actorId: string,
  reviewId: string,
  decision: "approved" | "rejected",
  note: string,
  decidedAt: string,
) {
  const review = database.prepare(`
    SELECT sar.*, s.name AS supplier_name
    FROM supplier_annual_reviews sar
    JOIN suppliers s ON s.id = sar.supplier_id
    WHERE sar.id = ?
  `).get(reviewId) as
    | {
        id: string;
        annual_review_no: string;
        supplier_id: string;
        supplier_name: string;
        status: string;
        next_status: string;
        result: string;
        final_score: number;
        conclusion: string;
      }
    | undefined;
  if (!review || review.status !== "pending_approval") return;
  if (decision === "rejected") {
    database.prepare(`
      UPDATE supplier_annual_reviews
      SET status = 'rejected',
          approved_by = ?,
          approved_at = ?,
          approval_note = ?
      WHERE id = ?
    `).run(actorId, decidedAt, note, review.id);
    audit(database, actorId, "rejectSupplierAnnualReview", "supplier_annual_review", review.id, `驳回供应商年度复评 ${review.annual_review_no}`);
    return;
  }

  applySupplierAnnualReviewAdmission({
    database,
    actorId,
    reviewId: review.id,
    supplierId: review.supplier_id,
    supplierName: review.supplier_name,
    nextStatus: review.next_status,
    result: review.result,
    finalScore: Number(review.final_score ?? 0),
    conclusion: review.conclusion,
  });
  database.prepare(`
    UPDATE supplier_annual_reviews
    SET status = 'approved',
        approved_by = ?,
        approved_at = ?,
        approval_note = ?,
        applied_at = ?
    WHERE id = ?
  `).run(actorId, decidedAt, note, decidedAt, review.id);
  audit(
    database,
    actorId,
    "approveSupplierAnnualReview",
    "supplier_annual_review",
    review.id,
    `同意供应商年度复评 ${review.annual_review_no}，准入调整为 ${supplierAdmissionStatusLabel(review.next_status)}`,
  );
}

function recordSupplierAnnualReview(
  database: Database.Database,
  actorId: string,
  supplierId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = payloadObject(rawPayload);
  const supplier = database.prepare("SELECT id, name FROM suppliers WHERE id = ? AND status = 'active'").get(supplierId) as
    | { id: string; name: string }
    | undefined;
  if (!supplier) throw new Error("供应商不存在或未启用。");
  const reviewYear = Math.round(payloadNumber(payload, "review_year", "复评年度", { min: 2000 }));
  const qualityScore = roundMoney(payloadNumber(payload, "quality_score", "质量评分", { min: 0 }));
  const deliveryScore = roundMoney(payloadNumber(payload, "delivery_score", "交付评分", { min: 0 }));
  const certificateScore = roundMoney(payloadNumber(payload, "certificate_score", "资质评分", { min: 0 }));
  const cooperationScore = roundMoney(payloadNumber(payload, "cooperation_score", "协同评分", { min: 0 }));
  const calculatedScore = roundMoney(qualityScore * 0.4 + deliveryScore * 0.25 + certificateScore * 0.25 + cooperationScore * 0.1);
  const finalScore = roundMoney(payloadNumber(payload, "final_score", "最终评分", { min: 0 }) || calculatedScore);
  if ([qualityScore, deliveryScore, certificateScore, cooperationScore, finalScore].some((score) => score > 100)) {
    throw new Error("年度复评分数不能超过 100。");
  }
  const reviewedAt = `${payloadDate(payload, "reviewed_at", "复评日期", new Date().toISOString().slice(0, 10))}T00:00:00.000Z`;
  const nextReviewDueAt = payloadDate(payload, "next_review_due_at", "下次复评日期", `${reviewYear + 1}-12-31`);
  const conclusion = payloadText(payload, "conclusion", "复评结论", false) || `年度复评得分 ${finalScore}。`;
  const previousControl = database.prepare("SELECT control_status FROM supplier_admission_controls WHERE supplier_id = ?").get(supplier.id) as
    | { control_status: string }
    | undefined;
  const previousStatus = supplierAdmissionStatusValue(String(previousControl?.control_status ?? "normal"), "normal");
  const nextStatus = supplierAdmissionStatusFromScore(finalScore);
  const result = supplierAnnualReviewResultFromStatus(nextStatus);
  const certificateStatus = supplierCertificateRisk(database, supplier.id);
  const reviewId = uid("SARV");
  const reviewNo = serial(database, "supplier_annual_reviews", "NF");
  const actor = getUser(database, actorId);
  const requiresApproval = nextStatus !== previousStatus && !["manager", "admin"].includes(actor.role);
  const existing = database.prepare("SELECT id FROM supplier_annual_reviews WHERE supplier_id = ? AND review_year = ?").get(supplier.id, reviewYear) as
    | { id: string }
    | undefined;
  if (existing) throw new Error("该供应商本年度复评已存在。");

  let approvalId: string | null = null;
  let approvalNo = "";
  const createdAt = now();
  if (requiresApproval) {
    approvalId = uid("OA");
    approvalNo = serial(database, "approval_requests", "SP");
    database.prepare(`
      INSERT INTO approval_requests (
        id, request_no, type, title, applicant_id, status, amount,
        reason, rule_id, approver_role, sla_hours, entity_type, entity_id,
        created_at, decided_by, decided_at, decision_note
      )
      VALUES (?, ?, '供应商年度复评', ?, ?, 'pending', ?, ?, NULL, 'manager', 24, 'supplier_annual_review', ?, ?, NULL, NULL, NULL)
    `).run(
      approvalId,
      approvalNo,
      `${supplier.name} ${reviewYear}年度复评准入调整`,
      actorId,
      finalScore,
      `${supplierAnnualReviewResultLabel(result)}，准入建议由 ${supplierAdmissionStatusLabel(previousStatus)} 调整为 ${supplierAdmissionStatusLabel(nextStatus)}。${conclusion}`,
      reviewId,
      createdAt,
    );
  }

  database.prepare(`
    INSERT INTO supplier_annual_reviews (
      id, annual_review_no, supplier_id, review_year, quality_score, delivery_score,
      certificate_score, cooperation_score, final_score, previous_status, next_status,
      result, certificate_status, conclusion, reviewer_id, reviewed_at, next_review_due_at, created_at,
      status, approval_request_id, approved_by, approved_at, approval_note, applied_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reviewId,
    reviewNo,
    supplier.id,
    reviewYear,
    qualityScore,
    deliveryScore,
    certificateScore,
    cooperationScore,
    finalScore,
    previousStatus,
    nextStatus,
    result,
    certificateStatus,
    conclusion,
    actorId,
    reviewedAt,
    nextReviewDueAt,
    createdAt,
    requiresApproval ? "pending_approval" : "approved",
    approvalId,
    requiresApproval ? null : actorId,
    requiresApproval ? null : createdAt,
    requiresApproval ? "" : "复评记录提交后直接生效。",
    requiresApproval ? null : createdAt,
  );
  if (requiresApproval) {
    audit(database, actorId, "submitApproval", "approval", approvalId ?? "", `供应商年度复评 ${reviewNo} 自动提交审批 ${approvalNo}`);
  } else {
    applySupplierAnnualReviewAdmission({
      database,
      actorId,
      reviewId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      nextStatus,
      result,
      finalScore,
      conclusion,
    });
  }
  audit(database, actorId, "recordSupplierAnnualReview", "supplier_annual_review", reviewId, `供应商年度复评 ${reviewNo}：${supplier.name} / ${supplierAnnualReviewResultLabel(result)} / ${supplierAdmissionStatusLabel(nextStatus)}${requiresApproval ? " / 待审批" : ""}`);
}

type SupplierAdmissionRuleRow = {
  id: string;
  rule_code: string;
  rule_name: string;
  metric_key: string;
  operator: string;
  threshold_value: number;
  target_status: string;
  require_correction: number;
  priority: number;
  status: string;
  description: string;
};

type SupplierAdmissionRuleInput = ReturnType<typeof supplierAdmissionRulePayload>;

function supplierAdmissionOperatorLabel(value: string) {
  return (
    {
      lt: "小于",
      lte: "小于等于",
      gt: "大于",
      gte: "大于等于",
      eq: "等于",
    }[value] ?? value
  );
}

function supplierAdmissionRuleStatusLabel(value: string) {
  return (
    {
      active: "启用",
      inactive: "停用",
    }[value] ?? value
  );
}

function supplierAdmissionRuleStatusValue(value: string) {
  if (["active", "inactive"].includes(value)) return value;
  throw new Error("供应商准入规则状态不正确。");
}

function supplierAdmissionRuleOperatorValue(value: string) {
  if (["lt", "lte", "gt", "gte", "eq"].includes(value)) return value;
  throw new Error("供应商准入规则条件不正确。");
}

function supplierAdmissionRuleMetricValue(value: string) {
  if (["performance_score", "discrepancy_rate", "iqc_failed_streak", "open_discrepancy_count", "overdue_payable_count"].includes(value)) {
    return value;
  }
  throw new Error("供应商准入规则指标不正确。");
}

function supplierAdmissionRulePayload(rawPayload?: Record<string, unknown>) {
  const payload = payloadObject(rawPayload);
  const ruleCode = payloadText(payload, "rule_code", "规则编号");
  if (!/^[A-Z0-9][A-Z0-9_-]{2,40}$/.test(ruleCode)) throw new Error("规则编号需为 3-41 位大写字母、数字、横线或下划线。");
  const ruleName = payloadText(payload, "rule_name", "规则名称");
  const metricKey = supplierAdmissionRuleMetricValue(payloadText(payload, "metric_key", "评估指标"));
  const operator = supplierAdmissionRuleOperatorValue(payloadText(payload, "operator", "触发条件"));
  const thresholdValue = roundMoney(payloadNumber(payload, "threshold_value", "阈值", { min: 0 }));
  const targetStatus = supplierAdmissionStatusValue(payloadText(payload, "target_status", "触发后准入状态", false) || "watch");
  const requireCorrection = booleanPayload(payload, "require_correction", true) ? 1 : 0;
  const priority = Math.round(payloadNumber(payload, "priority", "规则优先级", { min: 0 }));
  const status = supplierAdmissionRuleStatusValue(payloadText(payload, "status", "规则状态", false) || "active");
  return {
    ruleCode,
    ruleName,
    metricKey,
    operator,
    thresholdValue,
    targetStatus,
    requireCorrection,
    priority,
    status,
    description: payloadText(payload, "description", "规则说明", false),
  };
}

function supplierAdmissionRuleInputRecord(input: SupplierAdmissionRuleInput, id?: string | null): Record<string, unknown> {
  return {
    id: id ?? "",
    rule_code: input.ruleCode,
    rule_name: input.ruleName,
    metric_key: input.metricKey,
    operator: input.operator,
    threshold_value: input.thresholdValue,
    target_status: input.targetStatus,
    require_correction: input.requireCorrection,
    priority: input.priority,
    status: input.status,
    description: input.description,
  };
}

function supplierAdmissionRuleRowFromRecord(record: Record<string, unknown>, fallbackId: string): SupplierAdmissionRuleRow {
  return {
    id: String(record.id || fallbackId),
    rule_code: String(record.rule_code ?? ""),
    rule_name: String(record.rule_name ?? ""),
    metric_key: supplierAdmissionRuleMetricValue(String(record.metric_key ?? "")),
    operator: supplierAdmissionRuleOperatorValue(String(record.operator ?? "")),
    threshold_value: Number(record.threshold_value ?? 0),
    target_status: supplierAdmissionStatusValue(String(record.target_status ?? "watch")),
    require_correction: Number(record.require_correction ?? 1),
    priority: Number(record.priority ?? 50),
    status: supplierAdmissionRuleStatusValue(String(record.status ?? "active")),
    description: String(record.description ?? ""),
  };
}

function supplierAdmissionRuleChangeStatusLabel(value: string) {
  return (
    {
      pending_approval: "待审批",
      approved: "已生效",
      rejected: "已驳回",
    }[value] ?? value
  );
}

function matchedSupplierAdmissionRule(
  database: Database.Database,
  supplierId: string,
  performance: Record<string, unknown>,
  rules: SupplierAdmissionRuleRow[],
) {
  return rules
    .filter((rule) => rule.status === "active")
    .map((rule) => {
      const metricValue = supplierAdmissionMetricValue(database, supplierId, rule.metric_key, performance);
      return {
        rule,
        metricValue,
        matched: supplierAdmissionRuleMatches(metricValue, rule.operator, Number(rule.threshold_value)),
      };
    })
    .filter((item) => item.matched)
    .sort((a, b) => {
      const rankDelta = supplierAdmissionStatusRank(b.rule.target_status) - supplierAdmissionStatusRank(a.rule.target_status);
      if (rankDelta !== 0) return rankDelta;
      return Number(b.rule.priority ?? 0) - Number(a.rule.priority ?? 0);
    })[0];
}

function buildSupplierAdmissionRuleImpactPreview(
  database: Database.Database,
  ruleId: string | undefined,
  rawPayload?: Record<string, unknown>,
) {
  const input = supplierAdmissionRulePayload(rawPayload);
  const existing = ruleId
    ? (database.prepare("SELECT * FROM supplier_admission_rules WHERE id = ?").get(ruleId) as Record<string, unknown> | undefined)
    : undefined;
  if (ruleId && !existing) throw new Error("供应商准入规则不存在。");
  const duplicate = database.prepare(`
    SELECT id
    FROM supplier_admission_rules
    WHERE rule_code = ?
      AND id != COALESCE(?, '')
    LIMIT 1
  `).get(input.ruleCode, ruleId ?? "") as { id: string } | undefined;
  if (duplicate) throw new Error("供应商准入规则编号已存在。");

  const currentRules = database.prepare("SELECT * FROM supplier_admission_rules").all() as SupplierAdmissionRuleRow[];
  const previewRecord = supplierAdmissionRuleInputRecord(input, ruleId || "__NEW_RULE__");
  const previewRule = supplierAdmissionRuleRowFromRecord(previewRecord, ruleId || "__NEW_RULE__");
  const replaced = ruleId ? currentRules.map((rule) => (rule.id === ruleId ? previewRule : rule)) : [...currentRules, previewRule];
  const suppliers = supplierPerformanceRows(database);
  const items = suppliers
    .map((supplier) => {
      const supplierId = String(supplier.supplier_id ?? "");
      const currentMatch = matchedSupplierAdmissionRule(database, supplierId, supplier, currentRules);
      const previewMatch = matchedSupplierAdmissionRule(database, supplierId, supplier, replaced);
      const currentStatus = currentMatch?.rule.target_status ?? "normal";
      const previewStatus = previewMatch?.rule.target_status ?? "normal";
      const currentPurchaseAllowed = supplierAdmissionPurchaseAllowed(currentStatus);
      const previewPurchaseAllowed = supplierAdmissionPurchaseAllowed(previewStatus);
      const openAction = openSupplierCorrectiveAction(database, supplierId);
      const willCreateCorrection =
        previewMatch && Number(previewMatch.rule.require_correction) && previewStatus !== "normal" && !openAction ? 1 : 0;
      const changed =
        currentStatus !== previewStatus ||
        currentMatch?.rule.rule_code !== previewMatch?.rule.rule_code ||
        Number(currentMatch?.rule.require_correction ?? 0) !== Number(previewMatch?.rule.require_correction ?? 0);
      return {
        supplier_id: supplierId,
        supplier_code: supplier.supplier_code,
        supplier_name: supplier.supplier_name,
        performance_score: supplier.performance_score,
        metric_value: previewMatch?.metricValue ?? supplierAdmissionMetricValue(database, supplierId, input.metricKey, supplier),
        current_rule_code: currentMatch?.rule.rule_code ?? "",
        preview_rule_code: previewMatch?.rule.rule_code ?? "",
        current_status: currentStatus,
        current_status_label: supplierAdmissionStatusLabel(currentStatus),
        preview_status: previewStatus,
        preview_status_label: supplierAdmissionStatusLabel(previewStatus),
        current_purchase_allowed: currentPurchaseAllowed,
        preview_purchase_allowed: previewPurchaseAllowed,
        purchase_control_delta:
          currentPurchaseAllowed !== previewPurchaseAllowed
            ? previewPurchaseAllowed
              ? "release"
              : "restrict"
            : "unchanged",
        will_create_correction: willCreateCorrection,
        changed: changed ? 1 : 0,
      };
    })
    .filter((item) => Number(item.changed) > 0);

  const currentRestrictedCount = suppliers.filter((supplier) => {
    const match = matchedSupplierAdmissionRule(database, String(supplier.supplier_id ?? ""), supplier, currentRules);
    return !supplierAdmissionPurchaseAllowed(match?.rule.target_status ?? "normal");
  }).length;
  const previewRestrictedCount = suppliers.filter((supplier) => {
    const match = matchedSupplierAdmissionRule(database, String(supplier.supplier_id ?? ""), supplier, replaced);
    return !supplierAdmissionPurchaseAllowed(match?.rule.target_status ?? "normal");
  }).length;
  const correctionCount = items.reduce((sum, item) => sum + Number(item.will_create_correction ?? 0), 0);
  const affectedCount = items.length;
  const riskLevel =
    previewRule.target_status === "blacklisted" ||
    previewRestrictedCount > currentRestrictedCount ||
    correctionCount > 0 ||
    affectedCount >= 3
      ? "high"
      : affectedCount > 0
        ? "medium"
        : "low";
  const oldRecord = existing ? { ...existing } : {};
  const hasChange = !existing || JSON.stringify(supplierAdmissionRuleInputRecord(input, ruleId ?? "")) !== JSON.stringify({
    id: ruleId ?? "",
    rule_code: oldRecord.rule_code ?? "",
    rule_name: oldRecord.rule_name ?? "",
    metric_key: oldRecord.metric_key ?? "",
    operator: oldRecord.operator ?? "",
    threshold_value: Number(oldRecord.threshold_value ?? 0),
    target_status: oldRecord.target_status ?? "",
    require_correction: Number(oldRecord.require_correction ?? 0),
    priority: Number(oldRecord.priority ?? 0),
    status: oldRecord.status ?? "",
    description: oldRecord.description ?? "",
  });

  return {
    rule_id: ruleId ?? "",
    rule_code: input.ruleCode,
    rule_name: input.ruleName,
    metric_key: input.metricKey,
    metric_label: supplierAdmissionMetricLabel(input.metricKey),
    operator: input.operator,
    operator_label: supplierAdmissionOperatorLabel(input.operator),
    threshold_value: input.thresholdValue,
    target_status: input.targetStatus,
    target_status_label: supplierAdmissionStatusLabel(input.targetStatus),
    require_correction: input.requireCorrection,
    require_correction_label: input.requireCorrection ? "自动生成整改" : "仅记录事件",
    priority: input.priority,
    status: input.status,
    status_label: supplierAdmissionRuleStatusLabel(input.status),
    description: input.description,
    has_change: hasChange,
    old_rule: oldRecord,
    new_rule: supplierAdmissionRuleInputRecord(input, ruleId ?? ""),
    summary: {
      affected_count: affectedCount,
      current_restricted_count: currentRestrictedCount,
      preview_restricted_count: previewRestrictedCount,
      delta_restricted_count: previewRestrictedCount - currentRestrictedCount,
      correction_count: correctionCount,
      risk_level: riskLevel,
    },
    items,
    summary_text:
      affectedCount > 0
        ? `预计影响 ${affectedCount} 家供应商，限制采购 ${previewRestrictedCount} 家，需生成整改 ${correctionCount} 项。`
        : "预计不会改变当前供应商准入判断。",
    generated_at: now(),
  };
}

export function previewSupplierAdmissionRuleImpact(input: {
  actorId: string;
  ruleId?: string;
  payload?: Record<string, unknown>;
}) {
  const database = getDb();
  requireRole(database, input.actorId, ["admin"]);
  return buildSupplierAdmissionRuleImpactPreview(database, input.ruleId, input.payload);
}

function upsertSupplierAdmissionRule(
  database: Database.Database,
  actorId: string,
  ruleId?: string,
  rawPayload?: Record<string, unknown>,
) {
  const input = supplierAdmissionRulePayload(rawPayload);
  const timestamp = now();
  const duplicate = database.prepare(`
    SELECT id
    FROM supplier_admission_rules
    WHERE rule_code = ?
      AND id != COALESCE(?, '')
    LIMIT 1
  `).get(input.ruleCode, ruleId ?? "") as { id: string } | undefined;
  if (duplicate) throw new Error("供应商准入规则编号已存在。");

  if (ruleId) {
    const existing = database.prepare("SELECT id FROM supplier_admission_rules WHERE id = ?").get(ruleId) as { id: string } | undefined;
    if (!existing) throw new Error("供应商准入规则不存在。");
    database.prepare(`
      UPDATE supplier_admission_rules
      SET rule_code = ?,
          rule_name = ?,
          metric_key = ?,
          operator = ?,
          threshold_value = ?,
          target_status = ?,
          require_correction = ?,
          priority = ?,
          status = ?,
          description = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.ruleCode,
      input.ruleName,
      input.metricKey,
      input.operator,
      input.thresholdValue,
      input.targetStatus,
      input.requireCorrection,
      input.priority,
      input.status,
      input.description,
      timestamp,
      existing.id,
    );
    audit(database, actorId, "upsertSupplierAdmissionRule", "supplier_admission_rule", existing.id, `更新供应商准入规则 ${input.ruleName}`);
    return;
  }

  const id = uid("SAR");
  database.prepare(`
    INSERT INTO supplier_admission_rules (
      id, rule_code, rule_name, metric_key, operator, threshold_value,
      target_status, require_correction, priority, status, description, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.ruleCode,
    input.ruleName,
    input.metricKey,
    input.operator,
    input.thresholdValue,
    input.targetStatus,
    input.requireCorrection,
    input.priority,
    input.status,
    input.description,
    timestamp,
    timestamp,
  );
  audit(database, actorId, "upsertSupplierAdmissionRule", "supplier_admission_rule", id, `新增供应商准入规则 ${input.ruleName}`);
}

function submitSupplierAdmissionRuleChange(
  database: Database.Database,
  actorId: string,
  ruleId?: string,
  rawPayload?: Record<string, unknown>,
) {
  const preview = buildSupplierAdmissionRuleImpactPreview(database, ruleId, rawPayload);
  if (!preview.has_change) throw new Error("供应商准入规则内容未变化，无需提交审批。");
  const pending = ruleId
    ? (database.prepare(`
        SELECT id
        FROM supplier_admission_rule_change_requests
        WHERE rule_id = ?
          AND status = 'pending_approval'
        LIMIT 1
      `).get(ruleId) as { id: string } | undefined)
    : undefined;
  if (pending) throw new Error("该供应商准入规则已有待审批变更。");

  const changeId = uid("SRC");
  const changeNo = serial(database, "supplier_admission_rule_change_requests", "GZ");
  const approvalId = uid("OA");
  const approvalNo = serial(database, "approval_requests", "SP");
  const createdAt = now();
  const affectedCount = Number((preview.summary as Record<string, unknown>).affected_count ?? 0);
  const title = `供应商准入规则变更 ${preview.rule_name}`;
  database.prepare(`
    INSERT INTO approval_requests (
      id, request_no, type, title, applicant_id, status, amount,
      reason, rule_id, approver_role, sla_hours, entity_type, entity_id,
      created_at, decided_by, decided_at, decision_note
    )
    VALUES (?, ?, '供应商准入规则变更', ?, ?, 'pending', ?, ?, NULL, 'manager', 24, 'supplier_admission_rule_change', ?, ?, NULL, NULL, NULL)
  `).run(
    approvalId,
    approvalNo,
    title,
    actorId,
    affectedCount,
    String(preview.summary_text ?? ""),
    changeId,
    createdAt,
  );
  database.prepare(`
    INSERT INTO supplier_admission_rule_change_requests (
      id, change_no, rule_id, approval_request_id, status,
      old_rule_json, new_rule_json, impact_json,
      created_by, created_at, approved_by, approved_at, applied_at, approval_note
    )
    VALUES (?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, NULL, NULL, NULL, '')
  `).run(
    changeId,
    changeNo,
    ruleId ?? null,
    approvalId,
    JSON.stringify(preview.old_rule ?? {}),
    JSON.stringify(preview.new_rule ?? {}),
    JSON.stringify(preview),
    actorId,
    createdAt,
  );
  audit(database, actorId, "submitSupplierAdmissionRuleChange", "supplier_admission_rule_change", changeId, `提交供应商准入规则变更 ${changeNo}：${preview.rule_name}`);
  audit(database, actorId, "submitApproval", "approval", approvalId, `供应商准入规则变更 ${changeNo} 自动提交审批 ${approvalNo}`);
}

function decideSupplierAdmissionRuleChange(
  database: Database.Database,
  actorId: string,
  changeId: string,
  decision: "approved" | "rejected",
  note: string,
  decidedAt: string,
) {
  const change = database.prepare("SELECT * FROM supplier_admission_rule_change_requests WHERE id = ?").get(changeId) as
    | {
        id: string;
        change_no: string;
        rule_id?: string | null;
        status: string;
        new_rule_json: string;
      }
    | undefined;
  if (!change || change.status !== "pending_approval") return;
  if (decision === "rejected") {
    database.prepare(`
      UPDATE supplier_admission_rule_change_requests
      SET status = 'rejected',
          approved_by = ?,
          approved_at = ?,
          approval_note = ?
      WHERE id = ?
    `).run(actorId, decidedAt, note, change.id);
    audit(database, actorId, "rejectSupplierAdmissionRuleChange", "supplier_admission_rule_change", change.id, `驳回供应商准入规则变更 ${change.change_no}`);
    return;
  }

  const newRule = parseJsonRecord(change.new_rule_json);
  upsertSupplierAdmissionRule(database, actorId, change.rule_id ?? undefined, newRule);
  const batchResult = evaluateAllSupplierAdmissionRules(database, actorId, "supplier_admission_rule_change", change.id);
  database.prepare(`
    UPDATE supplier_admission_rule_change_requests
    SET status = 'approved',
        approved_by = ?,
        approved_at = ?,
        applied_at = ?,
        approval_note = ?
    WHERE id = ?
  `).run(actorId, decidedAt, decidedAt, note, change.id);
  audit(
    database,
    actorId,
    "approveSupplierAdmissionRuleChange",
    "supplier_admission_rule_change",
    change.id,
    `同意并生效供应商准入规则变更 ${change.change_no}，自动重算 ${batchResult.supplierCount} 家供应商，触发 ${batchResult.triggeredCount} 条规则事件`,
  );
}

function supplierAdmissionRuleRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT *
    FROM supplier_admission_rules
    ORDER BY status ASC, priority DESC, rule_code ASC
  `).all() as SupplierAdmissionRuleRow[]).map((row) => ({
    ...row,
    operator_label: supplierAdmissionOperatorLabel(row.operator),
    target_status_label: supplierAdmissionStatusLabel(row.target_status),
    require_correction_label: Number(row.require_correction) ? "自动生成整改" : "仅记录事件",
    status_label: supplierAdmissionRuleStatusLabel(row.status),
  }));
}

function supplierAdmissionRuleChangeRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT src.*,
           creator.name AS created_by_name,
           approver.name AS approved_by_name,
           ar.request_no,
           ar.status AS approval_status,
           ar.decision_note
    FROM supplier_admission_rule_change_requests src
    JOIN users creator ON creator.id = src.created_by
    LEFT JOIN users approver ON approver.id = src.approved_by
    LEFT JOIN approval_requests ar ON ar.id = src.approval_request_id
    ORDER BY src.created_at DESC
  `).all() as Array<Record<string, unknown>>).map((row) => {
    const impact = parseJsonRecord(row.impact_json);
    const newRule = parseJsonRecord(row.new_rule_json);
    const summary = (impact.summary ?? {}) as Record<string, unknown>;
    return {
      ...row,
      rule_code: newRule.rule_code ?? "",
      rule_name: newRule.rule_name ?? "",
      metric_key: newRule.metric_key ?? "",
      metric_label: supplierAdmissionMetricLabel(String(newRule.metric_key ?? "")),
      target_status: newRule.target_status ?? "",
      target_status_label: supplierAdmissionStatusLabel(String(newRule.target_status ?? "")),
      require_correction_label: Number(newRule.require_correction ?? 0) ? "自动生成整改" : "仅记录事件",
      status_label: supplierAdmissionRuleChangeStatusLabel(String(row.status)),
      impact_summary: summary,
      impact_items: impact.items ?? [],
      summary_text: impact.summary_text ?? "",
      affected_count: Number(summary.affected_count ?? 0),
      preview_restricted_count: Number(summary.preview_restricted_count ?? 0),
      delta_restricted_count: Number(summary.delta_restricted_count ?? 0),
      correction_count: Number(summary.correction_count ?? 0),
      triggered_event_count: scalarNumber(
        database,
        "SELECT COUNT(*) AS value FROM supplier_admission_rule_events WHERE source_type = 'supplier_admission_rule_change' AND source_id = ?",
        [String(row.id)],
      ),
      corrective_action_count: scalarNumber(
        database,
        `
          SELECT COUNT(*) AS value
          FROM supplier_admission_rule_events
          WHERE source_type = 'supplier_admission_rule_change'
            AND source_id = ?
            AND corrective_action_id IS NOT NULL
        `,
        [String(row.id)],
      ),
      risk_level: summary.risk_level ?? "",
    };
  });
}

function supplierAdmissionMetricLabel(value: string) {
  return (
    {
      performance_score: "综合评分",
      discrepancy_rate: "到货差异率",
      iqc_failed_streak: "连续 IQC 不合格",
      open_discrepancy_count: "未结差异单",
      overdue_payable_count: "逾期应付",
    }[value] ?? value
  );
}

function supplierAdmissionRuleEventRows(database: Database.Database): Array<Record<string, unknown>> {
  return (database.prepare(`
    SELECT sare.*,
           sar.rule_code,
           sar.rule_name,
           s.supplier_code,
           s.name AS supplier_name,
           sac.control_no,
           sca.action_no,
           trigger_user.name AS triggered_by_name
    FROM supplier_admission_rule_events sare
    JOIN supplier_admission_rules sar ON sar.id = sare.rule_id
    JOIN suppliers s ON s.id = sare.supplier_id
    LEFT JOIN supplier_admission_controls sac ON sac.id = sare.control_id
    LEFT JOIN supplier_corrective_actions sca ON sca.id = sare.corrective_action_id
    JOIN users trigger_user ON trigger_user.id = sare.triggered_by
    ORDER BY sare.triggered_at DESC
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    target_status_label: supplierAdmissionStatusLabel(String(row.target_status)),
    metric_label: supplierAdmissionMetricLabel(String(row.metric_key)),
  }));
}

function supplierAdmissionStatusRank(status: string) {
  return (
    {
      normal: 0,
      watch: 1,
      restricted: 2,
      blacklisted: 3,
    }[status] ?? 0
  );
}

function strongerSupplierAdmissionStatus(a: string, b: string) {
  return supplierAdmissionStatusRank(a) >= supplierAdmissionStatusRank(b) ? a : b;
}

function supplierAdmissionRuleMatches(value: number, operator: string, threshold: number) {
  if (!Number.isFinite(value)) return false;
  if (operator === "lt") return value < threshold;
  if (operator === "lte") return value <= threshold;
  if (operator === "gt") return value > threshold;
  if (operator === "gte") return value >= threshold;
  if (operator === "eq") return value === threshold;
  return false;
}

function supplierIqcFailedStreak(database: Database.Database, supplierId: string) {
  const rows = database.prepare(`
    SELECT iqc.status, iqc.result
    FROM material_iqc_inspections iqc
    JOIN purchase_orders po ON po.id = iqc.purchase_order_id
    WHERE po.supplier_id = ?
      AND iqc.status IN ('accepted', 'rejected')
    ORDER BY COALESCE(iqc.inspected_at, iqc.created_at) DESC, iqc.id DESC
    LIMIT 10
  `).all(supplierId) as Array<{ status: string; result: string }>;
  let streak = 0;
  for (const row of rows) {
    if (row.status === "rejected" || row.result === "rejected_return") {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

function supplierAdmissionMetricValue(
  database: Database.Database,
  supplierId: string,
  metricKey: string,
  performance: Record<string, unknown>,
) {
  if (metricKey === "iqc_failed_streak") return supplierIqcFailedStreak(database, supplierId);
  const value = Number(performance[metricKey] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function supplierAdmissionRuleEvaluationRows(database: Database.Database, supplierId: string) {
  const performance = supplierPerformanceRows(database, { supplierId })[0] ?? {};
  const rules = database.prepare(`
    SELECT *
    FROM supplier_admission_rules
    WHERE status = 'active'
    ORDER BY priority DESC, rule_code ASC
  `).all() as SupplierAdmissionRuleRow[];

  return rules
    .map((rule) => {
      const metricValue = supplierAdmissionMetricValue(database, supplierId, rule.metric_key, performance);
      return {
        rule,
        metricValue,
        matched: supplierAdmissionRuleMatches(metricValue, rule.operator, Number(rule.threshold_value)),
      };
    })
    .filter((item) => item.matched)
    .sort((a, b) => {
      const rankDelta = supplierAdmissionStatusRank(b.rule.target_status) - supplierAdmissionStatusRank(a.rule.target_status);
      if (rankDelta !== 0) return rankDelta;
      return Number(b.rule.priority ?? 0) - Number(a.rule.priority ?? 0);
    });
}

function openSupplierCorrectiveAction(database: Database.Database, supplierId: string) {
  return database.prepare(`
    SELECT id, action_no
    FROM supplier_corrective_actions
    WHERE supplier_id = ?
      AND status IN ('open', 'submitted', 'rejected')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(supplierId) as { id: string; action_no: string } | undefined;
}

function evaluateSupplierAdmissionRules(
  database: Database.Database,
  actorId: string,
  supplierId: string,
  rawPayload?: Record<string, unknown>,
) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const supplier = database.prepare("SELECT id, name FROM suppliers WHERE id = ? AND status = 'active'").get(supplierId) as
    | { id: string; name: string }
    | undefined;
  if (!supplier) throw new Error("供应商不存在或未启用。");

  const sourceType = payloadText(payload, "source_type", "触发来源", false) || "manual_review";
  const sourceId = payloadText(payload, "source_id", "触发来源单据", false) || sourceType;
  const matched = supplierAdmissionRuleEvaluationRows(database, supplier.id)[0];
  if (!matched) {
    audit(database, actorId, "evaluateSupplierAdmissionRules", "supplier", supplier.id, `供应商准入规则评估未触发：${supplier.name}`);
    return;
  }

  const duplicate = database.prepare(`
    SELECT id
    FROM supplier_admission_rule_events
    WHERE supplier_id = ?
      AND rule_id = ?
      AND source_type = ?
      AND source_id = ?
    LIMIT 1
  `).get(supplier.id, matched.rule.id, sourceType, sourceId) as { id: string } | undefined;
  if (duplicate) return;

  const existingControl = database.prepare(`
    SELECT control_status
    FROM supplier_admission_controls
    WHERE supplier_id = ?
  `).get(supplier.id) as { control_status: string } | undefined;
  const targetStatus = strongerSupplierAdmissionStatus(existingControl?.control_status ?? "normal", matched.rule.target_status);
  const performance = supplierPerformanceRows(database, { supplierId: supplier.id })[0] ?? {};
  const eventId = uid("SAE");
  const eventNo = serial(database, "supplier_admission_rule_events", "CF");
  const reason = `自动触发规则 ${matched.rule.rule_code}：${supplierAdmissionMetricLabel(matched.rule.metric_key)}${supplierAdmissionOperatorLabel(
    matched.rule.operator,
  )}${matched.rule.threshold_value}，当前值 ${roundMoney(matched.metricValue)}；来源 ${sourceType}/${sourceId}。`;
  const controlId = upsertSupplierAdmissionControl({
    database,
    actorId,
    supplierId: supplier.id,
    status: targetStatus,
    reason,
    sourceType: "supplier_admission_rule",
    sourceId: eventId,
    performanceScore: Number(performance.performance_score ?? 0),
    riskLevel: supplierAdmissionRiskFromStatus(targetStatus),
  });

  let correctiveActionId: string | null = null;
  if (Number(matched.rule.require_correction)) {
    const existingAction = openSupplierCorrectiveAction(database, supplier.id);
    correctiveActionId = existingAction?.id ?? null;
    if (!correctiveActionId) {
      const owner =
        (database.prepare("SELECT id FROM users WHERE id = 'U-PUR' AND status = 'active'").get() as { id: string } | undefined) ??
        (database.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(actorId) as { id: string } | undefined);
      if (!owner) throw new Error("供应商整改责任人不存在或未启用。");
      correctiveActionId = uid("SCA");
      const actionNo = serial(database, "supplier_corrective_actions", "ZG");
      const createdAt = now();
      database.prepare(`
        INSERT INTO supplier_corrective_actions (
          id, action_no, supplier_id, control_id, status, severity,
          required_action, due_date, owner_id, created_by, created_at
        )
        VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
      `).run(
        correctiveActionId,
        actionNo,
        supplier.id,
        controlId,
        supplierCorrectionSeverity(targetStatus),
        `自动触发规则 ${matched.rule.rule_code} 要求整改：请提交原因分析、纠正预防措施、批次追溯资料和复供复评依据。`,
        addDays(new Date().toISOString().slice(0, 10), targetStatus === "blacklisted" ? 7 : 14),
        owner.id,
        actorId,
        createdAt,
      );
    }
  }

  const actionSummary = correctiveActionId
    ? `已更新准入为${supplierAdmissionStatusLabel(targetStatus)}并生成/关联整改任务`
    : `已更新准入为${supplierAdmissionStatusLabel(targetStatus)}并记录规则事件`;
  database.prepare(`
    INSERT INTO supplier_admission_rule_events (
      id, event_no, supplier_id, rule_id, control_id, corrective_action_id,
      source_type, source_id, metric_key, metric_value, threshold_value,
      target_status, action_summary, triggered_by, triggered_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    eventNo,
    supplier.id,
    matched.rule.id,
    controlId,
    correctiveActionId,
    sourceType,
    sourceId,
    matched.rule.metric_key,
    roundMoney(matched.metricValue),
    roundMoney(Number(matched.rule.threshold_value)),
    targetStatus,
    actionSummary,
    actorId,
    now(),
  );
  audit(database, actorId, "evaluateSupplierAdmissionRules", "supplier_admission_rule_event", eventId, `${supplier.name} ${actionSummary}：${matched.rule.rule_code}`);
}

function evaluateAllSupplierAdmissionRules(
  database: Database.Database,
  actorId: string,
  sourceType: string,
  sourceId: string,
) {
  const suppliers = database.prepare("SELECT id FROM suppliers WHERE status = 'active' ORDER BY supplier_code, name").all() as Array<{ id: string }>;
  const beforeCount = scalarNumber(
    database,
    "SELECT COUNT(*) AS value FROM supplier_admission_rule_events WHERE source_type = ? AND source_id = ?",
    [sourceType, sourceId],
  );
  suppliers.forEach((supplier) => {
    evaluateSupplierAdmissionRules(database, actorId, supplier.id, {
      source_type: sourceType,
      source_id: sourceId,
    });
  });
  const afterCount = scalarNumber(
    database,
    "SELECT COUNT(*) AS value FROM supplier_admission_rule_events WHERE source_type = ? AND source_id = ?",
    [sourceType, sourceId],
  );
  const triggeredCount = Math.max(0, afterCount - beforeCount);
  audit(
    database,
    actorId,
    "evaluateAllSupplierAdmissionRules",
    sourceType,
    sourceId,
    `批量重算供应商准入规则：${suppliers.length} 家供应商，新增触发事件 ${triggeredCount} 条`,
  );
  return { supplierCount: suppliers.length, triggeredCount };
}

function buildSalesEntityFilter(alias: string, filters: ReportFilters, dateColumn: string, orderColumn = "order_id") {
  const conditions = ["1 = 1"];
  const params: unknown[] = [];
  addDateFilter(conditions, params, dateColumn, filters);
  if (filters.customerId) {
    conditions.push(`${alias}.customer_id = ?`);
    params.push(filters.customerId);
  }
  if (filters.orderId) {
    conditions.push(`${alias}.${orderColumn} = ?`);
    params.push(filters.orderId);
  }
  return { where: conditions.join(" AND "), params };
}

function buildProductionSalesFilter(filters: ReportFilters, dateColumn: string) {
  const conditions = ["1 = 1"];
  const params: unknown[] = [];
  addDateFilter(conditions, params, dateColumn, filters);
  if (filters.customerId) {
    conditions.push("o.customer_id = ?");
    params.push(filters.customerId);
  }
  if (filters.orderId) {
    conditions.push("o.id = ?");
    params.push(filters.orderId);
  }
  return { where: conditions.join(" AND "), params };
}

function buildPurchaseEntityFilter(alias: string, filters: ReportFilters, dateColumn: string) {
  const conditions = ["1 = 1"];
  const params: unknown[] = [];
  addDateFilter(conditions, params, dateColumn, filters);
  if (filters.supplierId) {
    conditions.push(`${alias}.supplier_id = ?`);
    params.push(filters.supplierId);
  }
  if (filters.purchaseOrderId) {
    conditions.push(`${alias}.id = ?`);
    params.push(filters.purchaseOrderId);
  }
  if (filters.materialId) {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM purchase_order_lines pol
        WHERE pol.purchase_order_id = ${alias}.id
          AND pol.material_id = ?
      )
    `);
    params.push(filters.materialId);
  }
  return { where: conditions.join(" AND "), params };
}

function buildPayableEntityFilter(alias: string, filters: ReportFilters, dateColumn: string) {
  const conditions = ["1 = 1"];
  const params: unknown[] = [];
  addDateFilter(conditions, params, dateColumn, filters);
  if (filters.supplierId) {
    conditions.push(`${alias}.supplier_id = ?`);
    params.push(filters.supplierId);
  }
  if (filters.purchaseOrderId) {
    conditions.push(`${alias}.purchase_order_id = ?`);
    params.push(filters.purchaseOrderId);
  }
  if (filters.materialId) {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM purchase_order_lines pol
        WHERE pol.purchase_order_id = ${alias}.purchase_order_id
          AND pol.material_id = ?
      )
    `);
    params.push(filters.materialId);
  }
  return { where: conditions.join(" AND "), params };
}

function businessReportRows(database: Database.Database, reportType: string, filters: ReportFilters = {}) {
  const orderFilter = buildSalesEntityFilter("o", filters, "o.created_at", "id");
  const purchaseFilter = buildPurchaseEntityFilter("po", filters, "po.created_at");
  const receivableFilter = buildSalesEntityFilter("r", filters, "r.created_at");
  const payableFilter = buildPayableEntityFilter("p", filters, "p.created_at");
  const receiptFilter = buildSalesEntityFilter("r", filters, "rr.received_at");
  const inspectionFilter = buildProductionSalesFilter(filters, "i.created_at");

  const row = {
    order_amount: scalarNumber(
      database,
      `
        SELECT COALESCE(SUM(q.total_amount), 0) AS value
        FROM orders o
        JOIN quotes q ON q.id = o.quote_id
        WHERE ${orderFilter.where}
      `,
      orderFilter.params,
    ),
    purchase_amount: scalarNumber(
      database,
      `
        SELECT COALESCE(SUM(po.total_amount), 0) AS value
        FROM purchase_orders po
        WHERE ${purchaseFilter.where}
      `,
      purchaseFilter.params,
    ),
    receivable_balance: scalarNumber(
      database,
      `
        SELECT COALESCE(SUM(r.balance_amount), 0) AS value
        FROM receivables r
        WHERE ${receivableFilter.where}
      `,
      receivableFilter.params,
    ),
    payable_balance: scalarNumber(
      database,
      `
        SELECT COALESCE(SUM(p.balance_amount), 0) AS value
        FROM payables p
        WHERE ${payableFilter.where}
      `,
      payableFilter.params,
    ),
    received_amount: scalarNumber(
      database,
      `
        SELECT COALESCE(SUM(rr.amount), 0) AS value
        FROM receivable_receipts rr
        JOIN receivables r ON r.id = rr.receivable_id
        WHERE ${receiptFilter.where}
      `,
      receiptFilter.params,
    ),
    average_yield: scalarNumber(
      database,
      `
        SELECT COALESCE(AVG(i.yield_rate), 0) AS value
        FROM inspections i
        JOIN production_orders po ON po.id = i.production_order_id
        JOIN orders o ON o.id = po.order_id
        WHERE i.yield_rate IS NOT NULL
          AND ${inspectionFilter.where}
      `,
      inspectionFilter.params,
    ),
  };
  return [{ report_type: reportType, generated_at: now(), filter_summary: reportFilterSummary(database, filters), ...row }];
}

function upsertReportSnapshot(database: Database.Database, exportType: FormalReportExportType, actorId: string, filters: ReportFilters = {}) {
  const metrics = reportSnapshotMetrics(database, exportType, filters);
  const period = reportPeriod(exportType);
  database.prepare(`
    INSERT INTO report_snapshots (id, report_no, type, period_start, period_end, metrics_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid("RPT"),
    serial(database, "report_snapshots", "BB"),
    reportSnapshotType(exportType),
    period.start,
    period.end,
    JSON.stringify({ ...metrics, actorId }),
    now(),
  );
}

function recordDocumentExport(
  database: Database.Database,
  input: { actorId: string; type: string; entityId?: string; fileName: string },
) {
  const entityType = isFormalReportExportType(input.type)
    ? "report"
    : input.type.includes("statement") || input.type === "ledger"
      ? "ledger"
      : "document";
  database.prepare(`
    INSERT INTO document_exports (id, document_no, type, entity_type, entity_id, file_name, actor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid("DOC"),
    serial(database, "document_exports", "DJ"),
    input.type,
    entityType,
    input.entityId ?? null,
    input.fileName,
    input.actorId,
    now(),
  );
}

function rows(values: unknown[]) {
  return values as Array<Record<string, unknown>>;
}

function parseJsonRecord(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  } catch {
    return {} as Record<string, unknown>;
  }
}

function rowsToCsv(dataRows: Array<Record<string, unknown>>) {
  const headers = [...new Set(dataRows.flatMap((row) => Object.keys(row)))];
  const lines = [
    headers.map(csvEscape).join(","),
    ...dataRows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ];
  return lines.join("\n");
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function csvToRows(content: string) {
  const lines = content.replace(/^\ufeff/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

function readXlsxRows(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  const worksheetEntry = zip.getEntry("xl/worksheets/sheet1.xml");
  if (!worksheetEntry) throw new Error("Excel 文件缺少首个工作表。");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "text",
  });
  const sharedStrings = readSharedStrings(zip, parser);
  const worksheet = parser.parse(worksheetEntry.getData().toString("utf8")) as XmlNode;
  const sheetData = node(worksheet, "worksheet.sheetData") as Record<string, unknown> | undefined;
  const rowNodes = toArray<Record<string, unknown>>(sheetData?.row);

  return rowNodes.map((row) => {
    const values: unknown[] = [];
    for (const cell of toArray<Record<string, unknown>>(row.c)) {
      const ref = String(cell.r ?? "");
      const index = columnIndexFromCellRef(ref);
      if (index < 0) continue;
      values[index] = readCellValue(cell, sharedStrings);
    }
    return values;
  });
}

function readSharedStrings(zip: AdmZip, parser: XMLParser) {
  const entry = zip.getEntry("xl/sharedStrings.xml");
  if (!entry) return [];
  const parsed = parser.parse(entry.getData().toString("utf8")) as XmlNode;
  const items = toArray<Record<string, unknown>>(node(parsed, "sst.si"));
  return items.map((item) => {
    if (item.t != null) return textValue(item.t);
    return toArray<Record<string, unknown>>(item.r)
      .map((part) => textValue(part.t))
      .join("");
  });
}

function readCellValue(cell: Record<string, unknown>, sharedStrings: string[]) {
  if (cell.t === "s") {
    return sharedStrings[Number(textValue(cell.v))] ?? "";
  }
  if (cell.t === "inlineStr") {
    return textValue(node(cell, "is.t"));
  }
  const raw = textValue(cell.v);
  if (raw === "") return "";
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

function columnIndexFromCellRef(ref: string) {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase();
  if (!letters) return -1;
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return value - 1;
}

type XmlNode = Record<string, unknown>;

function node(source: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

function toArray<T>(value: unknown): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

function textValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "object" && "text" in value) {
    return String((value as { text?: unknown }).text ?? "");
  }
  return String(value);
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function xlsxCellToPrimitive(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return value.result ?? "";
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    return JSON.stringify(value);
  }
  return value;
}

function buildXlsxBuffer(sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>) {
  const zip = new AdmZip();
  const safeSheets = sheets.length > 0 ? sheets : [{ name: "empty", rows: [] }];
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypesXml(safeSheets.length)));
  zip.addFile("_rels/.rels", Buffer.from(rootRelsXml()));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml(safeSheets)));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRelsXml(safeSheets.length)));
  zip.addFile("xl/styles.xml", Buffer.from(stylesXml()));
  safeSheets.forEach((sheet, index) => {
    zip.addFile(`xl/worksheets/sheet${index + 1}.xml`, Buffer.from(worksheetXml(sheet.rows)));
  });
  return zip.toBuffer();
}

function contentTypesXml(sheetCount: number) {
  const sheets = Array.from({ length: sheetCount }, (_, index) => {
    return `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets}
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheets: Array<{ name: string }>) {
  const sheetXml = sheets
    .map((sheet, index) => {
      return `<sheet name="${xmlEscape(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetXml}</sheets>
</workbook>`;
}

function workbookRelsXml(sheetCount: number) {
  const sheetRels = Array.from({ length: sheetCount }, (_, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;
}

function worksheetXml(dataRows: Array<Record<string, unknown>>) {
  const headers = [...new Set(dataRows.flatMap((row) => Object.keys(row)))];
  const rows = [headers, ...dataRows.map((row) => headers.map((header) => row[header]))];
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => cellXml(value, `${columnName(columnIndex + 1)}${rowIndex + 1}`))
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const dimension = rows.length && headers.length ? `A1:${columnName(headers.length)}${rows.length}` : "A1";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function cellXml(value: unknown, ref: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(value ?? ""))}</t></is></c>`;
}

function columnName(index: number) {
  let name = "";
  let value = index;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function createBackup(actorId: string) {
  const database = getDb();
  requireRole(database, actorId, ["admin"]);
  const paths = ensureDataDirs();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const backupName = `erp-cold-backup-${stamp}.zip`;
  const backupPath = path.join(paths.backups, backupName);
  const tempDb = path.join(paths.backups, `erp-${stamp}.sqlite`);

  await database.backup(tempDb);

  const zip = new AdmZip();
  zip.addLocalFile(tempDb, "", "erp.sqlite");
  addDirectoryToZip(zip, paths.attachments, "attachments");
  addDirectoryToZip(zip, paths.exports, "exports");
  zip.addFile(
    "manifest.json",
    Buffer.from(
      JSON.stringify(
        {
          createdAt: now(),
          dataRoot: paths.root,
          database: "erp.sqlite",
          includes: ["attachments", "exports"],
          restore: "npm run restore -- <backup.zip>",
        },
        null,
        2,
      ),
    ),
  );
  zip.writeZip(backupPath);
  fs.rmSync(tempDb, { force: true });
  audit(database, actorId, "createBackup", "system", "backup", `生成冷备份 ${backupName}`);
  return { fileName: backupName, path: backupPath };
}

function addDirectoryToZip(zip: AdmZip, source: string, targetRoot: string) {
  if (!fs.existsSync(source)) return;
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(source, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      addDirectoryToZip(zip, full, target);
    } else {
      zip.addLocalFile(full, path.dirname(target), path.basename(target));
    }
  }
}
