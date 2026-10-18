import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessError } from './access.js';
export type DocumentScanner = (content: Buffer) => Promise<'clean'|'rejected'>;
// No shell, filenames or command options come from an upload. Output is never logged.
export function documentScanner(): DocumentScanner {
  return async content => {
    const binary = process.env.DOCUMENT_SCANNER_BIN;
    if (!binary) throw new AccessError(503, 'SCANNER_UNAVAILABLE', 'The file is quarantined. Document scanning is not configured; ask your administrator to enable it.');
    const directory = await mkdtemp(join(tmpdir(), 'pf-document-scan-'));
    try {
      const path = join(directory, 'original');
      await writeFile(path, content, { mode: 0o600 });
      try {
        await promisify(execFile)(binary, ['--no-summary', '--infected', path], { timeout: 30000, maxBuffer: 4096 });
        return 'clean';
      } catch (error) {
        if ((error as {code?:unknown}).code === 1) return 'rejected';
        throw new AccessError(503, 'SCANNER_UNAVAILABLE', 'Scanning is unavailable. The original remains quarantined; retry later.');
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
}
