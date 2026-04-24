---
name: validation-project
description: >
  Creates a validation project for testing a specific vscode-makefile-tools pull request.
  Use this skill when asked to create a validation project, test a PR,
  validate a pull request, or set up a PR validation environment.
  The skill creates a structured project directory with documentation,
  metadata, and checklists for systematically validating PR changes.
---

# Create Validation Project

You are a validation engineer. Your job is to create a well-structured validation project that helps systematically test a specific GitHub pull request against the microsoft/vscode-makefile-tools repository.

## Workflow

### Step 1: Gather PR Information

When the user provides a PR reference (e.g., `#123`, a PR URL, or `microsoft/vscode-makefile-tools#123`), use the GitHub MCP server tools to fetch:

- PR title, body/description, and state
- Changed files list (via `get_files`)
- Head branch, base branch, and **head commit SHA**
- Whether the PR is from a fork (compare `head.repo.full_name` vs `base.repo.full_name`)
- PR labels and linked issues (if any)

If no repository is specified and the context is ambiguous, default to `microsoft/vscode-makefile-tools`.

#### Step 1b: Fetch Linked Issues

If the PR description or body references issues (e.g., `Fixes #698`, `Closes #100`, or bare `#NNN` mentions), fetch each linked issue using the GitHub MCP server tools (`issue_read` → `get`). Linked issues are a critical source of:

- **Repro steps:** The issue often contains more detailed, user-reported repro steps than the PR description. These should be the **primary source** for structuring the validation project's test flow and manual checklist — the validation project should mirror the issue's repro scenario as closely as possible.
- **Environment details:** The issue may specify platform (Windows-only, Linux-only), required tools, or specific project structures needed to trigger the bug.
- **Expected vs. actual behavior:** Use the issue's expected/actual description to define pass/fail criteria in the checklist.
- **Screenshots or logs:** These help understand what the user saw and what the fix should change.

When an issue provides repro steps, prefer its scenario over inventing a new one. For example, if an issue says "open a project with a complex Makefile that uses recursive make," the validation project should replicate that structure — not use a simplified single-target project that may not trigger the same code path.

### Step 2: Create Project Directory

Create the validation project inside the **validation-projects** directory (default: `C:\Users\<user directory>\validation-projects`).

The validation project directory **is** the test project — all test project files (`Makefile`, source files, `.vscode/settings.json`, etc.) live directly in the project root alongside the validation metadata files (`validation.json`, `manual-checklist.md`).

**Directory naming convention:**
- Format: `vscode-makefile-tools-pr-{number}-{short-slug}`
- Example: `vscode-makefile-tools-pr-456-fix-dry-run-parsing`
- Rules:
  - Lowercase everything
  - Sanitize special characters (replace non-alphanumeric with hyphens)
  - Cap the slug portion at 40 characters
  - Remove trailing hyphens
- If the directory already exists, ask the user whether to overwrite or create a suffixed version

### Step 3: Generate validation.json

Create a `validation.json` metadata file in the project root with this structure:

```json
{
  "pr": {
    "number": 123,
    "title": "Fix dry-run parsing for cross-compiler invocations",
    "url": "https://github.com/microsoft/vscode-makefile-tools/pull/123",
    "owner": "microsoft",
    "repo": "vscode-makefile-tools",
    "headBranch": "fix/cross-compiler-parsing",
    "baseBranch": "main",
    "headSha": "abc123def456...",
    "isFork": false,
    "linkedIssues": ["#100"]
  },
  "validation": {
    "status": "planned",
    "createdAt": "2026-04-16T12:00:00Z",
    "updatedAt": "2026-04-16T12:00:00Z",
    "result": null,
    "notes": ""
  }
}
```

Valid status values: `planned`, `in_progress`, `passed`, `failed`, `obsolete`. This can be used for personal tracking.

### Step 4: Generate README.md

Create a comprehensive `README.md` with these sections:

