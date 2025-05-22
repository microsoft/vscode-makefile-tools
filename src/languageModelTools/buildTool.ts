import * as vscode from "vscode";
import * as make from "../make";

interface IBuildToolOptions {
  target?: string;
}

// TODO: Implement telemetry for num of arguments and prepareInvocation and invoke.
export class BuildTool implements vscode.LanguageModelTool<IBuildToolOptions> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<IBuildToolOptions>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await make.buildTarget(
      make.TriggeredBy.buildAll,
      "all",
      false
    );
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `The build resulted with the following return code: ${result}`
      ),
    ]);
  }

  prepareInvocation?(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildToolOptions>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    const confirmationMessages = {
      title: "Build the project in Makefile Tools",
      message: new vscode.MarkdownString(
        "Build the project in Makefile Tools?"
      ),
    };

    return {
      invocationMessage: "Building the project in Makefile Tools",
      confirmationMessages,
    };
  }
}
