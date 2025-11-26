# Claude Code Configuration

This directory contains configuration files for Claude Code to understand project-specific rules and constraints.

## config.json

Defines read-only directories and other project rules that Claude should follow when working with this codebase.

### Read-Only Directories

The following directories are marked as read-only and should **never** be modified:

- `packages/legacy-jstorrent-engine` - Legacy code that must remain unchanged

Claude can read, search, and analyze these directories but should never write, edit, or delete files within them.
