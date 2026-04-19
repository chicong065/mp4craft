/**
 * Minimal contract satisfied by any destination sink accepted by {@link Mp4Muxer}.
 *
 * @remarks
 * The muxer calls `write` with absolute byte offsets into the output stream. Implementations
 * may be synchronous or asynchronous (both return shapes are accepted). The presence of
 * {@link Target.seek} determines which {@link FastStart} modes are available: progressive
 * mode (`fastStart: false`) requires a seekable target because the `mdat` header size is
 * patched in place at finalize time, whereas in-memory fast-start mode (`fastStart:
 * "in-memory"`) works on any target, seekable or not, because the muxer emits bytes in
 * final order.
 *
 * Built-in implementations: {@link ArrayBufferTarget} (random-access in-memory buffer) and
 * {@link StreamTarget} (sequential callbacks, seek deliberately omitted).
 */
export type Target = {
  /**
   * Writes `data` into the target starting at absolute byte offset `offset`. The muxer may
   * call this out of order in progressive mode (in particular when patching the `mdat`
   * header at finalize time), so implementations that back a random-access buffer must
   * honour the offset rather than assuming sequential appends.
   *
   * @param offset - Absolute byte offset into the output stream where `data` begins.
   * @param data - Bytes to store. Must not be retained past the call return because the
   *   muxer may reuse the underlying buffer.
   * @returns Either `void` for synchronous sinks, or a `Promise` that resolves once the
   *   write is durable enough for subsequent writes to observe it.
   */
  write(offset: number, data: Uint8Array): void | Promise<void>
  /**
   * Repositions the logical write cursor for targets that support random access.
   *
   * @remarks
   * This method is optional. Its presence gates progressive mode (`fastStart: false`): when
   * absent, {@link Mp4Muxer} will refuse progressive mode and throw a `ConfigError` during
   * construction. {@link StreamTarget} deliberately omits `seek` so sequential-only sinks
   * remain expressible through the same interface.
   *
   * @param offset - Absolute byte offset where the next `write` should land.
   * @returns Either `void` synchronously, or a `Promise` that resolves once the reposition
   *   has been acknowledged.
   */
  seek?(offset: number): void | Promise<void>
  /**
   * Signals that no more writes will arrive and the target should flush and close any
   * underlying resources. Called exactly once, by {@link Mp4Muxer.finalize}.
   *
   * @returns Either `void` synchronously, or a `Promise` that resolves once the output has
   *   been fully persisted.
   */
  finish(): void | Promise<void>
}
