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

export function captureFormalSnapshot(database: Database.Database, ledgerId: string): { capturedAt: string; count: number } {
  const capturedAt = now();
  const insert = database.prepare(`
    INSERT INTO parallel_entity_snapshots (
      id, ledger_id, entity_type, entity_id, source_row_version, source_updated_at, content_hash, payload_json, captured_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ledger_id, entity_type, entity_id) DO UPDATE SET
      source_row_version = excluded.source_row_version,
      source_updated_at = excluded.source_updated_at,
      content_hash = excluded.content_hash,
      payload_json = excluded.payload_json,
      captured_at = excluded.captured_at
  `);

  const collections: Array<{ entityType: string; rows: Array<Record<string, unknown>> }> = [
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
  ];

  let count = 0;
  for (const collection of collections) {
    for (const captured of capture(database, collection.entityType, collection.rows)) {
      insert.run(
        uid("PES"),
        ledgerId,
        captured.entityType,
        captured.entityId,
        captured.rowVersion,
        captured.updatedAt,
        captured.contentHash,
        captured.payloadJson,
        capturedAt,
      );
      count += 1;
    }
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
