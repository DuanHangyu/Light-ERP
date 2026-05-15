import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

function offsetDate(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function loadService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-service-test-"));
  tempDirs.push(dir);
  process.env.ERP_DATA_DIR = dir;
  process.env.ERP_SEED_MODE = "demo";
  vi.resetModules();
  return import("./erp-service");
}

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  delete process.env.ERP_DATA_DIR;
  delete process.env.ERP_SEED_MODE;
});

describe("ERP service formal MRP shortage planning", () => {
  it("generates BOM net requirements and converts shortages into a purchase requisition", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "1000",
        margin_rate: "0.2",
      },
    });
    const quote = service.getSnapshot("U-SALES").board.quotes[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
    service.performAction({
      actorId: "U-SALES",
      action: "createOrder",
      entityId: String(quote.id),
      payload: { due_date: "2026-12-31", special_requirements: "MRP缺料净需求测试订单" },
    });
    const order = service.getSnapshot("U-ASSIST").board.orders[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-ASSIST", action: "createProductionInstruction", entityId: String(order.id) });

    service.performAction({
      actorId: "U-PUR",
      action: "generateMrpRequirementRun",
      payload: {
        horizon_date: "2027-01-31",
        note: "按客户订单交期进行正式 MRP 净需求测算。",
      },
    });

    let snapshot = service.getSnapshot("U-PUR");
    const run = snapshot.board.mrpRequirementRuns[0] as Record<string, unknown>;
    expect(run).toMatchObject({
      status: "draft",
      status_label: "待生成采购申请",
      source_type: "active_productions",
    });
    expect(Number(run.shortage_line_count)).toBeGreaterThan(0);
    expect(snapshot.board.mrpRequirementLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "shortage",
          net_shortage_qty: expect.any(Number),
          source_summary: expect.stringContaining(String(order.order_no)),
        }),
      ]),
    );

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseRequisitionFromMrp",
      entityId: String(run.id),
      payload: {
        required_date: "2026-12-20",
        reason: "MRP缺料测算自动转采购申请。",
      },
    });

    snapshot = service.getSnapshot("U-PUR");
    expect(snapshot.board.mrpRequirementRuns[0]).toMatchObject({
      id: run.id,
      status: "requisition_created",
      converted_requisition_no: expect.stringMatching(/^QS-/),
    });
    expect(snapshot.board.purchaseRequisitions[0]).toMatchObject({
      source_type: "bom_shortage",
      source_document_type: "mrp_requirement_run",
      source_document_id: run.id,
      status: "pending_approval",
    });
  });
});

describe("ERP service supplier admission, corrective action and reassessment closure", () => {
  it("blacklists a supplier, blocks purchasing, and restores admission after corrective reassessment", async () => {
    const service = await loadService();
    const snapshot = service.getSnapshot("U-MGR");
    const supplier = snapshot.board.suppliers.find((item) => item.id === "SUP-002") as Record<string, unknown>;
    const material = snapshot.board.materials.find((item) => item.status === "active") as Record<string, unknown>;

    service.performAction({
      actorId: "U-MGR",
      action: "blacklistSupplier",
      entityId: String(supplier.id),
      payload: {
        reason: "连续到货差异和 IQC 风险较高，暂停新增采购并要求供应商整改。",
        required_action: "提交8D整改报告、批次追溯记录和下批到货前自检证明。",
        due_date: "2026-06-01",
        owner_id: "U-PUR",
      },
    });

    let next = service.getSnapshot("U-PUR");
    const control = next.board.supplierAdmissionControls.find((item) => item.supplier_id === supplier.id);
    expect(control).toMatchObject({
      supplier_id: supplier.id,
      control_status: "blacklisted",
      control_status_label: "黑名单",
      purchase_allowed: 0,
      reason: expect.stringContaining("暂停新增采购"),
    });
    const corrective = next.board.supplierCorrectiveActions.find((item) => item.supplier_id === supplier.id);
    expect(corrective).toMatchObject({
      status: "open",
      status_label: "待整改",
      required_action: expect.stringContaining("8D整改报告"),
      owner_name: "采购员-孙倩",
    });

    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrder",
        payload: {
          supplier_id: supplier.id,
          due_date: "2026-08-20",
          lines: [{ material_id: material.id, qty: "5", unit_cost: "48" }],
        },
      }),
    ).toThrow("供应商准入");

    service.performAction({
      actorId: "U-PUR",
      action: "submitSupplierCorrection",
      entityId: String(corrective?.id),
      payload: {
        evidence_note: "供应商已提交8D报告、复盘照片和下一批来料自检记录，采购已完成初审。",
      },
    });
    next = service.getSnapshot("U-MGR");
    expect(next.board.supplierCorrectiveActions.find((item) => item.id === corrective?.id)).toMatchObject({
      status: "submitted",
      status_label: "待复评",
      evidence_note: expect.stringContaining("8D报告"),
    });

    service.performAction({
      actorId: "U-MGR",
      action: "reviewSupplierCorrection",
      entityId: String(corrective?.id),
      payload: {
        result: "passed",
        reassessment_score: "88",
        review_note: "整改资料完整，准予恢复采购，但保留一个月观察。",
      },
    });

    next = service.getSnapshot("U-PUR");
    expect(next.board.supplierCorrectiveActions.find((item) => item.id === corrective?.id)).toMatchObject({
      status: "closed",
      status_label: "已关闭",
      review_result_label: "复评通过",
    });
    expect(next.board.supplierAdmissionControls.find((item) => item.supplier_id === supplier.id)).toMatchObject({
      control_status: "normal",
      control_status_label: "准入正常",
      purchase_allowed: 1,
      release_note: expect.stringContaining("准予恢复采购"),
    });
    expect(next.board.supplierReassessments[0]).toMatchObject({
      supplier_id: supplier.id,
      result: "passed",
      result_label: "复评通过",
      previous_status: "blacklisted",
      next_status: "normal",
      reassessment_score: 88,
    });
    expect(next.board.supplierAdmissionReleases).toHaveLength(1);
    expect(next.board.supplierAdmissionReleases[0]).toMatchObject({
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      corrective_action_id: corrective?.id,
      reassessment_id: next.board.supplierReassessments[0].id,
      previous_status: "blacklisted",
      next_status: "normal",
      previous_status_label: "黑名单",
      next_status_label: "准入正常",
      purchase_allowed_before: 0,
      purchase_allowed_after: 1,
      release_result_label: "恢复采购",
      released_by_name: "管理层-王总",
      release_reason: expect.stringContaining("准予恢复采购"),
    });
    expect(next.board.supplierObservationPeriods).toHaveLength(1);
    expect(next.board.supplierObservationPeriods[0]).toMatchObject({
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      release_id: next.board.supplierAdmissionReleases[0].id,
      status: "active",
      status_label: "观察中",
      required_batch_count: 1,
      completed_batch_count: 0,
      breach_source_type_label: "-",
      close_reason: expect.stringContaining("复评通过"),
    });

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier.id,
        due_date: "2026-08-20",
        lines: [{ material_id: material.id, qty: "5", unit_cost: "48" }],
      },
    });
    let purchaseSnapshot = service.getSnapshot("U-PUR");
    const restoredPurchase = purchaseSnapshot.board.purchaseOrders[0] as Record<string, unknown>;
    expect(restoredPurchase).toMatchObject({
      supplier_name: supplier.name,
      status: "pending_approval",
    });
    const restoredApproval = purchaseSnapshot.board.approvalRequests.find((item) => item.entity_id === restoredPurchase.id);
    service.performAction({ actorId: "U-MGR", action: "approveApproval", entityId: String(restoredApproval?.id) });
    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseContract",
      entityId: String(restoredPurchase.id),
      payload: {
        contract_date: "2026-08-15",
        delivery_date: "2026-08-18",
        supplier_order_no: "OBS-SUP-ORDER-001",
        payment_terms: "月结30天",
      },
    });
    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseArrivalNotice",
      entityId: String(restoredPurchase.id),
      payload: {
        arrived_at: "2026-08-18",
        note: "恢复采购观察期内首批到货，仓库待签收。",
      },
    });
    purchaseSnapshot = service.getSnapshot("U-PUR");
    const observationArrival = purchaseSnapshot.board.purchaseArrivalNotices[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-WH",
      action: "registerPurchaseArrivalDiscrepancy",
      entityId: String(observationArrival.id),
      payload: {
        reason: "恢复采购观察期内实到数量短缺，触发复供观察异常。",
        proposed_action: "暂停新增采购，要求供应商补充整改并重新复评。",
        handling_decision: "supplier_replenish",
        lines: [
          {
            material_id: material.id,
            actual_arrived_qty: "3",
            actual_unit_cost: "48",
            actual_batch_hint: "OBS-SHORT-001",
            note: "观察期首批到货短缺 2 吨。",
          },
        ],
      },
    });

    next = service.getSnapshot("U-PUR");
    expect(next.board.supplierObservationPeriods[0]).toMatchObject({
      supplier_id: supplier.id,
      status: "breached",
      status_label: "观察异常",
      breach_source_type: "purchase_arrival_discrepancy",
      breach_source_type_label: "到货差异",
      breach_source_id: next.board.purchaseArrivalDiscrepancies[0].id,
      breach_reason: expect.stringContaining("观察期"),
    });
    expect(next.board.supplierAdmissionControls.find((item) => item.supplier_id === supplier.id)).toMatchObject({
      control_status: "restricted",
      control_status_label: "限制采购",
      purchase_allowed: 0,
      source_type: "supplier_observation_period",
      reason: expect.stringContaining("观察期"),
    });
    expect(next.board.supplierCorrectiveActions[0]).toMatchObject({
      supplier_id: supplier.id,
      status: "open",
      status_label: "待整改",
      required_action: expect.stringContaining("观察期"),
    });
    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrder",
        payload: {
          supplier_id: supplier.id,
          due_date: "2026-08-30",
          lines: [{ material_id: material.id, qty: "2", unit_cost: "49" }],
        },
      }),
    ).toThrow("供应商准入");
  });

  it("closes supplier observation after the first restored purchase batch passes IQC", async () => {
    const service = await loadService();
    const snapshot = service.getSnapshot("U-MGR");
    const supplier = snapshot.board.suppliers.find((item) => item.id === "SUP-002") as Record<string, unknown>;
    const material = snapshot.board.materials.find((item) => item.status === "active") as Record<string, unknown>;

    service.performAction({
      actorId: "U-MGR",
      action: "blacklistSupplier",
      entityId: String(supplier.id),
      payload: {
        reason: "年度复评前暂停新增采购。",
        required_action: "提交复供申请、8D整改报告和首批自检证明。",
        due_date: "2026-06-01",
        owner_id: "U-PUR",
      },
    });
    let next = service.getSnapshot("U-PUR");
    const corrective = next.board.supplierCorrectiveActions.find((item) => item.supplier_id === supplier.id) as Record<string, unknown>;
    service.performAction({
      actorId: "U-PUR",
      action: "submitSupplierCorrection",
      entityId: String(corrective.id),
      payload: { evidence_note: "供应商已提交复供资料和首批自检计划。" },
    });
    service.performAction({
      actorId: "U-MGR",
      action: "reviewSupplierCorrection",
      entityId: String(corrective.id),
      payload: {
        result: "passed",
        reassessment_score: "86",
        review_note: "同意恢复采购，首批采购纳入观察期。",
      },
    });
    next = service.getSnapshot("U-PUR");
    expect(next.board.supplierObservationPeriods[0]).toMatchObject({
      supplier_id: supplier.id,
      status: "active",
      completed_batch_count: 0,
    });

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier.id,
        due_date: "2026-08-20",
        lines: [{ material_id: material.id, qty: "4", unit_cost: "47" }],
      },
    });
    next = service.getSnapshot("U-PUR");
    const purchase = next.board.purchaseOrders[0] as Record<string, unknown>;
    const approval = next.board.approvalRequests.find((item) => item.entity_id === purchase.id);
    service.performAction({ actorId: "U-MGR", action: "approveApproval", entityId: String(approval?.id) });
    service.performAction({
      actorId: "U-PUR",
      action: "createMaterialIqcInspection",
      entityId: String(purchase.id),
      payload: {
        arrived_at: "2026-08-18",
        arrival_no: "OBS-ARR-20260818-001",
      },
    });
    const iqc = service.getSnapshot("U-QA").board.materialIqcInspections[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "completeMaterialIqcInspection",
      entityId: String(iqc.id),
      payload: {
        result: "qualified",
        inspected_at: "2026-08-19",
        measurements: "复供首批 IQC 检验合格。",
        disposition_note: "观察期首批合格，允许正常入库。",
      },
    });

    next = service.getSnapshot("U-PUR");
    expect(next.board.supplierObservationPeriods[0]).toMatchObject({
      supplier_id: supplier.id,
      status: "completed",
      status_label: "观察通过",
      completed_batch_count: 1,
      last_batch_source_type: "material_iqc_inspection",
      last_batch_source_type_label: "IQC合格批次",
      last_batch_source_id: iqc.id,
      close_reason: expect.stringContaining("首批采购 IQC 合格"),
    });
    expect(next.board.supplierAdmissionControls.find((item) => item.supplier_id === supplier.id)).toMatchObject({
      control_status: "normal",
      purchase_allowed: 1,
    });
  });

  it("keeps supplier admission restricted when reassessment fails", async () => {
    const service = await loadService();

    service.performAction({
      actorId: "U-PUR",
      action: "createSupplierCorrectiveAction",
      entityId: "SUP-001",
      payload: {
        control_status: "restricted",
        reason: "近期交付和质量波动，需要整改后复评。",
        required_action: "提交交付改善计划和来料自检表。",
        due_date: "2026-06-05",
      },
    });
    const corrective = service
      .getSnapshot("U-PUR")
      .board.supplierCorrectiveActions.find((item) => item.supplier_id === "SUP-001") as Record<string, unknown>;

    service.performAction({
      actorId: "U-PUR",
      action: "submitSupplierCorrection",
      entityId: String(corrective.id),
      payload: { evidence_note: "供应商提交整改说明，但缺少关键批次追溯资料。" },
    });
    service.performAction({
      actorId: "U-MGR",
      action: "reviewSupplierCorrection",
      entityId: String(corrective.id),
      payload: {
        result: "failed",
        reassessment_score: "62",
        review_note: "证据不足，维持限制准入，要求补充整改。",
      },
    });

    const next = service.getSnapshot("U-MGR");
    expect(next.board.supplierCorrectiveActions.find((item) => item.id === corrective.id)).toMatchObject({
      status: "rejected",
      status_label: "复评驳回",
      review_result_label: "复评不通过",
    });
    expect(next.board.supplierAdmissionControls.find((item) => item.supplier_id === "SUP-001")).toMatchObject({
      control_status: "restricted",
      control_status_label: "限制采购",
      purchase_allowed: 0,
    });
    expect(next.board.supplierReassessments[0]).toMatchObject({
      supplier_id: "SUP-001",
      result: "failed",
      next_status: "restricted",
    });
    expect(next.board.supplierAdmissionReleases).toHaveLength(0);
  });
});

describe("ERP service supplier admission automatic trigger rules", () => {
  it("exposes configurable default supplier admission trigger rules", async () => {
    const service = await loadService();
    const snapshot = service.getSnapshot("U-MGR");
    const rules = snapshot.board.supplierAdmissionRules as Array<Record<string, unknown>>;

    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_code: "SUP-SCORE-WATCH",
          metric_key: "performance_score",
          operator: "lt",
          target_status: "watch",
          status_label: "启用",
        }),
        expect.objectContaining({
          rule_code: "SUP-IQC-FAIL-STREAK",
          metric_key: "iqc_failed_streak",
          operator: "gte",
          target_status: "blacklisted",
          target_status_label: "黑名单",
        }),
        expect.objectContaining({
          rule_code: "SUP-DISCREPANCY-RATE",
          metric_key: "discrepancy_rate",
          operator: "gte",
          target_status: "restricted",
          require_correction: 1,
        }),
      ]),
    );
  });

  it("automatically restricts suppliers after arrival discrepancy, creates correction, logs trigger event, and blocks new purchasing", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-PUR");
    const supplier = before.board.suppliers.find((item) => item.id === "SUP-001") as Record<string, unknown>;
    const material = before.board.materials.find((item) => item.status === "active") as Record<string, unknown>;

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier.id,
        due_date: "2026-08-20",
        lines: [{ material_id: material.id, qty: "10", unit_cost: "42" }],
      },
    });
    let snapshot = service.getSnapshot("U-PUR");
    const purchaseOrder = snapshot.board.purchaseOrders[0] as Record<string, unknown>;
    const approval = snapshot.board.approvalRequests.find((item) => item.entity_id === purchaseOrder.id);
    service.performAction({ actorId: "U-MGR", action: "approveApproval", entityId: String(approval?.id) });
    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseContract",
      entityId: String(purchaseOrder.id),
      payload: {
        contract_date: "2026-07-10",
        delivery_date: "2026-07-18",
        supplier_order_no: "SUP-AUTO-RULE-001",
      },
    });
    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseArrivalNotice",
      entityId: String(purchaseOrder.id),
      payload: { arrived_at: "2026-07-18" },
    });
    snapshot = service.getSnapshot("U-WH");
    const arrival = snapshot.board.purchaseArrivalNotices[0] as Record<string, unknown>;
    const arrivalLine = (arrival.lines as Array<Record<string, unknown>>)[0];

    service.performAction({
      actorId: "U-WH",
      action: "registerPurchaseArrivalDiscrepancy",
      entityId: String(arrival.id),
      payload: {
        reason: "自动规则测试：实到数量不足并发生价格差异。",
        handling_decision: "supplier_replenish",
        proposed_action: "要求供应商补货并提交原因分析。",
        lines: [
          {
            arrival_notice_line_id: arrivalLine.lineId,
            actual_arrived_qty: "7",
            actual_unit_cost: "45",
            actual_batch_hint: "AUTO-RULE-BATCH",
            note: "数量短少且价格偏差。",
          },
        ],
      },
    });

    snapshot = service.getSnapshot("U-MGR");
    const control = (snapshot.board.supplierAdmissionControls as Array<Record<string, unknown>>).find(
      (item) => item.supplier_id === supplier.id,
    );
    expect(control).toMatchObject({
      control_status: "restricted",
      control_status_label: "限制采购",
      purchase_allowed: 0,
      source_type: "supplier_admission_rule",
    });
    const correction = (snapshot.board.supplierCorrectiveActions as Array<Record<string, unknown>>).find(
      (item) => item.supplier_id === supplier.id,
    );
    expect(correction).toMatchObject({
      status: "open",
      status_label: "待整改",
      required_action: expect.stringContaining("自动触发规则"),
    });
    const event = (snapshot.board.supplierAdmissionRuleEvents as Array<Record<string, unknown>>).find(
      (item) => item.supplier_id === supplier.id,
    );
    expect(event).toMatchObject({
      rule_code: "SUP-DISCREPANCY-RATE",
      target_status: "restricted",
      target_status_label: "限制采购",
      source_type: "purchase_arrival_discrepancy",
      source_id: expect.any(String),
      action_no: correction?.action_no,
    });

    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrder",
        payload: {
          supplier_id: supplier.id,
          due_date: "2026-09-20",
          lines: [{ material_id: material.id, qty: "1", unit_cost: "42" }],
        },
      }),
    ).toThrow("供应商准入状态");

    service.performAction({
      actorId: "U-MGR",
      action: "evaluateSupplierAdmissionRules",
      entityId: String(supplier.id),
      payload: {
        source_type: "manual_review",
        source_id: "MANUAL-RECHECK-001",
      },
    });
    const afterManual = service.getSnapshot("U-MGR");
    const corrections = (afterManual.board.supplierCorrectiveActions as Array<Record<string, unknown>>).filter(
      (item) => item.supplier_id === supplier.id && ["open", "submitted", "rejected"].includes(String(item.status)),
    );
    expect(corrections).toHaveLength(1);
  });

  it("lets administrators configure supplier admission rules and blocks non-admin edits", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-ADMIN");
    const discrepancyRule = (before.board.supplierAdmissionRules as Array<Record<string, unknown>>).find(
      (item) => item.rule_code === "SUP-DISCREPANCY-RATE",
    );
    expect(discrepancyRule).toBeTruthy();

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSupplierAdmissionRule",
      entityId: String(discrepancyRule?.id),
      payload: {
        rule_code: "SUP-DISCREPANCY-RATE",
        rule_name: "到货差异率观察规则",
        metric_key: "discrepancy_rate",
        operator: "gte",
        threshold_value: "65",
        target_status: "watch",
        require_correction: "false",
        priority: "55",
        status: "inactive",
        description: "采购评审期间临时停用差异率自动限制，仅保留人工观察。",
      },
    });

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSupplierAdmissionRule",
      payload: {
        rule_code: "SUP-OPEN-DISCREPANCY",
        rule_name: "未结差异单自动限制",
        metric_key: "open_discrepancy_count",
        operator: "gte",
        threshold_value: "1",
        target_status: "restricted",
        require_correction: "true",
        priority: "76",
        status: "active",
        description: "供应商存在未关闭到货差异时，自动限制新增采购并要求整改。",
      },
    });

    const snapshot = service.getSnapshot("U-ADMIN");
    expect(snapshot.board.supplierAdmissionRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_code: "SUP-DISCREPANCY-RATE",
          rule_name: "到货差异率观察规则",
          threshold_value: 65,
          target_status: "watch",
          target_status_label: "观察准入",
          require_correction: 0,
          require_correction_label: "仅记录事件",
          status: "inactive",
          status_label: "停用",
        }),
        expect.objectContaining({
          rule_code: "SUP-OPEN-DISCREPANCY",
          metric_key: "open_discrepancy_count",
          operator_label: "大于等于",
          threshold_value: 1,
          target_status: "restricted",
          require_correction_label: "自动生成整改",
          status_label: "启用",
        }),
      ]),
    );
    expect(snapshot.summary.supplierAutoRuleCount).toBe(4);
    expect(snapshot.board.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsertSupplierAdmissionRule",
          entity_type: "supplier_admission_rule",
          message: expect.stringContaining("未结差异单自动限制"),
        }),
      ]),
    );

    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "upsertSupplierAdmissionRule",
        entityId: String(discrepancyRule?.id),
        payload: {
          rule_code: "SUP-DISCREPANCY-RATE",
          rule_name: "采购员越权改规则",
          metric_key: "discrepancy_rate",
          operator: "gte",
          threshold_value: "80",
          target_status: "restricted",
          require_correction: "true",
          priority: "50",
          status: "active",
          description: "不允许采购员修改准入规则。",
        },
      }),
    ).toThrow("无权执行");
  });

  it("previews supplier rule impact, submits change approval, and applies the rule after approval", async () => {
    const service = await loadService();
    const payload = {
      rule_code: "SUP-SCORE-STRICT-APPROVAL",
      rule_name: "综合评分严格准入审批规则",
      metric_key: "performance_score",
      operator: "lt",
      threshold_value: "101",
      target_status: "restricted",
      require_correction: "true",
      priority: "88",
      status: "active",
      description: "评分低于 101 即限制采购，用于验证规则变更审批和影响预览。",
    };

    const preview = service.previewSupplierAdmissionRuleImpact({
      actorId: "U-ADMIN",
      payload,
    }) as Record<string, unknown>;
    expect(preview).toMatchObject({
      rule_code: "SUP-SCORE-STRICT-APPROVAL",
      rule_name: "综合评分严格准入审批规则",
      has_change: true,
    });
    expect(preview.summary).toMatchObject({
      affected_count: 2,
      preview_restricted_count: 2,
      correction_count: 2,
      risk_level: "high",
    });
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          supplier_name: "江苏华材金属有限公司",
          preview_status: "restricted",
          preview_purchase_allowed: 0,
          will_create_correction: 1,
        }),
      ]),
    );

    service.performAction({
      actorId: "U-ADMIN",
      action: "submitSupplierAdmissionRuleChange",
      payload,
    });

    let snapshot = service.getSnapshot("U-ADMIN");
    const change = snapshot.board.supplierAdmissionRuleChangeRequests[0] as Record<string, unknown>;
    expect(change).toMatchObject({
      status: "pending_approval",
      status_label: "待审批",
      rule_code: "SUP-SCORE-STRICT-APPROVAL",
      preview_restricted_count: 2,
      correction_count: 2,
    });
    const approval = snapshot.board.approvalCenter.find((item) => item.business_entity_id === change.id);
    expect(approval).toMatchObject({
      source_type_label: "供应商准入规则变更",
      module_label: "系统管理",
      approve_action: "approveApproval",
      reject_action: "rejectApproval",
    });
    expect(snapshot.board.supplierAdmissionRules.some((item) => item.rule_code === payload.rule_code)).toBe(false);

    service.performAction({
      actorId: "U-MGR",
      action: "approveApproval",
      entityId: String(approval?.entity_id),
      payload: { approval_note: "影响范围已确认，同意按正式规则生效。" },
    });

    snapshot = service.getSnapshot("U-ADMIN");
    expect(snapshot.board.supplierAdmissionRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_code: "SUP-SCORE-STRICT-APPROVAL",
          target_status: "restricted",
          status_label: "启用",
        }),
      ]),
    );
    expect(snapshot.board.supplierAdmissionRuleChangeRequests[0]).toMatchObject({
      status: "approved",
      status_label: "已生效",
      approved_by_name: "管理层-王总",
      triggered_event_count: 2,
      corrective_action_count: 2,
    });
    expect(snapshot.board.supplierAdmissionControls.filter((item) => item.source_type === "supplier_admission_rule")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          control_status: "restricted",
          purchase_allowed: 0,
          reason: expect.stringContaining("SUP-SCORE-STRICT-APPROVAL"),
        }),
      ]),
    );
    const changeEvents = (snapshot.board.supplierAdmissionRuleEvents as Array<Record<string, unknown>>).filter(
      (item) => item.source_type === "supplier_admission_rule_change" && item.source_id === change.id,
    );
    expect(changeEvents).toHaveLength(2);
    expect(changeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_code: "SUP-SCORE-STRICT-APPROVAL",
          target_status: "restricted",
          action_summary: expect.stringContaining("整改"),
        }),
      ]),
    );
    const autoCorrections = (snapshot.board.supplierCorrectiveActions as Array<Record<string, unknown>>).filter((item) =>
      String(item.required_action).includes("SUP-SCORE-STRICT-APPROVAL"),
    );
    expect(autoCorrections).toHaveLength(2);

    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "submitSupplierAdmissionRuleChange",
        payload,
      }),
    ).toThrow("无权执行");
  });
});

