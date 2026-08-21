import { describe, expect, it } from "vitest";
import { filterAndPaginateRows } from "./erp-table";

const rows = Array.from({ length: 23 }, (_, index) => ({
  id: index + 1,
  order_no: `DD-${String(index + 1).padStart(3, "0")}`,
  customer_name: index === 12 ? "上海星河" : `客户 ${index + 1}`,
}));

describe("ERP table query and pagination", () => {
  it("searches all primitive values without changing the source rows", () => {
    const result = filterAndPaginateRows(rows, "星河", 1, 10);
    expect(result.total).toBe(1);
    expect(result.rows[0]?.id).toBe(13);
    expect(rows).toHaveLength(23);
  });

  it("paginates without silently truncating rows", () => {
    const first = filterAndPaginateRows(rows, "", 1, 10);
    const last = filterAndPaginateRows(rows, "", 3, 10);
    expect(first.rows).toHaveLength(10);
    expect(last.rows).toHaveLength(3);
    expect(last.pageCount).toBe(3);
    expect(last.total).toBe(23);
  });

  it("clamps an invalid page after filtering", () => {
    const result = filterAndPaginateRows(rows, "星河", 8, 10);
    expect(result.page).toBe(1);
    expect(result.rows).toHaveLength(1);
  });
});
