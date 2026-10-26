import assert from 'node:assert/strict';
import test from 'node:test';
import {documentAvailable} from '../dist/document-status.js';

test('unscanned files and retained positive/no-verdict history are available without fabricating a scan result',()=>{
  for(const status of ['unscanned','pending','clean'])assert.equal(documentAvailable(status),true,status);
  for(const status of ['rejected','unknown','','CLEAN','clean\n'])assert.equal(documentAvailable(status),false,status);
});
