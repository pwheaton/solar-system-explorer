# CLAUDE.md

Notes for Claude Code (and anyone else) picking up this project. Read `README.md` for what the app does and the project layout, and `DESIGN.md` for why it's built the way it is and how it should look.

## Workflow

- **Never push to `main`.** `main` deploys straight to production on Vercel. Every change goes on a branch, then a pull request. Pull requests get their own Vercel preview.
- **Merge only when the user says so** ("Merge it"). Opening the PR and getting CI green is the end of a task, not merging.
- Run pnpm through npx at the pinned version: `npx -y pnpm@10.28.0 <script>`.
- **Don't run Playwright against the user's installed Chrome** (for example `channel: 'chrome'`). macOS blocks it. Browser tests run in GitHub Actions; check things locally in the in-app browser pane against `pnpm dev` or `pnpm start`. Downloading Playwright's own Chromium locally needs the user's OK first.

## Before opening a PR

```bash
npx -y pnpm@10.28.0 typecheck   # JSDoc types in lib/ (strict)
npx -y pnpm@10.28.0 lint        # ESLint, including no-undef
npx -y pnpm@10.28.0 test        # physics and scenario tests (node --test)
npx -y pnpm@10.28.0 build       # production build
```

CI (`.github/workflows/ci.yml`) runs all of these plus the Playwright smoke tests in `e2e/`. A smoke test fails on **any** console error, page error, failed request or 4xx/5xx response, so a missing asset or a stray `console.error` breaks CI.

For a change that touches the UI or the simulation loop, also load it in the in-app browser and check the console. Useful URL flags: `?perf=1` (timing overlay), `?worker=0` (physics on the main thread).

## Rules that are easy to break

- **Physics must stay time-reversible.** Rewind runs the integrator backwards and must retrace exactly, including through launches, merges and shattering impacts. Belt particles step less often than bodies, split into kick and drift halves (`pending*` fields in `belts.js`) so that reversing lands on the same state. Any change to stepping, collisions or history needs the rewind tests in `tests/` to pass.
- **Every collision or launch is a history record** (`history.js`) that can be undone and redone. New kinds of event need undo and redo, not just a forward path.
- **`lib/sim/` has no React and no DOM**, except `render.js` (canvas) and `host.js` (creates the Worker). It runs in a Web Worker, in Node tests, and on the server for link-preview images (`scene.js`, `app/api/og`).
- **Anything the page draws or reads comes through the snapshot** (`snapshot.js`). If you add a body field the UI needs, add it to `BODY_FIELDS` and to `ViewBody` in `types.ts`, or the worker build won't show it (the `?worker=0` path will, which hides the bug).
- **The default view has a plain URL.** `url-state.js` writes only values that differ from the scenario's defaults; once anything differs it pins the date and belt seed so the link reproduces exactly.
- **Types:** `lib/**/*.js` is checked with `// @ts-check` in strict mode against the shapes in `lib/sim/types.ts`. New functions need `@param` types. Keep the code plain JavaScript.
- **Keyboard shortcuts** live in `hooks/useKeyboardShortcuts.js` and are listed for users in `ShortcutsDrawer.jsx`. Change both together.

## Where to look

- Per-frame logic (speed, scenario events, mass ramps, rewind limit): `lib/sim/engine.js`
- Worker vs main thread, and the fallback: `lib/sim/host.js`
- Integrator: `lib/sim/physics.js`; gravity: `forces.js`; impacts: `impacts.js` (the model) and `collisions.js` (applying it)
- The main component and its hooks: `components/solar-system/SolarSystem.jsx`, `components/solar-system/hooks/`
- Styling: everything is in `components/solar-system/styles.module.css`
