import eslint from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '.cache/**',
      'build/**',
      'dist/**',
      'node_modules/**',
      'out/**',
      'src/renderer/public/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }
      ],
      'no-console': 'off',
      // These patterns are already used intentionally in the Electron codebase. Keep the
      // useful undefined-variable and unused-variable checks without forcing a broad rewrite.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unsafe-finally': 'off',
      'no-constant-condition': 'off',
      'no-cond-assign': 'off',
      'no-control-regex': 'off',
      'no-empty': 'off',
      'no-fallthrough': 'off',
      'no-func-assign': 'off',
      'no-prototype-builtins': 'off',
      'no-unused-expressions': 'off',
      'no-useless-assignment': 'off',
      'no-useless-catch': 'off',
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'error'
    }
  }
)
