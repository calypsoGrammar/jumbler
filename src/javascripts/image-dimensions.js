// Read encoded dimensions before asking the browser to allocate a decoded bitmap.
// A malformed or mismatched header is still rejected by Image.decode() later.
export function imageDimensions(buffer, type)
{
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const has = (offset, values) => values.every((value, index) => bytes[offset + index] === value);

  if(type === 'image/png')
  {
    if(bytes.length < 24 || !has(0, [137, 80, 78, 71, 13, 10, 26, 10]) ||
       view.getUint32(8) !== 13 || !has(12, [73, 72, 68, 82])) return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if(type === 'image/gif')
  {
    if(bytes.length < 10 || !(has(0, [71, 73, 70, 56, 55, 97]) || has(0, [71, 73, 70, 56, 57, 97]))) return null;
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  if(type === 'image/webp')
  {
    if(bytes.length < 30 || !has(0, [82, 73, 70, 70]) || !has(8, [87, 69, 66, 80])) return null;
    if(has(12, [86, 80, 56, 88]) && view.getUint32(16, true) >= 10)
    {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    }
    if(has(12, [86, 80, 56, 76]) && bytes[20] === 47)
    {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 63) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10),
      };
    }
    if(has(12, [86, 80, 56, 32]) && has(23, [157, 1, 42]))
    {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    return null;
  }

  if(type === 'image/jpeg')
  {
    if(bytes.length < 4 || !has(0, [255, 216])) return null;
    let offset = 2;
    while(offset + 3 < bytes.length)
    {
      if(bytes[offset++] !== 255) return null;
      while(bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if(marker === 217 || marker === 218 || marker === undefined) return null;
      if(marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if(offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset);
      if(length < 2 || offset + length > bytes.length) return null;
      if((marker >= 192 && marker <= 195) || (marker >= 197 && marker <= 199) ||
         (marker >= 201 && marker <= 203) || (marker >= 205 && marker <= 207))
      {
        if(length < 8) return null;
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  return null;
}
