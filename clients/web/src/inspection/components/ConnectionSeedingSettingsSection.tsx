import {
  formatNumber,
  message as localizedMessage,
} from "../../localization/runtime";
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import type {
  AdvertisedPeerEndpointStatus,
  ClientSettings,
  ClientSettingsApplicationState,
  ClientSettingsPatch,
  ClientSettingsRuntimeView,
  EncryptionPolicy,
  Ipv6PinholeStatus,
  ListenerPolicy,
  ListenerStatus,
  PortMappingFailureStage,
  PortMappingPolicy,
  PortMappingStatus,
  TransferRateLimit,
  TransportFamilyRuntimeView,
} from "../../api";
import { useInspectionStore } from "../context";
import { formatElapsedSeconds } from "../format";
import type { CommandAccepted } from "../model";
import {
  SEED_STOP_VALUE_MAXIMUM,
  durationLimitDraft,
  ratioLimitDraft,
  sameDurationLimitDraft,
  sameRatioLimitDraft,
  sessionSeedStopLimit,
  validateDurationLimit,
  validateRatioLimit,
  type DurationLimitDraft,
  type RatioLimitDraft,
  type SeedStopValidation,
} from "../seed-stop";
import {
  settingsDraftFields,
  settingsDraftPhase,
  settingsDraftValue,
  type SettingsDraftComparators,
  type SettingsDraftPhase,
  type SettingsDraftState,
} from "../settings-draft";
import {
  rateLimitDraftValue,
  validateRateLimit,
  type RateLimitValidation,
} from "../transfer-rate";
import { useSettingsDraft } from "../use-settings-draft";
import { DurationPicker, type DurationPreset } from "./DurationPicker";
import { NumberInput } from "./NumberInput";
import { RateLimitPicker, type RateLimitDraft } from "./RateLimitPicker";
import { RatioPicker } from "./RatioPicker";
import { SegmentedSetting, type SegmentedOption } from "./SegmentedSetting";
import styles from "./SettingsDialog.module.css";

const FIXED_PORT_MINIMUM = 1_024;
const FIXED_PORT_MAXIMUM = 65_535;
const PEER_LIMIT_MINIMUM = 1;
const PEER_LIMIT_MAXIMUM = 2_000;
const UPLOAD_SLOTS_MINIMUM = 0;
const UPLOAD_SLOTS_MAXIMUM = 50;
const ACTIVE_DOWNLOADS_MINIMUM = 1;
const ACTIVE_DOWNLOADS_MAXIMUM = 20;
const ACTIVE_SEEDS_MINIMUM = 0;
const ACTIVE_SEEDS_MAXIMUM = 500;
const SEED_GOAL_MINIMUM = 0;
const SEED_GOAL_MAXIMUM = SEED_STOP_VALUE_MAXIMUM;
/** The largest time goal is stored for "No time goal". */
const NO_TIME_GOAL_SECONDS = SEED_GOAL_MAXIMUM;
const DEFAULT_UPLOAD_RATE_KIB = "1024";
const DEFAULT_DOWNLOAD_RATE_KIB = "4096";

type ListenerMode = "off" | "automatic" | "fixed";

/** A short row-level line; warnings use the danger color. */
interface SettingNote {
  readonly text: string;
  readonly warning: boolean;
}

interface ConnectionSeedingSettingsSectionProps {
  readonly settings: ClientSettingsRuntimeView;
  readonly manageable: boolean;
  readonly onSave: (patch: ClientSettingsPatch) => Promise<CommandAccepted>;
}

interface DraftValidation {
  readonly settings: ClientSettings | null;
  readonly preferredPortError: string | null;
  readonly fixedPortError: string | null;
  readonly peerLimitError: string | null;
  readonly uploadSlotsError: string | null;
  readonly activeDownloadsError: string | null;
  readonly activeSeedsError: string | null;
  readonly shareRatioError: string | null;
  readonly finishedDownloadRatioError: string | null;
  readonly finishedTimeError: string | null;
  readonly seedStopRatioError: string | null;
  readonly seedStopTimeError: string | null;
  readonly uploadRateError: string | null;
  readonly downloadRateError: string | null;
}

