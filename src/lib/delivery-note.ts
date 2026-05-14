type DeliveryNoteSource = Record<string, unknown>;

export type DeliveryNotePreview = {
  header: {
    companyName: string;
    title: string;
    documentNo: string;
    documentDate: string;
    statusText: string;
  };
  parties: {
    customerName: string;
    orderNo: string;
    customerPoNo: string;
    salesContractNo: string;
  };
  logistics: {
    deliveryAddress: string;
    consignee: string;
    phone: string;
    logisticsCompany: string;
    vehicleNo: string;
    trackingNo: string;
  };
  lines: Array<{
    lineNo: number;
    productName: string;
    spec: string;
    batchNo: string;
    qty: string;
    unit: string;
    remark: string;
  }>;
  notes: string[];
  signatures: Array<{ label: string; hint: string }>;
};

function text(value: unknown, fallback = "-") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function dateText(value: unknown) {
  const result = text(value, "");
  return result ? result.slice(0, 10) : "-";
}

function qtyText(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
}

export function buildDeliveryNotePreview(source: DeliveryNoteSource): DeliveryNotePreview {
  const remark = text(source.remark, "");
  return {
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "送货单",
      documentNo: text(source.shipment_no),
      documentDate: dateText(source.shipped_at),
      statusText: "正式单据",
    },
    parties: {
      customerName: text(source.customer_name),
      orderNo: text(source.order_no),
      customerPoNo: text(source.customer_po_no),
      salesContractNo: text(source.sales_contract_no),
    },
    logistics: {
      deliveryAddress: text(source.delivery_address),
      consignee: text(source.consignee),
      phone: text(source.contact_phone),
      logisticsCompany: text(source.logistics_company),
      vehicleNo: text(source.vehicle_no),
      trackingNo: text(source.tracking_no),
    },
    lines: [
      {
        lineNo: 1,
        productName: text(source.product_name),
        spec: text(source.spec),
        batchNo: text(source.batch_no),
        qty: qtyText(source.shipped_qty),
        unit: text(source.unit),
        remark: remark || "随货附检验记录，批次可追溯",
      },
    ],
    notes: [
      "收货方签收后代表确认本单所列货物数量、包装及批次信息。",
      "如发现数量或外观异常，请在签收当日反馈并保留现场记录。",
      "本单由系统根据发货单自动生成，作为送货、签收、对账依据。",
    ],
    signatures: [
      { label: "制单", hint: "商务内勤" },
      { label: "仓库", hint: "发货复核" },
      { label: "承运", hint: "司机/物流" },
      { label: "客户签收", hint: "收货确认" },
    ],
  };
}
