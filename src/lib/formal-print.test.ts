import { describe, expect, it } from "vitest";
import { buildDeliveryNotePreview } from "./delivery-note";
import { buildMaterialIssuePreview } from "./production-documents";
import {
  buildPurchaseArrivalNoticePrintPreview,
  buildPurchaseContractPrintPreview,
  buildPurchaseReceiptPrintPreview,
  buildProductionPlanPrintPreview,
  buildWarehouseSignoffPrintPreview,
  buildCustomerRefundPrintPreview,
  buildReplacementShipmentPrintPreview,
  buildSalesReturnPrintPreview,
  buildStocktakePrintPreview,
  formalPrintFromDeliveryNote,
  formalPrintFromDocument,
} from "./formal-print";

describe("unified formal print templates", () => {
  it("converts delivery notes into the same A4 business document model", () => {
    const delivery = buildDeliveryNotePreview({
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
    });

    const print = formalPrintFromDeliveryNote(delivery);
    expect(print.templateName).toBe("统一正式单据模板");
    expect(print.header.title).toBe("送货单");
    expect(print.fieldSections.map((section) => section.title)).toEqual(["客户与订单", "收货与物流"]);
    expect(print.lineSections[0].columns.map((column) => column.label)).toEqual([
      "序号",
      "产品名称",
      "规格型号",
      "批次号",
      "数量",
      "单位",
      "备注",
    ]);
    expect(print.signatures.map((item) => item.label)).toEqual(["制单", "仓库", "承运", "客户签收"]);
  });

  it("converts production documents into the unified print model", () => {
    const issue = buildMaterialIssuePreview({
      issue_no: "CK-20260618-001",
      req_no: "LL-20260618-001",
      prod_no: "SC-20260618-001",
      order_no: "DD-20260615-001",
      customer_name: "上海星河装备有限公司",
      product_name: "定制化齿轮箱壳体",
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
          issue_mode: "manual_batch",
        },
      ],
    });

    const print = formalPrintFromDocument(issue);
    expect(print.header.title).toBe("原材料出库单");
    expect(print.fieldSections[0].title).toBe("基本信息");
    expect(print.lineSections[0].title).toBe("业务明细");
    expect(print.lineSections[0].rows[0]).toMatchObject({
      bomMaterial: "M-STEEL / 42CrMo 圆钢",
      issuedMaterial: "M-ALT-STEEL / 40Cr 替代圆钢",
      mode: "指定批次",
    });
  });

  it("builds a formal production plan print preview with schedule and calendar sections", () => {
    const print = buildProductionPlanPrintPreview({
      plan_no: "SCJH-20260702-001",
      generated_at: "2026-07-02T08:00:00.000Z",
      generated_by_name: "生产主管-马工",
      filters_label: "计划日期：2026-07-02 至 2026-07-06；机台：CNC-02",
      rows: [
        {
          prod_no: "SC-20260702-001",
          order_no: "DD-20260701-001",
          customer_name: "上海星河装备有限公司",
          product_name: "定制化齿轮箱壳体",
          order_qty: 12,
          unit: "件",
          planned_date: "2026-07-03",
          due_date: "2026-07-06",
          machine: "CNC-02",
          shift: "白班",
          owner: "马工",
          status_label: "生产中",
          delivery_risk_label: "正常",
        },
      ],
      calendarRows: [
        {
          plan_key: "2026-07-03 / CNC-02",
          planned_date: "2026-07-03",
          machine: "CNC-02",
          order_count: 1,
          planned_qty: 12,
          owners: "马工",
          load_status_label: "空闲",
        },
      ],
      warningRows: [],
    });

    expect(print.header.title).toBe("生产计划表");
    expect(print.header.documentNo).toBe("SCJH-20260702-001");
    expect(print.fieldSections[0].fields.find((field) => field.label === "计划范围")?.value).toContain("CNC-02");
    expect(print.lineSections.map((section) => section.title)).toEqual(["生产计划明细", "排程日历汇总"]);
    expect(print.lineSections[0].columns.map((column) => column.label)).toEqual([
      "序号",
      "计划日期",
      "生产单号",
      "客户订单",
      "客户名称",
      "产品名称",
      "计划数量",
      "机台",
      "班次",
      "负责人",
      "交付期限",
      "状态",
      "交期风险",
    ]);
    expect(print.lineSections[0].rows[0]).toMatchObject({
      prodNo: "SC-20260702-001",
      machine: "CNC-02",
      deliveryRisk: "正常",
    });
    expect(print.signatures.map((item) => item.label)).toEqual(["生产主管", "仓库确认", "品控确认", "管理确认"]);
  });

  it("builds purchase receipt and stocktake previews with standard signatures", () => {
    const purchaseReceipt = buildPurchaseReceiptPrintPreview({
      purchase_no: "CG-20260513-001",
      supplier_name: "江苏华材金属有限公司",
      material_code: "M-STEEL",
      material_name: "42CrMo 圆钢",
      batch_no: "CG-20260513-STEEL",
      qty: 20,
      unit: "kg",
      unit_cost: 15.8,
      line_amount: 316,
      created_at: "2026-05-13T09:30:00.000Z",
    });
    expect(purchaseReceipt.header.title).toBe("采购入库单");
    expect(purchaseReceipt.lineSections[0].rows[0]).toMatchObject({
      materialCode: "M-STEEL",
      materialName: "42CrMo 圆钢",
      amount: "316",
    });
    expect(purchaseReceipt.signatures.map((item) => item.label)).toEqual(["采购经办", "仓库入库", "质量复核", "财务留存"]);

    const stocktake = buildStocktakePrintPreview({
      stocktake_no: "PD-20260513-001",
      material_code: "M-STEEL",
      material_name: "42CrMo 圆钢",
      book_qty: 100,
      actual_qty: 95,
      difference_qty: -5,
      unit: "kg",
      unit_cost: 13.4,
      adjustment_amount: -67,
      status_label: "已调整",
      counted_by_name: "仓库管理员-吴勇",
      approved_by_name: "管理层-王总",
      counted_at: "2026-05-13",
    });
    expect(stocktake.header.title).toBe("库存盘点单");
    expect(stocktake.fieldSections[0].fields.find((field) => field.label === "调整类型")?.value).toBe("盘点盘亏");
    expect(stocktake.signatures.map((item) => item.label)).toEqual(["盘点人", "仓库复核", "管理审批", "财务留存"]);
  });

  it("builds after-sales return refund and replacement formal templates", () => {
    const salesReturn = buildSalesReturnPrintPreview({
      return_no: "TH-20260625-001",
      shipment_no: "FH-20260616-001",
      order_no: "DD-20260615-001",
      customer_name: "上海星河装备有限公司",
      product_name: "定制化齿轮箱壳体",
      return_qty: 4,
      unit: "件",
      return_amount: 2400,
      cost_amount: 1500,
      offset_amount: 0,
      refund_due_amount: 2400,
      reason: "客户反馈包装破损，要求退货退款并补发。",
      disposition: "return_to_stock",
      refund_status_label: "待退款",
      replacement_status_label: "待补发",
      received_at: "2026-06-25T00:00:00.000Z",
    });
    expect(salesReturn.header.title).toBe("销售退货单");
    expect(salesReturn.lineSections[0].rows[0]).toMatchObject({
      productName: "定制化齿轮箱壳体",
      qty: "4",
      returnAmount: "2400",
      refundDue: "2400",
    });
    expect(salesReturn.signatures.map((item) => item.label)).toEqual(["商务登记", "仓库收货", "品控复核", "财务确认"]);

    const refund = buildCustomerRefundPrintPreview({
      refund_no: "TK-20260626-001",
      return_no: "TH-20260625-001",
      receivable_no: "YS-20260616-001",
      customer_name: "上海星河装备有限公司",
      amount: 2400,
      method: "银行转账",
      note: "退货退款已支付给客户。",
      refunded_by_name: "财务专员-赵会计",
      refunded_at: "2026-06-26",
      status: "paid",
    });
    expect(refund.header.title).toBe("客户退款单");
    expect(refund.fieldSections[0].fields.find((field) => field.label === "退款金额")?.value).toBe("2400");
    expect(refund.notes.join(" ")).toContain("不影响原发货单批次追溯");

    const replacement = buildReplacementShipmentPrintPreview({
      shipment_no: "FH-20260627-002",
      return_no: "TH-20260625-001",
      original_shipment_no: "FH-20260616-001",
      order_no: "DD-20260615-001",
      customer_name: "上海星河装备有限公司",
      product_name: "定制化齿轮箱壳体",
      batch_no: "CP-20260615-001",
      shipped_qty: 4,
      unit: "件",
      logistics_company: "顺丰专线",
      tracking_no: "SF-AFTERSALE-REPLACE",
      shipped_at: "2026-06-27",
    });
    expect(replacement.header.title).toBe("补开发货单");
    expect(replacement.header.statusText).toBe("售后补发");
    expect(replacement.lineSections[0].rows[0]).toMatchObject({
      productName: "定制化齿轮箱壳体",
      qty: "4",
      amount: "0",
      remark: "售后补发，不重复生成应收",
    });
  });

  it("builds formal purchase contract arrival notice and warehouse signoff templates", () => {
    const source = {
      contract_no: "HT-20260701-001",
      purchase_no: "CG-20260701-001",
      arrival_no: "DH-20260708-001",
      supplier_name: "江苏华材金属有限公司",
      supplier_order_no: "SUP-20260701-88",
      contract_date: "2026-07-01",
      delivery_date: "2026-07-08",
      arrived_at: "2026-07-08",
      payment_terms: "月结30天",
      total_amount: 9600,
      status_label: "仓库已签收",
      created_by_name: "采购员-钱采购",
      warehouse_received_by_name: "仓库管理员-吴勇",
      warehouse_received_at: "2026-07-08T10:00:00.000Z",
      warehouse_note: "到货外箱完好，数量与通知单一致。",
      lines: [
        {
          materialCode: "M-STEEL",
          materialName: "42CrMo 圆钢",
          orderedQty: 600,
          arrivedQty: 600,
          unit: "kg",
          unitCost: 16,
          lineAmount: 9600,
          batchHint: "SUP-BATCH-001",
        },
      ],
    };

    const contract = buildPurchaseContractPrintPreview(source);
    expect(contract.header.title).toBe("采购合同");
    expect(contract.header.statusText).toBe("供应商下单");
    expect(contract.lineSections[0].rows[0]).toMatchObject({
      materialCode: "M-STEEL",
      materialName: "42CrMo 圆钢",
      qty: "600",
      amount: "9600",
    });
    expect(contract.signatures.map((item) => item.label)).toEqual(["采购经办", "供应商确认", "审批确认", "财务留存"]);

    const arrival = buildPurchaseArrivalNoticePrintPreview(source);
    expect(arrival.header.title).toBe("到货通知单");
    expect(arrival.fieldSections[0].fields.find((field) => field.label === "到货通知")?.value).toBe("DH-20260708-001");
    expect(arrival.signatures.map((item) => item.label)).toEqual(["采购通知", "供应商送货", "仓库待签", "IQC待检"]);

    const signoff = buildWarehouseSignoffPrintPreview(source);
    expect(signoff.header.title).toBe("仓库签收单");
    expect(signoff.fieldSections[1].fields.find((field) => field.label === "签收人")?.value).toBe("仓库管理员-吴勇");
    expect(signoff.signatures.map((item) => item.label)).toEqual(["供应商交接", "仓库签收", "数量复核", "质量交接"]);
  });
});
