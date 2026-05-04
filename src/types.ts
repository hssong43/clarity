export type VisionAction = "summarize" | "translate" | "analyze" | "ask";

export type ImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export type ChatImageAttachment = {
  mime: ImageMime;
  dataUrl: string;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  displayId?: string;
  name?: string;
  size?: number;
  source?: "screen" | "upload";
};

export type CapturedImage = {
  mime: "image/jpeg" | "image/webp";
  dataUrl: string;
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
  displayId: string;
};

export type TextAttachment = {
  name: string;
  mime: string;
  size: number;
  text: string;
  truncated: boolean;
};

export type VisionChatMessage = {
  role: "assistant" | "user";
  content: string;
  images?: ChatImageAttachment[];
  files?: TextAttachment[];
};

export type VisionChatRequest = {
  messages: VisionChatMessage[];
};

export type StreamStopReason =
  | "complete"
  | "length"
  | "content_filter"
  | "tool_use"
  | "error"
  | "unknown";

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reason: StreamStopReason; message?: string }
  | { type: "error"; message: string };
