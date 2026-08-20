import { NextRequest } from "next/server";
import { getSessionUser } from "./erp-service";

export const SESSION_COOKIE = "erp_session";

export function actorIdFromRequest(request: NextRequest, fallbackActorId?: string) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionUser = getSessionUser(token);
  if (sessionUser) return sessionUser.id;
  // Explicit escape hatch for isolated local automation only. It is disabled
  // by default and must never be enabled on a customer deployment.
  if (process.env.ERP_ALLOW_ACTOR_FALLBACK === "1") return fallbackActorId ?? "";
  return "";
}
