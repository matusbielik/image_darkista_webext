
import { browser } from '#imports';
import { areImagesSimilar, calculateAutoAdjust } from './image-analyzer';
import {
  SETTINGS_STORAGE_KEY,
  loadSettings,
  mergeSettings,
  type Settings,
} from '../shared/settings';
import type { ContentCommand } from '../shared/messages';

const MIN_IMAGE_DIMENSION = 20;
const CONTROLS_Z_INDEX = '2147483647';
const INVERT_DEFAULT_VALUE = '0';
const INVERT_MAX_VALUE = '1';
const INVERT_STEP_VALUE = '0.1';
const HUE_DEFAULT_VALUE = '0';
const HUE_MAX_VALUE = '360';
const HUE_STEP_VALUE = '10';
const AUTO_INVERT_HUE_VALUE = '180';
const CONTROLS_CLASS = 'dark-image-controls';
const HAS_CONTROLS_ATTR = 'data-has-dark-controls';
const VISIBLE_CLASS = 'visible';
const COMPACT_CLASS = 'compact';
const HIDDEN_CLASS = 'dark-component-hidden';

interface ControlledImageElements {
  controlsContainer: HTMLDivElement;
  invertSlider: HTMLInputElement;
  hueSlider: HTMLInputElement;
  autoButton: HTMLButtonElement;
  similarButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  intersectionObserver: IntersectionObserver;
  abortController: AbortController;
}

export class ImageController {
  private settings = mergeSettings();
  private readonly mutationObserver: MutationObserver;
  private readonly controlledImages = new Map<
    HTMLImageElement,
    ControlledImageElements
  >();

  constructor() {
    this.mutationObserver = new MutationObserver(
      records => this.handleMutations(records),
    );
  }

