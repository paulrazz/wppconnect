'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAiResponse, typingDelayMs, reactionLeadMs, deliverAiReply } = require('../services/ai-response.service');

function mock(output, overrides = {}) {
  const calls = [];
  const whatsapp = {
    sendReaction: async (_key, id, emoji) => { calls.push(['reaction', id, emoji]); return { id: 'reaction' }; },
    startTyping: async () => { calls.push(['start']); },
    stopTyping: async () => { calls.push(['stop']); },
    sendMessage: async (_key, _chat, text, opts) => { calls.push(['text', text, opts]); return { id: 'text-id' }; },
    sendFile: async (_key, _chat, image, filename, caption, opts) => { calls.push(['image', filename, caption, opts]); return { id: 'image-id' }; },
    ...overrides.whatsapp,
  };
  const args = {
    output, apiKey: 'key', chatId: 'chat', triggerId: 'incoming-id', whatsapp,
    canSend: overrides.canSend || (async () => true),
    markSent: async (sent) => calls.push(['marked', sent.id]),
    renderSvg: overrides.renderSvg || (async () => 'data:image/png;base64,AAAA'),
    pause: async (ms) => calls.push(['pause', ms]),
    random: () => 0, reactionLeadSeconds: overrides.lead,
  };
  return { calls, args };
}

