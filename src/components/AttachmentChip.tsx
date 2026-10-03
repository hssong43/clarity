import type { ReactNode } from "react";
import { AlertCircle, Camera, FileText, Image as ImageIcon, Loader2, X } from "lucide-react";
import { formatBytes, type PendingAttachment } from "../lib/attachments";

export function AttachmentChip({
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
  icon: ReactNode;
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
