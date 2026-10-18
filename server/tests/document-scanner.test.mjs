import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocument,MAX_DOCUMENT_BYTES} from '../dist/private-documents.js';
import {documentScanner} from '../dist/document-scanner.js';
import {mkdtemp,writeFile,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
test('document signatures, Unicode/text encoding and exact size bounds are validated',()=>{
 const valid=(name,type,bytes)=>validateDocument(name,type,Buffer.from(bytes).toString('base64'));
 assert.equal(valid('report.txt','text/plain','Fictional résumé').mediaType,'text/plain');
 assert.equal(valid('scan.PDF','application/pdf','%PDF-1.7\nfictional').mediaType,'application/pdf');
 assert.equal(valid('photo.png','image/png',[137,80,78,71,13,10,26,10,1]).mediaType,'image/png');
 assert.equal(valid('photo.jpeg','image/jpeg',[255,216,255,224,1]).mediaType,'image/jpeg');
 for(const [name,type,bytes] of [['x.html','text/plain','html'],['../x.txt','text/plain','x'],['x\n.txt','text/plain','x'],['x.txt','text/plain',[255]],['x.pdf','application/pdf','not pdf'],['x.png','image/png','not png'],['x.txt','text/plain','']])assert.throws(()=>valid(name,type,bytes));
 assert.equal(valid('limit.txt','text/plain',Buffer.alloc(MAX_DOCUMENT_BYTES,65)).bytes.length,MAX_DOCUMENT_BYTES);
 assert.throws(()=>valid('large.txt','text/plain',Buffer.alloc(MAX_DOCUMENT_BYTES+1,65)));
 assert.throws(()=>validateDocument('bad.txt','text/plain','YQ='));
});
test('loopback daemon checks loaded definition age, streams exact bytes, and quarantines invalid replies',async()=>{
 const previous=process.env.DOCUMENT_SCANNER_PORT;
 let version=`ClamAV 1.4.3/12345/${new Date().toUTCString().replace(' GMT','')}`;
 let response='stream: OK\0',received;
 const daemon=createServer(socket=>{
  let input=Buffer.alloc(0);
  socket.on('error',()=>{});
  socket.on('data',data=>{
   input=Buffer.concat([input,data]);
   const end=input.indexOf(0);if(end<0)return;
   const command=input.subarray(0,end).toString();
   if(command==='zVERSION')return socket.end(version+'\0');
   assert.equal(command,'zINSTREAM');
   if(input.length<end+5)return;
   const length=input.readUInt32BE(end+1);
   if(input.length<end+1+4+length+4)return;
   assert.equal(input.readUInt32BE(end+1+4+length),0);
   received=input.subarray(end+5,end+5+length);socket.end(response);
  });
 });
 await new Promise(resolve=>daemon.listen(0,'127.0.0.1',resolve));
 try{
  process.env.DOCUMENT_SCANNER_PORT=String(daemon.address().port);
  const scanner=documentScanner(),content=Buffer.from('private\0original');
  assert.equal(await scanner.available(),true);
  assert.equal(await scanner(content),'clean');assert.deepEqual(received,content);
  response='stream: Eicar-Test-Signature FOUND\0';assert.equal(await scanner(content),'rejected');
  for(const invalid of ['stream: OK\0unexpected','stream: size limit exceeded ERROR\0','OK\0','stream: OK\n']){
   response=invalid;await assert.rejects(scanner(content),e=>e.code==='SCANNER_UNAVAILABLE');
  }
  for(const invalid of ['ClamAV 1.4.3/123/Thu Jan 1 00:00:00 2020','not a version']){
   version=invalid;assert.equal(await scanner.available(),false);await assert.rejects(scanner(content),e=>e.code==='SCANNER_UNAVAILABLE');
  }
  process.env.DOCUMENT_SCANNER_PORT='invalid';assert.equal(await scanner.available(),false);await assert.rejects(scanner(content),e=>e.code==='SCANNER_UNAVAILABLE');
 }finally{
  if(previous===undefined)delete process.env.DOCUMENT_SCANNER_PORT;else process.env.DOCUMENT_SCANNER_PORT=previous;
  await new Promise(resolve=>daemon.close(resolve));
 }
});
test('ClamAV adapter quarantines when unconfigured, unavailable or invalid and removes private temp files',async()=>{
 const previous=process.env.DOCUMENT_SCANNER_BIN,root=await mkdtemp(join(tmpdir(),'pf-scanner-adapter-test-'));
 try{
  delete process.env.DOCUMENT_SCANNER_BIN;assert.equal(await documentScanner().available(),false);await assert.rejects(documentScanner()(Buffer.from('fixture')),e=>e.code==='SCANNER_UNAVAILABLE');
  process.env.DOCUMENT_SCANNER_BIN=join(root,'does-not-exist');await assert.rejects(documentScanner()(Buffer.from('fixture')),e=>e.code==='SCANNER_UNAVAILABLE');
  // A process fixture verifies the CLI protocol, not real malware coverage.
  const binary=join(root,'scanner-fixture'),paths=join(root,'paths');
  await writeFile(binary,`#!/bin/sh\nprintf '%s\\n' "$3" >> '${paths}'\ntest "$1" = '--no-summary' || exit 2\ntest "$2" = '--infected' || exit 2\ncase "$(cat "$3")" in fixture-clean) exit 0;; fixture-infected) exit 1;; *) exit 2;; esac\n`,{mode:0o700});
  process.env.DOCUMENT_SCANNER_BIN=binary;assert.equal(await documentScanner().available(),true);
  assert.equal(await documentScanner()(Buffer.from('fixture-clean')),'clean');
  assert.equal(await documentScanner()(Buffer.from('fixture-infected')),'rejected');
  await assert.rejects(documentScanner()(Buffer.from('fixture-error')),e=>e.code==='SCANNER_UNAVAILABLE');
  for(const path of (await readFile(paths,'utf8')).trim().split('\n'))await assert.rejects(readdir(join(path,'..')),e=>e.code==='ENOENT');
 }finally{if(previous===undefined)delete process.env.DOCUMENT_SCANNER_BIN;else process.env.DOCUMENT_SCANNER_BIN=previous;await rm(root,{recursive:true,force:true});}
});
