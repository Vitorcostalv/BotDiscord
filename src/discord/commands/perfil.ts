import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  type ButtonInteraction,
  type Message,
  SlashCommandBuilder,
} from 'discord.js';

import type { AchievementDefinition } from '../../achievements/definitions.js';
import { listAllAchievements, trackEvent, getUserAchievements } from '../../achievements/service.js';
import { env } from '../../config/env.js';
import { getUserRolls } from '../../services/rollHistoryService.js';
import {
  clearProfileBanner,
  getPlayerProfile,
  setProfileBanner,
} from '../../services/profileService.js';
import { getUserReviewCount, listUserReviews, type ReviewCategory } from '../../services/reviewService.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { getUserXp, getXpProgress } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, buildMissingProfileEmbed, createSuziEmbed } from '../embeds.js';

const EMOJI_HEART = '\u{1F496}';
const EMOJI_GAME = '\u{1F3AE}';
const EMOJI_SKULL = '\u{1F480}';
const EMOJI_SCROLL = '\u{1F4DC}';
const EMOJI_TROPHY = '\u{1F3C6}';

const CATEGORY_EMOJI: Record<ReviewCategory, string> = {
  AMEI: EMOJI_HEART,
  JOGAVEL: EMOJI_GAME,
  RUIM: EMOJI_SKULL,
};

type ProfilePage = 'profile' | 'achievements' | 'history' | 'reviews';
type BannerAction = 'set' | 'clear';

const BANNER_ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const PROGRESS_BAR_SIZE = 10;

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

function formatStars(value: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(value)));
  return `${'★'.repeat(clamped)}${'☆'.repeat(5 - clamped)}`;
}

