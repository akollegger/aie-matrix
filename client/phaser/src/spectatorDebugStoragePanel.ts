const POLL_INTERVAL_MS = 5_000;

export interface StoragePanelOptions {
  /** Base URL of the game server (e.g. http://localhost:8787). */
  serverBase: string;
  /** Bearer token — ghost-house API key. Sourced from SPECTATOR_DEBUG_TOKEN. */
  token: string | undefined;
  /** Returns current ghost IDs in the room for the dropdown. */
  getGhostIds: () => string[];
}

interface StoragePanelHandle {
  el: HTMLDivElement;
  /** Trigger an immediate fetch (also called on tab activate). */
  refresh: () => void;
  /** Stop the poll timer (called on tab deactivate / overlay destroy). */
  destroy: () => void;
}

// No `display` here — visibility is controlled by the overlay stylesheet via data-visible.
const panelCss = `
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
  min-height: 0;
`;

const controlsCss = `
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 4px 0 2px;
  flex-shrink: 0;
`;

const inputCss = `
  background: rgba(10, 25, 50, 0.9);
  border: 1px solid rgba(120, 180, 255, 0.3);
  border-radius: 4px;
  color: #d7ecff;
  font: inherit;
  font-size: 11px;
  padding: 2px 6px;
`;

const btnCss = `
  ${inputCss}
  cursor: pointer;
  background: rgba(40, 90, 160, 0.45);
  flex-shrink: 0;
`;

const resultCss = `
  flex: 1;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.35;
  font-size: 11px;
  color: #d7ecff;
  margin: 0;
  min-height: 0;
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = style;
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, v);
  }
  return e;
}

export function buildStoragePanel(opts: StoragePanelOptions): StoragePanelHandle {
  const { serverBase, token, getGhostIds } = opts;

  const container = el("div", panelCss);

  // Controls row
  const controls = el("div", controlsCss);

  const select = el("select", `${inputCss} flex: 1; min-width: 80px;`);
  const placeholderOpt = document.createElement("option");
  placeholderOpt.value = "";
  placeholderOpt.textContent = "— pick ghost —";
  select.appendChild(placeholderOpt);

  const endpointLabel = el("span", "color: #8aa4c8; white-space: nowrap; flex-shrink: 0;");
  endpointLabel.textContent = "/threads/";

  const fetchBtn = el("button", btnCss, { type: "button" });
  fetchBtn.textContent = "Fetch";

  const statusSpan = el("span", "color: #8aa4c8; font-size: 10px; flex-shrink: 0;");

  controls.append(endpointLabel, select, fetchBtn, statusSpan);

  const resultPre = el("pre", resultCss);
  resultPre.textContent = "Select a ghost and click Fetch.";

  container.append(controls, resultPre);

  let pollTimer: ReturnType<typeof setInterval> | undefined;

  function updateDropdown(): void {
    const ids = getGhostIds();
    const current = select.value;
    // Remove all non-placeholder options
    while (select.options.length > 1) {
      select.remove(1);
    }
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      select.appendChild(opt);
    }
    // Restore selection if still valid
    if (ids.includes(current)) {
      select.value = current;
    }
  }

  async function doFetch(): Promise<void> {
    const ghostId = select.value;
    if (!ghostId) {
      resultPre.textContent = "No ghost selected.";
      return;
    }
    if (!token) {
      resultPre.textContent = "No token — set SPECTATOR_DEBUG_TOKEN in your .env.";
      return;
    }

    statusSpan.textContent = "fetching…";
    try {
      const res = await fetch(`${serverBase}/threads/${encodeURIComponent(ghostId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      statusSpan.textContent = `${res.status} · ${new Date().toLocaleTimeString()}`;
      resultPre.textContent = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    } catch (err) {
      statusSpan.textContent = "error";
      resultPre.textContent = String(err);
    }
  }

  fetchBtn.addEventListener("click", () => void doFetch());

  function startPoll(): void {
    stopPoll();
    pollTimer = setInterval(() => {
      updateDropdown();
      void doFetch();
    }, POLL_INTERVAL_MS);
  }

  function stopPoll(): void {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  function refresh(): void {
    updateDropdown();
    void doFetch();
    startPoll();
  }

  function destroy(): void {
    stopPoll();
  }

  return { el: container, refresh, destroy };
}
