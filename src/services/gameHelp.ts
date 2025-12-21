import { logWarn } from '../utils/logging.js';

import { generateAnswer } from './llm.js';
import { getPreferences } from './storage.js';

const genericHints = {
  overview:
    'Sem detalhes específicos, mas vamos lá: foque em entender as mecânicas principais, explore o mapa com calma e leia tutoriais in-game.',
  tips:
    'Comece dominando o básico: movimentação, esquiva/defesa e gerenciamento de recursos. Faça missões iniciais para pegar ritmo.',
  mistakes: 'Erro comum é rushar a campanha sem se equipar. Administre inventário, leia descrições de itens e teste combinações.',
  affinity:
    'Se curte progressão constante, sistema de habilidades e coop com amigos, esse jogo deve te agradar bastante.',
};

export type GameHelpResponse = {
  overview: string;
  tips: string;
  mistakes: string;
  affinity: string;
};

function isGameHelpResponse(value: unknown): value is GameHelpResponse {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return ['overview', 'tips', 'mistakes', 'affinity'].every((key) => typeof obj[key] === 'string');
}

export async function getGameHelp(
  userId: string,
  gameName: string,
  platform?: string,
): Promise<GameHelpResponse> {
  const prefs = getPreferences(userId);
  const context = `Jogo: ${gameName}. Plataforma: ${platform ?? prefs.plataforma ?? 'desconhecida'}.
Preferências do usuário: plataforma favorita ${prefs.plataforma ?? 'n/d'}, gênero favorito ${prefs.genero ?? 'n/d'}.`;

  try {
    const llmResult = await generateAnswer(
      `Quais dicas rápidas para o jogo ${gameName}? Responda em português, sem inventar números ou patches. Traga visão geral, dicas iniciais, erros comuns e afinidade.`,
      context,
    );
    if (isGameHelpResponse(llmResult)) {
      return llmResult;
    }
  } catch (error) {
    logWarn('SUZI-CMD-002', error, { message: 'LLM falhou, usando heuristicas' });
  }

  return {
    overview: genericHints.overview,
    tips: genericHints.tips,
    mistakes: genericHints.mistakes,
    affinity: `${genericHints.affinity} Preferências: plataforma ${prefs.plataforma ?? 'qualquer'}, gênero ${prefs.genero ?? 'variado'}.`,
  };
}
