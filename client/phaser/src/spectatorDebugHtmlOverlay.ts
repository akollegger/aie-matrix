import type { SpectatorDebugLogRing } from "./spectatorDebugTelemetry.js";
import type { StoragePanelOptions } from "./spectatorDebugStoragePanel.js";
import { buildStoragePanel } from "./spectatorDebugStoragePanel.js";

type TabId = "state" | "log" | "storage";

interface TabDef {
  id: TabId;
  label: string;
  panel: HTMLElement;
  /** Called when the tab becomes active. */
  onActivate: () => void;
  /** Called when the tab is deactivated. */
  onDeactivate?: () => void;
}

const css = `
:host {
  all: initial;
  font-family: ui-monospace, Menlo, Monaco, monospace;
  font-size: 11px;
  color: #d7ecff;
  display: block;
  pointer-events: auto;
}
.wrap {
  background: rgba(0, 12, 28, 0.92);
  border: 1px solid rgba(120, 180, 255, 0.35);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.45);
  width: 100%;
  box-sizing: border-box;
  height: min(38vh, 320px);
  display: flex;
  flex-direction: column;
}
.tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(120, 180, 255, 0.25);
  background: rgba(0, 8, 20, 0.95);
}
.tab {
  flex: 1;
  padding: 6px 10px;
  cursor: pointer;
  border: none;
  background: transparent;
  color: #8aa4c8;
  font: inherit;
}
.tab:hover {
  color: #cfe6ff;
}
.tab[data-active="true"] {
  color: #fff;
  background: rgba(40, 90, 160, 0.35);
}
.panel {
  display: none;
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 8px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.35;
}
.panel[data-visible="true"] {
  display: block;
}
.panel[data-visible="true"][data-layout="flex"] {
  display: flex;
}
`;

/**
 * Fixed HTML overlay (State / Log / Storage tabs). Attached under `document.body` with `position: fixed`.
 */
export class SpectatorDebugHtmlOverlay {
  private readonly shadow: ShadowRoot;
  private readonly tabs: TabDef[];
  private active: TabId = "state";
  private unsubLog?: () => void;

  constructor(
    private readonly logRing: SpectatorDebugLogRing,
    private readonly getStateText: () => string,
    storageOptions: StoragePanelOptions,
  ) {
    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;width:100vw;max-width:100%;z-index:1000000;pointer-events:auto;box-sizing:border-box;padding:0;";
    this.shadow = root.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    this.shadow.appendChild(style);

    const wrap = document.createElement("div");
    wrap.className = "wrap";

    const tabBar = document.createElement("div");
    tabBar.className = "tabs";
    tabBar.setAttribute("role", "tablist");

    // --- State panel ---
    const statePre = document.createElement("pre");
    statePre.className = "panel";
    statePre.setAttribute("role", "tabpanel");

    // --- Log panel ---
    const logPre = document.createElement("pre");
    logPre.className = "panel";
    logPre.setAttribute("role", "tabpanel");

    // --- Storage panel ---
    const { el: storageEl, refresh: refreshStorage, destroy: destroyStorage } = buildStoragePanel(storageOptions);
    storageEl.className = "panel";
    storageEl.dataset.layout = "flex";
    storageEl.setAttribute("role", "tabpanel");

    const refreshState = () => { statePre.textContent = this.getStateText(); };
    const refreshLog = () => {
      logPre.textContent = this.logRing.snapshot().join("\n");
      logPre.scrollTop = logPre.scrollHeight;
    };

    this.tabs = [
      { id: "state", label: "State", panel: statePre, onActivate: refreshState },
      { id: "log", label: "Log", panel: logPre, onActivate: refreshLog },
      {
        id: "storage", label: "Storage", panel: storageEl,
        onActivate: refreshStorage,
        onDeactivate: destroyStorage,
      },
    ];

    // Build tab buttons and panels
    for (const def of this.tabs) {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.textContent = def.label;
      btn.setAttribute("role", "tab");
      btn.dataset.active = def.id === this.active ? "true" : "false";
      btn.dataset.tabId = def.id;
      btn.addEventListener("click", () => this.selectTab(def.id));
      tabBar.appendChild(btn);

      def.panel.dataset.visible = def.id === this.active ? "true" : "false";
      wrap.appendChild(def.panel);
    }

    wrap.prepend(tabBar);
    this.shadow.appendChild(wrap);
    document.body.appendChild(root);

    refreshState();
    refreshLog();

    this.unsubLog = this.logRing.subscribe(() => {
      if (this.active === "log") {
        refreshLog();
      }
    });
  }

  private selectTab(tab: TabId): void {
    const prev = this.tabs.find((t) => t.id === this.active);
    prev?.onDeactivate?.();

    this.active = tab;

    for (const def of this.tabs) {
      const isActive = def.id === tab;
      def.panel.dataset.visible = isActive ? "true" : "false";
      const btn = this.shadow.querySelector<HTMLButtonElement>(`button[data-tab-id="${def.id}"]`);
      if (btn) btn.dataset.active = isActive ? "true" : "false";
      if (isActive) def.onActivate();
    }
  }

  refreshState(): void {
    if (this.active === "state") {
      const def = this.tabs.find((t) => t.id === "state");
      def?.onActivate();
    }
  }

  /** Call when Colyseus state changes (same cadence as the old Phaser text HUD). */
  onRoomStateChanged(): void {
    this.refreshState();
  }

  destroy(): void {
    this.unsubLog?.();
    this.unsubLog = undefined;
    // Stop storage polling if active
    const storageDef = this.tabs.find((t) => t.id === "storage");
    storageDef?.onDeactivate?.();
    this.shadow.host.remove();
  }
}
