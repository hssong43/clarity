import { describe, expect, it, vi } from "vitest";
import {
  collectReadyAttachmentPayload,
  createReadingAttachment,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_FILE_BYTES,
  resolveUploadAttachment
} from "./attachments";

vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?url", () => ({
  default: "/assets/pdf.worker.mjs"
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: "PDF selectable text" }] })
      }),
      destroy: vi.fn()
    })
  })
}));

vi.mock("mammoth", () => ({
  default: {
    extractRawText: vi.fn(async () => ({ value: "DOCX extracted text", messages: [] }))
  }
}));

describe("attachment parsing", () => {
  it("creates reading placeholders for dropped files", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const attachment = createReadingAttachment(file, "file-1");

    expect(attachment).toMatchObject({
      id: "file-1",
      status: "reading",
      name: "notes.txt",
      mime: "text/plain",
      size: 5
    });
  });

  it("accepts uploaded images as image attachments", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "diagram.png", { type: "image/png" });
    const attachment = await resolveUploadAttachment(file, "image-1");

    expect(attachment.status).toBe("ready");
    expect(attachment.kind).toBe("image");
    if (attachment.status === "ready" && attachment.kind === "image") {
      expect(attachment.images[0].mime).toBe("image/png");
      expect(attachment.images[0].dataUrl).toContain("data:image/png;base64,");
    }
  });

  it("extracts text files and truncates long content", async () => {
    const longText = "a".repeat(MAX_EXTRACTED_TEXT_CHARS + 50);
    const file = new File([longText], "large.md", { type: "text/markdown" });
    const attachment = await resolveUploadAttachment(file, "text-1");

    expect(attachment.status).toBe("ready");
    expect(attachment.kind).toBe("text");
    if (attachment.status === "ready" && attachment.kind === "text") {
      expect(attachment.file.text).toHaveLength(MAX_EXTRACTED_TEXT_CHARS);
      expect(attachment.file.truncated).toBe(true);
    }
  });

  it("extracts selectable PDF text", async () => {
    const file = new File(["%PDF"], "sample.pdf", { type: "application/pdf" });
    const attachment = await resolveUploadAttachment(file, "pdf-1");

    expect(attachment.status).toBe("ready");
    expect(attachment.kind).toBe("text");
    if (attachment.status === "ready" && attachment.kind === "text") {
      expect(attachment.file.text).toBe("PDF selectable text");
    }
  });

  it("extracts DOCX raw text", async () => {
    const file = new File(["docx"], "sample.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    const attachment = await resolveUploadAttachment(file, "docx-1");

    expect(attachment.status).toBe("ready");
    expect(attachment.kind).toBe("text");
    if (attachment.status === "ready" && attachment.kind === "text") {
      expect(attachment.file.text).toBe("DOCX extracted text");
    }
  });

  it("rejects oversized and unsupported files as failed chips", async () => {
    const oversized = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "huge.txt", {
      type: "text/plain"
    });
    const unsupported = new File(["data"], "sheet.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    await expect(resolveUploadAttachment(oversized, "large-1")).resolves.toMatchObject({
      status: "error",
      message: "Limit 10 MB"
    });
    await expect(resolveUploadAttachment(unsupported, "unsupported-1")).resolves.toMatchObject({
      status: "error",
      message: "Unsupported file"
    });
  });

  it("collects only ready image and text payloads", async () => {
    const image = await resolveUploadAttachment(
      new File(["img"], "image.webp", { type: "image/webp" }),
      "image-1"
    );
    const text = await resolveUploadAttachment(
      new File(["context"], "context.txt", { type: "text/plain" }),
      "text-1"
    );
    const failed = await resolveUploadAttachment(
      new File(["data"], "sheet.xlsx", { type: "application/vnd.ms-excel" }),
      "failed-1"
    );

    const payload = collectReadyAttachmentPayload([image, text, failed]);

    expect(payload.names).toEqual(["image.webp", "context.txt"]);
    expect(payload.images).toHaveLength(1);
    expect(payload.files).toHaveLength(1);
  });
});
