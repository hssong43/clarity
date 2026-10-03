import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { isFileDrag } from "../lib/attachments";

export function useFileDrop(onDropFiles: (files: FileList) => void) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const dragDepthRef = useRef(0);

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

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDropTarget(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
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

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setIsDropTarget(false);
      onDropFiles(event.dataTransfer.files);
    },
    [onDropFiles]
  );

  return { isDropTarget, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

export type FileDropHandlers = ReturnType<typeof useFileDrop>["dropHandlers"];
