import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig(async () => ({
  plugins: await WxtVitest(),
  test: {
    environment: 'happy-dom',
    restoreMocks: true,
    exclude: [...configDefaults.exclude, '.worktrees/**'],
  },
}));
