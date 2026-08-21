export type TablePage<T> = {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
};

export function filterAndPaginateRows<T extends Record<string, unknown>>(
  sourceRows: T[],
  query: string,
  requestedPage: number,
  pageSize: number,
): TablePage<T> {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const filteredRows = normalizedQuery
    ? sourceRows.filter((row) =>
        Object.values(row)
          .filter((value) => ["string", "number", "boolean"].includes(typeof value))
          .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(normalizedQuery)),
      )
    : [...sourceRows];
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / safePageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), pageCount);
  const offset = (page - 1) * safePageSize;
  return {
    rows: filteredRows.slice(offset, offset + safePageSize),
    total: filteredRows.length,
    page,
    pageCount,
  };
}
