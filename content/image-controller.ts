import { browser } from '#imports';
import { areImagesSimilar, calculateAutoAdjust } from './image-analyzer';
import type { ContentCommand } from '../shared/messages';
import {
  SETTINGS_STORAGE_KEY,
  loadSettings,
  mergeSettings,
  type Settings,
} from '../shared/settings';

const MIN_IMAGE_DIMENSION = 20;
// The panel may cover at most this share of the image; smaller images (thumbnails)
// get no panel, so it never swallows their clicks.
const MAX_PANEL_COVERAGE = 1 / 3;
const CONTROLS_Z_INDEX = '2147483647';
const INVERT_DEFAULT_VALUE = '0';
const INVERT_MAX_VALUE = '1';
const INVERT_STEP_VALUE = '0.1';
const HUE_DEFAULT_VALUE = '0';
const HUE_MAX_VALUE = '360';
const HUE_STEP_VALUE = '10';
const AUTO_INVERT_HUE_VALUE = '180';
const CONTROLS_CLASS = 'dark-image-controls';
const VISIBLE_CLASS = 'visible';
const COMPACT_CLASS = 'compact';
const HIDDEN_CLASS = 'dark-component-hidden';

interface ImageState {
  invert: string;
  hue: string;
  baseFilter: string;
}

export class ImageController {
  private settings = mergeSettings();
  private readonly panel: HTMLDivElement;
  private readonly invertSlider: HTMLInputElement;
  private readonly hueSlider: HTMLInputElement;
  private readonly state = new WeakMap<HTMLImageElement, ImageState>();
  private current: HTMLImageElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly signal: AbortSignal,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = CONTROLS_CLASS;
    this.panel.style.zIndex = CONTROLS_Z_INDEX;
    this.invertSlider = this.addSlider(
      'invert', '🔆', INVERT_MAX_VALUE, INVERT_STEP_VALUE,
    );
    this.hueSlider = this.addSlider(
      'hue', '🎨', HUE_MAX_VALUE, HUE_STEP_VALUE,
    );
    const buttons = document.createElement('div');
    buttons.className = 'dark-action-buttons-group';
    this.addButton(buttons, 'auto', '🎯', 'Auto', () => this.handleAutoClick());
    this.addButton(
      buttons, 'similar', '✨', 'Similar', () => this.handleSimilarClick(),
    );
    this.addButton(buttons, 'reset', '↺', 'Reset', () => this.handleResetClick());
    this.panel.append(buttons);
    root.append(this.panel);

    const options = { signal };
    this.panel.addEventListener('click', e => e.stopPropagation(), options);
    this.panel.addEventListener('mouseleave', e => {
      if (e.relatedTarget !== this.current) this.hide();
    }, options);
    document.addEventListener('mouseover', this.handleMouseOver, {
      signal,
      passive: true,
    });
    document.addEventListener('mouseout', this.handleMouseOut, options);
    // ponytail: scroll/resize hide the panel instead of tracking the image; reposition-on-scroll if users ask
    window.addEventListener('scroll', () => this.hide(), {
      signal,
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', () => this.hide(), options);
    // ponytail: position: fixed is relative to html/body if the page (or Dark Reader filter mode) sets filter/transform on them, so the panel may be offset there
  }

  async init(): Promise<void> {
    this.settings = await loadSettings();
    if (this.signal.aborted) return;
    browser.storage.onChanged.addListener(this.handleStorageChanged);
    browser.runtime.onMessage.addListener(this.handleRuntimeMessage);
    this.signal.addEventListener('abort', () => {
      browser.storage.onChanged.removeListener(this.handleStorageChanged);
      browser.runtime.onMessage.removeListener(this.handleRuntimeMessage);
    }, { once: true });
    this.applySettings();
  }

  private addSlider(
    type: 'invert' | 'hue',
    labelText: string,
    max: string,
    step: string,
  ): HTMLInputElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'dark-slider-component';
    wrapper.dataset.type = type;
    const label = document.createElement('label');
    label.textContent = labelText;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = max;
    slider.step = step;
    slider.value = '0';
    slider.addEventListener('input', () => this.handleSliderInput(), {
      signal: this.signal,
    });
    wrapper.append(label, slider);
    this.panel.append(wrapper);
    return slider;
  }

  private addButton(
    parent: HTMLElement,
    type: 'auto' | 'similar' | 'reset',
    icon: string,
    text: string,
    onClick: () => void,
  ): void {
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
    button.append(iconSpan, textSpan);
    button.addEventListener('click', event => {
      event.stopPropagation();
      event.preventDefault();
      onClick();
    }, { signal: this.signal });
    parent.append(button);
  }

  private readonly handleMouseOver = (event: MouseEvent): void => {
    const target = event.target;
    if (target instanceof HTMLImageElement && this.isEligible(target)) {
      this.show(target);
    }
  };

