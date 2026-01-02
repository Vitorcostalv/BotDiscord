import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { renderSobreCard } from '../../render/sobreCard.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, createSuziEmbed } from '../embeds.js';

const EMOJI_MOON = '\u{1F319}';

export const sobreCommand = {
  data: new SlashCommandBuilder().setName('sobre').setDescription('Conheca a lore da Suzi'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const botUser = interaction.client.user;
    const suziImageUrl = botUser ? botUser.displayAvatarURL({ size: 512, extension: 'png' }) : null;

    try {
      const buffer = await renderSobreCard({ suziImageUrl });
      const fileName = 'sobre-suzi.png';
      const attachment = new AttachmentBuilder(buffer, { name: fileName });
      const embed = createSuziEmbed('accent')
        .setTitle(`${EMOJI_MOON} Sobre a Suzi`)
        .setDescription('Oraculo gamer • entre o dado e o destino')
        .setImage(`attachment://${fileName}`)
        .setFooter({ text: 'Suzi • Oraculo gamer' });

      await safeRespond(interaction, { embeds: [embed], files: [attachment] });
    } catch (error) {
      logWarn('SUZI-CMD-002', error, { message: 'Falha ao renderizar card do /sobre' });
      const embed = createSuziEmbed('accent')
        .setTitle(`${EMOJI_MOON} Sobre a Suzi`)
        .setDescription('Nao consegui renderizar o card agora. Tente novamente em instantes.')
        .setFooter({ text: 'Suzi • Oraculo gamer' });
      await safeRespond(interaction, { embeds: [embed] });
    }

    try {
      const { unlocked } = trackEvent(interaction.user.id, 'sobre');
      unlockTitlesFromAchievements(interaction.user.id, unlocked);
      const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
      if (unlockEmbed) {
        await safeRespond(interaction, { embeds: [unlockEmbed] });
      }
    } catch (error) {
      logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /sobre' });
    }
  },
};
