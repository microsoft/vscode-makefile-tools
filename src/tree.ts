// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Tree.ts

import * as configuration from './configuration';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';

import * as nls from 'vscode-nls';
import { extension } from './extension';
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
        this._name = localize("tree.build.target", "Build target: {0}", `[${targetName}]`);
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

        return localize("tree.launch.target", "Launch target: {0}", `[${shortName}]`);
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
            // enablement in makefile.outline.setLaunchConfiguration is not
            // disabling this TreeItem
            item.command = {
                command: "makefile.outline.setLaunchConfiguration",
                title: "%makefile-tools.command.makefile.setLaunchConfiguration.title%"
            };
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
        this._name = localize("tree.configuration", "Configuration: {0}", `[${configurationName}]`);
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

export class MakefilePathInfoNode extends BaseNode {
   constructor(pathInSettings: string, pathDisplayed: string) {
       super(pathDisplayed);
       this._title = pathDisplayed;
       this._tooltip = pathInSettings;
   }

   _title: string;
   _tooltip: string;

   update(pathInSettings: string, pathDisplayed: string): void {
      this._title = localize("tree.makefile.path.info", "{0}", `${pathDisplayed}`);
      this._tooltip = pathInSettings;
   }

   getChildren(): BaseNode[] {
       return [];
   }

   getTreeItem(): vscode.TreeItem {
       try {
           const item: vscode.TreeItem = new vscode.TreeItem(this._title);
           item.collapsibleState = vscode.TreeItemCollapsibleState.None;
           item.tooltip = this._tooltip;
           item.contextValue = [
               `nodeType=makefilePathInfo`,
           ].join(',');
           return item;
       } catch (e) {
           return new vscode.TreeItem(localize("issue.rendering.item", "{0} (there was an issue rendering this item)", this._title));
       }
   }
}

export class MakePathInfoNode extends BaseNode {
   constructor(pathInSettings: string, pathDisplayed: string) {
      super(pathDisplayed);
      this._title = pathDisplayed;
      this._tooltip = pathInSettings;
   }

   _title: string;
   _tooltip: string;

   update(pathInSettings: string, pathDisplayed: string): void {
      this._title = localize("tree.make.path.info", "{0}", `${pathDisplayed}`);
      this._tooltip = pathInSettings;
   }

   getChildren(): BaseNode[] {
       return [];
   }

   getTreeItem(): vscode.TreeItem {
       try {
           const item: vscode.TreeItem = new vscode.TreeItem(this._title);
           item.collapsibleState = vscode.TreeItemCollapsibleState.None;
           item.tooltip = this._tooltip;
           item.contextValue = [
               `nodeType=makePathInfo`,
           ].join(',');
           return item;
       } catch (e) {
           return new vscode.TreeItem(localize("issue.rendering.item", "{0} (there was an issue rendering this item)", this._title));
       }
   }
}

export class BuildLogPathInfoNode extends BaseNode {
   constructor(pathInSettings: string, pathDisplayed: string) {
      super(pathDisplayed);
      this._title = pathDisplayed;
      this._tooltip = pathInSettings;
   }

   _title: string;
   _tooltip: string;

   update(pathInSettings: string, pathDisplayed: string): void {
      this._title = localize("tree.build.log.path.info", "{0}", `${pathDisplayed}`);
      this._tooltip = pathInSettings;
   }

   getChildren(): BaseNode[] {
       return [];
   }

   getTreeItem(): vscode.TreeItem {
       try {
           const item: vscode.TreeItem = new vscode.TreeItem(this._title);
           item.collapsibleState = vscode.TreeItemCollapsibleState.None;
           item.tooltip = this._tooltip;
           item.contextValue = [
               `nodeType=buildLogPathInfo`,
           ].join(',');
           return item;
       } catch (e) {
           return new vscode.TreeItem(localize("issue.rendering.item", "{0} (there was an issue rendering this item)", this._title));
       }
   }
}

export class ProjectOutlineProvider implements vscode.TreeDataProvider<BaseNode> {
    private readonly _changeEvent = new vscode.EventEmitter<BaseNode | null>();
    private readonly _unsetString = localize("Unset", "Unset");

    constructor() {
        this._currentConfigurationItem = new ConfigurationNode(this._unsetString);
        this._currentBuildTargetItem = new BuildTargetNode(this._unsetString);
        this._currentLaunchTargetItem = new LaunchTargetNode(this._unsetString);
        this._currentMakefilePathInfoItem = new MakefilePathInfoNode(this._unsetString, "");
        this._currentMakePathInfoItem = new MakePathInfoNode(this._unsetString, "");
        this._currentBuildLogPathInfoItem = new BuildLogPathInfoNode(this._unsetString, "");
    }

