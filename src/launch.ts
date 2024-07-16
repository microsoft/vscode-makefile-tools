// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Launch support: debug and run in terminal

import * as configuration from "./configuration";
import * as extension from "./extension";
import * as logger from "./logger";
import * as make from "./make";
import * as path from "path";
import * as telemetry from "./telemetry";
import * as util from "./util";
import * as vscode from "vscode";

import * as nls from "vscode-nls";
nls.config({
  messageFormat: nls.MessageFormat.bundle,
  bundleFormat: nls.BundleFormat.standalone,
})();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export enum LaunchStatuses {
  success = "success",
  blocked = "blocked by (pre)configure or build",
  noLaunchConfigurationSet = "no launch configuration set by the user",
  launchTargetsListEmpty = "launch targets list empty",
  buildFailed = "build failed",
}

let launcher: Launcher;

export class Launcher implements vscode.Disposable {
  // Command property accessible from launch.json:
  // the full path of the target binary currently set for launch
  public getLaunchTargetPath(): string {
    let launchConfiguration: configuration.LaunchConfiguration | undefined =
      configuration.getCurrentLaunchConfiguration();
    if (launchConfiguration) {
      return launchConfiguration.binaryPath;
    } else {
      return "";
    }
  }

  // Command property accessible from launch.json:
  // calls getLaunchTargetPath after triggering a build of the current target,
  // if makefile.buildBeforeLaunch allows it.
  public async launchTargetPath(): Promise<string> {
    if (configuration.getBuildBeforeLaunch()) {
      await make.buildTarget(
        make.TriggeredBy.launch,
        configuration.getCurrentTarget() || ""
      );
    }

    return this.getLaunchTargetPath();
  }

  // Command property accessible from launch.json:
  // the full path from where the target binary is to be launched
  public getLaunchTargetDirectory(): string {
    let launchConfiguration: configuration.LaunchConfiguration | undefined =
      configuration.getCurrentLaunchConfiguration();
    if (launchConfiguration) {
      return launchConfiguration.cwd;
    } else {
      return util.getWorkspaceRoot();
    }
  }

  // Command property accessible from launch.json:
  // the file name of the current target binary, without path or extension.
  public getLaunchTargetFileName(): string {
    let launchConfiguration: configuration.LaunchConfiguration | undefined =
      configuration.getCurrentLaunchConfiguration();
    if (launchConfiguration) {
      return path.parse(launchConfiguration.binaryPath).name;
    } else {
      return "";
    }
  }

  // Command property accessible from launch.json:
  // calls getLaunchTargetFileName after triggering a build of the current target,
  // if makefile.buildBeforeLaunch allows it.
  public async launchTargetFileName(): Promise<string> {
    if (configuration.getBuildBeforeLaunch()) {
      await make.buildTarget(
        make.TriggeredBy.launch,
        configuration.getCurrentTarget() || ""
      );
    }

    return this.getLaunchTargetFileName();
  }

  // Command property accessible from launch.json:
  // the arguments sent to the target binary, returned as array of string
  // This is used by the debug/terminal VS Code APIs.
  public getLaunchTargetArgs(): string[] {
    let launchConfiguration: configuration.LaunchConfiguration | undefined =
      configuration.getCurrentLaunchConfiguration();
    if (launchConfiguration) {
      return launchConfiguration.binaryArgs;
    } else {
      return [];
    }
  }

  // Command property accessible from launch.json:
  // the arguments sent to the target binary, returned as one simple string
  // This is an alternative to define the arguments in launch.json,
  // since the string array syntax is not working.
  // This is not a perfect solution, it all depends on how the main entry point
  // is parsing its given arguments.
  // Example: for [CWD>tool arg1 arg2 arg3], the tool will receive
  // 2 arguments: tool and "arg1 arg2 arg3"
  // As opposed to the above case when the tool will receive
  // 4 arguments: tool, arg1, arg2, arg3
  // TODO: investigate how we can define string array arguments
  // for the target binary in launch.json
  public getLaunchTargetArgsConcat(): string {
    return this.getLaunchTargetArgs().join(" ");
  }

