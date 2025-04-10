import { defineContentScript } from 'wxt/sandbox';
import { browser } from 'wxt/browser';
import './content-styles.css'; // Assuming this CSS file exists and is correct

// --- Constants for Configuration & Magic Numbers ---
const MIN_IMAGE_DIMENSION = 20;
const DARK_BACKGROUND_THRESHOLD = 0.4;
const DARK_IMAGE_THRESHOLD = 0.3; // Threshold to consider image itself dark
const DEFAULT_BRIGHTNESS_FALLBACK = 0.5;
const CONTROLS_Z_INDEX = '2147483647';
const INITIALIZATION_DELAY_MS = 250;
const INVERT_DEFAULT_VALUE = '0';
const INVERT_MAX_VALUE = '1';
const INVERT_STEP_VALUE = '0.1';
const HUE_DEFAULT_VALUE = '0';
const HUE_MAX_VALUE = '360';
const HUE_STEP_VALUE = '10';
const AUTO_INVERT_HUE_VALUE = '180'; // Default hue for auto-inversion

// --- Interfaces ---
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

// Map stores the controls container associated with an image
interface ControlledImageElements {
  controlsContainer: HTMLDivElement;
  intersectionObserver: IntersectionObserver; // To track image position/visibility
  hoverAbortController: AbortController; // To clean up hover listeners
  // References to specific controls if needed for updates
  invertSlider?: HTMLInputElement;
  hueSlider?: HTMLInputElement;
  autoButton?: HTMLButtonElement;
  similarButton?: HTMLButtonElement;
  resetButton?: HTMLButtonElement;
}

// --- Message Types ---
interface UpdateSettingsMessage { action: 'updateSettings'; settings: Settings; }
interface ApplyToAllMessage { action: 'applyToAll'; invertValue: string; hueValue: string; }
interface ResetAllMessage { action: 'resetAll'; }
type ContentScriptMessage = UpdateSettingsMessage | ApplyToAllMessage | ResetAllMessage;

// --- Constants ---
// No WRAPPER_CLASS needed now
const CONTROLS_CLASS = 'dark-image-controls';
const HAS_CONTROLS_ATTR = 'data-has-dark-controls';
const VISIBLE_CLASS = 'visible'; // Controls visibility
const COMPACT_CLASS = 'compact';
const HIDDEN_CLASS = 'dark-component-hidden'; // Component visibility within controls

// Default settings
const DEFAULT_SETTINGS: Settings = {
  enableInvert: true,
  enableHue: true,
  enableAuto: true,
  enableSimilar: true,
  enableReset: true,
  enableCompact: false,
};

// --- Image Analyzer (Brightness, Background Color) ---
// (Keeping the analyzer utility class as it's mostly self-contained)
class ImageAnalyzer {
  private static canvas: HTMLCanvasElement = document.createElement('canvas');
  private static context: CanvasRenderingContext2D | null = ImageAnalyzer.canvas.getContext('2d', { willReadFrequently: true }); // Opt-in for performance

