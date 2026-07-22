import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeBrightness, areImagesSimilar, calculateAutoAdjustFromValues,
  getBackgroundColor,
} from './image-analyzer';

function image(src: string, width = 100, height = 100): HTMLImageElement {
  const value = document.createElement('img'); value.src = src;
  Object.defineProperties(value, {
    complete: { get: () => true }, naturalWidth: { get: () => width },
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
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => { throw new DOMException('blocked', 'SecurityError'); },
    } as unknown as CanvasRenderingContext2D);
    await expect(analyzeBrightness(image('/cors.png'))).resolves.toBeNull();
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
