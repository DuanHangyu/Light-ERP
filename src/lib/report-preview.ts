type Row = Record<string, unknown>;

export type ReportPreviewType =
  | "business-daily"
  | "business-weekly"
  | "business-monthly"
  | "inventory-overstock"
  | "sales-statement"
  | "purchase-statement"
  | "supplier-performance"
  | "supplier-discrepancy"
  | "material-adjustment-cost-impact"
  | "quality-exception";

export type ReportPreview = {
  header: {
    companyName: string;
    title: string;
    documentNo: string;
    documentDate: string;
    periodText: string;
    filterSummary: string;
    generatedBy: string;
    statusText: string;
  };
  kpis: Array<{ label: string; value: string }>;
  sections: Array<{
    title: string;
    columns: Array<{ key: string; label: string }>;
    rows: Array<Record<string, string>>;
  }>;
  notes: string[];
  signatures: Array<{ label: string; hint: string }>;
};

type ReportPreviewInput = {
  type: ReportPreviewType;
  generatedBy: string;
  generatedAt?: string;
  companyName?: string;
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    customerName?: string;
    supplierName?: string;
    materialName?: string;
    orderNo?: string;
    purchaseNo?: string;
  };
  summary: {
    orderAmount?: number;
    purchaseAmount?: number;
    inventoryValue?: number;
    receivableBalance?: number;
    payableBalance?: number;
    receivedAmount?: number;
    overstockValue?: number;
    averageYield?: number;
    qualityInspectionCount?: number;
    qualityFailedCount?: number;
    qualityReinspectionCount?: number;
    qualityClosedCount?: number;
    qualityClosureRate?: number;
    supplierDiscrepancyCount?: number;
    supplierDiscrepancyResolvedCount?: number;
    supplierDiscrepancyPendingCount?: number;
    supplierDiscrepancyAdjustmentAmount?: number;
    supplierDiscrepancyResolutionRate?: number;
    supplierAverageScore?: number;
    supplierRiskCount?: number;
    materialAdjustmentCount?: number;
    materialAdjustmentPendingReviewCount?: number;
    materialAdjustmentCostImpactAmount?: number;
    materialAdjustmentInventoryDelta?: number;
  };
  rows: {
    receivables?: Row[];
    payables?: Row[];
    inventoryAging?: Row[];
    qualityExceptions?: Row[];
    qualityRootCauses?: Row[];
    qualityDispositionTypes?: Row[];
    supplierPerformance?: Row[];
    supplierDiscrepancies?: Row[];
    supplierDiscrepancyDetails?: Row[];
    materialAdjustments?: Row[];
  };
};

function text(value: unknown, fallback = "-") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function dateText(value: unknown) {
  const result = text(value, "");
  return result ? result.slice(0, 10) : "-";
}

