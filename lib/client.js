(() => {
  const MODULE_ID = "dsh-selection-quote";
  const NS = "selection-quote";
  const STYLE_ELEMENT_ID = "dsh-selection-quote-styles";

  function normalizeQuoteText(text) {
    if (typeof text !== "string") return "";
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }

  function formatQuoteBlock(text) {
    const cleaned = normalizeQuoteText(text);
    if (!cleaned) return "";
    return cleaned
      .split("\n")
      .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
      .join("\n");
  }

  function formatQuoteForChat(text) {
    const block = formatQuoteBlock(text);
    if (!block) return "";
    return `${block}\n\n`;
  }

  function formatQuoteAndComment(quote, comment, options = {}) {
    const block = formatQuoteBlock(quote);
    if (!block) return "";
    const label = options.commentLabel || "批注";
    const cleanedComment = normalizeQuoteText(comment);
    if (!cleanedComment) {
      return block;
    }
    return `${block}\n**${label}**：${cleanedComment}`;
  }

  function formatBatchItems(items, options = {}) {
    if (!Array.isArray(items) || items.length === 0) return "";
    const blocks = items
      .map((item) => {
        if (!item || typeof item.quote !== "string") return "";
        return formatQuoteAndComment(item.quote, item.comment || "", options);
      })
      .filter(Boolean);
    if (blocks.length === 0) return "";
    return `${blocks.join("\n\n")}\n\n`;
  }

  function truncateQuotePreview(text, maxChars = 140) {
    const cleaned = normalizeQuoteText(text).replace(/\s+/g, " ");
    if (cleaned.length <= maxChars) return cleaned;
    return `${cleaned.slice(0, Math.max(1, maxChars - 1))}…`;
  }

  function computeToolbarPosition(rect, viewport = {}, mode = "pill") {
    const vw = Number(viewport.width) || (typeof window !== "undefined" ? window.innerWidth : 1280) || 1280;
    const vh = Number(viewport.height) || (typeof window !== "undefined" ? window.innerHeight : 800) || 800;
    const halfWidth = mode === "comment" ? 190 : 140;
    const margin = 16;
    const requiredTopSpace = mode === "comment" ? 210 : 54;
    const gap = 10;

    const rawCenterX = (Number(rect?.left) || 0) + (Number(rect?.width) || 0) / 2;
    const minX = margin + halfWidth;
    const maxX = Math.max(minX, vw - margin - halfWidth);
    const left = Math.min(Math.max(rawCenterX, minX), maxX);

    const rectTop = Number(rect?.top) || 0;
    const rectBottom = Number(rect?.bottom) || rectTop + (Number(rect?.height) || 20);

    if (rectTop >= requiredTopSpace) {
      return {
        left: Math.round(left),
        top: Math.round(Math.max(margin, rectTop - gap)),
        placement: "above",
      };
    }

    return {
      left: Math.round(left),
      top: Math.round(Math.min(vh - margin, rectBottom + gap)),
      placement: "below",
    };
  }

  function focusComposerElement(hostRoot) {
    if (typeof document === "undefined") return false;
    const root =
      (hostRoot && hostRoot.closest && hostRoot.closest("[data-conversation-content]")) ||
      document;
    const editor =
      root.querySelector?.('[data-composer-card] [contenteditable="true"]') ||
      root.querySelector?.("[data-composer-card] textarea") ||
      document.querySelector?.('[data-composer-card] [contenteditable="true"]') ||
      document.querySelector?.("[data-composer-card] textarea");

    if (editor && typeof editor.focus === "function") {
      try {
        editor.focus();
        if (
          editor.getAttribute?.("contenteditable") === "true" &&
          typeof window !== "undefined" &&
          typeof window.getSelection === "function" &&
          typeof document.createRange === "function"
        ) {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        return true;
      } catch (_err) {
        return false;
      }
    }
    return false;
  }

  function insertIntoComposerDraft(ctx, sessionId, rawFormattedText, hostRoot) {
    const normalized = normalizeQuoteText(rawFormattedText);
    if (!normalized) return false;
    const textWithTrailingNewlines = `${normalized}\n\n`;

    const shell = ctx?.conversation?.input?.shell?.(sessionId);
    let inserted = false;

    if (shell) {
      const currentDraft = shell.projection?.clipboardText ?? "";
      const hasExisting = currentDraft.trim().length > 0;
      const payload = hasExisting
        ? `${currentDraft.replace(/\s+$/, "")}\n\n${textWithTrailingNewlines}`
        : textWithTrailingNewlines;

      if (!hasExisting && shell.actions && typeof shell.actions.insertText === "function") {
        try {
          const span =
            typeof shell.actions.captureInsertion === "function"
              ? shell.actions.captureInsertion()
              : undefined;
          inserted = Boolean(shell.actions.insertText(textWithTrailingNewlines, span));
        } catch (_err) {
          inserted = false;
        }
      }

      if (!inserted && typeof shell.setDraft === "function") {
        shell.setDraft(payload);
        inserted = true;
      } else if (!inserted && shell.actions && typeof shell.actions.insertText === "function") {
        const prefix = currentDraft && !currentDraft.endsWith("\n") ? "\n\n" : "";
        const span =
          typeof shell.actions.captureInsertion === "function"
            ? shell.actions.captureInsertion()
            : undefined;
        inserted = Boolean(shell.actions.insertText(`${prefix}${textWithTrailingNewlines}`, span));
      }

      if (typeof shell.focus === "function") {
        try {
          shell.focus();
        } catch (_err) {
          // ignore
        }
      }
    }

    focusComposerElement(hostRoot);
    return inserted;
  }

  function closestElement(node, selector) {
    if (!node) return null;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || typeof el.closest !== "function") return null;
    return el.closest(selector);
  }

  function isValidMessageSelection(selection, conversationRoot, minSelectionLength = 2) {
    if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
      return { valid: false, text: "", rect: null };
    }
    const rawText = typeof selection.toString === "function" ? selection.toString() : "";
    const trimmed = normalizeQuoteText(rawText);
    if (trimmed.length < minSelectionLength) {
      return { valid: false, text: "", rect: null };
    }

    const range = selection.getRangeAt(0);
    const startNode = range.startContainer;
    const endNode = range.endContainer;
    const commonNode = range.commonAncestorContainer;

    const forbiddenSelector = [
      "[data-composer-seat]",
      "[data-composer-card]",
      "[data-dsh-quote-toolbar]",
      "[data-dsh-quote-dock]",
      '[contenteditable="true"]',
      "textarea",
      "input",
    ].join(", ");

    if (
      closestElement(startNode, forbiddenSelector) ||
      closestElement(endNode, forbiddenSelector) ||
      closestElement(commonNode, forbiddenSelector)
    ) {
      return { valid: false, text: "", rect: null };
    }

    if (conversationRoot && typeof conversationRoot.contains === "function") {
      const startInside = conversationRoot.contains(startNode);
      const endInside = conversationRoot.contains(endNode);
      if (!startInside || !endInside) {
        return { valid: false, text: "", rect: null };
      }
    }

    let rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
    if ((!rect || (rect.width === 0 && rect.height === 0)) && typeof range.getClientRects === "function") {
      const rects = range.getClientRects();
      if (rects && rects.length > 0) {
        rect = rects[0];
      }
    }

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      return { valid: false, text: "", rect: null };
    }

    return {
      valid: true,
      text: trimmed,
      rect: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      },
    };
  }

  function createFallbackSnapshotStore(initialState) {
    let state = initialState;
    const listeners = new Set();
    return {
      getSnapshot() {
        return state;
      },
      setState(updater) {
        const next = typeof updater === "function" ? updater(state) : updater;
        if (Object.is(next, state)) return state;
        state = next;
        for (const listener of listeners) {
          listener();
        }
        return state;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  function createSelectionQuoteStore(createSnapshotStoreFn = createFallbackSnapshotStore) {
    let seq = 0;
    const initialToolbar = {
      visible: false,
      mode: "pill",
      text: "",
      rect: null,
      placement: "above",
      commentDraft: "",
    };

    const store = (createSnapshotStoreFn || createFallbackSnapshotStore)({
      items: [],
      editingId: null,
      editingComment: "",
      toolbar: initialToolbar,
    });

    const update = (recipe) => {
      if (typeof store.setState === "function") {
        return store.setState(recipe);
      }
      if (typeof store.setSnapshot === "function") {
        const next = typeof recipe === "function" ? recipe(store.getSnapshot()) : recipe;
        store.setSnapshot(next);
        return next;
      }
      return store.getSnapshot();
    };

    return {
      getSnapshot: () => store.getSnapshot(),
      subscribe: (listener) => store.subscribe(listener),

      showPill(text, rect, viewport) {
        const cleaned = normalizeQuoteText(text);
        if (!cleaned) return;
        const pos = computeToolbarPosition(rect, viewport, "pill");
        update((prev) => ({
          ...prev,
          toolbar: {
            visible: true,
            mode: "pill",
            text: cleaned,
            rect,
            left: pos.left,
            top: pos.top,
            placement: pos.placement,
            commentDraft: "",
          },
        }));
      },

      openCommentMode(textOverride, rectOverride, viewport) {
        update((prev) => {
          const text = normalizeQuoteText(textOverride || prev.toolbar.text);
          if (!text) return prev;
          const rect = rectOverride || prev.toolbar.rect || {
            top: 180,
            left: 480,
            bottom: 204,
            right: 640,
            width: 160,
            height: 24,
          };
          const pos = computeToolbarPosition(rect, viewport, "comment");
          return {
            ...prev,
            toolbar: {
              visible: true,
              mode: "comment",
              text,
              rect,
              left: pos.left,
              top: pos.top,
              placement: pos.placement,
              commentDraft: prev.toolbar.mode === "comment" ? prev.toolbar.commentDraft : "",
            },
          };
        });
      },

      setCommentDraft(commentDraft) {
        update((prev) => ({
          ...prev,
          toolbar: {
            ...prev.toolbar,
            commentDraft: String(commentDraft ?? ""),
          },
        }));
      },

      hideToolbar() {
        update((prev) => {
          if (!prev.toolbar.visible) return prev;
          return {
            ...prev,
            toolbar: initialToolbar,
          };
        });
      },

      addItem({ quote, comment = "" }, maxItems = 20) {
        const cleanedQuote = normalizeQuoteText(quote);
        if (!cleanedQuote) return null;
        const cleanedComment = normalizeQuoteText(comment);
        seq += 1;
        const newItem = {
          id: `sq-${Date.now()}-${seq}`,
          quote: cleanedQuote,
          comment: cleanedComment,
          createdAt: Date.now(),
        };
        update((prev) => {
          const nextItems = [...prev.items, newItem].slice(-Math.max(1, maxItems));
          return {
            ...prev,
            items: nextItems,
            toolbar: initialToolbar,
          };
        });
        return newItem;
      },

      removeItem(id) {
        update((prev) => ({
          ...prev,
          items: prev.items.filter((item) => item.id !== id),
          editingId: prev.editingId === id ? null : prev.editingId,
          editingComment: prev.editingId === id ? "" : prev.editingComment,
        }));
      },

      updateItem(id, patch) {
        update((prev) => ({
          ...prev,
          items: prev.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...(typeof patch.quote === "string" ? { quote: normalizeQuoteText(patch.quote) } : {}),
                  ...(typeof patch.comment === "string"
                    ? { comment: normalizeQuoteText(patch.comment) }
                    : {}),
                }
              : item
          ),
        }));
      },

      startEditing(id) {
        update((prev) => {
          const target = prev.items.find((item) => item.id === id);
          if (!target) return prev;
          return {
            ...prev,
            editingId: id,
            editingComment: target.comment || "",
          };
        });
      },

      setEditingComment(comment) {
        update((prev) => ({
          ...prev,
          editingComment: String(comment ?? ""),
        }));
      },

      commitEditing() {
        update((prev) => {
          if (!prev.editingId) return prev;
          const cleaned = normalizeQuoteText(prev.editingComment);
          return {
            ...prev,
            items: prev.items.map((item) =>
              item.id === prev.editingId ? { ...item, comment: cleaned } : item
            ),
            editingId: null,
            editingComment: "",
          };
        });
      },

      cancelEditing() {
        update((prev) => ({
          ...prev,
          editingId: null,
          editingComment: "",
        }));
      },

      clearItems() {
        update((prev) => ({
          ...prev,
          items: [],
          editingId: null,
          editingComment: "",
        }));
      },
    };
  }

  function ensureStylesInjected() {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ELEMENT_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
      /* Ensure composer dock wraps cleanly and sits right above input card when Quotes & Comments Dock is active */
      [data-composer-seat] > div:has(> [data-dsh-quote-dock]) {
        order: -1;
        flex-wrap: wrap !important;
        width: 100% !important;
        max-width: var(--dsh-composer-card-max-width, 820px) !important;
        padding-top: 0 !important;
        padding-bottom: 6px !important;
      }

      [data-dsh-quote-dock] {
        flex: 0 0 100%;
        order: -20;
        width: 100%;
        max-width: var(--dsh-composer-card-max-width, 820px);
        margin: 0 auto 6px auto;
        box-sizing: border-box;
        font-family: var(--dsh-font-sans, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      }

      .dsh-sq-toolbar-anchor {
        position: fixed;
        z-index: 9999;
        pointer-events: auto;
        font-family: var(--dsh-font-sans, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
        transition: opacity 0.14s cubic-bezier(0.16, 1, 0.3, 1), transform 0.14s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .dsh-sq-toolbar-anchor[data-placement="above"] {
        transform: translate(-50%, -100%);
      }

      .dsh-sq-toolbar-anchor[data-placement="below"] {
        transform: translate(-50%, 0);
      }

      .dsh-sq-pill {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 4px 6px;
        border-radius: 999px;
        background: var(--dsh-surface-floating, rgba(255, 255, 255, 0.92));
        color: var(--dsh-text-primary, #14171f);
        border: 0.5px solid var(--dsh-border-subtle, rgba(15, 23, 42, 0.14));
        box-shadow:
          0 10px 28px -6px rgba(15, 23, 42, 0.18),
          0 2px 6px -1px rgba(15, 23, 42, 0.08);
        backdrop-filter: blur(14px) saturate(160%);
        -webkit-backdrop-filter: blur(14px) saturate(160%);
        user-select: none;
        white-space: nowrap;
      }

      @media (prefers-color-scheme: dark) {
        .dsh-sq-pill {
          background: var(--dsh-surface-floating, rgba(26, 29, 38, 0.92));
          color: var(--dsh-text-primary, #f1f5f9);
          border-color: var(--dsh-border-subtle, rgba(255, 255, 255, 0.14));
          box-shadow:
            0 12px 32px -6px rgba(0, 0, 0, 0.52),
            0 2px 8px -1px rgba(0, 0, 0, 0.32);
        }
      }

      [data-theme="dark"] .dsh-sq-pill,
      .dark .dsh-sq-pill {
        background: var(--dsh-surface-floating, rgba(26, 29, 38, 0.92));
        color: var(--dsh-text-primary, #f1f5f9);
        border-color: var(--dsh-border-subtle, rgba(255, 255, 255, 0.14));
        box-shadow:
          0 12px 32px -6px rgba(0, 0, 0, 0.52),
          0 2px 8px -1px rgba(0, 0, 0, 0.32);
      }

      .dsh-sq-pill-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font-size: 12.5px;
        font-weight: 500;
        line-height: 1.2;
        cursor: pointer;
        transition: background-color 0.12s ease, color 0.12s ease;
      }

      .dsh-sq-pill-btn:hover {
        background: var(--dsh-surface-hover, rgba(59, 130, 246, 0.1));
      }

      .dsh-sq-pill-btn:active {
        transform: scale(0.98);
      }

      .dsh-sq-kbd {
        display: inline-flex;
        align-items: center;
        padding: 1px 5px;
        border-radius: 4px;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: var(--dsh-text-secondary, #64748b);
        background: var(--dsh-surface-muted, rgba(148, 163, 184, 0.16));
      }

      .dsh-sq-divider {
        width: 1px;
        height: 15px;
        background: var(--dsh-border-subtle, rgba(148, 163, 184, 0.3));
        margin: 0 2px;
      }

      .dsh-sq-comment-card {
        width: 372px;
        max-width: calc(100vw - 24px);
        padding: 11px 12px;
        border-radius: 14px;
        background: var(--dsh-surface-floating, rgba(255, 255, 255, 0.96));
        color: var(--dsh-text-primary, #14171f);
        border: 0.5px solid var(--dsh-border-subtle, rgba(15, 23, 42, 0.15));
        box-shadow:
          0 16px 40px -8px rgba(15, 23, 42, 0.22),
          0 4px 12px -2px rgba(15, 23, 42, 0.1);
        backdrop-filter: blur(16px) saturate(170%);
        -webkit-backdrop-filter: blur(16px) saturate(170%);
        display: flex;
        flex-direction: column;
        gap: 9px;
      }

      @media (prefers-color-scheme: dark) {
        .dsh-sq-comment-card {
          background: var(--dsh-surface-floating, rgba(24, 27, 36, 0.96));
          color: var(--dsh-text-primary, #f1f5f9);
          border-color: var(--dsh-border-subtle, rgba(255, 255, 255, 0.14));
          box-shadow:
            0 18px 44px -8px rgba(0, 0, 0, 0.58),
            0 4px 14px -2px rgba(0, 0, 0, 0.36);
        }
      }

      [data-theme="dark"] .dsh-sq-comment-card,
      .dark .dsh-sq-comment-card {
        background: var(--dsh-surface-floating, rgba(24, 27, 36, 0.96));
        color: var(--dsh-text-primary, #f1f5f9);
        border-color: var(--dsh-border-subtle, rgba(255, 255, 255, 0.14));
        box-shadow:
          0 18px 44px -8px rgba(0, 0, 0, 0.58),
          0 4px 14px -2px rgba(0, 0, 0, 0.36);
      }

      .dsh-sq-quote-preview {
        padding: 5px 9px;
        border-left: 3px solid var(--dsh-accent-primary, #3b82f6);
        background: var(--dsh-surface-muted, rgba(59, 130, 246, 0.07));
        border-radius: 0 7px 7px 0;
        font-size: 11.5px;
        line-height: 1.45;
        color: var(--dsh-text-secondary, #64748b);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
      }

      .dsh-sq-textarea {
        width: 100%;
        min-height: 62px;
        max-height: 150px;
        padding: 8px 10px;
        border-radius: 9px;
        border: 1px solid var(--dsh-border-subtle, rgba(148, 163, 184, 0.32));
        background: var(--dsh-surface-input, rgba(255, 255, 255, 0.65));
        color: inherit;
        font-family: inherit;
        font-size: 12.5px;
        line-height: 1.45;
        resize: vertical;
        box-sizing: border-box;
        outline: none;
        transition: border-color 0.14s ease, box-shadow 0.14s ease;
      }

      @media (prefers-color-scheme: dark) {
        .dsh-sq-textarea {
          background: rgba(15, 18, 26, 0.65);
          border-color: rgba(255, 255, 255, 0.14);
        }
      }

      [data-theme="dark"] .dsh-sq-textarea,
      .dark .dsh-sq-textarea {
        background: rgba(15, 18, 26, 0.65);
        border-color: rgba(255, 255, 255, 0.14);
      }

      .dsh-sq-textarea:focus {
        border-color: var(--dsh-accent-primary, #3b82f6);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.18);
      }

      .dsh-sq-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }

      .dsh-sq-card-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
      }

      .dsh-sq-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.12s ease;
        white-space: nowrap;
      }

      .dsh-sq-btn-secondary {
        background: var(--dsh-surface-muted, rgba(148, 163, 184, 0.14));
        color: var(--dsh-text-primary, inherit);
        border-color: var(--dsh-border-subtle, rgba(148, 163, 184, 0.24));
      }

      .dsh-sq-btn-secondary:hover {
        background: var(--dsh-surface-hover, rgba(148, 163, 184, 0.24));
      }

      .dsh-sq-btn-primary {
        background: var(--dsh-accent-primary, #2563eb);
        color: #ffffff;
      }

      .dsh-sq-btn-primary:hover {
        filter: brightness(1.06);
      }

      .dsh-sq-btn-ghost {
        background: transparent;
        color: var(--dsh-text-secondary, #64748b);
        padding: 4px 7px;
      }

      .dsh-sq-btn-ghost:hover {
        background: var(--dsh-surface-muted, rgba(148, 163, 184, 0.14));
        color: var(--dsh-text-primary, inherit);
      }

      /* Dock above/around composer */
      .dsh-sq-dock-panel {
        border-radius: 13px;
        padding: 8px 10px;
        background: var(--dsh-surface-elevated, rgba(248, 250, 252, 0.9));
        border: 1px solid var(--dsh-border-subtle, rgba(148, 163, 184, 0.24));
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      @media (prefers-color-scheme: dark) {
        .dsh-sq-dock-panel {
          background: var(--dsh-surface-elevated, rgba(22, 25, 34, 0.88));
          border-color: var(--dsh-border-subtle, rgba(255, 255, 255, 0.11));
        }
      }

      [data-theme="dark"] .dsh-sq-dock-panel,
      .dark .dsh-sq-dock-panel {
        background: var(--dsh-surface-elevated, rgba(22, 25, 34, 0.88));
        border-color: var(--dsh-border-subtle, rgba(255, 255, 255, 0.11));
      }

      .dsh-sq-dock-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 0 2px;
      }

      .dsh-sq-dock-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        color: var(--dsh-text-secondary, #64748b);
      }

      .dsh-sq-dock-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        background: rgba(37, 99, 235, 0.12);
        color: var(--dsh-accent-primary, #2563eb);
      }

      .dsh-sq-dock-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
        max-height: 196px;
        overflow-y: auto;
      }

      .dsh-sq-dock-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 9px;
        border-radius: 9px;
        background: var(--dsh-surface-card, rgba(255, 255, 255, 0.78));
        border: 0.5px solid var(--dsh-border-subtle, rgba(148, 163, 184, 0.22));
        transition: border-color 0.12s ease;
      }

      @media (prefers-color-scheme: dark) {
        .dsh-sq-dock-item {
          background: rgba(30, 34, 45, 0.78);
          border-color: rgba(255, 255, 255, 0.09);
        }
      }

      [data-theme="dark"] .dsh-sq-dock-item,
      .dark .dsh-sq-dock-item {
        background: rgba(30, 34, 45, 0.78);
        border-color: rgba(255, 255, 255, 0.09);
      }

      .dsh-sq-dock-item:hover {
        border-color: var(--dsh-accent-primary, #3b82f6);
      }

      .dsh-sq-dock-item-body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .dsh-sq-dock-quote {
        font-size: 11.5px;
        line-height: 1.35;
        color: var(--dsh-text-secondary, #64748b);
        border-left: 2.5px solid var(--dsh-accent-primary, #3b82f6);
        padding-left: 7px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .dsh-sq-dock-comment {
        font-size: 12.5px;
        line-height: 1.4;
        color: var(--dsh-text-primary, inherit);
        word-break: break-word;
        cursor: pointer;
      }

      .dsh-sq-dock-comment-empty {
        font-size: 11.5px;
        font-style: italic;
        color: var(--dsh-text-tertiary, #94a3b8);
        cursor: pointer;
      }

      .dsh-sq-dock-item-actions {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        flex-shrink: 0;
      }

      .dsh-sq-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: var(--dsh-text-secondary, #64748b);
        cursor: pointer;
        font-size: 12px;
        transition: background-color 0.12s ease, color 0.12s ease;
      }

      .dsh-sq-icon-btn:hover {
        background: var(--dsh-surface-muted, rgba(148, 163, 184, 0.18));
        color: var(--dsh-text-primary, inherit);
      }

      .dsh-sq-edit-input {
        width: 100%;
        padding: 4px 7px;
        border-radius: 6px;
        border: 1px solid var(--dsh-accent-primary, #3b82f6);
        background: var(--dsh-surface-input, rgba(255, 255, 255, 0.9));
        color: inherit;
        font-size: 12px;
        font-family: inherit;
        outline: none;
        box-sizing: border-box;
      }

      @media (prefers-color-scheme: dark) {
        .dsh-sq-edit-input {
          background: rgba(15, 18, 26, 0.9);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildModule(require) {
    const React = require("react");
    const ReactDOM = require("react-dom");
    const jsxRuntime = require("react/jsx-runtime");
    const storePkg = (() => {
      try {
        return require("@deepseek-ai/dsh-client-store");
      } catch (_err) {
        return {};
      }
    })();

    const createSnapshotStore = storePkg.createSnapshotStore || createFallbackSnapshotStore;
    const useStore =
      storePkg.useStore ||
      ((store, selector = (s) => s) =>
        React.useSyncExternalStore(
          store.subscribe,
          () => selector(store.getSnapshot()),
          () => selector(store.getSnapshot())
        ));

    const sessionStores = new Map();
    function getSessionStore(sessionId) {
      const key = String(sessionId || "__default__");
      let store = sessionStores.get(key);
      if (!store) {
        store = createSelectionQuoteStore(createSnapshotStore);
        sessionStores.set(key, store);
      }
      return store;
    }

    function createSelectionOverlayComponent(ctx) {
      return function SelectionQuoteOverlay({ sessionId }) {
        const store = React.useMemo(() => getSessionStore(sessionId), [sessionId]);
        const toolbar = useStore(store, (s) => s.toolbar);
        const probeRef = React.useRef(null);
        const toolbarRef = React.useRef(null);
        const textareaRef = React.useRef(null);

        React.useEffect(() => {
          ensureStylesInjected();
        }, []);

        React.useEffect(() => {
          if (toolbar.visible && toolbar.mode === "comment" && textareaRef.current) {
            const timer = setTimeout(() => {
              textareaRef.current?.focus?.();
            }, 15);
            return () => clearTimeout(timer);
          }
        }, [toolbar.visible, toolbar.mode]);

        const getConversationRoot = React.useCallback(() => {
          if (probeRef.current && typeof probeRef.current.closest === "function") {
            const found = probeRef.current.closest("[data-conversation-content]");
            if (found) return found;
          }
          return typeof document !== "undefined"
            ? document.querySelector("[data-conversation-content]")
            : null;
        }, []);

        const handleAddToChat = React.useCallback(
          (textToInsert) => {
            const targetText = normalizeQuoteText(textToInsert || store.getSnapshot().toolbar.text);
            if (!targetText) return false;
            const formatted = formatQuoteForChat(targetText);
            insertIntoComposerDraft(ctx, sessionId, formatted, probeRef.current);
            store.hideToolbar();
            if (typeof window !== "undefined" && typeof window.getSelection === "function") {
              try {
                window.getSelection()?.removeAllRanges?.();
              } catch (_err) {
                // ignore
              }
            }
            return true;
          },
          [sessionId, store]
        );

        const handleStageQuoteToDock = React.useCallback(
          (textToStage, comment = "") => {
            const targetText = normalizeQuoteText(textToStage || store.getSnapshot().toolbar.text);
            if (!targetText) return false;
            store.addItem({ quote: targetText, comment });
            if (typeof window !== "undefined" && typeof window.getSelection === "function") {
              try {
                window.getSelection()?.removeAllRanges?.();
              } catch (_err) {
                // ignore
              }
            }
            return true;
          },
          [store]
        );

        const handleDirectInsertWithComment = React.useCallback(() => {
          const snap = store.getSnapshot().toolbar;
          if (!snap.text) return false;
          const formatted = formatQuoteAndComment(snap.text, snap.commentDraft);
          insertIntoComposerDraft(ctx, sessionId, formatted, probeRef.current);
          store.hideToolbar();
          if (typeof window !== "undefined" && typeof window.getSelection === "function") {
            try {
              window.getSelection()?.removeAllRanges?.();
            } catch (_err) {
              // ignore
            }
          }
          return true;
        }, [sessionId, store]);

        React.useEffect(() => {
          if (typeof document === "undefined" || typeof window === "undefined") return;

          const syncFromDomSelection = () => {
            const currentToolbar = store.getSnapshot().toolbar;
            if (currentToolbar.visible && currentToolbar.mode === "comment") {
              return;
            }
            const sel = window.getSelection?.();
            const convRoot = getConversationRoot();
            const result = isValidMessageSelection(sel, convRoot, 2);
            if (result.valid) {
              store.showPill(result.text, result.rect, {
                width: window.innerWidth,
                height: window.innerHeight,
              });
            } else if (currentToolbar.visible && currentToolbar.mode === "pill") {
              store.hideToolbar();
            }
          };

          const onMouseUp = (e) => {
            if (toolbarRef.current && toolbarRef.current.contains(e.target)) {
              return;
            }
            setTimeout(syncFromDomSelection, 10);
          };

          const onMouseDown = (e) => {
            if (toolbarRef.current && toolbarRef.current.contains(e.target)) {
              return;
            }
            const currentToolbar = store.getSnapshot().toolbar;
            if (currentToolbar.visible) {
              store.hideToolbar();
            }
          };

          const onKeyDown = (e) => {
            const currentToolbar = store.getSnapshot().toolbar;
            if (e.key === "Escape" && currentToolbar.visible) {
              e.preventDefault();
              e.stopPropagation();
              store.hideToolbar();
              return;
            }

            const isMod = Boolean(e.metaKey || e.ctrlKey);
            const isKeyL = e.code === "KeyL" || (typeof e.key === "string" && e.key.toLowerCase() === "l");
            if (!isMod || e.altKey || !isKeyL) return;

            const sel = window.getSelection?.();
            const convRoot = getConversationRoot();
            const check = isValidMessageSelection(sel, convRoot, 2);
            const activeText = check.valid ? check.text : currentToolbar.visible ? currentToolbar.text : "";
            const activeRect = check.valid ? check.rect : currentToolbar.rect;

            if (!activeText) return;

            e.preventDefault();
            e.stopPropagation();

            if (e.shiftKey) {
              store.openCommentMode(activeText, activeRect, {
                width: window.innerWidth,
                height: window.innerHeight,
              });
            } else {
              handleAddToChat(activeText);
            }
          };

          document.addEventListener("mouseup", onMouseUp, true);
          document.addEventListener("mousedown", onMouseDown, true);
          document.addEventListener("keydown", onKeyDown, true);

          return () => {
            document.removeEventListener("mouseup", onMouseUp, true);
            document.removeEventListener("mousedown", onMouseDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
          };
        }, [getConversationRoot, handleAddToChat, store]);

        const floatingNode =
          toolbar.visible && typeof document !== "undefined" && document.body
            ? ReactDOM.createPortal(
                jsxRuntime.jsx("div", {
                  ref: toolbarRef,
                  className: "dsh-sq-toolbar-anchor",
                  "data-dsh-quote-toolbar": sessionId,
                  "data-mode": toolbar.mode,
                  "data-placement": toolbar.placement || "above",
                  style: {
                    left: `${toolbar.left ?? 320}px`,
                    top: `${toolbar.top ?? 160}px`,
                  },
                  onMouseDown: (e) => {
                    e.stopPropagation();
                  },
                  children:
                    toolbar.mode === "pill"
                      ? jsxRuntime.jsxs("div", {
                          className: "dsh-sq-pill",
                          role: "toolbar",
                          "aria-label": "划词引用与批注工具栏",
                          children: [
                            jsxRuntime.jsxs("button", {
                              type: "button",
                              className: "dsh-sq-pill-btn",
                              "data-action": "add-to-chat",
                              title: "将选中文本作为引用块插入底部输入框 (⌘L)",
                              onMouseDown: (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              },
                              onClick: (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (e.altKey) {
                                  handleStageQuoteToDock(toolbar.text, "");
                                } else {
                                  handleAddToChat(toolbar.text);
                                }
                              },
                              children: [
                                jsxRuntime.jsx("span", { children: "Add to Chat" }),
                                jsxRuntime.jsx("kbd", { className: "dsh-sq-kbd", children: "⌘L" }),
                              ],
                            }),
                            jsxRuntime.jsx("span", { className: "dsh-sq-divider", "aria-hidden": "true" }),
                            jsxRuntime.jsxs("button", {
                              type: "button",
                              className: "dsh-sq-pill-btn",
                              "data-action": "open-comment",
                              title: "针对选中片段撰写行内批注 (⇧⌘L)",
                              onMouseDown: (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              },
                              onClick: (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                store.openCommentMode();
                              },
                              children: [
                                jsxRuntime.jsx("span", { children: "写批注" }),
                                jsxRuntime.jsx("kbd", { className: "dsh-sq-kbd", children: "⇧⌘L" }),
                              ],
                            }),
                            jsxRuntime.jsx("span", { className: "dsh-sq-divider", "aria-hidden": "true" }),
                            jsxRuntime.jsx("button", {
                              type: "button",
                              className: "dsh-sq-pill-btn",
                              "data-action": "stage-quote",
                              title: "暂存引用到输入框上方批注栏，支持多段汇总插入",
                              onMouseDown: (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              },
                              onClick: (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleStageQuoteToDock(toolbar.text, "");
                              },
                              children: jsxRuntime.jsx("span", { children: "+ 批注栏" }),
                            }),
                          ],
                        })
                      : jsxRuntime.jsxs("div", {
                          className: "dsh-sq-comment-card",
                          role: "dialog",
                          "aria-label": "写批注卡片",
                          children: [
                            jsxRuntime.jsx("div", {
                              className: "dsh-sq-quote-preview",
                              title: toolbar.text,
                              children: truncateQuotePreview(toolbar.text, 160),
                            }),
                            jsxRuntime.jsx("textarea", {
                              ref: textareaRef,
                              className: "dsh-sq-textarea",
                              "data-dsh-comment-input": "true",
                              value: toolbar.commentDraft,
                              placeholder:
                                "针对这段文字写下你的注释或修改意见… (Enter 确认，Shift+Enter 换行，Esc 取消)",
                              onChange: (e) => store.setCommentDraft(e.target.value),
                              onKeyDown: (e) => {
                                if (e.nativeEvent?.isComposing) return;
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  store.hideToolbar();
                                  return;
                                }
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDirectInsertWithComment();
                                  return;
                                }
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleStageQuoteToDock(toolbar.text, toolbar.commentDraft);
                                }
                              },
                            }),
                            jsxRuntime.jsxs("div", {
                              className: "dsh-sq-card-footer",
                              children: [
                                jsxRuntime.jsx("button", {
                                  type: "button",
                                  className: "dsh-sq-btn dsh-sq-btn-ghost",
                                  "data-action": "cancel-comment",
                                  onClick: () => store.hideToolbar(),
                                  children: "取消 (Esc)",
                                }),
                                jsxRuntime.jsxs("div", {
                                  className: "dsh-sq-card-actions",
                                  children: [
                                    jsxRuntime.jsx("button", {
                                      type: "button",
                                      className: "dsh-sq-btn dsh-sq-btn-secondary",
                                      "data-action": "direct-insert-comment",
                                      onClick: () => handleDirectInsertWithComment(),
                                      children: "直接插入输入框 (⌘Enter)",
                                    }),
                                    jsxRuntime.jsx("button", {
                                      type: "button",
                                      className: "dsh-sq-btn dsh-sq-btn-primary",
                                      "data-action": "add-comment-to-dock",
                                      onClick: () =>
                                        handleStageQuoteToDock(toolbar.text, toolbar.commentDraft),
                                      children: "加入批注栏 (Enter)",
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          ],
                        }),
                }),
                document.body
              )
            : null;

        return jsxRuntime.jsxs(jsxRuntime.Fragment, {
          children: [
            jsxRuntime.jsx("span", {
              ref: probeRef,
              "data-dsh-selection-quote-probe": sessionId,
              style: { display: "none" },
            }),
            floatingNode,
          ],
        });
      };
    }

    function createQuotesCommentsDockComponent(ctx) {
      return function QuotesCommentsDock({ sessionId }) {
        const store = React.useMemo(() => getSessionStore(sessionId), [sessionId]);
        const items = useStore(store, (s) => s.items);
        const editingId = useStore(store, (s) => s.editingId);
        const editingComment = useStore(store, (s) => s.editingComment);
        const dockRef = React.useRef(null);

        React.useEffect(() => {
          ensureStylesInjected();
        }, []);

        if (!items || items.length === 0) {
          return null;
        }

        const handleBatchInsertAll = () => {
          const formatted = formatBatchItems(items);
          if (!formatted) return;
          insertIntoComposerDraft(ctx, sessionId, formatted, dockRef.current);
          store.clearItems();
        };

        const handleInsertSingle = (item) => {
          const formatted = formatQuoteAndComment(item.quote, item.comment);
          if (!formatted) return;
          insertIntoComposerDraft(ctx, sessionId, formatted, dockRef.current);
          store.removeItem(item.id);
        };

        return jsxRuntime.jsx("div", {
          ref: dockRef,
          "data-dsh-quote-dock": sessionId,
          children: jsxRuntime.jsxs("div", {
            className: "dsh-sq-dock-panel",
            role: "region",
            "aria-label": "引用与批注汇总栏",
            children: [
              jsxRuntime.jsxs("div", {
                className: "dsh-sq-dock-header",
                children: [
                  jsxRuntime.jsxs("div", {
                    className: "dsh-sq-dock-title",
                    children: [
                      jsxRuntime.jsx("span", { children: "引用与批注队列" }),
                      jsxRuntime.jsx("span", {
                        className: "dsh-sq-dock-badge",
                        children: String(items.length),
                      }),
                    ],
                  }),
                  jsxRuntime.jsxs("div", {
                    className: "dsh-sq-card-actions",
                    children: [
                      jsxRuntime.jsx("button", {
                        type: "button",
                        className: "dsh-sq-btn dsh-sq-btn-ghost",
                        "data-action": "clear-dock",
                        title: "清空全部待插入的引用与批注",
                        onClick: () => store.clearItems(),
                        children: "清空",
                      }),
                      jsxRuntime.jsx("button", {
                        type: "button",
                        className: "dsh-sq-btn dsh-sq-btn-primary",
                        "data-action": "batch-insert-all",
                        title: "将全部引用与批注格式化为 Markdown 一次性写入底部输入框",
                        onClick: handleBatchInsertAll,
                        children: "一键汇总插入输入框",
                      }),
                    ],
                  }),
                ],
              }),
              jsxRuntime.jsx("div", {
                className: "dsh-sq-dock-list",
                children: items.map((item, idx) => {
                  const isEditing = editingId === item.id;
                  return jsxRuntime.jsxs(
                    "div",
                    {
                      className: "dsh-sq-dock-item",
                      "data-dock-item-id": item.id,
                      children: [
                        jsxRuntime.jsxs("div", {
                          className: "dsh-sq-dock-item-body",
                          children: [
                            jsxRuntime.jsxs("div", {
                              className: "dsh-sq-dock-quote",
                              title: item.quote,
                              children: [`#${idx + 1} `, truncateQuotePreview(item.quote, 110)],
                            }),
                            isEditing
                              ? jsxRuntime.jsx("input", {
                                  type: "text",
                                  className: "dsh-sq-edit-input",
                                  "data-dock-edit-input": item.id,
                                  autoFocus: true,
                                  value: editingComment,
                                  placeholder: "输入批注内容，按 Enter 保存，Esc 取消…",
                                  onChange: (e) => store.setEditingComment(e.target.value),
                                  onBlur: () => store.commitEditing(),
                                  onKeyDown: (e) => {
                                    if (e.nativeEvent?.isComposing) return;
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      store.commitEditing();
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      store.cancelEditing();
                                    }
                                  },
                                })
                              : item.comment
                              ? jsxRuntime.jsxs("div", {
                                  className: "dsh-sq-dock-comment",
                                  title: "点击修改此条批注",
                                  onClick: () => store.startEditing(item.id),
                                  children: [
                                    jsxRuntime.jsx("strong", { children: "批注：" }),
                                    item.comment,
                                  ],
                                })
                              : jsxRuntime.jsx("div", {
                                  className: "dsh-sq-dock-comment-empty",
                                  title: "点击添加批注",
                                  onClick: () => store.startEditing(item.id),
                                  children: "点击添加批注说明…",
                                }),
                          ],
                        }),
                        jsxRuntime.jsxs("div", {
                          className: "dsh-sq-dock-item-actions",
                          children: [
                            jsxRuntime.jsx("button", {
                              type: "button",
                              className: "dsh-sq-icon-btn",
                              "data-action": "edit-dock-item",
                              title: "编辑批注",
                              onClick: () => store.startEditing(item.id),
                              children: "✎",
                            }),
                            jsxRuntime.jsx("button", {
                              type: "button",
                              className: "dsh-sq-icon-btn",
                              "data-action": "insert-single-dock-item",
                              title: "单独插入此条到输入框",
                              onClick: () => handleInsertSingle(item),
                              children: "↵",
                            }),
                            jsxRuntime.jsx("button", {
                              type: "button",
                              className: "dsh-sq-icon-btn",
                              "data-action": "remove-dock-item",
                              title: "删除此条",
                              onClick: () => store.removeItem(item.id),
                              children: "×",
                            }),
                          ],
                        }),
                      ],
                    },
                    item.id
                  );
                }),
              }),
            ],
          }),
        });
      };
    }

    const inject = ["slots", "locale", "sessions", "conversation"];
    const name = NS;

    function apply(ctx) {
      const SelectionQuoteOverlay = createSelectionOverlayComponent(ctx);
      const QuotesCommentsDock = createQuotesCommentsDockComponent(ctx);

      ctx.slots.inject("conversation.input.overlay", () =>
        ctx.slots.register(
          {
            name: "conversation.input.overlay",
            id: "selection-quote-overlay",
            order: 10,
            locale: NS,
            inject: (sessionId) => ({ sessionId }),
          },
          SelectionQuoteOverlay
        )
      );

      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "selection-quote-dock",
            order: -20,
            locale: NS,
            inject: (sessionId) => ({ sessionId }),
          },
          QuotesCommentsDock
        )
      );
    }

    return {
      name,
      inject,
      apply,
      getSessionStore,
      createSelectionQuoteStore,
      formatQuoteBlock,
      formatQuoteForChat,
      formatQuoteAndComment,
      formatBatchItems,
      truncateQuotePreview,
      computeToolbarPosition,
      isValidMessageSelection,
      insertIntoComposerDraft,
    };
  }

  if (typeof window !== "undefined" && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === "function") {
    window.__ModuleLoader__.load({
      id: MODULE_ID,
      factory: buildModule,
    });
  }

  if (typeof globalThis !== "undefined") {
    globalThis.__DSH_SELECTION_QUOTE_BUILD__ = buildModule;
  }
})();
