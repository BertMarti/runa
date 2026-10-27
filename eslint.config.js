import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'data/**', 'e2e/.data/**', 'e2e/informe/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Prohibidas en todo el proyecto: abren la puerta a XSS o a ejecutar texto como código.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Usa texto con React; la CSP exige Trusted Types.' },
        { property: 'outerHTML', message: 'Usa texto con React; la CSP exige Trusted Types.' },
        { property: 'insertAdjacentHTML', message: 'Usa texto con React; la CSP exige Trusted Types.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Prohibido: el contenido de un secreto nunca se interpreta como HTML.',
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/server/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/test/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
