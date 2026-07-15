import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    globals: false,
    // MOB-147: disable client telemetry by default so existing tool
    // tests don't accidentally observe the fire-and-forget POST.
    setupFiles: ['./__tests__/setup.ts'],
  },
});
