import { NextRequest, NextResponse } from "next/server";
import { previewSupplierAdmissionRuleImpact } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actorId = actorIdFromRequest(request, request.nextUrl.searchParams.get("actorId") ?? undefined);
    if (!actorId) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    const ruleId = request.nextUrl.searchParams.get("ruleId") || undefined;
    const payload = {
      rule_code: request.nextUrl.searchParams.get("rule_code") ?? "",
      rule_name: request.nextUrl.searchParams.get("rule_name") ?? "",
      metric_key: request.nextUrl.searchParams.get("metric_key") ?? "",
      operator: request.nextUrl.searchParams.get("operator") ?? "",
      threshold_value: request.nextUrl.searchParams.get("threshold_value") ?? "",
      target_status: request.nextUrl.searchParams.get("target_status") ?? "",
      require_correction: request.nextUrl.searchParams.get("require_correction") ?? "",
      priority: request.nextUrl.searchParams.get("priority") ?? "",
      status: request.nextUrl.searchParams.get("status") ?? "",
      description: request.nextUrl.searchParams.get("description") ?? "",
    };
    return NextResponse.json(previewSupplierAdmissionRuleImpact({ actorId, ruleId, payload }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "供应商准入规则影响预览失败。" },
      { status: 400 },
    );
  }
}
