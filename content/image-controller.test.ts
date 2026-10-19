import { browser } from '#imports';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ImageController } from './image-controller';

vi.mock('./image-analyzer', async importOriginal => ({
  ...(await importOriginal<typeof import('./image-analyzer')>()),
  calculateAutoAdjust: vi.fn(async () => ({ invertValue: 1, skipEffects: false })),
}));

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function createImage(
  src: string,
  initial: Rect = { left: 50, top: 30, width: 400, height: 300 },
  parent: HTMLElement = document.body,
) {
  let rect = initial;
  const image = document.createElement('img');
  image.src = src;
  image.width = rect.width;
  image.height = rect.height;
  image.getBoundingClientRect = () => ({
    x: rect.left,
    y: rect.top,
    top: rect.top,
    left: rect.left,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({}),
  });
  parent.append(image);
  return {
    image,
    setRect(next: Rect) {
      rect = next;
    },
  };
}

function hover(target: Element): void {
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

function mouseOut(target: Element, relatedTarget: EventTarget | null): void {
  target.dispatchEvent(
    new MouseEvent('mouseout', { bubbles: true, relatedTarget }),
  );
}

function setSlider(slider: HTMLInputElement, value: string): void {
  slider.value = value;
  slider.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ImageController', () => {
  let root: HTMLDivElement;
  let ac: AbortController;
  let panel: HTMLDivElement;

  const query = <T extends Element>(selector: string): T => {
    const element = panel.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
  };
  const invertSlider = () => query<HTMLInputElement>('[data-type="invert"] input');
  const hueSlider = () => query<HTMLInputElement>('[data-type="hue"] input');
  const button = (type: string) => query<HTMLButtonElement>(
    `.dark-action-button[data-type="${type}"]`,
  );
  const isVisible = () => panel.classList.contains('visible');

  async function start(): Promise<void> {
    const controller = new ImageController(root, ac.signal);
    panel = root.querySelector<HTMLDivElement>('.dark-image-controls')!;
    await controller.init();
  }

  beforeEach(() => {
    fakeBrowser.reset();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
    ac = new AbortController();
    // happy-dom's document.images is not iterable, unlike real browsers.
    Object.defineProperty(document, 'images', {
      configurable: true,
      get: () => Array.from(document.querySelectorAll('img')),
    });
  });

  afterEach(() => {
    ac.abort();
    fakeBrowser.reset();
    document.body.innerHTML = '';
    Reflect.deleteProperty(document, 'images');
  });

  it('shows the panel at the image top-right when hovering an eligible image', async () => {
    const { image } = createImage('/big.png', {
      left: 50, top: 30, width: 400, height: 300,
    });
    const { image: tiny } = createImage('/tiny.png', {
      left: 0, top: 0, width: 10, height: 10,
    });
    await start();
    expect(isVisible()).toBe(false);

    hover(tiny);
    expect(isVisible()).toBe(false);

    // happy-dom reports offsetWidth 0, so the panel's right edge equals the image's.
    hover(image);
    expect(isVisible()).toBe(true);
    expect(panel.style.top).toBe('30px');
    expect(panel.style.left).toBe('450px');
  });

  it('subtracts the panel width and clamps left to zero', async () => {
    const { image } = createImage('/narrow.png', {
      left: 0, top: 5, width: 100, height: 100,
    });
    await start();
    let width = 60;
    Object.defineProperty(panel, 'offsetWidth', { get: () => width });

    hover(image);
    expect(panel.style.left).toBe('40px');

    width = 150;
    hover(image);
    expect(panel.style.left).toBe('0px');
  });

  it('does not show the panel for a hidden image', async () => {
    const { image } = createImage('/hidden.png');
    image.style.visibility = 'hidden';
    await start();

    hover(image);
    expect(isVisible()).toBe(false);
  });

  it('shows controls for an image that was 0x0 at init and loaded later', async () => {
    const { image, setRect } = createImage('/late.png', {
      left: 0, top: 0, width: 0, height: 0,
    });
    await start();

    hover(image);
    expect(isVisible()).toBe(false);

    setRect({ left: 20, top: 40, width: 400, height: 300 });
    hover(image);
    expect(isVisible()).toBe(true);
    expect(panel.style.top).toBe('40px');
    expect(panel.style.left).toBe('420px');
  });

  it('applies slider changes to the current image only and restores per-image values', async () => {
    const { image: first } = createImage('/first.png');
    const { image: second } = createImage('/second.png');
    await start();

    hover(first);
    setSlider(invertSlider(), '0.8');
    setSlider(hueSlider(), '180');
    expect(first.style.filter).toBe('invert(0.8) hue-rotate(180deg)');
    expect(second.style.filter).toBe('');

    hover(second);
    expect(invertSlider().value).toBe('0');
    expect(hueSlider().value).toBe('0');
    expect(second.style.filter).toBe('');

    hover(first);
    expect(invertSlider().value).toBe('0.8');
    expect(hueSlider().value).toBe('180');
  });

  it('keeps the panel when the mouse moves into it and hides it when moving elsewhere', async () => {
    const { image } = createImage('/hover.png');
    await start();

    hover(image);
    mouseOut(image, panel);
    expect(isVisible()).toBe(true);

    mouseOut(image, document.body);
    expect(isVisible()).toBe(false);
  });

  it('hides when leaving the panel to a non-image but not when returning to the image', async () => {
    const { image } = createImage('/panel-leave.png');
    await start();

    hover(image);
    panel.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: image }));
    expect(isVisible()).toBe(true);

    panel.dispatchEvent(
      new MouseEvent('mouseleave', { relatedTarget: document.body }),
    );
    expect(isVisible()).toBe(false);
  });

  it('hides on scroll and on resize', async () => {
    const { image } = createImage('/scroll.png');
    await start();

    hover(image);
    window.dispatchEvent(new Event('scroll'));
    expect(isVisible()).toBe(false);

    hover(image);
    expect(isVisible()).toBe(true);
    window.dispatchEvent(new Event('resize'));
    expect(isVisible()).toBe(false);
  });

  it('keeps the page inline filter when adjusting and resetting', async () => {
    const { image } = createImage('/base-filter.png');
    image.style.filter = 'grayscale(1)';
    await start();

    hover(image);
    setSlider(invertSlider(), '1');
    expect(image.style.filter).toBe('grayscale(1) invert(1) hue-rotate(0deg)');

    button('reset').click();
    expect(image.style.filter).toBe('grayscale(1)');
    expect(invertSlider().value).toBe('0');
  });

  it('keeps the page inline filter through applyToAll and resetAll', async () => {
    const { image } = createImage('/base-filter-bulk.png');
    const { image: tiny } = createImage('/tiny-bulk.png', {
      left: 0, top: 0, width: 10, height: 10,
    });
    image.style.filter = 'grayscale(1)';
    await start();

    await fakeBrowser.runtime.sendMessage({
      action: 'applyToAll', invertValue: '1', hueValue: '180',
    });
    expect(image.style.filter).toBe('grayscale(1) invert(1) hue-rotate(180deg)');
    expect(tiny.style.filter).toBe('');

    await fakeBrowser.runtime.sendMessage({ action: 'resetAll' });
    expect(image.style.filter).toBe('grayscale(1)');
    expect(tiny.style.filter).toBe('');
  });

  it('mirrors bulk values into the sliders of the current image', async () => {
    const { image } = createImage('/mirror.png');
    await start();
    hover(image);

    await fakeBrowser.runtime.sendMessage({
      action: 'applyToAll', invertValue: '0.5', hueValue: '90',
    });
    expect(invertSlider().value).toBe('0.5');
    expect(hueSlider().value).toBe('90');

    await fakeBrowser.runtime.sendMessage({ action: 'resetAll' });
    expect(invertSlider().value).toBe('0');
    expect(hueSlider().value).toBe('0');
  });

  it('merges each partial storage value over defaults', async () => {
    await start();
    const hue = query('[data-type="hue"]');
    const invert = query('[data-type="invert"]');

    await browser.storage.local.set({
      settings: { enableHue: false, enableCompact: true },
    });
    expect(hue.classList.contains('dark-component-hidden')).toBe(true);
    expect(panel.classList.contains('compact')).toBe(true);

    await browser.storage.local.set({ settings: { enableInvert: false } });
    expect(hue.classList.contains('dark-component-hidden')).toBe(false);
    expect(panel.classList.contains('compact')).toBe(false);
    expect(invert.classList.contains('dark-component-hidden')).toBe(true);

    await browser.storage.local.remove('settings');
    expect(invert.classList.contains('dark-component-hidden')).toBe(false);
  });

  it('applies stored settings loaded during init', async () => {
    await browser.storage.local.set({ settings: { enableAuto: false } });
    await start();

    expect(button('auto').classList.contains('dark-component-hidden')).toBe(true);
    expect(button('reset').classList.contains('dark-component-hidden')).toBe(false);
  });

  it('ignores unrelated storage and malformed messages without side effects', async () => {
    const { image } = createImage('/noop.png');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await start();
    hover(image);

    await browser.storage.sync.set({ settings: { enableCompact: true } });
    await browser.storage.local.set({ unrelated: true });
    await fakeBrowser.runtime.sendMessage(null);
    await fakeBrowser.runtime.sendMessage('applyToAll');
    await fakeBrowser.runtime.sendMessage({ action: 'unknown' });
    await fakeBrowser.runtime.sendMessage({
      action: 'applyToAll', invertValue: 1, hueValue: null,
    });

    expect(image.style.filter).toBe('');
    expect(panel.classList.contains('compact')).toBe(false);
    expect(query('[data-type="invert"]').classList.contains('dark-component-hidden'))
      .toBe(false);
    expect(warning).not.toHaveBeenCalled();
  });

  it('removes browser listeners and stops showing the panel after abort', async () => {
    const { image } = createImage('/abort.png');
    await start();
    expect(browser.storage.onChanged.hasListeners()).toBe(true);
    expect(browser.runtime.onMessage.hasListeners()).toBe(true);

    ac.abort();

    expect(browser.storage.onChanged.hasListeners()).toBe(false);
    expect(browser.runtime.onMessage.hasListeners()).toBe(false);
    hover(image);
    expect(isVisible()).toBe(false);
  });

  it('leaves no listeners when aborted while loading settings', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const originalGet = browser.storage.local.get.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'get').mockImplementation(
      async (keys?: unknown) => {
        await gate;
        return originalGet(keys as never);
      },
    );
    const controller = new ImageController(root, ac.signal);
    const pending = controller.init();

    ac.abort();
    release();
    await pending;

    expect(browser.storage.onChanged.hasListeners()).toBe(false);
    expect(browser.runtime.onMessage.hasListeners()).toBe(false);
  });

  it('applies the current slider values to similar images only', async () => {
    const article = document.createElement('article');
    const nav = document.createElement('nav');
    document.body.append(article, nav);
    const { image: source } = createImage('/photos/source.png', undefined, article);
    const { image: sibling } = createImage('/photos/sibling.png', undefined, article);
    const { image: navImage } = createImage('/photos/nav.png', undefined, nav);
    await start();

    hover(source);
    setSlider(invertSlider(), '0.7');
    setSlider(hueSlider(), '120');
    button('similar').click();
    await vi.waitFor(() => {
      expect(sibling.style.filter).toBe('invert(0.7) hue-rotate(120deg)');
    });

    expect(source.style.filter).toBe('invert(0.7) hue-rotate(120deg)');
    expect(navImage.style.filter).toBe('');
  });
});
