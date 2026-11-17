import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidProfileAvatarDataUrl } from '../dist/profile-avatar.js';

const dataUrl = (type, bytes) => `data:image/${type};base64,${bytes.toString('base64')}`;

test('accepts supported raster image signatures and rejects SVG payloads', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0, 0xff, 0xd9]);
  const webp = Buffer.alloc(16);
  webp.write('RIFF', 0, 'ascii');
  webp.writeUInt32LE(webp.length - 8, 4);
  webp.write('WEBP', 8, 'ascii');

  assert.equal(isValidProfileAvatarDataUrl(dataUrl('png', png)), true);
  assert.equal(isValidProfileAvatarDataUrl(dataUrl('jpeg', jpeg)), true);
  assert.equal(isValidProfileAvatarDataUrl(dataUrl('webp', webp)), true);
  assert.equal(isValidProfileAvatarDataUrl('data:image/svg+xml;base64,PHN2Zy8+'), false);
  assert.equal(isValidProfileAvatarDataUrl(dataUrl('jpeg', png)), false);
});

test('rejects profile avatars larger than 512 KB', () => {
  const oversized = Buffer.alloc(512 * 1024 + 1);
  assert.equal(isValidProfileAvatarDataUrl(dataUrl('png', oversized)), false);
});
