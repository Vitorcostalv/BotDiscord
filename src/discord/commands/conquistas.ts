import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import type { AchievementDefinition, AchievementRarity } from '../../achievements/definitions.js';
import { getUserAchievements, listAllAchievements } from '../../achievements/service.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_TROPHY = '\u{1F3C6}';

const RARITY_LABELS: Record<AchievementRarity, string> = {
  comum: 'Comum',
  rara: 'Rara',
  epica: 'Epica',
};

const RARITY_ORDER: AchievementRarity[] = ['comum', 'rara', 'epica'];

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

export const conquistasCommand = {
  data: new SlashCommandBuilder().setName('conquistas').setDescription('Lista suas conquistas'),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    try {
      const { unlockedList } = getUserAchievements(interaction.user.id);
      const definitions = listAllAchievements();
      const unlockedMap = new Map(unlockedList.map((entry) => [entry.id, entry.unlockedAt]));
      const unlocked = definitions.filter((definition) => unlockedMap.has(definition.id));

      const embed = createSuziEmbed('primary')
        .setTitle(`${EMOJI_TROPHY} Conquistas do Player`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
        .setDescription(`Total: ${unlocked.length}/${definitions.length}`);

      if (!unlocked.length) {
        embed.addFields({
          name: 'Nenhuma conquista ainda',
          value: 'Use /roll, /pergunta, /jogo e /register para desbloquear.',
        });
      } else {
        for (const rarity of RARITY_ORDER) {
          const items = unlocked
            .filter((definition) => definition.rarity === rarity)
            .sort((a, b) => (unlockedMap.get(b.id) ?? 0) - (unlockedMap.get(a.id) ?? 0));

          if (!items.length) continue;

          const value = safeText(
            items.map((item: AchievementDefinition) => `${item.emoji} ${item.name}`).join('\n'),
            1024,
          );

          embed.addFields({ name: `Raridade: ${RARITY_LABELS[rarity]}`, value });
        }
      }

      await safeRespond(interaction, { embeds: [embed] });
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /conquistas' });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002'));
    }
  },
};
