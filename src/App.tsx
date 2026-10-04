import { useCallback, useState } from "react";
import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { HistoryPanel } from "./components/HistoryPanel";
import { PanelHeader } from "./components/PanelHeader";
import { PermissionNotice } from "./components/PermissionNotice";
import { Pill } from "./components/Pill";
import { ProfilePanel } from "./components/ProfilePanel";
import { ShortcutSettings } from "./components/ShortcutSettings";
import { useAttachments } from "./hooks/useAttachments";
import { useCaptureShortcuts } from "./hooks/useCaptureShortcuts";
import { useChatStream } from "./hooks/useChatStream";
import { useConversations } from "./hooks/useConversations";
import { useFileDrop } from "./hooks/useFileDrop";
import { useOverlayWindow } from "./hooks/useOverlayWindow";
import { useProfiles } from "./hooks/useProfiles";
import { useScreenCapturePermission } from "./hooks/useScreenCapturePermission";
import type { ProfileDraft } from "./lib/modelProfiles";
import { closeOverlayWindow } from "./lib/tauri";

function App() {
  const profiles = useProfiles();
  const { activeProfile, showProfilePanel, setShowProfilePanel } = profiles;
  const { state, dispatch, sendChatMessage, stopStreaming, continueAnswer } = useChatStream({
    activeProfile,
    onMissingProfile: profiles.openProfileSetup
  });
  const history = useConversations({ messages: state.messages, mode: state.mode, dispatch });
  const [showHistory, setShowHistory] = useState(false);
  const { permission, requestPermission, openSettings } = useScreenCapturePermission();
  const attachments = useAttachments({ mode: state.mode, dispatch, permission });
  const { attachFiles, isCapturingAttachment, pendingAttachments } = attachments;

  const hasProfile = Boolean(activeProfile);
  const isBusy = state.mode === "Streaming" || isCapturingAttachment;
  const showPill = state.mode === "IdlePill" && (hasProfile || !showProfilePanel);

  useOverlayWindow(showPill);

  const collapseToPill = useCallback(() => {
    if (!hasProfile) {
      setShowProfilePanel(false);
    }
    dispatch({ type: "COLLAPSE" });
  }, [dispatch, hasProfile, setShowProfilePanel]);

  const expandFromPill = useCallback(() => {
    if (!hasProfile) {
      setShowProfilePanel(true);
    }
    dispatch({ type: "EXPAND" });
  }, [dispatch, hasProfile, setShowProfilePanel]);

  const handleDroppedFiles = useCallback(
    (files: FileList) => {
      if (showPill) {
        expandFromPill();
      }
      attachFiles(files);
    },
    [attachFiles, expandFromPill, showPill]
  );
  const { isDropTarget, dropHandlers } = useFileDrop(handleDroppedFiles);

  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const { shortcuts, shortcutError, updateShortcut } = useCaptureShortcuts((area) => {
    if (!activeProfile || showProfilePanel) {
      expandFromPill();
      return;
    }
    if (state.mode === "IdlePill") {
      dispatch({ type: "EXPAND" });
    }
    if (!isBusy) {
      void attachments.captureScreenAttachment(area);
    }
    setComposerFocusRequest((request) => request + 1);
  });

  const saveProfile = async (draft: ProfileDraft) => {
    if ((await profiles.saveProfile(draft)) && state.mode === "Error") {
      dispatch({ type: "RESET_ERROR" });
    }
  };

  const deleteProfile = (profileId: string) => {
    profiles.deleteProfile(profileId);
    dispatch({ type: "EXPAND" });
  };

  const sendQuestion = (text: string) => {
    void sendChatMessage(text, {
      attachments: pendingAttachments,
      onAttachmentsSent: attachments.clearAttachments
    });
  };

  if (showPill) {
    return (
      <Pill isDropTarget={isDropTarget} dropHandlers={dropHandlers} onExpand={expandFromPill} />
    );
  }

  const showAssistant = Boolean(activeProfile) && !showProfilePanel;
  const needsPermission = permission.supported && !permission.granted;

  return (
    <main
      className={`panel glass-sheet ${showAssistant ? "assistant-shell" : "key-shell"} ${
        isDropTarget ? "is-drop-target" : ""
      }`}
      data-state={state.mode}
      {...dropHandlers}
    >
      <PanelHeader
        mode={state.mode}
        activeProfile={activeProfile}
        isCapturingAttachment={isCapturingAttachment}
        onOpenProfiles={profiles.editActiveProfile}
        historyOpen={showHistory}
        canSwitchConversation={history.canSwitch}
        onNewChat={() => {
          history.startNew();
          setShowHistory(false);
        }}
        onToggleHistory={() => setShowHistory((open) => !open)}
        onMinimize={collapseToPill}
        onClose={() => void closeOverlayWindow()}
      />

      <section className="panel-body">
        {showProfilePanel ? (
          <ProfilePanel
            activeProfileId={profiles.profileState.activeProfileId}
            draft={profiles.profileDraft}
            error={profiles.profileError}
            profiles={profiles.profileState.profiles}
            onCancel={profiles.cancelProfileEdit}
            onDelete={deleteProfile}
            onDraft={profiles.setProfileDraft}
            onNewProfile={profiles.startNewProfile}
            onProvider={profiles.changeDraftProvider}
            onSave={(draft) => void saveProfile(draft)}
            onSelectProfile={profiles.selectProfile}
            footer={
              <ShortcutSettings
                shortcuts={shortcuts}
                error={shortcutError}
                onChange={(area, next) => void updateShortcut(area, next)}
              />
            }
          />
        ) : null}

        {showAssistant && needsPermission ? (
          <PermissionNotice
            canRequest={permission.canRequest}
            onRequest={requestPermission}
            onOpenSettings={openSettings}
          />
        ) : null}

        {showAssistant ? (
          <>
            {showHistory ? (
              <HistoryPanel
                conversations={history.conversations}
                currentId={history.currentId}
                canSwitch={history.canSwitch}
                onOpen={(id) => {
                  history.open(id);
                  setShowHistory(false);
                }}
                onDelete={history.remove}
                onClearAll={history.clearAll}
              />
            ) : (
              <Conversation
                state={state}
                isBusy={isBusy}
                isCapturingAttachment={isCapturingAttachment}
                onDismissError={() => dispatch({ type: "RESET_ERROR" })}
                onContinue={continueAnswer}
              />
            )}
            <Composer
              pendingAttachments={pendingAttachments}
              hasPendingScreen={attachments.hasPendingScreen}
              hasReadyAttachments={attachments.hasReadyAttachments}
              isReadingAttachment={attachments.isReadingAttachment}
              isCapturingAttachment={isCapturingAttachment}
              isBusy={isBusy}
              isStreaming={state.mode === "Streaming"}
              captureDisabled={needsPermission}
              onCapture={() => void attachments.captureScreenAttachment()}
              onCaptureRegion={() => void attachments.captureScreenAttachment("region")}
              onRemoveAttachment={attachments.removeAttachment}
              onSend={sendQuestion}
              onStop={stopStreaming}
              focusRequest={composerFocusRequest}
            />
          </>
        ) : null}
      </section>
    </main>
  );
}

export default App;
