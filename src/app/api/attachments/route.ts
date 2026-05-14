import { NextRequest, NextResponse } from "next/server";
import { createDocumentAttachment, getDocumentAttachmentFile, getSnapshot } from "@/lib/erp-service";
import { actorIdFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const actorId = actorIdFromRequest(request, String(form.get("actorId") ?? ""));
    const file = form.get("file");
    if (!actorId || !(file instanceof File)) {
      return NextResponse.json({ error: "缺少账号或附件文件。" }, { status: 400 });
    }
    await createDocumentAttachment({
      actorId,
      entityType: String(form.get("entityType") ?? "other"),
      entityId: String(form.get("entityId") ?? "") || undefined,
      entityNo: String(form.get("entityNo") ?? ""),
      category: String(form.get("category") ?? ""),
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      note: String(form.get("note") ?? ""),
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(getSnapshot(actorId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "附件上传失败。" },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const actorId = actorIdFromRequest(request, request.nextUrl.searchParams.get("actorId") ?? undefined);
    const id = request.nextUrl.searchParams.get("id");
    if (!actorId || !id) {
      return NextResponse.json({ error: "缺少账号或附件编号。" }, { status: 400 });
    }
    const file = getDocumentAttachmentFile(actorId, id);
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "附件下载失败。" },
      { status: 400 },
    );
  }
}
