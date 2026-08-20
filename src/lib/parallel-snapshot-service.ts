import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { now, uid } from "./erp-service";

export type SnapshotPreview = {
  orderCount: number;
  productionOrderCount: number;
  materialCount: number;
  batchCount: number;
  requisitionCount: number;
  requisitionLineCount: number;
  finishedBatchCount: number;
  receivableCount: number;
  payableCount: number;
  bomCount: number;
  bomLineCount: number;
  estimatedSnapshotRows: number;
  hasUnfinishedBusiness: boolean;
};

type CapturedEntity = {
  entityType: string;
  entityId: string;
  rowVersion: number;
  updatedAt: string | null;
  contentHash: string;
  payloadJson: string;
};

function hashRow(row: Record<string, unknown>): string {
  const stable = JSON.stringify(
    Object.keys(row)
      .sort()
      .reduce((acc, key) => {
        acc[key] = row[key];
        return acc;
      }, {} as Record<string, unknown>),
  );
  return crypto.createHash("sha256").update(stable, "utf8").digest("hex");
}

function capture(database: Database.Database, entityType: string, rows: Array<Record<string, unknown>>): CapturedEntity[] {
  return rows.map((row) => {
    const id = String(row.id ?? "");
    return {
      entityType,
      entityId: id,
      rowVersion: Number((row as { row_version?: number }).row_version ?? 0),
      updatedAt: (row.updated_at as string | null | undefined) ?? (row.created_at as string | null | undefined) ?? null,
      contentHash: hashRow(row),
      payloadJson: JSON.stringify(row),
    };
  });
}

function upsertCapturedEntities(
  database: Database.Database,
  ledgerId: string,
  entities: CapturedEntity[],
  capturedAt: string,
) {
  const insert = database.prepare(`
    INSERT INTO parallel_entity_snapshots (
      id, ledger_id, entity_type, entity_id, source_row_version, source_updated_at, content_hash, payload_json, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ledger_id, entity_type, entity_id) DO UPDATE SET
      source_row_version = excluded.source_row_version,
      source_updated_at = excluded.source_updated_at,
      content_hash = excluded.content_hash,
      payload_json = excluded.payload_json,
      captured_at = excluded.captured_at
  `);
  for (const entity of entities) {
    insert.run(uid("PES"), ledgerId, entity.entityType, entity.entityId, entity.rowVersion, entity.updatedAt, entity.contentHash, entity.payloadJson, capturedAt);
  }
}

export function ensureMaterialSnapshot(database: Database.Database, ledgerId: string, materialId: string) {
  const material = database.prepare("SELECT * FROM materials WHERE id = ? AND status = 'active'").get(materialId) as Record<string, unknown> | undefined;
  if (!material) throw new Error(`调整引用了不存在或已停用的物料：${materialId}`);
  const batches = database.prepare("SELECT * FROM material_batches WHERE material_id = ?").all(materialId) as Array<Record<string, unknown>>;
  const capturedAt = now();
  upsertCapturedEntities(database, ledgerId, [
    ...capture(database, "material", [material]),
    ...capture(database, "material_batch", batches),
  ], capturedAt);
}

export function previewSnapshot(database: Database.Database): SnapshotPreview {
  const orderCount = (database.prepare("SELECT COUNT(*) AS c FROM orders").get() as { c: number }).c;
  const productionOrderCount = (database.prepare("SELECT COUNT(*) AS c FROM production_orders").get() as { c: number }).c;
  const materialCount = (database.prepare("SELECT COUNT(*) AS c FROM materials WHERE status='active'").get() as { c: number }).c;
  const batchCount = (database.prepare("SELECT COUNT(*) AS c FROM material_batches").get() as { c: number }).c;
  const requisitionCount = (database.prepare("SELECT COUNT(*) AS c FROM requisitions").get() as { c: number }).c;
  const requisitionLineCount = (database.prepare("SELECT COUNT(*) AS c FROM requisition_lines").get() as { c: number }).c;
  const finishedBatchCount = (database.prepare("SELECT COUNT(*) AS c FROM finished_batches").get() as { c: number }).c;
  const receivableCount = (database.prepare("SELECT COUNT(*) AS c FROM receivables").get() as { c: number }).c;
  const payableCount = (database.prepare("SELECT COUNT(*) AS c FROM payables").get() as { c: number }).c;
  const bomCount = (database.prepare("SELECT COUNT(*) AS c FROM boms WHERE status='active'").get() as { c: number }).c;
  const bomLineCount = (database.prepare("SELECT COUNT(*) AS c FROM bom_lines").get() as { c: number }).c;
  const estimatedSnapshotRows =
    orderCount + productionOrderCount + materialCount + batchCount + requisitionCount + requisitionLineCount + finishedBatchCount + receivableCount + payableCount + bomCount + bomLineCount;
  const hasUnfinishedBusiness =
    (database.prepare("SELECT COUNT(*) AS c FROM production_orders WHERE status NOT IN ('shipped','cancelled','voided')").get() as { c: number }).c > 0;
  return {
    orderCount,
    productionOrderCount,
    materialCount,
    batchCount,
    requisitionCount,
    requisitionLineCount,
    finishedBatchCount,
    receivableCount,
    payableCount,
    bomCount,
    bomLineCount,
    estimatedSnapshotRows,
    hasUnfinishedBusiness,
  };
}

