export type BomComponentType = "material" | "product";
export type QaResult = "qualified" | "concession" | "failed";

export type BomLineInput = {
  parentProductId: string;
  componentType: BomComponentType;
  componentId: string;
  qtyPer: number;
  isPrimary?: boolean;
};

export type FifoBatch = {
  batchId: string;
  availableQty: number;
  receivedAt: string;
};

export type CostedInventoryBatch = {
  qty: number;
  unitCost: number;
};

export type InventoryAgingStatus = "normal" | "stale_warning" | "overstock";

export type MaterialRequirementDemand = {
  materialId: string;
  requiredQty: number;
  sourceSummary?: string;
};

export type MaterialRequirementSupply = {
  materialId: string;
  availableQty: number;
  safetyStockQty?: number;
  incomingPurchaseQty?: number;
  plannedRequisitionQty?: number;
  estimatedUnitCost: number;
};

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundQty(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function calculateMovingAverage(input: {
  currentQty: number;
  currentAverageCost: number;
  incomingQty: number;
  incomingUnitCost: number;
}) {
  const { currentQty, currentAverageCost, incomingQty, incomingUnitCost } = input;
  if (currentQty < 0 || incomingQty <= 0 || currentAverageCost < 0 || incomingUnitCost < 0) {
    throw new Error("Invalid quantity or cost for moving average calculation.");
  }

  const nextQty = roundQty(currentQty + incomingQty);
  const nextAverageCost =
    nextQty === 0
      ? 0
      : roundMoney((currentQty * currentAverageCost + incomingQty * incomingUnitCost) / nextQty);

  return { nextQty, nextAverageCost };
}

export function calculateAverageCostFromRemainingBatches(batches: CostedInventoryBatch[]) {
  const totals = batches.reduce(
    (acc, batch) => {
      if (batch.qty < 0 || batch.unitCost < 0) {
        throw new Error("Invalid remaining batch quantity or cost.");
      }
      return {
        qty: acc.qty + batch.qty,
        cost: acc.cost + batch.qty * batch.unitCost,
      };
    },
    { qty: 0, cost: 0 },
  );

  const nextQty = roundQty(totals.qty);
  return {
    nextQty,
    nextAverageCost: nextQty === 0 ? 0 : roundMoney(totals.cost / nextQty),
  };
}

export function allocateFifo(batches: FifoBatch[], requiredQty: number) {
  if (requiredQty <= 0) {
    throw new Error("Required quantity must be greater than zero.");
  }

  let remaining = requiredQty;
  const allocations: Array<{ batchId: string; qty: number }> = [];

  for (const batch of [...batches].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
    if (remaining <= 0) break;
    const qty = Math.min(batch.availableQty, remaining);
    if (qty <= 0) continue;
    allocations.push({ batchId: batch.batchId, qty: roundQty(qty) });
    remaining = roundQty(remaining - qty);
  }

  return {
    allocations,
    shortage: roundQty(Math.max(remaining, 0)),
  };
}

export function expandBom(input: {
  rootProductId: string;
  quantity: number;
  lines: BomLineInput[];
}) {
  if (input.quantity <= 0) {
    throw new Error("BOM expansion quantity must be greater than zero.");
  }

  const byParent = new Map<string, BomLineInput[]>();
  for (const line of input.lines) {
    if (line.qtyPer <= 0) {
      throw new Error(`Invalid BOM quantity for ${line.componentId}.`);
    }
    byParent.set(line.parentProductId, [...(byParent.get(line.parentProductId) ?? []), line]);
  }

  const materialMap = new Map<string, { requiredQty: number; isPrimary: boolean }>();

  const visit = (productId: string, multiplier: number, stack: string[]) => {
    if (stack.includes(productId)) {
      throw new Error(`BOM cycle detected: ${[...stack, productId].join(" -> ")}`);
    }

    for (const line of byParent.get(productId) ?? []) {
      const requiredQty = roundQty(multiplier * line.qtyPer);
      if (line.componentType === "product") {
        visit(line.componentId, requiredQty, [...stack, productId]);
        continue;
      }

      const existing = materialMap.get(line.componentId) ?? { requiredQty: 0, isPrimary: false };
      materialMap.set(line.componentId, {
        requiredQty: roundQty(existing.requiredQty + requiredQty),
        isPrimary: existing.isPrimary || Boolean(line.isPrimary),
      });
    }
  };

  visit(input.rootProductId, input.quantity, []);

  const materials = [...materialMap.entries()]
    .map(([materialId, value]) => ({ materialId, ...value }))
    .sort((a, b) => a.materialId.localeCompare(b.materialId));

  return {
    materials,
    primaryMaterialQty: roundQty(
      materials.reduce((sum, material) => sum + (material.isPrimary ? material.requiredQty : 0), 0),
    ),
  };
}

export function calculateMaterialNetRequirements(input: {
  demands: MaterialRequirementDemand[];
  supplies: MaterialRequirementSupply[];
}) {
  const supplyByMaterial = new Map(input.supplies.map((supply) => [supply.materialId, supply]));
  const demandByMaterial = new Map<
    string,
    {
      materialId: string;
      requiredQty: number;
      sourceSummaries: string[];
    }
  >();

  for (const demand of input.demands) {
    if (demand.requiredQty <= 0) throw new Error("MRP demand quantity must be greater than zero.");
    const current = demandByMaterial.get(demand.materialId) ?? {
      materialId: demand.materialId,
      requiredQty: 0,
      sourceSummaries: [],
    };
    current.requiredQty = roundQty(current.requiredQty + demand.requiredQty);
    if (demand.sourceSummary && !current.sourceSummaries.includes(demand.sourceSummary)) {
      current.sourceSummaries.push(demand.sourceSummary);
    }
    demandByMaterial.set(demand.materialId, current);
  }

  return [...demandByMaterial.values()]
    .map((demand) => {
      const supply = supplyByMaterial.get(demand.materialId);
      if (!supply) throw new Error(`Missing MRP supply for material ${demand.materialId}.`);
      const availableQty = roundQty(Math.max(supply.availableQty, 0));
      const safetyStockQty = roundQty(Math.max(supply.safetyStockQty ?? 0, 0));
      const incomingPurchaseQty = roundQty(Math.max(supply.incomingPurchaseQty ?? 0, 0));
      const plannedRequisitionQty = roundQty(Math.max(supply.plannedRequisitionQty ?? 0, 0));
      const grossNeedQty = roundQty(demand.requiredQty + safetyStockQty);
      const netShortageQty = roundQty(
        Math.max(grossNeedQty - availableQty - incomingPurchaseQty - plannedRequisitionQty, 0),
      );
      const estimatedUnitCost = roundMoney(Math.max(supply.estimatedUnitCost, 0));

      return {
        materialId: demand.materialId,
        requiredQty: roundQty(demand.requiredQty),
        availableQty,
        safetyStockQty,
        incomingPurchaseQty,
        plannedRequisitionQty,
        netShortageQty,
        suggestedPurchaseQty: netShortageQty,
        estimatedUnitCost,
        lineAmount: roundMoney(netShortageQty * estimatedUnitCost),
        sourceSummary: demand.sourceSummaries.join("；"),
        status: netShortageQty > 0 ? ("shortage" as const) : ("covered" as const),
      };
    })
    .sort((a, b) => {
      if (b.netShortageQty !== a.netShortageQty) return b.netShortageQty - a.netShortageQty;
      return a.materialId.localeCompare(b.materialId);
    });
}

export function qaAllowsInbound(result: QaResult) {
  return result === "qualified" || result === "concession";
}

export function calculateYieldRate(input: { actualInboundQty: number; primaryIssuedQty: number }) {
  if (input.actualInboundQty < 0 || input.primaryIssuedQty < 0) {
    throw new Error("Yield quantities cannot be negative.");
  }
  if (input.primaryIssuedQty === 0) return 0;
  return roundMoney((input.actualInboundQty / input.primaryIssuedQty) * 100);
}

export type LedgerStatus = "unpaid" | "partial" | "paid";

export function calculateLedgerStatus(input: { totalAmount: number; settledAmount: number }): LedgerStatus {
  if (input.totalAmount < 0 || input.settledAmount < 0) {
    throw new Error("Ledger amounts cannot be negative.");
  }
  if (input.totalAmount === 0 || input.settledAmount >= input.totalAmount) return "paid";
  if (input.settledAmount > 0) return "partial";
  return "unpaid";
}

export function calculateBalance(input: { totalAmount: number; settledAmount: number }) {
  if (input.totalAmount < 0 || input.settledAmount < 0) {
    throw new Error("Ledger amounts cannot be negative.");
  }
  return roundMoney(Math.max(input.totalAmount - input.settledAmount, 0));
}

export function calculateAgeDays(input: { fromDate: string; asOfDate?: string }) {
  const from = Date.parse(input.fromDate);
  const asOf = Date.parse(input.asOfDate ?? new Date().toISOString());
  if (Number.isNaN(from) || Number.isNaN(asOf)) {
    throw new Error("Invalid date for aging calculation.");
  }
  return Math.max(Math.floor((asOf - from) / (1000 * 60 * 60 * 24)), 0);
}

export function classifyInventoryAging(input: {
  lastMovementAt?: string | null;
  asOfDate?: string;
  staleWarningDays?: number;
  overstockDays?: number;
}): { status: InventoryAgingStatus; inactiveDays: number } {
  const staleWarningDays = input.staleWarningDays ?? 90;
  const overstockDays = input.overstockDays ?? 180;
  if (staleWarningDays <= 0 || overstockDays <= staleWarningDays) {
    throw new Error("Invalid inventory aging thresholds.");
  }

  if (!input.lastMovementAt) {
    return { status: "normal", inactiveDays: 0 };
  }

  const inactiveDays = calculateAgeDays({
    fromDate: input.lastMovementAt,
    asOfDate: input.asOfDate,
  });

  if (inactiveDays >= overstockDays) {
    return { status: "overstock", inactiveDays };
  }
  if (inactiveDays >= staleWarningDays) {
    return { status: "stale_warning", inactiveDays };
  }
  return { status: "normal", inactiveDays };
}

export type SupplierRiskLevel = "low" | "medium" | "high";
export type SupplierAdmissionStatus = "normal" | "watch" | "restricted" | "blacklisted";

export function supplierAdmissionStatusFromScore(score: number): SupplierAdmissionStatus {
  const safeScore = Number.isFinite(score) ? score : 0;
  if (safeScore >= 80) return "normal";
  if (safeScore >= 70) return "watch";
  if (safeScore >= 60) return "restricted";
  return "blacklisted";
}

export function calculateSupplierPerformanceScore(input: {
  purchaseOrderCount: number;
  onTimeDeliveryRate: number;
  iqcPassRate: number;
  discrepancyRate: number;
  overduePayableCount: number;
  adjustmentRate: number;
}) {
  const clampRate = (value: number) => Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100);
  const purchaseOrderCount = Math.max(Math.floor(input.purchaseOrderCount), 0);
  const onTimeDeliveryRate = clampRate(input.onTimeDeliveryRate);
  const iqcPassRate = clampRate(input.iqcPassRate);
  const discrepancyRate = clampRate(input.discrepancyRate);
  const overduePayableCount = Math.max(Math.floor(input.overduePayableCount), 0);
  const adjustmentRate = Math.abs(Number.isFinite(input.adjustmentRate) ? input.adjustmentRate : 0);

  const score = Math.max(
    0,
    Math.min(
      100,
      roundMoney(
        100 -
          (100 - onTimeDeliveryRate) * 0.25 -
          (100 - iqcPassRate) * 0.35 -
          discrepancyRate * 0.25 -
          Math.min(overduePayableCount * 5, 15) -
          Math.min(adjustmentRate * 0.5, 10),
      ),
    ),
  );

  let grade = "D";
  let gradeLabel = "高风险供应商";
  let riskLevel: SupplierRiskLevel = "high";
  let recommendation = "暂停新增采购，完成质量、交付、差异和对账整改后再恢复。";
  if (score >= 90) {
    grade = "A";
    gradeLabel = "优质供应商";
    riskLevel = "low";
    recommendation = "优先询价和下单，可作为关键物料稳定供应商。";
  } else if (score >= 80) {
    grade = "B";
    gradeLabel = "稳定供应商";
    riskLevel = "low";
    recommendation = "可正常采购，持续跟进入厂检验和交期表现。";
  } else if (score >= 70) {
    grade = "C";
    gradeLabel = "观察供应商";
    riskLevel = "medium";
    recommendation = "控制新增订单规模，要求供应商提交交期或质量改进措施。";
  }

  return {
    score: purchaseOrderCount === 0 ? 100 : score,
    grade: purchaseOrderCount === 0 ? "A" : grade,
    gradeLabel: purchaseOrderCount === 0 ? "优质供应商" : gradeLabel,
    riskLevel: purchaseOrderCount === 0 ? ("low" as const) : riskLevel,
    recommendation: purchaseOrderCount === 0 ? "暂无采购历史，作为新供应商观察引入。" : recommendation,
  };
}
