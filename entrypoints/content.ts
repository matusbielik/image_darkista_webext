import { defineContentScript } from 'wxt/sandbox';
import { browser } from 'wxt/browser';

// Types and Interfaces
interface Settings {
  enableInvert: boolean;
  enableHue: boolean;
  enableAuto: boolean;
  enableSimilar: boolean;
  enableReset: boolean;
  enableCompact: boolean;
}

interface AutoAdjustResult {
  invertValue: number;
  skipEffects: boolean;
}

interface Message {
  action: string;
  [key: string]: any;
}

// Utility class for image analysis
class ImageAnalyzer {
  private static canvas: HTMLCanvasElement = document.createElement('canvas');
  private static context: CanvasRenderingContext2D | null = ImageAnalyzer.canvas.getContext('2d');

  static async analyzeBrightness(img: HTMLImageElement): Promise<number> {
    return new Promise((resolve) => {
      const calculate = () => {
        if (!this.context) {
          resolve(0.5);
          return;
        }

        this.canvas.width = img.naturalWidth || img.width;
        this.canvas.height = img.naturalHeight || img.height;
        this.context.drawImage(img, 0, 0);

        try {
          const imageData = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height);
          const data = imageData.data;
          let totalBrightness = 0;

          for (let i = 0; i < data.length; i += 16) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            totalBrightness += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          }

          resolve(totalBrightness / (data.length / 16));
        } catch (e) {
          resolve(0.5);
        }
      };

      img.complete ? calculate() : img.onload = calculate;
    });
  }

  static getBackgroundColor(element: Element | null): string {
    while (element) {
      const bgColor = window.getComputedStyle(element).backgroundColor;
      if (bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
        return bgColor;
      }
      element = element.parentElement;
    }
    return window.getComputedStyle(document.body).backgroundColor;
  }
}

// UI Component base class
abstract class UIComponent {
  protected settings: Settings;
  protected img: HTMLImageElement;

  constructor(img: HTMLImageElement, settings: Settings) {
    this.img = img;
    this.settings = settings;
  }

  protected createBaseButton(text: string, title: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = this.settings.enableCompact ? text.split(' ')[0] : text;
    button.title = title;
    button.style.fontSize = '10px';
    button.style.padding = this.settings.enableCompact ? '2px' : '2px 4px';
    button.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.color = 'white';
    button.style.cursor = 'pointer';
    button.style.transition = 'background-color 0.2s';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';

    if (this.settings.enableCompact) {
      button.style.width = '24px';
      button.style.height = '24px';
      button.style.minWidth = '24px';
    }

    this.addButtonHoverEffects(button);
    return button;
  }

  private addButtonHoverEffects(button: HTMLButtonElement): void {
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    });
  }

  abstract render(): HTMLElement | null;
}

// Slider Components
class SliderComponent extends UIComponent {
  private readonly type: 'invert' | 'hue';
  private readonly config: {
    label: string;
    min: string;
    max: string;
    step: string;
    defaultValue: string;
  };

  constructor(img: HTMLImageElement, settings: Settings, type: 'invert' | 'hue') {
    super(img, settings);
    this.type = type;
    this.config = type === 'invert' ? {
      label: '🔆',
      min: '0',
      max: '1',
      step: '0.1',
      defaultValue: '0'
    } : {
      label: '🎨',
      min: '0',
      max: '360',
      step: '10',
      defaultValue: '0'
    };
  }

  render(): HTMLElement | null {
    const settingKey = `enable${this.type.charAt(0).toUpperCase() + this.type.slice(1)}` as keyof Settings;
    if (!this.settings[settingKey]) {
      return null;
    }

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = this.settings.enableCompact ? '2px' : '4px';

    const label = document.createElement('label');
    label.textContent = this.config.label;
    label.style.fontSize = '12px';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = this.config.min;
    slider.max = this.config.max;
    slider.step = this.config.step;
    slider.value = this.config.defaultValue;
    slider.style.width = this.settings.enableCompact ? '40px' : '60px';

    slider.addEventListener('input', this.handleInput.bind(this));

    container.appendChild(label);
    container.appendChild(slider);
    return container;
  }

  private handleInput(e: Event): void {
    e.stopPropagation();
    e.preventDefault();
    const wrapper = this.img.parentElement;
    if (!wrapper) return;

    const sliders = wrapper.querySelectorAll('input[type="range"]');
    const invertValue = (sliders[0] as HTMLInputElement)?.value || '0';
    const hueValue = (sliders[1] as HTMLInputElement)?.value || '0';
    ImageAdjuster.applyImageFilter(this.img, invertValue, hueValue);
  }
}

