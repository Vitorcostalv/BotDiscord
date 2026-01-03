import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { setGuildLanguage, type GuildLanguage } from '../../services/guildSettingsService.js';
import { hasRegisterPermission } from '../../services/permissionService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { createSuziEmbed } from '../embeds.js';

const LANGUAGE_CHOICES: Array<{ nameKey: string; value: GuildLanguage }> = [
  { nameKey: 'language.label.en', value: 'en' },
  { nameKey: 'language.label.pt', value: 'pt' },
];

export const languageCommand = {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription(tLang('en', 'language.command.desc'))
    .setNameLocalizations(getLocalized('language.command.name'))
    .setDescriptionLocalizations(getLocalized('language.command.desc'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription(tLang('en', 'language.option.action.desc'))
        .setNameLocalizations(getLocalized('language.option.action.name'))
        .setDescriptionLocalizations(getLocalized('language.option.action.desc'))
        .addStringOption((option) =>
          option
            .setName('language')
            .setDescription(tLang('en', 'language.option.language.desc'))
            .setNameLocalizations(getLocalized('language.option.language.name'))
            .setDescriptionLocalizations(getLocalized('language.option.language.desc'))
            .setRequired(true)
            .addChoices(
              ...LANGUAGE_CHOICES.map((choice) => ({
                name: tLang('en', choice.nameKey),
                value: choice.value,
                name_localizations: getLocalized(choice.nameKey),
              })),
            ),
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, true);
    if (!canReply) return;

    const guildId = interaction.guildId;
    const t = getTranslator(guildId);

    if (!guildId) {
      const embed = createSuziEmbed('warning')
        .setTitle(t('common.server_only.title'))
        .setDescription(t('common.server_only.desc'));
      await safeRespond(interaction, { embeds: [embed] }, true);
      return;
    }

    if (!hasRegisterPermission(interaction)) {
      const embed = createSuziEmbed('warning')
        .setTitle(t('language.not_allowed.title'))
        .setDescription(t('language.not_allowed.desc'));
      await safeRespond(interaction, { embeds: [embed] }, true);
      return;
    }

    const language = interaction.options.getString('language', true) as GuildLanguage;
    const result = setGuildLanguage(guildId, language, interaction.user.id);

    const embed = createSuziEmbed('success')
      .setTitle(t('language.changed.title'))
      .setDescription(
        `${t('language.changed.desc', {
          from: t(`language.label.${result.previous}`),
          to: t(`language.label.${result.current}`),
        })}\n\n${t('language.warning')}`,
      )
      .setFooter({ text: t('language.changed.footer') });

    await safeRespond(interaction, { embeds: [embed] }, true);
  },
};
