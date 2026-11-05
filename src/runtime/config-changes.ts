/**
 * Rendering a config `diff` / `apply` result for a terminal.
 *
 * Shared by `config diff` / `config apply` and by `get-started`, which applies the directory it
 * just wrote. One formatter rather than two, so the preview someone sees in the guided flow is
 * byte-for-byte the preview they see once they are running the commands themselves.
 */

const OP_MARK: Record<string, string> = { create: '+', update: '~', delete: '-', noop: ' ' };

export interface ChangeSet {
  changes: Array<Record<string, unknown>>;
  summary: Record<string, number>;
}

/** One line per change, then a tally. `apply` results also carry a per-change status. */
export const formatChanges = (data: ChangeSet): string => {
  const lines = data.changes.map((change) => {
    const mark = OP_MARK[String(change['op'])] ?? '?';
    const status = change['status'] ? ` (${String(change['status'])})` : '';
    const error = change['error'] ? `  ${String(change['error'])}` : '';
    return `  ${mark} ${String(change['configKey'])}${status}${error}`;
  });
  const s = data.summary;
  const tally = [
    `${s['create'] ?? 0} to create`,
    `${s['update'] ?? 0} to update`,
    `${s['delete'] ?? 0} to delete`,
    ...(s['failed'] === undefined ? [] : [`${s['failed']} failed`]),
  ].join(', ');
  return [...lines, '', tally].join('\n');
};

/** How many changes an apply would actually make, which is what a confirmation has to quote. */
export const changeCount = (summary: Record<string, number>): number =>
  (summary['create'] ?? 0) + (summary['update'] ?? 0) + (summary['delete'] ?? 0);
