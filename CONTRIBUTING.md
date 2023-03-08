# How to Contribute Changes

## Contribution Steps

* Clone the repository: git clone https://github.com/microsoft/vscode-makefile-tools.git.
* Install [node](https://nodejs.org) and [yarn](https://yarnpkg.com).
* Run the following commands, in a terminal, from the Makefile Tools extension code base root folder:
      * `yarn install` will install the dependencies needed to build the extension.
      * **(optional)** `yarn global add vsce` will install `vsce` globally to create a VSIX package that you can install.
* To compile source changes, run from terminal: `yarn compile`.
      * This is also done automatically by VSCode when requesting to debug the extension via F5.
* To build a vsix with your changes, run from terminal: 'vsce package'.
* File an [issue](https://github.com/microsoft/vscode-makefile-tools/issues) and a [pull request](https://github.com/microsoft/vscode-makefile-tools/pulls) with the change and we will review it.
* If the change affects functionality, add a line describing the change to [**CHANGELOG.md**](CHANGELOG.md).
* Adding and running tests: infrastructure to be finalized.

## String Localization

* [vscode-nls](https://github.com/microsoft/vscode-nls) is used to localize strings in TypeScript code.  To use [vscode-nls](https://github.com/microsoft/vscode-nls), the source file must contain:
```typescript
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
```
* For each user-facing string, wrap the string in a call to localize:
```typescript
const readmeMessage: string = localize("refer.read.me", "Please refer to {0} for troubleshooting information. Issues can be created at {1}", readmePath, "https://github.com/Microsoft/vscode-makefile-tools/issues");
```
* The first parameter to localize should be a unique key for that string, not used by any other call to localize() in the file unless representing the same string.  The second parameter is the string to localize.  Both of these parameters must be string literals.  Tokens such as {0} and {1} are supported in the localizable string, with replacement values passed as additional parameters to localize().

## About the Code

* [**configuration.ts**](src/configuration.ts) read/update/process settings.
* [**cpptools.ts**](src/cpptools.ts) integration with CppTools VSCode extension.
* [**extension.ts**](src/extension.ts) extension activation, commands, functionality entry-points.
* [**launch.ts**](src/launch.ts) debugging and running in terminal.
* [**logger.ts**](src/logger.ts) logging.
* [**make.ts**](src/make.ts) make invocations for various features: building, (pre)configuring.
* [**parser.ts**](src/parser.ts) regular expressions and parsing functionality.
* [**state.ts**](src/state.ts) reading/setting state variables.
* [**telemetry.ts**](src/telemetry.ts) telemetry functionality.
* [**tree.ts**](src/tree.ts) tree UI for the Makefile Tools side panel.
* [**ui.ts**](src/ui.ts) deprecated support for status bar buttons.
* [**util.ts**](src/util.ts) various util helpers for file system operations, paths/strings processing, threads management.

