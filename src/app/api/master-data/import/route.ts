import { NextRequest, NextResponse } from "next/server";
import { getSnapshot, importMasterDataRows, workbookRowsFromBuffer } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const actorId = actorIdFromRequest(request, String(formData.get("actorId") ?? "") || undefined);
    const type = String(formData.get("type") ?? "");
    const file = formData.get("file");
    if (!["customers", "suppliers", "materials", "products", "boms"].includes(type)) {
      return NextResponse.json({ error: "主数据类型不正确。" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传 Excel 或 CSV 文件。" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await workbookRowsFromBuffer(buffer, file.name);
    const result = importMasterDataRows({
      actorId,
      type: type as Parameters<typeof importMasterDataRows>[0]["type"],
      rows,
    });
    return NextResponse.json({ ok: true, ...result, snapshot: getSnapshot(actorId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "主数据导入失败。" },
      { status: 400 },
    );
  }
}
