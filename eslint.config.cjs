const js = require('@eslint/js');
const eslintPluginUnicorn = require('eslint-plugin-unicorn').default;
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', '.vercel/**', 'public/**', 'data/**', 'src/db/sql/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      unicorn: eslintPluginUnicorn,
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^(next|_)$',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-implicit-globals': 'error',
      'no-unreachable': 'error',
      'no-throw-literal': 'error',
      'no-multiple-empty-lines': ['warn', { max: 1, maxEOF: 1 }],

      /* catch / control-flow hygiene */
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-useless-catch': 'error',
      'no-constant-condition': ['warn', { checkLoops: true }],

      /* prefer clearer iteration when you want to fix noise (warn, not error) */
      'unicorn/no-array-for-each': 'warn',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/prevent-abbreviations': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
