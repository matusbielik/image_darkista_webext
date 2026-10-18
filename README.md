# Image Darkista Web Extension

Image Darkista adds per-image invert and hue controls for pages used with dark-mode extensions such as Dark Reader. It is a WXT extension: Manifest V3 for Chrome, Manifest V2 for Firefox (WXT's Firefox default; host permissions stay granted at install).

## Architecture

- `entrypoints/popup/main.ts` persists shared settings and sends active-tab bulk commands.
- `entrypoints/content.ts` owns WXT lifecycle for one `ImageController`.
- `content/image-controller.ts` owns image DOM state, observers, listeners, rendering, and teardown.
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