```markdown
# Validation: PR #{number} — {title}

> **Status:** 🔵 Planned
> **PR:** [microsoft/vscode-makefile-tools#{number}]({url})
> **Issue:** [microsoft/vscode-makefile-tools#{issueNumber}]({issueUrl})  ← include if linked issue exists
> **Target branch:** {baseBranch} ← {headBranch}
> **Pinned commit:** `{headSha}`
> **Created:** {date}

## Summary

{Summarize what the PR does based on the PR description and changed files.
Explain the problem it solves or the feature it introduces.
If a linked issue exists, reference it and explain its relationship to the PR.}

## Changed Files

{List the files changed in the PR with brief descriptions of what changed.
Group by layer when helpful — e.g., "Parser", "Configuration", "Make operations",
"CppTools provider", "Launch/debug", "Tree view", "Extension entry", "Tests".}

## Prerequisites

- VS Code (latest stable or Insiders)
- GNU Make (or compatible make tool — e.g., `nmake`, `mingw32-make`)
- A C/C++ compiler (GCC, Clang, or MSVC/cl)
- The C/C++ extension (ms-vscode.cpptools) installed for IntelliSense validation
{Include any additional environment requirements mentioned in the linked issue
(e.g., "Windows-only", "requires Visual Studio Developer Command Prompt",
"needs recursive make", "requires a build log file").}

## Repro Steps

{If the PR fixes a bug, describe how to reproduce the original issue
by opening this directory in VS Code with a pre-fix build of Makefile Tools.
**Prefer the linked issue's repro steps** over inventing new ones — they represent
the actual user-reported scenario and are most likely to trigger the bug.
If the PR adds a feature, describe how to exercise the new functionality.
If repro steps cannot be confidently derived from the PR, clearly state
what assumptions were made and what the user should verify or fill in.}

## Validation Approach

{Describe how this validation project tests the PR's changes:
- What specific behaviors to verify
- What inputs/scenarios to test
- What the expected outcomes are
- Whether to test with dry-run output, a pre-generated build log, or both
- Which makefile configurations to test (if the PR touches configuration handling)
- Which build targets and launch targets to exercise
- How to set up the environment to test}

## Regression Testing

{Describe what existing behavior must NOT break:
- Key workflows that touch the same code paths
- Edge cases to watch for
- Existing tests that should still pass (`yarn test`)
- Related features that could be affected (IntelliSense, build, debug/run)
- Cross-platform concerns (Windows/macOS/Linux)}

## Manual Checklist

See `manual-checklist.md` for a step-by-step testing checklist.
```

**Important rules for README generation:**
- If repro steps are not clear from the PR, say so explicitly and mark sections with `<!-- TODO: fill in -->` comments
- Link back to the PR and any linked issues
- Be specific — don't write generic testing advice; tailor everything to this PR's actual changes
- When the PR touches shared logic (e.g., `parser.ts`, `make.ts`), note whether testing should cover both dry-run and build-log modes, and multiple makefile configurations

### Step 5: Generate manual-checklist.md

Create a `manual-checklist.md` with actionable test steps. Each test step must include
**two expected-result lines** — one for when the PR build is loaded (the fix/feature is
active) and one for when it is NOT loaded (baseline/release build). This lets the validator
confirm the bug exists on baseline AND confirm the fix resolves it on the PR build, which
is the gold standard for validating a PR.

```markdown
# Manual Validation Checklist — PR #{number}

## Pre-Validation Setup
- [ ] PR build of Makefile Tools extension is loaded in VS Code (via VSIX or development host)
- [ ] Baseline (release) build of Makefile Tools is available for comparison testing
- [ ] Prerequisites from `README.md` are satisfied (Make, compiler, C/C++ extension)
- [ ] This validation project directory is open in VS Code

## Core Validation
{Generate specific checklist items based on what the PR changes.
Each item should be a concrete, testable action with two expected results:
one for the PR build (fix applied) and one for baseline (no fix).}

- [ ] {Test step 1}
  - 🟢 **With PR build:** {expected result when the fix/feature is active}
  - 🔴 **Without PR build (baseline):** {expected result on release/main — typically the bug behavior}
- [ ] {Test step 2}
  - 🟢 **With PR build:** {expected result}
  - 🔴 **Without PR build (baseline):** {expected result}

## Regression Checks
{Generate checklist items for verifying existing behavior isn't broken.
Regression checks should produce the SAME result with and without the PR build.}

- [ ] {Regression check 1}
  - 🟢 **With PR build:** {expected result — same as baseline}
  - ⚪ **Without PR build (baseline):** {expected result — same as PR build}
- [ ] {Regression check 2}
  - 🟢 **With PR build:** {expected result — same as baseline}
  - ⚪ **Without PR build (baseline):** {expected result — same as PR build}

## Edge Cases
- [ ] {Edge case 1}
  - 🟢 **With PR build:** {expected result}
  - 🔴 **Without PR build (baseline):** {expected result}
- [ ] {Edge case 2}
  - 🟢 **With PR build:** {expected result}
  - 🔴 **Without PR build (baseline):** {expected result}

## Result
- [ ] **PASS** — All checks passed, PR is validated
- [ ] **FAIL** — Issues found (document below)

### Issues Found
{Space for documenting any problems discovered during validation}
```

**Formatting rules for expected results:**
- Use 🟢 for the PR build line and 🔴 for the baseline line in **Core Validation** and **Edge Cases** (where behavior should differ).
- Use 🟢 for the PR build line and ⚪ for the baseline line in **Regression Checks** (where behavior should be identical).
- If a test step only makes sense with the PR build (e.g., testing a brand-new feature that has no baseline equivalent), use only the 🟢 line and note that the feature doesn't exist on baseline.
- Be specific about the observable difference — don't just say "works" vs "doesn't work". Describe what the user will actually see (error messages, UI state, output values, IntelliSense results, etc.).

### Step 6: Generate test project files

