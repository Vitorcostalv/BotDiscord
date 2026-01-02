import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { env } from '../../config/env.js';
import { hasRegisterPermission } from '../../services/permissionService.js';
import {
  getCachedSummary,
  getSteamLink,
  linkSteam,
  mapPersonaState,
  unlinkSteam,
  validateSteamId64,
} from '../../services/steamService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { logError } from '../../utils/logging.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_GAME = '\u{1F3AE}';
const EMOJI_LINK = '\u{1F517}';
const EMOJI_REFRESH = '\u{1F503}';
const EMOJI_WARNING = '\u26A0\uFE0F';
const REFRESH_COOLDOWN_MS = 30_000;
const refreshCooldowns = new Map<string, number>();

type SteamAction = 'link' | 'unlink' | 'view' | 'refresh';

const ACTION_CHOICES = [
  { name: `${EMOJI_LINK} link`, value: 'link' },
  { name: 'view', value: 'view' },
  { name: `${EMOJI_REFRESH} refresh`, value: 'refresh' },
  { name: 'unlink', value: 'unlink' },
];

function isRefreshOnCooldown(userId: string): number | null {
  const now = Date.now();
  const expiresAt = refreshCooldowns.get(userId);
  if (!expiresAt || now >= expiresAt) {
    refreshCooldowns.set(userId, now + REFRESH_COOLDOWN_MS);
    return null;
  }
  return Math.ceil((expiresAt - now) / 1000);
}

function buildSteamField(summary: {
  personaname: string;
  personastate: number;
  gameextrainfo?: string;
  lastlogoff?: number;
  profileurl?: string;
}): string {
  const status = mapPersonaState(summary.personastate);
  const game = summary.gameextrainfo ? `${EMOJI_GAME} ${summary.gameextrainfo}` : '-';
  const last = summary.lastlogoff ? `<t:${summary.lastlogoff}:R>` : '-';
  const lines = [
    `Nick: ${summary.personaname}`,
    `Status: ${status}`,
    `Jogando agora: ${game}`,
    `Ultimo online: ${last}`,
    `Link: ${summary.profileurl ?? '-'}`,
  ];

  if (!summary.gameextrainfo) {
    lines.push('Obs: jogo atual so aparece se o perfil e detalhes estiverem publicos na Steam.');
  }

  return lines.join('\n');
}

function ensureSteamEnabled(): { ok: true } | { ok: false; embed: ReturnType<typeof createSuziEmbed> } {
  if (env.steamApiKey) {
    return { ok: true };
  }
  const embed = createSuziEmbed('warning')
    .setTitle(`${EMOJI_WARNING} Steam desabilitado`)
    .setDescription('Configure STEAM_API_KEY para habilitar a integracao com a Steam.');
  return { ok: false, embed };
}

