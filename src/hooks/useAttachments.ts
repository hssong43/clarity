import { type Dispatch, useCallback, useState } from "react";
import type { ClarityEvent, ClarityMode } from "../lib/appState";
import {
  createReadingAttachment,
  createScreenAttachment,
  MAX_PENDING_ATTACHMENTS,
  resolveUploadAttachment,
  type PendingAttachment
} from "../lib/attachments";
import { captureScreens, type ScreenCapturePermission } from "../lib/tauri";

export function useAttachments({
  mode,
  dispatch,
  permission
}: {
  mode: ClarityMode;
  dispatch: Dispatch<ClarityEvent>;
  permission: ScreenCapturePermission;
}) {
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isCapturingAttachment, setIsCapturingAttachment] = useState(false);

  const isReadingAttachment = pendingAttachments.some(
    (attachment) => attachment.status === "reading"
  );
  const hasPendingScreen = pendingAttachments.some(isScreenAttachment);
  const hasReadyAttachments = pendingAttachments.some(
    (attachment) => attachment.status === "ready"
  );

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
      } else if (mode === "Error") {
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
    [dispatch, pendingAttachments.length, mode]
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
        ...current.filter((attachment) => !isScreenAttachment(attachment)),
        createScreenAttachment(images)
      ]);
      if (mode === "Error") {
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
    dispatch,
    hasPendingScreen,
    pendingAttachments.length,
    permission.granted,
    permission.supported,
    mode
  ]);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((current) => current.filter((candidate) => candidate.id !== id));
  }, []);

  const clearAttachments = useCallback(() => setPendingAttachments([]), []);

  return {
    pendingAttachments,
    isCapturingAttachment,
    isReadingAttachment,
    hasPendingScreen,
    hasReadyAttachments,
    attachFiles,
    captureScreenAttachment,
    removeAttachment,
    clearAttachments
  };
}

function isScreenAttachment(attachment: PendingAttachment): boolean {
  return (
    attachment.status === "ready" && attachment.kind === "image" && attachment.source === "screen"
  );
}
