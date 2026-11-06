import path from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': path.resolve(__dirname, 'src'),
  'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
};

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    projects: [
      {
        extends: true,
        resolve: {
          alias,
        },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        resolve: {
          alias,
        },
        test: {
          name: 'emulator',
          include: [
            'tests/rules/**/*.test.ts',
            'tests/integration/**/*.test.ts',
          ],
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
