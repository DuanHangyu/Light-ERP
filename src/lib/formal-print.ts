import type { DeliveryNotePreview } from "./delivery-note";
import type { FormalDocumentPreview } from "./production-documents";

type Source = Record<string, unknown>;

export type FormalPrintDocument = {
  templateName: "统一正式单据模板";
  header: {
    companyName: string;
    title: string;
    documentNo: string;
    documentDate: string;
    statusText: string;
  };
  eyebrow: string;
  description: string;
  fieldSections: Array<{
    title: string;
    fields: Array<{ label: string; value: string }>;
  }>;
  lineSections: Array<{
    title: string;
    columns: Array<{ key: string; label: string; align?: "left" | "right" | "center" }>;
    rows: Array<Record<string, string | number>>;
    minRows?: number;
  }>;
  notesTitle: string;
  notes: string[];
  signatures: Array<{ label: string; hint: string }>;
  footerLeft: string;
  footerRight: string;
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

function moneyText(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function baseDocument(input: {
  header: FormalPrintDocument["header"];
  eyebrow?: string;
  description?: string;
  fieldSections: FormalPrintDocument["fieldSections"];
  lineSections: FormalPrintDocument["lineSections"];
  notesTitle?: string;
  notes: string[];
  signatures: FormalPrintDocument["signatures"];
  footerLeft?: string;
  footerRight?: string;
}): FormalPrintDocument {
  return {
    templateName: "统一正式单据模板",
    header: input.header,
    eyebrow: input.eyebrow ?? "LOCAL ERP BUSINESS DOCUMENT",
    description: input.description ?? "系统自动生成正式业务单据，适用于审批、执行、对账、追溯和本地归档",
    fieldSections: input.fieldSections,
    lineSections: input.lineSections,
    notesTitle: input.notesTitle ?? "执行说明",
    notes: input.notes,
    signatures: input.signatures,
    footerLeft: input.footerLeft ?? "第一联：业务执行联 / 第二联：公司存根联",
    footerRight: input.footerRight ?? `系统留痕编号：${input.header.documentNo}`,
  };
}

const genericLineLabels: Record<string, string> = {
  lineNo: "序号",
  materialCode: "物料编码",
  materialName: "物料名称",
  requiredQty: "需求量",
  unit: "单位",
  usage: "用途",
  remark: "备注",
  bomMaterial: "BOM物料",
  issuedMaterial: "实际出库物料",
  batchNo: "批次号",
  qty: "数量",
  unitCost: "单位成本",
  amount: "金额",
  mode: "发料模式",
  kind: "类型",
  productName: "产品名称",
};

function columnsFromRows(rows: Array<Record<string, string | number>>) {
  const keys = rows.length > 0 ? Object.keys(rows[0]) : ["lineNo", "remark"];
  return keys.map((key) => ({
    key,
    label: genericLineLabels[key] ?? key,
    align: ["qty", "unitCost", "amount", "requiredQty"].includes(key) ? ("right" as const) : undefined,
  }));
}

export function formalPrintFromDocument(preview: FormalDocumentPreview): FormalPrintDocument {
  return baseDocument({
    header: preview.header,
    fieldSections: [{ title: "基本信息", fields: preview.fields }],
    lineSections:
      preview.lines.length > 0
        ? [
            {
              title: "业务明细",
              columns: columnsFromRows(preview.lines),
              rows: preview.lines,
              minRows: 4,
            },
          ]
        : [],
    notesTitle: "执行说明",
    notes: preview.notes,
    signatures: preview.signatures,
  });
}

export function buildProductionPlanPrintPreview(source: Source): FormalPrintDocument {
  const planRows = (Array.isArray(source.rows) ? (source.rows as Source[]) : []).map((row, index) => ({
    lineNo: index + 1,
    plannedDate: dateText(row.planned_date),
    prodNo: text(row.prod_no),
    orderNo: text(row.order_no),
    customerName: text(row.customer_name),
    productName: text(row.product_name),
    qty: `${qtyText(row.order_qty ?? row.qty)}${text(row.unit, "") ? ` ${text(row.unit, "")}` : ""}`,
    machine: text(row.machine),
    shift: text(row.shift, ""),
    owner: text(row.owner),
    dueDate: dateText(row.due_date),
    status: text(row.status_label ?? row.status),
    deliveryRisk: text(row.delivery_risk_label ?? row.warning_type_label ?? "正常"),
  }));
  const calendarRows = (Array.isArray(source.calendarRows) ? (source.calendarRows as Source[]) : []).map((row, index) => ({
    lineNo: index + 1,
    plannedDate: dateText(row.planned_date),
    machine: text(row.machine),
    taskCount: qtyText(row.order_count),
    plannedQty: qtyText(row.planned_qty),
    owners: text(row.owners),
    loadStatus: text(row.load_status_label ?? row.load_status),
    summary: text(row.production_summary ?? row.plan_key),
  }));
  const warningRows = Array.isArray(source.warningRows) ? (source.warningRows as Source[]) : [];
  const warningCount = warningRows.length;
  const machineCount = new Set(planRows.map((row) => row.machine).filter((value) => value && value !== "-")).size;

  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP"),
      title: "生产计划表",
      documentNo: text(source.plan_no, `SCJH-${dateText(source.generated_at ?? new Date().toISOString()).replaceAll("-", "")}`),
      documentDate: dateText(source.generated_at ?? new Date().toISOString()),
      statusText: "正式排程",
    },
    eyebrow: "LOCAL ERP PRODUCTION SCHEDULE",
    description: "系统根据生产指令、排产记录、机台负荷和交期预警生成，适用于生产执行、仓库备料、品控准备与管理确认",
    fieldSections: [
      {
        title: "计划范围",
        fields: [
          { label: "计划范围", value: text(source.filters_label, "全部生产计划") },
          { label: "计划单数", value: `${planRows.length} 单` },
          { label: "涉及机台", value: `${machineCount} 台` },
          { label: "交期预警", value: `${warningCount} 条` },
        ],
      },
      {
        title: "编制信息",
        fields: [
          { label: "编制时间", value: dateText(source.generated_at ?? new Date().toISOString()) },
          { label: "编制人", value: text(source.generated_by_name ?? source.created_by_name, "系统自动生成") },
          { label: "打印状态", value: "正式版式 / 可归档" },
          { label: "数据来源", value: "生产指令、排产记录、领料状态、订单交期" },
        ],
      },
    ],
    lineSections: [
      {
        title: "生产计划明细",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "plannedDate", label: "计划日期" },
          { key: "prodNo", label: "生产单号" },
          { key: "orderNo", label: "客户订单" },
          { key: "customerName", label: "客户名称" },
          { key: "productName", label: "产品名称" },
          { key: "qty", label: "计划数量", align: "right" },
          { key: "machine", label: "机台" },
          { key: "shift", label: "班次" },
          { key: "owner", label: "负责人" },
          { key: "dueDate", label: "交付期限" },
          { key: "status", label: "状态" },
          { key: "deliveryRisk", label: "交期风险" },
        ],
        rows: planRows,
        minRows: 6,
      },
      {
        title: "排程日历汇总",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "plannedDate", label: "计划日期" },
          { key: "machine", label: "机台" },
          { key: "taskCount", label: "任务数", align: "right" },
          { key: "plannedQty", label: "计划量", align: "right" },
          { key: "owners", label: "负责人" },
          { key: "loadStatus", label: "负荷状态" },
          { key: "summary", label: "排程摘要" },
        ],
        rows: calendarRows,
        minRows: 4,
      },
    ],
    notesTitle: "排产执行要求",
    notes: [
      "生产计划以系统最新排产记录为准；如需调整日期、机台、班次或负责人，必须通过排产变更留痕。",
      "仓库按本计划提前核对领料单和库存批次；品控按计划安排请验资源。",
      "存在交期预警的生产单应优先复核产能、物料和质量风险，并在系统内更新处理结果。",
    ],
    signatures: [
      { label: "生产主管", hint: "确认排程" },
      { label: "仓库确认", hint: "备料确认" },
      { label: "品控确认", hint: "检验准备" },
      { label: "管理确认", hint: "计划批准" },
    ],
    footerLeft: "第一联：生产执行联 / 第二联：仓库备料联 / 第三联：管理归档联",
  });
}

