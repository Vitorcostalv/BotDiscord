import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { hasRegisterPermission } from '../../services/permissionService.js';
import {
  getCachedSummary,
  getSteamLink,
  linkSteam,
  mapPersonaState,
  unlinkSteam,
  validateSteamId64,
} from '../../services/steamService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_GAME = '\u{1F3AE}';
const EMOJI_LINK = '\u{1F517}';
const EMOJI_REFRESH = '\u{1F503}';
const EMOJI_WARNING = '\u26A0\uFE0F';
const REFRESH_COOLDOWN_MS = 30_000;
const refreshCooldowns = new Map<string, number>();

type SteamAction = 'link' | 'unlink' | 'view' | 'refresh';

function localizedChoice(labelKey: string, value: SteamAction, emoji?: string) {
  const en = tLang('en', labelKey);
  const pt = tLang('pt', labelKey);
  const prefix = emoji ? `${emoji} ` : '';
  return {
    name: `${prefix}${en}`,
    name_localizations: {
      'en-US': `${prefix}${en}`,
      'pt-BR': `${prefix}${pt}`,
    },
    value,
  };
}

const ACTION_CHOICES = [
  localizedChoice('steam.action.link', 'link', EMOJI_LINK),
  localizedChoice('steam.action.view', 'view'),
  localizedChoice('steam.action.refresh', 'refresh', EMOJI_REFRESH),
  localizedChoice('steam.action.unlink', 'unlink'),
];

function isRefreshOnCooldown(userId: string): number | null {
  const now = Date.now();
  const expiresAt = refreshCooldowns.get(userId);
  if (!expiresAt || now >= expiresAt) {
    refreshCooldowns.set(userId, now + REFRESH_COOLDOWN_MS);
    return null;
  }
  return Math.ceil((expiresAt - now) / 1000);
}

function buildSteamField(
  t: (key: string, vars?: Record<string, string | number>) => string,
  summary: {
    personaname: string;
    personastate: number;
    gameextrainfo?: string;
    lastlogoff?: number;
    profileurl?: string;
  },
): string {
  const stateKey = mapPersonaState(summary.personastate);
  const status = t(`steam.status.${stateKey}`);
  const displayName =
    summary.personaname && summary.personaname !== 'Sem nome' ? summary.personaname : t('steam.field.unknown_name');
  const game = summary.gameextrainfo ? `${EMOJI_GAME} ${summary.gameextrainfo}` : t('common.none');
  const last = summary.lastlogoff ? `<t:${summary.lastlogoff}:R>` : t('common.none');
  const profileLink = summary.profileurl ? summary.profileurl : t('common.none');
  const lines = [
    `${t('steam.field.name')}: ${displayName}`,
    `${t('steam.field.status')}: ${status}`,
    `${t('steam.field.playing')}: ${game}`,
    `${t('steam.field.last_online')}: ${last}`,
    `${t('steam.field.link')}: ${profileLink}`,
  ];

  if (!summary.gameextrainfo) {
    lines.push(t('steam.note.private'));
  }

  return lines.join('\n');
}

function ensureSteamEnabled(
  t: (key: string, vars?: Record<string, string | number>) => string,
): { ok: true } | { ok: false; embed: ReturnType<typeof createSuziEmbed> } {
  if (env.steamApiKey) {
    return { ok: true };
  }
  const embed = createSuziEmbed('warning')
    .setTitle(`${EMOJI_WARNING} ${t('steam.disabled.title')}`)
    .setDescription(t('steam.disabled.desc'));
  return { ok: false, embed };
}

