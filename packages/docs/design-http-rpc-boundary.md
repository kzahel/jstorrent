
# **Node-Only Orchestration Layer – Architectural Boundary**

## **1. Purpose and Scope**

The HTTP RPC orchestration layer exists **only** for:

* Node-based integration and e2e testing
* Python-driven tests
* Local developer tooling
* Standalone CLI/Node debugging

It is **not** part of the core engine and is **not used in production environments** (browser extension, native host, io-daemon, mobile, etc.).

It is simply a scaffolding runtime for the Node test environment.

---

## **2. Hard Separation Rules**

### **Rule 1: BtEngine must never import or reference HTTP code**

**BtEngine:**

* Contains zero knowledge of HTTP
* Has no built-in server
* Never exposes HTTP-related functions
* Has no adapters for request/response handling
* Does not create or manage processes

### **Rule 2: The HTTP RPC layer treats BtEngine as a pure library**

The orchestration layer calls BtEngine *exactly as*:

```ts
const engine = new BtEngine(config)
```

and never modifies its internal architecture.

### **Rule 3: The HTTP RPC layer lives in a separate module**

Directory structure:

```
packages/engine/             (core BtEngine library)
packages/engine-node-rpc/    (Node-only RPC orchestration)
packages/engine-tests/       (Python + RPC integration)
```

or if kept in a single package:

```
src/core/         (BtEngine and subsystems)
src/node-rpc/     (HTTP orchestration code)
src/node-cli/     (optional CLI entrypoints)
```

This ensures imports remain one-directional:

```
node-rpc → BtEngine
BtEngine → (never) node-rpc
```

### **Rule 4: Other runtimes get their own orchestration layer**

Future environments will provide their own orchestration:

* **Chrome extension** → controlled by Native Messaging
* **Native host** → binary protocol, not HTTP
* **io-daemon** → WebSockets binary transport
* **Mobile** → direct JS/TS calls or platform bridges

None of these reuse the Node HTTP RPC.

---

## **3. Why this separation is crucial**

### **A. Engine remains portable**

The same BtEngine runs everywhere:

* browser
* extension
* node
* native host
* mobile
* workers

### **B. No HTTP dependencies leak into the engine**

No issues with:

* bundlers
* tree-shaking
* servers ending up in extension builds
* unnecessary polyfills
* security reviews

### **C. Engine stays testable in memory**

MemorySwarm tests run *without* the HTTP layer.

### **D. Other orchestration layers can evolve independently**

Your io-daemon → native-host → extension stack remains clean.

---

## **4. Updated Design Summary**

### **BtEngine**

* pure TypeScript library
* domain logic only
* no networking setup outside provided factories
* no process or HTTP awareness
* completely independent of Node environment

### **Node HTTP RPC Layer**

* thin wrapper around BtEngine
* exists *only* in Node runtime
* used for Python + Node e2e tests
* provides deterministic lifecycle
* isolates test infrastructure from core engine
* safe to delete or replace without touching engine internals

### **Other orchestration layers**

* implemented separately
* use different protocols (native messaging, WebSockets, IPC)
* must never import Node HTTP RPC server code

---

## **5. Boilerplate paragraph (for doc headers)**

You can paste this at the top of the design doc:

