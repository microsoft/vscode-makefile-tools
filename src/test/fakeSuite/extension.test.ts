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

import * as configuration from '../../configuration';
import { expect } from 'chai';
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
   let systemPlatform: string;
   if (process.platform === "win32") {
      systemPlatform = (process.env.MSYSTEM === undefined) ? "win32" : process.env.MSYSTEM;
   } else {
      systemPlatform = process.platform;
   }

   test(`Complex scenarios with quotes and escaped quotes - ${systemPlatform}`, async () => {
      // Settings reset from the previous test run.
      extension.getState().reset(false);
      await vscode.workspace.getConfiguration("makefile").update("launchConfigurations", undefined);
      configuration.setCurrentLaunchConfiguration(undefined);
      configuration.setCurrentMakefileConfiguration("Default");
      configuration.initFromState();
      await configuration.initFromSettings();

      // We define extension log here as opposed to in the fake repro .vscode/settings.json
      // because the logging produced at the first project load has too few important data to verify and much variations
      // that are not worth to be processed when comparing with a baseline.
      // Example: when running a test after incomplete debugging or after loading the fake repro project independently of the testing framework,
      // which leaves the workspace state not clean, resulting in a different extension output log
      // than without debugging/loading the project before.
      // If we define extension log here instead of .vscode/settings.json, we also have to clean it up
      // because at project load time, there is no makefile log identified and no file is deleted on activation.
      let extensionLogPath: string = configuration.getExtensionLog() || path.join(vscode.workspace.rootPath || "./", ".vscode/Makefile.out");
      if (util.checkFileExistsSync(extensionLogPath)) {
         util.deleteFileSync(extensionLogPath);
      }

      // Run a preconfigure script to include our tests fake compilers path so that we always find gcc/gpp/clang/...etc...
      // from this extension repository instead of a real installation which may vary from system to system.
      configuration.setPreConfigureScript(path.join(vscode.workspace.rootPath || "./", systemPlatform === "win32" ? ".vscode/preconfigure.bat" : ".vscode/preconfigure_nonwin.sh"));
      await make.preConfigure(make.TriggeredBy.tests);

      configuration.prepareConfigurationsQuickPick();
      await configuration.setConfigurationByName("complex_escaped_quotes");

      // No need to setting and building a target, running a launch target, ...etc... like the other tests
      // Compare log output only from a configure to see how we parse the quotes and escape characters in compiler command lines.
      let retc: number = await make.cleanConfigure(make.TriggeredBy.tests, true);

      // Compare the output log with the baseline
      // TODO: incorporate relevant diff snippets into the test log.
      // Until then, print into base and diff files for easier viewing
      // when the test fails.
      let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
      let baselineLogPath: string = path.join(parsedPath.dir, systemPlatform === "win32" ? "../complex_escaped_quotes_baseline.out" : "../complex_escaped_quotes_nonWin_baseline.out");
      let extensionLogContent: string = util.readFile(extensionLogPath) || "";
      extensionLogContent = extensionLogContent.replace(/\r\n/mg, "\n");
      let baselineLogContent: string = util.readFile(baselineLogPath) || "";
      let extensionRootPath: string = path.resolve(__dirname, "../../../../");
      baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
      baselineLogContent = baselineLogContent.replace(/\r\n/mg, "\n");
      // fs.writeFileSync(path.join(parsedPath.dir, "base6.out"), baselineLogContent);
      // fs.writeFileSync(path.join(parsedPath.dir, "diff6.out"), extensionLogContent);

      expect(extensionLogContent).to.be.equal(baselineLogContent);
   });

   if (systemPlatform === "win32") {
      test(`Complex scenarios with quotes and escaped quotes - winOnly`, async () => {
         // Settings reset from the previous test run.
         extension.getState().reset(false);
         await vscode.workspace.getConfiguration("makefile").update("launchConfigurations", undefined);
         configuration.setCurrentLaunchConfiguration(undefined);
         configuration.setCurrentMakefileConfiguration("Default");
         configuration.initFromState();
         await configuration.initFromSettings();
   
         // We define extension log here as opposed to in the fake repro .vscode/settings.json
         // because the logging produced at the first project load has too few important data to verify and much variations
         // that are not worth to be processed when comparing with a baseline.
         // Example: when running a test after incomplete debugging or after loading the fake repro project independently of the testing framework,
         // which leaves the workspace state not clean, resulting in a different extension output log
         // than without debugging/loading the project before.
         // If we define extension log here instead of .vscode/settings.json, we also have to clean it up
         // because at project load time, there is no makefile log identified and no file is deleted on activation.
         let extensionLogPath: string = configuration.getExtensionLog() || path.join(vscode.workspace.rootPath || "./", ".vscode/Makefile.out");
         if (util.checkFileExistsSync(extensionLogPath)) {
            util.deleteFileSync(extensionLogPath);
         }

         // Run a preconfigure script to include our tests fake compilers path so that we always find gcc/gpp/clang/...etc...
         // from this extension repository instead of a real installation which may vary from system to system.
         configuration.setPreConfigureScript(path.join(vscode.workspace.rootPath || "./", ".vscode/preconfigure.bat"));
         await make.preConfigure(make.TriggeredBy.tests);

         configuration.prepareConfigurationsQuickPick();
         await configuration.setConfigurationByName("complex_escaped_quotes_winOnly");

         // No need to setting and building a target, running a launch target, ...etc... like the other tests
         // Compare log output only from a configure to see how we parse the quotes and escape characters in compiler command lines.
         let retc: number = await make.cleanConfigure(make.TriggeredBy.tests, true);

         // Compare the output log with the baseline
         // TODO: incorporate relevant diff snippets into the test log.
         // Until then, print into base and diff files for easier viewing
         // when the test fails.
         let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
         let baselineLogPath: string = path.join(parsedPath.dir, "../complex_escaped_quotes_winOnly_baseline.out");
         let extensionLogContent: string = util.readFile(extensionLogPath) || "";
         extensionLogContent = extensionLogContent.replace(/\r\n/mg, "\n");
         let baselineLogContent: string = util.readFile(baselineLogPath) || "";
         let extensionRootPath: string = path.resolve(__dirname, "../../../../");
         baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
         baselineLogContent = baselineLogContent.replace(/\r\n/mg, "\n");
         // fs.writeFileSync(path.join(parsedPath.dir, "base.out"), baselineLogContent);
         // fs.writeFileSync(path.join(parsedPath.dir, "diff.out"), extensionLogContent);

         expect(extensionLogContent).to.be.equal(baselineLogContent);
      });
   }

   if (systemPlatform === "win32") {
      test('Interesting small makefile - windows', async () => {
         // Settings reset from the previous test run.
         extension.getState().reset(false);
         await vscode.workspace.getConfiguration("makefile").update("launchConfigurations", undefined);
         configuration.setCurrentLaunchConfiguration(undefined);
         configuration.setCurrentMakefileConfiguration("Default");
         configuration.initFromState();
         await configuration.initFromSettings();

         // Extension log is defined in the test .vscode/settings.json but delete it now
         // because we are interested to compare against a baseline from this point further.
         let extensionLogPath: string = configuration.getExtensionLog() || path.join(vscode.workspace.rootPath || "./", ".vscode/Makefile.out");
         if (extensionLogPath && util.checkFileExistsSync(extensionLogPath)) {
            util.deleteFileSync(extensionLogPath);
         }

         // Run a preconfigure script to include our tests "Program Files" path so that we always find a cl.exe
         // from this extension repository instead of a real VS installation that happens to be in the path.
         configuration.setPreConfigureScript(path.join(vscode.workspace.rootPath || "./", ".vscode/preconfigure.bat"));
         await make.preConfigure(make.TriggeredBy.tests);

         configuration.prepareConfigurationsQuickPick();
         await configuration.setConfigurationByName("InterestingSmallMakefile_windows_configDebug");
         const retc: number = await make.cleanConfigure(make.TriggeredBy.tests, true);

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
         await configuration.setConfigurationByName("InterestingSmallMakefile_windows_configRelSize");
         await configuration.setConfigurationByName("InterestingSmallMakefile_windows_configRelSpeed");

         // InterestingSmallMakefile_windows_configRelSpeed constructs a more interesting build command.
         await configuration.setTargetByName("Execute_Arch3");
         make.prepareBuildTarget("Execute_Arch3");

         extension.getState().reset(false);
         await vscode.workspace.getConfiguration("makefile").update("launchConfigurations", undefined);

         // Compare the output log with the baseline
         // TODO: incorporate relevant diff snippets into the test log.
         // Until then, print into base and diff files for easier viewing
         // when the test fails.
         let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
         let baselineLogPath: string = path.join(parsedPath.dir, "../InterestingSmallMakefile_windows_baseline.out");
         let extensionLogContent: string = util.readFile(extensionLogPath) || "";
         extensionLogContent = extensionLogContent.replace(/\r\n/mg, "\n");
         let baselineLogContent: string = util.readFile(baselineLogPath) || "";
         let extensionRootPath: string = path.resolve(__dirname, "../../../../");
         baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
         baselineLogContent = baselineLogContent.replace(/\r\n/mg, "\n");
         // fs.writeFileSync(path.join(parsedPath.dir, "base.out"), baselineLogContent);
         // fs.writeFileSync(path.join(parsedPath.dir, "diff.out"), extensionLogContent);
         expect(extensionLogContent).to.be.equal(baselineLogContent);
      });
   }

   // dry-run logs for https://github.com/rui314/8cc.git
   if (systemPlatform === "linux" || systemPlatform === "mingw") {
      test(`8cc - ${systemPlatform}`, async () => {
         // Settings reset from the previous test run.
         extension.getState().reset(false);
         await vscode.workspace.getConfiguration("makefile").update("launchConfigurations", undefined);
         configuration.setCurrentLaunchConfiguration(undefined);
         configuration.setCurrentMakefileConfiguration("Default");
         configuration.initFromState();
         await configuration.initFromSettings();
   
         // Extension log is defined in the test .vscode/settings.json but delete it now
         // because we are interested to compare against a baseline from this point further.
         let extensionLogPath: string = configuration.getExtensionLog() || path.join(vscode.workspace.rootPath || "./", ".vscode/Makefile.out");
         if (extensionLogPath && util.checkFileExistsSync(extensionLogPath)) {
            util.deleteFileSync(extensionLogPath);
         }

         // Run a preconfigure script to include our tests fake compilers path so that we always find gcc/gpp/clang/...etc...
         // from this extension repository instead of a real installation which may vary from system to system.
         configuration.setPreConfigureScript(path.join(vscode.workspace.rootPath || "./", ".vscode/preconfigure_nonwin.sh"));
         await make.preConfigure(make.TriggeredBy.tests);

         configuration.prepareConfigurationsQuickPick();
         await configuration.setConfigurationByName(process.platform === "linux" ? "8cc_linux" : "8cc_mingw");
         const retc: number = await make.cleanConfigure(make.TriggeredBy.tests, true);

         const launchConfigurations: string[] = ["8cc()"];
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

         await configuration.setTargetByName("all");
         make.prepareBuildTarget("all");

         // Compare the output log with the baseline
         // TODO: incorporate relevant diff snippets into the test log.
         // Until then, print into base and diff files for easier viewing
         // when the test fails.
         let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
         let baselineLogPath: string = path.join(parsedPath.dir, process.platform === "linux" ? "../8cc_linux_baseline.out" : "../8cc_mingw_baseline.out");
         let extensionLogContent: string = util.readFile(extensionLogPath) || "";
         let baselineLogContent: string = util.readFile(baselineLogPath) || "";
         let extensionRootPath: string = path.resolve(__dirname, "../../../../");
         baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
         // fs.writeFileSync(path.join(parsedPath.dir, "base5.out"), baselineLogContent);
         // fs.writeFileSync(path.join(parsedPath.dir, "diff5.out"), extensionLogContent);
         expect(extensionLogContent).to.be.equal(baselineLogContent);
      });
   }

   // dry-run logs for https://github.com/FidoProject/Fido.git
   if (systemPlatform === "linux" || systemPlatform === "mingw") {
      test(`Fido - ${systemPlatform}`, async () => {
         // Settings reset from the previous test run.
         extension.getState().reset(false);
         await vscode.workspace.getConfiguration("makefile").update("launchConfigurations", undefined);
         configuration.setCurrentLaunchConfiguration(undefined);
         configuration.setCurrentMakefileConfiguration("Default");
         configuration.initFromState();
         await configuration.initFromSettings();
   
         // Extension log is defined in the test .vscode/settings.json but delete it now
         // because we are interested to compare against a baseline from this point further.
         let extensionLogPath: string = configuration.getExtensionLog() || path.join(vscode.workspace.rootPath || "./", ".vscode/Makefile.out");
         if (extensionLogPath && util.checkFileExistsSync(extensionLogPath)) {
            util.deleteFileSync(extensionLogPath);
         }

         // Run a preconfigure script to include our tests fake compilers path so that we always find gcc/gpp/clang/...etc...
         // from this extension repository instead of a real installation which may vary from system to system.
         configuration.setPreConfigureScript(path.join(vscode.workspace.rootPath || "./", ".vscode/preconfigure_nonwin.sh"));
         await make.preConfigure(make.TriggeredBy.tests);

         configuration.prepareConfigurationsQuickPick();
         await configuration.setConfigurationByName(process.platform === "linux" ? "Fido_linux" : "Fido_mingw");
         const retc: number = await make.cleanConfigure(make.TriggeredBy.tests, true);

         const launchConfigurations: string[] = ["bin/foo.o()"];
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

         await configuration.setTargetByName("bin/foo.o");
         make.prepareBuildTarget("bin/foo.o");

         // Compare the output log with the baseline
         // TODO: incorporate relevant diff snippets into the test log.
         // Until then, print into base and diff files for easier viewing
         // when the test fails.
         let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
         let baselineLogPath: string = path.join(parsedPath.dir, process.platform === "linux" ? "../Fido_linux_baseline.out" : "../Fido_mingw_baseline.out");
         let extensionLogContent: string = util.readFile(extensionLogPath) || "";
         let baselineLogContent: string = util.readFile(baselineLogPath) || "";
         let extensionRootPath: string = path.resolve(__dirname, "../../../../");
         baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
         // fs.writeFileSync(path.join(parsedPath.dir, "base4.out"), baselineLogContent);
         // fs.writeFileSync(path.join(parsedPath.dir, "diff4.out"), extensionLogContent);
         expect(extensionLogContent).to.be.equal(baselineLogContent);
      });
   }

   // dry-run logs for https://github.com/jakogut/tinyvm.git
   if (systemPlatform === "linux" || systemPlatform === "mingw") {
      test(`tinyvm - ${systemPlatform}`, async () => {
         // Settings reset from the previous test run.
         extension.getState().reset(false);
         await vscode.workspace.getConfiguration("makefile").update("launchConfigurations", undefined);
         configuration.setCurrentLaunchConfiguration(undefined);
         configuration.setCurrentMakefileConfiguration("Default");
         configuration.initFromState();
         await configuration.initFromSettings();
   
         // Extension log is defined in the test .vscode/settings.json but delete it now
         // because we are interested to compare against a baseline from this point further.
         let extensionLogPath: string = configuration.getExtensionLog() || path.join(vscode.workspace.rootPath || "./", ".vscode/Makefile.out");
         if (extensionLogPath && util.checkFileExistsSync(extensionLogPath)) {
            util.deleteFileSync(extensionLogPath);
         }

         // Run a preconfigure script to include our tests fake compilers path so that we always find gcc/gpp/clang/...etc...
         // from this extension repository instead of a real installation which may vary from system to system.
         configuration.setPreConfigureScript(path.join(vscode.workspace.rootPath || "./", ".vscode/preconfigure_nonwin.sh"));
         await make.preConfigure(make.TriggeredBy.tests);

         configuration.prepareConfigurationsQuickPick();
         await configuration.setConfigurationByName(process.platform === "linux" ? "tinyvm_linux_pedantic" : "tinyvm_mingw_pedantic");
         const retc: number = await make.cleanConfigure(make.TriggeredBy.tests, true);

         const launchConfigurations: string[] = ["bin/tvmi()"];
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

         await configuration.setTargetByName("tvmi");
         make.prepareBuildTarget("tvmi");

         // Compare the output log with the baseline
         // TODO: incorporate relevant diff snippets into the test log.
         // Until then, print into base and diff files for easier viewing
         // when the test fails.
         let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
         let baselineLogPath: string = path.join(parsedPath.dir, process.platform === "linux" ? "../tinyvm_linux_baseline.out" : "../tinyvm_mingw_baseline.out");
         let extensionLogContent: string = util.readFile(extensionLogPath) || "";
         let baselineLogContent: string = util.readFile(baselineLogPath) || "";
         let extensionRootPath: string = path.resolve(__dirname, "../../../../");
         baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
         // fs.writeFileSync(path.join(parsedPath.dir, "base3.out"), baselineLogContent);
         // fs.writeFileSync(path.join(parsedPath.dir, "diff3.out"), extensionLogContent);
         expect(extensionLogContent).to.be.equal(baselineLogContent);
      });
   }

   test(`Test real make - ${systemPlatform}`, async () => {
      // Settings reset from the previous test run.
      extension.getState().reset(false);
      await vscode.workspace.getConfiguration("makefile").update("launchConfigurations", undefined);
      configuration.setCurrentLaunchConfiguration(undefined);
      configuration.setCurrentMakefileConfiguration("Default");
      configuration.initFromState();
      await configuration.initFromSettings();

      // Extension log is defined in the test .vscode/settings.json but delete it now
      // because we are interested to compare against a baseline from this point further.
      let extensionLogPath: string = configuration.getExtensionLog() || path.join(vscode.workspace.rootPath || "./", ".vscode/Makefile.out");
      if (extensionLogPath && util.checkFileExistsSync(extensionLogPath)) {
         util.deleteFileSync(extensionLogPath);
      }

      configuration.prepareConfigurationsQuickPick();

      await configuration.setConfigurationByName("test-make-f");
      await make.cleanConfigure(make.TriggeredBy.tests);

      await configuration.setConfigurationByName("test-make-C");
      await make.buildTarget(make.TriggeredBy.tests, "all", true);

      // Compare the output log with the baseline
      // TODO: incorporate relevant diff snippets into the test log.
      // Until then, print into base and diff files for easier viewing
      // when the test fails.
      let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
      let baselineLogPath: string = path.join(parsedPath.dir, process.platform === "win32" ? "../test_real_make_windows_baseline.out" : "../test_real_make_nonWin_baseline.out");
      let extensionLogContent: string = util.readFile(extensionLogPath) || "";
      extensionLogContent = extensionLogContent.replace(/\r\n/mg, "\n");
      let baselineLogContent: string = util.readFile(baselineLogPath) || "";
      let extensionRootPath: string = path.resolve(__dirname, "../../../../");
      baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
      baselineLogContent = baselineLogContent.replace(/\r\n/mg, "\n");
      // fs.writeFileSync(path.join(parsedPath.dir, "base2.out"), baselineLogContent);
      // fs.writeFileSync(path.join(parsedPath.dir, "diff2.out"), extensionLogContent);
      expect(extensionLogContent).to.be.equal(baselineLogContent);
   });

   test(`Variables expansion - ${systemPlatform}`, async () => {
      // Settings reset from the previous test run.
      extension.getState().reset(false);
      await vscode.workspace.getConfiguration("makefile").update("launchConfigurations", undefined);
      configuration.setCurrentLaunchConfiguration(undefined);
      configuration.setCurrentMakefileConfiguration("Default");
      configuration.initFromState();
      await configuration.initFromSettings();

      configuration.prepareConfigurationsQuickPick();
      await configuration.setConfigurationByName("varexp");
      await configuration.setTargetByName("all");

      // Delete extension log a bit later than other tests. For this one, we only care to capture varexp.
      // All else that happens before, it was covered during the other tests in this suite.
      let extensionLogPath: string = configuration.getExtensionLog() || path.join(vscode.workspace.rootPath || "./", ".vscode/Makefile.out");
      if (extensionLogPath && util.checkFileExistsSync(extensionLogPath)) {
         util.deleteFileSync(extensionLogPath);
      }

      await util.getExpandedSettingVal("buildLog", "./${workspaceFolder}/${configuration}/${buildTarget}/something/${configuration}/${buildTarget}/build.log");

      let stopAtEntry: string = await util.expandVariablesInSetting("defaultLaunchConfiguration.stopAtEntry", "${config:makefile.panel.visibility.debug}");
      let tmpDefaultLaunchConfiguration: configuration.DefaultLaunchConfiguration = {
         miDebuggerPath: "./${workspaceRoot}/${command:makefile.getConfiguration}/${command:makefile.getBuildTarget}",
         stopAtEntry: util.booleanify(stopAtEntry)
      };
      await util.getExpandedSettingVal<configuration.DefaultLaunchConfiguration>("defaultLaunchConfiguration", tmpDefaultLaunchConfiguration);

      let tmpConfigurations: configuration.MakefileConfiguration[] = [{
         name: "MyTmpName",
         makePath: "${env:ProgramFiles(x86)}/${workspaceFolderBasename}/make",
         makeArgs: ["${command:makefile.getLaunchTargetPath}",
                    "${SomeUnsupportedVar}",
                    "try_\\${escape_varexp1}_various_\\${escape_varexp2}_escapes",
                    "${command:makefile.inexistentCommand}",
                    "${config:makefile.inexistentSetting}"]}];
      await util.getExpandedSettingVal<configuration.MakefileConfiguration>("configurations", tmpConfigurations);

      // Compare the output log with the baseline
      // TODO: incorporate relevant diff snippets into the test log.
      // Until then, print into base and diff files for easier viewing
      // when the test fails.
      let parsedPath: path.ParsedPath = path.parse(extensionLogPath);
      let baselineLogPath: string = path.join(parsedPath.dir, process.platform === "win32" ? "../varexp_win32_baseline.out" : "../varexp_baseline.out");
      let extensionLogContent: string = util.readFile(extensionLogPath) || "";
      extensionLogContent = extensionLogContent.replace(/\r\n/mg, "\n");
      let baselineLogContent: string = util.readFile(baselineLogPath) || "";
      let extensionRootPath: string = path.resolve(__dirname, "../../../../");
      baselineLogContent = baselineLogContent.replace(/{REPO:VSCODE-MAKEFILE-TOOLS}/mg, extensionRootPath);
      baselineLogContent = baselineLogContent.replace(/\r\n/mg, "\n");
      // fs.writeFileSync(path.join(parsedPath.dir, "base1.out"), baselineLogContent);
      // fs.writeFileSync(path.join(parsedPath.dir, "diff1.out"), extensionLogContent);
      expect(extensionLogContent).to.be.equal(baselineLogContent);
   });

});
