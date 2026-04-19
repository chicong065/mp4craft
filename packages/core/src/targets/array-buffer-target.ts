import type { Target } from '@/targets/target'
import { StateError } from '@/types/errors'

/**
 * In-memory {@link Target} that accumulates writes into a growable `Uint8Array` and exposes
 * the final bytes as an `ArrayBuffer` once the muxer has finished.
 *
 * @remarks
 * The target supports random-access writes, so it works with every {@link FastStart} mode.
 * It is the simplest sink to reach for when the entire output fits in memory, for example
 * in-browser previews, unit tests, and short recordings. Writes grow the internal buffer
 * by doubling its capacity as needed.
 *
 * @example
 * ```ts
 * const target = new ArrayBufferTarget();
 * const muxer = new Mp4Muxer({ target, video: { ... } });
 * muxer.addVideoChunk(chunk);
 * await muxer.finalize();
 * const mp4Bytes = new Uint8Array(target.buffer);
 * ```
 */
export class ArrayBufferTarget implements Target {
  private internalBuffer = new Uint8Array(1024)
  private occupiedByteCount = 0
  private finalizedBuffer: ArrayBuffer | null = null

  private ensureCapacity(writeEnd: number): void {
    if (writeEnd <= this.internalBuffer.length) {
      return
    }
    let newCapacity = this.internalBuffer.length
    while (newCapacity < writeEnd) newCapacity *= 2
    const resizedBuffer = new Uint8Array(newCapacity)
    resizedBuffer.set(this.internalBuffer.subarray(0, this.occupiedByteCount))
    this.internalBuffer = resizedBuffer
  }

  /**
   * Stores `data` at the given absolute offset, growing the backing buffer if needed.
   *
   * @param offset - Absolute byte offset where the data begins.
   * @param data - Bytes to copy into the buffer.
   */
  write(offset: number, data: Uint8Array): void {
    const writeEnd = offset + data.length
    this.ensureCapacity(writeEnd)
    this.internalBuffer.set(data, offset)
    if (writeEnd > this.occupiedByteCount) {
      this.occupiedByteCount = writeEnd
    }
  }

  /**
   * No-op seek, because {@link ArrayBufferTarget.write} already accepts absolute offsets
   * and never depends on a separate cursor. Declared so the target can participate in
   * progressive (`fastStart: false`) mode, which requires the {@link Target.seek} method
   * to be present.
   */
  seek(_offset: number): void {}

  /**
   * Snapshots the populated prefix of the backing buffer into a fresh `ArrayBuffer` so
   * {@link ArrayBufferTarget.buffer} can return exactly the bytes that were written.
   */
  finish(): void {
    const output = new Uint8Array(this.occupiedByteCount)
    output.set(this.internalBuffer.subarray(0, this.occupiedByteCount))
    this.finalizedBuffer = output.buffer
  }

  /**
   * The final MP4 byte stream, available after {@link Mp4Muxer.finalize} has resolved.
   *
   * @returns An `ArrayBuffer` sized exactly to the populated byte count.
   * @throws {@link StateError} When accessed before `finish()` (equivalently, before
   *   `Mp4Muxer.finalize()` has completed).
   *
   * @example
   * ```ts
   * const target = new ArrayBufferTarget();
   * const muxer = new Mp4Muxer({ target, video: { ... } });
   * muxer.addVideoChunk(chunk);
   * await muxer.finalize();
   * const mp4Bytes = new Uint8Array(target.buffer);
   * ```
   */
  get buffer(): ArrayBuffer {
    if (!this.finalizedBuffer) {
      throw new StateError('ArrayBufferTarget.buffer accessed before finish()')
    }
    return this.finalizedBuffer
  }
}
