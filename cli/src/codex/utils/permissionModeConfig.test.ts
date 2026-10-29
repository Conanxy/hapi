import { describe, expect, it } from 'vitest';
import { resolveCodexPermissionModeConfig, toSharedCodexPermissionMode } from './permissionModeConfig';

describe('resolveCodexPermissionModeConfig', () => {
    it('uses on-request approvals for default mode', () => {
        expect(resolveCodexPermissionModeConfig('default')).toEqual({
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
            sandboxPolicy: { type: 'workspaceWrite' }
        });
    });
});

describe('toSharedCodexPermissionMode', () => {
    it('maps archived Safe Yolo onto the equivalent native shared mode', () => {
        expect(toSharedCodexPermissionMode('safe-yolo')).toBe('default');
        expect(toSharedCodexPermissionMode('default')).toBe('default');
        expect(toSharedCodexPermissionMode('read-only')).toBe('read-only');
        expect(toSharedCodexPermissionMode('yolo')).toBe('yolo');
        expect(toSharedCodexPermissionMode(undefined)).toBeUndefined();
    });
});
