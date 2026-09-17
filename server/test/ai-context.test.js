const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareChatContext, pendingIncomingCount, isLatestInboxMessage } = require('../services/ai-context.service');

const incoming = (id, body) => ({ id, body, fromMe: false, sender: { pushname: 'Ada' } });
const outgoing = (id, body) => ({ id, body, fromMe: true });

test('preserves chronological history and ends with the actual latest question', () => {
  const history = [incoming('a', 'I dey fine. You?'), outgoing('b', 'thick madam which call?'), incoming('c', 'Who be thick madam? 😂😂')];
  const context = prepareChatContext(history, history[2], 'owner');
  assert.deepEqual(context.map(m => m.text), history.map(m => m.body));
  assert.equal(context.at(-1).text, 'Who be thick madam? 😂😂');
  assert.equal(context.at(-1).role, 'user');
});

test('uses message IDs rather than deduplicating repeated text', () => {
  const history = [incoming('a', 'hello'), outgoing('b', 'hi'), incoming('c', 'hello')];
  const context = prepareChatContext(history, history[2], 'owner');
  assert.equal(context.length, 3);
  assert.equal(context.at(-1).text, 'hello');
});

test('trims later messages from an earlier job', () => {
  const history = [incoming('a', 'first'), outgoing('b', 'done'), incoming('c', 'new question')];
  const context = prepareChatContext(history, history[0], 'owner');
  assert.deepEqual(context.map(m => m.text), ['first']);
});

test('when inbox persistence misses the event, anchors solely to the real event', () => {
  const history = [incoming('a', 'old'), outgoing('b', 'old answer')];
  const context = prepareChatContext(history, incoming('not-yet-saved', 'new question'), 'owner');
  assert.deepEqual(context.map(m => m.text), ['new question']);
});

test('self-chat trigger still becomes a user turn, without altering earlier outgoing roles', () => {
  const history = [outgoing('a', 'my previous message'), outgoing('b', 'test me')];
  const context = prepareChatContext(history, history[1], 'owner');
  assert.deepEqual(context.map(m => m.role), ['assistant', 'user']);
});

test('retains media hints and quoted content', () => {
  const picture = { id: 'p', body: '', type: 'image', hasMedia: true, filename: 'photo.jpg', hasQuotedMsg: true, quotedMsgObj: { body: 'this one?' } };
  const context = prepareChatContext([picture], picture, 'owner');
  assert.match(context[0].text, /this one\?/);
  assert.match(context[0].text, /Attached image: photo\.jpg/);
});

test('counts both pending messages in one batch', () => {
  const history = [outgoing('a', 'Talk later'), incoming('b', 'I dey hungry'), incoming('c', 'Who be thick madam? 😂😂')];
  const context = prepareChatContext(history, history[2], 'owner');
  assert.deepEqual(context.map(m => m.text), ['Talk later', 'I dey hungry', 'Who be thick madam? 😂😂']);
  assert.equal(pendingIncomingCount(context), 2);
});

test('a previous outgoing reply closes the older batch', () => {
  const history = [incoming('a', 'first question'), outgoing('b', 'answered'), incoming('c', 'second question')];
  const context = prepareChatContext(history, history[2], 'owner');
  assert.equal(pendingIncomingCount(context), 1);
});

test('three consecutive incoming messages stay in one pending batch', () => {
  const history = [incoming('a', 'first'), incoming('b', 'second'), incoming('c', 'third')];
  const context = prepareChatContext(history, history[2], 'owner');
  assert.equal(pendingIncomingCount(context), 3);
  assert.deepEqual(context.map(m => m.text), ['first', 'second', 'third']);
});

test('rejects outdated send attempts, including a new owner message', () => {
  assert.equal(isLatestInboxMessage(incoming('new', 'hello'), 'old'), false);
  assert.equal(isLatestInboxMessage(outgoing('owner-replied', 'done'), 'old'), false);
  assert.equal(isLatestInboxMessage(incoming('same', 'hello'), 'same'), true);
});
