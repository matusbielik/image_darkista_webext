# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Image Darkista is a personal-use browser extension that inverts images while preserving hue (`invert(1) hue-rotate(180deg)`), meant to run alongside Dark Reader. Primary browser: Brave (Chromium). Firefox builds work but are low priority.

Stack: WXT 0.21, TypeScript 7, pnpm, Vitest 4 + happy-dom. Manifest V3 for Chromium, MV2 for Firefox (WXT default).

## Commands

```bash
pnpm install
pnpm dev               # Chromium dev build in .output/chrome-mv3-dev (load unpacked manually)
pnpm dev:firefox
pnpm build             # .output/chrome-mv3
pnpm build:firefox     # .output/firefox-mv2
pnpm test              # vitest run
pnpm compile           # tsc --noEmit (strict + noUncheckedIndexedAccess)
```

Before calling work done: `pnpm test && pnpm compile && pnpm build`.

## Architecture

There is no background script. Only two entrypoints:

- `entrypoints/content.ts`: mounts a WXT shadow-root UI (`createShadowRootUi`, `cssInjectionMode: 'ui'`) and starts one `ImageController(ui.uiContainer, ctx.signal)`.
- `entrypoints/popup/`: settings checkboxes and the bulk "apply to all" / "reset all" buttons.

Content-side modules:

- `content/image-controller.ts`: **one shared controls panel** per page. It follows the hovered image:
  - Document-level `mouseover`/`mouseout` decide which image is current.
  - Eligibility is checked at hover time: rendered size ≥ 20px and not `visibility: hidden`.
  - The panel is `position: fixed`, placed from `getBoundingClientRect()`, and hides on scroll/resize.
  - Per-image values (`invert`, `hue`, `baseFilter`) live in a `WeakMap`. `setValues()` is the single place that writes `img.style.filter`; it composes on top of the page's own inline filter, captured on first touch.
  - Bulk actions and Similar iterate `document.images` at click time.
  - No MutationObserver or IntersectionObserver. All listeners are registered with the abort signal; there is no `cleanup()` method.
- `content/image-analyzer.ts`: plain functions.
  - `analyzeBrightness`: samples a 32×32 downscaled canvas. It returns `null` for images that aren't loaded yet.
    - If the canvas is tainted (a cross-origin image), it re-requests the image once with `crossOrigin = 'anonymous'`, with a 3s timeout.
    - It returns silently with `null` when the server refuses CORS.
  - `calculateAutoAdjust`: dark background (< 0.4 luma) and an image that isn't dark (≥ 0.3) → invert. If brightness is unknown, it inverts on a dark background.
  - `areImagesSimilar`: the Similar heuristic, based on article/nav context and asset paths.
- `entrypoints/content-styles.css`: panel styles. They load only inside the shadow root.

Shared contracts:

- `shared/settings.ts`: the `Settings` type, `DEFAULT_SETTINGS`, `loadSettings`/`saveSettings`/`mergeSettings`. Stored under `browser.storage.local` key `settings`. Content scripts pick up changes in every tab via `browser.storage.onChanged`; the popup sends no settings message.
- `shared/messages.ts`: `ContentCommand`, which is only `applyToAll` and `resetAll`, sent by the popup to the active tab. Malformed messages are ignored.

`MIN_IMAGE_DIMENSION = 20` is defined in both the analyzer and the controller; keep them in sync.

## Testing

- `fakeBrowser` comes from `wxt/testing/fake-browser`; the Vitest plugin from `wxt/testing/vitest-plugin`.
- Controller tests construct `new ImageController(div, abortController.signal)` with a plain `<div>` root and stubbed `getBoundingClientRect`, then dispatch bubbling mouse events.
- happy-dom quirks:
  - `document.images` is not iterable; the tests override it with `querySelectorAll('img')`.
  - `offsetWidth` is 0.
  - There is no layout, so positioning needs manual testing.
- Vitest excludes `.worktrees/**`.

## Known limits

- **Dark Reader styles inside our shadow root.** Dark Reader injects its styles into the open shadow root; this only affects how the panel looks.
- **Panel offset.** If a page or Dark Reader's *filter* mode sets `filter`/`transform` on `html`/`body`, `position: fixed` is relative to that element and the panel may be offset.
- **Auto on cross-origin images.** The CORS retry only works when the server sends `Access-Control-Allow-Origin`. Otherwise Auto falls back to the background-only decision. A background-script fetch, which needs a `host_permissions` addition, would cover the rest.
- **Hover-only.** No controls on touch devices or on images covered by transparent overlays.

## Conventions

- Plain, readable TypeScript: one statement per line, no golfing. Minimal abstractions.
- Commits are authored as the git user (Matúš Bielik), with **no** Claude `Co-Authored-By` trailer.
