import * as api from "vscode-makefile-tools-api";
import * as vscode from "vscode";
import * as make from "./make";
import { getBuildTargets } from "./configuration";
import { logEvent } from "./telemetry";
import { log } from "console";

export class MakefileToolsApiImpl implements api.MakefileToolsApi {
  constructor(public version: api.Version = api.Version.v1) {
  }
  
  build(target?: string, clean?: boolean, cancellationToken?: vscode.CancellationToken): Promise<api.CommandResult> {
    logApiTelemetry("build", this.version);
    return make.buildTarget(make.TriggeredBy.api, target ?? "", clean ?? false, cancellationToken);
  }
  clean(cancellationToken: vscode.CancellationToken): Promise<api.CommandResult> {
    logApiTelemetry("clean", this.version);
    return make.buildTarget(make.TriggeredBy.api, "clean", false, cancellationToken);
  }
  async listBuildTargets(): Promise<string[] | undefined> {
    logApiTelemetry("listBuildTargets", this.version);
    return getBuildTargets();
  }
}

function logApiTelemetry(event: string, version: api.Version): void {
  logEvent("api", {
    event: event,
    version: api.Version.v1.toString(),
  });
}
