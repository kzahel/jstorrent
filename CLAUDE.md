# Claude Instructions

## Git Configuration and Commit Attribution

### User Identity Management

**CRITICAL**: When using Claude Code research preview (claude.ai/code), proper git commit attribution is required.

#### Before ANY git push operations:

1. **Check current git configuration**:
   ```bash
   git config user.name
   git config user.email
   ```

2. **If the email is `noreply@anthropic.com` or name is just `Claude`**:
   - **STOP** - Do not proceed with the push
   - Ask the user which identity should be used for commits
   - Configure git with the correct user details before pushing

3. **Never push commits** with these default values:
   - Name: `Claude`
   - Email: `noreply@anthropic.com`

#### Authorized Users

| Name | Email |
|------|-------|
| Kyle Graehl | kgraehl@gmail.com |
| Graehl Arts | graehlarts@gmail.com |

#### Setting Git Config

When the user confirms their identity, set git config:

```bash
git config user.name "User Name"
git config user.email "user@email.com"
```

#### Workflow

1. At the start of any session involving commits/pushes, verify git config
2. If using placeholder values, ask: "Which user are you? (Kyle Graehl or Graehl Arts?)"
3. Configure git with the appropriate credentials
4. Proceed with commits and pushes

This ensures proper commit history attribution across all work.

## TypeScript Editing Workflow

After editing TypeScript files, run the following checks in order:

1. `pnpm run typecheck` - Verify type correctness
2. `pnpm run test` - Run unit tests
3. `pnpm run lint` - Check lint rules

**IMPORTANT**: Only after all edits are complete and tests pass, run as the final step:

3. `pnpm format:fix` - Fix formatting issues

Run `format:fix` last because fixing type errors or tests may introduce formatting issues that need to be cleaned up at the very end.
