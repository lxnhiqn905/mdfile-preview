(function () {
  const url = window.location.href;

  // ─── Configure marked once ──────────────────────────────────────────
  marked.setOptions({ gfm: true, breaks: false });

  // ─── Route by context ───────────────────────────────────────────────
  if (url.startsWith('file://')) {
    handleLocalFile();
  } else if (location.hostname === 'drive.google.com') {
    handleDriveFile();
  }

  // ════════════════════════════════════════════════════════════════════
  // LOCAL FILE HANDLER
  // ════════════════════════════════════════════════════════════════════
  function handleLocalFile() {
    if (!/\.(md|markdown)(\?.*)?$/i.test(url)) return;

    const pre = document.querySelector('pre');
    const rawText = pre ? pre.textContent : document.body.innerText;
    if (!rawText || !rawText.trim()) return;

    const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);
    renderFullPage(rawText, filename);
  }

  // ════════════════════════════════════════════════════════════════════
  // GOOGLE DRIVE HANDLER
  // ════════════════════════════════════════════════════════════════════
  function handleDriveFile() {
    // State: dismissed is tied to a specific filename.
    // When filename changes (navigation), dismissed auto-resets.
    const state = { filename: '', dismissed: false };

    function tryRender() {
      const filename = getDriveFilename();

      // No MD file detected — nothing to do
      if (!filename || !isMarkdownFilename(filename)) return;

      // Navigated to a different file → reset dismissed flag
      if (filename !== state.filename) {
        state.filename = filename;
        state.dismissed = false;
      }

      // User manually closed this file's overlay — don't reopen
      if (state.dismissed) return;

      // Overlay already showing
      if (document.getElementById('md-drive-overlay')) return;

      const rawText = findDriveTextContent();
      if (!rawText || rawText.length < 20) return;

      showDriveOverlay(rawText, filename, () => {
        // User closed the overlay — mark as dismissed for THIS filename only
        state.dismissed = true;
      });
    }

    // Watch <title> changes specifically — cheapest way to detect SPA navigation
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(debounce(tryRender, 300))
        .observe(titleEl, { childList: true, subtree: true, characterData: true });
    }

    // Broad observer as fallback for content appearing after title settles
    new MutationObserver(debounce(tryRender, 500))
      .observe(document.documentElement, { childList: true, subtree: true });

    // Timed retries for initial load
    [600, 1200, 2500, 5000].forEach(t => setTimeout(tryRender, t));
  }

  /**
   * Try to extract the filename from Google Drive's UI.
   * Drive sets document.title to "filename - Google Drive" when a file is open.
   * It also uses aria-label / data-tooltip attributes on various elements.
   */
  function getDriveFilename() {
    // 1. Page title  →  "README.md - Google Drive"
    const titleMatch = document.title.match(/^(.+?\.(?:md|markdown))\s*[-–|]/i);
    if (titleMatch) return titleMatch[1].trim();

    // 2. aria-label / data-tooltip attributes on any element
    for (const el of document.querySelectorAll('[aria-label],[data-tooltip],[title]')) {
      const text = (
        el.getAttribute('aria-label') ||
        el.getAttribute('data-tooltip') ||
        el.getAttribute('title') || ''
      ).trim();
      if (/\.(?:md|markdown)$/i.test(text)) return text;
    }

    // 3. Any heading / span whose visible text ends in .md
    for (const el of document.querySelectorAll('h1,h2,[role="heading"],span')) {
      const text = (el.textContent || '').trim();
      if (/\.(?:md|markdown)$/.test(text) && text.length < 120) return text;
    }

    return null;
  }

  /**
   * Find the raw text content that Google Drive is showing.
   *
   * Drive renders text-file previews in different ways depending on context:
   *  - A large <pre> inside an overlay/modal
   *  - A scrollable <div> that contains only plain text
   *  - An <iframe> whose body contains a <pre> (handled by all_frames:true in manifest)
   *
   * We score candidates and return the best match.
   */
  function findDriveTextContent() {
    // Case: we are inside an iframe whose body is just a <pre> (Drive text viewer iframe)
    if (window !== window.top) {
      const pre = document.querySelector('body > pre');
      if (pre) {
        const t = pre.textContent.trim();
        if (t.length > 20) return t;
      }
    }

    // Case: main page — look for the best text block
    let best = null;
    let bestScore = 0;

    const candidates = [
      ...document.querySelectorAll('pre'),
      ...document.querySelectorAll('div,section'),
    ];

    for (const el of candidates) {
      // Skip elements with lots of interactive children (nav bars, toolbars)
      if (el.querySelectorAll('button,input,select').length > 3) continue;
      // Skip tiny / invisible elements
      if (el.offsetHeight < 80) continue;

      const text = el.textContent.trim();
      if (text.length < 40) continue;

      const score = markdownScore(text) - Math.min(el.children.length, 40);
      if (score > bestScore) {
        bestScore = score;
        best = text;
      }
    }

    return bestScore >= 4 ? best : null;
  }

  /** Heuristic score: how "markdown-like" does this text look? */
  function markdownScore(text) {
    let s = 0;
    if (/^#{1,6}\s/m.test(text))         s += 4;  // ATX headings
    if (/\*\*[^*\n]{1,80}\*\*/.test(text)) s += 3;  // bold
    if (/^```/m.test(text))               s += 4;  // fenced code
    if (/^\s*[-*+]\s/m.test(text))        s += 2;  // unordered list
    if (/^\s*\d+\.\s/m.test(text))        s += 2;  // ordered list
    if (/\[.+\]\(https?:/.test(text))     s += 2;  // links
    if (/^>\s/m.test(text))               s += 1;  // blockquote
    return s;
  }

  // ════════════════════════════════════════════════════════════════════
  // DRIVE OVERLAY  (fixed overlay on top of the Drive UI)
  // ════════════════════════════════════════════════════════════════════
  function showDriveOverlay(rawText, filename, onClose) {
    // Remove any previous overlay
    document.getElementById('md-drive-overlay')?.remove();

    const html = marked.parse(rawText);

    const overlay = document.createElement('div');
    overlay.id = 'md-drive-overlay';
    overlay.innerHTML = `
      <style>
        /* Scoped reset — prevents Drive's global CSS from leaking in */
        #md-drive-overlay * {
          box-sizing: border-box !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif !important;
        }
        #md-drive-overlay .markdown-body {
          max-width: 860px; margin: 32px auto; padding: 0 24px 80px;
          color: #e6edf3 !important; background: transparent !important;
          font-size: 16px !important; line-height: 1.6 !important;
        }
        #md-drive-overlay .markdown-body h1,
        #md-drive-overlay .markdown-body h2,
        #md-drive-overlay .markdown-body h3,
        #md-drive-overlay .markdown-body h4,
        #md-drive-overlay .markdown-body h5,
        #md-drive-overlay .markdown-body h6 {
          color: #f0f6fc !important; font-weight: 600 !important;
          margin-top: 28px !important; margin-bottom: 12px !important;
        }
        #md-drive-overlay .markdown-body h1 { font-size: 2em !important; padding-bottom: 10px !important; border-bottom: 1px solid #30363d !important; }
        #md-drive-overlay .markdown-body h2 { font-size: 1.5em !important; padding-bottom: 8px !important; border-bottom: 1px solid #30363d !important; }
        #md-drive-overlay .markdown-body h3 { font-size: 1.25em !important; }
        #md-drive-overlay .markdown-body p  { color: #e6edf3 !important; margin-bottom: 16px !important; }
        #md-drive-overlay .markdown-body li { color: #e6edf3 !important; }
        #md-drive-overlay .markdown-body strong { color: #f0f6fc !important; font-weight: 600 !important; }
        #md-drive-overlay .markdown-body a  { color: #58a6ff !important; text-decoration: none !important; }
        #md-drive-overlay .markdown-body code {
          font-family: "SFMono-Regular", Consolas, Menlo, monospace !important;
          font-size: 85% !important; padding: 0.2em 0.4em !important;
          background: #161b22 !important; border: 1px solid #30363d !important;
          border-radius: 6px !important; color: #ff7b72 !important;
        }
        #md-drive-overlay .markdown-body pre {
          padding: 16px !important; overflow: auto !important;
          background: #161b22 !important; border: 1px solid #30363d !important;
          border-radius: 8px !important; margin-bottom: 16px !important;
        }
        #md-drive-overlay .markdown-body pre code {
          padding: 0 !important; background: transparent !important;
          border: none !important; color: #e6edf3 !important; font-size: 13px !important;
        }
        #md-drive-overlay .markdown-body blockquote {
          padding: 8px 16px !important; color: #8b949e !important;
          border-left: 4px solid #3d444d !important; margin: 0 0 16px !important;
        }
        #md-drive-overlay .markdown-body table {
          width: 100% !important; border-collapse: collapse !important;
          display: table !important; margin-bottom: 16px !important;
        }
        #md-drive-overlay .markdown-body th,
        #md-drive-overlay .markdown-body td {
          padding: 6px 13px !important; border: 1px solid #30363d !important;
          color: #e6edf3 !important; background: #0d1117 !important;
          font-size: 14px !important;
        }
        #md-drive-overlay .markdown-body th {
          background: #161b22 !important; color: #f0f6fc !important; font-weight: 600 !important;
        }
        #md-drive-overlay .markdown-body tr:nth-child(even) td {
          background: #161b22 !important;
        }
        #md-drive-overlay .markdown-body hr {
          height: 1px !important; background: #30363d !important;
          border: none !important; margin: 24px 0 !important;
        }
        #md-drive-overlay .markdown-body img { max-width: 100% !important; border-radius: 6px !important; }
        #md-drive-overlay .markdown-body ul,
        #md-drive-overlay .markdown-body ol { padding-left: 2em !important; margin-bottom: 16px !important; }
        #md-drive-overlay .md-toolbar {
          position: sticky !important; top: 0 !important; z-index: 100 !important;
          display: flex !important; align-items: center !important; justify-content: space-between !important;
          padding: 8px 24px !important; background: #161b22 !important;
          border-bottom: 1px solid #30363d !important;
        }
        #md-drive-overlay .md-filename {
          font-size: 14px !important; font-weight: 600 !important; color: #8b949e !important;
        }
        #md-drive-overlay .hidden { display: none !important; }
        #md-drive-overlay .md-source {
          max-width: 860px; margin: 32px auto; padding: 0 24px 80px;
          white-space: pre-wrap !important; word-break: break-word !important;
          font-family: "SFMono-Regular", Consolas, Menlo, monospace !important;
          font-size: 13px !important; color: #e6edf3 !important;
          background: transparent !important; border: none !important;
        }
      </style>
      <div class="md-toolbar">
        <span class="md-filename">${escapeHtml(filename)}</span>
        <div style="display:flex;gap:8px">
          <button id="md-drive-source"></> Source</button>
          <button id="md-drive-close">✕ Close</button>
        </div>
      </div>
      <div id="md-drive-rendered" class="markdown-body">${html}</div>
      <pre id="md-drive-raw" class="md-source hidden">${escapeHtml(rawText)}</pre>
    `;

    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      background: '#0d1117',
      overflowY: 'auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });

    overlay.querySelectorAll('button').forEach(btn => {
      Object.assign(btn.style, {
        padding: '4px 12px',
        fontSize: '12px',
        background: '#21262d',
        color: '#c9d1d9',
        border: '1px solid #30363d',
        borderRadius: '6px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      });
    });

    document.body.appendChild(overlay);

    // Close helper — removes overlay and notifies caller so renderedFilename resets
    function closeOverlay() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    }

    overlay.querySelector('#md-drive-close').onclick = closeOverlay;

    // Source toggle
    overlay.querySelector('#md-drive-source').onclick = function () {
      const rendered = overlay.querySelector('#md-drive-rendered');
      const raw      = overlay.querySelector('#md-drive-raw');
      const showingSource = !raw.classList.contains('hidden');
      rendered.classList.toggle('hidden', !showingSource);
      raw.classList.toggle('hidden', showingSource);
      this.innerHTML = showingSource ? '</> Source' : 'Preview';
    };

    // Escape key
    function onKey(e) { if (e.key === 'Escape') closeOverlay(); }
    document.addEventListener('keydown', onKey);
  }

  // ════════════════════════════════════════════════════════════════════
  // FULL PAGE RENDER  (local file:// )
  // ════════════════════════════════════════════════════════════════════
  function renderFullPage(rawText, filename) {
    const html = marked.parse(rawText);

    document.open();
    document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(filename)}</title>
  <link rel="stylesheet" href="${chrome.runtime.getURL('style.css')}">
</head>
<body>
  <div class="md-toolbar">
    <span class="md-filename">${escapeHtml(filename)}</span>
    <button id="md-toggle-source">&#60;/&#62; Source</button>
  </div>
  <div id="md-preview" class="markdown-body">${html}</div>
  <pre id="md-source" class="md-source hidden">${escapeHtml(rawText)}</pre>
  <script>
    document.getElementById('md-toggle-source').addEventListener('click', function () {
      const p = document.getElementById('md-preview');
      const s = document.getElementById('md-source');
      const src = !s.classList.contains('hidden');
      p.classList.toggle('hidden', !src);
      s.classList.toggle('hidden', src);
      this.innerHTML = src ? '&#60;/&#62; Source' : 'Preview';
    });
  <\/script>
</body>
</html>`);
    document.close();
  }

  // ─── Utilities ──────────────────────────────────────────────────────
  function isMarkdownFilename(name) {
    return /\.(?:md|markdown)$/i.test(name);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
})();
