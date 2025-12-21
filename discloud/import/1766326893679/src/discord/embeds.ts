import { EmbedBuilder, type User } from 'discord.js';

import type { AchievementDefinition } from '../achievements/definitions.js';
import type { PlayerProfile } from '../services/storage.js';

const COLORS = {
  primary: 0x5865f2,
  warning: 0xf1c40f,
};

const EMOJI = {
  game: '🎮',
  brain: '🧠',
  dice: '🎲',
  register: '📝',
  profile: '📌',
  class: '⚔️',
  level: '⭐',
  warning: '⚠️',
};

const CLASS_EMOJI: Record<string, string> = {
  guerreiro: '⚔️',
  mago: '🧙',
  arqueiro: '🏹',
  tank: '🛡️',
};

type AchievementSummary = {
  recent: AchievementDefinition[];
  total: number;
};

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

function formatTimestamp(timestamp: number): string {
  return `<t:${Math.floor(timestamp / 1000)}:f>`;
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

function buildProgressBar(level: number): string {
  const total = 10;
  const filled = Math.max(1, Math.min(total, Math.ceil(level / 10)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(total - filled)}`;
}

function formatAchievements(summary: AchievementSummary): string {
  const recent = summary.recent.slice(0, 6);
  const list = recent.length ? recent.map((item) => `${item.emoji} ${item.name}`).join('\n') : 'Nenhuma ainda.';
  return safeText(`${list}\nTotal: ${summary.total}`, 1024);
}

export function buildHelpEmbed(botUser?: User | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.game} GameBuddy — Central de Comandos`)
    .setDescription('Seu companheiro gamer/RPG para dicas, perguntas e rolagens rapidas.')
    .setColor(COLORS.primary)
    .addFields(
      {
        name: `${EMOJI.brain} Informacao`,
        value: safeText('/ping — Verifica latencia do bot', 1024),
      },
      {
        name: `${EMOJI.game} Jogos & Perguntas`,
        value: safeText(
          '/jogo nome:<texto> plataforma:<opcional>\n- Ajuda estruturada sobre um jogo\n' +
            '/pergunta pergunta:<texto>\n- Perguntas gerais sobre jogos (com memoria curta)',
          1024,
        ),
      },
      {
        name: `${EMOJI.dice} RPG`,
        value: safeText('/roll expressao:<NdM>\n- Rolagem de dados (ex: 2d20, 1d100)', 1024),
      },
      {
        name: `${EMOJI.profile} Perfil do Player`,
        value: safeText(
          '/register\n- Registra seu jogador\n' +
            '/perfil\n- Mostra seu perfil\n' +
            '/nivel\n- Atualiza o nivel do personagem\n' +
            '/conquistas\n- Lista suas conquistas',
          1024,
        ),
      },
    )
    .setFooter({ text: 'Use /register para comecar sua jornada 🎒' });

  if (botUser) {
    embed.setThumbnail(botUser.displayAvatarURL({ size: 128 }));
  }

  return embed;
}

export function buildRegisterSuccessEmbed(user: User, player: PlayerProfile): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${EMOJI.register} Registro concluido com sucesso`)
    .setDescription(`Bem-vindo a aventura, ${safeText(player.playerName, 256)}!`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setColor(COLORS.primary)
    .addFields(
      { name: '🧙 Personagem', value: safeText(player.characterName, 1024), inline: true },
      { name: `${EMOJI.class} Classe`, value: safeText(player.className, 1024), inline: true },
      { name: `${EMOJI.level} Nivel inicial`, value: String(player.level), inline: true },
      {
        name: `${EMOJI.profile} Proximos passos`,
        value: safeText('Use /perfil para ver seu perfil\nUse /nivel para evoluir seu personagem', 1024),
      },
    )
    .setFooter({ text: 'GameBuddy • Registro de Player' });
}

export function buildRegisterWarningEmbed(user?: User | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.warning} Voce ja possui um personagem registrado`)
    .setDescription('Use /perfil para ver seus dados ou /nivel para evoluir seu personagem.')
    .setColor(COLORS.warning)
    .setFooter({ text: 'GameBuddy • Registro de Player' });

  if (user) {
    embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
  }

  return embed;
}

export function buildProfileEmbed(
  user: User,
  player: PlayerProfile,
  achievements?: AchievementSummary,
): EmbedBuilder {
  const classEmoji = getClassEmoji(player.className);
  const progress = buildProgressBar(player.level);

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.profile} Perfil do Player`)
    .setDescription(`Jogador: ${safeText(player.playerName, 1024)}`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setColor(COLORS.primary)
    .addFields(
      { name: '🧙 Personagem', value: safeText(player.characterName, 1024), inline: true },
      { name: `${EMOJI.class} Classe`, value: `${classEmoji} ${safeText(player.className, 1000)}`, inline: true },
      { name: `${EMOJI.level} Nivel`, value: `${player.level}\n${progress}`, inline: true },
      {
        name: 'Datas',
        value: `Registro: ${formatTimestamp(player.createdAt)}\nAtualizado: ${formatTimestamp(player.updatedAt)}`,
      },
    )
    .setFooter({ text: 'GameBuddy • Perfil do Player' });

  if (achievements) {
    embed.addFields({
      name: '🏆 Conquistas',
      value: formatAchievements(achievements),
    });
  }

  return embed;
}

export function buildMissingProfileEmbed(user?: User | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI.warning} Perfil nao encontrado`)
    .setDescription('Voce ainda nao esta registrado. Use /register para comecar sua jornada.')
    .setColor(COLORS.warning)
    .setFooter({ text: 'GameBuddy • Perfil do Player' });

  if (user) {
    embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
  }

  return embed;
}
