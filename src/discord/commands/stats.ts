import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getGuildStats } from '../../services/rollHistoryService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_CHART = '\u{1F4CA}';

function formatTop(list: Array<{ userId: string; count: number }>): string {
  if (!list.length) return 'Sem dados ainda.';
  return list.map((item, index) => `${index + 1}. <@${item.userId}> - ${item.count}`).join('\n');
}

export const statsCommand = {
  data: new SlashCommandBuilder().setName('stats').setDescription('Resumo rapido de rolagens no servidor'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    if (!interaction.guildId) {
      const embed = createSuziEmbed('warning')
        .setTitle(`${EMOJI_CHART} Estatisticas`)
        .setDescription('Este comando so funciona em servidores.');
      await safeRespond(interaction, { embeds: [embed] });
      return;
    }

    try {
      const stats = getGuildStats(interaction.guildId);
      const embed = createSuziEmbed('primary')
        .setTitle(`${EMOJI_CHART} Estatisticas do Servidor`)
        .addFields(
          { name: 'Rolagens (24h)', value: String(stats.total24h), inline: true },
          { name: 'Rolagens (total)', value: String(stats.totalAll), inline: true },
          { name: 'Top Roladores (24h)', value: formatTop(stats.top24h) },
          { name: 'Top Roladores (total)', value: formatTop(stats.topAll) },
        );

      await safeRespond(interaction, { embeds: [embed] });
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /stats' });
      const embed = createSuziEmbed('warning')
        .setTitle(`${EMOJI_CHART} Estatisticas`)
        .setDescription('Nao consegui carregar os dados agora. Tente novamente em instantes.');
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