  async init(): Promise<void> {
    this.settings = await loadSettings();
    this.processImages(document.body);
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'style', 'class', 'width', 'height'],
    });
    browser.storage.onChanged.addListener(this.handleStorageChanged);
    browser.runtime.onMessage.addListener(this.handleRuntimeMessage);
  }

  private readonly handleStorageChanged = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ): void => {
    const change = changes[SETTINGS_STORAGE_KEY];
    if (areaName !== 'local' || !change) return;
    this.settings = mergeSettings(
      change.newValue as Partial<Settings> | undefined,
    );
    this.applySettingsToAllControls();
  };

  private readonly handleRuntimeMessage = (message: unknown): void => {
    if (typeof message !== 'object' || message === null) return;
    const value = message as Record<string, unknown>;
    if (
      value.action === 'applyToAll'
      && typeof value.invertValue === 'string'
      && typeof value.hueValue === 'string'
    ) {
      this.handleCommand({
        action: 'applyToAll',
        invertValue: value.invertValue,
        hueValue: value.hueValue,
      });
    } else if (value.action === 'resetAll') {
      this.handleCommand({ action: 'resetAll' });
    }
  };

  private handleCommand(command: ContentCommand): void {
    switch (command.action) {
      case 'applyToAll':
        this.applyToAllImages(command.invertValue, command.hueValue);
        break;
      case 'resetAll':
        this.resetAllImages();
        break;
    }
  }

  private handleMutations(mutations: MutationRecord[]): void {
    let needsPositionUpdate = new Set<HTMLImageElement>();

    for (const mutation of mutations) {

      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) {
            this.processImages(node);
          }
        });
        mutation.removedNodes.forEach(node => {
          if (node instanceof Element) {
            this.cleanupRemovedImages(node);
          }
        });
      } else if (mutation.type === 'attributes') {
        if (mutation.target instanceof HTMLImageElement) {
          const img = mutation.target;
          if (this.controlledImages.has(img)) {
            needsPositionUpdate.add(img);
            if (!this.isEligibleImage(img, true)) {
              console.log("Image became ineligible, removing controls:", img.src);
              this.removeControlsForImage(img);
            }
          } else if (this.isEligibleImage(img)) {
            console.log("Image became eligible, adding controls:", img.src);
            this.addControlsToImage(img);
          }
        }
      }
    }

    needsPositionUpdate.forEach(img => this.updateControlsPosition(img));
  }


  private processImages(rootElement: Element): void {
    const images = rootElement.matches('img') ? [rootElement as HTMLImageElement] : Array.from(rootElement.querySelectorAll('img'));
    images.forEach(img => {
      if (this.isEligibleImage(img)) {
        this.addControlsToImage(img);
      }
    });
  }

  private isEligibleImage(img: HTMLImageElement, checkingControlledImage = false): boolean {
    if (!checkingControlledImage && img.hasAttribute(HAS_CONTROLS_ATTR)) {
      return false;
    }
    const style = window.getComputedStyle(img);
    if (!img.offsetParent || style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    if (img.clientWidth < MIN_IMAGE_DIMENSION || img.clientHeight < MIN_IMAGE_DIMENSION) {
      return false;
    }
    return true;
  }


  private cleanupRemovedImages(rootElement: Element): void {
    const images = rootElement.matches('img') ? [rootElement as HTMLImageElement] : Array.from(rootElement.querySelectorAll('img'));
    images.forEach(img => {
      if (this.controlledImages.has(img)) {
        this.removeControlsForImage(img);
      }
    });
  }

  private addControlsToImage(image: HTMLImageElement): void {
    if (this.controlledImages.has(image) || !this.isEligibleImage(image)) return;
    const abortController = new AbortController();
    const signal = abortController.signal;
    const controlsContainer = this.createControlsContainer(signal);
    const invertSlider = this.addSlider(
      controlsContainer, image, 'invert', '🔆', INVERT_DEFAULT_VALUE,
      INVERT_MAX_VALUE, INVERT_STEP_VALUE, INVERT_DEFAULT_VALUE, signal,
    );
    const hueSlider = this.addSlider(
      controlsContainer, image, 'hue', '🎨', HUE_DEFAULT_VALUE,
      HUE_MAX_VALUE, HUE_STEP_VALUE, HUE_DEFAULT_VALUE, signal,
    );
    const buttons = document.createElement('div');
    buttons.className = 'dark-action-buttons-group';
    const autoButton = this.addButton(
      buttons, 'auto', '🎯', 'Auto', () => this.handleAutoClick(image), signal,
    );
    const similarButton = this.addButton(
      buttons, 'similar', '✨', 'Similar',
      () => this.handleSimilarClick(image), signal,
    );
    const resetButton = this.addButton(
      buttons, 'reset', '↺', 'Reset', () => this.handleResetClick(image), signal,
    );
    controlsContainer.append(buttons);
    const intersectionObserver = new IntersectionObserver(
      entries => this.handleIntersection(entries, image),
      { threshold: 0 },
    );
    this.controlledImages.set(image, {
      controlsContainer,
      invertSlider,
      hueSlider,
      autoButton,
      similarButton,
      resetButton,
      intersectionObserver,
      abortController,
    });
    image.setAttribute(HAS_CONTROLS_ATTR, 'true');
    document.body.append(controlsContainer);
    this.setupHoverEvents(image, controlsContainer, signal);
    intersectionObserver.observe(image);
    this.applySettingsToControls(image);
    this.updateControlsPosition(image, controlsContainer);
  }

  private createControlsContainer(signal: AbortSignal): HTMLDivElement {
    const container = document.createElement('div');
    container.className = CONTROLS_CLASS;
    container.style.zIndex = CONTROLS_Z_INDEX;
    container.addEventListener(
      'click',
      event => event.stopPropagation(),
      { signal },
    );
    return container;
  }

  private addSlider(
    parent: HTMLElement,
    image: HTMLImageElement,
    type: 'invert' | 'hue',
    labelText: string,
    min: string,
    max: string,
    step: string,
    value: string,
    signal: AbortSignal,
  ): HTMLInputElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'dark-slider-component';
    wrapper.dataset.type = type;
    const label = document.createElement('label');
    label.textContent = labelText;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    slider.addEventListener(
      'input',
      () => this.handleSliderInput(image),
      { signal },
    );
    wrapper.append(label, slider);
    parent.append(wrapper);
    return slider;
  }

  private addButton(
    parent: HTMLElement,
    type: 'auto' | 'similar' | 'reset',
    icon: string,
    text: string,
    onClick: () => void,
    signal: AbortSignal,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'dark-action-button';
    button.dataset.type = type;
    button.title = text;
    const iconSpan = document.createElement('span');
    iconSpan.className = 'button-icon';
    iconSpan.textContent = icon;
    const textSpan = document.createElement('span');
    textSpan.className = 'button-text';
    textSpan.textContent = ` ${text}`;
    textSpan.style.marginLeft = '4px';
    button.append(iconSpan, textSpan);
    button.addEventListener('click', event => {
      event.stopPropagation();
      event.preventDefault();
      onClick();
    }, { signal });
    parent.append(button);
    return button;
  }

  private setupHoverEvents(
    image: HTMLImageElement,
    controls: HTMLElement,
    signal: AbortSignal,
  ): void {
    const show = () => {
      this.updateControlsPosition(image, controls);
      controls.classList.add(VISIBLE_CLASS);
    };
    const hide = () => controls.classList.remove(VISIBLE_CLASS);
    image.addEventListener('mouseenter', show, { signal });
    image.addEventListener('mouseleave', hide, { signal });
    controls.addEventListener('mouseenter', show, { signal });
    controls.addEventListener('mouseleave', hide, { signal });
  }

  private removeControlsForImage(image: HTMLImageElement): void {
    const owned = this.controlledImages.get(image);
    if (!owned) return;
    owned.abortController.abort();
    owned.intersectionObserver.disconnect();
    owned.controlsContainer.remove();
    image.removeAttribute(HAS_CONTROLS_ATTR);
    this.controlledImages.delete(image);
  }

  private handleIntersection(entries: IntersectionObserverEntry[], img: HTMLImageElement): void {
    const elements = this.controlledImages.get(img);
    if (!elements) return;

    entries.forEach(entry => {
      if (entry.isIntersecting) {
        this.updateControlsPosition(img, elements.controlsContainer);
      } else {
        elements.controlsContainer.classList.remove(VISIBLE_CLASS);
      }
    });
  }

  private updateControlsPosition(img: HTMLImageElement, controlsContainer?: HTMLElement): void {
    if (!controlsContainer) {
      const elements = this.controlledImages.get(img);
      if (!elements) return;
      controlsContainer = elements.controlsContainer;
    }

    if (!img.isConnected || !this.isEligibleImage(img, true)) {
      this.removeControlsForImage(img);
      return;
    }

    requestAnimationFrame(() => {
      if (!controlsContainer || !controlsContainer.isConnected) return;

      const rect = img.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

      controlsContainer.style.position = 'absolute';
      controlsContainer.style.top = `${rect.top + scrollTop}px`;
      controlsContainer.style.left = `${rect.left + scrollLeft + rect.width - controlsContainer.offsetWidth}px`;

      controlsContainer.style.width = 'auto';
      controlsContainer.style.height = 'auto';

    });
  }


  private applySettingsToAllControls(): void {
    this.controlledImages.forEach((elements, img) => {
      this.applySettingsToControls(img);
    });
  }

  private applySettingsToControls(img: HTMLImageElement): void {
    const elements = this.controlledImages.get(img);
    if (!elements?.controlsContainer) return;

    const container = elements.controlsContainer;
    container.classList.toggle(COMPACT_CLASS, this.settings.enableCompact);

    container.querySelector('.dark-slider-component[data-type="invert"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableInvert);
    container.querySelector('.dark-slider-component[data-type="hue"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableHue);
    container.querySelector('.dark-action-button[data-type="auto"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableAuto);
    container.querySelector('.dark-action-button[data-type="similar"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableSimilar);
    container.querySelector('.dark-action-button[data-type="reset"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableReset);

    container.querySelectorAll('.button-text').forEach(span => {
      (span as HTMLElement).style.display = this.settings.enableCompact ? 'none' : 'inline';
    });
    this.updateControlsPosition(img, container);
  }

  private applyImageFilter(img: HTMLImageElement, invert: string | number, hue: string | number): void {
    const iValue = parseFloat(String(invert));
    const hValue = parseFloat(String(hue));
    if (iValue === 0 && hValue === 0) {
      img.style.filter = '';
    } else {
      img.style.filter = `invert(${iValue}) hue-rotate(${hValue}deg)`;
    }
  }

  private updateSliderValues(img: HTMLImageElement, invert: string, hue: string): void {
    const elements = this.controlledImages.get(img);
    if (!elements) return;
    if (elements.invertSlider) elements.invertSlider.value = invert;
    if (elements.hueSlider) elements.hueSlider.value = hue;
  }


  private handleSliderInput(image: HTMLImageElement): void {
    const owned = this.controlledImages.get(image);
    if (!owned) return;
    this.applyImageFilter(
      image,
      owned.invertSlider.value,
      owned.hueSlider.value,
    );
  }

  private async handleAutoClick(img: HTMLImageElement): Promise<void> {
    console.log("Auto-adjust clicked for:", img.src);
    try {
      const result = await calculateAutoAdjust(img);
      console.log("Auto-adjust result:", result);

      if (result.skipEffects) {
        this.updateSliderValues(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
        this.applyImageFilter(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
        console.log("Auto-adjust: Skipping effects based on analysis.");
      } else {
        const invertValue = result.invertValue.toFixed(1);
        const hueValue = AUTO_INVERT_HUE_VALUE;
        console.log(`Auto-adjust applying: Invert=${invertValue}, Hue=${hueValue}`);
        this.updateSliderValues(img, invertValue, hueValue);
        this.applyImageFilter(img, invertValue, hueValue);
      }
    } catch (error) {
      console.error("Error during handleAutoClick:", error);
    }
  }

  private async handleSimilarClick(sourceImg: HTMLImageElement): Promise<void> {
    console.log("Apply Similar clicked for:", sourceImg.src);
    const sourceElements = this.controlledImages.get(sourceImg);
    if (!sourceElements) return;

    const invertValue = sourceElements.invertSlider?.value ?? INVERT_DEFAULT_VALUE;
    const hueValue = sourceElements.hueSlider?.value ?? HUE_DEFAULT_VALUE;

    let appliedCount = 0;
    console.log("Searching for similar images");
    for (const [targetImg] of this.controlledImages.entries()) {
      if (targetImg === sourceImg) continue;

      const isSimilar = this.isSimilarImage(sourceImg, targetImg);
      console.log(`Comparing to: ${targetImg.src}, Is Similar: ${isSimilar}`);

      if (isSimilar) {
        const targetAdjustResult = await calculateAutoAdjust(targetImg);

        if (targetAdjustResult.skipEffects) {
          console.log(`Skipping application to ${targetImg.src}: Target analysis suggests skipping effects.`);
        } else {
          console.log(`Applying filters to similar image: ${targetImg.src}`);
          this.updateSliderValues(targetImg, invertValue, hueValue);
          this.applyImageFilter(targetImg, invertValue, hueValue);
          appliedCount++;
        }
      }
    }
    console.log(`Apply Similar: Applied filters to ${appliedCount} similar images.`);
  }

  private handleResetClick(img: HTMLImageElement): void {
    console.log("Reset clicked for:", img.src);
    this.updateSliderValues(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
    this.applyImageFilter(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
  }

  private applyToAllImages(invertValue: string, hueValue: string): void {
    console.log(`Applying to all: Invert=${invertValue}, Hue=${hueValue}`);
    console.log("Images in map for Apply All:", Array.from(this.controlledImages.keys()).map(img => img.src));
    this.controlledImages.forEach((elements, img) => {
      this.updateSliderValues(img, invertValue, hueValue);
      this.applyImageFilter(img, invertValue, hueValue);
    });
  }

  private resetAllImages(): void {
    console.log("Resetting all images");
    console.log("Images in map for Reset All:", Array.from(this.controlledImages.keys()).map(img => img.src));
    this.controlledImages.forEach((elements, img) => {
      this.updateSliderValues(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
      this.applyImageFilter(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
    });
  }

  private isSimilarImage(
    sourceImage: HTMLImageElement,
    targetImage: HTMLImageElement,
  ): boolean {
    return areImagesSimilar(sourceImage, targetImage);
  }

  cleanup(): void {
    this.mutationObserver.disconnect();
    browser.storage.onChanged.removeListener(this.handleStorageChanged);
    browser.runtime.onMessage.removeListener(this.handleRuntimeMessage);
    for (const image of this.controlledImages.keys()) {
      this.removeControlsForImage(image);
    }
  }
}