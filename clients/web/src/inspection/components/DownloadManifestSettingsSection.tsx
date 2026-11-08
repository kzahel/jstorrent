import { useState } from "react";

import type { ClientSettingsPatch } from "../../api";
import { message as localizedMessage } from "../../localization/runtime";
import { useInspectionStore } from "../context";
import { DOWNLOAD_MANIFESTS, hostSupports } from "../host-capabilities";
import styles from "./SettingsDialog.module.css";

interface DownloadManifestSettingsSectionProps {
  /** Absent from hosts released before the setting. */
  readonly enabled: boolean | undefined;
  readonly manageable: boolean;
  readonly onSave: (patch: ClientSettingsPatch) => Promise<unknown>;
}

/**
 * The PlaysVideo sidecar toggle (Tactical 391). Hosts without the
 * capability neither write sidecars nor accept the setting, so the
 * section is hidden for them.
 */
export function DownloadManifestSettingsSection({
  enabled,
  manageable,
  onSave,
}: DownloadManifestSettingsSectionProps) {
  const supported = useInspectionStore((state) =>
    hostSupports(state.session, DOWNLOAD_MANIFESTS),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!supported || enabled === undefined) return null;
  return (
    <fieldset className={styles.section} disabled={!manageable || pending}>
      <legend>
        {localizedMessage("inspection.components.download.manifest.settings.title")}
      </legend>
      <div className={styles.rows}>
        <label className={styles.preference}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              const write = event.currentTarget.checked;
              setPending(true);
              setError("");
              void onSave({ write_download_manifests: write })
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                )
                .finally(() => setPending(false));
            }}
          />
          <span>
            <strong>
              {localizedMessage("inspection.components.download.manifest.settings.write")}
            </strong>
            <small>
              {localizedMessage("inspection.components.download.manifest.settings.help")}
            </small>
          </span>
        </label>
      </div>
      {error === "" ? null : (
        <p className={styles.errorStatus} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
