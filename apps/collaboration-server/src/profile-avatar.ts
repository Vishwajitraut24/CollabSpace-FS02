const MAX_AVATAR_BYTES = 512 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const isValidProfileAvatarDataUrl = (value: string): boolean => {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;

  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES || bytes.toString('base64') !== match[2]) return false;

  switch (match[1]) {
    case 'png':
      return bytes.length >= 20
        && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        && bytes.subarray(-8).equals(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]));
    case 'jpeg':
      return bytes.length >= 4
        && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    case 'webp':
      return bytes.length >= 16
        && bytes.toString('ascii', 0, 4) === 'RIFF'
        && bytes.toString('ascii', 8, 12) === 'WEBP'
        && bytes.readUInt32LE(4) === bytes.length - 8;
    default:
      return false;
  }
};
