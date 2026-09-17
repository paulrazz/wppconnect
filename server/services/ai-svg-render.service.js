'use strict';

const MAX_SVG_BYTES = 48 * 1024;
const MAX_TAGS = 500;
const SIZE = 800;
const MAX_PNG_BYTES = 5 * 1024 * 1024;
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'path', 'text', 'tspan', 'title', 'desc', 'lineargradient',
  'radialgradient', 'stop', 'clippath', 'mask', 'pattern'
]);
const ALLOWED_ATTRIBUTES = new Set([
  'xmlns', 'width', 'height', 'viewbox', 'preserveaspectratio',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'transform', 'fill', 'fill-opacity', 'stroke',
  'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'id',
  'gradientunits', 'gradienttransform', 'offset', 'stop-color',
  'stop-opacity', 'clip-path', 'mask', 'font-size', 'font-family',
  'font-weight', 'text-anchor', 'dominant-baseline', 'letter-spacing',
  'word-spacing', 'paint-order', 'shape-rendering'
]);

// Don't feed arbitrary model-controlled XML to libvips/librsvg. SVG is a small
// static drawing language here: no CSS, HTML, network references or entities.
function safeSvg(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const svg = value.trim();
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES ||
      !/^<svg(?:\s|>)/i.test(svg) || !/<\/svg\s*>$/i.test(svg) ||
      /<!|<\?|&#|&(?!(?:amp|lt|gt|quot|apos);)|\b(?:javascript|data|file|https?):|@import/i.test(svg)) return null;

  const tag = /<(\/?)\s*([A-Za-z][\w:-]*)([^<>]*?)>/g;
  const attr = /([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  const stack = [];
  let count = 0;
  let cursor = 0;
  let match;
  let root = null;
  while ((match = tag.exec(svg)) !== null) {
    // A stray opening angle bracket may hide an element from the tokenizer.
    if (svg.slice(cursor, match.index).includes('<')) return null;
    cursor = tag.lastIndex;
    if (++count > MAX_TAGS) return null;
    const name = match[2].toLowerCase();
    if (root && !stack.length) return null; // One document, never adjacent roots.
    if (!ALLOWED_ELEMENTS.has(name)) return null;
    const closing = Boolean(match[1]);
    const selfClosing = !closing && /\/\s*$/.test(match[3]);
    if (closing) {
      if (match[3].trim() || stack.pop() !== name) return null;
      continue;
    }
    if (!root) {
      if (name !== 'svg') return null;
      root = match;
    }
    let rawAttrs = match[3].replace(/\/\s*$/, '');
    const seen = new Set();
    rawAttrs = rawAttrs.replace(attr, (whole, key, quote, val) => {
      const lower = key.toLowerCase();
      if (!ALLOWED_ATTRIBUTES.has(lower) || seen.has(lower) || val.length > 2048 ||
          /[<>]|\b(?:javascript|data|file|https?):|@import/i.test(val)) return '!INVALID!';
      seen.add(lower);
      if (lower === 'xmlns' && (name !== 'svg' || val !== 'http://www.w3.org/2000/svg')) return '!INVALID!';
      if ((lower === 'width' || lower === 'height') &&
          !(/^(?:\d+(?:\.\d+)?)(?:px)?$/.test(val) && Number.parseFloat(val) > 0 && Number.parseFloat(val) <= 2000 ||
            /^(?:\d+(?:\.\d+)?)%$/.test(val) && Number.parseFloat(val) > 0 && Number.parseFloat(val) <= 100)) return '!INVALID!';
      if (lower === 'id' && !/^[A-Za-z_][\w.-]{0,100}$/.test(val)) return '!INVALID!';
      const references = [...val.matchAll(/url\s*\(([^)]*)\)/gi)];
      if (references.some(ref => !/^\s*['"]?#[A-Za-z_][\w.-]{0,100}['"]?\s*$/.test(ref[1]))) return '!INVALID!';
      if (/\burl\s*\(/i.test(val) && !references.length) return '!INVALID!';
      return '';
    });
    // Non-attribute leftovers imply malformed XML or a blocked attribute.
    if (rawAttrs.trim()) return null;
    if (!selfClosing) stack.push(name);
  }
  if (!root || stack.length || svg.slice(cursor).includes('<')) return null;

  // Some SVGs contain only a viewBox. Give the rasterizer concrete dimensions
  // so its default 300x150 fallback does not distort the requested drawing.
  if (!/\bwidth\s*=/i.test(root[0]) || !/\bheight\s*=/i.test(root[0])) {
    const additions = `${/\bwidth\s*=/i.test(root[0]) ? '' : ` width="${SIZE}"`}${/\bheight\s*=/i.test(root[0]) ? '' : ` height="${SIZE}"`}`;
    return svg.replace(root[0], root[0].replace(/>$/, `${additions}>`));
  }
  return svg;
}

async function renderSvgToDataUrl(svgString, sharpFactory = require('sharp')) {
  const drawing = safeSvg(svgString);
  if (!drawing) {
    console.warn('[AI SVG] Rejected unsafe or unsupported drawing.');
    return null;
  }
  try {
    // No Chromium or additional browser tab. Constrain input and final pixels;
    // resize before PNG encoding so a malicious dimension cannot grow output.
    const png = await sharpFactory(Buffer.from(drawing, 'utf8'), {
      density: 72, limitInputPixels: 4_000_000, failOn: 'error',
    })
      .resize({ width: SIZE, height: SIZE, fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 6 })
      .timeout({ seconds: 10 })
      .toBuffer();
    if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
        png.length > MAX_PNG_BYTES) throw new Error('Invalid or oversized PNG');
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (error) {
    console.warn('[AI SVG] Sharp could not render drawing:', error.message);
    return null;
  }
}

module.exports = { safeSvg, renderSvgToDataUrl };