export function formalPrintFromDeliveryNote(preview: DeliveryNotePreview): FormalPrintDocument {
  return baseDocument({
    header: preview.header,
    eyebrow: "LOCAL ERP DELIVERY DOCUMENT",
    description: "系统根据发货单自动生成，适用于送货、签收、对账和内部归档",
    fieldSections: [
      {
        title: "客户与订单",
        fields: [
          { label: "客户名称", value: preview.parties.customerName },
          { label: "销售订单", value: preview.parties.orderNo },
          { label: "客户单号", value: preview.parties.customerPoNo },
          { label: "销售合同", value: preview.parties.salesContractNo },
        ],
      },
      {
        title: "收货与物流",
        fields: [
          { label: "收货人", value: preview.logistics.consignee },
          { label: "联系电话", value: preview.logistics.phone },
          { label: "物流公司", value: preview.logistics.logisticsCompany },
          { label: "车牌号", value: preview.logistics.vehicleNo },
          { label: "物流单号", value: preview.logistics.trackingNo },
          { label: "送货地址", value: preview.logistics.deliveryAddress },
        ],
      },
    ],
    lineSections: [
      {
        title: "货品明细",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "productName", label: "产品名称" },
          { key: "spec", label: "规格型号" },
          { key: "batchNo", label: "批次号" },
          { key: "qty", label: "数量", align: "right" },
          { key: "unit", label: "单位" },
          { key: "remark", label: "备注" },
        ],
        rows: preview.lines,
        minRows: 4,
      },
    ],
    notesTitle: "签收说明",
    notes: preview.notes,
    signatures: preview.signatures,
    footerLeft: "第一联：客户签收联 / 第二联：公司存根联",
  });
}

function purchaseDocumentLines(source: Source, qtyMode: "ordered" | "arrived" = "ordered") {
  const rawLines = Array.isArray(source.lines) ? (source.lines as Source[]) : [];
  const lines =
    rawLines.length > 0
      ? rawLines
      : [
          {
            materialCode: source.material_code,
            materialName: source.material_name ?? source.material,
            spec: source.spec,
            orderedQty: source.qty,
            arrivedQty: source.qty,
            unit: source.unit,
            unitCost: source.unit_cost,
            lineAmount: source.line_amount,
            batchHint: source.batch_no,
            note: source.note,
          },
        ];

  return lines.map((line, index) => {
    const qty = qtyMode === "arrived" ? line.arrivedQty ?? line.arrived_qty ?? line.qty : line.orderedQty ?? line.ordered_qty ?? line.qty;
    const unitCost = line.unitCost ?? line.unit_cost;
    const amount = line.lineAmount ?? line.line_amount ?? Number(qty ?? 0) * Number(unitCost ?? 0);
    return {
      lineNo: index + 1,
      materialCode: text(line.materialCode ?? line.material_code),
      materialName: text(line.materialName ?? line.material_name ?? line.material),
      spec: text(line.spec, ""),
      qty: qtyText(qty),
      unit: text(line.unit, ""),
      unitCost: moneyText(unitCost),
      amount: moneyText(amount),
      batchHint: text(line.batchHint ?? line.batch_hint, ""),
      remark: text(line.note ?? line.remark, ""),
    };
  });
}

const purchaseColumns = [
  { key: "lineNo", label: "序号" },
  { key: "materialCode", label: "物料编码" },
  { key: "materialName", label: "物料名称" },
  { key: "spec", label: "规格型号" },
  { key: "qty", label: "数量", align: "right" as const },
  { key: "unit", label: "单位" },
  { key: "unitCost", label: "单价", align: "right" as const },
  { key: "amount", label: "金额", align: "right" as const },
  { key: "batchHint", label: "批次/标识" },
  { key: "remark", label: "备注" },
];

