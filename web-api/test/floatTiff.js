// A one-band float32 TIFF like CHS's WCS returns; sharp can only write 8-bit
// ones.
function floatTiff(values, width, height = values.length / width) {
  const entries = [
    [256, 4, width], // ImageWidth, LONG
    [257, 4, height], // ImageLength
    [258, 3, 32], // BitsPerSample, SHORT
    [259, 3, 1], // Compression: none
    [262, 3, 1], // Photometric: BlackIsZero
    [273, 4, null], // StripOffsets, filled below
    [277, 3, 1], // SamplesPerPixel
    [278, 4, height], // RowsPerStrip
    [279, 4, values.length * 4], // StripByteCounts
    [339, 3, 3], // SampleFormat: IEEE float
  ];
  const ifdSize = 2 + entries.length * 12 + 4;
  const dataOffset = 8 + ifdSize;
  const buf = Buffer.alloc(dataOffset + values.length * 4);
  buf.write("II", 0, "latin1");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  buf.writeUInt16LE(entries.length, 8);
  entries.forEach(([tag, type, value], i) => {
    const at = 10 + i * 12;
    buf.writeUInt16LE(tag, at);
    buf.writeUInt16LE(type, at + 2);
    buf.writeUInt32LE(1, at + 4);
    const v = value ?? dataOffset;
    if (type === 3) buf.writeUInt16LE(v, at + 8);
    else buf.writeUInt32LE(v, at + 8);
  });
  values.forEach((v, i) => buf.writeFloatLE(v, dataOffset + i * 4));
  return buf;
}

module.exports = { floatTiff };