export function ConnectionSeedingSettingsSection({
  settings,
  manageable,
  onSave,
}: ConnectionSeedingSettingsSectionProps) {
  const configured = settings.configured;
  const durableRevision = useInspectionStore((state) => state.durableRevision);
  const authority = clientSettingsDraft(configured);
  const [draftState, dispatchDraft] = useSettingsDraft(
    "client-settings",
    durableRevision,
    authority,
    CLIENT_SETTINGS_COMPARATORS,
  );
  const draft = settingsDraftValue(draftState) ?? authority;
  const transportPending = useRef(false);
  const [forwardingConfirmation, setForwardingConfirmation] = useState(false);
  const [acceptedMessage, setAcceptedMessage] = useState<string | null>(null);
  const phase = settingsDraftPhase(draftState);
  const pending = phase === "submitting" || phase === "awaiting_view";

  const validation = useMemo(
    () => {
      const uploadRate = validateRateLimit(
        draft.uploadRate.unlimited,
        draft.uploadRate.valueKiB,
      );
      const downloadRate = validateRateLimit(
        draft.downloadRate.unlimited,
        draft.downloadRate.valueKiB,
      );
      return validateDraft(
        draft.listener.mode,
        draft.preferredPort,
        draft.listener.fixedPort,
        draft.portMapping,
        draft.peerLimit,
        draft.uploadSlots,
        draft.activeDownloads,
        draft.activeSeeds,
        draft.shareRatioLimit,
        draft.finishedDownloadRatioLimit,
        validateDurationLimit(draft.finishedTimeLimit),
        validateRatioLimit(draft.seedStopRatio),
        validateDurationLimit(draft.seedStopTime),
        uploadRate,
        downloadRate,
        draft.encryption,
        draft.ipv6Enabled,
        draft.dhtEnabled,
        draft.peerExchangeEnabled,
        configured.tracker_https_server_authentication,
      );
    },
    [configured.tracker_https_server_authentication, draft],
  );
  const dirtyFields = settingsDraftFields(draftState);
  const patch = clientSettingsPatch(dirtyFields, validation.settings);

  const resetDraft = () => {
    setForwardingConfirmation(false);
    dispatchDraft({ type: "discard" });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !manageable ||
      patch === null ||
      transportPending.current ||
      draftState.submission !== null
    ) {
      return;
    }
    setForwardingConfirmation(false);
    transportPending.current = true;
    setAcceptedMessage(null);
    dispatchDraft({ type: "submit" });
    try {
      const result = await onSave(patch);
      if (result.resultingRevision === undefined) {
        throw new Error(localizedMessage("inspection.components.connection.seeding.settings.section.save.not.confirmed"));
      }
      setAcceptedMessage(localizedMessage("inspection.components.connection.seeding.settings.section.saved"));
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
    clientDraftStatus(draftState, phase) ??
    (phase === "pristine" ? acceptedMessage : null);

  const peerLimitCapped =
    settings.effective_peer_connection_limit < configured.peer_connection_limit;

  return (
    <fieldset className={styles.section}>
      <legend>{localizedMessage("inspection.components.connection.seeding.settings.section.connection.seeding")}</legend>
      {!manageable ? (
        <p className={styles.storageNote}>{localizedMessage("inspection.components.connection.seeding.settings.section.not.manageable")}</p>
      ) : null}
      <form className={styles.settingsForm} onSubmit={(event) => void submit(event)}>
        <SettingGroup
          id="speed-limits-heading"
          title={localizedMessage("inspection.components.connection.seeding.settings.section.speed.limits.heading")}
          description={localizedMessage("inspection.components.connection.seeding.settings.section.speed.limits.description")}
          note={applicationNote(settings.bandwidth_application)}
        >
          <RateLimitPicker
            id="all-torrents-upload-rate"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.upload")}
            unlimited={draft.uploadRate.unlimited}
            valueKiB={draft.uploadRate.valueKiB}
            error={validation.uploadRateError}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "uploadRate", value })
            }
          />
          <RateLimitPicker
            id="all-torrents-download-rate"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.download")}
            unlimited={draft.downloadRate.unlimited}
            valueKiB={draft.downloadRate.valueKiB}
            error={validation.downloadRateError}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "downloadRate", value })
            }
          />
        </SettingGroup>

        <SettingGroup
          id="queue-heading"
          title={localizedMessage("inspection.components.connection.seeding.settings.section.queue.heading")}
        >
          <NumberField
            id="active-downloads"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.max.active.downloads")}
            description={localizedMessage("inspection.components.connection.seeding.settings.section.max.active.downloads.description")}
            value={draft.activeDownloads}
            minimum={ACTIVE_DOWNLOADS_MINIMUM}
            maximum={ACTIVE_DOWNLOADS_MAXIMUM}
            error={validation.activeDownloadsError}
            disabled={!manageable}
            note={
              settings.active_downloads_clamp_reason === "platform_limit"
                ? limitedNote(settings.effective_active_downloads)
                : null
            }
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "activeDownloads", value })
            }
          />
          <ToggleOption
            label={localizedMessage("inspection.components.connection.seeding.settings.section.no.active.seed.limit")}
            checked={draft.activeSeeds.unlimited}
            disabled={!manageable}
            onChange={(unlimited) =>
              dispatchDraft({
                type: "edit",
                field: "activeSeeds",
                value: { ...draft.activeSeeds, unlimited },
              })
            }
          />
          <NumberField
            id="active-seeds"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.max.active.seeds")}
            value={draft.activeSeeds.torrents}
            minimum={ACTIVE_SEEDS_MINIMUM}
            maximum={ACTIVE_SEEDS_MAXIMUM}
            error={validation.activeSeedsError}
            disabled={!manageable || draft.activeSeeds.unlimited}
            onChange={(torrents) =>
              dispatchDraft({
                type: "edit",
                field: "activeSeeds",
                value: { ...draft.activeSeeds, torrents },
              })
            }
          />
        </SettingGroup>

        <SettingGroup
          id="stop-seeding-heading"
          title={localizedMessage("inspection.components.connection.seeding.settings.section.stop.seeding.heading")}
          description={localizedMessage("inspection.components.connection.seeding.settings.section.stop.seeding.description")}
        >
          <RatioPicker
            id="seed-stop-ratio"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.stop.share.ratio")}
            offLabel={localizedMessage("inspection.components.connection.seeding.settings.section.stop.off")}
            draft={draft.seedStopRatio}
            error={validation.seedStopRatioError}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "seedStopRatio", value })
            }
          />
          <DurationPicker
            id="seed-stop-time"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.stop.seeding.time")}
            offLabel={localizedMessage("inspection.components.connection.seeding.settings.section.stop.off")}
            draft={draft.seedStopTime}
            secondsUnit={
              configured.seed_stop_time_seconds.type === "limited" &&
              configured.seed_stop_time_seconds.value % 60 !== 0
            }
            error={validation.seedStopTimeError}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "seedStopTime", value })
            }
          />
        </SettingGroup>

        <SettingGroup
          id="seeding-priority-heading"
          title={localizedMessage("inspection.components.connection.seeding.settings.section.seeding.priority.heading")}
          description={localizedMessage("inspection.components.connection.seeding.settings.section.seeding.priority.description")}
        >
          <NumberField
            id="share-ratio-limit"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.share.ratio.goal")}
            description={localizedMessage("inspection.components.connection.seeding.settings.section.share.ratio.goal.description")}
            unit={localizedMessage("inspection.components.connection.seeding.settings.section.unit.percent")}
            value={draft.shareRatioLimit}
            minimum={SEED_GOAL_MINIMUM}
            maximum={SEED_GOAL_MAXIMUM}
            error={validation.shareRatioError}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "shareRatioLimit", value })
            }
          />
          <NumberField
            id="finished-download-ratio-limit"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.seeding.download.time.goal")}
            unit={localizedMessage("inspection.components.connection.seeding.settings.section.unit.percent")}
            value={draft.finishedDownloadRatioLimit}
            minimum={SEED_GOAL_MINIMUM}
            maximum={SEED_GOAL_MAXIMUM}
            error={validation.finishedDownloadRatioError}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({
                type: "edit",
                field: "finishedDownloadRatioLimit",
                value,
              })
            }
          />
          <DurationPicker
            id="finished-time-limit"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.seeding.time.goal")}
            leadingPresets={noTimeGoalPreset()}
            draft={draft.finishedTimeLimit}
            secondsUnit={
              configured.finished_time_limit_seconds % 60 !== 0 &&
              configured.finished_time_limit_seconds !== NO_TIME_GOAL_SECONDS
            }
            error={validation.finishedTimeError}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "finishedTimeLimit", value })
            }
          />
        </SettingGroup>

        <SettingGroup
          id="connections-heading"
          title={localizedMessage("inspection.components.connection.seeding.settings.section.connections.heading")}
        >
          <NumberField
            id="peer-connection-limit"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.max.peer.connections")}
            value={draft.peerLimit}
            minimum={PEER_LIMIT_MINIMUM}
            maximum={PEER_LIMIT_MAXIMUM}
            error={validation.peerLimitError}
            disabled={!manageable}
            note={
              applicationNote(settings.peer_connections_application) ??
              (peerLimitCapped
                ? limitedNote(settings.effective_peer_connection_limit)
                : null)
            }
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "peerLimit", value })
            }
          />
          <NumberField
            id="upload-slots"
            label={localizedMessage("inspection.components.connection.seeding.settings.section.upload.slots")}
            description={localizedMessage("inspection.components.connection.seeding.settings.section.upload.slots.description")}
            value={draft.uploadSlots}
            minimum={UPLOAD_SLOTS_MINIMUM}
            maximum={UPLOAD_SLOTS_MAXIMUM}
            error={validation.uploadSlotsError}
            disabled={!manageable}
            note={applicationNote(settings.upload_slots_application)}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "uploadSlots", value })
            }
          />
        </SettingGroup>

        <SettingGroup
          id="network-heading"
          title={localizedMessage("inspection.components.connection.seeding.settings.section.network.heading")}
        >
          <ToggleOption
            label={localizedMessage("inspection.components.connection.seeding.settings.section.incoming.connections")}
            description={localizedMessage("inspection.components.connection.seeding.settings.section.incoming.description")}
            note={incomingNote(settings)}
            checked={draft.listener.mode !== "off"}
            disabled={!manageable}
            onChange={(enabled) => {
              dispatchDraft({
                type: "edit",
                field: "listener",
                value: {
                  ...draft.listener,
                  mode: enabled ? (draft.listener.fixedPort ? "fixed" : "automatic") : "off",
                },
              });
              if (!enabled || configured.listener.type === "disabled") {
                setForwardingConfirmation(false);
                dispatchDraft({ type: "edit", field: "portMapping", value: "disabled" });
              }
            }}
          />
          {draft.listener.mode === "off" ? null : (
            <SegmentedSetting
              name="listener-policy"
              title={localizedMessage("inspection.components.connection.seeding.settings.section.port")}
              options={LISTENER_OPTIONS}
              value={draft.listener.mode}
              disabled={!manageable}
              onChange={(mode) =>
                dispatchDraft({
                  type: "edit",
                  field: "listener",
                  value: { ...draft.listener, mode },
                })
              }
            />
          )}
          {draft.listener.mode === "fixed" ? (
            <NumberField
              id="fixed-listener-port"
              label={localizedMessage("inspection.components.connection.seeding.settings.section.port.number")}
              value={draft.listener.fixedPort}
              minimum={FIXED_PORT_MINIMUM}
              maximum={FIXED_PORT_MAXIMUM}
              error={validation.fixedPortError}
              disabled={!manageable}
              onChange={(fixedPort) =>
                dispatchDraft({
                  type: "edit",
                  field: "listener",
                  value: { ...draft.listener, fixedPort },
                })
              }
            />
          ) : null}

          <ToggleOption
            label={localizedMessage("inspection.components.connection.seeding.settings.section.upnp.port.forwarding")}
            description={localizedMessage("inspection.components.connection.seeding.settings.section.upnp.port.forwarding.description")}
            note={statusNote(
              settings.port_mapping_application,
              portMappingNote(settings.port_mapping_status),
            )}
            checked={draft.listener.mode !== "off" && draft.portMapping === "upnp"}
            disabled={!manageable || draft.listener.mode === "off"}
            onChange={(checked) => {
              if (checked) {
                setForwardingConfirmation(true);
              } else {
                dispatchDraft({ type: "edit", field: "portMapping", value: "disabled" });
              }
            }}
          />
          {forwardingConfirmation && draft.listener.mode !== "off" ? (
            <div
              className={styles.networkConfirmation}
              role="group"
              aria-label={localizedMessage("inspection.components.connection.seeding.settings.section.forwarding.confirm.title")}
            >
              <strong>{localizedMessage("inspection.components.connection.seeding.settings.section.forwarding.confirm.title")}</strong>
              <p>{localizedMessage("inspection.components.connection.seeding.settings.section.forwarding.confirm.description")}</p>
              <div className={styles.rootActions}>
                <button
                  className={styles.secondaryAction}
                  type="button"
                  onClick={() => setForwardingConfirmation(false)}
                >
                  {localizedMessage("inspection.components.connection.seeding.settings.section.not.now")}
                </button>
                <button
                  className={styles.primaryAction}
                  type="button"
                  disabled={!manageable}
                  onClick={() => {
                    setForwardingConfirmation(false);
                    dispatchDraft({ type: "edit", field: "portMapping", value: "upnp" });
                  }}
                >
                  {localizedMessage("inspection.components.connection.seeding.settings.section.enable")}
                </button>
              </div>
            </div>
          ) : null}
          <ToggleOption
            label={localizedMessage("inspection.components.connection.seeding.settings.section.ipv6")}
            description={localizedMessage("inspection.components.connection.seeding.settings.section.ipv6.description")}
            note={applicationNote(settings.ipv6_application)}
            checked={draft.ipv6Enabled}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "ipv6Enabled", value })
            }
          />
          <ToggleOption
            label={localizedMessage("inspection.components.connection.seeding.settings.section.dht")}
            description={localizedMessage("inspection.components.connection.seeding.settings.section.dht.description")}
            note={applicationNote(settings.dht_application)}
            checked={draft.dhtEnabled}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "dhtEnabled", value })
            }
          />
          <ToggleOption
            label={localizedMessage("inspection.components.connection.seeding.settings.section.peer.exchange.pex")}
            description={localizedMessage("inspection.components.connection.seeding.settings.section.peer.exchange.description")}
            note={applicationNote(settings.peer_exchange_application)}
            checked={draft.peerExchangeEnabled}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "peerExchangeEnabled", value })
            }
          />

          <SegmentedSetting
            name="encryption-policy"
            title={localizedMessage("inspection.components.connection.seeding.settings.section.protocol.encryption")}
            options={ENCRYPTION_OPTIONS}
            value={draft.encryption}
            disabled={!manageable}
            onChange={(value) =>
              dispatchDraft({ type: "edit", field: "encryption", value })
            }
          >
            <span>{localizedMessage("inspection.components.connection.seeding.settings.section.protocol.encryption.description")}</span>
            <NoteLine note={applicationNote(settings.encryption_application)} />
          </SegmentedSetting>
        </SettingGroup>

        <NetworkDetails settings={settings} />

        <div className={styles.formActions}>
          <button
            className={styles.primaryAction}
            type="submit"
            disabled={!manageable || pending || patch === null}
          >
            {pending ? localizedMessage("inspection.components.connection.seeding.settings.section.saving") : localizedMessage("inspection.components.connection.seeding.settings.section.save.settings")}
          </button>
          <button
            className={styles.secondaryAction}
            type="button"
            disabled={!manageable || dirtyFields.length === 0}
            onClick={resetDraft}
          >{localizedMessage("inspection.components.connection.seeding.settings.section.cancel.changes")}</button>
        </div>
        {status === null ? null : (
          <output
            className={
              phase === "failed" || phase === "conflict"
                ? styles.errorStatus
                : styles.successStatus
            }
            role={phase === "failed" || phase === "conflict" ? "alert" : "status"}
            aria-live="polite"
          >
            {status}
          </output>
        )}
      </form>
    </fieldset>
  );
}

