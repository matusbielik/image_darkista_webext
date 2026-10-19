import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeBrightness, areImagesSimilar, calculateAutoAdjustFromValues,
  getBackgroundColor,
} from './image-analyzer';

const SAMPLE_SIZE = 32;

function image(src: string, width = 100, height = 100, complete = true): HTMLImageElement {
  const value = document.createElement('img'); value.src = src;
  Object.defineProperties(value, {
    complete: { get: () => complete }, naturalWidth: { get: () => width },
    naturalHeight: { get: () => height }, clientWidth: { get: () => width },
    clientHeight: { get: () => height },
  });
  value.width = width; value.height = height; return value;
}

describe('image analyzer', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => vi.restoreAllMocks());

  it('preserves auto thresholds and fallbacks', () => {
    expect(calculateAutoAdjustFromValues('rgb(255, 255, 255)', null))
      .toEqual({ invertValue: 0, skipEffects: true });
    expect(calculateAutoAdjustFromValues('rgb(0, 0, 0)', null))
      .toEqual({ invertValue: 1, skipEffects: false });
    expect(calculateAutoAdjustFromValues('rgb(0, 0, 0)', .29))
      .toEqual({ invertValue: 0, skipEffects: true });
    expect(calculateAutoAdjustFromValues('rgb(0, 0, 0)', .3))
      .toEqual({ invertValue: 1, skipEffects: false });
    expect(calculateAutoAdjustFromValues('invalid', 1))
      .toEqual({ invertValue: 0, skipEffects: true });
  });

  it('walks transparent ancestors and falls back to body', () => {
    document.body.style.backgroundColor = 'rgb(12, 34, 56)';
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.style.backgroundColor = 'transparent'; parent.append(child);
    document.body.append(parent);
    expect(getBackgroundColor(child)).toBe('rgb(12, 34, 56)');
  });

  it('preserves unavailable and CORS canvas fallbacks', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(analyzeBrightness(image('/unreadable.png'))).resolves.toBeNull();
    vi.restoreAllMocks();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => { throw new DOMException('blocked', 'SecurityError'); },
    } as unknown as CanvasRenderingContext2D);
    // The CORS retry is refused by the server.
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValue(new Error('CORS refused'));
    await expect(analyzeBrightness(image('/cors.png'))).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  describe('CORS retry for tainted canvases', () => {
    // Behaves like a real canvas: reading pixels of a cross-origin image throws
    // unless that image was loaded with crossOrigin="anonymous".
    function mockCanvas(): HTMLImageElement[] {
      const drawn: HTMLImageElement[] = [];
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: (source: HTMLImageElement) => {
          drawn.push(source);
        },
        getImageData: () => {
          if (drawn.at(-1)?.crossOrigin !== 'anonymous') {
            throw new DOMException('tainted', 'SecurityError');
          }
          return { data: new Uint8ClampedArray(SAMPLE_SIZE * SAMPLE_SIZE * 4).fill(255) };
        },
      } as unknown as CanvasRenderingContext2D);
      return drawn;
    }

    it('measures a CORS-loaded copy when the original taints the canvas', async () => {
      const drawn = mockCanvas();
      vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
      const original = image('https://cdn.example.com/photo.jpg');

      await expect(analyzeBrightness(original)).resolves.toBeCloseTo(1, 5);

      expect(drawn).toHaveLength(2);
      const copy = drawn[1]!;
      expect(copy).not.toBe(original);
      expect(copy.crossOrigin).toBe('anonymous');
      expect(copy.src).toBe('https://cdn.example.com/photo.jpg');
      expect(original.crossOrigin).toBeNull();
    });

    it('gives up when the CORS copy never loads', async () => {
      vi.useFakeTimers();
      try {
        mockCanvas();
        vi.spyOn(HTMLImageElement.prototype, 'decode').mockReturnValue(new Promise(() => {}));
        const result = analyzeBrightness(image('https://slow.example.com/photo.jpg'));
        await vi.advanceTimersByTimeAsync(3000);
        await expect(result).resolves.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('returns null for unloaded images without touching page handlers', async () => {
    const img = image('/lazy.png', 100, 100, false);
    const onload = () => undefined;
    const onerror = () => undefined;
    img.onload = onload;
    img.onerror = onerror;
    await expect(analyzeBrightness(img)).resolves.toBeNull();
    expect(img.onload).toBe(onload);
    expect(img.onerror).toBe(onerror);
  });

  it('averages luma over a downscaled sample canvas', async () => {
    const drawImage = vi.fn();
    const fill = (r: number, g: number, b: number) => {
      const data = new Uint8ClampedArray(SAMPLE_SIZE * SAMPLE_SIZE * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
      return { data };
    };
    let pixels = fill(255, 255, 255);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData: () => pixels,
    } as unknown as CanvasRenderingContext2D);

    const img = image('/big.png', 4000, 3000);
    expect(await analyzeBrightness(img)).toBeCloseTo(1, 5);
    expect(drawImage).toHaveBeenCalledWith(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    pixels = fill(0, 0, 0);
    expect(await analyzeBrightness(img)).toBe(0);
  });

  it('preserves context, nav, asset, and size similarity', () => {
    const article = document.createElement('article');
    const first = image('/photos/a.png'); const second = image('/photos/b.png');
    const outside = image('/photos/c.png'); article.append(first, second);
    const nav = document.createElement('nav'); const navImage = image('/photos/n.png');
    nav.append(navImage); document.body.append(article, outside, nav);
    expect(areImagesSimilar(first, second)).toBe(true);
    expect(areImagesSimilar(first, outside)).toBe(false);
    expect(areImagesSimilar(first, navImage)).toBe(false);
    expect(areImagesSimilar(outside, image('/assets/icon.png'))).toBe(false);
    expect(areImagesSimilar(outside, image('/photos/s.png', 20, 20))).toBe(false);
  });
});
