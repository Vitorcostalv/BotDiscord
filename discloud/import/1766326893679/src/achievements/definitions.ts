export type AchievementEventName = 'register' | 'roll' | 'pergunta' | 'jogo';

export type AchievementPayload = {
  sides?: number;
  rolls?: number[];
};

export type AchievementCounters = {
  rolls: number;
  questions: number;
  games: number;
  registerCount: number;
};

export type AchievementUserState = {
  counters: AchievementCounters;
};

export type AchievementRarity = 'comum' | 'rara' | 'epica';

export type AchievementDefinition = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  rarity: AchievementRarity;
  condition: (eventName: AchievementEventName, payload: AchievementPayload, userState: AchievementUserState) => boolean;
};

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: 'FIRST_REGISTER',
    name: 'Primeiro Registro',
    description: 'Registrou seu personagem pela primeira vez.',
    emoji: '📝',
    rarity: 'comum',
    condition: (eventName, _payload, userState) =>
      eventName === 'register' && userState.counters.registerCount >= 1,
  },
  {
    id: 'FIRST_ROLL',
    name: 'Primeira Rolagem',
    description: 'Rolou dados pela primeira vez.',
    emoji: '🎲',
    rarity: 'comum',
    condition: (eventName, _payload, userState) => eventName === 'roll' && userState.counters.rolls >= 1,
  },
  {
    id: 'FIRST_QUESTION',
    name: 'Primeira Pergunta',
    description: 'Fez sua primeira pergunta sobre jogos.',
    emoji: '🧠',
    rarity: 'comum',
    condition: (eventName, _payload, userState) =>
      eventName === 'pergunta' && userState.counters.questions >= 1,
  },
  {
    id: 'FIRST_GAME',
    name: 'Primeiro Jogo',
    description: 'Pediu ajuda sobre um jogo pela primeira vez.',
    emoji: '🎮',
    rarity: 'comum',
    condition: (eventName, _payload, userState) => eventName === 'jogo' && userState.counters.games >= 1,
  },
  {
    id: 'ROLL_10',
    name: 'Dez Rolagens',
    description: 'Fez 10 rolagens.',
    emoji: '🎲',
    rarity: 'rara',
    condition: (_eventName, _payload, userState) => userState.counters.rolls >= 10,
  },
  {
    id: 'ROLL_50',
    name: 'Cinquenta Rolagens',
    description: 'Fez 50 rolagens.',
    emoji: '🎲',
    rarity: 'epica',
    condition: (_eventName, _payload, userState) => userState.counters.rolls >= 50,
  },
  {
    id: 'NAT20_D20',
    name: 'Critico Natural',
    description: 'Tirou 20 em um d20.',
    emoji: '⚔️',
    rarity: 'rara',
    condition: (eventName, payload) =>
      eventName === 'roll' && payload.sides === 20 && Boolean(payload.rolls?.includes(20)),
  },
  {
    id: 'NAT1_D20',
    name: 'Falha Critica',
    description: 'Tirou 1 em um d20.',
    emoji: '⚔️',
    rarity: 'rara',
    condition: (eventName, payload) =>
      eventName === 'roll' && payload.sides === 20 && Boolean(payload.rolls?.includes(1)),
  },
];
