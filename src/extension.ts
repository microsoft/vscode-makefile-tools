// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Makefile Tools extension

import * as configuration from "./configuration";
import * as cpptools from "./cpptools";
import * as launch from "./launch";
import { promises as fs } from "fs";
import * as make from "./make";
import * as parser from "./parser";
import * as path from "path";
import * as state from "./state";
import * as telemetry from "./telemetry";
import * as tree from "./tree";
import * as ui from "./ui";
import * as util from "./util";
import * as vscode from "vscode";
import * as cpp from "vscode-cpptools";

import * as nls from "vscode-nls";
import { TelemetryEventProperties } from "@vscode/extension-telemetry";
nls.config({
  messageFormat: nls.MessageFormat.bundle,
  bundleFormat: nls.BundleFormat.standalone,
})();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

let statusBar: ui.UI = ui.getUI();
let launcher: launch.Launcher = launch.getLauncher();

export let extension: MakefileToolsExtension;

export class MakefileToolsExtension {
  public readonly _projectOutlineProvider = new tree.ProjectOutlineProvider();
  private readonly _projectOutlineTreeView = vscode.window.createTreeView(
    "makefile.outline",
    {
      treeDataProvider: this._projectOutlineProvider,
      showCollapseAll: false,
    }
  );

  private readonly cppConfigurationProvider =
    new cpptools.CppConfigurationProvider();
  public getCppConfigurationProvider(): cpptools.CppConfigurationProvider {
    return this.cppConfigurationProvider;
  }

  private mementoState = new state.StateManager(this.extensionContext);
  private cppToolsAPI?: cpp.CppToolsApi;
  private cppConfigurationProviderRegister?: Promise<void>;
  private compilerFullPath?: string;

  public constructor(
    public readonly extensionContext: vscode.ExtensionContext
  ) {}

  public updateBuildLogPresent(newValue: boolean): void {
    vscode.commands.executeCommand(
      "setContext",
      "makefile.buildLogFilePresent",
      newValue
    );
  }

  public updateMakefileFilePresent(newValue: boolean): void {
    vscode.commands.executeCommand(
      "setContext",
      "makefile.makefileFilePresent",
      newValue
    );
  }

  public getState(): state.StateManager {
    return this.mementoState;
  }

  public dispose(): void {
    this._projectOutlineTreeView.dispose();
    if (this.cppToolsAPI) {
      this.cppToolsAPI.dispose();
    }
  }

  private fullFeatureSet: boolean = false;
  public getFullFeatureSet(): boolean {
    return this.fullFeatureSet;
  }
  public async setFullFeatureSet(newValue: boolean): Promise<void> {
    await vscode.commands.executeCommand(
      "setContext",
      "makefile:fullFeatureSet",
      newValue
    );
    this.fullFeatureSet = newValue;
  }

  // Used for calling cppToolsAPI.notifyReady only once in a VSCode session.
  private ranNotifyReadyInSession: boolean = false;
  public getRanNotifyReadyInSession(): boolean {
    return this.ranNotifyReadyInSession;
  }
  public setRanNotifyReadyInSession(ran: boolean): void {
    this.ranNotifyReadyInSession = ran;
  }

  // Similar to state.ranConfigureInCodebaseLifetime, but at the scope of a VSCode session
  private completedConfigureInSession: boolean = false;
  public getCompletedConfigureInSession(): boolean | undefined {
    return this.completedConfigureInSession;
  }
  public setCompletedConfigureInSession(completed: boolean): void {
    this.completedConfigureInSession = completed;
  }

  // Register this extension as a new provider or request an update
  public async registerCppToolsProvider(): Promise<void> {
    await this.ensureCppToolsProviderRegistered();

    // Call notifyReady earlier than when the provider is updated,
    // as soon as we know that we are going to actually parse for IntelliSense.
    // This allows CppTools to ask earlier about source files in use
    // and Makefile Tools may return a targeted source file configuration
    // if it was already computed in our internal arrays (make.ts: customConfigProviderItems).
    // If the requested file isn't yet processed, it will get updated when configure is finished.
    // TODO: remember all requests that are coming and send an update as soon as we detect
    // any of them being pushed into make.customConfigProviderItems.
    if (this.cppToolsAPI) {
      if (!this.ranNotifyReadyInSession && this.cppToolsAPI.notifyReady) {
        this.cppToolsAPI.notifyReady(this.cppConfigurationProvider);
        this.setRanNotifyReadyInSession(true);
      }
    }
  }

