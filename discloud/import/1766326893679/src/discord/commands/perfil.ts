import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import type { AchievementDefinition } from '../../achievements/definitions.js';
import { getUserAchievements, listAllAchievements } from '../../achievements/service.js';
import { getPlayer } from '../../services/storage.js';
import { safeDeferReply, safeReply } from '../../utils/interactions.js';
import { logger } from '../../utils/logger.js';
import { buildMissingProfileEmbed, buildProfileEmbed } from '../embeds.js';

export const perfilCommand = {
  data: new SlashCommandBuilder().setName('perfil').setDescription('Mostra o perfil do player'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    try {
      const profile = getPlayer(interaction.user.id);
      if (!profile) {
        const embed = buildMissingProfileEmbed(interaction.user);
        await safeReply(interaction, { embeds: [embed] });
        return;
      }

      const { unlockedList } = getUserAchievements(interaction.user.id);
      const definitions = listAllAchievements();
      const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));

      const recent = unlockedList
        .slice()
        .sort((a, b) => b.unlockedAt - a.unlockedAt)
        .map((entry) => definitionMap.get(entry.id))
        .filter((definition): definition is AchievementDefinition => Boolean(definition))
        .slice(0, 6);

      const embed = buildProfileEmbed(interaction.user, profile, {
        recent,
        total: unlockedList.length,
      });

      await safeReply(interaction, { embeds: [embed] });
    } catch (error) {
      logger.error('Erro no comando /perfil', error);
      await safeReply(interaction, '⚠️ deu ruim aqui, tenta de novo');
    }
  },
};
