import type { ApiProductInfo } from "../../api";
import type { StartupTimings } from "../../startup-timing";
import type { DesktopUpdaterSnapshot } from "../updater/types";

/** How this page reaches the library it shows. */
export type AboutConnection =
  | "desktop"
  | "server"
  | "remote"
  | "android-companion"
  | "desktop-companion"
  | "demo";

export type ProductFlavor = "production" | "preview" | "development";

/**
 * Product facts a host makes known without an updater. Facts an updater
 * reports (version, build, target, package) take precedence when present.
 */
export interface AboutFacts {
  readonly connection?: AboutConnection;
  readonly hostVersion?: string;
  readonly hostBuild?: string;
  readonly hostTarget?: string;
  /** Host directory of the profile; shown to the owner, never in diagnostics. */
  readonly profileLocation?: string;
  /** Desktop or Android application identifier of the running profile. */
  readonly identifier?: string;
  /** Build of this page when it is deployed separately from the host. */
  readonly pageBuild?: string;
}

export interface SupportFacts {
  readonly about: AboutFacts;
  readonly updater?: DesktopUpdaterSnapshot | undefined;
  /** This page's startup phases, in milliseconds since navigation. */
  readonly startup?: StartupTimings | undefined;
}

const PRODUCTION_IDENTIFIERS = new Set(["com.jstorrent.desktop", "com.jstorrent.app"]);
const PREVIEW_IDENTIFIERS = new Set(["com.jstorrent.rstorrent"]);

/** Overlays what the host reports in its API hello on the page's own facts. */
export function withHostProduct(
  about: AboutFacts,
  host: ApiProductInfo | null | undefined,
): AboutFacts {
  if (host === null || host === undefined) return about;
  return {
    ...about,
    hostVersion: host.version,
    hostBuild: host.build_id,
    hostTarget: host.target,
    ...(host.identifier === null || host.identifier === undefined
      ? {}
      : { identifier: host.identifier }),
    ...(host.profile_location === null || host.profile_location === undefined
      ? {}
      : { profileLocation: host.profile_location }),
  };
}

export function productFlavor(identifier: string): ProductFlavor {
  if (PRODUCTION_IDENTIFIERS.has(identifier)) return "production";
  if (PREVIEW_IDENTIFIERS.has(identifier)) return "preview";
  return "development";
}
