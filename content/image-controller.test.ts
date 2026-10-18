import { browser } from '#imports';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { ImageController } from './image-controller';

class IO {
  static all: IO[] = []; observe = vi.fn(); disconnect = vi.fn();
  constructor(readonly callback: IntersectionObserverCallback) { IO.all.push(this); }
}
class MO {
  static all: MO[] = []; observe = vi.fn(); disconnect = vi.fn();
  constructor(readonly callback: MutationCallback) { MO.all.push(this); }
  emit(records: MutationRecord[]) { this.callback(records, this as unknown as MutationObserver); }
}
function fixture(src: string, initialWidth = 100, initialHeight = 100) {
  let width = initialWidth; let height = initialHeight;
  const image = document.createElement('img'); image.src = src;
  Object.defineProperties(image, {
    offsetParent: { get: () => document.body }, clientWidth: { get: () => width },
    clientHeight: { get: () => height },
  });
  image.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0,
    right: width, bottom: height, width, height, toJSON: () => ({}) });
  image.width = width; image.height = height; document.body.append(image);
  return { image, setSize(w: number, h: number) {
    width = w; height = h; image.width = w; image.height = h;
  } };
}
const controls = () => Array.from(
  document.querySelectorAll<HTMLDivElement>('.dark-image-controls'),
);

