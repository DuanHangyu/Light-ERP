import { NextRequest, NextResponse } from "next/server";
import { importBomRows, workbookRowsFromBuffer } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const actorId = actorIdFromRequest(request, String(formData.get("actorId") ?? "") || undefined);
    const productId = String(formData.get("productId") ?? "P-FINISHED");
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传 Excel 文件。" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await workbookRowsFromBuffer(buffer, file.name);
    importBomRows({ actorId, productId, rows });
    return NextResponse.json({ ok: true, importedRows: rows.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "BOM 导入失败。" },
      { status: 400 },
    );
  }
}
