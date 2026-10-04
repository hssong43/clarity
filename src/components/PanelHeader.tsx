import { History, KeyRound, Minimize2, SquarePen, Sparkles } from "lucide-react";
import type { ClarityMode } from "../lib/appState";
import { providerConfigs, type ModelProfile } from "../lib/modelProfiles";

export function PanelHeader({
  mode,
  activeProfile,
  isCapturingAttachment,
  onOpenProfiles,
  historyOpen = false,
  canSwitchConversation = true,
  onNewChat,
  onToggleHistory,
  onMinimize
}: {
  mode: ClarityMode;
  activeProfile: ModelProfile | null;
  isCapturingAttachment: boolean;
  onOpenProfiles: () => void;
  historyOpen?: boolean;
  canSwitchConversation?: boolean;
  onNewChat?: () => void;
  onToggleHistory?: () => void;
  onMinimize: () => void;
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
        {activeProfile && onNewChat ? (
          <button
            className="icon-button"
            type="button"
            onClick={onNewChat}
            disabled={!canSwitchConversation}
            title="New chat"
          >
            <SquarePen size={15} />
          </button>
        ) : null}
        {activeProfile && onToggleHistory ? (
          <button
            className={`icon-button ${historyOpen ? "is-active" : ""}`}
            type="button"
            onClick={onToggleHistory}
            aria-pressed={historyOpen}
            title="Chat history"
          >
            <History size={15} />
          </button>
        ) : null}
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
        <button className="icon-button" type="button" onClick={onMinimize} title="Collapse to orb">
          <Minimize2 size={15} />
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