function moneyText(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "¥0.00";
  return `¥${number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function qtyText(value: unknown, unit?: unknown) {
  const number = Number(value ?? 0);
  const qty = Number.isFinite(number) ? number.toLocaleString("zh-CN", { maximumFractionDigits: 3 }) : "0";
  const suffix = text(unit, "");
  return suffix ? `${qty} ${suffix}` : qty;
}

function percentText(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0.00%";
  return `${number.toFixed(2)}%`;
}

function reportTitle(type: ReportPreviewType) {
  return (
    {
      "business-daily": "经营日报",
      "business-weekly": "经营周报",
      "business-monthly": "经营月报",
      "inventory-overstock": "库存积压报表",
      "sales-statement": "销售对账单",
      "purchase-statement": "采购对账单",
      "supplier-performance": "供应商绩效评分报表",
      "supplier-discrepancy": "供应商差异统计报表",
      "material-adjustment-cost-impact": "补退料成本影响报表",
      "quality-exception": "质量异常分析报表",
    }[type] ?? type
  );
}

function reportNo(type: ReportPreviewType, generatedAt: string) {
  const datePart = dateText(generatedAt).replaceAll("-", "");
  const typePart = type.toUpperCase().replaceAll("-", "_");
  return `RPT-${typePart}-${datePart}`;
}

function filterSummary(filters: ReportPreviewInput["filters"]) {
  const parts: string[] = [];
  if (filters?.dateFrom || filters?.dateTo) parts.push(`日期：${filters.dateFrom || "不限"} 至 ${filters.dateTo || "不限"}`);
  if (filters?.customerName) parts.push(`客户：${filters.customerName}`);
  if (filters?.supplierName) parts.push(`供应商：${filters.supplierName}`);
  if (filters?.materialName) parts.push(`物料：${filters.materialName}`);
  if (filters?.orderNo) parts.push(`订单：${filters.orderNo}`);
  if (filters?.purchaseNo) parts.push(`采购单：${filters.purchaseNo}`);
  return parts.length > 0 ? parts.join("；") : "全部数据";
}

function commonKpis(input: ReportPreviewInput) {
  return [
    { label: "订单额", value: moneyText(input.summary.orderAmount) },
    { label: "采购额", value: moneyText(input.summary.purchaseAmount) },
    { label: "库存总值", value: moneyText(input.summary.inventoryValue) },
    { label: "应收余额", value: moneyText(input.summary.receivableBalance) },
    { label: "应付余额", value: moneyText(input.summary.payableBalance) },
    { label: "已回款", value: moneyText(input.summary.receivedAmount) },
    { label: "积压金额", value: moneyText(input.summary.overstockValue) },
    { label: "平均收率", value: percentText(input.summary.averageYield) },
    { label: "检验单数", value: text(input.summary.qualityInspectionCount ?? 0, "0") },
    { label: "不合格次数", value: text(input.summary.qualityFailedCount ?? 0, "0") },
    { label: "复检次数", value: text(input.summary.qualityReinspectionCount ?? 0, "0") },
    { label: "关闭数量", value: text(input.summary.qualityClosedCount ?? 0, "0") },
    { label: "复检关闭率", value: percentText(input.summary.qualityClosureRate) },
  ];
}

function supplierDiscrepancyKpis(input: ReportPreviewInput) {
  const summaryRows = input.rows.supplierDiscrepancies ?? [];
  const discrepancyCount =
    input.summary.supplierDiscrepancyCount ?? summaryRows.reduce((sum, row) => sum + Number(row.discrepancy_count ?? 0), 0);
  const resolvedCount =
    input.summary.supplierDiscrepancyResolvedCount ?? summaryRows.reduce((sum, row) => sum + Number(row.resolved_count ?? 0), 0);
  const pendingCount =
    input.summary.supplierDiscrepancyPendingCount ?? summaryRows.reduce((sum, row) => sum + Number(row.pending_count ?? 0), 0);
  const adjustmentAmount =
    input.summary.supplierDiscrepancyAdjustmentAmount ??
    summaryRows.reduce((sum, row) => sum + Number(row.total_adjustment_amount ?? 0), 0);
  const resolutionRate =
    input.summary.supplierDiscrepancyResolutionRate ?? (discrepancyCount > 0 ? (resolvedCount / discrepancyCount) * 100 : 0);
  return [
    { label: "差异单数", value: text(discrepancyCount, "0") },
    { label: "处理完成", value: text(resolvedCount, "0") },
    { label: "待处理", value: text(pendingCount, "0") },
    { label: "差异金额", value: moneyText(adjustmentAmount) },
    { label: "处理完成率", value: percentText(resolutionRate) },
  ];
}

function supplierPerformanceKpis(input: ReportPreviewInput) {
  const rows = input.rows.supplierPerformance ?? [];
  const averageScore =
    input.summary.supplierAverageScore ??
    (rows.length ? rows.reduce((sum, row) => sum + Number(row.performance_score ?? 0), 0) / rows.length : 0);
  const riskCount =
    input.summary.supplierRiskCount ?? rows.filter((row) => String(row.risk_level ?? "") === "high").length;
  return [
    { label: "供应商数量", value: text(rows.length, "0") },
    { label: "平均评分", value: Number(averageScore).toFixed(2) },
    { label: "高风险供应商", value: text(riskCount, "0") },
  ];
}

function materialAdjustmentKpis(input: ReportPreviewInput) {
  const rows = input.rows.materialAdjustments ?? [];
  const pendingReview =
    input.summary.materialAdjustmentPendingReviewCount ??
    rows.filter((row) => String(row.review_status ?? "") === "pending_review").length;
  const costImpact =
    input.summary.materialAdjustmentCostImpactAmount ??
    rows.reduce((sum, row) => sum + Number(row.cost_impact_amount ?? 0), 0);
  const inventoryDelta =
    input.summary.materialAdjustmentInventoryDelta ??
    rows.reduce((sum, row) => sum + Number(row.inventory_value_delta ?? 0), 0);
  return [
    { label: "补退料单数", value: text(input.summary.materialAdjustmentCount ?? rows.length, "0") },
    { label: "待复核单数", value: text(pendingReview, "0") },
    { label: "成本影响", value: moneyText(costImpact) },
    { label: "库存价值变动", value: moneyText(inventoryDelta) },
  ];
}

function receivableRows(rows: Row[]) {
  return rows.map((row) => ({
    receivableNo: text(row.receivable_no),
    customer: text(row.customer_name ?? row.customer),
    orderNo: text(row.order_no),
    shipmentNo: text(row.shipment_no, ""),
    totalAmount: moneyText(row.total_amount),
    receivedAmount: moneyText(row.received_amount),
    balanceAmount: moneyText(row.balance_amount),
    status: ledgerStatus(text(row.status)),
    dueDate: dateText(row.due_date),
  }));
}

function payableRows(rows: Row[]) {
  return rows.map((row) => ({
    payableNo: text(row.payable_no),
    supplier: text(row.supplier_name ?? row.supplier),
    purchaseNo: text(row.purchase_no),
    totalAmount: moneyText(row.total_amount),
    paidAmount: moneyText(row.paid_amount),
    balanceAmount: moneyText(row.balance_amount),
    status: ledgerStatus(text(row.status)),
    dueDate: dateText(row.due_date),
  }));
}

function inventoryRows(rows: Row[]) {
  return rows.map((row) => ({
    materialName: text(row.name ?? row.material_name),
    stockQty: qtyText(row.stock_qty, row.unit),
    averageCost: moneyText(row.average_cost),
    stockValue: moneyText(row.stock_value),
    inactiveDays: `${text(row.inactive_days, "0")} 天`,
    agingStatus: agingStatusText(text(row.aging_status)),
    lastMovementAt: dateText(row.last_movement_at),
  }));
}

function qualityExceptionRows(rows: Row[]) {
  return rows.map((row) => ({
    dispositionNo: text(row.disposition_no),
    inspectionNo: text(row.inspection_no),
    prodNo: text(row.prod_no),
    productName: text(row.product_name),
    customerName: text(row.customer_name),
    dispositionType: text(row.disposition_type_label ?? row.disposition_type),
    rootCause: text(row.root_cause),
    correctiveAction: text(row.corrective_action),
    status: text(row.status_label ?? row.status),
    dueDate: dateText(row.due_date),
    closedAt: dateText(row.closed_at),
    reinspectionCount: text(row.reinspection_count ?? 0, "0"),
  }));
}

function qualityRootCauseRows(rows: Row[]) {
  return rows.map((row) => ({
    rootCause: text(row.root_cause),
    count: text(row.count ?? 0, "0"),
    closedCount: text(row.closed_count ?? 0, "0"),
    openCount: text(row.open_count ?? 0, "0"),
    closureRate: percentText(row.closure_rate),
  }));
}

function qualityDispositionRows(rows: Row[]) {
  return rows.map((row) => ({
    dispositionType: text(row.disposition_type_label ?? row.disposition_type),
    count: text(row.count ?? 0, "0"),
    closedCount: text(row.closed_count ?? 0, "0"),
    closureRate: percentText(row.closure_rate),
  }));
}

function supplierDiscrepancySummaryRows(rows: Row[]) {
  return rows.map((row) => ({
    supplier: text(row.supplier_name ?? row.supplier),
    discrepancyCount: text(row.discrepancy_count ?? 0, "0"),
    resolvedCount: text(row.resolved_count ?? 0, "0"),
    pendingCount: text(row.pending_count ?? 0, "0"),
    quantityVarianceQty: qtyText(row.quantity_variance_qty),
    priceVarianceAmount: moneyText(row.price_variance_amount),
    totalAdjustmentAmount: moneyText(row.total_adjustment_amount),
    resolutionRate: percentText(row.resolution_rate),
  }));
}

function supplierDiscrepancyDetailRows(rows: Row[]) {
  return rows.map((row) => ({
    discrepancyNo: text(row.discrepancy_no),
    arrivalNo: text(row.arrival_no),
    purchaseNo: text(row.purchase_no),
    supplier: text(row.supplier_name ?? row.supplier),
    discrepancyType: text(row.discrepancy_type_label ?? row.discrepancy_type),
    handlingDecision: text(row.handling_decision_label ?? row.handling_decision),
    quantityVarianceQty: qtyText(row.quantity_variance_qty),
    priceVarianceAmount: moneyText(row.price_variance_amount),
    totalAdjustmentAmount: moneyText(row.total_adjustment_amount),
    status: text(row.status_label ?? row.status),
  }));
}

function supplierPerformanceRows(rows: Row[]) {
  return rows.map((row) => ({
    supplier: text(row.supplier_name ?? row.supplier),
    score: Number(row.performance_score ?? 0).toFixed(2),
    grade: text(row.grade_label ?? row.grade),
    riskLevel: text(row.risk_level_label ?? row.risk_level),
    purchaseOrderCount: text(row.purchase_order_count ?? 0, "0"),
    onTimeDeliveryRate: percentText(row.on_time_delivery_rate),
    iqcPassRate: percentText(row.iqc_pass_rate),
    discrepancyRate: percentText(row.discrepancy_rate),
    overduePayableCount: text(row.overdue_payable_count ?? 0, "0"),
    totalAdjustmentAmount: moneyText(row.total_adjustment_amount),
    recommendation: text(row.recommendation, ""),
  }));
}

function materialAdjustmentRows(rows: Row[]) {
  return rows.map((row) => ({
    orderNo: text(row.order_no),
    reviewNo: text(row.review_no, ""),
    suggestionNo: text(row.suggestion_no),
    prodNo: text(row.prod_no),
    requisitionNo: text(row.req_no, ""),
    customerOrderNo: text(row.customer_order_no),
    customerName: text(row.customer_name),
    productName: text(row.product_name),
    adjustmentType: text(row.adjustment_type_label ?? row.adjustment_type),
    qty: qtyText(row.qty),
    costImpactAmount: moneyText(row.cost_impact_amount),
    inventoryValueDelta: moneyText(row.inventory_value_delta),
    reviewStatus: text(row.review_status_label ?? row.review_status),
    reviewResult: text(row.review_result_label ?? row.review_result, ""),
    reviewedBy: text(row.reviewed_by_name, ""),
    executedAt: dateText(row.executed_at),
  }));
}

function ledgerStatus(status: string) {
  return (
    {
      paid: "已结清",
      partial: "部分结清",
      unpaid: "未结清",
    }[status] ?? status
  );
}

function agingStatusText(status: string) {
  return (
    {
      stale_warning: "呆滞预警",
      overstock: "积压库存",
      normal: "正常",
    }[status] ?? status
  );
}

function salesColumns() {
  return [
    { key: "receivableNo", label: "应收单号" },
    { key: "customer", label: "客户" },
    { key: "orderNo", label: "销售订单" },
    { key: "shipmentNo", label: "发货单" },
    { key: "totalAmount", label: "应收金额" },
    { key: "receivedAmount", label: "已收金额" },
    { key: "balanceAmount", label: "未收余额" },
    { key: "status", label: "状态" },
    { key: "dueDate", label: "到期日" },
  ];
}

function purchaseColumns() {
  return [
    { key: "payableNo", label: "应付单号" },
    { key: "supplier", label: "供应商" },
    { key: "purchaseNo", label: "采购单" },
    { key: "totalAmount", label: "应付金额" },
    { key: "paidAmount", label: "已付金额" },
    { key: "balanceAmount", label: "未付余额" },
    { key: "status", label: "状态" },
    { key: "dueDate", label: "到期日" },
  ];
}

function inventoryColumns() {
  return [
    { key: "materialName", label: "物料" },
    { key: "stockQty", label: "库存" },
    { key: "averageCost", label: "移动均价" },
    { key: "stockValue", label: "库存价值" },
    { key: "inactiveDays", label: "未动天数" },
    { key: "agingStatus", label: "库龄状态" },
    { key: "lastMovementAt", label: "最近变动" },
  ];
}

function qualityRootCauseColumns() {
  return [
    { key: "rootCause", label: "不合格原因" },
    { key: "count", label: "发生次数" },
    { key: "closedCount", label: "已关闭" },
    { key: "openCount", label: "未关闭" },
    { key: "closureRate", label: "关闭率" },
  ];
}

function qualityDispositionColumns() {
  return [
    { key: "dispositionType", label: "处理方式" },
    { key: "count", label: "数量" },
    { key: "closedCount", label: "已关闭" },
    { key: "closureRate", label: "关闭率" },
  ];
}

function qualityExceptionColumns() {
  return [
    { key: "dispositionNo", label: "处置单号" },
    { key: "inspectionNo", label: "请验单" },
    { key: "prodNo", label: "生产单" },
    { key: "productName", label: "产品" },
    { key: "customerName", label: "客户" },
    { key: "dispositionType", label: "处理方式" },
    { key: "rootCause", label: "原因分析" },
    { key: "status", label: "状态" },
    { key: "reinspectionCount", label: "复检次数" },
  ];
}

function supplierDiscrepancySummaryColumns() {
  return [
    { key: "supplier", label: "供应商" },
    { key: "discrepancyCount", label: "差异单数" },
    { key: "resolvedCount", label: "已处理" },
    { key: "pendingCount", label: "待处理" },
    { key: "quantityVarianceQty", label: "数量差异" },
    { key: "priceVarianceAmount", label: "价格差异" },
    { key: "totalAdjustmentAmount", label: "影响金额" },
    { key: "resolutionRate", label: "处理完成率" },
  ];
}

function supplierDiscrepancyDetailColumns() {
  return [
    { key: "discrepancyNo", label: "差异单号" },
    { key: "arrivalNo", label: "到货通知" },
    { key: "purchaseNo", label: "采购单" },
    { key: "supplier", label: "供应商" },
    { key: "discrepancyType", label: "差异类型" },
    { key: "handlingDecision", label: "处理方式" },
    { key: "quantityVarianceQty", label: "数量差异" },
    { key: "totalAdjustmentAmount", label: "影响金额" },
    { key: "status", label: "状态" },
  ];
}

function supplierPerformanceColumns() {
  return [
    { key: "supplier", label: "供应商" },
    { key: "score", label: "绩效评分" },
    { key: "grade", label: "等级" },
    { key: "riskLevel", label: "风险等级" },
    { key: "purchaseOrderCount", label: "采购单数" },
    { key: "onTimeDeliveryRate", label: "到货准时率" },
    { key: "iqcPassRate", label: "IQC合格率" },
    { key: "discrepancyRate", label: "到货差异率" },
    { key: "overduePayableCount", label: "应付逾期" },
    { key: "totalAdjustmentAmount", label: "差异金额" },
    { key: "recommendation", label: "采购建议" },
  ];
}

function materialAdjustmentColumns() {
  return [
    { key: "orderNo", label: "补退料单" },
    { key: "reviewNo", label: "复核单" },
    { key: "prodNo", label: "生产单" },
    { key: "requisitionNo", label: "领料单" },
    { key: "customerOrderNo", label: "销售订单" },
    { key: "customerName", label: "客户" },
    { key: "productName", label: "产品" },
    { key: "adjustmentType", label: "类型" },
    { key: "qty", label: "数量" },
    { key: "costImpactAmount", label: "成本影响" },
    { key: "inventoryValueDelta", label: "库存价值变动" },
    { key: "reviewStatus", label: "复核状态" },
    { key: "reviewResult", label: "复核结果" },
    { key: "executedAt", label: "执行日期" },
  ];
}

function previewNotes(type: ReportPreviewType) {
  const base = [
    "本报表由系统根据当前本地数据库自动生成，适用于内部经营复盘、对账确认和纸质归档。",
    "如报表带筛选条件，封面筛选条件即为本次统计口径，导出与打印应保持一致。",
  ];
  if (type === "inventory-overstock") {
    return [
      ...base,
      "库存规则：3 个月未发生变动列为呆滞预警；6 个月未发生变动列为积压库存并纳入积压报表。",
    ];
  }
  if (type === "sales-statement") {
    return [...base, "销售对账以发货和应收账款为依据，客户确认后可作为后续回款跟进资料。"];
  }
  if (type === "purchase-statement") {
    return [...base, "采购对账以采购入库和应付账款为依据，供应商确认后可作为付款申请资料。"];
  }
  if (type === "supplier-discrepancy") {
    return [
      ...base,
      "供应商差异统计以到货差异单为依据，按供应商汇总数量差异、价格差异、影响金额和处理完成率。",
      "差异处理方式包括补货、退货、折让、特采或按实接收，可用于供应商绩效复盘和采购谈判。",
    ];
  }
  if (type === "supplier-performance") {
    return [
      ...base,
      "供应商绩效评分按到货准时率、IQC合格率、到货差异率、应付逾期和差异金额综合计算。",
      "高风险供应商建议暂停新增采购或缩小订单规模，整改完成后再恢复正常合作。",
    ];
  }
  if (type === "quality-exception") {
    return [
      ...base,
      "质量异常分析以不合格请验单、技术处置意见和复检关闭状态为依据，重点查看原因分布、处置方式和复检关闭率。",
      "未关闭异常应纳入质量会议跟进，已关闭异常保留技术意见、复检记录和责任闭环。",
    ];
  }
  if (type === "material-adjustment-cost-impact") {
    return [
      ...base,
      "补退料成本影响报表以正式补料、退料执行明细为依据，展示生产成本增加或冲减、库存价值变动和仓库复核状态。",
      "待复核单据应由仓库核对执行批次、库存反向流水、移动均价和生产工单成本归集后再归档。",
    ];
  }
  return [...base, "经营类报表用于管理层查看订单、采购、库存、应收应付、回款和质量收率的综合情况。"];
}

export function buildReportPreview(input: ReportPreviewInput): ReportPreview {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const title = reportTitle(input.type);
  const receivables = receivableRows(input.rows.receivables ?? []);
  const payables = payableRows(input.rows.payables ?? []);
  const inventory = inventoryRows(input.rows.inventoryAging ?? []);
  const qualityExceptions = qualityExceptionRows(input.rows.qualityExceptions ?? []);
  const qualityRootCauses = qualityRootCauseRows(input.rows.qualityRootCauses ?? []);
  const qualityDispositionTypes = qualityDispositionRows(input.rows.qualityDispositionTypes ?? []);
  const supplierPerformance = supplierPerformanceRows(input.rows.supplierPerformance ?? []);
  const supplierDiscrepancies = supplierDiscrepancySummaryRows(input.rows.supplierDiscrepancies ?? []);
  const supplierDiscrepancyDetails = supplierDiscrepancyDetailRows(input.rows.supplierDiscrepancyDetails ?? []);
  const materialAdjustments = materialAdjustmentRows(input.rows.materialAdjustments ?? []);
  const sections: ReportPreview["sections"] = [];

  if (input.type === "sales-statement") {
    sections.push({ title: "销售对账明细", columns: salesColumns(), rows: receivables });
  } else if (input.type === "purchase-statement") {
    sections.push({ title: "采购对账明细", columns: purchaseColumns(), rows: payables });
  } else if (input.type === "inventory-overstock") {
    sections.push({ title: "呆滞与积压库存明细", columns: inventoryColumns(), rows: inventory });
  } else if (input.type === "quality-exception") {
    sections.push({ title: "不合格原因分布", columns: qualityRootCauseColumns(), rows: qualityRootCauses });
    sections.push({ title: "处置方式统计", columns: qualityDispositionColumns(), rows: qualityDispositionTypes });
    sections.push({ title: "质量异常明细", columns: qualityExceptionColumns(), rows: qualityExceptions });
  } else if (input.type === "supplier-discrepancy") {
    sections.push({ title: "供应商差异统计", columns: supplierDiscrepancySummaryColumns(), rows: supplierDiscrepancies });
    sections.push({ title: "到货差异明细", columns: supplierDiscrepancyDetailColumns(), rows: supplierDiscrepancyDetails });
  } else if (input.type === "supplier-performance") {
    sections.push({ title: "供应商绩效评分", columns: supplierPerformanceColumns(), rows: supplierPerformance });
  } else if (input.type === "material-adjustment-cost-impact") {
    sections.push({ title: "补退料成本影响明细", columns: materialAdjustmentColumns(), rows: materialAdjustments });
  } else {
    sections.push({ title: "应收账款摘要", columns: salesColumns(), rows: receivables.slice(0, 8) });
    sections.push({ title: "应付账款摘要", columns: purchaseColumns(), rows: payables.slice(0, 8) });
    sections.push({ title: "经营风险与待跟进", columns: inventoryColumns(), rows: inventory.slice(0, 8) });
  }

  return {
    header: {
      companyName: input.companyName ?? "本地化生产流转 ERP",
      title,
      documentNo: reportNo(input.type, generatedAt),
      documentDate: dateText(generatedAt),
      periodText: input.filters?.dateFrom || input.filters?.dateTo ? `${input.filters.dateFrom || "不限"} 至 ${input.filters.dateTo || "不限"}` : "当前数据",
      filterSummary: filterSummary(input.filters),
      generatedBy: input.generatedBy,
      statusText: "正式预览",
    },
    kpis:
      input.type === "supplier-discrepancy"
        ? supplierDiscrepancyKpis(input)
        : input.type === "supplier-performance"
          ? supplierPerformanceKpis(input)
          : input.type === "material-adjustment-cost-impact"
            ? materialAdjustmentKpis(input)
            : commonKpis(input),
    sections,
    notes: previewNotes(input.type),
    signatures: [
      { label: "编制", hint: input.generatedBy },
      { label: "财务复核", hint: "应收/应付/金额" },
      { label: "业务确认", hint: "订单/库存/交付" },
      { label: "管理层", hint: "审批/归档" },
    ],
  };
}
