import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoBuildPaths, executableBuildArguments } from './build-executable';

describe('executable build privacy', () => {
    const directories: string[] = [];

    afterEach(() => {
        directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
    });

    function temporaryDirectory(): string {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-private-build-'));
        directories.push(directory);
        return directory;
    }

    it.each([
        'bun-darwin-arm64',
        'bun-darwin-x64',
        'bun-linux-arm64',
        'bun-linux-x64-baseline',
        'bun-windows-x64',
    ])('does not embed ESM/CommonJS build paths or private environment values (%s)', target => {
        const directory = temporaryDirectory();
        mkdirSync(join(directory, 'src', 'dependency'), { recursive: true });
        writeFileSync(join(directory, 'src', 'bootstrap.ts'), [
            "import dependency from './dependency/index.cjs';",
            'console.log(__dirname, __filename, import.meta.dir, import.meta.path, dependency, process.env.HAPI_BUILD_PRIVATE_SENTINEL);',
        ].join('\n'));
        writeFileSync(join(directory, 'src', 'dependency', 'index.cjs'),
            'module.exports = { directory: __dirname, filename: __filename };');
        const outfile = join(directory, target.includes('windows') ? 'probe.exe' : 'probe');
        const sentinel = 'hapi-private-environment-must-not-be-bundled';

        execFileSync('bun', executableBuildArguments(directory, target, outfile), {
            cwd: directory,
            stdio: 'pipe',
            timeout: 60_000,
            env: { ...process.env, HAPI_BUILD_PRIVATE_SENTINEL: sentinel },
        });

        const binary = readFileSync(outfile);
        expect(binary.includes(Buffer.from(directory))).toBe(false);
        expect(binary.includes(Buffer.from(directory, 'utf16le'))).toBe(false);
        expect(binary.includes(Buffer.from(sentinel))).toBe(false);
        expect(() => assertNoBuildPaths(outfile, directory)).not.toThrow();
    }, 60_000);

    it.each(['utf8', 'utf16le'] as const)('rejects workspace paths encoded as %s', encoding => {
        const directory = temporaryDirectory();
        const outfile = join(directory, 'probe');
        writeFileSync(outfile, Buffer.from(`prefix ${directory}/src/index.ts suffix`, encoding));

        expect(() => assertNoBuildPaths(outfile, directory)).toThrow('build-machine');
    });

    it.each([
        'C:\\Users\\private-builder',
        'C:/Users/private-builder',
        'C:\\\\Users\\\\private-builder',
        '/home/private%20builder',
    ])('rejects raw, normalized, escaped and URL-encoded home paths (%s)', value => {
        const directory = temporaryDirectory();
        const outfile = join(directory, 'probe');
        writeFileSync(outfile, value);
        const home = value.startsWith('C:') ? 'C:\\Users\\private-builder' : '/home/private builder';

        expect(() => assertNoBuildPaths(outfile, directory, home)).toThrow('build-machine');
    });

    it('permits virtual module paths and runtime environment lookups', () => {
        const directory = temporaryDirectory();
        const outfile = join(directory, 'probe');
        writeFileSync(outfile, '/$bunfs/root/hapi process.env.CLI_API_TOKEN');

        expect(() => assertNoBuildPaths(outfile, directory)).not.toThrow();
        expect(() => assertNoBuildPaths(outfile, directory, '/root')).not.toThrow();
    });

    it.each(['/root/.hapi', 'file:///root/.hapi'])('rejects actual root home paths (%s)', value => {
        const directory = temporaryDirectory();
        const outfile = join(directory, 'probe');
        writeFileSync(outfile, value);

        expect(() => assertNoBuildPaths(outfile, directory, '/root')).toThrow('build-machine');
    });
});