export const steamCommand = {
  data: new SlashCommandBuilder()
    .setName('steam')
    .setDescription('Gerencie a integracao com a Steam')
    .addStringOption((option) =>
      option
        .setName('acao')
        .setDescription('O que deseja fazer')
        .setRequired(true)
        .addChoices(...ACTION_CHOICES),
    )
    .addStringOption((option) =>
      option.setName('steamid64').setDescription('SteamID64 (17 digitos)').setRequired(false),
    )
    .addUserOption((option) => option.setName('user').setDescription('Usuario alvo').setRequired(false))
    .addBooleanOption((option) =>
      option.setName('force').setDescription('Sobrescreve vinculo existente').setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) {
      return;
    }

    const action = interaction.options.getString('acao', true) as SteamAction;

    const enabled = ensureSteamEnabled();
    if (!enabled.ok) {
      await safeRespond(interaction, { embeds: [enabled.embed] });
      return;
    }

    if (action === 'refresh') {
      const cooldown = isRefreshOnCooldown(interaction.user.id);
      if (cooldown) {
        const embed = createSuziEmbed('warning')
          .setTitle('Calma ai')
          .setDescription(`Aguarde ${cooldown}s para atualizar novamente.`);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }
    }

    try {
      if (action === 'link') {
        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const isSelf = targetUser.id === interaction.user.id;
        const force = interaction.options.getBoolean('force') ?? false;
        const steamId64 = interaction.options.getString('steamid64')?.trim();
        if (!steamId64) {
          const embed = createSuziEmbed('warning')
            .setTitle('Informe o SteamID64')
            .setDescription('Use /steam acao:link steamid64:<17 digitos>.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        if (!isSelf && !hasRegisterPermission(interaction)) {
          const embed = createSuziEmbed('warning')
            .setTitle(`${EMOJI_WARNING} Permissao insuficiente`)
            .setDescription('Voce precisa de Manage Guild ou do cargo mestre para vincular outra pessoa.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        if (!validateSteamId64(steamId64)) {
          const embed = createSuziEmbed('warning')
            .setTitle('SteamID64 invalido')
            .setDescription('Use o SteamID64 (17 digitos). Ex: 7656119...');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const existing = getSteamLink(targetUser.id);
        if (existing && !force) {
          const embed = createSuziEmbed('warning')
            .setTitle('Vinculo ja existe')
            .setDescription('Use /steam acao:link force:true para sobrescrever.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const summaryResult = await getCachedSummary(steamId64, { force: true });
        if (!summaryResult.ok && summaryResult.reason === 'NOT_FOUND') {
          const embed = createSuziEmbed('warning')
            .setTitle('Nao foi possivel vincular')
            .setDescription('Perfil privado ou SteamID invalido.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        linkSteam(targetUser.id, steamId64, interaction.user.id);

        const embed = createSuziEmbed('success')
          .setTitle(`${EMOJI_LINK} Steam vinculado`)
          .setDescription(`Conta Steam vinculada para <@${targetUser.id}>.`);

        if (summaryResult.ok) {
          embed.addFields({ name: 'Perfil Steam', value: buildSteamField(summaryResult.summary) });
          if (summaryResult.summary.avatarfull) {
            embed.setThumbnail(summaryResult.summary.avatarfull);
          }
        } else {
          embed.addFields({ name: 'Perfil Steam', value: 'Perfil indisponivel agora. Tente /steam refresh depois.' });
        }

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'unlink') {
        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const isSelf = targetUser.id === interaction.user.id;

        if (!isSelf && !hasRegisterPermission(interaction)) {
          const embed = createSuziEmbed('warning')
            .setTitle(`${EMOJI_WARNING} Permissao insuficiente`)
            .setDescription('Voce precisa de Manage Guild ou do cargo mestre para remover vinculos.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const removed = unlinkSteam(targetUser.id);
        if (!removed) {
          const embed = createSuziEmbed('warning')
            .setTitle('Nenhum vinculo encontrado')
            .setDescription('Este usuario ainda nao possui Steam vinculado.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const embed = createSuziEmbed('success')
          .setTitle('Vinculo removido')
          .setDescription(`Steam desvinculado de <@${targetUser.id}>.`);
        await safeRespond(interaction, { embeds: [embed] });
        return;
      }

      if (action === 'view' || action === 'refresh') {
        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const link = getSteamLink(targetUser.id);
        if (!link) {
          const embed = createSuziEmbed('warning')
            .setTitle('Nenhum Steam vinculado')
            .setDescription('Use /steam acao:link para vincular um SteamID64.');
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const summaryResult = await getCachedSummary(link.steamId64, { force: action === 'refresh' });
        if (!summaryResult.ok) {
          const embed = createSuziEmbed('warning')
            .setTitle(`${EMOJI_WARNING} Steam indisponivel`)
            .setDescription(
              summaryResult.reason === 'NOT_FOUND'
                ? 'Perfil privado ou SteamID invalido.'
                : 'Nao consegui carregar o perfil Steam agora.',
            );
          await safeRespond(interaction, { embeds: [embed] });
          return;
        }

        const embed = createSuziEmbed('primary')
          .setTitle(`${EMOJI_GAME} Perfil Steam`)
          .setDescription(`Usuario: <@${targetUser.id}>`)
          .addFields({ name: 'Detalhes', value: buildSteamField(summaryResult.summary) });

        if (summaryResult.summary.avatarfull) {
          embed.setThumbnail(summaryResult.summary.avatarfull);
        }

        if (action === 'refresh') {
          embed.setFooter({ text: `${EMOJI_REFRESH} Cache atualizado` });
        }

        await safeRespond(interaction, { embeds: [embed] });
        return;
      }
    } catch (error) {
      logError('SUZI-CMD-002', error, { message: 'Erro no comando /steam', action });
      const embed = createSuziEmbed('warning')
        .setTitle('Algo deu errado')
        .setDescription('Nao consegui completar o comando /steam agora.');
      await safeRespond(interaction, { embeds: [embed] });
    }
  },
};
