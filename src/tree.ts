// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Tree.ts

import * as configuration from './configuration';
import * as util from './util';
import * as vscode from 'vscode';

import * as nls from 'vscode-nls';
nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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
        this._name = localize("tree.build.target", "Build target: [{0}]", targetName);
    }

    getChildren(): BaseNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        try {
            const item: vscode.TreeItem = new vscode.TreeItem(this._name);
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
            item.tooltip = localize("makefile.target.currently.selected.for.build", "The makefile target currently selected for build.");
            item.contextValue = [
                `nodeType=buildTarget`,
            ].join(',');
            return item;
        } catch (e) {
            return new vscode.TreeItem(localize("issue.rendering.item", "{0} (there was an issue rendering this item)", this._name));
        }
    }

}

export class LaunchTargetNode extends BaseNode {
    _name: string;
    _toolTip: string;

    // Keep the tree node label as short as possible.
    // The binary path is the most important component of a launch target.
    async getShortLaunchTargetName(completeLaunchTargetName: string): Promise<string> {
        let launchConfiguration: configuration.LaunchConfiguration | undefined = await configuration.stringToLaunchConfiguration(completeLaunchTargetName);
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

        return localize("tree.launch.target", "Launch target: [{0}]", shortName);
    }

    constructor(targetName: string) {
        super(`launchTarget:${targetName}`);

        // Show the complete launch target name as tooltip and the short name as label
        this._name = targetName;
        this._toolTip = targetName;
    }

    async update(targetName: string): Promise<void> {
        // Show the complete launch target name as tooltip and the short name as label
        this._name = await this.getShortLaunchTargetName(targetName);
        this._toolTip = targetName;
    }

    getChildren(): BaseNode[] {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        try {
            const item: vscode.TreeItem = new vscode.TreeItem(this._name);
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
            item.tooltip = localize("launch.target.currently.selected.for.debug.run.in.terminal",
                                    "The launch target currently selected for debug and run in terminal.\n{0}", this._toolTip);
            item.contextValue = [
                `nodeType=launchTarget`,
            ].join(',');
            return item;
        } catch (e) {
            return new vscode.TreeItem(localize("issue.rendering.item", "{0} (there was an issue rendering this item)", this._name));
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
        this._name = localize("tree.configuration", "Configuration: [{0}]", configurationName);
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
            return new vscode.TreeItem(localize("issue.rendering.item", "{0} (there was an issue rendering this item)", this._name));
        }
    }

}

export class ProjectOutlineProvider implements vscode.TreeDataProvider<BaseNode> {
    private readonly _changeEvent = new vscode.EventEmitter<BaseNode | null>();

    constructor() {
        const unsetString: string = localize("Unset", "Unset");
        this._currentConfigurationItem = new ConfigurationNode(unsetString);
        this._currentBuildTargetItem = new BuildTargetNode(unsetString);
        this._currentLaunchTargetItem = new LaunchTargetNode(unsetString);
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

    async update(configuration: string, buildTarget: string, launchTarget: string): Promise<void> {
        this._currentConfigurationItem.update(configuration);
        this._currentBuildTargetItem.update(buildTarget);
        await this._currentLaunchTargetItem.update(launchTarget);

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

    async updateLaunchTarget(launchTarget: string): Promise<void> {
        await this._currentLaunchTargetItem.update(launchTarget);
        this._changeEvent.fire(null);
    }
}