  // Request a custom config provider update.
  public updateCppToolsProvider(): void {
    this.cppConfigurationProvider.logConfigurationProviderBrowse();

    if (this.cppToolsAPI) {
      this.cppToolsAPI.didChangeCustomConfiguration(
        this.cppConfigurationProvider
      );
    }
  }

  public ensureCppToolsProviderRegistered(): Promise<void> {
    // make sure this extension is registered as provider only once
    if (!this.cppConfigurationProviderRegister) {
      this.cppConfigurationProviderRegister = this.registerCppTools();
    }

    return this.cppConfigurationProviderRegister;
  }

  public getCppToolsVersion(): cpp.Version | undefined {
    return this.cppToolsAPI?.getVersion();
  }

  public async registerCppTools(): Promise<void> {
    if (!this.cppToolsAPI) {
      this.cppToolsAPI = await cpp.getCppToolsApi(cpp.Version.v6);
    }

    if (this.cppToolsAPI) {
      this.cppToolsAPI.registerCustomConfigurationProvider(
        this.cppConfigurationProvider
      );
    }
  }

  private cummulativeBrowsePath: string[] = [];
  public clearCummulativeBrowsePath(): void {
    this.cummulativeBrowsePath = [];
  }

  public buildCustomConfigurationProvider(
    customConfigProviderItem: parser.CustomConfigProviderItem
  ): void {
    this.compilerFullPath = customConfigProviderItem.compilerFullPath;
    let provider: cpptools.CustomConfigurationProvider =
      make.getDeltaCustomConfigurationProvider();

    const configuration: cpp.SourceFileConfiguration = {
      defines: customConfigProviderItem.defines,
      standard: customConfigProviderItem.standard,
      includePath: customConfigProviderItem.includes,
      forcedInclude: customConfigProviderItem.forcedIncludes,
      intelliSenseMode: customConfigProviderItem.intelliSenseMode,
      compilerPath: customConfigProviderItem.compilerFullPath,
      compilerArgs: customConfigProviderItem.compilerArgs,
      windowsSdkVersion: customConfigProviderItem.windowsSDKVersion,
    };

    // cummulativeBrowsePath incorporates all the files and the includes paths
    // of all the compiler invocations of the current configuration
    customConfigProviderItem.files.forEach((filePath) => {
      let uri: vscode.Uri = vscode.Uri.file(filePath);
      let sourceFileConfigurationItem: cpptools.SourceFileConfigurationItem = {
        uri,
        configuration,
        compileCommand: {
          command: customConfigProviderItem.line,
          directory: customConfigProviderItem.currentPath,
          file: filePath,
        },
      };

      // These are the configurations processed during the current configure.
      // Store them in the 'delta' file index instead of the final one.
      provider.fileIndex.set(
        path.normalize(
          process.platform === "win32" ? uri.fsPath.toUpperCase() : uri.fsPath
        ),
        sourceFileConfigurationItem
      );
      extension
        .getCppConfigurationProvider()
        .logConfigurationProviderItem(sourceFileConfigurationItem);

      let folder: string = path.dirname(filePath);
      if (!this.cummulativeBrowsePath.includes(folder)) {
        this.cummulativeBrowsePath.push(folder);
      }
    });

    customConfigProviderItem.includes.forEach((incl) => {
      if (!this.cummulativeBrowsePath.includes(incl)) {
        this.cummulativeBrowsePath.push(incl);
      }
    });

    customConfigProviderItem.forcedIncludes.forEach((fincl) => {
      let folder: string = path.dirname(fincl);
      if (!this.cummulativeBrowsePath.includes(folder)) {
        this.cummulativeBrowsePath.push(fincl);
      }
    });

    provider.workspaceBrowse = {
      browsePath: this.cummulativeBrowsePath,
      standard: customConfigProviderItem.standard,
      compilerPath: customConfigProviderItem.compilerFullPath,
      compilerArgs: customConfigProviderItem.compilerArgs,
      windowsSdkVersion: customConfigProviderItem.windowsSDKVersion,
    };

    make.setCustomConfigurationProvider(provider);
  }

