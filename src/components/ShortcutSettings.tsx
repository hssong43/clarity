import { useState } from "react";
import { Keyboard } from "lucide-react";
import {
  DEFAULT_CAPTURE_SHORTCUT,
  formatShortcut,
  shortcutFromKeyboardEvent
} from "../lib/shortcuts";

export function ShortcutSettings({
  shortcut,
  error,
  onChange
}: {
  shortcut: string;
  error: string | null;
  onChange: (shortcut: string) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);

  return (
    <section className="shortcut-settings" aria-label="Capture shortcut">
      <div className="shortcut-row">
        <Keyboard size={15} aria-hidden="true" />
        <span className="shortcut-copy">
          <span>Capture shortcut</span>
          <small>Opens Clarity with the current screen attached.</small>
        </span>
      </div>
      <div className="shortcut-row">
        <input
          className="shortcut-input"
          readOnly
          aria-label="Capture shortcut keys"
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
        {shortcut !== DEFAULT_CAPTURE_SHORTCUT ? (
          <button type="button" onClick={() => onChange(DEFAULT_CAPTURE_SHORTCUT)}>
            Reset
          </button>
        ) : null}
        {shortcut ? (
          <button type="button" onClick={() => onChange("")}>
            Turn off
          </button>
        ) : null}
      </div>
      {error ? <p className="key-error">{error}</p> : null}
    </section>
  );
}
