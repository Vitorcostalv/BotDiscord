import { EmbedBuilder, type User } from 'discord.js';

import type { AchievementDefinition } from '../achievements/definitions.js';
import type { HistoryEvent } from '../services/historyService.js';
import type { PlayerProfile } from '../services/profileService.js';
import type { XpState } from '../services/xpService.js';

export const SUZI_COLORS = {
  primary: 0x7d3cff,
  accent: 0xff5ca8,
  dark: 0x2b1434,
  warning: 0xf0b429,
  success: 0x5cc98a,
};

const EMOJI = {
  game: '\u{1F3AE}',
  brain: '\u{1F9E0}',
  dice: '\u{1F3B2}',
  register: '\u{1F9FE}',
  profile: '\u2728',
  class: '\u{1F9ED}',
  level: '\u2B50',
  warning: '\u26A0\uFE0F',
  trophy: '\u{1F3C6}',
  scroll: '\u{1F4DC}',
};

const CLASS_EMOJI: Record<string, string> = {
  guerreiro: '\u2694\uFE0F',
  mago: '\u{1F9D9}',
  arqueiro: '\u{1F3F9}',
  ladino: '\u{1F5E1}\uFE0F',
  clerigo: '\u2728',
  paladino: '\u{1F6E1}\uFE0F',
};

const HISTORY_LABELS: Record<string, string> = {
  roll: `${EMOJI.dice} Rolagem`,
  pergunta: `${EMOJI.brain} Pergunta`,
  jogo: `${EMOJI.game} Jogo`,
  nivel: `${EMOJI.level} Nivel`,
  register: `${EMOJI.register} Registro`,
};

type AchievementSummary = {
  recent: AchievementDefinition[];
  total: number;
};

type ProfileExtras = {
  achievements?: AchievementSummary;
  history?: HistoryEvent[];
  xp?: XpState;
  equippedTitle?: string | null;
  classTitle: string;
};

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

function normalizeClassName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getClassEmoji(className: string): string {
  const normalized = normalizeClassName(className);
  return CLASS_EMOJI[normalized] ?? EMOJI.class;
}

function formatAchievements(summary: AchievementSummary): string {
  const recent = summary.recent.slice(0, 6);
  const list = recent.length ? recent.map((item) => `${item.emoji} ${item.name}`).join('\n') : 'Nenhuma ainda.';
  return safeText(`${list}\nTotal: ${summary.total}`, 1024);
}

function formatHistory(events: HistoryEvent[] = []): string {
  if (!events.length) return 'Nenhuma atividade recente.';
  const lines = events.slice(0, 3).map((event) => {
    const label = HISTORY_LABELS[event.type] ?? event.type;
    const time = `<t:${Math.floor(event.ts / 1000)}:R>`;
    return `- ${label}: ${safeText(event.label, 60)} ${time}`;
  });
  return safeText(lines.join('\n'), 1024);
}

function formatTitle(equippedTitle: string | null | undefined, classTitle: string): string {
  if (equippedTitle) {
    return `Equipado: ${safeText(equippedTitle, 256)}\nClasse: ${safeText(classTitle, 256)}`;
  }
  return `Classe: ${safeText(classTitle, 256)}`;
}

function formatXp(xp?: XpState): string {
  if (!xp) return '-';
  const streak = xp.streak.days > 1 ? `\nStreak: ${xp.streak.days} dias` : '';
  return `XP: ${xp.xp}\nNivel: ${xp.level}${streak}`;
}

export function createSuziEmbed(color: keyof typeof SUZI_COLORS = 'primary'): EmbedBuilder {
  return new EmbedBuilder().setColor(SUZI_COLORS[color]);
}

export function buildAchievementUnlockEmbed(unlocked: AchievementDefinition[]): EmbedBuilder | null {
  if (!unlocked.length) return null;
  if (unlocked.length === 1) {
    const item = unlocked[0];
    return createSuziEmbed('accent')
      .setTitle(`${EMOJI.trophy} Conquista desbloqueada: ${item.emoji} ${item.name}`)
      .setDescription(item.description);
  }

  const lines = unlocked.map((item) => `- ${item.emoji} ${item.name}`);
  return createSuziEmbed('accent')
    .setTitle(`${EMOJI.trophy} Conquistas desbloqueadas`)
    .setDescription(lines.join('\n'));
}

