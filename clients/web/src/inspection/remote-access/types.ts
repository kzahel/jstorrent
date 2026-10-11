export type RemoteClientState = "current" | "revoked" | "expired";
export type RemoteAuthenticationMethod = "password" | "resume";

export interface RemoteAuthorizedClient {
  readonly client_id: string;
  readonly label: string;
  readonly fingerprint: string;
  readonly created: number;
  readonly last_full_login: number;
  readonly last_resume: number | null;
  readonly last_seen: number;
  readonly idle_expires: number;
  readonly absolute_expires: number;
  readonly state: RemoteClientState;
  readonly client_build: string | null;
  readonly route_observation: string | null;
  readonly browser_observation: string | null;
}

export interface RemoteTombstone {
  readonly client_id: string;
  readonly label: string;
  readonly fingerprint: string;
  readonly created: number;
  readonly last_seen: number;
  readonly ended: number;
  readonly state: RemoteClientState;
}

export interface RemoteSecurityEvent {
  readonly event_id: string;
  readonly timestamp: number;
  readonly kind: string;
  readonly result: "succeeded" | "rejected";
  readonly client_id: string | null;
  readonly circuit_id: string | null;
  readonly authentication_method: RemoteAuthenticationMethod | null;
  readonly route: string | null;
  readonly client_build: string | null;
  readonly reason_class: string | null;
  readonly direct_file: RemoteDirectFileAudit | null;
}

export interface RemoteDirectFileAudit {
  readonly torrent_id: string;
  readonly file_index: number;
  readonly byte_count: number;
  readonly candidate_class: string | null;
}

export interface RemoteFailedAttemptBucket {
  readonly bucket_start: number;
  readonly kind: "password" | "resume" | "rate_limited";
  readonly route_class: string;
  readonly attempts: number;
}

export interface RemoteSecuritySnapshot {
  readonly generation: number;
  readonly authorization_generation: number;
  readonly clients: readonly RemoteAuthorizedClient[];
  readonly tombstones: readonly RemoteTombstone[];
  readonly events: readonly RemoteSecurityEvent[];
  readonly failed_attempts: readonly RemoteFailedAttemptBucket[];
}

export interface RemoteLiveCircuit {
  readonly circuit_id: string;
  readonly client_id: string | null;
  readonly authentication_method: RemoteAuthenticationMethod;
  readonly connection_generation: number;
  readonly started: number;
  readonly last_activity: number;
  readonly route: string;
}

export interface RemoteSecurityView {
  readonly enabled: boolean;
  readonly username: string | null;
  readonly route: string | null;
  readonly relay_id: string | null;
  readonly host_pin: string | null;
  readonly authority: RemoteSecuritySnapshot | null;
  readonly retained_history: RemoteSecuritySnapshot | null;
  readonly live_circuits: readonly RemoteLiveCircuit[];
  readonly direct_file: RemoteDirectFileSecurity;
}

export interface RemoteDirectFileSecurity {
  readonly compiled: boolean;
  readonly enabled: boolean;
  readonly state: string;
  readonly active_circuit_id: string | null;
  readonly bytes_sent: number;
  readonly candidate_class: string | null;
  readonly active_tasks: number;
  readonly open_sockets: number;
  readonly active_requests: number;
  readonly queued_bytes: number;
}

export interface DesktopRemoteAccessState {
  readonly configured: boolean;
  readonly security: RemoteSecurityView | null;
}

export interface DisableRemoteAccessOutcome {
  readonly authority_file_removed: boolean;
  readonly route_released: boolean;
}

export interface DesktopRemoteAccess {
  readonly scope: "local" | "remote";
  readonly currentClientId?: string | undefined;
  state(): Promise<DesktopRemoteAccessState>;
  enable(username: string, passphrase: string): Promise<RemoteSecurityView>;
  rename(clientId: string, label: string): Promise<void>;
  revoke(clientId: string): Promise<void>;
  revokeAllOther(retainedClientId: string): Promise<number>;
  closeCircuit(circuitId: string): Promise<void>;
  requirePasswordEverywhere(): Promise<number>;
  changePassphrase(passphrase: string): Promise<number>;
  disable(): Promise<DisableRemoteAccessOutcome>;
  recover(username: string, passphrase: string): Promise<RemoteSecurityView>;
  clearHistory(): Promise<boolean>;
  setDirectFileTransfersEnabled(enabled: boolean): Promise<RemoteSecurityView>;
  stopDirectFileTransfers(): Promise<RemoteSecurityView>;
  directFileSupported?(): boolean;
  saveCompletedFile?(request: RemoteCompletedFileSaveRequest): Promise<void>;
  playCompletedFile?(request: RemoteCompletedFilePlaybackRequest): Promise<{ close(): Promise<void> }>;
  signOutThisBrowser?(): Promise<void>;
}

export interface RemoteCompletedFileSaveRequest {
  readonly torrentId: string;
  readonly fileIndex: number;
  readonly fileName: string;
  readonly lengthBytes: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RemoteCompletedFileSaveProgress) => void;
}

export interface RemoteCompletedFileSaveProgress {
  readonly state: "choosing_destination" | "connecting" | "transferring" | "complete";
  readonly bytesWritten: bigint;
  readonly fileLength: bigint;
}

export interface RemoteCompletedFilePlaybackRequest {
  readonly torrentId: string;
  readonly fileIndex: number;
  readonly fileName: string;
  readonly lengthBytes: string;
  readonly video: HTMLVideoElement;
  readonly signal?: AbortSignal;
  readonly onReady?: () => void;
  readonly onError?: (message: string) => void;
}
