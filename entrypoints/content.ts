import { defineContentScript } from '#imports';
import { ImageController } from '../content/image-controller';
import './content-styles.css';

export default defineContentScript({
  matches: ['<all_urls>'], cssInjectionMode: 'manifest',
  async main(ctx) {
    const controller = new ImageController();
    try { await controller.init(); }
    catch (error) { console.error('Failed to initialize image controls:', error); }
    ctx.onInvalidated(() => controller.cleanup());
  },
});