function xlsxXml(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  return zip
    .getEntries()
    .filter((entry) => entry.entryName.endsWith(".xml"))
    .map((entry) => entry.getData().toString("utf8"))
    .join("\n");
}

function createProducingOrder(service: Awaited<ReturnType<typeof loadService>>, qty = "10") {
  const before = service.getSnapshot("U-SALES");
  const customer = before.board.customers.find((item) => item.status === "active");
  const product = before.board.products.find((item) => item.status === "active");

  service.performAction({
    actorId: "U-SALES",
    action: "createQuote",
    payload: {
      customer_id: customer?.id,
      product_id: product?.id,
      qty,
      margin_rate: "0.2",
    },
  });
  const quote = service.getSnapshot("U-SALES").board.quotes[0] as Record<string, unknown>;
  service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
  service.performAction({
    actorId: "U-SALES",
    action: "createOrder",
    entityId: String(quote.id),
    payload: { due_date: "2026-06-28", special_requirements: "生产日报与技术处置测试订单" },
  });
  const order = service.getSnapshot("U-ASSIST").board.orders[0] as Record<string, unknown>;
  service.performAction({ actorId: "U-ASSIST", action: "createProductionInstruction", entityId: String(order.id) });
  const production = service.getSnapshot("U-PROD").board.productions[0] as Record<string, unknown>;
  service.performAction({ actorId: "U-PROD", action: "scheduleAndGenerateRequisition", entityId: String(production.id) });
  const requisition = service.getSnapshot("U-WH").board.requisitions[0] as Record<string, unknown>;
  service.performAction({ actorId: "U-WH", action: "approveMaterialRequisition", entityId: String(requisition.id) });
  service.performAction({ actorId: "U-WH", action: "issueMaterials", entityId: String(requisition.id) });

  return {
    order,
    production,
    requisition,
  };
}

function createPlanChangeImpactScenario(service: Awaited<ReturnType<typeof loadService>>) {
  const { order, production, requisition } = createProducingOrder(service, "10");

  service.performAction({
    actorId: "U-PUR",
    action: "createPurchaseOrder",
    payload: {
      supplier_id: "SUP-001",
      due_date: "2026-07-05",
      lines: [{ material_id: "M-STEEL", qty: "30", unit_cost: "12.5" }],
    },
  });
  const purchaseApproval = service
    .getSnapshot("U-MGR")
    .board.approvalRequests.find((item) => item.entity_type === "purchase_order" && item.status === "pending");
  service.performAction({
    actorId: "U-MGR",
    action: "approveApproval",
    entityId: String(purchaseApproval?.id),
    payload: { approval_note: "生产计划相关备料采购，同意执行。" },
  });
  const purchaseOrders = service.getSnapshot("U-PUR").board.purchaseOrders as Array<Record<string, unknown>>;
  const purchaseOrder = purchaseOrders.find((item) => item.status === "pending_receipt" && item.due_date === "2026-07-05") as Record<
    string,
    unknown
  >;
  service.performAction({
    actorId: "U-PUR",
    action: "createPurchaseContract",
    entityId: String(purchaseOrder.id),
    payload: {
      contract_date: "2026-06-20",
      delivery_date: "2026-07-05",
      payment_terms: "按合同约定验收入库后付款",
      note: "生产计划联动测试采购合同。",
    },
  });
  const purchaseContract = service.getSnapshot("U-PUR").board.purchaseContracts.find(
    (item) => item.purchase_order_id === purchaseOrder.id,
  ) as Record<string, unknown>;

  service.performAction({
    actorId: "U-PROD",
    action: "updateProductionSchedule",
    entityId: String(production.id),
    payload: {
      planned_date: "2026-06-24",
      machine: "CNC-02",
      owner: "马工",
      shift: "白班",
      schedule_note: "锁版前基准排程。",
      change_reason: "建立生产计划基准。",
    },
  });
  service.performAction({
    actorId: "U-PROD",
    action: "lockProductionPlan",
    payload: {
      date_from: "2026-06-20",
      date_to: "2026-06-30",
      note: "第 26 周计划锁版，作为采购、质检和交付协同基准。",
    },
  });
  const plan = service.getSnapshot("U-PROD").board.productionPlanVersions[0] as Record<string, unknown>;
  const planApproval = service
    .getSnapshot("U-MGR")
    .board.approvalRequests.find((item) => item.entity_type === "production_plan" && item.entity_id === plan.id);
  service.performAction({
    actorId: "U-MGR",
    action: "approveApproval",
    entityId: String(planApproval?.id),
    payload: { approval_note: "同意发布，后续变更必须联动责任部门确认。" },
  });
  service.performAction({
    actorId: "U-PROD",
    action: "updateProductionSchedule",
    entityId: String(production.id),
    payload: {
      planned_date: "2026-07-02",
      machine: "CNC-05",
      owner: "赵工",
      shift: "夜班",
      schedule_note: "客户交期变化后重新排程。",
      change_reason: "客户要求延后生产并重新协调采购到货、质检和发货。",
    },
  });

  const impacts = (service.getSnapshot("U-MGR") as unknown as {
    board: { productionPlanChangeImpacts: Array<Record<string, unknown>> };
  }).board.productionPlanChangeImpacts.filter((item) => item.production_order_id === production.id);

  return {
    order,
    production,
    requisition,
    purchaseOrder,
    purchaseContract,
    plan,
    impacts,
  };
}

describe("ERP service document attachment archive", () => {
  it("stores evidence files on the local data disk, records metadata, and includes them in cold backups", async () => {
    const service = await loadService();
    const order = service.getSnapshot("U-ADMIN").board.orders[0] as Record<string, unknown>;
    const content = Buffer.from("signed delivery proof and customer confirmation", "utf8");

    const attachment = await service.createDocumentAttachment({
      actorId: "U-ADMIN",
      entityType: "sales_order",
      entityId: String(order.id),
      entityNo: String(order.order_no),
      category: "客户合同",
      fileName: "星河装备合同.txt",
      mimeType: "text/plain",
      note: "客户盖章合同，作为订单归档凭证。",
      buffer: content,
    });

    expect(attachment).toMatchObject({
      entity_type: "sales_order",
      entity_id: order.id,
      entity_no: order.order_no,
      category: "客户合同",
      file_name: "星河装备合同.txt",
      size_bytes: content.length,
    });
    expect(attachment.attachment_no).toMatch(/^FJ-\d{8}-\d{3}$/);
    expect(attachment.sha256).toHaveLength(64);
    expect(fs.existsSync(String(attachment.absolute_path))).toBe(true);
    expect(fs.readFileSync(String(attachment.absolute_path), "utf8")).toBe(content.toString("utf8"));

    const snapshot = service.getSnapshot("U-ADMIN");
    expect(snapshot.storage.attachmentsBytes).toBeGreaterThanOrEqual(content.length);
    expect(snapshot.board.documentAttachments[0]).toMatchObject({
      id: attachment.id,
      attachment_no: attachment.attachment_no,
      entity_no: order.order_no,
      uploaded_by_name: "系统管理员-管理员",
    });

    const backup = await service.createBackup("U-ADMIN");
    const zip = new AdmZip(backup.path);
    expect(zip.getEntries().some((entry) => entry.entryName.endsWith(String(attachment.storage_name)))).toBe(true);
  });

  it("archives signed technical disposition evidence as a first-class local attachment", async () => {
    const service = await loadService();
    const { production } = createProducingOrder(service, "10");

    service.performAction({ actorId: "U-PROD", action: "requestInspection", entityId: String(production.id) });
    const inspection = service.getSnapshot("U-QA").board.inspections[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(inspection.id),
      payload: {
        result: "failed",
        measurements: "首检不合格，需技术部处理。",
        disposition_note: "转技术部出具处理意见。",
      },
    });
    service.performAction({
      actorId: "U-TECH",
      action: "createTechnicalDisposition",
      entityId: String(inspection.id),
      payload: {
        disposition_type: "rework",
        root_cause: "夹具定位磨损。",
        corrective_action: "更换夹具并返工复检。",
      },
    });
    const disposition = service
      .getSnapshot("U-TECH")
      .board.technicalDispositions.find((item) => item.inspection_id === inspection.id) as Record<string, unknown>;
    const content = Buffer.from("signed technical disposition PDF bytes", "utf8");

    const attachment = await service.createDocumentAttachment({
      actorId: "U-ADMIN",
      entityType: "technical_disposition",
      entityId: String(disposition.id),
      entityNo: String(disposition.disposition_no),
      category: "技术处置单",
      fileName: "技术处置单签字版.pdf",
      mimeType: "application/pdf",
      note: "技术部签字确认后归档。",
      buffer: content,
    });

    expect(attachment).toMatchObject({
      entity_type: "technical_disposition",
      entity_id: disposition.id,
      entity_no: disposition.disposition_no,
      category: "技术处置单",
      file_name: "技术处置单签字版.pdf",
      size_bytes: content.length,
    });
    const archived = service.getSnapshot("U-ADMIN").board.documentAttachments.find((item) => item.id === attachment.id);
    expect(archived).toMatchObject({
      attachment_no: attachment.attachment_no,
      entity_type: "technical_disposition",
      entity_no: disposition.disposition_no,
    });
  });

  it("tracks supplier certificate expiry and auto-adjusts admission after annual review", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-ADMIN");
    const supplier = before.board.suppliers.find((item) => item.id === "SUP-001") as Record<string, unknown>;
    const material = before.board.materials.find((item) => item.status === "active") as Record<string, unknown>;

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSupplierCertificate",
      entityId: String(supplier.id),
      payload: {
        certificate_type: "quality_system",
        certificate_name: "ISO9001 质量管理体系认证",
        certificate_no: "ISO-EXPIRED-2020",
        issued_at: "2019-01-01",
        expires_at: "2020-01-01",
        remind_days: "90",
        note: "客户采购评审前发现证书已过期，需供应商补充新证。",
      },
    });

    let snapshot = service.getSnapshot("U-ADMIN");
    const expiredCertificate = snapshot.board.supplierQualificationCertificates.find(
      (item) => item.certificate_no === "ISO-EXPIRED-2020",
    );
    expect(expiredCertificate).toMatchObject({
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      certificate_name: "ISO9001 质量管理体系认证",
      certificate_no: "ISO-EXPIRED-2020",
      expiry_status: "expired",
      expiry_status_label: "已过期",
      days_until_expiry: expect.any(Number),
    });
    expect(snapshot.summary.supplierCertificateDueCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.summary.supplierAnnualReviewDueCount).toBeGreaterThanOrEqual(1);

    service.performAction({
      actorId: "U-MGR",
      action: "recordSupplierAnnualReview",
      entityId: String(supplier.id),
      payload: {
        review_year: "2026",
        quality_score: "55",
        delivery_score: "58",
        certificate_score: "35",
        cooperation_score: "60",
        final_score: "58",
        conclusion: "年度复评不通过：质量表现不足，且核心资质证书已过期。",
        next_review_due_at: "2027-05-14",
      },
    });

    snapshot = service.getSnapshot("U-PUR");
    expect(snapshot.board.supplierAnnualReviews[0]).toMatchObject({
      supplier_id: supplier.id,
      review_year: 2026,
      final_score: 58,
      previous_status: "normal",
      next_status: "blacklisted",
      previous_status_label: "准入正常",
      next_status_label: "黑名单",
      certificate_status_label: "存在过期资质",
      result_label: "复评不通过",
      next_review_due_at: "2027-05-14",
    });
    expect(snapshot.board.supplierAdmissionControls.find((item) => item.supplier_id === supplier.id)).toMatchObject({
      control_status: "blacklisted",
      control_status_label: "黑名单",
      purchase_allowed: 0,
      source_type: "supplier_annual_review",
      reason: expect.stringContaining("年度复评不通过"),
    });
    expect(snapshot.board.supplierCorrectiveActions[0]).toMatchObject({
      supplier_id: supplier.id,
      status: "open",
      required_action: expect.stringContaining("年度复评"),
    });
    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrder",
        payload: {
          supplier_id: supplier.id,
          due_date: "2026-09-10",
          lines: [{ material_id: material.id, qty: "2", unit_cost: "42" }],
        },
      }),
    ).toThrow("供应商准入");

    service.performAction({
      actorId: "U-MGR",
      action: "recordSupplierAnnualReview",
      entityId: String(supplier.id),
      payload: {
        review_year: "2027",
        quality_score: "90",
        delivery_score: "88",
        certificate_score: "92",
        cooperation_score: "91",
        final_score: "90",
        conclusion: "年度复评通过：新资质已补齐，质量和交付表现恢复稳定。",
        next_review_due_at: "2028-05-14",
      },
    });

    snapshot = service.getSnapshot("U-PUR");
    expect(snapshot.board.supplierAnnualReviews[0]).toMatchObject({
      review_year: 2027,
      result_label: "复评通过",
      previous_status: "blacklisted",
      next_status: "normal",
    });
    expect(snapshot.board.supplierAdmissionControls.find((item) => item.supplier_id === supplier.id)).toMatchObject({
      control_status: "normal",
      control_status_label: "准入正常",
      purchase_allowed: 1,
      release_note: expect.stringContaining("年度复评通过"),
    });
  });

  it("archives supplier certificate attachments, reminds expiry tasks, and routes admission changes through approval", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-PUR");
    const supplier = before.board.suppliers.find((item) => item.id === "SUP-001") as Record<string, unknown>;
    const material = before.board.materials.find((item) => item.status === "active") as Record<string, unknown>;

    service.performAction({
      actorId: "U-PUR",
      action: "upsertSupplierCertificate",
      entityId: String(supplier.id),
      payload: {
        certificate_type: "quality_system",
        certificate_name: "ISO9001 质量管理体系认证",
        certificate_no: "ISO-ARCHIVE-2026",
        issued_at: "2023-05-01",
        expires_at: "2026-05-20",
        remind_days: "30",
        note: "供应商补充证书扫描件，系统需提醒临期并归档附件。",
      },
    });

    let snapshot = service.getSnapshot("U-PUR");
    const certificate = snapshot.board.supplierQualificationCertificates.find(
      (item) => item.certificate_no === "ISO-ARCHIVE-2026",
    ) as Record<string, unknown>;
    expect(certificate).toMatchObject({
      supplier_id: supplier.id,
      expiry_status: "expiring",
      expiry_status_label: "即将到期",
      attachment_count: 0,
    });
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `task-supplier-certificate-${certificate.id}`,
          action: "renewSupplierCertificate",
          title: expect.stringContaining("资质到期"),
        }),
      ]),
    );

    const attachment = await service.createDocumentAttachment({
      actorId: "U-PUR",
      entityType: "supplier_certificate",
      entityId: String(certificate.id),
      entityNo: String(certificate.qualification_no),
      category: "供应商资质证书",
      fileName: "ISO9001-2026-供应商盖章扫描件.pdf",
      mimeType: "application/pdf",
      note: "供应商盖章版资质证书，纳入本地归档。",
      buffer: Buffer.from("supplier qualification certificate bytes", "utf8"),
    });
    expect(attachment).toMatchObject({
      entity_type: "supplier_certificate",
      entity_id: certificate.id,
      entity_no: certificate.qualification_no,
      category: "供应商资质证书",
    });

    snapshot = service.getSnapshot("U-PUR");
    const archivedCertificate = snapshot.board.supplierQualificationCertificates.find(
      (item) => item.id === certificate.id,
    ) as Record<string, unknown>;
    expect(archivedCertificate).toMatchObject({
      attachment_count: 1,
      latest_attachment_no: attachment.attachment_no,
      latest_attachment_name: "ISO9001-2026-供应商盖章扫描件.pdf",
    });

    service.performAction({
      actorId: "U-PUR",
      action: "recordSupplierAnnualReview",
      entityId: String(supplier.id),
      payload: {
        review_year: "2026",
        quality_score: "58",
        delivery_score: "64",
        certificate_score: "55",
        cooperation_score: "60",
        final_score: "58",
        conclusion: "年度复评触发准入等级下降，需管理层审批后生效。",
        next_review_due_at: "2027-05-14",
      },
    });

    snapshot = service.getSnapshot("U-PUR");
    const review = snapshot.board.supplierAnnualReviews[0] as Record<string, unknown>;
    expect(review).toMatchObject({
      supplier_id: supplier.id,
      review_year: 2026,
      previous_status: "normal",
      next_status: "blacklisted",
      status: "pending_approval",
      status_label: "待审批生效",
      approval_status: "pending",
    });
    expect(snapshot.board.supplierAdmissionControls.find((item) => item.supplier_id === supplier.id)).toBeUndefined();
    expect(
      snapshot.board.approvalCenter.some(
        (item) =>
          item.business_entity_type === "supplier_annual_review" &&
          item.business_entity_id === review.id &&
          item.approve_action === "approveApproval",
      ),
    ).toBe(true);
    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrder",
        payload: {
          supplier_id: supplier.id,
          due_date: "2026-08-10",
          lines: [{ material_id: material.id, qty: "1", unit_cost: "38" }],
        },
      }),
    ).not.toThrow();

    const approval = service
      .getSnapshot("U-MGR")
      .board.approvalRequests.find(
        (item) => item.entity_type === "supplier_annual_review" && item.entity_id === review.id,
      ) as Record<string, unknown>;
    service.performAction({
      actorId: "U-MGR",
      action: "approveApproval",
      entityId: String(approval.id),
      payload: { approval_note: "同意年度复评结论，准入等级调整为黑名单并生成整改。" },
    });

    snapshot = service.getSnapshot("U-PUR");
    expect(snapshot.board.supplierAnnualReviews[0]).toMatchObject({
      id: review.id,
      status: "approved",
      status_label: "已审批生效",
      approved_by_name: "管理层-王总",
      approval_note: "同意年度复评结论，准入等级调整为黑名单并生成整改。",
    });
    expect(snapshot.board.supplierAdmissionControls.find((item) => item.supplier_id === supplier.id)).toMatchObject({
      control_status: "blacklisted",
      purchase_allowed: 0,
      source_type: "supplier_annual_review",
      source_id: review.id,
    });
    expect(snapshot.board.supplierCorrectiveActions[0]).toMatchObject({
      supplier_id: supplier.id,
      status: "open",
      required_action: expect.stringContaining("年度复评"),
    });
    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrder",
        payload: {
          supplier_id: supplier.id,
          due_date: "2026-09-10",
          lines: [{ material_id: material.id, qty: "2", unit_cost: "42" }],
        },
      }),
    ).toThrow("供应商准入");
  });

  it("renews expiring supplier certificates, retires the old certificate, and refreshes qualification risk", async () => {
    const service = await loadService();
    let snapshot = service.getSnapshot("U-PUR");
    const oldCertificate = snapshot.board.supplierQualificationCertificates.find(
      (item) => item.supplier_id === "SUP-002" && item.expiry_status === "expired",
    ) as Record<string, unknown>;
    expect(oldCertificate).toMatchObject({
      supplier_name: "苏州涂装化工有限公司",
      expiry_status_label: "已过期",
    });
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `task-supplier-certificate-${oldCertificate.id}`,
          title: expect.stringContaining("资质到期"),
        }),
      ]),
    );

    service.performAction({
      actorId: "U-PUR",
      action: "renewSupplierCertificate",
      entityId: String(oldCertificate.id),
      payload: {
        certificate_no: "CHEM-RENEWED-2028-001",
        issued_at: "2026-05-14",
        expires_at: "2028-05-13",
        remind_days: "90",
        note: "供应商已补充新版危险化学品经营备案，旧证自动归档为已续证。",
      },
    });

    snapshot = service.getSnapshot("U-PUR");
    const renewedOld = snapshot.board.supplierQualificationCertificates.find((item) => item.id === oldCertificate.id);
    const newCertificate = snapshot.board.supplierQualificationCertificates.find(
      (item) => item.certificate_no === "CHEM-RENEWED-2028-001",
    ) as Record<string, unknown>;
    expect(renewedOld).toMatchObject({
      id: oldCertificate.id,
      status: "renewed",
      status_label: "已续证",
      renewed_to_no: newCertificate.qualification_no,
      expiry_status_label: "已续证归档",
    });
    expect(newCertificate).toMatchObject({
      supplier_id: oldCertificate.supplier_id,
      renewed_from_id: oldCertificate.id,
      renewed_from_no: oldCertificate.qualification_no,
      certificate_name: oldCertificate.certificate_name,
      expiry_status: "valid",
      expiry_status_label: "有效",
      status: "active",
      status_label: "有效",
    });
    expect(snapshot.summary.supplierCertificateDueCount).toBe(1);
    expect(snapshot.tasks.some((task) => task.id === `task-supplier-certificate-${oldCertificate.id}`)).toBe(false);
    expect(snapshot.board.supplierAnnualReviews.length).toBe(0);

    const attachment = await service.createDocumentAttachment({
      actorId: "U-PUR",
      entityType: "supplier_certificate",
      entityId: String(newCertificate.id),
      entityNo: String(newCertificate.qualification_no),
      category: "供应商续证附件",
      fileName: "CHEM-RENEWED-2028-001-盖章件.pdf",
      mimeType: "application/pdf",
      note: "新版资质证书盖章件，续证后归档。",
      buffer: Buffer.from("renewed supplier certificate bytes", "utf8"),
    });

    snapshot = service.getSnapshot("U-PUR");
    expect(snapshot.board.supplierQualificationCertificates.find((item) => item.id === newCertificate.id)).toMatchObject({
      attachment_count: 1,
      latest_attachment_no: attachment.attachment_no,
      latest_attachment_name: "CHEM-RENEWED-2028-001-盖章件.pdf",
    });
    expect(snapshot.board.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "renewSupplierCertificate",
          entity_type: "supplier_qualification_certificate",
          entity_id: newCertificate.id,
        }),
      ]),
    );
  });

  it("builds a required qualification matrix and blocks purchase orders with missing mandatory certificates", async () => {
    const service = await loadService();
    let snapshot = service.getSnapshot("U-PUR");
    const supplier = snapshot.board.suppliers.find((item) => item.id === "SUP-002") as Record<string, unknown>;
    const coating = snapshot.board.materials.find((item) => item.id === "M-COATING") as Record<string, unknown>;

    const matrixRow = snapshot.board.supplierQualificationMatrix.find(
      (item) => item.supplier_id === supplier.id && item.material_id === coating.id,
    );
    expect(matrixRow).toMatchObject({
      supplier_name: "苏州涂装化工有限公司",
      material_name: "防锈涂层液",
      certificate_name: "危险化学品经营备案",
      compliance_status: "expired",
      compliance_status_label: "已过期",
      purchase_blocking: 1,
      purchase_blocking_label: "阻止下单",
    });
    expect(snapshot.summary.supplierQualificationBlockingCount).toBeGreaterThanOrEqual(1);
    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrder",
        payload: {
          supplier_id: supplier.id,
          due_date: "2026-06-30",
          lines: [{ material_id: coating.id, qty: "1", unit_cost: "52" }],
        },
      }),
    ).toThrow("必备资质");

    const expiredCertificate = snapshot.board.supplierQualificationCertificates.find(
      (item) => item.supplier_id === supplier.id && item.certificate_name === "危险化学品经营备案",
    ) as Record<string, unknown>;
    service.performAction({
      actorId: "U-PUR",
      action: "renewSupplierCertificate",
      entityId: String(expiredCertificate.id),
      payload: {
        certificate_no: "CHEM-MATRIX-2028-001",
        issued_at: "2026-05-14",
        expires_at: "2028-05-13",
        remind_days: "90",
        note: "按必备资质矩阵完成续证。",
      },
    });

    snapshot = service.getSnapshot("U-PUR");
    expect(
      snapshot.board.supplierQualificationMatrix.find(
        (item) => item.supplier_id === supplier.id && item.material_id === coating.id,
      ),
    ).toMatchObject({
      compliance_status: "compliant",
      compliance_status_label: "符合",
      purchase_blocking: 0,
      purchase_blocking_label: "允许下单",
      matched_certificate_no: "CHEM-MATRIX-2028-001",
    });
    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrder",
        payload: {
          supplier_id: supplier.id,
          due_date: "2026-07-15",
          lines: [{ material_id: coating.id, qty: "1", unit_cost: "52" }],
        },
      }),
    ).not.toThrow();
  });
});

