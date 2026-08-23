import type Database from "better-sqlite3";
import {
  allocateFifo,
  calculateMovingAverage,
  calculateYieldRate,
  expandBom,
  roundMoney,
  roundQty,
  type BomLineInput,
  type FifoBatch,
} from "./domain";
import { now, uid } from "./erp-service";
import {
  assertTrustedFormalSnapshot,
  loadSnapshotStore,
  type SnapshotStore,
} from "./parallel-snapshot-service";
import {
  ADJUSTMENT_TYPE_LABELS,
  PARALLEL_ENGINE_VERSION,
  type AdjustmentType,
  type ImpactDomain,
  type ImpactSeverity,
  type ParallelAdjustmentLineRow,
  type ParallelAdjustmentRow,
} from "./parallel-ledger-types";
import {
  syncParallelSimulationDocuments,
  type ParallelSimulationDocumentSpec,
} from "./parallel-simulation-document-service";

type NumberRow = Record<string, unknown>;

function num(row: NumberRow | undefined, key: string, fallback = 0): number {
  if (!row) return fallback;
  const value = row[key];
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(row: NumberRow | undefined, key: string, fallback = ""): string {
  if (!row) return fallback;
  const value = row[key];
  return value == null ? fallback : String(value);
}

type AdjustedModel = {
  materials: Map<string, NumberRow>;
  materialBatches: Array<NumberRow>;
  products: Map<string, NumberRow>;
  bomLines: Array<NumberRow>;
  productionOrders: Array<NumberRow>;
  orders: Map<string, NumberRow>;
  requisitions: Array<NumberRow>;
  requisitionLines: Array<NumberRow>;
  projectedPurchasePrices: Map<string, number>;
  projectedPurchaseQuantities: Map<string, number>;
  inventoryOverrides: Map<string, number>;
  batchOverrides: Map<string, number>;
  processFeeOverrides: Map<string, number>;
  lossRateOverrides: Map<string, number>;
  productionQtyOverrides: Map<string, number>;
  issueQtyOverrides: Map<string, number>;
  bomComponentOverrides: Map<string, number>;
  bomAddedComponents: Array<{ productId: string; materialId: string; qtyPer: number; isPrimary: boolean }>;
  bomRemovedComponents: Array<{ productId: string; materialId: string }>;
  materialSubstitutions: MaterialSubstitutionRule[];
};

type MaterialSubstitutionRule = {
  adjustmentId: string;
  lineId: string;
  entityType: string;
  entityId: string;
  sourceMaterialId: string;
  targetMaterialId: string;
  quantity: number | null;
};

type MaterialSubstitutionResult = MaterialSubstitutionRule & {
  productionOrderId: string;
  productId: string;
  substituteQty: number;
  sourceRequiredBefore: number;
  sourceRequiredAfter: number;
  targetRequiredBefore: number;
  targetRequiredAfter: number;
  issuedSourceQty: number;
  issuedTargetQty: number;
  requisitionIds: string[];
};

function buildModel(store: SnapshotStore): AdjustedModel {
  return {
    materials: new Map(store.materials.map((m) => [str(m, "id"), m])),
    materialBatches: [...store.materialBatches],
    products: new Map(store.products.map((p) => [str(p, "id"), p])),
    bomLines: [...store.bomLines],
    productionOrders: [...store.productionOrders],
    orders: new Map(store.orders.map((o) => [str(o, "id"), o])),
    requisitions: [...store.requisitions],
    requisitionLines: [...store.requisitionLines],
    projectedPurchasePrices: new Map(),
    projectedPurchaseQuantities: new Map(),
    inventoryOverrides: new Map(),
    batchOverrides: new Map(),
    processFeeOverrides: new Map(),
    lossRateOverrides: new Map(),
    productionQtyOverrides: new Map(),
    issueQtyOverrides: new Map(),
    bomComponentOverrides: new Map(),
    bomAddedComponents: [],
    bomRemovedComponents: [],
    materialSubstitutions: [],
  };
}

function applyAdjustments(model: AdjustedModel, adjustments: ParallelAdjustmentRow[], lines: ParallelAdjustmentLineRow[]) {
  const lineByAdjustment = new Map<string, ParallelAdjustmentLineRow[]>();
  for (const line of lines) {
    const list = lineByAdjustment.get(line.adjustment_id) ?? [];
    list.push(line);
    lineByAdjustment.set(line.adjustment_id, list);
  }
  for (const adjustment of adjustments) {
    const adjLines = lineByAdjustment.get(adjustment.id) ?? [];
    switch (adjustment.adjustment_type as AdjustmentType) {
      case "purchase_price":
        for (const line of adjLines) {
          const materialId = line.target_material_id ?? line.entity_id;
          const price = line.unit_price ?? (line.after_value ? Number(line.after_value) : undefined);
          if (materialId && price != null && Number.isFinite(price)) model.projectedPurchasePrices.set(materialId, price);
        }
        break;
      case "purchase_qty":
        for (const line of adjLines) {
          const materialId = line.target_material_id ?? line.entity_id;
          const qty = line.quantity ?? (line.after_value ? Number(line.after_value) : undefined);
          if (materialId && qty != null && Number.isFinite(qty) && qty >= 0) model.projectedPurchaseQuantities.set(materialId, qty);
          if (materialId && line.unit_price != null && Number.isFinite(line.unit_price)) model.projectedPurchasePrices.set(materialId, line.unit_price);
        }
        break;
      case "inventory_qty":
        for (const line of adjLines) {
          const qty = line.quantity ?? (line.after_value ? Number(line.after_value) : undefined);
          if (line.entity_id && qty != null && Number.isFinite(qty)) model.inventoryOverrides.set(line.entity_id, qty);
        }
        break;
      case "batch_adjust":
        for (const line of adjLines) {
          const qty = line.quantity ?? (line.after_value ? Number(line.after_value) : undefined);
          if (line.entity_id && qty != null && Number.isFinite(qty) && qty >= 0) model.batchOverrides.set(line.entity_id, qty);
        }
        break;
      case "issue_qty":
        for (const line of adjLines) {
          const materialId = line.target_material_id ?? line.source_material_id;
          const qty = line.quantity ?? (line.after_value ? Number(line.after_value) : undefined);
          if (line.entity_id && materialId && qty != null && Number.isFinite(qty) && qty >= 0) {
            model.issueQtyOverrides.set(`${line.entity_id}:${materialId}`, qty);
          }
        }
        break;
      case "production_qty":
        for (const line of adjLines) {
          const qty = line.quantity ?? (line.after_value ? Number(line.after_value) : undefined);
          if (line.entity_id && qty != null && Number.isFinite(qty) && qty > 0) model.productionQtyOverrides.set(line.entity_id, qty);
        }
        break;
      case "process_fee_loss":
        for (const line of adjLines) {
          const value = line.unit_price ?? (line.after_value ? Number(line.after_value) : undefined);
          if (!line.entity_id || value == null || !Number.isFinite(value)) continue;
          if (line.field_code === "loss_rate") model.lossRateOverrides.set(line.entity_id, value);
          else model.processFeeOverrides.set(line.entity_id, value);
        }
        break;
      case "bom_ratio":
        for (const line of adjLines) {
          const targetMaterial = line.target_material_id;
          const newQty = line.quantity ?? (line.after_value ? Number(line.after_value) : undefined);
          if (targetMaterial && newQty != null && Number.isFinite(newQty)) {
            const productId = line.entity_id;
            if (productId) {
              model.bomComponentOverrides.set(`${productId}:${targetMaterial}`, newQty);
              model.bomAddedComponents.push({ productId, materialId: targetMaterial, qtyPer: newQty, isPrimary: false });
            }
          }
        }
        break;
      case "material_substitute":
        for (const line of adjLines) {
          if (line.source_material_id && line.target_material_id) {
            model.materialSubstitutions.push({
              adjustmentId: adjustment.id,
              lineId: line.id,
              entityType: line.entity_type,
              entityId: line.entity_id,
              sourceMaterialId: line.source_material_id,
              targetMaterialId: line.target_material_id,
              quantity: line.quantity,
            });
          }
        }
        break;
      default:
        break;
    }
  }
}

function activeBomLines(model: AdjustedModel): BomLineInput[] {
  const inputs: BomLineInput[] = [];
  const seen = new Set<string>();
  for (const line of model.bomLines) {
    const parentProductId = str(line, "parent_product_id");
    const componentId = str(line, "component_id");
    const removed = model.bomRemovedComponents.some((item) => item.productId === parentProductId && item.materialId === componentId);
    if (removed) continue;
    const componentType = str(line, "component_type", "material") as "material" | "product";
    const override = model.bomComponentOverrides.get(`${parentProductId}:${componentId}`);
    inputs.push({
      parentProductId,
      componentType,
      componentId,
      qtyPer: override != null ? override : num(line, "qty_per", 0),
      isPrimary: Boolean(num(line, "is_primary", 0)),
    });
    seen.add(`${parentProductId}:${componentId}`);
  }
  for (const added of model.bomAddedComponents) {
    const key = `${added.productId}:${added.materialId}`;
    if (seen.has(key)) continue;
    inputs.push({ parentProductId: added.productId, componentType: "material", componentId: added.materialId, qtyPer: added.qtyPer, isPrimary: added.isPrimary });
    seen.add(key);
  }
  return inputs;
}

type ExpandedMaterial = { materialId: string; requiredQty: number; isPrimary: boolean };

function issuedMaterialsForProductionOrder(model: AdjustedModel, productionOrderId: string) {
  const requisitionIds = model.requisitions
    .filter((row) => str(row, "production_order_id") === productionOrderId)
    .map((row) => str(row, "id"));
  const requisitionIdSet = new Set(requisitionIds);
  const issuedByMaterial = new Map<string, number>();
  for (const line of model.requisitionLines) {
    if (!requisitionIdSet.has(str(line, "requisition_id"))) continue;
    const materialId = str(line, "material_id");
    const issuedQty = Math.max(0, num(line, "issued_qty", 0));
    issuedByMaterial.set(materialId, roundQty((issuedByMaterial.get(materialId) ?? 0) + issuedQty));
  }
  return { requisitionIds, issuedByMaterial };
}

function applyMaterialSubstitutions(
  model: AdjustedModel,
  productionOrderId: string,
  productId: string,
  materials: ExpandedMaterial[],
): { materials: ExpandedMaterial[]; primaryMaterialQty: number; results: MaterialSubstitutionResult[] } {
  const materialMap = new Map(materials.map((material) => [material.materialId, { ...material }]));
  const { requisitionIds, issuedByMaterial } = issuedMaterialsForProductionOrder(model, productionOrderId);
  const results: MaterialSubstitutionResult[] = [];

  for (const rule of model.materialSubstitutions) {
    const matchesScope =
      (rule.entityType === "production_order" && rule.entityId === productionOrderId) ||
      (rule.entityType === "product" && rule.entityId === productId);
    if (!matchesScope || rule.sourceMaterialId === rule.targetMaterialId) continue;
    const source = materialMap.get(rule.sourceMaterialId);
    if (!source || source.requiredQty <= 0) continue;
    const target = materialMap.get(rule.targetMaterialId) ?? {
      materialId: rule.targetMaterialId,
      requiredQty: 0,
      isPrimary: source.isPrimary,
    };
    const requestedQty = rule.quantity == null ? source.requiredQty : Math.max(0, rule.quantity);
    const substituteQty = roundQty(Math.min(source.requiredQty, requestedQty));
    if (substituteQty <= 0) continue;
    const sourceBefore = source.requiredQty;
    const targetBefore = target.requiredQty;
    source.requiredQty = roundQty(source.requiredQty - substituteQty);
    target.requiredQty = roundQty(target.requiredQty + substituteQty);
    target.isPrimary = target.isPrimary || source.isPrimary;
    materialMap.set(rule.sourceMaterialId, source);
    materialMap.set(rule.targetMaterialId, target);
    results.push({
      ...rule,
      productionOrderId,
      productId,
      substituteQty,
      sourceRequiredBefore: sourceBefore,
      sourceRequiredAfter: source.requiredQty,
      targetRequiredBefore: targetBefore,
      targetRequiredAfter: target.requiredQty,
      issuedSourceQty: issuedByMaterial.get(rule.sourceMaterialId) ?? 0,
      issuedTargetQty: issuedByMaterial.get(rule.targetMaterialId) ?? 0,
      requisitionIds,
    });
  }

  const nextMaterials = [...materialMap.values()]
    .filter((material) => material.requiredQty > 0)
    .sort((a, b) => a.materialId.localeCompare(b.materialId));
  return {
    materials: nextMaterials,
    primaryMaterialQty: roundQty(
      nextMaterials.reduce((sum, material) => sum + (material.isPrimary ? material.requiredQty : 0), 0),
    ),
    results,
  };
}

function batchesForMaterial(model: AdjustedModel, materialId: string): FifoBatch[] {
  const override = model.inventoryOverrides.get(materialId);
  if (override != null) return [{ batchId: `override-${materialId}`, availableQty: override, receivedAt: "1970-01-01T00:00:00.000Z" }];
  return model.materialBatches
    .filter((batch) => str(batch, "material_id") === materialId && num(batch, "qty") > 0)
    .map((batch) => ({
      batchId: str(batch, "id"),
      availableQty: model.batchOverrides.get(str(batch, "id")) ?? num(batch, "qty"),
      receivedAt: str(batch, "received_at", ""),
    }));
}

function batchUnitCost(model: AdjustedModel, batchId: string, materialId: string): number {
  if (batchId.startsWith("override-")) return num(model.materials.get(materialId), "average_cost", 0);
  const batch = model.materialBatches.find((b) => str(b, "id") === batchId);
  return num(batch, "unit_cost", 0);
}

function projectedPurchasePrice(model: AdjustedModel, materialId: string): number {
  const override = model.projectedPurchasePrices.get(materialId);
  if (override != null) return override;
  return num(model.materials.get(materialId), "average_cost", 0);
}

type Allocation = {
  productionOrderId: string;
  materialId: string;
  batchId: string;
  allocatedQty: number;
  unitCost: number;
  isProjected: boolean;
};

type CostResult = {
  productionOrderId: string;
  productId: string;
  materialCost: number;
  processingCost: number;
  totalCost: number;
  finishedQty: number;
  unitCost: number;
  yieldRate: number;
  baselineMaterialCost: number;
  baselineTotalCost: number;
};

type GapResult = {
  materialId: string;
  requiredQty: number;
  availableQty: number;
  shortageQty: number;
  projectedPurchaseQty: number;
  projectedUnitCost: number;
  lineAmount: number;
};

function buildSimulationDocumentSpecs(
  adjustments: ParallelAdjustmentRow[],
  substitutionResults: MaterialSubstitutionResult[],
  gapByMaterial: Map<string, GapResult>,
  costResults: CostResult[],
  model: AdjustedModel,
): ParallelSimulationDocumentSpec[] {
  const adjustmentById = new Map(adjustments.map((adjustment) => [adjustment.id, adjustment]));
  const specs: ParallelSimulationDocumentSpec[] = [];

  substitutionResults.forEach((result, index) => {
    const adjustment = adjustmentById.get(result.adjustmentId);
    const businessDate = adjustment?.effective_at ?? new Date().toISOString().slice(0, 10);
    const baseSequence = index * 100;
    const sourceMaterial = model.materials.get(result.sourceMaterialId);
    const targetMaterial = model.materials.get(result.targetMaterialId);
    const sourceName = str(sourceMaterial, "name", result.sourceMaterialId);
    const targetName = str(targetMaterial, "name", result.targetMaterialId);
    const key = (documentType: string) => `${result.adjustmentId}:${result.productionOrderId}:${result.targetMaterialId}:${documentType}`;
    const bomKey = key("bom_change");

    specs.push({
      generationKey: bomKey,
      documentType: "bom_change",
      businessDate,
      sequenceNo: baseSequence + 10,
      title: `${targetName}配方变更单`,
      payload: {
        production_order_id: result.productionOrderId,
        product_id: result.productId,
        source_material_id: result.sourceMaterialId,
        source_material_name: sourceName,
        target_material_id: result.targetMaterialId,
        target_material_name: targetName,
        substitute_qty: result.substituteQty,
        effective_date: businessDate,
      },
      sourceAdjustmentId: result.adjustmentId,
    });

    const gap = gapByMaterial.get(result.targetMaterialId);
    let receiptKey: string | null = null;
    if (gap && gap.shortageQty > 0) {
      const requisitionKey = key("purchase_requisition");
      const orderKey = key("purchase_order");
      const arrivalKey = key("purchase_arrival");
      receiptKey = key("purchase_receipt");
      specs.push(
        {
          generationKey: requisitionKey,
          documentType: "purchase_requisition",
          businessDate,
          sequenceNo: baseSequence + 20,
          dependencyKeys: [bomKey],
          title: `${targetName}采购申请`,
          payload: {
            material_id: result.targetMaterialId,
            material_name: targetName,
            quantity: gap.projectedPurchaseQty,
            estimated_unit_cost: gap.projectedUnitCost,
            amount: gap.lineAmount,
            required_date: businessDate,
            production_order_id: result.productionOrderId,
          },
          sourceAdjustmentId: result.adjustmentId,
        },
        {
          generationKey: orderKey,
          documentType: "purchase_order",
          businessDate,
          sequenceNo: baseSequence + 30,
          dependencyKeys: [requisitionKey],
          title: `${targetName}采购订单`,
          payload: {
            material_id: result.targetMaterialId,
            material_name: targetName,
            quantity: gap.projectedPurchaseQty,
            purchase_requisition_key: requisitionKey,
          },
          requiredFields: ["supplier_id", "unit_price", "planned_arrival_date"],
          sourceAdjustmentId: result.adjustmentId,
        },
        {
          generationKey: arrivalKey,
          documentType: "purchase_arrival",
          businessDate,
          sequenceNo: baseSequence + 40,
          dependencyKeys: [orderKey],
          title: `${targetName}采购到货单`,
          payload: {
            material_id: result.targetMaterialId,
            material_name: targetName,
            purchase_order_key: orderKey,
          },
          requiredFields: ["arrival_date", "actual_qty"],
          sourceAdjustmentId: result.adjustmentId,
        },
        {
          generationKey: receiptKey,
          documentType: "purchase_receipt",
          businessDate,
          sequenceNo: baseSequence + 50,
          dependencyKeys: [arrivalKey],
          title: `${targetName}采购入库单`,
          payload: {
            material_id: result.targetMaterialId,
            material_name: targetName,
            purchase_arrival_key: arrivalKey,
          },
          requiredFields: ["receipt_date", "actual_qty", "batch_no", "warehouse_id"],
          sourceAdjustmentId: result.adjustmentId,
        },
      );
    }

    const returnQty = roundQty(Math.max(0, result.issuedSourceQty - result.sourceRequiredAfter));
    const returnKey = key("material_return");
    if (returnQty > 0) {
      specs.push({
        generationKey: returnKey,
        documentType: "material_return",
        businessDate,
        sequenceNo: baseSequence + 60,
        dependencyKeys: [bomKey],
        title: `${sourceName}生产退料单`,
        payload: {
          production_order_id: result.productionOrderId,
          requisition_ids: result.requisitionIds,
          material_id: result.sourceMaterialId,
          material_name: sourceName,
          quantity: returnQty,
          business_date: businessDate,
        },
        sourceAdjustmentId: result.adjustmentId,
      });
    }

    const supplementQty = roundQty(Math.max(0, result.targetRequiredAfter - result.issuedTargetQty));
    const supplementKey = key("material_supplement");
    if (supplementQty > 0) {
      specs.push({
        generationKey: supplementKey,
        documentType: "material_supplement",
        businessDate,
        sequenceNo: baseSequence + 70,
        dependencyKeys: receiptKey ? [bomKey, receiptKey] : [bomKey],
        title: `${targetName}生产补料单`,
        payload: {
          production_order_id: result.productionOrderId,
          requisition_ids: result.requisitionIds,
          material_id: result.targetMaterialId,
          material_name: targetName,
          quantity: supplementQty,
          business_date: businessDate,
          inventory_sufficient: !gap,
        },
        sourceAdjustmentId: result.adjustmentId,
      });
    }

    const cost = costResults.find((item) => item.productionOrderId === result.productionOrderId);
    if (cost && roundMoney(cost.totalCost - cost.baselineTotalCost) !== 0) {
      const dependencies = [supplementQty > 0 ? supplementKey : bomKey];
      if (returnQty > 0) dependencies.push(returnKey);
      specs.push({
        generationKey: key("production_cost_adjustment"),
        documentType: "production_cost_adjustment",
        businessDate,
        sequenceNo: baseSequence + 80,
        dependencyKeys: dependencies,
        title: `${result.productionOrderId}工单成本调整单`,
        payload: {
          production_order_id: result.productionOrderId,
          before_total_cost: cost.baselineTotalCost,
          after_total_cost: cost.totalCost,
          adjustment_amount: roundMoney(cost.totalCost - cost.baselineTotalCost),
          business_date: businessDate,
        },
        sourceAdjustmentId: result.adjustmentId,
      });
    }
  });

  return specs.sort((a, b) => a.sequenceNo - b.sequenceNo);
}

function computeBaseline(model: AdjustedModel, productionOrder: NumberRow): { materialCost: number; processingCost: number; total: number } {
  const order = model.orders.get(str(productionOrder, "order_id"));
  if (!order) return { materialCost: 0, processingCost: 0, total: 0 };
  const productId = str(order, "product_id");
  const orderQty = num(order, "qty", 0);
  const product = model.products.get(productId);
  const baselineLines: BomLineInput[] = model.bomLines.map((line) => ({
    parentProductId: str(line, "parent_product_id"),
    componentType: str(line, "component_type", "material") as "material" | "product",
    componentId: str(line, "component_id"),
    qtyPer: num(line, "qty_per", 0),
    isPrimary: Boolean(num(line, "is_primary", 0)),
  }));
  const expansion = expandBom({ rootProductId: productId, quantity: orderQty, lines: baselineLines });
  let materialCost = 0;
  for (const demand of expansion.materials) {
    const material = model.materials.get(demand.materialId);
    materialCost = roundMoney(materialCost + demand.requiredQty * num(material, "average_cost", 0));
  }
  const processingCost = roundMoney(num(product, "process_fee", 0) * orderQty);
  return { materialCost, processingCost, total: roundMoney(materialCost + processingCost) };
}

function clearRunProjections(database: Database.Database, ledgerId: string) {
  const oldRuns = database.prepare("SELECT id FROM parallel_calculation_runs WHERE ledger_id = ?").all(ledgerId) as Array<{ id: string }>;
  // Suggestions reference gaps, so dependent suggestions must be removed first.
  database.prepare("DELETE FROM parallel_suggestions WHERE ledger_id = ?").run(ledgerId);
  if (oldRuns.length > 0) {
    const placeholders = oldRuns.map(() => "?").join(",");
    for (const table of ["parallel_inventory_projections", "parallel_material_allocations", "parallel_cost_projections", "parallel_impacts", "parallel_gaps"]) {
      database.prepare(`DELETE FROM ${table} WHERE run_id IN (${placeholders})`).run(...oldRuns.map((r) => r.id));
    }
  }
  database.prepare("UPDATE parallel_calculation_runs SET stale = 1 WHERE ledger_id = ?").run(ledgerId);
}

export function runParallelCalculation(
  database: Database.Database,
  actorId: string,
  ledgerId: string,
): { runId: string; summary: Record<string, unknown> } {
  const ledger = database.prepare("SELECT * FROM parallel_ledgers WHERE id = ?").get(ledgerId) as
    | { id: string; status: string; working_version: number; name: string; ledger_code: string }
    | undefined;
  if (!ledger) throw new Error("平行账套不存在。");
  if (!["draft", "ready", "calculation_failed"].includes(ledger.status)) {
    throw new Error(`账套当前状态【${ledger.status}】不允许重新测算。`);
  }
  assertTrustedFormalSnapshot(database, ledgerId);

  const startedAt = now();
  const startedMs = Date.now();
  database.prepare("UPDATE parallel_ledgers SET status = 'calculating', updated_at = ? WHERE id = ?").run(startedAt, ledgerId);

  try {
    const store = loadSnapshotStore(database, ledgerId);
    const model = buildModel(store);
    const adjustments = database
      .prepare("SELECT * FROM parallel_adjustments WHERE ledger_id = ? AND status = 'active' ORDER BY created_at")
      .all(ledgerId) as ParallelAdjustmentRow[];
    const adjustmentIds = adjustments.map((a) => a.id);
    const lines: ParallelAdjustmentLineRow[] =
      adjustmentIds.length === 0
        ? []
        : (database.prepare(`SELECT * FROM parallel_adjustment_lines WHERE adjustment_id IN (${adjustmentIds.map(() => "?").join(",")})`).all(...adjustmentIds) as ParallelAdjustmentLineRow[]);
    applyAdjustments(model, adjustments, lines);

    const allocations: Allocation[] = [];
    const costResults: CostResult[] = [];
    const substitutionResults: MaterialSubstitutionResult[] = [];
    const gapByMaterial = new Map<string, GapResult>();
    const issuedByMaterial = new Map<string, number>();
    const projectedInbound = new Map<string, { qty: number; price: number }>();
    const sharedBatchPool = new Map<string, FifoBatch[]>();
    for (const materialId of model.materials.keys()) sharedBatchPool.set(materialId, batchesForMaterial(model, materialId));

    const addProjectedInbound = (materialId: string, qty: number, price: number) => {
      if (qty <= 0) return;
      const current = projectedInbound.get(materialId);
      if (!current) projectedInbound.set(materialId, { qty: roundQty(qty), price });
      else {
        const nextQty = roundQty(current.qty + qty);
        const nextPrice = nextQty > 0 ? roundMoney((current.qty * current.price + qty * price) / nextQty) : price;
        projectedInbound.set(materialId, { qty: nextQty, price: nextPrice });
      }
    };

    for (const [materialId, plannedQty] of model.projectedPurchaseQuantities.entries()) {
      if (plannedQty <= 0) continue;
      const price = projectedPurchasePrice(model, materialId);
      addProjectedInbound(materialId, plannedQty, price);
      const pool = sharedBatchPool.get(materialId) ?? [];
      pool.push({ batchId: `planned-${materialId}`, availableQty: plannedQty, receivedAt: "9998-12-31T00:00:00.000Z" });
      sharedBatchPool.set(materialId, pool);
    }

    const projectionOrders = [...model.productionOrders]
      .filter((productionOrder) => !["shipped", "reversed", "voided", "cancelled"].includes(str(productionOrder, "status")))
      .sort((a, b) => str(a, "created_at").localeCompare(str(b, "created_at")) || str(a, "id").localeCompare(str(b, "id")));

    for (const productionOrder of projectionOrders) {
      const order = model.orders.get(str(productionOrder, "order_id"));
      if (!order) continue;
      const productId = str(order, "product_id");
      const productionOrderId = str(productionOrder, "id");
      const orderQty = model.productionQtyOverrides.get(productionOrderId) ?? num(order, "qty", 0);
      const product = model.products.get(productId);
      const lossRate = model.lossRateOverrides.get(productId) ?? 0;
      const bomInputs = activeBomLines(model);
      const expandedBom = expandBom({ rootProductId: productId, quantity: roundQty(orderQty * (1 + lossRate)), lines: bomInputs });
      const expansion = applyMaterialSubstitutions(
        model,
        productionOrderId,
        productId,
        expandedBom.materials,
      );
      substitutionResults.push(...expansion.results);
      const baseline = computeBaseline(model, productionOrder);
      const projectedBatchId = (materialId: string) => `projected-${materialId}`;

      let materialCost = 0;
      for (const demand of expansion.materials) {
        const materialId = demand.materialId;
        const requiredQty = model.issueQtyOverrides.get(`${productionOrderId}:${materialId}`) ?? demand.requiredQty;
        const batches = sharedBatchPool.get(materialId) ?? [];
        const firstPass = allocateFifo(batches, requiredQty);
        const price = projectedPurchasePrice(model, materialId);

        let finalAllocations = firstPass.allocations;
        if (firstPass.shortage > 0) {
          const projectedBatch: FifoBatch = { batchId: projectedBatchId(materialId), availableQty: firstPass.shortage, receivedAt: "9999-12-31T00:00:00.000Z" };
          batches.push(projectedBatch);
          finalAllocations = [...firstPass.allocations, { batchId: projectedBatch.batchId, qty: firstPass.shortage }];
          addProjectedInbound(materialId, firstPass.shortage, price);
          const currentGap = gapByMaterial.get(materialId);
          const shortageQty = roundQty((currentGap?.shortageQty ?? 0) + firstPass.shortage);
          const totalRequired = roundQty((currentGap?.requiredQty ?? 0) + requiredQty);
          const totalAvailable = roundQty((currentGap?.availableQty ?? 0) + requiredQty - firstPass.shortage);
          gapByMaterial.set(materialId, {
            materialId,
            requiredQty: totalRequired,
            availableQty: totalAvailable,
            shortageQty,
            projectedPurchaseQty: shortageQty,
            projectedUnitCost: price,
            lineAmount: roundMoney(shortageQty * price),
          });
        }

        for (const alloc of finalAllocations) {
          const isProjected = alloc.batchId === projectedBatchId(materialId) || alloc.batchId === `planned-${materialId}`;
          const unitCost = isProjected ? price : batchUnitCost(model, alloc.batchId, materialId);
          materialCost = roundMoney(materialCost + alloc.qty * unitCost);
          allocations.push({ productionOrderId, materialId, batchId: alloc.batchId, allocatedQty: alloc.qty, unitCost, isProjected });
          issuedByMaterial.set(materialId, roundQty((issuedByMaterial.get(materialId) ?? 0) + alloc.qty));
          const batch = batches.find((item) => item.batchId === alloc.batchId);
          if (batch) batch.availableQty = roundQty(Math.max(0, batch.availableQty - alloc.qty));
        }
      }

      const processFeeOverride = model.processFeeOverrides.get(productId);
      const processFee = processFeeOverride != null ? processFeeOverride : num(product, "process_fee", 0);
      const processingCost = roundMoney(processFee * orderQty);
      const totalCost = roundMoney(materialCost + processingCost);
      const finishedQty = orderQty;
      const unitCost = finishedQty > 0 ? roundMoney(totalCost / finishedQty) : 0;
      const yieldRate = calculateYieldRate({ actualInboundQty: finishedQty, primaryIssuedQty: expansion.primaryMaterialQty });
      costResults.push({ productionOrderId, productId, materialCost, processingCost, totalCost, finishedQty, unitCost, yieldRate, baselineMaterialCost: baseline.materialCost, baselineTotalCost: baseline.total });
    }

    const inventoryEnding = new Map<string, { qty: number; value: number; avgCost: number }>();
    for (const material of model.materials.values()) {
      const materialId = str(material, "id");
      const override = model.inventoryOverrides.get(materialId);
      const stockQty = override != null ? override : num(material, "stock_qty", 0);
      inventoryEnding.set(materialId, { qty: stockQty, value: roundMoney(stockQty * num(material, "average_cost", 0)), avgCost: num(material, "average_cost", 0) });
    }
    for (const [materialId, inbound] of projectedInbound.entries()) {
      const ending = inventoryEnding.get(materialId);
      if (!ending) continue;
      const moved = calculateMovingAverage({ currentQty: ending.qty, currentAverageCost: ending.avgCost, incomingQty: inbound.qty, incomingUnitCost: inbound.price });
      ending.qty = roundQty(ending.qty + inbound.qty);
      ending.avgCost = moved.nextAverageCost;
      ending.value = roundMoney(ending.qty * ending.avgCost);
    }
    for (const [materialId, issued] of issuedByMaterial.entries()) {
      const ending = inventoryEnding.get(materialId);
      if (!ending) continue;
      ending.qty = roundQty(Math.max(0, ending.qty - issued));
      ending.value = roundMoney(ending.qty * ending.avgCost);
    }

    const runId = uid("PRUN");
    const inputHash = `${ledgerId}:v${ledger.working_version}:${adjustments.length}:${lines.length}`;
    const finishedAt = now();
    const durationMs = Date.now() - startedMs;
    const summary = {
      productionOrderCount: costResults.length,
      adjustmentCount: adjustments.length,
      gapCount: gapByMaterial.size,
      totalMaterialCost: roundMoney(costResults.reduce((s, c) => s + c.materialCost, 0)),
      totalCost: roundMoney(costResults.reduce((s, c) => s + c.totalCost, 0)),
      baselineTotalCost: roundMoney(costResults.reduce((s, c) => s + c.baselineTotalCost, 0)),
      totalShortageAmount: roundMoney(Array.from(gapByMaterial.values()).reduce((s, g) => s + g.lineAmount, 0)),
    };

    const persist = database.transaction(() => {
      clearRunProjections(database, ledgerId);
      database
        .prepare("INSERT INTO parallel_calculation_runs (id, ledger_id, ledger_version, engine_version, input_hash, status, started_at, finished_at, duration_ms, error_code, error_message, summary_json, created_at, stale) VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, NULL, NULL, ?, ?, 0)")
        .run(runId, ledgerId, ledger.working_version, PARALLEL_ENGINE_VERSION, inputHash, startedAt, finishedAt, durationMs, JSON.stringify(summary), finishedAt);

      const insertAllocation = database.prepare("INSERT INTO parallel_material_allocations (id, run_id, production_order_id, requirement_material_id, issued_material_id, batch_id, allocated_qty, unit_cost, allocation_type, source_adjustment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const alloc of allocations) {
        insertAllocation.run(uid("PMA"), runId, alloc.productionOrderId, alloc.materialId, alloc.materialId, alloc.batchId, alloc.allocatedQty, alloc.unitCost, alloc.isProjected ? "projected_purchase" : "fifo", null);
      }

      const insertCost = database.prepare("INSERT INTO parallel_cost_projections (id, run_id, production_order_id, product_id, material_cost, processing_cost, other_cost, total_cost, finished_qty, unit_cost, yield_rate) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)");
      for (const cost of costResults) {
        insertCost.run(uid("PCP"), runId, cost.productionOrderId, cost.productId, cost.materialCost, cost.processingCost, cost.totalCost, cost.finishedQty, cost.unitCost, cost.yieldRate);
      }

      const insertInventory = database.prepare("INSERT INTO parallel_inventory_projections (id, run_id, ledger_id, warehouse_id, material_id, batch_id, batch_no, quantity, unit_cost, inventory_value, last_movement_at, projection_status) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, 'projected')");
      for (const [materialId, ending] of inventoryEnding.entries()) {
        insertInventory.run(uid("PIP"), runId, ledgerId, materialId, ending.qty, ending.avgCost, ending.value, finishedAt);
      }

      writeImpactsAndGaps(
        database,
        runId,
        ledgerId,
        costResults,
        gapByMaterial,
        adjustments,
        model,
        substitutionResults,
      );
      syncParallelSimulationDocuments(
        database,
        ledgerId,
        runId,
        buildSimulationDocumentSpecs(adjustments, substitutionResults, gapByMaterial, costResults, model),
      );
      database.prepare("UPDATE parallel_ledgers SET status = 'ready', engine_version = ?, updated_at = ? WHERE id = ?").run(PARALLEL_ENGINE_VERSION, finishedAt, ledgerId);
      database.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, message, created_at) VALUES (?, ?, 'parallelLedgerRecalculate', 'parallel_ledger', ?, ?, ?)").run(uid("A"), actorId, ledgerId, `重新测算平行账套 ${ledger.ledger_code}：${JSON.stringify(summary)}`, finishedAt);
    });
    persist();

    return { runId, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = now();
    database.prepare("UPDATE parallel_ledgers SET status = 'calculation_failed', updated_at = ? WHERE id = ?").run(finishedAt, ledgerId);
    database.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, message, created_at) VALUES (?, ?, 'parallelLedgerRecalculate', 'parallel_ledger', ?, ?, ?)").run(uid("A"), actorId, ledgerId, `测算失败：${message}`, finishedAt);
    throw error;
  }
}

