# CopyPasta

Free, open-source `Win + V` clipboard history for macOS.

No paywall. No subscription. Just better copy/paste.

## Why CopyPasta

Windows users get great clipboard history out of the box.  
On macOS, most equivalent tools are paid.

CopyPasta exists to fix that:

- Free forever
- Open source (MIT)
- Built for speed and keyboard flow
- Tray-first by default

## What You Get

- `Cmd + Shift + V` clipboard launcher
- Tray + window workflows
- Unlimited history retention (latest first, scroll for older)
- Rich clipboard support:
  - Text
  - HTML / RTF
  - Images
  - Files and folders (Finder copy)
- Fast paste flow with focus restore + retry fallback
- Search, pin, delete, clear-unpinned
- Local-only persistence

## Quick Start

```bash
npm install
npm start
```

## Install via Homebrew Cask

Recommended:

```bash
brew tap wdonofrio/copypasta
brew install --cask copypasta
```

Notes:

- This uses `Casks/copypasta.rb` in this repo.
- It downloads from the latest GitHub Release assets:
  - `CopyPasta-arm64.dmg`
  - `CopyPasta-x64.dmg`

## Install via DMG (Unsigned Fallback)

1. Download the latest `CopyPasta-*.dmg` from GitHub Releases.
2. Open the `.dmg`.
3. Drag `CopyPasta.app` into `Applications`.
4. Launch CopyPasta from `Applications`.
5. If macOS blocks launch, right-click app -> Open once to trust it.
6. Grant Accessibility + Automation permissions when prompted.

## Daily Flow

1. Copy normally (`Cmd + C`).
2. Open CopyPasta (`Cmd + Shift + V`).
3. Pick an item.
4. It pastes back into your original app (if permissions allow), or paste manually with `Cmd + V`.

## Tray Behavior

- Left-click tray item: open window
- Right-click tray item: open tray menu
- Settings lets you choose whether `Cmd + Shift + V` opens window or tray menu

## Permissions (macOS)

For automatic paste (`Cmd+V` simulation), enable:

- Accessibility
- Automation (`System Events`)

You can verify/request these in **Settings** inside the app.

## Data Storage

Clipboard history is stored at:

`~/Library/Application Support/copypasta/clipboard-history.json`

## Development

Run tests:

```bash
npm test
```

Build installer artifacts locally:

```bash
npm run dist:mac
```

Artifacts are written to `release/` (`.dmg` and `.zip`).

## License

MIT. See [LICENSE](./LICENSE).
