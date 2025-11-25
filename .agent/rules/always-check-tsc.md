---
trigger: always_on
---

After making any typescript code changes, always run the project-wide TypeScript typecheck and address any errors before considering a task complete.

The monorepo uses pnpm and the root tsconfig, so the correct command is:

    pnpm typecheck

Never assume the code compiles after edits.  
Always check.  
Always fix type errors immediately.

If a file change produces type errors in other packages, resolve them before marking the task complete.
