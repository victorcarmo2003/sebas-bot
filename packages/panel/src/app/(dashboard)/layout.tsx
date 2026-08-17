import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { SebasSeal } from "@/components/sebas-seal";
import type { PermissionScope } from "@/lib/worker-api";

const NAV_ITEMS: Array<{ href: string; label: string; scope?: PermissionScope }> = [
  { href: "/", label: "Dashboard" },
  { href: "/guilds", label: "Guilds", scope: "guilds:view" },
  { href: "/history", label: "Histórico", scope: "history:view" },
  { href: "/logs", label: "Logs", scope: "logs:view" },
  { href: "/modules", label: "Módulos", scope: "modules:manage" },
  { href: "/admins", label: "Admins", scope: "admins:manage" },
  { href: "/settings", label: "Configurações" }
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.role || session.role === "none") {
    redirect("/no-access");
  }

  const permissions = session.permissions;
  const isOwner = session.role === "owner";
  const visibleItems = NAV_ITEMS.filter((item) => !item.scope || isOwner || permissions.includes(item.scope));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-brass bg-panel px-5">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 py-2.5">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <SebasSeal size={24} />
              <span className="font-display text-base text-parchment">Sebas</span>
            </div>
            <nav className="flex items-center gap-0.5">
              {visibleItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2.5 py-1.5 text-sm text-parchment-muted transition-colors hover:bg-panel-raised hover:text-parchment"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[0.68rem] uppercase tracking-[0.14em] text-parchment-dim">
              {isOwner ? "Dono" : "Subadmin"}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button type="submit" className="text-sm text-parchment-dim transition-colors hover:text-parchment">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
