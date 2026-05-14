import { describe, expect, it } from "vitest";
import { buildReportPreview } from "./report-preview";

const baseInput = {
  generatedBy: "系统管理员-管理员",
  generatedAt: "2026-05-13T09:20:00.000Z",
  filters: {
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
    customerName: "上海星河装备有限公司",
    supplierName: "苏州涂装化工有限公司",
    materialName: "旧版喷涂辅料",
    orderNo: "DD-20260410-001",
  },
  summary: {
    orderAmount: 12000,
    purchaseAmount: 960,
    inventoryValue: 48000,
    receivableBalance: 7000,
    payableBalance: 660,
    receivedAmount: 5000,
    overstockValue: 2332,
    averageYield: 97.5,
    qualityInspectionCount: 5,
    qualityFailedCount: 2,
    qualityReinspectionCount: 1,
    qualityClosedCount: 1,
    qualityClosureRate: 50,
    supplierAverageScore: 76.5,
    supplierRiskCount: 1,
  },
  rows: {
    receivables: [
      {
        receivable_no: "YS-20260410-001",
        customer_name: "上海星河装备有限公司",
        order_no: "DD-20260410-001",
        total_amount: 12000,
        received_amount: 5000,
        balance_amount: 7000,
        status: "partial",
        due_date: "2026-05-10",
      },
    ],
    payables: [
      {
        payable_no: "YF-20260420-001",
        supplier_name: "苏州涂装化工有限公司",
        purchase_no: "CG-20260420-001",
        total_amount: 960,
        paid_amount: 300,
        balance_amount: 660,
        status: "partial",
        due_date: "2026-05-05",
      },
    ],
    inventoryAging: [
      {
        name: "旧版喷涂辅料",
        stock_qty: 88,
        unit: "L",
        stock_value: 2332,
        inactive_days: 208,
        aging_status: "overstock",
        last_movement_at: "2025-10-18T09:00:00.000Z",
      },
    ],
    qualityExceptions: [
      {
        disposition_no: "JS-20260622-001",
        inspection_no: "QY-20260621-001",
        prod_no: "SC-20260618-001",
        product_name: "高强度定制件",
        customer_name: "上海星河装备有限公司",
        disposition_type_label: "返工返修",
        root_cause: "夹具定位磨损导致加工基准偏移。",
        corrective_action: "更换定位块后返工并重新 OQC。",
        status_label: "已关闭",
        due_date: "2026-06-23",
        closed_at: "2026-06-24T10:00:00.000Z",
        reinspection_count: 1,
      },
    ],
    qualityRootCauses: [
      {
        root_cause: "夹具定位磨损导致加工基准偏移。",
        count: 2,
        closed_count: 1,
        open_count: 1,
        closure_rate: 50,
      },
    ],
    qualityDispositionTypes: [
      {
        disposition_type_label: "返工返修",
        count: 2,
        closed_count: 1,
        closure_rate: 50,
      },
    ],
    supplierDiscrepancies: [
      {
        supplier_name: "苏州涂装化工有限公司",
        discrepancy_count: 3,
        resolved_count: 2,
        pending_count: 1,
        quantity_variance_qty: -8.5,
        price_variance_amount: 126,
        total_adjustment_amount: -420,
        resolution_rate: 66.67,
      },
    ],
    supplierDiscrepancyDetails: [
      {
        discrepancy_no: "CY-20260718-001",
        arrival_no: "DH-20260718-001",
        purchase_no: "CG-20260710-001",
        supplier_name: "苏州涂装化工有限公司",
        discrepancy_type_label: "混合差异",
        handling_decision_label: "供应商补货",
        status_label: "差异已处理",
        quantity_variance_qty: -2.5,
        price_variance_amount: 19,
        total_adjustment_amount: -86,
      },
    ],
    supplierPerformance: [
      {
        supplier_name: "苏州涂装化工有限公司",
        performance_score: 62.5,
        grade: "D",
        grade_label: "高风险供应商",
        risk_level_label: "高风险",
        purchase_order_count: 4,
        on_time_delivery_rate: 72,
        iqc_pass_rate: 65,
        discrepancy_rate: 50,
        overdue_payable_count: 2,
        total_adjustment_amount: -420,
        recommendation: "暂停新增采购，完成质量和交付整改后再恢复。",
      },
    ],
  },
};

