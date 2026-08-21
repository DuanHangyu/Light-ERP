import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/erp-service";
import { reportCatalogEntriesForRole } from "@/lib/erp-report-access";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const actorId = actorIdFromRequest(request);
  if (!actorId) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  try {
    const user = getUser(getDb(), actorId);
    return NextResponse.json(
      { reports: reportCatalogEntriesForRole(user.role) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "无法读取报表目录。" }, { status: 403 });
  }
}
