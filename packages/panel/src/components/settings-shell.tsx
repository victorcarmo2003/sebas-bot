"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings/account", label: "Conta" },
  { href: "/settings/parameters", label: "Parâmetros" },
  { href: "/settings/opencode", label: "OpenCode" },
  { href: "/settings/marketplace", label: "Marketplace" }
];

// Sidebar vertical, mas dentro do max-w-4xl centralizado do layout do dashboard —
// nao e uma sidebar colada na borda esquerda da tela (pedido explicito do dono).
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex gap-6">
      <nav className="flex w-44 shrink-0 flex-col gap-1">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                active
                  ? "border-gold-dim bg-panel-raised text-parchment"
                  : "border-transparent text-parchment-muted hover:bg-panel-raised hover:text-parchment"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