export function buildPurchaseContractPrintPreview(source: Source): FormalPrintDocument {
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP"),
      title: "采购合同",
      documentNo: text(source.contract_no),
      documentDate: dateText(source.contract_date ?? source.created_at),
      statusText: "供应商下单",
    },
    eyebrow: "LOCAL ERP PROCUREMENT CONTRACT",
    description: "系统根据已审批采购订单生成，作为供应商下单、到货跟踪、应付对账和合同附件归档的业务依据",
    fieldSections: [
      {
        title: "合同与订单",
        fields: [
          { label: "采购合同", value: text(source.contract_no) },
          { label: "采购订单", value: text(source.purchase_no) },
          { label: "供应商单号", value: text(source.supplier_order_no, "") },
          { label: "合同日期", value: dateText(source.contract_date ?? source.created_at) },
          { label: "约定到货", value: dateText(source.delivery_date) },
          { label: "合同金额", value: moneyText(source.total_amount) },
        ],
      },
      {
        title: "供应商与条款",
        fields: [
          { label: "供应商", value: text(source.supplier_name ?? source.supplier) },
          { label: "付款条款", value: text(source.payment_terms, "按双方确认条款执行") },
          { label: "制单人", value: text(source.created_by_name, "") },
          { label: "供应商确认", value: dateText(source.supplier_confirmed_at ?? source.contract_date) },
        ],
      },
    ],
    lineSections: [
      {
        title: "采购明细",
        columns: purchaseColumns,
        rows: purchaseDocumentLines(source, "ordered"),
        minRows: 4,
      },
    ],
    notesTitle: "合同说明",
    notes: [
      "本单由系统根据已审批采购订单生成，正式法律合同以双方盖章扫描件或纸质原件为准。",
      "供应商回传的盖章合同、报价确认、补充协议等文件应上传至合同附件归档。",
      "后续到货通知、仓库签收、IQC来料检验、采购入库和应付账款均沿用本合同链路追溯。",
    ],
    signatures: [
      { label: "采购经办", hint: "价格/数量" },
      { label: "供应商确认", hint: "交期/条款" },
      { label: "审批确认", hint: "授权/预算" },
      { label: "财务留存", hint: "付款依据" },
    ],
    footerLeft: "第一联：采购执行联 / 第二联：供应商确认联 / 第三联：财务留存联",
  });
}

export function buildPurchaseArrivalNoticePrintPreview(source: Source): FormalPrintDocument {
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP"),
      title: "到货通知单",
      documentNo: text(source.arrival_no),
      documentDate: dateText(source.arrived_at ?? source.created_at),
      statusText: text(source.status_label, "待仓库签收"),
    },
    eyebrow: "LOCAL ERP ARRIVAL NOTICE",
    description: "供应商到货后由采购或仓库生成，作为仓库签收、IQC请检和后续采购入库的前置单据",
    fieldSections: [
      {
        title: "到货与采购",
        fields: [
          { label: "到货通知", value: text(source.arrival_no) },
          { label: "采购合同", value: text(source.contract_no, "") },
          { label: "采购订单", value: text(source.purchase_no) },
          { label: "供应商单号", value: text(source.supplier_order_no, "") },
          { label: "到货日期", value: dateText(source.arrived_at ?? source.created_at) },
          { label: "到货金额", value: moneyText(source.total_amount) },
        ],
      },
      {
        title: "供应商与状态",
        fields: [
          { label: "供应商", value: text(source.supplier_name ?? source.supplier) },
          { label: "制单人", value: text(source.created_by_name, "") },
          { label: "当前状态", value: text(source.status_label, "") },
          { label: "IQC单号", value: text(source.iqc_no, "") },
        ],
      },
    ],
    lineSections: [
      {
        title: "到货明细",
        columns: purchaseColumns,
        rows: purchaseDocumentLines(source, "arrived"),
        minRows: 4,
      },
    ],
    notesTitle: "到货说明",
    notes: [
      "仓库签收前应核对供应商、采购合同、物料编码、到货数量、外包装状态和随货资料。",
      "仓库签收后系统允许提交IQC来料检验，未签收的到货通知不得直接入库。",
      text(source.note, "如有数量、包装或批次差异，应在签收说明中登记并通知采购确认。"),
    ],
    signatures: [
      { label: "采购通知", hint: "到货信息" },
      { label: "供应商送货", hint: "随货资料" },
      { label: "仓库待签", hint: "数量/包装" },
      { label: "IQC待检", hint: "质量接收" },
    ],
    footerLeft: "第一联：仓库签收联 / 第二联：IQC请检联 / 第三联：采购归档联",
  });
}

export function buildPurchaseArrivalChangeLogPrintPreview(source: Source): FormalPrintDocument {
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP"),
      title: "到货通知变更留痕单",
      documentNo: text(source.change_no),
      documentDate: dateText(source.changed_at ?? source.created_at),
      statusText: text(source.document_status ?? source.status_label, "已留痕"),
    },
    eyebrow: "LOCAL ERP ARRIVAL CHANGE LOG",
    description: "采购到货通知发生计划调整时自动生成，记录变更前后信息、关联生产计划影响和责任人，用于仓库签收、供应商沟通及审计追溯",
    fieldSections: [
      {
        title: "来源单据",
        fields: [
          { label: "变更留痕单", value: text(source.change_no) },
          { label: "到货通知", value: text(source.arrival_no) },
          { label: "采购订单", value: text(source.purchase_no) },
          { label: "采购合同", value: text(source.contract_no, "") },
          { label: "供应商", value: text(source.supplier_name ?? source.supplier) },
          { label: "影响单号", value: text(source.impact_no, "") },
        ],
      },
      {
        title: "变更信息",
        fields: [
          { label: "变更类型", value: text(source.change_type_label ?? source.change_type, "生产计划影响调整") },
          { label: "原到货日期", value: dateText(source.old_arrived_at) },
          { label: "新到货日期", value: dateText(source.new_arrived_at) },
          { label: "变更人", value: text(source.changed_by_name ?? source.changed_by, "") },
          { label: "变更时间", value: dateText(source.changed_at) },
          { label: "变更原因", value: text(source.reason, "") },
        ],
      },
    ],
    lineSections: [
      {
        title: "变更对照",
        columns: [
          { key: "field", label: "字段" },
          { key: "before", label: "变更前" },
          { key: "after", label: "变更后" },
        ],
        rows: [
          { field: "到货日期", before: dateText(source.old_arrived_at), after: dateText(source.new_arrived_at) },
          { field: "到货说明", before: text(source.old_note, ""), after: text(source.new_note, "") },
        ],
        minRows: 4,
      },
    ],
    notesTitle: "留痕说明",
    notes: [
      "本单由系统在处理生产计划变更影响并调整采购到货通知时自动生成。",
      "任何到货通知日期、说明或执行节奏变更均应保留变更前后信息、变更原因和责任人。",
      "仓库签收、IQC请检、采购对账和供应商交期沟通应以最新到货通知为准，同时保留本留痕单用于追溯。",
    ],
    signatures: [
      { label: "采购确认", hint: "到货日期" },
      { label: "生产知会", hint: "计划影响" },
      { label: "仓库知会", hint: "签收节奏" },
      { label: "管理复核", hint: "变更追溯" },
    ],
    footerLeft: "第一联：采购执行联 / 第二联：仓库知会联 / 第三联：生产追溯联",
  });
}

