import { useRef } from "react";
import type { FileSafetySettings, FileSafetyPreset } from "../../api";
import { message as localizedMessage } from "../../localization/runtime";
import { useInspectionCommand, useInspectionStore } from "../context";
import { hostSupports } from "../host-capabilities";
import {
  settingsDraftFields,
  settingsDraftPhase,
  settingsDraftValue,
} from "../settings-draft";
import { useSettingsDraft } from "../use-settings-draft";
import styles from "./SettingsDialog.module.css";

const recommended =
  ".exe .com .scr .msi .msix .bat .cmd .ps1 .vbs .js .jse .wsf .hta .lnk .url .dmg .pkg .app .command .sh .apk .appimage .deb .rpm .jar .desktop";
const archives = ".zip .rar .7z .tar .gz .bz2 .xz .tgz";
type Draft = {
  enabled: boolean;
  preset: FileSafetyPreset;
  extensions: string;
  mark: boolean;
};
const comparators = {
  enabled: Object.is,
  preset: Object.is,
  extensions: Object.is,
  mark: Object.is,
};

export function FileSafetySettingsSection({
  settings,
  manageable,
}: {
  readonly settings: FileSafetySettings;
  readonly manageable: boolean;
}) {
  const supported = useInspectionStore((state) =>
    hostSupports(state.session, "file_safety"),
  );
  const revision = useInspectionStore((state) => state.durableRevision);
  const execute = useInspectionCommand();
  const saving = useRef(false);
  const authority: Draft = {
    enabled: settings.enabled,
    preset: settings.preset,
    extensions: settings.custom_extensions.join(", "),
    mark: settings.mark_internet_origin,
  };
  const [state, dispatch] = useSettingsDraft(
    "file-safety",
    revision,
    authority,
    comparators,
  );
  const draft = settingsDraftValue(state) ?? authority;
  const phase = settingsDraftPhase(state);
  const pending = phase === "submitting" || phase === "awaiting_view";
  const extensions = draft.extensions
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  const valid =
    extensions.length <= 128 &&
    extensions.every(
      (value) =>
        value.length <= 32 && /^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(value),
    );
  if (!supported) return null;
  return (
    <fieldset className={styles.section} disabled={!manageable || pending}>
      <legend>{localizedMessage("safety.settings.title")}</legend>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (saving.current || pending || !valid || state.conflicts.length > 0)
            return;
          saving.current = true;
          dispatch({ type: "submit" });
          void execute({
            type: "update_file_safety_settings",
            settings: {
              enabled: draft.enabled,
              preset: draft.preset,
              custom_extensions: [...new Set(extensions)],
              mark_internet_origin: draft.mark,
            },
          })
            .then((result) => {
              if (!result.accepted || result.resultingRevision === undefined)
                throw new Error(
                  result.message ?? localizedMessage("safety.settings.failed"),
                );
              dispatch({ type: "accept", revision: result.resultingRevision });
            })
            .catch((error) =>
              dispatch({
                type: "fail",
                message:
                  error instanceof Error
                    ? error.message
                    : localizedMessage("safety.settings.failed"),
              }),
            )
            .finally(() => {
              saving.current = false;
            });
        }}
      >
        <label className={styles.preference}>
          <span>{localizedMessage("safety.settings.enabled")}</span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              dispatch({
                type: "edit",
                field: "enabled",
                value: event.target.checked,
              })
            }
          />
        </label>
        <label className={styles.settingHeading}>
          {localizedMessage("safety.settings.preset")}
          <select
            disabled={!draft.enabled}
            value={draft.preset}
            onChange={(event) => {
              const preset = event.target.value as FileSafetyPreset;
              if (preset === "custom" && draft.preset !== "custom")
                dispatch({
                  type: "edit",
                  field: "extensions",
                  value: `${recommended}${draft.preset === "archives" ? ` ${archives}` : ""}`,
                });
              dispatch({ type: "edit", field: "preset", value: preset });
            }}
          >
            <option value="recommended">
              {localizedMessage("safety.preset.recommended")}
            </option>
            <option value="archives">
              {localizedMessage("safety.preset.archives")}
            </option>
            <option value="custom">
              {localizedMessage("safety.preset.custom")}
            </option>
          </select>
        </label>
        {draft.preset === "custom" ? (
          <label className={styles.settingHeading}>
            {localizedMessage("safety.settings.extensions")}
            <textarea
              rows={3}
              maxLength={4224}
              spellCheck={false}
              disabled={!draft.enabled}
              value={draft.extensions}
              onChange={(event) =>
                dispatch({
                  type: "edit",
                  field: "extensions",
                  value: event.target.value,
                })
              }
            />
            <span>{localizedMessage("safety.settings.extension.help")}</span>
          </label>
        ) : (
          <p className={styles.storageNote}>
            {localizedMessage("safety.settings.preset.help")}
          </p>
        )}
        {!valid ? (
          <p role="alert">{localizedMessage("safety.settings.invalid")}</p>
        ) : null}
        <p className={styles.storageNote}>
          {localizedMessage("safety.settings.future")}
        </p>
        <label className={styles.preference}>
          <span>{localizedMessage("safety.settings.origin")}</span>
          <input
            type="checkbox"
            checked={draft.mark}
            onChange={(event) =>
              dispatch({
                type: "edit",
                field: "mark",
                value: event.target.checked,
              })
            }
          />
        </label>
        <p className={styles.storageNote}>
          {localizedMessage("safety.settings.origin.help")}
        </p>
        {state.failure !== null ? <p role="alert">{state.failure}</p> : null}
        {state.conflicts.length > 0 ? (
          <p role="alert">{localizedMessage("safety.settings.conflict")}</p>
        ) : null}
        <div className={styles.rootActions}>
          <button
            type="submit"
            disabled={
              !valid ||
              pending ||
              state.conflicts.length > 0 ||
              settingsDraftFields(state).length === 0
            }
          >
            {localizedMessage("safety.settings.save")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => dispatch({ type: "discard" })}
          >
            {localizedMessage("safety.settings.discard")}
          </button>
        </div>
      </form>
    </fieldset>
  );
}
