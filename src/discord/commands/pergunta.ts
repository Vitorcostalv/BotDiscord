import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { ask } from '../../llm/router.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { formatSuziIntro, getPlayerProfile } from '../../services/profileService.js';
import { listTopItems } from '../../services/reviewService.js';
import { appendQuestionHistory, getQuestionHistory, type QuestionType } from '../../services/storage.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { awardXp } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import { withCooldown } from '../cooldown.js';
import { buildAchievementUnlockEmbed, createSuziEmbed } from '../embeds.js';

const EMOJI_BRAIN = '\u{1F9E0}';
const EMOJI_SPARKLE = '\u2728';

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

export const perguntaCommand = {
  data: new SlashCommandBuilder()
    .setName('pergunta')
    .setDescription(tLang('en', 'question.command.desc'))
    .setDescriptionLocalizations(getLocalized('question.command.desc'))
    .addStringOption((option) =>
      option
        .setName('pergunta')
        .setDescription(tLang('en', 'question.option.question'))
        .setDescriptionLocalizations(getLocalized('question.option.question'))
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('tipo')
        .setDescription(tLang('en', 'question.option.type'))
        .setDescriptionLocalizations(getLocalized('question.option.type'))
        .setRequired(false)
            .addChoices(
              {
                name: tLang('en', 'question.type.game'),
                value: 'JOGO',
                name_localizations: getLocalized('question.type.game'),
              },
              {
                name: tLang('en', 'question.type.movie'),
                value: 'FILME',
                name_localizations: getLocalized('question.type.movie'),
              },
              {
                name: tLang('en', 'question.type.tutorial'),
                value: 'TUTORIAL',
                name_localizations: getLocalized('question.type.tutorial'),
              },
            ),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);

    await withCooldown(interaction, 'pergunta', async () => {
      const userId = interaction.user.id;
      const question = interaction.options.getString('pergunta', true);
      const questionType = (interaction.options.getString('tipo') as QuestionType | null) ?? 'JOGO';

      try {
        const history = getQuestionHistory(userId, interaction.guildId, questionType);
        const historyLines = history.map((h) => `${h.type}/${h.questionType}: ${h.content} -> ${h.response}`);
        const userProfile = getPlayerProfile(userId, interaction.guildId ?? null);

        let scopeHint = '';
        const wantsRomanceClosed =
          questionType === 'FILME' && /romance/i.test(question) && /final fechado/i.test(question);
        if (wantsRomanceClosed && interaction.guildId) {
          const closedMovies = listTopItems(interaction.guildId, {
            type: 'MOVIE',
            romanceClosedOnly: true,
            minReviews: 1,
            limit: 5,
          });
          if (closedMovies.length) {
            scopeHint = t('question.scope.closed', {
              list: closedMovies.map((item) => item.name).join(', '),
            });
          } else {
            scopeHint = t('question.scope.none');
          }
        }

        const result = await ask({
          question,
          userProfile,
          userDisplayName: interaction.user.globalName ?? interaction.user.username,
          userHistory: historyLines,
          questionType,
          scopeHint: scopeHint || undefined,
          guildId: interaction.guildId,
          userId,
        });
        const response = result.text;

        appendQuestionHistory(userId, interaction.guildId, questionType, {
          content: question,
          response,
        });
        appendProfileHistory(
          userId,
          {
            type: 'pergunta',
            label: safeText(question, 50),
          },
          interaction.guildId ?? null,
        );

        const intro = formatSuziIntro(
          userId,
          {
            displayName: interaction.user.globalName ?? interaction.user.username,
            kind: 'pergunta',
          },
          interaction.guildId ?? null,
        );

        const embed = createSuziEmbed('primary')
          .setTitle(`${EMOJI_BRAIN} ${t('question.embed.title')}`)
          .addFields(
            { name: t('question.embed.question'), value: safeText(question, 1024) },
            { name: t('question.embed.answer'), value: safeText(response, 1024) },
          );

        if (intro) {
          embed.setDescription(intro);
        }

        await safeRespond(interaction, { embeds: [embed] });

        const xpResult = awardXp(userId, 5, { reason: 'pergunta', cooldownSeconds: 10 }, interaction.guildId ?? null);
        if (xpResult.leveledUp) {
          await safeRespond(
            interaction,
            t('question.level_up', { level: xpResult.newLevel, emoji: EMOJI_SPARKLE }),
          );
        }

        try {
          const { unlocked } = trackEvent(userId, 'pergunta');
          unlockTitlesFromAchievements(userId, unlocked);
          const unlockEmbed = buildAchievementUnlockEmbed(t, unlocked);
          if (unlockEmbed) {
            await safeRespond(interaction, { embeds: [unlockEmbed] });
          }
        } catch (error) {
          logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /pergunta' });
        }
      } catch (error) {
        logError('SUZI-CMD-002', error, { message: 'Erro no comando /pergunta' });
        await safeRespond(interaction, toPublicMessage('SUZI-CMD-002', interaction.guildId));
      }
    });
  },
};