function SettingGroup({
  id,
  title,
  description,
  note = null,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly note?: SettingNote | null;
  readonly children: ReactNode;
}) {
  return (
    <section className={styles.settingSection} aria-labelledby={id}>
      <div className={styles.settingSectionHeading}>
        <h3 id={id}>{title}</h3>
        {description === undefined ? null : <span>{description}</span>}
        <NoteLine note={note} />
      </div>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

function NoteLine({ note }: { readonly note: SettingNote | null }) {
  if (note === null) return null;
  return (
    <small className={note.warning ? styles.settingNoteWarning : styles.settingNote}>
      {note.text}
    </small>
  );
}

function ToggleOption({
  label,
  description,
  note = null,
  checked,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly description?: string;
  readonly note?: SettingNote | null;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.option}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>{label}</strong>
        {description === undefined ? null : <small>{description}</small>}
        <NoteLine note={note} />
      </span>
    </label>
  );
}

interface NumberFieldProps {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly unit?: string;
  readonly note?: SettingNote | null;
  readonly value: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}

function NumberField({
  id,
  label,
  description,
  unit,
  note = null,
  value,
  minimum,
  maximum,
  error,
  disabled,
  onChange,
}: NumberFieldProps) {
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  return (
    <label className={styles.numberField} htmlFor={id}>
      <span>
        <strong>{label}</strong>
        {description === undefined ? null : (
          <small id={descriptionId}>{description}</small>
        )}
      </span>
      <NumberInput
        id={id}
        label={label}
        unit={unit}
        value={value}
        minimum={minimum}
        maximum={maximum}
        step={1}
        disabled={disabled}
        invalid={error !== null}
        describedBy={
          [description === undefined ? null : descriptionId, error === null ? null : errorId]
            .filter((part): part is string => part !== null)
            .join(" ") || undefined
        }
        onChange={onChange}
      />
      <NoteLine note={note} />
      {error === null ? null : (
        <small id={errorId} className={styles.fieldError}>
          {error}
        </small>
      )}
    </label>
  );
}

function noTimeGoalPreset(): readonly DurationPreset[] {
  return [
    {
      seconds: NO_TIME_GOAL_SECONDS,
      label: localizedMessage("inspection.components.connection.seeding.settings.section.no.time.goal"),
    },
  ];
}

function applicationNote(state: ClientSettingsApplicationState): SettingNote | null {
  switch (state.type) {
    case "applied":
      return null;
    case "applying":
      return {
        text: localizedMessage("inspection.components.connection.seeding.settings.section.note.applying"),
        warning: false,
      };
    case "degraded":
      return {
        text: localizedMessage("inspection.components.connection.seeding.settings.section.note.not.applied"),
        warning: true,
      };
  }
}

/** A specific status failure explains more than the generic application note. */
function statusNote(
  application: ClientSettingsApplicationState,
  status: SettingNote | null,
): SettingNote | null {
  return status?.warning === true ? status : applicationNote(application) ?? status;
}

function limitedNote(count: number): SettingNote {
  return {
    text: localizedMessage("inspection.components.connection.seeding.settings.section.note.limited.on.device", { count }),
    warning: false,
  };
}

function incomingNote(settings: ClientSettingsRuntimeView): SettingNote | null {
  // Transport convergence also covers IPv6. Its failure does not imply that
  // a disabled or successfully bound TCP/uTP listener failed.
  return settings.transport_application.type === "applying"
    ? applicationNote(settings.transport_application)
    : listenerNote(settings.listener_status);
}

function listenerNote(status: ListenerStatus): SettingNote | null {
  switch (status.type) {
    case "disabled":
      return null;
    case "listening":
      return {
        text: localizedMessage("inspection.components.connection.seeding.settings.section.listener.port", { port: String(status.port) }),
        warning: false,
      };
    case "bind_failed": {
      const text = {
        address_in_use: localizedMessage("inspection.components.connection.seeding.settings.section.listener.address.in.use"),
        permission_denied: localizedMessage("inspection.components.connection.seeding.settings.section.listener.permission.denied"),
        address_unavailable: localizedMessage("inspection.components.connection.seeding.settings.section.listener.address.unavailable"),
        other: localizedMessage("inspection.components.connection.seeding.settings.section.listener.failed"),
      }[status.reason];
      return { text, warning: true };
    }
  }
}

/** Plain port-forwarding status for the UPnP row; router facts stay in Network details. */
function portMappingNote(status: PortMappingStatus): SettingNote | null {
  switch (status.type) {
    case "disabled":
      return null;
    case "ineligible":
      return { text: localizedMessage("inspection.components.connection.seeding.settings.section.port.mapping.ineligible"), warning: false };
    case "discovering":
      return { text: localizedMessage("inspection.components.connection.seeding.settings.section.port.mapping.discovering"), warning: false };
    case "mapping":
      return { text: localizedMessage("inspection.components.connection.seeding.settings.section.port.mapping.requesting"), warning: false };
    case "stopping":
      return { text: localizedMessage("inspection.components.connection.seeding.settings.section.port.mapping.stopping"), warning: false };
    case "mapped":
      return {
        text: localizedMessage("inspection.components.connection.seeding.settings.section.port.mapping.mapped", { port: String(status.external_port) }),
        warning: false,
      };
    case "failed":
      return {
        text: status.stage === "discovery"
          ? localizedMessage("inspection.components.connection.seeding.settings.section.port.mapping.no.router")
          : localizedMessage("inspection.components.connection.seeding.settings.section.port.mapping.failed"),
        warning: true,
      };
    case "renewal_failed":
      return {
        text: localizedMessage("inspection.components.connection.seeding.settings.section.port.mapping.renewal.failed", { port: String(status.external_port) }),
        warning: true,
      };
    case "cleanup_failed":
      return {
        text: localizedMessage("inspection.components.connection.seeding.settings.section.port.mapping.cleanup.failed", { port: String(status.external_port) }),
        warning: true,
      };
  }
}

/**
 * Collapsed support detail. Values the form already shows are omitted, and
 * engine-authored detail strings stay in Logs.
 */
function NetworkDetails({ settings }: { readonly settings: ClientSettingsRuntimeView }) {
  const listener = settings.effective_listener?.listener;
  const udp = settings.session_udp_status;
  const seedLimit = settings.effective_active_seeds;
  return (
    <details className={styles.networkDetails}>
      <summary>{localizedMessage("inspection.components.connection.seeding.settings.section.network.details")}</summary>
      <ul>
        {listener !== undefined &&
        isLoopbackListener(listener) &&
        settings.listener_status.type === "listening" ? (
          <li>{localizedMessage("inspection.components.connection.seeding.settings.section.details.development.loopback", { port: String(settings.listener_status.port) })}</li>
        ) : null}
        <li>
          {udp.type === "bound"
            ? localizedMessage("inspection.components.connection.seeding.settings.section.details.udp.port", { port: String(udp.port) })
            : localizedMessage("inspection.components.connection.seeding.settings.section.details.udp.unavailable")}
        </li>
        {settings.transport_families.map((family) => (
          <li key={family.family}>{transportFamilyLine(family)}</li>
        ))}
        <li>{forwardingLine("TCP", settings.port_mapping_status)}</li>
        <li>{forwardingLine("UDP", settings.udp_port_mapping_status)}</li>
        <li>{firewallLine(settings.ipv6_pinhole_status)}</li>
        <li>{advertisedLine(settings.advertised_peer_endpoint)}</li>
        <li>{localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.recovery")}</li>
        <li>
          {localizedMessage("inspection.components.connection.seeding.settings.section.details.active.downloads", {
            active: settings.active_download_count,
            limit: settings.effective_active_downloads,
            checking: settings.checking_count,
          })}
        </li>
        <li>
          {seedLimit.type === "unlimited"
            ? localizedMessage("inspection.components.connection.seeding.settings.section.details.active.seeds.unlimited", {
                active: settings.active_seed_count,
                idle: settings.inactive_seed_count,
              })
            : localizedMessage("inspection.components.connection.seeding.settings.section.details.active.seeds", {
                active: settings.active_seed_count,
                limit: seedLimit.torrents,
                idle: settings.inactive_seed_count,
              })}
        </li>
      </ul>
    </details>
  );
}

function transportFamilyLine(family: TransportFamilyRuntimeView): string {
  const name = family.family === "ipv4" ? "IPv4" : "IPv6";
  if (!family.configured) {
    return localizedMessage("inspection.components.connection.seeding.settings.section.details.family.off", { family: name });
  }
  const parts = [
    family.tcp_endpoint === null
      ? null
      : localizedMessage("inspection.components.connection.seeding.settings.section.details.family.tcp", { endpoint: family.tcp_endpoint }),
    family.udp_endpoint === null
      ? null
      : localizedMessage("inspection.components.connection.seeding.settings.section.details.family.udp", { endpoint: family.udp_endpoint }),
    family.advertised_endpoint === null
      ? localizedMessage("inspection.components.connection.seeding.settings.section.details.family.not.shared")
      : localizedMessage("inspection.components.connection.seeding.settings.section.details.family.shared", { endpoint: family.advertised_endpoint }),
  ].filter((part): part is string => part !== null);
  return localizedMessage("inspection.components.connection.seeding.settings.section.details.family", {
    family: name,
    details: parts.join(" · "),
  });
}

function forwardingLine(protocol: "TCP" | "UDP", status: PortMappingStatus): string {
  switch (status.type) {
    case "disabled":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.off", { protocol });
    case "ineligible":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.ineligible", { protocol });
    case "discovering":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.discovering", { protocol });
    case "mapping":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.requesting", { protocol });
    case "mapped":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.mapped", {
        protocol,
        external: `${status.external_address}:${status.external_port}`,
        local: `${status.local_address}:${status.local_port}`,
      });
    case "failed":
      return forwardingFailureLine(protocol, status.stage);
    case "renewal_failed":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.renewal.failed", {
        protocol,
        port: String(status.external_port),
      });
    case "cleanup_failed":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.cleanup.failed", {
        protocol,
        port: String(status.external_port),
        duration: formatElapsedSeconds(String(status.remaining_lease_seconds)),
      });
    case "stopping":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.stopping", { protocol });
  }
}

