import { EmbedBuilder, type User } from 'discord.js';

import type { AchievementDefinition } from '../achievements/definitions.js';
import type { HistoryEvent } from '../services/historyService.js';
import type { PlayerProfile } from '../services/profileService.js';
import type { XpState } from '../services/xpService.js';

type Translator = (key: string, vars?: Record<string, string | number>) => string;

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
  pin: '\u{1F4CC}',
  tag: '\u{1F3F7}\uFE0F',
  bolt: '\u26A1',
  movie: '\u{1F3AC}',
};

const CLASS_EMOJI: Record<string, string> = {
  guerreiro: '\u2694\uFE0F',
  mago: '\u{1F9D9}',
  arqueiro: '\u{1F3F9}',
  ladino: '\u{1F5E1}\uFE0F',
  clerigo: '\u2728',
  paladino: '\u{1F6E1}\uFE0F',
};

const HISTORY_LABEL_KEYS: Record<string, string> = {
  roll: 'history.roll',
  pergunta: 'history.question',
  jogo: 'history.game',
  nivel: 'history.level',
  register: 'history.register',
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
  favoritesText?: string;
};

function safeText(text: string | undefined | null, maxLen: number): string {
  const normalized = text?.trim() ?? '';
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

function getClassEmoji(className: string | undefined | null): string {
  const normalized = normalizeClassName(className ?? '');
  return CLASS_EMOJI[normalized] ?? EMOJI.class;
}

function formatAchievementsCompact(t: Translator, summary: AchievementSummary): string {
  const recent = summary.recent.slice(0, 3);
  const lines = [t('achievements.total', { total: summary.total })];
  if (recent.length) {
    lines.push(...recent.map((item) => `- ${item.emoji} ${getAchievementName(t, item)}`));
  }
  return safeText(lines.join('\n'), 1024);
}

function formatAchievementsDetailed(t: Translator, summary: AchievementSummary): string {
  const recent = summary.recent.slice(0, 6);
  const lines = recent.length
    ? recent.map((item) => `${item.emoji} ${getAchievementName(t, item)}`)
    : [t('achievements.none')];
  lines.push(t('achievements.total', { total: summary.total }));
  return safeText(lines.join('\n'), 1024);
}

function formatHistory(t: Translator, events: HistoryEvent[] = []): string {
  if (!events.length) return t('history.none');
  const lines = events.slice(0, 3).map((event) => {
    const key = HISTORY_LABEL_KEYS[event.type] ?? event.type;
    const label = HISTORY_LABEL_KEYS[event.type] ? t(key) : event.type;
    const time = `<t:${Math.floor(event.ts / 1000)}:R>`;
    return `- ${label}: ${safeText(event.label, 60)} ${time}`;
  });
  return safeText(lines.join('\n'), 1024);
}

function formatTitle(t: Translator, equippedTitle: string | null | undefined, classTitle: string): string {
  if (equippedTitle) {
    return `${t('profile.title.equipped')}: ${safeText(equippedTitle, 256)}\n${t('profile.title.class')}: ${safeText(
      classTitle,
      256,
    )}`;
  }
  return `${t('profile.title.class')}: ${safeText(classTitle, 256)}`;
}

function formatTitleCompact(t: Translator, equippedTitle: string | null | undefined, classTitle: string): string {
  if (equippedTitle) {
    return `${t('profile.title.equipped')}: ${safeText(equippedTitle, 256)}`;
  }
  return `${t('profile.title.class')}: ${safeText(classTitle, 256)}`;
}

function formatXp(t: Translator, xp?: XpState): string {
  if (!xp) return '-';
  const streak = xp.streak.days > 1 ? `\n${t('profile.streak')}: ${xp.streak.days} ${t('profile.days')}` : '';
  return `XP: ${xp.xp}\n${t('profile.level')}: ${xp.level}${streak}`;
}

function formatXpCompact(t: Translator, xp?: XpState): string {
  if (!xp) return '-';
  return `${t('profile.level')}: ${xp.level} - XP: ${xp.xp}`;
}

export function createSuziEmbed(color: keyof typeof SUZI_COLORS = 'primary'): EmbedBuilder {
  return new EmbedBuilder().setColor(SUZI_COLORS[color]);
}

function getAchievementName(t: Translator, item: AchievementDefinition): string {
  const key = `achievement.${item.id}.name`;
  const translated = t(key);
  return translated === key ? item.name : translated;
}

function getAchievementDescription(t: Translator, item: AchievementDefinition): string {
  const key = `achievement.${item.id}.description`;
  const translated = t(key);
  return translated === key ? item.description : translated;
}

export function buildAchievementUnlockEmbed(
  t: Translator,
  unlocked: AchievementDefinition[],
): EmbedBuilder | null {
  if (!unlocked.length) return null;
  if (unlocked.length === 1) {
    const item = unlocked[0];
    return createSuziEmbed('accent')
      .setTitle(
        `${EMOJI.trophy} ${t('achievements.unlocked.single', {
          name: `${item.emoji} ${getAchievementName(t, item)}`,
        })}`,
      )
      .setDescription(getAchievementDescription(t, item));
  }

  const lines = unlocked.map((item) => `- ${item.emoji} ${getAchievementName(t, item)}`);
  return createSuziEmbed('accent')
    .setTitle(`${EMOJI.trophy} ${t('achievements.unlocked.multi')}`)
    .setDescription(lines.join('\n'));
}

export function buildHelpEmbed(t: Translator, botUser?: User | null): EmbedBuilder {
  const embed = createSuziEmbed('primary')
    .setTitle(`${EMOJI.scroll} ${t('help.title')}`)
    .setDescription(t('help.description'))
    .addFields(
      {
        name: `${EMOJI.brain} ${t('help.section.info.name')}`,
        value: safeText(t('help.section.info.value'), 1024),
      },
      {
        name: t('help.section.integrations.name'),
        value: safeText(t('help.section.integrations.value'), 1024),
      },
      {
        name: `${EMOJI.game} ${t('help.section.media.name')}`,
        value: safeText(t('help.section.media.value'), 1024),
      },
      {
        name: `${EMOJI.level} ${t('help.section.reviews.name')}`,
        value: safeText(t('help.section.reviews.value'), 1024),
      },
      {
        name: `${EMOJI.bolt} ${t('help.section.recommendations.name')}`,
        value: safeText(t('help.section.recommendations.value'), 1024),
      },
      {
        name: `${EMOJI.dice} ${t('help.section.rpg.name')}`,
        value: safeText(t('help.section.rpg.value'), 1024),
      },
      {
        name: t('help.section.history.name'),
        value: safeText(t('help.section.history.value'), 1024),
      },
      {
        name: `${EMOJI.profile} ${t('help.section.profile.name')}`,
        value: safeText(t('help.section.profile.value'), 1024),
      },
    )
    .setFooter({ text: t('help.footer') });

  if (botUser) {
    embed.setThumbnail(botUser.displayAvatarURL({ size: 128 }));
  }

  return embed;
}

export function buildRegisterSuccessEmbed(
  t: Translator,
  user: User,
  player: PlayerProfile,
): EmbedBuilder {
  return createSuziEmbed('success')
    .setTitle(`${EMOJI.register} ${t('register.success.title')}`)
    .setDescription(t('register.success.desc', { name: safeText(player.playerName, 256) }))
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: t('register.success.field.player'), value: safeText(player.playerName, 1024), inline: true },
      { name: `${EMOJI.level} ${t('register.success.field.level')}`, value: String(player.level), inline: true },
      {
        name: t('register.success.field.next'),
        value: safeText(t('register.success.next'), 1024),
      },
    )
    .setFooter({ text: t('register.success.footer') });
}