export function buildHelpEmbed(botUser?: User | null): EmbedBuilder {
  const embed = createSuziEmbed('primary')
    .setTitle(`${EMOJI.scroll} Suzi - Central de Comandos`)
    .setDescription('Seu oraculo gamer/RPG para dicas, perguntas e rolagens.')
    .addFields(
      {
        name: `${EMOJI.brain} Informacoes`,
        value: safeText('/ping - Verifica latencia do bot\n/sobre - Saiba a lore da Suzi', 1024),
      },
      {
        name: `${EMOJI.game} Jogos & Perguntas`,
        value: safeText(
          '/jogo nome:<texto> plataforma:<opcional>\n- Ajuda estruturada sobre um jogo\n' +
            '/pergunta pergunta:<texto>\n- Perguntas gerais sobre jogos',
          1024,
        ),
      },
      {
        name: `${EMOJI.dice} RPG`,
        value: safeText('/roll expressao:<NdM>\n- Rolagem de dados (ex: 2d20, 1d100)', 1024),
      },
      {
        name: 'Historico & Estatisticas',
        value: safeText(
          '/historico user:<opcional> limite:<1..10>\n- Ultimas rolagens do usuario\n' +
            '/stats\n- Resumo de rolagens do servidor',
          1024,
        ),
      },
      {
        name: `${EMOJI.profile} Perfil do Player`,
        value: safeText(
          '/register\n- Registra seu jogador\n' +
            '/perfil user:<opcional>\n- Mostra o perfil\n' +
            '/nivel nivel:<1..99> user:<opcional>\n- Atualiza o nivel do personagem\n' +
            '/settitle title:<titulo>\n- Equipa um titulo desbloqueado\n' +
            '/titleclear\n- Remove o titulo equipado\n' +
            '/conquistas\n- Lista suas conquistas',
          1024,
        ),
      },
    )
    .setFooter({ text: 'Use /register para comecar sua jornada com a Suzi' });

  if (botUser) {
    embed.setThumbnail(botUser.displayAvatarURL({ size: 128 }));
  }

  return embed;
}

export function buildRegisterSuccessEmbed(user: User, player: PlayerProfile): EmbedBuilder {
  return createSuziEmbed('success')
    .setTitle(`${EMOJI.register} Registro concluido`)
    .setDescription(`Bem-vindo a aventura, ${safeText(player.playerName, 256)}!`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Personagem', value: safeText(player.characterName, 1024), inline: true },
      { name: `${EMOJI.class} Classe`, value: safeText(player.className, 1024), inline: true },
      { name: `${EMOJI.level} Nivel inicial`, value: String(player.level), inline: true },
      {
        name: 'Proximos passos',
        value: safeText('Use /perfil para ver seu perfil\nUse /nivel para evoluir seu personagem', 1024),
      },
    )
    .setFooter({ text: 'Suzi - Registro de Player' });
}

export function buildRegisterWarningEmbed(user?: User | null): EmbedBuilder {
  const embed = createSuziEmbed('warning')
    .setTitle(`${EMOJI.warning} Registro ja existente`)
    .setDescription('Use /register force:true para sobrescrever ou /perfil para ver os dados.')
    .setFooter({ text: 'Suzi - Registro de Player' });

  if (user) {
    embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
  }

  return embed;
}

export function buildProfileEmbed(user: User, player: PlayerProfile, extras: ProfileExtras): EmbedBuilder {
  const classEmoji = getClassEmoji(player.className);

  const embed = createSuziEmbed('primary')
    .setTitle(`${EMOJI.profile} Perfil do Player`)
    .setDescription(`Jogador: ${safeText(player.playerName, 1024)}`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Personagem', value: safeText(player.characterName, 1024), inline: true },
      { name: `${EMOJI.class} Classe`, value: `${classEmoji} ${safeText(player.className, 1000)}`, inline: true },
      { name: `${EMOJI.level} Nivel`, value: String(player.level), inline: true },
      { name: 'Titulos', value: formatTitle(extras.equippedTitle, extras.classTitle), inline: false },
      { name: 'Suzi XP', value: formatXp(extras.xp), inline: true },
    )
    .setFooter({ text: 'Suzi - Perfil do Player' });

  if (extras.achievements) {
    embed.addFields({
      name: `${EMOJI.trophy} Conquistas`,
      value: formatAchievements(extras.achievements),
    });
  }

  if (extras.history) {
    embed.addFields({
      name: 'Ultimas acoes',
      value: formatHistory(extras.history),
    });
  }

  return embed;
}

export function buildMissingProfileEmbed(user?: User | null): EmbedBuilder {
  const embed = createSuziEmbed('warning')
    .setTitle(`${EMOJI.warning} Perfil nao encontrado`)
    .setDescription('Essa pessoa ainda nao se registrou. Use /register.')
    .setFooter({ text: 'Suzi - Perfil do Player' });

  if (user) {
    embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
  }

  return embed;
}
