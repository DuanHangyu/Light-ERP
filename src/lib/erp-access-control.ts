import type { ErpRole } from "./erp-navigation";

type RecordLike = Record<string, unknown>;

type SnapshotLike = {
  dataRoot: string;
  users: Array<{ id: string; [key: string]: unknown }>;
  currentUser: { id: string; role: string; [key: string]: unknown };
  summary: RecordLike;
  board: RecordLike;
  charts: RecordLike;
  storage: RecordLike;
  security: {
    currentPermissions: unknown[];
    rolePermissions: unknown[];
    permissionMatrix: unknown[];
  };
  parallel: RecordLike;
};

const sharedBoardFields = [
  "approvalRequests",
  "approvalCenter",
  "alertCenter",
  "alertMessageStates",
  "alertSubscriptions",
  "documentAttachments",
  "systemHealthRemediations",
  "systemHealthRemediationReviews",
] as const;

const salesBoardFields = [
  "quotes",
  "orders",
  "customers",
  "products",
  "boms",
  "materials",
  "customerDeliveryConfirmations",
  "finishedBatches",
  "finishedShipmentAllocations",
  "shipments",
  "salesReturns",
  "salesReturnAllocations",
  "salesReturnCandidates",
  "replacementShipmentCandidates",
  "customerRefunds",
  "receivables",
] as const;

const productionBoardFields = [
  "productions",
  "productionScheduleChanges",
  "productionDeliveryWarnings",
  "productionPlanVersions",
  "productionPlanLines",
  "productionPlanNotifications",
  "productionPlanChangeImpacts",
  "productionMaterialAdjustmentSuggestions",
  "productionMaterialAdjustmentOrders",
  "productionMaterialAdjustmentOrderReviews",
  "productionMaterialAdjustmentReviewExceptions",
  "qualityInspectionWindowConfirmations",
  "requisitions",
  "materialIssues",
  "inspections",
  "productionDailyReports",
  "technicalDispositions",
  "qualityExceptionAnalytics",
  "costAnomalyAnalytics",
  "costAnomalyDrilldowns",
  "costAnomalyRemediations",
  "costAnomalyRemediationReviews",
  "costAnomalyWarningRules",
  "costAnomalyWarningEvents",
  "costAnomalyWarningDashboard",
  "materials",
  "batches",
  "finishedBatches",
  "finishedReceipts",
  "productionCostSummaries",
  "productionCostAdjustments",
  "products",
  "boms",
  "purchaseRequisitions",
  "mrpRequirementRuns",
  "mrpRequirementLines",
] as const;

const warehouseBoardFields = [
  "productions",
  "productionDeliveryWarnings",
  "productionPlanVersions",
  "productionPlanLines",
  "productionPlanNotifications",
  "requisitions",
  "materialIssues",
  "inspections",
  "materials",
  "batches",
  "inventoryAging",
  "finishedBatches",
  "finishedReceipts",
  "purchaseArrivalNotices",
  "purchaseArrivalDiscrepancies",
  "purchaseOrders",
  "materialIqcInspections",
  "purchaseReceipts",
  "stocktakes",
  "inventoryTrace",
  "inventoryAgingDispositions",
  "productionPlanChangeImpacts",
  "productionMaterialAdjustmentSuggestions",
  "productionMaterialAdjustmentOrders",
  "productionMaterialAdjustmentOrderReviews",
  "productionMaterialAdjustmentReviewExceptions",
  "documentReversalCandidates",
  "documentReversals",
] as const;

const purchasingBoardFields = [
  "materials",
  "batches",
  "suppliers",
  "supplierPerformance",
  "supplierAdmissionControls",
  "supplierCorrectiveActions",
  "supplierReassessments",
  "supplierAdmissionReleases",
  "supplierObservationPeriods",
  "supplierQualificationCertificates",
  "supplierQualificationRequirements",
  "supplierQualificationMatrix",
  "supplierAnnualReviews",
  "supplierAnnualReviewDue",
  "supplierAdmissionRules",
  "supplierAdmissionRuleEvents",
  "supplierAdmissionRuleChangeRequests",
  "purchaseRequisitions",
  "mrpRequirementRuns",
  "mrpRequirementLines",
  "purchaseContracts",
  "purchaseArrivalNotices",
  "purchaseArrivalNoticeChangeLogs",
  "purchaseArrivalDiscrepancies",
  "purchaseOrders",
  "materialIqcInspections",
  "purchaseReceipts",
  "payables",
  "productionPlanNotifications",
  "productionPlanChangeImpacts",
  "documentReversalCandidates",
  "documentReversals",
  "ledgerRedOffsets",
] as const;

const qualityBoardFields = [
  "productions",
  "productionDeliveryWarnings",
  "productionPlanVersions",
  "productionPlanLines",
  "qualityInspectionWindowConfirmations",
  "inspections",
  "productionDailyReports",
  "technicalDispositions",
  "qualityExceptionAnalytics",
  "costAnomalyAnalytics",
  "costAnomalyDrilldowns",
  "costAnomalyRemediations",
  "costAnomalyRemediationReviews",
  "costAnomalyWarningEvents",
  "costAnomalyWarningDashboard",
  "materials",
  "products",
  "boms",
  "materialIqcInspections",
  "purchaseArrivalNotices",
  "purchaseArrivalDiscrepancies",
  "purchaseOrders",
  "productionPlanNotifications",
  "productionPlanChangeImpacts",
] as const;

