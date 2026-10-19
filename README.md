# Image Darkista Web Extension

Image Darkista adds per-image invert and hue controls for pages used with dark-mode extensions such as Dark Reader. It is a WXT extension: Manifest V3 for Chrome, Manifest V2 for Firefox (WXT's Firefox default; host permissions stay granted at install).

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
