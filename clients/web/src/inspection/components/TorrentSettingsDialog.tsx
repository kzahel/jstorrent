import { message as localizedMessage } from "../../localization/runtime";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type {
  TorrentSeedStopLimit,
  TorrentSeedStopLimits,
  TorrentSettingsPatch,
  TransferRateLimit,
} from "../../api";
import { useInspectionCommand, useInspectionStore } from "../context";
import type { TorrentRow } from "../model";
import {
  settingsDraftFields,
  settingsDraftPhase,
  settingsDraftValue,
  type SettingsDraftComparators,
  type SettingsDraftPhase,
  type SettingsDraftState,
} from "../settings-draft";
import {
  durationLimitDraft,
  ratioLimitDraft,
  sameDurationLimitDraft,
  sameRatioLimitDraft,
  sessionDurationLabel,
  sessionRatioLabel,
  torrentSeedStopLimits,
  validateDurationLimit,
  validateRatioLimit,
  type DurationLimitDraft,
  type RatioLimitDraft,
} from "../seed-stop";
import { rateLimitDraftValue, validateRateLimit } from "../transfer-rate";
import { useSettingsDraft } from "../use-settings-draft";
import { DurationPicker } from "./DurationPicker";
import { RateLimitPicker, type RateLimitDraft } from "./RateLimitPicker";
import { RatioPicker } from "./RatioPicker";
import styles from "./TorrentSettingsDialog.module.css";

export function TorrentSettingsDialog({
  torrent,
  onClose,
  returnFocus,
}: {
  readonly torrent: TorrentRow;
  readonly onClose: () => void;
  readonly returnFocus: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    return returnFocus;
  }, [returnFocus]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape" && !transportPending.current) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
      ) ?? [],
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  const execute = useInspectionCommand();
  const durableRevision = useInspectionStore((state) => state.durableRevision);
  const sessionRatio = useInspectionStore(
    (state) => state.clientSettings.configured.seed_stop_ratio_percent,
  );
  const sessionTime = useInspectionStore(
    (state) => state.clientSettings.configured.seed_stop_time_seconds,
  );
  const transportPending = useRef(false);
  const [acceptedMessage, setAcceptedMessage] = useState<string | null>(null);
  const seedStopLimits = torrentSeedStopLimits(torrent);
  const authority = torrentSettingsDraft(torrent.transferLimits, seedStopLimits);
  const [draftState, dispatchDraft] = useSettingsDraft(
    torrent.id,
    durableRevision,
    authority,
    TORRENT_SETTINGS_COMPARATORS,
  );
  const draft = settingsDraftValue(draftState) ?? authority;
  const upload = validateRateLimit(draft.upload.unlimited, draft.upload.valueKiB);
  const download = validateRateLimit(
    draft.download.unlimited,
    draft.download.valueKiB,
  );
  const seedStopRatio = validateRatioLimit(draft.seedStopRatio);
  const seedStopTime = validateDurationLimit(draft.seedStopTime);
  const dirtyFields = settingsDraftFields(draftState);
  const patch = torrentSettingsPatch(dirtyFields, {
    upload: upload.limit,
    download: download.limit,
    seedStopRatio: seedStopRatio.limit,
    seedStopTime: seedStopTime.limit,
  });
  const phase = settingsDraftPhase(draftState);
  const pending = phase === "submitting" || phase === "awaiting_view";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (patch === null || transportPending.current || draftState.submission !== null) {
      return;
    }
    transportPending.current = true;
    setAcceptedMessage(null);
    dispatchDraft({ type: "submit" });
    try {
      const result = await execute({
        type: "update_torrent_settings",
        torrentId: torrent.id,
        patch,
      });
      if (result.resultingRevision === undefined) {
        throw new Error(localizedMessage("inspection.components.torrent.settings.dialog.save.not.confirmed"));
      }
      setAcceptedMessage(localizedMessage("inspection.components.torrent.settings.dialog.saved"));
      dispatchDraft({ type: "accept", revision: result.resultingRevision });
    } catch (error) {
      setAcceptedMessage(null);
      dispatchDraft({
        type: "fail",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      transportPending.current = false;
    }
  };
  const status =
    draftStatus(draftState, phase) ??
    (phase === "pristine" ? acceptedMessage : null);

  return (
    <div className={styles.backdrop}>
      <form
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="torrent-settings-title"
        aria-describedby="torrent-settings-description"
        onKeyDown={handleKeyDown}
        onSubmit={(event) => void submit(event)}
      >
        <h2 id="torrent-settings-title">
          {localizedMessage("inspection.components.torrent.settings.dialog.title")}
        </h2>
        <p className={styles.torrentName}>{torrent.name}</p>
        <p id="torrent-settings-description">
          {localizedMessage("inspection.components.torrent.settings.dialog.description")}
        </p>
        <h3>
          {localizedMessage("inspection.components.torrent.settings.dialog.speed.limits")}
        </h3>
        <div className={styles.rateLimitFields}>
          <RateLimitPicker
            id="torrent-upload-rate"
            label={localizedMessage("inspection.components.torrent.settings.dialog.upload")}
            unlimited={draft.upload.unlimited}
            valueKiB={draft.upload.valueKiB}
            error={upload.error}
            disabled={false}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "upload", value })
            }
          />
          <RateLimitPicker
            id="torrent-download-rate"
            label={localizedMessage("inspection.components.torrent.settings.dialog.download")}
            unlimited={draft.download.unlimited}
            valueKiB={draft.download.valueKiB}
            error={download.error}
            disabled={false}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "download", value })
            }
          />
        </div>
        <h3>
          {localizedMessage("inspection.components.torrent.settings.dialog.stop.seeding")}
        </h3>
        <div className={styles.rateLimitFields}>
          <RatioPicker
            id="torrent-seed-stop-ratio"
            label={localizedMessage("inspection.components.torrent.settings.dialog.share.ratio")}
            useGlobalLabel={localizedMessage("inspection.components.torrent.settings.dialog.use.global", {
              limit: sessionRatioLabel(sessionRatio),
            })}
            offLabel={localizedMessage("inspection.components.torrent.settings.dialog.no.limit")}
            draft={draft.seedStopRatio}
            error={seedStopRatio.error}
            disabled={false}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "seedStopRatio", value })
            }
          />
          <DurationPicker
            id="torrent-seed-stop-time"
            label={localizedMessage("inspection.components.torrent.settings.dialog.seeding.time")}
            useGlobalLabel={localizedMessage("inspection.components.torrent.settings.dialog.use.global", {
              limit: sessionDurationLabel(sessionTime),
            })}
            offLabel={localizedMessage("inspection.components.torrent.settings.dialog.no.limit")}
            draft={draft.seedStopTime}
            secondsUnit={
              seedStopLimits.time_seconds.type === "limited" &&
              seedStopLimits.time_seconds.value % 60 !== 0
            }
            error={seedStopTime.error}
            disabled={false}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "seedStopTime", value })
            }
          />
        </div>
        <div className={styles.rateLimitActions}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={transportPending.current}
          >
            {localizedMessage("inspection.components.torrent.settings.dialog.cancel")}
          </button>
          <button type="submit" disabled={patch === null || pending}>
            {pending
              ? localizedMessage("inspection.components.torrent.settings.dialog.saving")
              : localizedMessage("inspection.components.torrent.settings.dialog.save")}
          </button>
          {status === null ? null : (
            <output aria-live="polite">{status}</output>
          )}
        </div>
      </form>
    </div>
  );
}

