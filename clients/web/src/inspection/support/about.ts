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
  /** Desktop or Android application identifier of the running profile. */
  readonly identifier?: string;
  /** Build of this page when it is deployed separately from the host. */
  readonly pageBuild?: string;
}

export interface SupportFacts {
  readonly about: AboutFacts;
  readonly updater?: DesktopUpdaterSnapshot | undefined;
}

const PRODUCTION_IDENTIFIERS = new Set(["com.jstorrent.desktop", "com.jstorrent.app"]);
const PREVIEW_IDENTIFIERS = new Set(["com.jstorrent.rstorrent"]);

export function productFlavor(identifier: string): ProductFlavor {
  if (PRODUCTION_IDENTIFIERS.has(identifier)) return "production";
  if (PREVIEW_IDENTIFIERS.has(identifier)) return "preview";
  return "development";
}