const financeBoardFields = [
  "quotes",
  "orders",
  "customers",
  "productions",
  "productionCostSummaries",
  "productionCostAdjustments",
  "shipments",
  "salesReturns",
  "salesReturnAllocations",
  "customerRefunds",
  "finishedBatches",
  "finishedShipmentAllocations",
  "inventoryTrace",
  "suppliers",
  "purchaseContracts",
  "purchaseOrders",
  "purchaseReceipts",
  "payables",
  "receivables",
  "costAnomalyAnalytics",
  "costAnomalyDrilldowns",
  "costAnomalyRemediations",
  "costAnomalyRemediationReviews",
  "costAnomalyWarningEvents",
  "costAnomalyWarningDashboard",
  "ledgerRedOffsets",
  "documentReversals",
  "documentReversalCandidates",
  "documentExports",
  "reportSnapshots",
] as const;

const systemBoardFields = [
  "processFlow",
  "processFlowSummary",
  "systemHealthSummary",
  "systemHealthChecks",
  "systemHealthRemediations",
  "systemHealthRemediationReviews",
  "operatingParameters",
  "approvalRules",
  "alertSubscriptions",
  "formulaCalculations",
  "documentSequences",
  "documentCancellations",
  "documentVoidCandidates",
  "documentReversals",
  "documentReversalCandidates",
  "documentAttachments",
  "initializationImports",
  "initializationImportErrors",
  "documentExports",
  "reportSnapshots",
  "systemSettings",
  "systemSettingEffects",
  "loginLogs",
  "auditLogs",
] as const;

function fieldSet(...groups: ReadonlyArray<readonly string[]>) {
  return new Set(groups.flatMap((group) => [...group]));
}

const boardFieldsByRole: Record<ErpRole, Set<string> | "all"> = {
  sales: fieldSet(sharedBoardFields, salesBoardFields),
  assistant: fieldSet(sharedBoardFields, salesBoardFields, [
    "productions",
    "productionScheduleChanges",
    "productionDeliveryWarnings",
    "productionPlanNotifications",
    "productionPlanChangeImpacts",
    "requisitions",
    "finishedReceipts",
  ]),
  production: fieldSet(sharedBoardFields, productionBoardFields),
  warehouse: fieldSet(sharedBoardFields, warehouseBoardFields),
  purchasing: fieldSet(sharedBoardFields, purchasingBoardFields),
  quality: fieldSet(sharedBoardFields, qualityBoardFields),
  technical: fieldSet(sharedBoardFields, qualityBoardFields, ["productionMaterialAdjustmentOrders"]),
  manager: "all",
  finance: fieldSet(sharedBoardFields, financeBoardFields),
  // The existing administrator role still owns operational configuration in
  // this release. Formal business/data administrators will be separated in a
  // later migration; parallel-ledger access is already membership-only.
  admin: "all",
};

const summaryFieldsByRole: Record<ErpRole, Set<string> | "all"> = {
  sales: fieldSet(["orderAmount", "receivableBalance", "pendingTasks", "alertCount"]),
  assistant: fieldSet(["activeProductions", "receivableBalance", "pendingTasks", "alertCount"]),
  production: fieldSet([
    "activeProductions",
    "mrpShortageLineCount",
    "lowYieldWarningCount",
    "qualityExceptionCount",
    "qualityClosureRate",
    "pendingTasks",
    "alertCount",
  ]),
  warehouse: fieldSet([
    "lowStockCount",
    "staleWarningCount",
    "overstockCount",
    "overstockValue",
    "inventoryValue",
    "pendingTasks",
    "alertCount",
  ]),
  purchasing: fieldSet([
    "purchaseAmount",
    "payableBalance",
    "mrpShortageLineCount",
    "mrpShortageAmount",
    "supplierRiskCount",
    "supplierAverageScore",
    "supplierRestrictedCount",
    "supplierCorrectiveOpenCount",
    "supplierCorrectionOverdueCount",
    "supplierReleaseCount",
    "supplierObservationActiveCount",
    "supplierCertificateDueCount",
    "supplierQualificationMissingCount",
    "supplierQualificationBlockingCount",
    "supplierAnnualReviewDueCount",
    "supplierAutoRuleCount",
    "supplierAutoTriggerCount",
    "supplierRuleChangePendingCount",
    "pendingTasks",
    "alertCount",
  ]),
  quality: fieldSet([
    "qualityExceptionCount",
    "qualityClosureRate",
    "lowYieldWarningCount",
    "pendingTasks",
    "alertCount",
  ]),
  technical: fieldSet([
    "qualityExceptionCount",
    "qualityClosureRate",
    "lowYieldWarningCount",
    "pendingTasks",
    "alertCount",
  ]),
  manager: "all",
  finance: fieldSet([
    "orderAmount",
    "purchaseAmount",
    "inventoryValue",
    "receivableBalance",
    "payableBalance",
    "receivedAmount",
    "costAnomalyWarningEventCount",
    "costAnomalyWarningOpenCount",
    "costAnomalyWarningCriticalCount",
    "pendingApprovalCount",
    "approvalOverdueCount",
    "pendingTasks",
    "alertCount",
  ]),
  admin: "all",
};

const chartFieldsByRole: Record<ErpRole, Set<string> | "all"> = {
  sales: fieldSet(["orderFunnel"]),
  assistant: fieldSet(["orderFunnel", "productionStages"]),
  production: fieldSet(["productionStages", "yieldTrend"]),
  warehouse: fieldSet(["inventoryByMaterial", "productionStages"]),
  purchasing: fieldSet(["inventoryByMaterial"]),
  quality: fieldSet(["productionStages", "yieldTrend"]),
  technical: fieldSet(["productionStages", "yieldTrend"]),
  manager: "all",
  finance: fieldSet(["cashPosition", "orderFunnel"]),
  admin: "all",
};

function knownRole(role: string): ErpRole | undefined {
  return role in boardFieldsByRole ? (role as ErpRole) : undefined;
}

function emptyValue(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  if (typeof value === "string") return "";
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as RecordLike).map(([key, nested]) => [key, emptyValue(nested)]));
  }
  return undefined;
}

function restrictRecord<T extends RecordLike>(record: T, allowed: Set<string> | "all"): T {
  if (allowed === "all") return record;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, allowed.has(key) ? value : emptyValue(value)]),
  ) as T;
}

function maskMaterialCosts(board: RecordLike) {
  const materials = Array.isArray(board.materials) ? board.materials : [];
  return {
    ...board,
    materials: materials.map((material) => {
      if (!material || typeof material !== "object") return material;
      const {
        average_cost: _averageCost,
        stock_value: _stockValue,
        payable_balance: _payableBalance,
        ...safeMaterial
      } = material as RecordLike;
      return safeMaterial;
    }),
  };
}

function filterRoleScopedRows(board: RecordLike, currentUser: SnapshotLike["currentUser"]) {
  const role = currentUser.role;
  const remediations = Array.isArray(board.systemHealthRemediations)
    ? board.systemHealthRemediations.filter((row) => {
        if (!row || typeof row !== "object") return false;
        const record = row as RecordLike;
        return record.owner_id === currentUser.id || record.owner_role === role;
      })
    : [];
  const remediationIds = new Set(remediations.map((row) => String((row as RecordLike).id ?? "")));
  const reviews = Array.isArray(board.systemHealthRemediationReviews)
    ? board.systemHealthRemediationReviews.filter((row) => {
        if (!row || typeof row !== "object") return false;
        return remediationIds.has(String((row as RecordLike).remediation_id ?? ""));
      })
    : [];
  const subscriptions = Array.isArray(board.alertSubscriptions)
    ? board.alertSubscriptions.filter((row) => {
        if (!row || typeof row !== "object") return false;
        return String((row as RecordLike).role ?? "") === role;
      })
    : [];
  return {
    ...board,
    systemHealthRemediations: remediations,
    systemHealthRemediationReviews: reviews,
    alertSubscriptions: subscriptions,
  };
}

/**
 * Converts the internal aggregate snapshot into the smallest DTO the current
 * role is allowed to receive. Every omitted domain is returned with an empty
 * shape so the legacy client cannot accidentally infer or render hidden data.
 */
export function authorizeErpSnapshot<T extends SnapshotLike>(snapshot: T): T {
  const role = knownRole(snapshot.currentUser.role);
  const boardPolicy = role ? boardFieldsByRole[role] : new Set<string>();
  const summaryPolicy = role ? summaryFieldsByRole[role] : new Set<string>();
  const chartPolicy = role ? chartFieldsByRole[role] : new Set<string>();
  let board = restrictRecord(snapshot.board, boardPolicy);

  if (role === "sales" || role === "assistant") {
    board = maskMaterialCosts(board) as typeof board;
  }
  if (role && role !== "admin" && role !== "manager") {
    board = filterRoleScopedRows(board, snapshot.currentUser) as typeof board;
  }

  const canAdministerSystem = role === "admin";
  return {
    ...snapshot,
    dataRoot: canAdministerSystem ? snapshot.dataRoot : "",
    users: canAdministerSystem
      ? snapshot.users
      : snapshot.users.filter((user) => user.id === snapshot.currentUser.id),
    summary: restrictRecord(snapshot.summary, summaryPolicy),
    board,
    charts: restrictRecord(snapshot.charts, chartPolicy),
    storage: canAdministerSystem
      ? snapshot.storage
      : (emptyValue(snapshot.storage) as typeof snapshot.storage),
    security: {
      currentPermissions: snapshot.security.currentPermissions,
      rolePermissions: canAdministerSystem ? snapshot.security.rolePermissions : [],
      permissionMatrix: canAdministerSystem ? snapshot.security.permissionMatrix : [],
    },
  };
}
