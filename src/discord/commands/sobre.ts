import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { getCanvasInitError, isCanvasReady } from '../../render/canvasState.js';
import { renderSobreCard } from '../../render/sobreCard.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logInfo, logWarn } from '../../utils/logging.js';
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
      logInfo('SUZI-CANVAS-001', 'Render start', {
        cmd: 'sobre',
        userId: interaction.user.id,
        guildId: interaction.guildId ?? 'dm',
      });

      const fileName = 'sobre-suzi.png';
      const embed = createSuziEmbed('accent')
        .setTitle(`${EMOJI_MOON} Sobre a Suzi`)
        .setDescription('Oraculo gamer ƒ?½ entre o dado e o destino')
        .setFooter({ text: 'Suzi ƒ?½ Oraculo gamer' });

      if (!isCanvasReady()) {
        embed.setDescription('Erro ao gerar imagem, tente novamente.');
        logWarn('SUZI-CANVAS-001', new Error('Canvas indisponivel'), {
          message: 'Canvas indisponivel para renderizar sobre',
          userId: interaction.user.id,
          reason: getCanvasInitError(),
        });
        await safeRespond(interaction, { embeds: [embed] });
      } else {
        const buffer = await renderSobreCard({ suziImageUrl });
        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        embed.setImage(`attachment://${fileName}`);
        await safeRespond(interaction, { embeds: [embed], files: [attachment] });
      }
    } catch (error) {
      logWarn('SUZI-CMD-002', error, { message: 'Falha ao renderizar card do /sobre' });
      const embed = createSuziEmbed('accent')
        .setTitle(`${EMOJI_MOON} Sobre a Suzi`)
        .setDescription('Erro ao gerar imagem, tente novamente.')
        .setFooter({ text: 'Suzi ƒ?½ Oraculo gamer' });
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
