import type { ErpRole } from "./erp-navigation";

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
  return catalog === "all" ? ["*"] : [...catalog].sort();
}
