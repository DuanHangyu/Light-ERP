import type { ErpRole } from "./erp-navigation";

const allReportTypes = [
  "finance",
  "quote",
  "shipment",
  "ledger",
  "delivery-note",
  "sales-statement",
  "purchase-statement",
  "purchase-contract",
  "purchase-arrival-notice",
  "purchase-arrival-change-log",
  "purchase-arrival-discrepancy",
  "warehouse-signoff",
  "purchase-receipt",
  "material-issue",
  "material-adjustment-order",
  "stocktake",
  "production-plan",
  "sales-return",
  "customer-refund",
  "replacement-shipment",
  "inventory-trace",
  "business-daily",
  "inventory-daily",
  "inventory-overstock",
  "supplier-discrepancy",
  "supplier-performance",
  "material-adjustment-cost-impact",
  "cost-anomaly-analysis",
  "quality-exception",
  "business-weekly",
  "business-monthly",
  "master-customers",
  "master-suppliers",
  "master-materials",
  "master-products",
  "master-boms",
  "master-template-customers",
  "master-template-suppliers",
  "master-template-materials",
  "master-template-products",
  "master-template-boms",
  "opening-template-opening-inventory",
  "opening-template-opening-receivables",
  "opening-template-opening-payables",
] as const;

const reportLabels: Partial<Record<(typeof allReportTypes)[number], string>> = {
  finance: "财务经营数据",
  quote: "报价单",
  shipment: "发货单",
  ledger: "应收应付台账",
  "delivery-note": "送货单",
  "sales-statement": "销售对账单",
  "purchase-statement": "采购对账单",
  "purchase-contract": "采购合同",
  "purchase-arrival-notice": "采购到货通知",
  "purchase-arrival-change-log": "采购到货变更记录",
  "purchase-arrival-discrepancy": "采购到货差异单",
  "warehouse-signoff": "仓库签收单",
  "purchase-receipt": "采购入库单",
  "material-issue": "生产领料单",
  "material-adjustment-order": "补退料调整单",
  stocktake: "盘点单",
  "production-plan": "生产计划",
  "sales-return": "销售退货单",
  "customer-refund": "客户退款单",
  "replacement-shipment": "补开发货单",
  "inventory-trace": "库存追溯表",
  "business-daily": "经营日报",
  "inventory-daily": "库存日报",
  "inventory-overstock": "库存积压报表",
  "supplier-discrepancy": "供应商差异分析",
  "supplier-performance": "供应商绩效",
  "material-adjustment-cost-impact": "补退料成本影响",
  "cost-anomaly-analysis": "成本异常分析",
  "quality-exception": "质量异常分析",
  "business-weekly": "经营周报",
  "business-monthly": "经营月报",
  "master-customers": "客户主档",
  "master-suppliers": "供应商主档",
  "master-materials": "物料主档",
  "master-products": "产品主档",
  "master-boms": "BOM 主档",
};

const salesReports = [
  "quote",
  "shipment",
  "delivery-note",
  "sales-statement",
  "business-daily",
  "master-customers",
  "master-products",
  "master-boms",
  "master-template-customers",
  "master-template-products",
  "master-template-boms",
] as const;

const assistantReports = [
  "shipment",
  "delivery-note",
  "sales-statement",
  "warehouse-signoff",
  "sales-return",
  "customer-refund",
  "replacement-shipment",
] as const;

const productionReports = [
  "production-plan",
  "material-adjustment-order",
  "material-adjustment-cost-impact",
  "cost-anomaly-analysis",
  "quality-exception",
  "master-materials",
  "master-products",
  "master-boms",
  "master-template-materials",
  "master-template-products",
  "master-template-boms",
] as const;

const warehouseReports = [
  "warehouse-signoff",
  "purchase-receipt",
  "material-issue",
  "stocktake",
  "inventory-trace",
  "inventory-daily",
  "inventory-overstock",
  "opening-template-opening-inventory",
] as const;

const purchasingReports = [
  "purchase-statement",
  "purchase-contract",
  "purchase-arrival-notice",
  "purchase-arrival-change-log",
  "purchase-arrival-discrepancy",
  "purchase-receipt",
  "supplier-discrepancy",
  "supplier-performance",
  "master-suppliers",
  "master-materials",
  "master-template-suppliers",
  "master-template-materials",
] as const;

const qualityReports = [
  "quality-exception",
  "supplier-discrepancy",
  "supplier-performance",
] as const;

const technicalReports = [
  "quality-exception",
  "material-adjustment-order",
  "master-materials",
  "master-products",
  "master-boms",
  "master-template-materials",
  "master-template-products",
  "master-template-boms",
] as const;

const financeReports = [
  "finance",
  "ledger",
  "sales-statement",
  "purchase-statement",
  "customer-refund",
  "business-daily",
  "business-weekly",
  "business-monthly",
  "material-adjustment-cost-impact",
  "cost-anomaly-analysis",
  "opening-template-opening-receivables",
  "opening-template-opening-payables",
] as const;

const reportTypesByRole: Record<ErpRole, ReadonlySet<string> | "all"> = {
  sales: new Set(salesReports),
  assistant: new Set(assistantReports),
  production: new Set(productionReports),
  warehouse: new Set(warehouseReports),
  purchasing: new Set(purchasingReports),
  quality: new Set(qualityReports),
  technical: new Set(technicalReports),
  manager: "all",
  finance: new Set(financeReports),
  // Kept for backwards-compatible system operations until the formal data
  // administrator role is migrated out of the legacy admin role.
  admin: "all",
};

function knownRole(role: string): ErpRole | undefined {
  return role in reportTypesByRole ? (role as ErpRole) : undefined;
}

export function canExportReport(role: string, reportType: string) {
  const normalizedRole = knownRole(role);
  if (!normalizedRole) return false;
  const catalog = reportTypesByRole[normalizedRole];
  return catalog === "all" || catalog.has(reportType);
}

export function requireReportExportPermission(role: string, reportType: string) {
  if (!canExportReport(role, reportType)) {
    throw new Error(`当前账号无权导出标准报表【${reportType}】。`);
  }
}

export function reportCatalogForRole(role: string): string[] {
  const normalizedRole = knownRole(role);
  if (!normalizedRole) return [];
  const catalog = reportTypesByRole[normalizedRole];
  return catalog === "all" ? [...allReportTypes] : [...catalog].sort();
}

export function reportCatalogEntriesForRole(role: string) {
  return reportCatalogForRole(role).map((code) => ({
    code,
    label: reportLabels[code as keyof typeof reportLabels] ?? code,
  }));
}
