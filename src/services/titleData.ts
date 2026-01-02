export type TitleDefinition = {
  id: string;
  label: string;
  description: string;
};

export const TITLE_DEFINITIONS: TitleDefinition[] = [
  {
    id: 'GUIDE_VIVO',
    label: 'Guia Vivo',
    description: 'Desbloqueado ao dominar dezenas de jogos.',
  },
  {
    id: 'ENCICLOPEDIA',
    label: 'Enciclopedia',
    description: 'Para quem ja viu (e perguntou) de tudo.',
  },
  {
    id: 'CEM_ROLAGENS',
    label: 'Cem Rolagens',
    description: 'Veterano das mesas e dos dados.',
  },
  {
    id: 'TEMPESTADE',
    label: 'Tempestade',
    description: 'Rola dezenas de dados como quem respira.',
  },
  {
    id: 'CRITICO_DUPLO',
    label: 'Critico Duplo',
    description: 'Dois 20 em pouco tempo. Lenda viva.',
  },
  {
    id: 'NOTURNO',
    label: 'Guardiao Noturno',
    description: 'Presenca firme nas madrugadas.',
  },
];

export const ACHIEVEMENT_TITLE_REWARDS: Record<string, string> = {
  GAME_100: 'GUIDE_VIVO',
  QUESTION_200: 'ENCICLOPEDIA',
  ROLL_100_TOTAL: 'CEM_ROLAGENS',
  BIG_ROLL: 'TEMPESTADE',
  DOUBLE_CRIT: 'CRITICO_DUPLO',
  NIGHT_OWL: 'NOTURNO',
};

export const CLASS_TITLES: Record<string, string> = {
  guerreiro: 'Lamina da Vanguarda',
  mago: 'Arcanista do Crepusculo',
  arqueiro: 'Olho de Nevoa',
  ladino: 'Sombra Sorridente',
  clerigo: 'Voz da Luz',
  paladino: 'Juramento de Acao',
};

export function listTitleDefinitions(): TitleDefinition[] {
  return [...TITLE_DEFINITIONS];
}
