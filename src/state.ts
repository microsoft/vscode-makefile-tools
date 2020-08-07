
// state.ts

import * as vscode from 'vscode';

// Class for the management of all the workspace state variables
export class StateManager {
  constructor(readonly extensionContext: vscode.ExtensionContext) {}

  private _get<T>(key: string): T | undefined {
    return this.extensionContext.globalState.get<T>(key);
  }

  private _update(key: string, value: any): Thenable<void> {
    return this.extensionContext.globalState.update(key, value);
  }

  // The project build configuration (one of the entries in the array of makefile.configurations
  // or a default).
  get buildConfiguration(): string | undefined {
    return this._get<string>('buildConfiguration');
  }
  set buildConfiguration(v: string | undefined) {
    this._update('buildConfiguration', v);
  }

  // The project build target (one of the targets defined in the makefile).
  get buildTarget(): string | undefined {
    return this._get<string>('buildTarget');
  }
  set buildTarget(v: string | undefined) {
    this._update('buildTarget', v);
  }

  // The project launch configuration (one of the entries in the array of makefile.launchConfigurations).
  get launchConfiguration(): string | undefined {
    return this._get<string>('launchConfiguration');
  }
  set launchConfiguration(v: string | undefined) {
    this._update('launchConfiguration', v);
  }

  // Whether this project had any configure attempt before
  // (it didn't have to succeed or even complete).
  // Sent as telemetry information and useful to know
  // how many projects are able to configure out of the box.
  get ranConfigureBefore(): boolean | undefined {
    return this._get<boolean>('ranConfigureBefore');
  }
  set ranConfigureBefore(v: boolean | undefined) {
    this._update('ranConfigureBefore', v);
  }

  // Reset all the variables saved in the workspace state.
  reset(): void {
    this.buildConfiguration = undefined;
    this.buildTarget = undefined;
    this.launchConfiguration = undefined;
    this.ranConfigureBefore = false;

    vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}
