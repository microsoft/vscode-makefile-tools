---
name: pr-readiness
description: >
  Verify that a pull request into microsoft/vscode-makefile-tools meets contribution
  requirements. Use when preparing, reviewing, or finalizing a PR to check for a
  descriptive title, a meaningful description, a properly formatted CHANGELOG entry,
  code correctness, regression risks, adherence to existing patterns, and whether
  documentation updates are needed.
---

# PR Readiness

## PR Requirements Checklist

### 1. PR Title

The title must clearly and concisely describe the change from the user's perspective. It should:

- Start with a verb (e.g., "Fix", "Add", "Improve", "Remove", "Update").
- Mention the affected feature or area (e.g., dry-run parsing, IntelliSense, build targets, configurations, tree view).
- Be specific enough that a reader understands the change without opening the PR.

**Good examples:**

- `Fix dry-run parser not recognizing cross-compiler prefixed gcc invocations`
- `Add support for pre-configure script arguments in makefile.configurations`
- `Improve target parsing to handle makefile variable-defined targets`

**Bad examples:**

- `Fix bug` (too vague)
- `Update code` (no useful information)
- `WIP` (not ready for review)

### 2. PR Description

The PR body must include:

- **What changed**: A short summary of the user-visible behavior change.
- **Why**: The motivation — link to a GitHub issue if one exists (e.g., `Fixes #1234`).
- **How** (if non-obvious): A brief explanation of the implementation approach when the change is complex.

### 3. CHANGELOG Entry

Every PR that affects functionality must add an entry to `CHANGELOG.md`.

#### Where to insert

Insert the entry under the **most recent (topmost) version heading** in `CHANGELOG.md`. The first version heading looks like `## <version>` (e.g., `## 0.12`). Always add the new entry at the **bottom** of the appropriate section (i.e., after all existing entries in that section).

#### Which section

Place the entry in exactly one of these three sections, creating the section if it does not already exist under the current version:

| Section | Use when… |
|---|---|
| `Features:` | A new user-visible capability is added (new command, new setting, new UI element). |
| `Improvements:` | An existing feature is enhanced, optimized, or has better UX — but no new capability is introduced. |
| `Bug Fixes:` | A defect is corrected. |

The sections appear in this fixed order: `Features:`, then `Improvements:`, then `Bug Fixes:`.

#### Entry format

Each entry follows this pattern:

```
- <Description>. [#<number>](<link>)
```

Where `<Description>` starts with a present-tense verb describing the user-visible change, and the link references either:

- The **GitHub issue** it solves: `[#<issue number>](https://github.com/microsoft/vscode-makefile-tools/issues/<issue number>)`
- Or the **PR** itself: `[#<pr number>](https://github.com/microsoft/vscode-makefile-tools/pull/<pr number>)`

An entry may optionally credit an external contributor at the end: `[@user](https://github.com/user)`.

**Examples:**

```markdown
Features:
- Add support for post-configure scripts that run after a successful configure operation. [#456](https://github.com/microsoft/vscode-makefile-tools/pull/456)

Improvements:
- Improve dry-run parsing to recognize ccache-wrapped compiler invocations. [#789](https://github.com/microsoft/vscode-makefile-tools/issues/789)

Bug Fixes:
- Fix IntelliSense includes not updating after changing the active build configuration. [#123](https://github.com/microsoft/vscode-makefile-tools/issues/123)
- Fix build target list not refreshing when Makefile is edited on Windows. [#234](https://github.com/microsoft/vscode-makefile-tools/issues/234) [@contributor](https://github.com/contributor)
```

#### What NOT to do

- Do **not** add a new version heading — use the existing topmost one.
- Do **not** place the entry under an older version.
- Do **not** use past tense (write "Fix …", not "Fixed …").
- Do **not** omit the issue or PR link.

### 4. Correctness

Review the code changes for logical correctness:

- **Configuration priority**: If the change touches how make parameters are resolved, verify it respects the priority chain defined in `configuration.ts`: (1) per-configuration buildLog → (2) global buildLog → (3) per-configuration makePath/makeArgs → (4) global makePath → (5) default make.
- **Build state guards**: If the change involves build or configure operations, verify it checks the state flags (`isBuilding`, `isConfiguring`, `isPreConfiguring`, `isPostConfiguring`) to prevent concurrent conflicting operations.
- **Edge cases**: Look for off-by-one errors, null/undefined access, missing `await` on async calls, and unhandled promise rejections.
- **Error handling**: Verify errors are not silently swallowed. Empty `catch` blocks are a red flag (note: `util.ts` has intentional empty catches for file-existence checks — that pattern is acceptable only for fs stat calls).
- **Cross-platform**: Check for hardcoded path separators (`/` or `\\`), case-sensitive env var assumptions, or platform-specific APIs used without guards. Paths must use `path.join()` / `path.normalize()`.
- **Regex correctness**: If the change modifies compiler/linker detection regexes in `parser.ts`, verify the patterns handle versioned names (e.g., `gcc-12`), cross-compiler prefixes (e.g., `arm-linux-gnueabihf-gcc`), and path separators on all platforms.

