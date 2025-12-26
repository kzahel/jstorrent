# Project Context

Strategic documentation for AI-assisted development conversations.

**Purpose:** Provide context for Claude web project chats about architecture, design decisions, and roadmap.

**Not for:** Task-executing agents. They should use `docs/tasks/` and package-level READMEs instead.

## Platform Status (December 2025)

| Platform | Status | Notes |
|----------|--------|-------|
| **Chrome Extension + Desktop** (Linux/Win/Mac) | ✅ Fully Functional | Rust native host, production ready |
| **Chrome Extension + ChromeOS** | ✅ Fully Functional | Kotlin Android companion app |
| **Android Standalone Native** | ✅ Fully Functional | QuickJS + Kotlin + Compose UI + SAF folder picker. UI is minimal but complete. |
| **iOS Standalone** | 🔜 Planned | JavaScriptCore + Swift + SwiftUI |

All "fully functional" platforms support: magnet links, .torrent files, multi-file torrents, session persistence, seeding, DHT, protocol encryption, and SAF/native folder picker for download location.

## Files

| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | Core design decisions, constraints, data flows |
| `PACKAGES.md` | Monorepo structure, package responsibilities |
| `WORKFLOW.md` | How work gets done, testing, dev setup |
| `RELEASE-STATUS.md` | What's blocking release, known limitations |
| `CHROMEOS-STRATEGY.md` | ChromeOS migration strategy and implementation status |
| `DAEMON-PROTOCOL.md` | Extension-daemon communication protocol reference |

## Usage

Upload these files to a Claude web project for strategic conversations about:
- Feature design and tradeoffs
- Architecture evolution
- Release planning
- Bug analysis requiring system-wide context

For tactical execution, create task docs in `docs/tasks/` instead.
