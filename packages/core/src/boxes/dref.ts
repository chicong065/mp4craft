import { writeBox } from '@/boxes/box'
import type { FullBox } from '@/boxes/full-box'

/**
 * Builds a self-contained `DataEntryUrlBox` (`url `) entry for use inside `dref`.
 *
 * The `url ` entry is a FullBox whose flags field encodes the `self-contained`
 * bit at 0x000001. When that bit is set, the media data resides in the same file
 * as the movie box and no URL string follows the header. Clearing the bit would
 * require an absolute URL string in the payload, which this muxer does not emit
 * because it only produces self-contained files.
 *
 * @returns A `FullBox` with flags 0x000001 and an empty payload.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
function createUrlEntry(): FullBox {
  return {
    type: 'url ',
    version: 0,
    flags: 0x000001, // self-contained: data is in the same file
    write: () => {
      // No URL string follows when the self-contained flag is set.
    },
  }
}

/**
 * Builds a `DataReferenceBox` (`dref`) per ISO/IEC 14496-12 §8.7.2.
 *
 * `dref` is a FullBox (version 0, flags 0) whose payload is an entry count
 * followed by one or more data-entry boxes. The muxer always emits a single
 * self-contained `url ` entry (flags bit 0 set) because the produced MP4 embeds
 * its media data in the same file. The presence of that single entry is what
 * makes every chunk offset in `stco` or `co64` an absolute offset into the file.
 *
 * @returns A `FullBox` whose serializer writes an entry count of 1 followed by a
 *   self-contained `url ` entry.
 *
 * @see {@link https://mp4ra.org/registered-types/boxes | MP4 Registration Authority box registry}
 */
export function createDref(): FullBox {
  const urlEntry: FullBox = createUrlEntry()
  return {
    type: 'dref',
    version: 0,
    flags: 0,
    write: (writer) => {
      writer.u32(1) // entry_count
      writeBox(writer, urlEntry)
    },
  }
}
