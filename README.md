HUMAN DOC: https://victorcarmo2003.github.io/sebas-bot/human/
AI DOC: https://victorcarmo2003.github.io/sebas-bot/ai/


# sebas-bot

Monorepo do Sebas — core, painel e módulos, reconstruído em 2026-08-16/17 a partir do que rodava em produção sem nenhum código-fonte versionado (ver `MILESTONES.md` pro histórico completo da investigação e da reescrita, e `C:\Users\hakor\.claude\plans\harmonic-frolicking-map.md` pro plano de arquitetura aprovado).

## O que é o Sebas

Plataforma de bot Discord modular, em 3 partes, todas neste repo (npm workspaces):

1. **`packages/core`** (`@sebas-bot/core`) — processo Node/TypeScript que recebe interactions do Discord, expõe a admin API e roda os módulos. Dois entrypoints: `bin/bot.ts` (webhook + API) e `bin/worker.ts` (cron + fila).
2. **`packages/panel`** (`@sebas-bot/panel`) — Next.js, dashboard que administra guilds, módulos, histórico, logs e sub-admins, falando com o core via API REST (`SEBAS_CORE_API_URL` + secret Bearer).
3. **`packages/modules/changelog-roblox`** (`@sebas-bot/module-changelog-roblox`) — módulo in-tree, monitora changelog do Roblox via RSS e posta no Discord. Roda sandboxado numa `worker_threads` própria, contra o contrato `SebasModuleContext` (ver `packages/core/src/core/modules/`).

Módulos de terceiros não vivem neste repo — são instalados dinamicamente via `POST /api/admin/modules/install` (clone do repo, build, self-test em sandbox, aprovação de permissões pelo dono). Ver `packages/core/src/core/modules/installer.ts`.

## Rodando localmente

```
npm install                                              # na raiz, resolve os 3 workspaces
npm run build --workspace=@sebas-bot/module-changelog-roblox   # builda o modulo antes do core (o core carrega o dist/ dele)
npm run migrate --workspace=@sebas-bot/core               # aplica migrations num data/sebas.db novo
npm run dev:bot --workspace=@sebas-bot/core                # bin/bot.ts, precisa de .env (ver .env.example)
npm run dev:worker --workspace=@sebas-bot/core              # bin/worker.ts, cron + fila
npm run dev --workspace=@sebas-bot/panel                   # painel Next.js
```

`packages/core` precisa de `.env` com `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `OWNER_DISCORD_ID`, `ADMIN_API_SECRET` — não versionado, não existe `.env.example` ainda (todo). `BOT_PORT` (padrão 8080) e `MCP_PORT` (padrão 8090) são opcionais.

## Tool calling, MCP e Skills

Sebas tem um "mordomo" que conversa via `/sebas` no Discord, usando tool calling real (formato OpenAI-compatible — mesmo que OpenCode Zen/DeepSeek falam) contra um registry central de tools:

- `packages/core/src/core/tools/registry.ts` — agrega tools de módulos (`module:<id>:<tool>`), skills (`skill:<tool>`) e servidores MCP externos (`mcp:<serverId>:<tool>`) sob nomes únicos.
- `packages/core/src/core/ai/agent-loop.ts` — loop multi-turno: chama a IA com as tools do registry, executa as que ela pedir, devolve o resultado, repete até resposta final.
- `packages/core/src/core/tools/skills.ts` + `packages/core/skills/*.md` — pacotes de instrução carregados sob demanda (`list_skills`/`load_skill`), igual Claude Skills.
- `packages/core/src/core/mcp/` — Sebas é cliente E servidor MCP: `client.ts` conecta em servidores MCP externos (stdio/HTTP, configurados em `mcp_servers`, rotas `/api/admin/mcp/servers`) como fonte extra de tools; `server.ts` expõe as tools do registry num servidor MCP próprio (porta `MCP_PORT`, `http.Server` separado do Hono do bot — a SDK do MCP quer `IncomingMessage`/`ServerResponse` crus).

Módulos ganham tools declarando um entrypoint `tools` no manifest, mesmo molde de `discordCommands` — ver `SebasModuleTools` em `packages/core/src/core/modules/types.ts`.

Conversa passiva (menção/DM, sem slash command) roda via `bin/gateway.ts` — cliente do Discord Gateway (WebSocket nativo do Node), processo separado (`sebas-gateway.service`), repassa mensagem relevante pro core via `POST /internal/gateway-message`. Precisa do intent privilegiado `MESSAGE_CONTENT` habilitado no Discord Developer Portal do app.

## Arquitetura do module host

Cada módulo (in-tree ou instalado via marketplace) roda isolado numa `worker_threads`. O `SebasModuleContext` que o módulo vê (`ctx.sql`, `ctx.storage`, `ctx.fetch`, `ctx.discord`, `ctx.ai`) é implementado como RPC de volta pro processo principal (`context-bridge.ts`), que é quem de fato toca o SQLite/rede/Discord e valida cada chamada contra as permissões concedidas ao módulo (`module_grants`). Ver `packages/core/src/core/modules/`:

- `host.ts` — spawn/lifecycle das workers, roteamento de entrypoint
- `context-bridge.ts` — implementação real do contexto, enforcement de permissão
- `runner.ts` / `context-in-worker.ts` — o lado de dentro da worker
- `installer.ts` / `lifecycle.ts` — ciclo de instalação dinâmica (clone → build → self-test → approve → enable)

## Onde roda em produção

- **VM:** `163.176.111.187` (hostname interno `instance-20260804-2203`), usuário SSH `hakor`. Domínio público `163-176-111-187.sslip.io` (Caddy).
- Atenção: existe outra VM do usuário em `147.15.47.157` (`minecraft---caverna`) — servidor de Minecraft, **não** tem nada do Sebas.
- Deploy real deste repo desde 2026-08-17 (M11 em `MILESTONES.md`): clonado via deploy key read-only em `/opt/sebas/sebas-bot`, buildado direto na VM (`npm install && npm run build`), 4 serviços systemd (`sebas-bot`, `sebas-worker`, `sebas-panel`, `sebas-gateway`) apontando pro checkout. Dado real (`sebas.db`) continua fora do checkout, em `/opt/sebas/bot/data` (não versionado).
- Redeploy: `cd /opt/sebas/sebas-bot && git pull && npm install && npm run build`, depois `sudo systemctl restart sebas-bot sebas-worker sebas-panel sebas-gateway`. Painel precisa recopiar `public/`/`.next/static` pro output standalone depois de rebuildar — ver comentário em `systemd/sebas-panel.service`.
- `/opt/sebas/bot` e `/opt/sebas/panel` (deploy antigo, manual, sem fonte) ainda existem no disco como rollback de emergência — não removidos ainda, ver M11.
