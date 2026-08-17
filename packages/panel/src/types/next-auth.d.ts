import type { PermissionScope } from "@/lib/worker-api";

declare module "next-auth" {
  interface Session {
    discordUserId?: string;
    role?: "owner" | "subadmin" | "none";
    permissions: PermissionScope[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    discordUserId?: string;
    role?: "owner" | "subadmin" | "none";
    permissions?: PermissionScope[];
  }
}
