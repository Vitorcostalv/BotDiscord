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
import { renderProfileCard, type ProfileCardPage } from '../../render/profileCard.js';
import { clearProfileBanner, getPlayerProfile, setProfileBanner } from '../../services/profileService.js';
import { getUserReviewCount, listUserReviews } from '../../services/reviewService.js';
import { getUserRolls } from '../../services/rollHistoryService.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { getUserXp, getXpProgress } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, buildMissingProfileEmbed, createSuziEmbed } from '../embeds.js';

type ProfilePage = ProfileCardPage;
type BannerAction = 'set' | 'clear';

const BANNER_ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const PAGE_LABELS: Record<ProfilePage, { label: string; index: number; fileKey: string }> = {
  profile: { label: 'Perfil', index: 1, fileKey: 'perfil' },
  achievements: { label: 'Conquistas', index: 2, fileKey: 'conquistas' },
  history: { label: 'Historico', index: 3, fileKey: 'historico' },
  reviews: { label: 'Reviews', index: 4, fileKey: 'reviews' },
};

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

function formatRelativeTime(ts: number): string {
  const diffMs = Math.max(0, Date.now() - ts);
  if (diffMs < 60_000) {
    return 'ha 1m';
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `ha ${minutes}m`;
  }
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) {
    return `ha ${hours}h`;
  }
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 7) {
    return `ha ${days}d`;
  }
  const date = new Date(ts);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function resolveBanner(profileBanner?: string | null): string | null {
  const custom = profileBanner?.trim();
  if (custom) return custom;
  const fallback = env.defaultProfileBannerUrl || env.profileBannerUrl;
  return fallback ? fallback.trim() : null;
}

function validateBannerUrl(input: string): { ok: true; url: string } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, message: 'URL invalida. Use um link http/https.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: 'Use um link http/https valido.' };
  }

  const pathname = url.pathname.toLowerCase();
  const hasExtension = BANNER_ALLOWED_EXT.some((ext) => pathname.endsWith(ext));
  if (!hasExtension) {
    return {
      ok: false,
      message: 'Use um link direto para imagem (.png, .jpg, .gif, .webp).',
    };
  }

  return { ok: true, url: url.toString() };
}

