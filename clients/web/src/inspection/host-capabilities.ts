import {
  HOST_CAPABILITY_REGISTRY,
  type ClientSettingsPatch,
  type Command,
  type HostCapabilityDefinition,
  type TorrentSettingsPatch,
} from "../api";
import type { SessionSummary } from "./model";

/** Host capability names, from the Rust registry. */
export const SEED_STOP_LIMITS = "seed_stop_limits";
export const MAGNET_EXPORT_OPTIONS = "magnet_export_options";

/**
 * Whether the connected host has a capability. A host that reports no list
 * (the demo, or a host before its hello arrives) is treated as current;
 * outgoing commands are still filtered by the live connection.
 */
export function hostSupports(
  session: Pick<SessionSummary, "hostCapabilities">,
  capability: string,
): boolean {
  const capabilities = session.hostCapabilities;
  return capabilities === undefined || capabilities === null
    ? true
    : capabilities.includes(capability);
}

/**
 * Drops the patch keys owned by capabilities the host does not advertise.
 * A host released before a key existed rejects the whole command, and over
 * remote access that closes the connection.
 */
export function supportedPatch<Patch extends ClientSettingsPatch | TorrentSettingsPatch>(
  patch: Patch,
  kind: "client_settings" | "torrent_settings",
  capabilities: ReadonlySet<string>,
  registry: readonly HostCapabilityDefinition[] = HOST_CAPABILITY_REGISTRY,
): Patch {
  const unsupported = new Set(
    registry
      .filter((capability) => !capabilities.has(capability.name))
      .flatMap((capability) =>
        kind === "client_settings"
          ? capability.client_settings_patch_keys
          : capability.torrent_settings_patch_keys,
      ),
  );
  if (unsupported.size === 0) return patch;
  return Object.fromEntries(
    Object.entries(patch).filter(([key]) => !unsupported.has(key)),
  ) as Patch;
}

/**
 * Drops command fields owned by capabilities the host does not advertise.
 * A released host's command parser ignores unknown fields, so sending one
 * would silently lose what it asked for; the caller still gets the
 * baseline behavior of the command.
 */
export function supportedCommand(
  command: Command,
  capabilities: ReadonlySet<string>,
  registry: readonly HostCapabilityDefinition[] = HOST_CAPABILITY_REGISTRY,
): Command {
  const unsupported = registry
    .filter((capability) => !capabilities.has(capability.name))
    .flatMap((capability) => capability.command_fields)
    .filter((owned) => owned.startsWith(`${command.type}.`))
    .map((owned) => owned.slice(command.type.length + 1));
  if (unsupported.length === 0) return command;
  return Object.fromEntries(
    Object.entries(command).filter(([key]) => !unsupported.includes(key)),
  ) as Command;
}
