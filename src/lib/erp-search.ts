import { isModuleAccessible, type ModuleKey } from "./erp-navigation";

type SearchRow = Record<string, unknown>;

export type ErpSearchSources = {
  quotes: SearchRow[];
  orders: SearchRow[];
  customers: SearchRow[];
  productions: SearchRow[];
  materials: SearchRow[];
  products: SearchRow[];
  suppliers: SearchRow[];
  purchaseOrders: SearchRow[];
  requisitions: SearchRow[];
  shipments: SearchRow[];
  receivables: SearchRow[];
  payables: SearchRow[];
};

export type ErpSearchResult = {
  id: string;
  type: string;
  primary: string;
  secondary: string;
  module: ModuleKey;
  row: SearchRow;
};

type SearchDefinition = {
  source: keyof ErpSearchSources;
  type: string;
  module: ModuleKey;
  primary: string[];
  secondary: string[];
  searchable: string[];
};

const searchDefinitions: SearchDefinition[] = [
  { source: "quotes", type: "报价单", module: "sales", primary: ["quote_no"], secondary: ["customer_name", "product_name"], searchable: ["quote_no", "customer_name", "product_name"] },
  { source: "orders", type: "销售订单", module: "sales", primary: ["order_no"], secondary: ["customer_name", "product_name"], searchable: ["order_no", "customer_name", "product_name", "customer_po_no"] },
  { source: "customers", type: "客户", module: "master", primary: ["name"], secondary: ["customer_code", "contact"], searchable: ["name", "customer_code", "contact"] },
  { source: "productions", type: "生产单", module: "production", primary: ["prod_no"], secondary: ["product_name", "order_no"], searchable: ["prod_no", "product_name", "order_no", "customer_name"] },
  { source: "materials", type: "物料", module: "master", primary: ["name"], secondary: ["material_code"], searchable: ["name", "material_code", "spec"] },
  { source: "products", type: "产品", module: "master", primary: ["name"], secondary: ["product_code"], searchable: ["name", "product_code", "spec"] },
  { source: "suppliers", type: "供应商", module: "suppliers", primary: ["name"], secondary: ["supplier_code", "contact"], searchable: ["name", "supplier_code", "contact"] },
  { source: "purchaseOrders", type: "采购单", module: "purchase", primary: ["purchase_no"], secondary: ["supplier_name"], searchable: ["purchase_no", "supplier_name", "supplier_code"] },
  { source: "requisitions", type: "领料单", module: "production", primary: ["req_no"], secondary: ["prod_no", "order_no"], searchable: ["req_no", "prod_no", "order_no"] },
  { source: "shipments", type: "发货单", module: "sales", primary: ["shipment_no"], secondary: ["order_no", "customer_name"], searchable: ["shipment_no", "order_no", "customer_name"] },
  { source: "receivables", type: "应收", module: "finance", primary: ["receivable_no"], secondary: ["customer_name", "order_no"], searchable: ["receivable_no", "customer_name", "order_no"] },
  { source: "payables", type: "应付", module: "finance", primary: ["payable_no"], secondary: ["supplier_name", "purchase_no"], searchable: ["payable_no", "supplier_name", "purchase_no"] },
];

function firstValue(row: SearchRow, keys: string[]): string {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "-";
}

export function searchErpEntities(
  role: string,
  sources: ErpSearchSources,
  query: string,
  limit = 8,
): ErpSearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  if (normalizedQuery.length < 2 || limit <= 0) return [];

  const results: ErpSearchResult[] = [];
  for (const definition of searchDefinitions) {
    if (!isModuleAccessible(role, definition.module)) continue;
    for (const row of sources[definition.source] ?? []) {
      const haystack = definition.searchable
        .map((key) => String(row[key] ?? ""))
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      if (!haystack.includes(normalizedQuery)) continue;
      results.push({
        id: String(row.id ?? `${definition.source}-${results.length}`),
        type: definition.type,
        primary: firstValue(row, definition.primary),
        secondary: firstValue(row, definition.secondary),
        module: definition.module,
        row,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}
