import { useRef, useState } from "react";

import { message } from "../../localization/runtime";
import { buildDiagnostics, DIAGNOSTICS_FILENAME } from "../support/diagnostics";
import type { DesktopUpdaterSnapshot } from "../updater/types";
import { ExternalLink } from "./ExternalLink";
import styles from "./SettingsDialog.module.css";

export function SupportDiagnostics({ snapshot }: { readonly snapshot: DesktopUpdaterSnapshot }) {
  const [preview, setPreview] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<"copied" | "manual">();
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const previewGeneration = useRef(0);

  async function copy() {
    if (preview === undefined) return;
    const generation = previewGeneration.current;
    try {
      await navigator.clipboard.writeText(preview);
      if (generation === previewGeneration.current) setCopyStatus("copied");
    } catch {
      if (generation !== previewGeneration.current) return;
      previewRef.current?.focus();
      previewRef.current?.select();
      setCopyStatus("manual");
    }
  }

  function download() {
    if (preview === undefined) return;
    const url = URL.createObjectURL(new Blob([preview], { type: "application/json" }));
    const link = document.createElement("a");
    try {
      link.href = url;
      link.download = DIAGNOSTICS_FILENAME;
      link.hidden = true;
      document.body.append(link);
      link.click();
    } finally {
      link.remove();
      // The click consumes the URL in this task; release it in the next task.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  return (
    <fieldset className={styles.section}>
      <legend>{message("support.diagnostics.title")}</legend>
      <p className={styles.updatePrivacy}>{message("support.diagnostics.description")}</p>
      <div className={styles.updateActions}>
        <button type="button" onClick={() => { previewGeneration.current += 1; setPreview(buildDiagnostics(snapshot)); setCopyStatus(undefined); }}>
          {preview === undefined ? message("support.diagnostics.prepare") : message("support.diagnostics.refresh")}
        </button>
      </div>
      {preview === undefined ? null : (
        <div className={styles.diagnosticsPreview}>
          <label htmlFor="support-diagnostics-preview">{message("support.diagnostics.preview")}</label>
          <textarea id="support-diagnostics-preview" ref={previewRef} readOnly value={preview} rows={12} spellCheck={false} />
          <div className={styles.updateActions}>
            <button type="button" onClick={() => void copy()}>{message("support.diagnostics.copy")}</button>
            <button type="button" onClick={download}>{message("support.diagnostics.download")}</button>
          </div>
          <p role="status" className={styles.updatePrivacy}>
            {copyStatus === undefined ? null : copyStatus === "copied" ? message("support.diagnostics.copied") : message("support.diagnostics.manual")}
          </p>
        </div>
      )}
      <p className={styles.updatePrivacy}>{message("support.diagnostics.public.report")}</p>
      <div className={styles.updateActions}>
        <ExternalLink href="https://github.com/kzahel/rstorrent/issues">{message("support.known.issues")}</ExternalLink>
        <ExternalLink href="https://github.com/kzahel/rstorrent/issues/new">{message("support.report.problem")}</ExternalLink>
        <ExternalLink href="https://github.com/kzahel/rstorrent/blob/main/docs/user-support.md">{message("support.privacy.recovery")}</ExternalLink>
      </div>
    </fieldset>
  );
}