type SnapshotCollection = { entityType: string; rows: Array<Record<string, unknown>> };

function rowId(row: Record<string, unknown>, key = "id") {
  return String(row[key] ?? "");
}

function scopedCollections(
  database: Database.Database,
  ledgerId: string,
  collections: SnapshotCollection[],
): SnapshotCollection[] {
  const ledger = database.prepare("SELECT scope_type FROM parallel_ledgers WHERE id = ?").get(ledgerId) as
    | { scope_type: string }
    | undefined;
  if (!ledger) throw new Error("平行账套不存在，无法生成基准快照。");
  if (ledger.scope_type === "company") return collections;

  const scopes = database
    .prepare("SELECT scope_entity_type, scope_entity_id FROM parallel_ledger_scopes WHERE ledger_id = ?")
    .all(ledgerId) as Array<{ scope_entity_type: string; scope_entity_id: string }>;
  if (scopes.length === 0) throw new Error("指定范围的平行账套必须选择至少一个业务对象。");

  const all = new Map(collections.map((collection) => [collection.entityType, collection.rows]));
  const materialIds = new Set<string>();
  const productIds = new Set<string>();
  const bomIds = new Set<string>();
  const quoteIds = new Set<string>();
  const orderIds = new Set<string>();
  const productionOrderIds = new Set<string>();
  const requisitionIds = new Set<string>();
  const finishedBatchIds = new Set<string>();
  const receivableIds = new Set<string>();
  const payableIds = new Set<string>();

  for (const scope of scopes) {
    if (scope.scope_entity_type === "material") materialIds.add(scope.scope_entity_id);
    if (scope.scope_entity_type === "product") productIds.add(scope.scope_entity_id);
    if (scope.scope_entity_type === "order") orderIds.add(scope.scope_entity_id);
    if (scope.scope_entity_type === "production_order") productionOrderIds.add(scope.scope_entity_id);
  }

  const orders = all.get("order") ?? [];
  const productionOrders = all.get("production_order") ?? [];
  const boms = all.get("bom") ?? [];
  const bomLines = all.get("bom_line") ?? [];
  const requisitions = all.get("requisition") ?? [];
  const requisitionLines = all.get("requisition_line") ?? [];
  const finishedBatches = all.get("finished_batch") ?? [];
  const receivables = all.get("receivable") ?? [];

  // A material/product scope means "all affected business". Order and work-order
  // scopes remain narrow and only pull their own dependency closure.
  if (ledger.scope_type === "material") {
    for (const line of bomLines) {
      if (materialIds.has(rowId(line, "component_id"))) productIds.add(rowId(line, "parent_product_id"));
    }
  }
  if (["material", "product"].includes(ledger.scope_type)) {
    for (const order of orders) {
      if (productIds.has(rowId(order, "product_id"))) orderIds.add(rowId(order));
    }
  }
  if (["material", "product", "order"].includes(ledger.scope_type)) {
    for (const productionOrder of productionOrders) {
      if (orderIds.has(rowId(productionOrder, "order_id"))) productionOrderIds.add(rowId(productionOrder));
    }
  }

  for (const productionOrder of productionOrders) {
    if (productionOrderIds.has(rowId(productionOrder))) orderIds.add(rowId(productionOrder, "order_id"));
  }
  for (const order of orders) {
    if (!orderIds.has(rowId(order))) continue;
    productIds.add(rowId(order, "product_id"));
    const quoteId = rowId(order, "quote_id");
    if (quoteId) quoteIds.add(quoteId);
  }

  // Recursively close multi-level BOM dependencies.
  let changed = true;
  while (changed) {
    const previousSize = productIds.size + materialIds.size + bomIds.size;
    for (const bom of boms) {
      if (productIds.has(rowId(bom, "product_id"))) bomIds.add(rowId(bom));
    }
    for (const line of bomLines) {
      if (!productIds.has(rowId(line, "parent_product_id")) && !bomIds.has(rowId(line, "bom_id"))) continue;
      if (rowId(line, "component_type") === "product") productIds.add(rowId(line, "component_id"));
      else materialIds.add(rowId(line, "component_id"));
    }
    changed = previousSize !== productIds.size + materialIds.size + bomIds.size;
  }

  for (const requisition of requisitions) {
    if (productionOrderIds.has(rowId(requisition, "production_order_id"))) requisitionIds.add(rowId(requisition));
  }
  for (const batch of finishedBatches) {
    if (productionOrderIds.has(rowId(batch, "production_order_id"))) finishedBatchIds.add(rowId(batch));
  }
  for (const receivable of receivables) {
    if (orderIds.has(rowId(receivable, "order_id"))) receivableIds.add(rowId(receivable));
  }

  const selected = (entityType: string, row: Record<string, unknown>) => {
    switch (entityType) {
      case "material": return materialIds.has(rowId(row));
      case "material_batch": return materialIds.has(rowId(row, "material_id"));
      case "product": return productIds.has(rowId(row));
      case "bom": return bomIds.has(rowId(row));
      case "bom_line": return bomIds.has(rowId(row, "bom_id")) || productIds.has(rowId(row, "parent_product_id"));
      case "quote": return quoteIds.has(rowId(row));
      case "order": return orderIds.has(rowId(row));
      case "production_order": return productionOrderIds.has(rowId(row));
      case "requisition": return requisitionIds.has(rowId(row));
      case "requisition_line": return requisitionIds.has(rowId(row, "requisition_id"));
      case "finished_batch": return finishedBatchIds.has(rowId(row));
      case "receivable": return receivableIds.has(rowId(row));
      case "payable": return payableIds.has(rowId(row));
      default: return false;
    }
  };

  return collections.map((collection) => ({
    ...collection,
    rows: collection.rows.filter((row) => selected(collection.entityType, row)),
  }));
}

