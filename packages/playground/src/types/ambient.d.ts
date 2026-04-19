/*
 * Ambient type declarations for browser APIs the standard TypeScript DOM lib does not
 * yet cover. The playground depends on two such APIs:
 *
 * - `MediaStreamTrackProcessor`, part of the Insertable Streams for MediaStreamTrack
 *   spec. The standard `lib.dom.d.ts` omits it even though Chrome has shipped it since
 *   M94. The scenario code guards the call at runtime so older browsers surface a
 *   clear error, but TypeScript still needs a declaration to compile.
 * - `window.showSaveFilePicker`, part of the File System Access API. It is not in
 *   `lib.dom.d.ts` either. The `saveBytesToDisk` helper probes for the method at
 *   runtime and falls back to a Blob anchor download when missing.
 *
 * @see {@link https://w3c.github.io/mediacapture-transform/ | MediaStreamTrack Insertable Streams}
 * @see {@link https://wicg.github.io/file-system-access/ | File System Access API}
 */

export {}

declare global {
  /** Init dictionary accepted by the `MediaStreamTrackProcessor` constructor. */
  type MediaStreamTrackProcessorInit = {
    /** The live `MediaStreamTrack` that supplies frames to the readable stream. */
    track: MediaStreamTrack
    /**
     * Maximum number of buffered frames before the processor drops the oldest frame.
     * Defaults to an implementation-defined value.
     */
    maxBufferSize?: number
  }

  /**
   * Stream-of-frames wrapper around a live `MediaStreamTrack`. The `readable` stream yields
   * `VideoFrame` objects for video tracks and `AudioData` objects for audio tracks. Callers
   * must `close()` each frame after processing to release the underlying GPU texture or the
   * audio buffer.
   */
  type MediaStreamTrackProcessor<FrameType> = {
    readonly readable: ReadableStream<FrameType>
  }

  /** Constructor surface for the `MediaStreamTrackProcessor` global. */
  type MediaStreamTrackProcessorConstructor = new <FrameType>(
    init: MediaStreamTrackProcessorInit
  ) => MediaStreamTrackProcessor<FrameType>

  /**
   * Global `MediaStreamTrackProcessor` constructor. Chrome exposes this on `window`.
   * Safari and Firefox do not yet, so callers must feature-detect before invoking.
   */
  var MediaStreamTrackProcessor: MediaStreamTrackProcessorConstructor | undefined

  /** Single file-type descriptor accepted by `showSaveFilePicker`. */
  type SaveFilePickerAcceptType = {
    /** Human-readable file type description shown in the dialog. */
    description?: string
    /** Mapping from MIME type to the list of accepted file extensions. */
    accept: Record<string, readonly string[]>
  }

  /** Options accepted by `window.showSaveFilePicker`. */
  type ShowSaveFilePickerOptions = {
    /** Suggested file name shown in the dialog. */
    suggestedName?: string
    /** Accepted file types. */
    types?: readonly SaveFilePickerAcceptType[]
    /** Whether to exclude the implementation-defined "All files" entry. */
    excludeAcceptAllOption?: boolean
  }

  // The `Window` declaration MUST stay an `interface` so it merges with the standard
  // `lib.dom.d.ts` Window interface. `type` aliases cannot declaration-merge, so the
  // "type not interface" convention does not apply to this augmentation.
  interface Window {
    /**
     * File System Access API entry point. Optional because the spec is a WICG
     * draft and Safari and Firefox still gate it behind flags or do not ship it.
     */
    showSaveFilePicker?: (options?: ShowSaveFilePickerOptions) => Promise<FileSystemFileHandle>
  }
}