function writeImpactsAndGaps(
  database: Database.Database,
  runId: string,
  ledgerId: string,
  costResults: CostResult[],
  gapByMaterial: Map<string, GapResult>,
  adjustments: ParallelAdjustmentRow[],
  model: AdjustedModel,
  substitutionResults: MaterialSubstitutionResult[],
) {
  const insertImpact = database.prepare("INSERT INTO parallel_impacts (id, run_id, domain, severity, blocking, entity_type, entity_id, before_value, after_value, delta_value, message, source_adjustment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const addImpact = (domain: ImpactDomain, severity: ImpactSeverity, blocking: boolean, entity_type: string, entity_id: string, before: string, after: string, delta: string, message: string, sourceAdjustmentId: string | null) => {
    insertImpact.run(uid("PIM"), runId, domain, severity, blocking ? 1 : 0, entity_type, entity_id, before, after, delta, message, sourceAdjustmentId);
  };

  const insertGap = database.prepare(`
    INSERT INTO parallel_gaps (
      id, run_id, gap_type, material_id, required_qty, available_qty,
      shortage_qty, required_date, blocking, resolution_status, selected_suggestion_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'open', NULL)
  `);
  const insertSuggestion = database.prepare(`
    INSERT INTO parallel_suggestions (
      id, gap_id, ledger_id, suggestion_type, document_type, payload_json,
      status, confirmed_by, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)
  `);
  const addGapSuggestion = (input: {
    gapType: string;
    materialId: string | null;
    requiredQty: number;
    availableQty: number;
    shortageQty: number;
    blocking: boolean;
    suggestionType: string;
    documentType: string;
    payload: Record<string, unknown>;
  }) => {
    const gapId = uid("PGP");
    const suggestionId = uid("PSG");
    insertGap.run(
      gapId,
      runId,
      input.gapType,
      input.materialId,
      input.requiredQty,
      input.availableQty,
      input.shortageQty,
      input.blocking ? 1 : 0,
    );
    insertSuggestion.run(
      suggestionId,
      gapId,
      ledgerId,
      input.suggestionType,
      input.documentType,
      JSON.stringify(input.payload),
    );
    return { gapId, suggestionId };
  };

  for (const cost of costResults) {
    const delta = roundMoney(cost.totalCost - cost.baselineTotalCost);
    addImpact("cost", delta === 0 ? "info" : delta > 0 ? "warning" : "critical", false, "production_order", cost.productionOrderId, String(cost.baselineTotalCost), String(cost.totalCost), String(delta), `工单总成本 ${cost.baselineTotalCost} → ${cost.totalCost}（Δ${delta > 0 ? "+" : ""}${delta}），单位成本 ${cost.unitCost}`, null);
  }
  for (const [materialId, gap] of gapByMaterial.entries()) {
    const material = model.materials.get(materialId);
    addImpact("inventory", "warning", true, "material", materialId, String(gap.availableQty), String(gap.requiredQty), String(gap.shortageQty), `物料 ${str(material, "name", materialId)} 缺口 ${gap.shortageQty}，建议采购 ${gap.projectedPurchaseQty} @ ${gap.projectedUnitCost}`, null);
    addImpact("purchase", "warning", true, "material", materialId, "0", String(gap.projectedPurchaseQty), String(gap.projectedPurchaseQty), `采购建议：${str(material, "name", materialId)} ${gap.projectedPurchaseQty}${str(material, "unit", "")}，预估金额 ${gap.lineAmount}`, null);
  }
  for (const adjustment of adjustments) {
    addImpact("bom", "info", false, "adjustment", adjustment.id, "", "", "", `调整项 ${adjustment.adjustment_no}：${ADJUSTMENT_TYPE_LABELS[adjustment.adjustment_type as AdjustmentType] ?? adjustment.adjustment_type}（${adjustment.reason || "无说明"}）`, adjustment.id);
  }

  for (const [materialId, gap] of gapByMaterial.entries()) {
    const source = substitutionResults.find((result) => result.targetMaterialId === materialId);
    addGapSuggestion({
      gapType: "purchase_shortage",
      materialId,
      requiredQty: gap.requiredQty,
      availableQty: gap.availableQty,
      shortageQty: gap.shortageQty,
      blocking: true,
      suggestionType: "purchase_requisition",
      documentType: "purchase_requisition",
      payload: {
        material_id: materialId,
        requested_qty: gap.projectedPurchaseQty,
        estimated_unit_cost: gap.projectedUnitCost,
        line_amount: gap.lineAmount,
        source_adjustment_id: source?.adjustmentId ?? null,
        source_adjustment_line_id: source?.lineId ?? null,
        affected_entity_type: "material",
        affected_entity_id: materialId,
        evidence: {
          required_qty: gap.requiredQty,
          available_qty: gap.availableQty,
          shortage_qty: gap.shortageQty,
          calculation_run_id: runId,
        },
      },
    });
  }

  for (const result of substitutionResults) {
    const sourceMaterial = model.materials.get(result.sourceMaterialId);
    const targetMaterial = model.materials.get(result.targetMaterialId);
    const common = {
      production_order_id: result.productionOrderId,
      product_id: result.productId,
      source_material_id: result.sourceMaterialId,
      target_material_id: result.targetMaterialId,
      substitute_qty: result.substituteQty,
      requisition_ids: result.requisitionIds,
      source_adjustment_id: result.adjustmentId,
      source_adjustment_line_id: result.lineId,
    };
    const hasTargetBomBasis = model.bomLines.some(
      (line) =>
        str(line, "parent_product_id") === result.productId &&
        str(line, "component_type", "material") === "material" &&
        str(line, "component_id") === result.targetMaterialId,
    );

    if (!hasTargetBomBasis) {
      addImpact(
        "bom",
        "blocking",
        true,
        "product",
        result.productId,
        result.sourceMaterialId,
        result.targetMaterialId,
        String(result.substituteQty),
        `物料替换缺少正式配方依据：${str(sourceMaterial, "name", result.sourceMaterialId)} → ${str(targetMaterial, "name", result.targetMaterialId)} ${result.substituteQty}`,
        result.adjustmentId,
      );
      addGapSuggestion({
        gapType: "bom_basis_missing",
        materialId: result.targetMaterialId,
        requiredQty: result.substituteQty,
        availableQty: 0,
        shortageQty: result.substituteQty,
        blocking: true,
        suggestionType: "bom_change",
        documentType: "bom_change",
        payload: {
          ...common,
          affected_entity_type: "product",
          affected_entity_id: result.productId,
          evidence: {
            active_target_bom_line_found: false,
            source_required_before: result.sourceRequiredBefore,
            source_required_after: result.sourceRequiredAfter,
            target_required_before: result.targetRequiredBefore,
            target_required_after: result.targetRequiredAfter,
            calculation_run_id: runId,
          },
        },
      });
    }

    const supplementQty = roundQty(Math.max(0, result.targetRequiredAfter - result.issuedTargetQty));
    if (supplementQty > 0) {
      addImpact(
        "production",
        "warning",
        true,
        "production_order",
        result.productionOrderId,
        String(result.issuedTargetQty),
        String(result.targetRequiredAfter),
        String(supplementQty),
        `工单需补领 ${str(targetMaterial, "name", result.targetMaterialId)} ${supplementQty}`,
        result.adjustmentId,
      );
      addGapSuggestion({
        gapType: "material_supplement_needed",
        materialId: result.targetMaterialId,
        requiredQty: result.targetRequiredAfter,
        availableQty: result.issuedTargetQty,
        shortageQty: supplementQty,
        blocking: true,
        suggestionType: "replenish",
        documentType: "material_supplement",
        payload: {
          ...common,
          material_id: result.targetMaterialId,
          suggested_qty: supplementQty,
          affected_entity_type: "production_order",
          affected_entity_id: result.productionOrderId,
          evidence: {
            theoretical_required_qty: result.targetRequiredAfter,
            issued_qty: result.issuedTargetQty,
            calculation_run_id: runId,
          },
        },
      });
    }

    const returnQty = roundQty(Math.max(0, result.issuedSourceQty - result.sourceRequiredAfter));
    if (returnQty > 0) {
      addImpact(
        "production",
        "warning",
        true,
        "production_order",
        result.productionOrderId,
        String(result.issuedSourceQty),
        String(result.sourceRequiredAfter),
        String(returnQty),
        `工单需退回 ${str(sourceMaterial, "name", result.sourceMaterialId)} ${returnQty}`,
        result.adjustmentId,
      );
      addGapSuggestion({
        gapType: "material_return_needed",
        materialId: result.sourceMaterialId,
        requiredQty: result.sourceRequiredAfter,
        availableQty: result.issuedSourceQty,
        shortageQty: returnQty,
        blocking: true,
        suggestionType: "return_material",
        documentType: "material_return",
        payload: {
          ...common,
          material_id: result.sourceMaterialId,
          suggested_qty: returnQty,
          affected_entity_type: "production_order",
          affected_entity_id: result.productionOrderId,
          evidence: {
            theoretical_required_qty: result.sourceRequiredAfter,
            issued_qty: result.issuedSourceQty,
            calculation_run_id: runId,
          },
        },
      });
    }

    const cost = costResults.find((item) => item.productionOrderId === result.productionOrderId);
    if (cost) {
      const deltaAmount = roundMoney(cost.totalCost - cost.baselineTotalCost);
      if (deltaAmount !== 0) {
        addGapSuggestion({
          gapType: "production_cost_changed",
          materialId: null,
          requiredQty: cost.totalCost,
          availableQty: cost.baselineTotalCost,
          shortageQty: Math.abs(deltaAmount),
          blocking: true,
          suggestionType: "order_cost_adjust",
          documentType: "production_cost_adjustment",
          payload: {
            ...common,
            before_total_cost: cost.baselineTotalCost,
            after_total_cost: cost.totalCost,
            delta_amount: deltaAmount,
            affected_entity_type: "production_order",
            affected_entity_id: result.productionOrderId,
            evidence: {
              baseline_material_cost: cost.baselineMaterialCost,
              projected_material_cost: cost.materialCost,
              projected_unit_cost: cost.unitCost,
              calculation_run_id: runId,
            },
          },
        });
      }
    }
  }
}
