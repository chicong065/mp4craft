import type { FullBox } from '@/boxes/full-box'

/**
 * Builds a `VideoMediaHeaderBox` (`vmhd`) per ISO/IEC 14496-12 §12.1.2.
 *
 * `vmhd` is a FullBox (version 0, flags 0x000001) that lives inside `minf` for
 * video tracks. The flags value of 0x000001 is mandated by the spec (the
 * `no-lean-ahead` flag must be set). The payload is a 16-bit `graphicsmode` set
 * to 0 (copy) and an RGB `opcolor[3]` set to `(0, 0, 0)`, matching typical
 * muxer output.
 *
 * @returns A `FullBox` whose serializer writes the fixed video media header payload.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createVmhd(): FullBox {
  return {
    type: 'vmhd',
    version: 0,
    flags: 0x000001,
    write: (writer) => {
      writer.u16(0) // graphicsmode
      writer.u16(0)
      writer.u16(0)
      writer.u16(0) // opcolor[3]
    },
  }
}
