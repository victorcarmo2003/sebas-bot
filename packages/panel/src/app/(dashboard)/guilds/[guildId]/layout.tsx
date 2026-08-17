import Link from "next/link";
import { TabLink } from "@/components/tab-link";

const TABS = [
  { segment: "", label: "Visão geral" },
  { segment: "settings", label: "Configurações" },
  { segment: "features", label: "Features" },
  { segment: "history", label: "Histórico" }
];

export default async function GuildLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const base = `/guilds/${guildId}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/guilds" className="text-parchment-dim hover:text-parchment">
          Guilds
        </Link>
        <span className="text-parchment-dim">/</span>
        <span className="font-mono text-parchment-dim">{guildId}</span>
      </div>

      <nav className="flex items-center gap-1 border-b border-brass">
        {TABS.map((tab) => (
          <TabLink key={tab.segment} href={`${base}${tab.segment ? `/${tab.segment}` : ""}`} label={tab.label} />
        ))}
      </nav>

      {children}
    </div>
  );
}
