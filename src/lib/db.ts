import Database from "better-sqlite3";
import { calculateMovingAverage, roundMoney } from "./domain";
import { ensureDataDirs } from "./paths";
import { hashPassword } from "./security";

let db: Database.Database | undefined;

export function getDb() {
  if (!db) {
    const paths = ensureDataDirs();
    db = new Database(paths.database);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    applyMigrations(db);
    initializeDatabase(db);
  }
  return db;
}

function seedMode() {
  return process.env.ERP_SEED_MODE === "production" ? "production" : "demo";
}

function applySchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      role_label TEXT NOT NULL,
      password TEXT NOT NULL,
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      password_changed_at TEXT,
      title TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      action_label TEXT NOT NULL,
      module_label TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_by TEXT REFERENCES users(id),
      updated_at TEXT NOT NULL,
      UNIQUE(role, action)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      customer_code TEXT,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      address TEXT,
      tax_no TEXT,
      remark TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      material_code TEXT,
      name TEXT NOT NULL,
      spec TEXT,
      unit TEXT NOT NULL,
      stock_qty REAL NOT NULL DEFAULT 0,
      average_cost REAL NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'raw',
      reorder_min_qty REAL NOT NULL DEFAULT 0,
      last_movement_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      remark TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      supplier_code TEXT,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT,
      tax_no TEXT,
      payment_terms TEXT NOT NULL,
      status TEXT NOT NULL,
      remark TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS material_batches (
      id TEXT PRIMARY KEY,
      material_id TEXT NOT NULL REFERENCES materials(id),
      batch_no TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      received_at TEXT NOT NULL,
      last_movement_at TEXT,
      status TEXT NOT NULL DEFAULT 'available'
    );

    CREATE TABLE IF NOT EXISTS material_substitutes (
      material_id TEXT NOT NULL REFERENCES materials(id),
      substitute_id TEXT NOT NULL REFERENCES materials(id),
      note TEXT NOT NULL,
      PRIMARY KEY (material_id, substitute_id)
    );

    CREATE TABLE IF NOT EXISTS purchase_requisitions (
      id TEXT PRIMARY KEY,
      requisition_no TEXT NOT NULL,
      source_type TEXT NOT NULL,
      requested_by TEXT NOT NULL REFERENCES users(id),
      approval_request_id TEXT REFERENCES approval_requests(id),
      source_document_type TEXT,
      source_document_id TEXT,
      status TEXT NOT NULL,
      total_amount REAL NOT NULL,
      required_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      approved_by TEXT REFERENCES users(id),
      approved_at TEXT,
      approval_note TEXT NOT NULL DEFAULT '',
      converted_order_id TEXT REFERENCES purchase_orders(id),
      converted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
      id TEXT PRIMARY KEY,
      purchase_requisition_id TEXT NOT NULL REFERENCES purchase_requisitions(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      requested_qty REAL NOT NULL,
      estimated_unit_cost REAL NOT NULL,
      line_amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS mrp_requirement_runs (
      id TEXT PRIMARY KEY,
      run_no TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_document_id TEXT,
      horizon_date TEXT NOT NULL,
      status TEXT NOT NULL,
      line_count INTEGER NOT NULL DEFAULT 0,
      shortage_line_count INTEGER NOT NULL DEFAULT 0,
      total_gross_qty REAL NOT NULL DEFAULT 0,
      total_shortage_qty REAL NOT NULL DEFAULT 0,
      total_shortage_amount REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      generated_by TEXT NOT NULL REFERENCES users(id),
      generated_at TEXT NOT NULL,
      converted_requisition_id TEXT REFERENCES purchase_requisitions(id),
      converted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS mrp_requirement_lines (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES mrp_requirement_runs(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      required_qty REAL NOT NULL,
      available_qty REAL NOT NULL,
      safety_stock_qty REAL NOT NULL DEFAULT 0,
      incoming_purchase_qty REAL NOT NULL DEFAULT 0,
      planned_requisition_qty REAL NOT NULL DEFAULT 0,
      net_shortage_qty REAL NOT NULL,
      suggested_purchase_qty REAL NOT NULL,
      estimated_unit_cost REAL NOT NULL,
      line_amount REAL NOT NULL,
      source_summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      purchase_no TEXT NOT NULL,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      approval_request_id TEXT REFERENCES approval_requests(id),
      source_requisition_id TEXT REFERENCES purchase_requisitions(id),
      status TEXT NOT NULL,
      total_amount REAL NOT NULL,
      due_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      received_at TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      line_amount REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_contracts (
      id TEXT PRIMARY KEY,
      contract_no TEXT NOT NULL,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      supplier_order_no TEXT NOT NULL DEFAULT '',
      contract_date TEXT NOT NULL,
      delivery_date TEXT NOT NULL,
      payment_terms TEXT NOT NULL DEFAULT '',
      total_amount REAL NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      supplier_confirmed_at TEXT,
      UNIQUE(purchase_order_id)
    );

    CREATE TABLE IF NOT EXISTS purchase_arrival_notices (
      id TEXT PRIMARY KEY,
      arrival_no TEXT NOT NULL,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
      purchase_contract_id TEXT REFERENCES purchase_contracts(id),
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      status TEXT NOT NULL,
      arrived_at TEXT NOT NULL,
      line_count INTEGER NOT NULL DEFAULT 0,
      total_arrived_qty REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      warehouse_received_by TEXT REFERENCES users(id),
      warehouse_received_at TEXT,
      warehouse_note TEXT NOT NULL DEFAULT '',
      iqc_id TEXT REFERENCES material_iqc_inspections(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_arrival_notice_lines (
      id TEXT PRIMARY KEY,
      arrival_notice_id TEXT NOT NULL REFERENCES purchase_arrival_notices(id),
      purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      ordered_qty REAL NOT NULL,
      arrived_qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      line_amount REAL NOT NULL,
      batch_hint TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS purchase_arrival_discrepancies (
      id TEXT PRIMARY KEY,
      discrepancy_no TEXT NOT NULL,
      arrival_notice_id TEXT NOT NULL REFERENCES purchase_arrival_notices(id),
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
      purchase_contract_id TEXT REFERENCES purchase_contracts(id),
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      approval_request_id TEXT REFERENCES approval_requests(id),
      discrepancy_type TEXT NOT NULL,
      handling_decision TEXT NOT NULL,
      status TEXT NOT NULL,
      line_count INTEGER NOT NULL DEFAULT 0,
      quantity_variance_qty REAL NOT NULL DEFAULT 0,
      price_variance_amount REAL NOT NULL DEFAULT 0,
      total_adjustment_amount REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      proposed_action TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      approved_by TEXT REFERENCES users(id),
      approved_at TEXT,
      approval_note TEXT NOT NULL DEFAULT '',
      resolved_by TEXT REFERENCES users(id),
      resolved_at TEXT,
      resolution_result TEXT NOT NULL DEFAULT '',
      resolution_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS purchase_arrival_discrepancy_lines (
      id TEXT PRIMARY KEY,
      discrepancy_id TEXT NOT NULL REFERENCES purchase_arrival_discrepancies(id),
      arrival_notice_line_id TEXT NOT NULL REFERENCES purchase_arrival_notice_lines(id),
      purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      ordered_qty REAL NOT NULL,
      actual_arrived_qty REAL NOT NULL,
      variance_qty REAL NOT NULL,
      ordered_unit_cost REAL NOT NULL,
      actual_unit_cost REAL NOT NULL,
      price_variance_amount REAL NOT NULL,
      expected_batch_hint TEXT NOT NULL DEFAULT '',
      actual_batch_hint TEXT NOT NULL DEFAULT '',
      line_adjustment_amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS material_iqc_inspections (
      id TEXT PRIMARY KEY,
      iqc_no TEXT NOT NULL,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      status TEXT NOT NULL,
      result TEXT,
      arrival_no TEXT NOT NULL DEFAULT '',
      arrived_at TEXT NOT NULL,
      due_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      inspected_by TEXT REFERENCES users(id),
      inspected_at TEXT,
      inspection_standard TEXT NOT NULL DEFAULT '',
      measurements TEXT NOT NULL DEFAULT '',
      disposition_note TEXT NOT NULL DEFAULT '',
      discount_rate REAL NOT NULL DEFAULT 0,
      accepted_amount REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS material_iqc_lines (
      id TEXT PRIMARY KEY,
      iqc_id TEXT NOT NULL REFERENCES material_iqc_inspections(id),
      purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      ordered_qty REAL NOT NULL,
      received_qty REAL NOT NULL,
      accepted_qty REAL NOT NULL DEFAULT 0,
      rejected_qty REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL,
      accepted_unit_cost REAL NOT NULL,
      line_amount REAL NOT NULL,
      batch_no TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      product_code TEXT,
      name TEXT NOT NULL,
      spec TEXT,
      unit TEXT NOT NULL,
      process_fee REAL NOT NULL,
      default_margin REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      remark TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS boms (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      remark TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS bom_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bom_id TEXT NOT NULL REFERENCES boms(id),
      parent_product_id TEXT NOT NULL,
      component_type TEXT NOT NULL,
      component_id TEXT NOT NULL,
      qty_per REAL NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      quote_no TEXT NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      qty REAL NOT NULL,
      version INTEGER NOT NULL,
      material_cost REAL NOT NULL,
      process_fee REAL NOT NULL,
      margin_rate REAL NOT NULL,
      total_amount REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL,
      quote_id TEXT NOT NULL REFERENCES quotes(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      qty REAL NOT NULL,
      due_date TEXT NOT NULL,
      special_requirements TEXT NOT NULL,
      customer_po_no TEXT NOT NULL DEFAULT '',
      sales_contract_no TEXT NOT NULL DEFAULT '',
      delivery_address TEXT NOT NULL DEFAULT '',
      consignee TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      payment_terms_days INTEGER NOT NULL DEFAULT 30,
      remark TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_orders (
      id TEXT PRIMARY KEY,
      prod_no TEXT NOT NULL,
      order_id TEXT NOT NULL REFERENCES orders(id),
      priority TEXT NOT NULL DEFAULT 'normal',
      instruction_note TEXT NOT NULL DEFAULT '',
      technical_requirements TEXT NOT NULL DEFAULT '',
      issued_by TEXT REFERENCES users(id),
      issued_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      planned_date TEXT NOT NULL,
      machine TEXT NOT NULL,
      owner TEXT NOT NULL,
      shift TEXT NOT NULL DEFAULT '',
      schedule_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_schedule_changes (
      id TEXT PRIMARY KEY,
      schedule_id TEXT REFERENCES schedules(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      old_planned_date TEXT,
      new_planned_date TEXT NOT NULL,
      old_machine TEXT,
      new_machine TEXT NOT NULL,
      old_owner TEXT,
      new_owner TEXT NOT NULL,
      old_shift TEXT,
      new_shift TEXT NOT NULL DEFAULT '',
      old_schedule_note TEXT,
      new_schedule_note TEXT NOT NULL DEFAULT '',
      change_reason TEXT NOT NULL,
      changed_by TEXT REFERENCES users(id),
      changed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_plan_versions (
      id TEXT PRIMARY KEY,
      plan_no TEXT NOT NULL,
      version_no INTEGER NOT NULL,
      status TEXT NOT NULL,
      filter_summary TEXT NOT NULL DEFAULT '',
      filters_json TEXT NOT NULL DEFAULT '{}',
      note TEXT NOT NULL DEFAULT '',
      production_count INTEGER NOT NULL DEFAULT 0,
      machine_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      approval_request_id TEXT REFERENCES approval_requests(id),
      locked_by TEXT NOT NULL REFERENCES users(id),
      locked_at TEXT NOT NULL,
      published_by TEXT REFERENCES users(id),
      published_at TEXT,
      approval_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_plan_lines (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES production_plan_versions(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      schedule_id TEXT REFERENCES schedules(id),
      prod_no TEXT NOT NULL,
      order_no TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      planned_date TEXT NOT NULL,
      due_date TEXT NOT NULL DEFAULT '',
      machine TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      shift TEXT NOT NULL DEFAULT '',
      order_qty REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      delivery_risk_status TEXT NOT NULL DEFAULT 'normal',
      delivery_risk_label TEXT NOT NULL DEFAULT '正常',
      schedule_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_plan_notifications (
      id TEXT PRIMARY KEY,
      notification_no TEXT NOT NULL,
      plan_id TEXT NOT NULL REFERENCES production_plan_versions(id),
      schedule_change_id TEXT NOT NULL REFERENCES production_schedule_changes(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      recipient_role TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      acknowledged_by TEXT REFERENCES users(id),
      acknowledged_at TEXT,
      acknowledge_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_plan_change_impacts (
      id TEXT PRIMARY KEY,
      impact_no TEXT NOT NULL,
      plan_id TEXT NOT NULL REFERENCES production_plan_versions(id),
      schedule_change_id TEXT NOT NULL REFERENCES production_schedule_changes(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      impact_type TEXT NOT NULL,
      affected_role TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      summary TEXT NOT NULL,
      suggested_action TEXT NOT NULL DEFAULT '',
      source_document_type TEXT NOT NULL DEFAULT '',
      source_document_id TEXT,
      source_document_no TEXT NOT NULL DEFAULT '',
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      linked_document_type TEXT NOT NULL DEFAULT '',
      linked_document_id TEXT,
      linked_document_no TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      resolved_by TEXT REFERENCES users(id),
      resolved_at TEXT,
      resolution_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_material_adjustment_suggestions (
      id TEXT PRIMARY KEY,
      suggestion_no TEXT NOT NULL,
      impact_id TEXT NOT NULL REFERENCES production_plan_change_impacts(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      requisition_id TEXT REFERENCES requisitions(id),
      adjustment_type TEXT NOT NULL,
      suggested_qty REAL NOT NULL DEFAULT 0,
      material_summary TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      confirmed_by TEXT REFERENCES users(id),
      confirmed_at TEXT,
      confirmation_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_material_adjustment_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL,
      suggestion_id TEXT NOT NULL REFERENCES production_material_adjustment_suggestions(id),
      impact_id TEXT NOT NULL REFERENCES production_plan_change_impacts(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      requisition_id TEXT REFERENCES requisitions(id),
      adjustment_type TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      material_summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      executed_by TEXT REFERENCES users(id),
      executed_at TEXT,
      execution_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_material_adjustment_order_lines (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES production_material_adjustment_orders(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      batch_id TEXT REFERENCES material_batches(id),
      batch_no TEXT NOT NULL,
      direction TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      line_amount REAL NOT NULL,
      movement_id TEXT NOT NULL REFERENCES inventory_movements(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_material_adjustment_order_reviews (
      id TEXT PRIMARY KEY,
      review_no TEXT NOT NULL,
      order_id TEXT NOT NULL REFERENCES production_material_adjustment_orders(id),
      review_result TEXT NOT NULL,
      review_note TEXT NOT NULL DEFAULT '',
      cost_impact_amount REAL NOT NULL DEFAULT 0,
      inventory_value_delta REAL NOT NULL DEFAULT 0,
      reviewed_by TEXT NOT NULL REFERENCES users(id),
      reviewed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_material_adjustment_review_exceptions (
      id TEXT PRIMARY KEY,
      exception_no TEXT NOT NULL,
      review_id TEXT NOT NULL REFERENCES production_material_adjustment_order_reviews(id),
      order_id TEXT NOT NULL REFERENCES production_material_adjustment_orders(id),
      reason_type TEXT NOT NULL,
      exception_description TEXT NOT NULL DEFAULT '',
      owner_role TEXT NOT NULL,
      status TEXT NOT NULL,
      due_date TEXT NOT NULL DEFAULT '',
      cost_adjustment_amount REAL NOT NULL DEFAULT 0,
      resolution_type TEXT NOT NULL DEFAULT '',
      resolution_note TEXT NOT NULL DEFAULT '',
      final_cost_adjustment_amount REAL NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      resolved_by TEXT REFERENCES users(id),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS quality_inspection_window_confirmations (
      id TEXT PRIMARY KEY,
      window_no TEXT NOT NULL,
      impact_id TEXT NOT NULL REFERENCES production_plan_change_impacts(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      inspection_id TEXT REFERENCES inspections(id),
      inspection_window_date TEXT NOT NULL,
      inspector TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_delivery_confirmations (
      id TEXT PRIMARY KEY,
      confirmation_no TEXT NOT NULL,
      impact_id TEXT NOT NULL REFERENCES production_plan_change_impacts(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      original_due_date TEXT NOT NULL,
      proposed_delivery_date TEXT NOT NULL,
      confirmation_status TEXT NOT NULL,
      contact_method TEXT NOT NULL DEFAULT '',
      customer_feedback TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_arrival_notice_change_logs (
      id TEXT PRIMARY KEY,
      change_no TEXT NOT NULL,
      arrival_notice_id TEXT NOT NULL REFERENCES purchase_arrival_notices(id),
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
      impact_id TEXT REFERENCES production_plan_change_impacts(id),
      change_type TEXT NOT NULL,
      old_arrived_at TEXT NOT NULL DEFAULT '',
      new_arrived_at TEXT NOT NULL DEFAULT '',
      old_note TEXT NOT NULL DEFAULT '',
      new_note TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      changed_by TEXT NOT NULL REFERENCES users(id),
      changed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requisitions (
      id TEXT PRIMARY KEY,
      req_no TEXT NOT NULL,
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      bom_id TEXT REFERENCES boms(id),
      bom_version TEXT NOT NULL DEFAULT '',
      requisition_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_by TEXT REFERENCES users(id),
      approved_at TEXT,
      approval_note TEXT NOT NULL DEFAULT '',
      issue_no TEXT NOT NULL DEFAULT '',
      issued_by TEXT REFERENCES users(id),
      issued_at TEXT,
      issue_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS requisition_lines (
      id TEXT PRIMARY KEY,
      requisition_id TEXT NOT NULL REFERENCES requisitions(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      required_qty REAL NOT NULL,
      issued_qty REAL NOT NULL DEFAULT 0,
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requisition_allocations (
      id TEXT PRIMARY KEY,
      requisition_line_id TEXT NOT NULL REFERENCES requisition_lines(id),
      batch_id TEXT NOT NULL REFERENCES material_batches(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      is_substitute INTEGER NOT NULL DEFAULT 0,
      issue_mode TEXT NOT NULL DEFAULT 'fifo',
      issue_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS inspections (
      id TEXT PRIMARY KEY,
      inspection_no TEXT NOT NULL,
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      status TEXT NOT NULL,
      result TEXT,
      actual_qty REAL,
      primary_issued_qty REAL,
      yield_rate REAL,
      measurements TEXT NOT NULL DEFAULT '',
      requested_by TEXT REFERENCES users(id),
      request_note TEXT NOT NULL DEFAULT '',
      completion_qty REAL,
      sample_qty REAL,
      completed_by TEXT REFERENCES users(id),
      inspection_standard TEXT NOT NULL DEFAULT '',
      disposition_note TEXT NOT NULL DEFAULT '',
      parent_inspection_id TEXT REFERENCES inspections(id),
      technical_disposition_id TEXT,
      inspection_round INTEGER NOT NULL DEFAULT 1,
      reinspection_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS production_daily_reports (
      id TEXT PRIMARY KEY,
      report_no TEXT NOT NULL,
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      report_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      planned_qty REAL NOT NULL,
      finished_qty REAL NOT NULL,
      good_qty REAL NOT NULL,
      defect_qty REAL NOT NULL DEFAULT 0,
      scrap_qty REAL NOT NULL DEFAULT 0,
      work_hours REAL NOT NULL DEFAULT 0,
      yield_rate REAL NOT NULL,
      status TEXT NOT NULL,
      abnormal_note TEXT NOT NULL DEFAULT '',
      reported_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS technical_dispositions (
      id TEXT PRIMARY KEY,
      disposition_no TEXT NOT NULL,
      inspection_id TEXT NOT NULL REFERENCES inspections(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      disposition_type TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      corrective_action TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS finished_goods_receipts (
      id TEXT PRIMARY KEY,
      receipt_no TEXT NOT NULL,
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      inspection_id TEXT NOT NULL REFERENCES inspections(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      finished_batch_id TEXT,
      transition_batch_id TEXT,
      finished_qty REAL NOT NULL,
      transition_qty REAL NOT NULL DEFAULT 0,
      material_cost REAL NOT NULL,
      process_cost REAL NOT NULL,
      total_cost REAL NOT NULL,
      unit_cost REAL NOT NULL,
      yield_rate REAL NOT NULL,
      received_by TEXT REFERENCES users(id),
      received_at TEXT NOT NULL,
      inbound_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_cost_summaries (
      id TEXT PRIMARY KEY,
      cost_no TEXT NOT NULL,
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      receipt_id TEXT NOT NULL REFERENCES finished_goods_receipts(id),
      material_cost REAL NOT NULL,
      process_cost REAL NOT NULL,
      transition_cost REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL,
      finished_qty REAL NOT NULL,
      transition_qty REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL,
      status TEXT NOT NULL,
      aggregated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_cost_adjustments (
      id TEXT PRIMARY KEY,
      adjustment_no TEXT NOT NULL,
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      cost_summary_id TEXT NOT NULL DEFAULT '',
      exception_id TEXT REFERENCES production_material_adjustment_review_exceptions(id),
      adjustment_amount REAL NOT NULL,
      previous_total_cost REAL NOT NULL DEFAULT 0,
      new_total_cost REAL NOT NULL DEFAULT 0,
      previous_unit_cost REAL NOT NULL DEFAULT 0,
      new_unit_cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      approval_request_id TEXT REFERENCES approval_requests(id),
      adjustment_note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      applied_by TEXT REFERENCES users(id),
      applied_at TEXT,
      reversal_id TEXT REFERENCES document_reversals(id),
      reversed_by TEXT REFERENCES users(id),
      reversed_at TEXT,
      reversal_reason TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS finished_batches (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      receipt_id TEXT REFERENCES finished_goods_receipts(id),
      batch_no TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      shipment_no TEXT NOT NULL,
      order_id TEXT NOT NULL REFERENCES orders(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      shipped_qty REAL NOT NULL,
      sales_amount REAL NOT NULL DEFAULT 0,
      cost_amount REAL NOT NULL DEFAULT 0,
      gross_profit REAL NOT NULL DEFAULT 0,
      gross_margin REAL NOT NULL DEFAULT 0,
      financial_status TEXT NOT NULL DEFAULT 'unpaid',
      shipped_by TEXT REFERENCES users(id),
      status TEXT NOT NULL,
      delivery_address TEXT NOT NULL DEFAULT '',
      consignee TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      logistics_company TEXT NOT NULL DEFAULT '',
      vehicle_no TEXT NOT NULL DEFAULT '',
      tracking_no TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      shipment_type TEXT NOT NULL DEFAULT 'standard',
      replacement_for_return_id TEXT,
      original_shipment_id TEXT,
      created_at TEXT NOT NULL,
      shipped_at TEXT
    );

    CREATE TABLE IF NOT EXISTS finished_shipment_allocations (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL REFERENCES shipments(id),
      finished_batch_id TEXT NOT NULL REFERENCES finished_batches(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      batch_no TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      cost_amount REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receivables (
      id TEXT PRIMARY KEY,
      receivable_no TEXT NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      shipment_id TEXT REFERENCES shipments(id),
      total_amount REAL NOT NULL,
      received_amount REAL NOT NULL DEFAULT 0,
      adjusted_amount REAL NOT NULL DEFAULT 0,
      refund_due_amount REAL NOT NULL DEFAULT 0,
      balance_amount REAL NOT NULL,
      status TEXT NOT NULL,
      due_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS receivable_receipts (
      id TEXT PRIMARY KEY,
      receivable_id TEXT NOT NULL REFERENCES receivables(id),
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      note TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payables (
      id TEXT PRIMARY KEY,
      payable_no TEXT NOT NULL,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      purchase_order_id TEXT REFERENCES purchase_orders(id),
      total_amount REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      balance_amount REAL NOT NULL,
      status TEXT NOT NULL,
      due_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payable_payments (
      id TEXT PRIMARY KEY,
      payable_id TEXT NOT NULL REFERENCES payables(id),
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      note TEXT NOT NULL,
      paid_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales_returns (
      id TEXT PRIMARY KEY,
      return_no TEXT NOT NULL,
      shipment_id TEXT NOT NULL REFERENCES shipments(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      production_order_id TEXT NOT NULL REFERENCES production_orders(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      receivable_id TEXT REFERENCES receivables(id),
      return_qty REAL NOT NULL,
      return_amount REAL NOT NULL,
      cost_amount REAL NOT NULL,
      offset_amount REAL NOT NULL DEFAULT 0,
      refund_due_amount REAL NOT NULL DEFAULT 0,
      refunded_amount REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      disposition TEXT NOT NULL,
      status TEXT NOT NULL,
      refund_status TEXT NOT NULL,
      replacement_status TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sales_return_allocations (
      id TEXT PRIMARY KEY,
      sales_return_id TEXT NOT NULL REFERENCES sales_returns(id),
      finished_batch_id TEXT NOT NULL REFERENCES finished_batches(id),
      batch_no TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      cost_amount REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_refunds (
      id TEXT PRIMARY KEY,
      refund_no TEXT NOT NULL,
      sales_return_id TEXT NOT NULL REFERENCES sales_returns(id),
      receivable_id TEXT REFERENCES receivables(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      refunded_by TEXT NOT NULL REFERENCES users(id),
      refunded_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_exports (
      id TEXT PRIMARY KEY,
      document_no TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      file_name TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_attachments (
      id TEXT PRIMARY KEY,
      attachment_no TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      entity_no TEXT NOT NULL,
      category TEXT NOT NULL,
      file_name TEXT NOT NULL,
      storage_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS initialization_imports (
      id TEXT PRIMARY KEY,
      import_no TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      imported_rows INTEGER NOT NULL,
      created_count INTEGER NOT NULL,
      updated_count INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id),
      note TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'import',
      valid_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS initialization_import_errors (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL REFERENCES initialization_imports(id),
      row_no INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      message TEXT NOT NULL,
      raw_data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_cancellations (
      id TEXT PRIMARY KEY,
      cancellation_no TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_id TEXT NOT NULL,
      document_no TEXT NOT NULL,
      original_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      cancelled_by TEXT NOT NULL REFERENCES users(id),
      cancelled_at TEXT NOT NULL,
      UNIQUE(document_type, document_id)
    );

    CREATE TABLE IF NOT EXISTS document_reversals (
      id TEXT PRIMARY KEY,
      reversal_no TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_id TEXT NOT NULL,
      document_no TEXT NOT NULL,
      original_status TEXT NOT NULL,
      reversal_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      reversed_by TEXT NOT NULL REFERENCES users(id),
      reversed_at TEXT NOT NULL,
      UNIQUE(document_type, document_id)
    );

    CREATE TABLE IF NOT EXISTS ledger_red_offsets (
      id TEXT PRIMARY KEY,
      offset_no TEXT NOT NULL,
      ledger_type TEXT NOT NULL,
      ledger_id TEXT NOT NULL,
      ledger_no TEXT NOT NULL,
      source_document_type TEXT NOT NULL,
      source_document_id TEXT NOT NULL,
      reversal_id TEXT NOT NULL REFERENCES document_reversals(id),
      original_amount REAL NOT NULL,
      settled_amount REAL NOT NULL DEFAULT 0,
      offset_amount REAL NOT NULL,
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_snapshots (
      id TEXT PRIMARY KEY,
      report_no TEXT NOT NULL,
      type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approval_rules (
      id TEXT PRIMARY KEY,
      rule_code TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      min_amount REAL NOT NULL DEFAULT 0,
      max_amount REAL,
      approver_role TEXT NOT NULL,
      sla_hours INTEGER NOT NULL DEFAULT 48,
      status TEXT NOT NULL DEFAULT 'active',
      condition_scope TEXT NOT NULL DEFAULT 'all',
      material_id TEXT REFERENCES materials(id),
      adjustment_type TEXT NOT NULL DEFAULT '',
      risk_level TEXT NOT NULL DEFAULT 'normal',
      allow_reversal INTEGER NOT NULL DEFAULT 1,
      reversal_approver_role TEXT NOT NULL DEFAULT 'manager',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_subscriptions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      min_severity TEXT NOT NULL DEFAULT 'low',
      enabled INTEGER NOT NULL DEFAULT 1,
      route_to_tasks INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(role, alert_type)
    );

    CREATE TABLE IF NOT EXISTS alert_message_states (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      alert_key TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      read_at TEXT,
      dismissed_at TEXT,
      handled_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, alert_key)
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      request_no TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      applicant_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      rule_id TEXT REFERENCES approval_rules(id),
      approver_role TEXT,
      sla_hours INTEGER NOT NULL DEFAULT 48,
      entity_type TEXT,
      entity_id TEXT,
      created_at TEXT NOT NULL,
      decided_by TEXT REFERENCES users(id),
      decided_at TEXT,
      decision_note TEXT
    );

    CREATE TABLE IF NOT EXISTS formula_price_calculations (
      id TEXT PRIMARY KEY,
      formula_no TEXT NOT NULL,
      formula_name TEXT NOT NULL,
      total_qty REAL NOT NULL,
      unit TEXT NOT NULL,
      material_cost REAL NOT NULL,
      process_fee REAL NOT NULL,
      loss_rate REAL NOT NULL,
      margin_rate REAL NOT NULL,
      quoted_unit_price REAL NOT NULL,
      total_price REAL NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      note TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS formula_price_lines (
      id TEXT PRIMARY KEY,
      calculation_id TEXT NOT NULL REFERENCES formula_price_calculations(id),
      material_id TEXT NOT NULL REFERENCES materials(id),
      material_name TEXT NOT NULL,
      qty REAL NOT NULL,
      unit TEXT NOT NULL,
      average_cost REAL NOT NULL,
      line_cost REAL NOT NULL,
      ratio REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_sequences (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL,
      prefix TEXT NOT NULL,
      date_key TEXT NOT NULL,
      current_no INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_aging_dispositions (
      id TEXT PRIMARY KEY,
      material_id TEXT NOT NULL REFERENCES materials(id),
      batch_id TEXT REFERENCES material_batches(id),
      aging_level TEXT NOT NULL,
      inactive_days INTEGER NOT NULL,
      status TEXT NOT NULL,
      owner_id TEXT REFERENCES users(id),
      action_plan TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stocktakes (
      id TEXT PRIMARY KEY,
      stocktake_no TEXT NOT NULL,
      material_id TEXT NOT NULL REFERENCES materials(id),
      book_qty REAL NOT NULL,
      actual_qty REAL NOT NULL,
      difference_qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      adjustment_amount REAL NOT NULL,
      status TEXT NOT NULL,
      counted_by TEXT NOT NULL REFERENCES users(id),
      counted_at TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      approved_by TEXT REFERENCES users(id),
      approved_at TEXT,
      approval_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      batch_no TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      movement_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parallel_ledgers (
      id TEXT PRIMARY KEY,
      ledger_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      base_ledger_id TEXT NOT NULL DEFAULT 'formal',
      base_as_of TEXT NOT NULL,
      base_revision TEXT,
      scope_type TEXT NOT NULL DEFAULT 'company',
      status TEXT NOT NULL DEFAULT 'creating',
      working_version INTEGER NOT NULL DEFAULT 1,
      engine_version TEXT,
      merge_allowed INTEGER NOT NULL DEFAULT 1,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      frozen_at TEXT,
      merged_at TEXT,
      archived_at TEXT,
      row_version INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS parallel_ledger_members (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL REFERENCES parallel_ledgers(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      member_role TEXT NOT NULL DEFAULT 'viewer',
      can_view INTEGER NOT NULL DEFAULT 1,
      can_adjust INTEGER NOT NULL DEFAULT 0,
      can_export INTEGER NOT NULL DEFAULT 0,
      can_submit_merge INTEGER NOT NULL DEFAULT 0,
      granted_by TEXT REFERENCES users(id),
      granted_at TEXT NOT NULL,
      UNIQUE (ledger_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS parallel_ledger_scopes (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL REFERENCES parallel_ledgers(id),
      scope_entity_type TEXT NOT NULL,
      scope_entity_id TEXT NOT NULL,
      include_children INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parallel_entity_snapshots (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL REFERENCES parallel_ledgers(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      source_row_version INTEGER NOT NULL DEFAULT 0,
      source_updated_at TEXT,
      content_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      UNIQUE (ledger_id, entity_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS parallel_snapshot_manifests (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL UNIQUE REFERENCES parallel_ledgers(id),
      base_as_of TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      entity_count INTEGER NOT NULL,
      entity_type_count INTEGER NOT NULL,
      snapshot_hash TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      verified_at TEXT,
      failure_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parallel_adjustments (
      id TEXT PRIMARY KEY,
      adjustment_no TEXT NOT NULL,
      ledger_id TEXT NOT NULL REFERENCES parallel_ledgers(id),
      ledger_version INTEGER NOT NULL,
      adjustment_type TEXT NOT NULL,
      effective_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      reference_type TEXT,
      reference_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parallel_adjustment_lines (
      id TEXT PRIMARY KEY,
      adjustment_id TEXT NOT NULL REFERENCES parallel_adjustments(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      field_code TEXT NOT NULL,
      before_value TEXT,
      after_value TEXT,
      delta_value TEXT,
      source_material_id TEXT,
      target_material_id TEXT,
      quantity REAL,
      unit_price REAL,
      remark TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS parallel_calculation_runs (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL REFERENCES parallel_ledgers(id),
      ledger_version INTEGER NOT NULL,
      engine_version TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      error_code TEXT,
      error_message TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS parallel_inventory_projections (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES parallel_calculation_runs(id),
      ledger_id TEXT NOT NULL,
      warehouse_id TEXT,
      material_id TEXT NOT NULL,
      batch_id TEXT,
      batch_no TEXT,
      quantity REAL NOT NULL,
      unit_cost REAL NOT NULL,
      inventory_value REAL NOT NULL,
      last_movement_at TEXT,
      projection_status TEXT NOT NULL DEFAULT 'available'
    );

    CREATE TABLE IF NOT EXISTS parallel_material_allocations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES parallel_calculation_runs(id),
      production_order_id TEXT NOT NULL,
      requirement_material_id TEXT NOT NULL,
      issued_material_id TEXT NOT NULL,
      batch_id TEXT,
      allocated_qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      allocation_type TEXT NOT NULL DEFAULT 'fifo',
      source_adjustment_id TEXT
    );

    CREATE TABLE IF NOT EXISTS parallel_cost_projections (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES parallel_calculation_runs(id),
      production_order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      material_cost REAL NOT NULL,
      processing_cost REAL NOT NULL,
      other_cost REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL,
      finished_qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      yield_rate REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parallel_impacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES parallel_calculation_runs(id),
      domain TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      blocking INTEGER NOT NULL DEFAULT 0,
      entity_type TEXT,
      entity_id TEXT,
      before_value TEXT,
      after_value TEXT,
      delta_value TEXT,
      message TEXT NOT NULL,
      source_adjustment_id TEXT
    );

    CREATE TABLE IF NOT EXISTS parallel_gaps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES parallel_calculation_runs(id),
      gap_type TEXT NOT NULL,
      material_id TEXT,
      required_qty REAL NOT NULL,
      available_qty REAL NOT NULL,
      shortage_qty REAL NOT NULL,
      required_date TEXT,
      blocking INTEGER NOT NULL DEFAULT 0,
      resolution_status TEXT NOT NULL DEFAULT 'open',
      selected_suggestion_id TEXT
    );

    CREATE TABLE IF NOT EXISTS parallel_suggestions (
      id TEXT PRIMARY KEY,
      gap_id TEXT NOT NULL REFERENCES parallel_gaps(id),
      ledger_id TEXT NOT NULL,
      suggestion_type TEXT NOT NULL,
      document_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      confirmed_by TEXT REFERENCES users(id),
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS parallel_merge_requests (
      id TEXT PRIMARY KEY,
      merge_no TEXT NOT NULL,
      ledger_id TEXT NOT NULL REFERENCES parallel_ledgers(id),
      ledger_version INTEGER NOT NULL,
      base_revision TEXT,
      target_revision TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT NOT NULL UNIQUE,
      submitted_by TEXT REFERENCES users(id),
      submitted_at TEXT,
      approved_by TEXT REFERENCES users(id),
      approved_at TEXT,
      published_by TEXT REFERENCES users(id),
      published_at TEXT,
      failure_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS parallel_merge_items (
      id TEXT PRIMARY KEY,
      merge_request_id TEXT NOT NULL REFERENCES parallel_merge_requests(id),
      sequence_no INTEGER NOT NULL,
      document_type TEXT NOT NULL,
      source_entity_type TEXT,
      source_entity_id TEXT,
      action_type TEXT NOT NULL DEFAULT 'correct',
      document_payload_json TEXT NOT NULL DEFAULT '{}',
      publish_status TEXT NOT NULL DEFAULT 'pending',
      published_document_id TEXT,
      UNIQUE (merge_request_id, sequence_no)
    );

    CREATE TABLE IF NOT EXISTS formal_correction_orders (
      id TEXT PRIMARY KEY,
      correction_no TEXT NOT NULL UNIQUE,
      correction_type TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'parallel_merge',
      source_ledger_id TEXT NOT NULL REFERENCES parallel_ledgers(id),
      source_merge_request_id TEXT NOT NULL REFERENCES parallel_merge_requests(id),
      source_merge_item_id TEXT NOT NULL UNIQUE REFERENCES parallel_merge_items(id),
      target_entity_type TEXT NOT NULL DEFAULT '',
      target_entity_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending_execution',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      executed_by TEXT REFERENCES users(id),
      executed_at TEXT,
      resulting_document_type TEXT,
      resulting_document_id TEXT,
      execution_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS correction_execution_runs (
      id TEXT PRIMARY KEY,
      merge_request_id TEXT NOT NULL UNIQUE REFERENCES parallel_merge_requests(id),
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      total_steps INTEGER NOT NULL DEFAULT 0,
      succeeded_steps INTEGER NOT NULL DEFAULT 0,
      waiting_steps INTEGER NOT NULL DEFAULT 0,
      failed_steps INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS correction_execution_steps (
      id TEXT PRIMARY KEY,
      execution_run_id TEXT NOT NULL REFERENCES correction_execution_runs(id),
      merge_item_id TEXT NOT NULL UNIQUE REFERENCES parallel_merge_items(id),
      document_type TEXT NOT NULL,
      dependency_order INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      published_document_id TEXT,
      result_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT NOT NULL DEFAULT '',
      executed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reconciliation_results (
      id TEXT PRIMARY KEY,
      execution_run_id TEXT NOT NULL REFERENCES correction_execution_runs(id),
      merge_request_id TEXT NOT NULL REFERENCES parallel_merge_requests(id),
      rule_code TEXT NOT NULL,
      domain TEXT NOT NULL,
      status TEXT NOT NULL,
      blocking INTEGER NOT NULL DEFAULT 1,
      expected_json TEXT NOT NULL DEFAULT '{}',
      actual_json TEXT NOT NULL DEFAULT '{}',
      delta_json TEXT NOT NULL DEFAULT '{}',
      message TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL,
      UNIQUE (execution_run_id, rule_code)
    );

    CREATE TABLE IF NOT EXISTS correction_recovery_points (
      id TEXT PRIMARY KEY,
      execution_run_id TEXT NOT NULL REFERENCES correction_execution_runs(id),
      attempt_no INTEGER NOT NULL,
      status TEXT NOT NULL,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      completion_note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      restored_at TEXT
    );

    CREATE TABLE IF NOT EXISTS parallel_merge_conflicts (
      id TEXT PRIMARY KEY,
      merge_request_id TEXT NOT NULL REFERENCES parallel_merge_requests(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      conflict_type TEXT NOT NULL,
      base_hash TEXT,
      current_hash TEXT,
      base_value_json TEXT,
      current_value_json TEXT,
      parallel_value_json TEXT,
      resolution_type TEXT,
      resolution_value_json TEXT,
      resolved_by TEXT REFERENCES users(id),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS database_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      setting_label TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      updated_by TEXT REFERENCES users(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_setting_effects (
      id TEXT PRIMARY KEY,
      setting_key TEXT NOT NULL REFERENCES system_settings(setting_key),
      setting_label TEXT NOT NULL,
      old_value TEXT NOT NULL,
      new_value TEXT NOT NULL,
      impact_json TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_health_remediations (
      id TEXT PRIMARY KEY,
      remediation_no TEXT NOT NULL UNIQUE,
      health_key TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_id TEXT REFERENCES users(id),
      action_plan TEXT NOT NULL DEFAULT '',
      result_note TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      submitted_by TEXT REFERENCES users(id),
      submitted_at TEXT,
      review_note TEXT NOT NULL DEFAULT '',
      source_snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      closed_by TEXT REFERENCES users(id),
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS system_health_remediation_reviews (
      id TEXT PRIMARY KEY,
      remediation_id TEXT NOT NULL REFERENCES system_health_remediations(id),
      remediation_no TEXT NOT NULL,
      decision TEXT NOT NULL,
      review_note TEXT NOT NULL DEFAULT '',
      reviewer_id TEXT NOT NULL REFERENCES users(id),
      reviewed_at TEXT NOT NULL
    );
  `);
  ensureColumn(database, "materials", "reorder_min_qty", "REAL NOT NULL DEFAULT 0");
  ensureColumn(database, "materials", "last_movement_at", "TEXT");
  ensureColumn(database, "material_batches", "last_movement_at", "TEXT");
  ensureColumn(database, "materials", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "material_batches", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "boms", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "bom_lines", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "production_orders", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "orders", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "quotes", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "requisitions", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "requisition_lines", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "finished_batches", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "receivables", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "payables", "row_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "document_exports", "ledger_type", "TEXT NOT NULL DEFAULT 'formal'");
  ensureColumn(database, "document_exports", "ledger_id", "TEXT");
  ensureColumn(database, "document_exports", "ledger_version", "INTEGER");
  ensureColumn(database, "audit_logs", "ledger_id", "TEXT");
  ensureColumn(database, "audit_logs", "ledger_version", "INTEGER");
  ensureColumn(database, "audit_logs", "request_id", "TEXT");
  ensureColumn(database, "parallel_ledger_members", "can_recalculate", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "parallel_ledger_members", "can_freeze", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "parallel_ledger_members", "can_approve_merge", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "parallel_ledger_members", "can_publish_merge", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "parallel_ledger_members", "can_archive", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "parallel_ledger_members", "can_discard", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "parallel_ledger_members", "can_admin", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "parallel_ledgers", "last_merge_preview_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(database, "parallel_ledgers", "last_merge_preview_at", "TEXT");
  backfillInventoryMovementDates(database);
}

function applyMigrations(database: Database.Database) {
  const migrations = [
    {
      id: "001_core_indexes",
      description: "核心业务查询索引与审计追溯索引",
      up: () => {
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_quotes_status_created ON quotes(status, created_at);
          CREATE INDEX IF NOT EXISTS idx_orders_status_due ON orders(status, due_date);
          CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
          CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders(status);
          CREATE INDEX IF NOT EXISTS idx_production_orders_order ON production_orders(order_id);
          CREATE INDEX IF NOT EXISTS idx_requisitions_status ON requisitions(status);
          CREATE INDEX IF NOT EXISTS idx_requisitions_production ON requisitions(production_order_id);
          CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
          CREATE INDEX IF NOT EXISTS idx_inspections_production ON inspections(production_order_id);
          CREATE INDEX IF NOT EXISTS idx_inspections_reinspection ON inspections(parent_inspection_id, technical_disposition_id);
          CREATE INDEX IF NOT EXISTS idx_production_daily_reports_production_date ON production_daily_reports(production_order_id, report_date);
          CREATE INDEX IF NOT EXISTS idx_technical_dispositions_inspection ON technical_dispositions(inspection_id);
          CREATE INDEX IF NOT EXISTS idx_technical_dispositions_status ON technical_dispositions(status, due_date);
          CREATE INDEX IF NOT EXISTS idx_material_batches_material_received ON material_batches(material_id, received_at);
          CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_created ON inventory_movements(item_type, item_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_inventory_movements_source ON inventory_movements(source_type, source_id);
          CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_due ON purchase_orders(status, due_date);
          CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
          CREATE INDEX IF NOT EXISTS idx_payables_status_due ON payables(status, due_date);
          CREATE INDEX IF NOT EXISTS idx_payables_supplier ON payables(supplier_id);
          CREATE INDEX IF NOT EXISTS idx_receivables_status_due ON receivables(status, due_date);
          CREATE INDEX IF NOT EXISTS idx_receivables_customer ON receivables(customer_id);
          CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created ON audit_logs(entity_type, entity_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs(actor_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_document_exports_type_created ON document_exports(type, created_at);
          CREATE INDEX IF NOT EXISTS idx_document_attachments_entity ON document_attachments(entity_type, entity_id, uploaded_at);
          CREATE INDEX IF NOT EXISTS idx_document_attachments_category ON document_attachments(category, uploaded_at);
          CREATE INDEX IF NOT EXISTS idx_initialization_imports_type_created ON initialization_imports(type, created_at);
        `);
      },
    },
    {
      id: "002_master_data_governance_schema",
      description: "主数据编码、状态、备注与时间戳治理字段",
      up: () => {
        ensureColumn(database, "customers", "customer_code", "TEXT");
        ensureColumn(database, "customers", "status", "TEXT NOT NULL DEFAULT 'active'");
        ensureColumn(database, "customers", "address", "TEXT");
        ensureColumn(database, "customers", "tax_no", "TEXT");
        ensureColumn(database, "customers", "remark", "TEXT");
        ensureColumn(database, "customers", "created_at", "TEXT");
        ensureColumn(database, "customers", "updated_at", "TEXT");

        ensureColumn(database, "suppliers", "supplier_code", "TEXT");
        ensureColumn(database, "suppliers", "address", "TEXT");
        ensureColumn(database, "suppliers", "tax_no", "TEXT");
        ensureColumn(database, "suppliers", "remark", "TEXT");
        ensureColumn(database, "suppliers", "created_at", "TEXT");
        ensureColumn(database, "suppliers", "updated_at", "TEXT");

        ensureColumn(database, "materials", "material_code", "TEXT");
        ensureColumn(database, "materials", "spec", "TEXT");
        ensureColumn(database, "materials", "status", "TEXT NOT NULL DEFAULT 'active'");
        ensureColumn(database, "materials", "remark", "TEXT");
        ensureColumn(database, "materials", "created_at", "TEXT");
        ensureColumn(database, "materials", "updated_at", "TEXT");

        ensureColumn(database, "products", "product_code", "TEXT");
        ensureColumn(database, "products", "spec", "TEXT");
        ensureColumn(database, "products", "status", "TEXT NOT NULL DEFAULT 'active'");
        ensureColumn(database, "products", "remark", "TEXT");
        ensureColumn(database, "products", "created_at", "TEXT");
        ensureColumn(database, "products", "updated_at", "TEXT");

        ensureColumn(database, "boms", "remark", "TEXT");
        ensureColumn(database, "boms", "created_at", "TEXT");
        ensureColumn(database, "boms", "updated_at", "TEXT");

        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_customers_status_name ON customers(status, name);
          CREATE INDEX IF NOT EXISTS idx_suppliers_status_name ON suppliers(status, name);
          CREATE INDEX IF NOT EXISTS idx_materials_status_kind_name ON materials(status, kind, name);
          CREATE INDEX IF NOT EXISTS idx_products_status_name ON products(status, name);
          CREATE INDEX IF NOT EXISTS idx_boms_product_status ON boms(product_id, status);
        `);
      },
    },
    {
      id: "003_master_data_governance_backfill",
      description: "主数据编码、状态与时间戳历史数据回填",
      up: () => {
        const now = new Date().toISOString();
        database
          .prepare(
            `
              UPDATE customers
              SET customer_code = COALESCE(NULLIF(customer_code, ''), id),
                  status = COALESCE(NULLIF(status, ''), 'active'),
                  created_at = COALESCE(created_at, ?),
                  updated_at = COALESCE(updated_at, ?)
            `,
          )
          .run(now, now);
        database
          .prepare(
            `
              UPDATE suppliers
              SET supplier_code = COALESCE(NULLIF(supplier_code, ''), id),
                  status = COALESCE(NULLIF(status, ''), 'active'),
                  created_at = COALESCE(created_at, ?),
                  updated_at = COALESCE(updated_at, ?)
            `,
          )
          .run(now, now);
        database
          .prepare(
            `
              UPDATE materials
              SET material_code = COALESCE(NULLIF(material_code, ''), id),
                  status = COALESCE(NULLIF(status, ''), 'active'),
                  created_at = COALESCE(created_at, last_movement_at, ?),
                  updated_at = COALESCE(updated_at, last_movement_at, ?)
            `,
          )
          .run(now, now);
        database
          .prepare(
            `
              UPDATE products
              SET product_code = COALESCE(NULLIF(product_code, ''), id),
                  status = COALESCE(NULLIF(status, ''), 'active'),
                  created_at = COALESCE(created_at, ?),
                  updated_at = COALESCE(updated_at, ?)
            `,
          )
          .run(now, now);
        database
          .prepare(
            `
              UPDATE boms
              SET created_at = COALESCE(created_at, ?),
                  updated_at = COALESCE(updated_at, ?)
            `,
          )
          .run(now, now);
        database.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_customer_code
            ON customers(customer_code)
            WHERE customer_code IS NOT NULL AND customer_code <> '';
          CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_supplier_code
            ON suppliers(supplier_code)
            WHERE supplier_code IS NOT NULL AND supplier_code <> '';
          CREATE UNIQUE INDEX IF NOT EXISTS ux_materials_material_code
            ON materials(material_code)
            WHERE material_code IS NOT NULL AND material_code <> '';
          CREATE UNIQUE INDEX IF NOT EXISTS ux_products_product_code
            ON products(product_code)
            WHERE product_code IS NOT NULL AND product_code <> '';
        `);
      },
    },
    {
      id: "004_purchase_approval_workflow",
      description: "采购订单审批关联与审批单业务来源字段",
      up: () => {
        ensureColumn(database, "purchase_orders", "approval_request_id", "TEXT");
        ensureColumn(database, "approval_requests", "entity_type", "TEXT");
        ensureColumn(database, "approval_requests", "entity_id", "TEXT");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_purchase_orders_approval ON purchase_orders(approval_request_id);
          CREATE INDEX IF NOT EXISTS idx_approval_requests_entity ON approval_requests(entity_type, entity_id);
        `);
      },
    },
    {
      id: "005_material_issue_traceability",
      description: "原材料出库手动批次、替代料与追溯备注字段",
      up: () => {
        ensureColumn(database, "requisition_allocations", "issue_mode", "TEXT NOT NULL DEFAULT 'fifo'");
        ensureColumn(database, "requisition_allocations", "issue_note", "TEXT NOT NULL DEFAULT ''");
      },
    },
    {
      id: "006_sales_delivery_receivable_formal_fields",
      description: "销售订单、发货单与应收闭环正式业务字段",
      up: () => {
        ensureColumn(database, "orders", "customer_po_no", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "orders", "sales_contract_no", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "orders", "delivery_address", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "orders", "consignee", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "orders", "contact_phone", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "orders", "payment_terms_days", "INTEGER NOT NULL DEFAULT 30");
        ensureColumn(database, "orders", "remark", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "shipments", "delivery_address", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "shipments", "consignee", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "shipments", "contact_phone", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "shipments", "logistics_company", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "shipments", "vehicle_no", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "shipments", "tracking_no", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "shipments", "remark", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_shipments_order_created ON shipments(order_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_shipments_production_status ON shipments(production_order_id, status);
        `);
      },
    },
    {
      id: "007_production_formal_instruction_schedule_requisition",
      description: "生产指令、排产记录与领料单正式字段",
      up: () => {
        ensureColumn(database, "production_orders", "priority", "TEXT NOT NULL DEFAULT 'normal'");
        ensureColumn(database, "production_orders", "instruction_note", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "production_orders", "technical_requirements", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "production_orders", "issued_by", "TEXT");
        ensureColumn(database, "production_orders", "issued_at", "TEXT");
        ensureColumn(database, "schedules", "shift", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "schedules", "schedule_note", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "requisitions", "bom_id", "TEXT");
        ensureColumn(database, "requisitions", "bom_version", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "requisitions", "requisition_note", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_production_orders_priority_status ON production_orders(priority, status);
          CREATE INDEX IF NOT EXISTS idx_schedules_planned_date ON schedules(planned_date);
          CREATE INDEX IF NOT EXISTS idx_requisitions_bom ON requisitions(bom_id);
        `);
      },
    },
    {
      id: "008_warehouse_formal_issue_loop",
      description: "仓库正式发料审批、出库单号、发料人和说明字段",
      up: () => {
        ensureColumn(database, "requisitions", "approved_by", "TEXT");
        ensureColumn(database, "requisitions", "approved_at", "TEXT");
        ensureColumn(database, "requisitions", "approval_note", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "requisitions", "issue_no", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "requisitions", "issued_by", "TEXT");
        ensureColumn(database, "requisitions", "issue_note", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_requisitions_issue_no ON requisitions(issue_no);
          CREATE INDEX IF NOT EXISTS idx_requisitions_approved_at ON requisitions(approved_at);
        `);
      },
    },
    {
      id: "009_quality_finished_inbound_formal_loop",
      description: "生产完工请验、品控判定与成品入库单正式字段",
      up: () => {
        ensureColumn(database, "inspections", "requested_by", "TEXT");
        ensureColumn(database, "inspections", "request_note", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "inspections", "completion_qty", "REAL");
        ensureColumn(database, "inspections", "sample_qty", "REAL");
        ensureColumn(database, "inspections", "completed_by", "TEXT");
        ensureColumn(database, "inspections", "inspection_standard", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "inspections", "disposition_note", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          CREATE TABLE IF NOT EXISTS finished_goods_receipts (
            id TEXT PRIMARY KEY,
            receipt_no TEXT NOT NULL,
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            inspection_id TEXT NOT NULL REFERENCES inspections(id),
            product_id TEXT NOT NULL REFERENCES products(id),
            finished_batch_id TEXT,
            transition_batch_id TEXT,
            finished_qty REAL NOT NULL,
            transition_qty REAL NOT NULL DEFAULT 0,
            material_cost REAL NOT NULL,
            process_cost REAL NOT NULL,
            total_cost REAL NOT NULL,
            unit_cost REAL NOT NULL,
            yield_rate REAL NOT NULL,
            received_by TEXT REFERENCES users(id),
            received_at TEXT NOT NULL,
            inbound_note TEXT NOT NULL DEFAULT ''
          );
          CREATE INDEX IF NOT EXISTS idx_finished_receipts_production ON finished_goods_receipts(production_order_id);
          CREATE INDEX IF NOT EXISTS idx_finished_receipts_inspection ON finished_goods_receipts(inspection_id);
          CREATE INDEX IF NOT EXISTS idx_finished_receipts_receipt_no ON finished_goods_receipts(receipt_no);
        `);
        ensureColumn(database, "finished_batches", "receipt_id", "TEXT");
      },
    },
    {
      id: "010_production_cost_and_finished_shipment_closure",
      description: "生产工单成本归集、成品批次出库分摊与发货应收联动字段",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_cost_summaries (
            id TEXT PRIMARY KEY,
            cost_no TEXT NOT NULL,
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            order_id TEXT NOT NULL REFERENCES orders(id),
            receipt_id TEXT NOT NULL REFERENCES finished_goods_receipts(id),
            material_cost REAL NOT NULL,
            process_cost REAL NOT NULL,
            transition_cost REAL NOT NULL DEFAULT 0,
            total_cost REAL NOT NULL,
            finished_qty REAL NOT NULL,
            transition_qty REAL NOT NULL DEFAULT 0,
            unit_cost REAL NOT NULL,
            status TEXT NOT NULL,
            aggregated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS finished_shipment_allocations (
            id TEXT PRIMARY KEY,
            shipment_id TEXT NOT NULL REFERENCES shipments(id),
            finished_batch_id TEXT NOT NULL REFERENCES finished_batches(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            batch_no TEXT NOT NULL,
            qty REAL NOT NULL,
            unit_cost REAL NOT NULL,
            cost_amount REAL NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_production_cost_summaries_production ON production_cost_summaries(production_order_id);
          CREATE INDEX IF NOT EXISTS idx_production_cost_summaries_receipt ON production_cost_summaries(receipt_id);
          CREATE INDEX IF NOT EXISTS idx_finished_shipment_allocations_shipment ON finished_shipment_allocations(shipment_id);
          CREATE INDEX IF NOT EXISTS idx_finished_shipment_allocations_batch ON finished_shipment_allocations(finished_batch_id);
        `);
        ensureColumn(database, "shipments", "sales_amount", "REAL NOT NULL DEFAULT 0");
        ensureColumn(database, "shipments", "cost_amount", "REAL NOT NULL DEFAULT 0");
        ensureColumn(database, "shipments", "gross_profit", "REAL NOT NULL DEFAULT 0");
        ensureColumn(database, "shipments", "gross_margin", "REAL NOT NULL DEFAULT 0");
        ensureColumn(database, "shipments", "financial_status", "TEXT NOT NULL DEFAULT 'unpaid'");
        ensureColumn(database, "shipments", "shipped_by", "TEXT");
      },
    },
    {
      id: "011_backfill_cost_and_shipment_closure",
      description: "历史成品入库、发货和应收闭环数据回填",
      up: () => {
        backfillCostAndShipmentClosure(database);
      },
    },
    {
      id: "012_formal_authentication_rbac_base",
      description: "正式账号登录、密码哈希、会话与用户状态字段",
      up: () => {
        ensureColumn(database, "users", "username", "TEXT");
        ensureColumn(database, "users", "password_hash", "TEXT");
        ensureColumn(database, "users", "status", "TEXT NOT NULL DEFAULT 'active'");
        ensureColumn(database, "users", "last_login_at", "TEXT");
        ensureColumn(database, "users", "password_changed_at", "TEXT");
        database.exec(`
          CREATE TABLE IF NOT EXISTS user_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            token_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_seen_at TEXT,
            revoked_at TEXT
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username
            ON users(username)
            WHERE username IS NOT NULL AND username <> '';
          CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
          CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active ON user_sessions(user_id, revoked_at, expires_at);
        `);
        backfillUserSecurity(database);
      },
    },
    {
      id: "013_formal_sequences_and_inventory_disposition",
      description: "正式单据流水号台账、库存呆滞积压处置台账与权限审计索引",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS document_sequences (
            id TEXT PRIMARY KEY,
            doc_type TEXT NOT NULL,
            prefix TEXT NOT NULL,
            date_key TEXT NOT NULL,
            current_no INTEGER NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_document_sequences_scope
            ON document_sequences(doc_type, prefix, date_key);
          CREATE INDEX IF NOT EXISTS idx_document_sequences_updated
            ON document_sequences(updated_at);

          CREATE TABLE IF NOT EXISTS inventory_aging_dispositions (
            id TEXT PRIMARY KEY,
            material_id TEXT NOT NULL REFERENCES materials(id),
            batch_id TEXT REFERENCES material_batches(id),
            aging_level TEXT NOT NULL,
            inactive_days INTEGER NOT NULL,
            status TEXT NOT NULL,
            owner_id TEXT REFERENCES users(id),
            action_plan TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            closed_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_inventory_aging_dispositions_material_created
            ON inventory_aging_dispositions(material_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_inventory_aging_dispositions_status
            ON inventory_aging_dispositions(status, created_at);
        `);
      },
    },
    {
      id: "014_backfill_formal_document_sequences",
      description: "按历史正式单据编号回填单据流水号治理台账",
      up: () => {
        backfillDocumentSequences(database);
      },
    },
    {
      id: "015_formal_stocktake_inventory_adjustment",
      description: "库存盘点单、盘盈盘亏审批与库存调整闭环",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS stocktakes (
            id TEXT PRIMARY KEY,
            stocktake_no TEXT NOT NULL,
            material_id TEXT NOT NULL REFERENCES materials(id),
            book_qty REAL NOT NULL,
            actual_qty REAL NOT NULL,
            difference_qty REAL NOT NULL,
            unit_cost REAL NOT NULL,
            adjustment_amount REAL NOT NULL,
            status TEXT NOT NULL,
            counted_by TEXT NOT NULL REFERENCES users(id),
            counted_at TEXT NOT NULL,
            remark TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            approved_by TEXT REFERENCES users(id),
            approved_at TEXT,
            approval_note TEXT NOT NULL DEFAULT ''
          );
          CREATE INDEX IF NOT EXISTS idx_stocktakes_status_created
            ON stocktakes(status, created_at);
          CREATE INDEX IF NOT EXISTS idx_stocktakes_material_created
            ON stocktakes(material_id, created_at);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_stocktakes_no
            ON stocktakes(stocktake_no);
        `);
      },
    },
    {
      id: "016_approval_rule_templates",
      description: "审批模板、金额规则、审批角色与 SLA 配置",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS approval_rules (
            id TEXT PRIMARY KEY,
            rule_code TEXT NOT NULL,
            rule_name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            min_amount REAL NOT NULL DEFAULT 0,
            max_amount REAL,
            approver_role TEXT NOT NULL,
            sla_hours INTEGER NOT NULL DEFAULT 48,
            status TEXT NOT NULL DEFAULT 'active',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_approval_rules_code
            ON approval_rules(rule_code);
          CREATE INDEX IF NOT EXISTS idx_approval_rules_match
            ON approval_rules(source_type, status, min_amount, max_amount);
          CREATE INDEX IF NOT EXISTS idx_approval_rules_role
            ON approval_rules(approver_role, status);
        `);
        ensureColumn(database, "approval_requests", "rule_id", "TEXT");
        ensureColumn(database, "approval_requests", "approver_role", "TEXT");
        ensureColumn(database, "approval_requests", "sla_hours", "INTEGER NOT NULL DEFAULT 48");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_approval_requests_rule
            ON approval_requests(rule_id);
          CREATE INDEX IF NOT EXISTS idx_approval_requests_approver_status
            ON approval_requests(approver_role, status);
        `);
      },
    },
    {
      id: "017_alert_message_center",
      description: "经营预警消息状态与角色订阅规则",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS alert_subscriptions (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            alert_type TEXT NOT NULL,
            min_severity TEXT NOT NULL DEFAULT 'low',
            enabled INTEGER NOT NULL DEFAULT 1,
            route_to_tasks INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(role, alert_type)
          );
          CREATE TABLE IF NOT EXISTS alert_message_states (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            alert_key TEXT NOT NULL,
            alert_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unread',
            read_at TEXT,
            dismissed_at TEXT,
            handled_at TEXT,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, alert_key)
          );
          CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_role_enabled
            ON alert_subscriptions(role, enabled, alert_type);
          CREATE INDEX IF NOT EXISTS idx_alert_message_states_user_status
            ON alert_message_states(user_id, status, updated_at);
          CREATE INDEX IF NOT EXISTS idx_alert_message_states_alert_key
            ON alert_message_states(alert_key);
        `);
        ensureColumn(database, "alert_subscriptions", "route_to_tasks", "INTEGER NOT NULL DEFAULT 1");
      },
    },
    {
      id: "018_system_governance_settings",
      description: "系统治理参数、备份策略和安全审计配置",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS system_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL,
            setting_label TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            updated_by TEXT REFERENCES users(id),
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_system_settings_category
            ON system_settings(category, setting_key);
        `);
      },
    },
    {
      id: "019_document_void_controls",
      description: "正式单据作废台账与安全作废控制",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS document_cancellations (
            id TEXT PRIMARY KEY,
            cancellation_no TEXT NOT NULL,
            document_type TEXT NOT NULL,
            document_id TEXT NOT NULL,
            document_no TEXT NOT NULL,
            original_status TEXT NOT NULL,
            reason TEXT NOT NULL,
            cancelled_by TEXT NOT NULL REFERENCES users(id),
            cancelled_at TEXT NOT NULL,
            UNIQUE(document_type, document_id)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_document_cancellations_document
            ON document_cancellations(document_type, document_id);
          CREATE INDEX IF NOT EXISTS idx_document_cancellations_cancelled_at
            ON document_cancellations(cancelled_at);
        `);
      },
    },
    {
      id: "020_document_reversal_closure",
      description: "正式冲销台账、库存反向流水与应收应付红冲记录",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS document_reversals (
            id TEXT PRIMARY KEY,
            reversal_no TEXT NOT NULL,
            document_type TEXT NOT NULL,
            document_id TEXT NOT NULL,
            document_no TEXT NOT NULL,
            original_status TEXT NOT NULL,
            reversal_type TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL,
            reversed_by TEXT NOT NULL REFERENCES users(id),
            reversed_at TEXT NOT NULL,
            UNIQUE(document_type, document_id)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_document_reversals_document
            ON document_reversals(document_type, document_id);
          CREATE INDEX IF NOT EXISTS idx_document_reversals_reversed_at
            ON document_reversals(reversed_at);

          CREATE TABLE IF NOT EXISTS ledger_red_offsets (
            id TEXT PRIMARY KEY,
            offset_no TEXT NOT NULL,
            ledger_type TEXT NOT NULL,
            ledger_id TEXT NOT NULL,
            ledger_no TEXT NOT NULL,
            source_document_type TEXT NOT NULL,
            source_document_id TEXT NOT NULL,
            reversal_id TEXT NOT NULL REFERENCES document_reversals(id),
            original_amount REAL NOT NULL,
            settled_amount REAL NOT NULL DEFAULT 0,
            offset_amount REAL NOT NULL,
            reason TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_ledger_red_offsets_ledger
            ON ledger_red_offsets(ledger_type, ledger_id);
          CREATE INDEX IF NOT EXISTS idx_ledger_red_offsets_reversal
            ON ledger_red_offsets(reversal_id);
          CREATE INDEX IF NOT EXISTS idx_ledger_red_offsets_created
            ON ledger_red_offsets(created_at);
        `);
      },
    },
    {
      id: "021_after_sales_return_refund_replacement",
      description: "正式售后退货、退款与补开发货单闭环",
      up: () => {
        ensureColumn(database, "shipments", "shipment_type", "TEXT NOT NULL DEFAULT 'standard'");
        ensureColumn(database, "shipments", "replacement_for_return_id", "TEXT");
        ensureColumn(database, "shipments", "original_shipment_id", "TEXT");
        ensureColumn(database, "receivables", "adjusted_amount", "REAL NOT NULL DEFAULT 0");
        ensureColumn(database, "receivables", "refund_due_amount", "REAL NOT NULL DEFAULT 0");
        database.exec(`
          CREATE TABLE IF NOT EXISTS sales_returns (
            id TEXT PRIMARY KEY,
            return_no TEXT NOT NULL,
            shipment_id TEXT NOT NULL REFERENCES shipments(id),
            order_id TEXT NOT NULL REFERENCES orders(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            customer_id TEXT NOT NULL REFERENCES customers(id),
            product_id TEXT NOT NULL REFERENCES products(id),
            receivable_id TEXT REFERENCES receivables(id),
            return_qty REAL NOT NULL,
            return_amount REAL NOT NULL,
            cost_amount REAL NOT NULL,
            offset_amount REAL NOT NULL DEFAULT 0,
            refund_due_amount REAL NOT NULL DEFAULT 0,
            refunded_amount REAL NOT NULL DEFAULT 0,
            reason TEXT NOT NULL,
            disposition TEXT NOT NULL,
            status TEXT NOT NULL,
            refund_status TEXT NOT NULL,
            replacement_status TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            received_at TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT ''
          );
          CREATE TABLE IF NOT EXISTS sales_return_allocations (
            id TEXT PRIMARY KEY,
            sales_return_id TEXT NOT NULL REFERENCES sales_returns(id),
            finished_batch_id TEXT NOT NULL REFERENCES finished_batches(id),
            batch_no TEXT NOT NULL,
            qty REAL NOT NULL,
            unit_cost REAL NOT NULL,
            cost_amount REAL NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS customer_refunds (
            id TEXT PRIMARY KEY,
            refund_no TEXT NOT NULL,
            sales_return_id TEXT NOT NULL REFERENCES sales_returns(id),
            receivable_id TEXT REFERENCES receivables(id),
            customer_id TEXT NOT NULL REFERENCES customers(id),
            amount REAL NOT NULL,
            method TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            refunded_by TEXT NOT NULL REFERENCES users(id),
            refunded_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_sales_returns_shipment ON sales_returns(shipment_id);
          CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON sales_returns(status, refund_status, replacement_status);
          CREATE INDEX IF NOT EXISTS idx_sales_return_allocations_return ON sales_return_allocations(sales_return_id);
          CREATE INDEX IF NOT EXISTS idx_customer_refunds_return ON customer_refunds(sales_return_id);
          CREATE INDEX IF NOT EXISTS idx_shipments_after_sales ON shipments(shipment_type, replacement_for_return_id, original_shipment_id);
        `);
      },
    },
    {
      id: "022_document_attachment_archive",
      description: "正式附件与凭证归档台账",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS document_attachments (
            id TEXT PRIMARY KEY,
            attachment_no TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            entity_no TEXT NOT NULL,
            category TEXT NOT NULL,
            file_name TEXT NOT NULL,
            storage_name TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            uploaded_by TEXT NOT NULL REFERENCES users(id),
            uploaded_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_document_attachments_no ON document_attachments(attachment_no);
          CREATE INDEX IF NOT EXISTS idx_document_attachments_entity ON document_attachments(entity_type, entity_id, uploaded_at);
          CREATE INDEX IF NOT EXISTS idx_document_attachments_category ON document_attachments(category, uploaded_at);
        `);
      },
    },
    {
      id: "023_go_live_initialization_imports",
      description: "正式上线初始化导入台账与期初数据支持",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS initialization_imports (
            id TEXT PRIMARY KEY,
            import_no TEXT NOT NULL,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            imported_rows INTEGER NOT NULL,
            created_count INTEGER NOT NULL,
            updated_count INTEGER NOT NULL,
            total_amount REAL NOT NULL,
            actor_id TEXT NOT NULL REFERENCES users(id),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_initialization_imports_no ON initialization_imports(import_no);
          CREATE INDEX IF NOT EXISTS idx_initialization_imports_type_created ON initialization_imports(type, created_at);
        `);
      },
    },
    {
      id: "024_purchase_requisition_workflow",
      description: "正式采购申请、审批与采购订单来源追溯",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS purchase_requisitions (
            id TEXT PRIMARY KEY,
            requisition_no TEXT NOT NULL,
            source_type TEXT NOT NULL,
            requested_by TEXT NOT NULL REFERENCES users(id),
            approval_request_id TEXT REFERENCES approval_requests(id),
            source_document_type TEXT,
            source_document_id TEXT,
            status TEXT NOT NULL,
            total_amount REAL NOT NULL,
            required_date TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            approved_by TEXT REFERENCES users(id),
            approved_at TEXT,
            approval_note TEXT NOT NULL DEFAULT '',
            converted_order_id TEXT REFERENCES purchase_orders(id),
            converted_at TEXT
          );
          CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
            id TEXT PRIMARY KEY,
            purchase_requisition_id TEXT NOT NULL REFERENCES purchase_requisitions(id),
            material_id TEXT NOT NULL REFERENCES materials(id),
            requested_qty REAL NOT NULL,
            estimated_unit_cost REAL NOT NULL,
            line_amount REAL NOT NULL,
            note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_requisitions_no
            ON purchase_requisitions(requisition_no);
          CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_status
            ON purchase_requisitions(status, created_at);
          CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_approval
            ON purchase_requisitions(approval_request_id);
          CREATE INDEX IF NOT EXISTS idx_purchase_requisition_lines_requisition
            ON purchase_requisition_lines(purchase_requisition_id);
        `);
        ensureColumn(database, "purchase_orders", "source_requisition_id", "TEXT");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_purchase_orders_source_requisition
            ON purchase_orders(source_requisition_id);
        `);
      },
    },
    {
      id: "025_material_iqc_incoming_inspection",
      description: "原材料 IQC 来料检验、入库放行与不合格处置闭环",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS material_iqc_inspections (
            id TEXT PRIMARY KEY,
            iqc_no TEXT NOT NULL,
            purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            status TEXT NOT NULL,
            result TEXT,
            arrival_no TEXT NOT NULL DEFAULT '',
            arrived_at TEXT NOT NULL,
            due_at TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            inspected_by TEXT REFERENCES users(id),
            inspected_at TEXT,
            inspection_standard TEXT NOT NULL DEFAULT '',
            measurements TEXT NOT NULL DEFAULT '',
            disposition_note TEXT NOT NULL DEFAULT '',
            discount_rate REAL NOT NULL DEFAULT 0,
            accepted_amount REAL NOT NULL DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS material_iqc_lines (
            id TEXT PRIMARY KEY,
            iqc_id TEXT NOT NULL REFERENCES material_iqc_inspections(id),
            purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
            material_id TEXT NOT NULL REFERENCES materials(id),
            ordered_qty REAL NOT NULL,
            received_qty REAL NOT NULL,
            accepted_qty REAL NOT NULL DEFAULT 0,
            rejected_qty REAL NOT NULL DEFAULT 0,
            unit_cost REAL NOT NULL,
            accepted_unit_cost REAL NOT NULL,
            line_amount REAL NOT NULL,
            batch_no TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_material_iqc_no
            ON material_iqc_inspections(iqc_no);
          CREATE INDEX IF NOT EXISTS idx_material_iqc_purchase
            ON material_iqc_inspections(purchase_order_id, status);
          CREATE INDEX IF NOT EXISTS idx_material_iqc_status_due
            ON material_iqc_inspections(status, due_at);
          CREATE INDEX IF NOT EXISTS idx_material_iqc_lines_iqc
            ON material_iqc_lines(iqc_id);
        `);
      },
    },
    {
      id: "026_production_daily_and_technical_disposition",
      description: "生产日报单与技术部不合格处理意见闭环",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_daily_reports (
            id TEXT PRIMARY KEY,
            report_no TEXT NOT NULL,
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            order_id TEXT NOT NULL REFERENCES orders(id),
            report_date TEXT NOT NULL,
            shift TEXT NOT NULL,
            planned_qty REAL NOT NULL,
            finished_qty REAL NOT NULL,
            good_qty REAL NOT NULL,
            defect_qty REAL NOT NULL DEFAULT 0,
            scrap_qty REAL NOT NULL DEFAULT 0,
            work_hours REAL NOT NULL DEFAULT 0,
            yield_rate REAL NOT NULL,
            status TEXT NOT NULL,
            abnormal_note TEXT NOT NULL DEFAULT '',
            reported_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS technical_dispositions (
            id TEXT PRIMARY KEY,
            disposition_no TEXT NOT NULL,
            inspection_id TEXT NOT NULL REFERENCES inspections(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            disposition_type TEXT NOT NULL,
            root_cause TEXT NOT NULL,
            corrective_action TEXT NOT NULL,
            due_date TEXT,
            status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            closed_at TEXT
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_daily_reports_no
            ON production_daily_reports(report_no);
          CREATE INDEX IF NOT EXISTS idx_production_daily_reports_production_date
            ON production_daily_reports(production_order_id, report_date);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_technical_dispositions_no
            ON technical_dispositions(disposition_no);
          CREATE INDEX IF NOT EXISTS idx_technical_dispositions_inspection
            ON technical_dispositions(inspection_id);
          CREATE INDEX IF NOT EXISTS idx_technical_dispositions_status
            ON technical_dispositions(status, due_date);
        `);
      },
    },
    {
      id: "027_reinspection_traceability",
      description: "技术处置后复检来源、轮次与闭环状态追溯",
      up: () => {
        ensureColumn(database, "inspections", "parent_inspection_id", "TEXT");
        ensureColumn(database, "inspections", "technical_disposition_id", "TEXT");
        ensureColumn(database, "inspections", "inspection_round", "INTEGER NOT NULL DEFAULT 1");
        ensureColumn(database, "inspections", "reinspection_reason", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_inspections_reinspection
            ON inspections(parent_inspection_id, technical_disposition_id);
        `);
      },
    },
    {
      id: "028_system_setting_effect_records",
      description: "系统参数变更影响预览与生效记录",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS system_setting_effects (
            id TEXT PRIMARY KEY,
            setting_key TEXT NOT NULL REFERENCES system_settings(setting_key),
            setting_label TEXT NOT NULL,
            old_value TEXT NOT NULL,
            new_value TEXT NOT NULL,
            impact_json TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_system_setting_effects_setting_created
            ON system_setting_effects(setting_key, created_at);
          CREATE INDEX IF NOT EXISTS idx_system_setting_effects_created
            ON system_setting_effects(created_at);
        `);
      },
    },
    {
      id: "029_system_health_remediation_loop",
      description: "上线问题整改任务、责任人与闭环记录",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS system_health_remediations (
            id TEXT PRIMARY KEY,
            remediation_no TEXT NOT NULL UNIQUE,
            health_key TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            severity TEXT NOT NULL,
            status TEXT NOT NULL,
            owner_id TEXT REFERENCES users(id),
            action_plan TEXT NOT NULL DEFAULT '',
            result_note TEXT NOT NULL DEFAULT '',
            source_snapshot_json TEXT NOT NULL DEFAULT '{}',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            closed_by TEXT REFERENCES users(id),
            closed_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_system_health_remediations_key_status
            ON system_health_remediations(health_key, status);
          CREATE INDEX IF NOT EXISTS idx_system_health_remediations_owner_status
            ON system_health_remediations(owner_id, status);
          CREATE INDEX IF NOT EXISTS idx_system_health_remediations_created
            ON system_health_remediations(created_at);
        `);
      },
    },
    {
      id: "030_system_health_remediation_due_review",
      description: "上线整改到期提醒、责任人提交复核与附件统计支撑",
      up: () => {
        ensureColumn(database, "system_health_remediations", "due_date", "TEXT");
        ensureColumn(database, "system_health_remediations", "submitted_by", "TEXT REFERENCES users(id)");
        ensureColumn(database, "system_health_remediations", "submitted_at", "TEXT");
        ensureColumn(database, "system_health_remediations", "review_note", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          UPDATE system_health_remediations
          SET due_date = COALESCE(due_date, date(created_at, '+7 day'))
          WHERE due_date IS NULL OR due_date = '';

          CREATE INDEX IF NOT EXISTS idx_system_health_remediations_due_status
            ON system_health_remediations(status, due_date);
          CREATE INDEX IF NOT EXISTS idx_system_health_remediations_submitted
            ON system_health_remediations(submitted_by, submitted_at);
        `);
        seedDefaultAlertSubscriptions(database);
      },
    },
    {
      id: "031_system_health_remediation_review_history",
      description: "上线整改复核驳回与复核历史记录",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS system_health_remediation_reviews (
            id TEXT PRIMARY KEY,
            remediation_id TEXT NOT NULL REFERENCES system_health_remediations(id),
            remediation_no TEXT NOT NULL,
            decision TEXT NOT NULL,
            review_note TEXT NOT NULL DEFAULT '',
            reviewer_id TEXT NOT NULL REFERENCES users(id),
            reviewed_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_system_health_remediation_reviews_remediation
            ON system_health_remediation_reviews(remediation_id, reviewed_at);
          CREATE INDEX IF NOT EXISTS idx_system_health_remediation_reviews_decision
            ON system_health_remediation_reviews(decision, reviewed_at);
        `);
      },
    },
    {
      id: "032_mrp_net_requirement_planning",
      description: "MRP 缺料净需求测算、采购建议与采购申请来源追溯",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS mrp_requirement_runs (
            id TEXT PRIMARY KEY,
            run_no TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_document_id TEXT,
            horizon_date TEXT NOT NULL,
            status TEXT NOT NULL,
            line_count INTEGER NOT NULL DEFAULT 0,
            shortage_line_count INTEGER NOT NULL DEFAULT 0,
            total_gross_qty REAL NOT NULL DEFAULT 0,
            total_shortage_qty REAL NOT NULL DEFAULT 0,
            total_shortage_amount REAL NOT NULL DEFAULT 0,
            note TEXT NOT NULL DEFAULT '',
            generated_by TEXT NOT NULL REFERENCES users(id),
            generated_at TEXT NOT NULL,
            converted_requisition_id TEXT REFERENCES purchase_requisitions(id),
            converted_at TEXT
          );
          CREATE TABLE IF NOT EXISTS mrp_requirement_lines (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES mrp_requirement_runs(id),
            material_id TEXT NOT NULL REFERENCES materials(id),
            required_qty REAL NOT NULL,
            available_qty REAL NOT NULL,
            safety_stock_qty REAL NOT NULL DEFAULT 0,
            incoming_purchase_qty REAL NOT NULL DEFAULT 0,
            planned_requisition_qty REAL NOT NULL DEFAULT 0,
            net_shortage_qty REAL NOT NULL,
            suggested_purchase_qty REAL NOT NULL,
            estimated_unit_cost REAL NOT NULL,
            line_amount REAL NOT NULL,
            source_summary TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_mrp_requirement_runs_no
            ON mrp_requirement_runs(run_no);
          CREATE INDEX IF NOT EXISTS idx_mrp_requirement_runs_status
            ON mrp_requirement_runs(status, generated_at);
          CREATE INDEX IF NOT EXISTS idx_mrp_requirement_lines_run
            ON mrp_requirement_lines(run_id, status);
          CREATE INDEX IF NOT EXISTS idx_mrp_requirement_lines_material
            ON mrp_requirement_lines(material_id, status);
        `);
        seedDefaultAlertSubscriptions(database);
      },
    },
    {
      id: "033_procurement_contract_arrival_signoff",
      description: "采购合同、供应商下单、到货通知单与仓库签收闭环",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS purchase_contracts (
            id TEXT PRIMARY KEY,
            contract_no TEXT NOT NULL,
            purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            supplier_order_no TEXT NOT NULL DEFAULT '',
            contract_date TEXT NOT NULL,
            delivery_date TEXT NOT NULL,
            payment_terms TEXT NOT NULL DEFAULT '',
            total_amount REAL NOT NULL,
            status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            supplier_confirmed_at TEXT,
            UNIQUE(purchase_order_id)
          );
          CREATE TABLE IF NOT EXISTS purchase_arrival_notices (
            id TEXT PRIMARY KEY,
            arrival_no TEXT NOT NULL,
            purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
            purchase_contract_id TEXT REFERENCES purchase_contracts(id),
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            status TEXT NOT NULL,
            arrived_at TEXT NOT NULL,
            line_count INTEGER NOT NULL DEFAULT 0,
            total_arrived_qty REAL NOT NULL DEFAULT 0,
            total_amount REAL NOT NULL DEFAULT 0,
            note TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            warehouse_received_by TEXT REFERENCES users(id),
            warehouse_received_at TEXT,
            warehouse_note TEXT NOT NULL DEFAULT '',
            iqc_id TEXT REFERENCES material_iqc_inspections(id)
          );
          CREATE TABLE IF NOT EXISTS purchase_arrival_notice_lines (
            id TEXT PRIMARY KEY,
            arrival_notice_id TEXT NOT NULL REFERENCES purchase_arrival_notices(id),
            purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
            material_id TEXT NOT NULL REFERENCES materials(id),
            ordered_qty REAL NOT NULL,
            arrived_qty REAL NOT NULL,
            unit_cost REAL NOT NULL,
            line_amount REAL NOT NULL,
            batch_hint TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_contracts_no
            ON purchase_contracts(contract_no);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_contracts_order
            ON purchase_contracts(purchase_order_id);
          CREATE INDEX IF NOT EXISTS idx_purchase_contracts_supplier_status
            ON purchase_contracts(supplier_id, status, created_at);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_arrival_notices_no
            ON purchase_arrival_notices(arrival_no);
          CREATE INDEX IF NOT EXISTS idx_purchase_arrival_notices_order_status
            ON purchase_arrival_notices(purchase_order_id, status, arrived_at);
          CREATE INDEX IF NOT EXISTS idx_purchase_arrival_notice_lines_notice
            ON purchase_arrival_notice_lines(arrival_notice_id);
        `);
      },
    },
    {
      id: "034_purchase_arrival_discrepancy_closure",
      description: "采购到货数量、批次和价格差异处理闭环",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS purchase_arrival_discrepancies (
            id TEXT PRIMARY KEY,
            discrepancy_no TEXT NOT NULL,
            arrival_notice_id TEXT NOT NULL REFERENCES purchase_arrival_notices(id),
            purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
            purchase_contract_id TEXT REFERENCES purchase_contracts(id),
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            approval_request_id TEXT REFERENCES approval_requests(id),
            discrepancy_type TEXT NOT NULL,
            handling_decision TEXT NOT NULL,
            status TEXT NOT NULL,
            line_count INTEGER NOT NULL DEFAULT 0,
            quantity_variance_qty REAL NOT NULL DEFAULT 0,
            price_variance_amount REAL NOT NULL DEFAULT 0,
            total_adjustment_amount REAL NOT NULL DEFAULT 0,
            reason TEXT NOT NULL DEFAULT '',
            proposed_action TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            approved_by TEXT REFERENCES users(id),
            approved_at TEXT,
            approval_note TEXT NOT NULL DEFAULT '',
            resolved_by TEXT REFERENCES users(id),
            resolved_at TEXT,
            resolution_result TEXT NOT NULL DEFAULT '',
            resolution_note TEXT NOT NULL DEFAULT ''
          );
          CREATE TABLE IF NOT EXISTS purchase_arrival_discrepancy_lines (
            id TEXT PRIMARY KEY,
            discrepancy_id TEXT NOT NULL REFERENCES purchase_arrival_discrepancies(id),
            arrival_notice_line_id TEXT NOT NULL REFERENCES purchase_arrival_notice_lines(id),
            purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
            material_id TEXT NOT NULL REFERENCES materials(id),
            ordered_qty REAL NOT NULL,
            actual_arrived_qty REAL NOT NULL,
            variance_qty REAL NOT NULL,
            ordered_unit_cost REAL NOT NULL,
            actual_unit_cost REAL NOT NULL,
            price_variance_amount REAL NOT NULL,
            expected_batch_hint TEXT NOT NULL DEFAULT '',
            actual_batch_hint TEXT NOT NULL DEFAULT '',
            line_adjustment_amount REAL NOT NULL,
            note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_arrival_discrepancies_no
            ON purchase_arrival_discrepancies(discrepancy_no);
          CREATE INDEX IF NOT EXISTS idx_purchase_arrival_discrepancies_arrival_status
            ON purchase_arrival_discrepancies(arrival_notice_id, status, created_at);
          CREATE INDEX IF NOT EXISTS idx_purchase_arrival_discrepancy_lines_parent
            ON purchase_arrival_discrepancy_lines(discrepancy_id);
        `);
      },
    },
    {
      id: "035_supplier_admission_correction_reassessment",
      description: "供应商准入控制、整改任务、黑名单与复评闭环",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS supplier_admission_controls (
            id TEXT PRIMARY KEY,
            control_no TEXT NOT NULL,
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            control_status TEXT NOT NULL,
            purchase_allowed INTEGER NOT NULL DEFAULT 1,
            reason TEXT NOT NULL DEFAULT '',
            source_type TEXT NOT NULL DEFAULT '',
            source_id TEXT,
            performance_score REAL NOT NULL DEFAULT 0,
            risk_level TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_by TEXT REFERENCES users(id),
            updated_at TEXT NOT NULL,
            released_at TEXT,
            release_note TEXT NOT NULL DEFAULT '',
            UNIQUE(supplier_id)
          );
          CREATE TABLE IF NOT EXISTS supplier_corrective_actions (
            id TEXT PRIMARY KEY,
            action_no TEXT NOT NULL,
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            control_id TEXT NOT NULL REFERENCES supplier_admission_controls(id),
            status TEXT NOT NULL,
            severity TEXT NOT NULL,
            required_action TEXT NOT NULL,
            due_date TEXT NOT NULL,
            owner_id TEXT REFERENCES users(id),
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            submitted_by TEXT REFERENCES users(id),
            submitted_at TEXT,
            evidence_note TEXT NOT NULL DEFAULT '',
            reviewed_by TEXT REFERENCES users(id),
            reviewed_at TEXT,
            review_result TEXT NOT NULL DEFAULT '',
            review_note TEXT NOT NULL DEFAULT '',
            closed_at TEXT
          );
          CREATE TABLE IF NOT EXISTS supplier_reassessments (
            id TEXT PRIMARY KEY,
            reassessment_no TEXT NOT NULL,
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            control_id TEXT NOT NULL REFERENCES supplier_admission_controls(id),
            corrective_action_id TEXT NOT NULL REFERENCES supplier_corrective_actions(id),
            previous_status TEXT NOT NULL,
            next_status TEXT NOT NULL,
            result TEXT NOT NULL,
            reassessment_score REAL NOT NULL,
            conclusion TEXT NOT NULL DEFAULT '',
            reviewer_id TEXT NOT NULL REFERENCES users(id),
            reviewed_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_admission_controls_no
            ON supplier_admission_controls(control_no);
          CREATE INDEX IF NOT EXISTS idx_supplier_admission_controls_status
            ON supplier_admission_controls(control_status, updated_at);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_corrective_actions_no
            ON supplier_corrective_actions(action_no);
          CREATE INDEX IF NOT EXISTS idx_supplier_corrective_actions_supplier_status
            ON supplier_corrective_actions(supplier_id, status, due_date);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_reassessments_no
            ON supplier_reassessments(reassessment_no);
          CREATE INDEX IF NOT EXISTS idx_supplier_reassessments_supplier
            ON supplier_reassessments(supplier_id, reviewed_at);
        `);
      },
    },
    {
      id: "036_supplier_admission_auto_rules",
      description: "供应商准入自动触发规则、触发事件与风控留痕",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS supplier_admission_rules (
            id TEXT PRIMARY KEY,
            rule_code TEXT NOT NULL,
            rule_name TEXT NOT NULL,
            metric_key TEXT NOT NULL,
            operator TEXT NOT NULL,
            threshold_value REAL NOT NULL,
            target_status TEXT NOT NULL,
            require_correction INTEGER NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 50,
            status TEXT NOT NULL DEFAULT 'active',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS supplier_admission_rule_events (
            id TEXT PRIMARY KEY,
            event_no TEXT NOT NULL,
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            rule_id TEXT NOT NULL REFERENCES supplier_admission_rules(id),
            control_id TEXT REFERENCES supplier_admission_controls(id),
            corrective_action_id TEXT REFERENCES supplier_corrective_actions(id),
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL DEFAULT '',
            metric_key TEXT NOT NULL,
            metric_value REAL NOT NULL,
            threshold_value REAL NOT NULL,
            target_status TEXT NOT NULL,
            action_summary TEXT NOT NULL DEFAULT '',
            triggered_by TEXT NOT NULL REFERENCES users(id),
            triggered_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_admission_rules_code
            ON supplier_admission_rules(rule_code);
          CREATE INDEX IF NOT EXISTS idx_supplier_admission_rules_status_priority
            ON supplier_admission_rules(status, priority);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_rule_events_source
            ON supplier_admission_rule_events(supplier_id, rule_id, source_type, source_id);
          CREATE INDEX IF NOT EXISTS idx_supplier_rule_events_supplier
            ON supplier_admission_rule_events(supplier_id, triggered_at);
        `);
        seedDefaultSupplierAdmissionRules(database);
      },
    },
    {
      id: "037_supplier_admission_rule_change_approval",
      description: "供应商准入规则变更影响预览、审批与生效记录",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS supplier_admission_rule_change_requests (
            id TEXT PRIMARY KEY,
            change_no TEXT NOT NULL,
            rule_id TEXT REFERENCES supplier_admission_rules(id),
            approval_request_id TEXT REFERENCES approval_requests(id),
            status TEXT NOT NULL,
            old_rule_json TEXT NOT NULL DEFAULT '{}',
            new_rule_json TEXT NOT NULL,
            impact_json TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            approved_by TEXT REFERENCES users(id),
            approved_at TEXT,
            applied_at TEXT,
            approval_note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_rule_changes_no
            ON supplier_admission_rule_change_requests(change_no);
          CREATE INDEX IF NOT EXISTS idx_supplier_rule_changes_status
            ON supplier_admission_rule_change_requests(status, created_at);
          CREATE INDEX IF NOT EXISTS idx_supplier_rule_changes_approval
            ON supplier_admission_rule_change_requests(approval_request_id);
        `);
      },
    },
    {
      id: "038_supplier_admission_release_records",
      description: "供应商复评通过后的采购限制解除与恢复采购台账",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS supplier_admission_releases (
            id TEXT PRIMARY KEY,
            release_no TEXT NOT NULL,
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            control_id TEXT NOT NULL REFERENCES supplier_admission_controls(id),
            corrective_action_id TEXT NOT NULL REFERENCES supplier_corrective_actions(id),
            reassessment_id TEXT NOT NULL REFERENCES supplier_reassessments(id),
            previous_status TEXT NOT NULL,
            next_status TEXT NOT NULL,
            purchase_allowed_before INTEGER NOT NULL,
            purchase_allowed_after INTEGER NOT NULL,
            release_result TEXT NOT NULL DEFAULT 'restored',
            release_reason TEXT NOT NULL DEFAULT '',
            released_by TEXT NOT NULL REFERENCES users(id),
            released_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(reassessment_id)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_admission_releases_no
            ON supplier_admission_releases(release_no);
          CREATE INDEX IF NOT EXISTS idx_supplier_admission_releases_supplier
            ON supplier_admission_releases(supplier_id, released_at);
          CREATE INDEX IF NOT EXISTS idx_supplier_admission_releases_control
            ON supplier_admission_releases(control_id, released_at);
        `);
      },
    },
    {
      id: "039_supplier_observation_periods",
      description: "供应商恢复采购后的观察期、首批合格结案与异常重新限制",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS supplier_observation_periods (
            id TEXT PRIMARY KEY,
            observation_no TEXT NOT NULL,
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            release_id TEXT NOT NULL REFERENCES supplier_admission_releases(id),
            reassessment_id TEXT NOT NULL REFERENCES supplier_reassessments(id),
            control_id TEXT NOT NULL REFERENCES supplier_admission_controls(id),
            status TEXT NOT NULL,
            start_at TEXT NOT NULL,
            planned_end_at TEXT NOT NULL,
            required_batch_count INTEGER NOT NULL DEFAULT 1,
            completed_batch_count INTEGER NOT NULL DEFAULT 0,
            last_batch_source_type TEXT NOT NULL DEFAULT '',
            last_batch_source_id TEXT,
            breach_source_type TEXT NOT NULL DEFAULT '',
            breach_source_id TEXT,
            breach_reason TEXT NOT NULL DEFAULT '',
            close_reason TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_by TEXT REFERENCES users(id),
            updated_at TEXT NOT NULL,
            closed_at TEXT,
            UNIQUE(release_id)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_observation_periods_no
            ON supplier_observation_periods(observation_no);
          CREATE INDEX IF NOT EXISTS idx_supplier_observation_periods_supplier_status
            ON supplier_observation_periods(supplier_id, status, planned_end_at);
          CREATE INDEX IF NOT EXISTS idx_supplier_observation_periods_release
            ON supplier_observation_periods(release_id);
        `);
      },
    },
    {
      id: "040_supplier_annual_review_certificates",
      description: "供应商年度复评、资质证书到期提醒与准入等级自动调整",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS supplier_qualification_certificates (
            id TEXT PRIMARY KEY,
            qualification_no TEXT NOT NULL,
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            certificate_type TEXT NOT NULL,
            certificate_name TEXT NOT NULL,
            certificate_no TEXT NOT NULL,
            issued_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            remind_days INTEGER NOT NULL DEFAULT 90,
            status TEXT NOT NULL DEFAULT 'active',
            note TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_by TEXT REFERENCES users(id),
            updated_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_certificates_no
            ON supplier_qualification_certificates(qualification_no);
          CREATE INDEX IF NOT EXISTS idx_supplier_certificates_supplier_expiry
            ON supplier_qualification_certificates(supplier_id, expires_at, status);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_certificates_business_no
            ON supplier_qualification_certificates(supplier_id, certificate_no)
            WHERE status != 'voided';

          CREATE TABLE IF NOT EXISTS supplier_annual_reviews (
            id TEXT PRIMARY KEY,
            annual_review_no TEXT NOT NULL,
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            review_year INTEGER NOT NULL,
            quality_score REAL NOT NULL DEFAULT 0,
            delivery_score REAL NOT NULL DEFAULT 0,
            certificate_score REAL NOT NULL DEFAULT 0,
            cooperation_score REAL NOT NULL DEFAULT 0,
            final_score REAL NOT NULL DEFAULT 0,
            previous_status TEXT NOT NULL,
            next_status TEXT NOT NULL,
            result TEXT NOT NULL,
            certificate_status TEXT NOT NULL DEFAULT 'normal',
            conclusion TEXT NOT NULL DEFAULT '',
            reviewer_id TEXT NOT NULL REFERENCES users(id),
            reviewed_at TEXT NOT NULL,
            next_review_due_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_annual_reviews_no
            ON supplier_annual_reviews(annual_review_no);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_annual_reviews_year
            ON supplier_annual_reviews(supplier_id, review_year);
          CREATE INDEX IF NOT EXISTS idx_supplier_annual_reviews_supplier
            ON supplier_annual_reviews(supplier_id, reviewed_at);
        `);
      },
    },
    {
      id: "041_supplier_review_approval_archive",
      description: "供应商资质附件归档与年度复评准入变更审批联动",
      up: () => {
        ensureColumn(database, "supplier_annual_reviews", "status", "TEXT NOT NULL DEFAULT 'approved'");
        ensureColumn(database, "supplier_annual_reviews", "approval_request_id", "TEXT");
        ensureColumn(database, "supplier_annual_reviews", "approved_by", "TEXT");
        ensureColumn(database, "supplier_annual_reviews", "approved_at", "TEXT");
        ensureColumn(database, "supplier_annual_reviews", "approval_note", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "supplier_annual_reviews", "applied_at", "TEXT");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_supplier_annual_reviews_approval
            ON supplier_annual_reviews(approval_request_id);
          CREATE INDEX IF NOT EXISTS idx_supplier_annual_reviews_status
            ON supplier_annual_reviews(status, reviewed_at);
          CREATE INDEX IF NOT EXISTS idx_document_attachments_supplier_certificate
            ON document_attachments(entity_type, entity_id, uploaded_at);
        `);
      },
    },
    {
      id: "042_supplier_certificate_renewal_lifecycle",
      description: "供应商资质到期续证生命周期管理",
      up: () => {
        ensureColumn(database, "supplier_qualification_certificates", "renewed_from_id", "TEXT");
        ensureColumn(database, "supplier_qualification_certificates", "renewed_to_id", "TEXT");
        ensureColumn(database, "supplier_qualification_certificates", "renewed_at", "TEXT");
        ensureColumn(database, "supplier_qualification_certificates", "renewal_note", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_supplier_certificates_renewed_from
            ON supplier_qualification_certificates(renewed_from_id);
          CREATE INDEX IF NOT EXISTS idx_supplier_certificates_renewed_to
            ON supplier_qualification_certificates(renewed_to_id);
        `);
      },
    },
    {
      id: "043_supplier_qualification_requirement_matrix",
      description: "供应商必备资质矩阵与采购拦截规则",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS supplier_qualification_requirements (
            id TEXT PRIMARY KEY,
            requirement_no TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            material_id TEXT REFERENCES materials(id),
            certificate_type TEXT NOT NULL,
            certificate_name TEXT NOT NULL DEFAULT '',
            min_valid_days INTEGER NOT NULL DEFAULT 0,
            block_purchase INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'active',
            description TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_by TEXT REFERENCES users(id),
            updated_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_qualification_requirements_no
            ON supplier_qualification_requirements(requirement_no);
          CREATE INDEX IF NOT EXISTS idx_supplier_qualification_requirements_scope
            ON supplier_qualification_requirements(scope_type, material_id, status);
          CREATE INDEX IF NOT EXISTS idx_supplier_qualification_requirements_certificate
            ON supplier_qualification_requirements(certificate_type, certificate_name, status);
        `);
      },
    },
    {
      id: "044_production_schedule_change_traceability",
      description: "生产排产变更留痕与交期预警基础表",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_schedule_changes (
            id TEXT PRIMARY KEY,
            schedule_id TEXT REFERENCES schedules(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            old_planned_date TEXT,
            new_planned_date TEXT NOT NULL,
            old_machine TEXT,
            new_machine TEXT NOT NULL,
            old_owner TEXT,
            new_owner TEXT NOT NULL,
            old_shift TEXT,
            new_shift TEXT NOT NULL DEFAULT '',
            old_schedule_note TEXT,
            new_schedule_note TEXT NOT NULL DEFAULT '',
            change_reason TEXT NOT NULL,
            changed_by TEXT REFERENCES users(id),
            changed_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_schedule_changes_production_changed
            ON production_schedule_changes(production_order_id, changed_at);
          CREATE INDEX IF NOT EXISTS idx_schedule_changes_schedule
            ON production_schedule_changes(schedule_id);
        `);
      },
    },
    {
      id: "045_production_plan_lock_publish_notifications",
      description: "生产计划锁版、审批发布、变更通知待办",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_plan_versions (
            id TEXT PRIMARY KEY,
            plan_no TEXT NOT NULL,
            version_no INTEGER NOT NULL,
            status TEXT NOT NULL,
            filter_summary TEXT NOT NULL DEFAULT '',
            filters_json TEXT NOT NULL DEFAULT '{}',
            note TEXT NOT NULL DEFAULT '',
            production_count INTEGER NOT NULL DEFAULT 0,
            machine_count INTEGER NOT NULL DEFAULT 0,
            warning_count INTEGER NOT NULL DEFAULT 0,
            approval_request_id TEXT REFERENCES approval_requests(id),
            locked_by TEXT NOT NULL REFERENCES users(id),
            locked_at TEXT NOT NULL,
            published_by TEXT REFERENCES users(id),
            published_at TEXT,
            approval_note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_plan_versions_no
            ON production_plan_versions(plan_no);
          CREATE INDEX IF NOT EXISTS idx_production_plan_versions_status
            ON production_plan_versions(status, locked_at);

          CREATE TABLE IF NOT EXISTS production_plan_lines (
            id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL REFERENCES production_plan_versions(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            schedule_id TEXT REFERENCES schedules(id),
            prod_no TEXT NOT NULL,
            order_no TEXT NOT NULL,
            customer_name TEXT NOT NULL DEFAULT '',
            product_name TEXT NOT NULL DEFAULT '',
            planned_date TEXT NOT NULL,
            due_date TEXT NOT NULL DEFAULT '',
            machine TEXT NOT NULL DEFAULT '',
            owner TEXT NOT NULL DEFAULT '',
            shift TEXT NOT NULL DEFAULT '',
            order_qty REAL NOT NULL DEFAULT 0,
            unit TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '',
            delivery_risk_status TEXT NOT NULL DEFAULT 'normal',
            delivery_risk_label TEXT NOT NULL DEFAULT '正常',
            schedule_note TEXT NOT NULL DEFAULT ''
          );
          CREATE INDEX IF NOT EXISTS idx_production_plan_lines_plan
            ON production_plan_lines(plan_id);
          CREATE INDEX IF NOT EXISTS idx_production_plan_lines_production
            ON production_plan_lines(production_order_id, plan_id);

          CREATE TABLE IF NOT EXISTS production_plan_notifications (
            id TEXT PRIMARY KEY,
            notification_no TEXT NOT NULL,
            plan_id TEXT NOT NULL REFERENCES production_plan_versions(id),
            schedule_change_id TEXT NOT NULL REFERENCES production_schedule_changes(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            recipient_role TEXT NOT NULL,
            title TEXT NOT NULL,
            detail TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            acknowledged_by TEXT REFERENCES users(id),
            acknowledged_at TEXT,
            acknowledge_note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_plan_notifications_no
            ON production_plan_notifications(notification_no);
          CREATE INDEX IF NOT EXISTS idx_production_plan_notifications_role_status
            ON production_plan_notifications(recipient_role, status, created_at);
          CREATE INDEX IF NOT EXISTS idx_production_plan_notifications_plan_change
            ON production_plan_notifications(plan_id, schedule_change_id);
        `);
      },
    },
    {
      id: "046_production_plan_change_impacts",
      description: "生产计划变更影响联动清单与责任待办",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_plan_change_impacts (
            id TEXT PRIMARY KEY,
            impact_no TEXT NOT NULL,
            plan_id TEXT NOT NULL REFERENCES production_plan_versions(id),
            schedule_change_id TEXT NOT NULL REFERENCES production_schedule_changes(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            impact_type TEXT NOT NULL,
            affected_role TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'medium',
            summary TEXT NOT NULL,
            suggested_action TEXT NOT NULL DEFAULT '',
            source_document_type TEXT NOT NULL DEFAULT '',
            source_document_id TEXT,
            source_document_no TEXT NOT NULL DEFAULT '',
            old_value TEXT NOT NULL DEFAULT '',
            new_value TEXT NOT NULL DEFAULT '',
            linked_document_type TEXT NOT NULL DEFAULT '',
            linked_document_id TEXT,
            linked_document_no TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            resolved_by TEXT REFERENCES users(id),
            resolved_at TEXT,
            resolution_note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_plan_change_impacts_no
            ON production_plan_change_impacts(impact_no);
          CREATE INDEX IF NOT EXISTS idx_production_plan_change_impacts_change
            ON production_plan_change_impacts(schedule_change_id, impact_type, status);
          CREATE INDEX IF NOT EXISTS idx_production_plan_change_impacts_role_status
            ON production_plan_change_impacts(affected_role, status, created_at);
          CREATE INDEX IF NOT EXISTS idx_production_plan_change_impacts_plan
            ON production_plan_change_impacts(plan_id, production_order_id);
        `);
      },
    },
    {
      id: "047_production_plan_impact_business_documents",
      description: "生产计划影响处理后的业务单据联动",
      up: () => {
        ensureColumn(database, "production_plan_change_impacts", "linked_document_type", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "production_plan_change_impacts", "linked_document_id", "TEXT");
        ensureColumn(database, "production_plan_change_impacts", "linked_document_no", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_material_adjustment_suggestions (
            id TEXT PRIMARY KEY,
            suggestion_no TEXT NOT NULL,
            impact_id TEXT NOT NULL REFERENCES production_plan_change_impacts(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            requisition_id TEXT REFERENCES requisitions(id),
            adjustment_type TEXT NOT NULL,
            suggested_qty REAL NOT NULL DEFAULT 0,
            material_summary TEXT NOT NULL DEFAULT '',
            reason TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            confirmed_by TEXT REFERENCES users(id),
            confirmed_at TEXT,
            confirmation_note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_material_adjustment_suggestions_no
            ON production_material_adjustment_suggestions(suggestion_no);
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_suggestions_impact
            ON production_material_adjustment_suggestions(impact_id);
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_suggestions_status
            ON production_material_adjustment_suggestions(status, created_at);

          CREATE TABLE IF NOT EXISTS production_material_adjustment_orders (
            id TEXT PRIMARY KEY,
            order_no TEXT NOT NULL,
            suggestion_id TEXT NOT NULL REFERENCES production_material_adjustment_suggestions(id),
            impact_id TEXT NOT NULL REFERENCES production_plan_change_impacts(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            requisition_id TEXT REFERENCES requisitions(id),
            adjustment_type TEXT NOT NULL,
            qty REAL NOT NULL DEFAULT 0,
            material_summary TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            executed_by TEXT REFERENCES users(id),
            executed_at TEXT,
            execution_note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_material_adjustment_orders_no
            ON production_material_adjustment_orders(order_no);
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_orders_suggestion
            ON production_material_adjustment_orders(suggestion_id);
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_orders_status
            ON production_material_adjustment_orders(status, created_at);

          CREATE TABLE IF NOT EXISTS quality_inspection_window_confirmations (
            id TEXT PRIMARY KEY,
            window_no TEXT NOT NULL,
            impact_id TEXT NOT NULL REFERENCES production_plan_change_impacts(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            inspection_id TEXT REFERENCES inspections(id),
            inspection_window_date TEXT NOT NULL,
            inspector TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_quality_inspection_window_confirmations_no
            ON quality_inspection_window_confirmations(window_no);
          CREATE INDEX IF NOT EXISTS idx_quality_inspection_window_confirmations_impact
            ON quality_inspection_window_confirmations(impact_id);

          CREATE TABLE IF NOT EXISTS customer_delivery_confirmations (
            id TEXT PRIMARY KEY,
            confirmation_no TEXT NOT NULL,
            impact_id TEXT NOT NULL REFERENCES production_plan_change_impacts(id),
            order_id TEXT NOT NULL REFERENCES orders(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            customer_id TEXT NOT NULL REFERENCES customers(id),
            original_due_date TEXT NOT NULL,
            proposed_delivery_date TEXT NOT NULL,
            confirmation_status TEXT NOT NULL,
            contact_method TEXT NOT NULL DEFAULT '',
            customer_feedback TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_delivery_confirmations_no
            ON customer_delivery_confirmations(confirmation_no);
          CREATE INDEX IF NOT EXISTS idx_customer_delivery_confirmations_impact
            ON customer_delivery_confirmations(impact_id);
          CREATE INDEX IF NOT EXISTS idx_customer_delivery_confirmations_order
            ON customer_delivery_confirmations(order_id, created_at);

          CREATE TABLE IF NOT EXISTS purchase_arrival_notice_change_logs (
            id TEXT PRIMARY KEY,
            change_no TEXT NOT NULL,
            arrival_notice_id TEXT NOT NULL REFERENCES purchase_arrival_notices(id),
            purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
            impact_id TEXT REFERENCES production_plan_change_impacts(id),
            change_type TEXT NOT NULL,
            old_arrived_at TEXT NOT NULL DEFAULT '',
            new_arrived_at TEXT NOT NULL DEFAULT '',
            old_note TEXT NOT NULL DEFAULT '',
            new_note TEXT NOT NULL DEFAULT '',
            reason TEXT NOT NULL DEFAULT '',
            changed_by TEXT NOT NULL REFERENCES users(id),
            changed_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_arrival_notice_change_logs_no
            ON purchase_arrival_notice_change_logs(change_no);
          CREATE INDEX IF NOT EXISTS idx_purchase_arrival_notice_change_logs_notice
            ON purchase_arrival_notice_change_logs(arrival_notice_id, changed_at);
          CREATE INDEX IF NOT EXISTS idx_purchase_arrival_notice_change_logs_impact
            ON purchase_arrival_notice_change_logs(impact_id);
        `);
      },
    },
    {
      id: "048_material_adjustment_order_and_arrival_change_logs",
      description: "补退料建议确认转正式单与到货通知变更留痕",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_material_adjustment_orders (
            id TEXT PRIMARY KEY,
            order_no TEXT NOT NULL,
            suggestion_id TEXT NOT NULL REFERENCES production_material_adjustment_suggestions(id),
            impact_id TEXT NOT NULL REFERENCES production_plan_change_impacts(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            requisition_id TEXT REFERENCES requisitions(id),
            adjustment_type TEXT NOT NULL,
            qty REAL NOT NULL DEFAULT 0,
            material_summary TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            executed_by TEXT REFERENCES users(id),
            executed_at TEXT,
            execution_note TEXT NOT NULL DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_material_adjustment_orders_no
            ON production_material_adjustment_orders(order_no);
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_orders_suggestion
            ON production_material_adjustment_orders(suggestion_id);
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_orders_status
            ON production_material_adjustment_orders(status, created_at);

          CREATE TABLE IF NOT EXISTS purchase_arrival_notice_change_logs (
            id TEXT PRIMARY KEY,
            change_no TEXT NOT NULL,
            arrival_notice_id TEXT NOT NULL REFERENCES purchase_arrival_notices(id),
            purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
            impact_id TEXT REFERENCES production_plan_change_impacts(id),
            change_type TEXT NOT NULL,
            old_arrived_at TEXT NOT NULL DEFAULT '',
            new_arrived_at TEXT NOT NULL DEFAULT '',
            old_note TEXT NOT NULL DEFAULT '',
            new_note TEXT NOT NULL DEFAULT '',
            reason TEXT NOT NULL DEFAULT '',
            changed_by TEXT NOT NULL REFERENCES users(id),
            changed_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_arrival_notice_change_logs_no
            ON purchase_arrival_notice_change_logs(change_no);
          CREATE INDEX IF NOT EXISTS idx_purchase_arrival_notice_change_logs_notice
            ON purchase_arrival_notice_change_logs(arrival_notice_id, changed_at);
          CREATE INDEX IF NOT EXISTS idx_purchase_arrival_notice_change_logs_impact
            ON purchase_arrival_notice_change_logs(impact_id);
        `);
      },
    },
    {
      id: "049_material_adjustment_execution_lines",
      description: "正式补退料单执行明细与库存流水关联",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_material_adjustment_order_lines (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL REFERENCES production_material_adjustment_orders(id),
            material_id TEXT NOT NULL REFERENCES materials(id),
            batch_id TEXT REFERENCES material_batches(id),
            batch_no TEXT NOT NULL,
            direction TEXT NOT NULL,
            qty REAL NOT NULL,
            unit_cost REAL NOT NULL,
            line_amount REAL NOT NULL,
            movement_id TEXT NOT NULL REFERENCES inventory_movements(id),
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_order_lines_order
            ON production_material_adjustment_order_lines(order_id);
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_order_lines_material
            ON production_material_adjustment_order_lines(material_id, created_at);
        `);
      },
    },
    {
      id: "050_material_adjustment_review_records",
      description: "正式补退料单执行后仓库复核与成本影响记录",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_material_adjustment_order_reviews (
            id TEXT PRIMARY KEY,
            review_no TEXT NOT NULL,
            order_id TEXT NOT NULL REFERENCES production_material_adjustment_orders(id),
            review_result TEXT NOT NULL,
            review_note TEXT NOT NULL DEFAULT '',
            cost_impact_amount REAL NOT NULL DEFAULT 0,
            inventory_value_delta REAL NOT NULL DEFAULT 0,
            reviewed_by TEXT NOT NULL REFERENCES users(id),
            reviewed_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_material_adjustment_order_reviews_no
            ON production_material_adjustment_order_reviews(review_no);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_material_adjustment_order_reviews_order
            ON production_material_adjustment_order_reviews(order_id);
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_order_reviews_reviewed
            ON production_material_adjustment_order_reviews(reviewed_at);
        `);
      },
    },
    {
      id: "051_material_adjustment_review_exceptions",
      description: "补退料复核异常处理闭环",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_material_adjustment_review_exceptions (
            id TEXT PRIMARY KEY,
            exception_no TEXT NOT NULL,
            review_id TEXT NOT NULL REFERENCES production_material_adjustment_order_reviews(id),
            order_id TEXT NOT NULL REFERENCES production_material_adjustment_orders(id),
            reason_type TEXT NOT NULL,
            exception_description TEXT NOT NULL DEFAULT '',
            owner_role TEXT NOT NULL,
            status TEXT NOT NULL,
            due_date TEXT NOT NULL DEFAULT '',
            cost_adjustment_amount REAL NOT NULL DEFAULT 0,
            resolution_type TEXT NOT NULL DEFAULT '',
            resolution_note TEXT NOT NULL DEFAULT '',
            final_cost_adjustment_amount REAL NOT NULL DEFAULT 0,
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            resolved_by TEXT REFERENCES users(id),
            resolved_at TEXT
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_material_adjustment_review_exceptions_no
            ON production_material_adjustment_review_exceptions(exception_no);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_material_adjustment_review_exceptions_review
            ON production_material_adjustment_review_exceptions(review_id);
          CREATE INDEX IF NOT EXISTS idx_production_material_adjustment_review_exceptions_status_owner
            ON production_material_adjustment_review_exceptions(status, owner_role);
        `);
      },
    },
    {
      id: "052_production_cost_adjustment_postings",
      description: "工单成本调整流水与补退料异常过账",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_cost_adjustments (
            id TEXT PRIMARY KEY,
            adjustment_no TEXT NOT NULL,
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            order_id TEXT NOT NULL REFERENCES orders(id),
            cost_summary_id TEXT NOT NULL DEFAULT '',
            exception_id TEXT REFERENCES production_material_adjustment_review_exceptions(id),
            adjustment_amount REAL NOT NULL,
            previous_total_cost REAL NOT NULL DEFAULT 0,
            new_total_cost REAL NOT NULL DEFAULT 0,
            previous_unit_cost REAL NOT NULL DEFAULT 0,
            new_unit_cost REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            adjustment_note TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_cost_adjustments_no
            ON production_cost_adjustments(adjustment_no);
          CREATE UNIQUE INDEX IF NOT EXISTS ux_production_cost_adjustments_exception
            ON production_cost_adjustments(exception_id);
          CREATE INDEX IF NOT EXISTS idx_production_cost_adjustments_production
            ON production_cost_adjustments(production_order_id, created_at);
        `);
      },
    },
    {
      id: "053_production_cost_adjustment_approval_reversal",
      description: "工单成本调整审批与红冲规则字段",
      up: () => {
        ensureColumn(database, "production_cost_adjustments", "approval_request_id", "TEXT REFERENCES approval_requests(id)");
        ensureColumn(database, "production_cost_adjustments", "applied_by", "TEXT REFERENCES users(id)");
        ensureColumn(database, "production_cost_adjustments", "applied_at", "TEXT");
        ensureColumn(database, "production_cost_adjustments", "reversal_id", "TEXT REFERENCES document_reversals(id)");
        ensureColumn(database, "production_cost_adjustments", "reversed_by", "TEXT REFERENCES users(id)");
        ensureColumn(database, "production_cost_adjustments", "reversed_at", "TEXT");
        ensureColumn(database, "production_cost_adjustments", "reversal_reason", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_production_cost_adjustments_status
            ON production_cost_adjustments(status, created_at);
          CREATE INDEX IF NOT EXISTS idx_production_cost_adjustments_approval
            ON production_cost_adjustments(approval_request_id);
        `);
      },
    },
    {
      id: "054_detailed_cost_adjustment_approval_rules",
      description: "成本调整审批规则细化条件与红冲控制",
      up: () => {
        ensureColumn(database, "approval_rules", "condition_scope", "TEXT NOT NULL DEFAULT 'all'");
        ensureColumn(database, "approval_rules", "material_id", "TEXT REFERENCES materials(id)");
        ensureColumn(database, "approval_rules", "adjustment_type", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "approval_rules", "risk_level", "TEXT NOT NULL DEFAULT 'normal'");
        ensureColumn(database, "approval_rules", "allow_reversal", "INTEGER NOT NULL DEFAULT 1");
        ensureColumn(database, "approval_rules", "reversal_approver_role", "TEXT NOT NULL DEFAULT 'manager'");
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_approval_rules_cost_context
            ON approval_rules(source_type, condition_scope, material_id, adjustment_type, status);
        `);
      },
    },
    {
      id: "055_cost_anomaly_remediation_loop",
      description: "成本异常下钻整改任务、复核与闭环记录",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_cost_anomaly_remediations (
            id TEXT PRIMARY KEY,
            remediation_no TEXT NOT NULL UNIQUE,
            adjustment_id TEXT NOT NULL REFERENCES production_cost_adjustments(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            order_id TEXT NOT NULL REFERENCES orders(id),
            exception_id TEXT REFERENCES production_material_adjustment_review_exceptions(id),
            severity TEXT NOT NULL DEFAULT 'medium',
            root_cause TEXT NOT NULL DEFAULT '',
            corrective_action TEXT NOT NULL DEFAULT '',
            preventive_action TEXT NOT NULL DEFAULT '',
            owner_id TEXT NOT NULL REFERENCES users(id),
            due_date TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            result_note TEXT NOT NULL DEFAULT '',
            review_note TEXT NOT NULL DEFAULT '',
            source_snapshot_json TEXT NOT NULL DEFAULT '{}',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            submitted_by TEXT REFERENCES users(id),
            submitted_at TEXT,
            closed_by TEXT REFERENCES users(id),
            closed_at TEXT
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_cost_anomaly_remediations_adjustment
            ON production_cost_anomaly_remediations(adjustment_id);
          CREATE INDEX IF NOT EXISTS idx_cost_anomaly_remediations_status_owner
            ON production_cost_anomaly_remediations(status, owner_id, due_date);
          CREATE INDEX IF NOT EXISTS idx_cost_anomaly_remediations_created
            ON production_cost_anomaly_remediations(created_at);

          CREATE TABLE IF NOT EXISTS production_cost_anomaly_remediation_reviews (
            id TEXT PRIMARY KEY,
            remediation_id TEXT NOT NULL REFERENCES production_cost_anomaly_remediations(id),
            remediation_no TEXT NOT NULL,
            decision TEXT NOT NULL,
            review_note TEXT NOT NULL DEFAULT '',
            reviewer_id TEXT NOT NULL REFERENCES users(id),
            reviewed_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_cost_anomaly_remediation_reviews_remediation
            ON production_cost_anomaly_remediation_reviews(remediation_id, reviewed_at);
          CREATE INDEX IF NOT EXISTS idx_cost_anomaly_remediation_reviews_decision
            ON production_cost_anomaly_remediation_reviews(decision, reviewed_at);
        `);
      },
    },
    {
      id: "056_cost_anomaly_warning_rules",
      description: "成本异常预警规则配置、触发事件与自动整改",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS production_cost_anomaly_warning_rules (
            id TEXT PRIMARY KEY,
            rule_code TEXT NOT NULL UNIQUE,
            rule_name TEXT NOT NULL,
            metric_key TEXT NOT NULL,
            operator TEXT NOT NULL,
            threshold_value REAL NOT NULL,
            window_days INTEGER NOT NULL DEFAULT 0,
            severity TEXT NOT NULL DEFAULT 'medium',
            owner_id TEXT NOT NULL REFERENCES users(id),
            auto_create_remediation INTEGER NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 50,
            status TEXT NOT NULL DEFAULT 'inactive',
            description TEXT NOT NULL DEFAULT '',
            created_by TEXT REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_by TEXT REFERENCES users(id),
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_cost_anomaly_warning_rules_active
            ON production_cost_anomaly_warning_rules(status, priority, metric_key);

          CREATE TABLE IF NOT EXISTS production_cost_anomaly_warning_events (
            id TEXT PRIMARY KEY,
            event_no TEXT NOT NULL UNIQUE,
            rule_id TEXT NOT NULL REFERENCES production_cost_anomaly_warning_rules(id),
            rule_code TEXT NOT NULL,
            rule_name TEXT NOT NULL,
            metric_key TEXT NOT NULL,
            threshold_value REAL NOT NULL,
            actual_value REAL NOT NULL,
            adjustment_id TEXT NOT NULL REFERENCES production_cost_adjustments(id),
            production_order_id TEXT NOT NULL REFERENCES production_orders(id),
            order_id TEXT NOT NULL REFERENCES orders(id),
            material_id TEXT REFERENCES materials(id),
            remediation_id TEXT REFERENCES production_cost_anomaly_remediations(id),
            event_status TEXT NOT NULL,
            trigger_source TEXT NOT NULL,
            trigger_reason TEXT NOT NULL DEFAULT '',
            triggered_by TEXT NOT NULL REFERENCES users(id),
            triggered_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS ux_cost_anomaly_warning_event_rule_adjustment
            ON production_cost_anomaly_warning_events(rule_id, adjustment_id);
          CREATE INDEX IF NOT EXISTS idx_cost_anomaly_warning_events_rule
            ON production_cost_anomaly_warning_events(rule_code, triggered_at);
          CREATE INDEX IF NOT EXISTS idx_cost_anomaly_warning_events_adjustment
            ON production_cost_anomaly_warning_events(adjustment_id);
        `);
        seedDefaultCostAnomalyWarningRules(database);
      },
    },
    {
      id: "057_alert_subscription_task_routing",
      description: "预警订阅是否进入待办配置",
      up: () => {
        ensureColumn(database, "alert_subscriptions", "route_to_tasks", "INTEGER NOT NULL DEFAULT 1");
        seedDefaultAlertSubscriptions(database);
      },
    },
    {
      id: "058_formal_role_permission_matrix",
      description: "正式角色权限矩阵、启停状态和权限审计基础字段",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS role_permissions (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            action TEXT NOT NULL,
            action_label TEXT NOT NULL,
            module_label TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_by TEXT REFERENCES users(id),
            updated_at TEXT NOT NULL,
            UNIQUE(role, action)
          );
          CREATE INDEX IF NOT EXISTS idx_role_permissions_role_enabled
            ON role_permissions(role, enabled);
          CREATE INDEX IF NOT EXISTS idx_role_permissions_action
            ON role_permissions(action, enabled);
        `);
      },
    },
    {
      id: "059_initialization_import_validation_errors",
      description: "正式初始化导入预校验批次、错误行明细与来源文件留痕",
      up: () => {
        ensureColumn(database, "initialization_imports", "source_name", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, "initialization_imports", "mode", "TEXT NOT NULL DEFAULT 'import'");
        ensureColumn(database, "initialization_imports", "valid_count", "INTEGER NOT NULL DEFAULT 0");
        ensureColumn(database, "initialization_imports", "failed_count", "INTEGER NOT NULL DEFAULT 0");
        ensureColumn(database, "initialization_imports", "error_summary", "TEXT NOT NULL DEFAULT ''");
        database.exec(`
          CREATE TABLE IF NOT EXISTS initialization_import_errors (
            id TEXT PRIMARY KEY,
            import_id TEXT NOT NULL REFERENCES initialization_imports(id),
            row_no INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            message TEXT NOT NULL,
            raw_data_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_initialization_import_errors_import
            ON initialization_import_errors(import_id, row_no);
          CREATE INDEX IF NOT EXISTS idx_initialization_import_errors_created
            ON initialization_import_errors(created_at);
        `);
      },
    },
    {
      id: "060_parallel_snapshot_manifests",
      description: "平行账套可信快照清单、版本和完整性校验",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS parallel_snapshot_manifests (
            id TEXT PRIMARY KEY,
            ledger_id TEXT NOT NULL UNIQUE REFERENCES parallel_ledgers(id),
            base_as_of TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            schema_version TEXT NOT NULL,
            engine_version TEXT NOT NULL,
            entity_count INTEGER NOT NULL,
            entity_type_count INTEGER NOT NULL,
            snapshot_hash TEXT NOT NULL,
            verification_status TEXT NOT NULL,
            verified_at TEXT,
            failure_reason TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_parallel_snapshot_manifests_status
            ON parallel_snapshot_manifests(verification_status, updated_at);
        `);
      },
    },
    {
      id: "061_parallel_correction_execution_and_reconciliation",
      description: "平行账套正式纠错执行批次、幂等步骤与发布后对账",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS correction_execution_runs (
            id TEXT PRIMARY KEY,
            merge_request_id TEXT NOT NULL UNIQUE REFERENCES parallel_merge_requests(id),
            idempotency_key TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            attempt_no INTEGER NOT NULL DEFAULT 1,
            total_steps INTEGER NOT NULL DEFAULT 0,
            succeeded_steps INTEGER NOT NULL DEFAULT 0,
            waiting_steps INTEGER NOT NULL DEFAULT 0,
            failed_steps INTEGER NOT NULL DEFAULT 0,
            failure_reason TEXT NOT NULL DEFAULT '',
            started_at TEXT NOT NULL,
            finished_at TEXT,
            created_by TEXT NOT NULL REFERENCES users(id),
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS correction_execution_steps (
            id TEXT PRIMARY KEY,
            execution_run_id TEXT NOT NULL REFERENCES correction_execution_runs(id),
            merge_item_id TEXT NOT NULL UNIQUE REFERENCES parallel_merge_items(id),
            document_type TEXT NOT NULL,
            dependency_order INTEGER NOT NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            published_document_id TEXT,
            result_json TEXT NOT NULL DEFAULT '{}',
            error_message TEXT NOT NULL DEFAULT '',
            executed_at TEXT,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS reconciliation_results (
            id TEXT PRIMARY KEY,
            execution_run_id TEXT NOT NULL REFERENCES correction_execution_runs(id),
            merge_request_id TEXT NOT NULL REFERENCES parallel_merge_requests(id),
            rule_code TEXT NOT NULL,
            domain TEXT NOT NULL,
            status TEXT NOT NULL,
            blocking INTEGER NOT NULL DEFAULT 1,
            expected_json TEXT NOT NULL DEFAULT '{}',
            actual_json TEXT NOT NULL DEFAULT '{}',
            delta_json TEXT NOT NULL DEFAULT '{}',
            message TEXT NOT NULL DEFAULT '',
            checked_at TEXT NOT NULL,
            UNIQUE (execution_run_id, rule_code)
          );
          CREATE INDEX IF NOT EXISTS idx_correction_execution_runs_status
            ON correction_execution_runs(status, updated_at);
          CREATE INDEX IF NOT EXISTS idx_correction_execution_steps_run
            ON correction_execution_steps(execution_run_id, dependency_order, status);
          CREATE INDEX IF NOT EXISTS idx_reconciliation_results_merge
            ON reconciliation_results(merge_request_id, status, blocking);
        `);
      },
    },
    {
      id: "062_parallel_correction_recovery_points",
      description: "平行账套正式纠错执行前恢复点与事务回滚凭据",
      up: () => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS correction_recovery_points (
            id TEXT PRIMARY KEY,
            execution_run_id TEXT NOT NULL REFERENCES correction_execution_runs(id),
            attempt_no INTEGER NOT NULL,
            status TEXT NOT NULL,
            snapshot_json TEXT NOT NULL DEFAULT '{}',
            completion_note TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            restored_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_correction_recovery_points_run
            ON correction_recovery_points(execution_run_id, attempt_no, created_at);
        `);
      },
    },
    {
      id: "parallel_ledger_indexes",
      description: "平行账套索引与唯一约束",
      up: () => {
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_parallel_ledgers_status ON parallel_ledgers(status);
          CREATE INDEX IF NOT EXISTS idx_parallel_ledgers_owner ON parallel_ledgers(owner_user_id);
          CREATE INDEX IF NOT EXISTS idx_parallel_ledger_members_user ON parallel_ledger_members(user_id);
          CREATE INDEX IF NOT EXISTS idx_parallel_ledger_scopes_ledger ON parallel_ledger_scopes(ledger_id, scope_entity_type);
          CREATE INDEX IF NOT EXISTS idx_parallel_entity_snapshots_entity ON parallel_entity_snapshots(entity_type, entity_id);
          CREATE INDEX IF NOT EXISTS idx_parallel_adjustments_ledger ON parallel_adjustments(ledger_id, ledger_version);
          CREATE INDEX IF NOT EXISTS idx_parallel_adjustment_lines_adj ON parallel_adjustment_lines(adjustment_id);
          CREATE INDEX IF NOT EXISTS idx_parallel_calculation_runs_ledger ON parallel_calculation_runs(ledger_id, ledger_version, created_at);
          CREATE INDEX IF NOT EXISTS idx_parallel_calculation_runs_stale ON parallel_calculation_runs(stale, status);
          CREATE INDEX IF NOT EXISTS idx_parallel_inventory_projections_run ON parallel_inventory_projections(run_id, material_id, batch_id);
          CREATE INDEX IF NOT EXISTS idx_parallel_material_allocations_run ON parallel_material_allocations(run_id, production_order_id);
          CREATE INDEX IF NOT EXISTS idx_parallel_cost_projections_run ON parallel_cost_projections(run_id, production_order_id);
          CREATE INDEX IF NOT EXISTS idx_parallel_impacts_run ON parallel_impacts(run_id, blocking, severity);
          CREATE INDEX IF NOT EXISTS idx_parallel_gaps_run ON parallel_gaps(run_id, blocking, resolution_status);
          CREATE INDEX IF NOT EXISTS idx_parallel_suggestions_gap ON parallel_suggestions(gap_id, status);
          CREATE INDEX IF NOT EXISTS idx_parallel_merge_requests_status ON parallel_merge_requests(ledger_id, status);
          CREATE INDEX IF NOT EXISTS idx_parallel_merge_items_req ON parallel_merge_items(merge_request_id, publish_status);
          CREATE INDEX IF NOT EXISTS idx_parallel_merge_conflicts_req ON parallel_merge_conflicts(merge_request_id, conflict_type);
          CREATE INDEX IF NOT EXISTS idx_document_exports_ledger ON document_exports(ledger_type, ledger_id);
        `);
      },
    },
  ];

  const applied = database
    .prepare("SELECT id FROM schema_migrations")
    .all() as Array<{ id: string }>;
  const appliedIds = new Set(applied.map((item) => item.id));
  const insert = database.prepare(`
    INSERT INTO schema_migrations (id, description, applied_at)
    VALUES (?, ?, ?)
  `);

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;
    database.transaction(() => {
      migration.up();
      insert.run(migration.id, migration.description, new Date().toISOString());
    })();
  }
}

function backfillDocumentSequences(database: Database.Database) {
  const sources = [
    { table: "quotes", column: "quote_no", prefix: "BJ" },
    { table: "orders", column: "order_no", prefix: "DD" },
    { table: "production_orders", column: "prod_no", prefix: "SC" },
    { table: "requisitions", column: "req_no", prefix: "LL" },
    { table: "requisitions", column: "issue_no", prefix: "CK" },
    { table: "inspections", column: "inspection_no", prefix: "QY" },
    { table: "production_daily_reports", column: "report_no", prefix: "RB" },
    { table: "technical_dispositions", column: "disposition_no", prefix: "JS" },
    { table: "finished_goods_receipts", column: "receipt_no", prefix: "RK" },
    { table: "production_cost_summaries", column: "cost_no", prefix: "CB" },
    { table: "production_cost_adjustments", column: "adjustment_no", prefix: "CBTZ" },
    { table: "production_cost_anomaly_remediations", column: "remediation_no", prefix: "CBZG" },
    { table: "production_cost_anomaly_warning_events", column: "event_no", prefix: "CBYJ" },
    { table: "shipments", column: "shipment_no", prefix: "FH" },
    { table: "receivables", column: "receivable_no", prefix: "YS" },
    { table: "purchase_orders", column: "purchase_no", prefix: "CG" },
    { table: "purchase_contracts", column: "contract_no", prefix: "HT" },
    { table: "purchase_arrival_notices", column: "arrival_no", prefix: "DH" },
    { table: "purchase_arrival_notice_change_logs", column: "change_no", prefix: "DHB" },
    { table: "purchase_arrival_discrepancies", column: "discrepancy_no", prefix: "CY" },
    { table: "supplier_admission_controls", column: "control_no", prefix: "ZR" },
    { table: "supplier_corrective_actions", column: "action_no", prefix: "ZG" },
    { table: "supplier_reassessments", column: "reassessment_no", prefix: "FP" },
    { table: "supplier_admission_releases", column: "release_no", prefix: "HF" },
    { table: "supplier_observation_periods", column: "observation_no", prefix: "GC" },
    { table: "supplier_qualification_certificates", column: "qualification_no", prefix: "ZZ" },
    { table: "supplier_qualification_requirements", column: "requirement_no", prefix: "YQ" },
    { table: "supplier_annual_reviews", column: "annual_review_no", prefix: "NF" },
    { table: "supplier_admission_rule_events", column: "event_no", prefix: "CF" },
    { table: "supplier_admission_rule_change_requests", column: "change_no", prefix: "GZ" },
    { table: "purchase_requisitions", column: "requisition_no", prefix: "QS" },
    { table: "mrp_requirement_runs", column: "run_no", prefix: "MRP" },
    { table: "material_iqc_inspections", column: "iqc_no", prefix: "IQC" },
    { table: "production_plan_versions", column: "plan_no", prefix: "SCJH" },
    { table: "production_plan_notifications", column: "notification_no", prefix: "TZ" },
    { table: "production_plan_change_impacts", column: "impact_no", prefix: "YX" },
    { table: "production_material_adjustment_suggestions", column: "suggestion_no", prefix: "BT" },
    { table: "production_material_adjustment_orders", column: "order_no", prefix: "BTD" },
    { table: "production_material_adjustment_order_reviews", column: "review_no", prefix: "BTFH" },
    { table: "production_material_adjustment_review_exceptions", column: "exception_no", prefix: "BTYC" },
    { table: "quality_inspection_window_confirmations", column: "window_no", prefix: "ZJ" },
    { table: "customer_delivery_confirmations", column: "confirmation_no", prefix: "JQ" },
    { table: "approval_requests", column: "request_no", prefix: "SP" },
    { table: "payables", column: "payable_no", prefix: "YF" },
    { table: "formula_price_calculations", column: "formula_no", prefix: "PF" },
    { table: "report_snapshots", column: "report_no", prefix: "BB" },
    { table: "document_exports", column: "document_no", prefix: "DJ" },
    { table: "document_attachments", column: "attachment_no", prefix: "FJ" },
    { table: "initialization_imports", column: "import_no", prefix: "DR" },
    { table: "document_cancellations", column: "cancellation_no", prefix: "ZF" },
    { table: "document_reversals", column: "reversal_no", prefix: "CX" },
    { table: "ledger_red_offsets", column: "offset_no", prefix: "HC" },
    { table: "sales_returns", column: "return_no", prefix: "TH" },
    { table: "customer_refunds", column: "refund_no", prefix: "TK" },
  ];
  const timestamp = new Date().toISOString();
  const upsert = database.prepare(`
    INSERT INTO document_sequences (id, doc_type, prefix, date_key, current_no, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      current_no = MAX(document_sequences.current_no, excluded.current_no),
      updated_at = excluded.updated_at
  `);

  for (const source of sources) {
    const tableExists = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(source.table) as { name: string } | undefined;
    if (!tableExists) continue;
    const rows = database.prepare(`SELECT ${source.column} AS document_no FROM ${source.table}`).all() as Array<{
      document_no?: string | null;
    }>;
    const maxByDate = new Map<string, number>();
    const pattern = new RegExp(`^${source.prefix}-(\\d{8})-(\\d+)$`);
    for (const row of rows) {
      const match = String(row.document_no ?? "").match(pattern);
      if (!match) continue;
      const dateKey = match[1];
      const number = Number(match[2]);
      if (!Number.isFinite(number)) continue;
      maxByDate.set(dateKey, Math.max(maxByDate.get(dateKey) ?? 0, number));
    }
    maxByDate.forEach((currentNo, dateKey) => {
      upsert.run(`${source.table}:${source.prefix}:${dateKey}`, source.table, source.prefix, dateKey, currentNo, timestamp);
    });
  }
}

function backfillUserSecurity(database: Database.Database) {
  const timestamp = new Date().toISOString();
  const users = database.prepare("SELECT id, password, username, password_hash FROM users").all() as Array<{
    id: string;
    password: string;
    username?: string | null;
    password_hash?: string | null;
  }>;
  const baseUserById = new Map<string, (typeof baseUsers)[number]>(baseUsers.map((user) => [user.id, user]));
  const update = database.prepare(`
    UPDATE users
    SET username = ?,
        password_hash = ?,
        status = COALESCE(NULLIF(status, ''), 'active'),
        password_changed_at = COALESCE(password_changed_at, ?)
    WHERE id = ?
  `);
  for (const user of users) {
    const base = baseUserById.get(user.id);
    const username = user.username || base?.username || user.id.toLowerCase();
    const passwordHash = user.password_hash || hashPassword(user.password || base?.password || "ChangeMe@2026");
    update.run(username, passwordHash, timestamp, user.id);
  }
}

function backfillCostAndShipmentClosure(database: Database.Database) {
  database.exec(`
    INSERT INTO production_cost_summaries (
      id, cost_no, production_order_id, order_id, receipt_id,
      material_cost, process_cost, transition_cost, total_cost,
      finished_qty, transition_qty, unit_cost, status, aggregated_at
    )
    SELECT
      'PCS-BACKFILL-' || fgr.id,
      'CB-BACKFILL-' || printf('%03d', fgr.rowid),
      fgr.production_order_id,
      po.order_id,
      fgr.id,
      fgr.material_cost,
      fgr.process_cost,
      ROUND(fgr.transition_qty * fgr.unit_cost * 0.15, 2),
      fgr.total_cost,
      fgr.finished_qty,
      fgr.transition_qty,
      fgr.unit_cost,
      'closed',
      fgr.received_at
    FROM finished_goods_receipts fgr
    JOIN production_orders po ON po.id = fgr.production_order_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM production_cost_summaries pcs
      WHERE pcs.production_order_id = fgr.production_order_id
    );

    INSERT INTO finished_shipment_allocations (
      id, shipment_id, finished_batch_id, production_order_id,
      batch_no, qty, unit_cost, cost_amount, created_at
    )
    SELECT
      'FSA-BACKFILL-' || im.id,
      s.id,
      fb.id,
      s.production_order_id,
      im.batch_no,
      ABS(im.qty),
      im.unit_cost,
      ROUND(ABS(im.qty) * im.unit_cost, 2),
      im.created_at
    FROM inventory_movements im
    JOIN shipments s ON s.id = im.source_id
    JOIN finished_batches fb
      ON fb.production_order_id = s.production_order_id
     AND fb.batch_no = im.batch_no
     AND fb.kind = 'finished'
    WHERE im.item_type = 'product'
      AND im.movement_type = 'shipment_outbound'
      AND im.source_type = 'shipment'
      AND NOT EXISTS (
        SELECT 1
        FROM finished_shipment_allocations fsa
        WHERE fsa.shipment_id = s.id
          AND fsa.batch_no = im.batch_no
      );

    UPDATE shipments
    SET sales_amount = ROUND((
      SELECT COALESCE(q.total_amount * shipments.shipped_qty / NULLIF(o.qty, 0), shipments.sales_amount)
      FROM orders o
      JOIN quotes q ON q.id = o.quote_id
      WHERE o.id = shipments.order_id
    ), 2)
    WHERE COALESCE(sales_amount, 0) = 0;

    UPDATE shipments
    SET cost_amount = ROUND(COALESCE((
      SELECT SUM(fsa.cost_amount)
      FROM finished_shipment_allocations fsa
      WHERE fsa.shipment_id = shipments.id
    ), cost_amount), 2);

    UPDATE shipments
    SET gross_profit = ROUND(sales_amount - cost_amount, 2),
        gross_margin = CASE
          WHEN sales_amount > 0 THEN ROUND((sales_amount - cost_amount) * 100.0 / sales_amount, 2)
          ELSE 0
        END,
        financial_status = COALESCE((
          SELECT r.status
          FROM receivables r
          WHERE r.shipment_id = shipments.id
          ORDER BY r.created_at DESC
          LIMIT 1
        ), financial_status);
  `);
}

function initializeDatabase(database: Database.Database) {
  const mode = seedMode();
  database.prepare(`
    INSERT INTO database_meta (key, value, updated_at)
    VALUES ('seed_mode', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(mode, new Date().toISOString());

  if (mode === "production") {
    seedProductionBaseData(database);
    return;
  }

  seedDemoData(database);
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function backfillInventoryMovementDates(database: Database.Database) {
  database.exec(`
    UPDATE material_batches
    SET last_movement_at = COALESCE(last_movement_at, received_at)
    WHERE last_movement_at IS NULL;

    UPDATE materials
    SET last_movement_at = COALESCE(
      last_movement_at,
      (
        SELECT MAX(im.created_at)
        FROM inventory_movements im
        WHERE im.item_type = 'material' AND im.item_id = materials.id
      ),
      (
        SELECT MAX(mb.last_movement_at)
        FROM material_batches mb
        WHERE mb.material_id = materials.id
      )
    )
    WHERE last_movement_at IS NULL;
  `);
}

export function resetDemoDatabase() {
  const database = getDb();
  database.exec(`
    DELETE FROM audit_logs;
    DELETE FROM ledger_red_offsets;
    DELETE FROM document_reversals;
    DELETE FROM document_cancellations;
    DELETE FROM document_attachments;
    DELETE FROM initialization_import_errors;
    DELETE FROM initialization_imports;
    DELETE FROM customer_refunds;
    DELETE FROM sales_return_allocations;
    DELETE FROM sales_returns;
    DELETE FROM system_settings;
    DELETE FROM alert_message_states;
    DELETE FROM alert_subscriptions;
    DELETE FROM supplier_annual_reviews;
    DELETE FROM supplier_qualification_requirements;
    DELETE FROM supplier_qualification_certificates;
    DELETE FROM supplier_observation_periods;
    DELETE FROM supplier_admission_releases;
    DELETE FROM supplier_reassessments;
    DELETE FROM supplier_admission_rule_change_requests;
    DELETE FROM supplier_admission_rule_events;
    DELETE FROM supplier_admission_rules;
    DELETE FROM supplier_corrective_actions;
    DELETE FROM supplier_admission_controls;
    DELETE FROM inventory_movements;
    DELETE FROM formula_price_lines;
    DELETE FROM formula_price_calculations;
    DELETE FROM approval_requests;
    DELETE FROM approval_rules;
    DELETE FROM inventory_aging_dispositions;
    DELETE FROM stocktakes;
    DELETE FROM document_sequences;
    DELETE FROM document_exports;
    DELETE FROM report_snapshots;
    DELETE FROM payable_payments;
    DELETE FROM receivable_receipts;
    DELETE FROM payables;
    DELETE FROM receivables;
    DELETE FROM finished_shipment_allocations;
    DELETE FROM shipments;
    DELETE FROM finished_batches;
    DELETE FROM production_cost_anomaly_warning_events;
    DELETE FROM production_cost_anomaly_warning_rules;
    DELETE FROM production_cost_anomaly_remediation_reviews;
    DELETE FROM production_cost_anomaly_remediations;
    DELETE FROM production_cost_adjustments;
    DELETE FROM production_cost_summaries;
    DELETE FROM finished_goods_receipts;
    DELETE FROM technical_dispositions;
    DELETE FROM production_daily_reports;
    DELETE FROM inspections;
    DELETE FROM production_material_adjustment_review_exceptions;
    DELETE FROM production_material_adjustment_order_reviews;
    DELETE FROM production_material_adjustment_order_lines;
    DELETE FROM production_material_adjustment_orders;
    DELETE FROM production_material_adjustment_suggestions;
    DELETE FROM quality_inspection_window_confirmations;
    DELETE FROM customer_delivery_confirmations;
    DELETE FROM production_plan_notifications;
    DELETE FROM production_plan_change_impacts;
    DELETE FROM production_plan_lines;
    DELETE FROM production_plan_versions;
    DELETE FROM requisition_allocations;
    DELETE FROM requisition_lines;
    DELETE FROM requisitions;
    DELETE FROM schedules;
    DELETE FROM production_orders;
    DELETE FROM orders;
    DELETE FROM quotes;
    DELETE FROM purchase_arrival_discrepancy_lines;
    DELETE FROM purchase_arrival_discrepancies;
    DELETE FROM purchase_arrival_notice_change_logs;
    DELETE FROM purchase_arrival_notice_lines;
    DELETE FROM purchase_arrival_notices;
    DELETE FROM purchase_contracts;
    DELETE FROM purchase_order_lines;
    DELETE FROM purchase_orders;
    DELETE FROM bom_lines;
    DELETE FROM boms;
    DELETE FROM products;
    DELETE FROM material_substitutes;
    DELETE FROM material_batches;
    DELETE FROM suppliers;
    DELETE FROM materials;
    DELETE FROM customers;
    DELETE FROM role_permissions;
    DELETE FROM user_sessions;
    DELETE FROM users;
  `);
  seedDemoData(database);
}

const baseUsers = [
  { id: "U-SALES", username: "sales", name: "销售员-陈琳", role: "sales", roleLabel: "销售员", password: "sales123", title: "报价与客户订单" },
  { id: "U-ASSIST", username: "assistant", name: "商务内勤-周敏", role: "assistant", roleLabel: "商务内勤", password: "assist123", title: "生产指令与发货" },
  { id: "U-PROD", username: "production", name: "生产主管-马工", role: "production", roleLabel: "生产主管", password: "prod123", title: "排产、BOM 与请验" },
  { id: "U-WH", username: "warehouse", name: "仓库管理员-吴勇", role: "warehouse", roleLabel: "仓库管理员", password: "wh123", title: "发料与入库" },
  { id: "U-QA", username: "quality", name: "品控员-李洁", role: "quality", roleLabel: "品控员", password: "qa123", title: "检验判定" },
  { id: "U-TECH", username: "technical", name: "技术部-陈工", role: "technical", roleLabel: "技术部", password: "tech123", title: "不合格评审与工艺处置" },
  { id: "U-PUR", username: "purchasing", name: "采购员-孙倩", role: "purchasing", roleLabel: "采购员", password: "pur123", title: "供应商、采购与应付" },
  { id: "U-MGR", username: "manager", name: "管理层-王总", role: "manager", roleLabel: "管理层", password: "mgr123", title: "实时看板" },
  { id: "U-FIN", username: "finance", name: "财务专员-赵会计", role: "finance", roleLabel: "财务专员", password: "fin123", title: "数据导出" },
  { id: "U-ADMIN", username: "admin", name: "系统管理员-管理员", role: "admin", roleLabel: "系统管理员", password: "admin123", title: "备份与归档" },
] as const;

function insertBaseUsers(database: Database.Database) {
  const insertUser = database.prepare(`
    INSERT OR IGNORE INTO users (
      id, username, name, role, role_label, password, password_hash,
      status, password_changed_at, title
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);
  const timestamp = new Date().toISOString();
  baseUsers.forEach((user) =>
    insertUser.run(
      user.id,
      user.username,
      user.name,
      user.role,
      user.roleLabel,
      user.password,
      hashPassword(user.password),
      timestamp,
      user.title,
    ),
  );
}

const defaultApprovalRules = [
  {
    id: "APR-OA-LOW",
    ruleCode: "OA-LOW",
    ruleName: "办公 OA 标准审批",
    sourceType: "office_oa",
    minAmount: 0,
    maxAmount: 999,
    approverRole: "manager",
    slaHours: 24,
    description: "日常办公、用印、费用类低金额事项，由管理层审批。",
  },
  {
    id: "APR-OA-HIGH",
    ruleCode: "OA-HIGH",
    ruleName: "办公 OA 高金额审批",
    sourceType: "office_oa",
    minAmount: 1000,
    maxAmount: null,
    approverRole: "manager",
    slaHours: 48,
    description: "超过 1000 元的办公、用印、费用类事项，进入高金额审批。",
  },
  {
    id: "APR-PR-STD",
    ruleCode: "PR-STD",
    ruleName: "采购申请审批",
    sourceType: "purchase_requisition",
    minAmount: 0,
    maxAmount: null,
    approverRole: "manager",
    slaHours: 24,
    description: "库存不足、BOM 缺料或人工申购先形成采购申请，由管理层确认需求后再转采购订单。",
  },
  {
    id: "APR-PO-STD",
    ruleCode: "PO-STD",
    ruleName: "采购订单审批",
    sourceType: "purchase_order",
    minAmount: 0,
    maxAmount: null,
    approverRole: "manager",
    slaHours: 24,
    description: "采购订单提交后由管理层确认供应商、价格和付款计划。",
  },
  {
    id: "APR-STOCKTAKE",
    ruleCode: "STOCKTAKE-STD",
    ruleName: "库存盘点差异审批",
    sourceType: "stocktake",
    minAmount: 0,
    maxAmount: null,
    approverRole: "manager",
    slaHours: 24,
    description: "盘盈盘亏差异调整前必须由管理层审批。",
  },
  {
    id: "APR-REQ",
    ruleCode: "REQ-STD",
    ruleName: "领料单发料审批",
    sourceType: "requisition",
    minAmount: 0,
    maxAmount: null,
    approverRole: "warehouse",
    slaHours: 12,
    description: "生产领料单由仓库复核 BOM、批次、FIFO 和替代料规则。",
  },
  {
    id: "APR-PCA-HIGH",
    ruleCode: "PCA-HIGH",
    ruleName: "工单成本调整审批",
    sourceType: "production_cost_adjustment",
    minAmount: 500,
    maxAmount: null,
    approverRole: "manager",
    slaHours: 24,
    description: "补退料异常、复核差异等导致的高金额工单成本调整，需管理层审批后入账。",
  },
] as const;

const defaultAlertSubscriptions = [
  { role: "admin", alertType: "low_stock", minSeverity: "low" },
  { role: "admin", alertType: "inventory_stale", minSeverity: "low" },
  { role: "admin", alertType: "inventory_overstock", minSeverity: "low" },
  { role: "admin", alertType: "approval_pending", minSeverity: "low" },
  { role: "admin", alertType: "receivable_due", minSeverity: "low" },
  { role: "admin", alertType: "payable_due", minSeverity: "low" },
  { role: "admin", alertType: "quality_yield_warning", minSeverity: "low" },
  { role: "admin", alertType: "mrp_shortage", minSeverity: "low" },
  { role: "admin", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "admin", alertType: "cost_anomaly_warning", minSeverity: "low" },
  { role: "manager", alertType: "low_stock", minSeverity: "low" },
  { role: "manager", alertType: "inventory_stale", minSeverity: "low" },
  { role: "manager", alertType: "inventory_overstock", minSeverity: "low" },
  { role: "manager", alertType: "approval_pending", minSeverity: "low" },
  { role: "manager", alertType: "receivable_due", minSeverity: "low" },
  { role: "manager", alertType: "payable_due", minSeverity: "low" },
  { role: "manager", alertType: "quality_yield_warning", minSeverity: "low" },
  { role: "manager", alertType: "mrp_shortage", minSeverity: "low" },
  { role: "manager", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "manager", alertType: "cost_anomaly_warning", minSeverity: "low" },
  { role: "sales", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "assistant", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "purchasing", alertType: "low_stock", minSeverity: "low" },
  { role: "purchasing", alertType: "mrp_shortage", minSeverity: "low" },
  { role: "purchasing", alertType: "payable_due", minSeverity: "medium" },
  { role: "production", alertType: "quality_yield_warning", minSeverity: "medium" },
  { role: "warehouse", alertType: "inventory_stale", minSeverity: "low" },
  { role: "warehouse", alertType: "inventory_overstock", minSeverity: "low" },
  { role: "warehouse", alertType: "approval_pending", minSeverity: "low" },
  { role: "warehouse", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "production", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "purchasing", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "quality", alertType: "quality_yield_warning", minSeverity: "low" },
  { role: "quality", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "technical", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "finance", alertType: "receivable_due", minSeverity: "low" },
  { role: "finance", alertType: "payable_due", minSeverity: "low" },
  { role: "finance", alertType: "system_health_remediation_due", minSeverity: "low" },
  { role: "finance", alertType: "cost_anomaly_warning", minSeverity: "low" },
] as const;

const defaultSystemSettings = [
  {
    key: "backup_frequency",
    value: "daily",
    label: "备份频率",
    category: "backup",
    description: "默认每日生成一份完整冷备份，包含数据库、附件、导出文件和 manifest。",
  },
  {
    key: "backup_retention_days",
    value: "180",
    label: "备份保留天数",
    category: "backup",
    description: "本地备份包建议至少保留 180 天，旧硬盘按年度归档。",
  },
  {
    key: "audit_retention_days",
    value: "3650",
    label: "审计日志保留天数",
    category: "security",
    description: "关键业务操作和系统管理操作保留 10 年，满足内部追溯要求。",
  },
  {
    key: "session_timeout_hours",
    value: "24",
    label: "登录会话有效期",
    category: "security",
    description: "员工登录会话默认 24 小时有效，离岗时建议主动退出。",
  },
  {
    key: "archive_disk_label",
    value: "ERP-DATA-DISK-A",
    label: "归档数据盘标识",
    category: "archive",
    description: "用于标识当前数据盘，便于硬盘更换、封存和资产台账登记。",
  },
  {
    key: "stale_warning_days",
    value: "90",
    label: "呆滞预警天数",
    category: "inventory",
    description: "库存 90 天未发生出入库时进入呆滞预警。",
  },
  {
    key: "overstock_days",
    value: "180",
    label: "积压纳入天数",
    category: "inventory",
    description: "库存 180 天未发生出入库时纳入积压报表。",
  },
  {
    key: "yield_warning_rate",
    value: "95",
    label: "收率预警线",
    category: "quality",
    description: "生产收率低于该百分比时，纳入质量与生产复盘关注。",
  },
  {
    key: "receivable_due_warning_days",
    value: "7",
    label: "应收临期提醒天数",
    category: "finance",
    description: "应收账款到期前 7 天进入财务临期提醒。",
  },
  {
    key: "payable_due_warning_days",
    value: "7",
    label: "应付临期提醒天数",
    category: "finance",
    description: "应付账款到期前 7 天进入付款计划提醒。",
  },
  {
    key: "purchase_approval_threshold",
    value: "5000",
    label: "采购审批金额阈值",
    category: "approval",
    description: "采购金额达到该阈值时进入管理层审批。",
  },
] as const;

const defaultSupplierAdmissionRules = [
  {
    id: "SAR-SCORE-WATCH",
    ruleCode: "SUP-SCORE-WATCH",
    ruleName: "供应商评分观察准入",
    metricKey: "performance_score",
    operator: "lt",
    thresholdValue: 80,
    targetStatus: "watch",
    requireCorrection: 1,
    priority: 30,
    description: "供应商综合评分低于 80 分时，自动进入观察准入并生成整改跟踪。",
  },
  {
    id: "SAR-SCORE-RESTRICT",
    ruleCode: "SUP-SCORE-RESTRICT",
    ruleName: "供应商评分限制采购",
    metricKey: "performance_score",
    operator: "lt",
    thresholdValue: 60,
    targetStatus: "restricted",
    requireCorrection: 1,
    priority: 70,
    description: "供应商综合评分低于 60 分时，自动限制新增采购。",
  },
  {
    id: "SAR-DISCREPANCY-RATE",
    ruleCode: "SUP-DISCREPANCY-RATE",
    ruleName: "到货差异率限制采购",
    metricKey: "discrepancy_rate",
    operator: "gte",
    thresholdValue: 40,
    targetStatus: "restricted",
    requireCorrection: 1,
    priority: 90,
    description: "供应商到货差异率达到 40% 时，自动限制新增采购并要求整改。",
  },
  {
    id: "SAR-IQC-FAIL-STREAK",
    ruleCode: "SUP-IQC-FAIL-STREAK",
    ruleName: "连续 IQC 不合格黑名单",
    metricKey: "iqc_failed_streak",
    operator: "gte",
    thresholdValue: 2,
    targetStatus: "blacklisted",
    requireCorrection: 1,
    priority: 100,
    description: "供应商连续 2 次 IQC 不合格退货时，自动纳入黑名单。",
  },
] as const;

const defaultCostAnomalyWarningRules = [
  {
    id: "CAWR-AMOUNT-HIGH",
    ruleCode: "COST-AMOUNT-HIGH",
    ruleName: "单笔成本异常超额预警",
    metricKey: "single_adjustment_amount",
    operator: "gte",
    thresholdValue: 500,
    windowDays: 0,
    severity: "high",
    ownerId: "U-PROD",
    autoCreateRemediation: 1,
    priority: 90,
    description: "单笔工单成本调整金额达到阈值时自动生成成本异常整改任务。",
  },
  {
    id: "CAWR-MATERIAL-FREQUENT",
    ruleCode: "COST-MATERIAL-FREQUENT",
    ruleName: "同物料连续成本异常预警",
    metricKey: "material_anomaly_count",
    operator: "gte",
    thresholdValue: 2,
    windowDays: 30,
    severity: "medium",
    ownerId: "U-PROD",
    autoCreateRemediation: 1,
    priority: 80,
    description: "同一物料在统计窗口内连续发生成本异常时自动生成整改任务。",
  },
  {
    id: "CAWR-WORKORDER-REVERSAL",
    ruleCode: "COST-WORKORDER-REVERSAL",
    ruleName: "同工单多次红冲预警",
    metricKey: "work_order_reversal_count",
    operator: "gte",
    thresholdValue: 2,
    windowDays: 90,
    severity: "critical",
    ownerId: "U-PROD",
    autoCreateRemediation: 1,
    priority: 100,
    description: "同一生产工单在统计窗口内多次发生成本红冲时自动生成整改任务。",
  },
] as const;

function seedDefaultApprovalRules(database: Database.Database) {
  const timestamp = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO approval_rules (
      id, rule_code, rule_name, source_type, min_amount, max_amount,
      approver_role, sla_hours, status, description, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `);
  defaultApprovalRules.forEach((rule) =>
    insert.run(
      rule.id,
      rule.ruleCode,
      rule.ruleName,
      rule.sourceType,
      rule.minAmount,
      rule.maxAmount,
      rule.approverRole,
      rule.slaHours,
      rule.description,
      timestamp,
      timestamp,
    ),
  );
}

function seedDefaultAlertSubscriptions(database: Database.Database) {
  const timestamp = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO alert_subscriptions (
      id, role, alert_type, min_severity, enabled, route_to_tasks, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 1, 1, ?, ?)
  `);
  defaultAlertSubscriptions.forEach((subscription) =>
    insert.run(
      `ALS-${subscription.role}-${subscription.alertType}`,
      subscription.role,
      subscription.alertType,
      subscription.minSeverity,
      timestamp,
      timestamp,
    ),
  );
}

function seedDefaultSystemSettings(database: Database.Database) {
  const timestamp = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO system_settings (
      setting_key, setting_value, setting_label, category, description, updated_by, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'U-ADMIN', ?)
  `);
  defaultSystemSettings.forEach((setting) =>
    insert.run(setting.key, setting.value, setting.label, setting.category, setting.description, timestamp),
  );
}

function seedDefaultSupplierAdmissionRules(database: Database.Database) {
  const timestamp = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO supplier_admission_rules (
      id, rule_code, rule_name, metric_key, operator, threshold_value,
      target_status, require_correction, priority, status, description, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `);
  defaultSupplierAdmissionRules.forEach((rule) =>
    insert.run(
      rule.id,
      rule.ruleCode,
      rule.ruleName,
      rule.metricKey,
      rule.operator,
      rule.thresholdValue,
      rule.targetStatus,
      rule.requireCorrection,
      rule.priority,
      rule.description,
      timestamp,
      timestamp,
    ),
  );
}

function seedDefaultCostAnomalyWarningRules(database: Database.Database) {
  const ownerExists = database.prepare("SELECT id FROM users WHERE id = 'U-PROD'").get();
  const adminExists = database.prepare("SELECT id FROM users WHERE id = 'U-ADMIN'").get();
  if (!ownerExists || !adminExists) return;
  const timestamp = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO production_cost_anomaly_warning_rules (
      id, rule_code, rule_name, metric_key, operator, threshold_value,
      window_days, severity, owner_id, auto_create_remediation, priority,
      status, description, created_by, created_at, updated_by, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive', ?, 'U-ADMIN', ?, 'U-ADMIN', ?)
  `);
  defaultCostAnomalyWarningRules.forEach((rule) =>
    insert.run(
      rule.id,
      rule.ruleCode,
      rule.ruleName,
      rule.metricKey,
      rule.operator,
      rule.thresholdValue,
      rule.windowDays,
      rule.severity,
      rule.ownerId,
      rule.autoCreateRemediation,
      rule.priority,
      rule.description,
      timestamp,
      timestamp,
    ),
  );
}

function seedDefaultGovernanceData(database: Database.Database) {
  seedDefaultApprovalRules(database);
  seedDefaultAlertSubscriptions(database);
  seedDefaultSystemSettings(database);
  seedDefaultSupplierAdmissionRules(database);
  seedDefaultCostAnomalyWarningRules(database);
}

function seedProductionBaseData(database: Database.Database) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (count.count > 0) {
    insertBaseUsers(database);
    seedDefaultGovernanceData(database);
    return;
  }

  const now = new Date().toISOString();
  database.transaction(() => {
    insertBaseUsers(database);
    seedDefaultGovernanceData(database);
    database.prepare(`
      INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("A-PROD-INIT", "U-ADMIN", "initialize", "system", "production", "初始化正式库基础账号与权限角色", now);
  })();
}

function seedDemoData(database: Database.Database) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (count.count > 0) {
    insertBaseUsers(database);
    seedDefaultGovernanceData(database);
    seedEnhancementData(database);
    return;
  }

  const now = new Date().toISOString();
  const avgSteel = calculateMovingAverage({
    currentQty: 100,
    currentAverageCost: 12,
    incomingQty: 80,
    incomingUnitCost: 14,
  });
  const avgAltSteel = calculateMovingAverage({
    currentQty: 60,
    currentAverageCost: 13.2,
    incomingQty: 60,
    incomingUnitCost: 13.6,
  });

  const materialUnitCost = avgSteel.nextAverageCost * 1 + 48 * 0.04 + 2.5 * 0.1;
  const processFee = 18;
  const margin = 0.22;
  const qty = 100;
  const quoteTotal = roundMoney((materialUnitCost + processFee) * qty * (1 + margin));

  const insertMaterial = database.prepare(`
    INSERT INTO materials (
      id, material_code, name, unit, stock_qty, average_cost, kind,
      status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);
  const insertBatch = database.prepare(`
    INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  database.transaction(() => {
    insertBaseUsers(database);
    seedDefaultGovernanceData(database);

    database
      .prepare(`
        INSERT INTO customers (
          id, customer_code, name, contact, phone, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `)
      .run("C-001", "C-001", "上海星河装备有限公司", "刘经理", "138-0000-2026", now, now);

    insertMaterial.run("M-STEEL", "M-STEEL", "42CrMo 圆钢", "kg", avgSteel.nextQty, avgSteel.nextAverageCost, "raw", now, now);
    insertMaterial.run("M-ALT-STEEL", "M-ALT-STEEL", "40Cr 替代圆钢", "kg", avgAltSteel.nextQty, avgAltSteel.nextAverageCost, "raw", now, now);
    insertMaterial.run("M-COATING", "M-COATING", "防锈涂层液", "L", 16, 48, "raw", now, now);
    insertMaterial.run("M-PACK", "M-PACK", "周转包装", "套", 35, 2.5, "packing", now, now);
    database.prepare("UPDATE materials SET reorder_min_qty = ? WHERE id = ?").run(80, "M-STEEL");
    database.prepare("UPDATE materials SET reorder_min_qty = ? WHERE id = ?").run(40, "M-ALT-STEEL");
    database.prepare("UPDATE materials SET reorder_min_qty = ? WHERE id = ?").run(20, "M-COATING");
    database.prepare("UPDATE materials SET reorder_min_qty = ? WHERE id = ?").run(50, "M-PACK");

    database
      .prepare(`
        INSERT INTO suppliers (
          id, supplier_code, name, contact, phone, payment_terms, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run("SUP-001", "SUP-001", "江苏华材金属有限公司", "张经理", "139-1000-2026", "月结30天", "active", now, now);
    database
      .prepare(`
        INSERT INTO suppliers (
          id, supplier_code, name, contact, phone, payment_terms, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run("SUP-002", "SUP-002", "苏州涂装化工有限公司", "钱经理", "137-2000-2026", "货到15天", "active", now, now);

    insertBatch.run("B-STEEL-OLD", "M-STEEL", "ST-20260102", 100, 12, "2026-01-02");
    insertBatch.run("B-STEEL-NEW", "M-STEEL", "ST-20260301", 80, 14, "2026-03-01");
    insertBatch.run("B-ALT-001", "M-ALT-STEEL", "ALT-20260215", 60, 13.2, "2026-02-15");
    insertBatch.run("B-ALT-002", "M-ALT-STEEL", "ALT-20260401", 60, 13.6, "2026-04-01");
    insertBatch.run("B-COATING-001", "M-COATING", "CT-20260410", 16, 48, "2026-04-10");
    insertBatch.run("B-PACK-001", "M-PACK", "PK-20260418", 35, 2.5, "2026-04-18");
    database.prepare("UPDATE material_batches SET last_movement_at = received_at WHERE last_movement_at IS NULL").run();
    database.prepare(`
      UPDATE materials
      SET last_movement_at = (
        SELECT MAX(mb.last_movement_at)
        FROM material_batches mb
        WHERE mb.material_id = materials.id
      )
      WHERE id IN ('M-STEEL', 'M-ALT-STEEL', 'M-COATING', 'M-PACK')
    `).run();

    database
      .prepare("INSERT INTO material_substitutes (material_id, substitute_id, note) VALUES (?, ?, ?)")
      .run("M-STEEL", "M-ALT-STEEL", "客户认可的临时替代料，需保留追溯记录");

    database
      .prepare(`
        INSERT INTO products (
          id, product_code, name, unit, process_fee, default_margin, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `)
      .run("P-FINISHED", "P-FINISHED", "定制化齿轮箱壳体", "件", processFee, margin, now, now);
    database
      .prepare(`
        INSERT INTO products (
          id, product_code, name, unit, process_fee, default_margin, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `)
      .run("P-SEMI", "P-SEMI", "热处理半成品", "件", 0, 0, now, now);

    database
      .prepare("INSERT INTO boms (id, product_id, version, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("BOM-FINISHED-V1", "P-FINISHED", "V1.0", "active", now, now);

    const insertBomLine = database.prepare(`
      INSERT INTO bom_lines (bom_id, parent_product_id, component_type, component_id, qty_per, is_primary)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertBomLine.run("BOM-FINISHED-V1", "P-FINISHED", "product", "P-SEMI", 1, 0);
    insertBomLine.run("BOM-FINISHED-V1", "P-FINISHED", "material", "M-PACK", 0.1, 0);
    insertBomLine.run("BOM-FINISHED-V1", "P-SEMI", "material", "M-STEEL", 1, 1);
    insertBomLine.run("BOM-FINISHED-V1", "P-SEMI", "material", "M-COATING", 0.04, 0);

    database.prepare(`
      INSERT INTO quotes (
        id, quote_no, customer_id, product_id, qty, version, material_cost,
        process_fee, margin_rate, total_amount, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "Q-001",
      "BJ-20260428-001",
      "C-001",
      "P-FINISHED",
      qty,
      1,
      roundMoney(materialUnitCost * qty),
      roundMoney(processFee * qty),
      margin,
      quoteTotal,
      "draft",
      now,
    );
    database.prepare(`
      INSERT INTO quotes (
        id, quote_no, customer_id, product_id, qty, version, material_cost,
        process_fee, margin_rate, total_amount, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "Q-HISTORY-001",
      "BJ-20260410-001",
      "C-001",
      "P-FINISHED",
      300,
      1,
      7200,
      1800,
      0.3333,
      12000,
      "converted",
      now,
    );
    database.prepare(`
      INSERT INTO orders (
        id, order_no, quote_id, customer_id, product_id, qty, due_date,
        special_requirements, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "O-HISTORY-001",
      "DD-20260410-001",
      "Q-HISTORY-001",
      "C-001",
      "P-FINISHED",
      300,
      "2026-04-24",
      "历史回款演示订单",
      "shipped",
      now,
    );

    database.prepare(`
      INSERT INTO purchase_orders (
        id, purchase_no, supplier_id, status, total_amount, due_date, created_at, received_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("PO-DEMO-001", "CG-20260428-001", "SUP-001", "pending_receipt", 3160, "2026-05-28", now, null);
    database.prepare(`
      INSERT INTO purchase_order_lines (
        id, purchase_order_id, material_id, qty, unit_cost, line_amount
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("POL-DEMO-001", "PO-DEMO-001", "M-STEEL", 200, 15.8, 3160);
    database.prepare(`
      INSERT INTO purchase_orders (
        id, purchase_no, supplier_id, status, total_amount, due_date, created_at, received_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("PO-DEMO-002", "CG-20260420-001", "SUP-002", "received", 960, "2026-05-05", now, now);
    database.prepare(`
      INSERT INTO purchase_order_lines (
        id, purchase_order_id, material_id, qty, unit_cost, line_amount
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("POL-DEMO-002", "PO-DEMO-002", "M-COATING", 20, 48, 960);
    database.prepare(`
      INSERT INTO payables (
        id, payable_no, supplier_id, purchase_order_id, total_amount, paid_amount,
        balance_amount, status, due_date, created_at, settled_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("AP-DEMO-001", "YF-20260420-001", "SUP-002", "PO-DEMO-002", 960, 300, 660, "partial", "2026-05-05", now, null);
    database.prepare(`
      INSERT INTO payable_payments (id, payable_id, amount, method, note, paid_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("APP-DEMO-001", "AP-DEMO-001", 300, "银行转账", "历史付款演示", now);
    database.prepare(`
      INSERT INTO receivables (
        id, receivable_no, customer_id, order_id, shipment_id, total_amount, received_amount,
        balance_amount, status, due_date, created_at, settled_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("AR-HISTORY-001", "YS-20260410-001", "C-001", "O-HISTORY-001", null, 12000, 5000, 7000, "partial", "2026-05-10", now, null);
    database.prepare(`
      INSERT INTO receivable_receipts (id, receivable_id, amount, method, note, received_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("ARR-HISTORY-001", "AR-HISTORY-001", 5000, "银行回款", "历史回款演示", now);

    database.prepare(`
      INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("A-SEED", "U-ADMIN", "seed", "system", "demo", "初始化演示客户、库存、BOM 与报价单", now);
  })();
  seedEnhancementData(database);
}

function seedEnhancementData(database: Database.Database) {
  const now = new Date().toISOString();
  seedDefaultSupplierAdmissionRules(database);
  seedDefaultCostAnomalyWarningRules(database);
  const certificateCount = database.prepare("SELECT COUNT(*) AS count FROM supplier_qualification_certificates").get() as { count: number };
  if (certificateCount.count === 0) {
    const insertCertificate = database.prepare(`
      INSERT OR IGNORE INTO supplier_qualification_certificates (
        id, qualification_no, supplier_id, certificate_type, certificate_name, certificate_no,
        issued_at, expires_at, remind_days, status, note, created_by, created_at, updated_by, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'U-ADMIN', ?, 'U-ADMIN', ?)
    `);
    insertCertificate.run(
      "SQC-DEMO-001",
      "ZZ-20260428-001",
      "SUP-001",
      "quality_system",
      "ISO9001 质量管理体系认证",
      "ISO-DEMO-2026-001",
      "2023-06-15",
      "2026-06-15",
      90,
      "演示数据：资质即将到期，用于采购评审提醒。",
      now,
      now,
    );
    insertCertificate.run(
      "SQC-DEMO-002",
      "ZZ-20260428-002",
      "SUP-002",
      "material_license",
      "危险化学品经营备案",
      "CHEM-DEMO-2025-002",
      "2022-04-01",
      "2026-04-01",
      90,
      "演示数据：资质已过期，需供应商补充新版证书。",
      now,
      now,
    );
  }
  const supplierOneCoatingLicense = database
    .prepare("SELECT COUNT(*) AS count FROM supplier_qualification_certificates WHERE id = 'SQC-DEMO-003'")
    .get() as { count: number };
  if (supplierOneCoatingLicense.count === 0) {
    database.prepare(`
      INSERT OR IGNORE INTO supplier_qualification_certificates (
        id, qualification_no, supplier_id, certificate_type, certificate_name, certificate_no,
        issued_at, expires_at, remind_days, status, note, created_by, created_at, updated_by, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'U-ADMIN', ?, 'U-ADMIN', ?)
    `).run(
      "SQC-DEMO-003",
      "ZZ-20260428-003",
      "SUP-001",
      "material_license",
      "危险化学品经营备案",
      "CHEM-DEMO-2028-001",
      "2026-01-01",
      "2028-12-31",
      90,
      "演示数据：江苏华材具备有效化工类采购资质，可通过必备资质矩阵检查。",
      now,
      now,
    );
  }

  const requirementCount = database.prepare("SELECT COUNT(*) AS count FROM supplier_qualification_requirements").get() as {
    count: number;
  };
  if (requirementCount.count === 0) {
    database.prepare(`
      INSERT OR IGNORE INTO supplier_qualification_requirements (
        id, requirement_no, scope_type, material_id, certificate_type, certificate_name,
        min_valid_days, block_purchase, status, description, created_by, created_at, updated_by, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'U-ADMIN', ?, 'U-ADMIN', ?)
    `).run(
      "SQR-DEMO-001",
      "YQ-20260428-001",
      "material",
      "M-COATING",
      "material_license",
      "危险化学品经营备案",
      0,
      1,
      "采购水性涂料等化工类物料前，供应商必须具备有效危险化学品经营备案。",
      now,
      now,
    );
  }

  const staleCount = database.prepare("SELECT COUNT(*) AS count FROM materials WHERE id IN ('M-SLOW', 'M-OVERSTOCK')")
    .get() as { count: number };
  if (staleCount.count === 0) {
    database.transaction(() => {
      database.prepare(`
        INSERT INTO materials (
          id, material_code, name, unit, stock_qty, average_cost, kind,
          reorder_min_qty, last_movement_at, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run("M-SLOW", "M-SLOW", "低频密封垫", "件", 120, 3.2, "raw", 30, "2026-01-12T08:30:00.000Z", now, now);
      database.prepare(`
        INSERT INTO materials (
          id, material_code, name, unit, stock_qty, average_cost, kind,
          reorder_min_qty, last_movement_at, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run("M-OVERSTOCK", "M-OVERSTOCK", "旧版喷涂辅料", "L", 88, 26.5, "raw", 20, "2025-10-18T09:00:00.000Z", now, now);
      database.prepare(`
        INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at, last_movement_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("B-SLOW-001", "M-SLOW", "SL-20260112", 120, 3.2, "2026-01-12", "2026-01-12T08:30:00.000Z");
      database.prepare(`
        INSERT INTO material_batches (id, material_id, batch_no, qty, unit_cost, received_at, last_movement_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("B-OVER-001", "M-OVERSTOCK", "OV-20251018", 88, 26.5, "2025-10-18", "2025-10-18T09:00:00.000Z");
    })();
  }

  const approvalCount = database.prepare("SELECT COUNT(*) AS count FROM approval_requests").get() as { count: number };
  if (approvalCount.count === 0) {
    database.prepare(`
      INSERT INTO approval_requests (
        id, request_no, type, title, applicant_id, status, amount,
        reason, created_at, decided_by, decided_at, decision_note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "OA-DEMO-001",
      "SP-20260428-001",
      "采购特采",
      "防锈涂层液紧急补货审批",
      "U-PUR",
      "pending",
      960,
      "客户订单交期提前，现有库存低于安全线，需要紧急补货。",
      now,
      null,
      null,
      null,
    );
    database.prepare(`
      INSERT INTO approval_requests (
        id, request_no, type, title, applicant_id, status, amount,
        reason, created_at, decided_by, decided_at, decision_note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "OA-DEMO-002",
      "SP-20260418-001",
      "费用报销",
      "生产线临时维修费用",
      "U-PROD",
      "approved",
      1280,
      "M-02 机台临时维修，已完成现场确认。",
      now,
      "U-MGR",
      now,
      "同意，纳入本月维修费用。",
    );
  }

  const formulaCount = database.prepare("SELECT COUNT(*) AS count FROM formula_price_calculations").get() as {
    count: number;
  };
  if (formulaCount.count > 0) return;

  const materials = database.prepare(`
    SELECT id, name, unit, average_cost
    FROM materials
    WHERE id IN ('M-STEEL', 'M-COATING', 'M-PACK')
  `).all() as Array<{ id: string; name: string; unit: string; average_cost: number }>;
  const byId = new Map(materials.map((material) => [material.id, material]));
  const lines = [
    { materialId: "M-STEEL", qty: 1 },
    { materialId: "M-COATING", qty: 0.04 },
    { materialId: "M-PACK", qty: 0.1 },
  ];
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
  const materialCost = roundMoney(
    lines.reduce((sum, line) => sum + line.qty * Number(byId.get(line.materialId)?.average_cost ?? 0), 0),
  );
  const processFee = 18;
  const lossRate = 0.03;
  const marginRate = 0.22;
  const quotedUnitPrice = roundMoney((materialCost * (1 + lossRate) + processFee) * (1 + marginRate));
  const totalPrice = roundMoney(quotedUnitPrice * 100);

  database.prepare(`
    INSERT INTO formula_price_calculations (
      id, formula_no, formula_name, total_qty, unit, material_cost,
      process_fee, loss_rate, margin_rate, quoted_unit_price, total_price,
      created_by, created_at, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "FC-DEMO-001",
    "PF-20260428-001",
    "齿轮箱壳体试算配方 A",
    totalQty,
    "件",
    materialCost,
    processFee,
    lossRate,
    marginRate,
    quotedUnitPrice,
    totalPrice,
    "U-MGR",
    now,
    "使用当前原材料移动均价自动试算，含损耗率与利润率。",
  );

  const insertLine = database.prepare(`
    INSERT INTO formula_price_lines (
      id, calculation_id, material_id, material_name, qty, unit,
      average_cost, line_cost, ratio
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  lines.forEach((line, index) => {
    const material = byId.get(line.materialId);
    if (!material) return;
    insertLine.run(
      `FCL-DEMO-${index + 1}`,
      "FC-DEMO-001",
      material.id,
      material.name,
      line.qty,
      material.unit,
      material.average_cost,
      roundMoney(line.qty * material.average_cost),
      totalQty > 0 ? line.qty / totalQty : 0,
    );
  });
}
