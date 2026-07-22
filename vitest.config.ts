import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig(async () => ({
  plugins: await WxtVitest(),
  test: { environment: 'happy-dom', restoreMocks: true },
}));
