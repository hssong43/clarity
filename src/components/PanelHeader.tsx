import { KeyRound, Minimize2, Sparkles, X } from "lucide-react";
import type { ClarityMode } from "../lib/appState";
import { providerConfigs, type ModelProfile } from "../lib/modelProfiles";

export function PanelHeader({
  mode,
  activeProfile,
  isCapturingAttachment,
  onOpenProfiles,
  onMinimize,
  onClose
}: {
  mode: ClarityMode;
  activeProfile: ModelProfile | null;
  isCapturingAttachment: boolean;
  onOpenProfiles: () => void;
  onMinimize: () => void;
  onClose: () => void;
}) {
  return (
    <header className="panel-header glass-header" data-tauri-drag-region="deep">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Sparkles size={15} />
        </span>
        <span className="brand-copy">
          <span className="brand-name">Clarity</span>
          <span className="brand-status">
            {statusLabel(mode, activeProfile, isCapturingAttachment)}
          </span>
        </span>
      </div>
      <div className="header-actions">
        {activeProfile ? (
          <button
            className="icon-button"
            type="button"
            onClick={onOpenProfiles}
            title="Model profiles"
          >
            <KeyRound size={15} />
          </button>
        ) : null}
        <button className="icon-button" type="button" onClick={onMinimize} title="Minimize to pill">
          <Minimize2 size={15} />
        </button>
        <button
          className="icon-button close-button"
          type="button"
          onClick={onClose}
          title="Close Clarity"
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}

function statusLabel(
  mode: string,
  activeProfile: ModelProfile | null,
  isCapturingAttachment = false
) {
  if (!activeProfile) return "Profile needed";
  if (isCapturingAttachment || mode === "Capturing") return "Capturing screen";
  if (mode === "Streaming") return "Answering";
  if (mode === "Error") return "Needs attention";
  return `${providerConfigs[activeProfile.provider].label} - ${activeProfile.model}`;
}
