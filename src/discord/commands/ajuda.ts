import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logger } from '../../utils/logger.js';
import { buildAchievementUnlockEmbed, buildHelpEmbed } from '../embeds.js';

export const ajudaCommand = {
  data: new SlashCommandBuilder().setName('ajuda').setDescription('Lista comandos disponiveis'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }
    const embed = buildHelpEmbed(interaction.client.user);
    await safeRespond(interaction, { embeds: [embed] });

    try {
      const { unlocked } = trackEvent(interaction.user.id, 'ajuda');
      unlockTitlesFromAchievements(interaction.user.id, unlocked);
      const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
      if (unlockEmbed) {
        await safeRespond(interaction, { embeds: [unlockEmbed] });
      }
    } catch (error) {
      logger.warn('Falha ao registrar conquistas do /ajuda', error);
    }
  },
};
