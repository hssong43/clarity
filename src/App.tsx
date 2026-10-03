import { useCallback } from "react";
import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { PanelHeader } from "./components/PanelHeader";
import { PermissionNotice } from "./components/PermissionNotice";
import { Pill } from "./components/Pill";
import { ProfilePanel } from "./components/ProfilePanel";
import { useAttachments } from "./hooks/useAttachments";
import { useChatStream } from "./hooks/useChatStream";
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

  const saveProfile = (draft: ProfileDraft) => {
    if (profiles.saveProfile(draft) && state.mode === "Error") {
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
            onSave={saveProfile}
            onSelectProfile={profiles.selectProfile}
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
            <Conversation
              state={state}
              isBusy={isBusy}
              isCapturingAttachment={isCapturingAttachment}
              onDismissError={() => dispatch({ type: "RESET_ERROR" })}
              onContinue={continueAnswer}
            />
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
              onRemoveAttachment={attachments.removeAttachment}
              onSend={sendQuestion}
              onStop={stopStreaming}
            />
          </>
        ) : null}
      </section>
    </main>
  );
}

export default App;
