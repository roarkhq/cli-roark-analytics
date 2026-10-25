import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findDefaultConfigModule, isConfigModulePath, loadConfigModule } from './config-module';
import { UsageError } from './errors';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'roark-cfgmod-'));

const writeModule = (dir: string, name: string, body: string): string => {
  const abs = join(dir, name);
  writeFileSync(abs, body);
  return abs;
};

describe('isConfigModulePath', () => {
  it('recognizes TS/JS entrypoints and rejects directories/yaml', () => {
    expect(isConfigModulePath('roark.config.ts')).toBe(true);
    expect(isConfigModulePath('./deploy.mjs')).toBe(true);
    expect(isConfigModulePath('./roark')).toBe(false);
    expect(isConfigModulePath('agents/frontdesk.yaml')).toBe(false);
  });
});

describe('loadConfigModule', () => {
  it('reads a defineConfig-style default export (bundle object)', async () => {
    const dir = scratch();
    const file = writeModule(
      dir,
      'roark.config.ts',
      `export default { resources: [{ kind: 'agent', name: 'frontdesk' }], prune: true }\n`,
    );
    const bundle = await loadConfigModule(file);
    expect(bundle.resources).toEqual([{ kind: 'agent', name: 'frontdesk' }]);
    expect(bundle.prune).toBe(true);
  });

  it('accepts a bare array of resources', async () => {
    const dir = scratch();
    const file = writeModule(dir, 'roark.config.ts', `export default [{ kind: 'tool', name: 'book' }]\n`);
    const bundle = await loadConfigModule(file);
    expect(bundle.resources).toEqual([{ kind: 'tool', name: 'book' }]);
    expect(bundle.prune).toBeUndefined();
  });

  it('calls a function (sync or async) that returns a bundle', async () => {
    const dir = scratch();
    const file = writeModule(
      dir,
      'roark.config.ts',
      `export default async () => ({ resources: [{ kind: 'persona', name: 'dana' }] })\n`,
    );
    const bundle = await loadConfigModule(file);
    expect(bundle.resources).toEqual([{ kind: 'persona', name: 'dana' }]);
  });

  it('lets --no-prune override a prune set in the module', async () => {
    const dir = scratch();
    const file = writeModule(dir, 'roark.config.ts', `export default { resources: [], prune: true }\n`);
    const bundle = await loadConfigModule(file, { prune: false });
    expect(bundle.prune).toBe(false);
  });

  it('rejects a module that does not export a bundle', async () => {
    const dir = scratch();
    const file = writeModule(dir, 'roark.config.ts', `export default 42\n`);
    await expect(loadConfigModule(file)).rejects.toThrow(UsageError);
  });

  it('rejects a module that fails to evaluate', async () => {
    const dir = scratch();
    const file = writeModule(dir, 'roark.config.ts', `throw new Error('boom')\n`);
    await expect(loadConfigModule(file)).rejects.toThrow(UsageError);
  });
});

describe('findDefaultConfigModule', () => {
  it('finds roark.config.ts in the directory, or returns undefined', () => {
    const dir = scratch();
    expect(findDefaultConfigModule(dir)).toBeUndefined();
    writeModule(dir, 'roark.config.ts', `export default { resources: [] }\n`);
    expect(findDefaultConfigModule(dir)).toBe(join(dir, 'roark.config.ts'));
  });
});
