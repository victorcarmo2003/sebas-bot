import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SebasToolCallResult, SebasToolDefinition } from "../modules/types.js";
import type { ToolProvider } from "./registry.js";

// process.cwd() e nao import.meta.url de proposito — mesma logica de db/migrate.ts e
// bin/bot.ts pra IN_TREE_MODULE_DIR: a profundidade muda entre tsx e dist/, cwd nao.
const SKILLS_DIR = () => join(process.cwd(), "skills");

interface Skill {
  name: string;
  description: string;
  body: string;
}

/** Frontmatter bem simples (chave: valor por linha) — nao precisa de dependencia de YAML pro
 * pouco que usamos aqui (so name/description). */
function parseSkillFile(raw: string): Skill | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return null;
  const [, frontmatter, body] = match;
  const meta: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    meta[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim();
  }
  if (!meta.name || !meta.description) return null;
  return { name: meta.name, description: meta.description, body: body.trim() };
}

function loadSkills(): Skill[] {
  let files: string[];
  try {
    files = readdirSync(SKILLS_DIR()).filter((file) => file.endsWith(".md"));
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const file of files) {
    try {
      const parsed = parseSkillFile(readFileSync(join(SKILLS_DIR(), file), "utf8"));
      if (parsed) skills.push(parsed);
    } catch (error) {
      console.warn(`Failed to read skill file "${file}":`, error);
    }
  }
  return skills;
}

const LIST_SKILLS_TOOL: SebasToolDefinition = {
  name: "list_skills",
  description: "Lista as skills disponiveis — pacotes de instrucao/contexto que podem ser carregados sob demanda pra uma tarefa especifica.",
  parameters: { type: "object", properties: {}, additionalProperties: false }
};

const LOAD_SKILL_TOOL: SebasToolDefinition = {
  name: "load_skill",
  description: "Carrega o conteudo completo de uma skill pelo nome (ver list_skills), pra usar como contexto adicional na resposta.",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "Nome exato da skill, como retornado por list_skills." } },
    required: ["name"],
    additionalProperties: false
  }
};

/** Skills nao passam por worker_threads nem module host — sao so arquivo, resolvidas direto
 * aqui. Ficam no registry como mais uma fonte de tools (namespace "skill"), nao executam nada
 * do lado do modulo, so leem markdown de packages/core/skills/. */
export const skillsToolProvider: ToolProvider = {
  namespace: "skill",
  async listTools() {
    return [LIST_SKILLS_TOOL, LOAD_SKILL_TOOL];
  },
  async callTool(name, args): Promise<SebasToolCallResult> {
    if (name === "list_skills") {
      return { ok: true, result: { items: loadSkills().map(({ name: skillName, description }) => ({ name: skillName, description })) } };
    }
    if (name === "load_skill") {
      const skillName = typeof args.name === "string" ? args.name : "";
      const skill = loadSkills().find((candidate) => candidate.name === skillName);
      if (!skill) {
        return { ok: false, error: `Skill "${skillName}" not found.` };
      }
      return { ok: true, result: { name: skill.name, content: skill.body } };
    }
    return { ok: false, error: `Unknown skill tool: ${name}` };
  }
};