function forwardingFailureLine(
  protocol: "TCP" | "UDP",
  stage: PortMappingFailureStage,
): string {
  switch (stage) {
    case "discovery":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.failed.discovery", { protocol });
    case "description":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.failed.description", { protocol });
    case "external_address":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.failed.external.address", { protocol });
    case "add":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.failed.add", { protocol });
    case "verify":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.failed.verify", { protocol });
    case "renewal":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.failed.renewal", { protocol });
    case "delete":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.forwarding.failed.delete", { protocol });
  }
}

function firewallLine(status: Ipv6PinholeStatus): string {
  switch (status.type) {
    case "disabled":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.off");
    case "ineligible":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.ineligible");
    case "discovering":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.discovering");
    case "service_unavailable":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.service.unavailable");
    case "action_unavailable":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.action.unavailable");
    case "inbound_pinhole_disallowed":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.disallowed");
    case "unfiltered":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.unfiltered", { port: String(status.internal_port) });
    case "creating":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.creating", { port: String(status.internal_port) });
    case "pinholed":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.open", { port: String(status.internal_port) });
    case "failed":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.failed");
    case "renewal_failed":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.renewal.failed", { port: String(status.internal_port) });
    case "cleanup_failed":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.cleanup.failed", {
        port: String(status.internal_port),
        duration: formatElapsedSeconds(String(status.remaining_lease_seconds)),
      });
    case "stopping":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.firewall.stopping");
  }
}

