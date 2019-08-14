import * as vscode from 'vscode';

let ui: UI;

export class UI {
    private configurationButton : vscode.StatusBarItem;
    private targetButton  : vscode.StatusBarItem;
    private buildButton  : vscode.StatusBarItem;

    SetConfiguration(configuration : string) {
        this.configurationButton.text = "Configuration: " + configuration;
    }

    SetTarget(target : string) {
        this.targetButton.text = "Target: " + target;
    }

    constructor() {
        this.configurationButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
        this.configurationButton.command = "make.setConfiguration";
        this.configurationButton.tooltip = "Click to select the workspace make configuration";
        this.configurationButton.show();

        this.targetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);
        this.targetButton.command = "make.setTarget";
        this.targetButton.tooltip = "Click to select the target to be run by make";
        this.targetButton.show();

        this.buildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
        this.buildButton.command = "make.build.current";
        this.buildButton.tooltip = "Click to build the target of the current workspace configuration";
        this.buildButton.text = "Build";
        this.buildButton.show();
    }

    public dispose(): void {
        this.configurationButton.dispose();
        this.targetButton.dispose();
        this.buildButton.dispose();
    }
}

export function getUI(): UI {
    if (ui === undefined) {
        ui = new UI();
    }
    return ui;
}
