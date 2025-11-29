# @jstorrent/engine

Core BitTorrent engine for JSTorrent.

## Testing

### Unit Tests
Run unit tests (excluding integration tests):
```bash
pnpm test
```

### Integration Tests
Run integration tests (requires `io-daemon` binary):
```bash
pnpm test:integration
```

The integration tests expect the `jstorrent-io-daemon` binary to be located at `../../../../../native-host/target/debug/jstorrent-io-daemon` relative to the test files. (it is built from `native-host` in the repository root with `cargo build --workspace`)

### All Tests
Run all tests:
```bash
pnpm test:all
```

### Python Tests
Run Python tests:
```bash
pnpm test:python
```