  static async analyzeBrightness(img: HTMLImageElement): Promise<number | null> {
    // Ensure the image is loaded before analyzing
    if (!img.complete || img.naturalWidth === 0) {
      await new Promise(resolve => { img.onload = img.onerror = resolve; });
    }
    if (!img.complete || img.naturalWidth === 0 || !this.context) {
      console.warn("Image analysis skipped: Image not loaded or context unavailable.", img.src);
      return null;
    }

    try {
      // Use natural dimensions if available, otherwise client dimensions
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      // Avoid issues with zero-sized canvases
      if (width === 0 || height === 0) return null;

      this.canvas.width = width;
      this.canvas.height = height;
      this.context.drawImage(img, 0, 0, width, height);

      const imageData = this.context.getImageData(0, 0, width, height);
      const data = imageData.data;
      let totalBrightness = 0;
      const pixelCount = data.length / 4;
      const sampleRate = Math.max(1, Math.floor(pixelCount / 1000)); // Sample ~1000 pixels

      let sampledPixels = 0;
      for (let i = 0; i < data.length; i += 4 * sampleRate) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Simple brightness calculation (Luma)
        totalBrightness += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        sampledPixels++;
      }

      return sampledPixels > 0 ? totalBrightness / sampledPixels : null;
    } catch (e) {
      // Log CORS errors specifically if possible
      if (e instanceof DOMException && e.name === 'SecurityError') {
        console.warn(`CORS issue analyzing image: ${img.src}`, e);
      } else {
        console.error(`Error analyzing image brightness: ${img.src}`, e);
      }
      return null;
    }
  }

  static getBackgroundColor(element: Element | null): string {
    while (element) {
      const style = window.getComputedStyle(element);
      const bgColor = style.backgroundColor;
      // Check for transparent or unset background
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
        return bgColor;
      }
      // Stop if we hit the body or html without finding a color
      if (element.tagName === 'BODY' || element.tagName === 'HTML') {
        break;
      }
      element = element.parentElement;
    }
    // Fallback to body background
    return window.getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)'; // Default white
  }

  static async calculateAutoAdjust(img: HTMLImageElement): Promise<AutoAdjustResult> {
    const bgColor = ImageAnalyzer.getBackgroundColor(img.parentElement);
    const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);

    if (!match) {
      console.warn("Could not parse background color for auto-adjust:", bgColor);
      return { invertValue: 0, skipEffects: true };
    }

    const [r, g, b] = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    const bgBrightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // --- Use Constants ---
    // const darkBackgroundThreshold = 0.4; --> Use DARK_BACKGROUND_THRESHOLD
    // const darkImageThreshold = 0.3; // Threshold to consider image itself dark --> Use DARK_IMAGE_THRESHOLD

    // 1. Check background first
    if (bgBrightness >= DARK_BACKGROUND_THRESHOLD) {
      console.log(`Auto-adjust: Light background (${bgBrightness.toFixed(2)}), skipping effects.`);
      return { invertValue: 0, skipEffects: true }; // Skip on light backgrounds
    }

    // 2. Background is dark, now attempt to check image brightness (may cause CORS warning)
    console.log(`Auto-adjust: Dark background (${bgBrightness.toFixed(2)}), checking image brightness...`);
    const imgBrightness = await ImageAnalyzer.analyzeBrightness(img); // Returns number | null

    // --- MODIFIED Logic for null ---
    // 3. Handle analysis failure (null result)
    if (imgBrightness === null) {
      console.log("Auto-adjust: Image brightness analysis failed (e.g., CORS). Defaulting to apply effects on dark background.");
      // Default to inverting on dark backgrounds if image analysis fails
      return { invertValue: 1, skipEffects: false };
    }

    // 4. Analysis succeeded, check if image is also dark
    if (imgBrightness < DARK_IMAGE_THRESHOLD) {
      console.log(`Auto-adjust: Dark background AND dark image (${imgBrightness.toFixed(2)}), skipping effects.`);
      return { invertValue: 0, skipEffects: true }; // Skip dark-on-dark
    } else {
      // Background is dark, image is not dark
      console.log(`Auto-adjust: Dark background, non-dark image (${imgBrightness.toFixed(2)}), applying inversion.`);
      return { invertValue: 1, skipEffects: false }; // Invert light/medium image on dark background
    }
  }
}


// --- Main Controller ---
class ImageController {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private mutationObserver: MutationObserver;
  // Map: Image element -> its controls container and observer
  private imageElementMap = new Map<HTMLImageElement, ControlledImageElements>();
  private controlIdToImageMap = new Map<string, HTMLImageElement>();
  private nextControlId = 0; // Simple unique ID generator

  constructor() {
    this.mutationObserver = new MutationObserver(this.handleMutations.bind(this));
    // Optional: Observe resizes/layout shifts affecting positioning
    // this.resizeObserver = new ResizeObserver(this.handleResizes.bind(this));
  }

