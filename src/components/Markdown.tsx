import { type ComponentProps, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openExternalUrl } from "../lib/tauri";
import { CopyButton } from "./CopyButton";

function CodeBlock(props: ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const { children, ...rest } = props;
  delete (rest as { node?: unknown }).node;

  return (
    <div className="code-block">
      <pre ref={preRef} {...rest}>
        {children}
      </pre>
      <CopyButton
        className="code-copy"
        label="Copy code"
        getText={() => (preRef.current?.textContent ?? "").replace(/\n$/, "")}
      />
    </div>
  );
}

const components: Components = {
  pre: CodeBlock,
  // Links open in the default browser; following them would replace the overlay UI.
  a: ({ href, children }) => (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        if (href) void openExternalUrl(href);
      }}
    >
      {children}
    </a>
  ),
  // Remote images are blocked by the CSP anyway; show the alt text instead.
  img: ({ alt }) => (alt ? <span className="markdown-image-alt">[{alt}]</span> : null)
};

/** Renders model output as GitHub-flavored Markdown. Raw HTML is not rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
