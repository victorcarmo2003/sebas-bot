import { sendDiscordDirectMessage } from "../discord/client.js";
import type { PendingAction } from "./repo.js";

export async function notifyDiscordUserOfPendingAction(botToken: string, dashboardUrl: string, action: PendingAction): Promise<void> {
  if (!action.targetDiscordUserId) {
    return;
  }
  const link = `${dashboardUrl.replace(/\/$/, "")}/notifications`;
  const content = [`Pendencia no Sebas: ${action.title}`, action.message, `Resolva no painel: ${link}`].join("\n\n");
  await sendDiscordDirectMessage(botToken, action.targetDiscordUserId, content);
}
