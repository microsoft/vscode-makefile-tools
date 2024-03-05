// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// state.ts

import * as vscode from "vscode";

// Class for the management of all the workspace state variables
export class StateManager {
  constructor(readonly extensionContext: vscode.ExtensionContext) {}

  private _get<T>(key: string): T | undefined {
    return this.extensionContext.workspaceState.get<T>(key);
  }

  private _update(key: string, value: any): Thenable<void> {
    return this.extensionContext.workspaceState.update(key, value);
  }

  // The project build configuration (one of the entries in the array of makefile.configurations
  // or a default).
  get buildConfiguration(): string | undefined {
    return this._get<string>("buildConfiguration");
  }
  set buildConfiguration(v: string | undefined) {
    this._update("buildConfiguration", v);
  }

  // The project build target (one of the targets defined in the makefile).
  get buildTarget(): string | undefined {
    return this._get<string>("buildTarget");
  }
  set buildTarget(v: string | undefined) {
    this._update("buildTarget", v);
  }

  // The project launch configuration (one of the entries in the array of makefile.launchConfigurations).
  get launchConfiguration(): string | undefined {
    return this._get<string>("launchConfiguration");
  }
  set launchConfiguration(v: string | undefined) {
    this._update("launchConfiguration", v);
  }

  // Whether this project had any configure attempt before
  // (it didn't have to succeed or even complete).
  // Sent as telemetry information and useful to know
  // how many projects are able to configure out of the box.
  get ranConfigureInCodebaseLifetime(): boolean {
    return this._get<boolean>("ranConfigureInCodebaseLifetime") || false;
  }
  set ranConfigureInCodebaseLifetime(v: boolean) {
    this._update("ranConfigureInCodebaseLifetime", v);
  }

  // Whether this project had any --dry-run specific configure attempt before
  // (it didn't have to succeed or even complete).
  // This is used in order to notify the user via a Yes(don't show again)/No popup
  // that some makefile code could still execute even in --dry-run mode.
  // Once the user decides 'Yes(don't show again)' the popup is not shown.
  get ranDryRunInCodebaseLifetime(): boolean {
    return this._get<boolean>("ranDryRunInCodebaseLifetime") || false;
  }
  set ranDryRunInCodebaseLifetime(v: boolean) {
    this._update("ranDryRunInCodebaseLifetime", v);
  }

  // If the project needs a clean configure as a result
  // of an operation that alters the configure state
  // (makefile configuration change, build target change,
  // settings or makefiles edits)
  get configureDirty(): boolean {
    let dirty: boolean | undefined = this._get<boolean>("configureDirty");
    if (dirty === undefined) {
      dirty = true;
    }

    return dirty;
  }
  set configureDirty(v: boolean) {
    this._update("configureDirty", v);
  }

  // Reset all the variables saved in the workspace state.
  reset(reloadWindow: boolean = true): void {
    this.buildConfiguration = undefined;
    this.buildTarget = undefined;
    this.launchConfiguration = undefined;
    this.ranConfigureInCodebaseLifetime = false;
    this.ranDryRunInCodebaseLifetime = false;
    this.configureDirty = false;

    if (reloadWindow) {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  }
}
