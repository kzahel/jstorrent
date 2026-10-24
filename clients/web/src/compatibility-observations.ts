import type { ApiHello, ApplicationClientFrame } from "./api";

/**
 * What this client saw go wrong, or degrade, with each host version it
 * connected to (Tactical 370). In memory only and bounded; nothing here is
 * transmitted. A host that reports no product (released before 0.3.2) is
 * `unreported`; failures before any hello was read are `unknown`.
 */
export interface CompatibilityObservation {
  /** Host `kind version`, `unreported` or `unknown`. */
  readonly peer: string;
  readonly connections: number;
  /** Server frames this client could not decode, by stage. */
  readonly decodeFailures: { readonly handshake: number; readonly frame: number };
  /** Calls the host refused as too new for it, by operation. */
  readonly refusedCalls: Readonly<Record<string, number>>;
  /** Command fields and settings keys dropped because the host lacks them. */
  readonly strippedFields: Readonly<Record<string, number>>;
  /** Actions refused or substituted locally for this host, by reason. */
  readonly degradedActions: Readonly<Record<string, number>>;
  /** Whether the library view opened at least once. */
  readonly libraryAttached: boolean;
}

const MAX_PEERS = 8;
const MAX_KEYS = 32;
const UNKNOWN = "unknown";
const OTHER = "other";

interface MutableObservation {
  peer: string;
  connections: number;
  decodeFailures: { handshake: number; frame: number };
  refusedCalls: Map<string, number>;
  strippedFields: Map<string, number>;
  degradedActions: Map<string, number>;
  libraryAttached: boolean;
}

export class CompatibilityObservations {
  private readonly peers = new Map<string, MutableObservation>();
  private current = UNKNOWN;

  /** A connection completed its handshake with this hello. */
  connected(hello: ApiHello): void {
    this.current = peerKey(hello);
    const entry = this.entry();
    entry.connections += 1;
  }

  /** A connection attempt starts; failures until its hello are `unknown`. */
  connecting(): void {
    this.current = UNKNOWN;
  }

  decodeFailure(stage: "handshake" | "frame"): void {
    this.entry().decodeFailures[stage] += 1;
  }

  refusedCall(operation: string): void {
    increment(this.entry().refusedCalls, operation);
  }

  strippedField(field: string): void {
    increment(this.entry().strippedFields, field);
  }

  degradedAction(reason: string): void {
    increment(this.entry().degradedActions, reason);
  }

  libraryAttached(): void {
    this.entry().libraryAttached = true;
  }

  snapshot(): CompatibilityObservation[] {
    return [...this.peers.values()].map((entry) => ({
      peer: entry.peer,
      connections: entry.connections,
      decodeFailures: { ...entry.decodeFailures },
      refusedCalls: Object.fromEntries(entry.refusedCalls),
      strippedFields: Object.fromEntries(entry.strippedFields),
      degradedActions: Object.fromEntries(entry.degradedActions),
      libraryAttached: entry.libraryAttached,
    }));
  }

  private entry(): MutableObservation {
    let peer = this.current;
    if (!this.peers.has(peer) && this.peers.size >= MAX_PEERS) peer = OTHER;
    let entry = this.peers.get(peer);
    if (entry === undefined) {
      entry = {
        peer,
        connections: 0,
        decodeFailures: { handshake: 0, frame: 0 },
        refusedCalls: new Map(),
        strippedFields: new Map(),
        degradedActions: new Map(),
        libraryAttached: false,
      };
      this.peers.set(peer, entry);
    }
    return entry;
  }
}

/** The operation a client frame asks for, such as `dispatch:pause`. */
export function operationName(frame: ApplicationClientFrame): string {
  if (frame.type !== "call") return frame.type;
  const operation = frame.operation;
  return operation.type === "dispatch"
    ? `dispatch:${operation.request.command.type}`
    : operation.type;
}

function peerKey(hello: ApiHello): string {
  const product = hello.product;
  return product === undefined || product === null
    ? "unreported"
    : `${product.kind} ${product.version}`.slice(0, 80);
}

function increment(counts: Map<string, number>, key: string): void {
  const bounded = counts.has(key) || counts.size < MAX_KEYS ? key : OTHER;
  counts.set(bounded, (counts.get(bounded) ?? 0) + 1);
}
