// Tree.ts

import * as configuration from './configuration';
import * as util from './util';
import * as vscode from 'vscode';

interface NamedItem {
    name: string;
}

abstract class BaseNode {
    constructor(public readonly id: string) { }
    abstract getTreeItem(): vscode.TreeItem;
    abstract getChildren(): BaseNode[];
}

export class BuildTargetNode extends BaseNode {
    constructor(targetName: string) {
        super(`buildTarget:${targetName}`);
        this._name = targetName;
    }

    _name: string;

    update(targetName: string): void {
        this._name = `Build target: [${targetName}]`;
    }

    getChildren(): BaseNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        try {
            const item: vscode.TreeItem = new vscode.TreeItem(this._name);
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
            item.tooltip = "The makefile target currently selected for build.";
            item.contextValue = [
                `nodeType=buildTarget`,
            ].join(',');
            return item;
        } catch (e) {
            return new vscode.TreeItem(`${this._name} (There was an issue rendering this item.)`);
        }
    }

}

export class LaunchTargetNode extends BaseNode {
    _name: string;
    _toolTip: string;

    // Keep the tree node label as short as possible.
    // The binary path is the most important component of a launch target.
    getShortLaunchTargetName(completeLaunchTargetName: string): string {
        let launchConfiguration: configuration.LaunchConfiguration | undefined = configuration.stringToLaunchConfiguration(completeLaunchTargetName);
        let shortName: string;

        if (!launchConfiguration) {
            shortName = "Unset";
        } else {
            if (vscode.workspace.workspaceFolders) {
                // In a complete launch target string, the binary path is relative to cwd.
                // In here, since we don't show cwd, make it relative to current workspace folder.
                shortName = util.makeRelPath(launchConfiguration.binaryPath, vscode.workspace.workspaceFolders[0].uri.fsPath);
            } else {
                // Just in case, if for some reason we don't have a workspace folder, return full binary path.
                shortName = launchConfiguration.binaryPath;
            }
        }

        return `Launch target: [${shortName}]`;
    }

    constructor(targetName: string) {
        super(`launchTarget:${targetName}`);

        // Show the complete launch target name as tooltip and the short name as label
        this._name = this.getShortLaunchTargetName(targetName);
        this._toolTip = targetName;
    }

    update(targetName: string): void {
        // Show the complete launch target name as tooltip and the short name as label
        this._name = this.getShortLaunchTargetName(targetName);
        this._toolTip = targetName;
    }

    getChildren(): BaseNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        try {
            const item: vscode.TreeItem = new vscode.TreeItem(this._name);
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
            item.tooltip = `The launch target currently selected for debug and run in terminal.\n${this._toolTip}`;
            item.contextValue = [
                `nodeType=launchTarget`,
            ].join(',');
            return item;
        } catch (e) {
            return new vscode.TreeItem(`${this._name} (There was an issue rendering this item.)`);
        }
    }

}

export class ConfigurationNode extends BaseNode {
    constructor(configurationName: string) {
        super(`configuration:${configurationName}`);
        this._name = configurationName;
    }

    _name: string;

    update(configurationName: string): void {
        this._name = `Configuration: [${configurationName}]`;
    }

    getChildren(): BaseNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        try {
            const item: vscode.TreeItem = new vscode.TreeItem(this._name);
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
            item.tooltip = "The makefile configuration currently selected from settings ('makefile.configurations').";
            item.contextValue = [
                `nodeType=configuration`,
            ].join(',');
            return item;
        } catch (e) {
            return new vscode.TreeItem(`${this._name} (There was an issue rendering this item.)`);
        }
    }

}

export class ProjectOutlineProvider implements vscode.TreeDataProvider<BaseNode> {
    private readonly _changeEvent = new vscode.EventEmitter<BaseNode | null>();

    constructor() {
        this._currentConfigurationItem = new ConfigurationNode("Unset");
        this._currentBuildTargetItem = new BuildTargetNode("Unset");
        this._currentLaunchTargetItem = new LaunchTargetNode("Unset");
    }

    private _currentConfigurationItem: ConfigurationNode;
    private _currentBuildTargetItem: BuildTargetNode;
    private _currentLaunchTargetItem: LaunchTargetNode;

    get onDidChangeTreeData(): any {
        return this._changeEvent.event;
    }
    async getTreeItem(node: BaseNode): Promise<vscode.TreeItem> {
        return node.getTreeItem();
    }
    getChildren(node?: BaseNode): BaseNode[] {
        if (node) {
            return node.getChildren();
        }

        return [this._currentConfigurationItem, this._currentBuildTargetItem, this._currentLaunchTargetItem];
    }

    update(configuration: string, buildTarget: string, launchTarget: string): void {
        this._currentConfigurationItem.update(configuration);
        this._currentBuildTargetItem.update(buildTarget);
        this._currentLaunchTargetItem.update(launchTarget);

        this._changeEvent.fire(null);
    }

    updateConfiguration(configuration: string): void {
        this._currentConfigurationItem.update(configuration);
        this._changeEvent.fire(null);
    }

    updateBuildTarget(buildTarget: string): void {
        this._currentBuildTargetItem.update(buildTarget);
        this._changeEvent.fire(null);
    }

    updateLaunchTarget(launchTarget: string): void {
        this._currentLaunchTargetItem.update(launchTarget);
        this._changeEvent.fire(null);
    }
}
