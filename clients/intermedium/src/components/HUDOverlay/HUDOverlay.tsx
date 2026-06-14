import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "../ChatPanel/ChatPanel.js";
import { LeaderboardPanel } from "../LeaderboardPanel/LeaderboardPanel.js";
import { ProfilePanel } from "../ProfilePanel/ProfilePanel.js";

type Tab = "chat" | "leaderboard" | "profile";

interface HUDOverlayProps {
  readonly leaderboardIds: string[];
  readonly humanGhostId: string | null;
  readonly worldApiUrl: string;
  readonly ghostClickRequest?: string | null;
  readonly onGhostClickHandled?: () => void;
  readonly onSelectedGhostChange?: (ghostId: string | null) => void;
}

const TAB_KEYS: Record<string, Tab> = {
  c: "chat",
  C: "chat",
  l: "leaderboard",
  L: "leaderboard",
  p: "profile",
  P: "profile",
};

const TOGGLE_KEYS = new Set(["`", "§", "~"]);

interface TabButtonProps {
  readonly label: string;
  readonly hint: string;
  readonly active: boolean;
  readonly onClick: () => void;
}

function TabButton({ label, hint, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        writingMode: "vertical-rl",
        textOrientation: "mixed",
        transform: "rotate(180deg)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "14px 8px",
        background: active
          ? "rgba(20, 35, 60, 0.92)"
          : "rgba(10, 18, 32, 0.75)",
        border: "none",
        color: active ? "rgba(200, 220, 255, 0.95)" : "rgba(140, 165, 200, 0.55)",
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "var(--tracking-label)",
        textTransform: "uppercase",
        transition: "background 0.15s, color 0.15s, border-color 0.15s",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.color = "rgba(180, 205, 240, 0.8)";
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(15, 26, 46, 0.88)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.color = "rgba(140, 165, 200, 0.55)";
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(10, 18, 32, 0.75)";
        }
      }}
    >
      <span style={{ opacity: 0.5, fontSize: 10 }}>{hint}</span>
      <span>{label}</span>
    </button>
  );
}

/**
 * Full-screen HUD overlay with a left-edge vertical tab strip.
 * Toggle: ` (backtick) or § key. Direct-open: C for chat, L for leaderboard. Esc closes.
 */
export function HUDOverlay({ leaderboardIds, humanGhostId, worldApiUrl, ghostClickRequest, onGhostClickHandled, onSelectedGhostChange }: HUDOverlayProps) {
  const [activeTab, setActiveTab] = useState<Tab | null>(null);

  const openTab = useCallback((tab: Tab) => {
    setActiveTab((cur) => (cur === tab ? null : tab));
  }, []);

  const close = useCallback(() => setActiveTab(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      if (TOGGLE_KEYS.has(e.key)) {
        e.preventDefault();
        // Toggle: if any tab is open close it; if none open, open chat
        setActiveTab((cur) => (cur !== null ? null : "chat"));
        return;
      }

      const tab = TAB_KEYS[e.key];
      if (tab) {
        e.preventDefault();
        openTab(tab);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, openTab]);

  return (
    // Full-screen transparent wrapper — pointer-events only on child elements
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
      }}
    >
      {/* Left vertical tab strip — always visible */}
      <div
        style={{
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 2,
        }}
      >
        <TabButton
          label="Profile"
          hint="P"
          active={activeTab === "profile"}
          onClick={() => openTab("profile")}
        />
        <TabButton
          label="Chat"
          hint="C"
          active={activeTab === "chat"}
          onClick={() => openTab("chat")}
        />
        <TabButton
          label="Board"
          hint="L"
          active={activeTab === "leaderboard"}
          onClick={() => openTab("leaderboard")}
        />
      </div>

      {/* Panel — fills remaining space beside the tab strip */}
      {/* ChatPanel is always mounted to preserve thread state across tab switches */}
      <div
        className="overlay-structure"
        style={{
          pointerEvents: "none",
          display: activeTab === "chat" ? "flex" : "none",
          flexDirection: "column",
          flex: 1,
          height: "100vh",
          overflow: "hidden",
        }}
      >
        <ChatPanel
          ghostClickRequest={ghostClickRequest}
          onGhostClickHandled={onGhostClickHandled}
          onSelectedGhostChange={onSelectedGhostChange}
        />
      </div>
      {activeTab === "profile" && (
        <div
          className="overlay-structure"
          style={{
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            flex: 1,
            height: "100vh",
            overflow: "hidden",
          }}
        >
          <ProfilePanel worldApiUrl={worldApiUrl} />
        </div>
      )}
      {activeTab === "leaderboard" && (
        <div
          className="overlay-structure"
          style={{
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            flex: 1,
            height: "100vh",
            overflow: "hidden",
          }}
        >
          <LeaderboardPanel
            leaderboardIds={leaderboardIds}
            humanGhostId={humanGhostId}
          />
        </div>
      )}
    </div>
  );
}
