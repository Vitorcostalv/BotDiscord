import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, buildHelpEmbed } from '../embeds.js';

export const ajudaCommand = {
  data: new SlashCommandBuilder()
    .setName('ajuda')
    .setDescription(tLang('en', 'help.command.desc'))
    .setDescriptionLocalizations(getLocalized('help.command.desc')),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }
    const t = getTranslator(interaction.guildId);
    const embed = buildHelpEmbed(t, interaction.client.user);
    await safeRespond(interaction, { embeds: [embed] });

    try {
      const { unlocked } = trackEvent(interaction.user.id, 'ajuda');
      unlockTitlesFromAchievements(interaction.user.id, unlocked);
      const unlockEmbed = buildAchievementUnlockEmbed(t, unlocked);
      if (unlockEmbed) {
        await safeRespond(interaction, { embeds: [unlockEmbed] });
      }
    } catch (error) {
      logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /ajuda' });
    }
  },
};
