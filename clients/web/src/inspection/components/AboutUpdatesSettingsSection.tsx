import { formatNumber, message as localizedMessage } from "../../localization/runtime";
import { productFlavor, type AboutConnection, type AboutFacts, type ProductFlavor } from "../support/about";
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
import { useToast } from "./Toast";

const RELEASES_URL = "https://github.com/kzahel/jstorrent/releases/latest";

export interface AboutUpdatesSettingsSectionProps {
  readonly about: AboutFacts;
  readonly updater?: DesktopUpdater | undefined;
  readonly snapshot?: DesktopUpdaterSnapshot | undefined;
}

/** About facts and support on every host; update controls only with an updater. */
export function AboutUpdatesSettingsSection({
  about,
  updater,
  snapshot,
}: AboutUpdatesSettingsSectionProps) {
  const info = snapshot?.info;
  const version = info?.version ?? about.hostVersion;
  const build = info?.buildId ?? about.hostBuild;
  const target = info?.target ?? about.hostTarget;
  const flavor = about.identifier === undefined ? undefined : productFlavor(about.identifier);
  return (
    <div className={styles.aboutUpdates}>
      <fieldset className={styles.section}>
        <legend>{localizedMessage("inspection.components.about.updates.settings.section.application")}</legend>
        <dl className={styles.releaseFacts}>
          {about.connection === undefined ? null : (
            <div>
              <dt>{localizedMessage("inspection.components.about.updates.settings.section.connection")}</dt>
              <dd className={styles.plainFact}>{connectionLabel(about.connection)}</dd>
            </div>
          )}
          <div>
            <dt>{localizedMessage("inspection.components.about.updates.settings.section.version")}</dt>
            {version === undefined
              ? <dd className={styles.plainFact}>{localizedMessage("inspection.components.about.updates.settings.section.not.reported")}</dd>
              : <dd>{version}</dd>}
          </div>
          {build === undefined ? null : (
            <div>
              <dt>{localizedMessage("inspection.components.about.updates.settings.section.build")}</dt>
              <dd title={build}>{shortBuildId(build)}</dd>
            </div>
          )}
          {target === undefined ? null : (
            <div>
              <dt>{localizedMessage("inspection.components.about.updates.settings.section.target")}</dt>
              <dd>{target}</dd>
            </div>
          )}
          {info === undefined ? null : (
            <div>
              <dt>{localizedMessage("inspection.components.about.updates.settings.section.package")}</dt>
              <dd>{packageLabel(info.bundleType)}</dd>
            </div>
          )}
          {about.pageBuild === undefined ? null : (
            <div>
              <dt>{localizedMessage("inspection.components.about.updates.settings.section.page.build")}</dt>
              <dd title={about.pageBuild}>{shortBuildId(about.pageBuild)}</dd>
            </div>
          )}
        </dl>
      </fieldset>

      {about.identifier === undefined && about.profileLocation === undefined ? null : (
        <fieldset className={styles.section}>
          <legend>{localizedMessage("inspection.components.about.updates.settings.section.profile")}</legend>
          <dl className={styles.releaseFacts}>
            {about.identifier === undefined || flavor === undefined ? null : (
              <>
                <div>
                  <dt>{localizedMessage("inspection.components.about.updates.settings.section.build.type")}</dt>
                  <dd className={styles.plainFact}>{flavorLabel(flavor)}</dd>
                </div>
                <div>
                  <dt>{localizedMessage("inspection.components.about.updates.settings.section.app.id")}</dt>
                  <dd>{about.identifier}</dd>
                </div>
              </>
            )}
            {about.profileLocation === undefined ? null : (
              <div>
                <dt>{localizedMessage("inspection.components.about.updates.settings.section.profile.location")}</dt>
                <dd>{about.profileLocation}</dd>
              </div>
            )}
          </dl>
          {flavor === undefined || flavor === "production" ? null : (
            <p className={styles.updatePrivacy}>{localizedMessage("inspection.components.about.updates.settings.section.separate.library")}</p>
          )}
        </fieldset>
      )}

      {updater === undefined || snapshot === undefined ? null : (
        <UpdatesFieldset updater={updater} snapshot={snapshot} />
      )}
      <SupportDiagnostics facts={{ about, updater: snapshot }} />
    </div>
  );
}

