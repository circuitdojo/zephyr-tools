# Repository Guidelines

## Project Structure & Module Organization
- `src/` — VS Code extension source (TypeScript).
  - `commands/`, `config/`, `hardware/`, `ui/`, `build/`, `files/`, `tasks/`, `utils/`.
  - `extension.ts` is the entrypoint; output bundles to `out/` via esbuild.
- `src/test/` — Mocha tests using `vscode-test`.
- `templates/` — Project templates (vanilla, nfed, ncs).
- `media/`, `icons/`, `img/` — Webview assets and icons.
- `manifest/` — Extension manifest resources.

## Build, Test, and Development Commands
- `npm run watch` — Incremental build with esbuild (dev loop).
- `npm run compile` — One-shot build to `out/extension.js`.
- `npm run lint` — ESLint on `src/**/*.ts`.
- `npm test` — Builds, then runs Mocha tests via `vscode-test`.
- `npm run package` — Type-check, then production bundle (used for publishing).

Tip: Open in VS Code and press F5 to launch the Extension Development Host.

## Coding Style & Naming Conventions
- Language: TypeScript (ES6 target, CommonJS). `tsconfig` uses `strict: true`.
- Indentation: 2 spaces. Prefer explicit types and early returns.
- Names: `PascalCase` for classes, `camelCase` for functions/vars, `SCREAMING_SNAKE_CASE` for constants.
- Linting: ESLint with `@typescript-eslint`. Fix issues or justify with minimal disables.

## Testing Guidelines
- Framework: Mocha (`tdd` UI) with `vscode-test` harness.
- Location: `src/test/suite/*.test.ts` (compiled to `.js`).
- Run: `npm test`. Keep tests fast and deterministic; prefer unit-level coverage for commands and utilities.

## Commit & Pull Request Guidelines
- Commits: Imperative subject, concise body with rationale. Reference issues (e.g., `Fixes #123`).
- PRs: Include summary, testing steps, and screenshots for UI changes (webviews/status bar). Update docs (`README.md`, plans) when behavior changes.
- CI hygiene: Ensure `npm run lint` and `npm test` pass before requesting review.

## Security & Configuration Tips
- Node >= 16 and VS Code >= 1.101.0.
- Extension settings live under `zephyr-tools.*` (e.g., `paths.zephyrBase`, `probeRs.*`). Avoid committing machine-specific paths.

## Agent-Specific Instructions
- Respect this file’s scope for repository-wide conventions.
- Prefer minimal, focused patches; avoid unrelated refactors.
- When adding commands or settings, wire them in `package.json` and keep names consistent (`zephyr-tools.*`).