describe("ERP service formal go-live initialization", () => {
  it("imports opening inventory, receivables, and payables with auditable initialization batches", async () => {
    const service = await loadService();

    const inventoryResult = service.importOpeningDataRows({
      actorId: "U-ADMIN",
      type: "opening-inventory",
      rows: [
        {
          material_code: "M-STEEL",
          batch_no: "OPEN-STEEL-20260101",
          qty: 12,
          unit_cost: 13.5,
          received_at: "2026-01-01",
          note: "上线期初库存",
        },
      ],
    });
    expect(inventoryResult).toMatchObject({ importedRows: 1, created: 1, totalAmount: 162 });
    let snapshot = service.getSnapshot("U-ADMIN");
    expect(snapshot.board.batches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          batch_no: "OPEN-STEEL-20260101",
          qty: 12,
          unit_cost: 13.5,
        }),
      ]),
    );
    expect(snapshot.board.inventoryTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movement_type: "opening_inventory",
          source_type: "opening_balance",
          batch_no: "OPEN-STEEL-20260101",
          qty: 12,
        }),
      ]),
    );

    const receivableResult = service.importOpeningDataRows({
      actorId: "U-ADMIN",
      type: "opening-receivables",
      rows: [
        {
          customer_code: "C-001",
          receivable_no: "YS-OPEN-001",
          total_amount: 8800,
          received_amount: 1800,
          due_date: "2026-02-15",
          created_at: "2026-01-01",
          note: "上线期初应收",
        },
      ],
    });
    expect(receivableResult).toMatchObject({ importedRows: 1, created: 1, totalAmount: 8800 });
    snapshot = service.getSnapshot("U-FIN");
    expect(snapshot.board.receivables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          receivable_no: "YS-OPEN-001",
          customer_name: "上海星河装备有限公司",
          total_amount: 8800,
          received_amount: 1800,
          balance_amount: 7000,
          status: "partial",
        }),
      ]),
    );

    const payableResult = service.importOpeningDataRows({
      actorId: "U-ADMIN",
      type: "opening-payables",
      rows: [
        {
          supplier_code: "SUP-001",
          payable_no: "YF-OPEN-001",
          total_amount: 4600,
          paid_amount: 600,
          due_date: "2026-02-20",
          created_at: "2026-01-03",
          note: "上线期初应付",
        },
      ],
    });
    expect(payableResult).toMatchObject({ importedRows: 1, created: 1, totalAmount: 4600 });
    snapshot = service.getSnapshot("U-ADMIN");
    expect(snapshot.board.payables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payable_no: "YF-OPEN-001",
          supplier_name: "江苏华材金属有限公司",
          total_amount: 4600,
          paid_amount: 600,
          balance_amount: 4000,
          status: "partial",
        }),
      ]),
    );
    expect(snapshot.board.initializationImports.map((item) => item.type)).toEqual(
      expect.arrayContaining(["opening-inventory", "opening-receivables", "opening-payables"]),
    );
  });
});

describe("ERP service formal procurement contract and arrival signoff", () => {
  it("closes purchase contract, supplier ordering, arrival notice, warehouse signoff and IQC handoff", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-PUR");
    const supplier = before.board.suppliers.find((item) => item.status === "active");
    const material = before.board.materials.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier?.id,
        due_date: "2026-08-15",
        lines: [{ material_id: material?.id, qty: "12", unit_cost: "42" }],
      },
    });
    let snapshot = service.getSnapshot("U-PUR");
    const purchaseOrder = snapshot.board.purchaseOrders[0] as Record<string, unknown>;
    const approval = snapshot.board.approvalRequests.find((item) => item.entity_id === purchaseOrder.id);
    service.performAction({ actorId: "U-MGR", action: "approveApproval", entityId: String(approval?.id) });

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseContract",
      entityId: String(purchaseOrder.id),
      payload: {
        contract_date: "2026-07-01",
        delivery_date: "2026-07-08",
        supplier_order_no: "SUP-ORDER-20260701-001",
        payment_terms: "月结30天",
      },
    });
    snapshot = service.getSnapshot("U-PUR");
    const contract = snapshot.board.purchaseContracts[0] as Record<string, unknown>;
    expect(contract).toMatchObject({
      purchase_order_id: purchaseOrder.id,
      supplier_order_no: "SUP-ORDER-20260701-001",
      status: "supplier_ordered",
      status_label: "已向供应商下单",
    });

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseArrivalNotice",
      entityId: String(purchaseOrder.id),
      payload: {
        arrived_at: "2026-07-08",
        note: "供应商按合同到货，通知仓库签收。",
      },
    });
    snapshot = service.getSnapshot("U-WH");
    const arrival = snapshot.board.purchaseArrivalNotices[0] as Record<string, unknown>;
    expect(arrival).toMatchObject({
      purchase_order_id: purchaseOrder.id,
      purchase_contract_id: contract.id,
      status: "pending_signoff",
      status_label: "待仓库签收",
    });
    expect(arrival.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          materialId: material?.id,
          arrivedQty: 12,
          unitCost: 42,
        }),
      ]),
    );

    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createMaterialIqcInspection",
        entityId: String(purchaseOrder.id),
        payload: { arrival_notice_id: arrival.id },
      }),
    ).toThrow("到货通知单必须先由仓库签收");

    service.performAction({
      actorId: "U-WH",
      action: "signPurchaseArrivalNotice",
      entityId: String(arrival.id),
      payload: {
        warehouse_received_at: "2026-07-08",
        warehouse_note: "外包装完好，数量与采购单一致。",
      },
    });
    snapshot = service.getSnapshot("U-WH");
    expect(snapshot.board.purchaseArrivalNotices[0]).toMatchObject({
      id: arrival.id,
      status: "signed",
      warehouse_received_by_name: "仓库管理员-吴勇",
    });

    const contractExport = await service.buildExport({
      actorId: "U-PUR",
      type: "purchase-contract",
      entityId: String(contract.id),
      format: "xlsx",
    });
    const contractXml = xlsxXml(contractExport.buffer);
    expect(contractExport.fileName).toContain("purchase-contract");
    expect(contractXml).toContain("采购合同");
    expect(contractXml).toContain(String(contract.contract_no));
    expect(contractXml).toContain("供应商下单");

    const arrivalExport = await service.buildExport({
      actorId: "U-PUR",
      type: "purchase-arrival-notice",
      entityId: String(arrival.id),
      format: "xlsx",
    });
    const arrivalXml = xlsxXml(arrivalExport.buffer);
    expect(arrivalExport.fileName).toContain("purchase-arrival-notice");
    expect(arrivalXml).toContain("到货通知单");
    expect(arrivalXml).toContain(String(arrival.arrival_no));

    const signoffExport = await service.buildExport({
      actorId: "U-WH",
      type: "warehouse-signoff",
      entityId: String(arrival.id),
      format: "xlsx",
    });
    const signoffXml = xlsxXml(signoffExport.buffer);
    expect(signoffExport.fileName).toContain("warehouse-signoff");
    expect(signoffXml).toContain("仓库签收单");
    expect(signoffXml).toContain("仓库管理员-吴勇");

    const attachmentContent = Buffer.from("signed supplier purchase contract bytes", "utf8");
    const attachment = await service.createDocumentAttachment({
      actorId: "U-PUR",
      entityType: "purchase_contract",
      entityId: String(contract.id),
      entityNo: String(contract.contract_no),
      category: "采购合同",
      fileName: "供应商盖章采购合同.pdf",
      mimeType: "application/pdf",
      note: "供应商回传盖章合同，纳入本地数据盘归档。",
      buffer: attachmentContent,
    });
    expect(attachment).toMatchObject({
      entity_type: "purchase_contract",
      entity_no: contract.contract_no,
      category: "采购合同",
      file_name: "供应商盖章采购合同.pdf",
    });
    const attachmentSnapshot = service.getSnapshot("U-ADMIN");
    expect(attachmentSnapshot.board.documentAttachments[0]).toMatchObject({
      id: attachment.id,
      entity_type_label: "采购合同",
      entity_no: contract.contract_no,
    });

    service.performAction({
      actorId: "U-PUR",
      action: "createMaterialIqcInspection",
      entityId: String(purchaseOrder.id),
      payload: { arrival_notice_id: arrival.id },
    });
    snapshot = service.getSnapshot("U-QA");
    const iqc = snapshot.board.materialIqcInspections[0] as Record<string, unknown>;
    expect(iqc).toMatchObject({
      purchase_order_id: purchaseOrder.id,
      arrival_no: arrival.arrival_no,
      arrived_at: "2026-07-08",
      status: "pending",
    });
    expect(snapshot.board.purchaseArrivalNotices[0]).toMatchObject({
      id: arrival.id,
      status: "iqc_created",
      iqc_no: iqc.iqc_no,
    });

    service.performAction({
      actorId: "U-QA",
      action: "completeMaterialIqcInspection",
      entityId: String(iqc.id),
      payload: {
        result: "qualified",
        inspected_at: "2026-07-09",
        measurements: "来料尺寸、外观、材质单据核对合格。",
      },
    });
    snapshot = service.getSnapshot("U-PUR");
    expect(snapshot.board.purchaseArrivalNotices[0]).toMatchObject({
      id: arrival.id,
      status: "inbounded",
      status_label: "已入库",
    });
    const receivedPurchaseOrders = snapshot.board.purchaseOrders as Array<Record<string, unknown>>;
    expect(receivedPurchaseOrders.find((item) => item.id === purchaseOrder.id)).toMatchObject({
      status: "received",
      contract_no: contract.contract_no,
      arrival_no: arrival.arrival_no,
    });
  });

  it("freezes an arrival with quantity price or batch discrepancies until approval and resolution are completed", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-PUR");
    const supplier = before.board.suppliers.find((item) => item.status === "active");
    const material = before.board.materials.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier?.id,
        due_date: "2026-08-20",
        lines: [{ material_id: material?.id, qty: "12", unit_cost: "42" }],
      },
    });
    let snapshot = service.getSnapshot("U-PUR");
    const purchaseOrder = snapshot.board.purchaseOrders[0] as Record<string, unknown>;
    const purchaseApproval = snapshot.board.approvalRequests.find((item) => item.entity_id === purchaseOrder.id);
    service.performAction({ actorId: "U-MGR", action: "approveApproval", entityId: String(purchaseApproval?.id) });
    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseContract",
      entityId: String(purchaseOrder.id),
      payload: {
        contract_date: "2026-07-10",
        delivery_date: "2026-07-18",
        supplier_order_no: "SUP-ORDER-DIFF-001",
      },
    });
    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseArrivalNotice",
      entityId: String(purchaseOrder.id),
      payload: { arrived_at: "2026-07-18" },
    });

    snapshot = service.getSnapshot("U-WH");
    const arrival = snapshot.board.purchaseArrivalNotices[0] as Record<string, unknown>;
    const arrivalLine = (arrival.lines as Array<Record<string, unknown>>)[0];

    service.performAction({
      actorId: "U-WH",
      action: "registerPurchaseArrivalDiscrepancy",
      entityId: String(arrival.id),
      payload: {
        reason: "实到数量少于合同数量，供应商批次号与通知单不一致，实际随货价格也发生变化。",
        handling_decision: "supplier_replenish",
        proposed_action: "按实收数量进入签收与 IQC，同时要求供应商补发短少数量。",
        lines: [
          {
            arrival_notice_line_id: arrivalLine.lineId,
            actual_arrived_qty: "9.5",
            actual_unit_cost: "44",
            actual_batch_hint: "REAL-BATCH-20260718",
            note: "短少 2.5kg，单价上浮 2 元，批次以随货标签为准。",
          },
        ],
      },
    });

    snapshot = service.getSnapshot("U-MGR");
    const discrepancy = snapshot.board.purchaseArrivalDiscrepancies[0] as Record<string, unknown>;
    expect(discrepancy).toMatchObject({
      arrival_notice_id: arrival.id,
      purchase_order_id: purchaseOrder.id,
      discrepancy_type: "mixed",
      status: "pending_approval",
      status_label: "差异待审批",
      handling_decision_label: "供应商补货",
      quantity_variance_qty: -2.5,
      price_variance_amount: 19,
      total_adjustment_amount: -86,
    });
    expect(discrepancy.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          materialId: material?.id,
          actualArrivedQty: 9.5,
          actualUnitCost: 44,
          actualBatchHint: "REAL-BATCH-20260718",
        }),
      ]),
    );
    expect(snapshot.board.purchaseArrivalNotices[0]).toMatchObject({
      id: arrival.id,
      status: "discrepancy_pending",
      status_label: "差异待审批",
      total_arrived_qty: 9.5,
      total_amount: 418,
    });
    const discrepancyApproval = snapshot.board.approvalRequests.find((item) => item.entity_id === discrepancy.id);
    expect(discrepancyApproval).toMatchObject({
      entity_type: "purchase_arrival_discrepancy",
      title: expect.stringContaining("到货差异审批"),
      status: "pending",
    });

    expect(() =>
      service.performAction({
        actorId: "U-WH",
        action: "signPurchaseArrivalNotice",
        entityId: String(arrival.id),
      }),
    ).toThrow("到货差异尚未处理完成");

    service.performAction({
      actorId: "U-MGR",
      action: "approveApproval",
      entityId: String(discrepancyApproval?.id),
      payload: { approval_note: "同意供应商补货，当前实收到货先进入检验流程。" },
    });
    snapshot = service.getSnapshot("U-PUR");
    expect(snapshot.board.purchaseArrivalDiscrepancies[0]).toMatchObject({
      id: discrepancy.id,
      status: "approved",
      status_label: "差异已批准",
      approved_by_name: "管理层-王总",
    });

    service.performAction({
      actorId: "U-PUR",
      action: "resolvePurchaseArrivalDiscrepancy",
      entityId: String(discrepancy.id),
      payload: {
        resolution_result: "supplier_replenish",
        resolution_note: "已通知供应商补发短少数量；本次到货按实收数量和实际批次继续签收。",
      },
    });
    snapshot = service.getSnapshot("U-WH");
    expect(snapshot.board.purchaseArrivalDiscrepancies[0]).toMatchObject({
      id: discrepancy.id,
      status: "resolved",
      status_label: "差异已处理",
      resolution_result_label: "供应商补货",
      resolved_by_name: "采购员-孙倩",
    });
    const resolvedArrival = snapshot.board.purchaseArrivalNotices[0] as Record<string, unknown>;
    expect(resolvedArrival).toMatchObject({
      id: arrival.id,
      status: "pending_signoff",
      total_arrived_qty: 9.5,
      total_amount: 418,
    });
    expect(resolvedArrival.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arrivedQty: 9.5,
          unitCost: 44,
          lineAmount: 418,
          batchHint: "REAL-BATCH-20260718",
        }),
      ]),
    );

    const discrepancyExport = await service.buildExport({
      actorId: "U-PUR",
      type: "purchase-arrival-discrepancy",
      entityId: String(discrepancy.id),
      format: "xlsx",
    });
    const discrepancyXml = xlsxXml(discrepancyExport.buffer);
    expect(discrepancyExport.fileName).toContain("purchase-arrival-discrepancy");
    expect(discrepancyXml).toContain('name="purchase_arrival_discrepancy"');
    expect(discrepancyXml).toContain("到货差异单");
    expect(discrepancyXml).toContain(String(discrepancy.discrepancy_no));
    expect(discrepancyXml).toContain("供应商补货");

    const supplierDiscrepancyReport = await service.buildExport({
      actorId: "U-MGR",
      type: "supplier-discrepancy",
      format: "xlsx",
    });
    const supplierDiscrepancyXml = xlsxXml(supplierDiscrepancyReport.buffer);
    expect(supplierDiscrepancyReport.fileName).toContain("supplier-discrepancy");
    expect(supplierDiscrepancyXml).toContain('name="supplier_discrepancy_summary"');
    expect(supplierDiscrepancyXml).toContain('name="supplier_discrepancy_detail"');
    expect(supplierDiscrepancyXml).toContain("供应商差异统计报表");
    expect(supplierDiscrepancyXml).toContain(String(supplier?.name));

    snapshot = service.getSnapshot("U-MGR");
    const supplierPerformance = (snapshot.board.supplierPerformance as Array<Record<string, unknown>>).find(
      (item) => item.supplier_id === supplier?.id,
    );
    expect(supplierPerformance).toMatchObject({
      supplier_name: supplier?.name,
      discrepancy_count: 1,
      risk_level: expect.any(String),
      grade_label: expect.any(String),
      recommendation: expect.any(String),
    });

    const supplierPerformanceReport = await service.buildExport({
      actorId: "U-MGR",
      type: "supplier-performance",
      format: "xlsx",
    });
    const supplierPerformanceXml = xlsxXml(supplierPerformanceReport.buffer);
    expect(supplierPerformanceReport.fileName).toContain("supplier-performance");
    expect(supplierPerformanceXml).toContain('name="supplier_performance"');
    expect(supplierPerformanceXml).toContain("供应商绩效评分报表");
    expect(supplierPerformanceXml).toContain(String(supplier?.name));
    expect(supplierPerformanceXml).toContain("绩效评分");

    service.performAction({
      actorId: "U-WH",
      action: "signPurchaseArrivalNotice",
      entityId: String(arrival.id),
      payload: {
        warehouse_received_at: "2026-07-18",
        warehouse_note: "差异已审批处理，按实收数量签收。",
      },
    });
    service.performAction({
      actorId: "U-PUR",
      action: "createMaterialIqcInspection",
      entityId: String(purchaseOrder.id),
      payload: { arrival_notice_id: arrival.id },
    });
    snapshot = service.getSnapshot("U-QA");
    const iqc = snapshot.board.materialIqcInspections[0] as Record<string, unknown>;
    expect(iqc.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          receivedQty: 9.5,
          unitCost: 44,
        }),
      ]),
    );
  });
});

