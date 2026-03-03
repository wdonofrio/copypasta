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

## Install (Non-Technical Users)

Preferred path:

1. Download the latest `CopyPasta-*.dmg` from GitHub Releases.
2. Open the `.dmg`.
3. Drag `CopyPasta.app` into `Applications`.
4. Launch CopyPasta from `Applications`.
5. Grant Accessibility + Automation permissions when prompted.

No terminal required.

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

## GitHub Release Automation

This repo includes a release workflow:

- File: `.github/workflows/release.yml`
- Trigger: push a tag like `v0.1.0`
- Output: macOS `.dmg` + `.zip` uploaded to GitHub Release

Optional signing/notarization is supported when these secrets are set:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `CSC_LINK`
- `CSC_KEY_PASSWORD`

## License

MIT. See [LICENSE](./LICENSE).
