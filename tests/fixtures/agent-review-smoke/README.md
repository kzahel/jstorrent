# PR review qualification fixture

This standalone Node fixture exists only to qualify the maintainer's hosted
review integration. It is not called by the torrent engine or product clients.

Run the focused checks with:

```bash
node --test tests/fixtures/agent-review-smoke/deadline.test.mjs
```

The contract includes the deadline boundary itself. Keep this sample out of
production; the qualification pull request is temporary and must not merge.
