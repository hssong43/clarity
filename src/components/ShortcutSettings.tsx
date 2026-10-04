import { useState } from "react";
import { Keyboard } from "lucide-react";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  shortcutFromKeyboardEvent,
  type CaptureArea,
  type CaptureShortcuts
} from "../lib/shortcuts";

const ROWS: Array<{ area: CaptureArea; label: string }> = [
  { area: "full", label: "Full-screen capture" },
  { area: "region", label: "Region capture" }
];

export function ShortcutSettings({
  shortcuts,
  error,
  onChange
}: {
  shortcuts: CaptureShortcuts;
  error: string | null;
  onChange: (area: CaptureArea, shortcut: string) => void;
}) {
  return (
    <section className="shortcut-settings" aria-label="Capture shortcuts">
      <div className="shortcut-row">
        <Keyboard size={15} aria-hidden="true" />
        <span className="shortcut-copy">
          <span>Capture shortcuts</span>
          <small>Open Clarity with the screen, or a selected region, attached.</small>
        </span>
      </div>
      {ROWS.map(({ area, label }) => (
        <ShortcutRow
          key={area}
          label={label}
          shortcut={shortcuts[area]}
          defaultShortcut={DEFAULT_SHORTCUTS[area]}
          onChange={(next) => onChange(area, next)}
        />
      ))}
      {error ? <p className="key-error">{error}</p> : null}
    </section>
  );
}

function ShortcutRow({
  label,
  shortcut,
  defaultShortcut,
  onChange
}: {
  label: string;
  shortcut: string;
  defaultShortcut: string;
  onChange: (shortcut: string) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);

  return (
    <div className="shortcut-row">
      <span className="shortcut-label">{label}</span>
      <input
        className="shortcut-input"
        readOnly
        aria-label={`${label} keys`}
        value={isRecording ? "Press keys…" : formatShortcut(shortcut)}
        onFocus={() => setIsRecording(true)}
        onBlur={() => setIsRecording(false)}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            return;
          }
          event.preventDefault();
          if (event.key === "Escape") {
            setIsRecording(false);
            event.currentTarget.blur();
            return;
          }
          const next = shortcutFromKeyboardEvent(event.nativeEvent);
          if (next) {
            setIsRecording(false);
            onChange(next);
            event.currentTarget.blur();
          }
        }}
      />
      {shortcut !== defaultShortcut ? (
        <button type="button" onClick={() => onChange(defaultShortcut)} title={`Reset ${label}`}>
          Reset
        </button>
      ) : null}
      {shortcut ? (
        <button type="button" onClick={() => onChange("")} title={`Turn off ${label}`}>
          Off
        </button>
      ) : null}
    </div>
  );
}