### 5. Regression Risks

Identify areas where the change could break existing behavior:

- **Parser regexes**: Changes to `parser.ts` compiler/linker lists or parsing regexes can break IntelliSense for existing projects. Verify patterns still match all previously-supported compiler naming variants.
- **Configuration resolution**: Changes to `configuration.ts` priority logic or `analyzeConfigureParams()` can alter which make path, args, or build log the extension uses — silently changing behavior for users with existing settings.
- **State management**: Changes to `make.ts` state flags or `state.ts` StateManager can cause operations to be incorrectly blocked or allowed concurrently.
- **CppTools provider**: Changes to `cpptools.ts` `fileIndex` or browse configuration can break IntelliSense for all users.
- **Settings**: Adding or renaming a setting in `package.json` without updating `configuration.ts` (or vice versa) causes silent failures.
- **Tree view**: Changes to `tree.ts` node `contextValue` strings can break `when` clause conditions in `package.json`, hiding or showing commands incorrectly.
- **Test coverage**: Flag changes to critical paths that lack corresponding test updates, especially in `parser.ts`, `configuration.ts`, and `make.ts`.

### 6. Adherence to Existing Patterns

Verify the change follows the project's established conventions:

- **Import style**: Uses `import * as module from './module'` for internal modules. Uses `import * as nls from 'vscode-nls'` for localization.
- **Logging**: Uses `logger.message()` with optional verbosity level — never `console.log`.
- **Localization**: All user-visible strings use `localize('message.key', 'Message text')` with the `vscode-nls` boilerplate at the top of the file.
- **Settings access**: Reads settings through exported `get*()` functions in `configuration.ts` — never calls `vscode.workspace.getConfiguration()` directly.
- **Telemetry**: Uses `telemetry.logEvent()` — never calls the VS Code telemetry API directly.
- **State pattern**: Module-level state uses `let` variables with exported getter/setter functions — not class properties or global mutable objects.
- **Async patterns**: Prefers `async`/`await` over `.then()` chains (exception: fire-and-forget UI calls like `vscode.window.showInformationMessage(...).then(...)`).
- **Naming and structure**: All source files are in `src/` (flat structure, no subdirectories except `test/`). New commands are registered in `src/extension.ts`. Copyright headers are present on every file.

### 7. Test Coverage

Verify that the PR includes adequate tests for the changes:

- **New functionality**: Any new function, command, setting, or behavior branch should have corresponding tests where feasible.
- **Bug fixes**: A bug fix should ideally include at least one test that would have caught the original bug.
- **Changed behavior**: If existing behavior is modified, check that existing tests are updated to reflect the new behavior.
- **Test infrastructure**: Tests live in `src/test/` and run via `@vscode/test-electron` (Mocha). They cannot be run as plain Node tests. The test infrastructure is minimal — flag gaps rather than ignoring them.
- **When tests are not feasible**: Some changes (e.g., pure UI wiring, VS Code API integration, dry-run parsing of complex real-world Makefiles) are difficult to unit test. In these cases, verify that the PR description explains how to manually verify the change, and flag the gap rather than ignoring it.

### 8. Documentation Updates

Check whether the change requires documentation updates:

- **New or changed settings**: Must be reflected in both `package.json` (`contributes.configuration` under `makefile.*`) and `src/configuration.ts` (add/update `get*()` function). User-facing strings go in `package.nls.json`.
- **New commands**: Must be documented in `package.json` (`contributes.commands`) with localized title in `package.nls.json`, and registered in `src/extension.ts`.
- **README**: If a new major feature is added, check whether `README.md` should mention it.
- **CONTRIBUTING.md**: If the change introduces a new module or significantly changes the architecture, update the "About the Code" section.

## Applying This Skill

When reviewing or preparing a PR:

1. **Check the title** — rewrite it if it is vague or missing context.
2. **Check the description** — ensure it explains what, why, and (if needed) how.
3. **Check `CHANGELOG.md`** — verify an entry exists under the current version in the correct section with the correct format. If missing, add one.
4. **Check correctness** — review code for logical errors, configuration priority violations, state guard issues, cross-platform problems, and regex correctness.
5. **Check regression risks** — identify areas where the change could break existing behavior and flag missing test coverage for critical paths.
6. **Check pattern adherence** — verify the change follows established import, logging, localization, settings access, and architectural conventions.
7. **Check test coverage** — verify that new or changed behavior has corresponding tests where feasible, and flag gaps.
8. **Check documentation** — verify that new or changed settings, commands, and behavior are reflected in the appropriate locations.

