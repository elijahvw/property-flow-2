import { createHash, randomUUID } from 'node:crypto';

// Insert isolated historical records at creation, never rewrite a scan verdict.
export async function historicalDocument(admin, { sourceId, lease = false, status, title = 'Historical original', content = 'Fictional historical document' }) {
  const documentId = randomUUID(), versionId = randomUUID(), bytes = Buffer.from(content);
  await admin.query('INSERT INTO "PrivateDocument" (id,"companyId","leaseId","requestId",title) VALUES($1,\'a\',$2,$3,$4)',
    [documentId, lease ? sourceId : null, lease ? null : sourceId, title]);
  await admin.query('INSERT INTO "DocumentVersion" (id,"companyId","documentId",number,filename,"mediaType","byteLength",sha256,content,"createdById","submissionKey","submissionHash","scanStatus","scannedAt") VALUES($1,\'a\',$2,1,\'historical.txt\',\'text/plain\',$3,$4,$5,\'manager\',$1,\'isolated-historical-fixture\',$6,$7)',
    [versionId, documentId, bytes.length, createHash('sha256').update(bytes).digest('hex'), bytes, status, ['clean', 'rejected'].includes(status) ? new Date() : null]);
  return { documentId, versionId };
}
