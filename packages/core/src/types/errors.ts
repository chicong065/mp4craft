import type { AudioCodec, VideoCodec } from '@/types/config'

/**
 * Identifier of the codec that raised a {@link CodecError}. Matches the
 * `codec` discriminator used in {@link VideoTrackConfig} and
 * {@link AudioTrackConfig}.
 */
export type CodecTag = VideoCodec | AudioCodec

/**
 * Base class for every error thrown from `mp4craft`.
 *
 * @remarks
 * All public errors derive from this type, so consumers can catch the entire package surface
 * with a single `instanceof Mp4CraftError` check. More specific failure modes are represented
 * by the subclasses {@link ConfigError}, {@link StateError}, {@link CodecError}, and
 * {@link TargetError}. The `name` field on each subclass is overridden so stack traces and
 * logging output identify the concrete failure category.
 *
 * @example
 * ```ts
 * try {
 *   await muxer.finalize();
 * } catch (thrown) {
 *   if (thrown instanceof Mp4CraftError) {
 *     console.error(`${thrown.name}: ${thrown.message}`);
 *   }
 * }
 * ```
 */
export class Mp4CraftError extends Error {
  override name = 'Mp4CraftError'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

/**
 * Thrown when the muxer configuration is invalid or incompatible with the chosen target.
 *
 * @remarks
 * Representative scenarios include constructing `Mp4Muxer` without a `video` or `audio`
 * track, combining `fastStart: false` with a non-seekable target such as `StreamTarget`,
 * calling `addVideoSample` / `addAudioSample` without the corresponding track configured,
 * and exceeding the 4 GiB size that a 32-bit `mdat` header can represent. See
 * {@link Mp4Muxer} for the exact call sites that surface this error.
 */
export class ConfigError extends Mp4CraftError {
  override name = 'ConfigError'
}

/**
 * Thrown when a method is called in the wrong lifecycle state.
 *
 * @remarks
 * Representative scenarios include adding samples after `finalize()` has run, calling
 * `finalize()` twice, calling `finalize()` before any sample has been appended, and reading
 * `ArrayBufferTarget.buffer` before `finalize()` has completed. See {@link Mp4Muxer} and
 * {@link ArrayBufferTarget} for the exact call sites that surface this error.
 */
export class StateError extends Mp4CraftError {
  override name = 'StateError'
}

/**
 * Thrown when codec-specific input bytes cannot be parsed or are inconsistent with the
 * declared codec.
 *
 * @remarks
 * The {@link CodecError.codec} field identifies the codec that produced the failure, for
 * example `"avc"`, `"hevc"`, `"vp9"`, `"aac"`, or `"opus"`. Typical causes include a
 * malformed `AVCDecoderConfigurationRecord`, a truncated `HEVCDecoderConfigurationRecord`,
 * or an `AudioSpecificConfig` whose declared object type is unsupported.
 */
export class CodecError extends Mp4CraftError {
  override name = 'CodecError'
  constructor(
    message: string,
    /**
     * Identifier of the codec that raised the error, matching the `codec`
     * discriminator used in {@link VideoTrackConfig} and
     * {@link AudioTrackConfig}.
     */
    public readonly codec: CodecTag,
    options?: ErrorOptions
  ) {
    super(message, options)
  }
}

/**
 * Thrown when a {@link Target} rejects a write or finish call, or when its contract is
 * violated by the muxer workflow.
 *
 * @remarks
 * Representative scenarios include writing to a `StreamTarget` at an offset that is not the
 * next expected sequential position (which indicates the surrounding code requested a seek
 * against a sequential-only sink), and user-supplied `onData` / `onFinish` callbacks that
 * reject their promise.
 */
export class TargetError extends Mp4CraftError {
  override name = 'TargetError'
}

/**
 * Exhaustiveness guard for `switch` statements over a discriminated union.
 * Placed in a `default` branch whose surrounding cases cover every variant,
 * the typed-`never` parameter fails to compile when a new variant is added
 * without a matching case. If runtime control ever reaches the call despite
 * the compile-time proof, the message is surfaced through {@link ConfigError}.
 *
 * @param unreachableValue - A value whose type is statically `never`
 *   because every discriminant variant has been handled above.
 * @param message - Diagnostic string surfaced on the thrown
 *   {@link ConfigError}.
 */
export function assertNever(_unreachableValue: never, message: string): never {
  throw new ConfigError(message)
}
