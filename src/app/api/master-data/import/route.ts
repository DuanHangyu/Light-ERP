import { NextRequest, NextResponse } from "next/server";
import { getSnapshot, ImportValidationError, importMasterDataRows, validateMasterDataRows, workbookRowsFromBuffer } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const actorId = actorIdFromRequest(request, String(formData.get("actorId") ?? "") || undefined);
    const type = String(formData.get("type") ?? "");
    const mode = String(formData.get("mode") ?? "import");
    const file = formData.get("file");
    if (!["customers", "suppliers", "materials", "products", "boms"].includes(type)) {
      return NextResponse.json({ error: "主数据类型不正确。" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传 Excel 或 CSV 文件。" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await workbookRowsFromBuffer(buffer, file.name);
    if (mode === "validate") {
      const result = validateMasterDataRows({
        actorId,
        type: type as Parameters<typeof importMasterDataRows>[0]["type"],
        rows,
        sourceName: file.name,
      });
      return NextResponse.json({ ...result, snapshot: getSnapshot(actorId) });
    }
    const result = importMasterDataRows({
      actorId,
      type: type as Parameters<typeof importMasterDataRows>[0]["type"],
      rows,
      sourceName: file.name,
    });
    return NextResponse.json({ ok: true, ...result, snapshot: getSnapshot(actorId) });
  } catch (error) {
    if (error instanceof ImportValidationError) {
      return NextResponse.json(
        { error: error.message, validation: error.result, errors: error.result.errors },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "主数据导入失败。" },
      { status: 400 },
    );
  }
}
