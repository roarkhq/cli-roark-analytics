// @ts-check
//
// Adapted from sdk-roark-analytics-node's root config, which used to lint this
// package while it lived there. One rule did not come across: that config bans
// `@roarkanalytics/sdk` package imports in favour of relative ones, because in
// the SDK repository those files ARE the SDK. Here the package import is the
// only correct way to reach it, and the SDK config disabled the rule for
// `packages/**` for exactly that reason - so it is dropped rather than inverted.
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { sourceType: 'module' },
  },
  files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.js', '**/*.mjs', '**/*.cjs'],
  ignores: ['dist/'],
  plugins: {
    '@typescript-eslint': tseslint.plugin,
    'unused-imports': unusedImports,
  },
  rules: {
    'no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'error',
  },
});
