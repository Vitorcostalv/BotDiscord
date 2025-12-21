import {
  ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  MessageFlags,
} from 'discord.js';

import { logger } from './logger.js';

function isInteractionError(error: unknown, code: number): boolean {
  return typeof (error as { code?: number }).code === 'number' && (error as { code?: number }).code === code;
}

function normalizePayload(
  payload: InteractionReplyOptions | InteractionEditReplyOptions | string,
): InteractionReplyOptions | InteractionEditReplyOptions {
  if (typeof payload === 'string') {
    return { content: payload };
  }
  return payload;
}

export async function safeDeferReply(
  interaction: ChatInputCommandInteraction,
  ephemeral = false,
): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;
  try {
    if (ephemeral) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }
    return true;
  } catch (error) {
    if (isInteractionError(error, 10062)) {
      logger.warn('Interacao expirada', error);
      return false;
    }
    logger.error('Falha ao deferir interacao', error);
    throw error;
  }
}

export async function safeReply(
  interaction: ChatInputCommandInteraction,
  payload: InteractionReplyOptions | InteractionEditReplyOptions | string,
  ephemeral = false,
): Promise<unknown> {
  const basePayload = normalizePayload(payload);
  try {
    if (interaction.deferred && !interaction.replied) {
      return await interaction.editReply(basePayload);
    }
    if (interaction.replied) {
      const replyPayload = ephemeral
        ? { ...basePayload, flags: MessageFlags.Ephemeral }
        : { ...basePayload };
      return await interaction.followUp(replyPayload as InteractionReplyOptions);
    }

    const replyPayload = ephemeral
      ? { ...basePayload, flags: MessageFlags.Ephemeral }
      : { ...basePayload };
    return await interaction.reply(replyPayload as InteractionReplyOptions);
  } catch (error) {
    if (isInteractionError(error, 10062)) {
      logger.warn('Interacao expirada', error);
      return null;
    }
    if (isInteractionError(error, 40060)) {
      logger.warn('Interacao ja reconhecida', error);
      return null;
    }
    logger.warn('Falha ao responder interacao', error);
    return null;
  }
}

export async function safeEditReply(
  interaction: ChatInputCommandInteraction,
  payload: InteractionEditReplyOptions | string,
): Promise<unknown> {
  const editPayload = normalizePayload(payload);
  try {
    return await interaction.editReply(editPayload as InteractionEditReplyOptions);
  } catch (error) {
    if (isInteractionError(error, 10062)) {
      logger.warn('Interacao expirada', error);
      return null;
    }
    if (isInteractionError(error, 40060)) {
      logger.warn('Interacao ja reconhecida', error);
      return null;
    }
    logger.warn('Falha ao editar resposta', error);
    return null;
  }
}
