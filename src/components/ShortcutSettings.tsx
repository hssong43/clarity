import { useState } from "react";
import { Keyboard, MousePointerClick } from "lucide-react";
import { modifierLabel, type PointerModifier } from "../lib/pointer";
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
  modifier,
  onChange,
  onModifierChange
}: {
  shortcuts: CaptureShortcuts;
  error: string | null;
  modifier: PointerModifier;
  onChange: (area: CaptureArea, shortcut: string) => void;
  onModifierChange: (modifier: PointerModifier) => void;
}) {
  return (
    <section className="shortcut-settings" aria-label="Capture shortcuts">
      <div className="shortcut-row">
        <MousePointerClick size={15} aria-hidden="true" />
        <span className="shortcut-copy">
          <span>Mouse key</span>
          <small>Hold it and click to open Clarity, or drag to attach that region.</small>
        </span>
      </div>
      <div className="modifier-choice" role="group" aria-label="Mouse key">
        {(["alt", "primary"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={modifier === option}
            onClick={() => onModifierChange(option)}
          >
            {modifierLabel(option)}
          </button>
        ))}
      </div>
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