  async initialize(): Promise<void> {
    await this.loadSettings();
    this.processImages(document.body); // Initial scan
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'style', 'class', 'width', 'height'] // Observe size changes too
    });
    this.setupMessageListener();
    // Optional: Start observing resizes
    // document.querySelectorAll('img').forEach(img => this.resizeObserver.observe(img));
    console.log("ImageController initialized (Overlay Mode)");
  }

  private async loadSettings(): Promise<void> {
    try {
      const result = await browser.storage.local.get('settings');
      if (result.settings) {
        this.settings = { ...DEFAULT_SETTINGS, ...result.settings };
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  private setupMessageListener(): void {
    browser.runtime.onMessage.addListener((message: unknown): boolean | undefined => {
      if (typeof message === 'object' && message !== null && 'action' in message) {
        this.handleMessage(message as ContentScriptMessage);
        return true; // Indicate potential async response (though not used here)
      }
      console.warn("Received invalid message format:", message);
      return undefined;
    });
  }

  private handleMessage(msg: ContentScriptMessage): void {
    console.log("Handling message:", msg.action, msg);
    switch (msg.action) {
      case 'updateSettings':
        if (JSON.stringify(this.settings) !== JSON.stringify(msg.settings)) {
          this.settings = { ...DEFAULT_SETTINGS, ...msg.settings };
          this.applySettingsToAllControls();
          console.log("Settings updated and UI refreshed.");
        } else {
          console.log("Settings received, but no changes detected.");
        }
        break;
      case 'applyToAll':
        this.applyToAllImages(msg.invertValue, msg.hueValue);
        break;
      case 'resetAll':
        this.resetAllImages();
        break;
    }
  }

  // --- DOM Observation and Processing ---

  private handleMutations(mutations: MutationRecord[]): void {
    let needsPositionUpdate = new Set<HTMLImageElement>();

    for (const mutation of mutations) {
      // console.log(`Mutation type: ${mutation.type}, Target:`, mutation.target); // Keep for debugging if needed

      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) {
            this.processImages(node); // Scan added node and its children
            // If node itself is img, potentially observe resize
            // if (node instanceof HTMLImageElement) this.resizeObserver.observe(node);
          }
        });
        mutation.removedNodes.forEach(node => {
          if (node instanceof Element) {
            this.cleanupRemovedImages(node); // Cleanup controls if node or children are removed
          }
        });
      } else if (mutation.type === 'attributes') {
        if (mutation.target instanceof HTMLImageElement) {
          const img = mutation.target;
          if (this.imageElementMap.has(img)) {
            // If style/class/size changes, mark for position update
            needsPositionUpdate.add(img);
            // Re-check eligibility if attributes change substantially
            if (!this.isEligibleImage(img, true)) {
              console.log("Image became ineligible, removing controls:", img.src);
              this.removeControlsForImage(img);
            }
          } else if (this.isEligibleImage(img)) {
            // If attributes change making it eligible, add controls
            console.log("Image became eligible, adding controls:", img.src);
            this.addControlsToImage(img);
          }
        }
      }
    }

    // Update positions after processing all mutations
    needsPositionUpdate.forEach(img => this.updateControlsPosition(img));
  }

  // Optional: Handle resize observer notifications
  // private handleResizes(entries: ResizeObserverEntry[]): void {
  //     for (const entry of entries) {
  //         if (entry.target instanceof HTMLImageElement && this.imageElementMap.has(entry.target)) {
  //             this.updateControlsPosition(entry.target);
  //         }
  //     }
  // }

  private processImages(rootElement: Element): void {
    const images = rootElement.matches('img') ? [rootElement as HTMLImageElement] : Array.from(rootElement.querySelectorAll('img'));
    images.forEach(img => {
      if (this.isEligibleImage(img)) {
        // console.log("Image IS eligible:", img.src); // Keep for debug
        this.addControlsToImage(img);
      }
    });
  }

  // Modified eligibility check - doesn't need wrapper checks
  private isEligibleImage(img: HTMLImageElement, checkingControlledImage = false): boolean {
    if (!checkingControlledImage && img.hasAttribute(HAS_CONTROLS_ATTR)) {
      return false;
    }
    const style = window.getComputedStyle(img);
    if (!img.offsetParent || style.display === 'none' || style.visibility === 'hidden') {
      // console.log(`Elig Check FAIL (Hidden/No OffsetParent): ${img.src}`);
      return false;
    }
    // Use clientWidth/Height which reflect actual rendered size
    if (img.clientWidth < MIN_IMAGE_DIMENSION || img.clientHeight < MIN_IMAGE_DIMENSION) {
      // console.log(`Elig Check FAIL (Too Small: ${img.clientWidth}x${img.clientHeight}): ${img.src}`);
      return false;
    }
    // Consider adding check for specific site elements if needed
    // if (img.closest('.no-adjust')) return false;
    return true;
  }


  private cleanupRemovedImages(rootElement: Element): void {
    const images = rootElement.matches('img') ? [rootElement as HTMLImageElement] : Array.from(rootElement.querySelectorAll('img'));
    images.forEach(img => {
      if (this.imageElementMap.has(img)) {
        this.removeControlsForImage(img);
      }
    });
  }

  // --- Control Creation and Management (Overlay Method) ---

  private addControlsToImage(img: HTMLImageElement): void {
    if (this.imageElementMap.has(img)) return;

    console.log("Adding controls (Overlay Mode) for:", img.src);
    img.setAttribute(HAS_CONTROLS_ATTR, 'true');

    const controlId = `dark-controls-${this.nextControlId++}`;
    const controlsContainer = this.createControlsContainer();
    controlsContainer.dataset.imageId = controlId;

    const intersectionObserver = new IntersectionObserver(
      (entries) => this.handleIntersection(entries, img),
      { threshold: 0 }
    );

    const hoverAbortController = new AbortController();

    const controlledElements: ControlledImageElements = {
      controlsContainer,
      intersectionObserver,
      hoverAbortController
    };

    // Add sliders directly to the main container
    controlledElements.invertSlider = this.addSlider(controlsContainer, 'invert', '🔆', INVERT_DEFAULT_VALUE, INVERT_MAX_VALUE, INVERT_STEP_VALUE, INVERT_DEFAULT_VALUE);
    controlledElements.hueSlider = this.addSlider(controlsContainer, 'hue', '🎨', HUE_DEFAULT_VALUE, HUE_MAX_VALUE, HUE_STEP_VALUE, HUE_DEFAULT_VALUE);

    // --- NEW: Create a container specifically for action buttons ---
    const actionButtonsGroup = document.createElement('div');
    actionButtonsGroup.className = 'dark-action-buttons-group'; // Add class for CSS targeting

    // Add buttons to the new group container
    controlledElements.autoButton = this.addButton(actionButtonsGroup, 'auto', '🎯', 'Auto', this.handleAutoClick.bind(this, img));
    controlledElements.similarButton = this.addButton(actionButtonsGroup, 'similar', '✨', 'Similar', this.handleSimilarClick.bind(this, img));
    controlledElements.resetButton = this.addButton(actionButtonsGroup, 'reset', '↺', 'Reset', this.handleResetClick.bind(this, img));

    // Append the button group to the main controls container
    controlsContainer.appendChild(actionButtonsGroup);

    this.controlIdToImageMap.set(controlId, img);
    document.body.appendChild(controlsContainer);
    this.updateControlsPosition(img, controlsContainer);
    intersectionObserver.observe(img);
    this.setupHoverEvents(img, controlsContainer, hoverAbortController.signal);

    this.imageElementMap.set(img, controlledElements);
    this.applySettingsToControls(img);
  }

  // Create controls container - positioned absolutely by CSS
  private createControlsContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = CONTROLS_CLASS; // CSS sets position: absolute, display: none etc.
    container.style.zIndex = CONTROLS_Z_INDEX; // Max z-index attempt
    // Prevent clicks inside controls from propagating
    container.addEventListener('click', e => e.stopPropagation());
    return container;
  }

  // --- addSlider, addButton remain the same as previous version ---
  private addSlider(parent: HTMLElement, type: 'invert' | 'hue', labelText: string, min: string, max: string, step: string, defaultValue: string): HTMLInputElement | undefined {
    const container = document.createElement('div');
    container.className = 'dark-slider-component'; // CSS handles layout
    container.dataset.type = type; // For applying settings

    const label = document.createElement('label');
    label.textContent = labelText;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = defaultValue;
    slider.addEventListener('input', (e) => this.handleSliderInput(e.target as HTMLInputElement));

    container.appendChild(label);
    container.appendChild(slider);
    parent.appendChild(container);
    return slider;
  }

  private addButton(parent: HTMLElement, type: 'auto' | 'similar' | 'reset', icon: string, text: string, clickHandler: (e: MouseEvent) => void): HTMLButtonElement | undefined {
    const button = document.createElement('button');
    button.className = 'dark-action-button'; // CSS handles layout/styling
    button.dataset.type = type; // For applying settings

    const iconSpan = document.createElement('span');
    iconSpan.className = 'button-icon';
    iconSpan.textContent = icon;

    const textSpan = document.createElement('span');
    textSpan.className = 'button-text';
    textSpan.textContent = ` ${text}`;
    textSpan.style.marginLeft = '4px';

    button.appendChild(iconSpan);
    button.appendChild(textSpan);
    button.title = text; // Tooltip

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      clickHandler(e);
    });

    parent.appendChild(button);
    return button;
  }

  // Attach hover to the IMAGE now
  private setupHoverEvents(img: HTMLImageElement, controls: HTMLElement, signal: AbortSignal): void {
    const show = () => {
      // Remove timeout logic
      this.updateControlsPosition(img, controls);
      controls.classList.add(VISIBLE_CLASS);
    };
    const hide = () => {
      // Remove timeout logic
      controls.classList.remove(VISIBLE_CLASS);
    };

    img.addEventListener('mouseenter', show, { signal });
    img.addEventListener('mouseleave', hide, { signal });
    // Keep controls visible if mouse moves directly onto them
    controls.addEventListener('mouseenter', show, { signal });
    controls.addEventListener('mouseleave', hide, { signal });
  }

  private removeControlsForImage(img: HTMLImageElement): void {
    const elements = this.imageElementMap.get(img);
    if (elements) {
      console.log("Removing controls (Overlay Mode) for:", img.src);
      elements.intersectionObserver.disconnect();

      // Find the ID and remove from the lookup map
      const controlId = elements.controlsContainer.dataset.imageId;
      if (controlId) {
        this.controlIdToImageMap.delete(controlId);
      }

      elements.controlsContainer.remove();
      this.imageElementMap.delete(img);
      img.removeAttribute(HAS_CONTROLS_ATTR);

      // Clean up hover listeners (important!)
      // We need a way to remove the specific listeners added in setupHoverEvents.
      // Storing them might be necessary, or using AbortSignal if supported.
      // For now, this might leave dangling listeners if the image element persists.
    }
  }

  // --- Positioning Logic ---

  private handleIntersection(entries: IntersectionObserverEntry[], img: HTMLImageElement): void {
    const elements = this.imageElementMap.get(img);
    if (!elements) return;

    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Image is visible, ensure position is updated
        // console.log("Image intersecting, updating position:", img.src); // Debug
        this.updateControlsPosition(img, elements.controlsContainer);
        // Make controls visible if needed (e.g., if hover is active)
        // elements.controlsContainer.style.opacity = '1'; // Or similar logic
      } else {
        // Image is not visible, hide controls
        // console.log("Image not intersecting, hiding controls:", img.src); // Debug
        elements.controlsContainer.classList.remove(VISIBLE_CLASS);
        // Optionally hide completely: elements.controlsContainer.style.opacity = '0';
      }
    });
  }

  // Modified positioning logic
  private updateControlsPosition(img: HTMLImageElement, controlsContainer?: HTMLElement): void {
    if (!controlsContainer) {
      const elements = this.imageElementMap.get(img);
      if (!elements) return;
      controlsContainer = elements.controlsContainer;
    }

    if (!img.isConnected || !this.isEligibleImage(img, true)) {
      this.removeControlsForImage(img);
      return;
    }

    // Use requestAnimationFrame for smoother updates and ensure layout is calculated
    requestAnimationFrame(() => {
      // Re-fetch container in case it was removed between frame requests
      if (!controlsContainer || !controlsContainer.isConnected) return;

      const rect = img.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

      // Position controls at top-right corner of the image
      controlsContainer.style.position = 'absolute';
      controlsContainer.style.top = `${rect.top + scrollTop}px`;
      // Calculate left based on image right edge minus controls width
      controlsContainer.style.left = `${rect.left + scrollLeft + rect.width - controlsContainer.offsetWidth}px`;
      // controlsContainer.style.left = `${rect.left + scrollLeft}px`; // Position top-left

      // Auto width/height (let content decide)
      controlsContainer.style.width = 'auto';
      controlsContainer.style.height = 'auto';

      // Optional: Add small offset if needed
      // controlsContainer.style.top = `${rect.top + scrollTop + 2}px`;
      // controlsContainer.style.left = `${rect.left + scrollLeft + 2}px`;
    });
  }

  // --- Applying Settings and Filters (Mostly unchanged logic, different targets) ---

  private applySettingsToAllControls(): void {
    this.imageElementMap.forEach((elements, img) => {
      this.applySettingsToControls(img);
    });
  }

  // Applies current controller settings (visibility, compact mode) to a specific image's controls
  private applySettingsToControls(img: HTMLImageElement): void {
    const elements = this.imageElementMap.get(img);
    if (!elements?.controlsContainer) return;

    const container = elements.controlsContainer;
    container.classList.toggle(COMPACT_CLASS, this.settings.enableCompact);

    // Find controls *within this specific container*
    container.querySelector('.dark-slider-component[data-type="invert"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableInvert);
    container.querySelector('.dark-slider-component[data-type="hue"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableHue);
    container.querySelector('.dark-action-button[data-type="auto"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableAuto);
    container.querySelector('.dark-action-button[data-type="similar"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableSimilar);
    container.querySelector('.dark-action-button[data-type="reset"]')?.classList.toggle(HIDDEN_CLASS, !this.settings.enableReset);

    container.querySelectorAll('.button-text').forEach(span => {
      (span as HTMLElement).style.display = this.settings.enableCompact ? 'none' : 'inline';
    });
    // Re-calculate position after visibility changes might affect size
    this.updateControlsPosition(img, container);
  }

  // applyImageFilter, updateSliderValues, event handlers (handleSliderInput, etc.)
  // remain conceptually similar but operate on the map's elements.
  private applyImageFilter(img: HTMLImageElement, invert: string | number, hue: string | number): void {
    const iValue = parseFloat(String(invert));
    const hValue = parseFloat(String(hue));
    if (iValue === 0 && hValue === 0) {
      img.style.filter = ''; // Clear filter
    } else {
      img.style.filter = `invert(${iValue}) hue-rotate(${hValue}deg)`;
    }
  }

  private updateSliderValues(img: HTMLImageElement, invert: string, hue: string): void {
    const elements = this.imageElementMap.get(img);
    if (!elements) return;
    if (elements.invertSlider) elements.invertSlider.value = invert;
    if (elements.hueSlider) elements.hueSlider.value = hue;
  }

  private handleSliderInput(slider: HTMLInputElement): void {
    const img = this.findAssociatedImage(slider); // Use class method
    if (!img) {
      console.warn("Could not find associated image for slider input", slider);
      return;
    }
    const elements = this.imageElementMap.get(img);
    if (!elements) return;
    const invertValue = elements.invertSlider?.value ?? INVERT_DEFAULT_VALUE;
    const hueValue = elements.hueSlider?.value ?? HUE_DEFAULT_VALUE;
    this.applyImageFilter(img, invertValue, hueValue);
  }

  private async handleAutoClick(img: HTMLImageElement): Promise<void> {
    console.log("Auto-adjust clicked for:", img.src);
    try {
      const result = await ImageAnalyzer.calculateAutoAdjust(img);
      console.log("Auto-adjust result:", result); // Log the result object

      if (result.skipEffects) {
        this.updateSliderValues(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
        this.applyImageFilter(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
        console.log("Auto-adjust: Skipping effects based on analysis.");
      } else {
        const invertValue = result.invertValue.toFixed(1);
        const hueValue = AUTO_INVERT_HUE_VALUE; // Default hue for inversion
        console.log(`Auto-adjust applying: Invert=${invertValue}, Hue=${hueValue}`); // Log values being applied
        this.updateSliderValues(img, invertValue, hueValue);
        this.applyImageFilter(img, invertValue, hueValue);
      }
    } catch (error) {
      console.error("Error during handleAutoClick:", error); // Log any errors during the process
    }
  }

  private async handleSimilarClick(sourceImg: HTMLImageElement): Promise<void> {
    console.log("Apply Similar clicked for:", sourceImg.src);
    const sourceElements = this.imageElementMap.get(sourceImg);
    if (!sourceElements) return;

    const invertValue = sourceElements.invertSlider?.value ?? INVERT_DEFAULT_VALUE;
    const hueValue = sourceElements.hueSlider?.value ?? HUE_DEFAULT_VALUE;

    let appliedCount = 0;
    console.log("Searching for similar images..."); // Log search start
    for (const [targetImg] of this.imageElementMap.entries()) {
      if (targetImg === sourceImg) continue; // Don't apply to self

      const isSimilar = this.isSimilarImage(sourceImg, targetImg);
      console.log(`Comparing to: ${targetImg.src}, Is Similar: ${isSimilar}`); // Log comparison

      if (isSimilar) {
        // >>> Check if the target image itself should have effects skipped <<<
        const targetAdjustResult = await ImageAnalyzer.calculateAutoAdjust(targetImg);

        if (targetAdjustResult.skipEffects) {
          console.log(`Skipping application to ${targetImg.src}: Target analysis suggests skipping effects.`);
        } else {
          // Target is eligible for effects, apply source filters
          console.log(`Applying filters to similar image: ${targetImg.src}`); // Log application
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

  // --- Global Actions (Unchanged logic) ---
  private applyToAllImages(invertValue: string, hueValue: string): void {
    console.log(`Applying to all: Invert=${invertValue}, Hue=${hueValue}`);
    // Log images currently being managed
    console.log("Images in map for Apply All:", Array.from(this.imageElementMap.keys()).map(img => img.src));
    this.imageElementMap.forEach((elements, img) => {
      this.updateSliderValues(img, invertValue, hueValue);
      this.applyImageFilter(img, invertValue, hueValue);
    });
  }

  private resetAllImages(): void {
    console.log("Resetting all images");
    // Log images currently being managed
    console.log("Images in map for Reset All:", Array.from(this.imageElementMap.keys()).map(img => img.src));
    this.imageElementMap.forEach((elements, img) => {
      this.updateSliderValues(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
      this.applyImageFilter(img, INVERT_DEFAULT_VALUE, HUE_DEFAULT_VALUE);
    });
  }

  // --- Heuristics (Unchanged logic) ---
  private isSimilarImage(sourceImg: HTMLImageElement, targetImg: HTMLImageElement): boolean {
    // --- Detailed Logging --- 
    console.log(`--- isSimilarImage Check ---`);
    console.log(`Source: ${sourceImg.src}`);
    console.log(`Target: ${targetImg.src}`);

    const isInContext = (img: HTMLImageElement, label: string): boolean => {
      const result = !!img.closest('article, [role="article"], .post, .entry, .content, main, .prose'); // Added .prose common for markdown content
      console.log(`  ${label} isInContext: ${result} (parent: ${img.parentElement?.tagName}.${img.parentElement?.className})`);
      return result;
    };
    const isLikelyStandalone = (img: HTMLImageElement, label: string): boolean => {
      const size = Math.max(img.width || img.clientWidth, img.height || img.clientHeight);
      const inNav = !!img.closest('nav, header, footer, .sidebar, .aside, .menu');
      const isAssetPath = /^\/(img|image|asset)s?\//i.test(new URL(img.src, location.href).pathname);
      const result = size > MIN_IMAGE_DIMENSION && !inNav && !isAssetPath;
      console.log(`  ${label} isLikelyStandalone: ${result} (size:${size}, inNav:${inNav}, isAssetPath:${isAssetPath})`);
      return result;
    };

    // Basic check: both should be likely standalone images, and either both in specific content areas or both not.
    const sourceStandalone = isLikelyStandalone(sourceImg, 'Source');
    const targetStandalone = isLikelyStandalone(targetImg, 'Target');

    if (!sourceStandalone || !targetStandalone) {
      console.log(`--- isSimilarImage Result: false (Standalone check failed) ---`);
      return false;
    }

    const sourceInContext = isInContext(sourceImg, 'Source');
    const targetInContext = isInContext(targetImg, 'Target');

    const result = sourceInContext === targetInContext;
    console.log(`--- isSimilarImage Result: ${result} (Context check) ---`);
    return result;
  }

  // --- NEW: Helper function moved into class ---
  private findAssociatedImage(controlElement: HTMLElement): HTMLImageElement | null {
    const controlsContainer = controlElement.closest(`.${CONTROLS_CLASS}`);
    if (!controlsContainer) {
      console.warn("Could not find parent controls container for element", controlElement);
      return null;
    }

    const imageId = (controlsContainer as HTMLElement).dataset.imageId;
    if (!imageId) {
      console.warn("Controls container missing data-image-id", controlsContainer);
      return null;
    }

    const img = this.controlIdToImageMap.get(imageId);
    if (!img) {
      console.warn(`Image with ID ${imageId} not found in map.`);
      return null;
    }
    // Optional: Check if image is still connected/valid
    // if (!img.isConnected) return null;

    return img;
  }

  // --- Cleanup ---
  public cleanup(): void {
    console.log("Cleaning up ImageController (Overlay Mode)...");
    this.mutationObserver.disconnect();
    // Optional: Disconnect resize observer
    // this.resizeObserver.disconnect();

    const images = Array.from(this.imageElementMap.keys());
    images.forEach(img => this.removeControlsForImage(img)); // This now removes observer and controls div

    this.imageElementMap.clear();
    this.controlIdToImageMap.clear(); // Clear this map too
    console.log("ImageController cleanup complete.");
  }
}

// --- Script Definition ---
export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'manifest',
  async main(ctx) {
    console.log('Darkista Image Adjuster Content Script - Overlay Mode');
    // Add a delay to allow dynamic content (like Svelte components) to potentially load
    console.log(`Waiting ${INITIALIZATION_DELAY_MS}ms before initializing...`);
    await new Promise(resolve => setTimeout(resolve, INITIALIZATION_DELAY_MS)); // 0.25 second delay

    const controller = new ImageController();
    try {
      await controller.initialize();
      console.log('ImageController Initialized Successfully (Overlay Mode)');
    } catch (error) {
      console.error("Failed to initialize ImageController:", error);
    }

    ctx.onInvalidated(() => {
      controller.cleanup();
      console.log('Darkista Image Adjuster Content Script Cleaned Up (Overlay Mode)');
    });
  }
});
