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
});
