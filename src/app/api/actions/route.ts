import { NextRequest, NextResponse } from "next/server";
import { getSnapshot, performAction } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      actorId?: string;
      action?: string;
      entityId?: string;
      variant?: string;
      actualQty?: number;
      payload?: Record<string, unknown>;
    };
    const actorId = actorIdFromRequest(request, body.actorId);
    if (!actorId || !body.action) {
      return NextResponse.json({ error: "缺少账号或操作。" }, { status: 400 });
    }
    performAction({
      actorId,
      action: body.action,
      entityId: body.entityId,
      variant: body.variant,
      actualQty: body.actualQty,
      payload: body.payload,
    });
    return NextResponse.json(getSnapshot(actorId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败。" },
      { status: 400 },
    );
  }
}
