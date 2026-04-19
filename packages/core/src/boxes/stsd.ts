import { writeBox, type Box } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'

/**
 * Builds a `SampleDescriptionBox` (`stsd`) per ISO/IEC 14496-12 §8.5.2.
 *
 * `stsd` is a FullBox (version 0, flags 0) whose payload is an entry count followed
 * by one or more codec-specific sample entries. The muxer writes exactly one sample
 * entry per track, so the entry count is always 1 and the child-entry layout
 * (including any codec-specific sub-boxes such as `avcC`, `hvcC`, `vpcC`, `esds`,
 * or `dOps`) is delegated to the codec that produced `sampleEntry`.
 *
 * @param sampleEntry - The codec-specific sample entry (for example, `avc1`,
 *   `hvc1`, `vp09`, `mp4a`, or `Opus`) emitted by the track's codec.
 * @returns A `FullBox` whose serializer writes an entry count of 1 followed by
 *   the supplied sample entry.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createStsd(sampleEntry: Box): FullBox {
  return {
    type: 'stsd',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(1)
      writeBox(writer, sampleEntry)
    },
  }
}