  // Invoke a VS Code debugging session passing it all the information
  // from the current launch configuration.
  // Debugger (imperfect) guess logic:
  //    - VS for msvc toolset, lldb for clang toolset, gdb for anything else.
  //    - debugger path is assumed to be the same as the compiler path.
  // Exceptions for miMode:
  //    - if the above logic results in a debugger that is missing, try the other one.
  //      This is needed either because the system might not be equipped
  //      with the preffered debugger that corresponds to the toolset in use,
  //      but also because there might be a compiler alias that is not properly identified
  //      (example: "cc" alias that points to clang but is not identified as clang,
  //       therefore requesting a gdb debugger which may be missing
  //       because there is no gcc toolset installed).
  //       TODO: implement proper detection of aliases and their commands.
  // Exceptions for miDebuggerPath:
  //    - for MacOS, point to the lldb-mi debugger that is installed by CppTools
  //    - if CppTools extension is not installed, intentionally do not provide a miDebuggerPath On MAC,
  //      because the debugger knows how to find automatically the right lldb-mi when miMode is lldb and miDebuggerPath is undefined
  //      (this is true for systems older than Catalina).
  // Additionally, cppvsdbg ignores miMode and miDebuggerPath.
  public prepareDebugCurrentTarget(
    currentLaunchConfiguration: configuration.LaunchConfiguration
  ): vscode.DebugConfiguration {
    let args: string[] = this.getLaunchTargetArgs();

    let compilerPath: string | undefined =
      extension.extension.getCompilerFullPath();
    let parsedObjPath: path.ParsedPath | undefined = compilerPath
      ? path.parse(compilerPath)
      : undefined;
    let isClangCompiler: boolean | undefined =
      parsedObjPath?.name.startsWith("clang");
    let isMsvcCompiler: boolean | undefined =
      !isClangCompiler && parsedObjPath?.name.startsWith("cl");
    let dbg: string = isMsvcCompiler ? "cppvsdbg" : "cppdbg";

    // Initial debugger guess
    let guessMiDebuggerPath: string | undefined =
      !isMsvcCompiler && parsedObjPath ? parsedObjPath.dir : undefined;
    let guessMiMode: string | undefined;
    if (parsedObjPath?.name.startsWith("clang")) {
      guessMiMode = "lldb";
    } else if (!parsedObjPath?.name.startsWith("cl")) {
      guessMiMode = "gdb";
    }

    // If the first chosen debugger is not installed, try the other one.
    if (guessMiDebuggerPath && guessMiMode) {
      // if the guessMiDebuggerPath is already a file, then go with that. Otherwise, append the guessMiMode.
      let debuggerPath: string = util.checkFileExistsSync(guessMiDebuggerPath)
        ? guessMiDebuggerPath
        : path.join(guessMiDebuggerPath, guessMiMode);
      if (process.platform === "win32") {
        // On mingw a file is not found if the extension is not part of the path
        debuggerPath = debuggerPath + ".exe";
      }

      if (!util.checkFileExistsSync(debuggerPath)) {
        guessMiMode = guessMiMode === "gdb" ? "lldb" : "gdb";
      }
    }

    // Properties defined by makefile.launchConfigurations override makefile.defaultLaunchConfiguration
    // and they both override the guessed values.
    let defaultLaunchConfiguration:
      | configuration.DefaultLaunchConfiguration
      | undefined = configuration.getDefaultLaunchConfiguration();
    let miMode: string | undefined =
      currentLaunchConfiguration.MIMode ||
      defaultLaunchConfiguration?.MIMode ||
      guessMiMode;
    let miDebuggerPath: string | undefined =
      currentLaunchConfiguration.miDebuggerPath ||
      defaultLaunchConfiguration?.miDebuggerPath ||
      guessMiDebuggerPath;

    // Exception for MAC-lldb, point to the lldb-mi installed by CppTools or set debugger path to undefined
    // (more details in the comment at the beginning of this function).
    if (miMode === "lldb" && process.platform === "darwin") {
      const cpptoolsExtension: vscode.Extension<any> | undefined =
        vscode.extensions.getExtension("ms-vscode.cpptools");
      miDebuggerPath = cpptoolsExtension
        ? path.join(
            cpptoolsExtension.extensionPath,
            "debugAdapters",
            "lldb-mi",
            "bin",
            "lldb-mi"
          )
        : undefined;
    } else if (miDebuggerPath && miMode) {
      // if the miDebuggerPath is already a file, rather than a directory, go with it.
      // Otherwise, append the MiMode.
      miDebuggerPath = util.checkFileExistsSync(miDebuggerPath)
        ? miDebuggerPath
        : path.join(miDebuggerPath, miMode);
      if (process.platform === "win32") {
        miDebuggerPath = miDebuggerPath + ".exe";
      }
    }

    let debugConfig: vscode.DebugConfiguration = {
      type: dbg,
      name: `Debug My Program`,
      request: "launch",
      cwd: this.getLaunchTargetDirectory(),
      args,
      env: util.mergeEnvironment(process.env as util.EnvironmentVariables),
      program: this.getLaunchTargetPath(),
      MIMode: miMode,
      miDebuggerPath: miDebuggerPath,
      console: "internalConsole",
      internalConsoleOptions: "openOnSessionStart",
      stopAtEntry:
        currentLaunchConfiguration.stopAtEntry ||
        defaultLaunchConfiguration?.stopAtEntry,
      symbolSearchPath:
        currentLaunchConfiguration.symbolSearchPath ||
        defaultLaunchConfiguration?.symbolSearchPath,
    };

    logger.message(
      localize(
        "created.debug.config",
        "Created the following debug config:\n   type = {0}\n   cwd = {1} (= {2})\n   args = {3}\n   program = {4} (= {5})\n   MIMode = {6}\n   miDebuggerPath = {7}\n   stopAtEntry = {8}\n   symbolSearchPath = {9}",
        dbg,
        debugConfig.cwd,
        this.getLaunchTargetDirectory(),
        args.join(" "),
        debugConfig.program,
        this.getLaunchTargetPath(),
        debugConfig.MIMode,
        debugConfig.miDebuggerPath,
        debugConfig.stopAtEntry,
        debugConfig.symbolSearchPath
      )
    );

    return debugConfig;
  }

