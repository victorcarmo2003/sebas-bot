import { SettingsShell } from "@/components/settings-shell";
import { requireSession } from "@/lib/require-session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return <SettingsShell>{children}</SettingsShell>;
}
