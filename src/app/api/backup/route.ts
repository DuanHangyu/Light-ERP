import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { createBackup } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actorId = actorIdFromRequest(request, request.nextUrl.searchParams.get("actorId") ?? undefined);
    const backup = await createBackup(actorId);
    return new NextResponse(new Uint8Array(fs.readFileSync(backup.path)), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(backup.fileName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "备份失败。" },
      { status: 400 },
    );
  }
}
