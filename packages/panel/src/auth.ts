import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { getWhoAmI, type PermissionScope } from "@/lib/worker-api";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Discord],
  pages: {
    signIn: "/login"
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.providerAccountId) {
        token.discordUserId = account.providerAccountId;
        token.role = undefined;
        token.permissions = undefined;
      }

      if (token.discordUserId && token.role === undefined) {
        try {
          const who = await getWhoAmI(token.discordUserId as string);
          token.role = who.role;
          token.permissions = who.permissions;
        } catch {
          token.role = "none";
          token.permissions = [];
        }
      }

      return token;
    },
    async session({ session, token }) {
      session.discordUserId = token.discordUserId as string | undefined;
      session.role = token.role as "owner" | "subadmin" | "none" | undefined;
      session.permissions = (token.permissions as PermissionScope[] | undefined) ?? [];
      return session;
    }
  }
});
