/**
 * Prettier — JS + EJS (via prettier-plugin-ejs).
 * Scope is enforced by npm scripts (no .prettierignore): only paths listed there are formatted.
 */
module.exports = {
  plugins: [require('prettier-plugin-ejs')],

  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  jsxSingleQuote: false,
  trailingComma: 'es5',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'always',
  endOfLine: 'lf',

  overrides: [
    {
      files: '*.ejs',
      options: {
        printWidth: 120,
        singleQuote: false,
        htmlWhitespaceSensitivity: 'css',
        singleAttributePerLine: false,
        bracketSameLine: false,
      },
    },
  ],
};