  private readonly handleMouseOut = (event: MouseEvent): void => {
    if (event.target !== this.current) return;
    if (this.isInsideOverlay(event.relatedTarget)) return;
    this.hide();
  };

  // Outside the shadow root the panel's contents are retargeted to the host.
  private isInsideOverlay(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    const rootNode = this.root.getRootNode();
    const host = rootNode instanceof ShadowRoot ? rootNode.host : null;
    return target === host || this.root.contains(target);
  }

  private isEligible(img: HTMLImageElement): boolean {
    const rect = img.getBoundingClientRect();
    return rect.width >= MIN_IMAGE_DIMENSION
      && rect.height >= MIN_IMAGE_DIMENSION
      && getComputedStyle(img).visibility !== 'hidden';
  }

  private show(img: HTMLImageElement): void {
    const rect = img.getBoundingClientRect();
    this.panel.classList.add(VISIBLE_CLASS);
    // Measured after un-hiding, so compact mode's smaller panel allows smaller images.
    // ponytail: fixed coverage ratio; per-site override if some galleries need it
    const panelArea = this.panel.offsetWidth * this.panel.offsetHeight;
    if (panelArea > MAX_PANEL_COVERAGE * rect.width * rect.height) {
      this.hide();
      return;
    }
    this.current = img;
    this.syncSliders(img);
    this.panel.style.top = `${rect.top}px`;
    this.panel.style.left = `${Math.max(0, rect.right - this.panel.offsetWidth)}px`;
  }

  private hide(): void {
    this.current = null;
    this.panel.classList.remove(VISIBLE_CLASS);
  }

  private syncSliders(img: HTMLImageElement): void {
    const entry = this.state.get(img);
    this.invertSlider.value = entry?.invert ?? INVERT_DEFAULT_VALUE;
    this.hueSlider.value = entry?.hue ?? HUE_DEFAULT_VALUE;
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
    this.applySettings();
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
        for (const img of document.images) {
          if (this.isEligible(img)) {
            this.setValues(img, command.invertValue, command.hueValue);
          }
        }
        break;
      case 'resetAll':
        for (const img of document.images) {
          if (this.state.has(img)) {
            this.setValues(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
          }
        }
        break;
    }
  }

  private applySettings(): void {
    const s = this.settings;
    this.panel.classList.toggle(COMPACT_CLASS, s.enableCompact);
    const parts: [string, boolean][] = [
      ['.dark-slider-component[data-type="invert"]', s.enableInvert],
      ['.dark-slider-component[data-type="hue"]', s.enableHue],
      ['.dark-action-button[data-type="auto"]', s.enableAuto],
      ['.dark-action-button[data-type="similar"]', s.enableSimilar],
      ['.dark-action-button[data-type="reset"]', s.enableReset],
    ];
    for (const [selector, enabled] of parts) {
      this.panel.querySelector(selector)?.classList.toggle(HIDDEN_CLASS, !enabled);
    }
  }

  // Writes the filter for img and mirrors the values into the sliders if the panel shows img.
  private setValues(img: HTMLImageElement, invert: string, hue: string): void {
    let entry = this.state.get(img);
    if (!entry) {
      // ponytail: base filter captured once on first touch; later page changes to inline filter are overwritten
      entry = { invert, hue, baseFilter: img.style.filter };
      this.state.set(img, entry);
    }
    entry.invert = invert;
    entry.hue = hue;
    const iValue = parseFloat(invert);
    const hValue = parseFloat(hue);
    if (iValue === 0 && hValue === 0) {
      img.style.filter = entry.baseFilter;
    } else {
      img.style.filter = [entry.baseFilter, `invert(${iValue}) hue-rotate(${hValue}deg)`]
        .filter(Boolean)
        .join(' ');
    }
    if (img === this.current) this.syncSliders(img);
  }

  private handleSliderInput(): void {
    if (!this.current) return;
    this.setValues(this.current, this.invertSlider.value, this.hueSlider.value);
  }

  private async handleAutoClick(): Promise<void> {
    const img = this.current;
    if (!img) return;
    try {
      const result = await calculateAutoAdjust(img);
      if (result.skipEffects) {
        this.setValues(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
      } else {
        this.setValues(img, result.invertValue.toFixed(1), AUTO_INVERT_HUE_VALUE);
      }
    } catch (error) {
      console.error('Failed to auto-adjust image:', error);
    }
  }

  private async handleSimilarClick(): Promise<void> {
    const source = this.current;
    if (!source) return;
    const invert = this.invertSlider.value;
    const hue = this.hueSlider.value;
    for (const target of document.images) {
      if (
        target === source
        || !this.isEligible(target)
        || !areImagesSimilar(source, target)
      ) {
        continue;
      }
      const result = await calculateAutoAdjust(target);
      if (!result.skipEffects) this.setValues(target, invert, hue);
    }
  }

  private handleResetClick(): void {
    if (!this.current) return;
    this.setValues(this.current, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
  }
}