function buildProgressBar(percent: number): string {
  const filled = Math.min(PROGRESS_BAR_SIZE, Math.max(0, Math.round((percent / 100) * PROGRESS_BAR_SIZE)));
  return `${'█'.repeat(filled)}${'░'.repeat(PROGRESS_BAR_SIZE - filled)}`;
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

function buildProfileButtons(active: ProfilePage, disabled = false): ActionRowBuilder<ButtonBuilder> {
  const profile = new ButtonBuilder()
    .setCustomId('perfil:profile')
    .setLabel('Perfil')
    .setStyle(active === 'profile' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled);

  const achievements = new ButtonBuilder()
    .setCustomId('perfil:achievements')
    .setLabel('Conquistas')
    .setStyle(active === 'achievements' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled);

  const history = new ButtonBuilder()
    .setCustomId('perfil:history')
    .setLabel('Historico')
    .setStyle(active === 'history' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled);

  const reviews = new ButtonBuilder()
    .setCustomId('perfil:reviews')
    .setLabel('Reviews')
    .setStyle(active === 'reviews' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled);

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

function formatFavorites(
  items: Array<{ name: string; stars: number; category: ReviewCategory }>,
  canShow: boolean,
): string {
  if (!canShow) {
    return 'Use /perfil em um servidor para ver favoritos.';
  }
  if (!items.length) {
    return 'Sem favoritos ainda.';
  }
  return items
    .map((entry) => `- ${safeText(entry.name, 40)} ${formatStars(entry.stars)} ${CATEGORY_EMOJI[entry.category]} ${entry.category}`)
    .join('\n');
}

function formatAchievements(total: number, unlocked: AchievementDefinition[]): string {
  if (!unlocked.length) {
    return 'Nenhuma conquista desbloqueada ainda.';
  }
  const lines = unlocked.map((item) => `${item.emoji} ${item.name}`);
  return safeText(lines.join('\n'), 1024);
}

function formatRollHistory(rolls: Array<{ ts: number; expr: string; total: number; min: number; max: number }>): string {
  if (!rolls.length) {
    return 'Sem rolagens registradas ainda.';
  }
  return rolls
    .map((entry) => {
      const time = `<t:${Math.floor(entry.ts / 1000)}:R>`;
      return `• ${time} — \`${entry.expr}\` → total ${entry.total} (min ${entry.min}, max ${entry.max})`;
    })
    .join('\n');
}

function formatReviewList(
  items: Array<{ name: string; stars: number; category: ReviewCategory }>,
  canShow: boolean,
): string {
  if (!canShow) {
    return 'Use /perfil em um servidor para ver suas reviews.';
  }
  if (!items.length) {
    return 'Sem reviews ainda. Use /review add';
  }
  return items
    .map((entry, index) => `${index + 1}) ${safeText(entry.name, 40)} — ${formatStars(entry.stars)} (${entry.category})`)
    .join('\n');
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

      const guildId = interaction.guildId;
      const canShowReviews = Boolean(guildId);
      const favorites = canShowReviews
        ? listUserReviews(guildId ?? '', target.id, { favoritesOnly: true, order: 'stars', limit: 3 })
        : [];
      const topReviews = canShowReviews
        ? listUserReviews(guildId ?? '', target.id, { order: 'stars', limit: 5 })
        : [];
      const totalReviews = canShowReviews ? getUserReviewCount(guildId ?? '', target.id) : 0;

      const favoriteEntries = favorites.map((entry) => ({
        name: entry.name,
        stars: entry.review.stars,
        category: entry.review.category,
      }));
      const reviewEntries = topReviews.map((entry) => ({
        name: entry.name,
        stars: entry.review.stars,
        category: entry.review.category,
      }));

      const rolls = getUserRolls(target.id, 5);
      const displayName = target.globalName ?? target.username;
      const banner = resolveBanner(profile.bannerUrl);

      const buildProfileEmbed = () => {
        const embed = createSuziEmbed('primary')
          .setTitle(displayName)
          .setThumbnail(target.displayAvatarURL({ size: 128 }))
          .addFields(
            {
              name: '✨ Progresso com a Suzi',
              value: `Nivel ${progress.level}\nXP ${progress.current}/${progress.needed} (${progress.percent}%)\n${buildProgressBar(progress.percent)}`,
            },
            {
              name: '⭐ Favoritos',
              value: formatFavorites(favoriteEntries, canShowReviews),
            },
          )
          .setFooter({ text: 'Pagina 1/4 · Perfil' });

        if (banner) {
          embed.setImage(banner);
        }

        return embed;
      };

      const buildAchievementsEmbed = () => {
        const embed = createSuziEmbed('accent')
          .setTitle('🏆 Conquistas')
          .setThumbnail(target.displayAvatarURL({ size: 128 }))
          .addFields({ name: 'Total de conquistas', value: String(unlocked.length), inline: true })
          .addFields({
            name: `${EMOJI_TROPHY} Desbloqueadas`,
            value: formatAchievements(unlocked.length, unlocked),
          })
          .setFooter({ text: 'Pagina 2/4 · Conquistas' });

        if (banner) {
          embed.setImage(banner);
        }

        return embed;
      };

      const buildHistoryEmbed = () => {
        const embed = createSuziEmbed('dark')
          .setTitle('📜 Historico')
          .setThumbnail(target.displayAvatarURL({ size: 128 }))
          .addFields({ name: `${EMOJI_SCROLL} Ultimas rolagens`, value: formatRollHistory(rolls) })
          .setFooter({ text: 'Pagina 3/4 · Historico' });

        if (banner) {
          embed.setImage(banner);
        }

        return embed;
      };

      const buildReviewsEmbed = () => {
        const embed = createSuziEmbed('primary')
          .setTitle('⭐ Reviews')
          .setThumbnail(target.displayAvatarURL({ size: 128 }))
          .setDescription(canShowReviews ? `Total de reviews: ${totalReviews}` : 'Sem reviews para mostrar aqui.')
          .addFields({ name: 'Top 5 jogos', value: formatReviewList(reviewEntries, canShowReviews) })
          .setFooter({ text: 'Pagina 4/4 · Reviews' });

        if (banner) {
          embed.setImage(banner);
        }

        return embed;
      };

      const pageBuilders: Record<ProfilePage, () => ReturnType<typeof createSuziEmbed>> = {
        profile: buildProfileEmbed,
        achievements: buildAchievementsEmbed,
        history: buildHistoryEmbed,
        reviews: buildReviewsEmbed,
      };

      let currentPage: ProfilePage = 'profile';
      const embed = pageBuilders[currentPage]();
      const components = [buildProfileButtons(currentPage)];

      await safeRespond(interaction, { embeds: [embed], components });

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
          await button.update({
            embeds: [pageBuilders[currentPage]()],
            components: [buildProfileButtons(currentPage)],
          });
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
        const { unlocked } = trackEvent(interaction.user.id, 'perfil');
        unlockTitlesFromAchievements(interaction.user.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
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
