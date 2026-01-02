import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getUserRolls } from '../../services/rollHistoryService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_SCROLL = '\u{1F4DC}';

function formatRollLine(entry: { ts: number; expr: string; total: number; min: number; max: number }): string {
  const time = `<t:${Math.floor(entry.ts / 1000)}:R>`;
  return `- ${time} - \`${entry.expr}\` -> total ${entry.total} (min ${entry.min}, max ${entry.max})`;
}

export const historicoCommand = {
  data: new SlashCommandBuilder()
    .setName('historico')
    .setDescription('Mostra o historico recente de rolagens')
    .addUserOption((option) => option.setName('user').setDescription('Usuario alvo').setRequired(false))
    .addIntegerOption((option) =>
      option.setName('limite').setDescription('Quantidade de itens (1 a 10)').setMinValue(1).setMaxValue(10),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    try {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const limitOption = interaction.options.getInteger('limite') ?? 5;
      const limit = Math.min(Math.max(limitOption, 1), 10);
      const rolls = getUserRolls(targetUser.id, limit, interaction.guildId ?? null);

      const embed = createSuziEmbed('primary')
        .setTitle(`${EMOJI_SCROLL} Historico de Rolagens`)
        .setDescription(`Usuario: <@${targetUser.id}>`);

      if (!rolls.length) {
        embed.addFields({ name: 'Rolagens', value: 'Sem rolagens registradas ainda.' });
      } else {
        const lines = rolls.map((entry) => formatRollLine(entry));
        embed.addFields({ name: `Ultimas ${rolls.length}`, value: lines.join('\n') });
      }

      await safeRespond(interaction, { embeds: [embed] });
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /historico' });
      const embed = createSuziEmbed('warning')
        .setTitle('Algo deu errado')
        .setDescription('Nao consegui carregar o historico agora. Tente novamente em instantes.');
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
