import { useEffect, useState } from "react";

interface NavHintProps {
  visible: boolean;
}

export function NavHint({ visible }: NavHintProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!visible || dismissed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=" || e.key === "Escape") {
        setDismissed(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, dismissed]);

  if (!visible || dismissed) return null;

  return (
    <div className="flex items-center gap-3 bg-surface border border-border rounded px-3 py-2 shadow-lg">
      <span className="font-mono text-sm text-text-faint tracking-[--tracking-label]">
        + / = zoom in · Esc back
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss hint"
        className="font-mono text-base text-text-faint hover:text-text-dim cursor-pointer bg-transparent border-0 leading-none p-0 ml-1"
      >
        ×
      </button>
    </div>
  );
}
