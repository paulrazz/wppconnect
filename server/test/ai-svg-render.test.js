'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeSvg, renderSvgToDataUrl } = require('../services/ai-svg-render.service');
const svg = '<svg viewBox="0 0 50 50"><defs><linearGradient id="g"><stop offset="1" stop-color="red"/></linearGradient></defs><rect width="50" height="50" fill="url(#g)"/><text x="10" y="10">Hi</text></svg>';

// Runs independently of native sharp installation during the script's quick
// checks; the real native test below runs when sharp is already installed.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVUAAAAASUVORK5CYII=', 'base64');
function mockSharp() {
  const state = { starts: 0, options: null, png: null, timeout: null, dimensions: null };
  const instance = {
    resize(opts) { state.dimensions = opts; return this; },
    flatten(opts) { state.flatten = opts; return this; },
    png(opts) { state.png = opts; return this; },
    timeout(opts) { state.timeout = opts; return this; },
    async toBuffer() { return png; },
  };
  return { state, factory: (bytes, opts) => {
    state.starts++;
    state.options = opts;
    state.input = String(bytes);
    return instance;
  } };
}

test('Sharp converts a static drawing without launching a browser', async () => {
  const { state, factory } = mockSharp();
  const url = await renderSvgToDataUrl(svg, factory);
  assert.ok(url.startsWith('data:image/png;base64,'));
  assert.equal(state.starts, 1);
  assert.equal(state.options.density, 72);
  assert.equal(state.options.limitInputPixels, 4_000_000);
  assert.deepEqual(state.dimensions, { width: 800, height: 800, fit: 'contain', background: '#ffffff' });
  assert.equal(state.timeout.seconds, 10);
  assert.match(state.input, /width="800" height="800"/);
});

test('safe static SVG with nested shapes and local gradients is allowed', () => {
  assert.ok(safeSvg(svg));
  assert.ok(safeSvg('<svg width="320" height="240"><svg width="50%" height="50%"><circle cx="10" cy="10" r="9"/></svg></svg>'));
});

test('rejects scripts, external assets, event handlers, bad XML, entity tricks and pixel bombs before Sharp', async () => {
  const bad = [
    '<svg><script>1</script></svg>',
    '<svg onload="alert(1)"><rect width="20"/></svg>',
    '<svg><image href="https://bad.test/img"/></svg>',
    '<svg><foreignObject><iframe src="file:///etc/passwd"/></foreignObject></svg>',
    '<svg><style>@import url(https://bad.test)</style></svg>',
    '<svg><rect fill="url(https://bad.test/img)"/></svg>',
    '<svg><rect style="fill:red"/></svg>',
    '<!DOCTYPE svg><svg><text>&xxe;</text></svg>',
    '<svg><text>&#x3c;script</text></svg>',
    '<svg width="999999" height="400"><rect width="10"/></svg>',
    '<svg><rect width="10"></svg>',
    '<svg><rect width="10"/></svg><svg></svg>',
    '<svg>'+('a'.repeat(50_000))+'</svg>',
  ];
  const { state, factory } = mockSharp();
  for (const item of bad) assert.equal(await renderSvgToDataUrl(item, factory), null, item.slice(0, 80));
  assert.equal(state.starts, 0);
});

test('failed rendering or an oversized output safely returns null', async () => {
  const fail = () => ({resize(){return this},flatten(){return this},png(){return this},timeout(){return this},toBuffer(){throw new Error('bad SVG')}});
  assert.equal(await renderSvgToDataUrl(svg, fail), null);
  const badPng = () => ({resize(){return this},flatten(){return this},png(){return this},timeout(){return this},async toBuffer(){return Buffer.alloc(6 * 1024 * 1024)}});
  assert.equal(await renderSvgToDataUrl(svg, badPng), null);
});

let sharp;
try { sharp = require('sharp'); } catch (_) { /* npm install happens separately */ }
test('native Sharp produces an 800x800 PNG with transparent areas flattened', { skip: !sharp && 'sharp is not installed' }, async () => {
  const dataUrl = await renderSvgToDataUrl('<svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="red"/></svg>', sharp);
  assert.ok(dataUrl);
  const meta = await sharp(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 800);
  assert.equal(meta.hasAlpha, false);
});