const svg = '<svg width="50" height="50"><svg viewBox="0 0 10 10"><circle r="4" /></svg></svg>';
test('understands regular SVG roots with attributes and nested SVG tags', () => {
  assert.deepEqual(parseAiResponse(`See this <quote><react>😂</react>${svg}`).svg, svg);
  assert.equal(parseAiResponse(`See this <quote><react>😂</react>${svg}`).text, 'See this');
  assert.equal(parseAiResponse(`See this <quote><react>😂</react>${svg}`).quote, true);
});
test('removes duplicate reaction tags, preserves prose, rejects non-emoji reactions', () => {
  assert.deepEqual(parseAiResponse('<react>🔥</react> hello <react>👏</react>').reaction, '🔥');
  assert.equal(parseAiResponse('<react>🔥</react> hello <react>👏</react>').text, 'hello');
  assert.equal(parseAiResponse('<react>haha</react> yes').reaction, '');
  assert.equal(parseAiResponse('<react>👩🏽‍💻</react>').reaction, '👩🏽‍💻');
});
test('invalid SVG and malformed control tags never leak into caption', () => {
  const result = parseAiResponse('Caption <svg width="100"><circle/><react>😂</react>');
  assert.equal(result.text, 'Caption');
  assert.equal(result.svg, null);
  assert.equal(result.invalidSvg, true);
});
test('reaction-only never starts typing and respects configured pace externally', async () => {
  const { calls, args } = mock('<react>😂</react>');
  assert.equal(await deliverAiReply(args), true);
  assert.deepEqual(calls, [['reaction','incoming-id','😂']]);
});
test('reaction first, nonzero gap, then typing delay then message', async () => {
  const { calls, args } = mock('<react>❤️</react> I hear you', { lead: 2 });
  assert.equal(await deliverAiReply(args), true);
  assert.deepEqual(calls.map(c => c[0]), ['reaction','pause','start','pause','stop','text','marked']);
  assert.equal(calls[1][1], 2000);
  assert.equal(calls[3][1], 10000);
});
test('quoted text uses latest incoming ID', async () => {
  const { calls, args } = mock('<quote>Answer here');
  await deliverAiReply(args);
  assert.deepEqual(calls.find(c => c[0] === 'text')[2], { quotedMessageId: 'incoming-id' });
});
test('quote plus image forwards quoted ID and caption to sendFile', async () => {
  const { calls, args } = mock(`<quote>Here you go ${svg}`);
  await deliverAiReply(args);
  const image = calls.find(c => c[0] === 'image');
  assert.deepEqual(image, ['image','generated.png','Here you go',{quotedMessageId:'incoming-id'}]);
});
test('reaction plus image sends reaction then gap then image', async () => {
  const { calls, args } = mock(`<react>😂</react> ${svg}`);
  await deliverAiReply(args);
  assert.deepEqual(calls.map(c => c[0]), ['reaction','pause','start','pause','stop','image','marked']);
  assert.equal(calls[1][1],1500);
});
test('reaction failure delivers accompanying text, but reaction-only failure surfaces', async () => {
  const bad = { sendReaction: async () => { throw new Error('reaction unavailable'); } };
  const combined = mock('<react>😅</react> still here', { whatsapp: bad });
  assert.equal(await deliverAiReply(combined.args), true);
  assert.equal(combined.calls.some(c => c[0] === 'text'), true);
  const solo = mock('<react>😅</react>', { whatsapp: bad });
  await assert.rejects(() => deliverAiReply(solo.args), /reaction unavailable/);
});
test('failed image rendering falls back to text without sending an empty message', async () => {
  const withText = mock(`Drawing failed ${svg}`, { renderSvg: async () => null });
  assert.equal(await deliverAiReply(withText.args), true);
  assert.equal(withText.calls.find(c => c[0] === 'text')[1], 'Drawing failed');
  const onlyImage = mock(svg, {renderSvg:async () => null});
  await assert.rejects(() => deliverAiReply(onlyImage.args), /could not be rendered/);
  assert.equal(onlyImage.calls.length, 0);
});
test('superseded while waiting never sends text, and stops typing', async () => {
  let count = 0;
  const { calls,args } = mock('<react>❤️</react> old text', { canSend: async () => ++count < 4 });
  assert.equal(await deliverAiReply(args), true);
  assert.equal(calls.some(c => c[0] === 'text'), false);
  assert.equal(calls[0][0], 'reaction');
});
test('image captions over WhatsApp limit acknowledge the text first, then send the image', async () => {
  const long = 'a'.repeat(1050);
  const { calls,args } = mock(`${long}${svg}`);
  assert.equal(await deliverAiReply(args), true);
  assert.equal(calls.find(c=>c[0]==='image')[2], '');
  assert.equal(calls.find(c=>c[0]==='text')[1], long);
  assert.ok(calls.findIndex(c=>c[0]==='text') < calls.findIndex(c=>c[0]==='image'));
  assert.ok(calls.filter(c=>c[0]==='pause').some(c=>c[1]===1500));
});
test('empty response does not send; malformed reaction-only throws; text length bounded', async () => {
  assert.equal(await deliverAiReply(mock(' ').args), false);
  await assert.rejects(() => deliverAiReply(mock('<react>oops</react>').args), /invalid action/);
  assert.throws(() => parseAiResponse('a'.repeat(4097)), /limit/);
});
test('typing delay ignores SVG source, and lead seconds are clamped', () => {
  assert.equal(typingDelayMs('two words', () => 0),10000);
  assert.equal(reactionLeadMs(0),1000);
  assert.equal(reactionLeadMs(200),10000);
});
test('a partial reaction plus failed message is marked partial, to avoid retry duplication', async () => {
  const {args,calls} = mock('<react>😂</react> this should fail', {
    whatsapp:{sendMessage:async () => {throw new Error('send failure')}}
  });
  await assert.rejects(() => deliverAiReply(args), error => error.message === 'send failure' && error.partialDelivery === true);
  assert.equal(calls.filter(c=>c[0]==='reaction').length,1);
  assert.equal(calls.filter(c=>c[0]==='stop').length,1);
});
test('reply without a reaction must not wait for reaction gap', async () => {
  const {args,calls} = mock('normal response');
  await deliverAiReply(args);
  assert.deepEqual(calls.map(c=>c[0]),['start','pause','stop','text','marked']);
});
test('image rendering failure with a reaction but no accompanying text must not send a partial reaction', async () => {
  const {args,calls} = mock('<react>👍</react>'+svg,{renderSvg:async()=>null});
  await assert.rejects(()=>deliverAiReply(args),/could not be rendered/);
  assert.equal(calls.length,0);
});
test('unconfirmed deliveries do not count as successfully sent', async () => {
  const {args} = mock('hello', {whatsapp:{sendMessage:async()=>({erro:true})}});
  await assert.rejects(()=>deliverAiReply(args),/did not confirm/);
  const {args:reactArgs} = mock('<react>😎</react>', {whatsapp:{sendReaction:async()=>null}});
  await assert.rejects(()=>deliverAiReply(reactArgs),/did not confirm/);
});
test('if a new message arrives after a long quoted answer, do not send the now-stale image', async () => {
  const long = 'a'.repeat(1050);
  let answered = false;
  const {args,calls} = mock(`<quote>${long}${svg}`, {
    whatsapp:{sendMessage:async(_key,_chat,text,opts)=>{answered=true;calls.push(['text',text,opts]);return {id:'sent-text'}}},
    canSend:async()=>!answered,
  });
  assert.equal(await deliverAiReply(args),true);
  assert.equal(calls.filter(c=>c[0]==='text').length,1);
  assert.equal(calls.filter(c=>c[0]==='image').length,0);
  assert.deepEqual(calls.find(c=>c[0]==='text')[2],{quotedMessageId:'incoming-id'});
});
