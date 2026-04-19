import type { Target } from '@/targets/target'
import { TargetError } from '@/types/errors'

/**
 * Options for constructing a {@link StreamTarget}.
 */
export type StreamTargetOptions = {
  /**
   * Callback invoked for every chunk of output bytes, in file order.
   *
   * @remarks
   * The muxer awaits the returned promise before issuing the next write, so asynchronous
   * sinks such as `FileSystemWritableFileStream.write` or a Node.js `Writable` can apply
   * backpressure simply by deferring resolution. A rejection propagates back through
   * {@link Mp4Muxer.finalize}, so callers only need a single `try` / `catch` around the
   * finalize call to observe sink errors.
   *
   * @param chunk - Object carrying the absolute file offset where the bytes begin and the
   *   bytes themselves. Because `StreamTarget` is sequential-only, `offset` is always equal
   *   to the running total of bytes already delivered to this callback.
   * @returns Optional promise that gates the next write.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/FileSystemWritableFileStream | FileSystemWritableFileStream}
   */
  onData: (chunk: { offset: number; data: Uint8Array }) => void | Promise<void>
  /**
   * Optional callback invoked once after the muxer has emitted all bytes and called
   * `finish()`. The muxer awaits the returned promise and its rejection propagates through
   * {@link Mp4Muxer.finalize}, so this is the appropriate hook for closing the underlying
   * file handle or settling any downstream stream.
   */
  onFinish?: () => void | Promise<void>
}

/**
 * Sequential {@link Target} that forwards every write to user-supplied callbacks, suitable
 * for piping the muxer output into a file, a network request body, or any other stream
 * sink.
 *
 * @remarks
 * Because `StreamTarget` deliberately omits {@link Target.seek}, it can only be combined
 * with {@link FastStart} mode `"in-memory"`, which emits bytes in their final on-disk order
 * and therefore never seeks. Attempting to use it with progressive mode (`fastStart: false`)
 * throws a `ConfigError` during {@link Mp4Muxer} construction.
 *
 * Every `write` asserts that its `offset` equals the running byte count already delivered,
 * which catches misconfigured surrounding code that accidentally requested a non-sequential
 * write.
 */
export class StreamTarget implements Target {
  private nextExpectedOffset = 0

  /**
   * Constructs a `StreamTarget` bound to the given callbacks.
   *
   * @param options - Callback configuration, see {@link StreamTargetOptions}.
   */
  constructor(private readonly options: StreamTargetOptions) {}

  /**
   * Forwards a chunk of output bytes to {@link StreamTargetOptions.onData}, awaiting the
   * user-supplied promise before returning.
   *
   * @param offset - Absolute byte offset of the chunk. Must equal the cumulative byte count
   *   already delivered, because `StreamTarget` does not support seeking.
   * @param data - Chunk bytes.
   * @throws {@link TargetError} When `offset` does not match the next expected sequential
   *   position, which indicates the surrounding muxer configuration requested a seek
   *   against a sequential-only sink.
   */
  async write(offset: number, data: Uint8Array): Promise<void> {
    if (offset !== this.nextExpectedOffset) {
      throw new TargetError(`StreamTarget is not seekable: expected offset ${this.nextExpectedOffset}, got ${offset}`)
    }
    await this.options.onData({ offset, data })
    this.nextExpectedOffset += data.length
  }

  /**
   * Invokes the optional {@link StreamTargetOptions.onFinish} callback and awaits it. Any
   * rejection propagates back through {@link Mp4Muxer.finalize}.
   */
  async finish(): Promise<void> {
    await this.options.onFinish?.()
  }
}
