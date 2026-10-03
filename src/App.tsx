import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState
} from "react";
import {
  AlertCircle,
  Camera,
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Minimize2,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X
} from "lucide-react";
import type { VisionChatMessage } from "./types";
import { clarityReducer, initialClarityState } from "./lib/appState";
import {
  collectReadyAttachmentPayload,
  createReadingAttachment,
  createScreenAttachment,
  formatBytes,
  isFileDrag,
  MAX_PENDING_ATTACHMENTS,
  resolveUploadAttachment,
  type PendingAttachment
} from "./lib/attachments";
import {
  createProfileDraft,
  createProfileFromDraft,
  defaultProfileName,
  getActiveProfile,
  loadProfileState,
  persistProfileState,
  providerConfigs,
  providerIds,
  validateProfileDraft,
  type ModelProfile,
  type ProfileDraft,
  type ProfileState,
  type ProviderId
} from "./lib/modelProfiles";
import {
  bindOverlayPositionPersistence,
  captureScreens,
  closeOverlayWindow,
  getScreenCapturePermission,
  openScreenCaptureSettings,
  requestScreenCapturePermission,
  restoreOverlayPosition,
  setOverlayMode,
  isAbortError,
  startOverlayDrag,
  type ScreenCapturePermission
} from "./lib/tauri";
import { streamVisionChat } from "./lib/visionClient";

const PILL_DRAG_MOVE_PX = 4;
const CONTINUE_PROMPT =
  "Continue exactly from where you stopped. Do not restart or repeat previous text.";

