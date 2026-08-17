"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className={`rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-gold text-parchment"
          : "border-transparent text-parchment-muted hover:bg-panel-raised hover:text-parchment"
      }`}
    >
      {label}
    </Link>
  );
}
