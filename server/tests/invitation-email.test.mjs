import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationMessage,invitationMailer} from '../dist/invitation-email.js';
test('invitation email escapes tenant-controlled text, keeps one exact private link and never claims delivery',()=>{
 const message=invitationMessage({to:'test@test.invalid',company:'A <script>alert(1)</script>\r\nB',role:'occupant',acceptanceUrl:'https://app.test/invite?contact=1#private-test-only',expiresAt:new Date('2026-11-01T12:00:00Z')});
 assert.ok(message.text.includes('https://app.test/invite?contact=1#private-test-only'));
 assert.ok(message.text.includes('as an occupant'));assert.ok(message.text.includes('https://app.test/help/invitations'));
 assert.ok(!message.html.includes('<script>'));assert.ok(!/[\r\n]/.test(message.subject));
 assert.equal(invitationMailer({}),undefined);
 assert.throws(()=>invitationMailer({INVITATION_EMAIL_FROM:'invalid\r\nsender',AWS_REGION:'us-east-1'}));
});
