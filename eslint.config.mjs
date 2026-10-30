import tseslint from 'typescript-eslint';

// Config única para todo o monorepo.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.expo/**', '**/.next/**'] },
  ...tseslint.configs.recommended,
  {
    // Regra de importação: apps nunca importam de outros apps (reforçada também por scripts/check-imports.mjs).
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/*', '@amma/api', '@amma/mobile', '@amma/admin'],
              message:
                'Apps não podem importar de outros apps. Mova o código comum para packages/shared.',
            },
          ],
        },
      ],
    },
  },
  {
    // Testes de integração leem JSON de respostas HTTP: `any` ali é prático e inofensivo.
    files: ['apps/api/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
