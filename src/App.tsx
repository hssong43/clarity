import { useCallback, useState } from "react";
import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { HistoryPanel } from "./components/HistoryPanel";
import { PanelHeader } from "./components/PanelHeader";
import { PermissionNotice } from "./components/PermissionNotice";
import { Orb } from "./components/Orb";
import { ProfilePanel } from "./components/ProfilePanel";
import { ShortcutSettings } from "./components/ShortcutSettings";
import { useAttachments } from "./hooks/useAttachments";
import { useCaptureShortcuts } from "./hooks/useCaptureShortcuts";
import { useChatStream } from "./hooks/useChatStream";
import { useConversations } from "./hooks/useConversations";
import { useFileDrop } from "./hooks/useFileDrop";
import { useOverlayWindow } from "./hooks/useOverlayWindow";
import { usePointerGesture } from "./hooks/usePointerGesture";
import { useProfiles } from "./hooks/useProfiles";
import { useScreenCapturePermission } from "./hooks/useScreenCapturePermission";
import type { ProfileDraft } from "./lib/modelProfiles";

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
  const showOrb = state.mode === "IdleOrb" && (hasProfile || !showProfilePanel);

  useOverlayWindow(showOrb);

  const collapseToOrb = useCallback(() => {
    if (!hasProfile) {
      setShowProfilePanel(false);
    }
    dispatch({ type: "COLLAPSE" });
  }, [dispatch, hasProfile, setShowProfilePanel]);

  const expandFromOrb = useCallback(() => {
    if (!hasProfile) {
      setShowProfilePanel(true);
    }
    dispatch({ type: "EXPAND" });
  }, [dispatch, hasProfile, setShowProfilePanel]);

  const handleDroppedFiles = useCallback(
    (files: FileList) => {
      if (showOrb) {
        expandFromOrb();
      }
      attachFiles(files);
    },
    [attachFiles, expandFromOrb, showOrb]
  );
  const { isDropTarget, dropHandlers } = useFileDrop(handleDroppedFiles);

  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  /** Opens the panel for a capture. False when a profile still has to be set up first. */
  const revealForCapture = () => {
    if (!activeProfile || showProfilePanel) {
      expandFromOrb();
      return false;
    }
    if (state.mode === "IdleOrb") {
      dispatch({ type: "EXPAND" });
    }
    setComposerFocusRequest((request) => request + 1);
    return true;
  };

  const { shortcuts, shortcutError, updateShortcut } = useCaptureShortcuts((area) => {
    if (revealForCapture() && !isBusy) {
      void attachments.captureScreenAttachment(area);
    }
  });

  const { modifier, updateModifier } = usePointerGesture((event) => {
    if (!revealForCapture() || event.kind !== "region" || isBusy) {
      return;
    }
    if (event.error) {
      dispatch({ type: "FAIL", error: event.error });
    } else if (event.image) {
      attachments.attachCapturedImage(event.image);
    }
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

  if (showOrb) {
    return <Orb onExpand={expandFromOrb} />;
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
        onMinimize={collapseToOrb}
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
                modifier={modifier}
                onChange={(area, next) => void updateShortcut(area, next)}
                onModifierChange={updateModifier}
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
