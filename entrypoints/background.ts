import { defineBackground } from '#imports';

export default defineBackground({
  main() {
    // Listen for messages from popup
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'getSettings') {
        // Return stored settings
        browser.storage.local.get(['invertValue', 'hueValue']).then(sendResponse);
        return true;
      }
    });
  }
});