describe("ERP service formal authentication and RBAC administration", () => {
  it("authenticates by account, hides passwords from snapshots, and lets admins manage user status", async () => {
    const service = await loadService();

    const login = service.authenticateUser({ account: "sales", password: "sales123" });
    expect(login.user).toMatchObject({
      id: "U-SALES",
      username: "sales",
      role: "sales",
      status: "active",
    });
    expect(login.token).toHaveLength(43);
    expect(() => service.authenticateUser({ account: "sales", password: "bad-password" })).toThrow("账号或密码不正确");

    const snapshot = service.getSnapshot(login.user.id);
    expect(snapshot.users[0]).not.toHaveProperty("password");
    expect(snapshot.users[0]).not.toHaveProperty("password_hash");
    expect(snapshot.security.currentPermissions).toContain("createQuote");
    expect(snapshot.security.rolePermissions.some((item) => item.role === "admin" && item.action === "resetUserPassword")).toBe(true);

    service.performAction({
      actorId: "U-ADMIN",
      action: "resetUserPassword",
      entityId: "U-SALES",
      payload: { new_password: "Newpass@2026" },
    });
    expect(service.authenticateUser({ account: "sales", password: "Newpass@2026" }).user.id).toBe("U-SALES");

    service.performAction({
      actorId: "U-ADMIN",
      action: "updateUserStatus",
      entityId: "U-SALES",
      payload: { status: "inactive" },
    });
    expect(() => service.authenticateUser({ account: "sales", password: "Newpass@2026" })).toThrow("账号已停用");

    const disabledSnapshot = service.getSnapshot("U-ADMIN");
    const disabledUser = disabledSnapshot.users.find((user) => user.id === "U-SALES");
    expect(disabledUser?.status).toBe("inactive");
  });

  it("exposes formal system governance settings, permission matrix summaries and login logs", async () => {
    const service = await loadService();

    service.authenticateUser({ account: "warehouse", password: "wh123" });

    const before = service.getSnapshot("U-ADMIN") as unknown as {
      board: {
        systemSettings: Array<Record<string, unknown>>;
        loginLogs: Array<Record<string, unknown>>;
      };
      security: {
        permissionMatrix: Array<Record<string, unknown>>;
      };
    };

    expect(before.board.systemSettings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          setting_key: "backup_frequency",
          setting_label: "备份频率",
          setting_value: "daily",
          category_label: "备份归档",
        }),
      ]),
    );
    expect(before.security.permissionMatrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "admin",
          module_label: "系统管理",
          action_count: expect.any(Number),
          high_risk_count: expect.any(Number),
        }),
      ]),
    );
    expect(before.board.loginLogs[0]).toMatchObject({
      action: "login",
      actor_name: "仓库管理员-吴勇",
      entity_type: "user",
    });

    expect(() =>
      service.performAction({
        actorId: "U-WH",
        action: "upsertSystemSetting",
        entityId: "backup_frequency",
        payload: { setting_value: "weekly" },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSystemSetting",
      entityId: "backup_frequency",
      payload: {
        setting_value: "weekly",
        description: "每周五下班前由系统管理员生成完整冷备份。",
      },
    });

    const after = service.getSnapshot("U-ADMIN") as unknown as {
      board: {
        systemSettings: Array<Record<string, unknown>>;
        auditLogs: Array<Record<string, unknown>>;
      };
    };
    expect(after.board.systemSettings.find((item) => item.setting_key === "backup_frequency")).toMatchObject({
      setting_value: "weekly",
      description: "每周五下班前由系统管理员生成完整冷备份。",
      updated_by_name: "系统管理员-管理员",
    });
    expect(after.board.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsertSystemSetting",
          entity_id: "backup_frequency",
        }),
      ]),
    );
  });

  it("exposes a formal process cockpit and configurable operating parameters", async () => {
    const service = await loadService();

    const snapshot = service.getSnapshot("U-MGR") as unknown as {
      summary: Record<string, unknown>;
      board: {
        processFlow: Array<Record<string, unknown>>;
        processFlowSummary: Record<string, unknown>;
        systemSettings: Array<Record<string, unknown>>;
        auditLogs: Array<Record<string, unknown>>;
      };
    };

    expect(snapshot.board.processFlowSummary).toMatchObject({
      node_count: expect.any(Number),
      pending_total: expect.any(Number),
      exception_total: expect.any(Number),
      health_rate: expect.any(Number),
    });
    expect(snapshot.summary).toMatchObject({
      processNodeCount: expect.any(Number),
      processExceptionCount: expect.any(Number),
    });
    expect(snapshot.board.processFlow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "quote_pricing",
          sequence: 1,
          title: "报价管理 / BOM+成本",
          department: "商务销售",
          target_module: "sales",
        }),
        expect.objectContaining({
          key: "production_plan",
          title: "生产安排计划 / 工令单",
          department: "商务销售",
          target_module: "production",
        }),
        expect.objectContaining({
          key: "material_iqc",
          title: "IQC 原料来料检验",
          department: "采购仓储",
          target_module: "quality",
        }),
        expect.objectContaining({
          key: "oqc_inspection",
          title: "OQC 成品检验",
          department: "生产制造",
          target_module: "quality",
        }),
        expect.objectContaining({
          key: "shipment_receivable",
          title: "销售出货 / 应收账款",
          department: "销售财务",
          target_module: "sales",
        }),
      ]),
    );

    expect(snapshot.board.systemSettings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          setting_key: "stale_warning_days",
          setting_label: "呆滞预警天数",
          setting_value: "90",
          category_label: "库存策略",
        }),
        expect.objectContaining({
          setting_key: "overstock_days",
          setting_label: "积压纳入天数",
          setting_value: "180",
          category_label: "库存策略",
        }),
        expect.objectContaining({
          setting_key: "yield_warning_rate",
          setting_label: "收率预警线",
          setting_value: "95",
          category_label: "质量口径",
        }),
      ]),
    );

    expect(() =>
      service.performAction({
        actorId: "U-WH",
        action: "upsertSystemSetting",
        entityId: "stale_warning_days",
        payload: { setting_value: "120" },
      }),
    ).toThrow("无权执行该操作");

    expect(() =>
      service.performAction({
        actorId: "U-ADMIN",
        action: "upsertSystemSetting",
        entityId: "yield_warning_rate",
        payload: { setting_value: "150" },
      }),
    ).toThrow("百分比参数必须在 0-100 之间");

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSystemSetting",
      entityId: "stale_warning_days",
      payload: {
        setting_value: "100",
        description: "库存 100 天未发生出入库时进入呆滞预警。",
      },
    });

    const after = service.getSnapshot("U-ADMIN") as unknown as {
      board: {
        systemSettings: Array<Record<string, unknown>>;
        auditLogs: Array<Record<string, unknown>>;
      };
    };
    expect(after.board.systemSettings.find((item) => item.setting_key === "stale_warning_days")).toMatchObject({
      setting_value: "100",
      description: "库存 100 天未发生出入库时进入呆滞预警。",
      updated_by_name: "系统管理员-管理员",
    });
    expect(after.board.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upsertSystemSetting",
          entity_id: "stale_warning_days",
        }),
      ]),
    );
  });

  it("applies operating parameters to inventory aging, finance alerts and quality yield warnings", async () => {
    const service = await loadService();
    const database = (await import("./db")).getDb();
    const dueInFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const oneHundredTwentyDaysAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const twoHundredDaysAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    database.prepare("UPDATE receivables SET due_date = ? WHERE id = 'AR-HISTORY-001'").run(dueInFiveDays);
    database.prepare("UPDATE payables SET due_date = ? WHERE id = 'AP-DEMO-001'").run(dueInFiveDays);
    database.prepare("UPDATE materials SET last_movement_at = ? WHERE id = 'M-SLOW'").run(oneHundredTwentyDaysAgo);
    database.prepare("UPDATE material_batches SET last_movement_at = ? WHERE material_id = 'M-SLOW'").run(oneHundredTwentyDaysAgo);
    database.prepare("UPDATE materials SET last_movement_at = ? WHERE id = 'M-OVERSTOCK'").run(twoHundredDaysAgo);
    database.prepare("UPDATE material_batches SET last_movement_at = ? WHERE material_id = 'M-OVERSTOCK'").run(twoHundredDaysAgo);

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSystemSetting",
      entityId: "stale_warning_days",
      payload: { setting_value: "130" },
    });
    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSystemSetting",
      entityId: "overstock_days",
      payload: { setting_value: "220" },
    });
    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSystemSetting",
      entityId: "receivable_due_warning_days",
      payload: { setting_value: "3" },
    });
    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSystemSetting",
      entityId: "payable_due_warning_days",
      payload: { setting_value: "3" },
    });

    const tunedInventory = service.getSnapshot("U-MGR") as unknown as {
      summary: Record<string, unknown>;
      board: {
        materials: Array<Record<string, unknown>>;
        inventoryAging: Array<Record<string, unknown>>;
        alertCenter: Array<Record<string, unknown>>;
        operatingParameters: Record<string, unknown>;
      };
    };
    expect(tunedInventory.board.operatingParameters).toMatchObject({
      staleWarningDays: 130,
      overstockDays: 220,
      receivableDueWarningDays: 3,
      payableDueWarningDays: 3,
    });
    expect(tunedInventory.board.materials.find((item) => item.id === "M-SLOW")).toMatchObject({
      aging_status: "normal",
    });
    expect(tunedInventory.board.materials.find((item) => item.id === "M-OVERSTOCK")).toMatchObject({
      aging_status: "stale_warning",
    });
    expect(tunedInventory.board.inventoryAging.find((item) => item.id === "M-OVERSTOCK")).toMatchObject({
      aging_status: "stale_warning",
    });
    expect(tunedInventory.board.alertCenter.some((item) => item.entity_id === "AR-HISTORY-001")).toBe(false);
    expect(tunedInventory.board.alertCenter.some((item) => item.entity_id === "AP-DEMO-001")).toBe(false);
    expect(tunedInventory.board.alertCenter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alert_type: "inventory_stale",
          entity_id: "M-OVERSTOCK",
          detail: expect.stringContaining("阈值 130 天"),
        }),
      ]),
    );
    expect(tunedInventory.summary).toMatchObject({
      staleWarningCount: expect.any(Number),
      overstockCount: 0,
    });

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSystemSetting",
      entityId: "yield_warning_rate",
      payload: { setting_value: "98" },
    });
    const { production } = createProducingOrder(service, "10");
    service.performAction({ actorId: "U-PROD", action: "requestInspection", entityId: String(production.id) });
    const requested = service.getSnapshot("U-QA");
    const inspection = requested.board.inspections[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(inspection.id),
      payload: {
        result: "concession",
        actual_qty: "9.2",
        measurements: "收率低于授权预警线，需纳入生产质量复盘。",
      },
    });

    const highYieldLine = service.getSnapshot("U-MGR") as unknown as {
      summary: Record<string, unknown>;
      board: { alertCenter: Array<Record<string, unknown>>; operatingParameters: Record<string, unknown> };
    };
    expect(highYieldLine.board.operatingParameters).toMatchObject({ yieldWarningRate: 98 });
    expect(highYieldLine.summary.lowYieldWarningCount).toBeGreaterThanOrEqual(1);
    expect(highYieldLine.board.alertCenter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alert_type: "quality_yield_warning",
          entity_id: inspection.id,
          detail: expect.stringContaining("预警线 98%"),
        }),
      ]),
    );

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSystemSetting",
      entityId: "yield_warning_rate",
      payload: { setting_value: "90" },
    });
    const loweredYieldLine = service.getSnapshot("U-MGR") as unknown as {
      summary: Record<string, unknown>;
      board: { alertCenter: Array<Record<string, unknown>> };
    };
    expect(loweredYieldLine.summary.lowYieldWarningCount).toBe(0);
    expect(loweredYieldLine.board.alertCenter.some((item) => item.alert_type === "quality_yield_warning")).toBe(false);
  });

  it("previews system setting impact before saving and records the effective impact after saving", async () => {
    const service = await loadService();
    const database = (await import("./db")).getDb();
    const oneHundredTwentyDaysAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const twoHundredDaysAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    database.prepare("UPDATE materials SET last_movement_at = ? WHERE id = 'M-SLOW'").run(oneHundredTwentyDaysAgo);
    database.prepare("UPDATE material_batches SET last_movement_at = ? WHERE material_id = 'M-SLOW'").run(oneHundredTwentyDaysAgo);
    database.prepare("UPDATE materials SET last_movement_at = ? WHERE id = 'M-OVERSTOCK'").run(twoHundredDaysAgo);
    database.prepare("UPDATE material_batches SET last_movement_at = ? WHERE material_id = 'M-OVERSTOCK'").run(twoHundredDaysAgo);

    expect(() =>
      service.previewSystemSettingImpact({
        actorId: "U-WH",
        settingKey: "stale_warning_days",
        settingValue: "130",
      }),
    ).toThrow("无权执行该操作");

    const preview = service.previewSystemSettingImpact({
      actorId: "U-ADMIN",
      settingKey: "stale_warning_days",
      settingValue: "130",
    });

    expect(preview).toMatchObject({
      setting_key: "stale_warning_days",
      setting_label: "呆滞预警天数",
      current_value: "90",
      preview_value: "130",
      summary: {
        affected_count: expect.any(Number),
        risk_level: expect.any(String),
      },
    });
    expect(Number((preview.summary as Record<string, unknown>).affected_count)).toBeGreaterThanOrEqual(1);
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "inventory_stale",
          label: "呆滞预警物料",
          current_count: 1,
          preview_count: 0,
          delta: -1,
        }),
      ]),
    );

    const before = service.getSnapshot("U-ADMIN") as unknown as {
      board: { systemSettingEffects: Array<Record<string, unknown>> };
    };
    expect(before.board.systemSettingEffects).toHaveLength(0);

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertSystemSetting",
      entityId: "stale_warning_days",
      payload: {
        setting_value: "130",
        description: "库存 130 天未发生出入库时进入呆滞预警。",
      },
    });

    const after = service.getSnapshot("U-ADMIN") as unknown as {
      board: { systemSettingEffects: Array<Record<string, unknown>> };
    };
    expect(after.board.systemSettingEffects[0]).toMatchObject({
      setting_key: "stale_warning_days",
      setting_label: "呆滞预警天数",
      old_value: "90",
      new_value: "130",
      created_by_name: "系统管理员-管理员",
      impact_summary: expect.objectContaining({
        affected_count: Number((preview.summary as Record<string, unknown>).affected_count),
      }),
      summary_text: expect.stringContaining("影响"),
    });
  });

  it("exposes a formal go-live health checklist with data integrity blockers and warnings", async () => {
    const service = await loadService();
    const database = (await import("./db")).getDb();
    database.prepare("UPDATE materials SET stock_qty = -2 WHERE id = 'M-STEEL'").run();
    database.prepare("UPDATE products SET product_code = '' WHERE id = 'P-FINISHED'").run();

    const snapshot = service.getSnapshot("U-ADMIN") as unknown as {
      summary: Record<string, unknown>;
      board: {
        systemHealthSummary: Record<string, unknown>;
        systemHealthChecks: Array<Record<string, unknown>>;
      };
    };

    expect(snapshot.summary).toMatchObject({
      systemHealthScore: expect.any(Number),
      systemHealthCriticalCount: expect.any(Number),
      systemHealthWarningCount: expect.any(Number),
    });
    expect(Number(snapshot.summary.systemHealthScore)).toBeLessThan(100);
    expect(snapshot.board.systemHealthSummary).toMatchObject({
      status: "blocked",
      status_label: "存在上线阻断项",
      critical_count: expect.any(Number),
      warning_count: expect.any(Number),
    });
    expect(snapshot.board.systemHealthChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "negative_inventory",
          category: "库存成本",
          severity: "critical",
          status: "failed",
          count: 1,
          action_label: "核查库存流水",
        }),
        expect.objectContaining({
          key: "product_code_missing",
          category: "主数据",
          severity: "critical",
          status: "failed",
          count: 1,
          action_label: "补齐产品编码",
        }),
        expect.objectContaining({
          key: "backup_status",
          category: "本地归档",
          severity: "warning",
          status: "warning",
          action_label: "生成冷备份",
        }),
      ]),
    );
    expect(snapshot.board.systemHealthChecks.map((item) => item.rank)).toEqual(
      [...snapshot.board.systemHealthChecks.map((item) => item.rank)].sort((a, b) => Number(a) - Number(b)),
    );
  });

  it("creates, tracks, and closes go-live issue remediation tasks from health checks", async () => {
    const service = await loadService();
    const database = (await import("./db")).getDb();
    database.prepare("UPDATE materials SET stock_qty = -2 WHERE id = 'M-STEEL'").run();

    const before = service.getSnapshot("U-ADMIN") as unknown as {
      board: {
        systemHealthChecks: Array<Record<string, unknown>>;
        systemHealthRemediations: Array<Record<string, unknown>>;
      };
    };
    const negativeInventoryCheck = before.board.systemHealthChecks.find((item) => item.key === "negative_inventory");
    expect(negativeInventoryCheck).toMatchObject({
      severity: "critical",
      status: "failed",
      remediation_status_label: "未生成",
    });
    expect(before.board.systemHealthRemediations).toHaveLength(0);

    expect(() =>
      service.performAction({
        actorId: "U-WH",
        action: "createSystemHealthRemediation",
        entityId: "negative_inventory",
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-ADMIN",
      action: "createSystemHealthRemediation",
      entityId: "negative_inventory",
      payload: {
        owner_id: "U-WH",
        action_plan: "核查 M-STEEL 负库存，按盘点调整或冲销修正。",
      },
    });

    const created = service.getSnapshot("U-ADMIN") as unknown as {
      board: {
        systemHealthChecks: Array<Record<string, unknown>>;
        systemHealthRemediations: Array<Record<string, unknown>>;
        auditLogs: Array<Record<string, unknown>>;
      };
    };
    const remediation = created.board.systemHealthRemediations[0];
    expect(remediation).toMatchObject({
      remediation_no: expect.stringMatching(/^ZG-/),
      health_key: "negative_inventory",
      status: "pending",
      status_label: "待整改",
      owner_name: "仓库管理员-吴勇",
      action_plan: "核查 M-STEEL 负库存，按盘点调整或冲销修正。",
    });
    expect(created.board.systemHealthChecks.find((item) => item.key === "negative_inventory")).toMatchObject({
      remediation_id: remediation.id,
      remediation_no: remediation.remediation_no,
      remediation_status: "pending",
      remediation_status_label: "待整改",
      remediation_owner_name: "仓库管理员-吴勇",
    });
    expect(created.board.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "创建上线整改任务",
          entity_type: "system_health_remediation",
          entity_id: remediation.id,
        }),
      ]),
    );

    expect(() =>
      service.performAction({
        actorId: "U-ADMIN",
        action: "createSystemHealthRemediation",
        entityId: "negative_inventory",
      }),
    ).toThrow("该自检项已有未关闭整改任务");

    service.performAction({
      actorId: "U-ADMIN",
      action: "closeSystemHealthRemediation",
      entityId: String(remediation.id),
      payload: {
        result_note: "已完成盘点调整，待复核。",
      },
    });

    const closed = service.getSnapshot("U-ADMIN") as unknown as {
      board: {
        systemHealthChecks: Array<Record<string, unknown>>;
        systemHealthRemediations: Array<Record<string, unknown>>;
        auditLogs: Array<Record<string, unknown>>;
      };
    };
    expect(closed.board.systemHealthRemediations[0]).toMatchObject({
      id: remediation.id,
      status: "closed",
      status_label: "已关闭",
      closed_by_name: "系统管理员-管理员",
      result_note: "已完成盘点调整，待复核。",
    });
    expect(closed.board.systemHealthChecks.find((item) => item.key === "negative_inventory")).toMatchObject({
      remediation_id: remediation.id,
      remediation_status: "closed",
      remediation_status_label: "已关闭",
    });
    expect(closed.board.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "关闭上线整改任务",
          entity_type: "system_health_remediation",
          entity_id: remediation.id,
        }),
      ]),
    );
  });

  it("reminds overdue go-live remediations, assigns owner tasks, and archives review attachments", async () => {
    const service = await loadService();
    const database = (await import("./db")).getDb();
    database.prepare("UPDATE materials SET stock_qty = -2 WHERE id = 'M-STEEL'").run();

    service.performAction({
      actorId: "U-ADMIN",
      action: "createSystemHealthRemediation",
      entityId: "negative_inventory",
      payload: {
        owner_id: "U-WH",
        due_date: "2026-04-01",
        action_plan: "仓库核查负库存批次，补充盘点单和库存调整依据。",
      },
    });

    const ownerSnapshot = service.getSnapshot("U-WH") as unknown as {
      tasks: Array<Record<string, unknown>>;
      board: {
        alertCenter: Array<Record<string, unknown>>;
        systemHealthRemediations: Array<Record<string, unknown>>;
      };
    };
    const remediation = ownerSnapshot.board.systemHealthRemediations[0];
    expect(remediation).toMatchObject({
      health_key: "negative_inventory",
      status: "pending",
      status_label: "待整改",
      due_date: "2026-04-01",
      is_overdue: true,
      review_attachment_count: 0,
    });
    expect(ownerSnapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "system_health_remediation",
          entityId: remediation.id,
          action: "markSystemHealthRemediationReady",
          title: expect.stringContaining(String(remediation.remediation_no)),
          primaryLabel: "提交复核",
        }),
      ]),
    );
    expect(ownerSnapshot.board.alertCenter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alert_type: "system_health_remediation_due",
          severity: "critical",
          entity_type: "system_health_remediation",
          entity_id: remediation.id,
          action: "markSystemHealthRemediationReady",
        }),
      ]),
    );

    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "markSystemHealthRemediationReady",
        entityId: String(remediation.id),
        payload: { review_note: "非责任人尝试提交。" },
      }),
    ).toThrow("只有整改责任人");

    service.performAction({
      actorId: "U-WH",
      action: "markSystemHealthRemediationReady",
      entityId: String(remediation.id),
      payload: { review_note: "已核查库存流水，整改资料已补齐，提交管理员复核。" },
    });

    await service.createDocumentAttachment({
      actorId: "U-WH",
      entityType: "system_health_remediation",
      entityId: String(remediation.id),
      entityNo: String(remediation.remediation_no),
      category: "整改复核附件",
      fileName: "负库存整改复核说明.pdf",
      mimeType: "application/pdf",
      note: "责任人提交的整改复核凭证。",
      buffer: Buffer.from("remediation review evidence", "utf8"),
    });

    const reviewSnapshot = service.getSnapshot("U-ADMIN") as unknown as {
      tasks: Array<Record<string, unknown>>;
      board: {
        systemHealthRemediations: Array<Record<string, unknown>>;
        documentAttachments: Array<Record<string, unknown>>;
        auditLogs: Array<Record<string, unknown>>;
      };
    };
    expect(reviewSnapshot.board.systemHealthRemediations[0]).toMatchObject({
      id: remediation.id,
      status: "ready_for_review",
      status_label: "待复核",
      submitted_by_name: "仓库管理员-吴勇",
      review_note: "已核查库存流水，整改资料已补齐，提交管理员复核。",
      review_attachment_count: 1,
    });
    expect(reviewSnapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "system_health_remediation",
          entityId: remediation.id,
          action: "closeSystemHealthRemediation",
          primaryLabel: "关闭整改",
        }),
      ]),
    );
    expect(reviewSnapshot.board.documentAttachments[0]).toMatchObject({
      entity_type: "system_health_remediation",
      entity_type_label: "上线整改任务",
      entity_id: remediation.id,
      category: "整改复核附件",
      file_name: "负库存整改复核说明.pdf",
    });
    expect(reviewSnapshot.board.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "提交上线整改复核",
          entity_type: "system_health_remediation",
          entity_id: remediation.id,
        }),
      ]),
    );
  });

  it("rejects go-live remediation review and keeps a formal review history for rework", async () => {
    const service = await loadService();
    const database = (await import("./db")).getDb();
    database.prepare("UPDATE materials SET stock_qty = -2 WHERE id = 'M-STEEL'").run();

    service.performAction({
      actorId: "U-ADMIN",
      action: "createSystemHealthRemediation",
      entityId: "negative_inventory",
      payload: {
        owner_id: "U-WH",
        due_date: "2026-04-01",
        action_plan: "补齐负库存整改依据。",
      },
    });
    const created = service.getSnapshot("U-ADMIN").board.systemHealthRemediations[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-WH",
      action: "markSystemHealthRemediationReady",
      entityId: String(created.id),
      payload: { review_note: "已经补充库存流水说明，申请复核。" },
    });

    expect(() =>
      service.performAction({
        actorId: "U-WH",
        action: "rejectSystemHealthRemediationReview",
        entityId: String(created.id),
        payload: { review_note: "责任人自行驳回。" },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-ADMIN",
      action: "rejectSystemHealthRemediationReview",
      entityId: String(created.id),
      payload: { review_note: "附件不完整，请补充盘点调整单后重新提交。" },
    });

    const rejected = service.getSnapshot("U-WH") as unknown as {
      tasks: Array<Record<string, unknown>>;
      board: {
        systemHealthRemediations: Array<Record<string, unknown>>;
        systemHealthRemediationReviews: Array<Record<string, unknown>>;
        auditLogs: Array<Record<string, unknown>>;
      };
    };
    expect(rejected.board.systemHealthRemediations[0]).toMatchObject({
      id: created.id,
      status: "rejected",
      status_label: "复核驳回",
      latest_review_decision: "rejected",
      latest_review_decision_label: "复核驳回",
      latest_review_note: "附件不完整，请补充盘点调整单后重新提交。",
      review_record_count: 2,
    });
    expect(rejected.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "system_health_remediation",
          entityId: created.id,
          action: "markSystemHealthRemediationReady",
          primaryLabel: "重新提交",
        }),
      ]),
    );
    expect(rejected.board.systemHealthRemediationReviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          remediation_id: created.id,
          decision: "submitted",
          decision_label: "提交复核",
          review_note: "已经补充库存流水说明，申请复核。",
        }),
        expect.objectContaining({
          remediation_id: created.id,
          decision: "rejected",
          decision_label: "复核驳回",
          reviewer_name: "系统管理员-管理员",
          review_note: "附件不完整，请补充盘点调整单后重新提交。",
        }),
      ]),
    );

    service.performAction({
      actorId: "U-WH",
      action: "markSystemHealthRemediationReady",
      entityId: String(created.id),
      payload: { review_note: "已补充盘点调整单，重新提交复核。" },
    });

    const resubmitted = service.getSnapshot("U-ADMIN") as unknown as {
      board: {
        systemHealthRemediations: Array<Record<string, unknown>>;
        systemHealthRemediationReviews: Array<Record<string, unknown>>;
      };
    };
    expect(resubmitted.board.systemHealthRemediations[0]).toMatchObject({
      id: created.id,
      status: "ready_for_review",
      status_label: "待复核",
      review_record_count: 3,
      latest_review_decision: "submitted",
    });
    expect(resubmitted.board.systemHealthRemediationReviews[0]).toMatchObject({
      remediation_id: created.id,
      decision: "submitted",
      review_note: "已补充盘点调整单，重新提交复核。",
    });
  });
});

describe("ERP service formal controls for document numbering and inventory aging", () => {
  it("issues formal daily document numbers and exposes sequence governance", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "8",
        margin_rate: "0.2",
      },
    });
    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "9",
        margin_rate: "0.2",
      },
    });

    const snapshot = service.getSnapshot("U-ADMIN");
    const quoteNos = (snapshot.board.quotes as Array<Record<string, unknown>>)
      .slice(0, 2)
      .map((quote) => String(quote.quote_no));
    expect(quoteNos).toEqual([`BJ-${today}-004`, `BJ-${today}-003`]);
    expect(snapshot.board.documentSequences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          doc_type: "quotes",
          prefix: "BJ",
          date_key: today,
          current_no: 4,
          sample_no: `BJ-${today}-004`,
        }),
      ]),
    );
  });

  it("records inventory aging disposition and enriches the RBAC permission matrix", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-WH");
    const overstock = before.board.inventoryAging.find((item) => item.aging_status === "overstock");

    expect(overstock?.id).toBeTruthy();
    expect(() =>
      service.performAction({
        actorId: "U-SALES",
        action: "recordInventoryAgingDisposition",
        entityId: String(overstock?.id),
        payload: { action_plan: "销售角色越权处置库存" },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-WH",
      action: "recordInventoryAgingDisposition",
      entityId: String(overstock?.id),
      payload: {
        owner_id: "U-WH",
        status: "tracking",
        action_plan: "列入积压台账，优先评估替代消耗或供应商协商退换。",
        note: "6个月未发生变动，需纳入月度库存积压报表。",
      },
    });

    const after = service.getSnapshot("U-WH");
    expect(after.board.inventoryAgingDispositions[0]).toMatchObject({
      material_id: overstock?.id,
      material_name: overstock?.name,
      aging_level: "overstock",
      status: "tracking",
      status_label: "跟进中",
      owner_name: "仓库管理员-吴勇",
      action_plan: "列入积压台账，优先评估替代消耗或供应商协商退换。",
    });
    expect(after.board.inventoryAging.find((item) => item.id === overstock?.id)).toMatchObject({
      disposition_status: "tracking",
      disposition_status_label: "跟进中",
    });
    expect(after.security.rolePermissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "warehouse",
          action: "recordInventoryAgingDisposition",
          action_label: "登记积压处置",
          module_label: "采购仓储",
          risk_level: "中",
        }),
      ]),
    );
  });
});

describe("ERP service formal alert center", () => {
  it("aggregates low stock, aging inventory, approval, receivable and payable alerts with severity and actions", async () => {
    const service = await loadService();
    const snapshot = service.getSnapshot("U-MGR") as unknown as {
      summary: { alertCount: number; criticalAlertCount: number };
      board: { alertCenter: Array<Record<string, unknown>> };
    };

    expect(snapshot.board.alertCenter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alert_type: "low_stock",
          severity: "high",
          module_label: "采购仓储",
          owner_role: "purchasing",
          action_label: "创建采购申请",
        }),
        expect.objectContaining({
          alert_type: "inventory_overstock",
          severity: "critical",
          module_label: "采购仓储",
          owner_role: "warehouse",
          action_label: "登记处置",
        }),
        expect.objectContaining({
          alert_type: "approval_pending",
          severity: "medium",
          module_label: "审批算价",
          owner_role: "manager",
          action_label: "进入审批",
        }),
      ]),
    );
    expect(snapshot.board.alertCenter.some((item) => ["receivable_due", "payable_due"].includes(String(item.alert_type)))).toBe(true);
    expect(snapshot.summary.alertCount).toBe(snapshot.board.alertCenter.length);
    expect(snapshot.summary.criticalAlertCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.board.alertCenter.map((item) => item.rank)).toEqual(
      [...snapshot.board.alertCenter.map((item) => item.rank)].sort((a, b) => Number(a) - Number(b)),
    );
  });

  it("persists per-user alert read or dismiss state and applies role subscription rules", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-ADMIN") as unknown as {
      summary: { unreadAlertCount: number };
      board: { alertCenter: Array<Record<string, unknown>>; alertMessageStates: Array<Record<string, unknown>> };
    };
    const receivableAlert = before.board.alertCenter.find((item) => item.alert_type === "receivable_due");

    expect(receivableAlert?.id).toBeTruthy();
    expect(receivableAlert).toMatchObject({
      message_status: "unread",
      is_unread: true,
      subscription_enabled: true,
    });

    service.performAction({
      actorId: "U-ADMIN",
      action: "markAlertRead",
      entityId: String(receivableAlert?.id),
    });

    const afterRead = service.getSnapshot("U-ADMIN") as unknown as {
      summary: { unreadAlertCount: number };
      board: { alertCenter: Array<Record<string, unknown>> };
    };
    expect(afterRead.board.alertCenter.find((item) => item.id === receivableAlert?.id)).toMatchObject({
      message_status: "read",
      is_unread: false,
    });
    expect(afterRead.summary.unreadAlertCount).toBe(before.summary.unreadAlertCount - 1);

    service.performAction({
      actorId: "U-ADMIN",
      action: "dismissAlert",
      entityId: String(receivableAlert?.id),
    });

    const afterDismiss = service.getSnapshot("U-ADMIN") as unknown as {
      board: { alertCenter: Array<Record<string, unknown>>; alertMessageStates: Array<Record<string, unknown>> };
    };
    expect(afterDismiss.board.alertCenter.some((item) => item.id === receivableAlert?.id)).toBe(false);
    expect(afterDismiss.board.alertMessageStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: "U-ADMIN",
          alert_key: receivableAlert?.id,
          status: "dismissed",
        }),
      ]),
    );

    const financeBefore = service.getSnapshot("U-FIN") as unknown as {
      board: { alertCenter: Array<Record<string, unknown>> };
    };
    expect(financeBefore.board.alertCenter.some((item) => item.alert_type === "receivable_due")).toBe(true);

    expect(() =>
      service.performAction({
        actorId: "U-FIN",
        action: "upsertAlertSubscription",
        payload: { role: "finance", alert_type: "receivable_due", enabled: false },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertAlertSubscription",
      payload: {
        role: "finance",
        alert_type: "receivable_due",
        enabled: false,
        min_severity: "medium",
      },
    });

    const financeAfter = service.getSnapshot("U-FIN") as unknown as {
      board: { alertCenter: Array<Record<string, unknown>>; alertSubscriptions: Array<Record<string, unknown>> };
    };
    expect(financeAfter.board.alertCenter.some((item) => item.alert_type === "receivable_due")).toBe(false);
    expect(financeAfter.board.alertSubscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "finance",
          alert_type: "receivable_due",
          enabled: 0,
          min_severity: "medium",
        }),
      ]),
    );
  });
});

