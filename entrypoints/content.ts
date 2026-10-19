import { createShadowRootUi, defineContentScript } from '#imports';
import { ImageController } from '../content/image-controller';
import './content-styles.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'image-darkista-ui',
      position: 'inline',
      anchor: 'body',
      onMount: () => {},
    });
    ui.mount();
    const controller = new ImageController(ui.uiContainer, ctx.signal);
    try {
      await controller.init();
    } catch (error) {
      console.error('Failed to initialize image controls:', error);
    }
  },
});