    private _currentConfigurationItem: ConfigurationNode;
    private _currentBuildTargetItem: BuildTargetNode;
    private _currentLaunchTargetItem: LaunchTargetNode;
    private _currentMakefilePathInfoItem: MakefilePathInfoNode;
    private _currentMakePathInfoItem: MakePathInfoNode;
    private _currentBuildLogPathInfoItem: BuildLogPathInfoNode;

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
        if (configuration.isOptionalFeatureEnabled("debug") || configuration.isOptionalFeatureEnabled("run")) {
            return [this._currentConfigurationItem,
                    this._currentBuildTargetItem,
                    this._currentLaunchTargetItem,
                    this._currentMakefilePathInfoItem,
                    this._currentMakePathInfoItem,
                    this._currentBuildLogPathInfoItem];
        } else {
            return [this._currentConfigurationItem,
                    this._currentBuildTargetItem,
                    this._currentMakefilePathInfoItem,
                    this._currentMakePathInfoItem,
                    this._currentBuildLogPathInfoItem];
        }
     }

    pathDisplayed(pathInSettings: string | undefined, kind: string, searchInPath: boolean, makeRelative: boolean): string {
       if (!pathInSettings) {
         if (kind === "Build Log") {
            extension.updateBuildLogPresent(false);
         } else if (kind === "Makefile") {
            extension.updateMakefileFilePresent(false);
         }
         return `${kind}: [Unset]`;
       }
       
       const pathInSettingsToTest: string | undefined = process.platform === "win32" && !pathInSettings?.endsWith(".exe") && kind === "Make" ? pathInSettings?.concat(".exe") : pathInSettings;
       const pathBase: string | undefined = (searchInPath && path.parse(pathInSettingsToTest).dir === "") ? path.parse(pathInSettingsToTest).base : undefined;
       const pathInEnv: string | undefined = pathBase ? (path.join(util.toolPathInEnv(pathBase) || "", pathBase)) : undefined;
       const finalPath: string = pathInEnv || pathInSettingsToTest;
       const checkFileExists = util.checkFileExistsSync(finalPath);

       if (kind === "Build Log") {
        extension.updateBuildLogPresent(checkFileExists);
       } else if (kind === "Makefile") {
        extension.updateMakefileFilePresent(checkFileExists);
       }

       return (!checkFileExists ? `${kind} (not found)` : `${kind}`) + `: [${makeRelative ? util.makeRelPath(finalPath, util.getWorkspaceRoot()) : finalPath}]`;
    }

    async update(configuration: string | undefined,
                 buildTarget: string | undefined,
                 launchTarget: string | undefined,
                 makefilePathInfo: string | undefined,
                 makePathInfo: string | undefined,
                 buildLogInfo: string | undefined): Promise<void> {
        this._currentConfigurationItem.update(configuration || this._unsetString);
        this._currentBuildTargetItem.update(buildTarget || this._unsetString);
        await this._currentLaunchTargetItem.update(launchTarget || this._unsetString);
        this._currentMakefilePathInfoItem.update(makefilePathInfo || this._unsetString, this.pathDisplayed(makefilePathInfo, "Makefile", false, false));
        this._currentMakePathInfoItem.update(makePathInfo || this._unsetString, this.pathDisplayed(makePathInfo, "Make", true, false));
        this._currentBuildLogPathInfoItem.update(buildLogInfo || this._unsetString, this.pathDisplayed(buildLogInfo, "Build Log", false, false));

        this.updateTree();
    }

    updateConfiguration(configuration: string): void {
        this._currentConfigurationItem.update(configuration);
        this.updateTree();
    }

    updateBuildTarget(buildTarget: string): void {
        this._currentBuildTargetItem.update(buildTarget);
        this.updateTree();
    }

    async updateLaunchTarget(launchTarget: string): Promise<void> {
        await this._currentLaunchTargetItem.update(launchTarget);
        this.updateTree();
    }

    async updateMakefilePathInfo(makefilePathInfo: string | undefined): Promise<void> {
      this._currentMakefilePathInfoItem.update(makefilePathInfo || this._unsetString, this.pathDisplayed(makefilePathInfo, "Makefile", false, true));
      this.updateTree();
    }

    async updateMakePathInfo(makePathInfo: string | undefined): Promise<void> {
      this._currentMakePathInfoItem.update(makePathInfo || this._unsetString, this.pathDisplayed(makePathInfo, "Make", true, false));
      this.updateTree();
    }

    async updateBuildLogPathInfo(buildLogPathInfo: string | undefined): Promise<void> {
      this._currentBuildLogPathInfoItem.update(buildLogPathInfo || this._unsetString, this.pathDisplayed(buildLogPathInfo, "Build Log", false, true));
      this.updateTree();
    }

    updateTree(): void {
        this._changeEvent.fire(null);
    }
}
