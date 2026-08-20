import { NextRequest, NextResponse } from "next/server";
import { buildExport } from "@/lib/erp-service";
import { getDb } from "@/lib/db";
import { actorIdFromRequest } from "@/lib/request-auth";
import { buildParallelExport, isParallelExportType } from "@/lib/parallel-export-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actorId = actorIdFromRequest(request, request.nextUrl.searchParams.get("actorId") ?? undefined);
    const rawType = request.nextUrl.searchParams.get("type") ?? "finance";
    const format = (request.nextUrl.searchParams.get("format") ?? "xlsx") as "xlsx" | "csv";
    const entityId = request.nextUrl.searchParams.get("entityId") ?? undefined;
    const filters = {
      dateFrom: request.nextUrl.searchParams.get("dateFrom") ?? undefined,
      dateTo: request.nextUrl.searchParams.get("dateTo") ?? undefined,
      customerId: request.nextUrl.searchParams.get("customerId") ?? undefined,
      supplierId: request.nextUrl.searchParams.get("supplierId") ?? undefined,
      materialId: request.nextUrl.searchParams.get("materialId") ?? undefined,
      orderId: request.nextUrl.searchParams.get("orderId") ?? undefined,
      purchaseOrderId: request.nextUrl.searchParams.get("purchaseOrderId") ?? undefined,
    };
    if (isParallelExportType(rawType)) {
      if (!entityId) throw new Error("导出平行账套报表需要指定账套编号。");
      const result = buildParallelExport(getDb(), actorId, entityId, rawType);
      return new NextResponse(new Uint8Array(result.buffer), {
        headers: {
          "Content-Type": result.contentType,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(result.fileName)}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const type = rawType as Parameters<typeof buildExport>[0]["type"];
    const result = await buildExport({ actorId, type, format, entityId, filters });
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(result.fileName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导出失败。" },
      { status: 400 },
    );
  }
}