describe("ERP service formal document void controls", () => {
  it("voids safe business documents with audit trail and blocks posted inventory documents", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-PUR") as unknown as {
      board: {
        materials: Array<Record<string, unknown>>;
        suppliers: Array<Record<string, unknown>>;
      };
    };
    const material = before.board.materials.find((item) => item.status === "active");
    const supplier = before.board.suppliers.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier?.id,
        due_date: "2026-05-30",
        lines: [{ material_id: material?.id, qty: 10, unit_cost: 12.5 }],
      },
    });

    const created = service.getSnapshot("U-ADMIN") as unknown as {
      board: {
        purchaseOrders: Array<Record<string, unknown>>;
        documentVoidCandidates: Array<Record<string, unknown>>;
      };
    };
    const purchase = created.board.purchaseOrders.find((item) => item.status === "pending_approval");
    expect(created.board.documentVoidCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document_type: "purchase_order",
          document_id: purchase?.id,
          document_no: purchase?.purchase_no,
        }),
      ]),
    );

    expect(() =>
      service.performAction({
        actorId: "U-SALES",
        action: "voidBusinessDocument",
        entityId: String(purchase?.id),
        payload: {
          document_type: "purchase_order",
          reason: "销售角色越权作废采购单",
        },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-ADMIN",
      action: "voidBusinessDocument",
      entityId: String(purchase?.id),
      payload: {
        document_type: "purchase_order",
        reason: "供应商报价录入错误，重新走采购流程。",
      },
    });

    const voided = service.getSnapshot("U-ADMIN") as unknown as {
      board: {
        purchaseOrders: Array<Record<string, unknown>>;
        documentCancellations: Array<Record<string, unknown>>;
        auditLogs: Array<Record<string, unknown>>;
      };
    };
    expect(voided.board.purchaseOrders.find((item) => item.id === purchase?.id)).toMatchObject({
      status: "voided",
      status_label: "已作废",
    });
    expect(voided.board.documentCancellations[0]).toMatchObject({
      document_type: "purchase_order",
      document_id: purchase?.id,
      document_no: purchase?.purchase_no,
      original_status: "pending_approval",
      reason: "供应商报价录入错误，重新走采购流程。",
      cancelled_by_name: "系统管理员-管理员",
    });
    expect(voided.board.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "voidBusinessDocument",
          entity_type: "document_void",
          entity_id: purchase?.id,
        }),
      ]),
    );

    const receivedPurchase = voided.board.purchaseOrders.find((item) => item.status === "received");
    expect(receivedPurchase?.id).toBeTruthy();
    expect(() =>
      service.performAction({
        actorId: "U-ADMIN",
        action: "voidBusinessDocument",
        entityId: String(receivedPurchase?.id),
        payload: {
          document_type: "purchase_order",
          reason: "尝试直接作废已入库采购单",
        },
      }),
    ).toThrow("采购单已入库");
  });
});

describe("ERP service formal stocktake and inventory adjustment", () => {
  it("creates a pending stocktake sheet and applies approved inventory loss adjustment", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-WH") as unknown as { board: { materials: Array<Record<string, unknown>> } };
    const material = before.board.materials.find((item) => Number(item.stock_qty ?? 0) > 20);
    const bookQty = Number(material?.stock_qty ?? 0);
    const actualQty = bookQty - 5;
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");

    expect(material?.id).toBeTruthy();
    expect(() =>
      service.performAction({
        actorId: "U-SALES",
        action: "createStocktake",
        payload: {
          material_id: material?.id,
          actual_qty: actualQty,
          counted_at: "2026-05-13",
          remark: "销售角色越权盘点",
        },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-WH",
      action: "createStocktake",
      payload: {
        material_id: material?.id,
        actual_qty: actualQty,
        counted_at: "2026-05-13",
        remark: "月度抽盘，发现账实差异。",
      },
    });

    const created = service.getSnapshot("U-WH") as unknown as {
      board: { stocktakes: Array<Record<string, unknown>>; documentSequences: Array<Record<string, unknown>> };
    };
    const stocktake = created.board.stocktakes[0];
    expect(stocktake).toMatchObject({
      stocktake_no: `PD-${today}-001`,
      material_id: material?.id,
      book_qty: bookQty,
      actual_qty: actualQty,
      difference_qty: -5,
      status: "pending_approval",
      status_label: "待审批",
    });
    expect(created.board.documentSequences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          doc_type: "stocktakes",
          prefix: "PD",
          current_no: 1,
        }),
      ]),
    );

    expect(() =>
      service.performAction({
        actorId: "U-WH",
        action: "approveStocktake",
        entityId: String(stocktake.id),
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-MGR",
      action: "approveStocktake",
      entityId: String(stocktake.id),
    });

    const approved = service.getSnapshot("U-WH") as unknown as {
      board: {
        materials: Array<Record<string, unknown>>;
        stocktakes: Array<Record<string, unknown>>;
        inventoryTrace: Array<Record<string, unknown>>;
      };
    };
    const updatedMaterial = approved.board.materials.find((item) => item.id === material?.id);
    expect(updatedMaterial?.stock_qty).toBe(actualQty);
    expect(approved.board.stocktakes[0]).toMatchObject({
      id: stocktake.id,
      status: "approved",
      status_label: "已调整",
      approved_by_name: "管理层-王总",
    });
    expect(approved.board.inventoryTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movement_type: "stocktake_loss",
          movement_type_label: "盘点盘亏",
          source_label: "库存盘点",
          source_no: stocktake.stocktake_no,
          material_name: material?.name,
          qty: -5,
        }),
      ]),
    );

    const exported = await service.buildExport({
      actorId: "U-WH",
      type: "stocktake",
      entityId: String(stocktake.id),
      format: "xlsx",
    });
    const xml = xlsxXml(exported.buffer);
    expect(exported.fileName).toContain("stocktake");
    expect(xml).toContain(String(stocktake.stocktake_no));
    expect(xml).toContain("库存盘点单");
    expect(xml).toContain("盘点盘亏");
  });
});

describe("ERP service formal sales entry", () => {
  it("creates a quote from active master data and converts it into a formal order", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");

    expect(customer?.id).toBeTruthy();
    expect(product?.id).toBeTruthy();

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "25",
        margin_rate: "0.25",
      },
    });

    const quoted = service.getSnapshot("U-SALES");
    const quote = quoted.board.quotes[0] as Record<string, unknown>;
    expect(quote.status).toBe("draft");
    expect(quote.material_cost).toBe(376.5);
    expect(quote.process_fee).toBe(450);
    expect(quote.total_amount).toBe(1033.13);

    service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
    service.performAction({
      actorId: "U-SALES",
      action: "createOrder",
      entityId: String(quote.id),
      payload: {
        due_date: "2026-06-01",
        special_requirements: "正式录入测试订单",
      },
    });

    const ordered = service.getSnapshot("U-SALES");
    expect(ordered.board.orders[0]).toMatchObject({
      quote_id: quote.id,
      qty: 25,
      due_date: "2026-06-01",
      special_requirements: "正式录入测试订单",
      status: "submitted",
    });
  });
});

describe("ERP service unified approval center", () => {
  it("accepts custom OA requests, aggregates pending approvals, and rejects stocktake adjustments without inventory movement", async () => {
    const service = await loadService();
    service.performAction({
      actorId: "U-PUR",
      action: "submitApproval",
      payload: {
        type: "办公 OA",
        title: "采购合同用印审批",
        amount: "300",
        reason: "新供应商合同需要管理层确认后用印并归档。",
      },
    });

    const before = service.getSnapshot("U-WH") as unknown as { board: { materials: Array<Record<string, unknown>> } };
    const material = before.board.materials.find((item) => Number(item.stock_qty ?? 0) > 10);
    service.performAction({
      actorId: "U-WH",
      action: "createStocktake",
      payload: {
        material_id: material?.id,
        actual_qty: Number(material?.stock_qty ?? 0) - 1,
        counted_at: "2026-05-13",
        remark: "审批中心驳回场景测试。",
      },
    });

    const managerSnapshot = service.getSnapshot("U-MGR") as unknown as {
      summary: { pendingApprovalCount: number; approvalOverdueCount: number };
      board: {
        approvalCenter: Array<Record<string, unknown>>;
        approvalRequests: Array<Record<string, unknown>>;
        stocktakes: Array<Record<string, unknown>>;
      };
    };
    const customApproval = managerSnapshot.board.approvalRequests.find((item) => item.title === "采购合同用印审批");
    const stocktake = managerSnapshot.board.stocktakes[0];

    expect(customApproval).toMatchObject({
      type: "办公 OA",
      title: "采购合同用印审批",
      amount: 300,
      reason: "新供应商合同需要管理层确认后用印并归档。",
      status: "pending",
    });
    expect(managerSnapshot.board.approvalCenter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_type: "approval_request",
          entity_id: customApproval?.id,
          title: "采购合同用印审批",
          approve_action: "approveApproval",
          reject_action: "rejectApproval",
          status_label: "待审批",
        }),
        expect.objectContaining({
          source_type: "stocktake",
          entity_id: stocktake.id,
          title: stocktake.stocktake_no,
          approve_action: "approveStocktake",
          reject_action: "rejectStocktake",
          status_label: "待审批",
        }),
      ]),
    );
    expect(managerSnapshot.summary.pendingApprovalCount).toBe(managerSnapshot.board.approvalCenter.length);
    expect(managerSnapshot.summary.approvalOverdueCount).toBeGreaterThanOrEqual(0);

    service.performAction({
      actorId: "U-MGR",
      action: "rejectStocktake",
      entityId: String(stocktake.id),
      payload: { approval_note: "差异原因不充分，退回仓库复盘。" },
    });

    const rejected = service.getSnapshot("U-MGR") as unknown as {
      board: { stocktakes: Array<Record<string, unknown>>; inventoryTrace: Array<Record<string, unknown>>; approvalCenter: Array<Record<string, unknown>> };
    };
    expect(rejected.board.stocktakes[0]).toMatchObject({
      id: stocktake.id,
      status: "rejected",
      status_label: "已驳回",
      approval_note: "差异原因不充分，退回仓库复盘。",
    });
    expect(rejected.board.inventoryTrace.some((item) => item.source_no === stocktake.stocktake_no)).toBe(false);
    expect(rejected.board.approvalCenter.some((item) => item.entity_id === stocktake.id)).toBe(false);
  });

  it("lets admins configure approval rules and applies the matching rule to new approval requests", async () => {
    const service = await loadService();

    expect(() =>
      service.performAction({
        actorId: "U-SALES",
        action: "upsertApprovalRule",
        payload: {
          rule_name: "合同用印快速审批",
          source_type: "office_oa",
          min_amount: "200",
          max_amount: "500",
          approver_role: "manager",
          sla_hours: "6",
        },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-ADMIN",
      action: "upsertApprovalRule",
      payload: {
        rule_name: "合同用印快速审批",
        source_type: "office_oa",
        min_amount: "200",
        max_amount: "500",
        approver_role: "manager",
        sla_hours: "6",
        description: "200-500 元合同用印类审批，管理层 6 小时内处理。",
      },
    });

    service.performAction({
      actorId: "U-PUR",
      action: "submitApproval",
      payload: {
        type: "合同用印",
        title: "供应商年度框架合同用印",
        amount: "300",
        reason: "供应商年度框架合同需要走正式用印审批。",
      },
    });

    const snapshot = service.getSnapshot("U-MGR") as unknown as {
      board: {
        approvalRules: Array<Record<string, unknown>>;
        approvalRequests: Array<Record<string, unknown>>;
        approvalCenter: Array<Record<string, unknown>>;
      };
    };
    const rule = snapshot.board.approvalRules.find((item) => item.rule_name === "合同用印快速审批");
    const approval = snapshot.board.approvalRequests.find((item) => item.title === "供应商年度框架合同用印");
    const centerRow = snapshot.board.approvalCenter.find((item) => item.entity_id === approval?.id);

    expect(rule).toMatchObject({
      source_type: "office_oa",
      source_type_label: "办公 OA",
      min_amount: 200,
      max_amount: 500,
      approver_role: "manager",
      approver_role_label: "管理层",
      sla_hours: 6,
      status: "active",
    });
    expect(approval).toMatchObject({
      rule_id: rule?.id,
      rule_name: "合同用印快速审批",
      approver_role: "manager",
      sla_hours: 6,
      status: "pending",
    });
    expect(centerRow).toMatchObject({
      rule_name: "合同用印快速审批",
      approver_role: "manager",
      approver_role_label: "管理层",
      sla_hours: 6,
      approve_action: "approveApproval",
    });
  });
});

describe("ERP service formal purchase entry", () => {
  it("creates approved purchase requisitions before purchase orders and preserves demand traceability", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-PUR");
    const supplier = before.board.suppliers.find((item) => item.status === "active");
    const material = before.board.materials.find((item) => item.status === "active");

    expect(supplier?.id).toBeTruthy();
    expect(material?.id).toBeTruthy();

    expect(() =>
      service.performAction({
        actorId: "U-SALES",
        action: "createPurchaseRequisition",
        payload: {
          source_type: "manual",
          lines: [{ material_id: material?.id, requested_qty: "8", estimated_unit_cost: "12" }],
        },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseRequisition",
      payload: {
        source_type: "low_stock",
        required_date: "2026-06-08",
        reason: "最低库存不足，按流程先发起采购申请。",
        lines: [{ material_id: material?.id, requested_qty: "8", estimated_unit_cost: "12" }],
      },
    });

    const requested = service.getSnapshot("U-PUR");
    const purchaseRequisition = requested.board.purchaseRequisitions[0] as Record<string, unknown>;
    expect(purchaseRequisition).toMatchObject({
      source_type: "low_stock",
      source_type_label: "最低库存触发",
      status: "pending_approval",
      total_amount: 96,
      requested_by_name: "采购员-孙倩",
    });
    expect(String(purchaseRequisition.requisition_no)).toMatch(/^QS-\d{8}-\d{3}$/);
    expect((purchaseRequisition.lines as unknown[]).length).toBe(1);

    const approval = requested.board.approvalRequests.find((item) => item.entity_id === purchaseRequisition.id);
    expect(approval).toMatchObject({
      entity_type: "purchase_requisition",
      status: "pending",
      amount: 96,
    });

    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrderFromRequisition",
        entityId: String(purchaseRequisition.id),
        payload: {
          supplier_id: supplier?.id,
          due_date: "2026-07-08",
        },
      }),
    ).toThrow("采购申请尚未审批通过");

    service.performAction({
      actorId: "U-MGR",
      action: "approveApproval",
      entityId: String(approval?.id),
      payload: { approval_note: "同意按最低库存补货，采购部按供应商价格下单。" },
    });

    const approved = service.getSnapshot("U-PUR");
    expect(
      (approved.board.purchaseRequisitions as Array<Record<string, unknown>>).find(
        (item) => item.id === purchaseRequisition.id,
      ),
    ).toMatchObject({
      status: "approved",
      approved_by_name: "管理层-王总",
      approval_note: "同意按最低库存补货，采购部按供应商价格下单。",
    });

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrderFromRequisition",
      entityId: String(purchaseRequisition.id),
      payload: {
        supplier_id: supplier?.id,
        due_date: "2026-07-08",
      },
    });

    const converted = service.getSnapshot("U-PUR");
    const convertedRequisition = (converted.board.purchaseRequisitions as Array<Record<string, unknown>>).find(
      (item) => item.id === purchaseRequisition.id,
    ) as Record<string, unknown>;
    expect(convertedRequisition.status).toBe("converted");
    expect(convertedRequisition.converted_order_no).toBeTruthy();

    const purchaseOrder = (converted.board.purchaseOrders as Array<Record<string, unknown>>).find(
      (item) => item.source_requisition_id === purchaseRequisition.id,
    ) as Record<string, unknown>;
    expect(purchaseOrder).toMatchObject({
      supplier_id: supplier?.id,
      source_requisition_id: purchaseRequisition.id,
      source_requisition_no: purchaseRequisition.requisition_no,
      status: "pending_approval",
      total_amount: 96,
      due_date: "2026-07-08",
    });
    expect(purchaseOrder.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          materialId: material?.id,
          qty: 8,
          unitCost: 12,
        }),
      ]),
    );

    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "createPurchaseOrderFromRequisition",
        entityId: String(purchaseRequisition.id),
        payload: {
          supplier_id: supplier?.id,
          due_date: "2026-07-08",
        },
      }),
    ).toThrow("采购申请已转采购订单");
  });

  it("creates a multi-line purchase order, routes approval, and receipt updates inventory and payables", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-PUR");
    const supplier = before.board.suppliers.find((item) => item.status === "active");
    const materials = before.board.materials.filter((item) => item.status === "active").slice(0, 2);
    const material = materials[0];
    const secondMaterial = materials[1];

    expect(supplier?.id).toBeTruthy();
    expect(material?.id).toBeTruthy();
    expect(secondMaterial?.id).toBeTruthy();

    const previousQty = Number(material?.stock_qty ?? 0);
    const previousAverageCost = Number(material?.average_cost ?? 0);
    const incomingQty = 10;
    const incomingUnitCost = 60;

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier?.id,
        due_date: "2026-06-10",
        lines: [
          {
            material_id: material?.id,
            qty: String(incomingQty),
            unit_cost: String(incomingUnitCost),
          },
          {
            material_id: secondMaterial?.id,
            qty: "5",
            unit_cost: "20",
          },
        ],
      },
    });

    const purchased = service.getSnapshot("U-PUR");
    const purchaseOrder = purchased.board.purchaseOrders[0] as Record<string, unknown>;
    expect(purchaseOrder).toMatchObject({
      supplier_id: supplier?.id,
      status: "pending_approval",
      total_amount: 700,
      due_date: "2026-06-10",
    });
    expect((purchaseOrder.lines as unknown[]).length).toBe(2);
    const approval = purchased.board.approvalRequests.find((item) => item.entity_id === purchaseOrder.id);
    expect(approval).toMatchObject({
      entity_type: "purchase_order",
      status: "pending",
      amount: 700,
    });

    expect(() =>
      service.performAction({
        actorId: "U-PUR",
        action: "receivePurchaseOrder",
        entityId: String(purchaseOrder.id),
      }),
    ).toThrow("采购单尚未审批通过");

    service.performAction({
      actorId: "U-MGR",
      action: "approveApproval",
      entityId: String(approval?.id),
    });

    service.performAction({
      actorId: "U-PUR",
      action: "receivePurchaseOrder",
      entityId: String(purchaseOrder.id),
    });

    const received = service.getSnapshot("U-PUR");
    const updatedMaterial = received.board.materials.find((item) => item.id === material?.id) as Record<string, unknown>;
    const expectedQty = previousQty + incomingQty;
    const expectedAverageCost = Math.round(
      ((previousQty * previousAverageCost + incomingQty * incomingUnitCost) / expectedQty) * 100,
    ) / 100;

    expect(updatedMaterial.stock_qty).toBe(expectedQty);
    expect(updatedMaterial.average_cost).toBe(expectedAverageCost);
    expect(received.board.purchaseReceipts[0]).toMatchObject({
      purchase_no: purchaseOrder.purchase_no,
    });
    expect(received.board.purchaseReceipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purchase_no: purchaseOrder.purchase_no,
          material_name: material?.name,
          qty: incomingQty,
          unit_cost: incomingUnitCost,
          line_amount: 600,
        }),
      ]),
    );
    const receivedPurchaseOrders = received.board.purchaseOrders as Array<Record<string, unknown>>;
    const receivedPurchaseOrder = receivedPurchaseOrders.find((item) => item.id === purchaseOrder.id);
    expect(receivedPurchaseOrder).toMatchObject({
      status: "received",
    });
    expect(received.board.payables[0]).toMatchObject({
      purchase_order_id: purchaseOrder.id,
      total_amount: 700,
      balance_amount: 700,
      status: "unpaid",
    });
  });

  it("routes arrived raw materials through IQC before inbound, with discount acceptance and rejected return handling", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-PUR");
    const supplier = before.board.suppliers.find((item) => item.status === "active");
    const material = before.board.materials.find((item) => item.status === "active");
    expect(supplier?.id).toBeTruthy();
    expect(material?.id).toBeTruthy();

    const previousQty = Number(material?.stock_qty ?? 0);
    const previousAverageCost = Number(material?.average_cost ?? 0);
    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier?.id,
        due_date: "2026-07-15",
        lines: [{ material_id: material?.id, qty: "10", unit_cost: "60" }],
      },
    });
    let snapshot = service.getSnapshot("U-PUR");
    const purchaseOrder = snapshot.board.purchaseOrders[0] as Record<string, unknown>;
    const approval = snapshot.board.approvalRequests.find((item) => item.entity_id === purchaseOrder.id);
    service.performAction({ actorId: "U-MGR", action: "approveApproval", entityId: String(approval?.id) });

    service.performAction({
      actorId: "U-PUR",
      action: "createMaterialIqcInspection",
      entityId: String(purchaseOrder.id),
      payload: {
        arrived_at: "2026-06-12",
        arrival_no: "ARR-20260612-001",
        note: "供应商到货，先通知 IQC 检验。",
      },
    });

    snapshot = service.getSnapshot("U-QA");
    const iqc = snapshot.board.materialIqcInspections[0] as Record<string, unknown>;
    expect(iqc).toMatchObject({
      purchase_order_id: purchaseOrder.id,
      purchase_no: purchaseOrder.purchase_no,
      supplier_name: supplier?.name,
      status: "pending",
      due_at: "2026-06-15",
      arrival_no: "ARR-20260612-001",
    });
    expect(String(iqc.iqc_no)).toMatch(/^IQC-\d{8}-\d{3}$/);
    expect((snapshot.board.purchaseOrders as Array<Record<string, unknown>>).find((item) => item.id === purchaseOrder.id)).toMatchObject({
      status: "iqc_pending",
    });

    expect(() =>
      service.performAction({
        actorId: "U-SALES",
        action: "completeMaterialIqcInspection",
        entityId: String(iqc.id),
        payload: { result: "qualified" },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-QA",
      action: "completeMaterialIqcInspection",
      entityId: String(iqc.id),
      payload: {
        result: "discount_accept",
        discount_rate: "0.1",
        inspected_at: "2026-06-13",
        measurements: "外观轻微划伤，尺寸合格，按降价接收入库。",
        inspection_standard: "原材料来料检验规范 IQC-2026-01",
        disposition_note: "供应商确认降价 10%，本批允许入库。",
      },
    });

    const accepted = service.getSnapshot("U-QA");
    const completedIqc = accepted.board.materialIqcInspections.find((item) => item.id === iqc.id) as Record<string, unknown>;
    expect(completedIqc).toMatchObject({
      status: "accepted",
      result: "discount_accept",
      result_label: "降价接收",
      accepted_amount: 540,
      inspected_by_name: "品控员-李洁",
      disposition_note: "供应商确认降价 10%，本批允许入库。",
    });
    const expectedQty = previousQty + 10;
    const expectedAverageCost = Math.round(((previousQty * previousAverageCost + 10 * 54) / expectedQty) * 100) / 100;
    expect(accepted.board.materials.find((item) => item.id === material?.id)).toMatchObject({
      stock_qty: expectedQty,
      average_cost: expectedAverageCost,
    });
    expect(accepted.board.purchaseReceipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purchase_no: purchaseOrder.purchase_no,
          iqc_no: iqc.iqc_no,
          iqc_result: "discount_accept",
          qty: 10,
          unit_cost: 54,
          line_amount: 540,
        }),
      ]),
    );
    expect(accepted.board.payables[0]).toMatchObject({
      purchase_order_id: purchaseOrder.id,
      total_amount: 540,
      balance_amount: 540,
      status: "unpaid",
    });
    expect(() =>
      service.performAction({
        actorId: "U-QA",
        action: "completeMaterialIqcInspection",
        entityId: String(iqc.id),
        payload: { result: "qualified" },
      }),
    ).toThrow("IQC 检验单不是待检状态");

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier?.id,
        due_date: "2026-07-20",
        lines: [{ material_id: material?.id, qty: "3", unit_cost: "80" }],
      },
    });
    snapshot = service.getSnapshot("U-PUR");
    const rejectedPurchase = snapshot.board.purchaseOrders[0] as Record<string, unknown>;
    const rejectedApproval = snapshot.board.approvalRequests.find((item) => item.entity_id === rejectedPurchase.id);
    service.performAction({ actorId: "U-MGR", action: "approveApproval", entityId: String(rejectedApproval?.id) });
    service.performAction({
      actorId: "U-PUR",
      action: "createMaterialIqcInspection",
      entityId: String(rejectedPurchase.id),
      payload: { arrived_at: "2026-06-14", arrival_no: "ARR-20260614-002" },
    });
    const rejectedIqc = service.getSnapshot("U-QA").board.materialIqcInspections[0] as Record<string, unknown>;
    const qtyBeforeRejected = Number(
      service.getSnapshot("U-QA").board.materials.find((item) => item.id === material?.id)?.stock_qty ?? 0,
    );
    service.performAction({
      actorId: "U-QA",
      action: "completeMaterialIqcInspection",
      entityId: String(rejectedIqc.id),
      payload: {
        result: "rejected_return",
        inspected_at: "2026-06-15",
        measurements: "化验指标不合格。",
        disposition_note: "整批退货，不进入原料库存。",
      },
    });

    const rejected = service.getSnapshot("U-QA");
    expect(rejected.board.materialIqcInspections.find((item) => item.id === rejectedIqc.id)).toMatchObject({
      status: "rejected",
      result: "rejected_return",
      accepted_amount: 0,
    });
    expect((rejected.board.purchaseOrders as Array<Record<string, unknown>>).find((item) => item.id === rejectedPurchase.id)).toMatchObject({
      status: "iqc_rejected",
    });
    expect(Number(rejected.board.materials.find((item) => item.id === material?.id)?.stock_qty ?? 0)).toBe(qtyBeforeRejected);
    expect(rejected.board.payables.some((item) => item.purchase_order_id === rejectedPurchase.id)).toBe(false);
  });
});

