import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, getSnapshot } from "@/lib/erp-service";
import { SESSION_COOKIE } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { account?: string; password?: string };
    if (!body.account || !body.password) {
      return NextResponse.json({ error: "请输入账号和密码。" }, { status: 400 });
    }
    const login = authenticateUser({ account: body.account, password: body.password });
    const response = NextResponse.json(getSnapshot(login.user.id));
    response.cookies.set(SESSION_COOKIE, login.token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败。" },
      { status: 401 },
    );
  }
}
