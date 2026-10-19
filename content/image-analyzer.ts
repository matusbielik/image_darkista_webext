const MIN_IMAGE_DIMENSION = 20;
const DARK_BACKGROUND_THRESHOLD = .4;
const DARK_IMAGE_THRESHOLD = .3;
const SAMPLE_SIZE = 32;
interface AutoAdjustResult { invertValue: number; skipEffects: boolean }

export async function analyzeBrightness(img: HTMLImageElement): Promise<number | null> {
  // Not loaded (yet): report "unavailable" instead of waiting, which would
  // clobber the page's own onload/onerror handlers and could hang forever.
  if (!img.complete || img.naturalWidth === 0) {
    return null;
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }
  try {
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    context.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const data = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!) / 255;
    }
    return total / (SAMPLE_SIZE * SAMPLE_SIZE);
  } catch (error) {
    // Cross-origin images taint the canvas; expected on most sites, so fall back silently.
    if (!(error instanceof DOMException && error.name === 'SecurityError')) {
      console.error(`Error analyzing image brightness: ${img.src}`, error);
    }
    return null;
  }
}

export function getBackgroundColor(start: Element | null): string {
  let element = start;
  while (element) {
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
    if (element.tagName === 'BODY' || element.tagName === 'HTML') break;
    element = element.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)';
}

export function calculateAutoAdjustFromValues(
  backgroundColor: string, imageBrightness: number | null,
): AutoAdjustResult {
  const match = backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  if (!match) return { invertValue: 0, skipEffects: true };
  const brightness = (.299 * +match[1]! + .587 * +match[2]! + .114 * +match[3]!) / 255;
  if (brightness >= DARK_BACKGROUND_THRESHOLD) return { invertValue: 0, skipEffects: true };
  if (imageBrightness === null) return { invertValue: 1, skipEffects: false };
  return imageBrightness < DARK_IMAGE_THRESHOLD
    ? { invertValue: 0, skipEffects: true }
    : { invertValue: 1, skipEffects: false };
}

export async function calculateAutoAdjust(img: HTMLImageElement): Promise<AutoAdjustResult> {
  const color = getBackgroundColor(img.parentElement);
  const first = calculateAutoAdjustFromValues(color, null);
  if (first.skipEffects) return first;
  return calculateAutoAdjustFromValues(color, await analyzeBrightness(img));
}

export function areImagesSimilar(source: HTMLImageElement, target: HTMLImageElement): boolean {
  const inContext = (img: HTMLImageElement) =>
    !!img.closest('article, [role="article"], .post, .entry, .content, main, .prose');
  const standalone = (img: HTMLImageElement) => {
    const size = Math.max(img.width || img.clientWidth, img.height || img.clientHeight);
    const inNav = !!img.closest('nav, header, footer, .sidebar, .aside, .menu');
    const asset = /^\/(img|image|asset)s?\//i.test(new URL(img.src, location.href).pathname);
    return size > MIN_IMAGE_DIMENSION && !inNav && !asset;
  };
  return standalone(source) && standalone(target) && inContext(source) === inContext(target);
}
