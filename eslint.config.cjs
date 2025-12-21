const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = [
  ...compat.config(require('./.eslintrc.json')),
  {
    files: ['**/*.ts'],
    rules: {
      'import/no-unresolved': 'off',
    },
  },
];
