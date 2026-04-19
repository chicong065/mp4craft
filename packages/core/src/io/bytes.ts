/**
 * Byte-normalization helpers shared by codec adapters and the muxer. Keeping
 * the conversion logic in one module means a single change here propagates
 * to every consumer instead of drifting across several near-identical
 * re-declarations.
 */

/**
 * Returns a `Uint8Array` view over the supplied description bytes. When the
 * input is an `ArrayBuffer`, the view spans the whole buffer; when the input
 * is an `ArrayBufferView`, the returned view preserves the original byte
 * offset and length. No bytes are copied.
 *
 * @param source - Decoder configuration bytes as either a backing buffer or
 *   a view over one.
 * @returns A `Uint8Array` pointing at the same bytes.
 */
export function toUint8Array(source: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source)
  }
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
}

/**
 * Copies the supplied bytes into a freshly allocated `ArrayBuffer` whose
 * lifetime is independent of the source. Use at library boundaries where
 * the caller's buffer must not be observed after handoff, so later mutations
 * to the source cannot corrupt the muxer's internal state.
 *
 * @param source - Bytes to copy.
 * @returns A new `ArrayBuffer` containing a byte-for-byte copy of the input.
 */
export function copyToOwnedArrayBuffer(source: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const sourceBytes = toUint8Array(source)
  const ownedArrayBuffer = new ArrayBuffer(sourceBytes.byteLength)
  new Uint8Array(ownedArrayBuffer).set(sourceBytes)
  return ownedArrayBuffer
}
