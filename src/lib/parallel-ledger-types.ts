import type Database from "better-sqlite3";

export type ParallelLedgerStatus =
  | "creating"
  | "draft"
  | "calculating"
  | "calculation_failed"
  | "ready"
  | "frozen"
  | "merge_pending"
  | "merge_rejected"
  | "conflicted"
  | "publishing"
  | "merged"
  | "archived"
  | "discarded";

export type AdjustmentType =
  | "material_substitute"
  | "bom_ratio"
  | "purchase_price"
  | "purchase_qty"
  | "inventory_qty"
  | "batch_adjust"
  | "issue_qty"
  | "production_qty"
  | "effective_date"
  | "process_fee_loss";

export type ImpactDomain =
  | "inventory"
  | "purchase"
  | "bom"
  | "production"
  | "cost"
  | "quality_yield"
  | "delivery"
  | "receivable_payable";

export type ImpactSeverity = "info" | "warning" | "critical" | "blocking";

export type SuggestionType =
  | "purchase_requisition"
  | "purchase_order_change"
  | "bom_change"
  | "replenish"
  | "return_material"
  | "stock_gain_loss"
  | "batch_adjust"
  | "order_cost_adjust"
  | "product_cost_adjust"
  | "delivery_date_change";

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  material_substitute: "物料替换",
  bom_ratio: "配方比例调整",
  purchase_price: "采购价格调整",
  purchase_qty: "采购数量调整",
  inventory_qty: "库存数量调整",
  batch_adjust: "批次调整",
  issue_qty: "领料数量调整",
  production_qty: "工单产量调整",
  effective_date: "业务生效日期调整",
  process_fee_loss: "加工费或损耗率调整",
};

export const LEDGER_STATUS_LABELS: Record<ParallelLedgerStatus, string> = {
  creating: "创建中",
  draft: "草稿",
  calculating: "计算中",
  calculation_failed: "计算失败",
  ready: "测算完成",
  frozen: "已冻结",
  merge_pending: "合并审批中",
  merge_rejected: "合并已驳回",
  conflicted: "存在冲突",
  publishing: "发布中",
  merged: "已合并",
  archived: "已归档",
  discarded: "已放弃",
};

export type ScopeEntityType = "company" | "warehouse" | "product" | "order" | "production_order" | "material";

export type ParallelLedgerRow = {
  id: string;
  ledger_code: string;
  name: string;
  purpose: string;
  base_ledger_id: string;
  base_as_of: string;
  base_revision: string | null;
  scope_type: string;
  status: ParallelLedgerStatus;
  working_version: number;
  engine_version: string | null;
  merge_allowed: number;
  owner_user_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  frozen_at: string | null;
  merged_at: string | null;
  archived_at: string | null;
  row_version: number;
};

export type ParallelAdjustmentRow = {
  id: string;
  adjustment_no: string;
  ledger_id: string;
  ledger_version: number;
  adjustment_type: AdjustmentType;
  effective_at: string;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ParallelAdjustmentLineRow = {
  id: string;
  adjustment_id: string;
  entity_type: string;
  entity_id: string;
  field_code: string;
  before_value: string | null;
  after_value: string | null;
  delta_value: string | null;
  source_material_id: string | null;
  target_material_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  remark: string;
};

export type ParallelCalculationRunRow = {
  id: string;
  ledger_id: string;
  ledger_version: number;
  engine_version: string;
  input_hash: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  summary_json: string;
  created_at: string;
  stale: number;
};

export type ParallelInventoryProjectionRow = {
  id: string;
  run_id: string;
  ledger_id: string;
  warehouse_id: string | null;
  material_id: string;
  batch_id: string | null;
  batch_no: string | null;
  quantity: number;
  unit_cost: number;
  inventory_value: number;
  last_movement_at: string | null;
  projection_status: string;
};

export type ParallelCostProjectionRow = {
  id: string;
  run_id: string;
  production_order_id: string;
  product_id: string;
  material_cost: number;
  processing_cost: number;
  other_cost: number;
  total_cost: number;
  finished_qty: number;
  unit_cost: number;
  yield_rate: number;
};

export type ParallelImpactRow = {
  id: string;
  run_id: string;
  domain: ImpactDomain;
  severity: ImpactSeverity;
  blocking: number;
  entity_type: string | null;
  entity_id: string | null;
  before_value: string | null;
  after_value: string | null;
  delta_value: string | null;
  message: string;
  source_adjustment_id: string | null;
};

export type ParallelGapRow = {
  id: string;
  run_id: string;
  gap_type: string;
  material_id: string | null;
  required_qty: number;
  available_qty: number;
  shortage_qty: number;
  required_date: string | null;
  blocking: number;
  resolution_status: string;
  selected_suggestion_id: string | null;
};

export type ParallelSuggestionRow = {
  id: string;
  gap_id: string;
  ledger_id: string;
  suggestion_type: SuggestionType;
  document_type: string;
  payload_json: string;
  status: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
};

export type SnapshotEntityCollector = {
  entityType: string;
  rows: Array<{ id: string; row_version?: number; updated_at?: string | null } & Record<string, unknown>>;
};

export type ParallelActionInput = {
  database: Database.Database;
  actorId: string;
  ledgerId?: string;
  payload?: Record<string, unknown>;
};

export const PARALLEL_ENGINE_VERSION = "parallel-engine-1.0";

export const PARALLEL_ROLES: string[] = ["manager", "admin", "finance"];