interface TorrentSettingsDraft {
  readonly upload: RateLimitDraft;
  readonly download: RateLimitDraft;
  readonly seedStopRatio: RatioLimitDraft;
  readonly seedStopTime: DurationLimitDraft;
}

const TORRENT_SETTINGS_COMPARATORS: SettingsDraftComparators<TorrentSettingsDraft> = {
  upload: sameRateLimitDraft,
  download: sameRateLimitDraft,
  seedStopRatio: sameRatioLimitDraft,
  seedStopTime: sameDurationLimitDraft,
};

function torrentSettingsDraft(
  limits: {
    readonly upload: TransferRateLimit;
    readonly download: TransferRateLimit;
  },
  seedStop: TorrentSeedStopLimits,
): TorrentSettingsDraft {
  return {
    upload: {
      unlimited: limits.upload.type === "unlimited",
      valueKiB: rateLimitDraftValue(limits.upload, "1024"),
    },
    download: {
      unlimited: limits.download.type === "unlimited",
      valueKiB: rateLimitDraftValue(limits.download, "4096"),
    },
    seedStopRatio: ratioLimitDraft(seedStop.ratio_percent),
    seedStopTime: durationLimitDraft(seedStop.time_seconds),
  };
}

function sameRateLimitDraft(
  left: RateLimitDraft,
  right: RateLimitDraft,
): boolean {
  return left.unlimited === right.unlimited &&
    (left.unlimited || left.valueKiB === right.valueKiB);
}

/** Only changed fields are sent; any invalid field blocks the whole save. */
function torrentSettingsPatch(
  fields: readonly (keyof TorrentSettingsDraft)[],
  values: {
    readonly upload: TransferRateLimit | null;
    readonly download: TransferRateLimit | null;
    readonly seedStopRatio: TorrentSeedStopLimit | null;
    readonly seedStopTime: TorrentSeedStopLimit | null;
  },
): TorrentSettingsPatch | null {
  const { upload, download, seedStopRatio, seedStopTime } = values;
  if (
    upload === null ||
    download === null ||
    seedStopRatio === null ||
    seedStopTime === null ||
    fields.length === 0
  ) {
    return null;
  }
  return {
    ...(fields.includes("upload") ? { upload_rate_limit: upload } : {}),
    ...(fields.includes("download") ? { download_rate_limit: download } : {}),
    ...(fields.includes("seedStopRatio")
      ? { seed_stop_ratio_percent: seedStopRatio }
      : {}),
    ...(fields.includes("seedStopTime")
      ? { seed_stop_time_seconds: seedStopTime }
      : {}),
  };
}

function draftStatus(
  state: SettingsDraftState<TorrentSettingsDraft>,
  phase: SettingsDraftPhase,
): string | null {
  if (phase === "submitting" || phase === "awaiting_view") {
    return localizedMessage("inspection.components.torrent.settings.dialog.saving");
  }
  if (phase === "conflict") {
    return localizedMessage("inspection.components.torrent.settings.dialog.changed.elsewhere");
  }
  return state.failure;
}