// Button Components
class ActionButton extends UIComponent {
  private readonly type: 'auto' | 'similar' | 'reset';
  private readonly config: {
    text: string;
    title: string;
    handler: () => Promise<void>;
  };

  constructor(img: HTMLImageElement, settings: Settings, type: 'auto' | 'similar' | 'reset') {
    super(img, settings);
    this.type = type;
    this.config = this.getConfig();
  }

  private getConfig() {
    switch (this.type) {
      case 'auto':
        return {
          text: '🎯 Auto-match',
          title: 'Auto-match',
          handler: this.handleAutoClick.bind(this)
        };
      case 'similar':
        return {
          text: '✨ Apply to similar',
          title: 'Apply to similar',
          handler: this.handleSimilarClick.bind(this)
        };
      case 'reset':
        return {
          text: '↺ Reset',
          title: 'Reset',
          handler: this.handleResetClick.bind(this)
        };
    }
  }

  render(): HTMLButtonElement | null {
    const settingKey = `enable${this.type.charAt(0).toUpperCase() + this.type.slice(1)}` as keyof Settings;
    if (!this.settings[settingKey]) {
      return null;
    }

    const button = this.createBaseButton(this.config.text, this.config.title);
    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await this.config.handler();
    });

    return button;
  }

  private async handleAutoClick(): Promise<void> {
    const result = await ImageAdjuster.calculateAutoAdjust(this.img);
    const wrapper = this.img.parentElement;
    if (!wrapper) return;

    const sliders = wrapper.querySelectorAll('input[type="range"]');
    const invertSlider = sliders[0] as HTMLInputElement;
    const hueSlider = sliders[1] as HTMLInputElement;

    if (result.skipEffects) {
      if (invertSlider) invertSlider.value = '0';
      if (hueSlider) hueSlider.value = '0';
      this.img.style.filter = '';
    } else {
      if (invertSlider) invertSlider.value = result.invertValue.toString();
      if (hueSlider) hueSlider.value = '180';
      ImageAdjuster.applyImageFilter(this.img, result.invertValue.toString(), '180');
    }
  }

  private async handleSimilarClick(): Promise<void> {
    const wrapper = this.img.parentElement;
    const sliders = wrapper?.querySelectorAll('input[type="range"]');
    const invertValue = (sliders?.[0] as HTMLInputElement)?.value || '0';
    const hueValue = (sliders?.[1] as HTMLInputElement)?.value || '0';

    // Get all images
    const images = document.querySelectorAll('img');

    // First, analyze the source image to get its characteristics
    const sourceResult = await ImageAdjuster.calculateAutoAdjust(this.img);
    if (sourceResult.skipEffects) {
      return; // If source image shouldn't be inverted, don't apply to others
    }

    // Apply to similar images
    for (const targetImg of images) {
      if (targetImg !== this.img && ImageAdjuster.isSimilarImage(this.img, targetImg as HTMLImageElement)) {
        const targetResult = await ImageAdjuster.calculateAutoAdjust(targetImg as HTMLImageElement);

        // Only apply if both images have similar characteristics
        if (!targetResult.skipEffects &&
          Math.abs(sourceResult.invertValue - targetResult.invertValue) < 0.3) {
          ImageAdjuster.applyImageFilter(targetImg as HTMLImageElement, invertValue, hueValue);

          // Also update controls if they exist for this image
          const targetWrapper = targetImg.parentElement;
          if (targetWrapper?.classList.contains('dark-controls-wrapper')) {
            const targetSliders = targetWrapper.querySelectorAll('input[type="range"]');
            if (targetSliders[0]) (targetSliders[0] as HTMLInputElement).value = invertValue;
            if (targetSliders[1]) (targetSliders[1] as HTMLInputElement).value = hueValue;
          }
        }
      }
    }
  }

  private async handleResetClick(): Promise<void> {
    const wrapper = this.img.parentElement;
    const sliders = wrapper?.querySelectorAll('input[type="range"]');
    if (sliders?.[0]) (sliders[0] as HTMLInputElement).value = '0';
    if (sliders?.[1]) (sliders[1] as HTMLInputElement).value = '0';
    ImageAdjuster.applyImageFilter(this.img, '0', '0');
  }
}

// Main ImageAdjuster class
class ImageAdjuster {
  private settings: Settings;
  private observer: MutationObserver;
  private scrollTimeout: number | null = null;

  constructor() {
    this.settings = {
      enableInvert: true,
      enableHue: true,
      enableAuto: true,
      enableSimilar: true,
      enableReset: true,
      enableCompact: false
    };
    this.observer = this.createObserver();
  }

