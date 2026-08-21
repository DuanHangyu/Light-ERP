import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { authenticateUser } from "@/lib/erp-service";
import { SESSION_COOKIE } from "@/lib/request-auth";
import { GET } from "./route";

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-report-catalog-"));
  process.env.ERP_DATA_DIR = dir;
}

describe("GET /api/reports/catalog", () => {
  beforeAll(() => freshDataDir());

  it("returns only the authenticated user's standard report catalog", async () => {
    const login = authenticateUser({ account: "sales", password: "sales123" });
    const request = new NextRequest("http://localhost/api/reports/catalog", {
      headers: { cookie: `${SESSION_COOKIE}=${login.token}` },
    });

    const response = await GET(request);
    const body = (await response.json()) as { reports: Array<{ code: string }> };

    expect(response.status).toBe(200);
    expect(body.reports.map((report) => report.code)).toContain("quote");
    expect(body.reports.map((report) => report.code)).not.toContain("master-suppliers");
    expect(body.reports.map((report) => report.code)).not.toContain("finance");
  });

  it("rejects unauthenticated catalog requests", async () => {
    const response = await GET(new NextRequest("http://localhost/api/reports/catalog"));
    expect(response.status).toBe(401);
  });
});
