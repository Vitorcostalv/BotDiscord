import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logger } from '../../utils/logger.js';
import { buildAchievementUnlockEmbed, createSuziEmbed } from '../embeds.js';

export const sobreCommand = {
  data: new SlashCommandBuilder().setName('sobre').setDescription('Conheca a lore da Suzi'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const botUser = interaction.client.user;
    const embed = createSuziEmbed('accent')
      .setTitle('🌙 Sobre a Suzi')
      .setDescription(
        'Dizem que Suzi surgiu entre mundos: um fio de dados, um bug antigo e uma centelha de magia gamer. ' +
          'Ela guia jogadores, responde perguntas e transforma rolagens em historias com um toque misterioso.',
      )
      .addFields(
        {
          name: 'Curiosidades',
          value:
            '• Coleciona resultados perfeitos em d20\n' +
            '• Prefere respostas curtas e certeiras\n' +
            '• Acredita que todo jogo tem um segredo oculto',
        },
        {
          name: 'Frase assinatura',
          value: '“Se o dado caiu, a historia ja escolheu um caminho.”',
        },
      )
      .setFooter({ text: 'Suzi - Oraculo gamer' });

    if (botUser) {
      embed.setThumbnail(botUser.displayAvatarURL({ size: 128 }));
    }

    await safeRespond(interaction, { embeds: [embed] });

    try {
      const { unlocked } = trackEvent(interaction.user.id, 'sobre');
      unlockTitlesFromAchievements(interaction.user.id, unlocked);
      const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
      if (unlockEmbed) {
        await safeRespond(interaction, { embeds: [unlockEmbed] });
      }
    } catch (error) {
      logger.warn('Falha ao registrar conquistas do /sobre', error);
    }
  },
};
