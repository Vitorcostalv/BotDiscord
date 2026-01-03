import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { getCanvasInitError, isCanvasReady } from '../../render/canvasState.js';
import { renderSobreCard } from '../../render/sobreCard.js';
import { getGuildLanguage } from '../../services/guildSettingsService.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logInfo, logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, createSuziEmbed } from '../embeds.js';

const EMOJI_MOON = '\u{1F319}';

export const sobreCommand = {
  data: new SlashCommandBuilder()
    .setName('sobre')
    .setDescription(tLang('en', 'about.command.desc'))
    .setDescriptionLocalizations(getLocalized('about.command.desc')),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const t = getTranslator(interaction.guildId);
    const lang = getGuildLanguage(interaction.guildId);

    const botUser = interaction.client.user;
    const suziImageUrl = botUser ? botUser.displayAvatarURL({ size: 512, extension: 'png' }) : null;

    try {
      logInfo('SUZI-CANVAS-001', 'Render start', {
        cmd: 'sobre',
        userId: interaction.user.id,
        guildId: interaction.guildId ?? 'dm',
      });

      const fileName = 'sobre-suzi.png';
      const embed = createSuziEmbed('accent')
        .setTitle(`${EMOJI_MOON} ${t('about.embed.title')}`)
        .setDescription(t('about.embed.desc'))
        .setFooter({ text: t('about.embed.footer') });

      if (!isCanvasReady()) {
        embed.setDescription(t('about.embed.error'));
        logWarn('SUZI-CANVAS-001', new Error('Canvas indisponivel'), {
          message: 'Canvas indisponivel para renderizar sobre',
          userId: interaction.user.id,
          reason: getCanvasInitError(),
        });
        await safeRespond(interaction, { embeds: [embed] });
      } else {
        const strings = {
          title: t('about.card.title'),
          subtitle: t('about.card.subtitle'),
          lore: t('about.card.lore'),
          tagline: t('about.card.tagline'),
          curiositiesTitle: t('about.card.curiosities_title'),
          curiosities: [
            t('about.card.curiosity.1'),
            t('about.card.curiosity.2'),
            t('about.card.curiosity.3'),
          ],
          quote: t('about.card.quote'),
          signature: t('about.card.signature'),
        };
        const buffer = await renderSobreCard({ suziImageUrl, locale: lang, strings });
        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        embed.setImage(`attachment://${fileName}`);
        await safeRespond(interaction, { embeds: [embed], files: [attachment] });
      }
    } catch (error) {
      logWarn('SUZI-CMD-002', error, { message: 'Falha ao renderizar card do /sobre' });
      const embed = createSuziEmbed('accent')
        .setTitle(`${EMOJI_MOON} ${t('about.embed.title')}`)
        .setDescription(t('about.embed.error'))
        .setFooter({ text: t('about.embed.footer') });
      await safeRespond(interaction, { embeds: [embed] });
    }

    try {
      const { unlocked } = trackEvent(interaction.user.id, 'sobre');
      unlockTitlesFromAchievements(interaction.user.id, unlocked);
      const unlockEmbed = buildAchievementUnlockEmbed(t, unlocked);
      if (unlockEmbed) {
        await safeRespond(interaction, { embeds: [unlockEmbed] });
      }
    } catch (error) {
      logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /sobre' });
    }
  },
};
