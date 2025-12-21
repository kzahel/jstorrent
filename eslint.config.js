import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'
import importPlugin from 'eslint-plugin-import'

export default tseslint.config(
  {
    ignores: [
      'dist',
      '.eslintrc.cjs',
      'packages/legacy-jstorrent-engine/**/*.js',
      '**/dist/**',
      'archive/legacy-app/**',
      'archive/legacy-extension/**',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['packages/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Dynamic imports are banned in the engine package.',
        },
        {
          selector: "MemberExpression[object.object.name='chrome'][object.property.name='storage']",
          message:
            'Direct chrome.storage access is banned in UI packages. Use KV message handlers via the service worker.',
        },
      ],
    },
  },
  {
    files: ['packages/engine/src/**/*.{ts,tsx}'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-nodejs-modules': 'error',
    },
  },
  {
    files: [
      'packages/engine/src/adapters/node/**/*.{ts,tsx}',
      'packages/engine/src/node-rpc/**/*.{ts,tsx}',
      'packages/engine/src/presets/node*.{ts,tsx}',
      'packages/engine/test/**/*.{ts,tsx}',
    ],
    rules: {
      'import/no-nodejs-modules': 'off',
    },
  },
  {
    files: ['packages/client/src/**/*.{ts,tsx}'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-nodejs-modules': 'error',
    },
  },
  {
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-nodejs-modules': 'error',
    },
  },
  // Ban direct chrome.storage access in UI packages - use KV handlers via service worker
  {
    files: ['packages/client/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.object.name='chrome'][object.property.name='storage']",
          message:
            'Direct chrome.storage access is banned in UI packages. Use KV message handlers via the service worker.',
        },
      ],
    },
  },
  // IMPORTANT: Keep this last to disable formatting rules that conflict with Prettier
  // This must come after all other configs to properly override formatting rules
  prettierConfig,
)
