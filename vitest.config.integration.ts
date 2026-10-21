import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { setupFiles: ['./test/setup.mjs'], include: ['test/integration/*.test.mjs'], fileParallelism: false, hookTimeout: 90000 } });
