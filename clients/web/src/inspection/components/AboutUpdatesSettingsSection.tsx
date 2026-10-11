import { useState } from "react";
import { message as localizedMessage } from "../../localization/runtime";
import { progressPercent } from "../updater/controller";
import { installPolicy } from "../updater/policy";
import type {
  DesktopUpdater,
  DesktopUpdaterSnapshot,
  UpdaterState,
} from "../updater/types";
import styles from "./SettingsDialog.module.css";
import { ExternalLink } from "./ExternalLink";
import { SupportDiagnostics } from "./SupportDiagnostics";

const RELEASES_URL = "https://github.com/kzahel/jstorrent/releases/latest";

export interface AboutUpdatesSettingsSectionProps {
  readonly updater: DesktopUpdater;
  readonly snapshot: DesktopUpdaterSnapshot;
}

export function AboutUpdatesSettingsSection({
  updater,
  snapshot,
}: AboutUpdatesSettingsSectionProps) {
  const { info, state } = snapshot;
  const policy = installPolicy(info.bundleType);
  const [commandCopyStatus, setCommandCopyStatus] = useState<"copied" | "failed">();
  return (
    <div className={styles.aboutUpdates}>
      <fieldset className={styles.section}>
        <legend>{localizedMessage("inspection.components.about.updates.settings.section.application")}</legend>
        <dl className={styles.releaseFacts}>
          <div>
            <dt>{localizedMessage("inspection.components.about.updates.settings.section.version")}</dt>
            <dd>{info.version}</dd>
          </div>
          <div>
            <dt>{localizedMessage("inspection.components.about.updates.settings.section.build")}</dt>
            <dd title={info.buildId}>{shortBuildId(info.buildId)}</dd>
          </div>
          <div>
            <dt>{localizedMessage("inspection.components.about.updates.settings.section.target")}</dt>
            <dd>{info.target}</dd>
          </div>
          <div>
            <dt>{localizedMessage("inspection.components.about.updates.settings.section.package")}</dt>
            <dd>{packageLabel(info.bundleType)}</dd>
          </div>
        </dl>
      </fieldset>

      <fieldset className={styles.section}>
        <legend>{localizedMessage("inspection.components.about.updates.settings.section.updates")}</legend>
        {updater.selectChannel !== undefined && ["app", "nsis", "appimage"].includes(info.bundleType) ? (
          <div className={styles.updateChannel}>
            <label htmlFor="desktop-update-channel">{localizedMessage("inspection.components.about.updates.settings.section.channel")}</label>
            <select
              id="desktop-update-channel"
              value={snapshot.channel ?? "stable"}
              disabled={snapshot.selectingChannel === true || state.phase === "checking" || isInstalling(state)}
              onChange={(event) => void updater.selectChannel?.(event.target.value as "stable" | "latest")}
            >
              <option value="stable">{localizedMessage("inspection.components.about.updates.settings.section.stable")}</option>
              <option value="latest">{localizedMessage("inspection.components.about.updates.settings.section.latest")}</option>
            </select>
            <p>{snapshot.channel === "latest"
              ? localizedMessage("inspection.components.about.updates.settings.section.latest.description")
              : localizedMessage("inspection.components.about.updates.settings.section.stable.description")}</p>
          </div>
        ) : null}
        <div className={styles.updateStatus} aria-live="polite">
          <strong>{statusTitle(state)}</strong>
          <span>{statusDetail(state, info.version)}</span>
        </div>
        {state.phase === "downloading" ? (
          <progress
            aria-label={localizedMessage("inspection.components.about.updates.settings.section.update.download.progress")}
            max={100}
            {...(progressPercent(state) === undefined
              ? {}
              : { value: progressPercent(state) })}
          />
        ) : null}
        {state.phase === "available" && state.notes ? (
          <div className={styles.releaseNotes}>
            <strong>{localizedMessage("inspection.components.about.updates.settings.section.release.notes")}</strong>
            <p>{state.notes}</p>
          </div>
        ) : null}
        {state.phase === "available" && state.manualApply !== undefined ? (
          <div className={styles.manualUpdate}>
            <strong>{localizedMessage("inspection.components.about.updates.settings.section.apply.from.a.shell.on.this.server")}</strong>
            <div className={styles.updateActions}>
              <button type="button" onClick={async () => {
                const command = state.manualApply?.command;
                if (command === undefined) return;
                try {
                  await navigator.clipboard.writeText(command);
                  setCommandCopyStatus("copied");
                } catch {
                  setCommandCopyStatus("failed");
                }
              }}>{localizedMessage("updates.copy-command")}</button>
            </div>
            <p role="status">{commandCopyStatus === undefined ? null : commandCopyStatus === "copied"
              ? localizedMessage("updates.command-copied")
              : localizedMessage("updates.command-copy-failed")}</p>
            <ExternalLink href={state.manualApply.releaseUrl}>{localizedMessage("inspection.components.about.updates.settings.section.review.signed.release")}</ExternalLink>
          </div>
        ) : null}
        <div className={styles.updateActions}>
          {policy.canCheck ? <button
            type="button"
            disabled={snapshot.selectingChannel === true || state.phase === "checking" || isInstalling(state)}
            onClick={() => void updater.check("manual")}
          >
            {state.phase === "checking" ? localizedMessage("inspection.components.about.updates.settings.section.checking") : localizedMessage("inspection.components.about.updates.settings.section.check.for.updates")}
          </button> : null}
          {policy.canInstallInApp && ((state.phase === "available" && state.manualApply === undefined) ||
          (state.phase === "error" && state.operation === "install")) ? (
            <button
              type="button"
              className={styles.primaryAction}
              disabled={isInstalling(state)}
              onClick={() => void updater.install()}
            >{localizedMessage("inspection.components.about.updates.settings.section.install.and.restart")}</button>
          ) : null}
          {state.phase === "manual-install" ? (
            <ExternalLink href={RELEASES_URL}>{localizedMessage("inspection.components.about.updates.settings.section.open.release.downloads")}</ExternalLink>
          ) : null}
        </div>
        {policy.canCheck ? <p className={styles.updatePrivacy}>{snapshot.channel === "latest"
          ? localizedMessage("inspection.components.about.updates.settings.section.checks.latest.schedule")
          : localizedMessage("inspection.components.about.updates.settings.section.rstorrent.checks.automatically.after.startup.and.about")} {info.checkPrivacy === "anonymous"
            ? localizedMessage("inspection.components.about.updates.settings.section.headless.checks.include.no.installation.identifier")
            : info.checkPrivacy === "preference-controlled"
              ? localizedMessage("inspection.components.about.updates.settings.section.checks.follow.the.usage.statistics.preference")
              : localizedMessage("inspection.components.about.updates.settings.section.checks.include.a.random.resettable.installation.identifier")}
        </p> : null}
      </fieldset>
      <SupportDiagnostics snapshot={snapshot} />
    </div>
  );
}

