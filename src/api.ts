import * as api from "vscode-makefile-tools-api";
import * as vscode from "vscode";
import * as make from "./make";
import { getBuildTargets } from "./configuration";

export class MakefileToolsApiImpl implements api.MakefileToolsApi {
  constructor(public version: api.Version = api.Version.v1) {
  }
  
  build(target?: string, clean?: boolean, cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
    return make.buildTarget(make.TriggeredBy.api, target ?? "", clean ?? false, cancellationToken);
  }
  clean(cancellationToken: vscode.CancellationToken): Promise<api.CommandResult> {
    return make.buildTarget(make.TriggeredBy.api, "clean", false, cancellationToken);
  }
  async listBuildTargets(): Promise<string[] | undefined> {
    return getBuildTargets();
  }
}
