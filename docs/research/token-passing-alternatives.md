# Token Passing Alternatives for io-daemon

## Problem Statement

The `jstorrent-io-daemon` currently receives its authentication token via command-line arguments:

```rust
cmd.arg("--token").arg(&token)
```

Command-line arguments are visible to any user on the system via `ps aux` (Unix) or Task Manager/Process Explorer (Windows). This is a security concern as it exposes the authentication token.

**Current location:** [daemon_manager.rs:37-45](../native-host/src/daemon_manager.rs#L37-L45)

There's already a TODO acknowledging this:
```rust
// TODO: Pass token via stdin or temp file instead of command line arg.
// Command line args are visible in `ps aux` output which is a security concern.
```

## Current Token Flow

```
┌─────────────────────────────────────────────────────────────┐
│ NATIVE HOST (Rust)                                          │
├─────────────────────────────────────────────────────────────┤
│ 1. Generate UUID token                                      │
│ 2. Spawn io-daemon: --token <uuid>  ← VISIBLE IN ps aux     │
│ 3. Return { token, port } to extension via native messaging │
└─────────────────────────────────────────────────────────────┘
```

## Alternative Approaches

### Option 1: stdin Pipe (Recommended)

**How it works:** Write the token to the daemon's stdin immediately after spawning. The daemon reads a single line from stdin at startup, then closes stdin and proceeds normally.

**Native host side (daemon_manager.rs):**
```rust
let mut cmd = Command::new(daemon_path);
cmd.arg("--port").arg("0")
    .arg("--parent-pid").arg(std::process::id().to_string())
    .arg("--install-id").arg(install_id)
    .stdin(Stdio::piped())  // Enable stdin pipe
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

let mut child = cmd.spawn()?;

// Write token to stdin
if let Some(mut stdin) = child.stdin.take() {
    writeln!(stdin, "{}", token)?;
    // stdin is dropped here, sending EOF
}
```

**Daemon side (main.rs):**
```rust
use std::io::{self, BufRead};

fn read_token_from_stdin() -> Result<String, io::Error> {
    let stdin = io::stdin();
    let mut line = String::new();
    stdin.lock().read_line(&mut line)?;
    Ok(line.trim().to_string())
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let token = read_token_from_stdin()
        .expect("Failed to read token from stdin");
    // ... rest of startup
}
```

**Pros:**
- Most secure - not visible in process listings at all
- Truly cross-platform - identical API on Linux, macOS, Windows
- Simple implementation
- Token only exists in process memory after read

**Cons:**
- Slightly more complex spawn logic
- Need to handle potential stdin read timeout (though unlikely to be an issue)
- Debugging harder since you can't see the token in `ps`

---

### Option 2: Environment Variable

**How it works:** Pass the token via an environment variable instead of CLI args.

**Native host side:**
```rust
let mut cmd = Command::new(daemon_path);
cmd.env("JST_TOKEN", &token)
    .arg("--port").arg("0")
    // ... other args
```

**Daemon side:**
```rust
let token = std::env::var("JST_TOKEN")
    .expect("JST_TOKEN environment variable required");
```

**Pros:**
- Simple to implement
- Cross-platform
- Better than CLI args

**Cons:**
- Still somewhat visible:
  - Linux: `/proc/<pid>/environ` readable by same user (or root)
  - Windows: Process Explorer can show environment variables
  - macOS: `ps eww` or similar tools
- Not a significant security improvement over CLI args in practice

---

### Option 3: Temporary File with Restricted Permissions

**How it works:** Write the token to a temp file with restrictive permissions, pass the file path via CLI, daemon reads and deletes the file.

**Native host side:**
```rust
use std::fs::{File, Permissions};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use tempfile::NamedTempFile;

// Create temp file with restrictive permissions
let mut temp_file = NamedTempFile::new()?;
temp_file.write_all(token.as_bytes())?;

#[cfg(unix)]
std::fs::set_permissions(temp_file.path(), Permissions::from_mode(0o600))?;

let token_path = temp_file.path().to_string_lossy().to_string();

let mut cmd = Command::new(daemon_path);
cmd.arg("--token-file").arg(&token_path)
    // ... other args
```

**Daemon side:**
```rust
let token = if let Some(path) = args.token_file {
    let token = std::fs::read_to_string(&path)?;
    std::fs::remove_file(&path)?;  // Delete after reading
    token.trim().to_string()
} else {
    args.token.clone()  // Fallback to CLI arg
};
```

**Pros:**
- Token not visible in process listings
- File permissions restrict access (on Unix)

**Cons:**
- Windows permission handling is more complex (ACLs instead of mode bits)
- Race condition window between file creation and daemon reading
- Need to ensure cleanup on daemon crash
- Platform-specific permission code

---

### Option 4: Named Pipe / Unix Socket

**How it works:** Create a named pipe or Unix socket, pass the path to the daemon, daemon connects and reads the token.

**Pros:**
- Very secure
- Permissions can be set on the pipe/socket

**Cons:**
- Very different APIs on Windows vs Unix
- Significantly more complex implementation
- Overkill for a simple one-time token transfer

---

## Comparison Matrix

| Criteria | stdin | env var | temp file | named pipe |
|----------|-------|---------|-----------|------------|
| **Security** | Excellent | Fair | Good | Excellent |
| **Cross-platform ease** | Excellent | Excellent | Fair | Poor |
| **Implementation complexity** | Low | Very Low | Medium | High |
| **Debugging ease** | Poor | Fair | Fair | Poor |
| **Risk of leaking token** | None | Medium | Low | None |

## Recommendation

**stdin pipe** is the recommended approach because:

1. **Best security** - Token never appears in any system-visible location
2. **Truly cross-platform** - Rust's `std::process::Command` stdin handling is identical on all platforms
3. **Simple** - Only requires ~10 lines of code change on each side
4. **Standard pattern** - Many security-conscious tools pass secrets via stdin (e.g., `docker login --password-stdin`)

## Implementation Notes

### Backward Compatibility

If backward compatibility with the `--token` CLI arg is desired during transition:

```rust
// Daemon side
let token = if args.token.is_empty() || args.token == "-" {
    read_token_from_stdin()?
} else {
    args.token.clone()
};
```

### Timeout Handling

Add a timeout to stdin reading to avoid hanging if the native host fails to write:

```rust
use tokio::time::{timeout, Duration};
use tokio::io::{AsyncBufReadExt, BufReader};

async fn read_token_from_stdin() -> Result<String> {
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    timeout(Duration::from_secs(5), reader.read_line(&mut line))
        .await
        .context("Timeout reading token from stdin")?
        .context("Failed to read token")?;

    Ok(line.trim().to_string())
}
```

## References

- [Docker password-stdin pattern](https://docs.docker.com/reference/cli/docker/login/#password-stdin)
- [Rust Command stdin](https://doc.rust-lang.org/std/process/struct.Command.html#method.stdin)
