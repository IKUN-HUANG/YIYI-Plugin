import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', 'data/**', 'cache/**', 'config/config/**', 'resources/**'] },
  {
    ...js.configs.recommended,
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        plugin: 'readonly',
        Bot: 'readonly',
        logger: 'readonly',
        redis: 'readonly',
        segment: 'readonly',
        uploadRecord: 'readonly'
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-irregular-whitespace': ['error', { skipStrings: true, skipComments: true, skipTemplates: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      semi: ['error', 'never']
    }
  },
  {
    files: ['models/King/login/qq.js'],
    languageOptions: { globals: globals.browser }
  }
]
