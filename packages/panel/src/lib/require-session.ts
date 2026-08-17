import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { PermissionScope } from "@/lib/worker-api";

export interface ActiveSession {
  discordUserId: string;
  role: "owner" | "subadmin";
  permissions: PermissionScope[];
}

export async function requireSession(scope?: PermissionScope): Promise<ActiveSession> {
  const session = await auth();
  if (!session?.discordUserId || !session.role || session.role === "none") {
    redirect("/no-access");
  }

  const isOwner = session.role === "owner";
  if (scope && !isOwner && !session.permissions.includes(scope)) {
    redirect("/");
  }

  return { discordUserId: session.discordUserId, role: session.role, permissions: session.permissions };
}
