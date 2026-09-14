const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress } = require('../services/webhook.service');
const { timingSafeEqual } = require('../lib/http');

test('constant-time key comparison handles matches and unequal lengths', () => {
  assert.equal(timingSafeEqual('correct-secret', 'correct-secret'), true);
  assert.equal(timingSafeEqual('correct-secret', 'wrong-secret'), false);
  assert.equal(timingSafeEqual('a', 'much-longer-value'), false);
});

test('private and reserved webhook targets are rejected', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '172.16.0.1', '192.168.1.2', '169.254.1.1', '::1', 'fd00::1']) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(address), false, address);
});
