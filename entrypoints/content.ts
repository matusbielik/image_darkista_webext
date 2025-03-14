import { defineContentScript } from 'wxt/sandbox';
import { browser } from 'wxt/browser';

interface Settings {
  enableInvert: boolean;
  enableHue: boolean;
  enableAuto: boolean;
  enableSimilar: boolean;
  enableReset: boolean;
  enableCompact: boolean;
}

let settings: Settings = {
  enableInvert: true,
  enableHue: true,
  enableAuto: true,
  enableSimilar: true,
  enableReset: true,
  enableCompact: false
};

async function loadSettings(): Promise<void> {
  try {
    const result = await browser.storage.local.get('settings');
    if (result.settings) {
      settings = {
        ...settings,
        ...result.settings
      };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Add these interfaces near the top of the file, after the Settings interface
interface ApplyToAllMessage {
  action: 'applyToAll'
  invertValue: string
  hueValue: string
}

interface ResetAllMessage {
  action: 'resetAll'
}

interface UpdateSettingsMessage {
  action: 'updateSettings'
  settings: Settings
}

// Union type for all possible message types
type Message = ApplyToAllMessage | ResetAllMessage | UpdateSettingsMessage

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    // Load settings first
    await loadSettings()

    // Function to create and add controls to an image
    const addControlsToImage = (img: HTMLImageElement) => {

      // Skip if controls are already added
      if (img.hasAttribute('has-dark-controls')) return;
      img.setAttribute('has-dark-controls', 'true');

      // Create control container with positioning relative to the image itself
      const controlContainer = document.createElement('div');
      controlContainer.className = 'dark-image-controls';
      controlContainer.style.position = 'absolute';
      controlContainer.style.top = '0';
      controlContainer.style.right = '0';
      controlContainer.style.zIndex = '9999';
      controlContainer.style.display = 'none';
      controlContainer.style.padding = settings.enableCompact ? '4px' : '8px';
      controlContainer.style.borderRadius = '8px';
      controlContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      controlContainer.style.color = 'white';
      controlContainer.style.flexDirection = 'column';
      controlContainer.style.gap = '4px';
      controlContainer.style.pointerEvents = 'auto'; // Ensure controls are clickable

      // Create a wrapper div that will contain both the image and controls
      const wrapper = document.createElement('div');
      wrapper.classList.add('dark-controls-wrapper');
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';
      wrapper.style.width = 'auto';
      wrapper.style.height = 'auto';
      wrapper.style.verticalAlign = 'top';

      // Preserve original image dimensions and behavior
      const originalStyles = window.getComputedStyle(img);
      img.style.display = originalStyles.display;
      img.style.width = originalStyles.width;
      img.style.height = originalStyles.height;
      img.style.maxWidth = originalStyles.maxWidth;
      img.style.maxHeight = originalStyles.maxHeight;

      // Position the container relative to the image
      const imgParent = img.parentElement;
      if (imgParent) {
        // Get the computed style of the image
        const imgStyle = window.getComputedStyle(img);

        // Preserve any existing margin on the image
        wrapper.style.margin = imgStyle.margin;
        img.style.margin = '0';

        // Replace image with wrapper
        imgParent.insertBefore(wrapper, img);
        wrapper.appendChild(img);
        wrapper.appendChild(controlContainer);

        // Update show/hide controls on hover to work with wrapper
        wrapper.addEventListener('mouseenter', () => {
          const controls = wrapper.querySelector('.dark-image-controls');
          if (controls) {
            (controls as HTMLElement).style.display = 'flex';
          }
        });

        wrapper.addEventListener('mouseleave', (e) => {
          const controls = wrapper.querySelector('.dark-image-controls');
          if (controls && !controls.contains(e.relatedTarget as Node)) {
            (controls as HTMLElement).style.display = 'none';
          }
        });
      }

      // Create sliders container
      const slidersContainer = document.createElement('div');
      slidersContainer.style.display = 'flex';
      slidersContainer.style.flexDirection = 'column';
      slidersContainer.style.gap = settings.enableCompact ? '2px' : '4px';

      // Create invert slider
      const invertContainer = createInvertSlider(img);
      if (invertContainer) {
        slidersContainer.appendChild(invertContainer);
      }

      // Create hue slider
      const hueContainer = createHueSlider(img);
      if (hueContainer) {
        slidersContainer.appendChild(hueContainer);
      }

      // Create button container
      const buttonsContainer = document.createElement('div');
      buttonsContainer.style.display = 'flex';
      buttonsContainer.style.flexDirection = settings.enableCompact ? 'row' : 'column';
      buttonsContainer.style.gap = settings.enableCompact ? '2px' : '4px';
      buttonsContainer.style.marginTop = '4px';

      // Create auto-invert button
      const autoInvertButton = createAutoButton(img);
      if (autoInvertButton) {
        buttonsContainer.appendChild(autoInvertButton);
      }

      // Create apply to similar button
      const applyToSimilarButton = createSimilarButton(img);
      if (applyToSimilarButton) {
        buttonsContainer.appendChild(applyToSimilarButton);
      }

      // Create reset button
      const resetButton = createResetButton(img);
      if (resetButton) {
        buttonsContainer.appendChild(resetButton);
      }

      // Add buttons container to the sliders container
      slidersContainer.appendChild(buttonsContainer);

      // Finally add everything to the main container
      controlContainer.appendChild(slidersContainer);
    };

    // Initially process all existing images
    document.querySelectorAll('img').forEach(img => {
      addControlsToImage(img as HTMLImageElement);
    });

    // Create a MutationObserver to watch for new images
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes') {
          // If this is an image and its src attribute changed
          if (mutation.target instanceof HTMLImageElement &&
            mutation.attributeName === 'src') {
            addControlsToImage(mutation.target);
          }
        } else if (mutation.type === 'childList') {
          // Check for added nodes
          mutation.addedNodes.forEach((node) => {
            // Check if the added node is an image
            if (node instanceof HTMLImageElement) {
              addControlsToImage(node);
            }
            // Also check for images within added nodes
            if (node instanceof Element) {
              node.querySelectorAll('img').forEach(img => {
                addControlsToImage(img as HTMLImageElement);
              });
            }
          });
        }
      });
    });

    // Start observing the document with the configured parameters
    observer.observe(document.body, {
      childList: true,      // Watch for changes in direct children
      subtree: true,        // Watch for changes in all descendants
      attributes: true,     // Watch for attribute changes
      attributeFilter: ['src']  // Only watch for src attribute changes
    });

    // Also add a scroll event listener to recheck for images
    // as they might be loaded during scroll
    let scrollTimeout: number | null = null;
    window.addEventListener('scroll', () => {
      if (scrollTimeout) {
        window.clearTimeout(scrollTimeout);
      }
      scrollTimeout = window.setTimeout(() => {
        document.querySelectorAll('img').forEach(img => {
          addControlsToImage(img as HTMLImageElement);
        });
      }, 100);
    });

    // Add this to your content.ts main function
    browser.runtime.onMessage.addListener((
      message: unknown,
      _sender: any,
      _sendResponse: (response?: any) => void
    ): true => {
      if (typeof message === 'object' && message !== null) {
        const msg = message as any;

        if (msg.action === 'updateSettings') {
          settings = msg.settings;

          // Find all wrappers using the class and update them
          document.querySelectorAll('.dark-controls-wrapper').forEach(wrapper => {
            const img = wrapper.querySelector('img');
            if (img) {
              // Get the original parent
              const originalParent = wrapper.parentElement;
              if (originalParent) {
                // Remove the image from wrapper
                wrapper.removeChild(img);
                // Put the image back in its original location
                originalParent.insertBefore(img, wrapper);
                // Remove the wrapper
                wrapper.remove();
                // Remove the attribute
                img.removeAttribute('has-dark-controls');
                // Re-add controls
                addControlsToImage(img as HTMLImageElement);
              }
            }
          });
        } else if (msg.action === 'applyToAll') {
          const images = document.querySelectorAll('img')
          images.forEach(img => {
            img.style.filter = `invert(${msg.invertValue}) hue-rotate(${msg.hueValue}deg)`
          })
        } else if (msg.action === 'resetAll') {
          const images = document.querySelectorAll('img')
          images.forEach(img => {
            img.style.filter = ''
          })
        }
      }

      return true;
    })

    // Extract control container creation to a separate function
    function createControlContainer(img: HTMLImageElement) {
      const controlContainer = document.createElement('div');
      controlContainer.className = 'dark-image-controls';
      controlContainer.style.position = 'absolute';
      controlContainer.style.top = '0';
      controlContainer.style.right = '0';
      controlContainer.style.zIndex = '9999';
      controlContainer.style.display = 'none';
      controlContainer.style.padding = settings.enableCompact ? '4px' : '8px';
      controlContainer.style.borderRadius = '8px';
      controlContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      controlContainer.style.color = 'white';
      controlContainer.style.flexDirection = 'column';
      controlContainer.style.gap = '4px';
      controlContainer.style.pointerEvents = 'auto';

      const mainContainer = document.createElement('div');
      mainContainer.style.display = 'flex';
      mainContainer.style.flexDirection = 'column';
      mainContainer.style.gap = settings.enableCompact ? '2px' : '4px';

      // Create and add sliders container
      const slidersContainer = document.createElement('div');
      slidersContainer.style.display = 'flex';
      slidersContainer.style.flexDirection = 'column';
      slidersContainer.style.gap = settings.enableCompact ? '2px' : '4px';

      // Only add sliders, nothing else
      if (settings.enableInvert) {
        const invertContainer = createInvertSlider(img);
        if (invertContainer) slidersContainer.appendChild(invertContainer);
      }

      if (settings.enableHue) {
        const hueContainer = createHueSlider(img);
        if (hueContainer) slidersContainer.appendChild(hueContainer);
      }

      // Add sliders container if it has children
      if (slidersContainer.children.length > 0) {
        mainContainer.appendChild(slidersContainer);
      }

      // Create and add buttons container
      const buttonsContainer = document.createElement('div');
      buttonsContainer.style.display = 'flex';
      buttonsContainer.style.flexDirection = settings.enableCompact ? 'row' : 'column';
      buttonsContainer.style.gap = settings.enableCompact ? '2px' : '4px';
      buttonsContainer.style.marginTop = '4px';

      // Add all buttons here
      const buttons = [];

      if (settings.enableAuto) {
        const autoButton = createAutoButton(img);
        if (autoButton) buttons.push(autoButton);
      }

      if (settings.enableSimilar) {
        const similarButton = createSimilarButton(img);
        if (similarButton) buttons.push(similarButton);
      }

      if (settings.enableReset) {
        const resetButton = createResetButton(img);
        if (resetButton) buttons.push(resetButton);
      }

      // Add all buttons to the buttons container
      buttons.forEach(button => buttonsContainer.appendChild(button));

      // Add buttons container if it has children
      if (buttons.length > 0) {
        mainContainer.appendChild(buttonsContainer);
      }

      controlContainer.appendChild(mainContainer);
      return controlContainer;
    }

    // Extract the creation of individual controls to separate functions
    function createInvertSlider(img: HTMLImageElement): HTMLDivElement | null {
      if (!settings.enableInvert) return null;

      const invertContainer = document.createElement('div');
      invertContainer.style.display = 'flex';
      invertContainer.style.alignItems = 'center';
      invertContainer.style.gap = settings.enableCompact ? '2px' : '4px';

      const invertLabel = document.createElement('label');
      invertLabel.textContent = '🔆';
      invertLabel.style.fontSize = '12px';

      const invertSlider = document.createElement('input');
      invertSlider.type = 'range';
      invertSlider.min = '0';
      invertSlider.max = '1';
      invertSlider.step = '0.1';
      invertSlider.value = '0';
      invertSlider.style.width = settings.enableCompact ? '40px' : '60px';

      invertSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const hueSlider = img.parentElement?.querySelector('input[type="range"]:nth-of-type(2)') as HTMLInputElement;
        const hueValue = hueSlider?.value || '180';
        applyImageFilter(img, invertSlider.value, hueValue);
      });

      invertContainer.appendChild(invertLabel);
      invertContainer.appendChild(invertSlider);
      return invertContainer;
    }

    function createHueSlider(img: HTMLImageElement): HTMLDivElement | null {
      if (!settings.enableHue) return null;

      const hueContainer = document.createElement('div');
      hueContainer.style.display = 'flex';
      hueContainer.style.alignItems = 'center';
      hueContainer.style.gap = settings.enableCompact ? '2px' : '4px';

      const hueLabel = document.createElement('label');
      hueLabel.textContent = '🎨';
      hueLabel.style.fontSize = '12px';

      const hueSlider = document.createElement('input');
      hueSlider.type = 'range';
      hueSlider.min = '0';
      hueSlider.max = '360';
      hueSlider.step = '10';
      hueSlider.value = '0';
      hueSlider.style.width = settings.enableCompact ? '40px' : '60px';

      hueSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const invertSlider = img.parentElement?.querySelector('input[type="range"]:first-of-type') as HTMLInputElement;
        const invertValue = invertSlider?.value || '0';
        applyImageFilter(img, invertValue, hueSlider.value);
      });

      hueContainer.appendChild(hueLabel);
      hueContainer.appendChild(hueSlider);
      return hueContainer;
    }

    function createAutoButton(img: HTMLImageElement): HTMLButtonElement | null {
      if (!settings.enableAuto) return null;

      const autoInvertButton = document.createElement('button');
      autoInvertButton.textContent = settings.enableCompact ? '🎯' : '🎯 Auto-match';
      autoInvertButton.title = 'Auto-match';
      autoInvertButton.style.fontSize = '10px';
      autoInvertButton.style.padding = settings.enableCompact ? '2px' : '2px 4px';
      autoInvertButton.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
      autoInvertButton.style.border = 'none';
      autoInvertButton.style.borderRadius = '4px';
      autoInvertButton.style.color = 'white';
      autoInvertButton.style.cursor = 'pointer';
      autoInvertButton.style.transition = 'background-color 0.2s';
      autoInvertButton.style.display = 'flex';
      autoInvertButton.style.alignItems = 'center';
      autoInvertButton.style.justifyContent = 'center';
      if (settings.enableCompact) {
        autoInvertButton.style.width = '24px';  // Fixed width in compact mode
        autoInvertButton.style.height = '24px';  // Fixed height in compact mode
        autoInvertButton.style.minWidth = '24px';  // Ensure minimum width
      }

      autoInvertButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        const result = await calculateAutoAdjust(img);

        // Update how we find the sliders
        const wrapper = img.parentElement;
        if (!wrapper) return;

        const sliders = wrapper.querySelectorAll('input[type="range"]');

        const invertSlider = sliders[0];
        const hueSlider = sliders[1];

        if (result.skipEffects) {
          if (invertSlider) (invertSlider as HTMLInputElement).value = '0';
          if (hueSlider) (hueSlider as HTMLInputElement).value = '0';
          img.style.filter = '';
        } else {
          if (invertSlider) (invertSlider as HTMLInputElement).value = result.invertValue.toString();
          if (hueSlider) (hueSlider as HTMLInputElement).value = '180';
          applyImageFilter(img, result.invertValue.toString(), '180');
        }
      });

      autoInvertButton.addEventListener('mouseenter', () => {
        autoInvertButton.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
      });
      autoInvertButton.addEventListener('mouseleave', () => {
        autoInvertButton.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
      });

      return autoInvertButton;
    }

    // Helper function to determine if images are in similar contexts
    function isSimilarImage(sourceImg: HTMLImageElement, targetImg: HTMLImageElement): boolean {
      // Check if images are in the same context
      const isInArticle = (img: HTMLImageElement): boolean => {
        return !!img.closest('article') ||
          !!img.closest('[role="article"]') ||
          !!img.closest('.post') ||
          !!img.closest('.article');
      };

      // Check if image is likely to be an icon
      const isLikelyIcon = (img: HTMLImageElement): boolean => {
        const size = Math.max(img.width, img.height);
        return size <= 48 || // Small images are likely icons
          img.closest('nav') !== null || // Images in navigation
          img.closest('header') !== null || // Images in header
          img.closest('footer') !== null || // Images in footer
          img.closest('.social') !== null || // Social media links
          img.src.toLowerCase().includes('icon') || // URL contains 'icon'
          img.src.toLowerCase().includes('logo'); // URL contains 'logo'
      };

      // Compare contexts
      const sourceInArticle = isInArticle(sourceImg);
      const targetInArticle = isInArticle(targetImg);
      const sourceIsIcon = isLikelyIcon(sourceImg);
      const targetIsIcon = isLikelyIcon(targetImg);

      // Images are similar if they're both in articles (or both not in articles)
      // and neither is an icon
      return sourceInArticle === targetInArticle && !sourceIsIcon && !targetIsIcon;
    }

    function createSimilarButton(img: HTMLImageElement): HTMLButtonElement | null {
      if (!settings.enableSimilar) return null;

      const applyToSimilarButton = document.createElement('button');
      applyToSimilarButton.textContent = settings.enableCompact ? '✨' : '✨ Apply to similar';
      applyToSimilarButton.title = 'Apply to similar';
      applyToSimilarButton.style.fontSize = '10px';
      applyToSimilarButton.style.padding = settings.enableCompact ? '2px' : '2px 4px';
      applyToSimilarButton.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
      applyToSimilarButton.style.border = 'none';
      applyToSimilarButton.style.borderRadius = '4px';
      applyToSimilarButton.style.color = 'white';
      applyToSimilarButton.style.cursor = 'pointer';
      applyToSimilarButton.style.transition = 'background-color 0.2s';
      applyToSimilarButton.style.display = 'flex';
      applyToSimilarButton.style.alignItems = 'center';
      applyToSimilarButton.style.justifyContent = 'center';
      if (settings.enableCompact) {
        applyToSimilarButton.style.width = '24px';  // Fixed width in compact mode
        applyToSimilarButton.style.height = '24px';  // Fixed height in compact mode
        applyToSimilarButton.style.minWidth = '24px';  // Ensure minimum width
      }

      applyToSimilarButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        // Get current filter values from the source image's sliders
        const wrapper = img.parentElement;
        const sliders = wrapper?.querySelectorAll('input[type="range"]');
        const invertSlider = sliders?.[0];
        const hueSlider = sliders?.[1];

        if (!invertSlider || !hueSlider) return;

        const invertValue = (invertSlider as HTMLInputElement).value;
        const hueValue = (hueSlider as HTMLInputElement).value;

        // Find all images and apply filter to similar ones
        const images = document.querySelectorAll('img');
        for (const targetImg of images) {
          if (targetImg !== img && isSimilarImage(img, targetImg as HTMLImageElement)) {
            const result = await calculateAutoAdjust(targetImg as HTMLImageElement);

            // Only apply if the target image isn't too dark
            if (!result.skipEffects) {
              applyImageFilter(targetImg as HTMLImageElement, invertValue, hueValue);
            }
          }
        }
      });

      applyToSimilarButton.addEventListener('mouseenter', () => {
        applyToSimilarButton.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
      });
      applyToSimilarButton.addEventListener('mouseleave', () => {
        applyToSimilarButton.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
      });

      return applyToSimilarButton;
    }

    function createResetButton(img: HTMLImageElement): HTMLButtonElement | null {
      if (!settings.enableReset) return null;

      const resetButton = document.createElement('button');
      resetButton.textContent = settings.enableCompact ? '↺' : '↺ Reset';
      resetButton.title = 'Reset';
      resetButton.style.fontSize = '10px';
      resetButton.style.padding = settings.enableCompact ? '2px' : '2px 4px';
      resetButton.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
      resetButton.style.border = 'none';
      resetButton.style.borderRadius = '4px';
      resetButton.style.color = 'white';
      resetButton.style.cursor = 'pointer';
      resetButton.style.transition = 'background-color 0.2s';
      resetButton.style.display = 'flex';
      resetButton.style.alignItems = 'center';
      resetButton.style.justifyContent = 'center';
      if (settings.enableCompact) {
        resetButton.style.width = '24px';  // Fixed width in compact mode
        resetButton.style.height = '24px';  // Fixed height in compact mode
        resetButton.style.minWidth = '24px';  // Ensure minimum width
      }

      resetButton.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const wrapper = img.parentElement;
        const sliders = wrapper?.querySelectorAll('input[type="range"]');
        const invertSlider = sliders?.[0];
        const hueSlider = sliders?.[1];

        if (invertSlider) (invertSlider as HTMLInputElement).value = '0';
        if (hueSlider) (hueSlider as HTMLInputElement).value = '0';
        applyImageFilter(img, '0', '0');
      });

      resetButton.addEventListener('mouseenter', () => {
        resetButton.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
      });
      resetButton.addEventListener('mouseleave', () => {
        resetButton.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
      });

      return resetButton;
    }

    // Helper function for applying filters
    function applyImageFilter(targetImg: HTMLImageElement, invertValue: string, hueValue: string) {
      targetImg.style.filter = `invert(${invertValue}) hue-rotate(${hueValue}deg)`;

      // Update sliders to match the applied filter
      const wrapper = targetImg.parentElement;
      if (wrapper?.classList.contains('dark-controls-wrapper')) {
        const invertSlider = wrapper.querySelector('input[type="range"]:first-of-type') as HTMLInputElement;
        const hueSlider = wrapper.querySelector('input[type="range"]:nth-of-type(2)') as HTMLInputElement;

        if (invertSlider) invertSlider.value = invertValue;
        if (hueSlider) hueSlider.value = hueValue;
      }
    }

    // Helper function to determine if a color is dark
    function isDarkColor(color: string): boolean {
      // Parse RGB values
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
      if (!match) return false;

      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);

      // Calculate luminance
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance < 0.5;
    }

    // Add this new helper function to analyze image brightness
    function analyzeImage(img: HTMLImageElement): Promise<number> {
      return new Promise((resolve) => {
        // Create a canvas to analyze the image
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Function to calculate once image is loaded
        const calculate = () => {
          if (!context) {
            resolve(0.5); // Default to middle brightness if we can't analyze
            return;
          }

          // Set canvas size to match image
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;

          // Draw image to canvas
          context.drawImage(img, 0, 0);

          try {
            // Get image data
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            let totalBrightness = 0;
            // Sample every 4th pixel for performance (r,g,b,a = 4 values per pixel)
            for (let i = 0; i < data.length; i += 16) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              // Use perceived brightness formula
              totalBrightness += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            }

            // Average brightness between 0 and 1
            const avgBrightness = totalBrightness / (data.length / 16);
            resolve(avgBrightness);
          } catch (e) {
            // If we can't access image data (CORS), fall back to middle brightness
            resolve(0.5);
          }
        };

        // If image is already loaded, calculate immediately
        if (img.complete) {
          calculate();
        } else {
          // Wait for image to load
          img.onload = calculate;
        }
      });
    }

    // Create an interface for the auto-adjust result
    interface AutoAdjustResult {
      invertValue: number;
      skipEffects: boolean;
    }

    // Update the function to return both values
    async function calculateAutoAdjust(img: HTMLImageElement): Promise<AutoAdjustResult> {
      const getBackgroundColor = (element: Element | null): string => {
        while (element) {
          const bgColor = window.getComputedStyle(element).backgroundColor;
          if (bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
            return bgColor;
          }
          element = element.parentElement;
        }
        return window.getComputedStyle(document.body).backgroundColor;
      };

      const bgColor = getBackgroundColor(img.parentElement);
      const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);

      if (!match) return { invertValue: 0, skipEffects: true };

      const [r, g, b] = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
      const bgBrightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      const imgBrightness = await analyzeImage(img);

      const brightnessDifference = Math.abs(bgBrightness - imgBrightness);
      if (brightnessDifference < 0.3 || imgBrightness < 0.3) {
        return { invertValue: 0, skipEffects: true };
      }

      const invertValue = bgBrightness < 0.5
        ? 1 - bgBrightness * 2
        : (1 - bgBrightness) * 2;

      return {
        invertValue,
        skipEffects: false
      };
    }

    // Optional: Clean up observer when extension is disabled/unloaded
    return () => {
      observer.disconnect();
    };
  }
});
