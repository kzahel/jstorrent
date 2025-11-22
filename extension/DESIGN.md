Below is a **complete, end-to-end repository design document** that defines:

- Repository layout
- Build setup (Vite, TS, React, MV3)
- Linting + Prettier
- Unit tests (Vitest + happy-dom + RTL)
- Integration tests (Playwright, “new headless” mode)
- GitHub Actions CI setup
- Command structure (including `npm run check_fast`)

This document is written so a coding agent—or future contributors—can implement everything with zero ambiguity.

---

# **JSTorrent MV3 Extension — Repository Design Document**

This describes the entire development environment, build system, test framework, and CI workflow for the JSTorrent MV3 browser extension.

This is intended as a **blueprint** for building the repository from scratch.

---

# **1. Goals**

The repository must:

- Be minimal, readable, and maintainable
- Produce a Chrome MV3 extension using:
  - TypeScript
  - React (UI)
  - Vite (multi-entry, no HMR)
  - Strict linting + formatting

- Support unit, integration, and optional real-device E2E tests
- Run all fast checks in a single command (`npm run check_fast`)
- Run full test suite (including Playwright integration tests) in GitHub Actions
- Produce a zip of `/dist` ready for Chrome Web Store submission

---

# **2. Repository Structure**

```
jstorrent-extension/
  package.json
  tsconfig.json
  vite.config.js
  eslintrc.cjs
  .prettierrc
  .prettierignore

  public/
    manifest.json
    icons/
      icon16.png
      icon32.png
      icon128.png

  src/
    sw.ts                          (MV3 service worker)
    shared/                        (shared utilities)

    ui/
      app.html
      app.tsx
      components/
        ...

    offscreen/
      offscreen.html
      offscreen.ts                 (connects to native host)

    magnet/
      magnet-handler.html
      magnet-handler.ts

  test/                            (unit tests + mocks)
    setup.ts                       (global test setup)
    mocks/
      mock-chrome.ts               (chrome.* mock)
      mock-native-host.ts          (fake host for unit tests)
    unit/
      example.unit.test.ts

  e2e/                             (Playwright integration tests)
    extension.spec.ts              (load extension, test UI)
    playwright.config.ts

  dist/                            (output)
```

---

# **3. Build System (Vite)**

### Requirements:

- Multi-entry bundling
- No dev server, no HMR
- Sourcemaps + non-minified output
- MV3–compatible CSP (no inline scripts)
- Build pages individually:
  - `/ui/app.html`
  - `/offscreen/offscreen.html`
  - `/magnet/magnet-handler.html`
  - `/sw.ts`

### Single build command:

```
npm run build
```

### Watch mode for local development:

```
npm run dev   // vite build --watch
```

---

# **4. TypeScript Configuration**

### Requirements:

- Strict mode
- TS-only transforms (Vite handles bundling)
- JSX via React 17+ transform (`react-jsx`)
- Skip library checking for speed
- Support for DOM + ES modules

### Important choices:

- `"strict": true`
- `"noUnusedLocals": true`
- `"noImplicitAny": true`
- `"skipLibCheck": true` (massive speed improvement)

---

# **5. Linting (ESLint)**

### Requirements:

- TypeScript-aware
- React-aware
- MV3 extension-friendly
- Warn, not fail, on stylistic issues
- Must be included in `check_fast`

### ESLint configuration includes:

- `parser: @typescript-eslint/parser`
- Plugins:
  - `@typescript-eslint`
  - `react`
  - `react-hooks`

- Rules:
  - `"react/react-in-jsx-scope": "off"`
  - `"@typescript-eslint/no-unused-vars": "warn"`
  - MV3 globals allowed (via env: webextensions)

---

# **6. Prettier Setup**

### Requirements:

- Enforce formatting
- Run in `check_fast`
- Do not run during build

Prettier settings:

- Semi: false
- Singles quotes
- Trailing commas: all
- Print width: 100

---

# **7. Testing Setup**

## **7.1 Unit Tests (Vitest)**

### Requirements:

- Fast
- No browser required
- Full TS + ESM support
- happy-dom for React components
- Mocks for chrome.\* and native host

### Technologies:

- Vitest
- React Testing Library
- happy-dom
- Manual mocks in `/test/mocks`

### Running unit tests:

```
npm run test
```

or:

```
npm run test:watch
```

---

## **7.2 Integration Tests (Playwright)**

### Requirements:

- Run Chromium in “new headless” mode
- Load extension via:

  ```
  --disable-extensions-except=dist
  --load-extension=dist
  ```