function App() {
  const [state, dispatch] = useReducer(clarityReducer, initialClarityState);
  const [question, setQuestion] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isCapturingAttachment, setIsCapturingAttachment] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const conversationRef = useRef<HTMLElement | null>(null);
  const pillPressStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const pillDragStartedRef = useRef(false);
  const dragDepthRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>(() => loadProfileState());
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() =>
    createProfileDraft(getActiveProfile(loadProfileState()))
  );
  const [profileError, setProfileError] = useState<string | null>(null);
  const [showProfilePanel, setShowProfilePanel] = useState(
    () => !getActiveProfile(loadProfileState())
  );
  const [permission, setPermission] = useState<ScreenCapturePermission>({
    supported: false,
    granted: true,
    canRequest: false
  });

  const activeProfile = getActiveProfile(profileState);
  const hasProfile = Boolean(activeProfile);
  const isReadingAttachment = pendingAttachments.some(
    (attachment) => attachment.status === "reading"
  );
  const isBusy = state.mode === "Streaming" || isCapturingAttachment;
  const hasPendingScreen = pendingAttachments.some(
    (attachment) =>
      attachment.status === "ready" && attachment.kind === "image" && attachment.source === "screen"
  );
  const hasReadyAttachments = pendingAttachments.some(
    (attachment) => attachment.status === "ready"
  );
  const canSubmitQuestion =
    Boolean(question.trim() || hasReadyAttachments) && !isBusy && !isReadingAttachment;
  const showPill = state.mode === "IdlePill" && (hasProfile || !showProfilePanel);

  useEffect(() => () => streamAbortRef.current?.abort(), []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void restoreOverlayPosition();
    void bindOverlayPositionPersistence().then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const shouldUsePanel = !showPill;
    void setOverlayMode(shouldUsePanel ? "panel" : "pill");
  }, [showPill]);

  useEffect(() => {
    void getScreenCapturePermission()
      .then(setPermission)
      .catch(() => {
        setPermission({ supported: false, granted: true, canRequest: false });
      });
  }, []);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) {
      return;
    }

    conversation.scrollTop = conversation.scrollHeight;
  }, [state.messages, state.mode, state.partialAnswer]);

  useEffect(() => {
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (isFileDrag(event.dataTransfer)) {
        event.preventDefault();
      }
    };

    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  const commitProfileState = (nextState: ProfileState) => {
    persistProfileState(nextState);
    setProfileState(nextState);
  };

  const selectProfile = (profileId: string) => {
    const profile = profileState.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;

    commitProfileState({ ...profileState, activeProfileId: profile.id });
    setProfileDraft(createProfileDraft(profile));
    setProfileError(null);
  };

  const startNewProfile = () => {
    setProfileDraft(createProfileDraft(null));
    setProfileError(null);
    setShowProfilePanel(true);
  };

  const saveProfile = (draft: ProfileDraft) => {
    const error = validateProfileDraft(draft);
    if (error) {
      setProfileError(error);
      return;
    }

    const existing = profileState.profiles.find((profile) => profile.id === draft.id) ?? null;
    const savedProfile = createProfileFromDraft(draft, existing);
    const profiles = existing
      ? profileState.profiles.map((profile) =>
          profile.id === savedProfile.id ? savedProfile : profile
        )
      : [...profileState.profiles, savedProfile];
    const nextState = { profiles, activeProfileId: savedProfile.id };

    commitProfileState(nextState);
    setProfileDraft(createProfileDraft(savedProfile));
    setProfileError(null);
    setShowProfilePanel(false);

    if (state.mode === "Error") {
      dispatch({ type: "RESET_ERROR" });
    }
  };

  const deleteProfile = (profileId: string) => {
    const profiles = profileState.profiles.filter((profile) => profile.id !== profileId);
    const activeProfileId =
      profileState.activeProfileId === profileId
        ? (profiles[0]?.id ?? null)
        : profileState.activeProfileId;
    const nextState = { profiles, activeProfileId };
    const nextActiveProfile = getActiveProfile(nextState);

    commitProfileState(nextState);
    setProfileDraft(createProfileDraft(nextActiveProfile));
    setProfileError(null);
    setShowProfilePanel(!nextActiveProfile);
    dispatch({ type: "EXPAND" });
  };

  const changeDraftProvider = (provider: ProviderId) => {
    setProfileDraft((draft) => {
      const currentConfig = providerConfigs[draft.provider];
      const nextConfig = providerConfigs[provider];
      const shouldReplaceName = !draft.name.trim() || draft.name === currentConfig.label;

      return {
        ...draft,
        provider,
        name: shouldReplaceName ? defaultProfileName(provider) : draft.name,
        model: nextConfig.defaultModel
      };
    });
  };

  const attachFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) {
        return;
      }

      const availableSlots = Math.max(0, MAX_PENDING_ATTACHMENTS - pendingAttachments.length);
      if (availableSlots === 0) {
        dispatch({
          type: "FAIL",
          error: `Remove an attachment first. Clarity supports ${MAX_PENDING_ATTACHMENTS} at once.`
        });
        return;
      }

      const selectedFiles = files.slice(0, availableSlots);
      if (selectedFiles.length < files.length) {
        dispatch({
          type: "FAIL",
          error: `Only ${MAX_PENDING_ATTACHMENTS} attachments can be pending at once.`
        });
      } else if (state.mode === "Error") {
        dispatch({ type: "RESET_ERROR" });
      }

      const placeholders = selectedFiles.map((file) => createReadingAttachment(file));
      setPendingAttachments((current) => [...current, ...placeholders]);

      void Promise.all(
        selectedFiles.map((file, index) => resolveUploadAttachment(file, placeholders[index].id))
      ).then((resolvedAttachments) => {
        setPendingAttachments((current) =>
          current.map(
            (attachment) =>
              resolvedAttachments.find((resolved) => resolved.id === attachment.id) ?? attachment
          )
        );
      });
    },
    [pendingAttachments.length, state.mode]
  );

  const handleDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDropTarget(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDropTarget(false);
    }
  }, []);

  const collapseToPill = useCallback(() => {
    if (!hasProfile) {
      setShowProfilePanel(false);
    }
    dispatch({ type: "COLLAPSE" });
  }, [hasProfile]);

  const expandFromPill = useCallback(() => {
    if (!hasProfile) {
      setShowProfilePanel(true);
    }
    dispatch({ type: "EXPAND" });
  }, [hasProfile]);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setIsDropTarget(false);
      if (showPill) {
        expandFromPill();
      }
      attachFiles(event.dataTransfer.files);
    },
    [attachFiles, expandFromPill, showPill]
  );

  const captureScreenAttachment = useCallback(async () => {
    if (permission.supported && !permission.granted) {
      dispatch({
        type: "FAIL",
        error: "Screen recording permission is required on macOS."
      });
      return;
    }

    setIsCapturingAttachment(true);
    try {
      const images = await captureScreens();
      if (images.length === 0) {
        throw new Error("No screens were captured.");
      }

      if (!hasPendingScreen && pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
        throw new Error(
          `Remove an attachment first. Clarity supports ${MAX_PENDING_ATTACHMENTS} at once.`
        );
      }

      setPendingAttachments((current) => [
        ...current.filter(
          (attachment) =>
            !(
              attachment.status === "ready" &&
              attachment.kind === "image" &&
              attachment.source === "screen"
            )
        ),
        createScreenAttachment(images)
      ]);
      if (state.mode === "Error") {
        dispatch({ type: "RESET_ERROR" });
      }
    } catch (error) {
      dispatch({
        type: "FAIL",
        error: error instanceof Error ? error.message : "The screenshot could not be captured."
      });
    } finally {
      setIsCapturingAttachment(false);
    }
  }, [
    hasPendingScreen,
    pendingAttachments.length,
    permission.granted,
    permission.supported,
    state.mode
  ]);

  const sendChatMessage = useCallback(
    async (text: string, options: { includeAttachments?: boolean; visibleText?: string } = {}) => {
      if (!activeProfile) {
        dispatch({ type: "EXPAND" });
        setShowProfilePanel(true);
        dispatch({
          type: "FAIL",
          error: "Add a model profile before using Clarity."
        });
        return;
      }

      const includeAttachments = options.includeAttachments ?? true;
      const trimmedQuestion = text.trim();
      const attachmentPayload = includeAttachments
        ? collectReadyAttachmentPayload(pendingAttachments)
        : { images: [], files: [], names: [] };
      const fallbackQuestion =
        attachmentPayload.names.length > 0
          ? `Please review the attached ${attachmentPayload.names.length === 1 ? "item" : "items"}.`
          : "";
      const messageText = trimmedQuestion || fallbackQuestion;

      if (!messageText) {
        return;
      }

      const currentMessage: VisionChatMessage = {
        role: "user",
        content: messageText,
        images: attachmentPayload.images.length > 0 ? attachmentPayload.images : undefined,
        files: attachmentPayload.files.length > 0 ? attachmentPayload.files : undefined
      };
      const requestMessages = [...toProviderMessages(state.messages), currentMessage];
      const visibleMessage =
        attachmentPayload.names.length > 0
          ? `${messageText}\n\nAttached: ${attachmentPayload.names.join(", ")}`
          : messageText;

      dispatch({ type: "USER_MESSAGE", text: options.visibleText ?? visibleMessage });
      if (includeAttachments) {
        setPendingAttachments([]);
      }
      dispatch({ type: "STREAM_START" });
      const controller = new AbortController();
      streamAbortRef.current = controller;
      try {
        await streamVisionChat({
          profile: activeProfile,
          request: { messages: requestMessages },
          signal: controller.signal,
          onEvent(event) {
            if (event.type === "delta") {
              dispatch({ type: "STREAM_DELTA", text: event.text });
            } else if (event.type === "done") {
              dispatch({ type: "STREAM_DONE", reason: event.reason, message: event.message });
            } else {
              dispatch({ type: "FAIL", error: event.message });
            }
          }
        });
      } catch (error) {
        if (isAbortError(error)) {
          dispatch({ type: "STREAM_DONE", reason: "cancelled" });
        } else {
          dispatch({
            type: "FAIL",
            error: error instanceof Error ? error.message : "The request failed."
          });
        }
      } finally {
        if (streamAbortRef.current === controller) {
          streamAbortRef.current = null;
        }
      }
    },
    [activeProfile, pendingAttachments, state.messages]
  );

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  const continueAnswer = useCallback(() => {
    void sendChatMessage(CONTINUE_PROMPT, {
      includeAttachments: false,
      visibleText: "Continue"
    });
  }, [sendChatMessage]);

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    const text = question;
    setQuestion("");
    void sendChatMessage(text);
  };

  const startPillPress = (x: number, y: number, pointerId: number) => {
    pillPressStartRef.current = { x, y, pointerId };
    pillDragStartedRef.current = false;
  };

  const maybeStartPillDrag = (x: number, y: number) => {
    const start = pillPressStartRef.current;
    if (!start || pillDragStartedRef.current) {
      return;
    }

    if (Math.hypot(x - start.x, y - start.y) >= PILL_DRAG_MOVE_PX) {
      pillDragStartedRef.current = true;
      pillPressStartRef.current = null;
      void startOverlayDrag().catch(() => {
        pillDragStartedRef.current = false;
      });
    }
  };

  const finishPillPress = () => {
    const wasDrag = pillDragStartedRef.current;
    pillPressStartRef.current = null;
    pillDragStartedRef.current = false;
    if (!wasDrag) {
      expandFromPill();
    }
  };

  const cancelPillPress = () => {
    pillPressStartRef.current = null;
    pillDragStartedRef.current = false;
  };

  if (showPill) {
    return (
      <div
        className={`pill glass-pill ${isDropTarget ? "is-drop-target" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Clarity overlay"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          startPillPress(event.clientX, event.clientY, event.pointerId);
        }}
        onPointerMove={(event) => {
          maybeStartPillDrag(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (event.button !== 0) return;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          finishPillPress();
        }}
        onPointerCancel={cancelPillPress}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            expandFromPill();
          }
        }}
      >
        <span className="pill-glow" aria-hidden="true" />
        <span className="pill-mark" aria-hidden="true">
          <Sparkles size={15} />
        </span>
        <span className="pill-label">Clarity</span>
      </div>
    );
  }

  const showAssistant = Boolean(activeProfile) && !showProfilePanel;

  return (
    <main
      className={`panel glass-sheet ${showAssistant ? "assistant-shell" : "key-shell"} ${
        isDropTarget ? "is-drop-target" : ""
      }`}
      data-state={state.mode}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="panel-header glass-header" data-tauri-drag-region="deep">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Sparkles size={15} />
          </span>
          <span className="brand-copy">
            <span className="brand-name">Clarity</span>
            <span className="brand-status">
              {statusLabel(state.mode, activeProfile, isCapturingAttachment)}
            </span>
          </span>
        </div>
        <div className="header-actions">
          {activeProfile ? (
            <button
              className="icon-button"
              type="button"
              onClick={() => {
                setProfileDraft(createProfileDraft(activeProfile));
                setProfileError(null);
                setShowProfilePanel(true);
              }}
              title="Model profiles"
            >
              <KeyRound size={15} />
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            onClick={collapseToPill}
            title="Minimize to pill"
          >
            <Minimize2 size={15} />
          </button>
          <button
            className="icon-button close-button"
            type="button"
            onClick={() => void closeOverlayWindow()}
            title="Close Clarity"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <section className="panel-body">
        {showProfilePanel ? (
          <ProfilePanel
            activeProfileId={profileState.activeProfileId}
            draft={profileDraft}
            error={profileError}
            profiles={profileState.profiles}
            onCancel={() => {
              setProfileDraft(createProfileDraft(activeProfile));
              setProfileError(null);
              setShowProfilePanel(false);
            }}
            onDelete={deleteProfile}
            onDraft={setProfileDraft}
            onNewProfile={startNewProfile}
            onProvider={changeDraftProvider}
            onSave={saveProfile}
            onSelectProfile={selectProfile}
          />
        ) : null}

        {showAssistant && permission.supported && !permission.granted ? (
          <PermissionNotice
            canRequest={permission.canRequest}
            onRequest={() =>
              void requestScreenCapturePermission()
                .then(setPermission)
                .catch(() => openScreenCaptureSettings())
            }
            onOpenSettings={() => void openScreenCaptureSettings()}
          />
        ) : null}

        {showAssistant ? (
          <>
            <section
              ref={conversationRef}
              className="conversation response-surface"
              aria-live="polite"
              aria-busy={isBusy}
            >
              {state.messages.length === 0 && state.mode === "ExpandedReady" ? (
                <div className="empty-state">
                  <span className="empty-mark">
                    <Sparkles size={20} />
                  </span>
                  <p>Send a message, or attach the screen when you want visual context.</p>
                </div>
              ) : null}

              {state.messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  {message.content}
                </article>
              ))}

              {isCapturingAttachment ? (
                <StatusLine icon={<Loader2 size={16} className="spin" />} text="Capturing screen" />
              ) : null}
              {state.mode === "Streaming" ? (
                <article className="message assistant streaming">
                  {state.partialAnswer || (
                    <StatusLine icon={<Loader2 size={16} className="spin" />} text="Thinking" />
                  )}
                </article>
              ) : null}
              {state.mode === "Error" ? (
                <div className="error-box">
                  <AlertCircle size={16} />
                  <span>{state.error}</span>
                  <button type="button" onClick={() => dispatch({ type: "RESET_ERROR" })}>
                    OK
                  </button>
                </div>
              ) : null}
              {state.mode !== "Streaming" && state.lastStopReason === "length" ? (
                <div className="continuation-box">
                  <AlertCircle size={16} />
                  <span>
                    The provider stopped because it reached the output limit.
                    {state.lastStopMessage ? ` ${state.lastStopMessage}` : ""}
                  </span>
                  <button type="button" onClick={continueAnswer} disabled={isBusy}>
                    Continue
                  </button>
                </div>
              ) : null}
            </section>

            <div className="composer">
              {pendingAttachments.length > 0 ? (
                <div className="attachment-tray" aria-label="Pending attachments">
                  {pendingAttachments.map((attachment) => (
                    <AttachmentChip
                      key={attachment.id}
                      attachment={attachment}
                      onRemove={() =>
                        setPendingAttachments((current) =>
                          current.filter((candidate) => candidate.id !== attachment.id)
                        )
                      }
                    />
                  ))}
                </div>
              ) : null}
              <form className="ask-form input-dock" onSubmit={submitQuestion}>
                <button
                  className={`attach-button ${hasPendingScreen ? "is-active" : ""}`}
                  type="button"
                  disabled={isBusy || (permission.supported && !permission.granted)}
                  onClick={() => void captureScreenAttachment()}
                  title={hasPendingScreen ? "Replace screen attachment" : "Attach current screen"}
                >
                  {isCapturingAttachment ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Camera size={15} />
                  )}
                </button>
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder={
                    hasReadyAttachments ? "Ask about the attachments" : "Message Clarity"
                  }
                  disabled={isBusy}
                />
                {state.mode === "Streaming" ? (
                  <button
                    className="send-button"
                    type="button"
                    onClick={stopStreaming}
                    title="Stop"
                    aria-label="Stop"
                  >
                    <Square size={13} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    type="submit"
                    disabled={!canSubmitQuestion}
                    title="Send"
                  >
                    <Send size={15} />
                  </button>
                )}
              </form>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

function AttachmentChip({
  attachment,
  onRemove
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const details = attachmentChipDetails(attachment);

  return (
    <div className={`attachment-chip ${details.className}`} title={details.title}>
      {details.icon}
      <span>{details.label}</span>
      {details.meta ? <small>{details.meta}</small> : null}
      <button type="button" onClick={onRemove} title={`Remove ${attachment.name}`}>
        <X size={13} />
      </button>
    </div>
  );
}

function attachmentChipDetails(attachment: PendingAttachment): {
  icon: React.ReactNode;
  label: string;
  meta: string;
  className: string;
  title: string;
} {
  if (attachment.status === "reading") {
    return {
      icon: <Loader2 size={14} className="spin" />,
      label: attachment.name,
      meta: "reading",
      className: "is-reading",
      title: `${attachment.name} - reading ${formatBytes(attachment.size)}`
    };
  }

  if (attachment.status === "error") {
    return {
      icon: <AlertCircle size={14} />,
      label: attachment.name,
      meta: attachment.message,
      className: "is-error",
      title: `${attachment.name} - ${attachment.message}`
    };
  }

  if (attachment.kind === "image") {
    const isScreen = attachment.source === "screen";
    return {
      icon: isScreen ? <Camera size={14} /> : <ImageIcon size={14} />,
      label: isScreen ? "Screen attached" : attachment.name,
      meta: isScreen
        ? attachment.images.length > 1
          ? `${attachment.images.length} screens`
          : "screen"
        : attachment.size
          ? formatBytes(attachment.size)
          : "",
      className: isScreen ? "is-screen" : "is-image",
      title: isScreen ? "Current screen attachment" : `${attachment.name} - ${attachment.mime}`
    };
  }

  return {
    icon: <FileText size={14} />,
    label: attachment.name,
    meta: `${formatBytes(attachment.size)}${attachment.file.truncated ? ", truncated" : ""}`,
    className: attachment.file.truncated ? "is-truncated" : "is-text",
    title: `${attachment.name} - ${attachment.mime}`
  };
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

function toProviderMessages(
  messages: Array<{ role: "assistant" | "user" | "system"; content: string }>
): VisionChatMessage[] {
  return messages.flatMap((message) =>
    message.role === "assistant" || message.role === "user"
      ? [{ role: message.role, content: message.content }]
      : []
  );
}

type ProfilePanelProps = {
  activeProfileId: string | null;
  draft: ProfileDraft;
  error: string | null;
  profiles: ModelProfile[];
  onCancel: () => void;
  onDelete: (profileId: string) => void;
  onDraft: (value: ProfileDraft | ((value: ProfileDraft) => ProfileDraft)) => void;
  onNewProfile: () => void;
  onProvider: (provider: ProviderId) => void;
  onSave: (draft: ProfileDraft) => void;
  onSelectProfile: (profileId: string) => void;
};

function ProfilePanel({
  activeProfileId,
  draft,
  error,
  profiles,
  onCancel,
  onDelete,
  onDraft,
  onNewProfile,
  onProvider,
  onSave,
  onSelectProfile
}: ProfilePanelProps) {
  const canSubmit = Boolean(draft.name.trim() && draft.apiKey.trim() && draft.model.trim());
  const config = providerConfigs[draft.provider];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) {
      onSave(draft);
    }
  };

  return (
    <form className="key-panel glass-card" onSubmit={submit}>
      <span className="key-mark" aria-hidden="true">
        <KeyRound size={20} />
      </span>
      <div className="key-heading">
        <h1 className="key-title">Model profiles</h1>
        <p className="key-copy">Save keys for OpenAI, Claude, and Gemini.</p>
      </div>

      <ProfileCards
        activeProfileId={activeProfileId}
        editingProfileId={draft.id}
        profiles={profiles}
        onNewProfile={onNewProfile}
        onSelectProfile={onSelectProfile}
      />

      <ProviderSelector selectedProvider={draft.provider} onProvider={onProvider} />

      <label className="field-label">
        Name
        <input
          value={draft.name}
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
          placeholder="Work profile"
        />
      </label>

      <label className="field-label">
        API key
        <input
          value={draft.apiKey}
          onChange={(event) => onDraft({ ...draft, apiKey: event.target.value })}
          type="password"
          placeholder={config.keyPlaceholder}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <ModelSelector
        model={draft.model}
        provider={draft.provider}
        onModel={(model) => onDraft({ ...draft, model })}
      />

      <div className="key-actions">
        <button type="submit" disabled={!canSubmit}>
          Save
        </button>
        <button type="button" onClick={onNewProfile} title="New profile">
          <Plus size={15} />
        </button>
        {activeProfileId ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {draft.id ? (
          <button
            className="danger-button"
            type="button"
            onClick={() => onDelete(draft.id!)}
            title="Delete profile"
          >
            <Trash2 size={15} />
          </button>
        ) : null}
      </div>
      {error ? <p className="key-error">{error}</p> : null}
    </form>
  );
}

function ProviderSelector({
  selectedProvider,
  onProvider
}: {
  selectedProvider: ProviderId;
  onProvider: (provider: ProviderId) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedConfig = providerConfigs[selectedProvider];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const selectProvider = (provider: ProviderId) => {
    onProvider(provider);
    setIsOpen(false);
  };

  return (
    <section className="field-label provider-dropdown-field" aria-label="Provider">
      Provider
      <div className="provider-dropdown" ref={rootRef}>
        <button
          className="provider-dropdown-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="provider-dropdown-copy">
            <span>{selectedConfig.label}</span>
            <small>{selectedConfig.defaultModel}</small>
          </span>
          <ChevronDown className={isOpen ? "is-open" : ""} size={16} aria-hidden="true" />
        </button>

        {isOpen ? (
          <div className="provider-dropdown-menu" role="listbox">
            {providerIds.map((provider) => {
              const config = providerConfigs[provider];
              const isSelected = provider === selectedProvider;

              return (
                <button
                  key={provider}
                  className={`provider-dropdown-option ${isSelected ? "is-selected" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => selectProvider(provider)}
                >
                  <span className="provider-dropdown-copy">
                    <span>{config.label}</span>
                    <small>{config.defaultModel}</small>
                  </span>
                  {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ModelSelector({
  model,
  provider,
  onModel
}: {
  model: string;
  provider: ProviderId;
  onModel: (model: string) => void;
}) {
  const config = providerConfigs[provider];

  return (
    <section className="field-label model-field" aria-label="Model">
      Model
      <input
        value={model}
        onChange={(event) => onModel(event.target.value)}
        placeholder={config.defaultModel}
        spellCheck={false}
      />
      <div className="model-preset-grid" aria-label={`${config.label} model presets`}>
        {config.modelOptions.map((option) => {
          const isSelected = option === model;

          return (
            <button
              key={option}
              className={`model-preset ${isSelected ? "is-selected" : ""}`}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onModel(option)}
            >
              <span>{option}</span>
              {isSelected ? <Check size={12} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ProfileCards({
  activeProfileId,
  editingProfileId,
  profiles,
  onNewProfile,
  onSelectProfile
}: {
  activeProfileId: string | null;
  editingProfileId: string | null;
  profiles: ModelProfile[];
  onNewProfile: () => void;
  onSelectProfile: (profileId: string) => void;
}) {
  return (
    <section className="profile-card-section" aria-label="Model profiles">
      <div className="profile-card-grid">
        {profiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          const isEditing = profile.id === editingProfileId;

          return (
            <button
              key={profile.id}
              className={`profile-card ${isActive ? "is-active" : ""} ${
                isEditing ? "is-editing" : ""
              }`}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelectProfile(profile.id)}
            >
              <span className="profile-card-main">
                <span className="profile-card-name">{profile.name}</span>
                <span className="profile-card-provider">
                  {providerConfigs[profile.provider].label}
                </span>
                <span className="profile-card-model">{profile.model}</span>
              </span>
              {isActive ? (
                <span className="profile-card-check" aria-label="Active profile">
                  <Check size={13} />
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          className={`profile-card profile-card-new ${editingProfileId ? "" : "is-editing"}`}
          type="button"
          onClick={onNewProfile}
        >
          <span className="profile-card-main">
            <span className="profile-card-name">New profile</span>
            <span className="profile-card-provider">Add provider key</span>
            <span className="profile-card-model">OpenAI, Claude, Gemini, OpenRouter</span>
          </span>
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function PermissionNotice({
  canRequest,
  onRequest,
  onOpenSettings
}: {
  canRequest: boolean;
  onRequest: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="notice permission">
      <AlertCircle size={16} />
      <span>Screen recording permission is required.</span>
      <button type="button" onClick={canRequest ? onRequest : onOpenSettings}>
        Open settings
      </button>
    </div>
  );
}

function StatusLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="status-line">
      {icon}
      <span>{text}</span>
    </div>
  );
}

export default App;
