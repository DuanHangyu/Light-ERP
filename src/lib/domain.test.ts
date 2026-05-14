import { describe, expect, it } from "vitest";
import {
  allocateFifo,
  calculateAverageCostFromRemainingBatches,
  calculateMovingAverage,
  calculateAgeDays,
  calculateBalance,
  calculateLedgerStatus,
  calculateMaterialNetRequirements,
  calculateSupplierPerformanceScore,
  calculateYieldRate,
  classifyInventoryAging,
  expandBom,
  qaAllowsInbound,
  supplierAdmissionStatusFromScore,
} from "./domain";
import { buildDeliveryNotePreview } from "./delivery-note";
import { buildPurchaseArrivalDiscrepancyPrintPreview, buildTechnicalDispositionPrintPreview } from "./formal-print";
import {
  buildFinishedGoodsReceiptPreview,
  buildMaterialIssuePreview,
  buildMaterialRequisitionPreview,
  buildProductionInstructionPreview,
} from "./production-documents";

describe("ERP core algorithms", () => {
  it("calculates moving weighted average after purchase inbound", () => {
    expect(
      calculateMovingAverage({
        currentQty: 100,
        currentAverageCost: 12,
        incomingQty: 50,
        incomingUnitCost: 18,
      }),
    ).toEqual({ nextQty: 150, nextAverageCost: 14 });
  });

  it("recalculates remaining inventory average cost after outbound by actual batch costs", () => {
    expect(
      calculateAverageCostFromRemainingBatches([
        { qty: 0, unitCost: 12 },
        { qty: 70, unitCost: 14 },
        { qty: 30, unitCost: 18 },
      ]),
    ).toEqual({ nextQty: 100, nextAverageCost: 15.2 });
  });

  it("returns zero cost when outbound consumes all remaining inventory", () => {
    expect(calculateAverageCostFromRemainingBatches([{ qty: 0, unitCost: 12 }])).toEqual({
      nextQty: 0,
      nextAverageCost: 0,
    });
  });

  it("allocates material batches by FIFO and preserves shortage", () => {
    const result = allocateFifo(
      [
        { batchId: "B-OLD", availableQty: 6, receivedAt: "2026-01-02" },
        { batchId: "B-NEW", availableQty: 10, receivedAt: "2026-03-01" },
      ],
      12,
    );

    expect(result.allocations).toEqual([
      { batchId: "B-OLD", qty: 6 },
      { batchId: "B-NEW", qty: 6 },
    ]);
    expect(result.shortage).toBe(0);
  });

  it("reports FIFO shortage when stock is insufficient", () => {
    const result = allocateFifo([{ batchId: "B1", availableQty: 2, receivedAt: "2026-01-01" }], 5);
    expect(result.allocations).toEqual([{ batchId: "B1", qty: 2 }]);
    expect(result.shortage).toBe(3);
  });

  it("rejects invalid quantities for cost and FIFO calculations", () => {
    expect(() =>
      calculateMovingAverage({
        currentQty: -1,
        currentAverageCost: 12,
        incomingQty: 10,
        incomingUnitCost: 13,
      }),
    ).toThrow("Invalid quantity");
    expect(() => allocateFifo([], 0)).toThrow("Required quantity");
  });

  it("recursively expands multilevel BOM into aggregated material needs", () => {
    const result = expandBom({
      rootProductId: "P-FINISHED",
      quantity: 10,
      lines: [
        { parentProductId: "P-FINISHED", componentType: "product", componentId: "P-SEMI", qtyPer: 2 },
        { parentProductId: "P-FINISHED", componentType: "material", componentId: "M-PACK", qtyPer: 1 },
        { parentProductId: "P-SEMI", componentType: "material", componentId: "M-MAIN", qtyPer: 3, isPrimary: true },
        { parentProductId: "P-SEMI", componentType: "material", componentId: "M-AUX", qtyPer: 0.5 },
      ],
    });

    expect(result.materials).toEqual([
      { materialId: "M-AUX", requiredQty: 10, isPrimary: false },
      { materialId: "M-MAIN", requiredQty: 60, isPrimary: true },
      { materialId: "M-PACK", requiredQty: 10, isPrimary: false },
    ]);
    expect(result.primaryMaterialQty).toBe(60);
  });

  it("calculates MRP net requirements from BOM demand, safety stock, incoming purchase and planned requisitions", () => {
    const result = calculateMaterialNetRequirements({
      demands: [
        { materialId: "M-STEEL", requiredQty: 60, sourceSummary: "SC-001 / DD-001" },
        { materialId: "M-STEEL", requiredQty: 15, sourceSummary: "SC-002 / DD-002" },
        { materialId: "M-PACK", requiredQty: 12, sourceSummary: "SC-001 / DD-001" },
      ],
      supplies: [
        {
          materialId: "M-STEEL",
          availableQty: 40,
          safetyStockQty: 20,
          incomingPurchaseQty: 10,
          plannedRequisitionQty: 5,
          estimatedUnitCost: 14.25,
        },
        {
          materialId: "M-PACK",
          availableQty: 30,
          safetyStockQty: 10,
          incomingPurchaseQty: 0,
          plannedRequisitionQty: 0,
          estimatedUnitCost: 2.5,
        },
      ],
    });

    expect(result).toEqual([
      {
        materialId: "M-STEEL",
        requiredQty: 75,
        availableQty: 40,
        safetyStockQty: 20,
        incomingPurchaseQty: 10,
        plannedRequisitionQty: 5,
        netShortageQty: 40,
        suggestedPurchaseQty: 40,
        estimatedUnitCost: 14.25,
        lineAmount: 570,
        sourceSummary: "SC-001 / DD-001；SC-002 / DD-002",
        status: "shortage",
      },
      {
        materialId: "M-PACK",
        requiredQty: 12,
        availableQty: 30,
        safetyStockQty: 10,
        incomingPurchaseQty: 0,
        plannedRequisitionQty: 0,
        netShortageQty: 0,
        suggestedPurchaseQty: 0,
        estimatedUnitCost: 2.5,
        lineAmount: 0,
        sourceSummary: "SC-001 / DD-001",
        status: "covered",
      },
    ]);
  });

  it("scores suppliers by delivery, IQC, discrepancy, overdue payable and adjustment risk", () => {
    expect(
      calculateSupplierPerformanceScore({
        purchaseOrderCount: 6,
        onTimeDeliveryRate: 96,
        iqcPassRate: 100,
        discrepancyRate: 0,
        overduePayableCount: 0,
        adjustmentRate: 0,
      }),
    ).toMatchObject({
      score: 99,
      grade: "A",
      gradeLabel: "优质供应商",
      riskLevel: "low",
    });

    const risky = calculateSupplierPerformanceScore({
      purchaseOrderCount: 4,
      onTimeDeliveryRate: 72,
      iqcPassRate: 65,
      discrepancyRate: 50,
      overduePayableCount: 2,
      adjustmentRate: -8,
    });

    expect(risky.score).toBeLessThan(65);
    expect(risky).toMatchObject({
      grade: "D",
      gradeLabel: "高风险供应商",
      riskLevel: "high",
    });
    expect(risky.recommendation).toContain("暂停新增");
  });

  it("classifies supplier score boundaries and new supplier defaults", () => {
    expect(
      calculateSupplierPerformanceScore({
        purchaseOrderCount: 3,
        onTimeDeliveryRate: 85,
        iqcPassRate: 85,
        discrepancyRate: 20,
        overduePayableCount: 0,
        adjustmentRate: 0,
      }),
    ).toMatchObject({
      grade: "B",
      gradeLabel: "稳定供应商",
      riskLevel: "low",
    });

    expect(
      calculateSupplierPerformanceScore({
        purchaseOrderCount: 3,
        onTimeDeliveryRate: 80,
        iqcPassRate: 78,
        discrepancyRate: 40,
        overduePayableCount: 0,
        adjustmentRate: 0,
      }),
    ).toMatchObject({
      grade: "C",
      gradeLabel: "观察供应商",
      riskLevel: "medium",
    });

    expect(
      calculateSupplierPerformanceScore({
        purchaseOrderCount: 0,
        onTimeDeliveryRate: Number.NaN,
        iqcPassRate: Number.NaN,
        discrepancyRate: Number.NaN,
        overduePayableCount: 0,
        adjustmentRate: Number.NaN,
      }),
    ).toMatchObject({
      score: 100,
      grade: "A",
      recommendation: "暂无采购历史，作为新供应商观察引入。",
    });
  });

  it("maps supplier reassessment scores to formal admission control status", () => {
    expect(supplierAdmissionStatusFromScore(92)).toBe("normal");
    expect(supplierAdmissionStatusFromScore(82)).toBe("normal");
    expect(supplierAdmissionStatusFromScore(76)).toBe("watch");
    expect(supplierAdmissionStatusFromScore(64)).toBe("restricted");
    expect(supplierAdmissionStatusFromScore(48)).toBe("blacklisted");
  });

  it("allows inbound only for approved QA outcomes", () => {
    expect(qaAllowsInbound("qualified")).toBe(true);
    expect(qaAllowsInbound("concession")).toBe(true);
    expect(qaAllowsInbound("failed")).toBe(false);
  });

  it("calculates yield rate from actual inbound and primary issued quantity", () => {
    expect(calculateYieldRate({ actualInboundQty: 47.5, primaryIssuedQty: 50 })).toBe(95);
  });

  it("guards BOM cycles and zero-primary yield safely", () => {
    expect(() =>
      expandBom({
        rootProductId: "P1",
        quantity: 1,
        lines: [
          { parentProductId: "P1", componentType: "product", componentId: "P2", qtyPer: 1 },
          { parentProductId: "P2", componentType: "product", componentId: "P1", qtyPer: 1 },
        ],
      }),
    ).toThrow("BOM cycle");
    expect(calculateYieldRate({ actualInboundQty: 10, primaryIssuedQty: 0 })).toBe(0);
  });

  it("calculates receivable and payable status from settled amount", () => {
    expect(calculateLedgerStatus({ totalAmount: 1000, settledAmount: 0 })).toBe("unpaid");
    expect(calculateLedgerStatus({ totalAmount: 1000, settledAmount: 300 })).toBe("partial");
    expect(calculateLedgerStatus({ totalAmount: 1000, settledAmount: 1000 })).toBe("paid");
    expect(calculateBalance({ totalAmount: 1000, settledAmount: 300.126 })).toBe(699.87);
  });

  it("calculates non-negative ledger aging days", () => {
    expect(calculateAgeDays({ fromDate: "2026-04-01", asOfDate: "2026-04-28" })).toBe(27);
    expect(calculateAgeDays({ fromDate: "2026-05-01", asOfDate: "2026-04-28" })).toBe(0);
  });

  it("classifies inventory as normal, stale warning, and overstock by last movement date", () => {
    expect(
      classifyInventoryAging({
        lastMovementAt: "2026-04-01",
        asOfDate: "2026-05-12",
      }),
    ).toEqual({ status: "normal", inactiveDays: 41 });

    expect(
      classifyInventoryAging({
        lastMovementAt: "2026-01-15",
        asOfDate: "2026-05-12",
      }),
    ).toEqual({ status: "stale_warning", inactiveDays: 117 });

    expect(
      classifyInventoryAging({
        lastMovementAt: "2025-10-01",
        asOfDate: "2026-05-12",
      }),
    ).toEqual({ status: "overstock", inactiveDays: 223 });
  });

  it("builds a formal delivery note preview model from shipment data", () => {
    const preview = buildDeliveryNotePreview({
      shipment_no: "FH-20260616-001",
      shipped_at: "2026-06-16T09:30:00.000Z",
      customer_name: "上海星河装备有限公司",
      order_no: "DD-20260615-001",
      customer_po_no: "PO-CUST-20260615",
      sales_contract_no: "HT-2026-001",
      product_name: "定制化齿轮箱壳体",
      spec: "A-01",
      batch_no: "CP-20260615-001",
      shipped_qty: 12,
      unit: "件",
      delivery_address: "上海市浦东新区张江路 88 号",
      consignee: "刘经理",
      contact_phone: "138-0000-2026",
      logistics_company: "顺丰专线",
      vehicle_no: "沪A-ERP01",
      tracking_no: "SF20260615001",
      remark: "第一批部分发货",
    });

    expect(preview.header).toMatchObject({
      title: "送货单",
      documentNo: "FH-20260616-001",
      documentDate: "2026-06-16",
      statusText: "正式单据",
    });
    expect(preview.parties.customerName).toBe("上海星河装备有限公司");
    expect(preview.logistics).toMatchObject({
      consignee: "刘经理",
      phone: "138-0000-2026",
      trackingNo: "SF20260615001",
    });
    expect(preview.lines).toEqual([
      {
        lineNo: 1,
        productName: "定制化齿轮箱壳体",
        spec: "A-01",
        batchNo: "CP-20260615-001",
        qty: "12",
        unit: "件",
        remark: "第一批部分发货",
      },
    ]);
    expect(preview.signatures.map((item) => item.label)).toEqual(["制单", "仓库", "承运", "客户签收"]);
  });

  it("builds formal production instruction and material requisition preview models", () => {
    const instruction = buildProductionInstructionPreview({
      prod_no: "SC-20260618-001",
      order_no: "DD-20260615-001",
      customer_name: "上海星河装备有限公司",
      product_name: "定制化齿轮箱壳体",
      order_qty: 20,
      unit: "件",
      due_date: "2026-06-30",
      priority: "urgent",
      instruction_note: "客户要求随货提供检验报告",
      technical_requirements: "按 V1.0 BOM 和客户认可工艺执行",
      issued_by_name: "商务内勤-周敏",
      issued_at: "2026-06-18T10:00:00.000Z",
      planned_date: "2026-06-20",
      machine: "CNC-06",
      owner: "马工",
      shift: "白班",
    });

    expect(instruction.header).toMatchObject({
      title: "生产指令单",
      documentNo: "SC-20260618-001",
      documentDate: "2026-06-18",
    });
    expect(instruction.fields.find((item) => item.label === "优先级")?.value).toBe("加急");
    expect(instruction.signatures.map((item) => item.label)).toEqual(["内勤下单", "生产接收", "工艺确认", "主管审核"]);

    const requisition = buildMaterialRequisitionPreview({
      req_no: "LL-20260618-001",
      prod_no: "SC-20260618-001",
      order_no: "DD-20260615-001",
      product_name: "定制化齿轮箱壳体",
      order_qty: 20,
      unit: "件",
      bom_version: "V1.0",
      planned_date: "2026-06-20",
      machine: "CNC-06",
      owner: "马工",
      requisition_note: "按主材批次先进先出发料",
      lines: [
        {
          materialName: "42CrMo 圆钢",
          materialCode: "M-STEEL",
          requiredQty: 20,
          unit: "kg",
          isPrimary: 1,
        },
      ],
    });

    expect(requisition.header.title).toBe("生产领料单");
    expect(requisition.lines).toEqual([
      {
        lineNo: 1,
        materialCode: "M-STEEL",
        materialName: "42CrMo 圆钢",
        requiredQty: "20",
        unit: "kg",
        usage: "主材",
        remark: "按主材批次先进先出发料",
      },
    ]);
    expect(requisition.signatures.map((item) => item.label)).toEqual(["生产领料", "仓库发料", "品控留存", "主管确认"]);
  });

  it("builds a formal warehouse material issue preview model", () => {
    const preview = buildMaterialIssuePreview({
      issue_no: "CK-20260618-001",
      req_no: "LL-20260618-001",
      prod_no: "SC-20260618-001",
      order_no: "DD-20260615-001",
      customer_name: "上海星河装备有限公司",
      product_name: "定制化齿轮箱壳体",
      approved_by_name: "仓库管理员-吴勇",
      issued_by_name: "仓库管理员-吴勇",
      approval_note: "仓库复核后批准发料",
      issue_note: "按客户指定替代料与指定批次发料",
      issued_at: "2026-06-18T00:00:00.000Z",
      issueLines: [
        {
          original_material_code: "M-STEEL",
          original_material_name: "42CrMo 圆钢",
          material_code: "M-ALT-STEEL",
          material_name: "40Cr 替代圆钢",
          batch_no: "ALT-20260401",
          qty: 20,
          unit: "kg",
          unit_cost: 13.4,
          line_amount: 268,
          is_substitute: 1,
          issue_mode: "manual_batch",
          issue_note: "客户指定替代料和批次",
        },
      ],
    });

    expect(preview.header).toMatchObject({
      title: "原材料出库单",
      documentNo: "CK-20260618-001",
      documentDate: "2026-06-18",
    });
    expect(preview.fields.find((item) => item.label === "审批人")?.value).toBe("仓库管理员-吴勇");
    expect(preview.lines).toEqual([
      {
        lineNo: 1,
        bomMaterial: "M-STEEL / 42CrMo 圆钢",
        issuedMaterial: "M-ALT-STEEL / 40Cr 替代圆钢",
        batchNo: "ALT-20260401",
        qty: "20",
        unit: "kg",
        unitCost: "13.4",
        amount: "268",
        mode: "指定批次",
        remark: "客户指定替代料和批次",
      },
    ]);
    expect(preview.signatures.map((item) => item.label)).toEqual(["领料部门", "仓库发料", "仓库复核", "成本留存"]);
  });

  it("builds a formal finished goods receipt preview model", () => {
    const preview = buildFinishedGoodsReceiptPreview({
      receipt_no: "RK-20260618-001",
      received_at: "2026-06-18T00:00:00.000Z",
      prod_no: "SC-20260618-001",
      order_no: "DD-20260615-001",
      customer_name: "上海星河装备有限公司",
      product_name: "定制化齿轮箱壳体",
      inspection_no: "QY-20260618-001",
      result: "concession",
      finished_batch_no: "CP-20260618-001",
      transition_batch_no: "CP-20260618-001-GY",
      finished_qty: 18.5,
      transition_qty: 1.5,
      unit: "件",
      material_cost: 278.4,
      process_cost: 360,
      total_cost: 638.4,
      unit_cost: 34.51,
      yield_rate: 92.5,
      received_by_name: "仓库管理员-吴勇",
      inbound_note: "合格成品与过渡料同步入库",
    });

    expect(preview.header).toMatchObject({
      title: "成品入库单",
      documentNo: "RK-20260618-001",
      documentDate: "2026-06-18",
    });
    expect(preview.fields.find((item) => item.label === "收率")?.value).toBe("92.5%");
    expect(preview.lines).toEqual([
      {
        lineNo: 1,
        kind: "成品",
        batchNo: "CP-20260618-001",
        productName: "定制化齿轮箱壳体",
        qty: "18.5",
        unit: "件",
        unitCost: "34.51",
        remark: "合格/让步接收入库",
      },
      {
        lineNo: 2,
        kind: "过渡料",
        batchNo: "CP-20260618-001-GY",
        productName: "定制化齿轮箱壳体",
        qty: "1.5",
        unit: "件",
        unitCost: "5.18",
        remark: "生产损耗、边角料或过渡料",
      },
    ]);
    expect(preview.signatures.map((item) => item.label)).toEqual(["生产交付", "品控放行", "仓库入库", "成本复核"]);
  });

  it("builds a formal technical disposition print preview model", () => {
    const preview = buildTechnicalDispositionPrintPreview({
      disposition_no: "JS-20260618-001",
      created_at: "2026-06-18T15:20:00.000Z",
      inspection_no: "QY-20260618-001",
      prod_no: "SC-20260618-001",
      order_no: "DD-20260615-001",
      customer_name: "上海星河装备有限公司",
      product_name: "定制化齿轮箱壳体",
      order_qty: 20,
      unit: "件",
      result: "failed",
      measurements: "端面平面度超出技术标准，抽检 3 件均不合格。",
      disposition_type: "rework",
      disposition_type_label: "返工返修",
      root_cause: "夹具定位磨损导致加工基准偏移。",
      corrective_action: "更换定位块后返工，返工完成重新请验。",
      due_date: "2026-06-23",
      status_label: "已下发",
      created_by_name: "技术部-陈工",
      note: "技术部已确认返工风险可控。",
    });

    expect(preview.header).toMatchObject({
      title: "技术处置单",
      documentNo: "JS-20260618-001",
      documentDate: "2026-06-18",
      statusText: "已下发",
    });
    expect(preview.fieldSections.flatMap((section) => section.fields)).toEqual(
      expect.arrayContaining([
        { label: "不合格请验单", value: "QY-20260618-001" },
        { label: "处理方式", value: "返工返修" },
        { label: "技术人员", value: "技术部-陈工" },
      ]),
    );
    expect(preview.lineSections[0].rows).toEqual([
      {
        lineNo: 1,
        item: "不合格现象",
        content: "端面平面度超出技术标准，抽检 3 件均不合格。",
        owner: "品控",
        dueDate: "-",
      },
      {
        lineNo: 2,
        item: "原因分析",
        content: "夹具定位磨损导致加工基准偏移。",
        owner: "技术部-陈工",
        dueDate: "2026-06-23",
      },
      {
        lineNo: 3,
        item: "处理意见",
        content: "更换定位块后返工，返工完成重新请验。",
        owner: "生产/技术",
        dueDate: "2026-06-23",
      },
    ]);
    expect(preview.signatures.map((item) => item.label)).toEqual(["品控提交", "技术评审", "生产执行", "质量复核"]);
    expect(preview.footerLeft).toContain("技术归档联");
  });

  it("builds a formal purchase arrival discrepancy print preview model", () => {
    const preview = buildPurchaseArrivalDiscrepancyPrintPreview({
      discrepancy_no: "CY-20260718-001",
      created_at: "2026-07-18T10:30:00.000Z",
      arrival_no: "DH-20260718-001",
      purchase_no: "CG-20260710-001",
      contract_no: "HT-20260710-001",
      supplier_name: "苏州涂装化工有限公司",
      discrepancy_type_label: "混合差异",
      handling_decision_label: "供应商补货",
      quantity_variance_qty: -2.5,
      price_variance_amount: 19,
      total_adjustment_amount: -86,
      status_label: "差异已处理",
      created_by_name: "仓库管理员-吴勇",
      approved_by_name: "管理层-王总",
      resolved_by_name: "采购员-孙倩",
      reason: "实到数量少于合同数量，供应商批次号与通知单不一致。",
      proposed_action: "要求供应商补发短少数量。",
      resolution_note: "已通知供应商补发，当前到货按实收数量继续签收。",
      lines: [
        {
          materialCode: "M-STEEL",
          materialName: "42CrMo 圆钢",
          unit: "kg",
          orderedQty: 12,
          actualArrivedQty: 9.5,
          varianceQty: -2.5,
          orderedUnitCost: 42,
          actualUnitCost: 44,
          priceVarianceAmount: 19,
          expectedBatchHint: "CG-20260710-001-1",
          actualBatchHint: "REAL-BATCH-20260718",
          lineAdjustmentAmount: -86,
          note: "短少 2.5kg，批次以随货标签为准。",
        },
      ],
    });

    expect(preview.header).toMatchObject({
      title: "到货差异单",
      documentNo: "CY-20260718-001",
      documentDate: "2026-07-18",
      statusText: "差异已处理",
    });
    expect(preview.fieldSections.flatMap((section) => section.fields)).toEqual(
      expect.arrayContaining([
        { label: "到货通知", value: "DH-20260718-001" },
        { label: "处理方式", value: "供应商补货" },
        { label: "影响金额", value: "-86" },
      ]),
    );
    expect(preview.lineSections[0].rows[0]).toMatchObject({
      materialName: "42CrMo 圆钢",
      orderedQty: "12",
      actualArrivedQty: "9.5",
      varianceQty: "-2.5",
      actualUnitCost: "44",
      lineAdjustmentAmount: "-86",
    });
    expect(preview.signatures.map((item) => item.label)).toEqual(["仓库登记", "采购确认", "审批批准", "财务/质量知会"]);
    expect(preview.footerLeft).toContain("差异归档联");
  });
});
