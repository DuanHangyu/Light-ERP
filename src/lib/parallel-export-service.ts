import type Database from "better-sqlite3";
import { buildXlsxBuffer, getUser, now, serial, uid } from "./erp-service";

export const PARALLEL_EXPORT_TYPES = [
  "parallel_inventory",
  "parallel_batches",
  "parallel_material_flow",
  "parallel_diff",
  "parallel_gaps",
  "parallel_order_cost",
  "parallel_product_cost",
  "parallel_adjustments",
] as const;
export type ParallelExportType = (typeof PARALLEL_EXPORT_TYPES)[number];

const TYPE_LABELS: Record<ParallelExportType, string> = {
  parallel_inventory: "平行账套库存汇总",
  parallel_batches: "平行账套批次明细",
  parallel_material_flow: "平行账套物料收发存测算",
  parallel_diff: "平行账套调整前后差异",
  parallel_gaps: "平行账套物料缺口与建议",
  parallel_order_cost: "平行账套工单成本测算",
  parallel_product_cost: "平行账套成品成本变化",
  parallel_adjustments: "平行账套调整明细",
};

function latestRunId(database: Database.Database, ledgerId: string): string | null {
  const row = database.prepare("SELECT id FROM parallel_calculation_runs WHERE ledger_id = ? AND status = 'succeeded' AND stale = 0 ORDER BY created_at DESC LIMIT 1").get(ledgerId) as { id: string } | undefined;
  return row?.id ?? null;
}

function materialName(database: Database.Database, materialId: string): { name: string; unit: string } {
  const row = database.prepare("SELECT name, unit FROM materials WHERE id = ?").get(materialId) as { name: string; unit: string } | undefined;
  return { name: row?.name ?? materialId, unit: row?.unit ?? "" };
}

export function isParallelExportType(type: string): type is ParallelExportType {
  return (PARALLEL_EXPORT_TYPES as readonly string[]).includes(type);
}

