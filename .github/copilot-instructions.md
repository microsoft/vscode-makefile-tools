---
description: "You are an expert contributor to microsoft/vscode-makefile-tools, a TypeScript VS Code extension for Makefile-based C/C++ projects targeting Windows, macOS, and Linux. You are deeply familiar with GNU Make, the VS Code extension API, the CppTools Custom Configuration Provider API, and this repo's architecture. Match existing patterns precisely and always prefer tracing the canonical data flow over guessing."
applyTo: "**/*.ts,**/*.tsx,**/package.json"
---

# Makefile Tools — Contributor Instructions

## Build, lint, and test

```bash
yarn install          # Install dependencies
yarn compile          # Build (dev mode, uses webpack)
yarn compile-watch    # Build in watch mode
gulp lint             # Lint (uses eslint via gulp)
yarn test             # Run tests (compiles test.tsconfig.json, then runs via @vscode/test-electron)
yarn pretest          # Compile tests only (tsc -p test.tsconfig.json)
```

Tests use Mocha under `src/test/` and require VS Code's test electron runner — they cannot be run as plain Node tests. The test infrastructure is minimal (`src/test/fakeSuite/`); there is no built-in way to run a single test file.

## Domain knowledge

- **Core mechanism**: The extension runs `make --dry-run` (or reads a pre-generated build log) to capture compiler invocations without actually building. `parser.ts` extracts source files, includes, defines, compiler paths, and flags from that output using regex-based detection. This parsed data feeds the CppTools Custom Configuration Provider for IntelliSense.
- **Configuration priority**: When resolving make parameters, the extension follows a strict priority chain (defined at the top of `configuration.ts`): (1) `makefile.configurations[].buildLog` → (2) `makefile.buildLog` → (3) `makefile.configurations[].makePath` / `makeArgs` → (4) `makefile.makePath` with default args → (5) default `make` tool with default args.
- **Compiler/linker recognition**: `parser.ts` maintains explicit lists of compiler names (gcc, clang, cl, icc, etc.) and linker names. These are used in regex patterns that also account for versioning and cross-compiler naming (e.g., `arm-linux-gnueabihf-gcc`). If adding support for a new compiler, update these lists.
- **Makefile configurations**: A "configuration" (`MakefileConfiguration` interface in `configuration.ts`) represents a named set of build parameters — make path, args, directory, build log, pre/post configure scripts. Users define multiple configurations in `makefile.configurations` and switch between them. This is distinct from C/C++ build types.
- **Build state management**: `make.ts` tracks mutually exclusive operations via module-level boolean flags (`isBuilding`, `isConfiguring`, `isPreConfiguring`, etc.) with getter/setter pairs. Operations check these flags to prevent concurrent conflicting operations. The `ConfigureBuildReturnCodeTypes` enum defines all possible return states.
- **Cross-platform**: Runs on Windows, macOS, and Linux. Path handling, environment variable casing, and make tool availability all differ. Always use `path.join()` / `path.normalize()` — never concatenate paths with `/` or `\`.

## Architecture

| Layer | Primary files | Responsibility |
|---|---|---|
| **Extension entry** | `src/extension.ts` | Activation, `MakefileToolsExtension` class, command registration, CppTools provider lifecycle, tree view wiring |
| **Configuration** | `src/configuration.ts` | Reads/writes all `makefile.*` VS Code settings. Exported `get*()` functions are the canonical access to settings. Defines `MakefileConfiguration` interface and priority resolution |
| **Make operations** | `src/make.ts` | Spawns `make` processes for building and (pre/post)configuring. Owns build/configure state flags and operation enums (`Operations`, `TriggeredBy`, `ConfigureBuildReturnCodeTypes`) |
| **Parser** | `src/parser.ts` | Parses `make --dry-run` output. Regex-based detection of compiler/linker invocations to extract source files, includes, defines, flags. Exports `parseTargets()` and compile command types |
| **CppTools provider** | `src/cpptools.ts` | Implements `cpp.CustomConfigurationProvider`. Maintains `fileIndex` map (source path → compiler config) and `workspaceBrowseConfiguration` |
| **Launch/debug** | `src/launch.ts` | `Launcher` class for debug (cppvsdbg/cppdbg) and run-in-terminal. Provides command properties for `launch.json` variable substitution |
| **Tree view** | `src/tree.ts` | `ProjectOutlineProvider` tree data provider for sidebar panel — configurations, build targets, launch configurations |
| **State** | `src/state.ts` | `StateManager` wrapping VS Code Memento API. Persists build configuration, build target, launch configuration, and configure-dirty flag |
| **Logging** | `src/logger.ts` | Centralized output channel logging with verbosity filtering (Normal/Verbose/Debug) based on `makefile.loggingLevel` setting |
| **Telemetry** | `src/telemetry.ts` | `logEvent()` wrapper around `@vscode/extension-telemetry`. Disabled during testing via `MAKEFILE_TOOLS_TESTING` env var |
| **Utilities** | `src/util.ts` | File system helpers, path/string processing, process spawning (`spawnChildProcess`), `scheduleTask` for yielding during heavy parsing |
| **UI (deprecated)** | `src/ui.ts` | Status bar buttons — kept for backward compatibility |
| **Tests** | `src/test/` | Mocha suites via `@vscode/test-electron` |

## Mandatory rules

### Before touching any code, orient first

Identify the affected layer(s) from the architecture table. Read the relevant files before writing anything. Never guess at call sites, data flow, or configuration keys.

### Use canonical data paths

| Need | Use |
|---|---|
| Extension settings | `configuration.get*()` functions — never `vscode.workspace.getConfiguration()` directly |
| Build/configure state | `make.getIsBuilding()`, `make.getIsConfiguring()`, etc. — never read the flags directly from outside `make.ts` |
| Current configuration | `configuration.getCurrentMakefileConfiguration()` |
| Current build target | `configuration.getCurrentTarget()` |
| Current launch config | `configuration.getCurrentLaunchConfiguration()` |
| Workspace state | `extension.getState()` → `StateManager` properties |
| Parsed targets/file index | `cpptools.CppConfigurationProvider` `fileIndex` |

### Localize all user-visible strings

Every file with user-visible text needs the `vscode-nls` boilerplate:

```typescript
import * as nls from 'vscode-nls';
nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
```

The first parameter to `localize()` is a unique key within the file; the second is the English string. Both must be string literals. Tokens like `{0}`, `{1}` are supported with replacement values as additional parameters.

### Use the module-scoped logger — never `console.log`

```typescript
import * as logger from './logger';
logger.message('My message');                    // Always shown
logger.message('Debug info', 'Debug');           // Only at Debug verbosity
logger.message('Verbose info', 'Verbose');       // At Verbose or Debug
```

### Use telemetry helpers — never call the VS Code telemetry API directly

```typescript
import * as telemetry from './telemetry';
telemetry.logEvent('eventName', properties, measures);
```

### Paths — always `path.join()` / `path.normalize()`

Never concatenate path strings with `/` or `\`.

### New or changed settings: update both locations

`package.json` (`contributes.configuration` under `makefile.*`) and `src/configuration.ts` (add a `get*()` function and wire it through `analyzeConfigureParams()` if applicable). User-facing strings in `package.json` use `%key%` references resolved from `package.nls.json`.

### Module-level singletons with getter/setter

State flags use module-scoped `let` variables with exported getter/setter functions rather than class properties. Follow this pattern when adding new state.

### Copyright headers

Every source file must start with:

```typescript
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
```

### Every PR needs a CHANGELOG entry

If a change affects functionality, add a line to `CHANGELOG.md`.

### Dependency management

The repo uses an Azure Artifacts npm feed (`.npmrc`). To add or update dependencies locally, delete `.npmrc` and use the default npm feed. Do not commit changes to `yarn.lock` — dependency updates require team intervention.

## Project conventions

- **TypeScript strict mode** is enabled. Target is ES2019 with CommonJS modules.
- **Webpack** bundles the extension into `dist/main.js` for production. Entry point is `src/extension.ts`.
- **No default exports** — the tslint config enforces `no-default-export`.
- **4-space indentation** (tslint enforced).
- **Explicit type annotations** required on variable declarations and call signatures (tslint `typedef` rule).

## Where to start

- **Build or configure behavior** → `src/make.ts` + `src/configuration.ts`
- **Dry-run parsing or IntelliSense data** → `src/parser.ts` + `src/cpptools.ts`
- **Debug/run in terminal** → `src/launch.ts`
- **Sidebar tree items** → `src/tree.ts` node `contextValue` + `package.json` `when` clauses
- **Setting ignored or wrong value** → `src/configuration.ts` `get*()` + `package.json` `contributes.configuration`
- **Command does nothing or crashes** → `src/extension.ts` command handler registration
- **Output panel text or log level** → `src/logger.ts`
- **Telemetry** → `src/telemetry.ts`
- **Persistent state** → `src/state.ts` `StateManager`