describe("ERP service formal warehouse material issue", () => {
  it("requires requisition approval, then issues materials with manual batch and substitute traceability", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "20",
        margin_rate: "0.2",
      },
    });
    const quote = service.getSnapshot("U-SALES").board.quotes[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
    service.performAction({
      actorId: "U-SALES",
      action: "createOrder",
      entityId: String(quote.id),
      payload: { due_date: "2026-06-05", special_requirements: "仓库发料测试订单" },
    });
    const order = service.getSnapshot("U-ASSIST").board.orders[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-ASSIST", action: "createProductionInstruction", entityId: String(order.id) });
    const production = service.getSnapshot("U-PROD").board.productions[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-PROD", action: "scheduleAndGenerateRequisition", entityId: String(production.id) });

    const scheduled = service.getSnapshot("U-WH");
    const requisition = scheduled.board.requisitions[0] as Record<string, unknown>;
    const lines = requisition.lines as Array<Record<string, unknown>>;
    const steelLine = lines.find((line) => line.materialId === "M-STEEL");
    const altBefore = scheduled.board.materials.find((item) => item.id === "M-ALT-STEEL") as Record<string, unknown>;
    const manualBatch = scheduled.board.batches.find((item) => item.id === "B-ALT-002") as Record<string, unknown>;

    expect(requisition.status).toBe("pending_approval");
    expect(steelLine?.lineId).toBeTruthy();
    expect(manualBatch?.id).toBe("B-ALT-002");
    expect(() =>
      service.performAction({
        actorId: "U-WH",
        action: "issueMaterials",
        entityId: String(requisition.id),
      }),
    ).toThrow("领料单尚未审批");

    service.performAction({
      actorId: "U-WH",
      action: "approveMaterialRequisition",
      entityId: String(requisition.id),
      payload: {
        approval_note: "仓库复核 BOM 明细、库存批次和替代料规则后批准发料",
      },
    });

    const approvedSnapshot = service.getSnapshot("U-WH");
    const approvedRequisitions = approvedSnapshot.board.requisitions as Array<Record<string, unknown>>;
    const approvedReq = approvedRequisitions.find((item) => item.id === requisition.id) as Record<
      string,
      unknown
    >;
    expect(approvedReq).toMatchObject({
      status: "approved",
      approved_by_name: "仓库管理员-吴勇",
      approval_note: "仓库复核 BOM 明细、库存批次和替代料规则后批准发料",
    });

    service.performAction({
      actorId: "U-WH",
      action: "issueMaterials",
      entityId: String(requisition.id),
      payload: {
        issue_date: "2026-06-18",
        issue_note: "按客户指定替代料与指定批次发料，出库后复核移动均价",
        selections: [
          {
            line_id: steelLine?.lineId,
            material_id: "M-ALT-STEEL",
            batch_id: "B-ALT-002",
            reason: "客户指定替代料和批次",
          },
        ],
      },
    });

    const issued = service.getSnapshot("U-WH");
    const altAfter = issued.board.materials.find((item) => item.id === "M-ALT-STEEL") as Record<string, unknown>;
    const issuedRequisitions = issued.board.requisitions as Array<Record<string, unknown>>;
    const issuedReq = issuedRequisitions.find((item) => item.id === requisition.id) as Record<string, unknown>;
    const issueRows = (issued.board as unknown as Record<string, Array<Record<string, unknown>>>).materialIssues;
    const issueRow = issueRows.find((item) => item.req_no === requisition.req_no && item.batch_no === "ALT-20260401");

    expect(altAfter.stock_qty).toBe(Number(altBefore.stock_qty) - Number(steelLine?.requiredQty));
    expect(altAfter.average_cost).toBe(13.36);
    expect(issuedReq).toMatchObject({
      status: "issued",
      issue_no: expect.stringMatching(/^CK-/),
      issued_by_name: "仓库管理员-吴勇",
      issue_note: "按客户指定替代料与指定批次发料，出库后复核移动均价",
    });
    expect(issueRow).toMatchObject({
      req_no: requisition.req_no,
      issue_no: issuedReq.issue_no,
      prod_no: production.prod_no,
      order_no: order.order_no,
      material_id: "M-ALT-STEEL",
      original_material_id: "M-STEEL",
      is_substitute: 1,
      batch_no: "ALT-20260401",
      issue_note: "客户指定替代料和批次",
    });
  });
});

describe("ERP service formal production instruction and scheduling", () => {
  it("records instruction fields, schedule details, and formal requisition metadata", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "20",
        margin_rate: "0.2",
      },
    });
    const quote = service.getSnapshot("U-SALES").board.quotes[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
    service.performAction({
      actorId: "U-SALES",
      action: "createOrder",
      entityId: String(quote.id),
      payload: {
        due_date: "2026-06-30",
        special_requirements: "生产指令正式字段测试",
        customer_po_no: "PO-PROD-001",
      },
    });
    const order = service.getSnapshot("U-ASSIST").board.orders[0] as Record<string, unknown>;

    service.performAction({
      actorId: "U-ASSIST",
      action: "createProductionInstruction",
      entityId: String(order.id),
      payload: {
        priority: "urgent",
        instruction_note: "客户要求随货提供检验报告",
        technical_requirements: "按 V1.0 BOM 和客户认可工艺执行",
      },
    });

    const instructed = service.getSnapshot("U-PROD");
    const production = instructed.board.productions[0] as Record<string, unknown>;
    expect(production).toMatchObject({
      order_id: order.id,
      priority: "urgent",
      priority_label: "加急",
      instruction_note: "客户要求随货提供检验报告",
      technical_requirements: "按 V1.0 BOM 和客户认可工艺执行",
      issued_by_name: "商务内勤-周敏",
      status: "instructed",
    });

    service.performAction({
      actorId: "U-PROD",
      action: "scheduleAndGenerateRequisition",
      entityId: String(production.id),
      payload: {
        planned_date: "2026-06-20",
        machine: "CNC-06",
        owner: "马工",
        shift: "白班",
        schedule_note: "优先安排白班首批生产",
        requisition_note: "按主材批次先进先出发料",
      },
    });

    const scheduled = service.getSnapshot("U-PROD");
    const scheduledProductions = scheduled.board.productions as Array<Record<string, unknown>>;
    const scheduledProduction = scheduledProductions.find((item) => item.id === production.id) as Record<string, unknown>;
    const scheduledRequisitions = scheduled.board.requisitions as Array<Record<string, unknown>>;
    const requisition = scheduledRequisitions.find((item) => item.production_order_id === production.id) as Record<
      string,
      unknown
    >;
    const lines = requisition.lines as Array<Record<string, unknown>>;

    expect(scheduledProduction).toMatchObject({
      planned_date: "2026-06-20",
      machine: "CNC-06",
      owner: "马工",
      shift: "白班",
      schedule_note: "优先安排白班首批生产",
      status: "material_requested",
    });
    expect(requisition).toMatchObject({
      prod_no: production.prod_no,
      order_no: order.order_no,
      product_name: "定制化齿轮箱壳体",
      order_qty: 20,
      bom_version: "V1.0",
      requisition_note: "按主材批次先进先出发料",
      status: "pending_approval",
    });
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          materialCode: "M-STEEL",
          materialName: "42CrMo 圆钢",
          requiredQty: 20,
          isPrimary: 1,
        }),
      ]),
    );
  });

  it("tracks schedule changes and raises delivery risk warnings for delayed production plans", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");
    const dueDate = offsetDate(5);
    const firstPlanDate = offsetDate(2);
    const delayedPlanDate = offsetDate(8);

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "16",
        margin_rate: "0.2",
      },
    });
    const quote = service.getSnapshot("U-SALES").board.quotes[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
    service.performAction({
      actorId: "U-SALES",
      action: "createOrder",
      entityId: String(quote.id),
      payload: {
        due_date: dueDate,
        special_requirements: "生产排产变更与交期预警测试",
      },
    });
    const order = service.getSnapshot("U-ASSIST").board.orders[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-ASSIST", action: "createProductionInstruction", entityId: String(order.id) });
    const production = service.getSnapshot("U-PROD").board.productions[0] as Record<string, unknown>;

    service.performAction({
      actorId: "U-PROD",
      action: "scheduleAndGenerateRequisition",
      entityId: String(production.id),
      payload: {
        planned_date: firstPlanDate,
        machine: "CNC-03",
        owner: "马工",
        shift: "白班",
        schedule_note: "按原交期排产。",
      },
    });

    service.performAction({
      actorId: "U-PROD",
      action: "updateProductionSchedule",
      entityId: String(production.id),
      payload: {
        planned_date: delayedPlanDate,
        machine: "CNC-09",
        owner: "李工",
        shift: "夜班",
        schedule_note: "客户插单后调整到夜班生产。",
        change_reason: "客户紧急插单，调整机台和班次。",
      },
    });

    const snapshot = service.getSnapshot("U-PROD");
    const updatedProduction = (snapshot.board.productions as Array<Record<string, unknown>>).find(
      (item) => item.id === production.id,
    ) as Record<string, unknown>;
    expect(updatedProduction).toMatchObject({
      planned_date: delayedPlanDate,
      machine: "CNC-09",
      owner: "李工",
      shift: "夜班",
      schedule_note: "客户插单后调整到夜班生产。",
      schedule_change_count: 1,
      latest_schedule_change_reason: "客户紧急插单，调整机台和班次。",
      delivery_risk_status: "delayed",
    });

    expect(snapshot.board.productionScheduleChanges[0]).toMatchObject({
      production_order_id: production.id,
      prod_no: production.prod_no,
      old_planned_date: firstPlanDate,
      new_planned_date: delayedPlanDate,
      old_machine: "CNC-03",
      new_machine: "CNC-09",
      old_owner: "马工",
      new_owner: "李工",
      change_reason: "客户紧急插单，调整机台和班次。",
      changed_by_name: "生产主管-马工",
    });

    expect(snapshot.board.productionDeliveryWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          production_order_id: production.id,
          order_no: order.order_no,
          warning_type: "scheduled_after_due",
          warning_level: "high",
          due_date: dueDate,
          planned_date: delayedPlanDate,
        }),
      ]),
    );
    expect(snapshot.board.alertCenter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alert_type: "production_delivery_risk",
          entity_id: production.id,
          action_label: "调整排产",
        }),
      ]),
    );
  });
});

describe("ERP service formal quality inspection and finished inbound", () => {
  it("records inspection measurements and gates finished goods inbound", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "20",
        margin_rate: "0.2",
      },
    });
    const quote = service.getSnapshot("U-SALES").board.quotes[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
    service.performAction({
      actorId: "U-SALES",
      action: "createOrder",
      entityId: String(quote.id),
      payload: { due_date: "2026-06-08", special_requirements: "质检入库测试订单" },
    });
    const order = service.getSnapshot("U-ASSIST").board.orders[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-ASSIST", action: "createProductionInstruction", entityId: String(order.id) });
    const production = service.getSnapshot("U-PROD").board.productions[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-PROD", action: "scheduleAndGenerateRequisition", entityId: String(production.id) });
    const requisition = service.getSnapshot("U-WH").board.requisitions[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-WH", action: "approveMaterialRequisition", entityId: String(requisition.id) });
    service.performAction({ actorId: "U-WH", action: "issueMaterials", entityId: String(requisition.id) });

    expect(() =>
      service.performAction({
        actorId: "U-WH",
        action: "receiveFinishedGoods",
        entityId: String(production.id),
      }),
    ).toThrow("生产单未通过品控");

    service.performAction({
      actorId: "U-PROD",
      action: "requestInspection",
      entityId: String(production.id),
      payload: {
        completion_qty: "20",
        sample_qty: "3",
        request_note: "生产已完工，随单提交自检记录和批次追溯。",
      },
    });
    const requested = service.getSnapshot("U-QA");
    const inspection = requested.board.inspections[0] as Record<string, unknown>;
    expect(inspection).toMatchObject({
      requested_by_name: "生产主管-马工",
      request_note: "生产已完工，随单提交自检记录和批次追溯。",
      completion_qty: 20,
      sample_qty: 3,
    });

    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(inspection.id),
      payload: {
        result: "concession",
        actual_qty: "18.5",
        measurements: "外观轻微划痕，尺寸 A=10.02mm，B=19.98mm，让步接收。",
        inspection_standard: "客户图纸 V1.0 + 内控检验规范 QI-2026-01",
        disposition_note: "轻微外观划痕不影响装配，标记让步接收并通知客户。",
      },
    });

    const inspected = service.getSnapshot("U-QA");
    const completed = inspected.board.inspections.find((item) => item.id === inspection.id) as Record<string, unknown>;
    expect(completed).toMatchObject({
      result: "concession",
      actual_qty: 18.5,
      measurements: "外观轻微划痕，尺寸 A=10.02mm，B=19.98mm，让步接收。",
      completed_by_name: "品控员-李洁",
      inspection_standard: "客户图纸 V1.0 + 内控检验规范 QI-2026-01",
      disposition_note: "轻微外观划痕不影响装配，标记让步接收并通知客户。",
      status: "completed",
    });
    expect(Number(completed.yield_rate)).toBeCloseTo(92.5, 1);

    service.performAction({
      actorId: "U-WH",
      action: "receiveFinishedGoods",
      entityId: String(production.id),
      payload: {
        inbound_date: "2026-06-18",
        inbound_note: "合格成品与过渡料同步入库，入库前核对请验单和批次成本。",
      },
    });

    const inbounded = service.getSnapshot("U-WH");
    const finished = inbounded.board.finishedBatches.find(
      (item) => item.production_order_id === production.id && item.kind === "finished",
    ) as Record<string, unknown>;
    const transition = inbounded.board.finishedBatches.find(
      (item) => item.production_order_id === production.id && item.kind === "transition",
    ) as Record<string, unknown>;
    const inboundedInspection = inbounded.board.inspections.find((item) => item.id === inspection.id) as Record<string, unknown>;
    const finishedReceipts = (inbounded.board as unknown as Record<string, Array<Record<string, unknown>>>).finishedReceipts;
    const receipt = finishedReceipts.find((item) => item.production_order_id === production.id) as Record<string, unknown>;

    expect(receipt).toMatchObject({
      receipt_no: expect.stringMatching(/^RK-/),
      production_order_id: production.id,
      inspection_id: inspection.id,
      finished_qty: 18.5,
      transition_qty: 1.5,
      yield_rate: 92.5,
      received_by_name: "仓库管理员-吴勇",
      inbound_note: "合格成品与过渡料同步入库，入库前核对请验单和批次成本。",
    });
    expect(finished).toMatchObject({ qty: 18.5, kind: "finished", status: "available", receipt_no: receipt.receipt_no });
    expect(transition).toMatchObject({ qty: 1.5, kind: "transition", status: "available", receipt_no: receipt.receipt_no });
    expect(inboundedInspection.status).toBe("inbounded");
    const inboundedProductions = inbounded.board.productions as Array<Record<string, unknown>>;
    expect(inboundedProductions.find((item) => item.id === production.id)).toMatchObject({ status: "in_stock" });
  });
});

describe("ERP service production daily report and technical disposition", () => {
  it("records a formal production daily report against a producing work order", async () => {
    const service = await loadService();
    const { production } = createProducingOrder(service, "10");

    expect(() =>
      service.performAction({
        actorId: "U-SALES",
        action: "createProductionDailyReport",
        entityId: String(production.id),
        payload: {
          report_date: "2026-06-21",
          shift: "白班",
          planned_qty: "10",
          finished_qty: "8",
          good_qty: "7.5",
          defect_qty: "0.3",
          scrap_qty: "0.2",
          work_hours: "6.5",
          abnormal_note: "首件调机耗时偏长，已记录。",
        },
      }),
    ).toThrow("无权执行");

    service.performAction({
      actorId: "U-PROD",
      action: "createProductionDailyReport",
      entityId: String(production.id),
      payload: {
        report_date: "2026-06-21",
        shift: "白班",
        planned_qty: "10",
        finished_qty: "8",
        good_qty: "7.5",
        defect_qty: "0.3",
        scrap_qty: "0.2",
        work_hours: "6.5",
        abnormal_note: "首件调机耗时偏长，已记录。",
      },
    });

    const snapshot = service.getSnapshot("U-PROD");
    const reports = (snapshot.board as unknown as Record<string, Array<Record<string, unknown>>>).productionDailyReports;
    const report = reports.find((item) => item.production_order_id === production.id) as Record<string, unknown>;

    expect(report).toMatchObject({
      report_no: expect.stringMatching(/^RB-\d{8}-\d{3}$/),
      prod_no: production.prod_no,
      report_date: "2026-06-21",
      shift: "白班",
      planned_qty: 10,
      finished_qty: 8,
      good_qty: 7.5,
      defect_qty: 0.3,
      scrap_qty: 0.2,
      work_hours: 6.5,
      yield_rate: 93.75,
      abnormal_note: "首件调机耗时偏长，已记录。",
      reported_by_name: "生产主管-马工",
      status: "submitted",
    });
  });

  it("requires technical department disposition after failed OQC and routes rework back to production", async () => {
    const service = await loadService();
    const { production } = createProducingOrder(service, "10");

    service.performAction({
      actorId: "U-PROD",
      action: "requestInspection",
      entityId: String(production.id),
      payload: {
        completion_qty: "10",
        sample_qty: "3",
        request_note: "日报记录后提交 OQC 终检。",
      },
    });
    const inspection = service.getSnapshot("U-QA").board.inspections[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(inspection.id),
      payload: {
        result: "failed",
        measurements: "端面平面度超出技术标准，抽检 3 件均不合格。",
        disposition_note: "不合格，转技术部出具处理意见。",
      },
    });

    const failed = service.getSnapshot("U-QA");
    const failedProductions = failed.board.productions as Array<Record<string, unknown>>;
    expect(failedProductions.find((item) => item.id === production.id)).toMatchObject({ status: "qa_failed" });
    expect(() =>
      service.performAction({
        actorId: "U-QA",
        action: "createTechnicalDisposition",
        entityId: String(inspection.id),
        payload: {
          disposition_type: "rework",
          root_cause: "夹具定位磨损导致加工基准偏移。",
          corrective_action: "更换定位块后返工，返工完成重新请验。",
        },
      }),
    ).toThrow("无权执行");

    service.performAction({
      actorId: "U-TECH",
      action: "createTechnicalDisposition",
      entityId: String(inspection.id),
      payload: {
        disposition_type: "rework",
        root_cause: "夹具定位磨损导致加工基准偏移。",
        corrective_action: "更换定位块后返工，返工完成重新请验。",
        due_date: "2026-06-23",
        note: "技术部已确认返工风险可控。",
      },
    });

    const technical = service.getSnapshot("U-TECH");
    const dispositions = (technical.board as unknown as Record<string, Array<Record<string, unknown>>>).technicalDispositions;
    const disposition = dispositions.find((item) => item.inspection_id === inspection.id) as Record<string, unknown>;
    expect(disposition).toMatchObject({
      disposition_no: expect.stringMatching(/^JS-\d{8}-\d{3}$/),
      inspection_no: inspection.inspection_no,
      prod_no: production.prod_no,
      disposition_type: "rework",
      disposition_type_label: "返工返修",
      root_cause: "夹具定位磨损导致加工基准偏移。",
      corrective_action: "更换定位块后返工，返工完成重新请验。",
      status: "issued",
      status_label: "已下发",
      created_by_name: "技术部-陈工",
    });
    const technicalProductions = technical.board.productions as Array<Record<string, unknown>>;
    expect(technicalProductions.find((item) => item.id === production.id)).toMatchObject({
      status: "producing",
      status_label: "生产中",
    });

    expect(() =>
      service.performAction({
        actorId: "U-TECH",
        action: "createTechnicalDisposition",
        entityId: String(inspection.id),
        payload: {
          disposition_type: "scrap",
          root_cause: "重复处置测试",
          corrective_action: "重复处置测试",
        },
      }),
    ).toThrow("已存在技术处置");
  });

  it("links reinspection to the failed inspection and closes the technical disposition after passing", async () => {
    const service = await loadService();
    const { production } = createProducingOrder(service, "10");

    service.performAction({
      actorId: "U-PROD",
      action: "requestInspection",
      entityId: String(production.id),
      payload: {
        completion_qty: "10",
        sample_qty: "3",
        request_note: "首轮 OQC 终检。",
      },
    });
    const firstInspection = service.getSnapshot("U-QA").board.inspections[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(firstInspection.id),
      payload: {
        result: "failed",
        measurements: "首轮检验端面平面度超差。",
        disposition_note: "转技术部评审后返工。",
      },
    });
    service.performAction({
      actorId: "U-TECH",
      action: "createTechnicalDisposition",
      entityId: String(firstInspection.id),
      payload: {
        disposition_type: "rework",
        root_cause: "夹具定位块磨损，导致基准漂移。",
        corrective_action: "更换夹具定位块并返工，返工后重新 OQC。",
        due_date: "2026-06-23",
      },
    });
    const issued = service.getSnapshot("U-TECH");
    const disposition = (issued.board as unknown as Record<string, Array<Record<string, unknown>>>).technicalDispositions.find(
      (item) => item.inspection_id === firstInspection.id,
    ) as Record<string, unknown>;

    service.performAction({
      actorId: "U-PROD",
      action: "requestInspection",
      entityId: String(production.id),
      payload: {
        completion_qty: "9.6",
        sample_qty: "3",
        request_note: "按技术处置返工完成，发起复检。",
      },
    });

    const reinspectionSnapshot = service.getSnapshot("U-QA");
    const reinspection = reinspectionSnapshot.board.inspections.find(
      (item) => item.parent_inspection_id === firstInspection.id,
    ) as Record<string, unknown>;
    expect(reinspection).toMatchObject({
      inspection_no: expect.stringMatching(/^QY-\d{8}-\d{3}$/),
      parent_inspection_id: firstInspection.id,
      parent_inspection_no: firstInspection.inspection_no,
      technical_disposition_id: disposition.id,
      technical_disposition_no: disposition.disposition_no,
      inspection_round: 2,
      is_reinspection: 1,
      status: "pending",
      request_note: "按技术处置返工完成，发起复检。",
    });
    const requestedDisposition = (reinspectionSnapshot.board as unknown as Record<string, Array<Record<string, unknown>>>).technicalDispositions.find(
      (item) => item.id === disposition.id,
    ) as Record<string, unknown>;
    expect(requestedDisposition).toMatchObject({
      status: "reinspection_requested",
      status_label: "已转复检",
    });

    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(reinspection.id),
      payload: {
        result: "qualified",
        actual_qty: "9.5",
        measurements: "复检合格，关键尺寸全部回到公差范围。",
        disposition_note: "复检合格，技术处置闭环关闭。",
      },
    });

    const closed = service.getSnapshot("U-TECH");
    const closedDisposition = (closed.board as unknown as Record<string, Array<Record<string, unknown>>>).technicalDispositions.find(
      (item) => item.id === disposition.id,
    ) as Record<string, unknown>;
    expect(closedDisposition).toMatchObject({
      status: "closed",
      status_label: "已关闭",
    });
    expect(String(closedDisposition.closed_at ?? "")).toContain("T");
    const closedProductions = closed.board.productions as Array<Record<string, unknown>>;
    expect(closedProductions.find((item) => item.id === production.id)).toMatchObject({
      status: "qa_approved",
      status_label: "待入库",
    });
  });
});