  async validateLaunchConfiguration(op: make.Operations): Promise<string> {
    // Cannot debug the project if it is currently building or (pre-)configuring.
    if (make.blockedByOp(op)) {
      return LaunchStatuses.blocked;
    }

    if (configuration.getBuildBeforeLaunch()) {
      let currentBuildTarget: string = configuration.getCurrentTarget() || "";
      logger.message(
        localize(
          "building.current.target.before.launch",
          'Building current target before launch: "{0}"',
          currentBuildTarget
        )
      );
      let buildSuccess: boolean =
        (await make.buildTarget(
          make.TriggeredBy.buildTarget,
          currentBuildTarget,
          false
        )) === make.ConfigureBuildReturnCodeTypes.success;
      if (!buildSuccess) {
        logger.message(
          localize(
            "building.target.failed",
            'Building target "{0}" failed.',
            currentBuildTarget
          )
        );
        let noButton: string = localize("no", "No");
        let yesButton: string = localize("yes", "Yes");
        const message: string = localize(
          "build.failed.continue.anyway",
          "Build failed. Do you want to continue anyway?"
        );
        const chosen: vscode.MessageItem | undefined =
          await vscode.window.showErrorMessage<vscode.MessageItem>(
            message,
            {
              title: yesButton,
              isCloseAffordance: false,
            },
            {
              title: noButton,
              isCloseAffordance: true,
            }
          );

        if (chosen === undefined || chosen.title === noButton) {
          return LaunchStatuses.buildFailed;
        }
      }
    }

    let currentLaunchConfiguration:
      | configuration.LaunchConfiguration
      | undefined = configuration.getCurrentLaunchConfiguration();
    if (!currentLaunchConfiguration) {
      // If no launch configuration is set, give the user a chance to select one now from the quick pick
      // (unless we know it's going to be empty).
      if (configuration.getLaunchTargets().length === 0) {
        vscode.window.showErrorMessage(
          localize(
            "cannot.op.no.launch.config.targets",
            "Cannot {0} because there is no launch configuration set and the list of launch targets is empty. Double check the makefile configuration and the build target.",
            op
          )
        );
        return LaunchStatuses.launchTargetsListEmpty;
      } else {
        vscode.window.showErrorMessage(
          localize(
            "cannot.op.choose.launch.config",
            "Cannot {0} because there is no launch configuration set. Choose one from the quick pick.",
            op
          )
        );
        await configuration.selectLaunchConfiguration();

        // Read again the current launch configuration. If a current launch configuration is stil not set
        // (the user cancelled the quick pick or the parser found zero launch targets) message and fail.
        currentLaunchConfiguration =
          configuration.getCurrentLaunchConfiguration();
        if (!currentLaunchConfiguration) {
          vscode.window.showErrorMessage(
            localize(
              "cannot.op.without.launch.config",
              "Cannot {0} until you select an active launch configuration.",
              op
            )
          );
          return LaunchStatuses.noLaunchConfigurationSet;
        }
      }
    }

    return LaunchStatuses.success;
  }

