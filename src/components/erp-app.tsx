"use client";

import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Boxes,
  Calculator,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  DatabaseBackup,
  Download,
  Factory,
  FileCheck2,
  FileSpreadsheet,
  FlaskConical,
  Gauge,
  LogIn,
  MessagesSquare,
  PackageCheck,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  ShieldCheck,
  Truck,
  Upload,
  Warehouse,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildDeliveryNotePreview, type DeliveryNotePreview } from "@/lib/delivery-note";
import {
  buildPurchaseArrivalNoticePrintPreview,
  buildPurchaseContractPrintPreview,
  buildPurchaseArrivalDiscrepancyPrintPreview,
  buildCustomerRefundPrintPreview,
  buildPurchaseReceiptPrintPreview,
  buildProductionPlanPrintPreview,
  buildReplacementShipmentPrintPreview,
  buildSalesReturnPrintPreview,
  buildStocktakePrintPreview,
  buildTechnicalDispositionPrintPreview,
  buildWarehouseSignoffPrintPreview,
  formalPrintFromDeliveryNote,
  formalPrintFromDocument,
  type FormalPrintDocument,
} from "@/lib/formal-print";
import {
  buildFinishedGoodsReceiptPreview,
  buildMaterialIssuePreview,
  buildMaterialRequisitionPreview,
  buildProductionInstructionPreview,
  type FormalDocumentPreview,
} from "@/lib/production-documents";
import { buildReportPreview, type ReportPreview, type ReportPreviewType } from "@/lib/report-preview";

type User = {
  id: string;
  username: string;
  name: string;
  role: string;
  role_label: string;
  status: string;
  last_login_at?: string | null;
  password_changed_at?: string | null;
  title: string;
};

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

type Row = Record<string, unknown>;

type ReportFilterState = {
  dateFrom: string;
  dateTo: string;
  customerId: string;
  supplierId: string;
  materialId: string;
  orderId: string;
  purchaseOrderId: string;
};

type DetailField = {
  label: string;
  value: React.ReactNode;
};

type DetailState = {
  title: string;
  subtitle: string;
  fields: DetailField[];
  lines?: Row[];
  audits?: Row[];
};

type Snapshot = {
  dataRoot: string;
  users: User[];
  currentUser: User;
  tasks: Task[];
  summary: {
    orderAmount: number;
    purchaseAmount: number;
    inventoryValue: number;
    receivableBalance: number;
    payableBalance: number;
    receivedAmount: number;
    lowStockCount: number;
    staleWarningCount: number;
    overstockCount: number;
    overstockValue: number;
    mrpShortageLineCount: number;
    mrpShortageAmount: number;
    pendingApprovalCount: number;
    approvalOverdueCount: number;
    formulaCount: number;
    activeProductions: number;
    pendingTasks: number;
    alertCount: number;
    criticalAlertCount: number;
    unreadAlertCount: number;
    dismissedAlertCount: number;
    qualityExceptionCount: number;
    qualityClosureRate: number;
    lowYieldWarningCount: number;
    supplierRiskCount: number;
    supplierAverageScore: number;
    supplierRestrictedCount: number;
    supplierCorrectiveOpenCount: number;
    supplierCorrectionOverdueCount: number;
    supplierReleaseCount: number;
    supplierObservationActiveCount: number;
    supplierCertificateDueCount: number;
    supplierQualificationMissingCount: number;
    supplierQualificationBlockingCount: number;
    supplierAnnualReviewDueCount: number;
    supplierAutoRuleCount: number;
    supplierAutoTriggerCount: number;
    supplierRuleChangePendingCount: number;
    processNodeCount: number;
    processPendingCount: number;
    processExceptionCount: number;
    systemHealthScore: number;
    systemHealthCriticalCount: number;
    systemHealthWarningCount: number;
  };
  board: {
    quotes: Row[];
    orders: Row[];
    customers: Row[];
    productions: Row[];
    productionScheduleChanges: Row[];
    productionDeliveryWarnings: Row[];
    productionPlanVersions: Row[];
    productionPlanLines: Row[];
    productionPlanNotifications: Row[];
    productionPlanChangeImpacts: Row[];
    productionMaterialAdjustmentSuggestions: Row[];
    qualityInspectionWindowConfirmations: Row[];
    customerDeliveryConfirmations: Row[];
    requisitions: Row[];
    materialIssues: Row[];
    inspections: Row[];
    productionDailyReports: Row[];
    technicalDispositions: Row[];
    qualityExceptionAnalytics: {
      totals?: Row;
      rootCauses?: Row[];
      dispositionTypes?: Row[];
      openExceptions?: Row[];
    };
    materials: Row[];
    batches: Row[];
    inventoryAging: Row[];
    finishedBatches: Row[];
    finishedReceipts: Row[];
    productionCostSummaries: Row[];
    finishedShipmentAllocations: Row[];
    shipments: Row[];
    salesReturns: Row[];
    salesReturnAllocations: Row[];
    salesReturnCandidates: Row[];
    replacementShipmentCandidates: Row[];
    customerRefunds: Row[];
    suppliers: Row[];
    supplierPerformance: Row[];
    supplierAdmissionControls: Row[];
    supplierCorrectiveActions: Row[];
    supplierReassessments: Row[];
    supplierAdmissionReleases: Row[];
    supplierObservationPeriods: Row[];
    supplierQualificationCertificates: Row[];
    supplierQualificationRequirements: Row[];
    supplierQualificationMatrix: Row[];
    supplierAnnualReviews: Row[];
    supplierAnnualReviewDue: Row[];
    supplierAdmissionRules: Row[];
    supplierAdmissionRuleEvents: Row[];
    supplierAdmissionRuleChangeRequests: Row[];
    products: Row[];
    boms: Row[];
    purchaseRequisitions: Row[];
    mrpRequirementRuns: Row[];
    mrpRequirementLines: Row[];
    purchaseContracts: Row[];
    purchaseArrivalNotices: Row[];
    purchaseArrivalDiscrepancies: Row[];
    purchaseOrders: Row[];
    materialIqcInspections: Row[];
    purchaseReceipts: Row[];
    stocktakes: Row[];
    inventoryTrace: Row[];
    payables: Row[];
    receivables: Row[];
    processFlow: Row[];
    processFlowSummary: Row;
    systemHealthSummary: Row;
    systemHealthChecks: Row[];
    systemHealthRemediations: Row[];
    systemHealthRemediationReviews: Row[];
    operatingParameters: Row;
    approvalRequests: Row[];
    approvalCenter: Row[];
    approvalRules: Row[];
    alertCenter: Row[];
    alertMessageStates: Row[];
    alertSubscriptions: Row[];
    formulaCalculations: Row[];
    inventoryAgingDispositions: Row[];
    documentSequences: Row[];
    documentCancellations: Row[];
    documentVoidCandidates: Row[];
    documentReversals: Row[];
    documentReversalCandidates: Row[];
    ledgerRedOffsets: Row[];
    documentAttachments: Row[];
    initializationImports: Row[];
    documentExports: Row[];
    reportSnapshots: Row[];
    systemSettings: Row[];
    systemSettingEffects: Row[];
    loginLogs: Row[];
    auditLogs: Row[];
  };
  charts: {
    inventoryByMaterial: Array<{ name: string; value: number }>;
    productionStages: Array<{ name: string; stage: number; status: string }>;
    orderFunnel: Array<{ name: string; value: number }>;
    cashPosition: Array<{ name: string; value: number }>;
    yieldTrend: Array<{ name: string; value: number }>;
  };
  storage: {
    databaseBytes: number;
    attachmentsBytes: number;
    exportsBytes: number;
    backupsBytes: number;
    latestBackup: string;
    restoreCommand: string;
    archiveNote: string;
  };
  security: {
    currentPermissions: string[];
    rolePermissions: Row[];
    permissionMatrix: Row[];
  };
};

type ModuleKey =
  | "overview"
  | "process"
  | "master"
  | "sales"
  | "production"
  | "inventory"
  | "quality"
  | "finance"
  | "reports"
  | "approval"
  | "archive"
  | "system";

type ActionRequest = Pick<Task, "action" | "entityId"> & {
  variant?: string;
  payload?: Record<string, unknown>;
};

const roleIcon: Record<string, typeof ClipboardList> = {
  sales: FileSpreadsheet,
  assistant: ClipboardList,
  production: Factory,
  warehouse: Warehouse,
  purchasing: Boxes,
  quality: FlaskConical,
  technical: ShieldCheck,
  manager: Gauge,
  finance: Download,
  admin: ShieldCheck,
};

const taskIcon: Record<string, typeof ClipboardList> = {
  confirmQuote: CheckCircle2,
  createOrder: ArrowRight,
  createProductionInstruction: ClipboardList,
  createShipment: Truck,
  scheduleAndGenerateRequisition: Factory,
  updateProductionSchedule: Factory,
  requestInspection: FlaskConical,
  createProductionDailyReport: ClipboardList,
  issueMaterials: Boxes,
  receiveFinishedGoods: PackageCheck,
  completeInspection: ShieldCheck,
  createTechnicalDisposition: ShieldCheck,
  createPurchaseOrder: ClipboardList,
  createPurchaseRequisition: ClipboardList,
  generateMrpRequirementRun: ClipboardList,
  createPurchaseRequisitionFromMrp: ClipboardList,
  createPurchaseContract: ReceiptText,
  createPurchaseArrivalNotice: Truck,
  signPurchaseArrivalNotice: Warehouse,
  registerPurchaseArrivalDiscrepancy: AlertTriangle,
  resolvePurchaseArrivalDiscrepancy: CheckCircle2,
  createSupplierCorrectiveAction: FileCheck2,
  blacklistSupplier: ShieldCheck,
  submitSupplierCorrection: Upload,
  reviewSupplierCorrection: CheckCircle2,
  upsertSupplierCertificate: FileCheck2,
  renewSupplierCertificate: RotateCcw,
  recordSupplierAnnualReview: ClipboardList,
  evaluateSupplierAdmissionRules: ShieldCheck,
  createPurchaseOrderFromRequisition: ClipboardList,
  createMaterialIqcInspection: FlaskConical,
  completeMaterialIqcInspection: ShieldCheck,
  receivePurchaseOrder: Warehouse,
  recordPayablePayment: Download,
  recordReceivableReceipt: CheckCircle2,
  approveMaterialRequisition: CheckCircle2,
  rejectMaterialRequisition: FileCheck2,
  purchaseInbound: Warehouse,
  submitApproval: FileCheck2,
  approveApproval: CheckCircle2,
  rejectApproval: FileCheck2,
  createFormulaCalculation: Calculator,
  upsertApprovalRule: ShieldCheck,
  deactivateApprovalRule: ShieldCheck,
  markAlertRead: CheckCircle2,
  dismissAlert: X,
  upsertAlertSubscription: BellRing,
  upsertSystemSetting: ShieldCheck,
  upsertSupplierAdmissionRule: ShieldCheck,
  submitSupplierAdmissionRuleChange: FileCheck2,
  createSystemHealthRemediation: FileCheck2,
  markSystemHealthRemediationReady: Upload,
  rejectSystemHealthRemediationReview: X,
  closeSystemHealthRemediation: CheckCircle2,
  voidBusinessDocument: FileCheck2,
  reverseBusinessDocument: RotateCcw,
  recordSalesReturn: RotateCcw,
  recordCustomerRefund: Download,
  createReplacementShipment: Truck,
  recordInventoryAgingDisposition: FileCheck2,
  createStocktake: ClipboardList,
  approveStocktake: CheckCircle2,
  resetDemo: RotateCcw,
  downloadBackup: DatabaseBackup,
  downloadFinance: Download,
  downloadLedger: Download,
  downloadDeliveryNote: Truck,
  downloadSalesStatement: FileSpreadsheet,
  downloadPurchaseStatement: FileSpreadsheet,
  downloadDailyReport: FileSpreadsheet,
  downloadMonthlyReport: FileSpreadsheet,
  downloadOverstockReport: FileSpreadsheet,
};

const navItems = [
  { key: "overview", label: "经营总览", title: "经营总览", subtitle: "订单、生产、库存、现金流与待办", icon: Gauge },
  { key: "process", label: "流程驾驶舱", title: "流程驾驶舱", subtitle: "客户流程图节点、待办、异常与部门责任", icon: ArrowRight },
  { key: "master", label: "主数据", title: "主数据管理", subtitle: "客户、供应商、物料、产品与 BOM 基础资料", icon: DatabaseBackup },
  { key: "sales", label: "销售订单", title: "销售订单", subtitle: "报价、客户订单、发货与销售对账", icon: FileSpreadsheet },
  { key: "production", label: "生产执行", title: "生产执行", subtitle: "生产指令、排产、领料与 BOM", icon: Factory },
  { key: "inventory", label: "采购仓储", title: "采购仓储", subtitle: "供应商、采购单、库存批次与预警", icon: Warehouse },
  { key: "quality", label: "质检收率", title: "质检收率", subtitle: "请验、检验结果、成品入库与收率", icon: FlaskConical },
  { key: "finance", label: "财务台账", title: "财务台账", subtitle: "应收、应付、收付款与账龄", icon: Download },
  { key: "reports", label: "报表中心", title: "报表中心", subtitle: "日报、周报、月报、对账与积压库存报表", icon: FileSpreadsheet },
  { key: "approval", label: "审批算价", title: "审批算价", subtitle: "办公 OA 审批、授权配方试算与历史统计", icon: Calculator },
  { key: "archive", label: "本地归档", title: "本地归档", subtitle: "数据盘、冷备份、导出记录与审计", icon: DatabaseBackup },
  { key: "system", label: "系统管理", title: "系统管理", subtitle: "账号登录、角色权限、密码与审计", icon: ShieldCheck },
] satisfies Array<{ key: ModuleKey; label: string; title: string; subtitle: string; icon: typeof ClipboardList }>;

const toneClass: Record<Task["tone"], string> = {
  amber: "border-l-amber-500 bg-amber-50/70",
  green: "border-l-emerald-500 bg-emerald-50/70",
  blue: "border-l-blue-500 bg-blue-50/70",
  rose: "border-l-rose-500 bg-rose-50/70",
  neutral: "border-l-slate-400 bg-slate-50",
};

const statusClass: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  inactive: "bg-slate-100 text-slate-600 ring-slate-200",
  voided: "bg-slate-100 text-slate-600 ring-slate-200",
  reversed: "bg-purple-50 text-purple-700 ring-purple-200",
  returned: "bg-amber-50 text-amber-700 ring-amber-200",
  pending_refund: "bg-amber-50 text-amber-700 ring-amber-200",
  partial_refunded: "bg-blue-50 text-blue-700 ring-blue-200",
  refunded: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending_replacement: "bg-amber-50 text-amber-700 ring-amber-200",
  replaced: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  not_required: "bg-slate-100 text-slate-600 ring-slate-200",
  refund_due: "bg-rose-50 text-rose-700 ring-rose-200",
  no_charge: "bg-blue-50 text-blue-700 ring-blue-200",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partial: "bg-amber-50 text-amber-700 ring-amber-200",
  unpaid: "bg-rose-50 text-rose-700 ring-rose-200",
  pending_approval: "bg-amber-50 text-amber-700 ring-amber-200",
  pending_receipt: "bg-blue-50 text-blue-700 ring-blue-200",
  iqc_pending: "bg-amber-50 text-amber-700 ring-amber-200",
  iqc_rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  received: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  shipped: "bg-slate-100 text-slate-700 ring-slate-200",
  draft: "bg-amber-50 text-amber-700 ring-amber-200",
  covered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  shortage: "bg-rose-50 text-rose-700 ring-rose-200",
  requisition_created: "bg-blue-50 text-blue-700 ring-blue-200",
  supplier_ordered: "bg-blue-50 text-blue-700 ring-blue-200",
  pending_signoff: "bg-amber-50 text-amber-700 ring-amber-200",
  discrepancy_pending: "bg-rose-50 text-rose-700 ring-rose-200",
  discrepancy_approved: "bg-blue-50 text-blue-700 ring-blue-200",
  signed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  iqc_created: "bg-blue-50 text-blue-700 ring-blue-200",
  converted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  pending_inspection: "bg-amber-50 text-amber-700 ring-amber-200",
  partial_shipped: "bg-blue-50 text-blue-700 ring-blue-200",
  普通: "bg-slate-100 text-slate-700 ring-slate-200",
  加急: "bg-rose-50 text-rose-700 ring-rose-200",
  高优先级: "bg-amber-50 text-amber-700 ring-amber-200",
  优质供应商: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  稳定供应商: "bg-blue-50 text-blue-700 ring-blue-200",
  观察供应商: "bg-amber-50 text-amber-700 ring-amber-200",
  高风险供应商: "bg-rose-50 text-rose-700 ring-rose-200",
  准入正常: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  观察准入: "bg-amber-50 text-amber-700 ring-amber-200",
  限制采购: "bg-rose-50 text-rose-700 ring-rose-200",
  黑名单: "bg-slate-900 text-white ring-slate-700",
  允许采购: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  限制下单: "bg-rose-50 text-rose-700 ring-rose-200",
  自动生成整改: "bg-blue-50 text-blue-700 ring-blue-200",
  仅记录事件: "bg-slate-100 text-slate-700 ring-slate-200",
  待复评: "bg-blue-50 text-blue-700 ring-blue-200",
  复评驳回: "bg-rose-50 text-rose-700 ring-rose-200",
  复评通过: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  复评不通过: "bg-rose-50 text-rose-700 ring-rose-200",
  待审批: "bg-amber-50 text-amber-700 ring-amber-200",
  已同意: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  已驳回: "bg-rose-50 text-rose-700 ring-rose-200",
  待审批生效: "bg-amber-50 text-amber-700 ring-amber-200",
  已审批生效: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  审批驳回: "bg-rose-50 text-rose-700 ring-rose-200",
  有效: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  即将到期: "bg-amber-50 text-amber-700 ring-amber-200",
  已过期: "bg-rose-50 text-rose-700 ring-rose-200",
  符合: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  临期: "bg-amber-50 text-amber-700 ring-amber-200",
  缺失: "bg-rose-50 text-rose-700 ring-rose-200",
  阻止下单: "bg-rose-50 text-rose-700 ring-rose-200",
  允许下单: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  仅预警: "bg-amber-50 text-amber-700 ring-amber-200",
  已续证: "bg-blue-50 text-blue-700 ring-blue-200",
  已续证归档: "bg-blue-50 text-blue-700 ring-blue-200",
  已作废: "bg-slate-100 text-slate-600 ring-slate-200",
  资质有效: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  存在临期资质: "bg-amber-50 text-amber-700 ring-amber-200",
  存在过期资质: "bg-rose-50 text-rose-700 ring-rose-200",
  未登记资质: "bg-slate-100 text-slate-700 ring-slate-200",
  年度复评到期: "bg-amber-50 text-amber-700 ring-amber-200",
  尚未年度复评: "bg-rose-50 text-rose-700 ring-rose-200",
  低风险: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  观察风险: "bg-amber-50 text-amber-700 ring-amber-200",
  高风险: "bg-rose-50 text-rose-700 ring-rose-200",
  待发料: "bg-amber-50 text-amber-700 ring-amber-200",
  已批准: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  已发料: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  pending_disposition: "bg-amber-50 text-amber-700 ring-amber-200",
  ready_for_review: "bg-blue-50 text-blue-700 ring-blue-200",
  tracking: "bg-blue-50 text-blue-700 ring-blue-200",
  scheduled: "bg-blue-50 text-blue-700 ring-blue-200",
  requisitioned: "bg-blue-50 text-blue-700 ring-blue-200",
  issued: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  submitted: "bg-blue-50 text-blue-700 ring-blue-200",
  reinspection_requested: "bg-blue-50 text-blue-700 ring-blue-200",
  reinspection_failed: "bg-rose-50 text-rose-700 ring-rose-200",
  instructed: "bg-amber-50 text-amber-700 ring-amber-200",
  material_requested: "bg-amber-50 text-amber-700 ring-amber-200",
  producing: "bg-blue-50 text-blue-700 ring-blue-200",
  inspection_requested: "bg-amber-50 text-amber-700 ring-amber-200",
  qa_approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  qa_failed: "bg-rose-50 text-rose-700 ring-rose-200",
  in_stock: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  inspected: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  inbounded: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  qualified: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  concession: "bg-amber-50 text-amber-700 ring-amber-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  accepted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  discount_accept: "bg-blue-50 text-blue-700 ring-blue-200",
  special_accept: "bg-amber-50 text-amber-700 ring-amber-200",
  rejected_return: "bg-rose-50 text-rose-700 ring-rose-200",
  normal: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  stale_warning: "bg-amber-50 text-amber-700 ring-amber-200",
  overstock: "bg-rose-50 text-rose-700 ring-rose-200",
  substitute: "bg-blue-50 text-blue-700 ring-blue-200",
  finished: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  transition: "bg-amber-50 text-amber-700 ring-amber-200",
  available: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  closed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  已提交: "bg-blue-50 text-blue-700 ring-blue-200",
  已下发: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  已转复检: "bg-blue-50 text-blue-700 ring-blue-200",
  复检未通过: "bg-rose-50 text-rose-700 ring-rose-200",
  已向供应商下单: "bg-blue-50 text-blue-700 ring-blue-200",
  供应商已确认: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  待仓库签收: "bg-amber-50 text-amber-700 ring-amber-200",
  仓库已签收: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  已请检: "bg-blue-50 text-blue-700 ring-blue-200",
  已入库: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  已退货: "bg-rose-50 text-rose-700 ring-rose-200",
  返工返修: "bg-amber-50 text-amber-700 ring-amber-200",
  报废处理: "bg-rose-50 text-rose-700 ring-rose-200",
  技术让步放行: "bg-blue-50 text-blue-700 ring-blue-200",
  工艺调整复检: "bg-violet-50 text-violet-700 ring-violet-200",
  待处理: "bg-amber-50 text-amber-700 ring-amber-200",
  跟进中: "bg-blue-50 text-blue-700 ring-blue-200",
  已关闭: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  待整改: "bg-amber-50 text-amber-700 ring-amber-200",
  待复核: "bg-blue-50 text-blue-700 ring-blue-200",
  复核驳回: "bg-rose-50 text-rose-700 ring-rose-200",
  复核通过: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  提交复核: "bg-blue-50 text-blue-700 ring-blue-200",
  未生成: "bg-slate-100 text-slate-600 ring-slate-200",
  未读: "bg-blue-50 text-blue-700 ring-blue-200",
  已读: "bg-slate-100 text-slate-700 ring-slate-200",
  已忽略: "bg-slate-100 text-slate-500 ring-slate-200",
  已处理: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  通过: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  关注: "bg-amber-50 text-amber-700 ring-amber-200",
  阻断: "bg-red-50 text-red-700 ring-red-200",
  具备上线条件: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  存在关注项: "bg-amber-50 text-amber-700 ring-amber-200",
  存在上线阻断项: "bg-red-50 text-red-700 ring-red-200",
  启用: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  停用: "bg-slate-100 text-slate-600 ring-slate-200",
  高: "bg-rose-50 text-rose-700 ring-rose-200",
  中: "bg-amber-50 text-amber-700 ring-amber-200",
  低: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  紧急: "bg-red-50 text-red-700 ring-red-200",
  critical: "bg-red-50 text-red-700 ring-red-200",
  high: "bg-rose-50 text-rose-700 ring-rose-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  exception: "bg-rose-50 text-rose-700 ring-rose-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  empty: "bg-slate-100 text-slate-600 ring-slate-200",
  存在异常: "bg-rose-50 text-rose-700 ring-rose-200",
  待推进: "bg-amber-50 text-amber-700 ring-amber-200",
  已流转: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  暂无数据: "bg-slate-100 text-slate-600 ring-slate-200",
  计划晚于交期: "bg-rose-50 text-rose-700 ring-rose-200",
  逾期未排产: "bg-rose-50 text-rose-700 ring-rose-200",
  临期未排产: "bg-amber-50 text-amber-700 ring-amber-200",
  临期未完成: "bg-amber-50 text-amber-700 ring-amber-200",
  超负荷: "bg-rose-50 text-rose-700 ring-rose-200",
  空闲: "bg-blue-50 text-blue-700 ring-blue-200",
};

function formatCurrency(value: unknown) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatQty(value: unknown, unit?: unknown) {
  return `${Number(value ?? 0).toLocaleString("zh-CN", {
    maximumFractionDigits: 3,
  })}${unit ? ` ${String(unit)}` : ""}`;
}

function shortDate(value: unknown) {
  if (!value) return "-";
  return String(value).slice(0, 10);
}

function formatBytes(value: unknown) {
  const bytes = Number(value ?? 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function downloadTypeForAction(action: string) {
  const map: Record<string, string> = {
    downloadLedger: "ledger",
    downloadDeliveryNote: "delivery-note",
    downloadSalesStatement: "sales-statement",
    downloadPurchaseStatement: "purchase-statement",
    downloadDailyReport: "business-daily",
    downloadMonthlyReport: "business-monthly",
    downloadOverstockReport: "inventory-overstock",
  };
  return map[action];
}

function downloadExport(actorId: string, type: string, entityId?: unknown, format = "xlsx", filters?: Partial<ReportFilterState>) {
  const params = new URLSearchParams({
    actorId,
    type,
    format,
  });
  if (entityId) params.set("entityId", String(entityId));
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      const text = String(value ?? "").trim();
      if (text) params.set(key, text);
    });
  }
  window.location.href = `/api/export?${params.toString()}`;
}

function downloadBackup(actorId: string) {
  window.location.href = `/api/backup?actorId=${encodeURIComponent(actorId)}`;
}

function averageYield(inspections: Row[]) {
  const values = inspections
    .map((inspection) => Number(inspection.yield_rate ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function alertActionPayload(alert: Row, actorId: string) {
  const action = String(alert.action ?? "");
  if (action === "recordReceivableReceipt") {
    return {
      amount: String(alert.balance_amount ?? ""),
      method: "银行转账",
      received_at: new Date().toISOString().slice(0, 10),
      note: "经营预警中心登记回款",
    };
  }
  if (action === "recordInventoryAgingDisposition") {
    return {
      owner_id: actorId,
      status: "tracking",
      action_plan: "经营预警中心登记跟进：核查订单需求、替代消耗、退换货或报废处理方案。",
      note: String(alert.detail ?? ""),
    };
  }
  if (action === "updateProductionSchedule") {
    return {
      planned_date: String(alert.planned_date || alert.due_date || new Date().toISOString().slice(0, 10)),
      machine: String(alert.machine || "待定机台"),
      owner: String(alert.owner || "待定负责人"),
      shift: "白班",
      schedule_note: "经营预警中心触发：生产计划存在交期风险，需要生产主管复核调整。",
      change_reason: String(alert.detail ?? "生产交期预警触发排产调整。"),
    };
  }
  if (action === "approveMaterialRequisition" || action === "approveStocktake" || action === "approveApproval") {
    return {
      approval_note: "经营预警中心快速处理：同意按当前业务流程继续推进。",
    };
  }
  return undefined;
}

export function ErpApp() {
  const [actorId, setActorId] = useState("");
  const [activeModule, setActiveModule] = useState<ModuleKey>("overview");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("正在加载本地数据");
  const [error, setError] = useState("");
  const [loginForm, setLoginForm] = useState({ account: "admin", password: "admin123" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentUser = snapshot?.currentUser;
  const CurrentIcon = currentUser ? roleIcon[currentUser.role] ?? LogIn : LogIn;
  const activeNav = navItems.find((item) => item.key === activeModule) ?? navItems[0];

  const load = async (nextActorId = actorId) => {
    setLoading(true);
    setError("");
    const query = nextActorId ? `?actorId=${encodeURIComponent(nextActorId)}` : "";
    const response = await fetch(`/api/snapshot${query}`, {
      cache: "no-store",
    });
    const data = (await response.json()) as Snapshot | { error: string };
    if (!response.ok || "error" in data) {
      setError("error" in data ? data.error : "读取失败");
      setSnapshot(null);
      setLoading(false);
      return;
    }
    setSnapshot(data);
    setActorId(data.currentUser.id);
    setMessage("数据已同步");
    setLoading(false);
  };

  useEffect(() => {
    void load("");
  }, []);

  const login = async () => {
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginForm),
    });
    const data = (await response.json()) as Snapshot | { error: string };
    if (!response.ok || "error" in data) {
      setError("error" in data ? data.error : "登录失败");
      setLoading(false);
      return;
    }
    setSnapshot(data);
    setActorId(data.currentUser.id);
    setMessage("登录成功，数据已同步");
    setLoading(false);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSnapshot(null);
    setActorId("");
    setActiveModule("overview");
    setMessage("已退出登录");
    setError("");
  };

  const runAction = async (task: ActionRequest) => {
    if (!task.action) return;

    if (task.action === "downloadBackup") {
      window.location.href = `/api/backup?actorId=${encodeURIComponent(actorId)}`;
      void load(actorId);
      return;
    }

    if (task.action === "downloadFinance") {
      window.location.href = `/api/export?actorId=${encodeURIComponent(actorId)}&type=finance&format=xlsx`;
      return;
    }

    const downloadType = downloadTypeForAction(task.action);
    if (downloadType) {
      const entity = task.entityId ? `&entityId=${encodeURIComponent(task.entityId)}` : "";
      window.location.href = `/api/export?actorId=${encodeURIComponent(actorId)}&type=${downloadType}&format=xlsx${entity}`;
      void load(actorId);
      return;
    }

    setBusy(`${task.action}-${task.entityId ?? "system"}-${task.variant ?? "primary"}`);
    setError("");
    const response = await fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorId,
        action: task.action,
        entityId: task.entityId,
        variant: task.variant,
        payload: task.payload,
      }),
    });
    const data = (await response.json()) as Snapshot | { error: string };
    if (!response.ok || "error" in data) {
      setError("error" in data ? data.error : "操作失败");
    } else {
      setSnapshot(data);
      setMessage("操作完成，库存与看板已刷新");
    }
    setBusy(null);
  };

  const uploadBom = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("请选择 BOM Excel 文件。");
      return;
    }
    setBusy("bom-import");
    setError("");
    const form = new FormData();
    form.append("actorId", actorId);
    form.append("productId", "P-FINISHED");
    form.append("file", file);
    const response = await fetch("/api/bom/import", { method: "POST", body: form });
    const data = (await response.json()) as { ok?: boolean; importedRows?: number; error?: string };
    if (!response.ok || data.error) {
      setError(data.error ?? "BOM 导入失败");
    } else {
      setMessage(`BOM 已导入 ${data.importedRows ?? 0} 行`);
      await load(actorId);
    }
    setBusy(null);
  };

  const lifecycleRows = useMemo(() => {
    if (!snapshot) return [];
    return [
      { name: "报价单", rows: snapshot.board.quotes, label: "quote_no", status: "status_label" },
      { name: "客户订单", rows: snapshot.board.orders, label: "order_no", status: "status_label" },
      { name: "生产单", rows: snapshot.board.productions, label: "prod_no", status: "status_label" },
      { name: "采购单", rows: snapshot.board.purchaseOrders, label: "purchase_no", status: "status" },
      { name: "领料单", rows: snapshot.board.requisitions, label: "req_no", status: "status" },
      { name: "请验单", rows: snapshot.board.inspections, label: "inspection_no", status: "status" },
      { name: "发货单", rows: snapshot.board.shipments, label: "shipment_no", status: "status" },
      { name: "应收", rows: snapshot.board.receivables, label: "receivable_no", status: "status" },
      { name: "应付", rows: snapshot.board.payables, label: "payable_no", status: "status" },
    ];
  }, [snapshot]);

  if (loading && !snapshot) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100">
        <div className="rounded-lg border border-slate-200 bg-white px-8 py-6 shadow-sm">
          <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
            <Gauge className="h-5 w-5 animate-pulse text-blue-600" />
            {message}
          </div>
        </div>
      </main>
    );
  }

  if (!snapshot) {
    return <LoginScreen error={error} form={loginForm} loading={loading} setForm={setLoginForm} onLogin={login} />;
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen min-w-0">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-[#111827] text-white lg:flex lg:flex-col">
          <div className="border-b border-white/10 px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-md bg-blue-600">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">Local ERP</div>
                <div className="text-xs text-slate-400">Production Flow Suite</div>
              </div>
            </div>
          </div>
          <nav className="space-y-1 px-3 py-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.key === activeModule;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setActiveModule(item.key)}
                  className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm transition ${
                    active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-white/10 px-5 py-4 text-xs leading-6 text-slate-400">
            <div className="truncate">数据盘：{snapshot.dataRoot}</div>
            <div>最近备份：{snapshot.storage.latestBackup}</div>
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-x-hidden">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="flex min-h-16 flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between xl:px-6">
              <div className="flex min-w-0 items-center gap-4">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-blue-50 text-blue-700 lg:hidden">
                  <Boxes className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold text-slate-950">{activeNav.title}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <CurrentIcon className="h-3.5 w-3.5 text-blue-600" />
                    <span>{currentUser?.name}</span>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{activeNav.subtitle}</span>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{message}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 md:w-64">
                  <Search className="h-4 w-4 shrink-0" />
                  <span className="truncate">搜索单据 / 客户 / 物料</span>
                </div>
                <div className="scrollbar-thin flex max-w-full gap-2 overflow-x-auto lg:hidden">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const active = item.key === activeModule;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setActiveModule(item.key)}
                        className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${
                          active
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-600">
                  <CurrentIcon className="h-4 w-4 text-blue-600" />
                  <span className="font-semibold text-slate-800">{currentUser?.role_label}</span>
                  <span className="text-slate-300">/</span>
                  <span>{currentUser?.username}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                >
                  <LogIn className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            </div>
          </header>

          <div className="px-4 py-5 xl:px-6">
            {error ? (
              <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <ModuleHeader
              title={activeNav.title}
              subtitle={activeNav.subtitle}
              action={
                activeModule === "finance"
                  ? { label: "导出台账", onClick: () => downloadExport(actorId, "ledger") }
                  : activeModule === "approval" &&
                      ["manager", "admin", "purchasing", "production"].includes(snapshot.currentUser.role)
                    ? { label: "试算配方", onClick: () => void runAction({ action: "createFormulaCalculation" }) }
                  : activeModule === "archive"
                    ? { label: "冷备份", onClick: () => downloadBackup(actorId) }
                    : undefined
              }
            />

            {activeModule === "overview" ? (
              <OverviewModule
                snapshot={snapshot}
                currentUser={currentUser}
                busy={busy}
                fileInputRef={fileInputRef}
                lifecycleRows={lifecycleRows}
                runAction={runAction}
                uploadBom={uploadBom}
                actorId={actorId}
              />
            ) : null}
            {activeModule === "process" ? <ProcessCockpitModule snapshot={snapshot} onOpenModule={setActiveModule} /> : null}
            {activeModule === "master" ? (
              <MasterDataModule
                snapshot={snapshot}
                actorId={actorId}
                busy={busy}
                runAction={runAction}
                openDetail={setDetail}
                onImported={(nextSnapshot) => {
                  if (nextSnapshot) {
                    setSnapshot(nextSnapshot);
                    setMessage("主数据已导入，台账已刷新");
                    return;
                  }
                  void load(actorId);
                }}
              />
            ) : null}
            {activeModule === "sales" ? (
              <SalesModule
                snapshot={snapshot}
                actorId={actorId}
                busy={busy}
                runAction={runAction}
                openDetail={setDetail}
                onSnapshot={setSnapshot}
                onError={setError}
              />
            ) : null}
            {activeModule === "production" ? (
              <ProductionModule
                snapshot={snapshot}
                currentUser={currentUser}
                busy={busy}
                runAction={runAction}
                fileInputRef={fileInputRef}
                uploadBom={uploadBom}
                openDetail={setDetail}
              />
            ) : null}
            {activeModule === "inventory" ? (
              <InventoryModule
                snapshot={snapshot}
                actorId={actorId}
                busy={busy}
                runAction={runAction}
                openDetail={setDetail}
                onSnapshot={setSnapshot}
                onError={setError}
              />
            ) : null}
            {activeModule === "quality" ? (
              <QualityModule
                snapshot={snapshot}
                currentUser={currentUser}
                busy={busy}
                runAction={runAction}
                openDetail={setDetail}
              />
            ) : null}
            {activeModule === "finance" ? (
              <FinanceModule
                snapshot={snapshot}
                actorId={actorId}
                busy={busy}
                runAction={runAction}
                openDetail={setDetail}
              />
            ) : null}
            {activeModule === "reports" ? (
              <ReportsModule snapshot={snapshot} actorId={actorId} openDetail={setDetail} />
            ) : null}
            {activeModule === "approval" ? (
              <ApprovalFormulaModule
                snapshot={snapshot}
                actorId={actorId}
                busy={busy}
                runAction={runAction}
                openDetail={setDetail}
              />
            ) : null}
            {activeModule === "archive" ? (
              <ArchiveModule
                snapshot={snapshot}
                actorId={actorId}
                onSnapshot={(next) => {
                  setSnapshot(next);
                  setMessage("附件已归档，数据盘与审计记录已刷新");
                }}
                onError={setError}
              />
            ) : null}
            {activeModule === "system" ? (
              <SystemModule
                snapshot={snapshot}
                actorId={actorId}
                busy={busy}
                runAction={runAction}
                openDetail={setDetail}
                onSnapshot={(next) => {
                  setSnapshot(next);
                  setMessage("整改复核附件已归档，整改台账已刷新");
                }}
                onError={setError}
              />
            ) : null}
          </div>
        </section>
      </div>
      <DetailModal detail={detail} onClose={() => setDetail(null)} />
    </main>
  );
}

function LoginScreen({
  error,
  form,
  loading,
  setForm,
  onLogin,
}: {
  error: string;
  form: { account: string; password: string };
  loading: boolean;
  setForm: React.Dispatch<React.SetStateAction<{ account: string; password: string }>>;
  onLogin: () => Promise<void>;
}) {
  return (
    <main className="min-h-screen bg-[#f4f7fb] px-6 py-10 text-slate-900">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.1fr_420px]">
        <section className="space-y-8">
          <div className="inline-flex items-center gap-3 rounded-md border border-blue-100 bg-white px-4 py-3 text-sm font-semibold text-blue-700 shadow-sm">
            <ShieldCheck className="h-5 w-5" />
            本地私有化生产流转 ERP
          </div>
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-normal text-slate-950">企业级账号登录与权限控制</h1>
            <p className="mt-5 text-base leading-8 text-slate-600">
              员工使用个人账号进入系统，系统按角色控制菜单、按钮、导出与审批权限，所有关键操作写入审计日志。
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">部署方式</div>
              <div className="mt-2 text-lg font-semibold text-slate-950">局域网本地化</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">权限体系</div>
              <div className="mt-2 text-lg font-semibold text-slate-950">RBAC 角色权限</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">操作追溯</div>
              <div className="mt-2 text-lg font-semibold text-slate-950">全流程审计</div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-slate-950">登录系统</h2>
            <p className="mt-2 text-sm text-slate-500">功能确认账号示例：admin / admin123</p>
          </div>
          {error ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              账号
              <input
                value={form.account}
                onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))}
                className="mt-2 h-11 w-full rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="请输入账号"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              密码
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onLogin();
                }}
                className="mt-2 h-11 w-full rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="请输入密码"
              />
            </label>
            <button
              type="button"
              onClick={() => void onLogin()}
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              <LogIn className="h-4 w-4" />
              {loading ? "正在登录" : "登录"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function ProcessCockpitModule({
  snapshot,
  onOpenModule,
}: {
  snapshot: Snapshot;
  onOpenModule: (module: ModuleKey) => void;
}) {
  const rows = snapshot.board.processFlow ?? [];
  const summary = snapshot.board.processFlowSummary ?? {};
  const departments = Array.from(new Set(rows.map((row) => String(row.department ?? "未分组"))));
  const criticalRows = rows.filter((row) => Number(row.exception_count ?? 0) > 0 || Number(row.pending_count ?? 0) > 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-5">
        <MiniMetric label="流程节点" value={`${Number(summary.node_count ?? rows.length)} 个`} />
        <MiniMetric label="待推进" value={`${Number(summary.pending_total ?? 0)} 项`} />
        <MiniMetric label="异常节点" value={`${Number(summary.exception_total ?? 0)} 项`} />
        <MiniMetric label="已完成节点" value={`${Number(summary.completed_node_count ?? 0)} 个`} />
        <MiniMetric label="流程健康度" value={`${Number(summary.health_rate ?? 100).toFixed(2)}%`} />
      </div>

      <Panel title="订单主线流程驾驶舱" icon={ArrowRight} action="按客户流程图落地">
        <div className="grid gap-3 xl:grid-cols-11">
          {rows.map((row) => (
            <button
              key={String(row.key)}
              type="button"
              onClick={() => onOpenModule(String(row.target_module ?? "overview") as ModuleKey)}
              className={`group flex min-h-[170px] min-w-0 flex-col rounded-md border p-3 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md ${processNodeClass(String(row.status))}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                  {String(row.sequence)}
                </span>
                <StatusBadge value={String(row.status_label)} />
              </div>
              <div className="mt-3 min-w-0">
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-950">{String(row.title)}</p>
                <p className="mt-1 text-xs font-medium text-slate-500">{String(row.department)}</p>
              </div>
              <p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-600">{String(row.description)}</p>
              <div className="mt-auto grid grid-cols-3 gap-2 pt-3 text-center text-xs">
                <ProcessCount label="待" value={row.pending_count} />
                <ProcessCount label="成" value={row.done_count} />
                <ProcessCount label="异" value={row.exception_count} />
              </div>
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <DataTable
          title="流程节点明细"
          icon={ClipboardList}
          rows={rows}
          columns={[
            { key: "sequence", label: "序号" },
            { key: "title", label: "节点" },
            { key: "department", label: "责任部门" },
            { key: "primary_metric", label: "主口径" },
            { key: "total_count", label: "总数" },
            { key: "pending_count", label: "待推进" },
            { key: "done_count", label: "已完成" },
            { key: "exception_count", label: "异常" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "target_module",
              label: "入口",
              render: (value) => (
                <InlineActionButton label="进入" onClick={() => onOpenModule(String(value ?? "overview") as ModuleKey)} />
              ),
            },
          ]}
        />

        <Panel title="部门责任分布" icon={Factory} action="按流程节点归集">
          <div className="space-y-3">
            {departments.map((department) => {
              const group = rows.filter((row) => String(row.department ?? "未分组") === department);
              const pending = group.reduce((sum, row) => sum + Number(row.pending_count ?? 0), 0);
              const exception = group.reduce((sum, row) => sum + Number(row.exception_count ?? 0), 0);
              return (
                <div key={department} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-950">{department}</p>
                    <StatusBadge value={exception > 0 ? "存在异常" : pending > 0 ? "待推进" : "已流转"} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
                    <span>节点 {group.length}</span>
                    <span>待推进 {pending}</span>
                    <span>异常 {exception}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <DataTable
        title="待推进与异常关注"
        icon={AlertTriangle}
        rows={criticalRows}
        columns={[
          { key: "title", label: "流程节点" },
          { key: "department", label: "责任部门" },
          { key: "pending_count", label: "待推进" },
          { key: "exception_count", label: "异常" },
          { key: "description", label: "业务说明" },
          {
            key: "target_module",
            label: "处理入口",
            render: (value) => (
              <InlineActionButton label="处理" onClick={() => onOpenModule(String(value ?? "overview") as ModuleKey)} />
            ),
          },
        ]}
      />
    </div>
  );
}

function ProcessCount({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-sm border border-white/70 bg-white/80 px-2 py-1">
      <div className="font-semibold text-slate-900">{Number(value ?? 0)}</div>
      <div className="mt-0.5 text-slate-500">{label}</div>
    </div>
  );
}

function processNodeClass(status: string) {
  if (status === "exception") return "border-rose-200 bg-rose-50/70";
  if (status === "pending") return "border-amber-200 bg-amber-50/70";
  if (status === "completed") return "border-emerald-200 bg-emerald-50/70";
  return "border-slate-200 bg-slate-50";
}

function SystemModule({
  snapshot,
  actorId,
  busy,
  runAction,
  openDetail,
  onSnapshot,
  onError,
}: {
  snapshot: Snapshot;
  actorId: string;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
  openDetail: (detail: DetailState) => void;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (message: string) => void;
}) {
  const isAdmin = snapshot.currentUser.role === "admin";
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "Welcome@2026",
  });
  const firstSetting = snapshot.board.systemSettings[0];
  const [settingForm, setSettingForm] = useState({
    setting_key: String(firstSetting?.setting_key ?? "backup_frequency"),
    setting_value: String(firstSetting?.setting_value ?? "daily"),
    description: String(firstSetting?.description ?? ""),
  });
  const [settingImpactPreview, setSettingImpactPreview] = useState<Row | null>(null);
  const [settingImpactLoading, setSettingImpactLoading] = useState(false);
  const [settingImpactError, setSettingImpactError] = useState("");
  const firstVoidCandidate = snapshot.board.documentVoidCandidates[0];
  const [voidForm, setVoidForm] = useState({
    document_id: String(firstVoidCandidate?.document_id ?? ""),
    document_type: String(firstVoidCandidate?.document_type ?? "purchase_order"),
    reason: "业务录入有误，按正式作废流程关闭原单并重新开单。",
  });
  const firstReversalCandidate = snapshot.board.documentReversalCandidates[0];
  const [reversalForm, setReversalForm] = useState({
    document_id: String(firstReversalCandidate?.document_id ?? ""),
    document_type: String(firstReversalCandidate?.document_type ?? "purchase_order"),
    reason: "原业务单据需要按正式冲销流程处理，同步生成库存反向流水和财务红冲记录。",
  });
  const remediationAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const firstRemediation = snapshot.board.systemHealthRemediations.find((item) => String(item.status) !== "closed") ??
    snapshot.board.systemHealthRemediations[0];
  const [remediationAttachmentForm, setRemediationAttachmentForm] = useState({
    remediation_id: String(firstRemediation?.id ?? ""),
    note: "整改责任人提交复核凭证，供管理员关闭问题前核验。",
  });
  const [remediationAttachmentBusy, setRemediationAttachmentBusy] = useState(false);
  const [auditKeyword, setAuditKeyword] = useState("");
  const updatePasswordField = (key: string, value: string) =>
    setPasswordForm((current) => ({ ...current, [key]: value }));
  const updateSettingField = (key: string, value: string) =>
    setSettingForm((current) => ({ ...current, [key]: value }));
  const selectSetting = (settingKey: string) => {
    const setting = snapshot.board.systemSettings.find((item) => String(item.setting_key) === settingKey);
    setSettingForm({
      setting_key: settingKey,
      setting_value: String(setting?.setting_value ?? ""),
      description: String(setting?.description ?? ""),
    });
  };
  const selectVoidCandidate = (documentId: string) => {
    const candidate = snapshot.board.documentVoidCandidates.find((item) => String(item.document_id) === documentId);
    setVoidForm((current) => ({
      ...current,
      document_id: documentId,
      document_type: String(candidate?.document_type ?? current.document_type),
    }));
  };
  const updateVoidField = (key: string, value: string) =>
    setVoidForm((current) => ({ ...current, [key]: value }));
  const selectReversalCandidate = (documentId: string) => {
    const candidate = snapshot.board.documentReversalCandidates.find((item) => String(item.document_id) === documentId);
    setReversalForm((current) => ({
      ...current,
      document_id: documentId,
      document_type: String(candidate?.document_type ?? current.document_type),
    }));
  };
  const updateReversalField = (key: string, value: string) =>
    setReversalForm((current) => ({ ...current, [key]: value }));
  const updateRemediationAttachmentField = (key: string, value: string) =>
    setRemediationAttachmentForm((current) => ({ ...current, [key]: value }));
  const filteredAuditLogs = snapshot.board.auditLogs.filter((log) => {
    const keyword = auditKeyword.trim().toLowerCase();
    if (!keyword) return true;
    return [log.actor_name, log.action, log.entity_type, log.entity_id, log.message]
      .map((value) => String(value ?? "").toLowerCase())
      .some((value) => value.includes(keyword));
  });
  const highRiskPermissionCount = snapshot.security.permissionMatrix.reduce(
    (sum, row) => sum + Number(row.high_risk_count ?? 0),
    0,
  );
  const settingGroups = Array.from(new Set(snapshot.board.systemSettings.map((setting) => String(setting.category_label ?? "未分类"))));
  const canVoidDocument = snapshot.security.currentPermissions.includes("voidBusinessDocument");
  const canReverseDocument = snapshot.security.currentPermissions.includes("reverseBusinessDocument");
  const canCreateSystemHealthRemediation = snapshot.security.currentPermissions.includes("createSystemHealthRemediation");
  const canMarkSystemHealthRemediationReady = snapshot.security.currentPermissions.includes("markSystemHealthRemediationReady");
  const canRejectSystemHealthRemediationReview = snapshot.security.currentPermissions.includes("rejectSystemHealthRemediationReview");
  const canCloseSystemHealthRemediation = snapshot.security.currentPermissions.includes("closeSystemHealthRemediation");
  const operatingParameters = snapshot.board.operatingParameters ?? {};
  const systemHealthSummary = snapshot.board.systemHealthSummary ?? {};
  const settingImpactItems = Array.isArray(settingImpactPreview?.items) ? (settingImpactPreview.items as Row[]) : [];
  const selectedRemediation = snapshot.board.systemHealthRemediations.find(
    (item) => String(item.id) === remediationAttachmentForm.remediation_id,
  );
  const remediationAttachments = snapshot.board.documentAttachments.filter(
    (attachment) => String(attachment.entity_type) === "system_health_remediation",
  );
  const ownerRoleByModule: Record<string, string> = {
    主数据: "admin",
    采购仓储: "warehouse",
    生产执行: "production",
    质检收率: "quality",
    财务台账: "finance",
    审批算价: "manager",
    本地归档: "admin",
  };
  const ownerIdForHealthCheck = (check: Row) => {
    const role = ownerRoleByModule[String(check.target_module ?? "")] ?? "admin";
    return String(snapshot.users.find((user) => user.role === role && user.status === "active")?.id ?? snapshot.currentUser.id);
  };
  const submitRemediationAttachment = async () => {
    const file = remediationAttachmentInputRef.current?.files?.[0];
    const remediation = selectedRemediation;
    if (!remediation) {
      onError("请选择需要归档复核附件的整改单。");
      return;
    }
    if (!file) {
      onError("请选择整改复核附件文件。");
      return;
    }
    setRemediationAttachmentBusy(true);
    onError("");
    const form = new FormData();
    form.append("actorId", actorId);
    form.append("entityType", "system_health_remediation");
    form.append("entityId", String(remediation.id));
    form.append("entityNo", String(remediation.remediation_no));
    form.append("category", "整改复核附件");
    form.append("note", remediationAttachmentForm.note);
    form.append("file", file);
    const response = await fetch("/api/attachments", { method: "POST", body: form });
    const data = (await response.json()) as Snapshot | { error: string };
    if (!response.ok || "error" in data) {
      onError("error" in data ? data.error : "整改复核附件上传失败。");
    } else {
      if (remediationAttachmentInputRef.current) remediationAttachmentInputRef.current.value = "";
      onSnapshot(data);
    }
    setRemediationAttachmentBusy(false);
  };

  useEffect(() => {
    if (!snapshot.board.systemHealthRemediations.length) return;
    const exists = snapshot.board.systemHealthRemediations.some((item) => String(item.id) === remediationAttachmentForm.remediation_id);
    if (!exists) {
      const next = snapshot.board.systemHealthRemediations.find((item) => String(item.status) !== "closed") ??
        snapshot.board.systemHealthRemediations[0];
      setRemediationAttachmentForm((current) => ({ ...current, remediation_id: String(next.id ?? "") }));
    }
  }, [remediationAttachmentForm.remediation_id, snapshot.board.systemHealthRemediations]);

  useEffect(() => {
    if (!isAdmin || !settingForm.setting_key || !settingForm.setting_value) {
      setSettingImpactPreview(null);
      setSettingImpactError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSettingImpactLoading(true);
      setSettingImpactError("");
      const query = new URLSearchParams({
        actorId: String(snapshot.currentUser.id),
        settingKey: settingForm.setting_key,
        settingValue: settingForm.setting_value,
      });
      fetch(`/api/system-settings/impact?${query.toString()}`, { cache: "no-store" })
        .then(async (response) => {
          const data = (await response.json()) as Row | { error: string };
          if (!response.ok || "error" in data) throw new Error("error" in data ? String(data.error) : "参数影响预览失败");
          if (!cancelled) setSettingImpactPreview(data);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSettingImpactPreview(null);
            setSettingImpactError(error instanceof Error ? error.message : "参数影响预览失败");
          }
        })
        .finally(() => {
          if (!cancelled) setSettingImpactLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isAdmin, settingForm.setting_key, settingForm.setting_value, snapshot.currentUser.id]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-5">
        <MiniMetric label="系统账号" value={`${snapshot.users.length} 个`} />
        <MiniMetric label="启用账号" value={`${snapshot.users.filter((user) => user.status === "active").length} 个`} />
        <MiniMetric label="当前权限" value={`${snapshot.security.currentPermissions.length} 项`} />
        <MiniMetric label="高风险权限" value={`${highRiskPermissionCount} 项`} />
        <MiniMetric label="审计日志" value={`${snapshot.board.auditLogs.length} 条`} />
      </div>
      <Panel title="正式上线自检" icon={ShieldCheck} action={String(systemHealthSummary.status_label ?? "上线检查")}>
        <div className="grid gap-3 md:grid-cols-5">
          <MiniMetric label="上线健康分" value={`${Number(systemHealthSummary.score ?? 100).toFixed(0)} 分`} />
          <MiniMetric label="阻断项" value={`${Number(systemHealthSummary.critical_count ?? 0)} 项`} />
          <MiniMetric label="关注项" value={`${Number(systemHealthSummary.warning_count ?? 0)} 项`} />
          <MiniMetric label="待整改任务" value={`${Number(systemHealthSummary.open_remediation_count ?? 0)} 项`} />
          <MiniMetric label="已关闭整改" value={`${Number(systemHealthSummary.closed_remediation_count ?? 0)} 项`} />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-3 py-2">等级</th>
                <th className="px-3 py-2">检查项</th>
                <th className="px-3 py-2">分类</th>
                <th className="px-3 py-2">数量</th>
                <th className="px-3 py-2">处理建议</th>
                <th className="px-3 py-2">整改状态</th>
                <th className="px-3 py-2">样例</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {snapshot.board.systemHealthChecks.slice(0, 8).map((check) => {
                const count = Number(check.count ?? 0);
                const remediationId = String(check.remediation_id ?? "");
                const remediationStatus = String(check.remediation_status ?? "none");
                const canCreate =
                  canCreateSystemHealthRemediation &&
                  count > 0 &&
                  (!remediationId || remediationStatus === "closed");
                const canClose = canCloseSystemHealthRemediation && remediationId && remediationStatus !== "closed";
                return (
                  <tr key={String(check.id)} className="bg-white">
                    <td className="px-3 py-2"><StatusBadge value={String(check.status_label ?? check.status)} /></td>
                    <td className="max-w-[220px] px-3 py-2 font-semibold text-slate-800">{String(check.title)}</td>
                    <td className="px-3 py-2 text-slate-500">{String(check.category)}</td>
                    <td className="px-3 py-2 text-slate-700">{count}</td>
                    <td className="px-3 py-2 text-slate-600">{String(check.action_label ?? "-")}</td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <StatusBadge value={String(check.remediation_status_label ?? "未生成")} />
                        {check.remediation_owner_name ? (
                          <p className="text-[11px] text-slate-500">{String(check.remediation_owner_name)}</p>
                        ) : null}
                      </div>
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-slate-500">
                      {Array.isArray(check.sample_entities) && check.sample_entities.length
                        ? check.sample_entities.map(String).join("、")
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {canCreate ? (
                          <button
                            type="button"
                            disabled={busy === `createSystemHealthRemediation-${String(check.key)}-primary`}
                            onClick={() =>
                              runAction({
                                action: "createSystemHealthRemediation",
                                entityId: String(check.key),
                                payload: {
                                  owner_id: ownerIdForHealthCheck(check),
                                  action_plan: `${String(check.action_label ?? "处理问题")}：${String(check.title ?? "")}`,
                                },
                              })
                            }
                            className="inline-flex h-8 items-center rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            生成整改
                          </button>
                        ) : null}
                        {canClose ? (
                          <button
                            type="button"
                            disabled={busy === `closeSystemHealthRemediation-${remediationId}-primary`}
                            onClick={() =>
                              runAction({
                                action: "closeSystemHealthRemediation",
                                entityId: remediationId,
                                payload: { result_note: `${String(check.title ?? "上线问题")} 已按上线整改流程确认关闭。` },
                              })
                            }
                            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            关闭
                          </button>
                        ) : null}
                        {!canCreate && !canClose ? <span className="text-xs text-slate-400">-</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <DataTable
        title="上线整改任务"
        icon={FileCheck2}
        rows={snapshot.board.systemHealthRemediations}
        columns={[
          { key: "remediation_no", label: "整改单号" },
          { key: "title", label: "问题事项" },
          { key: "category", label: "分类" },
          { key: "severity_label", label: "等级", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "owner_name", label: "责任人" },
          { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          {
            key: "due_date",
            label: "到期日",
            render: (value, row) => (
              <span className={row.is_overdue && String(row.status) !== "closed" ? "font-semibold text-rose-700" : ""}>
                {shortDate(value)}
              </span>
            ),
          },
          { key: "review_attachment_count", label: "复核附件" },
          { key: "action_plan", label: "整改计划" },
          { key: "review_note", label: "复核说明" },
          { key: "latest_review_note", label: "最新复核意见" },
          { key: "result_note", label: "关闭结果" },
          { key: "created_at", label: "创建时间", render: shortDate },
          {
            key: "operation",
            label: "操作",
            render: (_, row) => {
              const isOwner = String(row.owner_id) === String(snapshot.currentUser.id);
              const canSubmit =
                canMarkSystemHealthRemediationReady &&
                ["pending", "rejected"].includes(String(row.status)) &&
                (isOwner || snapshot.currentUser.role === "admin" || snapshot.currentUser.role === "manager");
              const canReject = canRejectSystemHealthRemediationReview && String(row.status) === "ready_for_review";
              const canClose = canCloseSystemHealthRemediation && String(row.status) !== "closed";
              return (
                <div className="flex items-center gap-2">
                  {canSubmit ? (
                    <button
                      type="button"
                      disabled={busy === `markSystemHealthRemediationReady-${String(row.id)}-primary`}
                      onClick={() =>
                        runAction({
                          action: "markSystemHealthRemediationReady",
                          entityId: String(row.id),
                          payload: { review_note: "整改责任人已处理并提交复核，复核附件见归档记录。" },
                        })
                      }
                      className="inline-flex h-8 items-center rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {String(row.status) === "rejected" ? "重新提交" : "提交复核"}
                    </button>
                  ) : null}
                  {canReject ? (
                    <button
                      type="button"
                      disabled={busy === `rejectSystemHealthRemediationReview-${String(row.id)}-primary`}
                      onClick={() =>
                        runAction({
                          action: "rejectSystemHealthRemediationReview",
                          entityId: String(row.id),
                          payload: { review_note: "复核未通过，请补充整改附件或处理说明后重新提交。" },
                        })
                      }
                      className="inline-flex h-8 items-center rounded-md border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      驳回复改
                    </button>
                  ) : null}
                  {canClose ? (
                    <button
                      type="button"
                      disabled={busy === `closeSystemHealthRemediation-${String(row.id)}-primary`}
                      onClick={() =>
                        runAction({
                          action: "closeSystemHealthRemediation",
                          entityId: String(row.id),
                          payload: { result_note: "整改责任人已处理，管理员确认关闭。" },
                        })
                      }
                      className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      关闭整改
                    </button>
                  ) : null}
                  {!canSubmit && !canReject && !canClose ? <span className="text-xs text-slate-400">-</span> : null}
                </div>
              );
            },
          },
        ]}
      />
      <DataTable
        title="整改复核记录"
        icon={ShieldCheck}
        rows={snapshot.board.systemHealthRemediationReviews}
        columns={[
          { key: "remediation_no", label: "整改单号" },
          { key: "remediation_title", label: "整改事项" },
          { key: "decision_label", label: "复核动作", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "review_note", label: "复核意见" },
          { key: "reviewer_name", label: "操作人" },
          { key: "reviewed_at", label: "时间", render: shortDate },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="整改复核附件" icon={Upload} action="责任人凭证">
          <div className="grid gap-3">
            <MasterSelect
              label="关联整改单"
              value={remediationAttachmentForm.remediation_id}
              onChange={(value) => updateRemediationAttachmentField("remediation_id", value)}
            >
              {snapshot.board.systemHealthRemediations.map((remediation) => (
                <option key={String(remediation.id)} value={String(remediation.id)}>
                  {String(remediation.remediation_no)} / {String(remediation.status_label)}
                </option>
              ))}
            </MasterSelect>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              复核附件
              <input
                ref={remediationAttachmentInputRef}
                type="file"
                className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700"
              />
            </label>
            <MasterTextarea
              label="附件说明"
              value={remediationAttachmentForm.note}
              onChange={(value) => updateRemediationAttachmentField("note", value)}
            />
            <button
              type="button"
              disabled={remediationAttachmentBusy || !selectedRemediation}
              onClick={() => void submitRemediationAttachment()}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {remediationAttachmentBusy ? "上传中" : "上传复核附件"}
            </button>
          </div>
        </Panel>
        <DataTable
          title="整改复核附件台账"
          icon={FileCheck2}
          rows={remediationAttachments}
          columns={[
            { key: "attachment_no", label: "附件编号" },
            { key: "entity_no", label: "整改单号" },
            { key: "category", label: "分类" },
            { key: "file_name", label: "文件名" },
            { key: "size_label", label: "大小" },
            { key: "uploaded_by_name", label: "上传人" },
            { key: "uploaded_at", label: "上传时间", render: shortDate },
            {
              key: "download",
              label: "下载",
              render: (_value, row) => (
                <InlineActionButton
                  label="下载"
                  onClick={() => {
                    window.location.href = `/api/attachments?actorId=${encodeURIComponent(actorId)}&id=${encodeURIComponent(String(row.id))}`;
                  }}
                />
              ),
            },
          ]}
        />
      </div>
      <Panel title="正式运行参数中心" icon={DatabaseBackup} action="库存 / 质量 / 财务 / 审批 / 归档">
        <div className="mb-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MiniMetric label="呆滞预警" value={`${operatingParameters.staleWarningDays ?? "-"} 天`} />
          <MiniMetric label="积压纳入" value={`${operatingParameters.overstockDays ?? "-"} 天`} />
          <MiniMetric label="收率预警线" value={`${operatingParameters.yieldWarningRate ?? "-"}%`} />
          <MiniMetric label="应收临期" value={`${operatingParameters.receivableDueWarningDays ?? "-"} 天`} />
          <MiniMetric label="应付临期" value={`${operatingParameters.payableDueWarningDays ?? "-"} 天`} />
          <MiniMetric label="采购审批阈值" value={formatCurrency(operatingParameters.purchaseApprovalThreshold)} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {settingGroups.map((category) => {
            const group = snapshot.board.systemSettings.filter((setting) => String(setting.category_label ?? "未分类") === category);
            return (
              <div key={category} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-950">{category}</p>
                  <span className="text-xs font-medium text-slate-500">{group.length} 项</span>
                </div>
                <div className="mt-3 space-y-2">
                  {group.slice(0, 3).map((setting) => (
                    <div key={String(setting.setting_key)} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-slate-500">{String(setting.setting_label)}</span>
                      <span className="shrink-0 font-semibold text-slate-900">{String(setting.setting_value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel title="修改本人密码" icon={ShieldCheck} action="会话安全">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <MasterInput
            label="当前密码"
            type="password"
            value={passwordForm.current_password}
            onChange={(value) => updatePasswordField("current_password", value)}
          />
          <MasterInput
            label="新密码"
            type="password"
            value={passwordForm.new_password}
            onChange={(value) => updatePasswordField("new_password", value)}
          />
          <MasterSubmitButton
            busy={busy === "changeOwnPassword-system-primary"}
            label="修改密码"
            onClick={() => runAction({ action: "changeOwnPassword", payload: passwordForm })}
          />
        </div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Panel title="系统参数维护" icon={DatabaseBackup} action={isAdmin ? "管理员配置" : "只读"}>
          {isAdmin ? (
            <div className="grid gap-3">
              <MasterSelect label="系统参数" value={settingForm.setting_key} onChange={selectSetting}>
                {snapshot.board.systemSettings.map((setting) => (
                  <option key={String(setting.setting_key)} value={String(setting.setting_key)}>
                    {String(setting.category_label)} / {String(setting.setting_label)}
                  </option>
                ))}
              </MasterSelect>
              <MasterInput
                label="参数值"
                value={settingForm.setting_value}
                onChange={(value) => updateSettingField("setting_value", value)}
              />
              <MasterTextarea
                label="参数说明"
                value={settingForm.description}
                onChange={(value) => updateSettingField("description", value)}
              />
              <MasterSubmitButton
                busy={busy === `upsertSystemSetting-${settingForm.setting_key}-primary`}
                label="保存参数"
                onClick={() =>
                  runAction({
                    action: "upsertSystemSetting",
                    entityId: settingForm.setting_key,
                    payload: {
                      setting_value: settingForm.setting_value,
                      description: settingForm.description,
                    },
                  })
                }
              />
              <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-950">保存前影响预览</p>
                  <StatusBadge
                    value={
                      settingImpactLoading
                        ? "计算中"
                        : settingImpactError
                          ? "需修正"
                          : String((settingImpactPreview?.summary as Row | undefined)?.risk_level ?? "low")
                    }
                  />
                </div>
                {settingImpactError ? (
                  <p className="mt-2 text-xs leading-5 text-rose-600">{settingImpactError}</p>
                ) : (
                  <>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      {settingImpactLoading
                        ? "正在根据当前业务数据计算影响范围..."
                        : String(settingImpactPreview?.summary_text ?? "调整参数前，系统会预估库存、质量、财务和审批口径变化。")}
                    </p>
                    <div className="mt-3 grid gap-2">
                      {settingImpactItems.map((item) => (
                        <div key={String(item.key)} className="rounded-md bg-white px-3 py-2 text-xs ring-1 ring-blue-100">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-slate-800">{String(item.label)}</span>
                            <span className="font-semibold text-blue-700">
                              {Number(item.current_count ?? 0)} → {Number(item.preview_count ?? 0)}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-slate-500">
                            <span>变化 {Number(item.delta ?? 0)}</span>
                            <span>影响 {Number(item.affected_count ?? 0)} 项</span>
                            {Array.isArray(item.sample_entities) && item.sample_entities.length ? (
                              <span>样例：{item.sample_entities.map(String).join("、")}</span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <EmptyText text="系统参数配置需使用系统管理员账号。" />
          )}
        </Panel>
        <div className="space-y-5">
          <DataTable
            title="系统参数台账"
            icon={DatabaseBackup}
            rows={snapshot.board.systemSettings}
            columns={[
              { key: "category_label", label: "分类" },
              { key: "setting_label", label: "参数" },
              { key: "setting_key", label: "编码" },
              { key: "setting_value", label: "当前值" },
              { key: "description", label: "说明" },
              { key: "updated_by_name", label: "更新人" },
              { key: "updated_at", label: "更新时间", render: shortDate },
            ]}
          />
          <DataTable
            title="参数生效记录"
            icon={FileCheck2}
            rows={snapshot.board.systemSettingEffects}
            columns={[
              { key: "setting_label", label: "参数" },
              { key: "old_value", label: "原值" },
              { key: "new_value", label: "新值" },
              { key: "summary_text", label: "影响摘要" },
              { key: "created_by_name", label: "操作人" },
              { key: "created_at", label: "生效时间", render: shortDate },
            ]}
          />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Panel title="单据作废中心" icon={FileCheck2} action={canVoidDocument ? "安全作废 / 留痕" : "只读"}>
          {canVoidDocument ? (
            <div className="grid gap-3">
              {snapshot.board.documentVoidCandidates.length === 0 ? (
                <EmptyText text="当前没有可直接作废的安全单据。已入库、已发料、已发货单据需走冲销流程。" />
              ) : (
                <>
                  <MasterSelect label="可作废单据" value={voidForm.document_id} onChange={selectVoidCandidate}>
                    {snapshot.board.documentVoidCandidates.map((candidate) => (
                      <option key={String(candidate.document_id)} value={String(candidate.document_id)}>
                        {String(candidate.document_type_label)} / {String(candidate.document_no)} / {String(candidate.original_status_label)}
                      </option>
                    ))}
                  </MasterSelect>
                  <MasterTextarea
                    label="作废原因"
                    value={voidForm.reason}
                    onChange={(value) => updateVoidField("reason", value)}
                  />
                  <MasterSubmitButton
                    busy={busy === `voidBusinessDocument-${voidForm.document_id}-primary`}
                    label="执行作废"
                    onClick={() =>
                      runAction({
                        action: "voidBusinessDocument",
                        entityId: voidForm.document_id,
                        payload: {
                          document_type: voidForm.document_type,
                          reason: voidForm.reason,
                        },
                      })
                    }
                  />
                </>
              )}
            </div>
          ) : (
            <EmptyText text="单据作废需管理层或系统管理员操作。" />
          )}
        </Panel>
        <DataTable
          title="单据作废记录"
          icon={FileCheck2}
          rows={snapshot.board.documentCancellations}
          columns={[
            { key: "cancellation_no", label: "作废单号" },
            { key: "document_type_label", label: "单据类型" },
            { key: "document_no", label: "原单号" },
            { key: "original_status", label: "原状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "reason", label: "作废原因" },
            { key: "cancelled_by_name", label: "作废人" },
            { key: "cancelled_at", label: "作废时间", render: shortDate },
          ]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Panel title="冲销处理中心" icon={RotateCcw} action={canReverseDocument ? "库存反向 / 财务红冲" : "只读"}>
          {canReverseDocument ? (
            <div className="grid gap-3">
              {snapshot.board.documentReversalCandidates.length === 0 ? (
                <EmptyText text="当前没有可冲销的已入库采购单或已发货单据。" />
              ) : (
                <>
                  <MasterSelect label="可冲销单据" value={reversalForm.document_id} onChange={selectReversalCandidate}>
                    {snapshot.board.documentReversalCandidates.map((candidate) => (
                      <option key={String(candidate.document_id)} value={String(candidate.document_id)}>
                        {String(candidate.document_type_label)} / {String(candidate.document_no)} / {String(candidate.reversal_type_label)}
                      </option>
                    ))}
                  </MasterSelect>
                  <MasterTextarea
                    label="冲销原因"
                    value={reversalForm.reason}
                    onChange={(value) => updateReversalField("reason", value)}
                  />
                  <MasterSubmitButton
                    busy={busy === `reverseBusinessDocument-${reversalForm.document_id}-primary`}
                    label="执行冲销"
                    onClick={() =>
                      runAction({
                        action: "reverseBusinessDocument",
                        entityId: reversalForm.document_id,
                        payload: {
                          document_type: reversalForm.document_type,
                          reason: reversalForm.reason,
                        },
                      })
                    }
                  />
                </>
              )}
            </div>
          ) : (
            <EmptyText text="业务冲销需管理层或系统管理员操作。" />
          )}
        </Panel>
        <DataTable
          title="冲销记录台账"
          icon={RotateCcw}
          rows={snapshot.board.documentReversals}
          columns={[
            { key: "reversal_no", label: "冲销单号" },
            { key: "document_type_label", label: "单据类型" },
            { key: "document_no", label: "原单号" },
            { key: "reversal_type_label", label: "冲销类型" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "reason", label: "冲销原因" },
            { key: "reversed_by_name", label: "冲销人" },
            { key: "reversed_at", label: "冲销时间", render: shortDate },
          ]}
        />
      </div>
      <DataTable
        title="应收应付红冲记录"
        icon={ReceiptText}
        rows={snapshot.board.ledgerRedOffsets}
        columns={[
          { key: "offset_no", label: "红冲单号" },
          { key: "ledger_type_label", label: "账款类型" },
          { key: "ledger_no", label: "账款单号" },
          { key: "source_document_type_label", label: "来源单据" },
          { key: "original_amount", label: "原金额", render: formatCurrency },
          { key: "settled_amount", label: "已收/已付", render: formatCurrency },
          { key: "offset_amount", label: "红冲金额", render: formatCurrency },
          { key: "reason", label: "红冲原因" },
          { key: "created_by_name", label: "经办人" },
          { key: "created_at", label: "红冲时间", render: shortDate },
        ]}
      />
      <DataTable
        title="用户账号"
        icon={ShieldCheck}
        rows={snapshot.users}
        columns={[
          { key: "username", label: "登录账号" },
          { key: "name", label: "姓名" },
          { key: "role_label", label: "角色" },
          { key: "title", label: "岗位说明" },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "last_login_at", label: "最近登录", render: shortDate },
          { key: "password_changed_at", label: "密码更新时间", render: shortDate },
          {
            key: "user_ops",
            label: "管理",
            render: (_value, row) =>
              isAdmin && row.id !== snapshot.currentUser.id ? (
                <div className="flex gap-2">
                  <InlineActionButton
                    label="重置密码"
                    busy={busy === `resetUserPassword-${String(row.id)}-primary`}
                    onClick={() =>
                      runAction({
                        action: "resetUserPassword",
                        entityId: String(row.id),
                        payload: { new_password: "Welcome@2026" },
                      })
                    }
                  />
                  <InlineActionButton
                    label={row.status === "active" ? "停用" : "启用"}
                    busy={busy === `updateUserStatus-${String(row.id)}-primary`}
                    onClick={() =>
                      runAction({
                        action: "updateUserStatus",
                        entityId: String(row.id),
                        payload: { status: row.status === "active" ? "inactive" : "active" },
                      })
                    }
                  />
                </div>
              ) : (
                <span className="text-xs text-slate-400">-</span>
              ),
          },
          {
            key: "detail",
            label: "详情",
            render: (_value, row) => (
              <DetailButton
                onClick={() =>
                  openDetail(
                    makeDetail("用户账号详情", String(row.name), row, [
                      ["登录账号", "username"],
                      ["姓名", "name"],
                      ["角色", "role_label"],
                      ["状态", "status"],
                      ["岗位说明", "title"],
                      ["最近登录", "last_login_at", shortDate],
                      ["密码更新时间", "password_changed_at", shortDate],
                    ]),
                  )
                }
              />
            ),
          },
        ]}
      />
      <DataTable
        title="角色权限矩阵摘要"
        icon={FileCheck2}
        rows={snapshot.security.permissionMatrix}
        columns={[
          { key: "role_label", label: "角色" },
          { key: "module_label", label: "模块" },
          { key: "action_count", label: "权限数" },
          { key: "high_risk_count", label: "高风险" },
          { key: "medium_risk_count", label: "中风险" },
          { key: "low_risk_count", label: "低风险" },
          { key: "actions", label: "权限范围" },
        ]}
      />
      <DataTable
        title="角色权限矩阵"
        icon={FileCheck2}
        rows={snapshot.security.rolePermissions}
        columns={[
          { key: "role_label", label: "角色" },
          { key: "module_label", label: "模块" },
          { key: "action_label", label: "权限动作" },
          { key: "action", label: "权限编码" },
          { key: "risk_level", label: "风险等级", render: (value) => <StatusBadge value={String(value)} /> },
        ]}
      />
      <DataTable
        title="单据编号台账"
        icon={ReceiptText}
        rows={snapshot.board.documentSequences}
        columns={[
          { key: "doc_type", label: "单据类型" },
          { key: "prefix", label: "前缀" },
          { key: "date_key", label: "日期段" },
          { key: "current_no", label: "当前流水" },
          { key: "sample_no", label: "最新编号" },
          { key: "updated_at", label: "更新时间", render: shortDate },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="登录日志"
          icon={LogIn}
          rows={snapshot.board.loginLogs}
          columns={[
            { key: "actor_name", label: "用户" },
            { key: "username", label: "账号" },
            { key: "role_label", label: "角色" },
            { key: "message", label: "事件" },
            { key: "created_at", label: "登录时间", render: shortDate },
          ]}
        />
        <Panel title="审计日志查询" icon={ShieldCheck} action={`${filteredAuditLogs.length} 条`}>
          <div className="space-y-3">
            <MasterInput label="关键字" value={auditKeyword} onChange={setAuditKeyword} />
            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {filteredAuditLogs.length === 0 ? (
                <EmptyText text="当前条件下暂无审计记录" />
              ) : (
                filteredAuditLogs.map((log) => (
                  <div key={String(log.id)} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                      <span className="truncate">{String(log.actor_name ?? "-")}</span>
                      <span className="shrink-0 text-slate-500">{shortDate(log.created_at)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{String(log.message ?? "-")}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function OverviewModule({
  snapshot,
  currentUser,
  busy,
  fileInputRef,
  lifecycleRows,
  runAction,
  uploadBom,
  actorId,
}: {
  snapshot: Snapshot;
  currentUser?: User;
  busy: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  lifecycleRows: Array<{ name: string; rows: Row[]; label: string; status: string }>;
  runAction: (task: ActionRequest) => Promise<void>;
  uploadBom: () => Promise<void>;
  actorId: string;
}) {
  return (
    <>
      <SummaryStrip snapshot={snapshot} />
      <ProductionProgressPanel productions={snapshot.board.productions} />
      <section className="mt-5 grid gap-5 2xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)_minmax(320px,360px)]">
        <div className="min-w-0 space-y-5">
          <Panel title="待办工作台" icon={ClipboardList} action={`${snapshot.tasks.length} 项`}>
            <div className="space-y-3">
              {snapshot.tasks.length === 0 ? (
                <EmptyText text="当前角色暂无待办" />
              ) : (
                snapshot.tasks.map((task) => (
                  <TaskCard key={task.id} task={task} busy={busy} runAction={runAction} />
                ))
              )}
            </div>
          </Panel>

          <AlertCenterPanel snapshot={snapshot} actorId={actorId} busy={busy} runAction={runAction} />

          {["production", "admin"].includes(currentUser?.role ?? "") ? (
            <BomImportPanel busy={busy} fileInputRef={fileInputRef} uploadBom={uploadBom} />
          ) : null}
        </div>

        <div className="min-w-0 space-y-5">
          <Panel title="订单主线" icon={ArrowRight} action="销售 / 生产 / 仓储 / 财务">
            <div className="grid gap-3 md:grid-cols-3">
              {lifecycleRows.map((group) => (
                <LifecycleTile key={group.name} group={group} />
              ))}
            </div>
          </Panel>

          <div className="grid gap-5 xl:grid-cols-3">
            <OrderFunnelChart snapshot={snapshot} />
            <CashChart snapshot={snapshot} />
            <ProductionChart snapshot={snapshot} />
          </div>

          <LedgerPanel
            actorId={actorId}
            receivables={snapshot.board.receivables}
            payables={snapshot.board.payables}
            purchaseOrders={snapshot.board.purchaseOrders}
            suppliers={snapshot.board.suppliers}
          />

          <InventoryTable actorId={actorId} materials={snapshot.board.materials} />
        </div>

        <div className="min-w-0 space-y-5">
          <InventoryValueChart snapshot={snapshot} />
          <YieldChart snapshot={snapshot} />
          <BatchPanel finishedBatches={snapshot.board.finishedBatches} inspections={snapshot.board.inspections} />
          <ArchivePanel snapshot={snapshot} />
          <ActivityPanel title="导出记录" icon={Download} rows={snapshot.board.documentExports} mode="document" />
          <ActivityPanel title="审计日志" icon={ShieldCheck} rows={snapshot.board.auditLogs} mode="audit" />
        </div>
      </section>
    </>
  );
}

type MasterTabKey = "customers" | "suppliers" | "materials" | "products" | "boms";
type OpeningImportType = "opening-inventory" | "opening-receivables" | "opening-payables";

const masterTabs = [
  { key: "customers", label: "客户", icon: FileSpreadsheet },
  { key: "suppliers", label: "供应商", icon: Boxes },
  { key: "materials", label: "物料", icon: Warehouse },
  { key: "products", label: "产品", icon: PackageCheck },
  { key: "boms", label: "BOM", icon: ClipboardList },
] satisfies Array<{ key: MasterTabKey; label: string; icon: typeof ClipboardList }>;

const openingImportTypes = [
  { key: "opening-inventory", label: "期初库存", detail: "物料编码、批次号、数量、单价、期初日期" },
  { key: "opening-receivables", label: "期初应收", detail: "客户编码、应收金额、已收金额、到期日" },
  { key: "opening-payables", label: "期初应付", detail: "供应商编码、应付金额、已付金额、到期日" },
] satisfies Array<{ key: OpeningImportType; label: string; detail: string }>;

function MasterDataModule({
  snapshot,
  actorId,
  busy,
  runAction,
  openDetail,
  onImported,
}: {
  snapshot: Snapshot;
  actorId: string;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
  openDetail: (detail: DetailState) => void;
  onImported: (snapshot?: Snapshot) => void;
}) {
  const [tab, setTab] = useState<MasterTabKey>("customers");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>(() =>
    defaultMasterForm("customers", snapshot),
  );
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const openingInputRef = useRef<HTMLInputElement>(null);
  const [openingType, setOpeningType] = useState<OpeningImportType>("opening-inventory");
  const [openingImporting, setOpeningImporting] = useState(false);
  const [openingMessage, setOpeningMessage] = useState("");
  const [openingError, setOpeningError] = useState("");
  const canEdit =
    snapshot.currentUser.role === "admin" ||
    (tab === "customers" && ["sales", "assistant"].includes(snapshot.currentUser.role)) ||
    (["suppliers", "materials"].includes(tab) && snapshot.currentUser.role === "purchasing") ||
    (["products", "boms"].includes(tab) && snapshot.currentUser.role === "production") ||
    (tab === "materials" && snapshot.currentUser.role === "warehouse");

  const changeTab = (next: MasterTabKey) => {
    setTab(next);
    setEditing(null);
    setForm(defaultMasterForm(next, snapshot));
  };
  const setField = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const beginCreate = () => {
    setEditing(null);
    setForm(defaultMasterForm(tab, snapshot));
  };
  const beginEdit = (row: Row) => {
    setEditing(row);
    setForm(masterFormFromRow(tab, row));
  };
  const submit = async () => {
    const actionMap: Record<Exclude<MasterTabKey, "boms">, string> = {
      customers: "upsertCustomer",
      suppliers: "upsertSupplier",
      materials: "upsertMaterial",
      products: "upsertProduct",
    };
    const action = tab === "boms" ? "createBomVersion" : actionMap[tab];
    await runAction({ action, entityId: tab === "boms" ? undefined : String(editing?.id ?? ""), payload: form });
    setEditing(null);
    setForm(defaultMasterForm(tab, snapshot));
  };
  const deactivate = async (row: Row) => {
    const actionMap: Record<MasterTabKey, string> = {
      customers: "deactivateCustomer",
      suppliers: "deactivateSupplier",
      materials: "deactivateMaterial",
      products: "deactivateProduct",
      boms: "deactivateBom",
    };
    await runAction({ action: actionMap[tab], entityId: String(row.id) });
  };
  const importMasterData = async () => {
    const file = importInputRef.current?.files?.[0];
    if (!file) {
      setImportError("请选择要导入的 Excel 或 CSV 文件。");
      return;
    }
    setImporting(true);
    setImportError("");
    setImportMessage("");
    const data = new FormData();
    data.append("actorId", actorId);
    data.append("type", tab);
    data.append("file", file);
    const response = await fetch("/api/master-data/import", { method: "POST", body: data });
    const result = (await response.json()) as
      | { ok: true; importedRows: number; created: number; updated: number; snapshot?: Snapshot }
      | { error: string };
    if (!response.ok || "error" in result) {
      setImportError("error" in result ? result.error : "导入失败");
    } else {
      setImportMessage(`导入 ${result.importedRows} 行，新增 ${result.created} 条，更新 ${result.updated} 条`);
      onImported(result.snapshot);
      if (importInputRef.current) importInputRef.current.value = "";
    }
    setImporting(false);
  };
  const importOpeningData = async () => {
    const file = openingInputRef.current?.files?.[0];
    if (!file) {
      setOpeningError("请选择期初数据 Excel 或 CSV 文件。");
      return;
    }
    setOpeningImporting(true);
    setOpeningError("");
    setOpeningMessage("");
    const data = new FormData();
    data.append("actorId", actorId);
    data.append("type", openingType);
    data.append("note", "正式上线初始化导入");
    data.append("file", file);
    const response = await fetch("/api/opening/import", { method: "POST", body: data });
    const result = (await response.json()) as
      | { ok: true; importedRows: number; created: number; updated: number; totalAmount: number; snapshot?: Snapshot }
      | { error: string };
    if (!response.ok || "error" in result) {
      setOpeningError("error" in result ? result.error : "初始化导入失败");
    } else {
      setOpeningMessage(`导入 ${result.importedRows} 行，生成 ${result.created} 条，金额 ${formatCurrency(result.totalAmount)}`);
      onImported(result.snapshot);
      if (openingInputRef.current) openingInputRef.current.value = "";
    }
    setOpeningImporting(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-5">
        <MiniMetric label="客户主档" value={`${snapshot.board.customers.length} 家`} />
        <MiniMetric label="供应商主档" value={`${snapshot.board.suppliers.length} 家`} />
        <MiniMetric label="物料主档" value={`${snapshot.board.materials.length} 项`} />
        <MiniMetric label="产品主档" value={`${snapshot.board.products.length} 项`} />
        <MiniMetric label="BOM 版本" value={`${snapshot.board.boms.length} 个`} />
      </div>

      <Panel title="正式上线初始化向导" icon={Upload} action="期初数据">
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="grid gap-3 md:grid-cols-3">
            {openingImportTypes.map((item, index) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setOpeningType(item.key)}
                className={`rounded-md border px-3 py-3 text-left ${
                  openingType === item.key
                    ? "border-blue-600 bg-blue-50 text-blue-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                }`}
              >
                <div className="text-xs font-semibold">步骤 {index + 1}</div>
                <div className="mt-1 text-sm font-semibold">{item.label}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</div>
              </button>
            ))}
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={openingInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="h-9 max-w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-600"
              />
              <button
                type="button"
                disabled={openingImporting}
                onClick={importOpeningData}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Upload className="h-4 w-4" />
                {openingImporting ? "导入中" : "导入期初数据"}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              建议顺序：先导入客户/供应商/物料/产品/BOM 主数据，再导入期初库存、期初应收和期初应付。期初库存会生成批次和库存流水。
            </p>
            {openingMessage ? <p className="mt-2 text-xs font-medium text-emerald-700">{openingMessage}</p> : null}
            {openingError ? <p className="mt-2 text-xs font-medium text-rose-700">{openingError}</p> : null}
          </div>
        </div>
      </Panel>

      <DataTable
        title="初始化导入记录"
        icon={FileCheck2}
        rows={snapshot.board.initializationImports}
        columns={[
          { key: "import_no", label: "导入批次" },
          { key: "type_label", label: "类型" },
          { key: "imported_rows", label: "行数" },
          { key: "created_count", label: "生成" },
          { key: "total_amount", label: "金额", render: formatCurrency },
          { key: "actor_name", label: "导入人" },
          { key: "created_at", label: "导入时间", render: shortDate },
        ]}
      />

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="scrollbar-thin flex gap-2 overflow-x-auto border-b border-slate-200 px-4 py-3">
          {masterTabs.map((item) => {
            const Icon = item.icon;
            const active = item.key === tab;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => changeTab(item.key)}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${
                  active
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{masterTabs.find((item) => item.key === tab)?.label}导入导出</p>
            <p className="mt-1 text-xs text-slate-500">
              支持 XLSX / CSV。导入时按业务编码自动判断新增或更新，库存数量和均价仍由业务流水产生。
            </p>
            {importMessage ? <p className="mt-2 text-xs font-medium text-emerald-700">{importMessage}</p> : null}
            {importError ? <p className="mt-2 text-xs font-medium text-rose-700">{importError}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadExport(actorId, `master-${tab}`)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
            >
              <Download className="h-4 w-4" />
              导出数据
            </button>
            <button
              type="button"
              onClick={() => downloadExport(actorId, `master-template-${tab}`)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
            >
              <FileSpreadsheet className="h-4 w-4" />
              下载模板
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="h-9 max-w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-600"
            />
            <button
              type="button"
              disabled={importing || !canEdit}
              onClick={importMasterData}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {importing ? "导入中" : "导入"}
            </button>
          </div>
        </div>

        <div className="grid gap-5 p-4 xl:grid-cols-[360px_1fr]">
          <Panel
            title={tab === "boms" ? "新增 BOM 版本" : editing ? "编辑主数据" : "新增主数据"}
            icon={ClipboardList}
            action={canEdit ? "授权维护" : "只读"}
          >
            {canEdit ? (
              <MasterDataForm
                tab={tab}
                form={form}
                snapshot={snapshot}
                editing={editing}
                busy={Boolean(busy)}
                setField={setField}
                submit={submit}
                beginCreate={beginCreate}
              />
            ) : (
              <EmptyText text="当前角色仅可查看主数据，维护请切换到对应授权账号。" />
            )}
          </Panel>

          <MasterDataTable
            tab={tab}
            snapshot={snapshot}
            canEdit={canEdit}
            busy={busy}
            beginEdit={beginEdit}
            deactivate={deactivate}
            openDetail={openDetail}
          />
        </div>
      </section>
    </div>
  );
}

function defaultMasterForm(tab: MasterTabKey, snapshot: Snapshot): Record<string, string | boolean> {
  if (tab === "customers") {
    return {
      customer_code: nextMasterCode("KH", snapshot.board.customers),
      name: "",
      contact: "",
      phone: "",
      status: "active",
      address: "",
      tax_no: "",
      remark: "",
    };
  }
  if (tab === "suppliers") {
    return {
      supplier_code: nextMasterCode("GYS", snapshot.board.suppliers),
      name: "",
      contact: "",
      phone: "",
      payment_terms: "月结30天",
      status: "active",
      address: "",
      tax_no: "",
      remark: "",
    };
  }
  if (tab === "materials") {
    return {
      material_code: nextMasterCode("WL", snapshot.board.materials),
      name: "",
      spec: "",
      unit: "kg",
      kind: "raw",
      reorder_min_qty: "0",
      status: "active",
      remark: "",
    };
  }
  if (tab === "products") {
    return {
      product_code: nextMasterCode("CP", snapshot.board.products),
      name: "",
      spec: "",
      unit: "件",
      process_fee: "0",
      default_margin: "0.2",
      status: "active",
      remark: "",
    };
  }
  return {
    product_id: String(snapshot.board.products.find((item) => item.status === "active")?.id ?? ""),
    version: `V${snapshot.board.boms.length + 1}.0`,
    material_id: String(snapshot.board.materials.find((item) => item.status === "active")?.id ?? ""),
    qty_per: "1",
    is_primary: true,
    remark: "",
  };
}

function masterFormFromRow(tab: MasterTabKey, row: Row): Record<string, string | boolean> {
  if (tab === "customers") {
    return pickMasterFields(row, ["customer_code", "name", "contact", "phone", "status", "address", "tax_no", "remark"]);
  }
  if (tab === "suppliers") {
    return pickMasterFields(row, [
      "supplier_code",
      "name",
      "contact",
      "phone",
      "payment_terms",
      "status",
      "address",
      "tax_no",
      "remark",
    ]);
  }
  if (tab === "materials") {
    return pickMasterFields(row, ["material_code", "name", "spec", "unit", "kind", "reorder_min_qty", "status", "remark"]);
  }
  if (tab === "products") {
    return pickMasterFields(row, ["product_code", "name", "spec", "unit", "process_fee", "default_margin", "status", "remark"]);
  }
  return pickMasterFields(row, ["product_id", "version", "remark"]);
}

function pickMasterFields(row: Row, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, String(row[key] ?? "")]));
}

function nextMasterCode(prefix: string, rows: Row[]) {
  return `${prefix}-${String(rows.length + 1).padStart(3, "0")}`;
}

function MasterDataForm({
  tab,
  form,
  snapshot,
  editing,
  busy,
  setField,
  submit,
  beginCreate,
}: {
  tab: MasterTabKey;
  form: Record<string, string | boolean>;
  snapshot: Snapshot;
  editing: Row | null;
  busy: boolean;
  setField: (key: string, value: string | boolean) => void;
  submit: () => Promise<void>;
  beginCreate: () => void;
}) {
  if (tab === "boms") {
    return (
      <div className="space-y-3">
        <MasterSelect label="产品" value={form.product_id} onChange={(value) => setField("product_id", value)}>
          {snapshot.board.products
            .filter((item) => item.status === "active")
            .map((product) => (
              <option key={String(product.id)} value={String(product.id)}>
                {String(product.product_code ?? product.id)} / {String(product.name)}
              </option>
            ))}
        </MasterSelect>
        <MasterInput label="版本号" value={form.version} onChange={(value) => setField("version", value)} />
        <MasterSelect label="首行物料" value={form.material_id} onChange={(value) => setField("material_id", value)}>
          {snapshot.board.materials
            .filter((item) => item.status === "active")
            .map((material) => (
              <option key={String(material.id)} value={String(material.id)}>
                {String(material.material_code ?? material.id)} / {String(material.name)}
              </option>
            ))}
        </MasterSelect>
        <MasterInput label="单位用量" type="number" value={form.qty_per} onChange={(value) => setField("qty_per", value)} />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(form.is_primary)}
            onChange={(event) => setField("is_primary", event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          标记为主材
        </label>
        <MasterTextarea label="备注" value={form.remark} onChange={(value) => setField("remark", value)} />
        <MasterSubmitButton busy={busy} label="创建新版本" onClick={submit} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tab === "customers" ? (
        <>
          <MasterInput label="客户编码" value={form.customer_code} onChange={(value) => setField("customer_code", value)} />
          <MasterInput label="客户名称" value={form.name} onChange={(value) => setField("name", value)} />
          <MasterInput label="联系人" value={form.contact} onChange={(value) => setField("contact", value)} />
          <MasterInput label="电话" value={form.phone} onChange={(value) => setField("phone", value)} />
          <MasterInput label="地址" value={form.address} onChange={(value) => setField("address", value)} />
          <MasterInput label="税号" value={form.tax_no} onChange={(value) => setField("tax_no", value)} />
        </>
      ) : null}

      {tab === "suppliers" ? (
        <>
          <MasterInput label="供应商编码" value={form.supplier_code} onChange={(value) => setField("supplier_code", value)} />
          <MasterInput label="供应商名称" value={form.name} onChange={(value) => setField("name", value)} />
          <MasterInput label="联系人" value={form.contact} onChange={(value) => setField("contact", value)} />
          <MasterInput label="电话" value={form.phone} onChange={(value) => setField("phone", value)} />
          <MasterInput label="付款条件" value={form.payment_terms} onChange={(value) => setField("payment_terms", value)} />
          <MasterInput label="地址" value={form.address} onChange={(value) => setField("address", value)} />
          <MasterInput label="税号" value={form.tax_no} onChange={(value) => setField("tax_no", value)} />
        </>
      ) : null}

      {tab === "materials" ? (
        <>
          <MasterInput label="物料编码" value={form.material_code} onChange={(value) => setField("material_code", value)} />
          <MasterInput label="物料名称" value={form.name} onChange={(value) => setField("name", value)} />
          <MasterInput label="规格型号" value={form.spec} onChange={(value) => setField("spec", value)} />
          <MasterInput label="单位" value={form.unit} onChange={(value) => setField("unit", value)} />
          <MasterSelect label="分类" value={form.kind} onChange={(value) => setField("kind", value)}>
            <option value="raw">原材料</option>
            <option value="packing">包装物</option>
            <option value="auxiliary">辅料</option>
          </MasterSelect>
          <MasterInput label="安全库存" type="number" value={form.reorder_min_qty} onChange={(value) => setField("reorder_min_qty", value)} />
        </>
      ) : null}

      {tab === "products" ? (
        <>
          <MasterInput label="产品编码" value={form.product_code} onChange={(value) => setField("product_code", value)} />
          <MasterInput label="产品名称" value={form.name} onChange={(value) => setField("name", value)} />
          <MasterInput label="规格型号" value={form.spec} onChange={(value) => setField("spec", value)} />
          <MasterInput label="单位" value={form.unit} onChange={(value) => setField("unit", value)} />
          <MasterInput label="加工费" type="number" value={form.process_fee} onChange={(value) => setField("process_fee", value)} />
          <MasterInput label="默认利润率" type="number" value={form.default_margin} onChange={(value) => setField("default_margin", value)} />
        </>
      ) : null}

      <MasterSelect label="状态" value={form.status} onChange={(value) => setField("status", value)}>
        <option value="active">启用</option>
        <option value="inactive">停用</option>
      </MasterSelect>
      <MasterTextarea label="备注" value={form.remark} onChange={(value) => setField("remark", value)} />
      <div className="flex flex-wrap gap-2">
        <MasterSubmitButton busy={busy} label={editing ? "保存修改" : "新增保存"} onClick={submit} />
        {editing ? (
          <button
            type="button"
            onClick={beginCreate}
            className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
          >
            取消编辑
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MasterDataTable({
  tab,
  snapshot,
  canEdit,
  busy,
  beginEdit,
  deactivate,
  openDetail,
}: {
  tab: MasterTabKey;
  snapshot: Snapshot;
  canEdit: boolean;
  busy: string | null;
  beginEdit: (row: Row) => void;
  deactivate: (row: Row) => Promise<void>;
  openDetail: (detail: DetailState) => void;
}) {
  if (tab === "customers") {
    return (
      <DataTable
        title="客户主档"
        icon={FileSpreadsheet}
        rows={snapshot.board.customers}
        columns={[
          { key: "customer_code", label: "编码" },
          { key: "name", label: "客户名称" },
          { key: "contact", label: "联系人" },
          { key: "phone", label: "电话" },
          { key: "receivable_balance", label: "应收余额", render: formatCurrency },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          masterDetailColumn(openDetail, "客户详情", "customer_code", [
            ["客户编码", "customer_code"],
            ["客户名称", "name"],
            ["联系人", "contact"],
            ["电话", "phone"],
            ["地址", "address"],
            ["税号", "tax_no"],
            ["订单数", "order_count"],
            ["应收余额", "receivable_balance", formatCurrency],
            ["状态", "status"],
            ["备注", "remark"],
          ]),
          masterActionColumn(canEdit, busy, beginEdit, deactivate),
        ]}
      />
    );
  }

  if (tab === "suppliers") {
    return (
      <DataTable
        title="供应商主档"
        icon={Boxes}
        rows={snapshot.board.suppliers}
        columns={[
          { key: "supplier_code", label: "编码" },
          { key: "name", label: "供应商名称" },
          { key: "contact", label: "联系人" },
          { key: "payment_terms", label: "账期" },
          { key: "payable_balance", label: "应付余额", render: formatCurrency },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          masterDetailColumn(openDetail, "供应商详情", "supplier_code", [
            ["供应商编码", "supplier_code"],
            ["供应商名称", "name"],
            ["联系人", "contact"],
            ["电话", "phone"],
            ["付款条件", "payment_terms"],
            ["地址", "address"],
            ["税号", "tax_no"],
            ["应付余额", "payable_balance", formatCurrency],
            ["状态", "status"],
            ["备注", "remark"],
          ]),
          masterActionColumn(canEdit, busy, beginEdit, deactivate),
        ]}
      />
    );
  }

  if (tab === "materials") {
    return (
      <DataTable
        title="物料主档"
        icon={Warehouse}
        rows={snapshot.board.materials}
        columns={[
          { key: "material_code", label: "编码" },
          { key: "name", label: "物料名称" },
          { key: "spec", label: "规格" },
          { key: "unit", label: "单位" },
          { key: "stock_qty", label: "库存", render: (value, row) => formatQty(value, row.unit) },
          { key: "average_cost", label: "移动均价", render: formatCurrency },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          masterDetailColumn(openDetail, "物料详情", "material_code", [
            ["物料编码", "material_code"],
            ["物料名称", "name"],
            ["规格", "spec"],
            ["单位", "unit"],
            ["分类", "kind"],
            ["安全库存", "reorder_min_qty"],
            ["当前库存", "stock_qty"],
            ["移动均价", "average_cost", formatCurrency],
            ["库龄状态", "aging_status_label"],
            ["状态", "status"],
            ["备注", "remark"],
          ]),
          masterActionColumn(canEdit, busy, beginEdit, deactivate),
        ]}
      />
    );
  }

  if (tab === "products") {
    return (
      <DataTable
        title="产品主档"
        icon={PackageCheck}
        rows={snapshot.board.products}
        columns={[
          { key: "product_code", label: "编码" },
          { key: "name", label: "产品名称" },
          { key: "spec", label: "规格" },
          { key: "unit", label: "单位" },
          { key: "process_fee", label: "加工费", render: formatCurrency },
          { key: "default_margin", label: "默认利润率", render: percentValue },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          masterDetailColumn(openDetail, "产品详情", "product_code", [
            ["产品编码", "product_code"],
            ["产品名称", "name"],
            ["规格", "spec"],
            ["单位", "unit"],
            ["加工费", "process_fee", formatCurrency],
            ["默认利润率", "default_margin", percentValue],
            ["订单数", "order_count"],
            ["BOM 版本数", "bom_count"],
            ["状态", "status"],
            ["备注", "remark"],
          ]),
          masterActionColumn(canEdit, busy, beginEdit, deactivate),
        ]}
      />
    );
  }

  return (
    <DataTable
      title="BOM 版本台账"
      icon={ClipboardList}
      rows={snapshot.board.boms}
      columns={[
        { key: "product_code", label: "产品编码" },
        { key: "product_name", label: "产品" },
        { key: "version", label: "版本" },
        { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
        { key: "updated_at", label: "更新时间", render: shortDate },
        {
          key: "bom_detail",
          label: "详情",
          render: (_value, row) => (
            <DetailButton
              onClick={() =>
                openDetail({
                  ...makeDetail("BOM 版本详情", `${String(row.product_name)} / ${String(row.version)}`, row, [
                    ["产品编码", "product_code"],
                    ["产品名称", "product_name"],
                    ["版本", "version"],
                    ["状态", "status"],
                    ["备注", "remark"],
                    ["创建时间", "created_at", shortDate],
                    ["更新时间", "updated_at", shortDate],
                  ]),
                  lines: detailLines(row.lines),
                  audits: auditRows(snapshot, row.id),
                })
              }
            />
          ),
        },
        masterActionColumn(canEdit, busy, undefined, deactivate),
      ]}
    />
  );
}

function masterDetailColumn(
  openDetail: (detail: DetailState) => void,
  title: string,
  subtitleKey: string,
  specs: DetailSpec[],
) {
  return {
    key: `${subtitleKey}_detail`,
    label: "详情",
    render: (_value: unknown, row: Row) => (
      <DetailButton onClick={() => openDetail(makeDetail(title, String(row[subtitleKey] ?? row.id), row, specs))} />
    ),
  };
}

function masterActionColumn(
  canEdit: boolean,
  busy: string | null,
  beginEdit: ((row: Row) => void) | undefined,
  deactivate: (row: Row) => Promise<void>,
) {
  return {
    key: "master_action",
    label: "操作",
    render: (_value: unknown, row: Row) =>
      canEdit ? (
        <div className="flex flex-wrap gap-2">
          {beginEdit ? <InlineActionButton label="编辑" onClick={() => beginEdit(row)} /> : null}
          {row.status !== "inactive" ? (
            <InlineActionButton
              label="停用"
              busy={Boolean(busy)}
              onClick={() => {
                void deactivate(row);
              }}
            />
          ) : null}
        </div>
      ) : (
        <span className="text-xs text-slate-400">-</span>
      ),
  };
}

function MasterInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input
        type={type}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function MasterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <select
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      >
        {children}
      </select>
    </label>
  );
}

function MasterTextarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <textarea
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-1 w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function MasterSubmitButton({
  busy,
  label,
  onClick,
}: {
  busy: boolean;
  label: string;
  onClick: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void onClick()}
      className="inline-flex h-9 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? "保存中" : label}
    </button>
  );
}

function SalesModule({
  snapshot,
  actorId,
  busy,
  runAction,
  openDetail,
  onSnapshot,
  onError,
}: {
  snapshot: Snapshot;
  actorId: string;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
  openDetail: (detail: DetailState) => void;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (message: string) => void;
}) {
  const activeCustomers = snapshot.board.customers.filter((item) => item.status === "active");
  const activeProducts = snapshot.board.products.filter((item) => item.status === "active");
  const [quoteForm, setQuoteForm] = useState<Record<string, string>>({
    customer_id: String(activeCustomers[0]?.id ?? ""),
    product_id: String(activeProducts[0]?.id ?? ""),
    qty: "100",
    margin_rate: String(activeProducts[0]?.default_margin ?? 0.2),
  });
  const [orderForm, setOrderForm] = useState<Record<string, string>>({
    due_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10),
    special_requirements: "客户要求批次可追溯，随货提供检验记录",
    customer_po_no: "PO-CUST-20260615",
    sales_contract_no: "HT-2026-001",
    delivery_address: "上海市浦东新区张江路 88 号",
    consignee: "刘经理",
    contact_phone: "138-0000-2026",
    payment_terms_days: "30",
    remark: "正式订单录入",
  });
  const shipReadyProductions = snapshot.board.productions.filter((item) =>
    ["in_stock", "partial_shipped"].includes(String(item.status)),
  );
  const [shipmentForm, setShipmentForm] = useState<Record<string, string>>({
    production_id: String(shipReadyProductions[0]?.id ?? ""),
    shipped_qty: "1",
    shipped_at: new Date().toISOString().slice(0, 10),
    delivery_address: "上海市浦东新区张江路 88 号",
    consignee: "刘经理",
    contact_phone: "138-0000-2026",
    logistics_company: "顺丰专线",
    vehicle_no: "沪A-ERP01",
    tracking_no: "",
    remark: "正式发货",
  });
  const firstReturnCandidate = snapshot.board.salesReturnCandidates[0];
  const [returnForm, setReturnForm] = useState<Record<string, string>>({
    shipment_id: String(firstReturnCandidate?.shipment_id ?? ""),
    return_qty: String(firstReturnCandidate?.returnable_qty ?? "1"),
    received_at: new Date().toISOString().slice(0, 10),
    disposition: "return_to_stock",
    reason: "客户反馈包装破损，要求退货退款并补发。",
    note: "实物已退回仓库，外观复核后可补发。",
  });
  const firstReplacementCandidate = snapshot.board.replacementShipmentCandidates[0];
  const [replacementForm, setReplacementForm] = useState<Record<string, string>>({
    sales_return_id: String(firstReplacementCandidate?.id ?? ""),
    shipped_at: new Date().toISOString().slice(0, 10),
    logistics_company: "顺丰专线",
    tracking_no: "",
    remark: "售后补开发货单，不重复生成应收。",
  });
  const [deliveryPreview, setDeliveryPreview] = useState<FormalPrintDocument | null>(null);
  const canSell = ["sales", "admin"].includes(snapshot.currentUser.role);
  const canShip = ["assistant", "admin"].includes(snapshot.currentUser.role);
  const canReturn = ["assistant", "warehouse", "admin"].includes(snapshot.currentUser.role);
  const canReplace = ["assistant", "admin"].includes(snapshot.currentUser.role);
  const selectedProduct = activeProducts.find((item) => String(item.id) === quoteForm.product_id);
  const selectedShipProduction =
    shipReadyProductions.find((item) => String(item.id) === shipmentForm.production_id) ?? shipReadyProductions[0];
  const availableFinishedQty = selectedShipProduction
    ? snapshot.board.finishedBatches
        .filter(
          (batch) =>
            batch.production_order_id === selectedShipProduction.id &&
            batch.kind === "finished" &&
            batch.status === "available",
        )
        .reduce((sum, batch) => sum + Number(batch.qty ?? 0), 0)
    : 0;
  const setQuoteField = (key: string, value: string) => setQuoteForm((current) => ({ ...current, [key]: value }));
  const setOrderField = (key: string, value: string) => setOrderForm((current) => ({ ...current, [key]: value }));
  const setShipmentField = (key: string, value: string) => setShipmentForm((current) => ({ ...current, [key]: value }));
  const setReturnField = (key: string, value: string) => setReturnForm((current) => ({ ...current, [key]: value }));
  const setReplacementField = (key: string, value: string) =>
    setReplacementForm((current) => ({ ...current, [key]: value }));
  const selectedReturnCandidate =
    snapshot.board.salesReturnCandidates.find((item) => String(item.shipment_id) === returnForm.shipment_id) ??
    snapshot.board.salesReturnCandidates[0];
  const selectedReplacementCandidate =
    snapshot.board.replacementShipmentCandidates.find((item) => String(item.id) === replacementForm.sales_return_id) ??
    snapshot.board.replacementShipmentCandidates[0];
  const submitQuote = async () => {
    await runAction({ action: "createQuote", payload: quoteForm });
    setQuoteForm((current) => ({ ...current, qty: current.qty || "100" }));
  };
  const submitShipment = async () => {
    if (!selectedShipProduction) return;
    await runAction({
      action: "createShipment",
      entityId: String(selectedShipProduction.id),
      payload: shipmentForm,
    });
  };
  const submitReturn = async () => {
    if (!selectedReturnCandidate) return;
    await runAction({
      action: "recordSalesReturn",
      entityId: String(selectedReturnCandidate.shipment_id),
      payload: returnForm,
    });
  };
  const submitReplacement = async () => {
    if (!selectedReplacementCandidate) return;
    await runAction({
      action: "createReplacementShipment",
      entityId: String(selectedReplacementCandidate.id),
      payload: replacementForm,
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MiniMetric label="报价单" value={`${snapshot.board.quotes.length} 张`} />
        <MiniMetric label="客户订单" value={`${snapshot.board.orders.length} 单`} />
        <MiniMetric label="发货单" value={`${snapshot.board.shipments.length} 张`} />
        <MiniMetric label="退货单" value={`${snapshot.board.salesReturns.length} 张`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <Panel title="新建销售报价" icon={FileSpreadsheet} action={canSell ? "BOM 自动算价" : "只读"}>
          {canSell ? (
            <div className="space-y-3">
              <MasterSelect
                label="客户"
                value={quoteForm.customer_id}
                onChange={(value) => setQuoteField("customer_id", value)}
              >
                {activeCustomers.map((customer) => (
                  <option key={String(customer.id)} value={String(customer.id)}>
                    {String(customer.customer_code ?? customer.id)} / {String(customer.name)}
                  </option>
                ))}
              </MasterSelect>
              <MasterSelect
                label="产品"
                value={quoteForm.product_id}
                onChange={(value) => {
                  const product = activeProducts.find((item) => String(item.id) === value);
                  setQuoteForm((current) => ({
                    ...current,
                    product_id: value,
                    margin_rate: String(product?.default_margin ?? current.margin_rate ?? 0.2),
                  }));
                }}
              >
                {activeProducts.map((product) => (
                  <option key={String(product.id)} value={String(product.id)}>
                    {String(product.product_code ?? product.id)} / {String(product.name)}
                  </option>
                ))}
              </MasterSelect>
              <MasterInput label="报价数量" type="number" value={quoteForm.qty} onChange={(value) => setQuoteField("qty", value)} />
              <MasterInput
                label="利润率"
                type="number"
                value={quoteForm.margin_rate}
                onChange={(value) => setQuoteField("margin_rate", value)}
              />
              <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                当前产品加工费：{formatCurrency(selectedProduct?.process_fee)} / 默认利润率：
                {percentValue(selectedProduct?.default_margin)}
              </div>
              <MasterSubmitButton
                busy={busy === "createQuote-system-primary"}
                label="生成报价单"
                onClick={submitQuote}
              />
            </div>
          ) : (
            <EmptyText text="当前角色只能查看销售数据，报价录入请切换销售员或管理员。" />
          )}
        </Panel>

        <Panel title="正式订单录入项" icon={ClipboardList} action="用于已确认报价">
          <div className="grid gap-3 md:grid-cols-3">
            <MasterInput label="交付日期" type="date" value={orderForm.due_date} onChange={(value) => setOrderField("due_date", value)} />
            <MasterInput label="客户订单号" value={orderForm.customer_po_no} onChange={(value) => setOrderField("customer_po_no", value)} />
            <MasterInput label="销售合同号" value={orderForm.sales_contract_no} onChange={(value) => setOrderField("sales_contract_no", value)} />
            <MasterInput label="收货人" value={orderForm.consignee} onChange={(value) => setOrderField("consignee", value)} />
            <MasterInput label="联系电话" value={orderForm.contact_phone} onChange={(value) => setOrderField("contact_phone", value)} />
            <MasterInput
              label="账期天数"
              type="number"
              value={orderForm.payment_terms_days}
              onChange={(value) => setOrderField("payment_terms_days", value)}
            />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <MasterTextarea
              label="交付地址"
              value={orderForm.delivery_address}
              onChange={(value) => setOrderField("delivery_address", value)}
            />
            <MasterTextarea
              label="特殊要求"
              value={orderForm.special_requirements}
              onChange={(value) => setOrderField("special_requirements", value)}
            />
          </div>
          <div className="mt-3">
            <MasterInput label="订单备注" value={orderForm.remark} onChange={(value) => setOrderField("remark", value)} />
          </div>
        </Panel>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="报价单"
          icon={FileSpreadsheet}
          rows={snapshot.board.quotes}
          columns={[
            { key: "quote_no", label: "报价单号" },
            { key: "customer_name", label: "客户" },
            { key: "product_name", label: "产品" },
            { key: "qty", label: "数量" },
            { key: "total_amount", label: "金额", render: formatCurrency },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "quote_action",
              label: "操作",
              render: (_value, row) => {
                if (!canSell) return <span className="text-xs text-slate-400">-</span>;
                if (row.status === "draft") {
                  return (
                    <InlineActionButton
                      label="确认"
                      busy={busy === `confirmQuote-${String(row.id)}-primary`}
                      onClick={() => void runAction({ action: "confirmQuote", entityId: String(row.id) })}
                    />
                  );
                }
                if (row.status === "confirmed") {
                  return (
                    <InlineActionButton
                      label="转订单"
                      busy={busy === `createOrder-${String(row.id)}-primary`}
                      onClick={() =>
                        void runAction({
                          action: "createOrder",
                          entityId: String(row.id),
                          payload: orderForm,
                        })
                      }
                    />
                  );
                }
                return <span className="text-xs text-slate-400">-</span>;
              },
            },
            {
              key: "id",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail(
                      makeDetail("报价单详情", String(row.quote_no), row, [
                        ["客户", "customer_name"],
                        ["产品", "product_name"],
                        ["数量", "qty"],
                        ["材料成本", "material_cost", formatCurrency],
                        ["加工费", "process_fee", formatCurrency],
                        ["利润率", "margin_rate", percentValue],
                        ["报价金额", "total_amount", formatCurrency],
                        ["状态", "status_label"],
                        ["创建时间", "created_at", shortDate],
                      ]),
                    )
                  }
                />
              ),
            },
          ]}
          action={{ label: "报价导出", onClick: () => downloadExport(actorId, "quote") }}
        />
        <DataTable
          title="客户订单"
          icon={ClipboardList}
          rows={snapshot.board.orders}
          columns={[
            { key: "order_no", label: "订单号" },
            { key: "customer_name", label: "客户" },
            { key: "product_name", label: "产品" },
            { key: "qty", label: "数量" },
            { key: "customer_po_no", label: "客户单号" },
            { key: "due_date", label: "交期", render: shortDate },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "id",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail(
                      makeDetail("客户订单详情", String(row.order_no), row, [
                        ["客户", "customer_name"],
                        ["产品", "product_name"],
                        ["订单数量", "qty"],
                        ["订单金额", "total_amount", formatCurrency],
                        ["客户订单号", "customer_po_no"],
                        ["销售合同号", "sales_contract_no"],
                        ["交付期限", "due_date", shortDate],
                        ["交付地址", "delivery_address"],
                        ["收货人", "consignee"],
                        ["联系电话", "contact_phone"],
                        ["账期天数", "payment_terms_days", dayValue],
                        ["状态", "status_label"],
                        ["特殊要求", "special_requirements"],
                        ["备注", "remark"],
                      ]),
                    )
                  }
                />
              ),
            },
          ]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="正式发货单录入" icon={Truck} action={canShip ? "自动生成应收" : "只读"}>
          {canShip && selectedShipProduction ? (
            <div className="grid gap-3">
              <MasterSelect
                label="待发货生产单"
                value={String(selectedShipProduction.id)}
                onChange={(value) => {
                  const next = shipReadyProductions.find((item) => String(item.id) === value);
                  const nextAvailable = next
                    ? snapshot.board.finishedBatches
                        .filter(
                          (batch) =>
                            batch.production_order_id === next.id &&
                            batch.kind === "finished" &&
                            batch.status === "available",
                        )
                        .reduce((sum, batch) => sum + Number(batch.qty ?? 0), 0)
                    : 0;
                  setShipmentForm((current) => ({
                    ...current,
                    production_id: value,
                    shipped_qty: nextAvailable > 0 ? String(nextAvailable) : current.shipped_qty,
                  }));
                }}
              >
                {shipReadyProductions.map((production) => (
                  <option key={String(production.id)} value={String(production.id)}>
                    {String(production.prod_no)} / {String(production.order_no)}
                  </option>
                ))}
              </MasterSelect>
              <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                当前可发成品：{formatQty(availableFinishedQty, selectedShipProduction?.unit ?? "件")}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <MasterInput label="发货数量" type="number" value={shipmentForm.shipped_qty} onChange={(value) => setShipmentField("shipped_qty", value)} />
                <MasterInput label="发货日期" type="date" value={shipmentForm.shipped_at} onChange={(value) => setShipmentField("shipped_at", value)} />
                <MasterInput label="收货人" value={shipmentForm.consignee} onChange={(value) => setShipmentField("consignee", value)} />
                <MasterInput label="联系电话" value={shipmentForm.contact_phone} onChange={(value) => setShipmentField("contact_phone", value)} />
                <MasterInput label="物流公司" value={shipmentForm.logistics_company} onChange={(value) => setShipmentField("logistics_company", value)} />
                <MasterInput label="车牌号" value={shipmentForm.vehicle_no} onChange={(value) => setShipmentField("vehicle_no", value)} />
              </div>
              <MasterInput label="物流单号" value={shipmentForm.tracking_no} onChange={(value) => setShipmentField("tracking_no", value)} />
              <MasterTextarea
                label="送货地址"
                value={shipmentForm.delivery_address}
                onChange={(value) => setShipmentField("delivery_address", value)}
              />
              <MasterInput label="发货备注" value={shipmentForm.remark} onChange={(value) => setShipmentField("remark", value)} />
              <MasterSubmitButton
                busy={busy === `createShipment-${String(selectedShipProduction.id)}-primary`}
                label="生成发货单"
                onClick={submitShipment}
              />
            </div>
          ) : (
            <EmptyText text={shipReadyProductions.length === 0 ? "暂无质检入库后的待发货成品" : "请切换商务内勤或管理员办理发货。"} />
          )}
        </Panel>
        <DataTable
          title="发货单"
          icon={Truck}
          rows={snapshot.board.shipments}
          columns={[
            { key: "shipment_no", label: "发货单号" },
            { key: "shipment_type_label", label: "类型" },
            { key: "order_no", label: "订单号" },
            { key: "customer_name", label: "客户" },
            { key: "product_name", label: "产品" },
            { key: "shipped_qty", label: "发货数量" },
            { key: "sales_amount", label: "销售金额", render: formatCurrency },
            { key: "cost_amount", label: "出库成本", render: formatCurrency },
            { key: "gross_profit", label: "毛利", render: formatCurrency },
            { key: "logistics_company", label: "物流" },
            { key: "financial_status", label: "回款", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "shipped_at", label: "发货日期", render: shortDate },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "print_preview",
              label: "打印",
              render: (_value, row) => (
                <div className="flex gap-2">
                  <InlineActionButton
                    label="预览"
                    onClick={() =>
                      setDeliveryPreview(
                        String(row.shipment_type ?? "standard") === "replacement"
                          ? buildReplacementShipmentPrintPreview(row)
                          : formalPrintFromDeliveryNote(buildDeliveryNotePreview(row)),
                      )
                    }
                  />
                  <InlineActionButton
                    label="导出"
                    onClick={() =>
                      downloadExport(
                        actorId,
                        String(row.shipment_type ?? "standard") === "replacement" ? "replacement-shipment" : "delivery-note",
                        row.id,
                      )
                    }
                  />
                </div>
              ),
            },
            {
              key: "id",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail(
                      makeDetail("发货单详情", String(row.shipment_no), row, [
                        ["订单号", "order_no"],
                        ["客户", "customer_name"],
                        ["产品", "product_name"],
                        ["发货数量", "shipped_qty"],
                        ["销售金额", "sales_amount", formatCurrency],
                        ["出库成本", "cost_amount", formatCurrency],
                        ["毛利", "gross_profit", formatCurrency],
                        ["毛利率", "gross_margin", percentNumberValue],
                        ["回款状态", "financial_status"],
                        ["发货人", "shipped_by_name"],
                        ["发货日期", "shipped_at", shortDate],
                        ["收货人", "consignee"],
                        ["联系电话", "contact_phone"],
                        ["送货地址", "delivery_address"],
                        ["物流公司", "logistics_company"],
                        ["车牌号", "vehicle_no"],
                        ["物流单号", "tracking_no"],
                        ["备注", "remark"],
                        ["状态", "status"],
                      ]),
                    )
                  }
                />
              ),
            },
          ]}
          action={{ label: "送货单", onClick: () => downloadExport(actorId, "delivery-note") }}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="销售退货登记" icon={RotateCcw} action={canReturn ? "退货入库 / 应收调整" : "只读"}>
          {canReturn && selectedReturnCandidate ? (
            <div className="grid gap-3">
              <MasterSelect
                label="可退发货单"
                value={String(selectedReturnCandidate.shipment_id)}
                onChange={(value) => {
                  const next = snapshot.board.salesReturnCandidates.find((item) => String(item.shipment_id) === value);
                  setReturnForm((current) => ({
                    ...current,
                    shipment_id: value,
                    return_qty: String(next?.returnable_qty ?? current.return_qty),
                  }));
                }}
              >
                {snapshot.board.salesReturnCandidates.map((candidate) => (
                  <option key={String(candidate.shipment_id)} value={String(candidate.shipment_id)}>
                    {String(candidate.shipment_no)} / {String(candidate.customer_name)} / 可退 {formatQty(candidate.returnable_qty, candidate.unit)}
                  </option>
                ))}
              </MasterSelect>
              <div className="grid gap-3 md:grid-cols-2">
                <MasterInput label="退货数量" type="number" value={returnForm.return_qty} onChange={(value) => setReturnField("return_qty", value)} />
                <MasterInput label="退货日期" type="date" value={returnForm.received_at} onChange={(value) => setReturnField("received_at", value)} />
              </div>
              <MasterSelect label="退货处置" value={returnForm.disposition} onChange={(value) => setReturnField("disposition", value)}>
                <option value="return_to_stock">退货入库，后续可补发</option>
                <option value="rework">返工处理</option>
                <option value="scrap">报废处理</option>
              </MasterSelect>
              <MasterTextarea label="退货原因" value={returnForm.reason} onChange={(value) => setReturnField("reason", value)} />
              <MasterInput label="退货备注" value={returnForm.note} onChange={(value) => setReturnField("note", value)} />
              <MasterSubmitButton
                busy={busy === `recordSalesReturn-${String(selectedReturnCandidate.shipment_id)}-primary`}
                label="登记退货"
                onClick={submitReturn}
              />
            </div>
          ) : (
            <EmptyText text={snapshot.board.salesReturnCandidates.length === 0 ? "暂无可退货的正式发货单。" : "请切换商务内勤、仓库或管理员登记退货。"} />
          )}
        </Panel>
        <Panel title="补开发货单" icon={Truck} action={canReplace ? "不重复生成应收" : "只读"}>
          {canReplace && selectedReplacementCandidate ? (
            <div className="grid gap-3">
              <MasterSelect
                label="待补发退货单"
                value={String(selectedReplacementCandidate.id)}
                onChange={(value) => setReplacementField("sales_return_id", value)}
              >
                {snapshot.board.replacementShipmentCandidates.map((candidate) => (
                  <option key={String(candidate.id)} value={String(candidate.id)}>
                    {String(candidate.return_no)} / {String(candidate.customer_name)} / {formatQty(candidate.return_qty, candidate.unit)}
                  </option>
                ))}
              </MasterSelect>
              <div className="grid gap-3 md:grid-cols-2">
                <MasterInput label="补发日期" type="date" value={replacementForm.shipped_at} onChange={(value) => setReplacementField("shipped_at", value)} />
                <MasterInput label="物流公司" value={replacementForm.logistics_company} onChange={(value) => setReplacementField("logistics_company", value)} />
              </div>
              <MasterInput label="物流单号" value={replacementForm.tracking_no} onChange={(value) => setReplacementField("tracking_no", value)} />
              <MasterInput label="补发备注" value={replacementForm.remark} onChange={(value) => setReplacementField("remark", value)} />
              <MasterSubmitButton
                busy={busy === `createReplacementShipment-${String(selectedReplacementCandidate.id)}-primary`}
                label="生成补发单"
                onClick={submitReplacement}
              />
            </div>
          ) : (
            <EmptyText text={snapshot.board.replacementShipmentCandidates.length === 0 ? "暂无待补发的退货单。" : "请切换商务内勤或管理员补发。"} />
          )}
        </Panel>
      </div>
      <DataTable
        title="销售退货单"
        icon={RotateCcw}
        rows={snapshot.board.salesReturns}
        columns={[
          { key: "return_no", label: "退货单号" },
          { key: "shipment_no", label: "原发货单" },
          { key: "customer_name", label: "客户" },
          { key: "product_name", label: "产品" },
          { key: "return_qty", label: "退货数量", render: (value, row) => formatQty(value, row.unit) },
          { key: "return_amount", label: "退货金额", render: formatCurrency },
          { key: "offset_amount", label: "应收抵减", render: formatCurrency },
          { key: "refund_due_amount", label: "待退金额", render: formatCurrency },
          { key: "refund_status", label: "退款", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "replacement_status", label: "补发", render: (value) => <StatusBadge value={String(value)} /> },
          {
            key: "return_print",
            label: "打印",
            render: (_value, row) => (
              <div className="flex gap-2">
                <InlineActionButton label="预览" onClick={() => setDeliveryPreview(buildSalesReturnPrintPreview(row))} />
                <InlineActionButton label="导出" onClick={() => downloadExport(actorId, "sales-return", row.id)} />
              </div>
            ),
          },
          { key: "received_at", label: "退货日期", render: shortDate },
        ]}
        action={{ label: "退货单导出", onClick: () => downloadExport(actorId, "sales-return") }}
      />
      <DataTable
        title="成品出库批次分摊"
        icon={PackageCheck}
        rows={snapshot.board.finishedShipmentAllocations}
        columns={[
          { key: "shipment_no", label: "发货单" },
          { key: "order_no", label: "订单号" },
          { key: "customer_name", label: "客户" },
          { key: "product_name", label: "产品" },
          { key: "batch_no", label: "成品批次" },
          { key: "qty", label: "出库数量", render: (value, row) => formatQty(value, row.unit) },
          { key: "unit_cost", label: "单位成本", render: formatCurrency },
          { key: "cost_amount", label: "出库成本", render: formatCurrency },
          { key: "created_at", label: "出库时间", render: shortDate },
        ]}
      />
      <DataTable
        title="销售应收"
        icon={Download}
        rows={snapshot.board.receivables}
        columns={[
          { key: "receivable_no", label: "应收单号" },
          { key: "shipment_no", label: "发货单" },
          { key: "customer_name", label: "客户" },
          { key: "total_amount", label: "应收金额", render: formatCurrency },
          { key: "adjusted_amount", label: "退货调整", render: formatCurrency },
          { key: "received_amount", label: "已收", render: formatCurrency },
          { key: "refund_due_amount", label: "待退款", render: formatCurrency },
          { key: "balance_amount", label: "余额", render: formatCurrency },
          { key: "due_date", label: "到期日", render: shortDate },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
        ]}
        action={{ label: "销售对账", onClick: () => downloadExport(actorId, "sales-statement") }}
      />
      <FormalPrintPreviewModal preview={deliveryPreview} onClose={() => setDeliveryPreview(null)} />
    </div>
  );
}

function FormalPrintPreviewModal({
  preview,
  onClose,
}: {
  preview: FormalPrintDocument | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-950/55 px-4 py-6">
      <div className="min-w-0 w-full max-w-[calc(210mm+48px)]">
        <div className="no-print mb-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xl">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-950">{preview.header.title}打印预览</p>
            <p className="mt-1 text-xs text-slate-500">
              {preview.templateName} / {preview.header.documentNo} / A4 正式版式
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Printer className="h-4 w-4" />
              打印
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-700"
              aria-label="关闭正式单据预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <section className="delivery-note-print-surface mx-auto box-border min-h-[297mm] w-[210mm] max-w-full bg-white px-[16mm] py-[14mm] text-slate-950 shadow-2xl">
          <header className="border-b-2 border-slate-950 pb-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold tracking-[0.18em] text-blue-700">{preview.eyebrow}</p>
                <h1 className="mt-2 text-[24px] font-bold tracking-normal">{preview.header.companyName}</h1>
                <p className="mt-2 text-[12px] text-slate-500">{preview.description}</p>
              </div>
              <div className="w-fit shrink-0 rounded-sm border-2 border-blue-700 px-5 py-2 text-center text-blue-700">
                <p className="text-[12px] font-semibold">{preview.header.statusText}</p>
                <p className="mt-1 text-[20px] font-bold">{preview.header.title}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-3">
              <PrintField label="单据编号" value={preview.header.documentNo} strong />
              <PrintField label="单据日期" value={preview.header.documentDate} strong />
              <PrintField label="打印日期" value={new Date().toISOString().slice(0, 10)} />
            </div>
          </header>

          <section className="mt-5 grid gap-4 text-[12px] md:grid-cols-2">
            {preview.fieldSections.map((section) => (
              <div
                key={section.title}
                className={`border border-slate-300 ${preview.fieldSections.length === 1 ? "md:col-span-2" : ""}`}
              >
                <PrintSectionTitle title={section.title} />
                <div className="grid grid-cols-2 gap-px bg-slate-200">
                  {section.fields.map((field) => (
                    <PrintGridCell
                      key={`${section.title}-${field.label}`}
                      label={field.label}
                      value={field.value}
                      wide={field.value.length > 24 || field.label.includes("地址") || field.label.includes("说明")}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>

          {preview.lineSections.map((section) => (
            <section key={section.title} className="mt-5">
              <PrintSectionTitle title={section.title} />
              <div className="overflow-x-auto print:overflow-visible">
                <table className="min-w-[640px] w-full border-collapse text-[12px] print:min-w-full">
                  <thead>
                    <tr className="bg-slate-100">
                      {section.columns.map((column) => (
                        <th
                          key={column.key}
                          className={`border border-slate-400 px-2 py-2 font-semibold ${printAlignClass(column.align)}`}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((line, index) => (
                      <tr key={`${section.title}-${String(line.lineNo ?? index)}`}>
                        {section.columns.map((column) => (
                          <td key={column.key} className={`border border-slate-300 px-2 py-3 ${printAlignClass(column.align)}`}>
                            {String(line[column.key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {Array.from({ length: Math.max((section.minRows ?? 0) - section.rows.length, 0) }).map((_, index) => (
                      <tr key={`${section.title}-blank-${index}`}>
                        {section.columns.map((column, columnIndex) => (
                          <td
                            key={`${section.title}-blank-${index}-${column.key}`}
                            className={`border border-slate-300 px-2 py-3 ${printAlignClass(column.align)}`}
                          >
                            {columnIndex === 0 ? <span className="text-slate-300">{section.rows.length + index + 1}</span> : <span>&nbsp;</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <section className="mt-5 rounded-sm border border-slate-300 bg-slate-50 px-3 py-3 text-[12px] leading-6 text-slate-700">
            <p className="font-semibold text-slate-950">{preview.notesTitle}</p>
            {preview.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </section>

          <section className="mt-8 grid grid-cols-4 gap-4 text-[12px]">
            {preview.signatures.map((signature) => (
              <div key={signature.label}>
                <div className="h-14 border-b border-slate-400" />
                <p className="mt-2 font-semibold">{signature.label}</p>
                <p className="mt-1 text-slate-500">{signature.hint}</p>
              </div>
            ))}
          </section>

          <footer className="mt-8 flex items-center justify-between border-t border-slate-300 pt-3 text-[11px] text-slate-500">
            <span>{preview.footerLeft}</span>
            <span>{preview.footerRight}</span>
          </footer>
        </section>
      </div>
    </div>
  );
}

function printAlignClass(align?: "left" | "right" | "center") {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

function DeliveryNotePreviewModal({
  preview,
  onClose,
}: {
  preview: DeliveryNotePreview | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-6">
      <div className="w-full max-w-[calc(210mm+48px)]">
        <div className="no-print mb-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xl">
          <div>
            <p className="text-sm font-semibold text-slate-950">送货单打印预览</p>
            <p className="mt-1 text-xs text-slate-500">{preview.header.documentNo} / A4 正式版式</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Printer className="h-4 w-4" />
              打印
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-700"
              aria-label="关闭送货单预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <section className="delivery-note-print-surface mx-auto min-h-[297mm] w-[210mm] max-w-full bg-white px-[16mm] py-[14mm] text-slate-950 shadow-2xl">
          <header className="border-b-2 border-slate-950 pb-5">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[13px] font-semibold tracking-[0.18em] text-blue-700">LOCAL ERP DELIVERY DOCUMENT</p>
                <h1 className="mt-2 text-[24px] font-bold tracking-normal">{preview.header.companyName}</h1>
                <p className="mt-2 text-[12px] text-slate-500">生产流转系统自动生成，适用于送货、签收、对账和内部归档</p>
              </div>
              <div className="shrink-0 rounded-sm border-2 border-blue-700 px-5 py-2 text-center text-blue-700">
                <p className="text-[12px] font-semibold">{preview.header.statusText}</p>
                <p className="mt-1 text-[20px] font-bold">{preview.header.title}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-[12px]">
              <PrintField label="单据编号" value={preview.header.documentNo} strong />
              <PrintField label="发货日期" value={preview.header.documentDate} strong />
              <PrintField label="打印日期" value={new Date().toISOString().slice(0, 10)} />
            </div>
          </header>

          <section className="mt-5 grid grid-cols-2 gap-4 text-[12px]">
            <div className="border border-slate-300">
              <PrintSectionTitle title="客户与订单" />
              <div className="grid grid-cols-2 gap-px bg-slate-200">
                <PrintGridCell label="客户名称" value={preview.parties.customerName} wide />
                <PrintGridCell label="销售订单" value={preview.parties.orderNo} />
                <PrintGridCell label="客户单号" value={preview.parties.customerPoNo} />
                <PrintGridCell label="销售合同" value={preview.parties.salesContractNo} wide />
              </div>
            </div>
            <div className="border border-slate-300">
              <PrintSectionTitle title="收货与物流" />
              <div className="grid grid-cols-2 gap-px bg-slate-200">
                <PrintGridCell label="收货人" value={preview.logistics.consignee} />
                <PrintGridCell label="联系电话" value={preview.logistics.phone} />
                <PrintGridCell label="物流公司" value={preview.logistics.logisticsCompany} />
                <PrintGridCell label="车牌号" value={preview.logistics.vehicleNo} />
                <PrintGridCell label="物流单号" value={preview.logistics.trackingNo} wide />
                <PrintGridCell label="送货地址" value={preview.logistics.deliveryAddress} wide />
              </div>
            </div>
          </section>

          <section className="mt-5">
            <PrintSectionTitle title="货品明细" />
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-slate-100">
                  {["序号", "产品名称", "规格型号", "批次号", "数量", "单位", "备注"].map((label) => (
                    <th key={label} className="border border-slate-400 px-2 py-2 text-left font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => (
                  <tr key={line.lineNo}>
                    <td className="border border-slate-300 px-2 py-3">{line.lineNo}</td>
                    <td className="border border-slate-300 px-2 py-3 font-semibold">{line.productName}</td>
                    <td className="border border-slate-300 px-2 py-3">{line.spec}</td>
                    <td className="border border-slate-300 px-2 py-3">{line.batchNo}</td>
                    <td className="border border-slate-300 px-2 py-3 text-right font-semibold">{line.qty}</td>
                    <td className="border border-slate-300 px-2 py-3">{line.unit}</td>
                    <td className="border border-slate-300 px-2 py-3">{line.remark}</td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(4 - preview.lines.length, 0) }).map((_, index) => (
                  <tr key={`blank-${index}`}>
                    <td className="border border-slate-300 px-2 py-3 text-slate-300">{preview.lines.length + index + 1}</td>
                    <td className="border border-slate-300 px-2 py-3">&nbsp;</td>
                    <td className="border border-slate-300 px-2 py-3">&nbsp;</td>
                    <td className="border border-slate-300 px-2 py-3">&nbsp;</td>
                    <td className="border border-slate-300 px-2 py-3">&nbsp;</td>
                    <td className="border border-slate-300 px-2 py-3">&nbsp;</td>
                    <td className="border border-slate-300 px-2 py-3">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mt-5 rounded-sm border border-slate-300 bg-slate-50 px-3 py-3 text-[12px] leading-6 text-slate-700">
            <p className="font-semibold text-slate-950">签收说明</p>
            {preview.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </section>

          <section className="mt-8 grid grid-cols-4 gap-4 text-[12px]">
            {preview.signatures.map((signature) => (
              <div key={signature.label}>
                <div className="h-14 border-b border-slate-400" />
                <p className="mt-2 font-semibold">{signature.label}</p>
                <p className="mt-1 text-slate-500">{signature.hint}</p>
              </div>
            ))}
          </section>

          <footer className="mt-8 flex items-center justify-between border-t border-slate-300 pt-3 text-[11px] text-slate-500">
            <span>第一联：客户签收联 / 第二联：公司存根联</span>
            <span>系统留痕编号：{preview.header.documentNo}</span>
          </footer>
        </section>
      </div>
    </div>
  );
}

function PrintField({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="border border-slate-300 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`mt-1 ${strong ? "font-bold" : "font-semibold"}`}>{value}</p>
    </div>
  );
}

function PrintSectionTitle({ title }: { title: string }) {
  return <div className="bg-slate-950 px-3 py-2 text-[12px] font-semibold text-white">{title}</div>;
}

function PrintGridCell({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`bg-white px-3 py-2 ${wide ? "col-span-2" : ""}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 min-h-5 font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ProductionDocumentPreviewModal({
  preview,
  onClose,
}: {
  preview: FormalDocumentPreview | null;
  onClose: () => void;
}) {
  if (!preview) return null;
  const lineKeys = preview.lines.length > 0 ? Object.keys(preview.lines[0]) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-6">
      <div className="w-full max-w-[calc(210mm+48px)]">
        <div className="no-print mb-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xl">
          <div>
            <p className="text-sm font-semibold text-slate-950">{preview.header.title}打印预览</p>
            <p className="mt-1 text-xs text-slate-500">{preview.header.documentNo} / A4 正式版式</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Printer className="h-4 w-4" />
              打印
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-700"
              aria-label="关闭生产单据预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <section className="delivery-note-print-surface mx-auto min-h-[297mm] w-[210mm] max-w-full bg-white px-[16mm] py-[14mm] text-slate-950 shadow-2xl">
          <header className="border-b-2 border-slate-950 pb-5">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[13px] font-semibold tracking-[0.18em] text-blue-700">LOCAL ERP BUSINESS DOCUMENT</p>
                <h1 className="mt-2 text-[24px] font-bold tracking-normal">{preview.header.companyName}</h1>
                <p className="mt-2 text-[12px] text-slate-500">订单驱动的业务流转单据，自动记录审批、批次、成本和追溯信息</p>
              </div>
              <div className="shrink-0 rounded-sm border-2 border-blue-700 px-5 py-2 text-center text-blue-700">
                <p className="text-[12px] font-semibold">{preview.header.statusText}</p>
                <p className="mt-1 text-[20px] font-bold">{preview.header.title}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-[12px]">
              <PrintField label="单据编号" value={preview.header.documentNo} strong />
              <PrintField label="单据日期" value={preview.header.documentDate} strong />
              <PrintField label="打印日期" value={new Date().toISOString().slice(0, 10)} />
            </div>
          </header>

          <section className="mt-5 border border-slate-300">
            <PrintSectionTitle title="基本信息" />
            <div className="grid grid-cols-3 gap-px bg-slate-200 text-[12px]">
              {preview.fields.map((field) => (
                <PrintGridCell key={field.label} label={field.label} value={field.value} wide={field.value.length > 22} />
              ))}
            </div>
          </section>

          {preview.lines.length > 0 ? (
            <section className="mt-5">
              <PrintSectionTitle title="明细行" />
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-slate-100">
                    {lineKeys.map((key) => (
                      <th key={key} className="border border-slate-400 px-2 py-2 text-left font-semibold">
                        {productionPrintColumnLabel(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line, index) => (
                    <tr key={String(line.lineNo ?? index)}>
                      {lineKeys.map((key) => (
                        <td key={key} className="border border-slate-300 px-2 py-3">
                          {String(line[key] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="mt-5 rounded-sm border border-slate-300 bg-slate-50 px-3 py-3 text-[12px] leading-6 text-slate-700">
            <p className="font-semibold text-slate-950">执行说明</p>
            {preview.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </section>

          <section className="mt-8 grid grid-cols-4 gap-4 text-[12px]">
            {preview.signatures.map((signature) => (
              <div key={signature.label}>
                <div className="h-14 border-b border-slate-400" />
                <p className="mt-2 font-semibold">{signature.label}</p>
                <p className="mt-1 text-slate-500">{signature.hint}</p>
              </div>
            ))}
          </section>
        </section>
      </div>
    </div>
  );
}

function productionPrintColumnLabel(key: string) {
  return (
    {
      lineNo: "序号",
      materialCode: "物料编码",
      materialName: "物料名称",
      requiredQty: "需求量",
      unit: "单位",
      usage: "用途",
      remark: "备注",
      bomMaterial: "BOM物料",
      issuedMaterial: "实际出库物料",
      batchNo: "批次",
      qty: "数量",
      unitCost: "批次成本",
      amount: "金额",
      mode: "发料模式",
    }[key] ?? detailColumnLabel(key)
  );
}

function averageProductionProgress(rows: Row[]) {
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((sum, row) => sum + productionProgressPercent(row.status), 0) / rows.length);
}

function buildMachineLoadRows(productions: Row[]): Row[] {
  const grouped = new Map<string, Row & { owners_set: Set<string> }>();
  productions
    .filter((production) => production.planned_date || production.machine)
    .forEach((production) => {
      const plannedDate = String(production.planned_date ?? "未排产");
      const machine = String(production.machine ?? "未指定机台");
      const key = `${plannedDate}-${machine}`;
      const current =
        grouped.get(key) ??
        ({
          id: key,
          plan_key: `${plannedDate} / ${machine}`,
          planned_date: plannedDate,
          machine,
          order_count: 0,
          planned_qty: 0,
          owners_set: new Set<string>(),
        } as Row & { owners_set: Set<string> });
      current.order_count = Number(current.order_count ?? 0) + 1;
      current.planned_qty = Number(current.planned_qty ?? 0) + Number(production.order_qty ?? 0);
      current.owners_set.add(String(production.owner ?? "-"));
      grouped.set(key, current);
    });

  return Array.from(grouped.values())
    .map((row): Row => {
      const orderCount = Number(row.order_count ?? 0);
      return {
        ...row,
        owners: Array.from(row.owners_set).filter(Boolean).join("、"),
        load_status: orderCount >= 4 ? "overload" : orderCount >= 2 ? "normal_load" : "light_load",
        load_status_label: orderCount >= 4 ? "超负荷" : orderCount >= 2 ? "正常" : "空闲",
      };
    })
    .sort((a, b) => String(a.planned_date).localeCompare(String(b.planned_date)) || String(a.machine).localeCompare(String(b.machine)));
}

function buildProductionCalendar(productions: Row[], fallbackMachines: string[]) {
  const scheduled = productions
    .filter((production) => production.planned_date)
    .sort(
      (a, b) =>
        String(a.planned_date).localeCompare(String(b.planned_date)) ||
        String(a.machine ?? "").localeCompare(String(b.machine ?? "")) ||
        String(a.prod_no ?? "").localeCompare(String(b.prod_no ?? "")),
    );
  const dates = Array.from(new Set(scheduled.map((production) => String(production.planned_date).slice(0, 10))));
  const machines = Array.from(
    new Set([
      ...scheduled.map((production) => String(production.machine ?? "").trim() || "未指定机台"),
      ...fallbackMachines.filter(Boolean),
    ]),
  ).slice(0, 6);
  const rows = dates.map((date) => {
    const cells = machines.map((machine) => {
      const cellProductions = scheduled.filter(
        (production) =>
          String(production.planned_date).slice(0, 10) === date &&
          (String(production.machine ?? "").trim() || "未指定机台") === machine,
      );
      const taskCount = cellProductions.length;
      const plannedQty = cellProductions.reduce((sum, production) => sum + Number(production.order_qty ?? 0), 0);
      const riskCount = cellProductions.filter((production) => String(production.delivery_risk_status ?? "normal") !== "normal").length;
      const owners = Array.from(new Set(cellProductions.map((production) => String(production.owner ?? "")).filter(Boolean))).join("、");
      return {
        id: `${date}-${machine}`,
        date,
        machine,
        productions: cellProductions,
        taskCount,
        plannedQty,
        riskCount,
        owners,
        loadStatusLabel: taskCount >= 4 ? "超负荷" : taskCount >= 2 ? "正常" : taskCount === 1 ? "空闲" : "暂无数据",
      };
    });
    return {
      date,
      cells,
      taskCount: cells.reduce((sum, cell) => sum + cell.taskCount, 0),
      plannedQty: cells.reduce((sum, cell) => sum + cell.plannedQty, 0),
      riskCount: cells.reduce((sum, cell) => sum + cell.riskCount, 0),
    };
  });
  return { dates, machines, rows };
}

function ProductionModule({
  snapshot,
  currentUser,
  busy,
  runAction,
  fileInputRef,
  uploadBom,
  openDetail,
}: {
  snapshot: Snapshot;
  currentUser?: User;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadBom: () => Promise<void>;
  openDetail: (detail: DetailState) => void;
}) {
  const canIssue = ["warehouse", "admin"].includes(currentUser?.role ?? "");
  const canCreateInstruction = ["assistant", "admin"].includes(currentUser?.role ?? "");
  const canSchedule = ["production", "admin"].includes(currentUser?.role ?? "");
  const canReport = ["production", "admin"].includes(currentUser?.role ?? "");
  const productionDailyReports = snapshot.board.productionDailyReports ?? [];
  const submittedOrders = snapshot.board.orders.filter((item) => item.status === "submitted");
  const instructedProductions = snapshot.board.productions.filter((item) => item.status === "instructed");
  const activeProductions = snapshot.board.productions.filter((item) => !["shipped", "voided", "cancelled"].includes(String(item.status)));
  const scheduleChangeCandidates = activeProductions.filter((item) => item.planned_date);
  const machineOptions = Array.from(
    new Set(snapshot.board.productions.map((item) => String(item.machine ?? "")).filter(Boolean)),
  );
  const reportableProductions = snapshot.board.productions.filter((item) =>
    ["producing", "inspection_requested", "qa_failed", "qa_approved", "in_stock"].includes(String(item.status)),
  );
  const [planningStatusFilter, setPlanningStatusFilter] = useState("all");
  const [planningMachineFilter, setPlanningMachineFilter] = useState("all");
  const [instructionForm, setInstructionForm] = useState<Record<string, string>>({
    order_id: String(submittedOrders[0]?.id ?? ""),
    priority: "normal",
    instruction_note: "按客户订单要求组织生产，并保留批次追溯。",
    technical_requirements: "按系统当前启用 BOM 和工艺要求执行。",
  });
  const [scheduleForm, setScheduleForm] = useState<Record<string, string>>({
    production_id: String(instructedProductions[0]?.id ?? ""),
    planned_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString().slice(0, 10),
    machine: "CNC-02",
    owner: "马工",
    shift: "白班",
    schedule_note: "按订单交期优先安排。",
    requisition_note: "按系统计算需求量领料，仓库默认 FIFO 发料。",
  });
  const [rescheduleForm, setRescheduleForm] = useState<Record<string, string>>({
    production_id: String(scheduleChangeCandidates[0]?.id ?? ""),
    planned_date: String(scheduleChangeCandidates[0]?.planned_date ?? new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString().slice(0, 10)),
    machine: String(scheduleChangeCandidates[0]?.machine ?? "CNC-02"),
    owner: String(scheduleChangeCandidates[0]?.owner ?? "马工"),
    shift: String(scheduleChangeCandidates[0]?.shift ?? "白班"),
    schedule_note: String(scheduleChangeCandidates[0]?.schedule_note ?? "按最新交付优先级调整排产。"),
    change_reason: "生产资源或订单交期变化，按正式排产变更流程留痕。",
  });
  const [dailyReportForm, setDailyReportForm] = useState<Record<string, string>>({
    production_id: String(reportableProductions[0]?.id ?? ""),
    report_date: new Date().toISOString().slice(0, 10),
    shift: "白班",
    planned_qty: String(reportableProductions[0]?.order_qty ?? ""),
    finished_qty: "",
    good_qty: "",
    defect_qty: "0",
    scrap_qty: "0",
    work_hours: "8",
    abnormal_note: "",
  });
  const [planLockForm, setPlanLockForm] = useState<Record<string, string>>({
    date_from: new Date().toISOString().slice(0, 10),
    date_to: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10),
    note: "生产计划锁版，提交管理层审批后发布执行。",
  });
  const [planPreview, setPlanPreview] = useState<FormalPrintDocument | null>(null);
  const [productionPreview, setProductionPreview] = useState<FormalPrintDocument | null>(null);
  const [requisitionPreview, setRequisitionPreview] = useState<FormalPrintDocument | null>(null);
  const [issuePreview, setIssuePreview] = useState<FormalPrintDocument | null>(null);
  const selectedOrder = submittedOrders.find((item) => String(item.id) === instructionForm.order_id) ?? submittedOrders[0];
  const selectedProduction =
    instructedProductions.find((item) => String(item.id) === scheduleForm.production_id) ?? instructedProductions[0];
  const selectedRescheduleProduction =
    scheduleChangeCandidates.find((item) => String(item.id) === rescheduleForm.production_id) ?? scheduleChangeCandidates[0];
  const selectedReportProduction =
    reportableProductions.find((item) => String(item.id) === dailyReportForm.production_id) ?? reportableProductions[0];
  const planningRows = activeProductions.filter((item) => {
    const statusMatch = planningStatusFilter === "all" || String(item.status) === planningStatusFilter;
    const machineMatch = planningMachineFilter === "all" || String(item.machine ?? "") === planningMachineFilter;
    return statusMatch && machineMatch;
  });
  const machineLoadRows = buildMachineLoadRows(planningRows);
  const deliveryWarnings = snapshot.board.productionDeliveryWarnings ?? [];
  const planningIdSet = new Set(planningRows.map((item) => String(item.id)));
  const visibleDeliveryWarnings = deliveryWarnings.filter((item) => planningIdSet.has(String(item.production_order_id)));
  const productionCalendar = buildProductionCalendar(planningRows, machineOptions);
  const productionPlanFilterLabel = [
    planningStatusFilter === "all" ? "状态：全部" : `状态：${productionStatusLabel(planningStatusFilter)}`,
    planningMachineFilter === "all" ? "机台：全部" : `机台：${planningMachineFilter}`,
  ].join("；");
  const setInstructionField = (key: string, value: string) =>
    setInstructionForm((current) => ({ ...current, [key]: value }));
  const setScheduleField = (key: string, value: string) => setScheduleForm((current) => ({ ...current, [key]: value }));
  const setRescheduleField = (key: string, value: string) =>
    setRescheduleForm((current) => ({ ...current, [key]: value }));
  const setDailyReportField = (key: string, value: string) =>
    setDailyReportForm((current) => ({ ...current, [key]: value }));
  const setPlanLockField = (key: string, value: string) =>
    setPlanLockForm((current) => ({ ...current, [key]: value }));
  const selectRescheduleProduction = (value: string) => {
    const next = scheduleChangeCandidates.find((item) => String(item.id) === value);
    setRescheduleForm({
      production_id: value,
      planned_date: String(next?.planned_date ?? rescheduleForm.planned_date),
      machine: String(next?.machine ?? rescheduleForm.machine),
      owner: String(next?.owner ?? rescheduleForm.owner),
      shift: String(next?.shift ?? rescheduleForm.shift),
      schedule_note: String(next?.schedule_note ?? rescheduleForm.schedule_note),
      change_reason: "生产资源或订单交期变化，按正式排产变更流程留痕。",
    });
  };
  const submitInstruction = async () => {
    if (!selectedOrder) return;
    await runAction({
      action: "createProductionInstruction",
      entityId: String(selectedOrder.id),
      payload: instructionForm,
    });
  };
  const submitSchedule = async () => {
    if (!selectedProduction) return;
    await runAction({
      action: "scheduleAndGenerateRequisition",
      entityId: String(selectedProduction.id),
      payload: scheduleForm,
    });
  };
  const submitReschedule = async () => {
    if (!selectedRescheduleProduction) return;
    await runAction({
      action: "updateProductionSchedule",
      entityId: String(selectedRescheduleProduction.id),
      payload: rescheduleForm,
    });
  };
  const submitDailyReport = async () => {
    if (!selectedReportProduction) return;
    await runAction({
      action: "createProductionDailyReport",
      entityId: String(selectedReportProduction.id),
      payload: dailyReportForm,
    });
  };
  const previewProductionPlan = () => {
    setPlanPreview(
      buildProductionPlanPrintPreview({
        plan_no: `SCJH-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`,
        generated_at: new Date().toISOString(),
        generated_by_name: currentUser?.name ?? snapshot.currentUser.name,
        filters_label: productionPlanFilterLabel,
        rows: planningRows,
        calendarRows: machineLoadRows,
        warningRows: visibleDeliveryWarnings,
      }),
    );
  };
  const submitPlanLock = async () => {
    await runAction({
      action: "lockProductionPlan",
      payload: planLockForm,
    });
  };
  const acknowledgePlanNotification = async (notification: Row) => {
    await runAction({
      action: "ackProductionPlanNotification",
      entityId: String(notification.id),
      payload: { acknowledge_note: `${currentUser?.role_label ?? "当前岗位"}已确认生产计划变更。` },
    });
  };
  const resolvePlanChangeImpact = async (impact: Row) => {
    const impactType = String(impact.impact_type);
    const linkedPayload =
      impactType === "purchase_arrival"
        ? {
            new_arrival_date: String(impact.new_planned_date ?? new Date().toISOString().slice(0, 10)),
            resolution_note: `${currentUser?.role_label ?? "当前岗位"}已调整采购到货计划并生成/更新到货通知单。`,
          }
        : impactType === "material_requisition"
          ? {
              adjustment_type: "check",
              suggested_qty: "0",
              resolution_note: `${currentUser?.role_label ?? "当前岗位"}已生成补退料复核建议单。`,
            }
          : impactType === "quality_window"
            ? {
                inspection_window_date: String(impact.new_planned_date ?? new Date().toISOString().slice(0, 10)),
                inspector: currentUser?.name ?? "",
                resolution_note: `${currentUser?.role_label ?? "当前岗位"}已确认质检窗口。`,
              }
            : impactType === "delivery_commitment"
              ? {
                  proposed_delivery_date: String(impact.new_planned_date ?? new Date().toISOString().slice(0, 10)),
                  contact_method: "系统确认",
                  customer_feedback: "已形成客户交期确认记录，待商务补充客户最终反馈。",
                  resolution_note: `${currentUser?.role_label ?? "当前岗位"}已生成客户交期确认记录。`,
                }
              : { resolution_note: `${currentUser?.role_label ?? "当前岗位"}已处理生产计划变更影响并同步责任事项。` };
    await runAction({
      action: "resolveProductionPlanChangeImpact",
      entityId: String(impact.id),
      payload: linkedPayload,
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MiniMetric label="生产单" value={`${snapshot.board.productions.length} 单`} />
        <MiniMetric label="在制计划" value={`${activeProductions.length} 单`} />
        <MiniMetric label="交期预警" value={`${deliveryWarnings.length} 条`} />
        <MiniMetric label="排产变更" value={`${snapshot.board.productionScheduleChanges.length} 次`} />
        <MiniMetric label="待审批" value={`${snapshot.board.requisitions.filter((item) => item.status === "pending_approval").length} 单`} />
        <MiniMetric label="待发料" value={`${snapshot.board.requisitions.filter((item) => item.status === "approved" || item.status === "pending").length} 单`} />
        <MiniMetric label="生产中" value={`${snapshot.board.productions.filter((item) => item.status === "producing").length} 单`} />
        <MiniMetric label="生产日报" value={`${productionDailyReports.length} 张`} />
        <MiniMetric label="变更影响" value={`${snapshot.board.productionPlanChangeImpacts.filter((item) => item.status === "pending").length} 项`} />
        <MiniMetric label="已发货" value={`${snapshot.board.productions.filter((item) => item.status === "shipped").length} 单`} />
      </div>
      <Panel title="生产计划中心" icon={Factory} action="排产 / 负荷 / 交期预警">
        <div className="grid gap-3 md:grid-cols-4">
          <MasterSelect label="状态筛选" value={planningStatusFilter} onChange={setPlanningStatusFilter}>
            <option value="all">全部状态</option>
            <option value="instructed">待排产</option>
            <option value="material_requested">待发料</option>
            <option value="producing">生产中</option>
            <option value="inspection_requested">待品控</option>
            <option value="qa_approved">待入库</option>
            <option value="in_stock">待发货</option>
          </MasterSelect>
          <MasterSelect label="机台筛选" value={planningMachineFilter} onChange={setPlanningMachineFilter}>
            <option value="all">全部机台</option>
            {machineOptions.map((machine) => (
              <option key={machine} value={machine}>
                {machine}
              </option>
            ))}
          </MasterSelect>
          <MiniMetric label="筛选结果" value={`${planningRows.length} 单`} />
          <MiniMetric label="平均进度" value={`${averageProductionProgress(planningRows)}%`} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <InlineActionButton label="打印预览" onClick={previewProductionPlan} />
          <InlineActionButton
            label="导出 XLSX"
            onClick={() => downloadExport(snapshot.currentUser.id, "production-plan", undefined, "xlsx")}
          />
          <InlineActionButton
            label="导出 CSV"
            onClick={() => downloadExport(snapshot.currentUser.id, "production-plan", undefined, "csv")}
          />
          <span className="text-xs text-slate-500">当前范围：{productionPlanFilterLabel}</span>
        </div>
      </Panel>
      <Panel
        title="生产排程日历视图"
        icon={CalendarDays}
        action={`${productionCalendar.dates.length} 天 / ${productionCalendar.machines.length} 台机台`}
      >
        {productionCalendar.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[980px] space-y-2">
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `136px repeat(${productionCalendar.machines.length}, minmax(210px, 1fr))` }}
              >
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  计划日期
                </div>
                {productionCalendar.machines.map((machine) => (
                  <div
                    key={machine}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700"
                  >
                    {machine}
                  </div>
                ))}
              </div>
              {productionCalendar.rows.map((day) => (
                <div
                  key={day.date}
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `136px repeat(${productionCalendar.machines.length}, minmax(210px, 1fr))` }}
                >
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                    <p className="text-sm font-semibold text-slate-950">{day.date}</p>
                    <p className="mt-1 text-xs text-slate-500">{day.taskCount} 单 / {formatQty(day.plannedQty)}</p>
                    {day.riskCount > 0 ? <p className="mt-2 text-xs font-semibold text-rose-600">{day.riskCount} 条交期风险</p> : null}
                  </div>
                  {day.cells.map((cell) => (
                    <div
                      key={cell.id}
                      className={`min-h-[132px] rounded-md border px-3 py-3 ${
                        cell.taskCount > 0 ? "border-blue-100 bg-blue-50/40" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-slate-600">{cell.owners || "未指定负责人"}</span>
                        <StatusBadge
                          value={cell.loadStatusLabel}
                          tone={cell.riskCount > 0 ? "warning" : cell.taskCount > 0 ? "success" : undefined}
                        />
                      </div>
                      <div className="mt-2 space-y-2">
                        {cell.productions.length > 0 ? (
                          cell.productions.map((production) => (
                            <div key={String(production.id)} className="rounded-md border border-white bg-white px-2.5 py-2 shadow-sm">
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 truncate text-xs font-semibold text-slate-950">{String(production.prod_no)}</p>
                                <span className="shrink-0 text-[11px] text-slate-500">{String(production.shift ?? "-")}</span>
                              </div>
                              <p className="mt-1 truncate text-xs text-slate-600">{String(production.product_name ?? "-")}</p>
                              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                <span>{formatQty(production.order_qty, production.unit)}</span>
                                <span>交期 {shortDate(production.due_date)}</span>
                              </div>
                              {String(production.delivery_risk_status ?? "normal") !== "normal" ? (
                                <p className="mt-1 text-[11px] font-semibold text-rose-600">{String(production.delivery_risk_label)}</p>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <div className="grid min-h-20 place-items-center rounded-md border border-dashed border-slate-200 text-xs text-slate-400">
                            暂无排产
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyText text="暂无已排产生产单，完成排产后将按日期和机台自动生成日历视图。" />
        )}
      </Panel>
      <Panel title="生产计划锁版 / 审批发布" icon={FileCheck2} action={canSchedule ? "锁版后进入审批中心" : "只读"}>
        {canSchedule ? (
          <div className="grid gap-3 xl:grid-cols-[160px_160px_1fr_auto]">
            <MasterInput
              label="计划开始"
              type="date"
              value={planLockForm.date_from}
              onChange={(value) => setPlanLockField("date_from", value)}
            />
            <MasterInput
              label="计划结束"
              type="date"
              value={planLockForm.date_to}
              onChange={(value) => setPlanLockField("date_to", value)}
            />
            <MasterInput label="锁版说明" value={planLockForm.note} onChange={(value) => setPlanLockField("note", value)} />
            <div className="flex items-end">
              <MasterSubmitButton
                busy={busy === "lockProductionPlan-system-primary"}
                label="锁版并提交审批"
                onClick={submitPlanLock}
              />
            </div>
          </div>
        ) : (
          <EmptyText text="请切换生产主管或管理员进行计划锁版；管理层在审批中心完成发布。" />
        )}
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <DataTable
          title="生产计划发布版本"
          icon={FileCheck2}
          rows={snapshot.board.productionPlanVersions}
          empty="暂无生产计划锁版记录"
          columns={[
            { key: "plan_no", label: "计划编号" },
            { key: "version_no", label: "版本" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "line_count", label: "计划单数" },
            { key: "machine_count", label: "机台" },
            { key: "warning_count", label: "预警" },
            { key: "approval_request_no", label: "审批单" },
            { key: "locked_by_name", label: "锁版人" },
            { key: "locked_at", label: "锁版时间", render: shortDate },
            { key: "published_by_name", label: "发布人" },
            { key: "published_at", label: "发布时间", render: shortDate },
            { key: "filter_summary", label: "范围" },
            { key: "approval_note", label: "审批意见" },
          ]}
        />
        <DataTable
          title="计划变更通知待办"
          icon={BellRing}
          rows={snapshot.board.productionPlanNotifications}
          empty="暂无发布后计划变更通知"
          columns={[
            { key: "notification_no", label: "通知单" },
            { key: "recipient_role_label", label: "责任岗位" },
            { key: "prod_no", label: "生产单" },
            { key: "plan_no", label: "计划版本" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "new_planned_date", label: "新日期", render: shortDate },
            { key: "new_machine", label: "新机台" },
            {
              key: "ack",
              label: "确认",
              render: (_value, row) => {
                const canAck =
                  String(row.status) === "pending" &&
                  (currentUser?.role === row.recipient_role || currentUser?.role === "admin" || (currentUser?.role === "manager" && row.recipient_role === "manager"));
                return canAck ? (
                  <InlineActionButton
                    label="确认"
                    busy={busy === `ackProductionPlanNotification-${String(row.id)}-primary`}
                    onClick={() => void acknowledgePlanNotification(row)}
                  />
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                );
              },
            },
          ]}
        />
      </div>
      <DataTable
        title="生产计划变更影响清单"
        icon={AlertTriangle}
        rows={snapshot.board.productionPlanChangeImpacts}
        empty="暂无生产计划变更影响"
        columns={[
          { key: "impact_no", label: "影响单号" },
          { key: "impact_type_label", label: "影响类型" },
          { key: "affected_role_label", label: "责任岗位" },
          { key: "severity_label", label: "等级", render: (value, row) => <StatusBadge value={String(value)} tone={["high", "critical"].includes(String(row.severity)) ? "warning" : undefined} /> },
          { key: "prod_no", label: "生产单" },
          { key: "source_document_no", label: "关联单据" },
          { key: "old_value", label: "变更前" },
          { key: "new_value", label: "变更后" },
          { key: "summary", label: "影响说明" },
          { key: "suggested_action", label: "建议动作" },
          { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "resolved_by_name", label: "处理人" },
          { key: "resolved_at", label: "处理时间", render: shortDate },
          {
            key: "resolve",
            label: "处理",
            render: (_value, row) => {
              const canResolve =
                String(row.status) === "pending" &&
                (currentUser?.role === row.affected_role || currentUser?.role === "admin" || currentUser?.role === "manager");
              return canResolve ? (
                <InlineActionButton
                  label="处理"
                  busy={busy === `resolveProductionPlanChangeImpact-${String(row.id)}-primary`}
                  onClick={() => void resolvePlanChangeImpact(row)}
                />
              ) : (
                <span className="text-xs text-slate-400">-</span>
              );
            },
          },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <DataTable
          title="补退料建议单"
          icon={PackageCheck}
          rows={snapshot.board.productionMaterialAdjustmentSuggestions}
          empty="暂无补退料建议"
          columns={[
            { key: "suggestion_no", label: "建议单号" },
            { key: "prod_no", label: "生产单" },
            { key: "req_no", label: "领料单" },
            { key: "adjustment_type_label", label: "类型", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "suggested_qty", label: "建议数量", render: (value) => formatQty(value) },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "created_by_name", label: "创建人" },
          ]}
        />
        <DataTable
          title="质检窗口确认"
          icon={ClipboardCheck}
          rows={snapshot.board.qualityInspectionWindowConfirmations}
          empty="暂无质检窗口确认"
          columns={[
            { key: "window_no", label: "确认单号" },
            { key: "prod_no", label: "生产单" },
            { key: "inspection_no", label: "请验单" },
            { key: "inspection_window_date", label: "检验日期", render: shortDate },
            { key: "inspector", label: "检验员" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          ]}
        />
        <DataTable
          title="客户交期确认"
          icon={MessagesSquare}
          rows={snapshot.board.customerDeliveryConfirmations}
          empty="暂无客户交期确认"
          columns={[
            { key: "confirmation_no", label: "确认单号" },
            { key: "order_no", label: "订单号" },
            { key: "customer_name", label: "客户" },
            { key: "original_due_date", label: "原交期", render: shortDate },
            { key: "proposed_delivery_date", label: "建议交期", render: shortDate },
            { key: "confirmation_status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          ]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <DataTable
          title="生产计划台账"
          icon={Factory}
          rows={planningRows}
          empty="暂无符合条件的生产计划"
          columns={[
            { key: "prod_no", label: "生产单" },
            { key: "order_no", label: "订单号" },
            { key: "customer_name", label: "客户" },
            { key: "product_name", label: "产品" },
            { key: "planned_date", label: "计划日期", render: shortDate },
            { key: "due_date", label: "交付期限", render: shortDate },
            { key: "machine", label: "机台" },
            { key: "owner", label: "负责人" },
            { key: "shift", label: "班次" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "delivery_risk_label", label: "交期风险", render: (value, row) => <StatusBadge value={String(value)} tone={String(row.delivery_risk_status) === "normal" ? "success" : "warning"} /> },
            { key: "schedule_change_count", label: "变更" },
          ]}
        />
        <div className="space-y-5">
          <DataTable
            title="机台负荷"
            icon={Gauge}
            rows={machineLoadRows}
            empty="暂无机台负荷"
            columns={[
              { key: "plan_key", label: "日期/机台" },
              { key: "order_count", label: "任务数" },
              { key: "planned_qty", label: "计划量", render: (value) => formatQty(value) },
              { key: "owners", label: "负责人" },
              { key: "load_status_label", label: "负荷", render: (value) => <StatusBadge value={String(value)} /> },
            ]}
          />
          <DataTable
            title="交期预警"
            icon={AlertTriangle}
            rows={deliveryWarnings}
            empty="当前无生产交期预警"
            columns={[
              { key: "prod_no", label: "生产单" },
              { key: "warning_type_label", label: "风险" },
              { key: "due_date", label: "交期", render: shortDate },
              { key: "planned_date", label: "计划", render: shortDate },
              { key: "delay_days", label: "影响天数" },
            ]}
          />
        </div>
      </div>
      <Panel title="排产变更留痕" icon={FileCheck2} action={canSchedule ? "正式变更" : "只读"}>
        {canSchedule && selectedRescheduleProduction ? (
          <div className="grid gap-3 xl:grid-cols-[1.4fr_repeat(4,minmax(120px,0.75fr))_1.5fr_auto]">
            <MasterSelect label="已排产生产单" value={String(selectedRescheduleProduction.id)} onChange={selectRescheduleProduction}>
              {scheduleChangeCandidates.map((production) => (
                <option key={String(production.id)} value={String(production.id)}>
                  {String(production.prod_no)} / {String(production.order_no)} / {String(production.product_name)}
                </option>
              ))}
            </MasterSelect>
            <MasterInput
              label="新计划日期"
              type="date"
              value={rescheduleForm.planned_date}
              onChange={(value) => setRescheduleField("planned_date", value)}
            />
            <MasterInput label="机台" value={rescheduleForm.machine} onChange={(value) => setRescheduleField("machine", value)} />
            <MasterInput label="负责人" value={rescheduleForm.owner} onChange={(value) => setRescheduleField("owner", value)} />
            <MasterInput label="班次" value={rescheduleForm.shift} onChange={(value) => setRescheduleField("shift", value)} />
            <MasterInput
              label="变更原因"
              value={rescheduleForm.change_reason}
              onChange={(value) => setRescheduleField("change_reason", value)}
            />
            <div className="flex items-end">
              <MasterSubmitButton
                busy={busy === `updateProductionSchedule-${String(selectedRescheduleProduction.id)}-primary`}
                label="保存变更"
                onClick={submitReschedule}
              />
            </div>
          </div>
        ) : (
          <EmptyText text={scheduleChangeCandidates.length === 0 ? "暂无已排产生产单可变更" : "请切换生产主管或管理员调整排产。"} />
        )}
      </Panel>
      <DataTable
        title="排产变更记录"
        icon={FileCheck2}
        rows={snapshot.board.productionScheduleChanges}
        empty="暂无排产变更记录"
        columns={[
          { key: "prod_no", label: "生产单" },
          { key: "old_planned_date", label: "原日期", render: shortDate },
          { key: "new_planned_date", label: "新日期", render: shortDate },
          { key: "old_machine", label: "原机台" },
          { key: "new_machine", label: "新机台" },
          { key: "change_reason", label: "原因" },
          { key: "changed_by_name", label: "变更人" },
          { key: "changed_at", label: "变更时间", render: shortDate },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="生产指令下发" icon={ClipboardList} action={canCreateInstruction ? "正式单据" : "只读"}>
          {canCreateInstruction && selectedOrder ? (
            <div className="grid gap-3">
              <MasterSelect
                label="待下发订单"
                value={String(selectedOrder.id)}
                onChange={(value) => setInstructionField("order_id", value)}
              >
                {submittedOrders.map((order) => (
                  <option key={String(order.id)} value={String(order.id)}>
                    {String(order.order_no)} / {String(order.customer_name)} / {String(order.product_name)}
                  </option>
                ))}
              </MasterSelect>
              <MasterSelect
                label="优先级"
                value={instructionForm.priority}
                onChange={(value) => setInstructionField("priority", value)}
              >
                <option value="normal">普通</option>
                <option value="urgent">加急</option>
                <option value="high">高优先级</option>
              </MasterSelect>
              <MasterTextarea
                label="生产指令说明"
                value={instructionForm.instruction_note}
                onChange={(value) => setInstructionField("instruction_note", value)}
              />
              <MasterTextarea
                label="技术要求"
                value={instructionForm.technical_requirements}
                onChange={(value) => setInstructionField("technical_requirements", value)}
              />
              <MasterSubmitButton
                busy={busy === `createProductionInstruction-${String(selectedOrder.id)}-primary`}
                label="下发生产指令"
                onClick={submitInstruction}
              />
            </div>
          ) : (
            <EmptyText text={submittedOrders.length === 0 ? "暂无待下发客户订单" : "请切换商务内勤或管理员下发生产指令。"} />
          )}
        </Panel>
        <Panel title="排产并生成领料单" icon={Factory} action={canSchedule ? "BOM 自动展开" : "只读"}>
          {canSchedule && selectedProduction ? (
            <div className="grid gap-3">
              <MasterSelect
                label="待排产生产单"
                value={String(selectedProduction.id)}
                onChange={(value) => setScheduleField("production_id", value)}
              >
                {instructedProductions.map((production) => (
                  <option key={String(production.id)} value={String(production.id)}>
                    {String(production.prod_no)} / {String(production.order_no)} / {String(production.product_name)}
                  </option>
                ))}
              </MasterSelect>
              <div className="grid gap-3 md:grid-cols-2">
                <MasterInput
                  label="计划日期"
                  type="date"
                  value={scheduleForm.planned_date}
                  onChange={(value) => setScheduleField("planned_date", value)}
                />
                <MasterInput label="机台" value={scheduleForm.machine} onChange={(value) => setScheduleField("machine", value)} />
                <MasterInput label="负责人" value={scheduleForm.owner} onChange={(value) => setScheduleField("owner", value)} />
                <MasterInput label="班次" value={scheduleForm.shift} onChange={(value) => setScheduleField("shift", value)} />
              </div>
              <MasterTextarea
                label="排产备注"
                value={scheduleForm.schedule_note}
                onChange={(value) => setScheduleField("schedule_note", value)}
              />
              <MasterTextarea
                label="领料说明"
                value={scheduleForm.requisition_note}
                onChange={(value) => setScheduleField("requisition_note", value)}
              />
              <MasterSubmitButton
                busy={busy === `scheduleAndGenerateRequisition-${String(selectedProduction.id)}-primary`}
                label="排产并生成领料单"
                onClick={submitSchedule}
              />
            </div>
          ) : (
            <EmptyText text={instructedProductions.length === 0 ? "暂无待排产生产指令" : "请切换生产主管或管理员排产。"} />
          )}
        </Panel>
      </div>
      <Panel title="生产日报单" icon={ClipboardList} action={canReport ? "正式填报" : "只读"}>
        {canReport && selectedReportProduction ? (
          <div className="grid gap-3 xl:grid-cols-[1.4fr_repeat(4,minmax(110px,0.6fr))_1.8fr_auto]">
            <MasterSelect
              label="生产工单"
              value={String(selectedReportProduction.id)}
              onChange={(value) => {
                const next = reportableProductions.find((item) => String(item.id) === value);
                setDailyReportField("production_id", value);
                setDailyReportField("planned_qty", String(next?.order_qty ?? ""));
              }}
            >
              {reportableProductions.map((production) => (
                <option key={String(production.id)} value={String(production.id)}>
                  {String(production.prod_no)} / {String(production.product_name)} / {String(production.status_label)}
                </option>
              ))}
            </MasterSelect>
            <MasterInput
              label="日期"
              type="date"
              value={dailyReportForm.report_date}
              onChange={(value) => setDailyReportField("report_date", value)}
            />
            <MasterInput label="班次" value={dailyReportForm.shift} onChange={(value) => setDailyReportField("shift", value)} />
            <MasterInput
              label="完成"
              type="number"
              value={dailyReportForm.finished_qty}
              onChange={(value) => setDailyReportField("finished_qty", value)}
            />
            <MasterInput
              label="合格"
              type="number"
              value={dailyReportForm.good_qty}
              onChange={(value) => setDailyReportField("good_qty", value)}
            />
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
              <MasterInput
                label="不合格"
                type="number"
                value={dailyReportForm.defect_qty}
                onChange={(value) => setDailyReportField("defect_qty", value)}
              />
              <MasterInput
                label="报废"
                type="number"
                value={dailyReportForm.scrap_qty}
                onChange={(value) => setDailyReportField("scrap_qty", value)}
              />
              <MasterInput
                label="工时"
                type="number"
                value={dailyReportForm.work_hours}
                onChange={(value) => setDailyReportField("work_hours", value)}
              />
            </div>
            <MasterInput
              label="异常说明"
              value={dailyReportForm.abnormal_note}
              onChange={(value) => setDailyReportField("abnormal_note", value)}
            />
            <div className="flex items-end">
              <MasterSubmitButton
                busy={busy === `createProductionDailyReport-${String(selectedReportProduction.id)}-primary`}
                label="提交日报"
                onClick={submitDailyReport}
              />
            </div>
          </div>
        ) : (
          <EmptyText text={reportableProductions.length === 0 ? "暂无已发料后的生产工单可填报日报" : "当前角色只能查看生产日报。"} />
        )}
      </Panel>
      <DataTable
        title="生产日报台账"
        icon={ClipboardList}
        rows={productionDailyReports}
        columns={[
          { key: "report_no", label: "日报单号" },
          { key: "report_date", label: "日期", render: shortDate },
          { key: "shift", label: "班次" },
          { key: "prod_no", label: "生产单" },
          { key: "product_name", label: "产品" },
          { key: "finished_qty", label: "完成", render: (value, row) => formatQty(value, row.unit) },
          { key: "good_qty", label: "合格", render: (value, row) => formatQty(value, row.unit) },
          { key: "defect_qty", label: "不合格", render: (value, row) => formatQty(value, row.unit) },
          { key: "scrap_qty", label: "报废", render: (value, row) => formatQty(value, row.unit) },
          { key: "yield_rate", label: "合格率", render: (value) => `${Number(value ?? 0).toFixed(2)}%` },
          { key: "reported_by_name", label: "填报人" },
          { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          {
            key: "daily_report_detail",
            label: "详情",
            render: (_value, row) => (
              <DetailButton
                onClick={() =>
                  openDetail({
                    ...makeDetail("生产日报详情", String(row.report_no), row, [
                      ["生产单", "prod_no"],
                      ["客户订单", "order_no"],
                      ["产品", "product_name"],
                      ["日期", "report_date", shortDate],
                      ["班次", "shift"],
                      ["计划数量", "planned_qty"],
                      ["完成数量", "finished_qty"],
                      ["合格数量", "good_qty"],
                      ["不合格数量", "defect_qty"],
                      ["报废数量", "scrap_qty"],
                      ["工时", "work_hours"],
                      ["合格率", "yield_rate", (value) => `${Number(value ?? 0).toFixed(2)}%`],
                      ["异常说明", "abnormal_note"],
                      ["填报人", "reported_by_name"],
                      ["状态", "status_label"],
                      ["创建时间", "created_at", shortDate],
                    ]),
                    audits: auditRows(snapshot, row.id),
                  })
                }
              />
            ),
          },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <DataTable
          title="生产指令与排产"
          icon={Factory}
          rows={snapshot.board.productions}
          columns={[
            { key: "prod_no", label: "生产单号" },
            { key: "order_no", label: "订单号" },
            { key: "product_name", label: "产品" },
            { key: "order_qty", label: "数量" },
            { key: "priority_label", label: "优先级", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "planned_date", label: "计划日期", render: shortDate },
            { key: "machine", label: "机台" },
            { key: "owner", label: "负责人" },
            { key: "shift", label: "班次" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "instruction_print",
              label: "打印",
              render: (_value, row) => (
                <InlineActionButton
                  label="预览"
                  onClick={() => setProductionPreview(formalPrintFromDocument(buildProductionInstructionPreview(row)))}
                />
              ),
            },
            {
              key: "production_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("生产指令详情", String(row.prod_no), row, [
                        ["客户订单", "order_no"],
                        ["产品", "product_name"],
                        ["生产数量", "order_qty"],
                        ["优先级", "priority_label"],
                        ["下达人", "issued_by_name"],
                        ["下达时间", "issued_at", shortDate],
                        ["交付期限", "due_date", shortDate],
                        ["计划日期", "planned_date", shortDate],
                        ["机台", "machine"],
                        ["负责人", "owner"],
                        ["班次", "shift"],
                        ["排产备注", "schedule_note"],
                        ["生产指令", "instruction_note"],
                        ["技术要求", "technical_requirements"],
                        ["状态", "status_label"],
                        ["创建时间", "created_at", shortDate],
                      ]),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
        />
        {["production", "admin"].includes(currentUser?.role ?? "") ? (
          <BomImportPanel busy={busy} fileInputRef={fileInputRef} uploadBom={uploadBom} />
        ) : (
          <ProductionChart snapshot={snapshot} />
        )}
      </div>
      {canIssue ? (
        <WarehouseIssueDesk snapshot={snapshot} busy={busy} runAction={runAction} />
      ) : null}
      <DataTable
        title="生产工单成本归集"
        icon={ReceiptText}
        rows={snapshot.board.productionCostSummaries}
        columns={[
          { key: "cost_no", label: "归集单号" },
          { key: "prod_no", label: "生产单" },
          { key: "receipt_no", label: "入库单" },
          { key: "product_name", label: "产品" },
          { key: "material_cost", label: "材料成本", render: formatCurrency },
          { key: "process_cost", label: "加工成本", render: formatCurrency },
          { key: "total_cost", label: "总成本", render: formatCurrency },
          { key: "unit_cost", label: "单位成本", render: formatCurrency },
          { key: "finished_qty", label: "成品数量", render: (value, row) => formatQty(value, row.unit) },
          { key: "transition_qty", label: "过渡料", render: (value, row) => formatQty(value, row.unit) },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "aggregated_at", label: "归集时间", render: shortDate },
        ]}
      />
      <DataTable
        title="领料单"
        icon={Boxes}
        rows={snapshot.board.requisitions}
        columns={[
          { key: "req_no", label: "领料单号" },
          { key: "prod_no", label: "生产单" },
          { key: "bom_version", label: "BOM版本" },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={requisitionStatusLabel(String(value))} /> },
          { key: "issue_no", label: "出库单号" },
          { key: "approved_by_name", label: "审批人" },
          { key: "created_at", label: "创建时间", render: shortDate },
          { key: "issued_at", label: "发料时间", render: shortDate },
          {
            key: "requisition_print",
            label: "打印",
            render: (_value, row) => (
              <InlineActionButton
                label="预览"
                onClick={() =>
                  setRequisitionPreview(
                    formalPrintFromDocument(buildMaterialRequisitionPreview({ ...row, lines: detailLines(row.lines) })),
                  )
                }
              />
            ),
          },
          {
            key: "requisition_detail",
            label: "详情",
            render: (_value, row) => (
              <DetailButton
                onClick={() =>
                  openDetail({
                    ...makeDetail("领料单详情", String(row.req_no), row, [
                      ["生产单", "prod_no"],
                      ["客户订单", "order_no"],
                      ["产品", "product_name"],
                      ["生产数量", "order_qty"],
                      ["BOM版本", "bom_version"],
                      ["计划日期", "planned_date", shortDate],
                      ["机台", "machine"],
                      ["负责人", "owner"],
                      ["领料说明", "requisition_note"],
                      ["审批人", "approved_by_name"],
                      ["审批时间", "approved_at", shortDate],
                      ["审批意见", "approval_note"],
                      ["出库单号", "issue_no"],
                      ["发料人", "issued_by_name"],
                      ["发料说明", "issue_note"],
                      ["状态", "status"],
                      ["创建时间", "created_at", shortDate],
                      ["发料时间", "issued_at", shortDate],
                    ]),
                    lines: detailLines(row.lines),
                    audits: auditRows(snapshot, row.id),
                  })
                }
              />
            ),
          },
        ]}
      />
      <DataTable
        title="原材料出库与批次追溯"
        icon={Boxes}
        rows={snapshot.board.materialIssues ?? []}
        columns={[
          { key: "issue_no", label: "出库单" },
          { key: "req_no", label: "领料单" },
          { key: "prod_no", label: "生产单" },
          { key: "order_no", label: "订单" },
          { key: "material_name", label: "出库物料" },
          { key: "batch_no", label: "批次" },
          { key: "qty", label: "数量", render: (value, row) => formatQty(value, row.unit) },
          { key: "unit_cost", label: "批次成本", render: formatCurrency },
          { key: "is_substitute", label: "替代", render: (value) => (Number(value) === 1 ? <StatusBadge value="substitute" /> : "-") },
          {
            key: "issue_print",
            label: "打印",
            render: (_value, row) => {
              const issueLines = (snapshot.board.materialIssues ?? []).filter((item) => String(item.req_no) === String(row.req_no));
              const req = snapshot.board.requisitions.find((item) => String(item.req_no) === String(row.req_no));
              return (
                <InlineActionButton
                  label="预览"
                  onClick={() => setIssuePreview(formalPrintFromDocument(buildMaterialIssuePreview({ ...req, ...row, issueLines })))}
                />
              );
            },
          },
          { key: "created_at", label: "出库时间", render: shortDate },
          {
            key: "issue_detail",
            label: "详情",
            render: (_value, row) => (
              <DetailButton
                onClick={() =>
                  openDetail(
                    makeDetail("原材料出库追溯", String(row.req_no), row, [
                      ["出库单", "issue_no"],
                      ["客户订单", "order_no"],
                      ["生产单", "prod_no"],
                      ["领料单", "req_no"],
                      ["BOM物料", "original_material_name"],
                      ["实际出库", "material_name"],
                      ["批次", "batch_no"],
                      ["数量", "qty"],
                      ["批次成本", "unit_cost", formatCurrency],
                      ["金额", "line_amount", formatCurrency],
                      ["发料模式", "issue_mode"],
                      ["备注", "issue_note"],
                      ["发料人", "issued_by_name"],
                    ]),
                  )
                }
              />
            ),
          },
        ]}
        action={{ label: "出库单", onClick: () => downloadExport(snapshot.currentUser.id, "material-issue") }}
      />
      <FormalPrintPreviewModal preview={planPreview} onClose={() => setPlanPreview(null)} />
      <FormalPrintPreviewModal preview={productionPreview} onClose={() => setProductionPreview(null)} />
      <FormalPrintPreviewModal preview={requisitionPreview} onClose={() => setRequisitionPreview(null)} />
      <FormalPrintPreviewModal preview={issuePreview} onClose={() => setIssuePreview(null)} />
    </div>
  );
}

function WarehouseIssueDesk({
  snapshot,
  busy,
  runAction,
}: {
  snapshot: Snapshot;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
}) {
  const pending = snapshot.board.requisitions.filter((item) =>
    ["pending_approval", "approved", "pending"].includes(String(item.status)),
  );
  const [selectedReqId, setSelectedReqId] = useState("");
  const selectedReq = pending.find((item) => String(item.id) === (selectedReqId || String(pending[0]?.id ?? "")));
  const lines = detailLines(selectedReq?.lines);
  const [selections, setSelections] = useState<Record<string, Record<string, string>>>({});
  const [issueForm, setIssueForm] = useState<Record<string, string>>({
    issue_date: new Date().toISOString().slice(0, 10),
    issue_note: "仓库复核后按系统领料单发料，出库后复核库存均价。",
    approval_note: "仓库已复核库存批次、BOM需求和替代料规则，批准发料。",
  });
  const selectedStatus = String(selectedReq?.status ?? "");
  const canApproveSelected = selectedStatus === "pending_approval";
  const canIssueSelected = selectedStatus === "approved" || selectedStatus === "pending";
  const updateIssueField = (key: string, value: string) => setIssueForm((current) => ({ ...current, [key]: value }));
  const updateSelection = (lineId: string, key: string, value: string) =>
    setSelections((current) => ({
      ...current,
      [lineId]: { ...(current[lineId] ?? {}), [key]: value },
    }));
  const approveSelected = async () => {
    if (!selectedReq) return;
    await runAction({
      action: "approveMaterialRequisition",
      entityId: String(selectedReq.id),
      payload: {
        approval_note: issueForm.approval_note,
      },
    });
  };
  const issueSelected = async (variant?: string) => {
    if (!selectedReq) return;
    await runAction({
      action: "issueMaterials",
      entityId: String(selectedReq.id),
      variant,
      payload: {
        issue_date: issueForm.issue_date,
        issue_note: issueForm.issue_note,
      },
    });
  };
  const submitManualIssue = async () => {
    if (!selectedReq) return;
    await runAction({
      action: "issueMaterials",
      entityId: String(selectedReq.id),
      variant: "manual",
      payload: {
        issue_date: issueForm.issue_date,
        issue_note: issueForm.issue_note,
        selections: lines.map((line) => {
          const lineId = String(line.lineId);
          const selection = selections[lineId] ?? {};
          return {
            line_id: lineId,
            material_id: selection.material_id || String(line.materialId),
            batch_id: selection.batch_id || "",
            reason: selection.reason || "",
          };
        }),
      },
    });
  };

  return (
    <Panel title="仓库发料操作台" icon={Warehouse} action={pending.length === 0 ? "无待发料" : "FIFO / 手动批次 / 替代料"}>
      {pending.length === 0 || !selectedReq ? (
        <EmptyText text="暂无待发料领料单" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[280px_1fr]">
            <MasterSelect
              label="领料单"
              value={String(selectedReq.id)}
              onChange={(value) => setSelectedReqId(value)}
            >
              {pending.map((req) => (
                <option key={String(req.id)} value={String(req.id)}>
                  {String(req.req_no)} / {String(req.prod_no)} / {requisitionStatusLabel(String(req.status))}
                </option>
              ))}
            </MasterSelect>
            <div className="flex flex-wrap items-end gap-2">
              <InlineActionButton
                label="批准领料单"
                busy={busy === `approveMaterialRequisition-${String(selectedReq.id)}-primary`}
                disabled={!canApproveSelected}
                onClick={() => void approveSelected()}
              />
              <InlineActionButton
                label="FIFO 发料"
                busy={busy === `issueMaterials-${String(selectedReq.id)}-primary`}
                disabled={!canIssueSelected}
                onClick={() => void issueSelected()}
              />
              <InlineActionButton
                label="替代料 FIFO"
                busy={busy === `issueMaterials-${String(selectedReq.id)}-substitute`}
                disabled={!canIssueSelected}
                onClick={() => void issueSelected("substitute")}
              />
              <InlineActionButton
                label="按选择发料"
                busy={busy === `issueMaterials-${String(selectedReq.id)}-manual`}
                disabled={!canIssueSelected}
                onClick={() => void submitManualIssue()}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MasterInput
              label="发料日期"
              value={issueForm.issue_date}
              onChange={(value) => updateIssueField("issue_date", value)}
            />
            <MasterInput
              label="审批意见"
              value={issueForm.approval_note}
              onChange={(value) => updateIssueField("approval_note", value)}
            />
            <MasterInput
              label="发料说明"
              value={issueForm.issue_note}
              onChange={(value) => updateIssueField("issue_note", value)}
            />
          </div>

          <div className="grid gap-3">
            {lines.map((line) => {
              const lineId = String(line.lineId);
              const selectedMaterialId = selections[lineId]?.material_id || String(line.materialId);
              const batches = snapshot.board.batches.filter((batch) => String(batch.material_id) === selectedMaterialId);
              return (
                <div key={lineId} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[1.2fr_1fr_1fr_1.2fr]">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">BOM物料</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{String(line.materialName)}</div>
                    <div className="mt-1 text-xs text-slate-500">需求 {formatQty(line.requiredQty, line.unit)}</div>
                  </div>
                  <MasterSelect
                    label="实际发料"
                    value={selectedMaterialId}
                    onChange={(value) => {
                      updateSelection(lineId, "material_id", value);
                      updateSelection(lineId, "batch_id", "");
                    }}
                  >
                    <option value={String(line.materialId)}>{String(line.materialName)}</option>
                    {line.substituteId ? (
                      <option value={String(line.substituteId)}>{String(line.substituteName ?? line.substituteId)}</option>
                    ) : null}
                  </MasterSelect>
                  <MasterSelect
                    label="出库批次"
                    value={selections[lineId]?.batch_id ?? ""}
                    onChange={(value) => updateSelection(lineId, "batch_id", value)}
                  >
                    <option value="">系统 FIFO</option>
                    {batches.map((batch) => (
                      <option key={String(batch.id)} value={String(batch.id)}>
                        {String(batch.batch_no)} / {formatQty(batch.qty, batch.unit)}
                      </option>
                    ))}
                  </MasterSelect>
                  <MasterInput
                    label="发料备注"
                    value={selections[lineId]?.reason ?? ""}
                    onChange={(value) => updateSelection(lineId, "reason", value)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

function InventoryModule({
  snapshot,
  actorId,
  busy,
  runAction,
  openDetail,
  onSnapshot,
  onError,
}: {
  snapshot: Snapshot;
  actorId: string;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
  openDetail: (detail: DetailState) => void;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (message: string) => void;
}) {
  const canPurchase = ["purchasing", "admin"].includes(snapshot.currentUser.role);
  const canWarehouse = ["warehouse", "admin"].includes(snapshot.currentUser.role);
  const canReviewSupplier = ["manager", "admin"].includes(snapshot.currentUser.role);
  const canCreatePurchaseRequisition = ["production", "warehouse", "purchasing", "admin"].includes(snapshot.currentUser.role);
  const canDisposeAging = ["warehouse", "purchasing", "manager", "admin"].includes(snapshot.currentUser.role);
  const canStocktake = ["warehouse", "admin"].includes(snapshot.currentUser.role);
  const canApproveStocktake = ["manager", "admin"].includes(snapshot.currentUser.role);
  const canConfigureSupplierAdmissionRules = snapshot.security.currentPermissions.includes("submitSupplierAdmissionRuleChange");
  const activeSuppliers = snapshot.board.suppliers.filter((item) => item.status === "active");
  const activeMaterials = snapshot.board.materials.filter((item) => item.status === "active");
  const [purchaseRequisitionForm, setPurchaseRequisitionForm] = useState<Record<string, string>>({
    source_type: "low_stock",
    required_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().slice(0, 10),
    reason: "库存低于安全线，按正式流程提交采购申请。",
  });
  const [purchaseRequisitionLines, setPurchaseRequisitionLines] = useState<Array<Record<string, string>>>([
    {
      material_id: String(activeMaterials[0]?.id ?? ""),
      requested_qty: "50",
      estimated_unit_cost: String(activeMaterials[0]?.average_cost ?? 0),
    },
  ]);
  const [purchaseForm, setPurchaseForm] = useState<Record<string, string>>({
    supplier_id: String(activeSuppliers[0]?.id ?? ""),
    due_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10),
  });
  const [purchaseLines, setPurchaseLines] = useState<Array<Record<string, string>>>([
    {
      material_id: String(activeMaterials[0]?.id ?? ""),
      qty: "100",
      unit_cost: String(activeMaterials[0]?.average_cost ?? 0),
    },
  ]);
  const [mrpForm, setMrpForm] = useState<Record<string, string>>({
    horizon_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10),
    note: "按当前待排产/待发料生产工单自动展开 BOM 并计算缺料净需求。",
  });
  const [supplierRuleForm, setSupplierRuleForm] = useState<Record<string, string>>({
    rule_id: "",
    rule_code: "SUP-CUSTOM-RISK",
    rule_name: "自定义供应商风险规则",
    metric_key: "performance_score",
    operator: "lt",
    threshold_value: "70",
    target_status: "watch",
    require_correction: "true",
    priority: "60",
    status: "active",
    description: "按客户正式管理制度配置供应商准入阈值、触发动作和整改要求。",
  });
  const [supplierRuleImpactPreview, setSupplierRuleImpactPreview] = useState<Row | null>(null);
  const [supplierRuleImpactLoading, setSupplierRuleImpactLoading] = useState(false);
  const [supplierRuleImpactError, setSupplierRuleImpactError] = useState("");
  const setPurchaseRequisitionField = (key: string, value: string) =>
    setPurchaseRequisitionForm((current) => ({ ...current, [key]: value }));
  const setPurchaseRequisitionLineField = (index: number, key: string, value: string) =>
    setPurchaseRequisitionLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const addPurchaseRequisitionLine = () =>
    setPurchaseRequisitionLines((current) => [
      ...current,
      {
        material_id: String(activeMaterials[0]?.id ?? ""),
        requested_qty: "1",
        estimated_unit_cost: String(activeMaterials[0]?.average_cost ?? 0),
      },
    ]);
  const removePurchaseRequisitionLine = (index: number) =>
    setPurchaseRequisitionLines((current) =>
      current.length <= 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index),
    );
  const purchaseRequisitionTotal = purchaseRequisitionLines.reduce(
    (sum, line) => sum + Number(line.requested_qty || 0) * Number(line.estimated_unit_cost || 0),
    0,
  );
  const submitPurchaseRequisition = async () => {
    await runAction({
      action: "createPurchaseRequisition",
      payload: { ...purchaseRequisitionForm, lines: purchaseRequisitionLines },
    });
  };
  const submitMrpRun = async () => {
    await runAction({
      action: "generateMrpRequirementRun",
      payload: mrpForm,
    });
  };
  const setSupplierRuleField = (key: string, value: string) =>
    setSupplierRuleForm((current) => ({ ...current, [key]: value }));
  const resetSupplierRuleForm = () =>
    setSupplierRuleForm({
      rule_id: "",
      rule_code: "SUP-CUSTOM-RISK",
      rule_name: "自定义供应商风险规则",
      metric_key: "performance_score",
      operator: "lt",
      threshold_value: "70",
      target_status: "watch",
      require_correction: "true",
      priority: "60",
      status: "active",
      description: "按客户正式管理制度配置供应商准入阈值、触发动作和整改要求。",
    });
  const loadSupplierRuleForm = (rule: Row) =>
    setSupplierRuleForm({
      rule_id: String(rule.id ?? ""),
      rule_code: String(rule.rule_code ?? ""),
      rule_name: String(rule.rule_name ?? ""),
      metric_key: String(rule.metric_key ?? "performance_score"),
      operator: String(rule.operator ?? "lt"),
      threshold_value: String(rule.threshold_value ?? "0"),
      target_status: String(rule.target_status ?? "watch"),
      require_correction: Number(rule.require_correction ?? 1) ? "true" : "false",
      priority: String(rule.priority ?? "50"),
      status: String(rule.status ?? "active"),
      description: String(rule.description ?? ""),
    });
  const submitSupplierAdmissionRule = async () => {
    await runAction({
      action: "submitSupplierAdmissionRuleChange",
      entityId: supplierRuleForm.rule_id || undefined,
      payload: supplierRuleForm,
    });
  };
  const setPurchaseField = (key: string, value: string) => setPurchaseForm((current) => ({ ...current, [key]: value }));
  const setPurchaseLineField = (index: number, key: string, value: string) =>
    setPurchaseLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    );
  const addPurchaseLine = () =>
    setPurchaseLines((current) => [
      ...current,
      {
        material_id: String(activeMaterials[0]?.id ?? ""),
        qty: "1",
        unit_cost: String(activeMaterials[0]?.average_cost ?? 0),
      },
    ]);
  const removePurchaseLine = (index: number) =>
    setPurchaseLines((current) => (current.length <= 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));
  const purchaseTotal = purchaseLines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.unit_cost || 0), 0);
  const submitPurchaseOrder = async () => {
    await runAction({ action: "createPurchaseOrder", payload: { ...purchaseForm, lines: purchaseLines } });
  };
  const [stocktakeForm, setStocktakeForm] = useState<Record<string, string>>({
    material_id: String(activeMaterials[0]?.id ?? ""),
    actual_qty: String(activeMaterials[0]?.stock_qty ?? 0),
    counted_at: new Date().toISOString().slice(0, 10),
    remark: "月度库存盘点，按实物数量录入。",
  });
  const [formalPreview, setFormalPreview] = useState<FormalPrintDocument | null>(null);
  const contractAttachmentInputRef = useRef<HTMLInputElement>(null);
  const firstContract = snapshot.board.purchaseContracts[0];
  const [contractAttachmentForm, setContractAttachmentForm] = useState<Record<string, string>>({
    contract_id: String(firstContract?.id ?? ""),
    category: "采购合同",
    note: "供应商回传盖章合同，纳入本地数据盘归档并随冷备份保存。",
  });
  const supplierCertificateAttachmentInputRef = useRef<HTMLInputElement>(null);
  const firstSupplierCertificate = snapshot.board.supplierQualificationCertificates[0];
  const [supplierCertificateAttachmentForm, setSupplierCertificateAttachmentForm] = useState<Record<string, string>>({
    certificate_id: String(firstSupplierCertificate?.id ?? ""),
    category: "供应商资质证书",
    note: "供应商盖章版资质证书，纳入本地归档并参与资质台账追溯。",
  });
  const selectedStocktakeMaterial = activeMaterials.find((item) => String(item.id) === stocktakeForm.material_id);
  const selectedContractForAttachment =
    snapshot.board.purchaseContracts.find((item) => String(item.id) === contractAttachmentForm.contract_id) ?? firstContract;
  const selectedSupplierCertificateForAttachment =
    snapshot.board.supplierQualificationCertificates.find((item) => String(item.id) === supplierCertificateAttachmentForm.certificate_id) ??
    firstSupplierCertificate;
  const supplierCertificateAttachments = snapshot.board.documentAttachments.filter(
    (attachment) => String(attachment.entity_type) === "supplier_certificate",
  );
  useEffect(() => {
    if (!firstContract) return;
    const exists = snapshot.board.purchaseContracts.some((item) => String(item.id) === contractAttachmentForm.contract_id);
    if (!exists) {
      setContractAttachmentForm((current) => ({ ...current, contract_id: String(firstContract.id ?? "") }));
    }
  }, [contractAttachmentForm.contract_id, firstContract, snapshot.board.purchaseContracts]);
  useEffect(() => {
    if (!firstSupplierCertificate) return;
    const exists = snapshot.board.supplierQualificationCertificates.some(
      (item) => String(item.id) === supplierCertificateAttachmentForm.certificate_id,
    );
    if (!exists) {
      setSupplierCertificateAttachmentForm((current) => ({ ...current, certificate_id: String(firstSupplierCertificate.id ?? "") }));
    }
  }, [firstSupplierCertificate, snapshot.board.supplierQualificationCertificates, supplierCertificateAttachmentForm.certificate_id]);
  const submitContractAttachment = async () => {
    const file = contractAttachmentInputRef.current?.files?.[0];
    if (!selectedContractForAttachment) {
      onError("暂无可归档的采购合同。");
      return;
    }
    if (!file) {
      onError("请选择采购合同附件文件。");
      return;
    }
    onError("");
    const form = new FormData();
    form.append("actorId", actorId);
    form.append("entityType", "purchase_contract");
    form.append("entityId", String(selectedContractForAttachment.id));
    form.append("entityNo", String(selectedContractForAttachment.contract_no));
    form.append("category", contractAttachmentForm.category);
    form.append("note", contractAttachmentForm.note);
    form.append("file", file);
    const response = await fetch("/api/attachments", { method: "POST", body: form });
    const data = (await response.json()) as Snapshot | { error: string };
    if (!response.ok || "error" in data) {
      onError("error" in data ? data.error : "采购合同附件上传失败。");
      return;
    }
    if (contractAttachmentInputRef.current) contractAttachmentInputRef.current.value = "";
    onSnapshot(data);
  };
  const updateSupplierCertificateAttachmentField = (key: string, value: string) =>
    setSupplierCertificateAttachmentForm((current) => ({ ...current, [key]: value }));
  const submitSupplierCertificateAttachment = async () => {
    const file = supplierCertificateAttachmentInputRef.current?.files?.[0];
    if (!selectedSupplierCertificateForAttachment) {
      onError("暂无可归档的供应商资质证书。");
      return;
    }
    if (!file) {
      onError("请选择供应商资质附件文件。");
      return;
    }
    onError("");
    const form = new FormData();
    form.append("actorId", actorId);
    form.append("entityType", "supplier_certificate");
    form.append("entityId", String(selectedSupplierCertificateForAttachment.id));
    form.append("entityNo", String(selectedSupplierCertificateForAttachment.qualification_no));
    form.append("category", supplierCertificateAttachmentForm.category);
    form.append("note", supplierCertificateAttachmentForm.note);
    form.append("file", file);
    const response = await fetch("/api/attachments", { method: "POST", body: form });
    const data = (await response.json()) as Snapshot | { error: string };
    if (!response.ok || "error" in data) {
      onError("error" in data ? data.error : "供应商资质附件上传失败。");
      return;
    }
    if (supplierCertificateAttachmentInputRef.current) supplierCertificateAttachmentInputRef.current.value = "";
    onSnapshot(data);
  };
  const setStocktakeField = (key: string, value: string) => {
    setStocktakeForm((current) => {
      if (key === "material_id") {
        const material = activeMaterials.find((item) => String(item.id) === value);
        return { ...current, material_id: value, actual_qty: String(material?.stock_qty ?? current.actual_qty) };
      }
      return { ...current, [key]: value };
    });
  };
  const stocktakeDifference = Number(stocktakeForm.actual_qty || 0) - Number(selectedStocktakeMaterial?.stock_qty ?? 0);
  const openArrivalDiscrepancyCount = snapshot.board.purchaseArrivalDiscrepancies.filter((item) =>
    ["pending_approval", "approved"].includes(String(item.status)),
  ).length;
  const buildArrivalDiscrepancyPayload = (row: Row) => {
    const line = detailLines(row.lines)[0] ?? {};
    const arrivedQty = Number(line.arrivedQty ?? line.orderedQty ?? 0);
    const unitCost = Number(line.unitCost ?? 0);
    const actualQty = Number(Math.max(0, arrivedQty * 0.95).toFixed(4));
    return {
      reason: "仓库实收到货与到货通知存在差异，先冻结签收并提交审批。",
      handling_decision: "supplier_replenish",
      proposed_action: "由采购联系供应商补齐差额，差异处理完成后再恢复签收。",
      lines: [
        {
          arrival_notice_line_id: String(line.lineId ?? ""),
          actual_arrived_qty: actualQty,
          actual_unit_cost: Number((unitCost * 1.02).toFixed(4)),
          actual_batch_hint: `${String(line.batchHint || row.arrival_no || "ARRIVAL")}-CY`,
          note: "正式流程演示：数量、价格或批次不一致，生成到货差异单。",
        },
      ],
    };
  };
  useEffect(() => {
    if (!canConfigureSupplierAdmissionRules) {
      setSupplierRuleImpactPreview(null);
      setSupplierRuleImpactError("");
      return;
    }
    if (!supplierRuleForm.rule_code || !supplierRuleForm.rule_name || !supplierRuleForm.threshold_value) {
      setSupplierRuleImpactPreview(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSupplierRuleImpactLoading(true);
      setSupplierRuleImpactError("");
      const query = new URLSearchParams({
        actorId,
        ruleId: supplierRuleForm.rule_id,
        rule_code: supplierRuleForm.rule_code,
        rule_name: supplierRuleForm.rule_name,
        metric_key: supplierRuleForm.metric_key,
        operator: supplierRuleForm.operator,
        threshold_value: supplierRuleForm.threshold_value,
        target_status: supplierRuleForm.target_status,
        require_correction: supplierRuleForm.require_correction,
        priority: supplierRuleForm.priority,
        status: supplierRuleForm.status,
        description: supplierRuleForm.description,
      });
      fetch(`/api/supplier-admission-rules/impact?${query.toString()}`, { cache: "no-store" })
        .then(async (response) => {
          const data = (await response.json()) as Row | { error: string };
          if (!response.ok || "error" in data) throw new Error("error" in data ? String(data.error) : "供应商准入规则影响预览失败");
          if (!cancelled) setSupplierRuleImpactPreview(data);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSupplierRuleImpactPreview(null);
            setSupplierRuleImpactError(error instanceof Error ? error.message : "供应商准入规则影响预览失败");
          }
        })
        .finally(() => {
          if (!cancelled) setSupplierRuleImpactLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [actorId, canConfigureSupplierAdmissionRules, supplierRuleForm]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-12">
        <MiniMetric label="供应商" value={`${snapshot.board.suppliers.length} 家`} />
        <MiniMetric label="采购申请" value={`${snapshot.board.purchaseRequisitions.length} 张`} />
        <MiniMetric label="采购单" value={`${snapshot.board.purchaseOrders.length} 张`} />
        <MiniMetric label="采购合同" value={`${snapshot.board.purchaseContracts.length} 份`} />
        <MiniMetric label="待签收到货" value={`${snapshot.board.purchaseArrivalNotices.filter((item) => item.status === "pending_signoff").length} 张`} />
        <MiniMetric label="到货差异" value={`${openArrivalDiscrepancyCount} 张`} />
        <MiniMetric label="MRP缺料" value={formatCurrency(snapshot.summary.mrpShortageAmount)} />
        <MiniMetric label="IQC 待检" value={`${snapshot.board.materialIqcInspections.filter((item) => item.status === "pending").length} 张`} />
        <MiniMetric label="库存总值" value={formatCurrency(snapshot.summary.inventoryValue)} />
        <MiniMetric label="低库存" value={`${snapshot.summary.lowStockCount} 项`} />
        <MiniMetric label="3个月未动" value={`${snapshot.summary.staleWarningCount} 项`} />
        <MiniMetric label="6个月积压" value={formatCurrency(snapshot.summary.overstockValue)} />
        <MiniMetric label="供应商风险" value={`${snapshot.summary.supplierRiskCount} 家`} />
        <MiniMetric label="准入限制" value={`${snapshot.summary.supplierRestrictedCount} 家`} />
        <MiniMetric label="整改待办" value={`${snapshot.summary.supplierCorrectiveOpenCount} 项`} />
        <MiniMetric label="整改逾期" value={`${snapshot.summary.supplierCorrectionOverdueCount} 项`} />
        <MiniMetric label="恢复采购" value={`${snapshot.summary.supplierReleaseCount} 次`} />
        <MiniMetric label="观察中" value={`${snapshot.summary.supplierObservationActiveCount} 家`} />
        <MiniMetric label="资质临期" value={`${snapshot.summary.supplierCertificateDueCount} 项`} />
        <MiniMetric label="必备缺失" value={`${snapshot.summary.supplierQualificationMissingCount} 项`} />
        <MiniMetric label="下单拦截" value={`${snapshot.summary.supplierQualificationBlockingCount} 项`} />
        <MiniMetric label="年度待评" value={`${snapshot.summary.supplierAnnualReviewDueCount} 家`} />
        <MiniMetric label="自动规则" value={`${snapshot.summary.supplierAutoRuleCount} 条`} />
        <MiniMetric label="规则触发" value={`${snapshot.summary.supplierAutoTriggerCount} 次`} />
        <MiniMetric label="规则审批" value={`${snapshot.summary.supplierRuleChangePendingCount} 单`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="MRP 缺料净需求" icon={ClipboardList} action={canCreatePurchaseRequisition ? "BOM净需求" : "只读"}>
          {canCreatePurchaseRequisition ? (
            <div className="grid gap-3">
              <MasterInput
                label="需求截止日期"
                type="date"
                value={mrpForm.horizon_date}
                onChange={(value) => setMrpForm((current) => ({ ...current, horizon_date: value }))}
              />
              <MasterInput
                label="测算说明"
                value={mrpForm.note}
                onChange={(value) => setMrpForm((current) => ({ ...current, note: value }))}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <MiniMetric label="待转采购申请" value={`${snapshot.board.mrpRequirementRuns.filter((item) => item.status === "draft").length} 张`} />
                <MiniMetric label="缺料行数" value={`${snapshot.summary.mrpShortageLineCount} 项`} />
              </div>
              <MasterSubmitButton
                busy={busy === "generateMrpRequirementRun-system-primary"}
                label="计算净需求"
                onClick={submitMrpRun}
              />
            </div>
          ) : (
            <EmptyText text="MRP 缺料测算需切换生产、仓库、采购或系统管理员。" />
          )}
        </Panel>
        <DataTable
          title="MRP 缺料测算记录"
          icon={ClipboardList}
          rows={snapshot.board.mrpRequirementRuns}
          columns={[
            { key: "run_no", label: "测算单号" },
            { key: "source_type_label", label: "范围" },
            { key: "horizon_date", label: "截止日期", render: shortDate },
            { key: "shortage_line_count", label: "缺料项" },
            { key: "total_shortage_qty", label: "缺料数量" },
            { key: "total_shortage_amount", label: "建议金额", render: formatCurrency },
            { key: "generated_by_name", label: "测算人" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "mrp_ops",
              label: "操作",
              render: (_value, row) => {
                if (canPurchase && row.status === "draft" && Number(row.shortage_line_count ?? 0) > 0) {
                  return (
                    <InlineActionButton
                      label="生成申请"
                      busy={busy === `createPurchaseRequisitionFromMrp-${String(row.id)}-primary`}
                      onClick={() =>
                        void runAction({
                          action: "createPurchaseRequisitionFromMrp",
                          entityId: String(row.id),
                          payload: {
                            required_date: purchaseRequisitionForm.required_date,
                            reason: `由 MRP ${String(row.run_no)} 缺料净需求转入采购申请。`,
                          },
                        })
                      }
                    />
                  );
                }
                if (row.status === "requisition_created") {
                  return <span className="text-xs text-emerald-700">{String(row.converted_requisition_no ?? "已生成")}</span>;
                }
                return <span className="text-xs text-slate-400">-</span>;
              },
            },
            {
              key: "mrp_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("MRP 缺料测算详情", String(row.run_no), row, [
                        ["范围", "source_type_label"],
                        ["截止日期", "horizon_date", shortDate],
                        ["缺料项", "shortage_line_count"],
                        ["建议金额", "total_shortage_amount", formatCurrency],
                        ["测算人", "generated_by_name"],
                        ["状态", "status_label"],
                        ["转采购申请", "converted_requisition_no"],
                        ["测算说明", "note"],
                      ]),
                      lines: detailLines(row.lines),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
        />
      </div>
      <DataTable
        title="MRP 缺料明细"
        icon={Boxes}
        rows={snapshot.board.mrpRequirementLines}
        columns={[
          { key: "run_no", label: "测算单" },
          { key: "material_name", label: "物料" },
          { key: "required_qty", label: "BOM需求", render: (value, row) => formatQty(value, row.unit) },
          { key: "available_qty", label: "现存", render: (value, row) => formatQty(value, row.unit) },
          { key: "safety_stock_qty", label: "安全库存", render: (value, row) => formatQty(value, row.unit) },
          { key: "incoming_purchase_qty", label: "在途采购", render: (value, row) => formatQty(value, row.unit) },
          { key: "planned_requisition_qty", label: "已申请", render: (value, row) => formatQty(value, row.unit) },
          { key: "net_shortage_qty", label: "净缺料", render: (value, row) => formatQty(value, row.unit) },
          { key: "line_amount", label: "建议金额", render: formatCurrency },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "source_summary", label: "来源工单" },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="采购申请录入" icon={ClipboardList} action={canCreatePurchaseRequisition ? "先申请后下单" : "只读"}>
          {canCreatePurchaseRequisition ? (
            <div className="grid gap-3">
              <MasterSelect
                label="申请来源"
                value={purchaseRequisitionForm.source_type}
                onChange={(value) => setPurchaseRequisitionField("source_type", value)}
              >
                <option value="low_stock">最低库存触发</option>
                <option value="bom_shortage">BOM 缺料触发</option>
                <option value="manual">人工申购</option>
              </MasterSelect>
              <MasterInput
                label="需求日期"
                type="date"
                value={purchaseRequisitionForm.required_date}
                onChange={(value) => setPurchaseRequisitionField("required_date", value)}
              />
              <MasterInput
                label="申请原因"
                value={purchaseRequisitionForm.reason}
                onChange={(value) => setPurchaseRequisitionField("reason", value)}
              />
              <div className="space-y-2">
                {purchaseRequisitionLines.map((line, index) => {
                  const selectedMaterial = activeMaterials.find((item) => String(item.id) === line.material_id);
                  return (
                    <div key={index} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-slate-500">申请明细 {index + 1}</div>
                        <button
                          type="button"
                          onClick={() => removePurchaseRequisitionLine(index)}
                          disabled={purchaseRequisitionLines.length <= 1}
                          className="h-7 rounded-md px-2 text-xs font-semibold text-slate-500 hover:bg-white hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          删除
                        </button>
                      </div>
                      <div className="mt-2 grid gap-3">
                        <MasterSelect
                          label="申请物料"
                          value={line.material_id}
                          onChange={(value) => {
                            const material = activeMaterials.find((item) => String(item.id) === value);
                            setPurchaseRequisitionLineField(index, "material_id", value);
                            setPurchaseRequisitionLineField(
                              index,
                              "estimated_unit_cost",
                              String(material?.average_cost ?? line.estimated_unit_cost),
                            );
                          }}
                        >
                          {activeMaterials.map((material) => (
                            <option key={String(material.id)} value={String(material.id)}>
                              {String(material.material_code ?? material.id)} / {String(material.name)}
                            </option>
                          ))}
                        </MasterSelect>
                        <div className="grid gap-3 md:grid-cols-2">
                          <MasterInput
                            label="申请数量"
                            type="number"
                            value={line.requested_qty}
                            onChange={(value) => setPurchaseRequisitionLineField(index, "requested_qty", value)}
                          />
                          <MasterInput
                            label="预计单价"
                            type="number"
                            value={line.estimated_unit_cost}
                            onChange={(value) => setPurchaseRequisitionLineField(index, "estimated_unit_cost", value)}
                          />
                        </div>
                        <div className="text-xs leading-5 text-slate-500">
                          当前库存：{formatQty(selectedMaterial?.stock_qty, selectedMaterial?.unit)} / 安全线：
                          {formatQty(selectedMaterial?.reorder_min_qty, selectedMaterial?.unit)} / 预计金额：
                          {formatCurrency(Number(line.requested_qty || 0) * Number(line.estimated_unit_cost || 0))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
                <button
                  type="button"
                  onClick={addPurchaseRequisitionLine}
                  className="h-8 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
                >
                  添加明细
                </button>
                <div className="text-sm font-semibold text-slate-900">预计合计 {formatCurrency(purchaseRequisitionTotal)}</div>
              </div>
              <MasterSubmitButton
                busy={busy === "createPurchaseRequisition-system-primary"}
                label="提交采购申请"
                onClick={submitPurchaseRequisition}
              />
            </div>
          ) : (
            <EmptyText text="采购申请录入需切换生产、仓库、采购或系统管理员。" />
          )}
        </Panel>
        <DataTable
          title="采购申请单"
          icon={ClipboardList}
          rows={snapshot.board.purchaseRequisitions}
          columns={[
            { key: "requisition_no", label: "申请单号" },
            { key: "source_type_label", label: "来源" },
            { key: "requested_by_name", label: "申请人" },
            { key: "total_amount", label: "预计金额", render: formatCurrency },
            { key: "required_date", label: "需求日期", render: shortDate },
            { key: "approval_no", label: "审批单" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "requisition_ops",
              label: "操作",
              render: (_value, row) => {
                if (canPurchase && row.status === "approved") {
                  return (
                    <InlineActionButton
                      label="转采购单"
                      busy={busy === `createPurchaseOrderFromRequisition-${String(row.id)}-primary`}
                      onClick={() =>
                        void runAction({
                          action: "createPurchaseOrderFromRequisition",
                          entityId: String(row.id),
                          payload: {
                            supplier_id: purchaseForm.supplier_id || String(activeSuppliers[0]?.id ?? ""),
                            due_date: purchaseForm.due_date,
                          },
                        })
                      }
                    />
                  );
                }
                if (row.status === "converted") return <span className="text-xs text-emerald-700">{String(row.converted_order_no)}</span>;
                if (row.status === "pending_approval") return <span className="text-xs text-amber-600">待审批</span>;
                return <span className="text-xs text-slate-400">-</span>;
              },
            },
            {
              key: "purchase_requisition_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("采购申请详情", String(row.requisition_no), row, [
                        ["来源", "source_type_label"],
                        ["申请人", "requested_by_name"],
                        ["预计金额", "total_amount", formatCurrency],
                        ["需求日期", "required_date", shortDate],
                        ["审批单", "approval_no"],
                        ["审批状态", "approval_status"],
                        ["审批人", "approved_by_name"],
                        ["审批意见", "approval_note"],
                        ["转采购单", "converted_order_no"],
                        ["申请原因", "reason"],
                      ]),
                      lines: detailLines(row.lines),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="采购订单录入" icon={ClipboardList} action={canPurchase ? "正式单据" : "只读"}>
          {canPurchase ? (
            <div className="grid gap-3">
              <MasterSelect
                label="供应商"
                value={purchaseForm.supplier_id}
                onChange={(value) => setPurchaseField("supplier_id", value)}
              >
                {activeSuppliers.map((supplier) => (
                  <option key={String(supplier.id)} value={String(supplier.id)}>
                    {String(supplier.supplier_code ?? supplier.id)} / {String(supplier.name)}
                  </option>
                ))}
              </MasterSelect>
              <MasterInput
                label="付款到期日"
                type="date"
                value={purchaseForm.due_date}
                onChange={(value) => setPurchaseField("due_date", value)}
              />
              <div className="space-y-2">
                {purchaseLines.map((line, index) => {
                  const selectedMaterial = activeMaterials.find((item) => String(item.id) === line.material_id);
                  return (
                    <div key={index} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-slate-500">明细 {index + 1}</div>
                        <button
                          type="button"
                          onClick={() => removePurchaseLine(index)}
                          disabled={purchaseLines.length <= 1}
                          className="h-7 rounded-md px-2 text-xs font-semibold text-slate-500 hover:bg-white hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          删除
                        </button>
                      </div>
                      <div className="mt-2 grid gap-3">
                        <MasterSelect
                          label="采购物料"
                          value={line.material_id}
                          onChange={(value) => {
                            const material = activeMaterials.find((item) => String(item.id) === value);
                            setPurchaseLineField(index, "material_id", value);
                            setPurchaseLineField(index, "unit_cost", String(material?.average_cost ?? line.unit_cost));
                          }}
                        >
                          {activeMaterials.map((material) => (
                            <option key={String(material.id)} value={String(material.id)}>
                              {String(material.material_code ?? material.id)} / {String(material.name)}
                            </option>
                          ))}
                        </MasterSelect>
                        <div className="grid gap-3 md:grid-cols-2">
                          <MasterInput
                            label="采购数量"
                            type="number"
                            value={line.qty}
                            onChange={(value) => setPurchaseLineField(index, "qty", value)}
                          />
                          <MasterInput
                            label="采购单价"
                            type="number"
                            value={line.unit_cost}
                            onChange={(value) => setPurchaseLineField(index, "unit_cost", value)}
                          />
                        </div>
                        <div className="text-xs leading-5 text-slate-500">
                          库存：{formatQty(selectedMaterial?.stock_qty, selectedMaterial?.unit)} / 均价：
                          {formatCurrency(selectedMaterial?.average_cost)} / 金额：
                          {formatCurrency(Number(line.qty || 0) * Number(line.unit_cost || 0))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
                <button
                  type="button"
                  onClick={addPurchaseLine}
                  className="h-8 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
                >
                  添加明细
                </button>
                <div className="text-sm font-semibold text-slate-900">合计 {formatCurrency(purchaseTotal)}</div>
              </div>
              <MasterSubmitButton
                busy={busy === "createPurchaseOrder-system-primary"}
                label="提交采购审批"
                onClick={submitPurchaseOrder}
              />
            </div>
          ) : (
            <EmptyText text="采购订单录入需切换采购员或管理员。" />
          )}
        </Panel>
        <DataTable
          title="采购入库单"
          icon={PackageCheck}
          rows={snapshot.board.purchaseReceipts ?? []}
          columns={[
            { key: "purchase_no", label: "来源采购单" },
            { key: "iqc_no", label: "IQC单", render: (value) => String(value ?? "-") },
            { key: "supplier_name", label: "供应商" },
            { key: "material_name", label: "物料" },
            { key: "iqc_result_label", label: "IQC判定" },
            { key: "batch_no", label: "入库批次" },
            { key: "qty", label: "入库数量", render: (value, row) => formatQty(value, row.unit) },
            { key: "unit_cost", label: "入库单价", render: formatCurrency },
            { key: "line_amount", label: "入库金额", render: formatCurrency },
            { key: "created_at", label: "入库时间", render: shortDate },
            {
              key: "receipt_detail",
              label: "操作",
              render: (_value, row) => (
                <div className="flex gap-2">
                  <DetailButton
                    onClick={() =>
                      openDetail(
                        makeDetail("采购入库单详情", String(row.batch_no), row, [
                          ["采购单号", "purchase_no"],
                          ["供应商", "supplier_name"],
                          ["物料", "material_name"],
                          ["批次号", "batch_no"],
                          ["数量", "qty"],
                          ["单价", "unit_cost", formatCurrency],
                          ["金额", "line_amount", formatCurrency],
                          ["入库时间", "created_at", shortDate],
                        ]),
                      )
                    }
                  />
                  <InlineActionButton label="预览" onClick={() => setFormalPreview(buildPurchaseReceiptPrintPreview(row))} />
                  <InlineActionButton
                    label="导出"
                    busy={false}
                    onClick={() => downloadExport(actorId, "purchase-receipt", row.id)}
                  />
                </div>
              ),
            },
          ]}
          action={{ label: "入库单", onClick: () => downloadExport(actorId, "purchase-receipt") }}
        />
      </div>
      <DataTable
        title="原料 IQC 来料检验"
        icon={FlaskConical}
        rows={snapshot.board.materialIqcInspections}
        columns={[
          { key: "iqc_no", label: "IQC单号" },
          { key: "purchase_no", label: "采购单" },
          { key: "supplier_name", label: "供应商" },
          { key: "arrival_no", label: "到货通知" },
          { key: "arrived_at", label: "到货日期", render: shortDate },
          { key: "due_at", label: "检验期限", render: shortDate },
          { key: "result_label", label: "判定" },
          { key: "accepted_amount", label: "放行金额", render: formatCurrency },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          {
            key: "iqc_detail",
            label: "详情",
            render: (_value, row) => (
              <DetailButton
                onClick={() =>
                  openDetail({
                    ...makeDetail("原料 IQC 检验详情", String(row.iqc_no), row, [
                      ["采购单", "purchase_no"],
                      ["供应商", "supplier_name"],
                      ["到货通知", "arrival_no"],
                      ["到货日期", "arrived_at", shortDate],
                      ["检验期限", "due_at", shortDate],
                      ["判定结果", "result_label"],
                      ["检验员", "inspected_by_name"],
                      ["实测记录", "measurements"],
                      ["检验标准", "inspection_standard"],
                      ["处置意见", "disposition_note"],
                      ["放行金额", "accepted_amount", formatCurrency],
                    ]),
                    lines: detailLines(row.lines),
                    audits: auditRows(snapshot, row.id),
                  })
                }
              />
            ),
          },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="库存盘点录入" icon={ClipboardList} action={canStocktake ? "待审批调整" : "只读"}>
          {canStocktake ? (
            <div className="grid gap-3">
              <MasterSelect
                label="盘点物料"
                value={stocktakeForm.material_id}
                onChange={(value) => setStocktakeField("material_id", value)}
              >
                {activeMaterials.map((material) => (
                  <option key={String(material.id)} value={String(material.id)}>
                    {String(material.material_code ?? material.id)} / {String(material.name)}
                  </option>
                ))}
              </MasterSelect>
              <div className="grid gap-3 md:grid-cols-2">
                <MasterInput
                  label="实盘数量"
                  type="number"
                  value={stocktakeForm.actual_qty}
                  onChange={(value) => setStocktakeField("actual_qty", value)}
                />
                <MasterInput
                  label="盘点日期"
                  type="date"
                  value={stocktakeForm.counted_at}
                  onChange={(value) => setStocktakeField("counted_at", value)}
                />
              </div>
              <MasterInput
                label="盘点说明"
                value={stocktakeForm.remark}
                onChange={(value) => setStocktakeField("remark", value)}
              />
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                账面库存：{formatQty(selectedStocktakeMaterial?.stock_qty, selectedStocktakeMaterial?.unit)} / 移动均价：
                {formatCurrency(selectedStocktakeMaterial?.average_cost)} / 差异：
                <span className={stocktakeDifference < 0 ? "font-semibold text-rose-600" : "font-semibold text-emerald-700"}>
                  {formatQty(stocktakeDifference, selectedStocktakeMaterial?.unit)}
                </span>
              </div>
              <MasterSubmitButton
                busy={busy === "createStocktake-system-primary"}
                label="提交盘点审批"
                onClick={() => runAction({ action: "createStocktake", payload: stocktakeForm })}
              />
            </div>
          ) : (
            <EmptyText text="库存盘点录入需切换仓库管理员或系统管理员。" />
          )}
        </Panel>
        <DataTable
          title="库存盘点单"
          icon={ClipboardList}
          rows={snapshot.board.stocktakes}
          columns={[
            { key: "stocktake_no", label: "盘点单号" },
            { key: "material_name", label: "物料" },
            { key: "book_qty", label: "账面", render: (value, row) => formatQty(value, row.unit) },
            { key: "actual_qty", label: "实盘", render: (value, row) => formatQty(value, row.unit) },
            { key: "difference_qty", label: "差异", render: (value, row) => formatQty(value, row.unit) },
            { key: "adjustment_amount", label: "调整金额", render: formatCurrency },
            { key: "counted_by_name", label: "盘点人" },
            { key: "approved_by_name", label: "审批人" },
            { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "stocktake_ops",
              label: "操作",
              render: (_value, row) => (
                <div className="flex gap-2">
                  {canApproveStocktake && row.status === "pending_approval" ? (
                    <InlineActionButton
                      label="审批调整"
                      busy={busy === `approveStocktake-${String(row.id)}-primary`}
                      onClick={() =>
                        void runAction({
                          action: "approveStocktake",
                          entityId: String(row.id),
                          payload: { approval_note: "同意按盘点差异调整库存。" },
                        })
                      }
                    />
                  ) : null}
                  <InlineActionButton label="预览" onClick={() => setFormalPreview(buildStocktakePrintPreview(row))} />
                  <InlineActionButton
                    label="导出"
                    busy={false}
                    onClick={() => downloadExport(actorId, "stocktake", row.id)}
                  />
                </div>
              ),
            },
            {
              key: "stocktake_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("库存盘点单详情", String(row.stocktake_no), row, [
                        ["物料", "material_name"],
                        ["账面数量", "book_qty"],
                        ["实盘数量", "actual_qty"],
                        ["差异数量", "difference_qty"],
                        ["调整金额", "adjustment_amount", formatCurrency],
                        ["盘点人", "counted_by_name"],
                        ["审批人", "approved_by_name"],
                        ["盘点日期", "counted_at", shortDate],
                        ["状态", "status_label"],
                        ["说明", "remark"],
                        ["审批意见", "approval_note"],
                      ]),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
          action={{ label: "盘点单导出", onClick: () => downloadExport(actorId, "stocktake") }}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="供应商"
          icon={Boxes}
          rows={snapshot.board.suppliers}
          columns={[
            { key: "name", label: "供应商" },
            { key: "contact", label: "联系人" },
            { key: "phone", label: "电话" },
            { key: "payment_terms", label: "账期" },
            { key: "payable_balance", label: "应付余额", render: formatCurrency },
          ]}
        />
        <DataTable
          title="采购订单"
          icon={ClipboardList}
          rows={snapshot.board.purchaseOrders}
          columns={[
            { key: "purchase_no", label: "采购单号" },
            { key: "supplier_name", label: "供应商" },
            { key: "source_requisition_no", label: "来源申请", render: (value) => String(value ?? "-") },
            { key: "contract_no", label: "采购合同", render: (value) => String(value ?? "-") },
            { key: "arrival_no", label: "到货通知", render: (value) => String(value ?? "-") },
            { key: "total_amount", label: "金额", render: formatCurrency },
            { key: "approval_no", label: "审批单" },
            { key: "due_date", label: "付款日", render: shortDate },
            { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "id",
              label: "操作",
              render: (value, row) => {
                if (row.status === "pending_receipt") {
                  return (
                    <div className="flex gap-2">
                      {canPurchase && !row.contract_no ? (
                        <InlineActionButton
                          label="合同下单"
                          busy={busy === `createPurchaseContract-${String(value)}-primary`}
                          onClick={() =>
                            void runAction({
                              action: "createPurchaseContract",
                              entityId: String(value),
                              payload: {
                                contract_date: new Date().toISOString().slice(0, 10),
                                delivery_date: String(row.due_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
                              },
                            })
                          }
                        />
                      ) : null}
                      {canPurchase && row.contract_no && !row.arrival_no ? (
                        <InlineActionButton
                          label="到货通知"
                          busy={busy === `createPurchaseArrivalNotice-${String(value)}-primary`}
                          onClick={() =>
                            void runAction({
                              action: "createPurchaseArrivalNotice",
                              entityId: String(value),
                              payload: {
                                arrived_at: new Date().toISOString().slice(0, 10),
                                note: "供应商到货，生成入库通知单并等待仓库签收。",
                              },
                            })
                          }
                        />
                      ) : null}
                      {canWarehouse && row.arrival_status === "pending_signoff" ? (
                        <InlineActionButton
                          label="仓库签收"
                          busy={busy === `signPurchaseArrivalNotice-${String(row.arrival_notice_id)}-primary`}
                          onClick={() =>
                            void runAction({
                              action: "signPurchaseArrivalNotice",
                              entityId: String(row.arrival_notice_id),
                              payload: {
                                warehouse_received_at: new Date().toISOString().slice(0, 10),
                                warehouse_note: "仓库核对到货数量与采购单一致，已签收。",
                              },
                            })
                          }
                        />
                      ) : null}
                      {(canPurchase || canWarehouse) && row.arrival_status === "pending_signoff" ? (
                        <InlineActionButton
                          label="登记差异"
                          busy={busy === `registerPurchaseArrivalDiscrepancy-${String(row.arrival_notice_id)}-primary`}
                          onClick={() =>
                            void runAction({
                              action: "registerPurchaseArrivalDiscrepancy",
                              entityId: String(row.arrival_notice_id),
                              payload: buildArrivalDiscrepancyPayload(
                                snapshot.board.purchaseArrivalNotices.find((notice) => String(notice.id) === String(row.arrival_notice_id)) ?? row,
                              ),
                            })
                          }
                        />
                      ) : null}
                      {(canPurchase || canWarehouse) && row.arrival_status === "signed" ? (
                        <InlineActionButton
                          label="提交IQC"
                          busy={busy === `createMaterialIqcInspection-${String(value)}-primary`}
                          onClick={() =>
                            void runAction({
                              action: "createMaterialIqcInspection",
                              entityId: String(value),
                              payload: {
                                arrival_notice_id: String(row.arrival_notice_id),
                                note: "仓库已签收，提交 IQC 原料检验。",
                              },
                            })
                          }
                        />
                      ) : null}
                      {row.arrival_status === "iqc_created" ? <span className="text-xs text-amber-600">待 IQC</span> : null}
                      {row.arrival_status === "discrepancy_pending" ? <span className="text-xs text-rose-600">差异审批中</span> : null}
                      {row.arrival_status === "discrepancy_approved" ? <span className="text-xs text-blue-600">差异待处理</span> : null}
                    </div>
                  );
                }
                if (row.status === "pending_approval") return <span className="text-xs text-amber-600">待审批</span>;
                if (row.status === "iqc_pending") return <span className="text-xs text-amber-600">待 IQC</span>;
                if (row.status === "iqc_rejected") return <span className="text-xs text-rose-600">IQC 未通过</span>;
                if (row.status === "received") {
                  return (
                    <InlineActionButton
                      label="入库单"
                      busy={false}
                      onClick={() => downloadExport(actorId, "purchase-receipt", value)}
                    />
                  );
                }
                return <span className="text-xs text-slate-400">-</span>;
              },
            },
            {
              key: "purchase_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("采购订单详情", String(row.purchase_no), row, [
                        ["供应商", "supplier_name"],
                        ["来源申请", "source_requisition_no"],
                        ["采购合同", "contract_no"],
                        ["合同状态", "contract_status_label"],
                        ["到货通知", "arrival_no"],
                        ["到货状态", "arrival_status_label"],
                        ["采购金额", "total_amount", formatCurrency],
                        ["审批单", "approval_no"],
                        ["审批状态", "approval_status"],
                        ["付款日", "due_date", shortDate],
                        ["状态", "status"],
                        ["创建时间", "created_at", shortDate],
                        ["入库时间", "received_at", shortDate],
                      ]),
                      lines: detailLines(row.lines),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
          action={{ label: "采购对账", onClick: () => downloadExport(actorId, "purchase-statement") }}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="采购合同附件归档" icon={Upload} action="本地数据盘">
          {snapshot.board.purchaseContracts.length > 0 ? (
            <div className="grid gap-3">
              <MasterSelect
                label="采购合同"
                value={String(selectedContractForAttachment?.id ?? "")}
                onChange={(value) => setContractAttachmentForm((current) => ({ ...current, contract_id: value }))}
              >
                {snapshot.board.purchaseContracts.map((contract) => (
                  <option key={String(contract.id)} value={String(contract.id)}>
                    {String(contract.contract_no)} / {String(contract.supplier_name)}
                  </option>
                ))}
              </MasterSelect>
              <MasterSelect
                label="附件分类"
                value={contractAttachmentForm.category}
                onChange={(value) => setContractAttachmentForm((current) => ({ ...current, category: value }))}
              >
                <option value="采购合同">采购合同</option>
                <option value="供应商报价">供应商报价</option>
                <option value="补充协议">补充协议</option>
                <option value="送货凭证">送货凭证</option>
                <option value="采购发票">采购发票</option>
              </MasterSelect>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                附件文件
                <input
                  ref={contractAttachmentInputRef}
                  type="file"
                  className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700"
                />
              </label>
              <MasterTextarea
                label="归档说明"
                value={contractAttachmentForm.note}
                onChange={(value) => setContractAttachmentForm((current) => ({ ...current, note: value }))}
              />
              <MasterSubmitButton
                busy={false}
                label="上传合同附件"
                onClick={submitContractAttachment}
              />
            </div>
          ) : (
            <EmptyText text="采购合同生成后，可在这里上传供应商盖章件、报价确认或补充协议。" />
          )}
        </Panel>
        <DataTable
          title="采购合同附件台账"
          icon={FileCheck2}
          rows={snapshot.board.documentAttachments.filter((item) => item.entity_type === "purchase_contract")}
          columns={[
            { key: "attachment_no", label: "附件编号" },
            { key: "entity_no", label: "合同号" },
            { key: "category", label: "分类" },
            { key: "file_name", label: "文件名" },
            { key: "size_label", label: "大小" },
            { key: "uploaded_by_name", label: "上传人" },
            { key: "uploaded_at", label: "上传时间", render: shortDate },
            {
              key: "download",
              label: "下载",
              render: (_value, row) => (
                <InlineActionButton
                  label="下载"
                  onClick={() => {
                    window.location.href = `/api/attachments?actorId=${encodeURIComponent(actorId)}&id=${encodeURIComponent(String(row.id))}`;
                  }}
                />
              ),
            },
          ]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="采购合同 / 供应商下单"
          icon={ReceiptText}
          rows={snapshot.board.purchaseContracts}
          columns={[
            { key: "contract_no", label: "合同号" },
            { key: "purchase_no", label: "采购单" },
            { key: "supplier_name", label: "供应商" },
            { key: "supplier_order_no", label: "供应商单号" },
            { key: "contract_date", label: "合同日期", render: shortDate },
            { key: "delivery_date", label: "约定到货", render: shortDate },
            { key: "total_amount", label: "金额", render: formatCurrency },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "contract_detail",
              label: "操作",
              render: (_value, row) => (
                <div className="flex gap-2">
                  <InlineActionButton label="预览" onClick={() => setFormalPreview(buildPurchaseContractPrintPreview(row))} />
                  <InlineActionButton label="导出" onClick={() => downloadExport(actorId, "purchase-contract", row.id)} />
                  <DetailButton
                    onClick={() =>
                      openDetail({
                        ...makeDetail("采购合同详情", String(row.contract_no), row, [
                          ["采购单", "purchase_no"],
                          ["供应商", "supplier_name"],
                          ["供应商单号", "supplier_order_no"],
                          ["合同日期", "contract_date", shortDate],
                          ["约定到货", "delivery_date", shortDate],
                          ["付款条款", "payment_terms"],
                          ["合同金额", "total_amount", formatCurrency],
                          ["状态", "status_label"],
                          ["制单人", "created_by_name"],
                          ["备注", "note"],
                        ]),
                        lines: detailLines(row.lines),
                        audits: auditRows(snapshot, row.id),
                      })
                    }
                  />
                </div>
              ),
            },
          ]}
          action={{ label: "合同导出", onClick: () => downloadExport(actorId, "purchase-contract") }}
        />
        <DataTable
          title="到货通知 / 仓库签收"
          icon={Truck}
          rows={snapshot.board.purchaseArrivalNotices}
          columns={[
            { key: "arrival_no", label: "到货通知" },
            { key: "purchase_no", label: "采购单" },
            { key: "contract_no", label: "合同号", render: (value) => String(value ?? "-") },
            { key: "supplier_name", label: "供应商" },
            { key: "arrived_at", label: "到货日期", render: shortDate },
            { key: "total_arrived_qty", label: "到货量" },
            { key: "total_amount", label: "到货金额", render: formatCurrency },
            { key: "warehouse_received_by_name", label: "签收人", render: (value) => String(value ?? "-") },
            { key: "iqc_no", label: "IQC单", render: (value) => String(value ?? "-") },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "arrival_ops",
              label: "操作",
              render: (_value, row) => (
                <div className="flex gap-2">
                  {canWarehouse && row.status === "pending_signoff" ? (
                    <InlineActionButton
                      label="签收"
                      busy={busy === `signPurchaseArrivalNotice-${String(row.id)}-primary`}
                      onClick={() =>
                        void runAction({
                          action: "signPurchaseArrivalNotice",
                          entityId: String(row.id),
                          payload: {
                            warehouse_received_at: new Date().toISOString().slice(0, 10),
                            warehouse_note: "仓库核对到货数量与采购单一致，已签收。",
                          },
                        })
                      }
                    />
                  ) : null}
                  {(canPurchase || canWarehouse) && row.status === "pending_signoff" ? (
                    <InlineActionButton
                      label="登记差异"
                      busy={busy === `registerPurchaseArrivalDiscrepancy-${String(row.id)}-primary`}
                      onClick={() =>
                        void runAction({
                          action: "registerPurchaseArrivalDiscrepancy",
                          entityId: String(row.id),
                          payload: buildArrivalDiscrepancyPayload(row),
                        })
                      }
                    />
                  ) : null}
                  {row.status === "discrepancy_pending" ? <span className="text-xs text-rose-600">差异审批中</span> : null}
                  {row.status === "discrepancy_approved" ? <span className="text-xs text-blue-600">差异待处理</span> : null}
                  {(canPurchase || canWarehouse) && row.status === "signed" ? (
                    <InlineActionButton
                      label="提交IQC"
                      busy={busy === `createMaterialIqcInspection-${String(row.purchase_order_id)}-primary`}
                      onClick={() =>
                        void runAction({
                          action: "createMaterialIqcInspection",
                          entityId: String(row.purchase_order_id),
                          payload: {
                            arrival_notice_id: String(row.id),
                            note: "仓库签收后提交 IQC 来料检验。",
                          },
                        })
                      }
                    />
                  ) : null}
                  <InlineActionButton
                    label="到货预览"
                    onClick={() => setFormalPreview(buildPurchaseArrivalNoticePrintPreview(row))}
                  />
                  <InlineActionButton
                    label="到货导出"
                    onClick={() => downloadExport(actorId, "purchase-arrival-notice", row.id)}
                  />
                  {row.status !== "pending_signoff" ? (
                    <>
                      <InlineActionButton
                        label="签收预览"
                        onClick={() => setFormalPreview(buildWarehouseSignoffPrintPreview(row))}
                      />
                      <InlineActionButton
                        label="签收导出"
                        onClick={() => downloadExport(actorId, "warehouse-signoff", row.id)}
                      />
                    </>
                  ) : null}
                  <DetailButton
                    onClick={() =>
                      openDetail({
                        ...makeDetail("到货通知详情", String(row.arrival_no), row, [
                          ["采购单", "purchase_no"],
                          ["采购合同", "contract_no"],
                          ["供应商", "supplier_name"],
                          ["到货日期", "arrived_at", shortDate],
                          ["到货金额", "total_amount", formatCurrency],
                          ["制单人", "created_by_name"],
                          ["签收人", "warehouse_received_by_name"],
                          ["签收时间", "warehouse_received_at", shortDate],
                          ["IQC单", "iqc_no"],
                          ["状态", "status_label"],
                          ["到货说明", "note"],
                          ["签收说明", "warehouse_note"],
                        ]),
                        lines: detailLines(row.lines),
                        audits: auditRows(snapshot, row.id),
                      })
                    }
                  />
                </div>
              ),
            },
          ]}
          action={{ label: "到货单导出", onClick: () => downloadExport(actorId, "purchase-arrival-notice") }}
        />
      </div>
      <DataTable
        title="供应商绩效评分"
        icon={Gauge}
        rows={snapshot.board.supplierPerformance}
        columns={[
          { key: "supplier_name", label: "供应商" },
          { key: "performance_score", label: "评分", render: (value) => Number(value ?? 0).toFixed(2) },
          { key: "grade_label", label: "等级", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "risk_level_label", label: "风险", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "admission_status_label", label: "准入", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "purchase_allowed_label", label: "采购控制", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "purchase_order_count", label: "采购单" },
          { key: "on_time_delivery_rate", label: "准时率", render: percentNumberValue },
          { key: "iqc_pass_rate", label: "IQC合格", render: percentNumberValue },
          { key: "discrepancy_rate", label: "差异率", render: percentNumberValue },
          { key: "overdue_payable_count", label: "逾期应付" },
          { key: "recommendation", label: "采购建议" },
          {
            key: "supplier_risk_ops",
            label: "准入操作",
            render: (_value, row) => (
              <div className="flex gap-2">
                {canPurchase || canReviewSupplier ? (
                  <InlineActionButton
                    label="评估"
                    busy={busy === `evaluateSupplierAdmissionRules-${String(row.supplier_id)}-primary`}
                    onClick={() =>
                      void runAction({
                        action: "evaluateSupplierAdmissionRules",
                        entityId: String(row.supplier_id),
                        payload: {
                          source_type: "manual_review",
                          source_id: `manual-${Date.now()}`,
                        },
                      })
                    }
                  />
                ) : null}
                {canPurchase || canReviewSupplier ? (
                  <InlineActionButton
                    label="生成整改"
                    busy={busy === `createSupplierCorrectiveAction-${String(row.supplier_id)}-primary`}
                    onClick={() =>
                      void runAction({
                        action: "createSupplierCorrectiveAction",
                        entityId: String(row.supplier_id),
                        payload: {
                          control_status: row.risk_level === "high" ? "restricted" : "watch",
                          reason: String(row.recommendation || "供应商绩效波动，需提交整改并复评。"),
                          required_action: "提交质量/交付整改计划、批次追溯资料和下一批来料自检证明。",
                          due_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10),
                          owner_id: "U-PUR",
                        },
                      })
                    }
                  />
                ) : null}
                {canReviewSupplier ? (
                  <InlineActionButton
                    label="拉黑"
                    busy={busy === `blacklistSupplier-${String(row.supplier_id)}-primary`}
                    onClick={() =>
                      void runAction({
                        action: "blacklistSupplier",
                        entityId: String(row.supplier_id),
                        payload: {
                          reason: "管理层判定供应商质量、交付或差异风险不可接受，暂停新增采购。",
                          required_action: "提交8D整改报告、质量复盘、批次追溯和恢复供货申请。",
                          due_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().slice(0, 10),
                          owner_id: "U-PUR",
                        },
                      })
                    }
                  />
                ) : null}
                {canPurchase || canReviewSupplier ? (
                  <InlineActionButton
                    label="资质登记"
                    busy={busy === `upsertSupplierCertificate-${String(row.supplier_id)}-primary`}
                    onClick={() =>
                      void runAction({
                        action: "upsertSupplierCertificate",
                        entityId: String(row.supplier_id),
                        payload: {
                          certificate_type: "quality_system",
                          certificate_name: "ISO9001 质量管理体系认证",
                          certificate_no: `ISO-${String(row.supplier_code || row.supplier_id)}-${Date.now()}`,
                          issued_at: new Date().toISOString().slice(0, 10),
                          expires_at: "2026-12-31",
                          remind_days: "90",
                          note: "正式流程演示：登记供应商资质证书并纳入到期提醒。",
                        },
                      })
                    }
                  />
                ) : null}
                {canPurchase || canReviewSupplier ? (
                  <InlineActionButton
                    label="年度复评"
                    busy={busy === `recordSupplierAnnualReview-${String(row.supplier_id)}-primary`}
                    onClick={() => {
                      const score = Number(row.performance_score ?? 85);
                      return void runAction({
                        action: "recordSupplierAnnualReview",
                        entityId: String(row.supplier_id),
                        payload: {
                          review_year: String(new Date().getFullYear()),
                          quality_score: String(Math.max(0, Math.min(100, score))),
                          delivery_score: String(Math.max(0, Math.min(100, score + 2))),
                          certificate_score: String(Math.max(0, Math.min(100, score + 1))),
                          cooperation_score: String(Math.max(0, Math.min(100, score + 3))),
                          final_score: String(Math.max(0, Math.min(100, score))),
                          conclusion: canReviewSupplier
                            ? "正式流程演示：管理层按年度供应商绩效和资质情况完成复评，系统自动调整准入等级。"
                            : "正式流程演示：采购提交年度复评，准入等级变化自动联动管理层审批。",
                          next_review_due_at: `${new Date().getFullYear() + 1}-12-31`,
                        },
                      });
                    }}
                  />
                ) : null}
              </div>
            ),
          },
        ]}
        action={{ label: "评分报表", onClick: () => downloadExport(actorId, "supplier-performance") }}
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <DataTable
          title="供应商资质证书"
          icon={FileCheck2}
          rows={snapshot.board.supplierQualificationCertificates}
          columns={[
            { key: "qualification_no", label: "资质单号" },
            { key: "supplier_name", label: "供应商" },
            { key: "certificate_type_label", label: "资质类型" },
            { key: "certificate_name", label: "资质名称" },
            { key: "certificate_no", label: "证书编号" },
            { key: "status_label", label: "生命周期", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "expires_at", label: "到期日", render: shortDate },
            { key: "days_until_expiry", label: "剩余天数", render: (value) => `${String(value ?? 0)} 天` },
            { key: "expiry_status_label", label: "到期状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "renewed_from_no", label: "来源旧证", render: (value) => String(value || "-") },
            { key: "renewed_to_no", label: "续证去向", render: (value) => String(value || "-") },
            { key: "attachment_count", label: "附件" },
            { key: "latest_attachment_name", label: "最新附件", render: (value) => String(value || "-") },
            { key: "note", label: "说明" },
            {
              key: "certificate_attachment_download",
              label: "下载",
              render: (_value, row) =>
                row.latest_attachment_id ? (
                  <InlineActionButton
                    label="下载"
                    onClick={() => {
                      window.location.href = `/api/attachments?actorId=${encodeURIComponent(actorId)}&id=${encodeURIComponent(String(row.latest_attachment_id))}`;
                    }}
                  />
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                ),
            },
            {
              key: "certificate_renewal_ops",
              label: "续证",
              render: (_value, row) =>
                (canPurchase || canReviewSupplier) && String(row.status) === "active" ? (
                  <InlineActionButton
                    label="续证"
                    busy={busy === `renewSupplierCertificate-${String(row.id)}-primary`}
                    onClick={() =>
                      void runAction({
                        action: "renewSupplierCertificate",
                        entityId: String(row.id),
                        payload: {
                          certificate_type: String(row.certificate_type || "other"),
                          certificate_name: String(row.certificate_name || "供应商资质证书"),
                          certificate_no: `${String(row.certificate_no || "CERT")}-RENEW-${Date.now()}`,
                          issued_at: new Date().toISOString().slice(0, 10),
                          expires_at: `${new Date().getFullYear() + 2}-12-31`,
                          remind_days: String(row.remind_days || 90),
                          note: "供应商提交新版资质证书，系统自动归档旧证并建立续证链路。",
                        },
                      })
                    }
                  />
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                ),
            },
          ]}
          empty="暂无供应商资质证书。可在供应商绩效评分中点击资质登记。"
        />
        <DataTable
          title="年度复评待办"
          icon={ClipboardList}
          rows={snapshot.board.supplierAnnualReviewDue}
          columns={[
            { key: "supplier_name", label: "供应商" },
            { key: "latest_review_year", label: "最近年度" },
            { key: "next_review_due_at", label: "下次复评", render: (value) => String(value || "-") },
            { key: "due_reason", label: "待办原因", render: (value) => <StatusBadge value={String(value)} /> },
          ]}
          empty="暂无年度复评待办。"
        />
        <DataTable
          title="供应商年度复评"
          icon={Gauge}
          rows={snapshot.board.supplierAnnualReviews}
          columns={[
            { key: "annual_review_no", label: "复评单号" },
            { key: "supplier_name", label: "供应商" },
            { key: "review_year", label: "年度" },
            { key: "final_score", label: "总分", render: (value) => Number(value ?? 0).toFixed(2) },
            { key: "status_label", label: "生效状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "approval_no", label: "审批单", render: (value) => String(value || "-") },
            { key: "approval_status_label", label: "审批状态", render: (value) => (value ? <StatusBadge value={String(value)} /> : "-") },
            { key: "certificate_status_label", label: "资质状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "previous_status_label", label: "原准入", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "next_status_label", label: "新准入", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "result_label", label: "结果", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "reviewer_name", label: "复评人" },
            { key: "approved_by_name", label: "审批人", render: (value) => String(value || "-") },
            { key: "next_review_due_at", label: "下次复评", render: shortDate },
            { key: "conclusion", label: "结论" },
          ]}
          empty="暂无年度复评记录。可由管理层在供应商绩效评分中发起年度复评。"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="必备资质要求"
          icon={ShieldCheck}
          rows={snapshot.board.supplierQualificationRequirements}
          columns={[
            { key: "requirement_no", label: "要求编号" },
            { key: "scope_type_label", label: "适用范围", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "material_name", label: "指定物料", render: (value) => String(value || "-") },
            { key: "certificate_type_label", label: "资质类型" },
            { key: "certificate_name", label: "必备资质" },
            { key: "min_valid_days", label: "最小有效天数" },
            { key: "block_purchase_label", label: "采购控制", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "description", label: "规则说明" },
          ]}
          empty="暂无必备资质要求。"
        />
        <DataTable
          title="供应商资质矩阵"
          icon={FileCheck2}
          rows={snapshot.board.supplierQualificationMatrix}
          columns={[
            { key: "supplier_name", label: "供应商" },
            { key: "material_name", label: "适用物料", render: (value) => String(value || "通用") },
            { key: "certificate_name", label: "必备资质" },
            { key: "matched_certificate_no", label: "匹配证书", render: (value) => String(value || "-") },
            { key: "matched_expires_at", label: "证书到期", render: (value) => (value ? shortDate(value) : "-") },
            { key: "compliance_status_label", label: "合规状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "purchase_blocking_label", label: "下单控制", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "description", label: "说明" },
          ]}
          empty="暂无供应商资质矩阵。"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="供应商资质附件归档" icon={Upload} action={canPurchase || canReviewSupplier ? "本地数据盘" : "只读"}>
          {canPurchase || canReviewSupplier ? (
            <div className="grid gap-3">
              <MasterSelect
                label="关联资质"
                value={supplierCertificateAttachmentForm.certificate_id}
                onChange={(value) => updateSupplierCertificateAttachmentField("certificate_id", value)}
              >
                {snapshot.board.supplierQualificationCertificates.map((certificate) => (
                  <option key={String(certificate.id)} value={String(certificate.id)}>
                    {String(certificate.qualification_no)} / {String(certificate.supplier_name)} / {String(certificate.expiry_status_label)}
                  </option>
                ))}
              </MasterSelect>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                资质附件
                <input
                  ref={supplierCertificateAttachmentInputRef}
                  type="file"
                  className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700"
                />
              </label>
              <MasterInput
                label="归档分类"
                value={supplierCertificateAttachmentForm.category}
                onChange={(value) => updateSupplierCertificateAttachmentField("category", value)}
              />
              <MasterTextarea
                label="附件说明"
                value={supplierCertificateAttachmentForm.note}
                onChange={(value) => updateSupplierCertificateAttachmentField("note", value)}
              />
              <button
                type="button"
                disabled={!selectedSupplierCertificateForAttachment}
                onClick={() => void submitSupplierCertificateAttachment()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Upload className="h-4 w-4" />
                上传资质附件
              </button>
            </div>
          ) : (
            <EmptyText text="采购、管理层或管理员可上传供应商资质附件。" />
          )}
        </Panel>
        <DataTable
          title="供应商资质附件台账"
          icon={FileCheck2}
          rows={supplierCertificateAttachments}
          columns={[
            { key: "attachment_no", label: "附件编号" },
            { key: "entity_no", label: "资质单号" },
            { key: "category", label: "分类" },
            { key: "file_name", label: "文件名" },
            { key: "size_label", label: "大小" },
            { key: "uploaded_by_name", label: "上传人" },
            { key: "uploaded_at", label: "上传时间", render: shortDate },
            {
              key: "download",
              label: "下载",
              render: (_value, row) => (
                <InlineActionButton
                  label="下载"
                  onClick={() => {
                    window.location.href = `/api/attachments?actorId=${encodeURIComponent(actorId)}&id=${encodeURIComponent(String(row.id))}`;
                  }}
                />
              ),
            },
          ]}
          empty="暂无供应商资质附件。"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="供应商准入控制"
          icon={ShieldCheck}
          rows={snapshot.board.supplierAdmissionControls}
          columns={[
            { key: "control_no", label: "准入单号" },
            { key: "supplier_name", label: "供应商" },
            { key: "control_status_label", label: "准入状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "purchase_allowed_label", label: "采购控制", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "performance_score", label: "复评/评分", render: (value) => Number(value ?? 0).toFixed(2) },
            { key: "open_action_count", label: "未结整改" },
            { key: "latest_action_no", label: "最新整改" },
            { key: "updated_by_name", label: "更新人", render: (value) => String(value ?? "-") },
            { key: "updated_at", label: "更新时间", render: shortDate },
            { key: "reason", label: "原因" },
          ]}
          empty="暂无准入限制。供应商绩效出现风险时，可从评分表生成整改或纳入黑名单。"
        />
        <DataTable
          title="供应商整改 / 复评"
          icon={FileCheck2}
          rows={snapshot.board.supplierCorrectiveActions}
          columns={[
            { key: "action_no", label: "整改单" },
            { key: "supplier_name", label: "供应商" },
            { key: "control_status_label", label: "准入状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "status_label", label: "整改状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "severity_label", label: "等级" },
            { key: "owner_name", label: "责任人", render: (value) => String(value ?? "-") },
            { key: "due_date", label: "到期日", render: shortDate },
            { key: "required_action", label: "整改要求" },
            { key: "evidence_note", label: "证据", render: (value) => String(value || "-") },
            { key: "review_result_label", label: "复评结果", render: (value) => (value ? <StatusBadge value={String(value)} /> : "-") },
            {
              key: "supplier_correction_ops",
              label: "操作",
              render: (_value, row) => (
                <div className="flex gap-2">
                  {(canPurchase || canReviewSupplier) && ["open", "rejected"].includes(String(row.status)) ? (
                    <InlineActionButton
                      label={row.status === "rejected" ? "重新提交" : "提交复评"}
                      busy={busy === `submitSupplierCorrection-${String(row.id)}-primary`}
                      onClick={() =>
                        void runAction({
                          action: "submitSupplierCorrection",
                          entityId: String(row.id),
                          payload: {
                            evidence_note: "供应商已提交整改报告、追溯资料和下一批来料自检记录，采购已完成初审。",
                          },
                        })
                      }
                    />
                  ) : null}
                  {canReviewSupplier && row.status === "submitted" ? (
                    <>
                      <InlineActionButton
                        label="通过"
                        busy={busy === `reviewSupplierCorrection-${String(row.id)}-primary`}
                        onClick={() =>
                          void runAction({
                            action: "reviewSupplierCorrection",
                            entityId: String(row.id),
                            payload: {
                              result: "passed",
                              reassessment_score: "88",
                              review_note: "整改材料完整，恢复采购准入并纳入观察。",
                            },
                          })
                        }
                      />
                      <InlineActionButton
                        label="驳回"
                        busy={busy === `reviewSupplierCorrection-${String(row.id)}-secondary`}
                        onClick={() =>
                          void runAction({
                            action: "reviewSupplierCorrection",
                            entityId: String(row.id),
                            variant: "secondary",
                            payload: {
                              result: "failed",
                              reassessment_score: "62",
                              review_note: "整改证据不足，维持采购限制并要求补充资料。",
                            },
                          })
                        }
                      />
                    </>
                  ) : null}
                  <DetailButton
                    onClick={() =>
                      openDetail({
                        ...makeDetail("供应商整改详情", String(row.action_no), row, [
                          ["供应商", "supplier_name"],
                          ["准入状态", "control_status_label"],
                          ["整改状态", "status_label"],
                          ["风险等级", "severity_label"],
                          ["责任人", "owner_name"],
                          ["到期日", "due_date", shortDate],
                          ["整改要求", "required_action"],
                          ["整改证据", "evidence_note"],
                          ["复评结果", "review_result_label"],
                          ["复评意见", "review_note"],
                        ]),
                        audits: auditRows(snapshot, row.id),
                      })
                    }
                  />
                </div>
              ),
            },
          ]}
          empty="暂无供应商整改任务。"
        />
      </div>
      <Panel
        title="供应商准入规则配置"
        icon={ShieldCheck}
        action={canConfigureSupplierAdmissionRules ? "指标 / 阈值 / 准入动作" : "只读"}
      >
        {canConfigureSupplierAdmissionRules ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
              <MasterSelect
                label="编辑规则"
                value={supplierRuleForm.rule_id || "new"}
                onChange={(value) => {
                  if (value === "new") {
                    resetSupplierRuleForm();
                    return;
                  }
                  const rule = snapshot.board.supplierAdmissionRules.find((item) => String(item.id) === value);
                  if (rule) loadSupplierRuleForm(rule);
                }}
              >
                <option value="new">新增规则</option>
                {snapshot.board.supplierAdmissionRules.map((rule) => (
                  <option key={String(rule.id)} value={String(rule.id)}>
                    {String(rule.rule_code)} / {String(rule.rule_name)}
                  </option>
                ))}
              </MasterSelect>
              <MasterInput label="规则编号" value={supplierRuleForm.rule_code} onChange={(value) => setSupplierRuleField("rule_code", value)} />
              <MasterInput label="规则名称" value={supplierRuleForm.rule_name} onChange={(value) => setSupplierRuleField("rule_name", value)} />
              <MasterSelect label="状态" value={supplierRuleForm.status} onChange={(value) => setSupplierRuleField("status", value)}>
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </MasterSelect>
            </div>
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_150px_1fr_1fr_120px]">
              <MasterSelect label="评估指标" value={supplierRuleForm.metric_key} onChange={(value) => setSupplierRuleField("metric_key", value)}>
                <option value="performance_score">综合评分</option>
                <option value="discrepancy_rate">到货差异率</option>
                <option value="iqc_failed_streak">连续 IQC 不合格</option>
                <option value="open_discrepancy_count">未结差异单</option>
                <option value="overdue_payable_count">逾期应付</option>
              </MasterSelect>
              <MasterSelect label="触发条件" value={supplierRuleForm.operator} onChange={(value) => setSupplierRuleField("operator", value)}>
                <option value="lt">小于</option>
                <option value="lte">小于等于</option>
                <option value="gt">大于</option>
                <option value="gte">大于等于</option>
                <option value="eq">等于</option>
              </MasterSelect>
              <MasterInput
                label="阈值"
                type="number"
                value={supplierRuleForm.threshold_value}
                onChange={(value) => setSupplierRuleField("threshold_value", value)}
              />
              <MasterSelect
                label="触发后准入"
                value={supplierRuleForm.target_status}
                onChange={(value) => setSupplierRuleField("target_status", value)}
              >
                <option value="watch">观察准入</option>
                <option value="restricted">限制采购</option>
                <option value="blacklisted">黑名单</option>
                <option value="normal">准入正常</option>
              </MasterSelect>
              <MasterSelect
                label="整改动作"
                value={supplierRuleForm.require_correction}
                onChange={(value) => setSupplierRuleField("require_correction", value)}
              >
                <option value="true">自动生成整改</option>
                <option value="false">仅记录事件</option>
              </MasterSelect>
              <MasterInput
                label="优先级"
                type="number"
                value={supplierRuleForm.priority}
                onChange={(value) => setSupplierRuleField("priority", value)}
              />
            </div>
            <div className="grid gap-3 lg:grid-cols-[1fr_160px_120px]">
              <MasterInput
                label="规则说明"
                value={supplierRuleForm.description}
                onChange={(value) => setSupplierRuleField("description", value)}
              />
              <div className="flex items-end">
                <MasterSubmitButton
                  busy={
                    busy === `submitSupplierAdmissionRuleChange-${supplierRuleForm.rule_id || "system"}-primary` ||
                    busy === "submitSupplierAdmissionRuleChange-system-primary"
                  }
                  label={supplierRuleForm.rule_id ? "提交变更审批" : "提交新增审批"}
                  onClick={submitSupplierAdmissionRule}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={resetSupplierRuleForm}
                  className="h-10 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
                >
                  新增
                </button>
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">生效前影响预览</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {supplierRuleImpactLoading
                      ? "正在按当前供应商绩效、差异、IQC 和整改状态测算..."
                      : supplierRuleImpactPreview
                        ? String(supplierRuleImpactPreview.summary_text ?? "")
                        : "调整规则后会自动测算受影响供应商。"}
                  </div>
                </div>
                {supplierRuleImpactPreview ? (
                  <StatusBadge value={String((supplierRuleImpactPreview.summary as Row | undefined)?.risk_level ?? "low")} />
                ) : null}
              </div>
              {supplierRuleImpactError ? <EmptyText text={supplierRuleImpactError} /> : null}
              {supplierRuleImpactPreview ? (
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-4">
                    <MiniMetric label="影响供应商" value={`${String((supplierRuleImpactPreview.summary as Row)?.affected_count ?? 0)} 家`} />
                    <MiniMetric label="限制采购" value={`${String((supplierRuleImpactPreview.summary as Row)?.preview_restricted_count ?? 0)} 家`} />
                    <MiniMetric label="限制增量" value={`${String((supplierRuleImpactPreview.summary as Row)?.delta_restricted_count ?? 0)} 家`} />
                    <MiniMetric label="预计整改" value={`${String((supplierRuleImpactPreview.summary as Row)?.correction_count ?? 0)} 项`} />
                  </div>
                  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-white text-xs font-semibold uppercase text-slate-500">
                          <th className="px-3 py-2">供应商</th>
                          <th className="px-3 py-2">评分</th>
                          <th className="px-3 py-2">当前规则</th>
                          <th className="px-3 py-2">预览规则</th>
                          <th className="px-3 py-2">当前准入</th>
                          <th className="px-3 py-2">预览准入</th>
                          <th className="px-3 py-2">预计整改</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {((supplierRuleImpactPreview.items as Row[] | undefined) ?? []).slice(0, 6).map((item) => (
                          <tr key={String(item.supplier_id)}>
                            <td className="px-3 py-2 font-medium text-slate-900">{String(item.supplier_name ?? "-")}</td>
                            <td className="px-3 py-2 text-slate-600">{Number(item.performance_score ?? 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-slate-600">{String(item.current_rule_code || "-")}</td>
                            <td className="px-3 py-2 text-slate-600">{String(item.preview_rule_code || "-")}</td>
                            <td className="px-3 py-2"><StatusBadge value={String(item.current_status_label ?? "-")} /></td>
                            <td className="px-3 py-2"><StatusBadge value={String(item.preview_status_label ?? "-")} /></td>
                            <td className="px-3 py-2 text-slate-600">{Number(item.will_create_correction ?? 0) ? "是" : "否"}</td>
                          </tr>
                        ))}
                        {((supplierRuleImpactPreview.items as Row[] | undefined) ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-4 text-center text-sm text-slate-500">
                              当前规则变更不会改变供应商准入判断。
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyText text="供应商准入规则配置需使用系统管理员账号。" />
        )}
      </Panel>
      <DataTable
        title="供应商准入规则变更审批"
        icon={FileCheck2}
        rows={snapshot.board.supplierAdmissionRuleChangeRequests}
        columns={[
          { key: "change_no", label: "变更单号" },
          { key: "rule_code", label: "规则编号" },
          { key: "rule_name", label: "规则名称" },
          { key: "request_no", label: "审批单" },
          { key: "affected_count", label: "影响供应商", render: (value) => `${String(value ?? 0)} 家` },
          { key: "preview_restricted_count", label: "限制采购", render: (value) => `${String(value ?? 0)} 家` },
          { key: "correction_count", label: "预计整改", render: (value) => `${String(value ?? 0)} 项` },
          { key: "triggered_event_count", label: "已触发", render: (value) => `${String(value ?? 0)} 条` },
          { key: "corrective_action_count", label: "已生成整改", render: (value) => `${String(value ?? 0)} 项` },
          { key: "created_by_name", label: "提交人" },
          { key: "approved_by_name", label: "审批人", render: (value) => String(value || "-") },
          { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          {
            key: "rule_change_ops",
            label: "详情",
            render: (_value, row) => (
              <DetailButton
                onClick={() =>
                  openDetail({
                    ...makeDetail("供应商准入规则变更详情", String(row.change_no), row, [
                      ["规则编号", "rule_code"],
                      ["规则名称", "rule_name"],
                      ["审批单", "request_no"],
                      ["影响供应商", "affected_count"],
                      ["限制采购", "preview_restricted_count"],
                      ["预计整改", "correction_count"],
                      ["已触发事件", "triggered_event_count"],
                      ["已生成整改", "corrective_action_count"],
                      ["提交人", "created_by_name"],
                      ["审批人", "approved_by_name"],
                      ["审批意见", "approval_note"],
                      ["摘要", "summary_text"],
                      ["状态", "status_label"],
                    ]),
                    lines: ((row.impact_items as Row[] | undefined) ?? []).map((item) => ({
                      supplier: item.supplier_name,
                      currentStatus: item.current_status_label,
                      previewStatus: item.preview_status_label,
                      currentRule: item.current_rule_code || "-",
                      previewRule: item.preview_rule_code || "-",
                      correction: Number(item.will_create_correction ?? 0) ? "是" : "否",
                    })),
                    audits: auditRows(snapshot, row.id),
                  })
                }
              />
            ),
          },
        ]}
        empty="暂无供应商准入规则变更审批记录。"
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="供应商准入自动触发规则"
          icon={ShieldCheck}
          rows={snapshot.board.supplierAdmissionRules}
          columns={[
            { key: "rule_code", label: "规则编号" },
            { key: "rule_name", label: "规则名称" },
            { key: "metric_key", label: "指标" },
            { key: "operator_label", label: "条件" },
            { key: "threshold_value", label: "阈值", render: (value) => Number(value ?? 0).toFixed(2) },
            { key: "target_status_label", label: "触发准入", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "require_correction_label", label: "动作", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "priority", label: "优先级" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "supplier_rule_ops",
              label: "配置",
              render: (_value, row) =>
                canConfigureSupplierAdmissionRules ? (
                  <InlineActionButton label="编辑" onClick={() => loadSupplierRuleForm(row)} />
                ) : (
                  <DetailButton
                    onClick={() =>
                      openDetail(
                        makeDetail("供应商准入规则详情", String(row.rule_code), row, [
                          ["规则名称", "rule_name"],
                          ["评估指标", "metric_key"],
                          ["触发条件", "operator_label"],
                          ["阈值", "threshold_value"],
                          ["触发后准入", "target_status_label"],
                          ["整改动作", "require_correction_label"],
                          ["优先级", "priority"],
                          ["状态", "status_label"],
                          ["规则说明", "description"],
                        ]),
                      )
                    }
                  />
                ),
            },
          ]}
          empty="暂无启用的供应商准入自动规则。"
        />
        <DataTable
          title="准入规则触发事件"
          icon={AlertTriangle}
          rows={snapshot.board.supplierAdmissionRuleEvents}
          columns={[
            { key: "event_no", label: "触发单号" },
            { key: "supplier_name", label: "供应商" },
            { key: "rule_code", label: "规则" },
            { key: "metric_label", label: "指标" },
            { key: "metric_value", label: "当前值", render: (value) => Number(value ?? 0).toFixed(2) },
            { key: "threshold_value", label: "阈值", render: (value) => Number(value ?? 0).toFixed(2) },
            { key: "target_status_label", label: "准入结果", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "source_type", label: "来源类型" },
            { key: "source_id", label: "来源单据" },
            { key: "action_no", label: "关联整改", render: (value) => String(value || "-") },
            { key: "triggered_by_name", label: "触发人" },
            { key: "triggered_at", label: "触发时间", render: shortDate },
          ]}
          empty="暂无规则触发事件。登记到货差异、IQC 不合格或手动评估后会自动记录。"
        />
      </div>
      <DataTable
        title="供应商复评记录"
        icon={ClipboardList}
        rows={snapshot.board.supplierReassessments}
        columns={[
          { key: "reassessment_no", label: "复评单号" },
          { key: "action_no", label: "整改单" },
          { key: "supplier_name", label: "供应商" },
          { key: "previous_status_label", label: "原准入", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "next_status_label", label: "新准入", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "result_label", label: "结果", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "reassessment_score", label: "复评分", render: (value) => Number(value ?? 0).toFixed(2) },
          { key: "reviewer_name", label: "复评人" },
          { key: "reviewed_at", label: "复评时间", render: shortDate },
          { key: "conclusion", label: "结论" },
        ]}
        empty="暂无复评记录。整改提交并由管理层复评后自动生成。"
      />
      <DataTable
        title="供应商恢复采购记录"
        icon={CheckCircle2}
        rows={snapshot.board.supplierAdmissionReleases}
        columns={[
          { key: "release_no", label: "恢复单号" },
          { key: "reassessment_no", label: "复评单号" },
          { key: "action_no", label: "整改单" },
          { key: "supplier_name", label: "供应商" },
          { key: "previous_status_label", label: "恢复前", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "next_status_label", label: "恢复后", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "purchase_allowed_before_label", label: "原采购控制", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "purchase_allowed_after_label", label: "新采购控制", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "release_result_label", label: "结果", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "released_by_name", label: "恢复人" },
          { key: "released_at", label: "恢复时间", render: shortDate },
          { key: "release_reason", label: "恢复依据" },
        ]}
        empty="暂无恢复采购记录。供应商整改复评通过，并从限制下单恢复为允许采购后自动生成。"
      />
      <DataTable
        title="供应商恢复采购观察期"
        icon={Gauge}
        rows={snapshot.board.supplierObservationPeriods}
        columns={[
          { key: "observation_no", label: "观察单号" },
          { key: "release_no", label: "恢复单号" },
          { key: "reassessment_no", label: "复评单号" },
          { key: "supplier_name", label: "供应商" },
          { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "start_at", label: "开始时间", render: shortDate },
          { key: "planned_end_at", label: "计划结束", render: shortDate },
          { key: "days_remaining", label: "剩余天数", render: (value) => `${String(value ?? 0)} 天` },
          { key: "batch_progress", label: "首批进度" },
          { key: "last_batch_source_type_label", label: "合格来源" },
          { key: "breach_source_type_label", label: "异常来源" },
          { key: "breach_reason", label: "异常原因", render: (value) => String(value || "-") },
          { key: "close_reason", label: "观察说明" },
        ]}
        empty="暂无供应商观察期。恢复采购后系统会自动生成 30 天或首批合格的观察期。"
      />
      <DataTable
        title="到货差异处理闭环"
        icon={AlertTriangle}
        rows={snapshot.board.purchaseArrivalDiscrepancies}
        columns={[
          { key: "discrepancy_no", label: "差异单号" },
          { key: "arrival_no", label: "到货通知" },
          { key: "purchase_no", label: "采购单" },
          { key: "supplier_name", label: "供应商" },
          { key: "discrepancy_type_label", label: "差异类型", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "handling_decision_label", label: "处理方式" },
          { key: "quantity_variance_qty", label: "数量差异", render: (value) => formatQty(value) },
          { key: "price_variance_amount", label: "价格差异", render: formatCurrency },
          { key: "total_adjustment_amount", label: "影响金额", render: formatCurrency },
          { key: "approval_no", label: "审批单" },
          { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          {
            key: "discrepancy_ops",
            label: "操作",
            render: (_value, row) => (
              <div className="flex gap-2">
                {canPurchase && row.status === "approved" ? (
                  <InlineActionButton
                    label="处理完成"
                    busy={busy === `resolvePurchaseArrivalDiscrepancy-${String(row.id)}-primary`}
                    onClick={() =>
                      void runAction({
                        action: "resolvePurchaseArrivalDiscrepancy",
                        entityId: String(row.id),
                        payload: {
                          resolution_result: String(row.handling_decision || "supplier_replenish"),
                          resolution_note: "采购已与供应商确认补货/折让方案，差异处理完成，恢复仓库签收流程。",
                        },
                      })
                    }
                  />
                ) : null}
                {row.status === "pending_approval" ? <span className="text-xs text-amber-600">等待审批中心处理</span> : null}
                {row.status === "resolved" ? <span className="text-xs text-emerald-600">已恢复签收</span> : null}
                <InlineActionButton label="预览" onClick={() => setFormalPreview(buildPurchaseArrivalDiscrepancyPrintPreview(row))} />
                <InlineActionButton label="导出" onClick={() => downloadExport(actorId, "purchase-arrival-discrepancy", row.id)} />
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("到货差异单详情", String(row.discrepancy_no), row, [
                        ["到货通知", "arrival_no"],
                        ["采购单", "purchase_no"],
                        ["采购合同", "contract_no"],
                        ["供应商", "supplier_name"],
                        ["差异类型", "discrepancy_type_label"],
                        ["处理方式", "handling_decision_label"],
                        ["数量差异", "quantity_variance_qty"],
                        ["价格差异", "price_variance_amount", formatCurrency],
                        ["影响金额", "total_adjustment_amount", formatCurrency],
                        ["审批单", "approval_no"],
                        ["审批状态", "approval_status"],
                        ["登记人", "created_by_name"],
                        ["批准人", "approved_by_name"],
                        ["处理人", "resolved_by_name"],
                        ["差异原因", "reason"],
                        ["建议处理", "proposed_action"],
                        ["处理说明", "resolution_note"],
                        ["状态", "status_label"],
                      ]),
                      lines: detailLines(row.lines),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              </div>
            ),
          },
        ]}
        action={{ label: "供应商差异报表", onClick: () => downloadExport(actorId, "supplier-discrepancy") }}
      />
      <InventoryTable
        actorId={actorId}
        materials={snapshot.board.materials}
        canPurchase={canCreatePurchaseRequisition}
        busy={busy}
        runAction={runAction}
      />
      <DataTable
        title="库存流水 / 批次追溯"
        icon={Warehouse}
        rows={snapshot.board.inventoryTrace}
        columns={[
          { key: "created_at", label: "发生日期", render: shortDate },
          { key: "movement_type_label", label: "业务动作", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "item_name", label: "物料/产品" },
          { key: "batch_no", label: "批次号" },
          { key: "qty", label: "数量", render: (value, row) => formatQty(value, row.unit) },
          { key: "unit_cost", label: "单位成本", render: formatCurrency },
          { key: "line_amount", label: "成本金额", render: formatCurrency },
          { key: "source_label", label: "来源类型" },
          { key: "source_no", label: "来源单号" },
          { key: "order_no", label: "订单号" },
          {
            key: "trace_party",
            label: "往来对象",
            render: (_value, row) => String(row.supplier_name || row.customer_name || "-"),
          },
          {
            key: "trace_detail",
            label: "详情",
            render: (_value, row) => (
              <DetailButton
                onClick={() =>
                  openDetail(
                    makeDetail("库存流水追溯", String(row.source_no ?? row.id), row, [
                      ["业务动作", "movement_type_label"],
                      ["物料/产品", "item_name"],
                      ["批次号", "batch_no"],
                      ["数量", "qty"],
                      ["单位成本", "unit_cost", formatCurrency],
                      ["成本金额", "line_amount", formatCurrency],
                      ["来源类型", "source_label"],
                      ["来源单号", "source_no"],
                      ["订单号", "order_no"],
                      ["客户", "customer_name"],
                      ["供应商", "supplier_name"],
                      ["发生日期", "created_at", shortDate],
                    ]),
                  )
                }
              />
            ),
          },
        ]}
        action={{ label: "导出追溯", onClick: () => downloadExport(actorId, "inventory-trace") }}
      />
      <DataTable
        title="呆滞与积压库存"
        icon={ShieldCheck}
        rows={snapshot.board.inventoryAging}
        columns={[
          { key: "name", label: "物料" },
          { key: "stock_qty", label: "库存", render: (value, row) => formatQty(value, row.unit) },
          { key: "average_cost", label: "移动均价", render: formatCurrency },
          { key: "stock_value", label: "库存价值", render: formatCurrency },
          { key: "last_movement_at", label: "最近变动", render: shortDate },
          { key: "inactive_days", label: "未动天数", render: (value) => `${String(value ?? 0)} 天` },
          { key: "aging_status_label", label: "状态", render: (value, row) => <StatusBadge value={String(row.aging_status ?? value)} /> },
          { key: "disposition_status_label", label: "处置状态" },
          { key: "disposition_owner_name", label: "责任人" },
          {
            key: "aging_ops",
            label: "处置",
            render: (_value, row) =>
              canDisposeAging ? (
                <InlineActionButton
                  label={row.disposition_status ? "更新处置" : "登记处置"}
                  busy={busy === `recordInventoryAgingDisposition-${String(row.id)}-primary`}
                  onClick={() =>
                    void runAction({
                      action: "recordInventoryAgingDisposition",
                      entityId: String(row.id),
                      payload: {
                        owner_id: snapshot.currentUser.id,
                        status: "tracking",
                        action_plan:
                          row.aging_status === "overstock"
                            ? "纳入6个月积压台账，评估替代消耗、退换货或报废处理。"
                            : "纳入3个月未动预警，复核后续订单需求并优先消耗。",
                        note: "由采购仓储模块登记，进入正式库存老化跟进台账。",
                      },
                    })
                  }
                />
              ) : (
                <span className="text-xs text-slate-400">只读</span>
              ),
          },
        ]}
        action={{ label: "积压报表", onClick: () => downloadExport(actorId, "inventory-overstock") }}
      />
      <DataTable
        title="积压处置台账"
        icon={FileCheck2}
        rows={snapshot.board.inventoryAgingDispositions}
        columns={[
          { key: "material_name", label: "物料" },
          { key: "aging_level", label: "规则", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "inactive_days", label: "未动天数", render: (value) => `${String(value ?? 0)} 天` },
          { key: "status_label", label: "处置状态", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "owner_name", label: "责任人" },
          { key: "action_plan", label: "处置方案" },
          { key: "created_by_name", label: "登记人" },
          { key: "created_at", label: "登记日期", render: shortDate },
        ]}
      />
      <DataTable
        title="供应商应付"
        icon={Download}
        rows={snapshot.board.payables}
        columns={[
          { key: "payable_no", label: "应付单号" },
          { key: "supplier_name", label: "供应商" },
          { key: "total_amount", label: "金额", render: formatCurrency },
          { key: "balance_amount", label: "余额", render: formatCurrency },
          { key: "age_days", label: "账龄", render: (value) => `${String(value ?? 0)} 天` },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          {
            key: "id",
            label: "操作",
            render: (value, row) =>
              canPurchase && row.status !== "paid" ? (
                <InlineActionButton
                  label="登记付款"
                  busy={busy === `recordPayablePayment-${String(value)}-primary`}
                  onClick={() => void runAction({ action: "recordPayablePayment", entityId: String(value) })}
                />
              ) : (
                <span className="text-xs text-slate-400">-</span>
                ),
          },
          {
            key: "payable_detail",
            label: "详情",
            render: (_value, row) => (
              <DetailButton
                onClick={() =>
                  openDetail({
                    ...makeDetail("应付账款详情", String(row.payable_no), row, [
                      ["供应商", "supplier_name"],
                      ["应付金额", "total_amount", formatCurrency],
                      ["已付金额", "paid_amount", formatCurrency],
                      ["未付余额", "balance_amount", formatCurrency],
                      ["账龄", "age_days", dayValue],
                      ["付款日", "due_date", shortDate],
                      ["状态", "status"],
                    ]),
                    audits: auditRows(snapshot, row.id),
                  })
                }
              />
            ),
          },
        ]}
        action={{ label: "采购对账", onClick: () => downloadExport(actorId, "purchase-statement") }}
      />
      <DataTable
        title="库存批次"
        icon={Warehouse}
        rows={snapshot.board.batches}
        columns={[
          { key: "batch_no", label: "批次号" },
          { key: "material_name", label: "物料" },
          { key: "qty", label: "数量" },
          { key: "unit", label: "单位" },
          { key: "unit_cost", label: "单价", render: formatCurrency },
          { key: "received_at", label: "入库日期", render: shortDate },
          { key: "last_movement_at", label: "最近变动", render: shortDate },
          { key: "inactive_days", label: "未动天数", render: (value) => `${String(value ?? 0)} 天` },
          { key: "aging_status_label", label: "状态", render: (value, row) => <StatusBadge value={String(row.aging_status ?? value)} /> },
        ]}
      />
      <FormalPrintPreviewModal preview={formalPreview} onClose={() => setFormalPreview(null)} />
    </div>
  );
}

function QualityModule({
  snapshot,
  currentUser,
  busy,
  runAction,
  openDetail,
}: {
  snapshot: Snapshot;
  currentUser?: User;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
  openDetail: (detail: DetailState) => void;
}) {
  const canRequestInspection = ["production", "admin"].includes(currentUser?.role ?? "");
  const canInspect = ["quality", "admin"].includes(currentUser?.role ?? "");
  const canTechnicalDisposition = ["technical", "admin"].includes(currentUser?.role ?? "");
  const canInbound = ["warehouse", "admin"].includes(currentUser?.role ?? "");
  const technicalDispositions = snapshot.board.technicalDispositions ?? [];
  const qualityAnalytics = snapshot.board.qualityExceptionAnalytics ?? {};
  const qualityTotals = qualityAnalytics.totals ?? {};
  const qualityRootCauses = Array.isArray(qualityAnalytics.rootCauses) ? qualityAnalytics.rootCauses : [];
  const qualityDispositionTypes = Array.isArray(qualityAnalytics.dispositionTypes) ? qualityAnalytics.dispositionTypes : [];
  const producingProductions = snapshot.board.productions.filter((item) => item.status === "producing");
  const pendingInspections = snapshot.board.inspections.filter((item) => item.status === "pending");
  const handledTechnicalInspectionIds = new Set(
    technicalDispositions.filter((item) => item.status !== "voided").map((item) => String(item.inspection_id)),
  );
  const failedInspections = snapshot.board.inspections.filter(
    (item) => item.result === "failed" && !handledTechnicalInspectionIds.has(String(item.id)),
  );
  const reinspectionRows = snapshot.board.inspections.filter((item) => Number(item.is_reinspection ?? 0) === 1);
  const pendingMaterialIqc = snapshot.board.materialIqcInspections.filter((item) => item.status === "pending");
  const inboundableProductions = snapshot.board.productions.filter((item) => item.status === "qa_approved");
  const [requestForm, setRequestForm] = useState<Record<string, string>>({
    production_id: String(producingProductions[0]?.id ?? ""),
    completion_qty: String(producingProductions[0]?.order_qty ?? ""),
    sample_qty: "3",
    request_note: "生产已完工，随单提交自检记录和批次追溯。",
  });
  const [inspectionForm, setInspectionForm] = useState<Record<string, string>>({
    inspection_id: String(pendingInspections[0]?.id ?? ""),
    result: "qualified",
    actual_qty: "18",
    measurements: "尺寸、外观、批次追溯记录符合标准。",
    inspection_standard: "客户图纸、BOM批次追溯和企业内控检验标准",
    disposition_note: "准予进入仓库入库环节。",
  });
  const [technicalForm, setTechnicalForm] = useState<Record<string, string>>({
    inspection_id: String(failedInspections[0]?.id ?? ""),
    disposition_type: "rework",
    root_cause: "加工基准偏移或过程控制参数异常，需技术部复核确认。",
    corrective_action: "按技术意见返工返修，完成后重新请验。",
    due_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString().slice(0, 10),
    note: "技术部处理意见随请验单归档。",
  });
  const [iqcForm, setIqcForm] = useState<Record<string, string>>({
    iqc_id: String(pendingMaterialIqc[0]?.id ?? ""),
    result: "qualified",
    discount_rate: "0",
    inspected_at: new Date().toISOString().slice(0, 10),
    measurements: "外观、数量、批号、关键指标符合来料检验标准。",
    inspection_standard: "原材料来料检验规范 IQC-2026-01",
    disposition_note: "IQC 放行，允许办理原材料入库。",
  });
  const [inboundForm, setInboundForm] = useState<Record<string, string>>({
    inbound_date: new Date().toISOString().slice(0, 10),
    inbound_note: "仓库已核对请验单、实物数量和批次成本，办理成品入库。",
  });
  const [finishedReceiptPreview, setFinishedReceiptPreview] = useState<FormalPrintDocument | null>(null);
  const [technicalDispositionPreview, setTechnicalDispositionPreview] = useState<FormalPrintDocument | null>(null);
  const selectedProducing =
    producingProductions.find((item) => String(item.id) === requestForm.production_id) ?? producingProductions[0];
  const selectedInspection =
    pendingInspections.find((item) => String(item.id) === inspectionForm.inspection_id) ?? pendingInspections[0];
  const selectedFailedInspection =
    failedInspections.find((item) => String(item.id) === technicalForm.inspection_id) ?? failedInspections[0];
  const selectedIqc = pendingMaterialIqc.find((item) => String(item.id) === iqcForm.iqc_id) ?? pendingMaterialIqc[0];
  const setRequestField = (key: string, value: string) => setRequestForm((current) => ({ ...current, [key]: value }));
  const setInspectionField = (key: string, value: string) =>
    setInspectionForm((current) => ({ ...current, [key]: value }));
  const setTechnicalField = (key: string, value: string) =>
    setTechnicalForm((current) => ({ ...current, [key]: value }));
  const setIqcField = (key: string, value: string) => setIqcForm((current) => ({ ...current, [key]: value }));
  const setInboundField = (key: string, value: string) => setInboundForm((current) => ({ ...current, [key]: value }));
  const submitInspectionRequest = async () => {
    if (!selectedProducing) return;
    await runAction({
      action: "requestInspection",
      entityId: String(selectedProducing.id),
      payload: requestForm,
    });
  };
  const submitInspection = async () => {
    if (!selectedInspection) return;
    await runAction({
      action: "completeInspection",
      entityId: String(selectedInspection.id),
      payload: {
        result: inspectionForm.result,
        actual_qty: inspectionForm.actual_qty,
        measurements: inspectionForm.measurements,
        inspection_standard: inspectionForm.inspection_standard,
        disposition_note: inspectionForm.disposition_note,
      },
    });
  };
  const submitTechnicalDisposition = async () => {
    if (!selectedFailedInspection) return;
    await runAction({
      action: "createTechnicalDisposition",
      entityId: String(selectedFailedInspection.id),
      payload: technicalForm,
    });
  };
  const submitMaterialIqc = async () => {
    if (!selectedIqc) return;
    await runAction({
      action: "completeMaterialIqcInspection",
      entityId: String(selectedIqc.id),
      payload: {
        result: iqcForm.result,
        discount_rate: iqcForm.discount_rate,
        inspected_at: iqcForm.inspected_at,
        measurements: iqcForm.measurements,
        inspection_standard: iqcForm.inspection_standard,
        disposition_note: iqcForm.disposition_note,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MiniMetric label="请验单" value={`${snapshot.board.inspections.length} 张`} />
        <MiniMetric label="原料 IQC" value={`${snapshot.board.materialIqcInspections.length} 张`} />
        <MiniMetric label="成品批次" value={`${snapshot.board.finishedBatches.length} 批`} />
        <MiniMetric label="待技术处置" value={`${failedInspections.length} 单`} />
        <MiniMetric label="复检记录" value={`${reinspectionRows.length} 单`} />
        <MiniMetric label="质量异常关闭率" value={`${Number(qualityTotals.closure_rate ?? 0).toFixed(2)}%`} />
        <MiniMetric label="平均收率" value={`${averageYield(snapshot.board.inspections).toFixed(2)}%`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="原料 IQC 来料检验" icon={FlaskConical} action={canInspect ? "来料判定" : "只读"}>
          {canInspect && selectedIqc ? (
            <div className="grid gap-3">
              <MasterSelect label="IQC 单" value={String(selectedIqc.id)} onChange={(value) => setIqcField("iqc_id", value)}>
                {pendingMaterialIqc.map((iqc) => (
                  <option key={String(iqc.id)} value={String(iqc.id)}>
                    {String(iqc.iqc_no)} / {String(iqc.purchase_no)}
                  </option>
                ))}
              </MasterSelect>
              <div className="grid gap-3 md:grid-cols-2">
                <MasterSelect label="判定结果" value={iqcForm.result} onChange={(value) => setIqcField("result", value)}>
                  <option value="qualified">合格</option>
                  <option value="concession">让步接收</option>
                  <option value="special_accept">特采接收</option>
                  <option value="discount_accept">降价接收</option>
                  <option value="rejected_return">不合格退货</option>
                </MasterSelect>
                <MasterInput
                  label="降价比例"
                  type="number"
                  value={iqcForm.discount_rate}
                  onChange={(value) => setIqcField("discount_rate", value)}
                />
              </div>
              <MasterInput
                label="检验日期"
                type="date"
                value={iqcForm.inspected_at}
                onChange={(value) => setIqcField("inspected_at", value)}
              />
              <MasterTextarea label="实测记录" value={iqcForm.measurements} onChange={(value) => setIqcField("measurements", value)} />
              <MasterTextarea
                label="检验标准"
                value={iqcForm.inspection_standard}
                onChange={(value) => setIqcField("inspection_standard", value)}
              />
              <MasterTextarea
                label="处置意见"
                value={iqcForm.disposition_note}
                onChange={(value) => setIqcField("disposition_note", value)}
              />
              <MasterSubmitButton
                busy={busy === `completeMaterialIqcInspection-${String(selectedIqc.id)}-primary`}
                label="提交 IQC 判定"
                onClick={submitMaterialIqc}
              />
            </div>
          ) : (
            <EmptyText text={pendingMaterialIqc.length === 0 ? "暂无待检原料 IQC 单" : "当前角色只能查看 IQC 数据。"} />
          )}
        </Panel>
        <DataTable
          title="原料 IQC 台账"
          icon={ShieldCheck}
          rows={snapshot.board.materialIqcInspections}
          columns={[
            { key: "iqc_no", label: "IQC单号" },
            { key: "purchase_no", label: "采购单" },
            { key: "supplier_name", label: "供应商" },
            { key: "arrived_at", label: "到货日期", render: shortDate },
            { key: "due_at", label: "期限", render: shortDate },
            { key: "result_label", label: "判定" },
            { key: "accepted_amount", label: "放行金额", render: formatCurrency },
            { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "iqc_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("原料 IQC 详情", String(row.iqc_no), row, [
                        ["采购单", "purchase_no"],
                        ["供应商", "supplier_name"],
                        ["到货通知", "arrival_no"],
                        ["到货日期", "arrived_at", shortDate],
                        ["检验期限", "due_at", shortDate],
                        ["判定结果", "result_label"],
                        ["检验员", "inspected_by_name"],
                        ["实测记录", "measurements"],
                        ["检验标准", "inspection_standard"],
                        ["处置意见", "disposition_note"],
                        ["降价比例", "discount_rate", percentValue],
                        ["放行金额", "accepted_amount", formatCurrency],
                      ]),
                      lines: detailLines(row.lines),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
        />
      </div>
      <Panel title="生产完工请验" icon={ClipboardList} action={canRequestInspection ? "完工请验" : "只读"}>
        {canRequestInspection && selectedProducing ? (
          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr_0.8fr_1.6fr_auto]">
            <MasterSelect
              label="生产单"
              value={String(selectedProducing.id)}
              onChange={(value) => {
                const next = producingProductions.find((item) => String(item.id) === value);
                setRequestField("production_id", value);
                setRequestField("completion_qty", String(next?.order_qty ?? ""));
              }}
            >
              {producingProductions.map((production) => (
                <option key={String(production.id)} value={String(production.id)}>
                  {String(production.prod_no)} / {String(production.order_no)}
                </option>
              ))}
            </MasterSelect>
            <MasterInput
              label="完工数量"
              type="number"
              value={requestForm.completion_qty}
              onChange={(value) => setRequestField("completion_qty", value)}
            />
            <MasterInput
              label="抽样数量"
              type="number"
              value={requestForm.sample_qty}
              onChange={(value) => setRequestField("sample_qty", value)}
            />
            <MasterInput
              label="请验说明"
              value={requestForm.request_note}
              onChange={(value) => setRequestField("request_note", value)}
            />
            <div className="flex items-end">
              <MasterSubmitButton
                busy={busy === `requestInspection-${String(selectedProducing.id)}-primary`}
                label="发起请验"
                onClick={submitInspectionRequest}
              />
            </div>
          </div>
        ) : (
          <EmptyText text={producingProductions.length === 0 ? "暂无生产中可请验的生产单" : "当前角色只能查看请验数据。"} />
        )}
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="检验结果录入" icon={FlaskConical} action={canInspect ? "正式判定" : "只读"}>
          {canInspect && selectedInspection ? (
            <div className="grid gap-3">
              <MasterSelect
                label="请验单"
                value={String(selectedInspection.id)}
                onChange={(value) => setInspectionField("inspection_id", value)}
              >
                {pendingInspections.map((inspection) => (
                  <option key={String(inspection.id)} value={String(inspection.id)}>
                    {String(inspection.inspection_no)} / {String(inspection.prod_no)}
                  </option>
                ))}
              </MasterSelect>
              <div className="grid gap-3 md:grid-cols-2">
                <MasterSelect
                  label="判定结果"
                  value={inspectionForm.result}
                  onChange={(value) => setInspectionField("result", value)}
                >
                  <option value="qualified">合格</option>
                  <option value="concession">让步接收</option>
                  <option value="failed">不合格</option>
                </MasterSelect>
                <MasterInput
                  label="实测入库量"
                  type="number"
                  value={inspectionForm.actual_qty}
                  onChange={(value) => setInspectionField("actual_qty", value)}
                />
              </div>
              <MasterTextarea
                label="检验记录"
                value={inspectionForm.measurements}
                onChange={(value) => setInspectionField("measurements", value)}
              />
              <MasterTextarea
                label="检验标准"
                value={inspectionForm.inspection_standard}
                onChange={(value) => setInspectionField("inspection_standard", value)}
              />
              <MasterTextarea
                label="处置意见"
                value={inspectionForm.disposition_note}
                onChange={(value) => setInspectionField("disposition_note", value)}
              />
              <MasterSubmitButton
                busy={busy === `completeInspection-${String(selectedInspection.id)}-primary`}
                label="提交检验"
                onClick={submitInspection}
              />
            </div>
          ) : (
            <EmptyText text={pendingInspections.length === 0 ? "暂无待检验请验单" : "当前角色只能查看质检数据。"} />
          )}
        </Panel>
        <div className="space-y-3">
          <Panel title="成品入库参数" icon={PackageCheck} action={canInbound ? "正式入库" : "只读"}>
            <div className="grid gap-3 md:grid-cols-[180px_1fr]">
              <MasterInput
                label="入库日期"
                value={inboundForm.inbound_date}
                onChange={(value) => setInboundField("inbound_date", value)}
              />
              <MasterInput
                label="入库说明"
                value={inboundForm.inbound_note}
                onChange={(value) => setInboundField("inbound_note", value)}
              />
            </div>
          </Panel>
          <DataTable
            title="待成品入库"
            icon={PackageCheck}
            rows={inboundableProductions}
            columns={[
              { key: "prod_no", label: "生产单" },
              { key: "order_no", label: "订单号" },
              { key: "product_name", label: "产品" },
              { key: "order_qty", label: "计划数量" },
              { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
              {
                key: "inbound_action",
                label: "操作",
                render: (_value, row) =>
                  canInbound ? (
                    <InlineActionButton
                      label="办理入库"
                      busy={busy === `receiveFinishedGoods-${String(row.id)}-primary`}
                      onClick={() =>
                        void runAction({
                          action: "receiveFinishedGoods",
                          entityId: String(row.id),
                          payload: inboundForm,
                        })
                      }
                    />
                  ) : (
                    <span className="text-xs text-slate-400">-</span>
                  ),
              },
            ]}
          />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="技术部不合格处理意见" icon={ShieldCheck} action={canTechnicalDisposition ? "正式处置" : "只读"}>
          {canTechnicalDisposition && selectedFailedInspection ? (
            <div className="grid gap-3">
              <MasterSelect
                label="不合格请验单"
                value={String(selectedFailedInspection.id)}
                onChange={(value) => setTechnicalField("inspection_id", value)}
              >
                {failedInspections.map((inspection) => (
                  <option key={String(inspection.id)} value={String(inspection.id)}>
                    {String(inspection.inspection_no)} / {String(inspection.prod_no)} / {String(inspection.product_name)}
                  </option>
                ))}
              </MasterSelect>
              <div className="grid gap-3 md:grid-cols-2">
                <MasterSelect
                  label="处理方式"
                  value={technicalForm.disposition_type}
                  onChange={(value) => setTechnicalField("disposition_type", value)}
                >
                  <option value="rework">返工返修</option>
                  <option value="process_adjustment">工艺调整复检</option>
                  <option value="concession_release">技术让步放行</option>
                  <option value="scrap">报废处理</option>
                </MasterSelect>
                <MasterInput
                  label="要求完成日期"
                  type="date"
                  value={technicalForm.due_date}
                  onChange={(value) => setTechnicalField("due_date", value)}
                />
              </div>
              <MasterTextarea
                label="原因分析"
                value={technicalForm.root_cause}
                onChange={(value) => setTechnicalField("root_cause", value)}
              />
              <MasterTextarea
                label="处理意见"
                value={technicalForm.corrective_action}
                onChange={(value) => setTechnicalField("corrective_action", value)}
              />
              <MasterTextarea label="备注" value={technicalForm.note} onChange={(value) => setTechnicalField("note", value)} />
              <MasterSubmitButton
                busy={busy === `createTechnicalDisposition-${String(selectedFailedInspection.id)}-primary`}
                label="下发技术意见"
                onClick={submitTechnicalDisposition}
              />
            </div>
          ) : (
            <EmptyText text={failedInspections.length === 0 ? "暂无待技术部处理的不合格请验单" : "请切换技术部或管理员出具处理意见。"} />
          )}
        </Panel>
        <DataTable
          title="技术处置台账"
          icon={ShieldCheck}
          rows={technicalDispositions}
          columns={[
            { key: "disposition_no", label: "处置单号" },
            { key: "inspection_no", label: "请验单" },
            { key: "prod_no", label: "生产单" },
            { key: "product_name", label: "产品" },
            { key: "disposition_type_label", label: "处理方式", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "due_date", label: "要求完成", render: shortDate },
            { key: "created_by_name", label: "技术人员" },
            { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "technical_print",
              label: "打印",
              render: (_value, row) => (
                <InlineActionButton label="预览" onClick={() => setTechnicalDispositionPreview(buildTechnicalDispositionPrintPreview(row))} />
              ),
            },
            {
              key: "technical_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("技术处置详情", String(row.disposition_no), row, [
                        ["请验单", "inspection_no"],
                        ["生产单", "prod_no"],
                        ["客户订单", "order_no"],
                        ["产品", "product_name"],
                        ["处理方式", "disposition_type_label"],
                        ["原因分析", "root_cause"],
                        ["处理意见", "corrective_action"],
                        ["要求完成日期", "due_date", shortDate],
                        ["备注", "note"],
                        ["技术人员", "created_by_name"],
                        ["状态", "status_label"],
                        ["创建时间", "created_at", shortDate],
                      ]),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
        <DataTable
          title="不合格原因分析"
          icon={ShieldCheck}
          rows={qualityRootCauses}
          columns={[
            { key: "root_cause", label: "不合格原因" },
            { key: "count", label: "发生次数" },
            { key: "closed_count", label: "已关闭" },
            { key: "open_count", label: "未关闭" },
            { key: "closure_rate", label: "关闭率", render: percentValue },
          ]}
        />
        <div className="space-y-5">
          <Panel title="质量异常统计" icon={FileSpreadsheet} action="质量会议口径">
            <div className="grid grid-cols-2 gap-3">
              <MiniMetric label="不合格次数" value={`${Number(qualityTotals.failed_count ?? 0)} 次`} />
              <MiniMetric label="处置单数" value={`${Number(qualityTotals.disposition_count ?? 0)} 张`} />
              <MiniMetric label="复检次数" value={`${Number(qualityTotals.reinspection_count ?? 0)} 次`} />
              <MiniMetric label="未关闭异常" value={`${Number(qualityTotals.open_count ?? 0)} 项`} />
            </div>
          </Panel>
          <DataTable
            title="处置方式分布"
            icon={ClipboardList}
            rows={qualityDispositionTypes}
            columns={[
              { key: "disposition_type_label", label: "处理方式" },
              { key: "count", label: "数量" },
              { key: "closed_count", label: "已关闭" },
              { key: "closure_rate", label: "关闭率", render: percentValue },
            ]}
          />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <DataTable
          title="请验与检验结果"
          icon={FlaskConical}
          rows={snapshot.board.inspections}
          columns={[
            { key: "inspection_no", label: "请验单号" },
            {
              key: "inspection_round",
              label: "轮次",
              render: (value, row) => (Number(row.is_reinspection ?? 0) === 1 ? `复检第 ${String(value ?? 2)} 轮` : "首检"),
            },
            { key: "parent_inspection_no", label: "来源不合格单" },
            { key: "technical_disposition_no", label: "技术处置" },
            { key: "prod_no", label: "生产单" },
            { key: "product_name", label: "产品" },
            {
              key: "result",
              label: "判定",
              render: (value, row) => <StatusBadge value={String(value ?? (row.status === "pending" ? "pending_inspection" : row.status))} />,
            },
            { key: "actual_qty", label: "入库量" },
            { key: "yield_rate", label: "收率", render: (value) => `${Number(value ?? 0).toFixed(2)}%` },
            { key: "completed_at", label: "完成时间", render: shortDate },
            {
              key: "inspection_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("请验单详情", String(row.inspection_no), row, [
                        ["生产单", "prod_no"],
                        ["产品", "product_name"],
                        ["检验轮次", "inspection_round", (value, item) => (Number(item.is_reinspection ?? 0) === 1 ? `复检第 ${Number(value ?? 2)} 轮` : "首检")],
                        ["来源不合格单", "parent_inspection_no"],
                        ["关联技术处置", "technical_disposition_no"],
                        ["复检原因", "reinspection_reason"],
                        ["请验人", "requested_by_name"],
                        ["请验说明", "request_note"],
                        ["完工数量", "completion_qty"],
                        ["抽样数量", "sample_qty"],
                        ["检验判定", "result"],
                        ["实测入库量", "actual_qty"],
                        ["主材领用量", "primary_issued_qty"],
                        ["收率", "yield_rate", (value) => `${Number(value ?? 0).toFixed(2)}%`],
                        ["检验员", "completed_by_name"],
                        ["检验标准", "inspection_standard"],
                        ["处置意见", "disposition_note"],
                        ["状态", "status"],
                        ["创建时间", "created_at", shortDate],
                        ["完成时间", "completed_at", shortDate],
                      ]),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
        />
        <YieldChart snapshot={snapshot} />
      </div>
      <DataTable
        title="成品入库单"
        icon={FileCheck2}
        rows={snapshot.board.finishedReceipts}
        columns={[
          { key: "receipt_no", label: "入库单号" },
          { key: "prod_no", label: "生产单" },
          { key: "inspection_no", label: "请验单" },
          { key: "product_name", label: "产品" },
          { key: "finished_qty", label: "成品数量", render: (value, row) => formatQty(value, row.unit) },
          { key: "transition_qty", label: "过渡料", render: (value, row) => formatQty(value, row.unit) },
          { key: "unit_cost", label: "单位成本", render: formatCurrency },
          { key: "yield_rate", label: "收率", render: (value) => `${Number(value ?? 0).toFixed(2)}%` },
          { key: "received_by_name", label: "入库人" },
          {
            key: "receipt_print",
            label: "打印",
            render: (_value, row) => (
              <InlineActionButton
                label="预览"
                onClick={() => setFinishedReceiptPreview(formalPrintFromDocument(buildFinishedGoodsReceiptPreview(row)))}
              />
            ),
          },
          { key: "received_at", label: "入库时间", render: shortDate },
        ]}
      />
      <DataTable
        title="成品/过渡料入库批次"
        icon={PackageCheck}
        rows={snapshot.board.finishedBatches}
        columns={[
          { key: "batch_no", label: "批次号" },
          { key: "product_name", label: "产品" },
          { key: "kind", label: "类型", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "qty", label: "数量", render: (value, row) => formatQty(value, row.unit) },
          { key: "unit_cost", label: "单位成本", render: formatCurrency },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "received_at", label: "入库时间", render: shortDate },
        ]}
      />
      <BatchPanel finishedBatches={snapshot.board.finishedBatches} inspections={snapshot.board.inspections} />
      <FormalPrintPreviewModal preview={finishedReceiptPreview} onClose={() => setFinishedReceiptPreview(null)} />
      <FormalPrintPreviewModal preview={technicalDispositionPreview} onClose={() => setTechnicalDispositionPreview(null)} />
    </div>
  );
}

function FinanceModule({
  snapshot,
  actorId,
  busy,
  runAction,
  openDetail,
}: {
  snapshot: Snapshot;
  actorId: string;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
  openDetail: (detail: DetailState) => void;
}) {
  const canSettle = ["finance", "purchasing", "admin"].includes(snapshot.currentUser.role);
  const canReceive = ["finance", "assistant", "admin"].includes(snapshot.currentUser.role);
  const canRefund = ["finance", "admin"].includes(snapshot.currentUser.role);
  const [financePrintPreview, setFinancePrintPreview] = useState<FormalPrintDocument | null>(null);
  const openReceivables = snapshot.board.receivables.filter((item) => item.status !== "paid");
  const refundableReturns = snapshot.board.salesReturns.filter((item) =>
    ["pending_refund", "partial_refunded"].includes(String(item.refund_status)),
  );
  const [receiptForm, setReceiptForm] = useState<Record<string, string>>({
    receivable_id: String(openReceivables[0]?.id ?? ""),
    amount: String(openReceivables[0]?.balance_amount ?? ""),
    method: "银行转账",
    received_at: new Date().toISOString().slice(0, 10),
    note: "客户回款登记",
  });
  const [refundForm, setRefundForm] = useState<Record<string, string>>({
    sales_return_id: String(refundableReturns[0]?.id ?? ""),
    amount: String(
      refundableReturns[0]
        ? Math.max(Number(refundableReturns[0].refund_due_amount ?? 0) - Number(refundableReturns[0].refunded_amount ?? 0), 0)
        : "",
    ),
    method: "银行转账",
    refunded_at: new Date().toISOString().slice(0, 10),
    note: "客户退货退款登记",
  });
  const selectedReceivable =
    openReceivables.find((item) => String(item.id) === receiptForm.receivable_id) ?? openReceivables[0];
  const selectedRefundReturn =
    refundableReturns.find((item) => String(item.id) === refundForm.sales_return_id) ?? refundableReturns[0];
  const setReceiptField = (key: string, value: string) => setReceiptForm((current) => ({ ...current, [key]: value }));
  const setRefundField = (key: string, value: string) => setRefundForm((current) => ({ ...current, [key]: value }));
  const submitReceipt = async () => {
    if (!selectedReceivable) return;
    await runAction({
      action: "recordReceivableReceipt",
      entityId: String(selectedReceivable.id),
      payload: receiptForm,
    });
  };
  const submitRefund = async () => {
    if (!selectedRefundReturn) return;
    await runAction({
      action: "recordCustomerRefund",
      entityId: String(selectedRefundReturn.id),
      payload: refundForm,
    });
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MiniMetric label="应收余额" value={formatCurrency(snapshot.summary.receivableBalance)} />
        <MiniMetric label="应付余额" value={formatCurrency(snapshot.summary.payableBalance)} />
        <MiniMetric label="已回款" value={formatCurrency(snapshot.summary.receivedAmount)} />
        <MiniMetric label="导出记录" value={`${snapshot.board.documentExports.length} 条`} />
      </div>
      <Panel title="正式回款登记" icon={Download} action={canReceive ? "金额可拆分" : "只读"}>
        {canReceive && selectedReceivable ? (
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
            <MasterSelect
              label="应收单"
              value={String(selectedReceivable.id)}
              onChange={(value) => {
                const next = openReceivables.find((item) => String(item.id) === value);
                setReceiptForm((current) => ({
                  ...current,
                  receivable_id: value,
                  amount: String(next?.balance_amount ?? current.amount),
                }));
              }}
            >
              {openReceivables.map((receivable) => (
                <option key={String(receivable.id)} value={String(receivable.id)}>
                  {String(receivable.receivable_no)} / {String(receivable.customer_name)} / 余额 {formatCurrency(receivable.balance_amount)}
                </option>
              ))}
            </MasterSelect>
            <MasterInput label="回款金额" type="number" value={receiptForm.amount} onChange={(value) => setReceiptField("amount", value)} />
            <MasterInput label="回款日期" type="date" value={receiptForm.received_at} onChange={(value) => setReceiptField("received_at", value)} />
            <MasterInput label="回款方式" value={receiptForm.method} onChange={(value) => setReceiptField("method", value)} />
            <MasterInput label="备注" value={receiptForm.note} onChange={(value) => setReceiptField("note", value)} />
            <MasterSubmitButton
              busy={busy === `recordReceivableReceipt-${String(selectedReceivable.id)}-primary`}
              label="登记回款"
              onClick={submitReceipt}
            />
          </div>
        ) : (
          <EmptyText text={openReceivables.length === 0 ? "暂无未结清应收账款" : "请切换财务、商务内勤或管理员登记回款。"} />
        )}
      </Panel>
      <Panel title="客户退款登记" icon={RotateCcw} action={canRefund ? "退货退款 / 财务留痕" : "只读"}>
        {canRefund && selectedRefundReturn ? (
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
            <MasterSelect
              label="退货单"
              value={String(selectedRefundReturn.id)}
              onChange={(value) => {
                const next = refundableReturns.find((item) => String(item.id) === value);
                setRefundForm((current) => ({
                  ...current,
                  sales_return_id: value,
                  amount: String(next ? Math.max(Number(next.refund_due_amount ?? 0) - Number(next.refunded_amount ?? 0), 0) : current.amount),
                }));
              }}
            >
              {refundableReturns.map((item) => (
                <option key={String(item.id)} value={String(item.id)}>
                  {String(item.return_no)} / {String(item.customer_name)} / 待退 {formatCurrency(Math.max(Number(item.refund_due_amount ?? 0) - Number(item.refunded_amount ?? 0), 0))}
                </option>
              ))}
            </MasterSelect>
            <MasterInput label="退款金额" type="number" value={refundForm.amount} onChange={(value) => setRefundField("amount", value)} />
            <MasterInput label="退款日期" type="date" value={refundForm.refunded_at} onChange={(value) => setRefundField("refunded_at", value)} />
            <MasterInput label="退款方式" value={refundForm.method} onChange={(value) => setRefundField("method", value)} />
            <MasterInput label="备注" value={refundForm.note} onChange={(value) => setRefundField("note", value)} />
            <MasterSubmitButton
              busy={busy === `recordCustomerRefund-${String(selectedRefundReturn.id)}-primary`}
              label="登记退款"
              onClick={submitRefund}
            />
          </div>
        ) : (
          <EmptyText text={refundableReturns.length === 0 ? "暂无待退款退货单。" : "请切换财务或管理员登记退款。"} />
        )}
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="应收账款"
          icon={Download}
          rows={snapshot.board.receivables}
          columns={[
            { key: "receivable_no", label: "应收单号" },
            { key: "customer_name", label: "客户" },
            { key: "order_no", label: "订单" },
            { key: "total_amount", label: "金额", render: formatCurrency },
            { key: "adjusted_amount", label: "退货调整", render: formatCurrency },
            { key: "received_amount", label: "已收", render: formatCurrency },
            { key: "refund_due_amount", label: "待退款", render: formatCurrency },
            { key: "balance_amount", label: "余额", render: formatCurrency },
            { key: "age_days", label: "账龄" },
            { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "id",
              label: "操作",
              render: (value, row) =>
                canReceive && row.status !== "paid" ? (
                  <InlineActionButton
                    label="收全款"
                    busy={busy === `recordReceivableReceipt-${String(value)}-primary`}
                    onClick={() =>
                      void runAction({
                        action: "recordReceivableReceipt",
                        entityId: String(value),
                        payload: {
                          amount: String(row.balance_amount ?? ""),
                          method: "银行转账",
                          received_at: new Date().toISOString().slice(0, 10),
                          note: "快速收全款",
                        },
                      })
                    }
                  />
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                ),
            },
            {
              key: "receivable_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("应收账款详情", String(row.receivable_no), row, [
                        ["客户", "customer_name"],
                        ["订单号", "order_no"],
                        ["应收金额", "total_amount", formatCurrency],
                        ["已收金额", "received_amount", formatCurrency],
                        ["未收余额", "balance_amount", formatCurrency],
                        ["账龄", "age_days", dayValue],
                        ["到期日", "due_date", shortDate],
                        ["状态", "status"],
                      ]),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
          action={{ label: "应收应付台账", onClick: () => downloadExport(actorId, "ledger") }}
        />
        <DataTable
          title="应付账款"
          icon={ClipboardList}
          rows={snapshot.board.payables}
          columns={[
            { key: "payable_no", label: "应付单号" },
            { key: "supplier_name", label: "供应商" },
            { key: "total_amount", label: "金额", render: formatCurrency },
            { key: "paid_amount", label: "已付", render: formatCurrency },
            { key: "balance_amount", label: "余额", render: formatCurrency },
            { key: "age_days", label: "账龄" },
            { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            {
              key: "id",
              label: "操作",
              render: (value, row) =>
                canSettle && row.status !== "paid" ? (
                  <InlineActionButton
                    label="登记付款"
                    busy={busy === `recordPayablePayment-${String(value)}-primary`}
                    onClick={() => void runAction({ action: "recordPayablePayment", entityId: String(value) })}
                  />
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                ),
            },
            {
              key: "finance_payable_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail({
                      ...makeDetail("应付账款详情", String(row.payable_no), row, [
                        ["供应商", "supplier_name"],
                        ["应付金额", "total_amount", formatCurrency],
                        ["已付金额", "paid_amount", formatCurrency],
                        ["未付余额", "balance_amount", formatCurrency],
                        ["账龄", "age_days", dayValue],
                        ["到期日", "due_date", shortDate],
                        ["状态", "status"],
                      ]),
                      audits: auditRows(snapshot, row.id),
                    })
                  }
                />
              ),
            },
          ]}
          action={{ label: "财务数据", onClick: () => downloadExport(actorId, "finance") }}
        />
      </div>
      <DataTable
        title="客户退款记录"
        icon={RotateCcw}
        rows={snapshot.board.customerRefunds}
        columns={[
          { key: "refund_no", label: "退款单号" },
          { key: "return_no", label: "退货单" },
          { key: "receivable_no", label: "应收单" },
          { key: "customer_name", label: "客户" },
          { key: "amount", label: "退款金额", render: formatCurrency },
          { key: "method", label: "方式" },
          { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "refunded_by_name", label: "经办人" },
          {
            key: "refund_print",
            label: "打印",
            render: (_value, row) => (
              <div className="flex gap-2">
                <InlineActionButton label="预览" onClick={() => setFinancePrintPreview(buildCustomerRefundPrintPreview(row))} />
                <InlineActionButton label="导出" onClick={() => downloadExport(actorId, "customer-refund", row.id)} />
              </div>
            ),
          },
          { key: "refunded_at", label: "退款日期", render: shortDate },
        ]}
        action={{ label: "退款单导出", onClick: () => downloadExport(actorId, "customer-refund") }}
      />
      <CashChart snapshot={snapshot} />
      <ActivityPanel title="财务导出记录" icon={Download} rows={snapshot.board.documentExports} mode="document" />
      <FormalPrintPreviewModal preview={financePrintPreview} onClose={() => setFinancePrintPreview(null)} />
    </div>
  );
}

const reportCards = [
  {
    title: "经营日报",
    type: "business-daily",
    cadence: "每日",
    detail: "订单额、采购额、库存价值、应收应付、回款与平均收率。",
  },
  {
    title: "经营周报",
    type: "business-weekly",
    cadence: "每周",
    detail: "面向周会的交付进度、现金流、库存积压与质量指标汇总。",
  },
  {
    title: "经营月报",
    type: "business-monthly",
    cadence: "每月",
    detail: "面向老板和管理层的月度经营、财务、库存、生产综合报表。",
  },
  {
    title: "库存积压报表",
    type: "inventory-overstock",
    cadence: "实时",
    detail: "3 个月未动预警，6 个月未动纳入积压报表并计算库存价值。",
  },
  {
    title: "销售对账单",
    type: "sales-statement",
    cadence: "按客户",
    detail: "按发货单与应收账款生成客户对账明细，支持签字确认。",
  },
  {
    title: "采购对账单",
    type: "purchase-statement",
    cadence: "按供应商",
    detail: "按采购入库与应付账款生成供应商对账明细，支持付款核对。",
  },
  {
    title: "供应商差异统计报表",
    type: "supplier-discrepancy",
    cadence: "实时",
    detail: "按到货差异单统计供应商差异次数、处理完成率、数量差异、价格差异与影响金额。",
  },
  {
    title: "供应商绩效评分报表",
    type: "supplier-performance",
    cadence: "实时",
    detail: "按到货准时、IQC合格、到货差异、应付逾期和差异金额综合评分。",
  },
  {
    title: "质量异常分析报表",
    type: "quality-exception",
    cadence: "实时",
    detail: "按不合格请验、技术处置和复检关闭状态分析原因分布、处置方式与关闭率。",
  },
] satisfies Array<{ title: string; type: ReportPreviewType; cadence: string; detail: string }>;

function ReportsModule({
  snapshot,
  actorId,
  openDetail,
}: {
  snapshot: Snapshot;
  actorId: string;
  openDetail: (detail: DetailState) => void;
}) {
  const reportExports = snapshot.board.documentExports.filter((row) => String(row.entity_type) === "report");
  const latestSnapshot = snapshot.board.reportSnapshots[0];
  const emptyFilters: ReportFilterState = {
    dateFrom: "",
    dateTo: "",
    customerId: "",
    supplierId: "",
    materialId: "",
    orderId: "",
    purchaseOrderId: "",
  };
  const [filters, setFilters] = useState<ReportFilterState>(emptyFilters);
  const [reportPreview, setReportPreview] = useState<ReportPreview | null>(null);
  const setFilter = (key: keyof ReportFilterState, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const downloadReport = (type: string) => downloadExport(actorId, type, undefined, "xlsx", filters);
  const previewReport = (type: ReportPreviewType) => {
    setReportPreview(
      buildReportPreview({
        type,
        generatedBy: snapshot.currentUser.name,
        filters: reportPreviewFilters(snapshot, filters),
        summary: reportPreviewSummary(snapshot, filters),
        rows: reportPreviewRows(snapshot, filters),
      }),
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniMetric label="正式报表" value={`${reportCards.length} 类`} />
        <MiniMetric label="报表快照" value={`${snapshot.board.reportSnapshots.length} 次`} />
        <MiniMetric label="导出文件" value={`${reportExports.length} 个`} />
        <MiniMetric label="应收余额" value={formatCurrency(snapshot.summary.receivableBalance)} />
        <MiniMetric label="应付余额" value={formatCurrency(snapshot.summary.payableBalance)} />
        <MiniMetric label="积压库存" value={formatCurrency(snapshot.summary.overstockValue)} />
      </div>

      <Panel title="报表查询条件" icon={Search} action="正式筛选">
        <div className="grid gap-3 lg:grid-cols-4 2xl:grid-cols-7">
          <MasterInput label="开始日期" type="date" value={filters.dateFrom} onChange={(value) => setFilter("dateFrom", value)} />
          <MasterInput label="结束日期" type="date" value={filters.dateTo} onChange={(value) => setFilter("dateTo", value)} />
          <MasterSelect label="客户" value={filters.customerId} onChange={(value) => setFilter("customerId", value)}>
            <option value="">全部客户</option>
            {snapshot.board.customers.map((customer) => (
              <option key={String(customer.id)} value={String(customer.id)}>
                {String(customer.customer_code ?? customer.id)} / {String(customer.name)}
              </option>
            ))}
          </MasterSelect>
          <MasterSelect label="供应商" value={filters.supplierId} onChange={(value) => setFilter("supplierId", value)}>
            <option value="">全部供应商</option>
            {snapshot.board.suppliers.map((supplier) => (
              <option key={String(supplier.id)} value={String(supplier.id)}>
                {String(supplier.supplier_code ?? supplier.id)} / {String(supplier.name)}
              </option>
            ))}
          </MasterSelect>
          <MasterSelect label="物料" value={filters.materialId} onChange={(value) => setFilter("materialId", value)}>
            <option value="">全部物料</option>
            {snapshot.board.materials.map((material) => (
              <option key={String(material.id)} value={String(material.id)}>
                {String(material.material_code ?? material.id)} / {String(material.name)}
              </option>
            ))}
          </MasterSelect>
          <MasterSelect label="销售订单" value={filters.orderId} onChange={(value) => setFilter("orderId", value)}>
            <option value="">全部销售订单</option>
            {snapshot.board.orders.map((order) => (
              <option key={String(order.id)} value={String(order.id)}>
                {String(order.order_no)} / {String(order.customer_name)}
              </option>
            ))}
          </MasterSelect>
          <MasterSelect
            label="采购单"
            value={filters.purchaseOrderId}
            onChange={(value) => setFilter("purchaseOrderId", value)}
          >
            <option value="">全部采购单</option>
            {snapshot.board.purchaseOrders.map((order) => (
              <option key={String(order.id)} value={String(order.id)}>
                {String(order.purchase_no)} / {String(order.supplier_name)}
              </option>
            ))}
          </MasterSelect>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs leading-5 text-slate-500">
            筛选条件会写入正式报表封面和报表快照，并参与销售对账、采购对账、库存积压、经营日报/周报/月报的统计口径。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFilters(emptyFilters)}
              className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
            >
              清空条件
            </button>
            <button
              type="button"
              onClick={() => downloadReport("business-daily")}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Download className="h-4 w-4" />
              按条件生成日报
            </button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        {reportCards.map((card) => (
          <Panel
            key={card.type}
            title={card.title}
            icon={FileSpreadsheet}
            actionButton={{ label: "下载 XLSX", onClick: () => downloadReport(card.type) }}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <StatusBadge value="正式模板" tone="success" />
                <span className="text-xs font-semibold text-slate-500">{card.cadence}</span>
              </div>
              <p className="min-h-12 text-sm leading-6 text-slate-600">{card.detail}</p>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                导出时自动生成封面、统计周期、生成账号、关键指标，并写入报表快照和导出审计。
              </div>
              <button
                type="button"
                onClick={() => previewReport(card.type)}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
              >
                <Printer className="h-4 w-4" />
                打印预览
              </button>
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <DataTable
          title="报表快照台账"
          icon={FileSpreadsheet}
          rows={snapshot.board.reportSnapshots}
          columns={[
            { key: "report_no", label: "快照编号" },
            { key: "report_title", label: "报表名称" },
            { key: "type", label: "类型", render: (value) => reportTypeLabel(String(value)) },
            { key: "period_start", label: "开始日期", render: shortDate },
            { key: "period_end", label: "结束日期", render: shortDate },
            { key: "generated_by_name", label: "生成人" },
            { key: "order_amount", label: "订单额", render: formatCurrency },
            { key: "overstock_value", label: "积压金额", render: formatCurrency },
            { key: "created_at", label: "生成时间", render: shortDate },
            {
              key: "snapshot_detail",
              label: "详情",
              render: (_value, row) => (
                <DetailButton
                  onClick={() =>
                    openDetail(
                      makeDetail("报表快照详情", String(row.report_no), row, [
                        ["报表名称", "report_title"],
                        ["报表类型", "type", (value) => reportTypeLabel(String(value))],
                        ["统计开始", "period_start", shortDate],
                        ["统计结束", "period_end", shortDate],
                        ["生成人", "generated_by_name"],
                        ["订单额", "order_amount", formatCurrency],
                        ["采购额", "purchase_amount", formatCurrency],
                        ["应收余额", "receivable_balance", formatCurrency],
                        ["应付余额", "payable_balance", formatCurrency],
                        ["库存积压金额", "overstock_value", formatCurrency],
                        ["生成时间", "created_at", shortDate],
                      ]),
                    )
                  }
                />
              ),
            },
          ]}
        />

        <Panel title="最新报表摘要" icon={ReceiptText} action={latestSnapshot ? String(latestSnapshot.report_no) : "暂无"}>
          {latestSnapshot ? (
            <div className="space-y-3 text-sm text-slate-600">
              <KeyValue label="报表名称" value={String(latestSnapshot.report_title ?? "-")} />
              <KeyValue label="生成人" value={String(latestSnapshot.generated_by_name ?? "-")} />
              <KeyValue label="周期" value={`${shortDate(latestSnapshot.period_start)} 至 ${shortDate(latestSnapshot.period_end)}`} />
              <KeyValue label="订单额" value={formatCurrency(latestSnapshot.order_amount)} />
              <KeyValue label="应收余额" value={formatCurrency(latestSnapshot.receivable_balance)} />
              <KeyValue label="积压金额" value={formatCurrency(latestSnapshot.overstock_value)} />
              <button
                type="button"
                onClick={() => downloadReport("business-daily")}
                className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Download className="h-4 w-4" />
                生成今日经营日报
              </button>
            </div>
          ) : (
            <EmptyText text="暂无报表快照，点击上方任一报表下载后会自动生成。" />
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="报表导出记录"
          icon={Download}
          rows={reportExports}
          columns={[
            { key: "document_no", label: "导出编号" },
            { key: "type", label: "报表类型", render: (value) => reportExportLabel(String(value)) },
            { key: "file_name", label: "文件名" },
            { key: "actor_name", label: "操作人" },
            { key: "created_at", label: "导出时间", render: shortDate },
          ]}
        />
        <DataTable
          title="库存积压明细"
          icon={Warehouse}
          rows={snapshot.board.inventoryAging}
          columns={[
            { key: "name", label: "物料" },
            { key: "stock_qty", label: "库存", render: (value, row) => formatQty(value, row.unit) },
            { key: "stock_value", label: "库存价值", render: formatCurrency },
            { key: "inactive_days", label: "未动天数", render: dayValue },
            { key: "aging_status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "last_movement_at", label: "最近变动", render: shortDate },
          ]}
          action={{ label: "积压报表", onClick: () => downloadReport("inventory-overstock") }}
        />
      </div>
      <ReportPreviewModal preview={reportPreview} onClose={() => setReportPreview(null)} />
    </div>
  );
}

function reportPreviewFilters(snapshot: Snapshot, filters: ReportFilterState) {
  return {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    customerName: String(snapshot.board.customers.find((item) => String(item.id) === filters.customerId)?.name ?? ""),
    supplierName: String(snapshot.board.suppliers.find((item) => String(item.id) === filters.supplierId)?.name ?? ""),
    materialName: String(snapshot.board.materials.find((item) => String(item.id) === filters.materialId)?.name ?? ""),
    orderNo: String(snapshot.board.orders.find((item) => String(item.id) === filters.orderId)?.order_no ?? ""),
    purchaseNo: String(snapshot.board.purchaseOrders.find((item) => String(item.id) === filters.purchaseOrderId)?.purchase_no ?? ""),
  };
}

function reportPreviewRows(snapshot: Snapshot, filters: ReportFilterState) {
  const receivables = snapshot.board.receivables.filter((row) => {
    if (filters.customerId && String(row.customer_id) !== filters.customerId) return false;
    if (filters.orderId && String(row.order_id) !== filters.orderId) return false;
    return dateInRange(row.created_at, filters);
  });
  const payables = snapshot.board.payables.filter((row) => {
    if (filters.supplierId && String(row.supplier_id) !== filters.supplierId) return false;
    if (filters.purchaseOrderId && String(row.purchase_order_id) !== filters.purchaseOrderId) return false;
    return dateInRange(row.created_at, filters);
  });
  const inventoryAging = snapshot.board.inventoryAging.filter((row) => {
    if (filters.materialId && String(row.id ?? row.material_id) !== filters.materialId) return false;
    return dateInRange(row.last_movement_at, filters);
  });
  const qualityExceptions = snapshot.board.technicalDispositions.filter((row) => {
    if (filters.customerId && String(row.customer_id) !== filters.customerId) return false;
    if (filters.orderId && String(row.order_id) !== filters.orderId) return false;
    return dateInRange(row.created_at, filters);
  });
  const qualityRootCauses = groupQualityExceptions(qualityExceptions, "root_cause", "root_cause");
  const qualityDispositionTypes = groupQualityExceptions(
    qualityExceptions,
    "disposition_type_label",
    "disposition_type_label",
  );
  const supplierDiscrepancyDetails = snapshot.board.purchaseArrivalDiscrepancies.filter((row) => {
    if (filters.supplierId && String(row.supplier_id) !== filters.supplierId) return false;
    if (filters.purchaseOrderId && String(row.purchase_order_id) !== filters.purchaseOrderId) return false;
    if (filters.materialId) {
      const hasMaterial = detailLines(row.lines).some((line) => String(line.materialId ?? line.material_id) === filters.materialId);
      if (!hasMaterial) return false;
    }
    return dateInRange(row.created_at, filters);
  });
  const supplierDiscrepancies = groupSupplierDiscrepancies(supplierDiscrepancyDetails);
  const supplierPerformance = snapshot.board.supplierPerformance.filter((row) => {
    if (filters.supplierId && String(row.supplier_id) !== filters.supplierId) return false;
    return true;
  });
  return {
    receivables,
    payables,
    inventoryAging,
    qualityExceptions,
    qualityRootCauses,
    qualityDispositionTypes,
    supplierDiscrepancies,
    supplierDiscrepancyDetails,
    supplierPerformance,
  };
}

function reportPreviewSummary(snapshot: Snapshot, filters: ReportFilterState) {
  const rows = reportPreviewRows(snapshot, filters);
  const orders = snapshot.board.orders.filter((row) => {
    if (filters.customerId && String(row.customer_id) !== filters.customerId) return false;
    if (filters.orderId && String(row.id) !== filters.orderId) return false;
    return dateInRange(row.created_at, filters);
  });
  const purchaseOrders = snapshot.board.purchaseOrders.filter((row) => {
    if (filters.supplierId && String(row.supplier_id) !== filters.supplierId) return false;
    if (filters.purchaseOrderId && String(row.id) !== filters.purchaseOrderId) return false;
    return dateInRange(row.created_at, filters);
  });
  const yieldValues = snapshot.board.inspections
    .map((row) => Number(row.yield_rate ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const filteredInspections = snapshot.board.inspections.filter((row) => {
    if (filters.customerId && String(row.customer_id) !== filters.customerId) return false;
    if (filters.orderId && String(row.order_id) !== filters.orderId) return false;
    return dateInRange(row.created_at, filters);
  });
  const qualityClosedCount = rows.qualityExceptions.filter(
    (row) => String(row.status) === "closed" || String(row.status_label) === "已关闭",
  ).length;
  const supplierDiscrepancyResolvedCount = rows.supplierDiscrepancyDetails.filter((row) => String(row.status) === "resolved").length;
  const supplierRiskCount = rows.supplierPerformance.filter((row) => String(row.risk_level) === "high").length;
  return {
    orderAmount: sumRows(orders, "total_amount"),
    purchaseAmount: sumRows(purchaseOrders, "total_amount"),
    inventoryValue: sumRows(snapshot.board.materials, "stock_value"),
    receivableBalance: sumRows(rows.receivables, "balance_amount"),
    payableBalance: sumRows(rows.payables, "balance_amount"),
    receivedAmount: sumRows(rows.receivables, "received_amount"),
    overstockValue: sumRows(rows.inventoryAging.filter((row) => row.aging_status === "overstock"), "stock_value"),
    averageYield: yieldValues.length ? yieldValues.reduce((sum, value) => sum + value, 0) / yieldValues.length : 0,
    qualityInspectionCount: filteredInspections.length,
    qualityFailedCount: rows.qualityExceptions.length,
    qualityReinspectionCount: filteredInspections.filter((row) => Number(row.is_reinspection ?? 0) === 1).length,
    qualityClosedCount,
    qualityClosureRate: rows.qualityExceptions.length ? Number(((qualityClosedCount / rows.qualityExceptions.length) * 100).toFixed(2)) : 0,
    supplierDiscrepancyCount: rows.supplierDiscrepancyDetails.length,
    supplierDiscrepancyResolvedCount,
    supplierDiscrepancyPendingCount: rows.supplierDiscrepancyDetails.length - supplierDiscrepancyResolvedCount,
    supplierDiscrepancyAdjustmentAmount: sumRows(rows.supplierDiscrepancyDetails, "total_adjustment_amount"),
    supplierDiscrepancyResolutionRate: rows.supplierDiscrepancyDetails.length
      ? Number(((supplierDiscrepancyResolvedCount / rows.supplierDiscrepancyDetails.length) * 100).toFixed(2))
      : 0,
    supplierAverageScore: rows.supplierPerformance.length
      ? Number((sumRows(rows.supplierPerformance, "performance_score") / rows.supplierPerformance.length).toFixed(2))
      : 0,
    supplierRiskCount,
  };
}

function dateInRange(value: unknown, filters: Pick<ReportFilterState, "dateFrom" | "dateTo">) {
  const date = String(value ?? "").slice(0, 10);
  if (!date) return true;
  if (filters.dateFrom && date < filters.dateFrom) return false;
  if (filters.dateTo && date > filters.dateTo) return false;
  return true;
}

function sumRows(rows: Row[], key: string) {
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
}

function groupQualityExceptions(rows: Row[], sourceKey: string, outputKey: string) {
  const grouped = new Map<string, Row>();
  rows.forEach((row) => {
    const label = String(row[sourceKey] ?? "").trim() || "未填写";
    const current =
      grouped.get(label) ??
      ({
        [outputKey]: label,
        count: 0,
        closed_count: 0,
        open_count: 0,
        closure_rate: 0,
      } satisfies Row);
    current.count = Number(current.count ?? 0) + 1;
    if (String(row.status) === "closed" || String(row.status_label) === "已关闭") {
      current.closed_count = Number(current.closed_count ?? 0) + 1;
    } else {
      current.open_count = Number(current.open_count ?? 0) + 1;
    }
    current.closure_rate = Number(current.count ?? 0)
      ? Number(((Number(current.closed_count ?? 0) / Number(current.count ?? 1)) * 100).toFixed(2))
      : 0;
    grouped.set(label, current);
  });
  return Array.from(grouped.values()).sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
}

function groupSupplierDiscrepancies(rows: Row[]) {
  const grouped = new Map<string, Row>();
  rows.forEach((row) => {
    const supplierId = String(row.supplier_id ?? row.supplier_name ?? "unknown");
    const current =
      grouped.get(supplierId) ??
      ({
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        discrepancy_count: 0,
        resolved_count: 0,
        pending_count: 0,
        quantity_variance_qty: 0,
        price_variance_amount: 0,
        total_adjustment_amount: 0,
        resolution_rate: 0,
      } satisfies Row);
    current.discrepancy_count = Number(current.discrepancy_count ?? 0) + 1;
    if (String(row.status) === "resolved") {
      current.resolved_count = Number(current.resolved_count ?? 0) + 1;
    } else {
      current.pending_count = Number(current.pending_count ?? 0) + 1;
    }
    current.quantity_variance_qty = Number(current.quantity_variance_qty ?? 0) + Number(row.quantity_variance_qty ?? 0);
    current.price_variance_amount = Number(current.price_variance_amount ?? 0) + Number(row.price_variance_amount ?? 0);
    current.total_adjustment_amount = Number(current.total_adjustment_amount ?? 0) + Number(row.total_adjustment_amount ?? 0);
    current.resolution_rate = Number(current.discrepancy_count ?? 0)
      ? Number(((Number(current.resolved_count ?? 0) / Number(current.discrepancy_count ?? 1)) * 100).toFixed(2))
      : 0;
    grouped.set(supplierId, current);
  });
  return Array.from(grouped.values()).sort((a, b) => Number(b.discrepancy_count ?? 0) - Number(a.discrepancy_count ?? 0));
}

function ReportPreviewModal({ preview, onClose }: { preview: ReportPreview | null; onClose: () => void }) {
  if (!preview) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-6">
      <div className="w-full max-w-[calc(210mm+48px)]">
        <div className="no-print mb-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xl">
          <div>
            <p className="text-sm font-semibold text-slate-950">{preview.header.title}打印预览</p>
            <p className="mt-1 text-xs text-slate-500">{preview.header.documentNo} / A4 正式版式</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Printer className="h-4 w-4" />
              打印
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-700"
              aria-label="关闭报表预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <section className="delivery-note-print-surface mx-auto min-h-[297mm] w-[210mm] max-w-full bg-white px-[14mm] py-[12mm] text-slate-950 shadow-2xl">
          <header className="border-b-2 border-slate-950 pb-5">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[13px] font-semibold tracking-[0.18em] text-blue-700">LOCAL ERP MANAGEMENT REPORT</p>
                <h1 className="mt-2 text-[24px] font-bold tracking-normal">{preview.header.companyName}</h1>
                <p className="mt-2 text-[12px] text-slate-500">系统生成报表，适用于经营会议、对账确认、纸质签批和归档留存</p>
              </div>
              <div className="shrink-0 rounded-sm border-2 border-blue-700 px-5 py-2 text-center text-blue-700">
                <p className="text-[12px] font-semibold">{preview.header.statusText}</p>
                <p className="mt-1 text-[20px] font-bold">{preview.header.title}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-[12px]">
              <PrintField label="报表编号" value={preview.header.documentNo} strong />
              <PrintField label="报表日期" value={preview.header.documentDate} strong />
              <PrintField label="编制人" value={preview.header.generatedBy} />
              <PrintField label="统计周期" value={preview.header.periodText} strong />
              <div className="col-span-2">
                <PrintField label="筛选条件" value={preview.header.filterSummary} />
              </div>
            </div>
          </header>

          <section className="mt-5">
            <PrintSectionTitle title="核心指标" />
            <div className="grid grid-cols-4 gap-px bg-slate-200 text-[12px]">
              {preview.kpis.map((kpi) => (
                <PrintGridCell key={kpi.label} label={kpi.label} value={kpi.value} />
              ))}
            </div>
          </section>

          {preview.sections.map((section) => (
            <ReportPrintTable key={section.title} section={section} />
          ))}

          <section className="mt-5 rounded-sm border border-slate-300 bg-slate-50 px-3 py-3 text-[12px] leading-6 text-slate-700">
            <p className="font-semibold text-slate-950">报表说明</p>
            {preview.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </section>

          <section className="mt-8 grid grid-cols-4 gap-4 text-[12px]">
            {preview.signatures.map((signature) => (
              <div key={signature.label}>
                <div className="h-14 border-b border-slate-400" />
                <p className="mt-2 font-semibold">{signature.label}</p>
                <p className="mt-1 text-slate-500">{signature.hint}</p>
              </div>
            ))}
          </section>

          <footer className="mt-8 flex items-center justify-between border-t border-slate-300 pt-3 text-[11px] text-slate-500">
            <span>系统打印件与电子报表快照口径一致</span>
            <span>留痕编号：{preview.header.documentNo}</span>
          </footer>
        </section>
      </div>
    </div>
  );
}

function ReportPrintTable({ section }: { section: ReportPreview["sections"][number] }) {
  return (
    <section className="mt-5">
      <PrintSectionTitle title={section.title} />
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-slate-100">
            {section.columns.map((column) => (
              <th key={column.key} className="border border-slate-400 px-2 py-2 text-left font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.length === 0 ? (
            <tr>
              <td className="border border-slate-300 px-2 py-3 text-center text-slate-500" colSpan={section.columns.length}>
                当前筛选条件下暂无明细
              </td>
            </tr>
          ) : (
            section.rows.slice(0, 10).map((row, index) => (
              <tr key={`${section.title}-${index}`}>
                {section.columns.map((column) => (
                  <td key={column.key} className="border border-slate-300 px-2 py-2">
                    {String(row[column.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {section.rows.length > 10 ? (
        <p className="mt-2 text-[11px] text-slate-500">纸质预览仅展示前 10 行，完整明细请下载 XLSX 文件。</p>
      ) : null}
    </section>
  );
}

function ApprovalFormulaModule({
  snapshot,
  actorId,
  busy,
  runAction,
  openDetail,
}: {
  snapshot: Snapshot;
  actorId: string;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
  openDetail: (detail: DetailState) => void;
}) {
  const latestFormula = snapshot.board.formulaCalculations[0];
  const formulaLines = Array.isArray(latestFormula?.lines) ? (latestFormula.lines as Row[]) : [];
  const canCalculate = ["U-MGR", "U-ADMIN", "U-PUR", "U-PROD"].includes(actorId);
  const approvalItems = snapshot.board.approvalCenter ?? [];
  const activeApprovalRuleCount = snapshot.board.approvalRules.filter((rule) => rule.status === "active").length;
  const [approvalForm, setApprovalForm] = useState<Record<string, string>>({
    type: "办公 OA",
    title: "合同用印审批",
    amount: "300",
    reason: "需要管理层确认后执行，并在系统内保留审批痕迹。",
  });
  const [ruleForm, setRuleForm] = useState<Record<string, string>>({
    rule_name: "合同用印快速审批",
    source_type: "office_oa",
    min_amount: "200",
    max_amount: "500",
    approver_role: "manager",
    sla_hours: "6",
    description: "200-500 元合同用印类审批，管理层 6 小时内处理。",
  });
  const [alertSubscriptionForm, setAlertSubscriptionForm] = useState<Record<string, string>>({
    role: "finance",
    alert_type: "receivable_due",
    min_severity: "medium",
    enabled: "true",
  });
  const setApprovalField = (key: string, value: string) => setApprovalForm((current) => ({ ...current, [key]: value }));
  const setRuleField = (key: string, value: string) => setRuleForm((current) => ({ ...current, [key]: value }));
  const setAlertSubscriptionField = (key: string, value: string) =>
    setAlertSubscriptionForm((current) => ({ ...current, [key]: value }));
  const canSubmitApproval = snapshot.security.currentPermissions.includes("submitApproval");
  const canConfigureRules = snapshot.security.currentPermissions.includes("upsertApprovalRule");
  const canConfigureAlertSubscriptions = snapshot.security.currentPermissions.includes("upsertAlertSubscription");
  const canRunApprovalAction = (row: Row, key: "approve_action" | "reject_action") =>
    snapshot.security.currentPermissions.includes(String(row[key] ?? ""));
  const runApprovalDecision = (row: Row, key: "approve_action" | "reject_action") => {
    const action = String(row[key] ?? "");
    if (!action) return;
    void runAction({
      action,
      entityId: String(row.entity_id),
      payload: {
        approval_note:
          key === "approve_action"
            ? `通过统一审批中心同意 ${String(row.request_no ?? row.title)}`
            : `通过统一审批中心驳回 ${String(row.request_no ?? row.title)}`,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-5">
        <MiniMetric label="待审批" value={`${snapshot.summary.pendingApprovalCount} 单`} />
        <MiniMetric label="超期审批" value={`${snapshot.summary.approvalOverdueCount} 单`} />
        <MiniMetric label="启用规则" value={`${activeApprovalRuleCount} 条`} />
        <MiniMetric label="配方试算" value={`${snapshot.summary.formulaCount} 次`} />
        <MiniMetric label="最新试算单价" value={formatCurrency(latestFormula?.quoted_unit_price)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Panel
          title="授权配方价格试算"
          icon={Calculator}
          actionButton={
            canCalculate
              ? {
                  label: busy === "createFormulaCalculation-system-primary" ? "试算中" : "试算配方",
                  onClick: () => void runAction({ action: "createFormulaCalculation" }),
                }
              : undefined
          }
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">
              授权人员输入或选定配方后，系统读取当前原材料移动均价，按“材料成本 + 损耗 + 加工费 + 利润率”自动计算配方价格，并保存每一次试算记录。
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <MiniMetric label="损耗率" value={`${(Number(latestFormula?.loss_rate ?? 0) * 100).toFixed(1)}%`} />
              <MiniMetric label="利润率" value={`${(Number(latestFormula?.margin_rate ?? 0) * 100).toFixed(1)}%`} />
              <MiniMetric label="100 件试算金额" value={formatCurrency(latestFormula?.total_price)} />
            </div>
            {latestFormula ? (
              <button
                type="button"
                onClick={() => openDetail(formulaDetail(snapshot, latestFormula))}
                className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
              >
                查看最新试算
              </button>
            ) : null}
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                    <th className="px-3 py-2">原材料</th>
                    <th className="px-3 py-2">配比用量</th>
                    <th className="px-3 py-2">单位</th>
                    <th className="px-3 py-2">当前均价</th>
                    <th className="px-3 py-2">成本贡献</th>
                    <th className="px-3 py-2">占比</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {formulaLines.map((line, index) => (
                    <tr key={String(line.materialId ?? index)}>
                      <td className="px-3 py-2 font-medium text-slate-900">{String(line.materialName)}</td>
                      <td className="px-3 py-2 text-slate-600">{String(line.qty)}</td>
                      <td className="px-3 py-2 text-slate-600">{String(line.unit)}</td>
                      <td className="px-3 py-2 text-slate-600">{formatCurrency(line.averageCost)}</td>
                      <td className="px-3 py-2 text-slate-600">{formatCurrency(line.lineCost)}</td>
                      <td className="px-3 py-2 text-slate-600">{(Number(line.ratio ?? 0) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>

        <Panel
          title="发起办公 OA 审批"
          icon={FileCheck2}
          action={canSubmitApproval ? "正式审批表单" : "只读"}
        >
          {canSubmitApproval ? (
            <div className="grid gap-3">
              <MasterSelect label="审批类型" value={approvalForm.type} onChange={(value) => setApprovalField("type", value)}>
                <option value="办公 OA">办公 OA</option>
                <option value="费用报销">费用报销</option>
                <option value="采购特采">采购特采</option>
                <option value="合同用印">合同用印</option>
              </MasterSelect>
              <MasterInput label="审批标题" value={approvalForm.title} onChange={(value) => setApprovalField("title", value)} />
              <MasterInput
                label="审批金额"
                type="number"
                value={approvalForm.amount}
                onChange={(value) => setApprovalField("amount", value)}
              />
              <MasterTextarea label="审批事由" value={approvalForm.reason} onChange={(value) => setApprovalField("reason", value)} />
              <MasterSubmitButton
                busy={busy === "submitApproval-system-primary"}
                label="提交审批"
                onClick={() => runAction({ action: "submitApproval", payload: approvalForm })}
              />
            </div>
          ) : (
            <EmptyText text="当前账号暂无发起审批权限。" />
          )}
        </Panel>
      </div>

      <Panel title="审批规则配置" icon={ShieldCheck} action={canConfigureRules ? "模板 / 金额 / 角色 / SLA" : "只读"}>
        {canConfigureRules ? (
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_140px_140px_160px_140px]">
            <MasterInput label="规则名称" value={ruleForm.rule_name} onChange={(value) => setRuleField("rule_name", value)} />
            <MasterSelect label="适用来源" value={ruleForm.source_type} onChange={(value) => setRuleField("source_type", value)}>
              <option value="office_oa">办公 OA</option>
              <option value="purchase_requisition">采购申请</option>
              <option value="purchase_order">采购订单</option>
              <option value="stocktake">库存盘点</option>
              <option value="requisition">领料单</option>
              <option value="formula_price">配方算价</option>
            </MasterSelect>
            <MasterInput
              label="起始金额"
              type="number"
              value={ruleForm.min_amount}
              onChange={(value) => setRuleField("min_amount", value)}
            />
            <MasterInput
              label="截止金额"
              type="number"
              value={ruleForm.max_amount}
              onChange={(value) => setRuleField("max_amount", value)}
            />
            <MasterSelect label="审批角色" value={ruleForm.approver_role} onChange={(value) => setRuleField("approver_role", value)}>
              <option value="manager">管理层</option>
              <option value="warehouse">仓库管理员</option>
              <option value="finance">财务专员</option>
              <option value="purchasing">采购员</option>
              <option value="admin">系统管理员</option>
            </MasterSelect>
            <MasterInput
              label="SLA 小时"
              type="number"
              value={ruleForm.sla_hours}
              onChange={(value) => setRuleField("sla_hours", value)}
            />
            <div className="lg:col-span-5">
              <MasterInput label="规则说明" value={ruleForm.description} onChange={(value) => setRuleField("description", value)} />
            </div>
            <div className="flex items-end">
              <MasterSubmitButton
                busy={busy === "upsertApprovalRule-system-primary"}
                label="保存规则"
                onClick={() => runAction({ action: "upsertApprovalRule", payload: ruleForm })}
              />
            </div>
          </div>
        ) : (
          <EmptyText text="审批规则配置需使用系统管理员账号。" />
        )}
      </Panel>

      <DataTable
        title="统一审批工作台"
        icon={FileCheck2}
        rows={approvalItems}
        columns={[
          { key: "source_type_label", label: "审批类型", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "request_no", label: "审批单号" },
          { key: "title", label: "标题" },
          { key: "applicant_name", label: "申请人" },
          { key: "amount", label: "金额/影响", render: formatCurrency },
          { key: "rule_name", label: "匹配规则" },
          { key: "approver_role_label", label: "审批角色" },
          { key: "age_days", label: "已等待", render: dayValue },
          { key: "sla_hours", label: "SLA", render: (value) => `${String(value ?? 0)} 小时` },
          { key: "risk_level", label: "风险", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          {
            key: "approval_center_ops",
            label: "审批操作",
            render: (_value, row) => (
              <div className="flex flex-wrap gap-2">
                <DetailButton onClick={() => openDetail(approvalCenterDetail(row))} />
                {canRunApprovalAction(row, "approve_action") ? (
                  <InlineActionButton
                    label="同意"
                    busy={busy === `${String(row.approve_action)}-${String(row.entity_id)}-primary`}
                    onClick={() => runApprovalDecision(row, "approve_action")}
                  />
                ) : null}
                {canRunApprovalAction(row, "reject_action") ? (
                  <InlineActionButton
                    label="驳回"
                    busy={busy === `${String(row.reject_action)}-${String(row.entity_id)}-primary`}
                    onClick={() => runApprovalDecision(row, "reject_action")}
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />

      <DataTable
        title="审批模板与规则台账"
        icon={ShieldCheck}
        rows={snapshot.board.approvalRules}
        columns={[
          { key: "rule_name", label: "规则名称" },
          { key: "source_type_label", label: "适用来源", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "amount_scope", label: "金额区间" },
          { key: "approver_role_label", label: "审批角色" },
          { key: "sla_hours", label: "SLA", render: (value) => `${String(value ?? 0)} 小时` },
          { key: "status_label", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
          { key: "description", label: "规则说明" },
          {
            key: "rule_ops",
            label: "操作",
            render: (_value, row) => (
              <div className="flex flex-wrap gap-2">
                <DetailButton onClick={() => openDetail(approvalRuleDetail(row))} />
                {canConfigureRules && row.status === "active" ? (
                  <InlineActionButton
                    label="停用"
                    busy={busy === `deactivateApprovalRule-${String(row.id)}-primary`}
                    onClick={() => runAction({ action: "deactivateApprovalRule", entityId: String(row.id) })}
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Panel title="预警订阅规则配置" icon={BellRing} action={canConfigureAlertSubscriptions ? "角色 / 类型 / 等级" : "只读"}>
          {canConfigureAlertSubscriptions ? (
            <div className="grid gap-3">
              <MasterSelect
                label="订阅角色"
                value={alertSubscriptionForm.role}
                onChange={(value) => setAlertSubscriptionField("role", value)}
              >
                <option value="manager">管理层</option>
                <option value="finance">财务专员</option>
                <option value="purchasing">采购员</option>
                <option value="warehouse">仓库管理员</option>
                <option value="assistant">商务内勤</option>
                <option value="production">生产主管</option>
                <option value="quality">品控员</option>
                <option value="sales">销售员</option>
                <option value="admin">系统管理员</option>
              </MasterSelect>
              <MasterSelect
                label="预警类型"
                value={alertSubscriptionForm.alert_type}
                onChange={(value) => setAlertSubscriptionField("alert_type", value)}
              >
                <option value="low_stock">低库存预警</option>
                <option value="inventory_stale">3个月未动库存</option>
                <option value="inventory_overstock">6个月积压库存</option>
                <option value="approval_pending">待审批</option>
                <option value="receivable_due">应收到期</option>
                <option value="payable_due">应付到期</option>
              </MasterSelect>
              <MasterSelect
                label="最低等级"
                value={alertSubscriptionForm.min_severity}
                onChange={(value) => setAlertSubscriptionField("min_severity", value)}
              >
                <option value="critical">紧急</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </MasterSelect>
              <MasterSelect
                label="订阅状态"
                value={alertSubscriptionForm.enabled}
                onChange={(value) => setAlertSubscriptionField("enabled", value)}
              >
                <option value="true">启用</option>
                <option value="false">停用</option>
              </MasterSelect>
              <MasterSubmitButton
                busy={busy === "upsertAlertSubscription-system-primary"}
                label="保存订阅"
                onClick={() => runAction({ action: "upsertAlertSubscription", payload: alertSubscriptionForm })}
              />
            </div>
          ) : (
            <EmptyText text="预警订阅规则需使用系统管理员账号配置。" />
          )}
        </Panel>

        <DataTable
          title="预警订阅规则台账"
          icon={BellRing}
          rows={snapshot.board.alertSubscriptions}
          columns={[
            { key: "role_label", label: "角色" },
            { key: "alert_type_label", label: "预警类型" },
            { key: "min_severity_label", label: "最低等级", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "enabled", label: "状态", render: (value) => <StatusBadge value={Number(value) === 1 ? "启用" : "停用"} /> },
            { key: "updated_at", label: "更新时间", render: shortDate },
            {
              key: "subscription_ops",
              label: "操作",
              render: (_value, row) =>
                canConfigureAlertSubscriptions ? (
                  <InlineActionButton
                    label={Number(row.enabled) === 1 ? "停用" : "启用"}
                    busy={busy === "upsertAlertSubscription-system-primary"}
                    onClick={() =>
                      runAction({
                        action: "upsertAlertSubscription",
                        payload: {
                          role: String(row.role),
                          alert_type: String(row.alert_type),
                          min_severity: String(row.min_severity ?? "low"),
                          enabled: Number(row.enabled) === 1 ? "false" : "true",
                        },
                      })
                    }
                  />
                ) : (
                  <span className="text-xs text-slate-400">-</span>
                ),
            },
          ]}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable
          title="配方试算历史"
          icon={Calculator}
          rows={snapshot.board.formulaCalculations}
          columns={[
            { key: "formula_no", label: "试算单号" },
            { key: "formula_name", label: "配方名称" },
            { key: "material_cost", label: "材料成本", render: formatCurrency },
            { key: "quoted_unit_price", label: "建议单价", render: formatCurrency },
            { key: "total_price", label: "100 件金额", render: formatCurrency },
            { key: "created_by_name", label: "试算人" },
            { key: "created_at", label: "试算时间", render: shortDate },
            {
              key: "formula_detail",
              label: "详情",
              render: (_value, row) => <DetailButton onClick={() => openDetail(formulaDetail(snapshot, row))} />,
            },
          ]}
        />
        <DataTable
          title="OA 审批台账"
          icon={FileCheck2}
          rows={snapshot.board.approvalRequests}
          columns={[
            { key: "request_no", label: "审批单号" },
            { key: "type", label: "类型" },
            { key: "title", label: "标题" },
            { key: "applicant_name", label: "申请人" },
            { key: "amount", label: "金额", render: formatCurrency },
            { key: "status", label: "状态", render: (value) => <StatusBadge value={String(value)} /> },
            { key: "created_at", label: "发起时间", render: shortDate },
            {
              key: "approval_detail",
              label: "详情",
              render: (_value, row) => <DetailButton onClick={() => openDetail(approvalDetail(snapshot, row))} />,
            },
          ]}
        />
      </div>
    </div>
  );
}

function ArchiveModule({
  snapshot,
  actorId,
  onSnapshot,
  onError,
}: {
  snapshot: Snapshot;
  actorId: string;
  onSnapshot: (snapshot: Snapshot) => void;
  onError: (message: string) => void;
}) {
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentEntities = useMemo(() => {
    const groups = [
      { type: "sales_order", label: "销售订单", rows: snapshot.board.orders, no: "order_no" },
      { type: "shipment", label: "发货单", rows: snapshot.board.shipments, no: "shipment_no" },
      { type: "sales_return", label: "销售退货单", rows: snapshot.board.salesReturns, no: "return_no" },
      { type: "customer_refund", label: "客户退款单", rows: snapshot.board.customerRefunds, no: "refund_no" },
      { type: "purchase_requisition", label: "采购申请单", rows: snapshot.board.purchaseRequisitions, no: "requisition_no" },
      { type: "purchase_order", label: "采购订单", rows: snapshot.board.purchaseOrders, no: "purchase_no" },
      { type: "purchase_contract", label: "采购合同", rows: snapshot.board.purchaseContracts, no: "contract_no" },
      { type: "purchase_arrival_notice", label: "到货通知单", rows: snapshot.board.purchaseArrivalNotices, no: "arrival_no" },
      { type: "warehouse_signoff", label: "仓库签收单", rows: snapshot.board.purchaseArrivalNotices, no: "arrival_no" },
      { type: "material_iqc", label: "原料 IQC 单", rows: snapshot.board.materialIqcInspections, no: "iqc_no" },
      { type: "inspection", label: "质检请验单", rows: snapshot.board.inspections, no: "inspection_no" },
      { type: "technical_disposition", label: "技术处置单", rows: snapshot.board.technicalDispositions, no: "disposition_no" },
      { type: "system_health_remediation", label: "上线整改单", rows: snapshot.board.systemHealthRemediations, no: "remediation_no" },
      { type: "receivable", label: "应收账款", rows: snapshot.board.receivables, no: "receivable_no" },
      { type: "payable", label: "应付账款", rows: snapshot.board.payables, no: "payable_no" },
    ];
    return groups.flatMap((group) =>
      group.rows.slice(0, 8).map((row) => ({
        type: group.type,
        label: `${group.label} / ${String(row[group.no] ?? row.id)}`,
        id: String(row.id ?? ""),
        no: String(row[group.no] ?? row.id ?? ""),
      })),
    );
  }, [snapshot]);
  const firstEntity = attachmentEntities[0];
  const [attachmentForm, setAttachmentForm] = useState<Record<string, string>>({
    entityKey: firstEntity ? `${firstEntity.type}|${firstEntity.id}|${firstEntity.no}` : "other||其他归档",
    entityType: firstEntity?.type ?? "other",
    entityId: firstEntity?.id ?? "",
    entityNo: firstEntity?.no ?? "其他归档",
    category: "客户合同",
    note: "正式凭证归档，随本地数据盘冷备份保存。",
  });
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const setAttachmentField = (key: string, value: string) =>
    setAttachmentForm((current) => ({ ...current, [key]: value }));
  const submitAttachment = async () => {
    const file = attachmentInputRef.current?.files?.[0];
    if (!file) {
      onError("请选择需要归档的附件文件。");
      return;
    }
    setAttachmentBusy(true);
    onError("");
    const form = new FormData();
    form.append("actorId", actorId);
    form.append("entityType", attachmentForm.entityType);
    form.append("entityId", attachmentForm.entityId);
    form.append("entityNo", attachmentForm.entityNo);
    form.append("category", attachmentForm.category);
    form.append("note", attachmentForm.note);
    form.append("file", file);
    const response = await fetch("/api/attachments", { method: "POST", body: form });
    const data = (await response.json()) as Snapshot | { error: string };
    if (!response.ok || "error" in data) {
      onError("error" in data ? data.error : "附件上传失败。");
    } else {
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      onSnapshot(data);
    }
    setAttachmentBusy(false);
  };

  return (
    <div className="space-y-5">
      <ArchivePanel snapshot={snapshot} />
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="附件凭证归档" icon={Upload} action="本地数据盘">
          <div className="grid gap-3">
            <MasterSelect
              label="关联单据"
              value={attachmentForm.entityKey}
              onChange={(value) => {
                const [entityType, entityId, entityNo] = value.split("|");
                setAttachmentForm((current) => ({
                  ...current,
                  entityKey: value,
                  entityType: entityType || "other",
                  entityId: entityId || "",
                  entityNo: entityNo || current.entityNo,
                }));
              }}
            >
              {attachmentEntities.map((entity) => (
                <option key={`${entity.type}-${entity.id}`} value={`${entity.type}|${entity.id}|${entity.no}`}>
                  {entity.label}
                </option>
              ))}
              <option value="other||其他归档">其他归档</option>
            </MasterSelect>
            <div className="grid gap-3 md:grid-cols-2">
              <MasterSelect label="凭证分类" value={attachmentForm.category} onChange={(value) => setAttachmentField("category", value)}>
                <option value="客户合同">客户合同</option>
                <option value="采购合同">采购合同</option>
                <option value="供应商报价">供应商报价</option>
                <option value="补充协议">补充协议</option>
                <option value="送货凭证">送货凭证</option>
                <option value="送货签收单">送货签收单</option>
                <option value="质检报告">质检报告</option>
                <option value="技术处置单">技术处置单</option>
                <option value="整改复核附件">整改复核附件</option>
                <option value="付款凭证">付款凭证</option>
                <option value="退款凭证">退款凭证</option>
                <option value="采购发票">采购发票</option>
                <option value="其他附件">其他附件</option>
              </MasterSelect>
              <MasterInput label="关联单号" value={attachmentForm.entityNo} onChange={(value) => setAttachmentField("entityNo", value)} />
            </div>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              附件文件
              <input
                ref={attachmentInputRef}
                type="file"
                className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700"
              />
            </label>
            <MasterTextarea
              label="归档说明"
              value={attachmentForm.note}
              onChange={(value) => setAttachmentField("note", value)}
            />
            <button
              type="button"
              disabled={attachmentBusy}
              onClick={() => void submitAttachment()}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {attachmentBusy ? "上传中" : "上传并归档"}
            </button>
          </div>
        </Panel>
        <DataTable
          title="附件凭证台账"
          icon={FileCheck2}
          rows={snapshot.board.documentAttachments}
          columns={[
            { key: "attachment_no", label: "附件编号" },
            { key: "entity_type_label", label: "单据类型" },
            { key: "entity_no", label: "关联单号" },
            { key: "category", label: "分类" },
            { key: "file_name", label: "文件名" },
            { key: "size_label", label: "大小" },
            { key: "uploaded_by_name", label: "上传人" },
            { key: "uploaded_at", label: "上传时间", render: shortDate },
            {
              key: "download",
              label: "下载",
              render: (_value, row) => (
                <InlineActionButton
                  label="下载"
                  onClick={() => {
                    window.location.href = `/api/attachments?actorId=${encodeURIComponent(actorId)}&id=${encodeURIComponent(String(row.id))}`;
                  }}
                />
              ),
            },
          ]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <ActivityPanel title="导出记录" icon={Download} rows={snapshot.board.documentExports} mode="document" />
        <ActivityPanel title="审计日志" icon={ShieldCheck} rows={snapshot.board.auditLogs} mode="audit" />
      </div>
      <Panel
        title="冷备份操作"
        icon={DatabaseBackup}
        actionButton={{ label: "生成备份包", onClick: () => downloadBackup(actorId) }}
      >
        <p className="text-sm leading-6 text-slate-600">
          备份包包含 SQLite 数据库、附件、导出文件和 manifest。更换硬盘时先下载备份包，再执行恢复命令。
        </p>
      </Panel>
    </div>
  );
}

function TaskCard({
  task,
  busy,
  runAction,
}: {
  task: Task;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
}) {
  const Icon = taskIcon[task.action ?? ""] ?? ClipboardList;
  const primaryBusy = busy === `${task.action}-${task.entityId ?? "system"}-primary`;
  const secondaryBusy = busy === `${task.secondaryAction}-${task.entityId ?? "system"}-${task.secondaryVariant}`;

  return (
    <article className={`rounded-md border border-slate-200 border-l-4 p-4 shadow-sm ${toneClass[task.tone]}`}>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-950">{task.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{task.detail}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {task.action ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => runAction(task)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Icon className="h-4 w-4" />
            {primaryBusy ? "处理中" : task.primaryLabel ?? "执行"}
          </button>
        ) : null}
        {task.secondaryAction ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              runAction({
                action: task.secondaryAction,
                entityId: task.entityId,
                variant: task.secondaryVariant,
              })
            }
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
          >
            <ArrowRight className="h-4 w-4" />
            {secondaryBusy ? "处理中" : task.secondaryLabel ?? "备选"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function AlertCenterPanel({
  snapshot,
  actorId,
  busy,
  runAction,
}: {
  snapshot: Snapshot;
  actorId: string;
  busy: string | null;
  runAction: (task: ActionRequest) => Promise<void>;
}) {
  const alerts = snapshot.board.alertCenter ?? [];
  const visibleAlerts = alerts.slice(0, 6);
  const severityClass: Record<string, string> = {
    critical: "border-red-200 bg-red-50/80",
    high: "border-rose-200 bg-rose-50/70",
    medium: "border-amber-200 bg-amber-50/70",
    low: "border-emerald-200 bg-emerald-50/70",
  };

  return (
    <Panel
      title="经营预警中心"
      icon={BellRing}
      action={`${alerts.length} 条 / 未读 ${snapshot.summary.unreadAlertCount} 条 / 紧急 ${snapshot.summary.criticalAlertCount} 条`}
    >
      <div className="space-y-3">
        {alerts.length === 0 ? (
          <EmptyText text="暂无低库存、积压库存、审批超期或账款到期预警" />
        ) : (
          visibleAlerts.map((alert) => {
            const alertId = String(alert.id ?? "");
            const action = String(alert.action ?? "");
            const entityId = alert.entity_id == null ? undefined : String(alert.entity_id);
            const canAct = Boolean(action && entityId && snapshot.security.currentPermissions.includes(action));
            const Icon = taskIcon[action] ?? AlertTriangle;
            const actionBusy = busy === `${action}-${entityId ?? "system"}-primary`;
            const readBusy = busy === `markAlertRead-${alertId}-primary`;
            const dismissBusy = busy === `dismissAlert-${alertId}-primary`;
            return (
              <article
                key={alertId}
                className={`rounded-md border p-3 shadow-sm ${severityClass[String(alert.severity)] ?? "border-slate-200 bg-slate-50"}`}
              >
                <div className="flex items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 truncate text-sm font-semibold text-slate-950">{String(alert.title ?? "-")}</h3>
                      <StatusBadge value={String(alert.severity_label ?? alert.severity ?? "-")} />
                      <StatusBadge value={String(alert.status_label ?? alert.message_status ?? "unread")} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{String(alert.detail ?? "-")}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-medium text-slate-500">
                      <span>{String(alert.module_label ?? "-")}</span>
                      <span>责任：{String(alert.owner_role_label ?? alert.owner_role ?? "-")}</span>
                      <span>#{String(alert.rank ?? "-")}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <StatusBadge value={String(alert.alert_type_label ?? alert.alert_type ?? "-")} />
                  <div className="flex flex-wrap justify-end gap-2">
                    {alert.is_unread ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void runAction({
                            action: "markAlertRead",
                            entityId: alertId,
                            payload: { alert_type: alert.alert_type },
                          })
                        }
                        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {readBusy ? "处理中" : "已读"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void runAction({
                          action: "dismissAlert",
                          entityId: alertId,
                          payload: { alert_type: alert.alert_type },
                        })
                      }
                      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                      <X className="h-3.5 w-3.5" />
                      {dismissBusy ? "处理中" : "忽略"}
                    </button>
                    {canAct ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void runAction({
                            action,
                            entityId,
                            payload: alertActionPayload(alert, actorId),
                          })
                        }
                        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {actionBusy ? "处理中" : String(alert.action_label ?? "处理")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })
        )}
        {alerts.length > visibleAlerts.length ? (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
            还有 {alerts.length - visibleAlerts.length} 条预警，可在对应模块继续处理。
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function LifecycleTile({
  group,
}: {
  group: { name: string; rows: Row[]; label: string; status: string };
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-800">{group.name}</h2>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
          {group.rows.length}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {group.rows.length === 0 ? (
          <EmptyText text="暂无数据" />
        ) : (
          group.rows.slice(0, 3).map((row) => (
            <div key={String(row.id)} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-700">{String(row[group.label] ?? "-")}</span>
              <StatusBadge value={String(row[group.status] ?? "-")} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LedgerPanel({
  actorId,
  receivables,
  payables,
  purchaseOrders,
  suppliers,
}: {
  actorId: string;
  receivables: Row[];
  payables: Row[];
  purchaseOrders: Row[];
  suppliers: Row[];
}) {
  const download = (type: string) => {
    window.location.href = `/api/export?actorId=${encodeURIComponent(actorId)}&type=${type}&format=xlsx`;
  };

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="应收台账" icon={Download} actionButton={{ label: "台账", onClick: () => download("ledger") }}>
        <LedgerList
          empty="暂无应收"
          rows={receivables}
          numberKey="receivable_no"
          nameKey="customer_name"
          balanceKey="balance_amount"
        />
      </Panel>

      <Panel title="采购与应付" icon={Boxes} actionButton={{ label: "采购对账", onClick: () => download("purchase-statement") }}>
        <LedgerList
          empty="暂无应付"
          rows={payables}
          numberKey="payable_no"
          nameKey="supplier_name"
          balanceKey="balance_amount"
        />
        <div className="mt-3 border-t border-slate-100 pt-3">
          {purchaseOrders.slice(0, 2).map((item) => (
            <div key={String(item.id)} className="flex items-center justify-between gap-3 py-1 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-700">{String(item.purchase_no)}</span>
              <span className="text-slate-500">{formatCurrency(item.total_amount)}</span>
            </div>
          ))}
          <p className="mt-2 text-xs leading-5 text-slate-500">供应商：{suppliers.map((item) => String(item.name)).join("、")}</p>
        </div>
      </Panel>
    </div>
  );
}

function LedgerList({
  rows,
  empty,
  numberKey,
  nameKey,
  balanceKey,
}: {
  rows: Row[];
  empty: string;
  numberKey: string;
  nameKey: string;
  balanceKey: string;
}) {
  if (rows.length === 0) return <EmptyText text={empty} />;

  return (
    <div className="divide-y divide-slate-100">
      {rows.slice(0, 4).map((item) => (
        <div key={String(item.id)} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{String(item[numberKey])}</span>
            <StatusBadge value={String(item.status)} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {String(item[nameKey])} / 余额 {formatCurrency(item[balanceKey])} / 账龄 {String(item.age_days ?? 0)} 天
          </p>
        </div>
      ))}
    </div>
  );
}

function InventoryTable({
  actorId,
  materials,
  canPurchase = false,
  busy,
  runAction,
}: {
  actorId: string;
  materials: Row[];
  canPurchase?: boolean;
  busy?: string | null;
  runAction?: (task: ActionRequest) => Promise<void>;
}) {
  return (
    <Panel
      title="实时库存"
      icon={Warehouse}
      actionButton={{
        label: "CSV",
        onClick: () => {
          window.location.href = `/api/export?actorId=${encodeURIComponent(actorId)}&type=finance&format=csv`;
        },
      }}
    >
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <th className="px-4 py-3">物料</th>
              <th className="px-4 py-3">库存</th>
              <th className="px-4 py-3">移动均价</th>
              <th className="px-4 py-3">库存价值</th>
              <th className="px-4 py-3">批次数</th>
              <th className="px-4 py-3">预警线</th>
              <th className="px-4 py-3">最近变动</th>
              <th className="px-4 py-3">库龄状态</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {materials.map((material) => {
              const warning =
                Number(material.reorder_min_qty ?? 0) > 0 &&
                Number(material.stock_qty ?? 0) <= Number(material.reorder_min_qty);
              return (
                <tr key={String(material.id)} className="bg-white hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{String(material.name)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatQty(material.stock_qty, material.unit)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatCurrency(material.average_cost)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatCurrency(Number(material.stock_qty ?? 0) * Number(material.average_cost ?? 0))}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{String(material.batch_count)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      value={warning ? `预警 ${formatQty(material.reorder_min_qty, material.unit)}` : "正常"}
                      tone={warning ? "warning" : "success"}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{shortDate(material.last_movement_at)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={String(material.aging_status ?? "normal")} />
                  </td>
                  <td className="px-4 py-3">
                    {canPurchase && runAction ? (
                      <InlineActionButton
                        label="生成申请"
                        busy={busy === `createPurchaseRequisition-${String(material.id)}-primary`}
                        onClick={() => void runAction({ action: "createPurchaseRequisition", entityId: String(material.id) })}
                      />
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function InlineActionButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? "处理中" : label}
    </button>
  );
}

function DetailButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
    >
      查看
    </button>
  );
}

type DetailSpec = [label: string, key: string, formatter?: (value: unknown, row: Row) => React.ReactNode];

function makeDetail(title: string, subtitle: string, row: Row, specs: DetailSpec[]): DetailState {
  return {
    title,
    subtitle,
    fields: specs.map(([label, key, formatter]) => {
      const raw = row[key];
      const value =
        formatter?.(raw, row) ??
        (label.includes("状态") ? <StatusBadge value={String(raw ?? "-")} /> : String(raw ?? "-"));
      return { label, value };
    }),
  };
}

function percentValue(value: unknown) {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`;
}

function percentNumberValue(value: unknown) {
  return `${Number(value ?? 0).toFixed(2)}%`;
}

function dayValue(value: unknown) {
  return `${String(value ?? 0)} 天`;
}

function reportTypeLabel(value: string) {
  return (
    {
      daily: "经营日报",
      weekly: "经营周报",
      monthly: "经营月报",
      inventory_daily: "库存日报",
      inventory_overstock: "库存积压报表",
      sales_statement: "销售对账单",
      purchase_statement: "采购对账单",
      supplier_performance: "供应商绩效评分报表",
      supplier_discrepancy: "供应商差异统计报表",
      quality_exception: "质量异常分析报表",
    }[value] ?? value
  );
}

function reportExportLabel(value: string) {
  return (
    {
      "business-daily": "经营日报",
      "business-weekly": "经营周报",
      "business-monthly": "经营月报",
      "inventory-daily": "库存日报",
      "inventory-overstock": "库存积压报表",
      "sales-statement": "销售对账单",
      "purchase-statement": "采购对账单",
      "supplier-performance": "供应商绩效评分报表",
      "supplier-discrepancy": "供应商差异统计报表",
      "quality-exception": "质量异常分析报表",
    }[value] ?? value
  );
}

function requisitionStatusLabel(status: string) {
  return (
    {
      pending_approval: "待审批",
      pending: "待发料",
      approved: "已批准",
      issued: "已发料",
      rejected: "已驳回",
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
      qa_failed: "检验未通过",
      qa_approved: "待入库",
      in_stock: "待发货",
      partial_shipped: "部分发货",
      shipped: "已发货",
      reversed: "已冲销",
    }[status] ?? status
  );
}

function detailLines(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Row[]) : [];
  } catch {
    return [];
  }
}

function auditRows(snapshot: Snapshot, entityId: unknown) {
  return snapshot.board.auditLogs.filter((log) => String(log.entity_id) === String(entityId));
}

function formulaDetail(snapshot: Snapshot, row: Row): DetailState {
  return {
    ...makeDetail("配方试算详情", String(row.formula_no), row, [
      ["配方名称", "formula_name"],
      ["总用量", "total_qty"],
      ["单位", "unit"],
      ["材料成本", "material_cost", formatCurrency],
      ["加工费", "process_fee", formatCurrency],
      ["损耗率", "loss_rate", percentValue],
      ["利润率", "margin_rate", percentValue],
      ["建议单价", "quoted_unit_price", formatCurrency],
      ["100 件金额", "total_price", formatCurrency],
      ["试算人", "created_by_name"],
      ["试算时间", "created_at", shortDate],
      ["说明", "note"],
    ]),
    lines: detailLines(row.lines),
    audits: auditRows(snapshot, row.id),
  };
}

function approvalDetail(snapshot: Snapshot, row: Row): DetailState {
  return {
    ...makeDetail("审批单详情", String(row.request_no), row, [
      ["审批类型", "type"],
      ["标题", "title"],
      ["申请人", "applicant_name"],
      ["金额", "amount", formatCurrency],
      ["状态", "status"],
      ["申请原因", "reason"],
      ["发起时间", "created_at", shortDate],
      ["审批人", "decided_by_name"],
      ["审批时间", "decided_at", shortDate],
      ["审批意见", "decision_note"],
    ]),
    audits: auditRows(snapshot, row.id),
  };
}

function approvalCenterDetail(row: Row): DetailState {
  return makeDetail("统一审批详情", String(row.request_no ?? row.title), row, [
    ["来源模块", "module_label"],
    ["审批类型", "source_type_label"],
    ["审批单号", "request_no"],
    ["标题", "title"],
    ["申请人", "applicant_name"],
    ["金额/影响", "amount", formatCurrency],
    ["风险等级", "risk_level"],
    ["已等待", "age_days", dayValue],
    ["SLA", "sla_hours", (value) => `${String(value ?? 0)} 小时`],
    ["是否超期", "is_overdue", (value) => (value ? "是" : "否")],
    ["状态", "status_label"],
    ["申请原因", "reason"],
    ["发起时间", "created_at", shortDate],
  ]);
}

function approvalRuleDetail(row: Row): DetailState {
  return makeDetail("审批规则详情", String(row.rule_name), row, [
    ["规则编码", "rule_code"],
    ["规则名称", "rule_name"],
    ["适用来源", "source_type_label"],
    ["金额区间", "amount_scope"],
    ["审批角色", "approver_role_label"],
    ["处理时限", "sla_hours", (value) => `${String(value ?? 0)} 小时`],
    ["状态", "status_label"],
    ["规则说明", "description"],
    ["创建时间", "created_at", shortDate],
    ["更新时间", "updated_at", shortDate],
  ]);
}

function DetailModal({ detail, onClose }: { detail: DetailState | null; onClose: () => void }) {
  if (!detail) return null;
  const lineKeys = preferredLineKeys(detail.lines ?? []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <section className="max-h-full w-full max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-950">{detail.title}</h2>
            <p className="mt-1 truncate text-sm text-slate-500">{detail.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-700"
            aria-label="关闭详情"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[76vh] overflow-y-auto px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {detail.fields.map((field) => (
              <div key={field.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-medium text-slate-500">{field.label}</p>
                <div className="mt-1 min-h-6 text-sm font-semibold text-slate-900">{field.value}</div>
              </div>
            ))}
          </div>

          {detail.lines && detail.lines.length > 0 ? (
            <div className="mt-5 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-950">明细行</div>
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                      {lineKeys.map((key) => (
                        <th key={key} className="px-4 py-3">
                          {detailColumnLabel(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.lines.map((line, index) => (
                      <tr key={String(line.id ?? index)}>
                        {lineKeys.map((key) => (
                          <td key={key} className="px-4 py-3 text-slate-700">
                            {formatDetailCell(key, line[key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="mt-5 rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-950">操作留痕</div>
            <div className="divide-y divide-slate-100">
              {detail.audits && detail.audits.length > 0 ? (
                detail.audits.map((audit) => (
                  <div key={String(audit.id)} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-semibold text-slate-900">{String(audit.action)}</span>
                      <span className="text-xs text-slate-500">{shortDate(audit.created_at)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {String(audit.actor_name ?? audit.actor_id ?? "-")} / {String(audit.message ?? "-")}
                    </p>
                  </div>
                ))
              ) : (
                <p className="px-4 py-4 text-sm text-slate-500">暂无最近审计记录</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function preferredLineKeys(lines: Row[]) {
  const preferred = [
    "materialName",
    "qty",
    "unit",
    "averageCost",
    "lineCost",
    "ratio",
    "componentName",
    "componentType",
    "qtyPer",
    "isPrimary",
    "unitCost",
    "lineAmount",
    "requestedQty",
    "estimatedUnitCost",
    "orderedQty",
    "receivedQty",
    "acceptedQty",
    "rejectedQty",
    "acceptedUnitCost",
    "batchNo",
    "requiredQty",
    "issuedQty",
  ];
  const found = new Set(lines.flatMap((line) => Object.keys(line)));
  const keys = preferred.filter((key) => found.has(key));
  return keys.length > 0 ? keys : Array.from(found).slice(0, 6);
}

function detailColumnLabel(key: string) {
  const labels: Record<string, string> = {
    materialName: "物料",
    qty: "数量",
    unit: "单位",
    averageCost: "当前均价",
    lineCost: "成本贡献",
    ratio: "占比",
    componentName: "组件",
    componentType: "类型",
    qtyPer: "单位用量",
    isPrimary: "主材",
    unitCost: "单价",
    lineAmount: "金额",
    requestedQty: "申请数量",
    estimatedUnitCost: "预计单价",
    orderedQty: "订购量",
    receivedQty: "到货量",
    acceptedQty: "放行量",
    rejectedQty: "拒收量",
    acceptedUnitCost: "放行单价",
    batchNo: "入库批次",
    requiredQty: "需求量",
    issuedQty: "已发量",
  };
  return labels[key] ?? key;
}

function formatDetailCell(key: string, value: unknown) {
  if (["averageCost", "lineCost", "unitCost", "lineAmount", "estimatedUnitCost", "acceptedUnitCost"].includes(key)) return formatCurrency(value);
  if (key === "ratio") return percentValue(value);
  if (key === "isPrimary") return Number(value) === 1 || value === true ? "是" : "否";
  if (["qty", "qtyPer", "requestedQty", "orderedQty", "receivedQty", "acceptedQty", "rejectedQty", "requiredQty", "issuedQty"].includes(key)) return formatQty(value);
  return String(value ?? "-");
}

function DataTable({
  title,
  icon,
  rows,
  columns,
  action,
  empty = "暂无数据",
}: {
  title: string;
  icon: typeof ClipboardList;
  rows?: Row[];
  columns: Array<{ key: string; label: string; render?: (value: unknown, row: Row) => React.ReactNode }>;
  action?: { label: string; onClick: () => void };
  empty?: string;
}) {
  const Icon = icon;
  const dataRows = rows ?? [];
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{dataRows.length}</span>
        </div>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
          >
            <Download className="h-4 w-4" />
            {action.label}
          </button>
        ) : null}
      </div>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              {columns.map((column) => (
                <th key={column.key} className="px-4 py-3">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dataRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                  {empty}
                </td>
              </tr>
            ) : (
              dataRows.map((row, index) => (
                <tr key={String(row.id ?? index)} className="bg-white hover:bg-slate-50">
                  {columns.map((column) => (
                    <td key={column.key} className="max-w-[220px] truncate px-4 py-3 text-slate-700">
                      {column.render ? column.render(row[column.key], row) : String(row[column.key] ?? "-")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BatchPanel({
  finishedBatches,
  inspections,
}: {
  finishedBatches: Row[];
  inspections: Row[];
}) {
  return (
    <Panel title="成品与质检" icon={PackageCheck}>
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500">入库批次</div>
          {finishedBatches.length === 0 ? (
            <EmptyText text="暂无入库批次" />
          ) : (
            <div className="space-y-2">
              {finishedBatches.slice(0, 4).map((batch) => (
                <div key={String(batch.id)} className="rounded-md bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-900">{String(batch.batch_no)}</span>
                    <StatusBadge value={String(batch.kind) === "transition" ? "过渡料" : "成品"} />
                  </div>
                  <div className="mt-1 text-slate-500">
                    {String(batch.product_name)} / {formatQty(batch.qty, batch.unit)} / {formatCurrency(batch.unit_cost)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500">品控收率</div>
          {inspections.length === 0 ? (
            <EmptyText text="暂无请验记录" />
          ) : (
            <div className="space-y-2">
              {inspections.slice(0, 4).map((inspection) => (
                <div key={String(inspection.id)} className="rounded-md bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-900">{String(inspection.inspection_no)}</span>
                    <StatusBadge value={String(inspection.result ?? inspection.status)} />
                  </div>
                  <div className="mt-1 text-slate-500">
                    入库 {formatQty(inspection.actual_qty)} / 主材 {formatQty(inspection.primary_issued_qty)} / 收率{" "}
                    {Number(inspection.yield_rate ?? 0).toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ArchivePanel({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Panel title="本地归档" icon={DatabaseBackup}>
      <div className="space-y-2 text-sm text-slate-600">
        <KeyValue label="数据库" value={formatBytes(snapshot.storage.databaseBytes)} />
        <KeyValue label="附件" value={formatBytes(snapshot.storage.attachmentsBytes)} />
        <KeyValue label="导出" value={formatBytes(snapshot.storage.exportsBytes)} />
        <KeyValue label="备份" value={formatBytes(snapshot.storage.backupsBytes)} />
        <div className="border-t border-slate-100 pt-2">最近备份：{snapshot.storage.latestBackup}</div>
        <div className="rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-white">{snapshot.storage.restoreCommand}</div>
        <p className="leading-6">{snapshot.storage.archiveNote}</p>
      </div>
    </Panel>
  );
}

function ActivityPanel({
  title,
  icon,
  rows,
  mode,
}: {
  title: string;
  icon: typeof ClipboardList;
  rows: Row[];
  mode: "document" | "audit";
}) {
  return (
    <Panel title={title} icon={icon}>
      <div className="max-h-[260px] divide-y divide-slate-100 overflow-y-auto scrollbar-thin">
        {rows.length === 0 ? (
          <EmptyText text="暂无记录" />
        ) : (
          rows.map((row) => (
            <div key={String(row.id)} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                  {mode === "document" ? String(row.file_name) : String(row.actor_name ?? row.actor_id)}
                </span>
                <span className="shrink-0 text-xs text-slate-400">{shortDate(row.created_at)}</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {mode === "document" ? `${String(row.actor_name ?? row.actor_id)} / ${String(row.type)}` : String(row.message)}
              </p>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof ClipboardList;
  tone: "blue" | "emerald" | "amber" | "rose" | "violet" | "cyan" | "slate";
}) {
  const toneMap = {
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    violet: "bg-violet-50 text-violet-700",
    cyan: "bg-cyan-50 text-cyan-700",
    slate: "bg-slate-100 text-slate-700",
  };

  return (
    <div className="min-h-[104px] rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-xs font-medium leading-5 text-slate-500">{label}</p>
          <p className="mt-2 break-words text-xl font-semibold leading-7 text-slate-950">{value}</p>
        </div>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${toneMap[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function ModuleHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Download className="h-4 w-4" />
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function SummaryStrip({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
      <Metric label="订单额" value={formatCurrency(snapshot.summary.orderAmount)} icon={FileSpreadsheet} tone="blue" />
      <Metric label="采购额" value={formatCurrency(snapshot.summary.purchaseAmount)} icon={Boxes} tone="violet" />
      <Metric label="库存总值" value={formatCurrency(snapshot.summary.inventoryValue)} icon={Warehouse} tone="emerald" />
      <Metric label="应收余额" value={formatCurrency(snapshot.summary.receivableBalance)} icon={Download} tone="cyan" />
      <Metric label="应付余额" value={formatCurrency(snapshot.summary.payableBalance)} icon={ClipboardList} tone="amber" />
      <Metric label="已回款" value={formatCurrency(snapshot.summary.receivedAmount)} icon={CheckCircle2} tone="emerald" />
      <Metric label="低库存" value={`${snapshot.summary.lowStockCount} 项`} icon={ShieldCheck} tone="rose" />
      <Metric label="积压库存" value={`${snapshot.summary.overstockCount} 项`} icon={Warehouse} tone="rose" />
      <Metric label="经营预警" value={`${snapshot.summary.alertCount} 条 / 未读 ${snapshot.summary.unreadAlertCount}`} icon={BellRing} tone="rose" />
      <Metric label="待审批" value={`${snapshot.summary.pendingApprovalCount} 单`} icon={FileCheck2} tone="amber" />
      <Metric label="配方试算" value={`${snapshot.summary.formulaCount} 次`} icon={Calculator} tone="violet" />
      <Metric label="我的待办" value={`${snapshot.summary.pendingTasks} 项`} icon={ClipboardList} tone="slate" />
    </section>
  );
}

const productionProgressMap: Record<string, number> = {
  instructed: 18,
  material_requested: 34,
  producing: 56,
  inspection_requested: 72,
  qa_failed: 68,
  qa_approved: 84,
  in_stock: 94,
  partial_shipped: 98,
  shipped: 100,
};

function productionProgressPercent(status: unknown) {
  return productionProgressMap[String(status ?? "")] ?? 0;
}

function productionNextStep(row: Row) {
  const status = String(row.status ?? "");
  const nextStep: Record<string, string> = {
    instructed: "生产主管排产并生成领料单",
    material_requested: "仓库按领料单 FIFO 发料",
    producing: "生产填报日报并完工请验",
    inspection_requested: "品控判定合格/让步/不合格",
    qa_failed: "技术处置后发起复检",
    qa_approved: "仓库办理成品/过渡料入库",
    in_stock: "商务内勤安排销售发货",
    partial_shipped: "继续补发或关闭发货差异",
    shipped: "订单已完成交付",
  };
  return nextStep[status] ?? "等待下一步流转";
}

function sortedProductionRows(productions: Row[]) {
  const stageWeight: Record<string, number> = {
    instructed: 1,
    material_requested: 2,
    producing: 3,
    inspection_requested: 4,
    qa_failed: 5,
    qa_approved: 6,
    in_stock: 7,
    partial_shipped: 8,
    shipped: 9,
  };

  return [...productions].sort((a, b) => {
    const aStatus = String(a.status ?? "");
    const bStatus = String(b.status ?? "");
    const aOpen = aStatus === "shipped" ? 1 : 0;
    const bOpen = bStatus === "shipped" ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen;

    const aPlan = String(a.planned_date ?? a.due_date ?? a.created_at ?? "9999-12-31");
    const bPlan = String(b.planned_date ?? b.due_date ?? b.created_at ?? "9999-12-31");
    if (aPlan !== bPlan) return aPlan.localeCompare(bPlan);

    return (stageWeight[aStatus] ?? 99) - (stageWeight[bStatus] ?? 99);
  });
}

function ProductionProgressPanel({ productions }: { productions: Row[] }) {
  const rows = sortedProductionRows(productions).slice(0, 6);
  const activeRows = productions.filter((row) => !["shipped", "voided", "cancelled"].includes(String(row.status ?? "")));
  const scheduledCount = productions.filter((row) => row.planned_date).length;
  const unscheduledCount = productions.filter((row) => String(row.status ?? "") === "instructed" || !row.planned_date).length;
  const producingCount = productions.filter((row) => String(row.status ?? "") === "producing").length;
  const qaPendingCount = productions.filter((row) => ["inspection_requested", "qa_approved"].includes(String(row.status ?? ""))).length;
  const averageProgress = activeRows.length
    ? Math.round(activeRows.reduce((sum, row) => sum + productionProgressPercent(row.status), 0) / activeRows.length)
    : productions.length
      ? 100
      : 0;

  return (
    <section className="mt-5">
      <Panel title="生产排单与进度" icon={Factory} action={`在制 ${activeRows.length} 单 / 已排产 ${scheduledCount} 单`}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MiniMetric label="在制生产单" value={`${activeRows.length} 单`} />
          <MiniMetric label="已排产" value={`${scheduledCount} 单`} />
          <MiniMetric label="生产中" value={`${producingCount} 单`} />
          <MiniMetric label="待质检/入库" value={`${qaPendingCount} 单`} />
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500">整体生产完成度</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{averageProgress}%</p>
            </div>
            <div className="min-w-0 flex-1 md:max-w-[720px]">
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${averageProgress}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>待排产 {unscheduledCount} 单</span>
                <span>生产中 {producingCount} 单</span>
                <span>待品控/入库 {qaPendingCount} 单</span>
              </div>
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="mt-4">
            <EmptyText text="暂无生产排单，销售订单转生产指令后将在这里显示计划日期、机台、负责人和进度。" />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {rows.map((row) => {
              const progress = productionProgressPercent(row.status);
              return (
                <article key={String(row.id)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-950">{String(row.prod_no ?? "-")}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {String(row.order_no ?? "-")} / {String(row.customer_name ?? "-")}
                      </p>
                    </div>
                    <StatusBadge value={String(row.status_label ?? row.status ?? "empty")} />
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                      <span className="truncate">{String(row.product_name ?? "-")}</span>
                      <span className="shrink-0 font-semibold text-slate-700">{progress}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${String(row.status) === "qa_failed" ? "bg-rose-500" : "bg-blue-600"}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                    <KeyValue label="计划日期" value={shortDate(row.planned_date)} />
                    <KeyValue label="交付期限" value={shortDate(row.due_date)} />
                    <KeyValue label="机台/班次" value={`${String(row.machine ?? "-")}${row.shift ? ` / ${String(row.shift)}` : ""}`} />
                    <KeyValue label="负责人" value={String(row.owner ?? "-")} />
                  </div>

                  <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                    下一步：{productionNextStep(row)}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function BomImportPanel({
  busy,
  fileInputRef,
  uploadBom,
}: {
  busy: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadBom: () => Promise<void>;
}) {
  return (
    <Panel title="BOM 导入" icon={Upload}>
      <div className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600"
        />
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={uploadBom}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Upload className="h-4 w-4" />
          {busy === "bom-import" ? "导入中" : "导入 BOM"}
        </button>
      </div>
    </Panel>
  );
}

function OrderFunnelChart({ snapshot }: { snapshot: Snapshot }) {
  return (
    <ChartPanel title="订单漏斗">
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={snapshot.charts.orderFunnel}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip />
          <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function CashChart({ snapshot }: { snapshot: Snapshot }) {
  return (
    <ChartPanel title="应收应付">
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={snapshot.charts.cashPosition}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} />
          <Tooltip formatter={(value) => formatCurrency(value)} />
          <Bar dataKey="value" fill="#0f766e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function ProductionChart({ snapshot }: { snapshot: Snapshot }) {
  return (
    <ChartPanel title="生产进度">
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={snapshot.charts.productionStages}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
          <Tooltip />
          <Line type="monotone" dataKey="stage" stroke="#7c3aed" strokeWidth={3} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function InventoryValueChart({ snapshot }: { snapshot: Snapshot }) {
  return (
    <ChartPanel title="库存价值">
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={snapshot.charts.inventoryByMaterial} layout="vertical" margin={{ left: 18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={88} />
          <Tooltip formatter={(value) => formatCurrency(value)} />
          <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function YieldChart({ snapshot }: { snapshot: Snapshot }) {
  return (
    <ChartPanel title="收率趋势">
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={snapshot.charts.yieldTrend}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
          <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
          <Line type="monotone" dataKey="value" stroke="#059669" strokeWidth={3} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function Panel({
  title,
  icon: Icon,
  action,
  actionButton,
  children,
}: {
  title: string;
  icon: typeof ClipboardList;
  action?: string;
  actionButton?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-blue-600" />
          <h2 className="truncate text-sm font-semibold text-slate-950">{title}</h2>
        </div>
        {actionButton ? (
          <button
            type="button"
            onClick={actionButton.onClick}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
          >
            <Download className="h-4 w-4" />
            {actionButton.label}
          </button>
        ) : action ? (
          <span className="shrink-0 text-xs font-medium text-slate-500">{action}</span>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
      <div className="mt-4 h-[210px]">{children}</div>
    </section>
  );
}

function StatusBadge({ value, tone }: { value: string; tone?: "success" | "warning" }) {
  const forced = tone === "success" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : tone === "warning" ? "bg-amber-50 text-amber-700 ring-amber-200" : undefined;
  const label =
    {
      pending: "待审批",
      pending_inspection: "待检验",
      approved: "已同意",
      rejected: "已驳回",
      待发料: "待发料",
      已发料: "已发料",
      draft: "草稿",
      converted: "已转订单",
      pending_approval: "待审批",
      pending_receipt: "待入库",
      pending_signoff: "待签收",
      discrepancy_pending: "差异待审批",
      discrepancy_approved: "差异待处理",
      received: "已入库",
      shipped: "已发货",
      partial_shipped: "部分发货",
      instructed: "待排产",
      material_requested: "待发料",
      scheduled: "已排产",
      requisitioned: "已生成领料",
      issued: "已发料",
      producing: "生产中",
      inspection_requested: "已请验",
      qa_approved: "待入库",
      qa_failed: "检验未通过",
      in_stock: "待发货",
      inspected: "已检验",
      inbounded: "已入库",
      qualified: "合格",
      concession: "让步接收",
      failed: "不合格",
      paid: "已结清",
      partial: "部分",
      unpaid: "未结清",
      normal: "正常",
      stale_warning: "呆滞预警",
      overstock: "积压库存",
      substitute: "替代",
      finished: "成品",
      transition: "过渡料",
      available: "可用",
      closed: "已归集",
      active: "启用",
      inactive: "停用",
      voided: "已作废",
      reversed: "已冲销",
      returned: "已退货",
      pending_refund: "待退款",
      partial_refunded: "部分退款",
      refunded: "已退款",
      pending_replacement: "待补发",
      replaced: "已补发",
      not_required: "无需处理",
      refund_due: "待退款",
      no_charge: "无需收款",
      unread: "未读",
      read: "已读",
      dismissed: "已忽略",
      handled: "已处理",
      resolved: "已处理",
    }[value] ?? value;
  return (
    <span
      className={`inline-flex min-h-6 max-w-[140px] items-center truncate rounded-full px-2 text-xs font-semibold ring-1 ring-inset ${
        forced ?? statusClass[value] ?? "bg-slate-100 text-slate-700 ring-slate-200"
      }`}
    >
      {label}
    </span>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <p className="rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">{text}</p>;
}
