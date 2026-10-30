import { defineConfig } from 'vitest/config';

// Testes unitários: rápidos e sem banco. Os de integração (test/) rodam com `pnpm test:int`.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
