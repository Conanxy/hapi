import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preparePlatform } from './prepare-npm-packages';

describe('npm artifact privacy', () => {
    const directories: string[] = [];
    const platform = {
        name: 'win32-x64',
        os: 'win32',
        cpu: 'x64',
        buildTarget: 'bun-windows-x64',
        binName: 'hapi.exe',
    } as const;

    afterEach(() => {
        directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
    });

    function fixture(content: string) {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-npm-privacy-'));
        directories.push(directory);
        const dist = join(directory, 'dist');
        const npm = join(directory, 'npm');
        mkdirSync(join(dist, platform.buildTarget), { recursive: true });
        writeFileSync(join(dist, platform.buildTarget, platform.binName), content);
        return { dist, npm };
    }

    it('rejects a cached binary containing a home directory before copying or writing package metadata', async () => {
        const { dist, npm } = fixture(JSON.stringify(join(homedir(), 'private-build', 'cli')));

        await expect(preparePlatform(platform, { name: '@youngfine/hapi', version: '0.0.0' }, dist, npm))
            .rejects.toThrow('build-machine');
        expect(existsSync(npm)).toBe(false);
    });

    it('still prepares a clean binary with exact version metadata', async () => {
        const { dist, npm } = fixture('/~BUN/root/hapi');

        await preparePlatform(platform, { name: '@youngfine/hapi', version: '0.0.0' }, dist, npm);

        expect(readFileSync(join(npm, platform.name, 'bin', platform.binName), 'utf8')).toBe('/~BUN/root/hapi');
        expect(JSON.parse(readFileSync(join(npm, platform.name, 'package.json'), 'utf8')))
            .toMatchObject({ name: '@youngfine/hapi-win32-x64', version: '0.0.0' });
    });
});
