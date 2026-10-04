import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CapturedImage } from "../types";
import type { RegionSelection } from "./region";
import type { PointerModifier } from "./pointer";
import type { CaptureArea } from "./shortcuts";

export type OverlayMode = "orb" | "panel";

export type ScreenCapturePermission = {
  supported: boolean;
  granted: boolean;
  canRequest: boolean;
};

export type NativeAuthScheme = "bearer" | "xApiKey" | "xGoogApiKey";

export type NativeHttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers: Array<[string, string]>;
  body: string;
  /** Have the native layer attach the profile's API key from the OS keychain. */
  auth?: { profileId: string; scheme: NativeAuthScheme };
};

type NativeHttpStreamRequest = NativeHttpRequest & {
  requestId: string;
};

type NativeHttpStreamEvent = {
  requestId: string;
  kind: "chunk" | "done" | "error";
  bytes?: number[];
  message?: string;
};

const NATIVE_HTTP_STREAM_EVENT = "clarity-native-http-stream";
const CAPTURE_SHORTCUT_EVENT = "clarity-capture-shortcut";
const REGION_RESULT_EVENT = "clarity-region-captured";
const POINTER_CAPTURE_EVENT = "clarity-pointer-capture";

export type RegionPreview = {
  displayId: string;
  dataUrl: string;
  width: number;
  height: number;
  isDefault: boolean;
};

type RegionResult = { image: CapturedImage | null; error: string | null };

/** Modifier + click, or modifier + drag with the dragged region already cropped. */
export type PointerCaptureEvent =
  { kind: "click" } | { kind: "region"; image: CapturedImage | null; error: string | null };

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function captureScreens(): Promise<CapturedImage[]> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri desktop runtime is required for screen capture.");
  }
  return invoke<CapturedImage[]>("capture_screens");
}

/**
 * Opens the region selector and resolves with the cropped image, or null when
 * the user cancels.
 */
export async function captureRegion(): Promise<CapturedImage | null> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri desktop runtime is required for screen capture.");
  }

  let unlisten: (() => void) | undefined;
  try {
    const result = await new Promise<RegionResult>((resolve, reject) => {
      void listen<RegionResult>(REGION_RESULT_EVENT, ({ payload }) => resolve(payload))
        .then((nextUnlisten) => {
          unlisten = nextUnlisten;
          return invoke("start_region_capture");
        })
        .catch(reject);
    });
    if (result.error) {
      throw new Error(result.error);
    }
    return result.image;
  } finally {
    unlisten?.();
  }
}

export async function getRegionPreviews(): Promise<RegionPreview[]> {
  return invoke<RegionPreview[]>("region_capture_previews");
}

export async function finishRegionCapture(
  displayId: string | null,
  selection: RegionSelection | null
): Promise<void> {
  await invoke("finish_region_capture", { displayId, selection });
}

export async function setOverlayMode(mode: OverlayMode): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("set_overlay_mode", { mode });
}

export type NativeGlassKind = "none" | "liquid" | "vibrancy" | "acrylic";

/** The OS material the window sits on; "none" outside Tauri or when unsupported. */
export async function getNativeGlassKind(): Promise<NativeGlassKind> {
  if (!isTauriRuntime()) {
    return "none";
  }
  return invoke<NativeGlassKind>("native_glass_kind").catch(() => "none" as const);
}

export async function getScreenCapturePermission(): Promise<ScreenCapturePermission> {
  if (!isTauriRuntime()) {
    return { supported: false, granted: true, canRequest: false };
  }
  return invoke<ScreenCapturePermission>("screen_capture_permission_status");
}

export async function requestScreenCapturePermission(): Promise<ScreenCapturePermission> {
  if (!isTauriRuntime()) {
    return { supported: false, granted: true, canRequest: false };
  }
  return invoke<ScreenCapturePermission>("request_screen_capture_permission");
}

export async function openScreenCaptureSettings(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("open_screen_capture_settings");
}

export async function startOverlayDrag(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await getCurrentWindow().startDragging();
}

/** Opens an http(s) link in the default browser instead of navigating the overlay. */
export async function openExternalUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    return;
  }
  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** Registers both global capture shortcuts; "" disables one. */
export async function setCaptureShortcuts(full: string, region: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("set_capture_shortcuts", { full, region });
}

/** Chooses which key turns a click or drag into a Clarity gesture. */
export async function setPointerModifier(modifier: PointerModifier): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("set_pointer_modifier", { modifier });
}

export async function onPointerCapture(
  handler: (event: PointerCaptureEvent) => void
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return listen<PointerCaptureEvent>(POINTER_CAPTURE_EVENT, ({ payload }) => handler(payload));
}

export async function onCaptureShortcut(handler: (area: CaptureArea) => void): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return listen<{ area: CaptureArea }>(CAPTURE_SHORTCUT_EVENT, ({ payload }) =>
    handler(payload.area)
  );
}

/** Stores the key in the OS keychain. Resolves false when that is unavailable. */
export async function storeApiKey(profileId: string, apiKey: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  try {
    await invoke("set_api_key", { profileId, apiKey });
    return true;
  } catch {
    return false;
  }
}

export async function deleteStoredApiKey(profileId: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("delete_api_key", { profileId }).catch(() => undefined);
}

export async function streamNativeHttp(
  request: NativeHttpRequest,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri desktop runtime is required for provider requests.");
  }

  const requestId = crypto.randomUUID();
  const streamRequest: NativeHttpStreamRequest = { ...request, requestId };
  const decoder = new TextDecoder();
  let streamError: string | null = null;

  const unlisten = await listen<NativeHttpStreamEvent>(NATIVE_HTTP_STREAM_EVENT, ({ payload }) => {
    if (payload.requestId !== requestId || signal?.aborted) {
      return;
    }

    if (payload.kind === "chunk" && payload.bytes) {
      const text = decoder.decode(new Uint8Array(payload.bytes), { stream: true });
      if (text) {
        onChunk(text);
      }
    } else if (payload.kind === "error") {
      streamError = payload.message ?? "The provider stream failed.";
    }
  });

  const cancel = () => {
    void invoke("cancel_http_request", { requestId }).catch(() => undefined);
  };

  try {
    if (signal?.aborted) {
      throw createAbortError();
    }
    signal?.addEventListener("abort", cancel, { once: true });

    await invoke("stream_http_request", { request: streamRequest });
    if (signal?.aborted) {
      throw createAbortError();
    }

    const flushed = decoder.decode();
    if (flushed) {
      onChunk(flushed);
    }

    if (streamError) {
      throw new Error(streamError);
    }
  } catch (error) {
    if (signal?.aborted) {
      throw isAbortError(error) ? error : createAbortError();
    }
    throw new Error(error instanceof Error ? error.message : String(error), {
      cause: error
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
    unlisten();
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function createAbortError(): DOMException {
  return new DOMException("The request was cancelled.", "AbortError");
}
