import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import type { AchievementDefinition } from '../../achievements/definitions.js';
import { listAllAchievements, trackEvent, getUserAchievements } from '../../achievements/service.js';
import { getHistory } from '../../services/historyService.js';
import { getPlayerProfile } from '../../services/profileService.js';
import { getTitleLabel, getAutoTitleForClass, getUserTitleState, unlockTitlesFromAchievements } from '../../services/titleService.js';
import { getUserXp } from '../../services/xpService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logger } from '../../utils/logger.js';
import { buildAchievementUnlockEmbed, buildMissingProfileEmbed, buildProfileEmbed } from '../embeds.js';

export const perfilCommand = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Mostra o perfil do player')
    .addUserOption((option) => option.setName('user').setDescription('Jogador alvo').setRequired(false)),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const target = interaction.options.getUser('user') ?? interaction.user;

    try {
      const profile = getPlayerProfile(target.id);
      if (!profile) {
        const embed = buildMissingProfileEmbed(target);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const achievements = getUserAchievements(target.id);
      const definitions = listAllAchievements();
      const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));

      const recent = achievements.unlockedList
        .slice()
        .sort((a, b) => b.unlockedAt - a.unlockedAt)
        .map((entry) => definitionMap.get(entry.id))
        .filter((definition): definition is AchievementDefinition => Boolean(definition))
        .slice(0, 6);

      const titles = getUserTitleState(target.id);
      const equippedTitle = titles.equipped ? getTitleLabel(titles.equipped) : null;
      const classTitle = getAutoTitleForClass(profile.className);
      const xp = getUserXp(target.id);
      const history = getHistory(target.id, 3);

      const embed = buildProfileEmbed(target, profile, {
        achievements: { recent, total: achievements.unlockedList.length },
        history,
        xp,
        equippedTitle,
        classTitle,
      });

      await safeRespond(interaction, { embeds: [embed] });

      try {
        const { unlocked } = trackEvent(interaction.user.id, 'perfil');
        unlockTitlesFromAchievements(interaction.user.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logger.warn('Falha ao registrar conquistas do /perfil', error);
      }
    } catch (error) {
      logger.error('Erro no comando /perfil', error);
      await safeRespond(interaction, '⚠️ deu ruim aqui, tenta de novo');
    }
  },
};