export function buildParallelExport(
  database: Database.Database,
  actorId: string,
  ledgerId: string,
  type: ParallelExportType,
): { fileName: string; contentType: string; buffer: Buffer } {
  const user = getUser(database, actorId);
  void user;
  const ledger = database.prepare("SELECT ledger_code, name, working_version, base_as_of FROM parallel_ledgers WHERE id = ?").get(ledgerId) as { ledger_code: string; name: string; working_version: number; base_as_of: string } | undefined;
  if (!ledger) throw new Error("平行账套不存在。");
  const runId = latestRunId(database, ledgerId);
  if (!runId) throw new Error("该账套尚无测算结果，请先重新测算后再导出。");

  const sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }> = [];
  const stamp = (row: Record<string, unknown>): Record<string, unknown> => ({ 账套编码: ledger.ledger_code, 账套名称: ledger.name, 基准日期: ledger.base_as_of, 版本: `v${ledger.working_version}`, 数据来源: "平行账套/测算数据", 导出时间: now(), ...row });

  switch (type) {
    case "parallel_inventory": {
      const rows = database.prepare("SELECT material_id, quantity, unit_cost, inventory_value FROM parallel_inventory_projections WHERE run_id = ? ORDER BY material_id").all(runId) as Array<Record<string, unknown>>;
      sheets.push({ name: TYPE_LABELS[type], rows: rows.map((r) => stamp({ 物料ID: r.material_id, 物料名称: materialName(database, String(r.material_id)).name, 测算数量: r.quantity, 测算均价: r.unit_cost, 库存价值: r.inventory_value })) });
      break;
    }
    case "parallel_batches": {
      const rows = database.prepare("SELECT requirement_material_id AS material_id, batch_id, allocated_qty, unit_cost, allocation_type FROM parallel_material_allocations WHERE run_id = ? ORDER BY requirement_material_id").all(runId) as Array<Record<string, unknown>>;
      sheets.push({ name: TYPE_LABELS[type], rows: rows.map((r) => stamp({ 物料ID: r.material_id, 物料名称: materialName(database, String(r.material_id)).name, 批次: r.batch_id, 分配数量: r.allocated_qty, 单位成本: r.unit_cost, 分配类型: r.allocation_type })) });
      break;
    }
    case "parallel_diff": {
      const rows = database.prepare("SELECT production_order_id, product_id, material_cost, total_cost, unit_cost FROM parallel_cost_projections WHERE run_id = ? ORDER BY production_order_id").all(runId) as Array<Record<string, unknown>>;
      const baselineRows = database.prepare("SELECT entity_id, payload_json FROM parallel_entity_snapshots WHERE ledger_id = ? AND entity_type = 'production_order'").all(ledgerId) as Array<{ entity_id: string; payload_json: string }>;
      sheets.push({ name: TYPE_LABELS[type], rows: rows.map((r) => stamp({ 工单ID: r.production_order_id, 产品ID: r.product_id, 测算材料成本: r.material_cost, 测算总成本: r.total_cost, 测算单位成本: r.unit_cost, 基准工单数: baselineRows.length })) });
      break;
    }
    case "parallel_gaps": {
      const rows = database.prepare("SELECT material_id, required_qty, available_qty, shortage_qty, resolution_status FROM parallel_gaps WHERE run_id = ? ORDER BY shortage_qty DESC").all(runId) as Array<Record<string, unknown>>;
      const suggestions = database.prepare("SELECT gap_id, suggestion_type, status, payload_json FROM parallel_suggestions WHERE ledger_id = ?").all(ledgerId) as Array<{ gap_id: string; suggestion_type: string; status: string; payload_json: string }>;
      sheets.push({ name: TYPE_LABELS[type], rows: rows.map((r) => stamp({ 物料ID: r.material_id, 物料名称: materialName(database, String(r.material_id ?? "")).name, 需求量: r.required_qty, 可用量: r.available_qty, 缺口量: r.shortage_qty, 处理状态: r.resolution_status, 建议数: suggestions.filter((s) => s.gap_id).length })) });
      break;
    }
    case "parallel_order_cost":
    case "parallel_product_cost": {
      const rows = database.prepare("SELECT production_order_id, product_id, material_cost, processing_cost, total_cost, finished_qty, unit_cost, yield_rate FROM parallel_cost_projections WHERE run_id = ? ORDER BY production_order_id").all(runId) as Array<Record<string, unknown>>;
      sheets.push({ name: TYPE_LABELS[type], rows: rows.map((r) => stamp({ 工单ID: r.production_order_id, 产品ID: r.product_id, 材料成本: r.material_cost, 加工费: r.processing_cost, 总成本: r.total_cost, 合格量: r.finished_qty, 单位成本: r.unit_cost, 收率: r.yield_rate })) });
      break;
    }
    case "parallel_adjustments": {
      const rows = database.prepare("SELECT adjustment_no, adjustment_type, effective_at, reason, status FROM parallel_adjustments WHERE ledger_id = ? ORDER BY created_at").all(ledgerId) as Array<Record<string, unknown>>;
      sheets.push({ name: TYPE_LABELS[type], rows: rows.map((r) => stamp({ 调整单号: r.adjustment_no, 调整类型: r.adjustment_type, 生效日期: r.effective_at, 原因: r.reason, 状态: r.status })) });
      break;
    }
    case "parallel_material_flow": {
      const inv = database.prepare("SELECT material_id, quantity, unit_cost, inventory_value FROM parallel_inventory_projections WHERE run_id = ? ORDER BY material_id").all(runId) as Array<Record<string, unknown>>;
      sheets.push({ name: TYPE_LABELS[type], rows: inv.map((r) => stamp({ 物料ID: r.material_id, 物料名称: materialName(database, String(r.material_id)).name, 期末数量: r.quantity, 期末均价: r.unit_cost, 期末价值: r.inventory_value })) });
      break;
    }
  }

  const fileBase = `parallel-${type}-${ledger.ledger_code}-v${ledger.working_version}-${new Date().toISOString().slice(0, 10)}`;
  const fileName = `${fileBase}.xlsx`;
  const docId = uid("DOC");
  const docNo = serial(database, "document_exports", "DJ");
  database.prepare("INSERT INTO document_exports (id, document_no, type, entity_type, entity_id, file_name, actor_id, created_at, ledger_type, ledger_id, ledger_version) VALUES (?, ?, ?, 'parallel_ledger', ?, ?, ?, ?, 'parallel', ?, ?)").run(docId, docNo, type, ledgerId, fileName, actorId, now(), ledgerId, ledger.working_version);
  return { fileName, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: buildXlsxBuffer(sheets) };
}