describe("formal report print preview", () => {
  it("builds a business report preview with formal cover, filters, kpis and signatures", () => {
    const preview = buildReportPreview({ ...baseInput, type: "business-daily" });

    expect(preview.header).toMatchObject({
      title: "经营日报",
      statusText: "正式预览",
      documentDate: "2026-05-13",
      generatedBy: "系统管理员-管理员",
    });
    expect(preview.header.filterSummary).toContain("客户：上海星河装备有限公司");
    expect(preview.header.filterSummary).toContain("日期：2026-01-01 至 2026-12-31");
    expect(preview.kpis).toEqual(expect.arrayContaining([expect.objectContaining({ label: "应收余额", value: "¥7,000.00" })]));
    expect(preview.sections.some((section) => section.title === "经营风险与待跟进")).toBe(true);
    expect(preview.signatures.map((item) => item.label)).toEqual(["编制", "财务复核", "业务确认", "管理层"]);
  });

  it("builds a sales reconciliation preview with printable receivable rows", () => {
    const preview = buildReportPreview({ ...baseInput, type: "sales-statement" });
    const detail = preview.sections.find((section) => section.title === "销售对账明细");

    expect(preview.header.title).toBe("销售对账单");
    expect(detail?.columns.map((column) => column.label)).toContain("应收单号");
    expect(detail?.rows[0]).toMatchObject({
      receivableNo: "YS-20260410-001",
      customer: "上海星河装备有限公司",
      totalAmount: "¥12,000.00",
      balanceAmount: "¥7,000.00",
    });
  });

  it("builds an overstock preview with aging rules and inventory rows", () => {
    const preview = buildReportPreview({ ...baseInput, type: "inventory-overstock" });
    const detail = preview.sections.find((section) => section.title === "呆滞与积压库存明细");

    expect(preview.header.title).toBe("库存积压报表");
    expect(preview.notes.join("\n")).toContain("3 个月");
    expect(preview.notes.join("\n")).toContain("6 个月");
    expect(detail?.rows[0]).toMatchObject({
      materialName: "旧版喷涂辅料",
      stockQty: "88 L",
      stockValue: "¥2,332.00",
      inactiveDays: "208 天",
    });
  });

  it("builds a quality exception analysis preview with root cause and closure metrics", () => {
    const preview = buildReportPreview({ ...baseInput, type: "quality-exception" });
    const rootCause = preview.sections.find((section) => section.title === "不合格原因分布");
    const exceptions = preview.sections.find((section) => section.title === "质量异常明细");

    expect(preview.header.title).toBe("质量异常分析报表");
    expect(preview.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "不合格次数", value: "2" }),
        expect.objectContaining({ label: "复检关闭率", value: "50.00%" }),
      ]),
    );
    expect(rootCause?.rows[0]).toMatchObject({
      rootCause: "夹具定位磨损导致加工基准偏移。",
      count: "2",
      closedCount: "1",
      closureRate: "50.00%",
    });
    expect(exceptions?.rows[0]).toMatchObject({
      dispositionNo: "JS-20260622-001",
      inspectionNo: "QY-20260621-001",
      productName: "高强度定制件",
      dispositionType: "返工返修",
      rootCause: "夹具定位磨损导致加工基准偏移。",
      status: "已关闭",
      reinspectionCount: "1",
    });
    expect(preview.notes.join("\n")).toContain("原因分布");
    expect(preview.notes.join("\n")).toContain("复检关闭率");
  });

  it("builds a supplier discrepancy report preview with supplier ranking and detail rows", () => {
    const preview = buildReportPreview({ ...baseInput, type: "supplier-discrepancy" });
    const summary = preview.sections.find((section) => section.title === "供应商差异统计");
    const details = preview.sections.find((section) => section.title === "到货差异明细");

    expect(preview.header.title).toBe("供应商差异统计报表");
    expect(preview.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "差异单数", value: "3" }),
        expect.objectContaining({ label: "处理完成", value: "2" }),
        expect.objectContaining({ label: "差异金额", value: "¥-420.00" }),
      ]),
    );
    expect(summary?.rows[0]).toMatchObject({
      supplier: "苏州涂装化工有限公司",
      discrepancyCount: "3",
      resolvedCount: "2",
      resolutionRate: "66.67%",
      totalAdjustmentAmount: "¥-420.00",
    });
    expect(details?.rows[0]).toMatchObject({
      discrepancyNo: "CY-20260718-001",
      arrivalNo: "DH-20260718-001",
      discrepancyType: "混合差异",
      status: "差异已处理",
    });
    expect(preview.notes.join("\n")).toContain("供应商差异");
    expect(preview.notes.join("\n")).toContain("补货、退货、折让");
  });

  it("builds a supplier performance score preview with risk recommendations", () => {
    const preview = buildReportPreview({ ...baseInput, type: "supplier-performance" });
    const section = preview.sections.find((item) => item.title === "供应商绩效评分");

    expect(preview.header.title).toBe("供应商绩效评分报表");
    expect(preview.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "平均评分", value: "76.50" }),
        expect.objectContaining({ label: "高风险供应商", value: "1" }),
      ]),
    );
    expect(section?.rows[0]).toMatchObject({
      supplier: "苏州涂装化工有限公司",
      score: "62.50",
      grade: "高风险供应商",
      riskLevel: "高风险",
      recommendation: "暂停新增采购，完成质量和交付整改后再恢复。",
    });
    expect(preview.notes.join("\n")).toContain("到货准时率");
    expect(preview.notes.join("\n")).toContain("供应商绩效");
  });
});