describe("ERP service formal sales shipment and receivable loop", () => {
  it("stores formal order fields, creates shipment receivable, and settles receipts", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "20",
        margin_rate: "0.2",
      },
    });
    const quote = service.getSnapshot("U-SALES").board.quotes[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
    service.performAction({
      actorId: "U-SALES",
      action: "createOrder",
      entityId: String(quote.id),
      payload: {
        due_date: "2026-06-15",
        special_requirements: "发货前提供检验报告",
        customer_po_no: "PO-CUST-20260615",
        sales_contract_no: "HT-2026-001",
        delivery_address: "上海市浦东新区张江路 88 号",
        consignee: "刘经理",
        contact_phone: "138-0000-2026",
        payment_terms_days: "15",
        remark: "首批正式订单",
      },
    });

    const ordered = service.getSnapshot("U-SALES");
    const order = ordered.board.orders[0] as Record<string, unknown>;
    expect(order).toMatchObject({
      customer_po_no: "PO-CUST-20260615",
      sales_contract_no: "HT-2026-001",
      delivery_address: "上海市浦东新区张江路 88 号",
      consignee: "刘经理",
      contact_phone: "138-0000-2026",
      payment_terms_days: 15,
      remark: "首批正式订单",
    });

    service.performAction({ actorId: "U-ASSIST", action: "createProductionInstruction", entityId: String(order.id) });
    const production = service.getSnapshot("U-PROD").board.productions[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-PROD", action: "scheduleAndGenerateRequisition", entityId: String(production.id) });
    const requisition = service.getSnapshot("U-WH").board.requisitions[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-WH", action: "approveMaterialRequisition", entityId: String(requisition.id) });
    service.performAction({ actorId: "U-WH", action: "issueMaterials", entityId: String(requisition.id) });
    service.performAction({ actorId: "U-PROD", action: "requestInspection", entityId: String(production.id) });
    const inspection = service.getSnapshot("U-QA").board.inspections[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(inspection.id),
      payload: {
        result: "qualified",
        actual_qty: "18",
        measurements: "全项合格，准予入库。",
      },
    });
    service.performAction({ actorId: "U-WH", action: "receiveFinishedGoods", entityId: String(production.id) });
    const inbounded = service.getSnapshot("U-MGR");
    const receipt = inbounded.board.finishedReceipts.find((item) => item.production_order_id === production.id) as Record<
      string,
      unknown
    >;
    const costSummary = inbounded.board.productionCostSummaries.find(
      (item) => item.production_order_id === production.id,
    ) as Record<string, unknown>;
    expect(costSummary).toMatchObject({
      production_order_id: production.id,
      order_id: order.id,
      receipt_id: receipt.id,
      material_cost: receipt.material_cost,
      process_cost: receipt.process_cost,
      total_cost: receipt.total_cost,
      finished_qty: receipt.finished_qty,
      transition_qty: receipt.transition_qty,
      unit_cost: receipt.unit_cost,
      status: "closed",
    });

    service.performAction({
      actorId: "U-ASSIST",
      action: "createShipment",
      entityId: String(production.id),
      payload: {
        shipped_qty: "12",
        shipped_at: "2026-06-16",
        delivery_address: "上海市浦东新区张江路 88 号",
        consignee: "刘经理",
        contact_phone: "138-0000-2026",
        logistics_company: "顺丰专线",
        vehicle_no: "沪A-ERP01",
        tracking_no: "SF20260615001",
        remark: "第一批部分发货",
      },
    });

    const shipped = service.getSnapshot("U-ASSIST");
    const shipment = shipped.board.shipments[0] as Record<string, unknown>;
    const receivable = shipped.board.receivables.find((item) => item.shipment_id === shipment.id) as Record<string, unknown>;
    const shippedOrders = shipped.board.orders as Array<Record<string, unknown>>;
    const shippedOrder = shippedOrders.find((item) => item.id === order.id) as Record<string, unknown>;
    const finishedBatch = shipped.board.finishedBatches.find(
      (item) => item.production_order_id === production.id && item.kind === "finished",
    ) as Record<string, unknown>;
    const shipmentAllocation = shipped.board.finishedShipmentAllocations.find(
      (item) => item.shipment_id === shipment.id,
    ) as Record<string, unknown>;
    const expectedReceivableAmount = Math.round((Number(quote.total_amount) * 12 * 100) / 20) / 100;
    const expectedShipmentCost = Math.round(Number(receipt.unit_cost) * 12 * 100) / 100;
    const expectedGrossProfit = Math.round((expectedReceivableAmount - expectedShipmentCost) * 100) / 100;
    const expectedGrossMargin = Math.round((expectedGrossProfit / expectedReceivableAmount) * 10000) / 100;

    expect(shipment).toMatchObject({
      order_id: order.id,
      shipped_qty: 12,
      sales_amount: expectedReceivableAmount,
      cost_amount: expectedShipmentCost,
      gross_profit: expectedGrossProfit,
      gross_margin: expectedGrossMargin,
      financial_status: "unpaid",
      shipped_by_name: "商务内勤-周敏",
      delivery_address: "上海市浦东新区张江路 88 号",
      consignee: "刘经理",
      logistics_company: "顺丰专线",
      vehicle_no: "沪A-ERP01",
      tracking_no: "SF20260615001",
      remark: "第一批部分发货",
    });
    expect(shippedOrder.status).toBe("partial_shipped");
    expect(finishedBatch.qty).toBe(6);
    expect(shipmentAllocation).toMatchObject({
      shipment_id: shipment.id,
      finished_batch_id: finishedBatch.id,
      production_order_id: production.id,
      qty: 12,
      unit_cost: receipt.unit_cost,
      cost_amount: expectedShipmentCost,
    });
    expect(receivable).toMatchObject({
      order_id: order.id,
      shipment_id: shipment.id,
      total_amount: expectedReceivableAmount,
      received_amount: 0,
      balance_amount: expectedReceivableAmount,
      status: "unpaid",
      due_date: "2026-07-01",
    });

    service.performAction({
      actorId: "U-FIN",
      action: "recordReceivableReceipt",
      entityId: String(receivable.id),
      payload: {
        amount: "200",
        method: "银行转账",
        note: "客户首笔回款",
        received_at: "2026-06-20",
      },
    });
    const partiallyPaid = service.getSnapshot("U-FIN").board.receivables.find((item) => item.id === receivable.id) as Record<
      string,
      unknown
    >;
    expect(partiallyPaid).toMatchObject({
      received_amount: 200,
      balance_amount: Math.round((expectedReceivableAmount - 200) * 100) / 100,
      status: "partial",
    });
    const partialShipment = (service.getSnapshot("U-FIN").board.shipments as Array<Record<string, unknown>>).find((item) => item.id === shipment.id) as Record<
      string,
      unknown
    >;
    expect(partialShipment.financial_status).toBe("partial");

    service.performAction({
      actorId: "U-FIN",
      action: "recordReceivableReceipt",
      entityId: String(receivable.id),
      payload: {
        amount: String(partiallyPaid.balance_amount),
        method: "承兑汇票",
        note: "尾款结清",
        received_at: "2026-06-28",
      },
    });
    const settled = service.getSnapshot("U-FIN").board.receivables.find((item) => item.id === receivable.id) as Record<
      string,
      unknown
    >;
    expect(settled).toMatchObject({
      received_amount: expectedReceivableAmount,
      balance_amount: 0,
      status: "paid",
      settled_at: "2026-06-28",
    });
    const settledShipment = (service.getSnapshot("U-FIN").board.shipments as Array<Record<string, unknown>>).find((item) => item.id === shipment.id) as Record<
      string,
      unknown
    >;
    expect(settledShipment.financial_status).toBe("paid");
  });
});

describe("ERP service formal reversal closure", () => {
  it("reverses purchase receipts with inventory reverse movements and payable red offsets", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-PUR");
    const supplier = before.board.suppliers.find((item) => item.status === "active");
    const material = before.board.materials.find((item) => item.status === "active");
    const previousQty = Number(material?.stock_qty ?? 0);
    const previousAverageCost = Number(material?.average_cost ?? 0);

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: supplier?.id,
        due_date: "2026-06-20",
        lines: [
          {
            material_id: material?.id,
            qty: "10",
            unit_cost: "60",
          },
        ],
      },
    });

    const purchased = service.getSnapshot("U-PUR");
    const purchaseOrder = purchased.board.purchaseOrders[0] as Record<string, unknown>;
    const approval = purchased.board.approvalRequests.find((item) => item.entity_id === purchaseOrder.id);
    service.performAction({ actorId: "U-MGR", action: "approveApproval", entityId: String(approval?.id) });
    service.performAction({ actorId: "U-PUR", action: "receivePurchaseOrder", entityId: String(purchaseOrder.id) });

    const received = service.getSnapshot("U-PUR");
    const payable = received.board.payables.find((item) => item.purchase_order_id === purchaseOrder.id) as Record<string, unknown>;
    expect(received.board.documentReversalCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document_type: "purchase_order",
          document_id: purchaseOrder.id,
          document_no: purchaseOrder.purchase_no,
        }),
      ]),
    );

    expect(() =>
      service.performAction({
        actorId: "U-SALES",
        action: "reverseBusinessDocument",
        entityId: String(purchaseOrder.id),
        payload: {
          document_type: "purchase_order",
          reason: "供应商送货批次作废，按正式流程红冲原入库。",
        },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-ADMIN",
      action: "reverseBusinessDocument",
      entityId: String(purchaseOrder.id),
      payload: {
        document_type: "purchase_order",
        reason: "供应商送货批次作废，按正式流程红冲原入库。",
      },
    });

    const reversed = service.getSnapshot("U-ADMIN");
    const reversedPurchase = (reversed.board.purchaseOrders as Array<Record<string, unknown>>).find(
      (item) => item.id === purchaseOrder.id,
    ) as Record<string, unknown>;
    const updatedMaterial = reversed.board.materials.find((item) => item.id === material?.id) as Record<string, unknown>;
    const reversal = reversed.board.documentReversals[0] as Record<string, unknown>;
    const redOffset = reversed.board.ledgerRedOffsets[0] as Record<string, unknown>;

    expect(reversedPurchase).toMatchObject({
      status: "reversed",
      status_label: "已冲销",
    });
    expect(updatedMaterial.stock_qty).toBe(previousQty);
    expect(updatedMaterial.average_cost).toBe(previousAverageCost);
    expect(reversal).toMatchObject({
      document_type: "purchase_order",
      document_type_label: "采购订单",
      document_id: purchaseOrder.id,
      document_no: purchaseOrder.purchase_no,
      reversal_type: "purchase_inbound",
      status_label: "已冲销",
      reversed_by_name: "系统管理员-管理员",
    });
    expect(redOffset).toMatchObject({
      ledger_type: "payable",
      ledger_type_label: "应付账款",
      ledger_id: payable.id,
      ledger_no: payable.payable_no,
      original_amount: 600,
      offset_amount: -600,
      reason: "供应商送货批次作废，按正式流程红冲原入库。",
    });
    expect(reversed.board.payables.find((item) => item.id === payable.id)).toMatchObject({
      status: "reversed",
      balance_amount: 0,
    });
    expect(reversed.board.inventoryTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movement_type: "purchase_inbound_reversal",
          source_type: "document_reversal",
          source_id: reversal.id,
          qty: -10,
        }),
      ]),
    );
    expect(() =>
      service.performAction({
        actorId: "U-ADMIN",
        action: "reverseBusinessDocument",
        entityId: String(purchaseOrder.id),
        payload: {
          document_type: "purchase_order",
          reason: "重复冲销",
        },
      }),
    ).toThrow("该单据已冲销");
  });

  it("reverses sales shipments with finished stock rollback and receivable red offsets", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "20",
        margin_rate: "0.2",
      },
    });
    const quote = service.getSnapshot("U-SALES").board.quotes[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
    service.performAction({
      actorId: "U-SALES",
      action: "createOrder",
      entityId: String(quote.id),
      payload: {
        due_date: "2026-06-15",
        special_requirements: "发货前提供检验报告",
        customer_po_no: "PO-CUST-REVERSAL",
        sales_contract_no: "HT-REVERSAL-001",
        delivery_address: "上海市浦东新区张江路 88 号",
        consignee: "刘经理",
        contact_phone: "138-0000-2026",
        payment_terms_days: "15",
      },
    });
    const order = service.getSnapshot("U-SALES").board.orders[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-ASSIST", action: "createProductionInstruction", entityId: String(order.id) });
    const production = service.getSnapshot("U-PROD").board.productions[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-PROD", action: "scheduleAndGenerateRequisition", entityId: String(production.id) });
    const requisition = service.getSnapshot("U-WH").board.requisitions[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-WH", action: "approveMaterialRequisition", entityId: String(requisition.id) });
    service.performAction({ actorId: "U-WH", action: "issueMaterials", entityId: String(requisition.id) });
    service.performAction({ actorId: "U-PROD", action: "requestInspection", entityId: String(production.id) });
    const inspection = service.getSnapshot("U-QA").board.inspections[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(inspection.id),
      payload: {
        result: "qualified",
        actual_qty: "18",
      },
    });
    service.performAction({ actorId: "U-WH", action: "receiveFinishedGoods", entityId: String(production.id) });
    service.performAction({
      actorId: "U-ASSIST",
      action: "createShipment",
      entityId: String(production.id),
      payload: {
        shipped_qty: "12",
        shipped_at: "2026-06-16",
      },
    });

    const shipped = service.getSnapshot("U-FIN");
    const shipment = shipped.board.shipments[0] as Record<string, unknown>;
    const receivable = shipped.board.receivables.find((item) => item.shipment_id === shipment.id) as Record<string, unknown>;
    const finishedBatch = shipped.board.finishedBatches.find(
      (item) => item.production_order_id === production.id && item.kind === "finished",
    ) as Record<string, unknown>;
    const expectedRestoredQty = Number(finishedBatch.qty) + 12;

    service.performAction({
      actorId: "U-FIN",
      action: "recordReceivableReceipt",
      entityId: String(receivable.id),
      payload: {
        amount: "200",
        method: "银行转账",
        note: "客户首笔回款",
        received_at: "2026-06-20",
      },
    });

    expect(shipped.board.documentReversalCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document_type: "shipment",
          document_id: shipment.id,
          document_no: shipment.shipment_no,
        }),
      ]),
    );

    service.performAction({
      actorId: "U-MGR",
      action: "reverseBusinessDocument",
      entityId: String(shipment.id),
      payload: {
        document_type: "shipment",
        reason: "客户发货信息有误，冲销原发货单并重开发货。",
      },
    });

    const reversed = service.getSnapshot("U-MGR");
    const reversedShipment = (reversed.board.shipments as Array<Record<string, unknown>>).find((item) => item.id === shipment.id) as Record<string, unknown>;
    const reversedReceivable = reversed.board.receivables.find((item) => item.id === receivable.id) as Record<string, unknown>;
    const restoredBatch = reversed.board.finishedBatches.find((item) => item.id === finishedBatch.id) as Record<string, unknown>;
    const reversedOrder = (reversed.board.orders as Array<Record<string, unknown>>).find(
      (item) => item.id === order.id,
    ) as Record<string, unknown>;
    const reversedProduction = (reversed.board.productions as Array<Record<string, unknown>>).find(
      (item) => item.id === production.id,
    ) as Record<string, unknown>;
    const reversal = reversed.board.documentReversals[0] as Record<string, unknown>;
    const redOffset = reversed.board.ledgerRedOffsets[0] as Record<string, unknown>;

    expect(reversedShipment).toMatchObject({
      status: "reversed",
      financial_status: "reversed",
    });
    expect(restoredBatch).toMatchObject({
      qty: expectedRestoredQty,
      status: "available",
    });
    expect(reversedOrder.status).toBe("in_production");
    expect(reversedProduction.status).toBe("in_stock");
    expect(reversedReceivable).toMatchObject({
      status: "reversed",
      balance_amount: 0,
    });
    expect(reversal).toMatchObject({
      document_type: "shipment",
      document_type_label: "发货单",
      document_id: shipment.id,
      document_no: shipment.shipment_no,
      reversal_type: "sales_shipment",
      status_label: "已冲销",
      reversed_by_name: "管理层-王总",
    });
    expect(redOffset).toMatchObject({
      ledger_type: "receivable",
      ledger_type_label: "应收账款",
      ledger_id: receivable.id,
      ledger_no: receivable.receivable_no,
      original_amount: receivable.total_amount,
      offset_amount: -Number(receivable.total_amount),
      reason: "客户发货信息有误，冲销原发货单并重开发货。",
    });
    expect(reversed.board.inventoryTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movement_type: "shipment_outbound_reversal",
          source_type: "document_reversal",
          source_id: reversal.id,
          qty: 12,
        }),
      ]),
    );
  });
});

describe("ERP service formal after-sales return refund and replacement loop", () => {
  it("records customer returns, customer refunds, and no-charge replacement shipments as a closed loop", async () => {
    const service = await loadService();
    const before = service.getSnapshot("U-SALES");
    const customer = before.board.customers.find((item) => item.status === "active");
    const product = before.board.products.find((item) => item.status === "active");

    service.performAction({
      actorId: "U-SALES",
      action: "createQuote",
      payload: {
        customer_id: customer?.id,
        product_id: product?.id,
        qty: "20",
        margin_rate: "0.2",
      },
    });
    const quote = service.getSnapshot("U-SALES").board.quotes[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-SALES", action: "confirmQuote", entityId: String(quote.id) });
    service.performAction({
      actorId: "U-SALES",
      action: "createOrder",
      entityId: String(quote.id),
      payload: {
        due_date: "2026-06-15",
        special_requirements: "售后闭环测试订单",
        customer_po_no: "PO-CUST-AFTERSALE",
        sales_contract_no: "HT-AFTERSALE-001",
        delivery_address: "上海市浦东新区张江路 88 号",
        consignee: "刘经理",
        contact_phone: "138-0000-2026",
        payment_terms_days: "15",
      },
    });
    const order = service.getSnapshot("U-SALES").board.orders[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-ASSIST", action: "createProductionInstruction", entityId: String(order.id) });
    const production = service.getSnapshot("U-PROD").board.productions[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-PROD", action: "scheduleAndGenerateRequisition", entityId: String(production.id) });
    const requisition = service.getSnapshot("U-WH").board.requisitions[0] as Record<string, unknown>;
    service.performAction({ actorId: "U-WH", action: "approveMaterialRequisition", entityId: String(requisition.id) });
    service.performAction({ actorId: "U-WH", action: "issueMaterials", entityId: String(requisition.id) });
    service.performAction({ actorId: "U-PROD", action: "requestInspection", entityId: String(production.id) });
    const inspection = service.getSnapshot("U-QA").board.inspections[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(inspection.id),
      payload: {
        result: "qualified",
        actual_qty: "18",
      },
    });
    service.performAction({ actorId: "U-WH", action: "receiveFinishedGoods", entityId: String(production.id) });
    service.performAction({
      actorId: "U-ASSIST",
      action: "createShipment",
      entityId: String(production.id),
      payload: {
        shipped_qty: "12",
        shipped_at: "2026-06-16",
        logistics_company: "顺丰专线",
        tracking_no: "SF-AFTERSALE-001",
      },
    });

    const shipped = service.getSnapshot("U-FIN");
    const shipment = shipped.board.shipments[0] as Record<string, unknown>;
    const receivable = shipped.board.receivables.find((item) => item.shipment_id === shipment.id) as Record<string, unknown>;
    const finishedBatch = shipped.board.finishedBatches.find(
      (item) => item.production_order_id === production.id && item.kind === "finished",
    ) as Record<string, unknown>;
    const shippedQty = Number(shipment.shipped_qty);
    const returnQty = 4;
    const expectedReturnAmount = Math.round((Number(shipment.sales_amount) * returnQty * 100) / shippedQty) / 100;
    const expectedReturnCost = Math.round((Number(shipment.cost_amount) * returnQty * 100) / shippedQty) / 100;

    service.performAction({
      actorId: "U-FIN",
      action: "recordReceivableReceipt",
      entityId: String(receivable.id),
      payload: {
        amount: String(receivable.balance_amount),
        method: "银行转账",
        note: "客户已全额回款",
        received_at: "2026-06-20",
      },
    });

    expect(service.getSnapshot("U-ASSIST").board.salesReturnCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shipment_id: shipment.id,
          shipment_no: shipment.shipment_no,
          returnable_qty: 12,
        }),
      ]),
    );
    expect(() =>
      service.performAction({
        actorId: "U-SALES",
        action: "recordSalesReturn",
        entityId: String(shipment.id),
        payload: {
          return_qty: String(returnQty),
          reason: "客户反馈包装破损，要求退货退款并补发。",
        },
      }),
    ).toThrow("无权执行该操作");

    service.performAction({
      actorId: "U-ASSIST",
      action: "recordSalesReturn",
      entityId: String(shipment.id),
      payload: {
        return_qty: String(returnQty),
        received_at: "2026-06-25",
        reason: "客户反馈包装破损，要求退货退款并补发。",
        disposition: "return_to_stock",
        note: "实物已退回仓库，外观复核后可补发。",
      },
    });

    const returned = service.getSnapshot("U-FIN");
    const salesReturn = returned.board.salesReturns[0] as Record<string, unknown>;
    const returnAllocation = returned.board.salesReturnAllocations[0] as Record<string, unknown>;
    const returnedReceivable = returned.board.receivables.find((item) => item.id === receivable.id) as Record<string, unknown>;
    const restoredBatch = returned.board.finishedBatches.find((item) => item.id === finishedBatch.id) as Record<string, unknown>;

    expect(salesReturn).toMatchObject({
      shipment_id: shipment.id,
      shipment_no: shipment.shipment_no,
      return_qty: returnQty,
      return_amount: expectedReturnAmount,
      cost_amount: expectedReturnCost,
      refund_due_amount: expectedReturnAmount,
      offset_amount: 0,
      status: "returned",
      refund_status: "pending_refund",
      replacement_status: "pending_replacement",
    });
    expect(returnAllocation).toMatchObject({
      sales_return_id: salesReturn.id,
      finished_batch_id: finishedBatch.id,
      qty: returnQty,
    });
    expect(restoredBatch.qty).toBe(Number(finishedBatch.qty) + returnQty);
    expect(returnedReceivable).toMatchObject({
      adjusted_amount: expectedReturnAmount,
      refund_due_amount: expectedReturnAmount,
      balance_amount: 0,
      status: "refund_due",
    });
    expect(returned.board.inventoryTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movement_type: "sales_return_inbound",
          source_type: "sales_return",
          source_id: salesReturn.id,
          qty: returnQty,
        }),
      ]),
    );

    service.performAction({
      actorId: "U-FIN",
      action: "recordCustomerRefund",
      entityId: String(salesReturn.id),
      payload: {
        amount: String(expectedReturnAmount),
        method: "银行转账",
        refunded_at: "2026-06-26",
        note: "退货退款已支付给客户。",
      },
    });

    const refunded = service.getSnapshot("U-FIN");
    const refund = refunded.board.customerRefunds[0] as Record<string, unknown>;
    const refundedReturn = (refunded.board.salesReturns as Array<Record<string, unknown>>).find((item) => item.id === salesReturn.id) as Record<string, unknown>;
    const refundedReceivable = refunded.board.receivables.find((item) => item.id === receivable.id) as Record<string, unknown>;

    expect(refund).toMatchObject({
      sales_return_id: salesReturn.id,
      receivable_id: receivable.id,
      amount: expectedReturnAmount,
      method: "银行转账",
      status: "paid",
    });
    expect(refundedReturn.refund_status).toBe("refunded");
    expect(refundedReceivable).toMatchObject({
      refund_due_amount: 0,
      status: "paid",
    });

    service.performAction({
      actorId: "U-ASSIST",
      action: "createReplacementShipment",
      entityId: String(salesReturn.id),
      payload: {
        shipped_at: "2026-06-27",
        logistics_company: "顺丰专线",
        tracking_no: "SF-AFTERSALE-REPLACE",
        remark: "退货售后补发，不重复生成应收。",
      },
    });

    const replaced = service.getSnapshot("U-ASSIST");
    const replacement = replaced.board.shipments[0] as Record<string, unknown>;
    const replacedReturn = (replaced.board.salesReturns as Array<Record<string, unknown>>).find((item) => item.id === salesReturn.id) as Record<string, unknown>;
    const finalBatch = replaced.board.finishedBatches.find((item) => item.id === finishedBatch.id) as Record<string, unknown>;

    expect(replacement).toMatchObject({
      shipment_type: "replacement",
      shipment_type_label: "补开发货单",
      replacement_for_return_id: salesReturn.id,
      original_shipment_id: shipment.id,
      shipped_qty: returnQty,
      sales_amount: 0,
      financial_status: "no_charge",
      tracking_no: "SF-AFTERSALE-REPLACE",
    });
    expect(replaced.board.receivables.some((item) => item.shipment_id === replacement.id)).toBe(false);
    expect(replacedReturn.replacement_status).toBe("replaced");
    expect(finalBatch.qty).toBe(Number(finishedBatch.qty));
    expect(replaced.board.inventoryTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movement_type: "replacement_shipment_outbound",
          source_type: "shipment",
          source_id: replacement.id,
          qty: -returnQty,
        }),
      ]),
    );

    const salesReturnExport = await service.buildExport({
      actorId: "U-ASSIST",
      type: "sales-return",
      entityId: String(salesReturn.id),
      format: "xlsx",
    });
    const salesReturnXml = xlsxXml(salesReturnExport.buffer);
    expect(salesReturnExport.fileName).toContain("sales-return");
    expect(salesReturnXml).toContain("销售退货单");
    expect(salesReturnXml).toContain(String(salesReturn.return_no));
    expect(salesReturnXml).toContain("应收抵减");

    const customerRefundExport = await service.buildExport({
      actorId: "U-FIN",
      type: "customer-refund",
      entityId: String(refund.id),
      format: "xlsx",
    });
    const customerRefundXml = xlsxXml(customerRefundExport.buffer);
    expect(customerRefundExport.fileName).toContain("customer-refund");
    expect(customerRefundXml).toContain("客户退款单");
    expect(customerRefundXml).toContain(String(refund.refund_no));
    expect(customerRefundXml).toContain("银行转账");

    const replacementExport = await service.buildExport({
      actorId: "U-ASSIST",
      type: "replacement-shipment",
      entityId: String(replacement.id),
      format: "xlsx",
    });
    const replacementXml = xlsxXml(replacementExport.buffer);
    expect(replacementExport.fileName).toContain("replacement-shipment");
    expect(replacementXml).toContain("补开发货单");
    expect(replacementXml).toContain(String(replacement.shipment_no));
    expect(replacementXml).toContain(String(salesReturn.return_no));

    const exportTypes = service.getSnapshot("U-ADMIN").board.documentExports.map((item) => item.type);
    expect(exportTypes).toEqual(expect.arrayContaining(["sales-return", "customer-refund", "replacement-shipment"]));
  });
});

