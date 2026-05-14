type Source = Record<string, unknown>;

export type FormalDocumentPreview = {
  header: {
    companyName: string;
    title: string;
    documentNo: string;
    documentDate: string;
    statusText: string;
  };
  fields: Array<{ label: string; value: string }>;
  lines: Array<Record<string, string | number>>;
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

function moneyText(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function priorityText(value: unknown) {
  return (
    {
      normal: "普通",
      urgent: "加急",
      high: "高优先级",
    }[text(value, "normal")] ?? text(value, "普通")
  );
}

function issueModeText(value: unknown) {
  return (
    {
      fifo: "FIFO",
      substitute_fifo: "替代料FIFO",
      manual: "手动指定",
      manual_batch: "指定批次",
    }[text(value, "fifo")] ?? text(value)
  );
}

export function buildProductionInstructionPreview(source: Source): FormalDocumentPreview {
  return {
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "生产指令单",
      documentNo: text(source.prod_no),
      documentDate: dateText(source.issued_at ?? source.created_at),
      statusText: "正式单据",
    },
    fields: [
      { label: "客户订单", value: text(source.order_no) },
      { label: "客户名称", value: text(source.customer_name) },
      { label: "产品名称", value: text(source.product_name) },
      { label: "生产数量", value: `${qtyText(source.order_qty)} ${text(source.unit, "")}`.trim() },
      { label: "交付期限", value: dateText(source.due_date) },
      { label: "优先级", value: priorityText(source.priority) },
      { label: "计划日期", value: dateText(source.planned_date) },
      { label: "机台", value: text(source.machine) },
      { label: "负责人", value: text(source.owner) },
      { label: "班次", value: text(source.shift) },
      { label: "下达人", value: text(source.issued_by_name) },
      { label: "下达说明", value: text(source.instruction_note) },
      { label: "技术要求", value: text(source.technical_requirements) },
    ],
    lines: [],
    notes: [
      "生产部门接收指令后，应按系统排产记录执行并保留实际生产反馈。",
      "如需变更 BOM、工艺、机台或交期，应在系统内重新记录并留痕。",
    ],
    signatures: [
      { label: "内勤下单", hint: "生产指令" },
      { label: "生产接收", hint: "排产确认" },
      { label: "工艺确认", hint: "BOM/配方" },
      { label: "主管审核", hint: "执行确认" },
    ],
  };
}

export function buildMaterialRequisitionPreview(source: Source): FormalDocumentPreview {
  const lines = Array.isArray(source.lines) ? (source.lines as Source[]) : [];
  const note = text(source.requisition_note, "");
  return {
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "生产领料单",
      documentNo: text(source.req_no),
      documentDate: dateText(source.created_at),
      statusText: "正式单据",
    },
    fields: [
      { label: "生产单", value: text(source.prod_no) },
      { label: "客户订单", value: text(source.order_no) },
      { label: "产品名称", value: text(source.product_name) },
      { label: "生产数量", value: `${qtyText(source.order_qty)} ${text(source.unit, "")}`.trim() },
      { label: "BOM版本", value: text(source.bom_version) },
      { label: "计划日期", value: dateText(source.planned_date) },
      { label: "机台", value: text(source.machine) },
      { label: "负责人", value: text(source.owner) },
      { label: "领料说明", value: note || "按系统计算需求量领料" },
    ],
    lines: lines.map((line, index) => ({
      lineNo: index + 1,
      materialCode: text(line.materialCode ?? line.material_code ?? line.materialId),
      materialName: text(line.materialName ?? line.material_name),
      requiredQty: qtyText(line.requiredQty ?? line.required_qty),
      unit: text(line.unit, ""),
      usage: Number(line.isPrimary ?? line.is_primary ?? 0) === 1 || line.isPrimary === true ? "主材" : "辅材",
      remark: note || "按系统 FIFO 规则发料",
    })),
    notes: [
      "仓库默认按先进先出发料；如使用替代料或指定批次，需在系统内记录原因。",
      "本单发料后自动扣减原材料批次库存，并形成生产成本与批次追溯记录。",
    ],
    signatures: [
      { label: "生产领料", hint: "申请人" },
      { label: "仓库发料", hint: "批次复核" },
      { label: "品控留存", hint: "追溯检查" },
      { label: "主管确认", hint: "生产确认" },
    ],
  };
}

