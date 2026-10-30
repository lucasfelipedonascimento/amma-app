import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integração: Postgres/PostGIS e Redis reais, em banco/índice próprios (veja test/global-setup.ts).
export default defineConfig({
  // esbuild (padrão do Vitest) não emite metadados de decorators; o Nest precisa deles para injetar dependências.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    // Todos os arquivos dividem o mesmo banco: um de cada vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
