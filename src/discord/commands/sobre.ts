import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
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
    const embed = createSuziEmbed('accent')
      .setTitle(`${EMOJI_MOON} Sobre a Suzi`)
      .setDescription(
        'Ninguem sabe exatamente quando Suzi apareceu. ' +
          'Alguns dizem que foi depois de uma rolagem impossivel. Outros juram que foi quando alguem fez a pergunta certa.\n\n' +
          'Ela vive nos intervalos: entre o dado e o resultado, entre a duvida e a resposta. ' +
          'Observa, calcula e responde - sempre com um sorriso que parece saber mais do que diz.',
      )
      .addFields(
        {
          name: 'Curiosidades',
          value:
            '- Tem carinho especial por resultados improvaveis\n' +
            '- Gosta de jogadores persistentes\n' +
            '- Acha que o acaso nunca e totalmente aleatorio',
        },
        {
          name: 'Frase assinatura',
          value: '"Nem todo resultado e sorte. Alguns so estavam esperando."',
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
      logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /sobre' });
    }
  },
};
