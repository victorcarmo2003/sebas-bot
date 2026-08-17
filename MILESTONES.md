s# Milestones — sebas-bot

Histórico: começou como investigação (2026-08-16) de onde vivia a estrutura principal do Sebas — descobriu que o core rodava em produção (`163.176.111.187`) sem nenhum código-fonte versionado, só `dist/` implantado manualmente. Virou reescrita completa: monorepo com core + painel + módulos, paridade de comportamento com o que já roda, e implementação de verdade do marketplace de módulos (instalação dinâmica, sandbox, permissões) que antes só existia como desenho no painel e no manifest. Plano completo em `C:\Users\hakor\.claude\plans\harmonic-frolicking-map.md`.

## M1 — Mapeamento (concluído em 2026-08-16)

- [x] Localizar os 3 componentes do Sebas: core, painel, módulos
- [x] Identificar a VM correta (`163.176.111.187`, não confundir com `147.15.47.157`)
- [x] Mapear serviços systemd, portas e roteamento Caddy
- [x] Confirmar que `sebas-worker` estava inativo na VM
- [x] Confirmar que não existia `.git` do core em lugar nenhum (só `dist/` implantado)

## M2 — Scaffold do monorepo (concluído em 2026-08-16)

- [x] `package.json` raiz com npm workspaces (`packages/core`, `packages/panel`, `packages/modules/changelog-roblox`)
- [x] Painel (`discord-changelogs-admin`) copiado pra `packages/panel`, renomeado `@sebas-bot/panel`
- [x] Módulo (`sebas-module-changelog-roblox`) copiado pra `packages/modules/changelog-roblox`, renomeado `@sebas-bot/module-changelog-roblox`

## M3 — Core em paridade (concluído em 2026-08-16)

Reconstituído a partir da leitura completa do `dist/` da VM (não é adivinhação — cada arquivo foi lido por inteiro antes de virar TypeScript de novo).

- [x] `bin/bot.ts`, `bin/worker.ts`
- [x] `src/core/{admin-api,ai,config,db,discord,notifications,queue,logging,timeout}` — mesma lógica, mesmas rotas, mesmo schema (migrations `0001`–`0003` idênticas às da VM)
- [x] Testado localmente: migrations aplicam limpo, `/health` responde, RBAC (`/whoami`) funciona

## M4 — Module host com sandbox real (concluído em 2026-08-16)

O contrato `SebasModuleContext` que `sebas-module-changelog-roblox` já implementava não rodava em lugar nenhum — construído do zero.

- [x] `src/core/modules/{host,runner,context-in-worker,context-bridge,worker-protocol}.ts` — cada módulo roda numa `worker_threads` própria; `sql`/`storage`/`fetch`/`discord`/`ai` do `ctx` são RPC de volta pro host, que aplica as permissões concedidas antes de executar
- [x] Migration `0004`: `module_storage` (KV sempre liberado), `module_config`, `module_installs`, `module_grants`, `module_events`
- [x] Testado localmente ponta a ponta: `PUT/GET /guilds/:id`, `GET /settings`, `GET /history` passam pelo controller do módulo dentro da worker sandboxada, com dado persistindo de verdade

**Achado durante o teste**: o módulo novo usa `ctx.storage` (KV) pra config de guild e `ctx.sql` (tabelas próprias, prefixo `mod_changelog-roblox_*`) pro histórico — **não** mais as tabelas cruas `changelog_roblox_guild_settings`/`_posted` que as migrations `0002`/`0003` criam. Essas tabelas antigas ficam no schema só por compatibilidade com o banco de produção existente; ver M7.

## M5 — Marketplace dinâmico (concluído em 2026-08-16)

- [x] `src/core/modules/{installer,lifecycle,discover,grants,marketplace-repo}.ts`
- [x] Rotas novas na admin API: `GET /modules/discover`, `POST /modules/install`, `GET/DELETE /modules/:id`, `POST /modules/:id/{approve,reject,enable,disable}` — contrato batendo com o que `worker-api.ts` do painel já esperava
- [x] Fluxo: `git clone` → valida manifest/`sebasCompat` → `npm install && npm run build` → self-test em sandbox (só `ctx.storage`, zero rede/discord/ai) → diff de permissões → `approve` grava grants → `enable` sobe a worker + registra cron

**Risco conhecido, não resolvido**: o passo de build (`npm install && npm run build`) roda scripts arbitrários do repo clonado com privilégio total do processo host — só a *execução* em runtime é isolada (worker_threads), não o build. Isolar isso de verdade exigiria sandbox de SO/container, fora do escopo atual.

## M6 — Correção de drift do painel (concluído em 2026-08-16)

