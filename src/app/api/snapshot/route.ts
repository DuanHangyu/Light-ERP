import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actorId = actorIdFromRequest(request, request.nextUrl.searchParams.get("actorId") ?? undefined);
    if (!actorId) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    return NextResponse.json(getSnapshot(actorId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取数据失败。" },
      { status: 500 },
    );
  }
}
