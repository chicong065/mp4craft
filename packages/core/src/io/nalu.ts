type NaluBoundary = { payloadStart: number; startCodeLength: number }

/**
 * Splits an Annex-B framed H.264 or H.265 bitstream into a sequence of NAL units.
 *
 * Recognises both `0x000001` (3-byte) and `0x00000001` (4-byte) start codes and returns
 * zero-copy subarray views over the input buffer. The returned NAL units include their NAL
 * header byte but exclude any leading start code.
 *
 * @param input - Annex-B framed bitstream bytes.
 * @returns An array of `Uint8Array` views, one per NAL unit, in bitstream order.
 *
 * @see {@link https://www.itu.int/rec/T-REC-H.264 | ISO/IEC 14496-10 Annex B}
 */
export function splitAnnexB(input: Uint8Array): Uint8Array[] {
  const boundaries: NaluBoundary[] = []
  let byteIndex = 0
  while (byteIndex + 2 < input.length) {
    if (input[byteIndex] === 0 && input[byteIndex + 1] === 0) {
      if (input[byteIndex + 2] === 1) {
        boundaries.push({ payloadStart: byteIndex + 3, startCodeLength: 3 })
        byteIndex += 3
        continue
      } else if (byteIndex + 3 < input.length && input[byteIndex + 2] === 0 && input[byteIndex + 3] === 1) {
        boundaries.push({ payloadStart: byteIndex + 4, startCodeLength: 4 })
        byteIndex += 4
        continue
      }
    }
    byteIndex++
  }

  const nalus: Uint8Array[] = []
  for (let naluIndex = 0; naluIndex < boundaries.length; naluIndex++) {
    const { payloadStart } = boundaries[naluIndex]!
    const nextBoundary = boundaries[naluIndex + 1]
    const naluEnd = nextBoundary !== undefined ? nextBoundary.payloadStart - nextBoundary.startCodeLength : input.length
    nalus.push(input.subarray(payloadStart, naluEnd))
  }
  return nalus
}

/**
 * Converts a NAL-unit sequence from Annex-B framing (start codes `0x000001` or `0x00000001`)
 * to length-prefixed form (each NAL unit preceded by a big-endian unsigned 32-bit size).
 *
 * Length-prefixed framing is what ISO/IEC 14496-15 expects inside `mdat` sample payloads for
 * AVC and HEVC. Callers that receive Annex-B bytes from hardware encoders or raw elementary
 * streams can use this helper before feeding samples into the muxer.
 *
 * @param input - Annex-B framed bitstream bytes.
 * @returns A freshly allocated buffer containing each NAL unit prefixed by its 4-byte size.
 */
export function annexBToLengthPrefixed(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const nalus = splitAnnexB(input)
  const totalBytes = nalus.reduce((byteCount, naluBytes) => byteCount + 4 + naluBytes.length, 0)
  const outputBuffer = new Uint8Array(new ArrayBuffer(totalBytes))
  const dataView = new DataView(outputBuffer.buffer)
  let writeOffset = 0
  for (const naluBytes of nalus) {
    dataView.setUint32(writeOffset, naluBytes.length, false)
    outputBuffer.set(naluBytes, writeOffset + 4)
    writeOffset += 4 + naluBytes.length
  }
  return outputBuffer
}

/**
 * Strips emulation prevention bytes from a NAL unit RBSP payload.
 *
 * The H.264 and H.265 bitstreams insert a `0x03` byte after every `0x00 0x00` pair whose next
 * byte would be `0x00`, `0x01`, `0x02`, or `0x03`, to prevent the payload from accidentally
 * forming a start code. This function reverses that transformation so bitstream parsers (for
 * example, the SPS parser in {@link AvcCodec}) can operate on the raw RBSP.
 *
 * @param input - NAL unit RBSP bytes with emulation prevention bytes still embedded.
 * @returns A freshly allocated buffer with every `0x00 0x00 0x03` sequence rewritten as
 *   `0x00 0x00`.
 *
 * @see {@link https://www.itu.int/rec/T-REC-H.264 | ISO/IEC 14496-10 §7.4.1.1 (emulation prevention)}
 */
export function unescapeRbsp(input: Uint8Array): Uint8Array {
  const outputBuffer = new Uint8Array(input.length)
  let outputOffset = 0
  for (let byteIndex = 0; byteIndex < input.length; byteIndex++) {
    if (
      byteIndex + 2 < input.length &&
      input[byteIndex] === 0x00 &&
      input[byteIndex + 1] === 0x00 &&
      input[byteIndex + 2] === 0x03
    ) {
      outputBuffer[outputOffset++] = 0x00
      outputBuffer[outputOffset++] = 0x00
      byteIndex += 2 // Skip the 0x03 emulation prevention byte.
    } else {
      outputBuffer[outputOffset++] = input[byteIndex]!
    }
  }
  return outputBuffer.subarray(0, outputOffset)
}