function buildProfileButtons(
  active: ProfilePage,
  disabled = false,
  disableActive = true,
): ActionRowBuilder<ButtonBuilder> {
  const profile = new ButtonBuilder()
    .setCustomId('perfil:profile')
    .setLabel('Perfil')
    .setStyle(active === 'profile' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled || (disableActive && active === 'profile'));

  const achievements = new ButtonBuilder()
    .setCustomId('perfil:achievements')
    .setLabel('Conquistas')
    .setStyle(active === 'achievements' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled || (disableActive && active === 'achievements'));

  const history = new ButtonBuilder()
    .setCustomId('perfil:history')
    .setLabel('Historico')
    .setStyle(active === 'history' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled || (disableActive && active === 'history'));

  const reviews = new ButtonBuilder()
    .setCustomId('perfil:reviews')
    .setLabel('Reviews')
    .setStyle(active === 'reviews' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled || (disableActive && active === 'reviews'));

  const close = new ButtonBuilder()
    .setCustomId('perfil:close')
    .setLabel('Fechar')
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
    .setDescription('Mostra o perfil do player')
    .addUserOption((option) => option.setName('user').setDescription('Jogador alvo').setRequired(false))
    .addBooleanOption((option) =>
      option.setName('detalhado').setDescription('Mostra informacoes completas').setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('banner')
        .setDescription('Ajusta o banner do perfil')
        .setRequired(false)
        .addChoices(
          { name: 'set', value: 'set' },
          { name: 'clear', value: 'clear' },
        ),
    )
    .addStringOption((option) =>
      option.setName('url').setDescription('URL do banner (http/https)').setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const target = interaction.options.getUser('user') ?? interaction.user;
    const bannerAction = interaction.options.getString('banner') as BannerAction | null;
    const bannerUrl = interaction.options.getString('url');

    try {
      const profile = getPlayerProfile(target.id);
      if (!profile) {
        const embed = buildMissingProfileEmbed(target);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (bannerAction) {
        if (target.id !== interaction.user.id) {
          const embed = createSuziEmbed('warning')
            .setTitle('Banner indisponivel')
            .setDescription('Voce so pode editar o seu proprio banner.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        if (bannerAction === 'set') {
          if (!bannerUrl) {
            const embed = createSuziEmbed('warning')
              .setTitle('Informe o banner')
              .setDescription('Use /perfil banner:set url:<link para imagem>.');
            await safeRespond(interaction, { embeds: [embed] });
            return;
          }
          const validation = validateBannerUrl(bannerUrl);
          if (!validation.ok) {
            const embed = createSuziEmbed('warning')
              .setTitle('URL invalida')
              .setDescription(validation.message);
            await safeRespond(interaction, { embeds: [embed] });
            return;
          }
          const updated = setProfileBanner(interaction.user.id, validation.url, interaction.user.id);
          if (!updated) {
            const embed = createSuziEmbed('warning')
              .setTitle('Nao consegui salvar')
              .setDescription('Registre seu perfil com /register antes de ajustar o banner.');
            await safeRespond(interaction, { embeds: [embed] });
            return;
          }
          const embed = createSuziEmbed('success')
            .setTitle('Banner atualizado')
            .setDescription('Seu banner foi salvo.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        if (bannerAction === 'clear') {
          const updated = clearProfileBanner(interaction.user.id, interaction.user.id);
          if (!updated) {
            const embed = createSuziEmbed('warning')
              .setTitle('Nao consegui remover')
              .setDescription('Registre seu perfil com /register antes de ajustar o banner.');
            await safeRespond(interaction, { embeds: [embed] });
            return;
          }
          const embed = createSuziEmbed('success')
            .setTitle('Banner removido')
            .setDescription('Voltando para o banner padrao.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }
      }

      const achievementsState = getUserAchievements(target.id);
      const definitions = listAllAchievements();
      const unlockedMap = new Map(achievementsState.unlockedList.map((entry) => [entry.id, entry.unlockedAt]));
      const unlocked = definitions.filter((definition) => unlockedMap.has(definition.id));

      const xpState = getUserXp(target.id);
      const progress = getXpProgress(xpState);

      const rolls = getUserRolls(target.id, 5);
      const historyEntries = rolls.map((entry) => ({
        expr: entry.expr,
        total: entry.total,
        when: formatRelativeTime(entry.ts),
      }));

      const guildId = interaction.guildId;
      const canShowReviews = Boolean(guildId);
      const favorites = canShowReviews
        ? listUserReviews(guildId ?? '', target.id, { favoritesOnly: true, order: 'stars', limit: 3 })
        : [];
      const topReviews = canShowReviews
        ? listUserReviews(guildId ?? '', target.id, { order: 'stars', limit: 5 })
        : [];
      const totalReviews = canShowReviews ? getUserReviewCount(guildId ?? '', target.id) : 0;

      const favoriteKeys = new Set(favorites.map((entry) => entry.gameKey));
      const favoriteEntries = favorites.map((entry) => ({
        name: entry.name,
        stars: entry.review.stars,
        category: entry.review.category,
      }));
      const reviewEntries = topReviews.map((entry) => ({
        name: entry.name,
        stars: entry.review.stars,
        category: entry.review.category,
        favorite: favoriteKeys.has(entry.gameKey),
      }));

      const displayName = target.globalName ?? target.username;
      const banner = resolveBanner(profile.bannerUrl);
      const avatarUrl = target.displayAvatarURL({ size: 256, extension: 'png' });

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
          name: definition.name,
        })),
        totalAchievements: unlocked.length,
        history: historyEntries,
        reviews: reviewEntries,
        totalReviews,
      };

      const buildPagePayload = async (page: ProfilePage, forUpdate: boolean) => {
        const { label, index, fileKey } = PAGE_LABELS[page];
        const fileName = `profile-${fileKey}.png`;
        let attachment: AttachmentBuilder | null = null;
        try {
          const buffer = await renderProfileCard({ ...cardBase, page });
          attachment = new AttachmentBuilder(buffer, { name: fileName });
        } catch (error) {
          logWarn('SUZI-CMD-002', error, { message: 'Falha ao renderizar card do perfil', userId: target.id });
        }

        const embed = createSuziEmbed('primary')
          .setTitle(`${label} - ${safeText(displayName, 64)}`)
          .setFooter({ text: `Pagina ${index}/4 - ${label}` });

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
        } = { embeds: [embed], components: [buildProfileButtons(page)] };

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
              content: 'So quem abriu o perfil pode navegar.',
              ephemeral: true,
            });
            return;
          }

          if (button.customId === 'perfil:close') {
            await button.update({ components: [buildProfileButtons(currentPage, true)] });
            collector.stop('closed');
            return;
          }

          const nextPage = resolvePage(button.customId);
          if (!nextPage) {
            await button.reply({ content: 'Botao invalido.', ephemeral: true });
            return;
          }

          currentPage = nextPage;
          const nextPayload = await buildPagePayload(currentPage, true);
          await button.update(nextPayload);
        });

        collector.on('end', async () => {
          if (!message) return;
          try {
            await message.edit({ components: [buildProfileButtons(currentPage, true)] });
          } catch (error) {
            logWarn('SUZI-DISCORD-001', error, { message: 'Falha ao desabilitar botoes do /perfil' });
          }
        });
      }

      try {
        const { unlocked: unlockedTitles } = trackEvent(interaction.user.id, 'perfil');
        unlockTitlesFromAchievements(interaction.user.id, unlockedTitles);
        const unlockEmbed = buildAchievementUnlockEmbed(unlockedTitles);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /perfil' });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /perfil' });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002'));
    }
  },
};
