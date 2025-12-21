import { env } from '../config/env.js';
import { logError, logInfo } from '../utils/logging.js';

export type LlmResponse = Record<string, unknown> | string | null;

export async function generateAnswer(prompt: string, context: string): Promise<LlmResponse> {
  if (!env.llmApiKey) {
    return null;
  }

  // Exemplo de implementação: enviar request HTTP para um endpoint LLM.
  // Use fetch com env.llmApiKey para autenticação. Retorne null em caso de erro.
  try {
    logInfo('SUZI-CMD-002', 'LLM habilitado, stub de chamada executado', { prompt, context });
    // const response = await fetch('https://sua-api-llm.com', { ... });
    // Parse e retorne string ou objeto estruturado.
    return null;
  } catch (error) {
    logError('SUZI-CMD-002', error, { message: 'Erro ao consultar LLM' });
    return null;
  }
}
