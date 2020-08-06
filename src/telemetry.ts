// Telemetry.ts

import * as logger from './logger';
import * as util from './util';
import TelemetryReporter from 'vscode-extension-telemetry';

export type Properties = { [key: string]: string };
export type Measures = { [key: string]: number };

interface IPackageInfo {
    name: string;
    version: string;
    aiKey: string;
}

let telemetryReporter: TelemetryReporter | null;

export function activate(): void {
    try {
        // Don't create the telemetry object (which will result in no information being sent)
        // when running Makefile Tools tests.
        if (process.env['MAKEFILE_TOOLS_TESTING'] !== '1') {
            telemetryReporter = createReporter();
        }
    } catch (e) {
        // can't really do much about this
    }
}

export function deactivate(): void {
    if (telemetryReporter) {
        telemetryReporter.dispose();
    }
}

export function logEvent(eventName: string, properties?: Properties, measures?: Measures): void {
    if (telemetryReporter) {
        // Log instead of sending real telemetry, until we stabilize a bit this feature of Makefile Tools extension
        //telemetryReporter.sendTelemetryEvent(eventName, properties, measures);

        logger.message(`Sending telemetry: eventName = ${eventName}`);

        if (properties) {
            logger.message(`properties: ${Object.getOwnPropertyNames(properties).map(k => `${k} = "${properties[k]}"`).concat()}`);
        }

        if (measures) {
            logger.message(`measures: ${Object.getOwnPropertyNames(measures).map(k => `${k} = "${measures[k]}"`).concat()}`);
        }
    }
}

function createReporter(): TelemetryReporter | null {
    const packageInfo: IPackageInfo = getPackageInfo();
    if (packageInfo && packageInfo.aiKey) {
        return new TelemetryReporter(packageInfo.name, packageInfo.version, packageInfo.aiKey);
    }
    return null;
}

function getPackageInfo(): IPackageInfo {
    const packageJSON: util.PackageJSON = util.thisExtensionPackage();
    return {
        name: `${packageJSON.publisher}.${packageJSON.name}`,
        version: packageJSON.version,
        aiKey: "AIF-d9b70cd4-b9f9-4d70-929b-a071c400b217" // ???
    };
}