function advertisedLine(status: AdvertisedPeerEndpointStatus): string {
  switch (status.type) {
    case "unavailable":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.advertised.unavailable");
    case "outbound_only":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.advertised.outbound");
    case "local":
      return status.incoming_observed
        ? localizedMessage("inspection.components.connection.seeding.settings.section.details.advertised.local.observed", { port: String(status.port) })
        : localizedMessage("inspection.components.connection.seeding.settings.section.details.advertised.local.unverified", { port: String(status.port) });
    case "mapped":
      return status.incoming_observed
        ? localizedMessage("inspection.components.connection.seeding.settings.section.details.advertised.mapped.observed", { port: String(status.external_port) })
        : localizedMessage("inspection.components.connection.seeding.settings.section.details.advertised.mapped.unobserved", { port: String(status.external_port) });
    case "renewal_unhealthy":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.advertised.renewal.unhealthy", {
        port: String(status.external_port),
        duration: formatElapsedSeconds(String(status.lease_seconds_remaining)),
      });
    case "stopping":
      return localizedMessage("inspection.components.connection.seeding.settings.section.details.advertised.stopping");
  }
}

interface ActiveSeedDraftField {
  readonly unlimited: boolean;
  readonly torrents: string;
}

interface ListenerDraftField {
  readonly mode: ListenerMode;
  readonly fixedPort: string;
}

