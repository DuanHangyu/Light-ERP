import { NextRequest } from "next/server";
import { getSessionUser } from "./erp-service";

export const SESSION_COOKIE = "erp_session";

export function actorIdFromRequest(request: NextRequest, fallbackActorId?: string) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionUser = getSessionUser(token);
  return sessionUser?.id ?? fallbackActorId ?? "";
}
