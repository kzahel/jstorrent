import { useEffect, useRef, useState } from "react";
import { extensionSupport, onExtensionStatisticsChanged } from "../../extension-support";

import { message } from "../../localization/runtime";
import { startupTimings } from "../../startup-timing";
import type { SupportFacts } from "../support/about";
import { buildDiagnostics, DIAGNOSTICS_FILENAME } from "../support/diagnostics";
import {
  feedbackPageUrl,
  GITHUB_ISSUES_URL,
  githubIssueUrl,
  SUPPORT_PAGE_URL,
} from "../support/report-links";
import { ExternalLink } from "./ExternalLink";
import { Icon } from "./Icon";
import { useToast } from "./Toast";
import styles from "./SettingsDialog.module.css";

export function SupportDiagnostics({ facts }: { readonly facts: SupportFacts }) {
  const [preview, setPreview] = useState<string>();
  const [manualCopy, setManualCopy] = useState(false);
  const [extensionFeedback, setExtensionFeedback] = useState<string>();
  const baseFeedback = feedbackPageUrl(facts);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      void extensionSupport("feedback").then(url => {
        if (!active || current !== generation || !url) return;
        const report = new URL(url);
        if (report.searchParams.has("surface")) {
          const host = new URL(baseFeedback);
          for (const key of ["v", "build", "target", "package", "connection"]) {
            const value = host.searchParams.get(key);
            if (value) report.searchParams.set(key === "v" ? "hostv" : key, value);
          }
        }
        setExtensionFeedback(report.href);
      });
    };
    let unsubscribe = () => {};
    setExtensionFeedback(undefined);
    if (facts.about.connection === "android-companion" || facts.about.connection === "desktop-companion") {
      refresh();
      unsubscribe = onExtensionStatisticsChanged(refresh);
    }
    return () => { active = false; unsubscribe(); };
  }, [facts.about.connection, baseFeedback]);
  const toast = useToast();
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const previewGeneration = useRef(0);
  const reportFacts = { ...facts, startup: startupTimings() };

  async function copy() {
    if (preview === undefined) return;
    const generation = previewGeneration.current;
    try {
      await navigator.clipboard.writeText(preview);
      if (generation === previewGeneration.current) {
        setManualCopy(false);
        toast.show({ message: message("support.diagnostics.copied") });
      }
    } catch {
      if (generation !== previewGeneration.current) return;
      previewRef.current?.focus();
      previewRef.current?.select();
      setManualCopy(true);
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
        <button type="button" onClick={() => { previewGeneration.current += 1; setPreview(buildDiagnostics(reportFacts)); setManualCopy(false); }}>
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
          {manualCopy ? (
            <p role="status" className={styles.updatePrivacy}>{message("support.diagnostics.manual")}</p>
          ) : null}
        </div>
      )}
      <div className={styles.updateActions}>
        <ExternalLink href={githubIssueUrl(reportFacts)}><Icon name="github" />{message("support.report.github")}</ExternalLink>
        <ExternalLink href={extensionFeedback ?? feedbackPageUrl(reportFacts)}>{message("support.report.feedback")}</ExternalLink>
        <ExternalLink href={GITHUB_ISSUES_URL}>{message("support.known.issues")}</ExternalLink>
        <ExternalLink href={SUPPORT_PAGE_URL}>{message("support.help")}</ExternalLink>
      </div>
    </fieldset>
  );
}