export function buildRegisterWarningEmbed(t: Translator, user?: User | null): EmbedBuilder {
  const embed = createSuziEmbed('warning')
    .setTitle(`${EMOJI.warning} ${t('register.exists.title')}`)
    .setDescription(t('register.exists.desc'))
    .setFooter({ text: t('register.exists.footer') });

  if (user) {
    embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
  }

  return embed;
}

export function buildProfileEmbed(
  t: Translator,
  user: User,
  player: PlayerProfile,
  extras: ProfileExtras,
  mode: 'compact' | 'detailed' = 'detailed',
): EmbedBuilder {
  const playerLabel = player.playerName ? safeText(player.playerName, 256) : `<@${user.id}>`;
  const description = `${safeText(player.characterName, 256)} - ${safeText(player.className, 256)} - ${t(
    'profile.level',
  )} ${player.level}`;

  if (mode === 'compact') {
    const compactEmbed = createSuziEmbed('primary')
      .setTitle(`${EMOJI.profile} ${t('profile.title')} - ${playerLabel}`)
      .setDescription(description)
      .setThumbnail(user.displayAvatarURL({ size: 128 }))
      .addFields(
        {
          name: `${EMOJI.pin} ${t('profile.character')}`,
          value: safeText(
            `${t('profile.character_name')}: ${player.characterName}\n${t('profile.class')}: ${
              player.className
            }\n${t('profile.level')}: ${player.level}`,
            1024,
          ),
          inline: true,
        },
        {
          name: `${EMOJI.tag} ${t('profile.title_label')}`,
          value: formatTitleCompact(t, extras.equippedTitle, extras.classTitle),
          inline: true,
        },
        { name: `${EMOJI.bolt} ${t('profile.suzi_xp')}`, value: formatXpCompact(t, extras.xp), inline: true },
        {
          name: `${EMOJI.trophy} ${t('profile.achievements')}`,
          value: extras.achievements ? formatAchievementsCompact(t, extras.achievements) : t('achievements.total', { total: 0 }),
        },
      )
      .setFooter({
        text: t('profile.compact.footer'),
      });

    if (extras.favoritesText !== undefined) {
      compactEmbed.addFields({
        name: `${EMOJI.level} ${t('profile.favorites')}`,
        value: safeText(extras.favoritesText, 1024),
      });
    }

    return compactEmbed;
  }

  const classEmoji = getClassEmoji(player.className);

  const embed = createSuziEmbed('primary')
    .setTitle(`${EMOJI.profile} ${t('profile.title')} - ${playerLabel}`)
    .setDescription(description)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: t('profile.character'), value: safeText(player.characterName, 1024), inline: true },
      { name: `${EMOJI.class} ${t('profile.class')}`, value: `${classEmoji} ${safeText(player.className, 1000)}`, inline: true },
      { name: `${EMOJI.level} ${t('profile.level')}`, value: String(player.level), inline: true },
      { name: t('profile.titles'), value: formatTitle(t, extras.equippedTitle, extras.classTitle), inline: false },
      { name: t('profile.suzi_xp'), value: formatXp(t, extras.xp), inline: true },
    )
    .setFooter({ text: t('profile.footer') });

  if (extras.favoritesText !== undefined) {
    embed.addFields({
      name: `${EMOJI.level} ${t('profile.favorites')}`,
      value: safeText(extras.favoritesText, 1024),
    });
  }

  if (extras.achievements) {
    embed.addFields({
      name: `${EMOJI.trophy} ${t('profile.achievements')}`,
      value: formatAchievementsDetailed(t, extras.achievements),
    });
  }

  if (extras.history) {
    embed.addFields({
      name: t('profile.history'),
      value: formatHistory(t, extras.history),
    });
  }

  return embed;
}

export function buildMissingProfileEmbed(t: Translator, user?: User | null): EmbedBuilder {
  const embed = createSuziEmbed('warning')
    .setTitle(`${EMOJI.warning} ${t('profile.missing.title')}`)
    .setDescription(t('profile.missing.desc'))
    .setFooter({ text: t('profile.missing.footer') });

  if (user) {
    embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
  }

  return embed;
}
