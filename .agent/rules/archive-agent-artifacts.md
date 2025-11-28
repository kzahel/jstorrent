# Artifact Archival Instructions

At the end of every completed task:

1. Create directory: `docs/agent_artifacts/{YYYY-MM-DD}-{N}-{feature-slug}/`
   - {YYYY-MM-DD}: Current date
   - {N}: Auto-incrementing number for today (01, 02, 03...)
   - {feature-slug}: Lowercase, hyphenated, 2-4 word description

2. Copy these files into the directory:
   - `task-list.md` (if exists)
   - `implementation-plan.md` (if exists)
   - `walkthrough.md` (if exists)
   - `prompts.md` (user's prompts throughout the process)

3. Add a README.md with:
   - High-level summary of changes and the date the task
     started and the task was marked complete. You may
     also include other metadata such as how many tokens
     were used and which model and which software was used.

Example structure:
```
docs/agent_artifacts/
  2025-11-28-01-bittorrent-engine-refactor/
  2025-11-28-02-storage-manager-interface/
  2025-11-29-01-native-messaging-protocol/
```

Do not do this automatically, but prompt the user when you think the task is complete and remind them that
you can create an archive of the artifacts for future reference.