# MD File Preview

A Chrome extension that renders Markdown files beautifully — works with local `file://` paths and Google Drive.

## Features

- Render `.md` and `.markdown` files directly in the browser
- Supports local files (`file://`) and Google Drive
- Toggle between **Preview** and **Source** view
- GitHub-style dark theme
- Supports GitHub Flavored Markdown (GFM): tables, fenced code blocks, bold, lists, links, blockquotes, and more

## Installation

Since this extension is not on the Chrome Web Store, install it manually:

1. Download or clone this repository to your computer
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the folder containing the extension files

The extension icon will appear in your Chrome toolbar.

## Usage

### Local Markdown files

1. Open a `.md` or `.markdown` file in Chrome (drag it into the browser, or press `Ctrl+O` / `Cmd+O`)
2. The extension automatically renders the file as formatted HTML
3. Use the **`</> Source`** button in the toolbar to switch to raw Markdown view
4. Click **`Preview`** to go back to the rendered view

### Google Drive

1. Open [Google Drive](https://drive.google.com) in Chrome
2. Open any `.md` or `.markdown` file stored in your Drive
3. An overlay appears with the rendered Markdown content
4. Use the **`</> Source`** button to toggle raw text view
5. Click **`✕ Close`** or press `Escape` to dismiss the overlay

## Permissions

| Permission | Reason |
|---|---|
| `file://*` | Read and render local Markdown files |
| `https://drive.google.com/*` | Detect and render Markdown files on Google Drive |

## Tech Stack

- Manifest V3
- [marked.js](https://marked.js.org/) for Markdown parsing
