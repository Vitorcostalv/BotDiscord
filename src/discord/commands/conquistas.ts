import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import type { AchievementDefinition, AchievementRarity } from '../../achievements/definitions.js';
import { getUserAchievements, listAllAchievements } from '../../achievements/service.js';
import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_TROPHY = '\u{1F3C6}';

const RARITY_ORDER: AchievementRarity[] = ['comum', 'rara', 'epica'];

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

function getAchievementName(t: (key: string) => string, item: AchievementDefinition): string {
  const key = `achievement.${item.id}.name`;
  const translated = t(key);
  return translated === key ? item.name : translated;
}

export const conquistasCommand = {
  data: new SlashCommandBuilder()
    .setName('conquistas')
    .setDescription(tLang('en', 'achievements.command.desc'))
    .setDescriptionLocalizations(getLocalized('achievements.command.desc')),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const t = getTranslator(interaction.guildId);

    try {
      const { unlockedList } = getUserAchievements(interaction.user.id);
      const definitions = listAllAchievements();
      const unlockedMap = new Map(unlockedList.map((entry) => [entry.id, entry.unlockedAt]));
      const unlocked = definitions.filter((definition) => unlockedMap.has(definition.id));

      const embed = createSuziEmbed('primary')
        .setTitle(`${EMOJI_TROPHY} ${t('achievements.title')}`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
        .setDescription(t('achievements.total_progress', { unlocked: unlocked.length, total: definitions.length }));

      if (!unlocked.length) {
        embed.addFields({
          name: t('achievements.empty.title'),
          value: t('achievements.empty.desc'),
        });
      } else {
        for (const rarity of RARITY_ORDER) {
          const items = unlocked
            .filter((definition) => definition.rarity === rarity)
            .sort((a, b) => (unlockedMap.get(b.id) ?? 0) - (unlockedMap.get(a.id) ?? 0));

          if (!items.length) continue;

          const value = safeText(
            items.map((item: AchievementDefinition) => `${item.emoji} ${getAchievementName(t, item)}`).join('\n'),
            1024,
          );

          embed.addFields({ name: t(`achievements.rarity.${rarity}`), value });
        }
      }

      await safeRespond(interaction, { embeds: [embed] });
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /conquistas' });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002', interaction.guildId));
    }
  },
};