function discrepancyDocumentLines(source: Source) {
  const rawLines = Array.isArray(source.lines) ? (source.lines as Source[]) : [];
  const lines =
    rawLines.length > 0
      ? rawLines
      : [
          {
            materialCode: source.material_code,
            materialName: source.material_name ?? source.material,
            unit: source.unit,
            orderedQty: source.ordered_qty,
            actualArrivedQty: source.actual_arrived_qty,
            varianceQty: source.variance_qty,
            orderedUnitCost: source.ordered_unit_cost,
            actualUnitCost: source.actual_unit_cost,
            priceVarianceAmount: source.price_variance_amount,
            expectedBatchHint: source.expected_batch_hint,
            actualBatchHint: source.actual_batch_hint,
            lineAdjustmentAmount: source.line_adjustment_amount,
            note: source.note,
          },
        ];

  return lines.map((line, index) => ({
    lineNo: index + 1,
    materialCode: text(line.materialCode ?? line.material_code),
    materialName: text(line.materialName ?? line.material_name ?? line.material),
    orderedQty: qtyText(line.orderedQty ?? line.ordered_qty),
    actualArrivedQty: qtyText(line.actualArrivedQty ?? line.actual_arrived_qty),
    varianceQty: qtyText(line.varianceQty ?? line.variance_qty),
    unit: text(line.unit, ""),
    orderedUnitCost: moneyText(line.orderedUnitCost ?? line.ordered_unit_cost),
    actualUnitCost: moneyText(line.actualUnitCost ?? line.actual_unit_cost),
    priceVarianceAmount: moneyText(line.priceVarianceAmount ?? line.price_variance_amount),
    expectedBatchHint: text(line.expectedBatchHint ?? line.expected_batch_hint, ""),
    actualBatchHint: text(line.actualBatchHint ?? line.actual_batch_hint, ""),
    lineAdjustmentAmount: moneyText(line.lineAdjustmentAmount ?? line.line_adjustment_amount),
    remark: text(line.note ?? line.remark, ""),
  }));
}

export function buildMaterialAdjustmentOrderPrintPreview(source: Source): FormalPrintDocument {
  const adjustmentType = text(source.adjustment_type_label ?? source.adjustment_type, "补退料");
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP"),
      title: "正式补退料单",
      documentNo: text(source.order_no),
      documentDate: dateText(source.created_at),
      statusText: text(source.status_label ?? source.document_status, "待执行"),
    },
    eyebrow: "LOCAL ERP MATERIAL ADJUSTMENT ORDER",
    description: "生产确认补退料建议后生成，作为仓库补发、退料、复核和生产计划变更追溯的正式执行单据",
    fieldSections: [
      {
        title: "生产与来源",
        fields: [
          { label: "正式单号", value: text(source.order_no) },
          { label: "建议单号", value: text(source.suggestion_no) },
          { label: "影响单号", value: text(source.impact_no) },
          { label: "生产单", value: text(source.prod_no) },
          { label: "领料单", value: text(source.req_no, "") },
          { label: "客户订单", value: text(source.order_no === source.customer_order_no ? "" : source.customer_order_no, "") },
        ],
      },
      {
        title: "执行要求",
        fields: [
          { label: "调整类型", value: adjustmentType },
          { label: "调整数量", value: qtyText(source.qty) },
          { label: "产品", value: text(source.product_name ?? source.product, "") },
          { label: "客户", value: text(source.customer_name ?? source.customer, "") },
          { label: "制单人", value: text(source.created_by_name ?? source.created_by, "") },
          { label: "制单时间", value: dateText(source.created_at) },
        ],
      },
    ],
    lineSections: [
      {
        title: "补退料执行明细",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "type", label: "类型" },
          { key: "qty", label: "数量", align: "right" },
          { key: "summary", label: "物料摘要" },
          { key: "reason", label: "来源原因" },
        ],
        rows: [
          {
            lineNo: 1,
            type: adjustmentType,
            qty: qtyText(source.qty),
            summary: text(source.material_summary, ""),
            reason: text(source.reason ?? source.suggestion_reason, ""),
          },
        ],
        minRows: 4,
      },
    ],
    notesTitle: "执行说明",
    notes: [
      text(source.confirmation_note, "本单已由生产确认补退料建议后转正式单。"),
      "仓库执行补料或退料时，应核对生产单、领料单、物料摘要和实际数量，并形成库存流水。",
      "本单与生产计划变更影响单、补退料建议单、领料单共同构成完整追溯链。",
    ],
    signatures: [
      { label: "生产确认", hint: "需求/数量" },
      { label: "仓库执行", hint: "补料/退料" },
      { label: "品控/技术知会", hint: "必要时" },
      { label: "主管复核", hint: "异常闭环" },
    ],
    footerLeft: "第一联：仓库执行联 / 第二联：生产留存联 / 第三联：异常追溯联",
  });
}

