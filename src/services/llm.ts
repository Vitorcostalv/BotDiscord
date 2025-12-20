import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export type LlmResponse = Record<string, unknown> | string | null;

export async function generateAnswer(prompt: string, context: string): Promise<LlmResponse> {
  if (!env.llmApiKey) {
    return null;
  }

  // Exemplo de implementação: enviar request HTTP para um endpoint LLM.
  // Use fetch com env.llmApiKey para autenticação. Retorne null em caso de erro.
  try {
    logger.info('LLM habilitado, stub de chamada executado', { prompt, context });
    // const response = await fetch('https://sua-api-llm.com', { ... });
    // Parse e retorne string ou objeto estruturado.
    return null;
  } catch (error) {
    logger.error('Erro ao consultar LLM', error);
    return null;
  }
}
