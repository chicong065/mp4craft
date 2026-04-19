import { writeBox, type Box } from '@/boxes/box'

/**
 * Builds a `SampleTableBox` (`stbl`) per ISO/IEC 14496-12 §8.5.1.
 *
 * The sample table container aggregates all per-sample timing, size, and location
 * indices for a single track, nested inside `minf`. The muxer emits the canonical
 * child ordering of `stsd`, `stts`, `stsc`, `stsz`, `stco` (or `co64`), and an
 * optional `stss` for video tracks.
 *
 * @param children - Child boxes composing the sample table. The `stco` field
 *   accepts either a 32-bit `stco` or a 64-bit `co64` box. The `stss` field is
 *   provided for video tracks to list keyframe sample numbers, and is omitted
 *   for audio tracks where every sample is independently decodable.
 * @returns A `Box` whose serializer writes the child boxes in canonical order.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createStbl(children: {
  /** `SampleDescriptionBox` describing the codec-specific sample entry for this track. */
  stsd: Box
  /** `DecodingTimeToSampleBox` mapping runs of samples to their decode-time deltas. */
  stts: Box
  /** `SampleToChunkBox` mapping runs of chunks to their samples-per-chunk values. */
  stsc: Box
  /** `SampleSizeBox` giving the size in bytes of each sample. */
  stsz: Box
  /**
   * `ChunkOffsetBox` locating each chunk inside the file. Accepts either `stco`
   * (32-bit offsets) or `co64` (64-bit offsets), depending on whether the largest
   * chunk offset fits in 32 bits.
   */
  stco: Box
  /**
   * `SyncSampleBox` listing 1-based keyframe sample numbers. Supplied for video
   * tracks, omitted for audio tracks where every sample is a sync sample.
   */
  stss?: Box
}): Box {
  return {
    type: 'stbl',
    write: (writer) => {
      writeBox(writer, children.stsd)
      writeBox(writer, children.stts)
      writeBox(writer, children.stsc)
      writeBox(writer, children.stsz)
      writeBox(writer, children.stco)
      if (children.stss) {
        writeBox(writer, children.stss)
      }
    },
  }
}