export function buildPurchaseArrivalDiscrepancyPrintPreview(source: Source): FormalPrintDocument {
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP"),
      title: "到货差异单",
      documentNo: text(source.discrepancy_no),
      documentDate: dateText(source.created_at),
      statusText: text(source.status_label, "差异登记"),
    },
    eyebrow: "LOCAL ERP ARRIVAL DISCREPANCY",
    description: "仓库或采购发现到货数量、价格、批次与合同/通知不一致时生成，作为冻结签收、审批处置、供应商沟通和后续归档的正式凭证",
    fieldSections: [
      {
        title: "来源与供应商",
        fields: [
          { label: "到货差异单", value: text(source.discrepancy_no) },
          { label: "到货通知", value: text(source.arrival_no) },
          { label: "采购订单", value: text(source.purchase_no) },
          { label: "采购合同", value: text(source.contract_no, "") },
          { label: "供应商", value: text(source.supplier_name ?? source.supplier) },
          { label: "登记时间", value: dateText(source.created_at) },
        ],
      },
      {
        title: "差异与处置",
        fields: [
          { label: "差异类型", value: text(source.discrepancy_type_label ?? source.discrepancy_type) },
          { label: "处理方式", value: text(source.handling_decision_label ?? source.handling_decision) },
          { label: "数量差异", value: qtyText(source.quantity_variance_qty) },
          { label: "价格差异", value: moneyText(source.price_variance_amount) },
          { label: "影响金额", value: moneyText(source.total_adjustment_amount) },
          { label: "当前状态", value: text(source.status_label ?? source.status) },
        ],
      },
      {
        title: "责任留痕",
        fields: [
          { label: "登记人", value: text(source.created_by_name, "") },
          { label: "审批人", value: text(source.approved_by_name, "") },
          { label: "处理人", value: text(source.resolved_by_name, "") },
          { label: "审批单", value: text(source.approval_no, "") },
        ],
      },
    ],
    lineSections: [
      {
        title: "差异明细",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "materialCode", label: "物料编码" },
          { key: "materialName", label: "物料名称" },
          { key: "orderedQty", label: "通知数量", align: "right" },
          { key: "actualArrivedQty", label: "实到数量", align: "right" },
          { key: "varianceQty", label: "数量差异", align: "right" },
          { key: "unit", label: "单位" },
          { key: "orderedUnitCost", label: "通知单价", align: "right" },
          { key: "actualUnitCost", label: "实际单价", align: "right" },
          { key: "priceVarianceAmount", label: "价格差异", align: "right" },
          { key: "expectedBatchHint", label: "通知批次" },
          { key: "actualBatchHint", label: "实际批次" },
          { key: "lineAdjustmentAmount", label: "影响金额", align: "right" },
          { key: "remark", label: "说明" },
        ],
        rows: discrepancyDocumentLines(source),
        minRows: 4,
      },
    ],
    notesTitle: "差异处理说明",
    notes: [
      text(source.reason, "到货差异由仓库/采购登记后冻结签收，需完成审批与处置后才能继续仓库签收。"),
      text(source.proposed_action, "采购应与供应商确认补货、退货、折让、特采或按实接收方案。"),
      text(source.resolution_note, "差异处理完成后，系统按最终实到数量、实际单价和实际批次继续后续签收、IQC和入库。"),
    ],
    signatures: [
      { label: "仓库登记", hint: "数量/批次" },
      { label: "采购确认", hint: "供应商沟通" },
      { label: "审批批准", hint: "处理授权" },
      { label: "财务/质量知会", hint: "价格/IQC" },
    ],
    footerLeft: "第一联：仓库执行联 / 第二联：采购跟踪联 / 第三联：质量交接联 / 第四联：差异归档联",
  });
}

export function buildWarehouseSignoffPrintPreview(source: Source): FormalPrintDocument {
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP"),
      title: "仓库签收单",
      documentNo: text(source.arrival_no),
      documentDate: dateText(source.warehouse_received_at ?? source.arrived_at),
      statusText: "已签收",
    },
    eyebrow: "LOCAL ERP WAREHOUSE SIGNOFF",
    description: "仓库完成供应商到货实物交接后生成，作为IQC请检、库存入库和异常追溯的签收凭证",
    fieldSections: [
      {
        title: "来源单据",
        fields: [
          { label: "到货通知", value: text(source.arrival_no) },
          { label: "采购合同", value: text(source.contract_no, "") },
          { label: "采购订单", value: text(source.purchase_no) },
          { label: "供应商", value: text(source.supplier_name ?? source.supplier) },
        ],
      },
      {
        title: "签收信息",
        fields: [
          { label: "签收人", value: text(source.warehouse_received_by_name, "") },
          { label: "签收时间", value: dateText(source.warehouse_received_at) },
          { label: "到货日期", value: dateText(source.arrived_at) },
          { label: "签收说明", value: text(source.warehouse_note, "") },
        ],
      },
    ],
    lineSections: [
      {
        title: "签收明细",
        columns: purchaseColumns,
        rows: purchaseDocumentLines(source, "arrived"),
        minRows: 4,
      },
    ],
    notesTitle: "签收说明",
    notes: [
      "签收仅代表仓库完成外观、数量和随货单据交接，不等同于质量合格入库。",
      "签收后系统自动形成可请检状态，IQC判定合格或让步接收后才允许采购入库。",
      text(source.warehouse_note, "如存在短少、破损、批次不符等异常，应在签收说明中登记并保留附件。"),
    ],
    signatures: [
      { label: "供应商交接", hint: "送货人" },
      { label: "仓库签收", hint: "实物接收" },
      { label: "数量复核", hint: "复核人" },
      { label: "质量交接", hint: "IQC接收" },
    ],
    footerLeft: "第一联：仓库存根联 / 第二联：采购跟踪联 / 第三联：质量交接联",
  });
}

