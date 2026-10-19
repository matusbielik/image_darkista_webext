# Image Darkista Web Extension

Image Darkista adds per-image invert and hue controls for pages used with dark-mode extensions such as Dark Reader. It is a WXT extension: Manifest V3 for Chrome, Manifest V2 for Firefox (WXT's Firefox default; host permissions stay granted at install).

## Features

Hover an image to get a small controls panel:

- **Invert** (0–1) and **Hue** (0–360°) sliders. `invert(1) hue-rotate(180deg)` darkens an image while keeping its colors.
- **Auto**: inverts when the background is dark and the image is not. Cross-origin images are re-requested with CORS; if the server refuses, Auto decides from the background alone.
- **Similar**: applies the current values to similar images on the page (same article/navigation context).
- **Reset**: restores the image, including any filter the page itself had set.

The popup toggles which controls are shown, switches compact mode, and applies or resets values for every image on the active tab.

## Architecture

- `entrypoints/popup/main.ts` persists shared settings and sends active-tab bulk commands.
- `entrypoints/content.ts` mounts a shadow-root UI and starts one `ImageController` bound to the content-script `ctx.signal`.
- `content/image-controller.ts` owns one shared controls panel that follows the hovered image; per-image values live in a `WeakMap`. No DOM observers; listeners are torn down by the abort signal.
- `content/image-analyzer.ts` contains plain image-analysis decisions.
- `shared/settings.ts` and `shared/messages.ts` define persisted and runtime contracts.

There is no background worker. Settings synchronize through `browser.storage.onChanged`; bulk apply/reset remain active-tab commands.

## Development and verification

```sh
pnpm install
pnpm dev
pnpm dev:firefox
pnpm test
pnpm compile
pnpm build
pnpm build:firefox
```

Chrome output is under `.output/chrome-mv3/`; Firefox output is under `.output/firefox-mv2/`.

To try it in a Chromium browser (Chrome, Brave), open `chrome://extensions`, enable Developer mode, and choose **Load unpacked** with `.output/chrome-mv3` (or `.output/chrome-mv3-dev` while `pnpm dev` runs).
