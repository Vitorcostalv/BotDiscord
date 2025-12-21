import {
  ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  MessageFlags,
} from 'discord.js';

import { logError, logWarn } from './logging.js';

function isInteractionError(error: unknown, code: number): boolean {
  return typeof (error as { code?: number }).code === 'number' && (error as { code?: number }).code === code;
}

function normalizeReplyPayload(
  payload: InteractionReplyOptions | InteractionEditReplyOptions | string,
  allowWithResponse: boolean,
): InteractionReplyOptions {
  if (typeof payload === 'string') {
    return { content: payload };
  }
  const base = { ...(payload as InteractionReplyOptions & InteractionEditReplyOptions) };
  if ('fetchReply' in base) {
    delete (base as { fetchReply?: unknown }).fetchReply;
  }
  if (!allowWithResponse && 'withResponse' in base) {
    delete (base as { withResponse?: unknown }).withResponse;
  }
  return base as InteractionReplyOptions;
}

function normalizeEditPayload(
  payload: InteractionReplyOptions | InteractionEditReplyOptions | string,
): InteractionEditReplyOptions {
  if (typeof payload === 'string') {
    return { content: payload };
  }
  const base = { ...(payload as InteractionReplyOptions & InteractionEditReplyOptions) };
  if ('flags' in base) {
    delete (base as { flags?: unknown }).flags;
  }
  if ('fetchReply' in base) {
    delete (base as { fetchReply?: unknown }).fetchReply;
  }
  if ('withResponse' in base) {
    delete (base as { withResponse?: unknown }).withResponse;
  }
  return base;
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
      logWarn('SUZI-DISCORD-001', error, { stage: 'defer' });
      return false;
    }
    logError('SUZI-DISCORD-001', error, { stage: 'defer' });
    throw error;
  }
}

export async function safeReply(
  interaction: ChatInputCommandInteraction,
  payload: InteractionReplyOptions | InteractionEditReplyOptions | string,
  ephemeral = false,
): Promise<unknown> {
  try {
    if (interaction.deferred && !interaction.replied) {
      return await interaction.editReply(normalizeEditPayload(payload));
    }
    if (interaction.replied) {
      const basePayload = normalizeReplyPayload(payload, false);
      const replyPayload = ephemeral
        ? { ...basePayload, flags: MessageFlags.Ephemeral }
        : { ...basePayload };
      return await interaction.followUp(replyPayload as InteractionReplyOptions);
    }

    const basePayload = normalizeReplyPayload(payload, true);
    const replyPayload = ephemeral
      ? { ...basePayload, flags: MessageFlags.Ephemeral }
      : { ...basePayload };
    return await interaction.reply(replyPayload as InteractionReplyOptions);
  } catch (error) {
    if (isInteractionError(error, 10062)) {
      logWarn('SUZI-DISCORD-001', error, { stage: 'reply' });
      return null;
    }
    if (isInteractionError(error, 40060)) {
      logWarn('SUZI-DISCORD-001', error, { stage: 'reply', reason: 'already_ack' });
      return null;
    }
    if (isInteractionError(error, 50013)) {
      logWarn('SUZI-DISCORD-002', error, { stage: 'reply' });
      return null;
    }
    if (isInteractionError(error, 50001)) {
      logWarn('SUZI-DISCORD-003', error, { stage: 'reply' });
      return null;
    }
    logWarn('SUZI-DISCORD-001', error, { stage: 'reply' });
    return null;
  }
}

export async function safeRespond(
  interaction: ChatInputCommandInteraction,
  payload: InteractionReplyOptions | InteractionEditReplyOptions | string,
  ephemeral = false,
): Promise<unknown> {
  return safeReply(interaction, payload, ephemeral);
}

export async function safeEditReply(
  interaction: ChatInputCommandInteraction,
  payload: InteractionEditReplyOptions | string,
): Promise<unknown> {
  const editPayload = normalizeEditPayload(payload);
  try {
    return await interaction.editReply(editPayload as InteractionEditReplyOptions);
  } catch (error) {
    if (isInteractionError(error, 10062)) {
      logWarn('SUZI-DISCORD-001', error, { stage: 'edit' });
      return null;
    }
    if (isInteractionError(error, 40060)) {
      logWarn('SUZI-DISCORD-001', error, { stage: 'edit', reason: 'already_ack' });
      return null;
    }
    logWarn('SUZI-DISCORD-001', error, { stage: 'edit' });
    return null;
  }
}
