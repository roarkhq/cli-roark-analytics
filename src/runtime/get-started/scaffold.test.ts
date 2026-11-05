import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeScaffold } from './scaffold';

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'roark-scaffold-'));

describe('writeScaffold', () => {
  it('creates nested directories and reports what it wrote', async () => {
    const dir = await tempDir();

    const result = await writeScaffold(dir, [
      { path: 'agents/frontdesk.yaml', contents: 'kind: agent\n' },
      { path: 'personas/caller.yaml', contents: 'kind: persona\n' },
    ]);

    expect(result.written).toEqual([join(dir, 'agents/frontdesk.yaml'), join(dir, 'personas/caller.yaml')]);
    expect(result.skipped).toEqual([]);
    expect(await readFile(join(dir, 'agents/frontdesk.yaml'), 'utf8')).toBe('kind: agent\n');
  });

  it('never overwrites a file someone has edited', async () => {
    // The whole reason the command is safe to re-run: a second pass fills the gaps and leaves
    // every existing file exactly as it is.
    const dir = await tempDir();
    await mkdir(join(dir, 'agents'), { recursive: true });
    await writeFile(join(dir, 'agents/frontdesk.yaml'), 'kind: agent # hand edited\n');

    const result = await writeScaffold(dir, [
      { path: 'agents/frontdesk.yaml', contents: 'kind: agent # generated\n' },
      { path: 'flows/first.yaml', contents: 'kind: flow\n' },
    ]);

    expect(result.skipped).toEqual([join(dir, 'agents/frontdesk.yaml')]);
    expect(result.written).toEqual([join(dir, 'flows/first.yaml')]);
    expect(await readFile(join(dir, 'agents/frontdesk.yaml'), 'utf8')).toBe('kind: agent # hand edited\n');
  });

  it('writes nothing for an empty file list', async () => {
    const dir = await tempDir();
    await expect(writeScaffold(dir, [])).resolves.toEqual({ written: [], skipped: [] });
  });
});