describe("ERP service production plan lock approval and change notifications", () => {
  it("locks a schedule snapshot, publishes it through approval, and creates role todo notifications after changes", async () => {
    const service = await loadService();
    const { production } = createProducingOrder(service, "10");

    service.performAction({
      actorId: "U-PROD",
      action: "updateProductionSchedule",
      entityId: String(production.id),
      payload: {
        planned_date: "2026-07-03",
        machine: "CNC-02",
        owner: "马工",
        shift: "白班",
        schedule_note: "锁版前确认生产排程。",
        change_reason: "锁版前标准化排程。",
      },
    });

    service.performAction({
      actorId: "U-PROD",
      action: "lockProductionPlan",
      payload: {
        date_from: "2026-07-01",
        date_to: "2026-07-10",
        note: "第 27 周生产计划锁版，提交管理层审批后发布。",
      },
    });

    const productionSnapshot = service.getSnapshot("U-PROD") as unknown as {
      board: {
        productionPlanVersions: Array<Record<string, unknown>>;
        productionPlanLines: Array<Record<string, unknown>>;
      };
    };
    const plan = productionSnapshot.board.productionPlanVersions[0];
    expect(plan).toMatchObject({
      status: "pending_approval",
      status_label: "待审批发布",
      line_count: expect.any(Number),
      locked_by_name: "生产主管-马工",
      approval_request_no: expect.stringMatching(/^SP-/),
    });
    expect(Number(plan.line_count)).toBeGreaterThan(0);
    expect(productionSnapshot.board.productionPlanLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plan_id: plan.id,
          prod_no: expect.stringMatching(/^SC-/),
          planned_date: "2026-07-03",
          machine: "CNC-02",
          owner: "马工",
        }),
      ]),
    );

    const managerSnapshot = service.getSnapshot("U-MGR") as unknown as {
      board: {
        approvalCenter: Array<Record<string, unknown>>;
        approvalRequests: Array<Record<string, unknown>>;
      };
      tasks: Array<Record<string, unknown>>;
    };
    const approval = managerSnapshot.board.approvalRequests.find((item) => item.entity_type === "production_plan");
    expect(approval).toMatchObject({
      entity_id: plan.id,
      title: expect.stringContaining(String(plan.plan_no)),
      status: "pending",
      approver_role: "manager",
    });
    expect(managerSnapshot.board.approvalCenter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          business_entity_type: "production_plan",
          business_entity_id: plan.id,
          source_type_label: "生产计划发布",
          module_label: "生产执行",
          approve_action: "approveApproval",
        }),
      ]),
    );
    expect(managerSnapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "approval",
          entityId: approval?.id,
          title: expect.stringContaining("审批"),
        }),
      ]),
    );

    service.performAction({
      actorId: "U-MGR",
      action: "approveApproval",
      entityId: String(approval?.id),
      payload: { approval_note: "计划范围清晰，同意发布执行。" },
    });

    const published = service.getSnapshot("U-MGR").board.productionPlanVersions[0] as Record<string, unknown>;
    expect(published).toMatchObject({
      id: plan.id,
      status: "published",
      status_label: "已发布",
      published_by_name: "管理层-王总",
      approval_note: "计划范围清晰，同意发布执行。",
    });

    service.performAction({
      actorId: "U-PROD",
      action: "updateProductionSchedule",
      entityId: String(production.id),
      payload: {
        planned_date: "2026-07-04",
        machine: "CNC-03",
        owner: "赵工",
        shift: "夜班",
        schedule_note: "发布后调整排程，需仓库和品控确认。",
        change_reason: "客户交期变更，计划发布后正式调整。",
      },
    });

    const warehouseSnapshot = service.getSnapshot("U-WH") as unknown as {
      board: { productionPlanNotifications: Array<Record<string, unknown>> };
      tasks: Array<Record<string, unknown>>;
    };
    const warehouseNotification = warehouseSnapshot.board.productionPlanNotifications.find(
      (item) => item.recipient_role === "warehouse",
    );
    expect(warehouseNotification).toMatchObject({
      plan_id: plan.id,
      status: "pending",
      status_label: "待确认",
      recipient_role_label: "仓库管理员",
      prod_no: expect.stringMatching(/^SC-/),
      detail: expect.stringContaining("2026-07-03"),
    });
    expect(warehouseSnapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `task-production-plan-notification-${warehouseNotification?.id}`,
          title: expect.stringContaining("生产计划变更"),
          action: "ackProductionPlanNotification",
          primaryLabel: "确认变更",
        }),
      ]),
    );

    service.performAction({
      actorId: "U-WH",
      action: "ackProductionPlanNotification",
      entityId: String(warehouseNotification?.id),
      payload: { acknowledge_note: "仓库已同步备料计划。" },
    });

    const acknowledged = service.getSnapshot("U-WH") as unknown as {
      board: { productionPlanNotifications: Array<Record<string, unknown>> };
      tasks: Array<Record<string, unknown>>;
    };
    expect(acknowledged.board.productionPlanNotifications.find((item) => item.id === warehouseNotification?.id)).toMatchObject({
      status: "acknowledged",
      acknowledged_by_name: "仓库管理员-吴勇",
      acknowledge_note: "仓库已同步备料计划。",
    });
    expect(
      acknowledged.tasks.some((task) => task.id === `task-production-plan-notification-${warehouseNotification?.id}`),
    ).toBe(false);
  });

  it("links published plan changes to material purchase quality and delivery impact todos", async () => {
    const service = await loadService();
    const { production, requisition } = createProducingOrder(service, "10");

    service.performAction({
      actorId: "U-PUR",
      action: "createPurchaseOrder",
      payload: {
        supplier_id: "SUP-001",
        due_date: "2026-07-05",
        lines: [{ material_id: "M-STEEL", qty: "30", unit_cost: "12.5" }],
      },
    });
    const purchaseApproval = service
      .getSnapshot("U-MGR")
      .board.approvalRequests.find((item) => item.entity_type === "purchase_order" && item.status === "pending");
    service.performAction({
      actorId: "U-MGR",
      action: "approveApproval",
      entityId: String(purchaseApproval?.id),
      payload: { approval_note: "生产计划相关备料采购，同意执行。" },
    });
    const purchaseOrders = service.getSnapshot("U-PUR").board.purchaseOrders as Array<Record<string, unknown>>;
    const purchaseOrder = purchaseOrders.find((item) => item.status === "pending_receipt" && item.due_date === "2026-07-05");

    service.performAction({
      actorId: "U-PROD",
      action: "updateProductionSchedule",
      entityId: String(production.id),
      payload: {
        planned_date: "2026-06-24",
        machine: "CNC-02",
        owner: "马工",
        shift: "白班",
        schedule_note: "锁版前基准排程。",
        change_reason: "建立生产计划基准。",
      },
    });
    service.performAction({
      actorId: "U-PROD",
      action: "lockProductionPlan",
      payload: {
        date_from: "2026-06-20",
        date_to: "2026-06-30",
        note: "第 26 周计划锁版，作为采购、质检和交付协同基准。",
      },
    });
    const plan = service.getSnapshot("U-PROD").board.productionPlanVersions[0] as Record<string, unknown>;
    const planApproval = service
      .getSnapshot("U-MGR")
      .board.approvalRequests.find((item) => item.entity_type === "production_plan" && item.entity_id === plan.id);
    service.performAction({
      actorId: "U-MGR",
      action: "approveApproval",
      entityId: String(planApproval?.id),
      payload: { approval_note: "同意发布，后续变更必须联动责任部门确认。" },
    });

    service.performAction({
      actorId: "U-PROD",
      action: "updateProductionSchedule",
      entityId: String(production.id),
      payload: {
        planned_date: "2026-07-02",
        machine: "CNC-05",
        owner: "赵工",
        shift: "夜班",
        schedule_note: "客户交期变化后重新排程。",
        change_reason: "客户要求延后生产并重新协调采购到货、质检和发货。",
      },
    });

    const managerSnapshot = service.getSnapshot("U-MGR") as unknown as {
      board: {
        productionPlanChangeImpacts: Array<Record<string, unknown>>;
      };
    };
    const impacts = managerSnapshot.board.productionPlanChangeImpacts;
    expect(impacts.map((item) => item.impact_type)).toEqual(
      expect.arrayContaining(["material_requisition", "purchase_arrival", "quality_window", "delivery_commitment"]),
    );
    expect(impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plan_id: plan.id,
          production_order_id: production.id,
          impact_type: "material_requisition",
          affected_role: "warehouse",
          source_document_no: requisition.req_no,
          status: "pending",
          status_label: "待处理",
        }),
        expect.objectContaining({
          impact_type: "purchase_arrival",
          affected_role: "purchasing",
          source_document_no: purchaseOrder?.purchase_no,
          severity: "high",
          summary: expect.stringContaining("2026-07-05"),
        }),
        expect.objectContaining({
          impact_type: "quality_window",
          affected_role: "quality",
          suggested_action: expect.stringContaining("检验"),
        }),
        expect.objectContaining({
          impact_type: "delivery_commitment",
          affected_role: "assistant",
          severity: "high",
          summary: expect.stringContaining("交期"),
        }),
      ]),
    );

    const purchasingSnapshot = service.getSnapshot("U-PUR") as unknown as {
      board: { productionPlanChangeImpacts: Array<Record<string, unknown>> };
      tasks: Array<Record<string, unknown>>;
    };
    const purchaseImpact = purchasingSnapshot.board.productionPlanChangeImpacts.find(
      (item) => item.impact_type === "purchase_arrival",
    ) as Record<string, unknown>;
    expect(purchasingSnapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `task-production-plan-impact-${purchaseImpact.id}`,
          title: expect.stringContaining("采购到货影响"),
          action: "resolveProductionPlanChangeImpact",
          primaryLabel: "处理影响",
        }),
      ]),
    );

    service.performAction({
      actorId: "U-PUR",
      action: "resolveProductionPlanChangeImpact",
      entityId: String(purchaseImpact.id),
      payload: { resolution_note: "已联系供应商调整到货节奏，并同步仓库备料窗口。" },
    });

    const resolvedSnapshot = service.getSnapshot("U-PUR") as unknown as {
      board: { productionPlanChangeImpacts: Array<Record<string, unknown>> };
      tasks: Array<Record<string, unknown>>;
    };
    const resolved = resolvedSnapshot.board.productionPlanChangeImpacts.find(
      (item) => item.id === purchaseImpact.id,
    ) as Record<string, unknown>;
    expect(resolved).toMatchObject({
      status: "resolved",
      status_label: "已处理",
      resolved_by_name: "采购员-孙倩",
      resolution_note: "已联系供应商调整到货节奏，并同步仓库备料窗口。",
    });
    expect(resolvedSnapshot.tasks.some((task) => task.id === `task-production-plan-impact-${purchaseImpact.id}`)).toBe(false);
  });

  it("creates linked business documents when resolving production plan change impacts", async () => {
    const service = await loadService();
    const scenario = createPlanChangeImpactScenario(service);

    const purchaseImpact = scenario.impacts.find(
      (item) => item.impact_type === "purchase_arrival" && item.source_document_id === scenario.purchaseOrder.id,
    ) as Record<string, unknown>;
    service.performAction({
      actorId: "U-PUR",
      action: "resolveProductionPlanChangeImpact",
      entityId: String(purchaseImpact.id),
      payload: {
        new_arrival_date: "2026-07-01",
        resolution_note: "供应商确认 2026-07-01 到货，采购生成调整后的到货通知单。",
      },
    });
    const purchaseLinked = service.getSnapshot("U-PUR") as unknown as {
      board: {
        productionPlanChangeImpacts: Array<Record<string, unknown>>;
        purchaseArrivalNotices: Array<Record<string, unknown>>;
      };
    };
    const resolvedPurchaseImpact = purchaseLinked.board.productionPlanChangeImpacts.find((item) => item.id === purchaseImpact.id) as Record<string, unknown>;
    const linkedArrival = purchaseLinked.board.purchaseArrivalNotices.find((item) => item.id === resolvedPurchaseImpact.linked_document_id) as Record<string, unknown>;
    expect(resolvedPurchaseImpact).toMatchObject({
      status: "resolved",
      linked_document_type: "purchase_arrival_notice",
      linked_document_no: expect.stringMatching(/^DH-/),
    });
    expect(linkedArrival).toMatchObject({
      purchase_order_id: scenario.purchaseOrder.id,
      arrived_at: "2026-07-01",
      status: "pending_signoff",
      note: expect.stringContaining("生产计划变更影响"),
    });

    const warehouseImpact = scenario.impacts.find((item) => item.impact_type === "material_requisition") as Record<string, unknown>;
    service.performAction({
      actorId: "U-WH",
      action: "resolveProductionPlanChangeImpact",
      entityId: String(warehouseImpact.id),
      payload: {
        adjustment_type: "supplement",
        suggested_qty: "2.5",
        resolution_note: "仓库生成补料建议单，待生产确认现场余料和补料数量。",
      },
    });
    const warehouseLinked = service.getSnapshot("U-WH") as unknown as {
      board: {
        productionPlanChangeImpacts: Array<Record<string, unknown>>;
        productionMaterialAdjustmentSuggestions: Array<Record<string, unknown>>;
      };
    };
    const resolvedWarehouseImpact = warehouseLinked.board.productionPlanChangeImpacts.find((item) => item.id === warehouseImpact.id) as Record<string, unknown>;
    expect(resolvedWarehouseImpact).toMatchObject({
      linked_document_type: "material_adjustment_suggestion",
      linked_document_no: expect.stringMatching(/^BT-/),
    });
    expect(warehouseLinked.board.productionMaterialAdjustmentSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impact_id: warehouseImpact.id,
          production_order_id: scenario.production.id,
          requisition_id: scenario.requisition.id,
          adjustment_type: "supplement",
          status_label: "待确认",
          suggested_qty: 2.5,
        }),
      ]),
    );

    const qualityImpact = scenario.impacts.find((item) => item.impact_type === "quality_window") as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "resolveProductionPlanChangeImpact",
      entityId: String(qualityImpact.id),
      payload: {
        inspection_window_date: "2026-07-03",
        inspector: "李洁",
        resolution_note: "品控已预留 2026-07-03 检验窗口。",
      },
    });
    const qualityLinked = service.getSnapshot("U-QA") as unknown as {
      board: {
        productionPlanChangeImpacts: Array<Record<string, unknown>>;
        qualityInspectionWindowConfirmations: Array<Record<string, unknown>>;
      };
    };
    const resolvedQualityImpact = qualityLinked.board.productionPlanChangeImpacts.find((item) => item.id === qualityImpact.id) as Record<string, unknown>;
    expect(resolvedQualityImpact).toMatchObject({
      linked_document_type: "quality_inspection_window",
      linked_document_no: expect.stringMatching(/^ZJ-/),
    });
    expect(qualityLinked.board.qualityInspectionWindowConfirmations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impact_id: qualityImpact.id,
          production_order_id: scenario.production.id,
          inspection_window_date: "2026-07-03",
          inspector: "李洁",
          status_label: "已确认",
        }),
      ]),
    );

    const deliveryImpact = scenario.impacts.find((item) => item.impact_type === "delivery_commitment") as Record<string, unknown>;
    service.performAction({
      actorId: "U-ASSIST",
      action: "resolveProductionPlanChangeImpact",
      entityId: String(deliveryImpact.id),
      payload: {
        proposed_delivery_date: "2026-07-05",
        contact_method: "电话沟通",
        customer_feedback: "客户接受 2026-07-05 发货安排，要求送货单备注计划变更。",
        resolution_note: "商务已完成客户交期确认。",
      },
    });
    const assistantLinked = service.getSnapshot("U-ASSIST") as unknown as {
      board: {
        productionPlanChangeImpacts: Array<Record<string, unknown>>;
        customerDeliveryConfirmations: Array<Record<string, unknown>>;
      };
    };
    const resolvedDeliveryImpact = assistantLinked.board.productionPlanChangeImpacts.find((item) => item.id === deliveryImpact.id) as Record<string, unknown>;
    expect(resolvedDeliveryImpact).toMatchObject({
      linked_document_type: "customer_delivery_confirmation",
      linked_document_no: expect.stringMatching(/^JQ-/),
    });
    expect(assistantLinked.board.customerDeliveryConfirmations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impact_id: deliveryImpact.id,
          order_id: scenario.order.id,
          original_due_date: "2026-06-28",
          proposed_delivery_date: "2026-07-05",
          confirmation_status: "accepted",
          customer_feedback: expect.stringContaining("客户接受"),
        }),
      ]),
    );
  });
});

describe("ERP service formal report center", () => {
  it("exports daily weekly monthly overstock and reconciliation reports with formal templates and snapshots", async () => {
    const service = await loadService();
    const reportExports = [
      { type: "business-daily", sheet: "business_daily", snapshotType: "daily", title: "经营日报" },
      { type: "business-weekly", sheet: "business_weekly", snapshotType: "weekly", title: "经营周报" },
      { type: "business-monthly", sheet: "business_monthly", snapshotType: "monthly", title: "经营月报" },
      { type: "inventory-overstock", sheet: "inventory_overstock", snapshotType: "inventory_overstock", title: "库存积压报表" },
      { type: "sales-statement", sheet: "sales_statement", snapshotType: "sales_statement", title: "销售对账单" },
      { type: "purchase-statement", sheet: "purchase_statement", snapshotType: "purchase_statement", title: "采购对账单" },
      { type: "quality-exception", sheet: "quality_exception", snapshotType: "quality_exception", title: "质量异常分析报表" },
    ] as const;

    for (const report of reportExports) {
      const result = await service.buildExport({
        actorId: "U-MGR",
        type: report.type,
        format: "xlsx",
      });
      const xml = xlsxXml(result.buffer);

      expect(result.fileName).toContain(report.type);
      expect(result.contentType).toContain("spreadsheetml");
      expect(result.buffer.subarray(0, 2).toString()).toBe("PK");
      expect(xml).toContain('name="report_cover"');
      expect(xml).toContain(`name="${report.sheet}"`);
      expect(xml).toContain(report.title);
      expect(xml).toContain("本地化生产流转 ERP");
    }

    const snapshot = service.getSnapshot("U-MGR");
    const reportSnapshots = snapshot.board.reportSnapshots as Array<Record<string, unknown>>;
    const reportTypes = reportSnapshots.map((item) => item.type);
    const exportTypes = snapshot.board.documentExports.map((item) => item.type);
    expect(reportTypes).toEqual(expect.arrayContaining(reportExports.map((report) => report.snapshotType)));
    expect(exportTypes).toEqual(expect.arrayContaining(reportExports.map((report) => report.type)));
    expect(reportSnapshots[0]).toMatchObject({
      report_title: expect.any(String),
      generated_by_name: "管理层-王总",
    });
  });

  it("exports a quality exception analysis report with root causes and technical disposition closure metrics", async () => {
    const service = await loadService();
    const { production } = createProducingOrder(service, "10");

    service.performAction({ actorId: "U-PROD", action: "requestInspection", entityId: String(production.id) });
    const inspection = service.getSnapshot("U-QA").board.inspections[0] as Record<string, unknown>;
    service.performAction({
      actorId: "U-QA",
      action: "completeInspection",
      entityId: String(inspection.id),
      payload: {
        result: "failed",
        measurements: "首轮 OQC 不合格，关键尺寸超差。",
        disposition_note: "需技术部判断返工方案。",
      },
    });
    service.performAction({
      actorId: "U-TECH",
      action: "createTechnicalDisposition",
      entityId: String(inspection.id),
      payload: {
        disposition_type: "rework",
        root_cause: "夹具定位磨损导致加工基准偏移。",
        corrective_action: "更换定位块后返工，并在返工完成后复检。",
        due_date: "2026-06-23",
      },
    });

    const result = await service.buildExport({
      actorId: "U-MGR",
      type: "quality-exception",
      format: "xlsx",
    });
    const xml = xlsxXml(result.buffer);

    expect(result.fileName).toContain("quality-exception");
    expect(xml).toContain('name="quality_exception"');
    expect(xml).toContain('name="root_cause"');
    expect(xml).toContain('name="disposition_type"');
    expect(xml).toContain("质量异常分析报表");
    expect(xml).toContain("夹具定位磨损导致加工基准偏移");
    expect(xml).toContain("返工返修");
    expect(xml).toContain("未关闭");

    const snapshot = service.getSnapshot("U-MGR");
    const analytics = snapshot.board.qualityExceptionAnalytics as Record<string, unknown>;
    expect(analytics.totals).toMatchObject({
      failed_count: 1,
      disposition_count: 1,
      closed_count: 0,
      closure_rate: 0,
    });
    expect(analytics.rootCauses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          root_cause: "夹具定位磨损导致加工基准偏移。",
          count: 1,
          closed_count: 0,
        }),
      ]),
    );
    expect(snapshot.board.reportSnapshots[0]).toMatchObject({
      type: "quality_exception",
      report_title: "质量异常分析报表",
      quality_failed_count: 1,
      quality_closure_rate: 0,
    });
  });

  it("applies formal report query filters to reconciliation and inventory exports", async () => {
    const service = await loadService();

    const salesIncluded = await service.buildExport({
      actorId: "U-MGR",
      type: "sales-statement",
      format: "csv",
      filters: { customerId: "C-001" },
    });
    expect(salesIncluded.buffer.toString("utf8")).toContain("YS-20260410-001");

    const salesExcluded = await service.buildExport({
      actorId: "U-MGR",
      type: "sales-statement",
      format: "csv",
      filters: { customerId: "C-NOT-EXISTS" },
    });
    expect(salesExcluded.buffer.toString("utf8")).not.toContain("YS-20260410-001");

    const salesFuture = await service.buildExport({
      actorId: "U-MGR",
      type: "sales-statement",
      format: "csv",
      filters: { dateFrom: "2099-01-01", dateTo: "2099-01-31" },
    });
    expect(salesFuture.buffer.toString("utf8")).not.toContain("YS-20260410-001");

    const purchaseIncluded = await service.buildExport({
      actorId: "U-MGR",
      type: "purchase-statement",
      format: "csv",
      filters: { supplierId: "SUP-002" },
    });
    expect(purchaseIncluded.buffer.toString("utf8")).toContain("YF-20260420-001");

    const purchaseExcluded = await service.buildExport({
      actorId: "U-MGR",
      type: "purchase-statement",
      format: "csv",
      filters: { supplierId: "SUP-001" },
    });
    expect(purchaseExcluded.buffer.toString("utf8")).not.toContain("YF-20260420-001");

    const inventoryFiltered = await service.buildExport({
      actorId: "U-MGR",
      type: "inventory-daily",
      format: "csv",
      filters: { materialId: "M-OVERSTOCK" },
    });
    const inventoryCsv = inventoryFiltered.buffer.toString("utf8");
    expect(inventoryCsv).toContain("旧版喷涂辅料");
    expect(inventoryCsv).not.toContain("42CrMo 圆钢");

    const formal = await service.buildExport({
      actorId: "U-MGR",
      type: "business-daily",
      format: "xlsx",
      filters: {
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        customerId: "C-001",
        supplierId: "SUP-002",
        materialId: "M-OVERSTOCK",
        orderId: "O-HISTORY-001",
      },
    });
    const formalXml = xlsxXml(formal.buffer);
    expect(formalXml).toContain("筛选条件");
    expect(formalXml).toContain("客户：上海星河装备有限公司");
    expect(formalXml).toContain("供应商：苏州涂装化工有限公司");
    expect(formalXml).toContain("物料：旧版喷涂辅料");
    expect(formalXml).toContain("订单：DD-20260410-001");

    const snapshot = service.getSnapshot("U-MGR");
    const filteredSnapshot = (snapshot.board.reportSnapshots as Array<Record<string, unknown>>).find((item) =>
      String(item.filter_summary ?? "").includes("客户：上海星河装备有限公司"),
    );
    expect(filteredSnapshot).toMatchObject({
      filter_summary: expect.stringContaining("客户：上海星河装备有限公司"),
    });
  });

  it("exports production plan ledger calendar and delivery warnings as a formal planning workbook", async () => {
    const service = await loadService();
    const { production } = createProducingOrder(service, "10");

    service.performAction({
      actorId: "U-PROD",
      action: "updateProductionSchedule",
      entityId: String(production.id),
      payload: {
        planned_date: "2026-07-03",
        machine: "CNC-02",
        owner: "马工",
        shift: "白班",
        schedule_note: "客户交期优先，纳入周生产计划。",
        change_reason: "测试正式生产计划导出。",
      },
    });

    const result = await service.buildExport({
      actorId: "U-PROD",
      type: "production-plan",
      format: "xlsx",
      filters: { dateFrom: "2026-07-01", dateTo: "2026-07-10" },
    });
    const xml = xlsxXml(result.buffer);

    expect(result.fileName).toContain("production-plan");
    expect(xml).toContain('name="production_plan"');
    expect(xml).toContain('name="schedule_calendar"');
    expect(xml).toContain('name="delivery_warnings"');
    expect(xml).toContain("SC-");
    expect(xml).toContain("CNC-02");
    expect(xml).toContain("马工");
    expect(xml).toContain("计划日期");
  });
});
