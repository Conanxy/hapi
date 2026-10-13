/**
 * Prepare npm packages for publishing.
 *
 * This script:
 * 1. Reads the version from cli/package.json
 * 2. Generates the main npm package (wrapper)
 * 3. Generates package.json for each platform package
 * 4. Copies binaries from dist-exe to npm package directories
 * 5. Adds exact platform optionalDependencies to the generated wrapper package
 *
 * Run after `bun run build:single-exe:all`
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDarwinPlatformPackage, signDarwinNpmBinary } from './signDarwinNpmBinary';
import { assertNoBuildPaths } from './build-executable';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const repoRoot = join(projectRoot, '..');
const NPM_SCOPE = '@youngfine';

// Platform configurations
// Maps npm platform name to build target info
const PLATFORMS = [
    {
        name: 'darwin-arm64',
        os: 'darwin',
        cpu: 'arm64',
        buildTarget: 'bun-darwin-arm64',
        binName: 'hapi'
    },
    {
        name: 'darwin-x64',
        os: 'darwin',
        cpu: 'x64',
        buildTarget: 'bun-darwin-x64',
        binName: 'hapi'
    },
    {
        name: 'linux-arm64',
        os: 'linux',
        cpu: 'arm64',
        buildTarget: 'bun-linux-arm64',
        binName: 'hapi'
    },
    {
        name: 'linux-x64',
        os: 'linux',
        cpu: 'x64',
        buildTarget: 'bun-linux-x64-baseline',
        binName: 'hapi'
    },
    {
        name: 'win32-x64',
        os: 'win32',
        cpu: 'x64',
        buildTarget: 'bun-windows-x64',
        binName: 'hapi.exe'
    }
] as const;

interface MainPackageJson {
    name: string;
    version: string;
    description?: string;
    author?: string | { name: string; email?: string; url?: string };
    license?: string;
    type?: string;
    homepage?: string;
    bugs?: string | { url?: string; email?: string };
    repository?: {
        type: string;
        url: string;
        directory?: string;
    };
    bin?: Record<string, string>;
}

async function readMainPackageJson(): Promise<MainPackageJson> {
    const pkgPath = join(projectRoot, 'package.json');
    const content = await Bun.file(pkgPath).text();
    return JSON.parse(content);
}

function generatePlatformPackageJson(
    platform: typeof PLATFORMS[number],
    mainPkg: MainPackageJson
): object {
    return {
        name: `${NPM_SCOPE}/hapi-${platform.name}`,
        version: mainPkg.version,
        description: `hapi binary for ${platform.os} ${platform.cpu}`,
        os: [platform.os],
        cpu: [platform.cpu],
        bin: {
            hapi: `bin/${platform.binName}`
        },
        files: [`bin/${platform.binName}`],
        license: mainPkg.license ?? 'MIT',
        repository: mainPkg.repository,
        publishConfig: {
            access: 'public'
        }
    };
}

function buildOptionalDependencies(version: string): Record<string, string> {
    const optionalDependencies: Record<string, string> = {};

    for (const platform of PLATFORMS) {
        optionalDependencies[`${NPM_SCOPE}/hapi-${platform.name}`] = version;
    }

    return optionalDependencies;
}

function generateMainPackageJson(
    mainPkg: MainPackageJson,
    optionalDependencies: Record<string, string>
): object {
    return {
        name: mainPkg.name,
        version: mainPkg.version,
        description: mainPkg.description,
        author: mainPkg.author,
        license: mainPkg.license ?? 'MIT',
        type: mainPkg.type,
        homepage: mainPkg.homepage,
        bugs: mainPkg.bugs,
        repository: mainPkg.repository,
        bin: mainPkg.bin ?? { hapi: 'bin/hapi.cjs' },
        files: ['bin/hapi.cjs', 'NOTICE', 'README.md', 'README.zh-CN.md'],
        optionalDependencies,
        publishConfig: {
            access: 'public'
        }
    };
}

function prepareMainPackage(
    mainPkg: MainPackageJson,
    projectRoot: string,
    npmDir: string
): void {
    const mainDir = join(npmDir, 'main');
    const binDir = join(mainDir, 'bin');
    const optionalDependencies = buildOptionalDependencies(mainPkg.version);

    mkdirSync(binDir, { recursive: true });

    const srcBin = join(projectRoot, 'bin', 'hapi.cjs');
    const destBin = join(binDir, 'hapi.cjs');
    copyFileSync(srcBin, destBin);
    chmodSync(destBin, 0o755);

    const srcNotice = join(projectRoot, 'NOTICE');
    const destNotice = join(mainDir, 'NOTICE');
    copyFileSync(srcNotice, destNotice);

    for (const filename of ['README.md', 'README.zh-CN.md']) {
        copyFileSync(join(repoRoot, filename), join(mainDir, filename));
    }

    const pkgJson = generateMainPackageJson(mainPkg, optionalDependencies);
    const pkgJsonPath = join(mainDir, 'package.json');
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 4) + '\n');
    console.log(`Generated: ${pkgJsonPath}`);
}

export async function preparePlatform(
    platform: typeof PLATFORMS[number],
    mainPkg: MainPackageJson,
    distExeDir: string,
    npmDir: string
): Promise<void> {
    const platformDir = join(npmDir, platform.name);
    const binDir = join(platformDir, 'bin');
    const srcBin = join(distExeDir, platform.buildTarget, platform.binName);
    const destBin = join(binDir, platform.binName);

    if (!existsSync(srcBin)) {
        throw new Error(`Binary not found: ${srcBin}. Run 'bun run build:exe:all' first.`);
    }
    // Re-check cached binaries so --skip-build cannot package a leaking artifact.
    assertNoBuildPaths(srcBin, repoRoot);

    // Ensure bin directory exists
    mkdirSync(binDir, { recursive: true });

    // Generate package.json
    const pkgJson = generatePlatformPackageJson(platform, mainPkg);
    const pkgJsonPath = join(platformDir, 'package.json');
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 4) + '\n');
    console.log(`Generated: ${pkgJsonPath}`);

    // Copy binary
    copyFileSync(srcBin, destBin);
    if (platform.os !== 'win32') {
        chmodSync(destBin, 0o755);
    }
    console.log(`Copied: ${srcBin} -> ${destBin}`);

    // Bun 1.4.0 compile artifacts fail macOS 27 code-signing checks until
    // Apple's codesign rewrites the ad-hoc signature. Do this at package-prep
    // time so npm never publishes a binary that dies with SIGKILL.
    if (isDarwinPlatformPackage(platform.name)) {
        signDarwinNpmBinary(destBin);
        console.log(`Signed: ${destBin}`);
    }
}

async function main(): Promise<void> {
    console.log('Preparing npm platform packages...\n');

    const mainPkg = await readMainPackageJson();
    console.log(`Version: ${mainPkg.version}\n`);

    const distExeDir = join(projectRoot, 'dist-exe');
    const npmDir = join(projectRoot, 'npm');

    let hasErrors = false;

    try {
        prepareMainPackage(mainPkg, projectRoot, npmDir);
    } catch (error) {
        console.error('Error preparing main package:', error);
        hasErrors = true;
    }

    for (const platform of PLATFORMS) {
        try {
            await preparePlatform(platform, mainPkg, distExeDir, npmDir);
        } catch (error) {
            console.error(`Error preparing ${platform.name}:`, error);
            hasErrors = true;
        }
    }

    console.log('\nDone!');

    if (hasErrors) {
        process.exit(1);
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
