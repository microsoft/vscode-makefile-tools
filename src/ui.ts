// UI support for this extension: buttons and quickpicks.

import * as configuration from './configuration';
import * as vscode from 'vscode';

let ui: UI;

export class UI {
    private configurationButton: vscode.StatusBarItem;
    private targetButton: vscode.StatusBarItem;
    private launchConfigurationButton: vscode.StatusBarItem;
    private buildButton: vscode.StatusBarItem;
    private debugButton: vscode.StatusBarItem;
    private runButton: vscode.StatusBarItem;

    public setConfiguration(configuration: string): void {
        this.configurationButton.text = "$(settings) Build configuration: " + configuration;
    }

    public setTarget(target: string): void {
        this.targetButton.text = "$(tag) Target to build: " + target;
    }

    public setLaunchConfiguration(launchConfigurationStr: string | undefined): void {
        if (launchConfigurationStr) {
            this.launchConfigurationButton.text = "$(rocket) Launch configuration: ";
            this.launchConfigurationButton.text += "[";
            this.launchConfigurationButton.text += launchConfigurationStr;
            this.launchConfigurationButton.text += "]";
        } else {
            this.launchConfigurationButton.text = "No launch configuration set";
        }
    }

    public constructor() {
        this.configurationButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 6);
        this.configurationButton.command = "Makefile.setBuildConfiguration";
        this.configurationButton.tooltip = "Click to select the workspace make configuration";
        this.configurationButton.show();

        this.targetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
        this.targetButton.command = "Makefile.setBuildTarget";
        this.targetButton.tooltip = "Click to select the target to be run by make";
        this.targetButton.show();

        this.buildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 4);
        this.buildButton.command = "Makefile.buildTarget";
        this.buildButton.tooltip = "Click to build the selected target";
        this.buildButton.text = "$(gear) Build";
        this.buildButton.show();

        this.launchConfigurationButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
        this.launchConfigurationButton.command = "Makefile.setLaunchConfiguration";
        this.launchConfigurationButton.tooltip = "Click to select the make launch configuration (binary, args and current path)";
        this.launchConfigurationButton.show();

        this.debugButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);
        this.debugButton.command = "Makefile.launchDebug";
        this.debugButton.tooltip = "Click to debug the selected executable";
        this.debugButton.text = "$(bug) Debug";
        this.debugButton.show();

        this.runButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
        this.runButton.command = "Makefile.launchRun";
        this.runButton.tooltip = "Click to launch the selected executable";
        this.runButton.text = "$(terminal) Run";
        this.runButton.show();
    }

    public dispose(): void {
        this.configurationButton.dispose();
        this.targetButton.dispose();
        this.launchConfigurationButton.dispose();
        this.buildButton.dispose();
        this.debugButton.dispose();
        this.runButton.dispose();
    }
}

export function getUI(): UI {
    if (ui === undefined) {
        ui = new UI();
    }

    return ui;
}
