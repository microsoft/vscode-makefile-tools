// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

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
// See comment in parser.ts, parseLineAsTool and parseLaunchConfiguration.

import * as assert from 'assert';
import * as configuration from '../../configuration';
import * as launch from '../../launch';
import * as make from '../../make';
import * as util from '../../util';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { extension } from '../../extension';

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
        test('Interesting small makefile - windows', async() => {
            // Settings reset from the previous test run.
            extension.getState().reset(false);

            // We define extension log here as opposed to in the fake repro .vscode/settings.json
            // because the logging produced at the first project load has too few important data to verify and much variations
            // that are not worth to be processed when comparing with a baseline.
            // Example: when running a test after incomplete debugging or after loading the fake repro project independently of the testing framework,
            // which leaves the workspace state not clean, resulting in a different extension output log
            // than without debugging/loading the project before.
            // If we define extension log here instead of .vscode/settings.json, we also have to clean it up
            // because at project load time, there is no makefile log identified and no file is deleted on activation.
            let extensionLogPath: string = path.join(vscode.workspace.rootPath || "./", ".vscode/Makefile.out");
            if (util.checkFileExistsSync(extensionLogPath)) {
                util.deleteFileSync(extensionLogPath);
            }
            configuration.setExtensionLog(extensionLogPath);

            // Run a preconfigure script to include our tests "Program Files" path so that we always find a cl.exe
            // from this extension repository instead of a real VS installation that happens to be in the path.
            configuration.setPreConfigureScript(path.join(vscode.workspace.rootPath || "./", ".vscode/preconfigure.bat"));
            await make.preConfigure(make.TriggeredBy.tests);

            configuration.prepareConfigurationsQuickPick();
            configuration.setConfigurationByName("InterestingSmallMakefile_windows_configDebug");
            const retc: number = await make.configure(make.TriggeredBy.tests, true);

            configuration.setBuildBeforeLaunch(false);
            const launchConfigurations: string[] = ["bin\\InterestingSmallMakefile\\ARC H3\\Debug\\main.exe(str3a,str3b,str3c)",
                                                    "bin\\InterestingSmallMakefile\\arch1\\Debug\\main.exe(str3a,str3b,str3c)",
                                                    "bin\\InterestingSmallMakefile\\arch2\\Debug\\main.exe()"];
            for (const config of launchConfigurations) {
                await configuration.setLaunchConfigurationByName(vscode.workspace.rootPath + ">" + config);
                let status: string = await launch.getLauncher().validateLaunchConfiguration(make.Operations.debug);
                let launchConfiguration: configuration.LaunchConfiguration | undefined;
                if (status === launch.LaunchStatuses.success) {
                    launchConfiguration = configuration.getCurrentLaunchConfiguration();
                }

                if (launchConfiguration) {
                    launch.getLauncher().prepareDebugCurrentTarget(launchConfiguration);
                    launch.getLauncher().prepareRunCurrentTarget();
                }
            }

            // A bit more coverage, "RelSize" and "RelSpeed" are set up
            // to exercise different combinations of pre-created build log and/or make tools.
            // No configure is necessary to be run here, it is enough to look at what happens
            // when changing a configuration.
            configuration.setConfigurationByName("InterestingSmallMakefile_windows_configRelSize");
            configuration.setConfigurationByName("InterestingSmallMakefile_windows_configRelSpeed");

            // InterestingSmallMakefile_windows_configRelSpeed constructs a more interesting build command.
            configuration.setTargetByName("Execute_Arch3");
            make.prepareBuildTarget("Execute_Arch3");

            // Compare the output log with the baseline
            // TODO: incorporate relevant diff snippets into the test log.
            // Until then, print into base and diff files for easier viewing
            // when the test fails.
            let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
            let baselineLogPath: string = path.join(parsedPath.dir, "../InterestingSmallMakefile_windows_baseline.out");
            let extensionLogContent: string = util.readFile(extensionLogPath) || "";
            let baselineLogContent: string = util.readFile(baselineLogPath) || "";
            let extensionRootPath: string = path.resolve(__dirname, "../../../../");
            baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
            // fs.writeFileSync(path.join(parsedPath.dir, "base.out"), baselineLogContent);
            // fs.writeFileSync(path.join(parsedPath.dir, "diff.out"), extensionLogContent);
            assert(extensionLogContent === baselineLogContent, "Extension log differs from baseline.");
        });
    }

    // dry-run logs for https://github.com/rui314/8cc.git
    if (process.platform === "linux" ||
        (process.platform === "win32" && process.env.MSYSTEM !== undefined)) {
        test('8cc - linux - and mingw', async() => {
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

            configuration.prepareConfigurationsQuickPick();
            configuration.setConfigurationByName(process.platform === "linux" ? "8cc_linux" : "8cc_mingw");

            configuration.setTargetByName("all");

            make.prepareBuildTarget("all");

            await configuration.setLaunchConfigurationByName(vscode.workspace.rootPath + ">8cc()");

            let status: string = await launch.getLauncher().validateLaunchConfiguration(make.Operations.debug);
            let launchConfiguration: configuration.LaunchConfiguration | undefined;
            if (status === launch.LaunchStatuses.success) {
                launchConfiguration = configuration.getCurrentLaunchConfiguration();
            }

            if (launchConfiguration) {
                launch.getLauncher().prepareDebugCurrentTarget(launchConfiguration);
                launch.getLauncher().prepareRunCurrentTarget();
            }

            // Settings reset for the next test run.
            extension.getState().reset();

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
        test('Fido - linux', async() => {
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

            // As long as all the 'fake sources/makefile' tests share the same makefile.configurations setting,
            // there is no need in running configuration.prepareConfigurationsQuickPick for each
            configuration.setConfigurationByName(process.platform === "linux" ? "Fido_linux" : "Fido_mingw");

            configuration.setTargetByName("bin/foo.o");

            make.prepareBuildTarget("bin/foo.o");

            await configuration.setLaunchConfigurationByName(vscode.workspace.rootPath + ">bin/foo.o()");

            let status: string = await launch.getLauncher().validateLaunchConfiguration(make.Operations.debug);
            let launchConfiguration: configuration.LaunchConfiguration | undefined;
            if (status === launch.LaunchStatuses.success) {
                launchConfiguration = configuration.getCurrentLaunchConfiguration();
            }

            if (launchConfiguration) {
                launch.getLauncher().prepareDebugCurrentTarget(launchConfiguration);
                launch.getLauncher().prepareRunCurrentTarget();
            }

            // Settings reset for the next test run.
            extension.getState().reset();

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
        test('tinyvm - linux', async() => {
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

            // As long as all the 'fake sources/makefile' tests share the same makefile.configurations setting,
            // there is no need in running configuration.prepareConfigurationsQuickPick for each
            configuration.setConfigurationByName(process.platform === "linux" ? "tinyvm_linux_pedantic" : "tinyvm_mingw_pedantic");

            configuration.setTargetByName("tvmi");

            make.prepareBuildTarget("tvmi");

            await configuration.setLaunchConfigurationByName(vscode.workspace.rootPath + ">bin/tvmi()");

            let status: string = await launch.getLauncher().validateLaunchConfiguration(make.Operations.debug);
            let launchConfiguration: configuration.LaunchConfiguration | undefined;
            if (status === launch.LaunchStatuses.success) {
                launchConfiguration = configuration.getCurrentLaunchConfiguration();
            }

            if (launchConfiguration) {
                launch.getLauncher().prepareDebugCurrentTarget(launchConfiguration);
                launch.getLauncher().prepareRunCurrentTarget();
            }

            // Settings reset for the next test run.
            extension.getState().reset();

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