describe('ImageController', () => {
  beforeEach(() => {
    fakeBrowser.reset(); document.body.innerHTML = ''; IO.all = []; MO.all = [];
    vi.stubGlobal('IntersectionObserver', IO); vi.stubGlobal('MutationObserver', MO);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
  });
  afterEach(() => {
    vi.unstubAllGlobals(); vi.restoreAllMocks(); fakeBrowser.reset();
    document.body.innerHTML = '';
  });
  it('discovers an image only once', async () => {
    const { image } = fixture('/one.png'); const controller = new ImageController();
    await controller.init();
    const rediscovery = [{
      type: 'childList', addedNodes: [image], removedNodes: [],
    } as unknown as MutationRecord];
    MO.all[0].emit(rediscovery);
    MO.all[0].emit(rediscovery);
    expect(controls()).toHaveLength(1);
    expect(IO.all).toHaveLength(1);
    controller.cleanup();
  });
it('isolates sliders and tears down removed image ownership', async () => {
  const first = fixture('/first.png').image;
  const second = fixture('/second.png').image;
  const controller = new ImageController();
  await controller.init();
  const owned = controls()[0];
  const abort = vi.spyOn(AbortController.prototype, 'abort');
  const invert = owned.querySelector<HTMLInputElement>(
    '[data-type="invert"] input',
  );
  const hue = owned.querySelector<HTMLInputElement>(
    '[data-type="hue"] input',
  );
  if (!invert || !hue) throw new Error('Expected sliders');
  invert.value = '.8';
  hue.value = '180';
  invert.dispatchEvent(new Event('input'));
  expect(first.style.filter).toBe('invert(0.8) hue-rotate(180deg)');
  expect(second.style.filter).toBe('');
  expect(owned.hasAttribute('data-image-id')).toBe(false);

  first.remove();
  MO.all[0].emit([{
    type: 'childList', addedNodes: [], removedNodes: [first],
  } as unknown as MutationRecord]);
  owned.classList.remove('visible');
  first.dispatchEvent(new Event('mouseenter'));

  expect(abort).toHaveBeenCalledOnce();
  expect(IO.all[0].disconnect).toHaveBeenCalledOnce();
  expect(owned.isConnected).toBe(false);
  expect(owned.classList.contains('visible')).toBe(false);
  expect(first.hasAttribute('data-has-dark-controls')).toBe(false);
  controller.cleanup();
  expect(IO.all[0].disconnect).toHaveBeenCalledOnce();
});

it('cleans all owned images once and is repeat-safe', async () => {
  const first = fixture('/cleanup-first.png').image;
  const second = fixture('/cleanup-second.png').image;
  const abort = vi.spyOn(AbortController.prototype, 'abort');
  const controller = new ImageController();
  await controller.init();
  const [firstObserver, secondObserver] = IO.all;

  controller.cleanup();

  expect(abort).toHaveBeenCalledTimes(2);
  expect(firstObserver.disconnect).toHaveBeenCalledOnce();
  expect(secondObserver.disconnect).toHaveBeenCalledOnce();
  expect(controls()).toHaveLength(0);
  expect(first.hasAttribute('data-has-dark-controls')).toBe(false);
  expect(second.hasAttribute('data-has-dark-controls')).toBe(false);

  controller.cleanup();
  expect(abort).toHaveBeenCalledTimes(2);
  expect(firstObserver.disconnect).toHaveBeenCalledOnce();
  expect(secondObserver.disconnect).toHaveBeenCalledOnce();
});

it('recreates controls once when a removed image is rediscovered', async () => {
  const { image } = fixture('/rediscovered.png');
  const controller = new ImageController();
  await controller.init();
  const observer = MO.all[0];

  image.remove();
  observer.emit([{
    type: 'childList', addedNodes: [], removedNodes: [image],
  } as unknown as MutationRecord]);
  expect(controls()).toHaveLength(0);

  document.body.append(image);
  const addition = [{
    type: 'childList', addedNodes: [image], removedNodes: [],
  } as unknown as MutationRecord];
  observer.emit(addition);
  observer.emit(addition);

  expect(controls()).toHaveLength(1);
  expect(IO.all).toHaveLength(2);
  controller.cleanup();
});

it('applies and resets typed bulk values', async () => {
  const first = fixture('/bulk-first.png').image;
  const second = fixture('/bulk-second.png').image;
  const controller = new ImageController();
  await controller.init();

  await fakeBrowser.runtime.sendMessage({
    action: 'applyToAll', invertValue: '.8', hueValue: '180',
  });
  expect(first.style.filter).toBe('invert(0.8) hue-rotate(180deg)');
  expect(second.style.filter).toBe('invert(0.8) hue-rotate(180deg)');

  await fakeBrowser.runtime.sendMessage({ action: 'resetAll' });
  expect(first.style.filter).toBe('');
  expect(second.style.filter).toBe('');
  controller.cleanup();
});

it('merges each partial storage value over defaults', async () => {
  fixture('/partial.png');
  const controller = new ImageController();
  await controller.init();
  const container = controls()[0];
  const hue = container.querySelector('[data-type="hue"]');
  const invert = container.querySelector('[data-type="invert"]');

  await browser.storage.local.set({
    settings: { enableHue: false, enableCompact: true },
  });
  expect(hue?.classList.contains('dark-component-hidden')).toBe(true);
  expect(container.classList.contains('compact')).toBe(true);

  await browser.storage.local.set({
    settings: { enableInvert: false },
  });
  expect(hue?.classList.contains('dark-component-hidden')).toBe(false);
  expect(container.classList.contains('compact')).toBe(false);
  expect(invert?.classList.contains('dark-component-hidden')).toBe(true);

  await browser.storage.local.remove('settings');
  expect(invert?.classList.contains('dark-component-hidden')).toBe(false);
  controller.cleanup();
});

it('ignores unrelated storage and malformed commands without side effects', async () => {
  const first = fixture('/noop-first.png').image;
  const second = fixture('/noop-second.png').image;
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const controller = new ImageController();
  await controller.init();

  await browser.storage.sync.set({ settings: { enableCompact: true } });
  await browser.storage.local.set({ unrelated: true });
  await fakeBrowser.runtime.sendMessage(null);
  await fakeBrowser.runtime.sendMessage('applyToAll');
  await fakeBrowser.runtime.sendMessage({ action: 'unknown' });
  await fakeBrowser.runtime.sendMessage({
    action: 'applyToAll', invertValue: 1, hueValue: null,
  });

  const container = controls()[0];
  expect(first.style.filter).toBe('');
  expect(second.style.filter).toBe('');
  expect(container.classList.contains('compact')).toBe(false);
  expect(container.querySelector('[data-type="invert"]')
    ?.classList.contains('dark-component-hidden')).toBe(false);
  expect(warning).not.toHaveBeenCalled();
  controller.cleanup();
});

it('removes both global listener references on cleanup', async () => {
  fixture('/listeners.png');
  const controller = new ImageController();
  await controller.init();
  expect(browser.storage.onChanged.hasListeners()).toBe(true);
  expect(browser.runtime.onMessage.hasListeners()).toBe(true);

  controller.cleanup();

  expect(browser.storage.onChanged.hasListeners()).toBe(false);
  expect(browser.runtime.onMessage.hasListeners()).toBe(false);
});

it('preserves mutation options, dynamic discovery, eligibility, and repeat safety', async () => {
  const controller = new ImageController();
  await Promise.all([controller.init(), controller.init()]); await controller.init();
  expect(MO.all).toHaveLength(1);
  expect(MO.all[0].observe).toHaveBeenCalledOnce();
  expect(MO.all[0].observe).toHaveBeenCalledWith(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['src', 'style', 'class', 'width', 'height'],
  });
  const section = document.createElement('section'); const dynamic = fixture('/dynamic.png');
  dynamic.image.remove(); section.append(dynamic.image); document.body.append(section);
  MO.all[0].emit([{ type: 'childList', addedNodes: [section], removedNodes: [] } as unknown as MutationRecord]);
  expect(controls()).toHaveLength(1);
  const frame = vi.fn((cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal('requestAnimationFrame', frame);
  MO.all[0].emit([{ type: 'attributes', target: dynamic.image, attributeName: 'width' } as unknown as MutationRecord]);
  expect(frame).toHaveBeenCalled();
  dynamic.setSize(10, 10);
  MO.all[0].emit([{ type: 'attributes', target: dynamic.image, attributeName: 'height' } as unknown as MutationRecord]);
  expect(controls()).toHaveLength(0);
  controller.cleanup(); controller.cleanup();
  expect(browser.storage.onChanged.hasListeners()).toBe(false);
  expect(browser.runtime.onMessage.hasListeners()).toBe(false);
});

it('does not leave listeners if cleanup runs during init', async () => {
  fixture('/race.png');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const originalGet = browser.storage.local.get.bind(browser.storage.local);
  vi.spyOn(browser.storage.local, 'get').mockImplementation(async (keys?: unknown) => {
    await gate;
    return originalGet(keys as never);
  });
  const controller = new ImageController();
  const pending = controller.init();
  controller.cleanup();
  release();
  await pending;
  expect(browser.storage.onChanged.hasListeners()).toBe(false);
  expect(browser.runtime.onMessage.hasListeners()).toBe(false);
  expect(MO.all[0].observe).not.toHaveBeenCalled();
  expect(controls()).toHaveLength(0);

  await controller.init();
  expect(browser.storage.onChanged.hasListeners()).toBe(true);
  expect(controls()).toHaveLength(1);
  controller.cleanup();
});
});
