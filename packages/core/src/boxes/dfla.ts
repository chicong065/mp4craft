import type { FullBox } from '@/boxes/full-box'

/**
 * Builds a `FLACSpecificBox` (`dfLa`) wrapping the supplied metadata-block bytes.
 *
 * Per FLAC in ISOBMFF, `dfLa` is a FullBox (version 0, flags 0) whose body is a sequence
 * of FLAC metadata blocks. The STREAMINFO block MUST be present because it carries the
 * sample rate, channel count, and bit-depth needed to decode the stream. Each metadata
 * block begins with a 4-byte header (1-bit last-metadata-block flag, 7-bit BLOCK_TYPE,
 * 24-bit LENGTH) followed by block data of the declared length.
 *
 * mp4craft emits the payload verbatim and does not parse or validate the metadata blocks.
 * Callers are responsible for supplying bytes that conform to the FLAC format, without
 * the native "fLaC" magic that begins a standalone `.flac` file.
 *
 * @param metadataBlocksPayload - Concatenated FLAC metadata blocks, each including its
 *   4-byte header followed by block data. The block whose last-metadata-block flag is
 *   set MUST be the final block in the sequence.
 * @returns A {@link FullBox} whose serializer writes the metadata-block bytes verbatim
 *   after the FullBox version-and-flags header.
 *
 * @see {@link https://github.com/xiph/flac/blob/master/doc/isoflac.txt | FLAC in ISOBMFF}
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createDfla(metadataBlocksPayload: Uint8Array): FullBox {
  return {
    type: 'dfLa',
    version: 0,
    flags: 0,
    write: (writer) => writer.bytes(metadataBlocksPayload),
  }
}