  public getCompilerFullPath(): string | undefined {
    return this.compilerFullPath;
  }
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  if (process.env["MAKEFILE_TOOLS_TESTING"] === "1") {
    await vscode.commands.executeCommand(
      "setContext",
      "makefile:testing",
      true
    );
  } else {
    await vscode.commands.executeCommand(
      "setContext",
      "makefile:testing",
      false
    );
  }

  statusBar = ui.getUI();
  extension = new MakefileToolsExtension(context);
  configuration.disableAllOptionallyVisibleCommands();
  await extension.setFullFeatureSet(false);

  telemetry.activate();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.setBuildConfiguration",
      async () => {
        await configuration.setNewConfiguration();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.getConfiguration", async () => {
      telemetry.logEvent("getConfiguration");
      return configuration.getCurrentMakefileConfiguration();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.setBuildTarget", async () => {
      await configuration.selectTarget();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.getBuildTarget", async () => {
      telemetry.logEvent("getBuildTarget");
      return configuration.getCurrentTarget() || "";
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.buildTarget", async () => {
      await make.buildTarget(
        make.TriggeredBy.buildTarget,
        configuration.getCurrentTarget() || "",
        false
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.buildCleanTarget", async () => {
      await make.buildTarget(
        make.TriggeredBy.buildCleanTarget,
        configuration.getCurrentTarget() || "",
        true
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.buildAll", async () => {
      await make.buildTarget(make.TriggeredBy.buildAll, "all", false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.buildCleanAll", async () => {
      await make.buildTarget(make.TriggeredBy.buildCleanAll, "all", true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.setLaunchConfiguration",
      async () => {
        await configuration.selectLaunchConfiguration();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.launchDebug", async () => {
      await launcher.debugCurrentTarget();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.launchRun", async () => {
      await launcher.runCurrentTarget();
    })
  );

  /** Start of commands that shouldn't be exposed in package.json, they are used for command substitution in launch.json and tasks.json.  */
  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.getLaunchTargetPath", () => {
      telemetry.logEvent("getLaunchTargetPath");
      return launcher.getLaunchTargetPath();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.launchTargetPath", () => {
      telemetry.logEvent("launchTargetPath");
      return launcher.launchTargetPath();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.getLaunchTargetDirectory", () => {
      telemetry.logEvent("getLaunchTargetDirectory");
      return launcher.getLaunchTargetDirectory();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.getLaunchTargetFileName", () => {
      telemetry.logEvent("getLaunchTargetFileName");
      return launcher.getLaunchTargetFileName();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.launchTargetFileName", () => {
      telemetry.logEvent("launchTargetFileName");
      return launcher.launchTargetFileName();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.getLaunchTargetArgs", () => {
      telemetry.logEvent("getLaunchTargetArgs");
      return launcher.getLaunchTargetArgs();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.getLaunchTargetArgsConcat",
      () => {
        telemetry.logEvent("getLaunchTargetArgsConcat");
        return launcher.getLaunchTargetArgsConcat();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.makeBaseDirectory", () => {
      telemetry.logEvent("makeBaseDirectory");
      return configuration.makeBaseDirectory();
    })
  );
  /** End of commands that shouldn't be exposed in package.json, they are used for command substitution in launch.json and tasks.json. */

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.configure", async () => {
      await make.configure(make.TriggeredBy.configure);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.cleanConfigure", async () => {
      await make.cleanConfigure(make.TriggeredBy.cleanConfigure);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.preConfigure", async () => {
      await make.preConfigure(make.TriggeredBy.preconfigure);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.postConfigure", async () => {
      await make.postConfigure(make.TriggeredBy.postConfigure);
    })
  );

  // Reset state - useful for troubleshooting.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.resetState",
      (reload?: boolean) => {
        telemetry.logEvent("commandResetState");
        extension.getState().reset(reload);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.outline.configure", () => {
      return vscode.commands.executeCommand("makefile.configure");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.outline.cleanConfigure", () => {
      return vscode.commands.executeCommand("makefile.cleanConfigure");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.outline.preConfigure", () => {
      return vscode.commands.executeCommand("makefile.preConfigure");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.outline.postConfigure", () => {
      return vscode.commands.executeCommand("makefile.postConfigure");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.outline.setLaunchConfiguration",
      () => {
        return vscode.commands.executeCommand(
          "makefile.setLaunchConfiguration"
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.outline.launchDebug", () => {
      return vscode.commands.executeCommand("makefile.launchDebug");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.outline.launchRun", () => {
      return vscode.commands.executeCommand("makefile.launchRun");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.outline.setBuildTarget", () => {
      return vscode.commands.executeCommand("makefile.setBuildTarget");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.outline.buildTarget", () => {
      return vscode.commands.executeCommand("makefile.buildTarget");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("makefile.outline.buildCleanTarget", () => {
      return vscode.commands.executeCommand("makefile.buildCleanTarget");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.outline.setBuildConfiguration",
      () => {
        return vscode.commands.executeCommand("makefile.setBuildConfiguration");
      }
    )
  );

  // Read from the workspace state before reading from settings,
  // becase the latter may use state info in variable expansion.
  configuration.initFromState();
  await configuration.initFromSettings(true);

  const openSettings = async (setting: string) => {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      setting
    );
    await vscode.commands.executeCommand(
      "workbench.action.openWorkspaceSettings"
    );
  };

  const openFile = async (fileUri: vscode.Uri) => {
    await vscode.commands.executeCommand("vscode.open", fileUri);
    await vscode.commands.executeCommand(
      "workbench.files.action.showActiveFileInExplorer"
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.outline.openMakefilePathSetting",
      async () => {
        await openSettings("makefile.makefilePath");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.outline.openMakefileFile",
      async () => {
        const makefile = configuration.getConfigurationMakefile();
        if (makefile) {
          if (util.checkFileExistsSync(makefile)) {
            await openFile(vscode.Uri.file(makefile));
          } else {
            extension.updateMakefileFilePresent(false);
            vscode.window.showErrorMessage(
              localize(
                "makefile.outline.makefileFileNotFound",
                "The makefile file could not be opened."
              )
            );
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.outline.openMakePathSetting",
      async () => {
        await openSettings("makefile.makePath");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.outline.openBuildLogSetting",
      async () => {
        await openSettings("makefile.buildLog");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "makefile.outline.openBuildLogFile",
      async () => {
        const buildLog = configuration.getBuildLog();
        if (buildLog) {
          if (util.checkFileExistsSync(buildLog)) {
            await openFile(vscode.Uri.file(buildLog));
          } else {
            extension.updateBuildLogPresent(false);
            vscode.window.showErrorMessage(
              localize(
                "makefile.outline.buildLogFileNotFound",
                "The build log file could not be opened."
              )
            );
          }
        }
      }
    )
  );

  // === Commands only for testing ===
  // commands that are not exposed via package.json and are used only for testing.
  // TODO: In the future, we should refactor such that our tests can use already exposed commands, and/or refactor so
  // that some of our tests that are more unit-like tests can be done with direct dependencies on the code.
  if (process.env["MAKEFILE_TOOLS_TESTING"] === "1") {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.setBuildConfigurationByName",
        async (name: string) => {
          await configuration.setConfigurationByName(name);
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.setPreconfigureScriptByPath",
        async (path: string) => {
          await configuration.setPreConfigureScript(path);
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.setTargetByName",
        async (name: string) => {
          await configuration.setTargetByName(name);
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.setLaunchConfigurationByName",
        async (name: string) => {
          await configuration.setLaunchConfigurationByName(name);
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.validateLaunchConfiguration",
        async () => {
          return await launch
            .getLauncher()
            .validateLaunchConfiguration(make.Operations.debug);
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.getCurrentLaunchConfiguration",
        async () => {
          return configuration.getCurrentLaunchConfiguration();
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.prepareDebugAndRunCurrentTarget",
        async (launchConfiguration: configuration.LaunchConfiguration) => {
          launch.getLauncher().prepareDebugCurrentTarget(launchConfiguration);
          launch.getLauncher().prepareRunCurrentTarget();
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.prepareBuildTarget",
        async (target: string) => {
          make.prepareBuildTarget(target);
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("makefile.testResetState", async () => {
        await configuration.setCurrentLaunchConfiguration(undefined);
        await configuration.setCurrentMakefileConfiguration("Default");
        configuration.setCurrentTarget(undefined);
        configuration.initFromState();
        await configuration.initFromSettings();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.getExpandedSettingValue",
        async (key: string, value: any) => {
          await util.getExpandedSettingVal(key, value);
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "makefile.expandVariablesInSetting",
        async (key: string, value: string) => {
          return util.expandVariablesInSetting(key, value);
        }
      )
    );
  }
  // === End of commands only for testing ===

  const parseCompilerArgsScript: string = util.parseCompilerArgsScriptFile();

  // The extension VSIX stripped the executable bit, so we need to set it.
  // 0x755 means rwxr-xr-x (read and execute for everyone, write for owner).
  await fs.chmod(parseCompilerArgsScript, 0o755);

  if (extension.getFullFeatureSet()) {
    let shouldConfigure = configuration.getConfigureOnOpen();
    if (shouldConfigure === null) {
      // Ask if the user wants to configure on open with the Makefile Tools extension.
      interface Choice1 {
        title: string;
        doConfigure: boolean;
      }
      vscode.window
        .showInformationMessage<Choice1>(
          localize(
            "extension.configureOnOpen",
            "Would you like to configure C++ IntelliSense for this workspace using information from your Makefiles?"
          ),
          {},
          { title: localize("yes", "Yes"), doConfigure: true },
          { title: localize("no", "No"), doConfigure: false }
        )
        .then(async (chosen) => {
          if (!chosen) {
            // User cancelled, they don't want to configure.
            shouldConfigure = false;
            telemetry.logConfigureOnOpenTelemetry(false);
          } else {
            // ask them if they always want to configure on open.
            // TODO: More work to do here to have the right flow.
            const persistMessage = chosen.doConfigure
              ? localize(
                  "always.configure.on.open",
                  "Always configure C++ IntelliSense using information from your Makefiles upon opening?"
                )
              : localize(
                  "never.configure.on.open",
                  "Configure C++ IntelliSense using information from your Makefiles upon opening?"
                );
            const buttonMessages = chosen.doConfigure
              ? [localize("yes.button", "Yes"), localize("no.button", "No")]
              : [
                  localize("never.button", "Never"),
                  localize(
                    "never.for.this.workspace.button",
                    "Not for this workspace"
                  ),
                ];
            interface Choice2 {
              title: string;
              persistMode: telemetry.ConfigureOnOpenScope;
            }

            vscode.window
              .showInformationMessage<Choice2>(
                persistMessage,
                {},
                { title: buttonMessages[0], persistMode: "user" },
                { title: buttonMessages[1], persistMode: "workspace" }
              )
              .then(async (choice) => {
                if (!choice) {
                  // User cancelled. Do nothing.
                  telemetry.logConfigureOnOpenTelemetry(chosen.doConfigure);
                  return;
                }

                let configTarget = vscode.ConfigurationTarget.Global;
                if (choice.persistMode === "workspace") {
                  configTarget = vscode.ConfigurationTarget.Workspace;
                }
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                  await vscode.workspace
                    .getConfiguration(undefined, workspaceFolder)
                    .update(
                      "makefile.configureOnOpen",
                      chosen.doConfigure,
                      configTarget
                    );
                }

                telemetry.logConfigureOnOpenTelemetry(
                  chosen.doConfigure,
                  choice.persistMode
                );
              });

            shouldConfigure = chosen.doConfigure;
            if (shouldConfigure === true) {
              await make.cleanConfigure(make.TriggeredBy.cleanConfigureOnOpen);
            }
          }
        });
    }

    if (shouldConfigure === true) {
      // We've opened a new workspace folder, and the user wants us to configure it now.
      await make.cleanConfigure(make.TriggeredBy.cleanConfigureOnOpen);
    }
  }

  // Analyze settings for type validation and telemetry
  let workspaceConfiguration: vscode.WorkspaceConfiguration =
    vscode.workspace.getConfiguration("makefile");
  let telemetryProperties: telemetry.Properties | null = {};
  try {
    telemetryProperties = await telemetry.analyzeSettings(
      workspaceConfiguration,
      "makefile",
      util.thisExtensionPackage().contributes.configuration.properties,
      true,
      telemetryProperties
    );
  } catch (e) {
    telemetry.telemetryLogger(e.message);
  }

  if (telemetryProperties && util.hasProperties(telemetryProperties)) {
    telemetry.logEvent("settings", telemetryProperties);
  }
}

export async function deactivate(): Promise<void> {
  vscode.window.showInformationMessage(
    localize(
      "extension.deactivated",
      "The extension {0} is de-activated.",
      "'vscode-makefile-tools'"
    )
  );

  await telemetry.deactivate();

  const items: any = [extension, launcher, statusBar];

  for (const item of items) {
    if (item) {
      item.dispose();
    }
  }
}