export function buildPurchaseReceiptPrintPreview(source: Source): FormalPrintDocument {
  const lineAmount = Number(source.line_amount ?? 0) || Number(source.qty ?? 0) * Number(source.unit_cost ?? 0);
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "采购入库单",
      documentNo: text(source.purchase_no),
      documentDate: dateText(source.created_at ?? source.received_at),
      statusText: "正式单据",
    },
    fieldSections: [
      {
        title: "采购与供应商",
        fields: [
          { label: "采购订单", value: text(source.purchase_no) },
          { label: "供应商", value: text(source.supplier_name ?? source.supplier) },
          { label: "入库日期", value: dateText(source.created_at ?? source.received_at) },
          { label: "入库说明", value: "采购入库后自动生成库存批次、库存流水与应付账款" },
        ],
      },
    ],
    lineSections: [
      {
        title: "入库明细",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "materialCode", label: "物料编码" },
          { key: "materialName", label: "物料名称" },
          { key: "batchNo", label: "入库批次" },
          { key: "qty", label: "数量", align: "right" },
          { key: "unit", label: "单位" },
          { key: "unitCost", label: "入库单价", align: "right" },
          { key: "amount", label: "入库金额", align: "right" },
        ],
        rows: [
          {
            lineNo: 1,
            materialCode: text(source.material_code),
            materialName: text(source.material_name ?? source.material),
            batchNo: text(source.batch_no),
            qty: qtyText(source.qty),
            unit: text(source.unit, ""),
            unitCost: moneyText(source.unit_cost),
            amount: moneyText(lineAmount),
          },
        ],
        minRows: 4,
      },
    ],
    notesTitle: "入库说明",
    notes: [
      "采购入库完成后，系统自动生成原材料批次、库存流水和应付账款。",
      "原材料库存均价按移动加权平均法更新；后续出库后按剩余批次成本重算均价。",
      "如到货数量、批次或单价与采购订单不一致，应先记录差异并提交审批。",
    ],
    signatures: [
      { label: "采购经办", hint: "订单/价格" },
      { label: "仓库入库", hint: "数量/批次" },
      { label: "质量复核", hint: "验收状态" },
      { label: "财务留存", hint: "应付依据" },
    ],
  });
}

function stocktakeTypeText(differenceQty: number) {
  if (differenceQty > 0) return "盘点盘盈";
  if (differenceQty < 0) return "盘点盘亏";
  return "账实相符";
}

function dispositionText(value: unknown) {
  return (
    {
      return_to_stock: "退货入库",
      rework: "返工处理",
      scrap: "报废处理",
    }[text(value, "")] ?? text(value)
  );
}

function refundStatusText(value: unknown) {
  return (
    {
      none: "无需退款",
      pending_refund: "待退款",
      partial_refunded: "部分退款",
      refunded: "已退款",
    }[text(value, "")] ?? text(value)
  );
}

function replacementStatusText(value: unknown) {
  return (
    {
      pending_replacement: "待补发",
      replaced: "已补发",
      not_required: "无需补发",
    }[text(value, "")] ?? text(value)
  );
}

function technicalDispositionTypeText(value: unknown) {
  return (
    {
      rework: "返工返修",
      scrap: "报废处理",
      concession_release: "技术让步放行",
      process_adjustment: "工艺调整复检",
    }[text(value, "")] ?? text(value)
  );
}

function qaResultText(value: unknown) {
  return (
    {
      qualified: "合格",
      concession: "让步接收",
      failed: "不合格",
    }[text(value, "")] ?? text(value)
  );
}

export function buildTechnicalDispositionPrintPreview(source: Source): FormalPrintDocument {
  const dispositionType = text(source.disposition_type_label, technicalDispositionTypeText(source.disposition_type));
  const dueDate = dateText(source.due_date);
  const createdBy = text(source.created_by_name);
  const measurements = text(source.measurements, "不合格现象以请验单实测记录为准");
  const rootCause = text(source.root_cause);
  const correctiveAction = text(source.corrective_action);

  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "技术处置单",
      documentNo: text(source.disposition_no),
      documentDate: dateText(source.created_at),
      statusText: text(source.status_label, "正式单据"),
    },
    eyebrow: "LOCAL ERP QUALITY DISPOSITION",
    description: "系统根据 OQC 不合格请验自动生成，适用于技术评审、返工复检、签字确认和本地归档",
    fieldSections: [
      {
        title: "不合格来源",
        fields: [
          { label: "不合格请验单", value: text(source.inspection_no) },
          { label: "生产单", value: text(source.prod_no) },
          { label: "客户订单", value: text(source.order_no) },
          { label: "客户名称", value: text(source.customer_name) },
          { label: "产品名称", value: text(source.product_name) },
          { label: "生产数量", value: `${qtyText(source.order_qty)} ${text(source.unit, "")}`.trim() },
          { label: "检验判定", value: qaResultText(source.result) },
          { label: "不合格记录", value: measurements },
        ],
      },
      {
        title: "技术评审",
        fields: [
          { label: "处理方式", value: dispositionType },
          { label: "技术人员", value: createdBy },
          { label: "要求完成日期", value: dueDate },
          { label: "当前状态", value: text(source.status_label) },
          { label: "原因分析", value: rootCause },
          { label: "处理意见", value: correctiveAction },
          { label: "备注", value: text(source.note, "技术处置意见随请验单和复检记录归档") },
          { label: "关闭时间", value: dateText(source.closed_at) },
        ],
      },
    ],
    lineSections: [
      {
        title: "处置明细",
        columns: [
          { key: "lineNo", label: "序号", align: "center" },
          { key: "item", label: "项目" },
          { key: "content", label: "内容" },
          { key: "owner", label: "责任部门/人" },
          { key: "dueDate", label: "要求完成", align: "center" },
        ],
        rows: [
          {
            lineNo: 1,
            item: "不合格现象",
            content: measurements,
            owner: "品控",
            dueDate: "-",
          },
          {
            lineNo: 2,
            item: "原因分析",
            content: rootCause,
            owner: createdBy,
            dueDate,
          },
          {
            lineNo: 3,
            item: "处理意见",
            content: correctiveAction,
            owner: "生产/技术",
            dueDate,
          },
        ],
        minRows: 4,
      },
    ],
    notesTitle: "归档说明",
    notes: [
      "技术处置单由技术部针对 OQC 不合格批次出具，作为返工、报废、让步放行或复检的正式依据。",
      "处置方式为返工返修或工艺调整复检时，生产完成后应重新发起请验，系统自动关联原不合格单和本技术处置单。",
      "本单打印签字后可在本地归档模块上传签字版 PDF 或图片，随 SQLite 数据库、附件和导出文件进入冷备份包。",
    ],
    signatures: [
      { label: "品控提交", hint: "不合格事实" },
      { label: "技术评审", hint: "原因/方案" },
      { label: "生产执行", hint: "返工/处置" },
      { label: "质量复核", hint: "复检关闭" },
    ],
    footerLeft: "第一联：技术归档联 / 第二联：生产执行联 / 第三联：品控复检联",
    footerRight: `技术处置追溯编号：${text(source.disposition_no)}`,
  });
}

