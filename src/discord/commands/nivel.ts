import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { trackEvent } from '../../achievements/service.js';
import { env } from '../../config/env.js';
import { appendHistory as appendProfileHistory } from '../../services/historyService.js';
import { getPlayerProfile, updatePlayerLevel } from '../../services/profileService.js';
import { unlockTitlesFromAchievements } from '../../services/titleService.js';
import { awardXp } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, buildMissingProfileEmbed, createSuziEmbed } from '../embeds.js';

const EMOJI_WARNING = '\u26A0\uFE0F';
const EMOJI_STAR = '\u2B50';
const EMOJI_SPARKLE = '\u2728';

function safeText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLen) return normalized;
  const sliceEnd = Math.max(0, maxLen - 3);
  return `${normalized.slice(0, sliceEnd).trimEnd()}...`;
}

export const nivelCommand = {
  data: new SlashCommandBuilder()
    .setName('nivel')
    .setDescription('Atualiza o nivel do personagem')
    .addIntegerOption((option) =>
      option
        .setName('nivel')
        .setDescription('Novo nivel do personagem (1 a 99)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(99),
    )
    .addUserOption((option) => option.setName('user').setDescription('Jogador alvo').setRequired(false)),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const target = interaction.options.getUser('user') ?? interaction.user;
    const isSelf = target.id === interaction.user.id;
    const level = interaction.options.getInteger('nivel', true);

    if (!isSelf) {
      const hasPermission = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
      if (!hasPermission && !env.allowAdminEdit) {
        await safeRespond(
          interaction,
          `${EMOJI_WARNING} Voce precisa de permissao de moderador para editar o nivel de outra pessoa.`,
        );
        return;
      }
    }

    try {
      const profile = getPlayerProfile(target.id);
      if (!profile) {
        const embed = buildMissingProfileEmbed(target);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      const updated = updatePlayerLevel(target.id, level);
      if (!updated) {
        await safeRespond(interaction, `${EMOJI_WARNING} Nao consegui atualizar o nivel agora.`);
        return;
      }

      appendProfileHistory(target.id, {
        type: 'nivel',
        label: `Nivel ${level}`,
      });

      const embed = createSuziEmbed('success')
        .setTitle(`${EMOJI_STAR} Nivel atualizado`)
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: 'Jogador', value: safeText(updated.playerName, 1024), inline: true },
          { name: 'Personagem', value: safeText(updated.characterName, 1024), inline: true },
          { name: 'Classe', value: safeText(updated.className, 1024), inline: true },
          { name: 'Novo nivel', value: String(updated.level), inline: true },
        );

      await safeRespond(interaction, { embeds: [embed] });

      if (isSelf) {
        const xpResult = awardXp(interaction.user.id, 1, { reason: 'nivel' });
        if (xpResult.leveledUp) {
          await safeRespond(interaction, `${EMOJI_SPARKLE} Voce subiu para o nivel ${xpResult.newLevel} da Suzi!`);
        }
      }

      try {
        const { unlocked } = trackEvent(interaction.user.id, 'nivel', { self: isSelf });
        unlockTitlesFromAchievements(interaction.user.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /nivel' });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /nivel' });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002'));
    }
  },
};
