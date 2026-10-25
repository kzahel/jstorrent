// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DETAIL_TABS } from "../inspection/tabs";
import { LocalizationProvider, message, setProductLocaleForTest, useProductLocale, localizeDocumentShell } from "./runtime";

afterEach(cleanup);

it("refreshes provider, helper and cached labels without replacing unfinished draft state", () => {
  function Draft() {
    const [draft, setDraft] = useState("");
    return <>
      <label>{message("localization.language.title")}<input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <span data-testid="tab">{DETAIL_TABS[0]!.label}</span>
    </>;
  }
  // The application root uses this subscription to create fresh elements while
  // keeping React's component identity and the inspection controller intact.
  function Root() {
    useProductLocale();
    return <LocalizationProvider><Draft /></LocalizationProvider>;
  }
  const restoreEnglish = setProductLocaleForTest("en");
  let restorePseudo: (() => void) | undefined;
  try {
    render(<Root />);
    fireEvent.change(screen.getByRole("textbox", { name: "draft" }), { target: { value: "unfinished text" } });
    const englishTab = screen.getByTestId("tab").textContent;
    document.head.innerHTML = '<title data-l10n-id="shell.app.title">JSTorrent</title>';
    localizeDocumentShell();
    document.title = "JSTorrent - ↓42 KB/s";
    act(() => { restorePseudo = setProductLocaleForTest("en-XA"); });
    expect(screen.getByRole("textbox", { name: "draft" }).getAttribute("value")).toBe("unfinished text");
    expect(screen.getByTestId("tab").textContent).not.toBe(englishTab);
    expect(screen.getByTestId("tab").textContent).toContain("⟦");
    expect(document.documentElement.lang).toBe("en-XA");
    expect(document.title).toBe("JSTorrent - ↓42 KB/s");
  } finally {
    act(() => { restorePseudo?.(); restoreEnglish(); });
  }
});