interface ClientSettingsDraft {
  readonly listener: ListenerDraftField;
  readonly preferredPort: string;
  readonly portMapping: PortMappingPolicy;
  readonly peerLimit: string;
  readonly uploadSlots: string;
  readonly activeDownloads: string;
  readonly activeSeeds: ActiveSeedDraftField;
  readonly shareRatioLimit: string;
  readonly finishedDownloadRatioLimit: string;
  readonly finishedTimeLimit: DurationLimitDraft;
  readonly seedStopRatio: RatioLimitDraft;
  readonly seedStopTime: DurationLimitDraft;
  readonly uploadRate: RateLimitDraft;
  readonly downloadRate: RateLimitDraft;
  readonly encryption: EncryptionPolicy;
  readonly ipv6Enabled: boolean;
  readonly dhtEnabled: boolean;
  readonly peerExchangeEnabled: boolean;
}

const CLIENT_SETTINGS_COMPARATORS: SettingsDraftComparators<ClientSettingsDraft> = {
  listener: (left, right) =>
    left.mode === right.mode &&
    (left.mode !== "fixed" || left.fixedPort === right.fixedPort),
  preferredPort: Object.is,
  portMapping: Object.is,
  peerLimit: Object.is,
  uploadSlots: Object.is,
  activeDownloads: Object.is,
  activeSeeds: (left, right) =>
    left.unlimited === right.unlimited &&
    (left.unlimited || left.torrents === right.torrents),
  shareRatioLimit: Object.is,
  finishedDownloadRatioLimit: Object.is,
  finishedTimeLimit: sameDurationLimitDraft,
  seedStopRatio: sameRatioLimitDraft,
  seedStopTime: sameDurationLimitDraft,
  uploadRate: sameRateLimitDraft,
  downloadRate: sameRateLimitDraft,
  encryption: Object.is,
  ipv6Enabled: Object.is,
  dhtEnabled: Object.is,
  peerExchangeEnabled: Object.is,
};

function clientSettingsDraft(settings: ClientSettings): ClientSettingsDraft {
  return {
    listener: {
      mode: productListenerMode(settings.listener),
      fixedPort: isFixedListener(settings.listener)
        ? String(settings.listener.port)
        : "",
    },
    preferredPort: String(settings.preferred_listen_port),
    portMapping: settings.port_mapping,
    peerLimit: String(settings.peer_connection_limit),
    uploadSlots: String(settings.upload_slots),
    activeDownloads: String(settings.active_downloads),
    activeSeeds: {
      unlimited: settings.active_seeds.type === "unlimited",
      torrents:
        settings.active_seeds.type === "limited"
          ? String(settings.active_seeds.torrents)
          : "5",
    },
    shareRatioLimit: String(settings.share_ratio_limit_percent),
    finishedDownloadRatioLimit: String(
      settings.finished_download_ratio_limit_percent,
    ),
    finishedTimeLimit: durationLimitDraft({
      type: "limited",
      value: settings.finished_time_limit_seconds,
    }),
    seedStopRatio: ratioLimitDraft(settings.seed_stop_ratio_percent),
    seedStopTime: durationLimitDraft(settings.seed_stop_time_seconds),
    uploadRate: {
      unlimited: settings.upload_rate_limit.type === "unlimited",
      valueKiB: rateLimitDraftValue(
        settings.upload_rate_limit,
        DEFAULT_UPLOAD_RATE_KIB,
      ),
    },
    downloadRate: {
      unlimited: settings.download_rate_limit.type === "unlimited",
      valueKiB: rateLimitDraftValue(
        settings.download_rate_limit,
        DEFAULT_DOWNLOAD_RATE_KIB,
      ),
    },
    encryption: settings.encryption,
    ipv6Enabled: settings.ipv6_enabled,
    dhtEnabled: settings.dht_enabled,
    peerExchangeEnabled: settings.peer_exchange_enabled,
  };
}

function sameRateLimitDraft(
  left: RateLimitDraft,
  right: RateLimitDraft,
): boolean {
  return left.unlimited === right.unlimited &&
    (left.unlimited || left.valueKiB === right.valueKiB);
}

