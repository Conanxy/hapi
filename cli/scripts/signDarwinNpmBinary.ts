import { execFileSync } from 'node:child_process';

export type ExecFileSyncFn = (
    file: string,
    args?: readonly string[],
    options?: { stdio?: 'inherit' | 'pipe' | 'ignore' }
) => Buffer | string;

export function isDarwinPlatformPackage(platformName: string): boolean {
    return platformName.startsWith('darwin-');
}

export function signDarwinNpmBinary(
    binPath: string,
    options: {
        hostPlatform?: NodeJS.Platform;
        execFileSync?: ExecFileSyncFn;
    } = {}
): void {
    const hostPlatform = options.hostPlatform ?? process.platform;
    const run = options.execFileSync ?? execFileSync;

    if (hostPlatform !== 'darwin') {
        throw new Error(
            `Darwin npm binaries must be ad-hoc signed on macOS before publish (host: ${hostPlatform}). ` +
            'Re-run `bun run prepare-npm-packages` on a Mac, or move the personal npm workflow to macos-latest.'
        );
    }

    run('codesign', ['--force', '--sign', '-', binPath], { stdio: 'inherit' });
    run('codesign', ['--verify', '--strict', binPath], { stdio: 'inherit' });
}
