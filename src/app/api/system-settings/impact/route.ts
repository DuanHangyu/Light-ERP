import { NextRequest, NextResponse } from "next/server";
import { previewSystemSettingImpact } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actorId = actorIdFromRequest(request, request.nextUrl.searchParams.get("actorId") ?? undefined);
    const settingKey = request.nextUrl.searchParams.get("settingKey") ?? "";
    const settingValue = request.nextUrl.searchParams.get("settingValue") ?? "";
    if (!actorId) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    if (!settingKey || !settingValue) return NextResponse.json({ error: "缺少系统参数或预览值。" }, { status: 400 });
    return NextResponse.json(previewSystemSettingImpact({ actorId, settingKey, settingValue }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "参数影响预览失败。" },
      { status: 400 },
    );
  }
}