  public async debugCurrentTarget(): Promise<vscode.DebugSession | undefined> {
    let status: string = await this.validateLaunchConfiguration(
      make.Operations.debug
    );
    let currentLaunchConfiguration:
      | configuration.LaunchConfiguration
      | undefined;
    if (status === LaunchStatuses.success) {
      currentLaunchConfiguration =
        configuration.getCurrentLaunchConfiguration();
    }

    if (currentLaunchConfiguration) {
      let debugConfig: vscode.DebugConfiguration =
        this.prepareDebugCurrentTarget(currentLaunchConfiguration);
      let startFolder: vscode.WorkspaceFolder;
      if (vscode.workspace.workspaceFolders) {
        startFolder = vscode.workspace.workspaceFolders[0];
        await vscode.debug.startDebugging(startFolder, debugConfig);
      } else {
        await vscode.debug.startDebugging(undefined, debugConfig);
      }

      if (!vscode.debug.activeDebugSession) {
        status = "failed";
      }
    }

    let telemetryProperties: telemetry.Properties = {
      status: status,
    };
    telemetry.logEvent("debug", telemetryProperties);

    return vscode.debug.activeDebugSession;
  }

  private launchTerminal: vscode.Terminal | undefined;

  // Watch for the user closing our terminal
  private readonly onTerminalClose = vscode.window.onDidCloseTerminal(
    (term) => {
      if (term === this.launchTerminal) {
        this.launchTerminal = undefined;
      }
    }
  );

  // Invoke a VS Code running terminal passing it all the information
  // from the current launch configuration
  public prepareRunCurrentTarget(): string {
    // Add a pair of quotes just in case there is a space in the binary path
    let terminalCommand: string = '"' + this.getLaunchTargetPath() + '" ';
    terminalCommand += this.getLaunchTargetArgs().join(" ");

    // Log the message for high verbosity only because the output channel will become visible over the terminal,
    // even if the terminal show() is called after the logger show().
    logger.message(
      localize(
        "running.command.in.terminal",
        "Running command '{0}' in the terminal from location '{1}'",
        terminalCommand,
        this.getLaunchTargetDirectory()
      ),
      "Debug"
    );
    return terminalCommand;
  }

  public async runCurrentTarget(): Promise<vscode.Terminal> {
    const terminalOptions: vscode.TerminalOptions = {
      name: "Make/Launch",
    };

    // Use cmd.exe on Windows
    if (process.platform === "win32") {
      terminalOptions.shellPath = "C:\\Windows\\System32\\cmd.exe";
    }

    terminalOptions.cwd = this.getLaunchTargetDirectory();
    terminalOptions.env = util.mergeEnvironment(
      process.env as util.EnvironmentVariables
    );

    if (!this.launchTerminal) {
      this.launchTerminal = vscode.window.createTerminal(terminalOptions);
    }

    let status: string = await this.validateLaunchConfiguration(
      make.Operations.run
    );
    let currentLaunchConfiguration:
      | configuration.LaunchConfiguration
      | undefined;
    if (status === LaunchStatuses.success) {
      currentLaunchConfiguration =
        configuration.getCurrentLaunchConfiguration();
      let terminalCommand: string = this.prepareRunCurrentTarget();
      this.launchTerminal.sendText(terminalCommand);

      let telemetryProperties: telemetry.Properties = {
        status: status,
      };
      telemetry.logEvent("run", telemetryProperties);
      this.launchTerminal.show();
    }

    return this.launchTerminal;
  }

  public dispose(): void {
    if (this.launchTerminal) {
      this.launchTerminal.dispose();
    }

    this.onTerminalClose.dispose();
  }
}

export function getLauncher(): Launcher {
  if (launcher === undefined) {
    launcher = new Launcher();
  }

  return launcher;
}