function clientSettingsPatch(
  fields: readonly (keyof ClientSettingsDraft)[],
  settings: ClientSettings | null,
): ClientSettingsPatch | null {
  if (settings === null || fields.length === 0) return null;
  return {
    ...(fields.includes("listener") ? { listener: settings.listener } : {}),
    ...(fields.includes("preferredPort")
      ? { preferred_listen_port: settings.preferred_listen_port }
      : {}),
    ...(fields.includes("portMapping")
      ? { port_mapping: settings.port_mapping }
      : {}),
    ...(fields.includes("peerLimit")
      ? { peer_connection_limit: settings.peer_connection_limit }
      : {}),
    ...(fields.includes("uploadSlots")
      ? { upload_slots: settings.upload_slots }
      : {}),
    ...(fields.includes("activeDownloads")
      ? { active_downloads: settings.active_downloads }
      : {}),
    ...(fields.includes("activeSeeds")
      ? { active_seeds: settings.active_seeds }
      : {}),
    ...(fields.includes("shareRatioLimit")
      ? { share_ratio_limit_percent: settings.share_ratio_limit_percent }
      : {}),
    ...(fields.includes("finishedDownloadRatioLimit")
      ? {
          finished_download_ratio_limit_percent:
            settings.finished_download_ratio_limit_percent,
        }
      : {}),
    ...(fields.includes("finishedTimeLimit")
      ? { finished_time_limit_seconds: settings.finished_time_limit_seconds }
      : {}),
    ...(fields.includes("seedStopRatio")
      ? { seed_stop_ratio_percent: settings.seed_stop_ratio_percent }
      : {}),
    ...(fields.includes("seedStopTime")
      ? { seed_stop_time_seconds: settings.seed_stop_time_seconds }
      : {}),
    ...(fields.includes("uploadRate")
      ? { upload_rate_limit: settings.upload_rate_limit }
      : {}),
    ...(fields.includes("downloadRate")
      ? { download_rate_limit: settings.download_rate_limit }
      : {}),
    ...(fields.includes("encryption")
      ? { encryption: settings.encryption }
      : {}),
    ...(fields.includes("ipv6Enabled")
      ? { ipv6_enabled: settings.ipv6_enabled }
      : {}),
    ...(fields.includes("dhtEnabled")
      ? { dht_enabled: settings.dht_enabled }
      : {}),
    ...(fields.includes("peerExchangeEnabled")
      ? { peer_exchange_enabled: settings.peer_exchange_enabled }
      : {}),
  };
}

function clientDraftStatus(
  state: SettingsDraftState<ClientSettingsDraft>,
  phase: SettingsDraftPhase,
): string | null {
  if (phase === "submitting" || phase === "awaiting_view") {
    return localizedMessage("inspection.components.connection.seeding.settings.section.saving");
  }
  if (phase === "conflict") {
    return localizedMessage("inspection.components.connection.seeding.settings.section.changed.elsewhere");
  }
  return state.failure;
}

