import { describe, expect, it } from "vitest";
import { searchErpEntities } from "./erp-search";

const sources = {
  quotes: [{ id: "Q1", quote_no: "BJ-001", customer_name: "上海星河" }],
  orders: [{ id: "O1", order_no: "DD-001", customer_name: "上海星河" }],
  customers: [{ id: "C1", customer_code: "KH-001", name: "上海星河装备" }],
  productions: [{ id: "P1", prod_no: "SC-001", product_name: "齿轮箱" }],
  materials: [{ id: "M1", material_code: "MAT-001", name: "合金钢" }],
  products: [{ id: "PR1", product_code: "CP-001", name: "齿轮箱" }],
  suppliers: [{ id: "S1", supplier_code: "GYS-001", name: "江苏华材" }],
  purchaseOrders: [{ id: "PO1", purchase_no: "CG-001", supplier_name: "江苏华材" }],
  requisitions: [{ id: "R1", req_no: "LL-001", prod_no: "SC-001" }],
  shipments: [{ id: "SH1", shipment_no: "FH-001", order_no: "DD-001" }],
  receivables: [{ id: "AR1", receivable_no: "YS-001", customer_name: "上海星河" }],
  payables: [{ id: "AP1", payable_no: "YF-001", supplier_name: "江苏华材" }],
};

describe("ERP global search", () => {
  it("finds records by document number, code, and name", () => {
    expect(searchErpEntities("admin", sources, "DD-001").map((item) => item.primary)).toContain("DD-001");
    expect(searchErpEntities("admin", sources, "合金钢").map((item) => item.primary)).toContain("合金钢");
    expect(searchErpEntities("admin", sources, "江苏华材").map((item) => item.type)).toEqual(
      expect.arrayContaining(["供应商", "采购单", "应付"]),
    );
  });

  it("filters result domains using the current role navigation", () => {
    const salesResults = searchErpEntities("sales", sources, "江苏华材");
    const purchasingResults = searchErpEntities("purchasing", sources, "江苏华材");

    expect(salesResults).toEqual([]);
    expect(purchasingResults.map((item) => item.module)).toEqual(expect.arrayContaining(["suppliers", "purchase"]));
    expect(purchasingResults.map((item) => item.module)).not.toContain("finance");
  });

  it("does not search until two characters and limits the result set", () => {
    expect(searchErpEntities("admin", sources, "D")).toEqual([]);
    expect(searchErpEntities("admin", sources, "上海", 2)).toHaveLength(2);
  });
});
