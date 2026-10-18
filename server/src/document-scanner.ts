import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createConnection } from 'node:net';
import { AccessError } from './access.js';
export type DocumentScanner = ((content: Buffer) => Promise<'clean'|'rejected'>) & { available?: () => Promise<boolean> };
const unavailable = () => new AccessError(503, 'SCANNER_UNAVAILABLE', 'Scanning is unavailable. The original remains quarantined; retry later.');

// Fargate containers share loopback. Never send private originals to an external host.
function daemonRequest(port: number, command: string, content?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let reply = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (error) reject(unavailable()); else resolve(reply.subarray(0, -1).toString('utf8'));
    };
    const deadline = setTimeout(() => finish(unavailable()), content ? 30000 : 3000);
    socket.on('error', () => finish(unavailable()));
    socket.on('end', () => finish(reply.length > 1 && reply.indexOf(0) === reply.length - 1 ? undefined : unavailable()));
    socket.on('data', data => {
      reply = Buffer.concat([reply, data]);
      if (reply.length > 4096) return finish(unavailable());
    });
    socket.on('connect', () => {
      socket.write(`z${command}\0`);
      if (content) {
        // Uploads are already bounded to 5 MB; one bounded frame plus the end marker.
        const length = Buffer.alloc(4);
        length.writeUInt32BE(content.length);
        socket.write(length);
        socket.write(content);
        socket.write(Buffer.alloc(4));
      }
    });
  });
}

async function currentDefinitions(port: number) {
  const version = await daemonRequest(port, 'VERSION');
  const match = /^ClamAV [^/]+\/\d+\/(.+)$/.exec(version);
  // The sidecar uses UTC. Refuse clearance when loaded definitions are stale.
  const updated = match ? Date.parse(`${match[1]} UTC`) : NaN;
  const age = Date.now() - updated;
  return Number.isFinite(age) && age >= -3600000 && age <= 72 * 3600000;
}
// No shell, filenames or command options come from an upload. Output is never logged.
export function documentScanner(): DocumentScanner {
  let active = 0;
  const port = () => {
    const value = process.env.DOCUMENT_SCANNER_PORT;
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw unavailable();
    return Number(value);
  };
  const scan: DocumentScanner = async content => {
    const daemon = port();
    if (daemon !== undefined) {
      if (active >= 2 || content.length === 0 || content.length > 5 * 1024 * 1024) throw unavailable();
      active++;
      try {
        if (!await currentDefinitions(daemon)) throw unavailable();
        const verdict = await daemonRequest(daemon, 'INSTREAM', content);
        if (verdict === 'stream: OK') return 'clean';
        if (/^stream: [^\r\n\0]+ FOUND$/.test(verdict)) return 'rejected';
        throw unavailable();
      } finally { active--; }
    }
    const binary = process.env.DOCUMENT_SCANNER_BIN;
    if (!binary || !isAbsolute(binary)) throw new AccessError(503, 'SCANNER_UNAVAILABLE', 'The file is quarantined. Document scanning is not configured; ask your administrator to enable it.');
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
  scan.available = async () => {
    try {
      const daemon = port();
      if (daemon !== undefined) return await currentDefinitions(daemon);
    } catch { return false; }
    const binary = process.env.DOCUMENT_SCANNER_BIN;
    if (!binary || !isAbsolute(binary)) return false;
    try { await access(binary, constants.X_OK); return true; } catch { return false; }
  };
  return scan;
}
