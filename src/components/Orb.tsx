import { Sparkles } from "lucide-react";

/**
 * The idle overlay: a small orb that follows the cursor. The native window ignores
 * the mouse, so the click handler only serves keyboard use and the browser dev server.
 */
export function Orb({ onExpand }: { onExpand: () => void }) {
  return (
    <div
      className="orb"
      role="button"
      tabIndex={0}
      aria-label="Clarity overlay"
      onClick={onExpand}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onExpand();
        }
      }}
    >
      <Sparkles size={17} aria-hidden="true" />
    </div>
  );
}
