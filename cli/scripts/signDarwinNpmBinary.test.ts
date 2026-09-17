import { describe, expect, it, vi } from 'vitest';
import { isDarwinPlatformPackage, signDarwinNpmBinary } from './signDarwinNpmBinary';

describe('signDarwinNpmBinary', () => {
    it('recognizes darwin platform packages', () => {
        expect(isDarwinPlatformPackage('darwin-arm64')).toBe(true);
        expect(isDarwinPlatformPackage('darwin-x64')).toBe(true);
        expect(isDarwinPlatformPackage('linux-arm64')).toBe(false);
        expect(isDarwinPlatformPackage('win32-x64')).toBe(false);
    });

    it('ad-hoc signs and strictly verifies on macOS', () => {
        const execFileSync = vi.fn();

        signDarwinNpmBinary('/tmp/hapi', {
            hostPlatform: 'darwin',
            execFileSync,
        });

        expect(execFileSync.mock.calls).toEqual([
            ['codesign', ['--force', '--sign', '-', '/tmp/hapi'], { stdio: 'inherit' }],
            ['codesign', ['--verify', '--strict', '/tmp/hapi'], { stdio: 'inherit' }],
        ]);
    });

    it('refuses to publish an unsigned darwin binary from Linux', () => {
        const execFileSync = vi.fn();

        expect(() => signDarwinNpmBinary('/tmp/hapi', {
            hostPlatform: 'linux',
            execFileSync,
        })).toThrow(/must be ad-hoc signed on macOS/);

        expect(execFileSync).not.toHaveBeenCalled();
    });
});
