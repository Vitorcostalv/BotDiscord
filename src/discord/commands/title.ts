import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import { getLocalized, getTranslator, tLang } from '../../i18n/index.js';
import { getPlayerProfile } from '../../services/profileService.js';
import {
  clearEquippedTitle,
  equipTitle,
  getTitleLabel,
  getUserTitleState,
  isTitleUnlocked,
  listTitleDefinitions,
  resolveTitleDefinition,
} from '../../services/titleService.js';
import { safeDeferReply, safeRespond } from '../../utils/interactions.js';
import { createSuziEmbed } from '../embeds.js';

const EMOJI_TAG = '\u{1F3F7}\uFE0F';
const EMOJI_WARNING = '\u26A0\uFE0F';
const EMOJI_CLEAN = '\u{1F9FC}';

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

type TitleAction = 'add' | 'remove';

const ACTION_CHOICES = [
  { name: tLang('en', 'title.action.add'), name_localizations: getLocalized('title.action.add'), value: 'add' },
  {
    name: tLang('en', 'title.action.remove'),
    name_localizations: getLocalized('title.action.remove'),
    value: 'remove',
  },
];

function translateTitleLabel(t: (key: string, vars?: Record<string, string | number>) => string, idOrLabel: string) {
  const key = `title.${idOrLabel}.label`;
  const translated = t(key);
  if (translated !== key) return translated;
  return getTitleLabel(idOrLabel);
}

export async function executeTitleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const t = getTranslator(interaction.guildId);
  const profile = getPlayerProfile(interaction.user.id, interaction.guildId ?? null);
  if (!profile) {
    await safeRespond(interaction, t('title.add.need_register', { emoji: EMOJI_WARNING }));
    return;
  }

  const input = interaction.options.getString('titulo') ?? interaction.options.getString('title');
  if (!input) {
    await safeRespond(interaction, t('title.add.missing', { emoji: EMOJI_WARNING }));
    return;
  }
  const definition = resolveTitleDefinition(input);
  if (!definition) {
    await safeRespond(interaction, t('title.add.invalid', { emoji: EMOJI_WARNING }));
    return;
  }

  if (!isTitleUnlocked(interaction.user.id, definition.id)) {
    const state = getUserTitleState(interaction.user.id);
    const unlocked = Object.keys(state.unlocked ?? {});
    const unlockedText = unlocked.length
      ? unlocked.map((id) => translateTitleLabel(t, id)).join('\n')
      : t('title.add.none');
    await safeRespond(interaction, t('title.add.locked', { emoji: EMOJI_WARNING, list: unlockedText }));
    return;
  }

  const equipped = equipTitle(interaction.user.id, definition.id);
  if (!equipped) {
    await safeRespond(interaction, t('title.add.failed', { emoji: EMOJI_WARNING }));
    return;
  }

  const titleLabel = translateTitleLabel(t, equipped.id ?? equipped.label);
  const embed = createSuziEmbed('success')
    .setTitle(`${EMOJI_TAG} ${t('title.add.success.title')}`)
    .setDescription(t('title.add.success.desc', { title: titleLabel }))
    .addFields({ name: t('title.add.success.field.remove'), value: t('title.add.success.field.remove_value') });

  await safeRespond(interaction, { embeds: [embed] });
}

export async function executeTitleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const t = getTranslator(interaction.guildId);
  const profile = getPlayerProfile(interaction.user.id, interaction.guildId ?? null);
  if (!profile) {
    await safeRespond(interaction, t('title.remove.need_register', { emoji: EMOJI_WARNING }));
    return;
  }

  clearEquippedTitle(interaction.user.id);

  const embed = createSuziEmbed('primary')
    .setTitle(`${EMOJI_CLEAN} ${t('title.remove.success.title')}`)
    .setDescription(t('title.remove.success.desc'));

  await safeRespond(interaction, { embeds: [embed] });
}

export const titleCommand = {
  data: new SlashCommandBuilder()
    .setName('title')
    .setDescription(tLang('en', 'title.command.desc'))
    .setDescriptionLocalizations(getLocalized('title.command.desc'))
    .addStringOption((option) =>
      option
        .setName('acao')
        .setNameLocalizations(getLocalized('title.option.action.name'))
        .setDescription(tLang('en', 'title.option.action.desc'))
        .setDescriptionLocalizations(getLocalized('title.option.action.desc'))
        .setRequired(true)
        .addChoices(...ACTION_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('titulo')
        .setNameLocalizations(getLocalized('title.option.title.name'))
        .setDescription(tLang('en', 'title.option.title.desc'))
        .setDescriptionLocalizations(getLocalized('title.option.title.desc'))
        .setRequired(false)
        .addChoices(...TITLE_CHOICES),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const canReply = await safeDeferReply(interaction, false);
    if (!canReply) return;

    const action = interaction.options.getString('acao', true) as TitleAction;
    if (action === 'add') {
      await executeTitleAdd(interaction);
      return;
    }
    if (action === 'remove') {
      await executeTitleRemove(interaction);
    }
  },
};
