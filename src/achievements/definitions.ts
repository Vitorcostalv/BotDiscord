export type AchievementEventName =
  | 'register'
  | 'roll'
  | 'pergunta'
  | 'jogo'
  | 'nivel'
  | 'perfil'
  | 'ajuda'
  | 'sobre';

export type AchievementPayload = {
  sides?: number;
  rolls?: number[];
  count?: number;
  self?: boolean;
  dayKey?: string;
  hour?: number;
  doubleCrit?: boolean;
};

export type AchievementCounters = {
  rolls: number;
  questions: number;
  games: number;
  registerCount: number;
  helpCount: number;
  profileCount: number;
  aboutCount: number;
  selfLevelEdits: number;
};

export type AchievementMeta = {
  lastD20CritTs?: number;
  lastRegisterDay?: string;
  lastRollDay?: string;
  profileDays?: string[];
};

export type AchievementUserState = {
  counters: AchievementCounters;
  meta: AchievementMeta;
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
    emoji: '🧾',
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
    name: 'Crítico Natural',
    description: 'Tirou 20 em um d20.',
    emoji: '💥',
    rarity: 'rara',
    condition: (eventName, payload) =>
      eventName === 'roll' && payload.sides === 20 && Boolean(payload.rolls?.includes(20)),
  },
  {
    id: 'NAT1_D20',
    name: 'Falha Crítica',
    description: 'Tirou 1 em um d20.',
    emoji: '💀',
    rarity: 'rara',
    condition: (eventName, payload) =>
      eventName === 'roll' && payload.sides === 20 && Boolean(payload.rolls?.includes(1)),
  },
  {
    id: 'ROLL_100_TOTAL',
    name: 'Cem Rolagens',
    description: 'Fez 100 rolagens totais.',
    emoji: '🎲',
    rarity: 'epica',
    condition: (_eventName, _payload, userState) => userState.counters.rolls >= 100,
  },
  {
    id: 'BIG_ROLL',
    name: 'Tempestade',
    description: 'Rolou 50 dados ou mais em uma unica vez.',
    emoji: '🌪️',
    rarity: 'rara',
    condition: (eventName, payload) => eventName === 'roll' && (payload.count ?? 0) >= 50,
  },
  {
    id: 'MAX_D100',
    name: 'Cem em um d100',
    description: 'Tirou 100 em 1d100.',
    emoji: '💯',
    rarity: 'rara',
    condition: (eventName, payload) =>
      eventName === 'roll' &&
      payload.sides === 100 &&
      payload.count === 1 &&
      Boolean(payload.rolls?.includes(100)),
  },
  {
    id: 'LOW_D100',
    name: 'Um em d100',
    description: 'Tirou 1 em 1d100.',
    emoji: '🕳️',
    rarity: 'rara',
    condition: (eventName, payload) =>
      eventName === 'roll' && payload.sides === 100 && payload.count === 1 && Boolean(payload.rolls?.includes(1)),
  },
  {
    id: 'DOUBLE_CRIT',
    name: 'Crítico Duplo',
    description: 'Tirou 20 em d20 duas vezes em 10 minutos.',
    emoji: '💥',
    rarity: 'epica',
    condition: (eventName, payload) => eventName === 'roll' && payload.doubleCrit === true,
  },
  {
    id: 'QUESTION_50',
    name: 'Curioso',
    description: 'Fez 50 /pergunta.',
    emoji: '🧠',
    rarity: 'rara',
    condition: (_eventName, _payload, userState) => userState.counters.questions >= 50,
  },
  {
    id: 'QUESTION_200',
    name: 'Enciclopédia',
    description: 'Fez 200 /pergunta.',
    emoji: '🧠',
    rarity: 'epica',
    condition: (_eventName, _payload, userState) => userState.counters.questions >= 200,
  },
  {
    id: 'GAME_25',
    name: 'Explorador',
    description: 'Pediu ajuda em 25 jogos.',
    emoji: '🎮',
    rarity: 'rara',
    condition: (_eventName, _payload, userState) => userState.counters.games >= 25,
  },
  {
    id: 'GAME_100',
    name: 'Guia Vivo',
    description: 'Pediu ajuda em 100 jogos.',
    emoji: '🎮',
    rarity: 'epica',
    condition: (_eventName, _payload, userState) => userState.counters.games >= 100,
  },
  {
    id: 'LEVEL_SETTER',
    name: 'Ajuste Fino',
    description: 'Usou /nivel 5 vezes no proprio personagem.',
    emoji: '⭐',
    rarity: 'rara',
    condition: (_eventName, _payload, userState) => userState.counters.selfLevelEdits >= 5,
  },
  {
    id: 'PROFILE_STREAK_7',
    name: 'Presença',
    description: 'Consultou /perfil em 7 dias diferentes.',
    emoji: '📌',
    rarity: 'rara',
    condition: (_eventName, _payload, userState) => (userState.meta.profileDays ?? []).length >= 7,
  },
  {
    id: 'REGISTER_AND_ROLL',
    name: 'Aventurando',
    description: 'Registrou e rolou no mesmo dia.',
    emoji: '🧾',
    rarity: 'rara',
    condition: (eventName, payload, userState) =>
      (eventName === 'register' || eventName === 'roll') &&
      userState.meta.lastRegisterDay === payload.dayKey &&
      userState.meta.lastRollDay === payload.dayKey,
  },
  {
    id: 'ABOUT_FIRST',
    name: 'Conhecendo a Suzi',
    description: 'Usou /sobre pela primeira vez.',
    emoji: '🌙',
    rarity: 'comum',
    condition: (eventName, _payload, userState) => eventName === 'sobre' && userState.counters.aboutCount >= 1,
  },
  {
    id: 'NIGHT_OWL',
    name: 'Noturno',
    description: 'Usou um comando entre 02:00 e 04:00.',
    emoji: '🦉',
    rarity: 'rara',
    condition: (_eventName, payload) => typeof payload.hour === 'number' && payload.hour >= 2 && payload.hour < 4,
  },
  {
    id: 'HELPER',
    name: 'Sempre Ajuda',
    description: 'Usou /ajuda 10 vezes.',
    emoji: '🧭',
    rarity: 'rara',
    condition: (_eventName, _payload, userState) => userState.counters.helpCount >= 10,
  },
];
