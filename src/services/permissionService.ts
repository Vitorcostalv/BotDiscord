import {
  PermissionsBitField,
  type APIInteractionGuildMember,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';

import { env } from '../config/env.js';

export function hasRegisterPermission(interaction: ChatInputCommandInteraction): boolean {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    return true;
  }

  const roleId = env.roleMasterId;
  if (!roleId) {
    return false;
  }

  const member = interaction.member;
  if (!member || typeof member !== 'object' || !('roles' in member)) {
    return false;
  }

  const roleStore = (member as GuildMember).roles;
  if (roleStore && typeof roleStore === 'object' && 'cache' in roleStore) {
    return (member as GuildMember).roles.cache.has(roleId);
  }

  const rawRoles = (member as APIInteractionGuildMember).roles;
  return Array.isArray(rawRoles) && rawRoles.includes(roleId);
}
