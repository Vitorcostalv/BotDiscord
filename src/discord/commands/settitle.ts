import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getLocalized, tLang } from '../../i18n/index.js';
import { listTitleDefinitions } from '../../services/titleService.js';
import { safeDeferReply } from '../../utils/interactions.js';

import { executeTitleAdd } from './title.js';

function getTitleLabelForLang(id: string, fallback: string, lang: 'en' | 'pt'): string {
  const key = `title.${id}.label`;
  const translated = tLang(lang, key);
  return translated === key ? fallback : translated;
}

const TITLE_CHOICES = listTitleDefinitions().map((title) => ({
  name: getTitleLabelForLang(title.id, title.label, 'en'),
  name_localizations: {
    'en-US': getTitleLabelForLang(title.id, title.label, 'en'),
    'pt-BR': getTitleLabelForLang(title.id, title.label, 'pt'),
  },
  value: title.id,
}));

export const settitleCommand = {
  data: new SlashCommandBuilder()
    .setName('settitle')
    .setDescription(tLang('en', 'title.set.command.desc'))
    .setDescriptionLocalizations(getLocalized('title.set.command.desc'))
    .addStringOption((option) =>
      option
        .setName('title')
        .setNameLocalizations(getLocalized('title.set.option.title.name'))
        .setDescription(tLang('en', 'title.set.option.title.desc'))
        .setDescriptionLocalizations(getLocalized('title.set.option.title.desc'))
        .setRequired(true)
        .addChoices(...TITLE_CHOICES),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    await executeTitleAdd(interaction);
  },
};