function validateDraft(
  listenerMode: ListenerMode,
  preferredPort: string,
  fixedPort: string,
  portMapping: PortMappingPolicy,
  peerLimit: string,
  uploadSlots: string,
  activeDownloads: string,
  activeSeeds: ActiveSeedDraftField,
  shareRatioLimit: string,
  finishedDownloadRatioLimit: string,
  finishedTime: SeedStopValidation,
  seedStopRatio: SeedStopValidation,
  seedStopTime: SeedStopValidation,
  uploadRate: RateLimitValidation,
  downloadRate: RateLimitValidation,
  encryption: EncryptionPolicy,
  ipv6Enabled: boolean,
  dhtEnabled: boolean,
  peerExchangeEnabled: boolean,
  trackerHttpsServerAuthentication: ClientSettings["tracker_https_server_authentication"],
): DraftValidation {
  const preferred = parseBoundedInteger(
    preferredPort,
    FIXED_PORT_MINIMUM,
    FIXED_PORT_MAXIMUM,
  );
  const port = parseBoundedInteger(
    fixedPort,
    FIXED_PORT_MINIMUM,
    FIXED_PORT_MAXIMUM,
  );
  const peers = parseBoundedInteger(
    peerLimit,
    PEER_LIMIT_MINIMUM,
    PEER_LIMIT_MAXIMUM,
  );
  const slots = parseBoundedInteger(
    uploadSlots,
    UPLOAD_SLOTS_MINIMUM,
    UPLOAD_SLOTS_MAXIMUM,
  );
  const downloads = parseBoundedInteger(
    activeDownloads,
    ACTIVE_DOWNLOADS_MINIMUM,
    ACTIVE_DOWNLOADS_MAXIMUM,
  );
  const seeds = parseBoundedInteger(
    activeSeeds.torrents,
    ACTIVE_SEEDS_MINIMUM,
    ACTIVE_SEEDS_MAXIMUM,
  );
  const shareRatio = parseBoundedInteger(
    shareRatioLimit,
    SEED_GOAL_MINIMUM,
    SEED_GOAL_MAXIMUM,
  );
  const finishedDownloadRatio = parseBoundedInteger(
    finishedDownloadRatioLimit,
    SEED_GOAL_MINIMUM,
    SEED_GOAL_MAXIMUM,
  );
  const fixedPortError =
    !isFixedListenerMode(listenerMode)
      ? null
      : port === null
        ? wholeNumberError(FIXED_PORT_MINIMUM, FIXED_PORT_MAXIMUM)
        : null;
  const preferredPortError =
    preferred === null
      ? wholeNumberError(FIXED_PORT_MINIMUM, FIXED_PORT_MAXIMUM)
      : null;
  const peerLimitError =
    peers === null
      ? wholeNumberError(PEER_LIMIT_MINIMUM, PEER_LIMIT_MAXIMUM)
      : null;
  const uploadSlotsError =
    slots === null
      ? wholeNumberError(UPLOAD_SLOTS_MINIMUM, UPLOAD_SLOTS_MAXIMUM)
      : null;
  const activeDownloadsError =
    downloads === null
      ? wholeNumberError(ACTIVE_DOWNLOADS_MINIMUM, ACTIVE_DOWNLOADS_MAXIMUM)
      : null;
  const activeSeedsError =
    activeSeeds.unlimited || seeds !== null
      ? null
      : wholeNumberError(ACTIVE_SEEDS_MINIMUM, ACTIVE_SEEDS_MAXIMUM);
  const shareRatioError =
    shareRatio === null
      ? wholeNumberError(SEED_GOAL_MINIMUM, SEED_GOAL_MAXIMUM)
      : null;
  const finishedDownloadRatioError =
    finishedDownloadRatio === null
      ? wholeNumberError(SEED_GOAL_MINIMUM, SEED_GOAL_MAXIMUM)
      : null;
  const finishedTimeError = finishedTime.error;
  if (
    preferredPortError !== null ||
    fixedPortError !== null ||
    peerLimitError !== null ||
    uploadSlotsError !== null ||
    activeDownloadsError !== null ||
    activeSeedsError !== null ||
    shareRatioError !== null ||
    finishedDownloadRatioError !== null ||
    finishedTimeError !== null ||
    seedStopRatio.error !== null ||
    seedStopTime.error !== null ||
    uploadRate.error !== null ||
    downloadRate.error !== null
  ) {
    return {
      settings: null,
      preferredPortError,
      fixedPortError,
      peerLimitError,
      uploadSlotsError,
      activeDownloadsError,
      activeSeedsError,
      shareRatioError,
      finishedDownloadRatioError,
      finishedTimeError,
      seedStopRatioError: seedStopRatio.error,
      seedStopTimeError: seedStopTime.error,
      uploadRateError: uploadRate.error,
      downloadRateError: downloadRate.error,
    };
  }
  const listener: ListenerPolicy = listenerMode === "off"
    ? { type: "disabled" }
    : listenerMode === "automatic"
    ? { type: "automatic_local_network" }
    : { type: "fixed_local_network", port: port as number };
  return {
    settings: {
      listener,
      preferred_listen_port: preferred as number,
      port_mapping: listenerMode === "off" ? "disabled" : portMapping,
      peer_connection_limit: peers as number,
      upload_slots: slots as number,
      active_downloads: downloads as number,
      active_seeds: activeSeeds.unlimited
        ? { type: "unlimited" }
        : { type: "limited", torrents: seeds as number },
      share_ratio_limit_percent: shareRatio as number,
      finished_download_ratio_limit_percent: finishedDownloadRatio as number,
      finished_time_limit_seconds:
        finishedTime.limit?.type === "limited" ? finishedTime.limit.value : NO_TIME_GOAL_SECONDS,
      upload_rate_limit: uploadRate.limit as TransferRateLimit,
      download_rate_limit: downloadRate.limit as TransferRateLimit,
      encryption,
      ipv6_enabled: ipv6Enabled,
      dht_enabled: dhtEnabled,
      peer_exchange_enabled: peerExchangeEnabled,
      tracker_https_server_authentication: trackerHttpsServerAuthentication,
      seed_stop_ratio_percent: sessionSeedStopLimit(
        seedStopRatio.limit as NonNullable<SeedStopValidation["limit"]>,
      ),
      seed_stop_time_seconds: sessionSeedStopLimit(
        seedStopTime.limit as NonNullable<SeedStopValidation["limit"]>,
      ),
    },
    preferredPortError: null,
    fixedPortError: null,
    peerLimitError: null,
    uploadSlotsError: null,
    activeDownloadsError: null,
    activeSeedsError: null,
    shareRatioError: null,
    finishedDownloadRatioError: null,
    finishedTimeError: null,
    seedStopRatioError: null,
    seedStopTimeError: null,
    uploadRateError: null,
    downloadRateError: null,
  };
}

/** Ports read as identifiers, so their range is shown without grouping. */
function wholeNumberError(minimum: number, maximum: number): string {
  const options = { useGrouping: minimum !== FIXED_PORT_MINIMUM };
  return localizedMessage("inspection.components.connection.seeding.settings.section.whole.number.range", {
    minimum: formatNumber(minimum, options),
    maximum: formatNumber(maximum, options),
  });
}

function parseBoundedInteger(
  value: string,
  minimum: number,
  maximum: number,
): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

const LISTENER_OPTIONS: readonly SegmentedOption<"automatic" | "fixed">[] = [
  {
    value: "automatic",
    label: localizedMessage("inspection.components.connection.seeding.settings.section.automatic"),
    description: localizedMessage("inspection.components.connection.seeding.settings.section.automatic.port.description"),
  },
  {
    value: "fixed",
    label: localizedMessage("inspection.components.connection.seeding.settings.section.fixed"),
    description: localizedMessage("inspection.components.connection.seeding.settings.section.fixed.port.description"),
  },
];

const ENCRYPTION_OPTIONS: readonly SegmentedOption<EncryptionPolicy>[] = [
  {
    value: "disabled",
    label: localizedMessage("inspection.components.connection.seeding.settings.section.disabled.75081b5"),
    description: localizedMessage("inspection.components.connection.seeding.settings.section.encryption.disabled.description"),
  },
  {
    value: "allow",
    label: localizedMessage("inspection.components.connection.seeding.settings.section.allow"),
    description: localizedMessage("inspection.components.connection.seeding.settings.section.encryption.allow.description"),
  },
  {
    value: "prefer",
    label: localizedMessage("inspection.components.connection.seeding.settings.section.prefer"),
    description: localizedMessage("inspection.components.connection.seeding.settings.section.encryption.prefer.description"),
  },
  {
    value: "required",
    label: localizedMessage("inspection.components.connection.seeding.settings.section.required"),
    description: localizedMessage("inspection.components.connection.seeding.settings.section.encryption.required.description"),
  },
];

function isFixedListenerMode(mode: ListenerMode): boolean {
  return mode === "fixed";
}

function productListenerMode(listener: ListenerPolicy): ListenerMode {
  if (listener.type === "disabled") return "off";
  return listener.type === "fixed_loopback" ||
    listener.type === "fixed_local_network"
    ? "fixed"
    : "automatic";
}

function isFixedListener(
  listener: ListenerPolicy,
): listener is Extract<
  ListenerPolicy,
  { type: "fixed_loopback" | "fixed_local_network" }
> {
  return listener.type === "fixed_loopback" ||
    listener.type === "fixed_local_network";
}

function isLoopbackListener(listener: ListenerPolicy): boolean {
  return listener.type === "automatic_loopback" ||
    listener.type === "fixed_loopback";
}
