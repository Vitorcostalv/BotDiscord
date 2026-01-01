import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getPlayerProfile } from '../../services/profileService.js';
import {
  clearEquippedTitle,
  equipTitle,
  getTitleLabel,
  getUserTitleState,
  isTitleUnlocked,
  listTitleDefinitions,
  resolveTitleDefinition,
} from '../../services/titleService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_TAG = '\u{1F3F7}\uFE0F';
const EMOJI_WARNING = '\u26A0\uFE0F';
const EMOJI_CLEAN = '\u{1F9FC}';

const TITLE_CHOICES = listTitleDefinitions().map((title) => ({
  name: title.label,
  value: title.id,
}));

export async function executeTitleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const profile = getPlayerProfile(interaction.user.id);
  if (!profile) {
    await safeRespond(interaction, `${EMOJI_WARNING} Voce precisa se registrar com /register antes de equipar titulos.`);
    return;
  }

  const input = interaction.options.getString('title', true);
  const definition = resolveTitleDefinition(input);
  if (!definition) {
    await safeRespond(
      interaction,
      `${EMOJI_WARNING} Esse titulo nao existe. Use /conquistas para ver o que desbloqueou.`,
    );
    return;
  }

  if (!isTitleUnlocked(interaction.user.id, definition.id)) {
    const state = getUserTitleState(interaction.user.id);
    const unlocked = Object.keys(state.unlocked ?? {});
    const unlockedText = unlocked.length ? unlocked.map(getTitleLabel).join('\n') : 'Nenhum.';
    await safeRespond(
      interaction,
      `${EMOJI_WARNING} Voce ainda nao desbloqueou esse titulo.\nTitulos liberados:\n${unlockedText}`,
    );
    return;
  }

  const equipped = equipTitle(interaction.user.id, definition.id);
  if (!equipped) {
    await safeRespond(interaction, `${EMOJI_WARNING} Nao consegui equipar o titulo agora.`);
    return;
  }

  const embed = createSuziEmbed('success')
    .setTitle(`${EMOJI_TAG} Titulo equipado`)
    .setDescription(`${equipped.label} agora esta ativo no seu perfil.`)
    .addFields({ name: 'Remover titulo', value: '/title remove' });

  await safeRespond(interaction, { embeds: [embed] });
}

export async function executeTitleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const profile = getPlayerProfile(interaction.user.id);
  if (!profile) {
    await safeRespond(interaction, `${EMOJI_WARNING} Voce precisa se registrar com /register antes de remover titulos.`);
    return;
  }

  clearEquippedTitle(interaction.user.id);

  const embed = createSuziEmbed('primary')
    .setTitle(`${EMOJI_CLEAN} Titulo removido`)
    .setDescription('Seu titulo foi removido do perfil.');

  await safeRespond(interaction, { embeds: [embed] });
}

export const titleCommand = {
  data: new SlashCommandBuilder()
    .setName('title')
    .setDescription('Gerencie seus titulos')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Equipa um titulo desbloqueado')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('Titulo para equipar')
            .setRequired(true)
            .addChoices(...TITLE_CHOICES),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('remove').setDescription('Remove o titulo equipado'),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') {
      await executeTitleAdd(interaction);
      return;
    }
    if (subcommand === 'remove') {
      await executeTitleRemove(interaction);
    }
  },
};