function statusTitle(state: UpdaterState): string {
  switch (state.phase) {
    case "idle":
      return localizedMessage("inspection.components.about.updates.settings.section.automatic.updates.enabled");
    case "checking":
      return localizedMessage("inspection.components.about.updates.settings.section.checking.for.updates");
    case "up-to-date":
      return localizedMessage("inspection.components.about.updates.settings.section.rstorrent.is.up.to.date");
    case "waiting-for-stable":
      return localizedMessage("inspection.components.about.updates.settings.section.waiting.for.stable");
    case "available":
      return `JSTorrent ${state.version} is available`;
    case "manual-install":
      return localizedMessage("inspection.components.about.updates.settings.section.manual.update.required");
    case "downloading":
      return `Downloading JSTorrent ${state.version}`;
    case "installing":
      return `Installing JSTorrent ${state.version}`;
    case "error":
      return state.operation === "check"
        ? "Update check failed"
        : "Update installation failed";
  }
}

function statusDetail(state: UpdaterState, currentVersion: string): string {
  switch (state.phase) {
    case "idle":
      return `Currently running ${currentVersion}.`;
    case "checking":
      return localizedMessage("inspection.components.about.updates.settings.section.contacting.the.rstorrent.update.service");
    case "up-to-date":
      return `Version ${currentVersion} is the newest compatible release.`;
    case "waiting-for-stable":
      return localizedMessage("inspection.components.about.updates.settings.section.waiting.for.stable.description");
    case "available":
      return state.manualApply === undefined
        ? "Installation happens only after you approve it."
        : "The browser checks the signed channel but cannot replace the running service.";
    case "manual-install":
      return `This ${state.packageLabel} stays with its package channel.`;
    case "downloading": {
      const percent = progressPercent(state);
      return percent === undefined
        ? `${formatBytes(state.downloadedBytes)} downloaded.`
        : `${percent}% · ${formatBytes(state.downloadedBytes)} downloaded.`;
    }
    case "installing":
      return localizedMessage("inspection.components.about.updates.settings.section.rstorrent.will.relaunch.after.installation.succeeds");
    case "error":
      return state.message;
  }
}

function isInstalling(state: UpdaterState): boolean {
  return state.phase === "downloading" || state.phase === "installing";
}

function shortBuildId(buildId: string): string {
  return buildId === "development" ? buildId : buildId.slice(0, 12);
}

function packageLabel(bundleType: DesktopUpdaterSnapshot["info"]["bundleType"]): string {
  switch (bundleType) {
    case "app":
      return localizedMessage("inspection.components.about.updates.settings.section.macos.app");
    case "nsis":
      return localizedMessage("inspection.components.about.updates.settings.section.windows.nsis");
    case "appimage":
      return localizedMessage("inspection.components.about.updates.settings.section.linux.appimage");
    case "msi":
      return localizedMessage("inspection.components.about.updates.settings.section.windows.msi");
    case "deb":
      return localizedMessage("inspection.components.about.updates.settings.section.linux.deb");
    case "rpm":
      return localizedMessage("inspection.components.about.updates.settings.section.linux.rpm");
    case "headless":
      return localizedMessage("inspection.components.about.updates.settings.section.linux.headless.service");
    case "unknown":
      return localizedMessage("inspection.components.about.updates.settings.section.development.build");
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