export const steamCommand = {
  data: new SlashCommandBuilder()
    .setName('steam')
    .setDescription(tLang('en', 'steam.command.desc'))
    .setDescriptionLocalizations(getLocalized('steam.command.desc'))
    .addStringOption((option) =>
      option
        .setName('acao')
        .setNameLocalizations(getLocalized('steam.option.action.name'))
        .setDescription(tLang('en', 'steam.option.action.desc'))
        .setDescriptionLocalizations(getLocalized('steam.option.action.desc'))
        .setRequired(true)
        .addChoices(...ACTION_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('steamid64')
        .setNameLocalizations(getLocalized('steam.option.steamid.name'))
        .setDescription(tLang('en', 'steam.option.steamid.desc'))
        .setDescriptionLocalizations(getLocalized('steam.option.steamid.desc'))
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setNameLocalizations(getLocalized('steam.option.user.name'))
        .setDescription(tLang('en', 'steam.option.user.desc'))
        .setDescriptionLocalizations(getLocalized('steam.option.user.desc'))
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('force')
        .setNameLocalizations(getLocalized('steam.option.force.name'))
        .setDescription(tLang('en', 'steam.option.force.desc'))
        .setDescriptionLocalizations(getLocalized('steam.option.force.desc'))
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);
    const action = interaction.options.getString('acao', true) as SteamAction;

    const enabled = ensureSteamEnabled(t);
    if (!enabled.ok) {
      await safeRespond(interaction, { embeds: [enabled.embed] });
      return;
    }

    if (action === 'refresh') {
      const cooldown = isRefreshOnCooldown(interaction.user.id);
      if (cooldown) {
        const embed = createSuziEmbed('warning')
          .setTitle(t('steam.refresh.cooldown.title'))
          .setDescription(t('steam.refresh.cooldown.desc', { wait: cooldown }));
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }
    }

    try {
      if (action === 'link') {
        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const isSelf = targetUser.id === interaction.user.id;
        const force = interaction.options.getBoolean('force') ?? false;
        const steamId64 = interaction.options.getString('steamid64')?.trim();
        if (!steamId64) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('steam.link.missing_id.title'))
            .setDescription(t('steam.link.missing_id.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        if (!isSelf && !hasRegisterPermission(interaction)) {
          const embed = createSuziEmbed('warning')
            .setTitle(`${EMOJI_WARNING} ${t('steam.link.permission.title')}`)
            .setDescription(t('steam.link.permission.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        if (!validateSteamId64(steamId64)) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('steam.link.invalid_id.title'))
            .setDescription(t('steam.link.invalid_id.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const existing = getSteamLink(targetUser.id, interaction.guildId ?? null);
        if (existing && !force) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('steam.link.exists.title'))
            .setDescription(t('steam.link.exists.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const summaryResult = await getCachedSummary(steamId64, {
          force: true,
          guildId: interaction.guildId ?? null,
        });
        if (!summaryResult.ok && summaryResult.reason === 'NOT_FOUND') {
          const embed = createSuziEmbed('warning')
            .setTitle(t('steam.link.failed.title'))
            .setDescription(t('steam.link.failed.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        linkSteam(targetUser.id, steamId64, interaction.user.id, interaction.guildId ?? null);

        const embed = createSuziEmbed('success')
          .setTitle(`${EMOJI_LINK} ${t('steam.link.success.title')}`)
          .setDescription(t('steam.link.success.desc', { user: `<@${targetUser.id}>` }));

        if (summaryResult.ok) {
          embed.addFields({ name: t('steam.field.profile'), value: buildSteamField(t, summaryResult.summary) });
          if (summaryResult.summary.avatarfull) {
            embed.setThumbnail(summaryResult.summary.avatarfull);
          }
        } else {
          embed.addFields({
            name: t('steam.field.profile'),
            value: t('steam.link.profile_unavailable'),
          });
        }

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'unlink') {
        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const isSelf = targetUser.id === interaction.user.id;

        if (!isSelf && !hasRegisterPermission(interaction)) {
          const embed = createSuziEmbed('warning')
            .setTitle(`${EMOJI_WARNING} ${t('steam.unlink.permission.title')}`)
            .setDescription(t('steam.unlink.permission.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const removed = unlinkSteam(targetUser.id, interaction.guildId ?? null);
        if (!removed) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('steam.unlink.none.title'))
            .setDescription(t('steam.unlink.none.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const embed = createSuziEmbed('success')
          .setTitle(t('steam.unlink.success.title'))
          .setDescription(t('steam.unlink.success.desc', { user: `<@${targetUser.id}>` }));
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'view' || action === 'refresh') {
        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const link = getSteamLink(targetUser.id, interaction.guildId ?? null);
        if (!link) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('steam.view.none.title'))
            .setDescription(t('steam.view.none.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const summaryResult = await getCachedSummary(link.steamId64, {
          force: action === 'refresh',
          guildId: interaction.guildId ?? null,
        });
        if (!summaryResult.ok) {
          const embed = createSuziEmbed('warning')
            .setTitle(`${EMOJI_WARNING} ${t('steam.view.error.title')}`)
            .setDescription(
              summaryResult.reason === 'NOT_FOUND'
                ? t('steam.view.error.not_found')
                : t('steam.view.error.generic'),
            );
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const embed = createSuziEmbed('primary')
          .setTitle(`${EMOJI_GAME} ${t('steam.view.title')}`)
          .setDescription(t('steam.view.user', { user: `<@${targetUser.id}>` }))
          .addFields({ name: t('steam.field.details'), value: buildSteamField(t, summaryResult.summary) });

        if (summaryResult.summary.avatarfull) {
          embed.setThumbnail(summaryResult.summary.avatarfull);
        }

        if (action === 'refresh') {
          embed.setFooter({ text: `${EMOJI_REFRESH} ${t('steam.view.cache_updated')}` });
        }

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /steam', action });
      const embed = createSuziEmbed('warning').setTitle(t('steam.error.title')).setDescription(t('steam.error.desc'));
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
