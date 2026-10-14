import { message as localizedMessage } from "../../localization/runtime";
import { useState } from "react";

import type { DownloadRoot, DownloadStorageSettings } from "../model";
import {
  CrostiniStorageHelp,
  describeCrostiniStoragePath,
} from "./CrostiniStorageHelp";
import styles from "./SettingsDialog.module.css";

interface DownloadSettingsSectionProps {
  readonly storage: DownloadStorageSettings;
  readonly manageable: boolean;
  readonly showCrostiniStorageHelp: boolean;
  readonly oneCurrentRoot?: boolean;
  readonly onChooseFolder: (repairRoot?: string) => Promise<DownloadRoot | null>;
  readonly onDefaultRootChange: (rootId: string) => Promise<void>;
  readonly onShowAddOptionsChange: (show: boolean) => Promise<void>;
  readonly onShowFileSelectionChange: (show: boolean) => Promise<void>;
  readonly onRemoveRoot: (rootId: string) => Promise<void>;
}

export function DownloadSettingsSection({
  storage,
  manageable,
  showCrostiniStorageHelp,
  oneCurrentRoot = false,
  onChooseFolder,
  onDefaultRootChange,
  onShowAddOptionsChange,
  onShowFileSelectionChange,
  onRemoveRoot,
}: DownloadSettingsSectionProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [storageError, setStorageError] = useState("");

  /** The folder list and checkboxes show success; only failures need words. */
  const runStorageAction = async (
    action: string,
    operation: () => Promise<unknown>,
  ) => {
    setPendingAction(action);
    setStorageError("");
    try {
      await operation();
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <fieldset className={styles.section}>
      <legend>{localizedMessage("inspection.components.download.settings.section.downloads")}</legend>
      {!manageable ? (
        <p className={styles.storageNote}>{localizedMessage("inspection.components.download.settings.section.not.manageable")}</p>
      ) : (
        <>
          <div className={styles.settingHeading}>
            <strong>{localizedMessage("inspection.components.download.settings.section.download.folders")}</strong>
            <span>
              {oneCurrentRoot
                ? localizedMessage("inspection.components.download.settings.section.new.downloads.current.folder")
                : localizedMessage("inspection.components.download.settings.section.new.downloads.default.folder")}
            </span>
          </div>
          {showCrostiniStorageHelp ? <CrostiniStorageHelp /> : null}
          <div className={styles.rootList}>
            {storage.roots.length === 0 ? (
              <p className={styles.storageNote}>{localizedMessage("inspection.components.download.settings.section.no.download.folder.has.been.chosen.yet")}</p>
            ) : (
              storage.roots.map((root) => {
                const performance = showCrostiniStorageHelp
                  ? describeCrostiniStoragePath(root.path)
                  : null;
                return (
                  <article
                    key={root.id}
                    className={styles.root}
                    data-availability={root.availability}
                  >
                    <div>
                      <strong>{root.label}</strong>
                      <span>
                        {root.path ??
                          (oneCurrentRoot && root.availability === "available"
                            ? localizedMessage("inspection.components.download.settings.section.managed.by.android")
                            : localizedMessage("inspection.components.download.settings.section.location.is.unavailable"))}
                      </span>
                      <small>
                        {root.availability === "available"
                          ? root.id === storage.defaultRoot
                            ? oneCurrentRoot
                              ? localizedMessage("inspection.components.download.settings.section.current.download.folder")
                              : localizedMessage("inspection.components.download.settings.section.default.download.folder")
                            : localizedMessage("inspection.components.download.settings.section.available")
                          : localizedMessage("inspection.components.download.settings.section.unavailable.repair.required")}
                      </small>
                      {performance === null ? null : (
                        <small className={styles.rootPerformance}>
                          {performance}
                        </small>
                      )}
                    </div>
                    <div className={styles.rootActions}>
                      {root.availability === "unavailable" ? (
                        <button
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() =>
                            void runStorageAction(
                              `repair-${root.id}`,
                              () => onChooseFolder(root.id),
                            )
                          }
                        >
                          {pendingAction === `repair-${root.id}`
                            ? localizedMessage("inspection.components.download.settings.section.repairing")
                            : localizedMessage("inspection.components.download.settings.section.repair")}
                        </button>
                      ) : root.id !== storage.defaultRoot ? (
                        <button
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() =>
                            void runStorageAction(
                              `default-${root.id}`,
                              () => onDefaultRootChange(root.id),
                            )
                          }
                        >
                          {oneCurrentRoot ? localizedMessage("inspection.components.download.settings.section.make.current") : localizedMessage("inspection.components.download.settings.section.make.default")}
                        </button>
                      ) : null}
                      {root.id === storage.defaultRoot && oneCurrentRoot ? null : (
                        <button
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() =>
                            void runStorageAction(
                              `remove-${root.id}`,
                              () => onRemoveRoot(root.id),
                            )
                          }
                        >
                          {pendingAction === `remove-${root.id}`
                            ? localizedMessage("inspection.components.download.settings.section.removing")
                            : localizedMessage("inspection.components.download.settings.section.remove")}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <button
            className={styles.addFolder}
            type="button"
            disabled={pendingAction !== null}
            onClick={() =>
              void runStorageAction("add", () => onChooseFolder())
            }
          >
            {pendingAction === "add" ? localizedMessage("inspection.components.download.settings.section.choosing") : localizedMessage("inspection.components.download.settings.section.add.folder")}
          </button>
          <div className={styles.rows}>
            {oneCurrentRoot ? null : (
              <label className={styles.preference}>
                <input
                  type="checkbox"
                  checked={storage.showAddOptions}
                  disabled={pendingAction !== null}
                  onChange={(event) => {
                    const show = event.currentTarget.checked;
                    void runStorageAction("preference", () =>
                      onShowAddOptionsChange(show),
                    );
                  }}
                />
                <span>
                  <strong>{localizedMessage("inspection.components.download.settings.section.show.options.when.adding.torrents")}</strong>
                  <small>{localizedMessage("inspection.components.download.settings.section.options.always.shown.without.default")}</small>
                </span>
              </label>
            )}
            <label className={styles.preference}>
              <input
                type="checkbox"
                checked={storage.showFileSelection ?? true}
                disabled={pendingAction !== null}
                onChange={(event) => {
                  const show = event.currentTarget.checked;
                  void runStorageAction("file-selection-preference", () =>
                    onShowFileSelectionChange(show),
                  );
                }}
              />
              <span>
                <strong>{localizedMessage("inspection.components.download.settings.section.show.file.selection.when.adding.torrents")}</strong>
                <small>{localizedMessage("inspection.components.download.settings.section.choose.files.before.starting")}</small>
              </span>
            </label>
          </div>
          {storageError === "" ? null : (
            <p className={styles.errorStatus} role="alert">
              {storageError}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
