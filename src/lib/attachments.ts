import type { CapturedImage, ChatImageAttachment, ImageMime, TextAttachment } from "../types";

export const MAX_PENDING_ATTACHMENTS = 6;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_CHARS = 20_000;

export type PendingAttachment =
  | {
      id: string;
      status: "reading";
      kind: "file";
      name: string;
      mime: string;
      size: number;
    }
  | {
      id: string;
      status: "ready";
      kind: "image";
      source: "screen" | "upload";
      name: string;
      mime: ImageMime;
      size?: number;
      images: ChatImageAttachment[];
    }
  | {
      id: string;
      status: "ready";
      kind: "text";
      name: string;
      mime: string;
      size: number;
      file: TextAttachment;
    }
  | {
      id: string;
      status: "error";
      kind: "error";
      name: string;
      mime: string;
      size: number;
      message: string;
    };

type FileKind = "image" | "pdf" | "docx" | "text";

const IMAGE_MIME_TYPES = new Set<ImageMime>(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "html",
  "htm",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "log",
  "sql",
  "rs",
  "py",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "go",
  "php",
  "rb",
  "swift",
  "kt",
  "sh",
  "ps1"
]);

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/xhtml+xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/toml",
  "application/sql"
]);

export function createAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `attachment-${Date.now()}-${Math.random()}`;
}

export function createReadingAttachment(file: File, id = createAttachmentId()): PendingAttachment {
  return {
    id,
    status: "reading",
    kind: "file",
    name: file.name || "Untitled file",
    mime: normalizeMime(file),
    size: file.size
  };
}

export function createScreenAttachment(images: CapturedImage[]): PendingAttachment {
  return {
    id: "screen-capture",
    status: "ready",
    kind: "image",
    source: "screen",
    name: "Screen",
    mime: images[0]?.mime ?? "image/jpeg",
    images: images.map((image, index) => ({
      ...image,
      name: images.length > 1 ? `Screen ${index + 1}` : "Screen",
      source: "screen" as const
    }))
  };
}

export async function resolveUploadAttachment(
  file: File,
  id = createAttachmentId()
): Promise<PendingAttachment> {
  const name = file.name || "Untitled file";
  const mime = normalizeMime(file);
  const size = file.size;

  if (size > MAX_FILE_BYTES) {
    return createErrorAttachment(id, name, mime, size, `Limit ${formatBytes(MAX_FILE_BYTES)}`);
  }

  const kind = classifyFile(file);
  if (!kind) {
    return createErrorAttachment(id, name, mime, size, "Unsupported file");
  }

  try {
    if (kind === "image") {
      const dataUrl = await readFileAsDataUrl(file);
      return {
        id,
        status: "ready",
        kind: "image",
        source: "upload",
        name,
        mime: mime as ImageMime,
        size,
        images: [{ mime: mime as ImageMime, dataUrl, name, size, source: "upload" }]
      };
    }

    const extracted =
      kind === "pdf"
        ? await extractPdfText(file)
        : kind === "docx"
          ? await extractDocxText(file)
          : await readFileAsText(file);
    const normalized = normalizeExtractedText(extracted);

    if (!normalized) {
      return createErrorAttachment(id, name, mime, size, "No selectable text");
    }

    const { text, truncated } = truncateExtractedText(normalized);
    return {
      id,
      status: "ready",
      kind: "text",
      name,
      mime,
      size,
      file: { name, mime, size, text, truncated }
    };
  } catch (error) {
    return createErrorAttachment(
      id,
      name,
      mime,
      size,
      error instanceof Error && error.message ? error.message : "Could not read file"
    );
  }
}

export function collectReadyAttachmentPayload(attachments: PendingAttachment[]): {
  images: ChatImageAttachment[];
  files: TextAttachment[];
  names: string[];
} {
  return attachments.reduce(
    (payload, attachment) => {
      if (attachment.status !== "ready") {
        return payload;
      }

      payload.names.push(attachment.name);
      if (attachment.kind === "image") {
        payload.images.push(...attachment.images);
      } else if (attachment.kind === "text") {
        payload.files.push(attachment.file);
      }
      return payload;
    },
    { images: [] as ChatImageAttachment[], files: [] as TextAttachment[], names: [] as string[] }
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
}

export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes("Files");
}

function classifyFile(file: File): FileKind | null {
  const mime = normalizeMime(file);
  const extension = getExtension(file.name);

  if (IMAGE_MIME_TYPES.has(mime as ImageMime)) return "image";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return "docx";
  }
  if (mime.startsWith("text/") || TEXT_MIME_TYPES.has(mime) || TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }

  return null;
}

function createErrorAttachment(
  id: string,
  name: string,
  mime: string,
  size: number,
  message: string
): PendingAttachment {
  return {
    id,
    status: "error",
    kind: "error",
    name,
    mime,
    size,
    message
  };
}

function normalizeMime(file: File): string {
  const type = file.type.trim().toLowerCase();
  if (type) return type;

  const extension = getExtension(file.name);
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (TEXT_EXTENSIONS.has(extension)) return "text/plain";
  return "application/octet-stream";
}

function getExtension(name: string): string {
  const match = /\.([^.]+)$/.exec(name.toLowerCase());
  return match?.[1] ?? "";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read image"));
      }
    });
    reader.addEventListener("error", () => reject(new Error("Could not read image")));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read text"));
      }
    });
    reader.addEventListener("error", () => reject(new Error("Could not read text")));
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read file"));
      }
    });
    reader.addEventListener("error", () => reject(new Error("Could not read file")));
    reader.readAsArrayBuffer(file);
  });
}

async function extractPdfText(file: File): Promise<string> {
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs?url")
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;

  const loadingTask = getDocument({
    data: new Uint8Array(await readFileAsArrayBuffer(file))
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: unknown) => (hasTextString(item) ? item.str : ""))
        .filter(Boolean)
        .join(" ");

      if (text.trim()) {
        pages.push(text.trim());
      }

      if (pages.join("\n\n").length >= MAX_EXTRACTED_TEXT_CHARS) {
        break;
      }
    }
  } finally {
    await pdf.destroy();
  }

  return pages.join("\n\n");
}

async function extractDocxText(file: File): Promise<string> {
  const mammothModule = (await import("mammoth")) as typeof import("mammoth") & {
    default?: typeof import("mammoth");
  };
  const mammoth = mammothModule.default ?? mammothModule;
  const result = await mammoth.extractRawText({ arrayBuffer: await readFileAsArrayBuffer(file) });
  return result.value;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateExtractedText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_TEXT_CHARS) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(0, MAX_EXTRACTED_TEXT_CHARS).trimEnd(),
    truncated: true
  };
}

function hasTextString(item: unknown): item is { str: string } {
  return typeof item === "object" && item !== null && "str" in item && typeof item.str === "string";
}
