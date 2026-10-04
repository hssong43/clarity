import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "../lib/clipboard";

export function CopyButton({
  getText,
  label = "Copy",
  className = ""
}: {
  getText: () => string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`copy-button ${className}`}
      title={copied ? "Copied" : label}
      aria-label={copied ? "Copied" : label}
      onClick={() => {
        void copyText(getText()).then(setCopied);
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
