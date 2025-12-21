import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getPlayerProfile } from '../../services/profileService.js';
import { clearEquippedTitle, getAutoTitleForClass } from '../../services/titleService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_WARNING = '\u26A0\uFE0F';
const EMOJI_CLEAN = '\u{1F9FC}';

export const titleclearCommand = {
  data: new SlashCommandBuilder().setName('titleclear').setDescription('Remove o titulo equipado'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const profile = getPlayerProfile(interaction.user.id);
    if (!profile) {
      await safeRespond(interaction, `${EMOJI_WARNING} Voce precisa se registrar com /register antes de remover titulos.`);
      return;
    }

    clearEquippedTitle(interaction.user.id);
    const classTitle = getAutoTitleForClass(profile.className);

    const embed = createSuziEmbed('primary')
      .setTitle(`${EMOJI_CLEAN} Titulo removido`)
      .setDescription(`Agora voce voltou ao titulo da classe: ${classTitle}`);

    await safeRespond(interaction, { embeds: [embed] });
  },
};
