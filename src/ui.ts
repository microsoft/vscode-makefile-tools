import * as configuration from './configuration';
import * as path from 'path';
import * as vscode from 'vscode';

let ui: UI;

export class UI {
    private configurationButton : vscode.StatusBarItem;
    private targetButton  : vscode.StatusBarItem;
    private launchConfigurationButton  : vscode.StatusBarItem;
    private buildButton  : vscode.StatusBarItem;
    private debugButton : vscode.StatusBarItem;
    private runButton : vscode.StatusBarItem;

    SetConfiguration(configuration : string) {
        this.configurationButton.text = "Build configuration: " + configuration;
    }

    SetTarget(target : string) {
        this.targetButton.text = "Target to build: " + target;
    }

    SetLaunchConfiguration(launchConfigurationStr: string | undefined) {
        if (launchConfigurationStr) {
            this.launchConfigurationButton.text = "Launch configuration: ";
            this.launchConfigurationButton.text += "[";
            this.launchConfigurationButton.text += launchConfigurationStr;
            this.launchConfigurationButton.text += "]";
        } else {
            this.launchConfigurationButton.text = "No launch configuration set";
        }
    }

    constructor() {
        this.configurationButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 6);
        this.configurationButton.command = "Make.setBuildConfiguration";
        this.configurationButton.tooltip = "Click to select the workspace make configuration";
        this.configurationButton.show();

        this.targetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
        this.targetButton.command = "Make.setBuildTarget";
        this.targetButton.tooltip = "Click to select the target to be run by make";
        this.targetButton.show();

        this.buildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 4);
        this.buildButton.command = "Make.buildTarget";
        this.buildButton.tooltip = "Click to build the selected target";
        this.buildButton.text = "Build";
        this.buildButton.show();

        this.launchConfigurationButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
        this.launchConfigurationButton.command = "Make.setLaunchConfiguration";
        this.launchConfigurationButton.tooltip = "Click to select the make launch configuration (binary, args and current path)";
        this.launchConfigurationButton.show();

        this.debugButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);
        this.debugButton.command = "Make.launchDebug";
        this.debugButton.tooltip = "Click to debug the selected executable";
        this.debugButton.text = "Debug";
        this.debugButton.show();

        this.runButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
        this.runButton.command = "Make.launchRun";
        this.runButton.tooltip = "Click to launch the selected executable";
        this.runButton.text = "Run";
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