export function buildSalesReturnPrintPreview(source: Source): FormalPrintDocument {
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "销售退货单",
      documentNo: text(source.return_no),
      documentDate: dateText(source.received_at ?? source.created_at),
      statusText: text(source.status_label, "正式售后"),
    },
    eyebrow: "LOCAL ERP AFTER-SALES DOCUMENT",
    description: "系统根据客户退货业务自动生成，适用于退货收货、应收调整、退款、补发和本地归档",
    fieldSections: [
      {
        title: "客户与原单",
        fields: [
          { label: "客户名称", value: text(source.customer_name) },
          { label: "销售订单", value: text(source.order_no) },
          { label: "原发货单", value: text(source.shipment_no) },
          { label: "退货日期", value: dateText(source.received_at ?? source.created_at) },
          { label: "产品名称", value: text(source.product_name) },
          { label: "退货原因", value: text(source.reason) },
        ],
      },
      {
        title: "财务与处置",
        fields: [
          { label: "退货处置", value: dispositionText(source.disposition) },
          { label: "退货金额", value: moneyText(source.return_amount) },
          { label: "退货成本", value: moneyText(source.cost_amount) },
          { label: "应收抵减", value: moneyText(source.offset_amount) },
          { label: "待退金额", value: moneyText(source.refund_due_amount) },
          { label: "退款状态", value: text(source.refund_status_label, refundStatusText(source.refund_status)) },
          { label: "补发状态", value: text(source.replacement_status_label, replacementStatusText(source.replacement_status)) },
          { label: "备注", value: text(source.note, "退货单经仓库收货后进入财务退款或售后补发流程") },
        ],
      },
    ],
    lineSections: [
      {
        title: "退货明细",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "productName", label: "产品名称" },
          { key: "qty", label: "退货数量", align: "right" },
          { key: "unit", label: "单位" },
          { key: "returnAmount", label: "退货金额", align: "right" },
          { key: "costAmount", label: "退货成本", align: "right" },
          { key: "offsetAmount", label: "应收抵减", align: "right" },
          { key: "refundDue", label: "待退金额", align: "right" },
          { key: "remark", label: "备注" },
        ],
        rows: [
          {
            lineNo: 1,
            productName: text(source.product_name),
            qty: qtyText(source.return_qty),
            unit: text(source.unit, ""),
            returnAmount: moneyText(source.return_amount),
            costAmount: moneyText(source.cost_amount),
            offsetAmount: moneyText(source.offset_amount),
            refundDue: moneyText(source.refund_due_amount),
            remark: dispositionText(source.disposition),
          },
        ],
        minRows: 4,
      },
    ],
    notesTitle: "退货说明",
    notes: [
      "销售退货单生成后，系统按原发货批次记录退货入库流水，并同步调整应收账款。",
      "客户已回款且退货金额超过应收余额时，系统自动形成待退款金额，需由财务登记客户退款。",
      "需要补发时，应从退货单生成补开发货单；补发单不重复生成应收账款。",
    ],
    signatures: [
      { label: "商务登记", hint: "退货原因" },
      { label: "仓库收货", hint: "数量/批次" },
      { label: "品控复核", hint: "处置建议" },
      { label: "财务确认", hint: "应收/退款" },
    ],
    footerLeft: "第一联：客户沟通联 / 第二联：仓库收货联 / 第三联：财务留存联",
  });
}

export function buildCustomerRefundPrintPreview(source: Source): FormalPrintDocument {
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "客户退款单",
      documentNo: text(source.refund_no),
      documentDate: dateText(source.refunded_at ?? source.created_at),
      statusText: text(source.status_label, "已登记"),
    },
    eyebrow: "LOCAL ERP FINANCE DOCUMENT",
    description: "系统根据销售退货单生成客户退款记录，适用于财务付款、对账确认和本地归档",
    fieldSections: [
      {
        title: "退款信息",
        fields: [
          { label: "客户名称", value: text(source.customer_name) },
          { label: "退货单号", value: text(source.return_no) },
          { label: "应收单号", value: text(source.receivable_no) },
          { label: "退款金额", value: moneyText(source.amount) },
          { label: "退款方式", value: text(source.method) },
          { label: "退款日期", value: dateText(source.refunded_at ?? source.created_at) },
          { label: "经办人", value: text(source.refunded_by_name) },
          { label: "备注", value: text(source.note, "客户退货退款登记") },
        ],
      },
    ],
    lineSections: [
      {
        title: "退款明细",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "returnNo", label: "退货单" },
          { key: "receivableNo", label: "应收单" },
          { key: "customerName", label: "客户" },
          { key: "method", label: "方式" },
          { key: "amount", label: "退款金额", align: "right" },
          { key: "remark", label: "备注" },
        ],
        rows: [
          {
            lineNo: 1,
            returnNo: text(source.return_no),
            receivableNo: text(source.receivable_no),
            customerName: text(source.customer_name),
            method: text(source.method),
            amount: moneyText(source.amount),
            remark: text(source.note, "退货退款"),
          },
        ],
        minRows: 4,
      },
    ],
    notesTitle: "退款说明",
    notes: [
      "客户退款单仅记录财务退款动作，不影响原发货单批次追溯。",
      "退款登记后系统同步减少退货单待退款金额，并更新应收账款状态。",
      "本单应与银行付款凭证、销售退货单和客户对账资料一并归档。",
    ],
    signatures: [
      { label: "财务制单", hint: "退款登记" },
      { label: "业务确认", hint: "客户沟通" },
      { label: "财务复核", hint: "付款凭证" },
      { label: "管理审批", hint: "留存确认" },
    ],
    footerLeft: "第一联：财务付款联 / 第二联：业务对账联 / 第三联：公司存根联",
  });
}