- [x] `SebasModuleManifest.discordCommands` em `worker-api.ts`: `commandGroup: string` → `commands: string[]`, pra bater com `sebas.module.json` de verdade (campo não era usado em nenhuma tela, troca segura)
- [x] `npm run build` do painel passa limpo depois da correção

## M7 — Migração de dados de produção (não iniciado)

Só é relevante se/quando este monorepo for reimplantado por cima do `sebas.db` real da VM.

- [ ] Escrever migration que copia `changelog_roblox_posted` → `mod_changelog-roblox_posted`, `changelog_roblox_guild_settings`/`_state` → chaves em `module_storage` (ver achado em M4)
- [ ] Auto-conceder ao módulo in-tree os grants que ele pediria via `installer.ts`, direto no banco de produção (ele não passa pelo fluxo de install/approve — é in-tree)

## M8 — Reativar `sebas-worker` na VM / redeploy (não iniciado)

- [ ] Checar `journalctl -u sebas-worker` na VM pra entender por que caiu
- [ ] Substituir o fluxo manual (`deploy-tmp/*.tar.gz`) por deploy a partir deste repo git
- [ ] Rodar M7 antes de trocar o processo em produção

## M9 — Tool calling + MCP + Skills (concluído em 2026-08-17)

Motivação: usuário quer um "mordomo" capaz no Discord (comando + listagem de tools + interação), e está treinando em paralelo um Qwen2.5 fine-tunado como fallback caso a OpenCode Zen feche o tier free — esse fine-tune é treinado pra chamar tools do mesmo jeito que o provider principal, então o formato que nasce aqui é a referência. Plano completo (agora sobrescrito no arquivo de plano, mas resumido aqui): `SebasTool` contract + registry central + tool calling real na IA + skills + MCP dos dois lados + comando `/sebas` no Discord.

- [x] `SebasTool`/`SebasModuleTools` em `src/core/modules/types.ts` — mesmo molde de `discordCommands` (entrypoint `tools`, capability `"tools"`), com `list-tools`/`invoke-tool` no protocolo host↔worker (`worker-protocol.ts`, `runner.ts`, `host.ts`)
- [x] `src/core/tools/registry.ts` — agrega tools de módulos/skills/MCP sob nomes qualificados (`module:<id>:<tool>`, `skill:<tool>`, `mcp:<serverId>:<tool>`)
- [x] Tool calling real OpenAI-compatible: `ai/types.ts` (`messages`/`tools`/`toolCalls`), `ai/openai-compat.ts` (monta `tools`/`tool_choice`, parseia `tool_calls`), `opencode-client.ts`/`openai-client.ts` atualizados, `ai/agent-loop.ts` (loop multi-turno modelo↔tool)
- [x] `src/core/tools/skills.ts` — `list_skills`/`load_skill` lendo `packages/core/skills/*.md` (frontmatter), primeira skill: `sebas-persona.md`
- [x] MCP dos dois lados (`@modelcontextprotocol/sdk`): `src/core/mcp/client.ts` (conecta servidores externos via stdio/HTTP, migration `0005_mcp_servers.sql`, rotas `GET/POST/DELETE /api/admin/mcp/servers`) e `src/core/mcp/server.ts` (expõe o registry como servidor MCP, `http.Server` próprio na porta `MCP_PORT`, separado do Hono do bot por causa de como a SDK espera `IncomingMessage`/`ServerResponse` crus)
- [x] Comando `/sebas` (`bin/bot.ts`, não é módulo) — resposta deferida, roda `agent-loop` com o registry cheio, `register-discord-commands.mjs` atualizado pra registrar ele junto dos comandos do módulo in-tree

**Testado ponta a ponta, sem mock**: `agent-loop` com provider fake (ciclo completo tool-call → resultado → resposta final); `skills.ts` lendo arquivo de verdade; `/api/admin/tools` via HTTP real; servidor MCP batendo com um `Client` de verdade da própria SDK (`tools/list` + `tools/call`); cliente MCP conectando via `stdio` a um mini-servidor MCP real (processo separado); comando `/sebas` via `POST /interactions` com assinatura ed25519 gerada de verdade (`tweetnacl`) — confirmado: verifica assinatura, reconhece o comando, responde deferido, tenta o PATCH final no Discord (rejeitado só por token de teste ser fake).

**Risco conhecido, não resolvido**: `mcp/client.ts` com transporte `stdio` spawna processo arbitrário com privilégio do host — mesma categoria de risco do build de módulo em `installer.ts` (M5), documentado, não isolado.

**Fora deste milestone, de propósito**: Discord Gateway (WebSocket) pra conversa passiva (menção/DM sem slash command) — precisa de processo persistente, reconexão, intent privilegiado `MESSAGE_CONTENT` aprovado no Discord Developer Portal. Por enquanto a interação com o mordomo é só via `/sebas`.