function UpdatesFieldset({
  updater,
  snapshot,
}: {
  readonly updater: DesktopUpdater;
  readonly snapshot: DesktopUpdaterSnapshot;
}) {
  const { info, state } = snapshot;
  const policy = installPolicy(info.bundleType);
  const toast = useToast();
  return (
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
      {updater.setAutomaticUpdates !== undefined && policy.canInstallInApp ? (
        <label><input type="checkbox" checked={snapshot.automaticUpdates ?? false}
          onChange={event => void updater.setAutomaticUpdates?.(event.target.checked)} />
          {localizedMessage("updates.automatic-install")}
        </label>
      ) : null}
      <div className={styles.updateStatus} aria-live="polite">
        <strong>{state.phase === "idle" && snapshot.automaticAvailable === false ? localizedMessage("updates.automatic-awaiting-qualification") : state.phase === "idle" && snapshot.automaticUpdates === false ? localizedMessage("updates.automatic-install-off") : statusTitle(state)}</strong>
        <span>{snapshot.updateMessage === undefined
          ? statusDetail(state, info)
          : hostUpdateDetail(snapshot.updateMessage, info.version)}</span>
        {snapshot.lastOutcome === undefined ? null : <span>{localizedMessage("updates.last-outcome", {
          message: hostUpdateDetail(snapshot.lastOutcome.message, snapshot.lastOutcome.version),
        })}</span>}
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
                toast.show({ message: localizedMessage("updates.command-copied") });
              } catch {
                toast.show({ tone: "error", message: localizedMessage("updates.command-copy-failed") });
              }
            }}>{localizedMessage("updates.copy-command")}</button>
          </div>
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
  );
}

function connectionLabel(connection: AboutConnection): string {
  switch (connection) {
    case "desktop":
      return localizedMessage("inspection.components.about.updates.settings.section.connection.desktop");
    case "server":
      return localizedMessage("inspection.components.about.updates.settings.section.connection.server");
    case "remote":
      return localizedMessage("inspection.components.about.updates.settings.section.connection.remote");
    case "android-companion":
      return localizedMessage("inspection.components.about.updates.settings.section.connection.android");
    case "desktop-companion":
      return localizedMessage("inspection.components.about.updates.settings.section.connection.desktop.app");
    case "demo":
      return localizedMessage("inspection.components.about.updates.settings.section.connection.demo");
  }
}

function flavorLabel(flavor: ProductFlavor): string {
  switch (flavor) {
    case "production":
      return localizedMessage("inspection.components.about.updates.settings.section.build.type.production");
    case "preview":
      return localizedMessage("inspection.components.about.updates.settings.section.build.type.preview");
    case "development":
      return localizedMessage("inspection.components.about.updates.settings.section.build.type.development");
  }
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
      return localizedMessage("updates.status.available", { version: state.version });
    case "manual-install":
      return localizedMessage("inspection.components.about.updates.settings.section.manual.update.required");
    case "downloading":
      return localizedMessage("updates.status.downloading", { version: state.version });
    case "installing":
      return localizedMessage("updates.status.installing", { version: state.version });
    case "error":
      return state.operation === "check"
        ? localizedMessage("updates.status.check-failed")
        : localizedMessage("updates.status.install-failed");
  }
}

function statusDetail(state: UpdaterState, info: DesktopUpdaterSnapshot["info"]): string {
  switch (state.phase) {
    case "idle":
      return localizedMessage("updates.detail.current-version", { version: info.version });
    case "checking":
      return localizedMessage("inspection.components.about.updates.settings.section.contacting.the.rstorrent.update.service");
    case "up-to-date":
      return localizedMessage("updates.detail.up-to-date", { version: info.version });
    case "waiting-for-stable":
      return localizedMessage("inspection.components.about.updates.settings.section.waiting.for.stable.description");
    case "available":
      return state.manualApply === undefined
        ? localizedMessage("updates.detail.approval-required")
        : localizedMessage("updates.detail.browser-check-only");
    case "manual-install":
      return localizedMessage("updates.detail.package-channel", { package: packageLabel(info.bundleType) });
    case "downloading": {
      const percent = progressPercent(state);
      return percent === undefined
        ? localizedMessage("updates.detail.downloaded", { size: formatBytes(state.downloadedBytes) })
        : localizedMessage("updates.detail.download-progress", { percent: percent / 100, size: formatBytes(state.downloadedBytes) });
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

/** Existing hosts send free text. Recognize their product statuses at presentation
 * time so live language changes work, retaining unknown diagnostics verbatim. */
function hostUpdateDetail(detail: string, installedVersion: string): string {
  if (detail === `Updated to ${installedVersion}`) {
    return localizedMessage("updates.detail.updated", { version: installedVersion });
  }
  switch (detail) {
    case "Downloaded; waiting for playback, unfinished work or connected clients":
      return localizedMessage("updates.detail.waiting-for-work");
    case "Downloaded; choose Install & restart to finish the update":
      return localizedMessage("updates.detail.install-to-finish");
    case "Downloaded; automatic installation is off":
      return localizedMessage("updates.detail.automatic-off");
    case "Restarting shortly to install the update":
      return localizedMessage("updates.detail.restarting");
    case "Downloaded; waiting until you're away":
      return localizedMessage("updates.detail.waiting-until-away");
    case "Automatic installation is paused for this channel":
      return localizedMessage("updates.detail.channel-paused");
    case "Update installation did not finish":
      return localizedMessage("updates.detail.install-incomplete");
    default:
      return detail;
  }
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
  if (bytes < 1_048_576) return `${formatNumber(bytes / 1_024, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 })} KiB`;
  return `${formatNumber(bytes / 1_048_576, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 })} MiB`;
}