- Test extension pages:
  - popup UI
  - offscreen behavior
  - message passing

### Not in `check_fast`, but included in full CI test.

### Run:

```
npm run test:e2e
```

This will:

1. Build extension
2. Launch Chromium with extension
3. Run tests invisibly (headless)
4. Assert UI and extension state

---

## **7.3 Optional Real E2E Tests**

(not included in CI)

Real E2E tests require:

- Native host installed
- A seeded torrent via Transmission
- Real IPC between offscreen <-> native host
- Real downloads + completion signals

Run manually:

```
npm run test:real
```

---

# **8. NPM Script Command Table**

| Command          | Purpose                    | Fast?   |
| ---------------- | -------------------------- | ------- |
| **build**        | Build extension            | Yes     |
| **dev**          | Watch-mode build           | Yes     |
| **lint**         | Run ESLint                 | Yes     |
| **format**       | Format files with Prettier | Yes     |
| **format:check** | Verify formatting only     | Yes     |
| **test**         | Unit tests                 | Yes     |
| **test:e2e**     | Playwright extension tests | ~Medium |
| **test:real**    | Real full-flow tests       | Slow    |
| **check_fast**   | Run all fast checks        | Yes     |

### `check_fast` must include:

- Lint
- Prettier check
- TypeScript type check
- Unit tests

Example:

```
npm run check_fast
```

Runs:

```
eslint src
prettier --check .
tsc --noEmit
vitest run
```

All within ~1–2 seconds.

---

# **9. GitHub Actions CI Setup**

### Requirements:

- Ubuntu runner (`ubuntu-latest`)
- Install Node + dependencies
- Build extension
- Run `check_fast`
- Run Playwright integration tests (`npm run test:e2e`)

### Full workflow:

```
.github/workflows/ci.yml
```

### Steps performed:

1. **Checkout**
2. **Setup Node.js**
3. **Install dependencies**
4. **Run check_fast**
5. **Build extension**
6. **Install Playwright browsers**
7. **Run Playwright E2E tests**

### E2E runs headless but fully supports MV3 extension loading.

---

# **10. File-by-File Requirements for a Coding Agent**

Below is what the coding agent must generate:

### 10.1 Root configuration files:

- `package.json`
- `vite.config.js`
- `tsconfig.json`
- `eslintrc.cjs`
- `.prettierrc`
- `.prettierignore`

### 10.2 Extension files:

- `public/manifest.json`
- `public/icons/*.png`
- `src/sw.ts`
- `src/offscreen/offscreen.ts`
- `src/offscreen/offscreen.html`
- `src/magnet/magnet-handler.ts`
- `src/magnet/magnet-handler.html`
- `src/ui/app.tsx`
- `src/ui/app.html`
- `src/shared/*` (optional utility files)

### 10.3 Unit test framework:

- `test/setup.ts`
- `test/mocks/mock-chrome.ts`
- `test/mocks/mock-native-host.ts`
- `test/unit/example.unit.test.ts`

### 10.4 Integration test framework:

- `e2e/playwright.config.ts`
- `e2e/extension.spec.ts`

### 10.5 GitHub Actions CI:

- `.github/workflows/ci.yml`

---

# **11. Development Workflows**

## **Local dev loop (fast)**

```
npm install
npm run dev     # watch mode
# edit TS/React files
npm run check_fast
```

## **Before commit:**

```
npm run check_fast
```

## **Before release:**

```
npm run build
zip -r jstorrent-extension.zip dist/
```

## **Full validation (not fast):**

```
npm run test:e2e
```

## **Real-world torrent E2E:**

```
npm run test:real
```

---

# **12. Performance Expectations**

### Check_fast:

< 2 seconds

### Build:

~200–500 ms

### Unit tests:

100–400 ms

### Integration tests:

1–3 seconds

### Real E2E (optional):

5–15 seconds depending on torrent size

---

# **13. Guiding Principles**

- Every component is testable in isolation
- No HMR or dev server → simpler, predictable build
- Tests never appear onscreen (Playwright new headless)
- Linting, formatting, type checking always run before merge
- CI mimics local environment closely
- Optional real tests test the entire native-host + torrent stack
- Code stays readable (no minify)

---

# **14. Final Summary**

This design document defines:

- Directory layout
- Build tooling
- Lint/format rules
- Unit test strategy
- Integration test strategy
- Real-world test strategy
- CI pipeline
- NPM script structure including `check_fast`
- Deliverables required from contributors or automation

This is the **complete blueprint** for the modern JSTorrent MV3 extension repository.
