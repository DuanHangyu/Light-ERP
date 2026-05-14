import { NextRequest, NextResponse } from "next/server";
import { getSnapshot, importOpeningDataRows, workbookRowsFromBuffer } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const actorId = actorIdFromRequest(request, String(formData.get("actorId") ?? "") || undefined);
    const type = String(formData.get("type") ?? "");
    const file = formData.get("file");
    if (!["opening-inventory", "opening-receivables", "opening-payables"].includes(type)) {
      return NextResponse.json({ error: "初始化导入类型不正确。" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传 Excel 或 CSV 文件。" }, { status: 400 });
    }

    const rows = await workbookRowsFromBuffer(Buffer.from(await file.arrayBuffer()), file.name);
    const result = importOpeningDataRows({
      actorId,
      type: type as Parameters<typeof importOpeningDataRows>[0]["type"],
      rows,
      note: String(formData.get("note") ?? ""),
    });
    return NextResponse.json({ ok: true, ...result, snapshot: getSnapshot(actorId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "初始化导入失败。" },
      { status: 400 },
    );
  }
}
