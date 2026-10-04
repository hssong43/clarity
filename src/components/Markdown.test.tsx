import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../lib/clipboard";
import { openExternalUrl } from "../lib/tauri";
import { Markdown } from "./Markdown";

vi.mock("../lib/tauri", () => ({ openExternalUrl: vi.fn(async () => undefined) }));
vi.mock("../lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));

beforeEach(() => {
  vi.mocked(openExternalUrl).mockClear();
  vi.mocked(copyText).mockClear();
});

describe("Markdown", () => {
  it("renders GitHub-flavored markdown", () => {
    const { container } = render(
      <Markdown
        text={"## Summary\n\n- **Revenue** up\n- Costs down\n\n| A | B |\n|---|---|\n| 1 | 2 |"}
      />
    );

    expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("strong")).toHaveTextContent("Revenue");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("does not render raw HTML from model output", () => {
    const { container } = render(
      <Markdown text={'Hi <img src=x onerror="alert(1)"> <script>alert(1)</script>'} />
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens http links externally and drops javascript: URLs", () => {
    render(<Markdown text={"[docs](https://example.com/a) and [bad](javascript:alert(1))"} />);

    fireEvent.click(screen.getByText("docs"));
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/a");

    const bad = screen.getByText("bad");
    expect(bad.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
    fireEvent.click(bad);
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
  });

  it("copies code blocks", async () => {
    render(<Markdown text={"```ts\nconst x = 1;\n```"} />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy code" })));

    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("const x = 1;"));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
