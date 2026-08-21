import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@gptrouter/contracts': path.resolve(__dirname, '../contracts/src/index.ts'),
      '@gptrouter/domain': path.resolve(__dirname, '../domain/src/index.ts'),
      '@gptrouter/persistence': path.resolve(__dirname, '../persistence/src/index.ts'),
      '@gptrouter/security': path.resolve(__dirname, '../security/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.tsbuildinfo'],
  },
});