export function captureFormalSnapshot(database: Database.Database, ledgerId: string): { capturedAt: string; count: number } {
  const capturedAt = now();

  const collections = scopedCollections(database, ledgerId, [
    { entityType: "material", rows: database.prepare("SELECT * FROM materials WHERE status='active'").all() as Array<Record<string, unknown>> },
    { entityType: "material_batch", rows: database.prepare("SELECT * FROM material_batches").all() as Array<Record<string, unknown>> },
    { entityType: "product", rows: database.prepare("SELECT * FROM products WHERE status='active'").all() as Array<Record<string, unknown>> },
    { entityType: "bom", rows: database.prepare("SELECT * FROM boms WHERE status='active'").all() as Array<Record<string, unknown>> },
    { entityType: "bom_line", rows: database.prepare("SELECT * FROM bom_lines").all() as Array<Record<string, unknown>> },
    { entityType: "quote", rows: database.prepare("SELECT * FROM quotes").all() as Array<Record<string, unknown>> },
    { entityType: "order", rows: database.prepare("SELECT * FROM orders").all() as Array<Record<string, unknown>> },
    { entityType: "production_order", rows: database.prepare("SELECT * FROM production_orders").all() as Array<Record<string, unknown>> },
    { entityType: "requisition", rows: database.prepare("SELECT * FROM requisitions").all() as Array<Record<string, unknown>> },
    { entityType: "requisition_line", rows: database.prepare("SELECT * FROM requisition_lines").all() as Array<Record<string, unknown>> },
    { entityType: "finished_batch", rows: database.prepare("SELECT * FROM finished_batches").all() as Array<Record<string, unknown>> },
    { entityType: "receivable", rows: database.prepare("SELECT * FROM receivables").all() as Array<Record<string, unknown>> },
    { entityType: "payable", rows: database.prepare("SELECT * FROM payables").all() as Array<Record<string, unknown>> },
  ]);

  let count = 0;
  for (const collection of collections) {
    const captured = capture(database, collection.entityType, collection.rows);
    upsertCapturedEntities(database, ledgerId, captured, capturedAt);
    count += captured.length;
  }
  return { capturedAt, count };
}

export type SnapshotStore = {
  materials: Array<Record<string, unknown>>;
  materialBatches: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  boms: Array<Record<string, unknown>>;
  bomLines: Array<Record<string, unknown>>;
  quotes: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  productionOrders: Array<Record<string, unknown>>;
  requisitions: Array<Record<string, unknown>>;
  requisitionLines: Array<Record<string, unknown>>;
  finishedBatches: Array<Record<string, unknown>>;
  receivables: Array<Record<string, unknown>>;
  payables: Array<Record<string, unknown>>;
};

export function loadSnapshotStore(database: Database.Database, ledgerId: string): SnapshotStore {
  const rows = database
    .prepare("SELECT entity_type, payload_json FROM parallel_entity_snapshots WHERE ledger_id = ?")
    .all(ledgerId) as Array<{ entity_type: string; payload_json: string }>;
  const store: SnapshotStore = {
    materials: [],
    materialBatches: [],
    products: [],
    boms: [],
    bomLines: [],
    quotes: [],
    orders: [],
    productionOrders: [],
    requisitions: [],
    requisitionLines: [],
    finishedBatches: [],
    receivables: [],
    payables: [],
  };
  const bucketMap: Record<string, keyof SnapshotStore> = {
    material: "materials",
    material_batch: "materialBatches",
    product: "products",
    bom: "boms",
    bom_line: "bomLines",
    quote: "quotes",
    order: "orders",
    production_order: "productionOrders",
    requisition: "requisitions",
    requisition_line: "requisitionLines",
    finished_batch: "finishedBatches",
    receivable: "receivables",
    payable: "payables",
  };
  for (const row of rows) {
    const bucket = bucketMap[row.entity_type];
    if (bucket) {
      store[bucket].push(JSON.parse(row.payload_json) as Record<string, unknown>);
    }
  }
  return store;
}