  async initialize(): Promise<void> {
    await this.loadSettings();
    this.processExistingImages();
    this.setupObserver();
    this.setupScrollHandler();
    this.setupMessageListener();
  }

  private async loadSettings(): Promise<void> {
    try {
      const result = await browser.storage.local.get('settings');
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  private createObserver(): MutationObserver {
    return new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes') {
          if (mutation.target instanceof HTMLImageElement &&
            mutation.attributeName === 'src') {
            this.addControlsToImage(mutation.target);
          }
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLImageElement) {
              this.addControlsToImage(node);
            }
            if (node instanceof Element) {
              node.querySelectorAll('img').forEach(img => {
                this.addControlsToImage(img as HTMLImageElement);
              });
            }
          });
        }
      });
    });
  }

  private setupObserver(): void {
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  }

  private setupScrollHandler(): void {
    window.addEventListener('scroll', () => {
      if (this.scrollTimeout) {
        window.clearTimeout(this.scrollTimeout);
      }
      this.scrollTimeout = window.setTimeout(() => {
        this.processExistingImages();
      }, 100);
    });
  }

  private setupMessageListener(): void {
    browser.runtime.onMessage.addListener((message: unknown): true => {
      if (typeof message === 'object' && message !== null) {
        const msg = message as Message;
        this.handleMessage(msg);
      }
      return true;
    });
  }

  private handleMessage(msg: Message): void {
    switch (msg.action) {
      case 'updateSettings':
        this.settings = msg.settings;
        this.updateAllControls();
        break;
      case 'applyToAll':
        this.applyToAllImages(msg.invertValue, msg.hueValue);
        break;
      case 'resetAll':
        this.resetAllImages();
        break;
    }
  }

  private processExistingImages(): void {
    document.querySelectorAll('img').forEach(img => {
      this.addControlsToImage(img as HTMLImageElement);
    });
  }

  private addControlsToImage(img: HTMLImageElement): void {
    if (img.hasAttribute('has-dark-controls')) return;
    img.setAttribute('has-dark-controls', 'true');

    const wrapper = this.createWrapper(img);
    const controlContainer = this.createControlContainer(img);

    this.setupImageWrapper(img, wrapper, controlContainer);
  }

  private createWrapper(img: HTMLImageElement): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.classList.add('dark-controls-wrapper');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.style.width = 'auto';
    wrapper.style.height = 'auto';
    wrapper.style.verticalAlign = 'top';
    return wrapper;
  }

  private createControlContainer(img: HTMLImageElement): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'dark-image-controls';
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.right = '0';
    container.style.zIndex = '9999';
    container.style.display = 'none';
    container.style.padding = this.settings.enableCompact ? '4px' : '8px';
    container.style.borderRadius = '8px';
    container.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    container.style.color = 'white';
    container.style.flexDirection = 'column';
    container.style.gap = '4px';
    container.style.pointerEvents = 'auto';

    const mainContainer = document.createElement('div');
    mainContainer.style.display = 'flex';
    mainContainer.style.flexDirection = 'column';
    mainContainer.style.gap = this.settings.enableCompact ? '2px' : '4px';

    // Add sliders
    const slidersContainer = document.createElement('div');
    slidersContainer.style.display = 'flex';
    slidersContainer.style.flexDirection = 'column';
    slidersContainer.style.gap = this.settings.enableCompact ? '2px' : '4px';

    const invertSlider = new SliderComponent(img, this.settings, 'invert').render();
    const hueSlider = new SliderComponent(img, this.settings, 'hue').render();

    if (invertSlider) slidersContainer.appendChild(invertSlider);
    if (hueSlider) slidersContainer.appendChild(hueSlider);

    if (slidersContainer.children.length > 0) {
      mainContainer.appendChild(slidersContainer);
    }

    // Add buttons
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.flexDirection = this.settings.enableCompact ? 'row' : 'column';
    buttonsContainer.style.gap = this.settings.enableCompact ? '2px' : '4px';
    buttonsContainer.style.marginTop = '4px';

    ['auto', 'similar', 'reset'].forEach(type => {
      const button = new ActionButton(img, this.settings, type as 'auto' | 'similar' | 'reset').render();
      if (button) buttonsContainer.appendChild(button);
    });

    if (buttonsContainer.children.length > 0) {
      mainContainer.appendChild(buttonsContainer);
    }

    container.appendChild(mainContainer);
    return container;
  }

  private setupImageWrapper(img: HTMLImageElement, wrapper: HTMLDivElement, controlContainer: HTMLDivElement): void {
    const originalStyles = window.getComputedStyle(img);
    img.style.display = originalStyles.display;
    img.style.width = originalStyles.width;
    img.style.height = originalStyles.height;
    img.style.maxWidth = originalStyles.maxWidth;
    img.style.maxHeight = originalStyles.maxHeight;

    const imgParent = img.parentElement;
    if (imgParent) {
      const imgStyle = window.getComputedStyle(img);
      wrapper.style.margin = imgStyle.margin;
      img.style.margin = '0';

      imgParent.insertBefore(wrapper, img);
      wrapper.appendChild(img);
      wrapper.appendChild(controlContainer);

      this.setupHoverEvents(wrapper);
    }
  }

  private setupHoverEvents(wrapper: HTMLDivElement): void {
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

  private updateAllControls(): void {
    document.querySelectorAll('.dark-controls-wrapper').forEach(wrapper => {
      const img = wrapper.querySelector('img');
      if (img) {
        const originalParent = wrapper.parentElement;
        if (originalParent) {
          wrapper.removeChild(img);
          originalParent.insertBefore(img, wrapper);
          wrapper.remove();
          img.removeAttribute('has-dark-controls');
          this.addControlsToImage(img as HTMLImageElement);
        }
      }
    });
  }

  private applyToAllImages(invertValue: string, hueValue: string): void {
    document.querySelectorAll('img').forEach(img => {
      ImageAdjuster.applyImageFilter(img as HTMLImageElement, invertValue, hueValue);
    });
  }

  private resetAllImages(): void {
    document.querySelectorAll('img').forEach(img => {
      ImageAdjuster.applyImageFilter(img as HTMLImageElement, '0', '0');
    });
  }

  // Static utility methods
  static applyImageFilter(targetImg: HTMLImageElement, invertValue: string, hueValue: string): void {
    targetImg.style.filter = `invert(${invertValue}) hue-rotate(${hueValue}deg)`;

    const wrapper = targetImg.parentElement;
    if (wrapper?.classList.contains('dark-controls-wrapper')) {
      const invertSlider = wrapper.querySelector('input[type="range"]:first-of-type') as HTMLInputElement;
      const hueSlider = wrapper.querySelector('input[type="range"]:nth-of-type(2)') as HTMLInputElement;

      if (invertSlider) invertSlider.value = invertValue;
      if (hueSlider) hueSlider.value = hueValue;
    }
  }

  static async calculateAutoAdjust(img: HTMLImageElement): Promise<AutoAdjustResult> {
    const bgColor = ImageAnalyzer.getBackgroundColor(img.parentElement);
    const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);

    if (!match) return { invertValue: 0, skipEffects: true };

    const [r, g, b] = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    const bgBrightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const imgBrightness = await ImageAnalyzer.analyzeBrightness(img);

    const brightnessDifference = Math.abs(bgBrightness - imgBrightness);
    if (brightnessDifference < 0.3 || imgBrightness < 0.3) {
      return { invertValue: 0, skipEffects: true };
    }

    const invertValue = bgBrightness < 0.5
      ? 1 - bgBrightness * 2
      : (1 - bgBrightness) * 2;

    return { invertValue, skipEffects: false };
  }

  static isSimilarImage(sourceImg: HTMLImageElement, targetImg: HTMLImageElement): boolean {
    const isInArticle = (img: HTMLImageElement): boolean => {
      return !!img.closest('article') ||
        !!img.closest('[role="article"]') ||
        !!img.closest('.post') ||
        !!img.closest('.article');
    };

    const isLikelyIcon = (img: HTMLImageElement): boolean => {
      const size = Math.max(img.width, img.height);
      return size <= 64 ||
        img.closest('nav') !== null ||
        img.closest('header') !== null ||
        img.closest('footer') !== null ||
        img.closest('.social') !== null ||
        img.src.toLowerCase().includes('icon') ||
        img.src.toLowerCase().includes('logo');
    };

    const sourceInArticle = isInArticle(sourceImg);
    const targetInArticle = isInArticle(targetImg);
    const sourceIsIcon = isLikelyIcon(sourceImg);
    const targetIsIcon = isLikelyIcon(targetImg);

    return sourceInArticle === targetInArticle && !sourceIsIcon && !targetIsIcon;
  }

  cleanup(): void {
    this.observer.disconnect();
    if (this.scrollTimeout) {
      window.clearTimeout(this.scrollTimeout);
    }
  }
}

// Export the content script
export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    const adjuster = new ImageAdjuster();
    await adjuster.initialize();
    return () => adjuster.cleanup();
  }
});
