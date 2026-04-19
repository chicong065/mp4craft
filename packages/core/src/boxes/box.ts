import type { Writer } from '@/io/writer'

/**
 * Every 4-character ASCII fourcc that mp4craft emits as the `type` field of
 * an ISOBMFF box. Narrowing `Box.type` to this union catches typos at compile
 * time and keeps the emitted fourcc set aligned with the boxes the codebase
 * actually writes. The `mdat` fourcc is absent because the `mdat` header is
 * written through dedicated helpers in `boxes/mdat.ts` rather than through
 * {@link writeBox}.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export type FourCC =
  | 'ftyp'
  | 'moov'
  | 'mvhd'
  | 'mvex'
  | 'mehd'
  | 'trex'
  | 'trak'
  | 'tkhd'
  | 'mdia'
  | 'mdhd'
  | 'hdlr'
  | 'minf'
  | 'vmhd'
  | 'smhd'
  | 'dinf'
  | 'dref'
  | 'url '
  | 'stbl'
  | 'stsd'
  | 'stts'
  | 'stsc'
  | 'stsz'
  | 'stco'
  | 'co64'
  | 'stss'
  | 'moof'
  | 'mfhd'
  | 'traf'
  | 'tfhd'
  | 'tfdt'
  | 'trun'
  | 'mfra'
  | 'tfra'
  | 'mfro'
  | 'avc1'
  | 'hvc1'
  | 'vp09'
  | 'av01'
  | 'mp4a'
  | 'Opus'
  | 'fLaC'
  | 'ipcm'
  | 'avcC'
  | 'hvcC'
  | 'vpcC'
  | 'av1C'
  | 'esds'
  | 'dOps'
  | 'dfLa'
  | 'pcmC'

/**
 * Generic ISOBMFF box value with a fourcc type tag and a body serializer.
 *
 * Every ISOBMFF box is length-prefixed. It begins with a 4-byte big-endian `size` field,
 * followed by a 4-byte ASCII `type` (fourcc), followed by the box body. The shared header
 * layout is defined in ISO/IEC 14496-12 §4.2. The `write(writer)` method is responsible for
 * emitting only the body bytes. The containing `size` and `type` fields are written by
 * {@link writeBox}.
 *
 * A `Box` value gains FullBox semantics by duck typing: when numeric `version` and `flags`
 * properties are present on the object, {@link writeBox} treats it as a FullBox and emits the
 * 4-byte `(version, flags)` header after the fourcc, before delegating to `write`. See
 * {@link FullBox} and ISO/IEC 14496-12 §4.2 for the FullBox extension shape.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://developer.apple.com/documentation/quicktime-file-format | Apple QuickTime File Format reference (historically describes the same structures)}
 */
export type Box = {
  /** The 4-character box type code (fourcc), written as ASCII after the `size` field. */
  readonly type: FourCC
  /**
   * Writes the box body bytes to `writer`. Must not emit the `size`, `type`, or FullBox
   * `(version, flags)` header, as those are written by {@link writeBox}.
   */
  write(writer: Writer): void
}

/**
 * Narrows a {@link Box} to its FullBox form by probing for numeric `version` and `flags`.
 *
 * ISO/IEC 14496-12 §4.2 defines the FullBox extension as a 1-byte `version` followed by a
 * 3-byte `flags` field inserted immediately after the `type` fourcc. `mp4craft` encodes the
 * distinction structurally: a plain `Box` has no such fields, while a FullBox carries them as
 * numeric properties on the same object.
 *
 * @param box - The box to probe.
 * @returns `true` when the box exposes numeric `version` and `flags` properties, marking it as
 *   a FullBox, `false` otherwise.
 */
function isFullBox(box: Box): box is Box & { version: number; flags: number } {
  if (!('version' in box) || !('flags' in box)) {
    return false
  }
  return typeof box.version === 'number' && typeof box.flags === 'number'
}

/**
 * Serializes an ISOBMFF box to `writer`, back-patching the leading `size` field once the body
 * has been fully written.
 *
 * Emission order follows ISO/IEC 14496-12 §4.2:
 *   1. A 4-byte big-endian `size` placeholder (patched at the end).
 *   2. The 4-character `type` fourcc.
 *   3. For FullBox values (detected by {@link isFullBox}), the 1-byte `version` and 3-byte
 *      `flags` header.
 *   4. The body bytes produced by `box.write(writer)`.
 *
 * After the body is written, the total byte length of the box is patched back into the size
 * placeholder via `writer.patchU32`. This tool uses the 32-bit size form exclusively, so the
 * caller is responsible for ensuring that no single box exceeds 2^32 - 1 bytes. The 64-bit
 * `largesize` extension defined in ISO/IEC 14496-12 §4.2 is not emitted here.
 *
 * @param writer - The byte sink that receives the serialized box.
 * @param box - The box value to serialize. FullBox semantics are inferred structurally from
 *   the presence of numeric `version` and `flags` properties.
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function writeBox(writer: Writer, box: Box): void {
  const sizeFieldOffset = writer.length
  writer.u32(0) // placeholder for size
  writer.fourcc(box.type)
  if (isFullBox(box)) {
    writer.u8(box.version)
    writer.u24(box.flags)
  }
  box.write(writer)
  writer.patchU32(sizeFieldOffset, writer.length - sizeFieldOffset)
}
