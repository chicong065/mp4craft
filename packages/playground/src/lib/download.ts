/*
 * File save helper that prefers the File System Access API when available and falls
 * back to a Blob anchor download for browsers that do not yet ship the API. Scenarios
 * call `saveBytesToDisk` after `muxer.finalize()` resolves to persist the output.
 */

/**
 * Saves the supplied bytes to disk. Prefers the File System Access API when the host
 * browser exposes `window.showSaveFilePicker`. Falls back to a Blob anchor download
 * otherwise. The fallback path revokes the created object URL shortly after the click
 * fires so memory is not retained across saves.
 *
 * User cancellation of the File System Access dialog surfaces as an `AbortError`
 * `DOMException` and is treated as a successful no-op so scenario code does not need
 * to distinguish "cancel" from "save".
 *
 * @param suggestedName - File name shown in the save dialog and set on the anchor.
 * @param bytes - The bytes to save.
 * @param mimeType - MIME type for the Blob fallback. Defaults to `"video/mp4"`.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker | MDN showSaveFilePicker}
 */
export async function saveBytesToDisk(
  suggestedName: string,
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string = 'video/mp4'
): Promise<void> {
  /*
   * Wrap once as a Blob so both the File System Access and anchor-download paths
   * hand the browser the same BufferSource-compatible chunk. The runtime copy is
   * cheap relative to the muxer's finalize step and avoids rewrapping downstream.
   */
  const payloadBlob = new Blob([bytes], { type: mimeType })

  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'MP4 video',
            accept: { [mimeType]: ['.mp4'] },
          },
        ],
      })
      const writableStream = await fileHandle.createWritable()
      await writableStream.write(payloadBlob)
      await writableStream.close()
      return
    } catch (unknownReason) {
      /*
       * Dialog cancellation is not an error path. Swallow AbortError and re-throw
       * everything else so the caller can surface genuine write failures.
       */
      if (unknownReason instanceof DOMException && unknownReason.name === 'AbortError') {
        return
      }
      throw unknownReason
    }
  }

  const fallbackBlob = payloadBlob
  const objectUrl = URL.createObjectURL(fallbackBlob)
  const anchorElement = document.createElement('a')
  anchorElement.href = objectUrl
  anchorElement.download = suggestedName
  document.body.appendChild(anchorElement)
  anchorElement.click()
  document.body.removeChild(anchorElement)
  /*
   * Browsers need the object URL alive long enough for the download to commit.
   * A short delay before revoke covers every engine observed in manual testing.
   */
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl)
  }, 100)
}
