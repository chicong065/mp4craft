import type { Box } from '@/boxes/box'

/**
 * Builds an `AV1CodecConfigurationBox` (`av1C`) wrapping the supplied raw payload bytes.
 *
 * The `av1C` box is a plain `Box`, not a `FullBox`. Its first payload byte packs a 1-bit
 * marker (always 1) and a 7-bit version into a single byte (typically `0x81`). This
 * marker-and-version byte serves the same self-describing role that a FullBox `(version,
 * flags)` header would, so the AV1 ISOBMFF binding deliberately does not wrap `av1C` in a
 * FullBox header. The body emitted here is therefore exactly the bytes of the
 * `AV1CodecConfigurationRecord`, with the outer box consisting solely of the standard 4-byte
 * `size` and 4-byte `type` fields produced by {@link writeBox}.
 *
 * @param av1CodecConfigurationRecord - The full `AV1CodecConfigurationRecord` payload per the
 *   AV1 ISOBMFF binding §2.3, starting at the marker-and-version byte and running through the
 *   optional `configOBUs`. Typically this is the value of WebCodecs
 *   `VideoDecoderConfig.description` produced by a configured `VideoEncoder`, or the
 *   extracted payload of an existing `av1C` atom.
 * @returns A `Box` whose serializer writes the payload bytes verbatim, producing the full
 *   `av1C` box when passed through {@link writeBox}.
 *
 * @see {@link https://aomediacodec.github.io/av1-isobmff/ | AV1 Codec ISO Media File Format Binding v1.2.0}
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 * @see {@link https://w3c.github.io/webcodecs/ | WebCodecs specification (source of `VideoDecoderConfig.description`)}
 */
export function createAv1c(av1CodecConfigurationRecord: Uint8Array): Box {
  return {
    type: 'av1C',
    write: (writer) => writer.bytes(av1CodecConfigurationRecord),
  }
}
