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
});
