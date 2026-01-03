import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  type ButtonInteraction,
  type Message,
  SlashCommandBuilder,
} from 'discord.js';

import { getUserAchievements, listAllAchievements, trackEvent } from '../../achievements/service.js';
import { env } from '../../config/env.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { isCanvasReady, getCanvasInitError } from '../../render/canvasState.js';
import { renderProfileCard, type ProfileCardLabels, type ProfileCardPage } from '../../render/profileCard.js';
import { getGuildLanguage, type GuildLanguage } from '../../services/guildSettingsService.js';
import { clearProfileBanner, getPlayerProfile, setProfileBanner } from '../../services/profileService.js';
import { getUserReviewCount, listUserReviews } from '../../services/reviewService.js';
import { getUserRolls } from '../../services/rollHistoryService.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { getUserXp, getXpProgress } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logInfo, logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, buildMissingProfileEmbed, createSuziEmbed } from '../embeds.js';

type ProfilePage = ProfileCardPage;
type BannerAction = 'set' | 'clear';

const BANNER_ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const PAGE_META: Record<ProfilePage, { labelKey: string; index: number; fileKey: string }> = {
  profile: { labelKey: 'profile.page.profile', index: 1, fileKey: 'perfil' },
  achievements: { labelKey: 'profile.page.achievements', index: 2, fileKey: 'conquistas' },
  history: { labelKey: 'profile.page.history', index: 3, fileKey: 'historico' },
  reviews: { labelKey: 'profile.page.reviews', index: 4, fileKey: 'reviews' },
};

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

function formatRelativeTime(ts: number, lang: GuildLanguage, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const diffMs = Math.max(0, Date.now() - ts);
  if (diffMs < 60_000) {
    return t('profile.relative.now');
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return t('profile.relative.minutes', { value: minutes });
  }
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) {
    return t('profile.relative.hours', { value: hours });
  }
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 7) {
    return t('profile.relative.days', { value: days });
  }
  const date = new Date(ts);
  const locale = lang === 'pt' ? 'pt-BR' : 'en-US';
  const dateText = date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return t('profile.relative.date', { date: dateText });
}

function resolveBanner(profileBanner?: string | null): string | null {
  const custom = profileBanner?.trim();
  if (custom) return custom;
  const fallback = env.defaultProfileBannerUrl || env.profileBannerUrl;
  return fallback ? fallback.trim() : null;
}

function validateBannerUrl(
  input: string,
  t: (key: string) => string,
): { ok: true; url: string } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, message: t('profile.banner.invalid_url') };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: t('profile.banner.invalid_protocol') };
  }

  const pathname = url.pathname.toLowerCase();
  const hasExtension = BANNER_ALLOWED_EXT.some((ext) => pathname.endsWith(ext));
  if (!hasExtension) {
    return {
      ok: false,
      message: t('profile.banner.invalid_extension'),
    };
  }

  return { ok: true, url: url.toString() };
}

function buildProfileButtons(
  t: (key: string) => string,
  active: ProfilePage,
  disabled = false,
  disableActive = true,
): ActionRowBuilder<ButtonBuilder> {
  const profile = new ButtonBuilder()
    .setCustomId('perfil:profile')
    .setLabel(t('profile.button.profile'))
    .setStyle(active === 'profile' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled || (disableActive && active === 'profile'));

  const achievements = new ButtonBuilder()
    .setCustomId('perfil:achievements')
    .setLabel(t('profile.button.achievements'))
    .setStyle(active === 'achievements' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled || (disableActive && active === 'achievements'));

  const history = new ButtonBuilder()
    .setCustomId('perfil:history')
    .setLabel(t('profile.button.history'))
    .setStyle(active === 'history' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled || (disableActive && active === 'history'));

  const reviews = new ButtonBuilder()
    .setCustomId('perfil:reviews')
    .setLabel(t('profile.button.reviews'))
    .setStyle(active === 'reviews' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled || (disableActive && active === 'reviews'));

  const close = new ButtonBuilder()
    .setCustomId('perfil:close')
    .setLabel(t('profile.button.close'))
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(profile, achievements, history, reviews, close);
}