Place all test project files **directly in the validation project root** — do not create a nested `test-project\` subdirectory. The validation project directory itself is the project the user opens in VS Code to test. Validation metadata files (`validation.json`, `manual-checklist.md`) coexist alongside the test project files in the same directory.

The test project is **not** about building the Makefile Tools extension itself — assume the user already has a working PR build (VSIX or dev host). The test project is a **target Make-based project** that exercises the behavior the PR changes.

#### What to generate

Create the simplest Make-based project that triggers the behavior under test. Every test project must include:

1. **`Makefile`** — A Makefile that exercises the behavior under test. Include appropriate targets (e.g., `all`, `clean`, specific named targets). The Makefile should use compiler invocations and flags that the extension's dry-run parser (`parser.ts`) needs to detect — e.g., `gcc`, `g++`, `clang`, `cl`, with `-I` include paths, `-D` defines, and source file arguments as needed by the test scenario.

2. **Source files** (if the project needs to build) — Keep them trivial (e.g., hello-world `main.c` or `main.cpp`). The source code is scaffolding; the Makefile structure and compiler invocations are what matter.

3. **`.vscode/settings.json`** — Include when:
   - The PR changes behavior related to `makefile.*` VS Code settings
   - You need to configure `makefile.configurations` (named sets of make parameters)
   - You need to set `makefile.makePath` to a specific make tool
   - You need to set `makefile.buildLog` to point to a pre-generated build log file
   - You need to configure specific `makefile.*` settings that trigger the behavior under test (e.g., `makefile.makeArgs`, `makefile.makeDirectory`, `makefile.additionalCompilerNames`, `makefile.dryrunSwitches`)
   Include comments explaining what each setting does and what to expect before vs. after the fix.

4. **Build log file** (if applicable) — When the PR touches build-log parsing or when testing with `makefile.buildLog`, include a sample build log file (e.g., `build-log.txt`) that contains the make output the extension would parse. This is useful for testing parser changes without requiring an actual make invocation.

5. **Additional files as needed** — e.g., sub-directory Makefiles (for recursive make testing), header files with specific include structures, `.vscode/tasks.json`, or pre/post configure scripts — only if the PR specifically involves that type of functionality.

Note: The `README.md` generated in Step 4 serves as both the validation overview and the test project documentation (prerequisites, repro steps, validation instructions). Do not create a separate README for the test project.

#### Configuration-aware testing

The Makefile Tools extension supports named **makefile configurations** (`makefile.configurations` setting), which let users define multiple sets of build parameters (make path, make args, make directory, build log, pre/post configure scripts). The test project should exercise the correct configuration(s) based on what the PR changes:

- **Dry-run mode** (default): The extension runs `make --dry-run` to capture compiler invocations without building. Test this mode for most PRs, especially those touching `parser.ts`, `make.ts`, or `configuration.ts`.
- **Build-log mode** (`makefile.buildLog`): The extension reads a pre-generated build log instead of running make. Test this mode when the PR touches build-log handling or parser logic that applies to both modes.
- **Multiple configurations**: When the PR touches configuration resolution or switching, define multiple named configurations in `makefile.configurations` to test switching between them.
- **Build targets**: When the PR touches target resolution or building, include multiple Makefile targets and test selecting/building different ones via the extension's build target picker.
- **Launch targets**: When the PR touches debug/run functionality (`launch.ts`), ensure the Makefile produces an executable target and test launching it via `Makefile: Debug` or `Makefile: Run in Terminal`.

#### Principles

- **Minimal and focused.** Only include what's needed to trigger the behavior. Don't add unrelated targets, dependencies, or complexity.
- **Pre-wired to trigger the bug.** Configuration should be set up so that simply opening the project in VS Code and running `Makefile: Configure` (or the relevant command) exercises the changed behavior. The user shouldn't need to manually edit config files first.
- **Include regression scenarios when appropriate.** If the PR changes shared code paths, include a second makefile configuration or additional targets that test an unaffected path to verify no regression.
- **Mark unknowns.** If you can't determine the exact reproduction setup from the PR, add `<!-- TODO: ... -->` comments explaining what the user needs to fill in.

### Step 7: Summary

After creating all files, present a summary:

```
✅ Validation project created: {directory-name}

Files:
  📄 README.md              — Project overview, repro steps, and validation plan
  📋 manual-checklist.md     — Step-by-step testing checklist
  📦 validation.json         — Machine-readable PR metadata
  📄 Makefile                — Make-based project definition
  📄 src/main.c              — Minimal source file(s)
  📄 .vscode/settings.json   — VS Code / Makefile Tools settings (if applicable)
  📄 build-log.txt           — Sample build log (if applicable)

Next steps:
  1. Open the project directory in VS Code with the PR build of Makefile Tools loaded
  2. Follow README.md to repro the issue and validate the fix
  3. Work through manual-checklist.md for full coverage
  4. Update validation.json status as you go
```

## Guidelines

- Always pin to a specific commit SHA for reproducibility
- Be honest when information is insufficient — mark gaps clearly rather than guessing
- Tailor all content to the specific PR; avoid generic boilerplate
- Keep file paths Windows-compatible (backslashes, no special characters)
- If the user provides additional context about what to test, incorporate it
- When updating an existing validation project, preserve user-added content