export function buildReplacementShipmentPrintPreview(source: Source): FormalPrintDocument {
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "补开发货单",
      documentNo: text(source.shipment_no),
      documentDate: dateText(source.shipped_at ?? source.created_at),
      statusText: "售后补发",
    },
    eyebrow: "LOCAL ERP AFTER-SALES DELIVERY",
    description: "系统根据销售退货单生成售后补开发货单，适用于补发出库、客户签收和售后归档",
    fieldSections: [
      {
        title: "售后关联",
        fields: [
          { label: "客户名称", value: text(source.customer_name) },
          { label: "销售订单", value: text(source.order_no) },
          { label: "退货单号", value: text(source.return_no) },
          { label: "原发货单", value: text(source.original_shipment_no ?? source.original_shipment_id) },
          { label: "物流公司", value: text(source.logistics_company) },
          { label: "物流单号", value: text(source.tracking_no) },
        ],
      },
    ],
    lineSections: [
      {
        title: "补发明细",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "productName", label: "产品名称" },
          { key: "batchNo", label: "批次号" },
          { key: "qty", label: "补发数量", align: "right" },
          { key: "unit", label: "单位" },
          { key: "amount", label: "销售金额", align: "right" },
          { key: "remark", label: "备注" },
        ],
        rows: [
          {
            lineNo: 1,
            productName: text(source.product_name),
            batchNo: text(source.batch_no),
            qty: qtyText(source.shipped_qty),
            unit: text(source.unit, ""),
            amount: "0",
            remark: text(source.remark, "售后补发，不重复生成应收"),
          },
        ],
        minRows: 4,
      },
    ],
    notesTitle: "补发说明",
    notes: [
      "补开发货单用于售后补发场景，系统只扣减成品库存，不重复生成应收账款。",
      "补发货物仍需按批次记录出库流水，支持后续质量追溯和客户签收确认。",
      "本单应与原销售退货单、原发货单和客户沟通记录一起归档。",
    ],
    signatures: [
      { label: "商务制单", hint: "售后补发" },
      { label: "仓库发货", hint: "批次/数量" },
      { label: "物流承运", hint: "运输确认" },
      { label: "客户签收", hint: "补发确认" },
    ],
    footerLeft: "第一联：客户签收联 / 第二联：售后归档联 / 第三联：仓库留存联",
  });
}

export function buildStocktakePrintPreview(source: Source): FormalPrintDocument {
  const differenceQty = Number(source.difference_qty ?? 0);
  return baseDocument({
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "库存盘点单",
      documentNo: text(source.stocktake_no),
      documentDate: dateText(source.counted_at ?? source.created_at),
      statusText: text(source.status_label, "正式单据"),
    },
    fieldSections: [
      {
        title: "盘点信息",
        fields: [
          { label: "盘点单号", value: text(source.stocktake_no) },
          { label: "物料编码", value: text(source.material_code) },
          { label: "物料名称", value: text(source.material_name) },
          { label: "账面数量", value: `${qtyText(source.book_qty)} ${text(source.unit, "")}`.trim() },
          { label: "实盘数量", value: `${qtyText(source.actual_qty)} ${text(source.unit, "")}`.trim() },
          { label: "差异数量", value: `${qtyText(differenceQty)} ${text(source.unit, "")}`.trim() },
          { label: "调整类型", value: stocktakeTypeText(differenceQty) },
          { label: "调整金额", value: moneyText(source.adjustment_amount) },
          { label: "盘点人", value: text(source.counted_by_name) },
          { label: "审批人", value: text(source.approved_by_name) },
        ],
      },
    ],
    lineSections: [
      {
        title: "盘点差异明细",
        columns: [
          { key: "lineNo", label: "序号" },
          { key: "materialCode", label: "物料编码" },
          { key: "materialName", label: "物料名称" },
          { key: "bookQty", label: "账面", align: "right" },
          { key: "actualQty", label: "实盘", align: "right" },
          { key: "differenceQty", label: "差异", align: "right" },
          { key: "unit", label: "单位" },
          { key: "unitCost", label: "单位成本", align: "right" },
          { key: "amount", label: "调整金额", align: "right" },
        ],
        rows: [
          {
            lineNo: 1,
            materialCode: text(source.material_code),
            materialName: text(source.material_name),
            bookQty: qtyText(source.book_qty),
            actualQty: qtyText(source.actual_qty),
            differenceQty: qtyText(differenceQty),
            unit: text(source.unit, ""),
            unitCost: moneyText(source.unit_cost),
            amount: moneyText(source.adjustment_amount),
          },
        ],
        minRows: 4,
      },
    ],
    notesTitle: "盘点说明",
    notes: [
      text(source.remark, "仓库按实物盘点结果录入，管理层审批后调整库存。"),
      text(source.approval_note, "审批后系统自动生成盘盈/盘亏库存流水，并重新计算库存均价。"),
      "盘点单作为账实差异、库存调整、成本追溯和财务留存依据。",
    ],
    signatures: [
      { label: "盘点人", hint: "实物清点" },
      { label: "仓库复核", hint: "批次/数量" },
      { label: "管理审批", hint: "差异确认" },
      { label: "财务留存", hint: "成本依据" },
    ],
  });
}
