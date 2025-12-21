import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import type { AchievementDefinition } from '../../achievements/definitions.js';
import { listAllAchievements, trackEvent, getUserAchievements } from '../../achievements/service.js';
import { env } from '../../config/env.js';
import { getHistory } from '../../services/historyService.js';
import { getPlayerProfile } from '../../services/profileService.js';
import { getSteamLink, getCachedSummary, mapPersonaState } from '../../services/steamService.js';
import { getTitleLabel, getAutoTitleForClass, getUserTitleState, unlockTitlesFromAchievements } from '../../services/titleService.js';
import { getUserXp } from '../../services/xpService.js';
import { toPublicMessage } from '../../utils/errors.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError, logWarn } from '../../utils/logging.js';
import { buildAchievementUnlockEmbed, buildMissingProfileEmbed, buildProfileEmbed } from '../embeds.js';

const EMOJI_GAME = '\u{1F3AE}';

export const perfilCommand = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Mostra o perfil do player')
    .addUserOption((option) => option.setName('user').setDescription('Jogador alvo').setRequired(false))
    .addBooleanOption((option) =>
      option.setName('detalhado').setDescription('Mostra informacoes completas').setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const target = interaction.options.getUser('user') ?? interaction.user;
    const detailed = interaction.options.getBoolean('detalhado') ?? false;

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
      const history = detailed ? getHistory(target.id, 3) : [];

      const embed = buildProfileEmbed(
        target,
        profile,
        {
          achievements: { recent, total: achievements.unlockedList.length },
          history,
          xp,
          equippedTitle,
          classTitle,
        },
        detailed ? 'detailed' : 'compact',
      );

      const steamLink = getSteamLink(target.id);
      if (steamLink) {
        if (!env.steamApiKey) {
          if (detailed) {
            embed.addFields({
              name: `${EMOJI_GAME} Steam`,
              value: 'Recursos Steam desabilitados. Configure STEAM_API_KEY.',
            });
          } else {
            embed.setFooter({
              text:
                'Steam: desabilitado\n' +
                'Jogando agora: -\n' +
                'Use /historico para ver rolagens - Use /perfil detalhado:true para ver tudo',
            });
          }
        } else {
          const summaryResult = await getCachedSummary(steamLink.steamId64);
          if (summaryResult.ok) {
            const summary = summaryResult.summary;
            const status = mapPersonaState(summary.personastate);
            const game = summary.gameextrainfo ? `${EMOJI_GAME} ${summary.gameextrainfo}` : '-';
            if (detailed) {
              const last = summary.lastlogoff ? `<t:${summary.lastlogoff}:R>` : '-';
              const lines = [
                `Nick: ${summary.personaname}`,
                `Status: ${status}`,
                `Jogando agora: ${game}`,
                `Ultimo online: ${last}`,
                `Link: ${summary.profileurl || '-'}`,
              ];
              if (!summary.gameextrainfo) {
                lines.push('Obs: jogo atual so aparece se o perfil e detalhes estiverem publicos na Steam.');
              }
              embed.addFields({
                name: `${EMOJI_GAME} Steam`,
                value: lines.join('\n'),
              });
            } else {
              embed.setFooter({
                text:
                  `Steam: ${summary.personaname} - ${status}\n` +
                  `Jogando agora: ${game}\n` +
                  'Use /historico para ver rolagens - Use /perfil detalhado:true para ver tudo',
              });
            }
            if (summary.avatarfull) {
              embed.setThumbnail(summary.avatarfull);
            }
          } else {
            const message =
              summaryResult.reason === 'NOT_FOUND'
                ? 'Perfil privado ou SteamID invalido.'
                : 'Steam indisponivel agora.';
            if (detailed) {
              embed.addFields({
                name: `${EMOJI_GAME} Steam`,
                value: message,
              });
            } else {
              embed.setFooter({
                text:
                  `Steam: ${message}\n` +
                  'Jogando agora: -\n' +
                  'Use /historico para ver rolagens - Use /perfil detalhado:true para ver tudo',
              });
            }
            logWarn('SUZI-CMD-002', new Error('Steam indisponivel'), {
              message: 'Falha ao carregar Steam no /perfil',
              steamId64: steamLink.steamId64,
              reason: summaryResult.reason,
            });
          }
        }
      }

      await safeRespond(interaction, { embeds: [embed] });

      try {
        const { unlocked } = trackEvent(interaction.user.id, 'perfil');
        unlockTitlesFromAchievements(interaction.user.id, unlocked);
        const unlockEmbed = buildAchievementUnlockEmbed(unlocked);
        if (unlockEmbed) {
          await safeRespond(interaction, { embeds: [unlockEmbed] });
        }
      } catch (error) {
        logWarn('SUZI-CMD-002', error, { message: 'Falha ao registrar conquistas do /perfil' });
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /perfil' });
      await safeRespond(interaction, toPublicMessage('SUZI-CMD-002'));
    }
  },
};
