import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';
import { getStatus } from '../../services/geminiUsageService.js';
import { getGuildStats } from '../../services/rollHistoryService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_CHART = '\u{1F4CA}';

function formatValue(value: number | null): string {
  if (value === null) return 'n/d';
  return String(value);
}

function formatTop(list: Array<{ userId: string; count: number }>): string {
  if (!list.length) return 'Sem dados ainda.';
  return list.map((item, index) => `${index + 1}. <@${item.userId}> - ${item.count}`).join('\n');
}

export const statusCommand = {
  data: new SlashCommandBuilder().setName('status').setDescription('Status do Gemini e rolagens do servidor'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const status = getStatus({ guildId: interaction.guildId, userId: interaction.user.id });
    const embed = createSuziEmbed(status.enabled ? 'primary' : 'warning').setTitle('Status');

    if (!status.enabled) {
      embed.setDescription('Gemini desabilitado.');
    }

    const guildCount = status.guild ? status.guild.countToday : null;
    const userCount = status.user ? status.user.countToday : null;

    embed.addFields(
      { name: 'Gemini hoje', value: String(status.global.countToday), inline: true },
      { name: 'Gemini total', value: String(status.global.countTotal), inline: true },
      { name: 'Restantes hoje', value: formatValue(status.remaining), inline: true },
      { name: 'Uso no servidor', value: formatValue(guildCount), inline: true },
      { name: 'Uso do usuario', value: formatValue(userCount), inline: true },
      { name: 'Modelo atual', value: env.geminiModel || 'n/d', inline: true },
    );

    if (!interaction.guildId) {
      embed.addFields({
        name: `${EMOJI_CHART} Rolagens`,
        value: 'Disponivel apenas em servidores.',
      });
    } else {
      try {
        const stats = getGuildStats(interaction.guildId);
        embed.addFields(
          { name: `${EMOJI_CHART} Rolagens (24h)`, value: String(stats.total24h), inline: true },
          { name: `${EMOJI_CHART} Rolagens (total)`, value: String(stats.totalAll), inline: true },
          { name: 'Top Roladores (24h)', value: formatTop(stats.top24h) },
          { name: 'Top Roladores (total)', value: formatTop(stats.topAll) },
        );
      } catch (error) {
        logError('SUZI-CMD-002', error, { message: 'Erro ao carregar stats no /status' });
        embed.addFields({
          name: `${EMOJI_CHART} Rolagens`,
          value: 'Nao consegui carregar os dados agora. Tente novamente.',
        });
      }
    }

    embed.setFooter({
      text: 'Reset diario depende do fuso; limite real pode variar conforme quota do projeto.',
    });

    await safeRespond(interaction, { embeds: [embed] });
  },
};
