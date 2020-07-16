// Makefile Tools Extension tests without sources and makefiles.
// These tests take advantage of the possibility of parsing
// a previously created dry-run 'make' output log.
// Each tested operation produces logging in the 'Makefile Tools'
// output channel and also in a log file on disk (defined via settings),
// which is compared with a baseline.

// TODO: add a suite of tests operating on real stand-alone makefile repos,
// thus emulating more closely the Makefile Tools end to end usage scenarios.
// For this we need to refactor the make process spawning in the extension,
// so that these tests would produce a deterministic output.

// Thus, this suite is not able to test the entire functionality of the extension
// (anything that is related to a real invocation of the make tool is not yet supported),
// but the remaining scenarios represent an acceptable amount of testing coverage.
// For this suite, even if only parsing is involved, it cannot run any test on any platform
// because of differences in path processing, extension naming, CppTools defaults (sdk, standard),
// debugger settings, etc...
// TODO: figure out a way to test correctly any test on any platform
// (possibly define a property to be considered when querying for process.platform).

// Some of these tests need also some fake binaries being checked in
// (enough to pass an 'if exists' check), to cover the identification of launch binaries
// that are called with arguments in the makefile.
// See comment in parser.ts, parseLineAsTool and parseForLaunchConfiguration.

import * as assert from 'assert';
import * as configuration from '../../configuration';
import * as launch from '../../launch';
import * as make from '../../make';
import * as util from '../../util';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// TODO: refactor initialization and cleanup of each test
suite('Fake dryrun parsing', /*async*/() => {
    // Interesting scenarios with string paths, corner cases in defining includes/defines,
    // complex configurations-targets-files associations.
    // For now, this test needs to run in an environment with VS 2019.
    // The output log varies depending on finding a particular VS toolset or not.
    // We need to test the scenario of providing in the makefile a full path to the compiler,
    // so there is no way around this. Using only compiler name and relying on path is not sufficient.
    // Also, for the cases when a path (relative or full) is given to the compiler in the makefile
    // and the compiler is not found there, the parser will skip over the compiler command
    // (see comment in parser.ts - parseLineAsTool), so again, we need to find the toolset that is referenced in the makefile.
    // TODO: mock various scenarios of VS environments without depending on what is installed.
    // TODO: adapt the makefile on mac/linux/mingw and add new tests in this suite
    // to parse the dry-run logs obtained on those platforms.
    if (process.platform === "win32" && process.env.MSYSTEM === undefined) {
        test('Interesting small makefile - windows', /*async*/() => {
            let extensionLogPath: string | undefined = configuration.getExtensionLog();
            // Cannot compare with a baseline if there is no extension log defined for this test
            // Use makefile.extensionLog in test workspace settings.
            // We could set this here, but would loose all the logging between the first loading
            // of the repro project by the test framework and this entry to the test function,
            // which would complicate the comparison with the baseline.
            assert(extensionLogPath, "Please define an extension log for the test");
            if (!extensionLogPath) {
                return; // no need to run the remaining of the test
            }

            configuration.startListeningToSettingsChanged();

            /*await*/ configuration.prepareConfigurationsQuickPick();
            /*await*/ configuration.setConfigurationByName("InterestingSmallMakefile_windows_configDebug");

            /*await*/ configuration.parseTargetsFromBuildLogOrCache();
            /*await*/ configuration.setTargetByName("execute_Arch3");

            make.prepareBuildCurrentTarget();

            /*await*/ configuration.parseLaunchConfigurationsFromBuildLog();
            /*await*/ configuration.setLaunchConfigurationByName(vscode.workspace.rootPath + ">bin/InterestingSmallMakefile/ARC H3/Debug/main.exe(str3a,str3b,str3c)");

            launch.getLauncher().prepareDebugCurrentTarget();
            launch.getLauncher().prepareRunCurrentTarget();

            // A bit more coverage, "RelSize" and "RelSpeed" are set up
            // to exercise different combinations of pre-created build log and/or make tools.
            /*await*/ configuration.setConfigurationByName("InterestingSmallMakefile_windows_configRelSize");
            /*await*/ configuration.setConfigurationByName("InterestingSmallMakefile_windows_configRelSpeed");

            // Settings reset for the next test run.
            configuration.stopListeningToSettingsChanged();
            let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
            workspaceConfiguration.update("buildConfiguration", undefined);
            workspaceConfiguration.update("buildTarget", undefined);
            workspaceConfiguration.update("launchConfiguration", undefined);

            // Compare the output log with the baseline
            // TODO: incorporate relevant diff snippets into the test log.
            // Until then, print into base and diff files for easier viewing
            // when the test fails.
            let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
            let baselineLogPath: string = path.join(parsedPath.dir, "InterestingSmallMakefile_windows_baseline.out");
            let extensionLogContent: string = util.readFile(extensionLogPath) || "";
            let baselineLogContent: string = util.readFile(baselineLogPath) || "";
            let extensionRootPath: string = path.resolve(__dirname, "../../../../");
            baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
            fs.writeFileSync(path.join(parsedPath.dir, "base.out"), baselineLogContent);
            fs.writeFileSync(path.join(parsedPath.dir, "diff.out"), extensionLogContent);
            assert(extensionLogContent === baselineLogContent, "Extension log differs from baseline.");
        });
    }

    // dry-run logs for https://github.com/rui314/8cc.git
    if (process.platform === "linux" ||
        (process.platform === "win32" && process.env.MSYSTEM !== undefined)) {
        test('8cc - linux - and mingw', /*async*/() => {
            let extensionLogPath: string | undefined = configuration.getExtensionLog();
            // Cannot compare with a baseline if there is no extension log defined for this test
            // Use makefile.extensionLog in test workspace settings.
            // We could set this here, but would loose all the logging between the first loading
            // of the repro project by the test framework and this entry to the test function,
            // which would complicate the comparison with the baseline.
            assert(extensionLogPath, "Please define an extension log for the test");
            if (!extensionLogPath) {
                return; // no need to run the remaining of the test
            }

            configuration.startListeningToSettingsChanged();

            /*await*/ configuration.prepareConfigurationsQuickPick();
            /*await*/ configuration.setConfigurationByName(process.platform === "linux" ? "8cc_linux" : "8cc_mingw");

            /*await*/ configuration.parseTargetsFromBuildLogOrCache();
            /*await*/ configuration.setTargetByName("all");

            make.prepareBuildCurrentTarget();

            /*await*/ configuration.parseLaunchConfigurationsFromBuildLog();
            /*await*/ configuration.setLaunchConfigurationByName(vscode.workspace.rootPath + ">8cc()");

            launch.getLauncher().prepareDebugCurrentTarget();
            launch.getLauncher().prepareRunCurrentTarget();

            // Settings reset for the next test run.
            configuration.stopListeningToSettingsChanged();
            let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
            workspaceConfiguration.update("buildConfiguration", undefined);
            workspaceConfiguration.update("buildTarget", undefined);
            workspaceConfiguration.update("launchConfiguration", undefined);

            // Compare the output log with the baseline
            // TODO: incorporate relevant diff snippets into the test log.
            // Until then, print into base and diff files for easier viewing
            // when the test fails.
            let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
            let baselineLogPath: string = path.join(parsedPath.dir, process.platform === "linux" ? "8cc_linux_baseline.out" : "8cc_mingw_baseline.out");
            let extensionLogContent: string = util.readFile(extensionLogPath) || "";
            let baselineLogContent: string = util.readFile(baselineLogPath) || "";
            let extensionRootPath: string = path.resolve(__dirname, "../../../../");
            baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
            fs.writeFileSync(path.join(parsedPath.dir, "base.out"), baselineLogContent);
            fs.writeFileSync(path.join(parsedPath.dir, "diff.out"), extensionLogContent);
            assert(extensionLogContent === baselineLogContent, "Extension log differs from baseline.");
        });
    }

    // dry-run logs for https://github.com/FidoProject/Fido.git
    if (process.platform === "linux" ||
        (process.platform === "win32" && process.env.MSYSTEM !== undefined)) {
        test('Fido - linux', /*async*/() => {
            let extensionLogPath: string | undefined = configuration.getExtensionLog();
            // Cannot compare with a baseline if there is no extension log defined for this test
            // Use makefile.extensionLog in test workspace settings.
            // We could set this here, but would loose all the logging between the first loading
            // of the repro project by the test framework and this entry to the test function,
            // which would complicate the comparison with the baseline.
            assert(extensionLogPath, "Please define an extension log for the test");
            if (!extensionLogPath) {
                return; // no need to run the remaining of the test
            }

            // When there are more than one test run in a suite,
            // the extension activation is executed only in the beginning.
            // Clear the extension log from the previous test,
            // since the extension clears it only in the beginning of activation.
            fs.unlinkSync(extensionLogPath);

            configuration.startListeningToSettingsChanged();

            // As long as all the 'fake sources/makefile' tests share the same makefile.configurations setting,
            // there is no need in running configuration.prepareConfigurationsQuickPick for each
            ///*await*/ configuration.prepareConfigurationsQuickPick();
            /*await*/ configuration.setConfigurationByName(process.platform === "linux" ? "Fido_linux" : "Fido_mingw");

            /*await*/ configuration.parseTargetsFromBuildLogOrCache();
            /*await*/ configuration.setTargetByName("bin/foo.o");

            make.prepareBuildCurrentTarget();

            /*await*/ configuration.parseLaunchConfigurationsFromBuildLog();
            /*await*/ configuration.setLaunchConfigurationByName(vscode.workspace.rootPath + ">bin/foo.o()");

            launch.getLauncher().prepareDebugCurrentTarget();
            launch.getLauncher().prepareRunCurrentTarget();

            // Settings reset for the next test run.
            configuration.stopListeningToSettingsChanged();
            let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
            workspaceConfiguration.update("buildConfiguration", undefined);
            workspaceConfiguration.update("buildTarget", undefined);
            workspaceConfiguration.update("launchConfiguration", undefined);

            // Compare the output log with the baseline
            // TODO: incorporate relevant diff snippets into the test log.
            // Until then, print into base and diff files for easier viewing
            // when the test fails.
            let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
            let baselineLogPath: string = path.join(parsedPath.dir, process.platform === "linux" ? "Fido_linux_baseline.out" : "Fido_mingw_baseline.out");
            let extensionLogContent: string = util.readFile(extensionLogPath) || "";
            let baselineLogContent: string = util.readFile(baselineLogPath) || "";
            let extensionRootPath: string = path.resolve(__dirname, "../../../../");
            baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
            fs.writeFileSync(path.join(parsedPath.dir, "base.out"), baselineLogContent);
            fs.writeFileSync(path.join(parsedPath.dir, "diff.out"), extensionLogContent);
            assert(extensionLogContent === baselineLogContent, "Extension log differs from baseline.");
        });
    }

    // dry-run logs for https://github.com/jakogut/tinyvm.git
    if (process.platform === "linux" ||
        (process.platform === "win32" && process.env.MSYSTEM !== undefined)) {
        test('tinyvm - linux', /*async*/() => {
            let extensionLogPath: string | undefined = configuration.getExtensionLog();
            // Cannot compare with a baseline if there is no extension log defined for this test
            // Use makefile.extensionLog in test workspace settings.
            // We could set this here, but would loose all the logging between the first loading
            // of the repro project by the test framework and this entry to the test function,
            // which would complicate the comparison with the baseline.
            assert(extensionLogPath, "Please define an extension log for the test");
            if (!extensionLogPath) {
                return; // no need to run the remaining of the test
            }

            // When there are more than one test run in a suite,
            // the extension activation is executed only in the beginning.
            // Clear the extension log from the previous test,
            // since the extension clears it only in the beginning of activation.
            fs.unlinkSync(extensionLogPath);

            configuration.startListeningToSettingsChanged();

            // As long as all the 'fake sources/makefile' tests share the same makefile.configurations setting,
            // there is no need in running configuration.prepareConfigurationsQuickPick for each
            // /*await*/ configuration.prepareConfigurationsQuickPick();
            /*await*/ configuration.setConfigurationByName(process.platform === "linux" ? "tinyvm_linux_pedantic" : "tinyvm_mingw_pedantic");

            /*await*/ configuration.parseTargetsFromBuildLogOrCache();
            /*await*/ configuration.setTargetByName("tvmi");

            make.prepareBuildCurrentTarget();

            /*await*/ configuration.parseLaunchConfigurationsFromBuildLog();
            /*await*/ configuration.setLaunchConfigurationByName(vscode.workspace.rootPath + ">bin/tvmi()");

            launch.getLauncher().prepareDebugCurrentTarget();
            launch.getLauncher().prepareRunCurrentTarget();

            // Settings reset for the next test run.
            configuration.stopListeningToSettingsChanged();
            let workspaceConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("makefile");
            workspaceConfiguration.update("buildConfiguration", undefined);
            workspaceConfiguration.update("buildTarget", undefined);
            workspaceConfiguration.update("launchConfiguration", undefined);

            // Compare the output log with the baseline
            // TODO: incorporate relevant diff snippets into the test log.
            // Until then, print into base and diff files for easier viewing
            // when the test fails.
            let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
            let baselineLogPath: string = path.join(parsedPath.dir, process.platform === "linux" ? "tinyvm_linux_baseline.out" : "tinyvm_mingw_baseline.out");
            let extensionLogContent: string = util.readFile(extensionLogPath) || "";
            let baselineLogContent: string = util.readFile(baselineLogPath) || "";
            let extensionRootPath: string = path.resolve(__dirname, "../../../../");
            baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
            fs.writeFileSync(path.join(parsedPath.dir, "base.out"), baselineLogContent);
            fs.writeFileSync(path.join(parsedPath.dir, "diff.out"), extensionLogContent);
            assert(extensionLogContent === baselineLogContent, "Extension log differs from baseline.");
        });
    }
});