export function buildMaterialIssuePreview(source: Source): FormalDocumentPreview {
  const lines = Array.isArray(source.issueLines)
    ? (source.issueLines as Source[])
    : Array.isArray(source.lines)
      ? (source.lines as Source[])
      : [];
  const issueNote = text(source.issue_note, "");
  return {
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "原材料出库单",
      documentNo: text(source.issue_no || source.req_no),
      documentDate: dateText(source.issued_at),
      statusText: "正式单据",
    },
    fields: [
      { label: "领料单", value: text(source.req_no) },
      { label: "生产单", value: text(source.prod_no) },
      { label: "客户订单", value: text(source.order_no) },
      { label: "客户名称", value: text(source.customer_name) },
      { label: "产品名称", value: text(source.product_name) },
      { label: "审批人", value: text(source.approved_by_name) },
      { label: "发料人", value: text(source.issued_by_name) },
      { label: "审批意见", value: text(source.approval_note) },
      { label: "发料说明", value: issueNote || "仓库按系统领料单完成发料" },
    ],
    lines: lines.map((line, index) => ({
      lineNo: index + 1,
      bomMaterial: `${text(line.original_material_code ?? line.original_material_id, "")} / ${text(line.original_material_name)}`,
      issuedMaterial: `${text(line.material_code ?? line.material_id, "")} / ${text(line.material_name)}`,
      batchNo: text(line.batch_no),
      qty: qtyText(line.qty),
      unit: text(line.unit, ""),
      unitCost: moneyText(line.unit_cost),
      amount: moneyText(line.line_amount),
      mode: issueModeText(line.issue_mode),
      remark: text(line.issue_note, issueNote || "按系统规则发料"),
    })),
    notes: [
      "本单出库后自动扣减原材料批次数量，并按剩余批次成本重算物料移动均价。",
      "指定批次、替代料或非 FIFO 发料必须在系统中记录原因，形成审计追溯。",
    ],
    signatures: [
      { label: "领料部门", hint: "生产确认" },
      { label: "仓库发料", hint: "经办人" },
      { label: "仓库复核", hint: "批次/数量" },
      { label: "成本留存", hint: "财务/管理" },
    ],
  };
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

export function buildFinishedGoodsReceiptPreview(source: Source): FormalDocumentPreview {
  const finishedQty = Number(source.finished_qty ?? 0);
  const transitionQty = Number(source.transition_qty ?? 0);
  const unitCost = Number(source.unit_cost ?? 0);
  const transitionUnitCost = unitCost * 0.15;
  const lines: Array<Record<string, string | number>> = [
    {
      lineNo: 1,
      kind: "成品",
      batchNo: text(source.finished_batch_no),
      productName: text(source.product_name),
      qty: qtyText(finishedQty),
      unit: text(source.unit, ""),
      unitCost: moneyText(unitCost),
      remark: "合格/让步接收入库",
    },
  ];
  if (transitionQty > 0) {
    lines.push({
      lineNo: 2,
      kind: "过渡料",
      batchNo: text(source.transition_batch_no),
      productName: text(source.product_name),
      qty: qtyText(transitionQty),
      unit: text(source.unit, ""),
      unitCost: moneyText(transitionUnitCost),
      remark: "生产损耗、边角料或过渡料",
    });
  }

  return {
    header: {
      companyName: text(source.company_name, "本地化生产流转 ERP 演示公司"),
      title: "成品入库单",
      documentNo: text(source.receipt_no),
      documentDate: dateText(source.received_at),
      statusText: "正式单据",
    },
    fields: [
      { label: "生产单", value: text(source.prod_no) },
      { label: "客户订单", value: text(source.order_no) },
      { label: "客户名称", value: text(source.customer_name) },
      { label: "产品名称", value: text(source.product_name) },
      { label: "请验单", value: text(source.inspection_no) },
      { label: "检验判定", value: qaResultText(source.result) },
      { label: "成品数量", value: `${qtyText(finishedQty)} ${text(source.unit, "")}`.trim() },
      { label: "过渡料数量", value: `${qtyText(transitionQty)} ${text(source.unit, "")}`.trim() },
      { label: "材料成本", value: moneyText(source.material_cost) },
      { label: "加工成本", value: moneyText(source.process_cost) },
      { label: "总成本", value: moneyText(source.total_cost) },
      { label: "单位成本", value: moneyText(source.unit_cost) },
      { label: "收率", value: `${qtyText(source.yield_rate)}%` },
      { label: "入库人", value: text(source.received_by_name) },
      { label: "入库说明", value: text(source.inbound_note) },
    ],
    lines,
    notes: [
      "成品与过渡料入库必须以合格或让步接收的检验结果为前置条件。",
      "系统按实际领料成本、加工费和实测入库量计算单位成本，并保留批次追溯。",
    ],
    signatures: [
      { label: "生产交付", hint: "完工确认" },
      { label: "品控放行", hint: "检验判定" },
      { label: "仓库入库", hint: "数量复核" },
      { label: "成本复核", hint: "财务/管理" },
    ],
  };
}
