# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository.

## What this is

`@roarkanalytics/cli`, the `roark` binary. A data table of commands generated from the Roark OpenAPI spec,
plus a hand-written runtime (`src/runtime/`) that turns that table into a commander program. The runtime
holds no per-endpoint knowledge: a new endpoint is a data change in the table, never a code change. It
depends on the published `@roarkanalytics/sdk`.

## Generated files: never hand-edit

[`app-agent-codegen`](https://github.com/roarkhq/app-agent-codegen) (the `cli` target) writes these and
opens a PR here (`automation/cli-update`) when the API changes. A hand edit is overwritten by the next
regeneration, and until then the codegen review's "Reproducible from the spec" gate fails.

- `src/commands.ts`: the whole command table.
- `src/completions.ts`: the whole file.
- `man/roark.1` and every `man/roark-*.1`, **except** `man/roark-config-diff.1` and
  `man/roark-config-apply.1`. `man/` is an owned directory: any other file you add there that the
  generator does not emit is deleted on the next regeneration.
- `README.md` and `SKILL.md`: whole files.
- `package.json`: the `man` array only (spliced; the rest of the file is hand-written).
- `package.json` `dependencies["@roarkanalytics/sdk"]` and `pnpm-lock.yaml`: raised by the SDK floor sync
  in codegen's `open-pr` when the table needs a newer SDK. Do not lower the range by hand.

Verified against `src/generate-cli.ts`, `src/targets.ts` and `src/sdk-floor-sync.ts` in app-agent-codegen:
`generate-cli` emits exactly 161 files (the five above plus 156 man pages), and `apply --target cli
--dry-run` against this repository touches only those paths.

### How to change generated output

- Wording, command names, flags, man page or README layout: change the emitter in app-agent-codegen
  (`src/emit/cli/*`, `src/model/cli.ts`, `src/naming/cli-naming.ts`).
- A command's existence, name override (`cli:`, `cli_group:`), a new verb (`cli_verbs:`), or a command the
  runtime implements by hand (`targets.cli.hand_maintained_commands`): change `sdk.yml` in
  `app-roark-analytics`.
- An endpoint's description or parameters: change the spec in `app-roark-analytics`.

Then let the regeneration PR carry the new output here.

## Hand-written files

Everything else: `src/runtime/**` (program, parsing, output, auth, config, config-as-code commands),
`src/bin.ts`, `src/index.ts`, `man/roark-config-diff.1`, `man/roark-config-apply.1`,
`scripts/`, `tests/`, `install.sh`, `build`, the workflows and the tool configs. `src/runtime/types.ts` is
the contract between the generated table and the runtime; changing it means changing the emitter too.
`src/version.ts` and `CHANGELOG.md` belong to release-please and `scripts/sync-version.cjs`; leave them alone.

`config diff` and `config apply` are hand-maintained commands: `program.ts` filters the generated ones out
and `runtime/commands/config-as-code.ts` registers its own. Keep their `usage`/`summary` in `sdk.yml` and
their man pages in step with that file by hand.

## Commands

- `pnpm install --frozen-lockfile`
- `pnpm typecheck` (`tsc --noEmit`), `pnpm test` (jest), `pnpm lint` (`eslint . && prettier --check .`),
  `pnpm build`. CI runs all four; run them before every push. `pnpm fix` applies eslint and prettier
  fixes.

Formatting is enforced by `.prettierrc.json`: single quotes, `printWidth` 110, trailing commas,
`experimentalTernaries`. It does not set `semi: false`, so prettier keeps **semicolons** in this repository
and `pnpm lint` fails without them. Follow the config, not the house no-semicolon default.

## Code structure (hand-written files)

- **Arrow functions only**: `const foo = () => {}`, never `function foo() {}`. No classes; group related
  functions in a module (or a namespace object). The existing `Error` subclasses in
  `src/runtime/errors.ts` are not a pattern to extend.
- **kebab-case** file and folder names.
- **Types** go in a `types.ts` beside the code that uses them. Do not declare `interface`/`type` in
  implementation files, including named input and return shapes. Where Zod is used, the schema and its
  inferred type go in `schema.ts`.
- **Pure helpers** (parsing, formatting, decisions) go in a `helpers.ts`, never inlined into the file
  doing IO.
- **Separate IO from decisions.** `fetch`, `fs`, the browser and the terminal sit at the edge; the logic
  takes plain data or injected functions so it is testable without a network or a TTY.
- **No duplication.** Before writing a helper, type or parser, search `src/runtime/` for an existing one
  and reuse or extract a shared one.
- **Never hand-roll a type that exists canonically.** Derive from the SDK's types or `src/runtime/types.ts`
  with `Pick`, `Omit`, `Extract` or `Parameters<...>`.
- **No `any`.** Use `unknown` and narrow.
- **Static imports only**; no `await import(...)`.

## Tests

- Colocated: `<file>.test.ts` beside `<file>.ts` under `src/` (`tsconfig.build.json` excludes them from the
  build). `tests/` holds only the script tests.
- A test for a fix must fail when the fix is reverted. Revert it locally and watch it go red before you
  push.

## Copy

No em dashes in user-facing text you write: help text, error messages, prompts and the hand-written man
pages. Use a colon, a comma or a new sentence. Copy in generated files comes from the spec or the
emitters; fix it there.
