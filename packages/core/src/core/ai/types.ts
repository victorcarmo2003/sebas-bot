export interface AiChatRequest {
  systemPrompt?: string;
  userPrompt: string;
  jsonSchema?: Record<string, unknown>;
  jsonSchemaName?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface AiChatResult {
  ok: boolean;
  json?: unknown;
  text?: string;
  error?: string;
  providerId: string;
}

export interface AiProvider {
  id: string;
  run(request: AiChatRequest): Promise<AiChatResult>;
}

export interface OpenCodeModel {
  id: string;
  free: boolean;
}