function resolvePage(customId: string): ProfilePage | null {
  if (customId === 'perfil:profile') return 'profile';
  if (customId === 'perfil:achievements') return 'achievements';
  if (customId === 'perfil:history') return 'history';
  if (customId === 'perfil:reviews') return 'reviews';
  return null;
}

export const perfilCommand = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription(tLang('en', 'profile.command.desc'))
    .setDescriptionLocalizations(getLocalized('profile.command.desc'))
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(tLang('en', 'profile.option.user'))
        .setDescriptionLocalizations(getLocalized('profile.option.user'))
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('detalhado')
        .setDescription(tLang('en', 'profile.option.detail'))
        .setDescriptionLocalizations(getLocalized('profile.option.detail'))
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('banner')
        .setDescription(tLang('en', 'profile.option.banner'))
        .setDescriptionLocalizations(getLocalized('profile.option.banner'))
        .setRequired(false)
        .addChoices(
          {
            name: tLang('en', 'profile.option.banner.set'),
            name_localizations: getLocalized('profile.option.banner.set'),
            value: 'set',
          },
          {
            name: tLang('en', 'profile.option.banner.clear'),
            name_localizations: getLocalized('profile.option.banner.clear'),
            value: 'clear',
          },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('url')
        .setDescription(tLang('en', 'profile.option.banner.url'))
        .setDescriptionLocalizations(getLocalized('profile.option.banner.url'))
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);
    const lang = getGuildLanguage(interaction.guildId);
    const target = interaction.options.getUser('user') ?? interaction.user;
    const bannerAction = interaction.options.getString('banner') as BannerAction | null;
    const bannerUrl = interaction.options.getString('url');

    try {
      const profile = getPlayerProfile(target.id, interaction.guildId ?? null);
      if (!profile) {
        const embed = buildMissingProfileEmbed(t, target);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (bannerAction) {
        if (target.id !== interaction.user.id) {
          const embed = createSuziEmbed('warning')
            .setTitle(t('profile.banner.only_self.title'))
            .setDescription(t('profile.banner.only_self.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        if (bannerAction === 'set') {
          if (!bannerUrl) {
            const embed = createSuziEmbed('warning')
              .setTitle(t('profile.banner.missing.title'))
              .setDescription(t('profile.banner.missing.desc'));
            await safeRespond(interaction, { embeds: [embed] });
            return;
          }
          const validation = validateBannerUrl(bannerUrl, t);
          if (!validation.ok) {
            const embed = createSuziEmbed('warning')
              .setTitle(t('profile.banner.invalid.title'))
              .setDescription(validation.message);
            await safeRespond(interaction, { embeds: [embed] });
            return;
          }
          const updated = setProfileBanner(
            interaction.user.id,
            validation.url,
            interaction.user.id,
            interaction.guildId ?? null,
          );
          if (!updated) {
            const embed = createSuziEmbed('warning')
              .setTitle(t('profile.banner.save_failed.title'))
              .setDescription(t('profile.banner.save_failed.desc'));
            await safeRespond(interaction, { embeds: [embed] });
            return;
          }
          const embed = createSuziEmbed('success')
            .setTitle(t('profile.banner.updated.title'))
            .setDescription(t('profile.banner.updated.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        if (bannerAction === 'clear') {
          const updated = clearProfileBanner(interaction.user.id, interaction.user.id, interaction.guildId ?? null);
          if (!updated) {
            const embed = createSuziEmbed('warning')
              .setTitle(t('profile.banner.clear_failed.title'))
              .setDescription(t('profile.banner.clear_failed.desc'));
            await safeRespond(interaction, { embeds: [embed] });
            return;
          }
          const embed = createSuziEmbed('success')
            .setTitle(t('profile.banner.cleared.title'))
            .setDescription(t('profile.banner.cleared.desc'));
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }
      }

      const achievementsState = getUserAchievements(target.id);
      const definitions = listAllAchievements();
      const unlockedMap = new Map(achievementsState.unlockedList.map((entry) => [entry.id, entry.unlockedAt]));
      const unlocked = definitions.filter((definition) => unlockedMap.has(definition.id));

      const xpState = getUserXp(target.id, interaction.guildId ?? null);
      const progress = getXpProgress(xpState);

      const rolls = getUserRolls(target.id, 5, interaction.guildId ?? null);
      const historyEntries = rolls.map((entry) => ({
        expr: entry.expr,
        total: entry.total,
        when: formatRelativeTime(entry.ts, lang, t),
      }));

      const guildId = interaction.guildId;
      const canShowReviews = Boolean(guildId);
      const favorites = canShowReviews
        ? listUserReviews(guildId ?? '', target.id, { favoritesOnly: true, order: 'stars', limit: 10 })
        : [];
      const topReviews = canShowReviews
        ? listUserReviews(guildId ?? '', target.id, { order: 'stars', limit: 5 })
        : [];
      const totalReviews = canShowReviews ? getUserReviewCount(guildId ?? '', target.id) : 0;

      const favoriteKeys = new Set(favorites.map((entry) => `${entry.type}:${entry.itemKey}`));
      const favoriteEntries = favorites.slice(0, 3).map((entry) => ({
        type: entry.type,
        name: entry.name,
        stars: entry.review.stars,
        category: entry.review.category,
      }));
      const reviewEntries = topReviews.map((entry) => ({
        type: entry.type,
        name: entry.name,
        stars: entry.review.stars,
        category: entry.review.category,
        favorite: favoriteKeys.has(`${entry.type}:${entry.itemKey}`),
      }));

      const displayName = target.globalName ?? target.username;
      const banner = resolveBanner(profile.bannerUrl);
      const avatarUrl = target.displayAvatarURL({ size: 256, extension: 'png' });

      const categoryLabels: ProfileCardLabels['categoryLabels'] = {
        AMEI: t('labels.category.amei'),
        JOGAVEL: t('labels.category.jogavel'),
        RUIM: t('labels.category.ruim'),
      };

      const labels: ProfileCardLabels = {
        pageLabels: {
          profile: t('profile.page.profile'),
          achievements: t('profile.page.achievements'),
          history: t('profile.page.history'),
          reviews: t('profile.page.reviews'),
        },
        progressTitle: t('profile.card.progress_title'),
        levelLine: t('profile.card.level', { level: progress.level }),
        xpLine: t('profile.card.xp', {
          current: Math.round(progress.current),
          needed: Math.max(1, Math.round(progress.needed)),
          percent: Math.round(progress.percent),
        }),
        favoritesTitle: t('profile.card.favorites_title'),
        favoritesEmpty: t('profile.card.favorites_empty'),
        achievementsTitle: t('profile.card.achievements_title'),
        achievementsTotal: t('profile.card.achievements_total', { total: unlocked.length }),
        achievementsEmpty: t('profile.card.achievements_empty'),
        historyTitle: t('profile.card.history_title'),
        historyEmpty: t('profile.card.history_empty'),
        reviewsTitle: t('profile.card.reviews_title'),
        reviewsTotal: t('profile.card.reviews_total', { total: totalReviews }),
        reviewsEmpty: t('profile.card.reviews_empty'),
        categoryLabels,
      };

      const cardBase = {
        displayName,
        avatarUrl,
        bannerUrl: banner,
        level: progress.level,
        xpCurrent: progress.current,
        xpNeeded: progress.needed,
        xpPercent: progress.percent,
        favorites: favoriteEntries,
        achievements: unlocked.slice(0, 6).map((definition) => ({
          emoji: definition.emoji,
          name: (() => {
            const key = `achievement.${definition.id}.name`;
            const translated = t(key);
            return translated === key ? definition.name : translated;
          })(),
        })),
        totalAchievements: unlocked.length,
        history: historyEntries,
        reviews: reviewEntries,
        totalReviews,
        labels,
      };

      const buildPagePayload = async (page: ProfilePage, forUpdate: boolean) => {
        const { labelKey, index, fileKey } = PAGE_META[page];
        const label = t(labelKey);
        const fileName = `profile-${fileKey}.png`;
        let attachment: AttachmentBuilder | null = null;
        let renderError: string | null = null;
        logInfo('SUZI-CANVAS-001', 'Render start', {
          cmd: 'perfil',
          page,
          userId: target.id,
          guildId: interaction.guildId ?? 'dm',
        });
        try {
          if (!isCanvasReady()) {
            renderError = t('profile.render_error');
            logWarn('SUZI-CANVAS-001', new Error('Canvas indisponivel'), {
              message: 'Canvas indisponivel para renderizar perfil',
              userId: target.id,
              reason: getCanvasInitError(),
            });
          } else {
            const buffer = await renderProfileCard({ ...cardBase, page });
            attachment = new AttachmentBuilder(buffer, { name: fileName });
          }
        } catch (error) {
          renderError = t('profile.render_error');
          logWarn('SUZI-CMD-002', error, { message: 'Falha ao renderizar card do perfil', userId: target.id });
        }

        const embed = createSuziEmbed('primary')
          .setTitle(t('profile.embed.title', { page: label, name: safeText(displayName, 64) }))
          .setFooter({ text: t('profile.embed.footer', { index, total: 4, page: label }) });
        if (renderError) {
          embed.setDescription(renderError);
        }

        if (attachment) {
          embed.setImage(`attachment://${fileName}`);
        } else if (banner) {
          embed.setImage(banner);
        }

        const payload: {
          embeds: ReturnType<typeof createSuziEmbed>[];
          components: ActionRowBuilder<ButtonBuilder>[];
          files?: AttachmentBuilder[];
          attachments?: [];
        } = { embeds: [embed], components: [buildProfileButtons(t, page)] };

        if (attachment) {
          payload.files = [attachment];
        }
        if (forUpdate) {
          payload.attachments = [];
        }

        return payload;
      };

      let currentPage: ProfilePage = 'profile';
      const initialPayload = await buildPagePayload(currentPage, false);
      await safeRespond(interaction, initialPayload);

      let message: Message | null = null;
      try {
        const fetched = await interaction.fetchReply();
        if (fetched && 'createMessageComponentCollector' in fetched) {
          message = fetched as Message;
        }
      } catch (error) {
        logWarn('SUZI-DISCORD-001', error, { message: 'Falha ao buscar mensagem do /perfil' });
      }

      if (message) {
        const collector = message.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120_000,
        });

        collector.on('collect', async (button: ButtonInteraction) => {
          if (!button.customId.startsWith('perfil:')) return;

          if (button.user.id !== interaction.user.id) {
            await button.reply({
              content: t('profile.button.only_author'),
              ephemeral: true,
            });
            return;
          }

          if (button.customId === 'perfil:close') {
            await button.update({ components: [buildProfileButtons(t, currentPage, true)] });
            collector.stop('closed');
            return;
          }

          const nextPage = resolvePage(button.customId);
          if (!nextPage) {
            await button.reply({ content: t('profile.button.invalid'), ephemeral: true });
            return;
          }

          currentPage = nextPage;
          const nextPayload = await buildPagePayload(currentPage, true);
          await button.update(nextPayload);
        });

        collector.on('end', async () => {
          if (!message) return;
          try {
            await message.edit({ components: [buildProfileButtons(t, currentPage, true)] });
          } catch (error) {
            logWarn('SUZI-DISCORD-001', error, { message: 'Falha ao desabilitar botoes do /perfil' });
          }
        });
      }

      try {
        const { unlocked: unlockedTitles } = trackEvent(interaction.user.id, 'perfil');
        unlockTitlesFromAchievements(interaction.user.id, unlockedTitles);
        const unlockEmbed = buildAchievementUnlockEmbed(t, unlockedTitles);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /perfil' });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /perfil' });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002', interaction.guildId));
    }
  },
};
