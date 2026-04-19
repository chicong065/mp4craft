import { CodeBlock } from '@/components/CodeBlock'
import docsStyles from '@/views/DocsView.module.css'

/**
 * Long-form reference for the mp4craft library. Eight ordered sections walk
 * the reader from a high-level positioning paragraph to the full API surface
 * and the recipes that cover the common real-world pipelines. Each section
 * lives in its own `<section id="...">` so the right-hand table of contents
 * anchors resolve without touching the router.
 *
 * The hand-rolled TypeScript highlighter in `lib/highlight-typescript.ts`
 * paints every code sample. No external syntax-library runtime is shipped.
 */
export function DocsView() {
  return (
    <div className={docsStyles.docsLayout}>
      <article className={docsStyles.article}>
        <header>
          <h1 className={docsStyles.heroTitle}>
            mp4<span className={docsStyles.heroTitleAccent}>craft</span> documentation
          </h1>
          <p className={docsStyles.heroLead}>
            The complete reference for muxing MP4 files from TypeScript, in the browser or Node.js. It covers every
            exported function, every config type, and every container layout the library emits.
          </p>
        </header>

        {renderIntroductionSection()}
        {renderQuickStartSection()}
        {renderCoreConceptsSection()}
        {renderApiReferenceSection()}
        {renderTypeReferenceSection()}
        {renderRecipesSection()}
        {renderErrorHandlingSection()}
        {renderDesignPrinciplesSection()}
      </article>

      <aside className={docsStyles.tableOfContents} aria-label="On this page">
        <span className={docsStyles.tableOfContentsHeading}>On this page</span>
        <a className={docsStyles.tableOfContentsLink} href="#introduction">
          Introduction
        </a>
        <a className={docsStyles.tableOfContentsLink} href="#quick-start">
          Quick start
        </a>
        <a className={docsStyles.tableOfContentsLink} href="#core-concepts">
          Core concepts
        </a>
        <a className={docsStyles.tableOfContentsLink} href="#api-reference">
          API reference
        </a>
        <a className={docsStyles.tableOfContentsLink} href="#type-reference">
          Type reference
        </a>
        <a className={docsStyles.tableOfContentsLink} href="#recipes">
          Recipes
        </a>
        <a className={docsStyles.tableOfContentsLink} href="#error-handling">
          Error handling
        </a>
        <a className={docsStyles.tableOfContentsLink} href="#design-principles">
          Design principles
        </a>
      </aside>
    </div>
  )
}

/**
 * Positioning paragraph: what mp4craft is in one line, what it covers, and
 * what it deliberately leaves to other libraries. Orients the reader before
 * the quick-start snippets show the shape of the API.
 */
function renderIntroductionSection() {
  return (
    <section id="introduction" className={docsStyles.section}>
      <h2 className={docsStyles.sectionHeading}>Introduction</h2>

      <p className={docsStyles.paragraph}>
        mp4craft writes MP4 files. It takes pre-encoded video and audio samples and arranges them into the correct ISO
        Base Media File Format box structure, producing a valid container ready for playback, download, or live
        streaming.
      </p>

      <p className={docsStyles.paragraph}>
        The library runs in modern browsers alongside WebCodecs and in Node.js with any encoder. Its scope is narrow and
        exhaustive within that scope. If the MP4 specification defines a way to carry a codec or arrange a container,
        mp4craft can emit it.
      </p>

      <h3 className={docsStyles.subsectionHeading}>What mp4craft does</h3>
      <ul className={docsStyles.list}>
        <li className={docsStyles.listItem}>
          <strong>Four video codecs.</strong> AVC, HEVC, VP9, AV1.
        </li>
        <li className={docsStyles.listItem}>
          <strong>Five audio codecs.</strong> AAC-LC, Opus, MP3, FLAC, integer PCM.
        </li>
        <li className={docsStyles.listItem}>
          <strong>Three container layouts.</strong> Progressive (<code>moov</code> at end), in-memory fast start (
          <code>moov</code> at start), and fragmented MP4 (self-contained <code>moof</code> + <code>mdat</code> pairs
          for live playback).
        </li>
        <li className={docsStyles.listItem}>
          <strong>Three target kinds.</strong> In-memory <code>ArrayBuffer</code>, callback-driven stream, and any
          user-supplied object that satisfies the <code>Target</code> interface.
        </li>
      </ul>

      <h3 className={docsStyles.subsectionHeading}>What mp4craft does not do</h3>
      <ul className={docsStyles.list}>
        <li className={docsStyles.listItem}>
          <strong>Encoding.</strong> Pair with WebCodecs <code>VideoEncoder</code> and <code>AudioEncoder</code> in the
          browser, or any codec library in Node.js.
        </li>
        <li className={docsStyles.listItem}>
          <strong>Demuxing.</strong> Reach for a dedicated MP4 parser to read existing files.
        </li>
        <li className={docsStyles.listItem}>
          <strong>DRM.</strong> Encryption boxes (<code>sinf</code>, <code>tenc</code>, <code>saio</code>,{' '}
          <code>saiz</code>) are not written.
        </li>
      </ul>

      <p className={docsStyles.paragraph}>
        The examples on this page follow WebCodecs conventions and use <code>EncodedVideoChunk</code>,{' '}
        <code>EncodedAudioChunk</code>, and <code>decoderConfig.description</code> directly. If those are new, the{' '}
        <a href="https://w3c.github.io/webcodecs/" target="_blank" rel="noreferrer">
          WebCodecs specification
        </a>{' '}
        is the shortest path to understanding them.
      </p>
    </section>
  )
}

/**
 * Three runnable examples arranged in order of how often they come up in
 * practice: in-memory write for a browser download, streaming write for
 * Node.js, fragmented live stream for MediaSource playback. Each snippet is
 * short enough to paste and adapt without reading ahead.
 */
function renderQuickStartSection() {
  return (
    <section id="quick-start" className={docsStyles.section}>
      <h2 className={docsStyles.sectionHeading}>Quick start</h2>

      <p className={docsStyles.paragraph}>
        Three minimal examples cover ninety per cent of real pipelines. Pick the one closest to your scenario,
        substitute your own encoded bytes, and you have a working muxer.
      </p>

      <h3 className={docsStyles.subsectionHeading}>Record in-memory and offer a download</h3>
      <p className={docsStyles.paragraph}>
        The most common browser flow. Samples accumulate in memory, then <code>finalize</code> produces a playable
        buffer ready for a <code>Blob</code> download or a <code>&lt;video&gt;</code> preview.
      </p>
      <CodeBlock
        label="Browser"
        code={`
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'

const target = new ArrayBufferTarget()
const muxer = new Mp4Muxer({
  target,
  fastStart: 'in-memory',
  video: {
    codec: 'avc',
    width: 1280,
    height: 720,
    description: avcDecoderConfigRecord, // from VideoEncoder metadata
  },
})

// Feed each chunk as the WebCodecs encoder emits it.
for (const chunk of encodedChunks) {
  muxer.addVideoChunk(chunk)
}

await muxer.finalize()
const mp4Bytes = new Uint8Array(target.buffer)
`}
      />

      <h3 className={docsStyles.subsectionHeading}>Stream to disk from Node.js</h3>
      <p className={docsStyles.paragraph}>
        Use <code>StreamTarget</code> when the output will not fit in memory or when the sink is a file, a socket, or an
        HTTP request body. The callback returns a promise, so any async sink applies its own backpressure.
      </p>
      <CodeBlock
        label="Node.js"
        code={`
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { Mp4Muxer, StreamTarget } from 'mp4craft'

const file = createWriteStream('output.mp4')
const muxer = new Mp4Muxer({
  target: new StreamTarget({
    onData: async ({ data }) => {
      if (!file.write(data)) await once(file, 'drain')
    },
    onFinish: () => new Promise<void>((resolve) => file.end(resolve)),
  }),
  fastStart: 'in-memory',
  video: { codec: 'avc', width: 1920, height: 1080, description: avcDecoderConfigRecord },
})

for (const sample of encodedSamples) {
  muxer.addVideoSample(sample)
}
await muxer.finalize()
`}
      />

      <h3 className={docsStyles.subsectionHeading}>Play back live via MediaSource</h3>
      <p className={docsStyles.paragraph}>
        Fragmented mode emits one <code>moof</code> + <code>mdat</code> pair per fragment, which MSE can consume in real
        time. A custom <code>Target</code> forwards every write into the <code>SourceBuffer</code>.
      </p>
      <CodeBlock
        label="Browser"
        code={`
import { Mp4Muxer, type Target } from 'mp4craft'

const mediaSource = new MediaSource()
videoElement.src = URL.createObjectURL(mediaSource)
await new Promise<void>((resolve) =>
  mediaSource.addEventListener('sourceopen', () => resolve(), { once: true }),
)

const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42001f"')

const target: Target = {
  async write(_offset, bytes) {
    // Copy so appendBuffer does not share storage with the muxer's staging buffer.
    const owned = new Uint8Array(bytes.byteLength)
    owned.set(bytes)
    await new Promise<void>((resolve, reject) => {
      sourceBuffer.addEventListener('updateend', () => resolve(), { once: true })
      sourceBuffer.addEventListener('error', () => reject(new Error('append failed')), { once: true })
      sourceBuffer.appendBuffer(owned)
    })
  },
  async finish() {
    if (mediaSource.readyState === 'open') mediaSource.endOfStream()
  },
}

const muxer = new Mp4Muxer({
  target,
  fastStart: 'fragmented',
  video: { codec: 'avc', width: 1280, height: 720, description: avcDecoderConfigRecord },
})

// Feed chunks as they arrive. The <video> starts playing on the first fragment.
`}
      />
    </section>
  )
}

/**
 * Lifecycle, layout choices, and the target abstraction. Keeps the reader
 * oriented with three short tables before diving into the API reference.
 */
function renderCoreConceptsSection() {
  return (
    <section id="core-concepts" className={docsStyles.section}>
      <h2 className={docsStyles.sectionHeading}>Core concepts</h2>

      <h3 className={docsStyles.subsectionHeading}>Lifecycle</h3>
      <p className={docsStyles.paragraph}>Every session runs three phases in order:</p>
      <ol className={docsStyles.list}>
        <li className={docsStyles.listItem}>
          <strong>Construct.</strong>{' '}
          <code>
            new Mp4Muxer({'{ '}...{' }'})
          </code>{' '}
          validates the options and sets up track state. In fragmented mode the initial <code>ftyp</code> + empty{' '}
          <code>moov</code> ship to the target immediately. Other modes defer header emission.
        </li>
        <li className={docsStyles.listItem}>
          <strong>Feed samples.</strong> Call <code>addVideoChunk</code> / <code>addAudioChunk</code> (WebCodecs) or{' '}
          <code>addVideoSample</code> / <code>addAudioSample</code> (raw bytes). Timestamps and durations are in
          microseconds throughout.
        </li>
        <li className={docsStyles.listItem}>
          <strong>Finalize.</strong> <code>await muxer.finalize()</code> flushes buffered state, writes closing boxes,
          and calls <code>target.finish()</code>. The muxer is single-use. Further calls throw <code>StateError</code>.
        </li>
      </ol>

      <h3 className={docsStyles.subsectionHeading}>Container modes</h3>
      <p className={docsStyles.paragraph}>Pick the layout that matches how your output is consumed:</p>
      <div className={docsStyles.tableWrapper}>
        <table className={docsStyles.table}>
          <thead>
            <tr>
              <th>Mode</th>
              <th>
                <code>moov</code> position
              </th>
              <th>Memory</th>
              <th>Seekable sink?</th>
              <th>Use when</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>false</code>
              </td>
              <td>End of file</td>
              <td>Low (streams through)</td>
              <td>Required</td>
              <td>Writing to a seekable file descriptor with known total size.</td>
            </tr>
            <tr>
              <td>
                <code>"in-memory"</code>
              </td>
              <td>Start of file</td>
              <td>Whole file buffered</td>
              <td>Not required</td>
              <td>Browser downloads, MSE-ready files, clips small enough to hold in RAM.</td>
            </tr>
            <tr>
              <td>
                <code>"fragmented"</code>
              </td>
              <td>
                Empty up front, then <code>moof</code> + <code>mdat</code> per fragment
              </td>
              <td>Bounded per fragment</td>
              <td>Not required</td>
              <td>Live streaming, long recordings, MSE playback, HTTP live segments.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className={docsStyles.subsectionHeading}>Targets</h3>
      <p className={docsStyles.paragraph}>
        A target is an object with <code>write(offset, data)</code>, an optional <code>seek(offset)</code>, and a{' '}
        <code>finish()</code>. Two built-in implementations cover most cases. Anything else lives behind the{' '}
        <code>Target</code> interface.
      </p>
      <ul className={docsStyles.list}>
        <li className={docsStyles.listItem}>
          <strong>
            <code>ArrayBufferTarget</code>
          </strong>{' '}
          buffers writes in memory. Exposes <code>target.buffer</code> after <code>finalize</code> resolves. Works with
          every fast-start mode.
        </li>
        <li className={docsStyles.listItem}>
          <strong>
            <code>StreamTarget</code>
          </strong>{' '}
          forwards every write to an <code>onData</code> callback. No <code>seek</code>, so it pairs with{' '}
          <code>"in-memory"</code> and <code>"fragmented"</code> and refuses progressive.
        </li>
        <li className={docsStyles.listItem}>
          <strong>
            Custom <code>Target</code>.
          </strong>{' '}
          Implement the interface to pipe output into a <code>FileSystemWritableFileStream</code>, an MSE{' '}
          <code>SourceBuffer</code>, a Node.js <code>Writable</code>, or a Fetch request body.
        </li>
      </ul>

      <div className={docsStyles.callout}>
        <strong>Rule of thumb.</strong> Default to <code>"in-memory"</code>. Switch to progressive when the output will
        not fit in RAM but your sink can seek. Switch to fragmented when you need the file to play while it is still
        being written.
      </div>
    </section>
  )
}

/**
 * Property catalog for every public symbol. Signatures lead, descriptions
 * follow in one or two sentences. Usage examples are inlined only when the
 * method's call-site is not obvious from the signature alone.
 */
function renderApiReferenceSection() {
  return (
    <section id="api-reference" className={docsStyles.section}>
      <h2 className={docsStyles.sectionHeading}>API reference</h2>

      <p className={docsStyles.paragraph}>
        Every public symbol exported from <code>mp4craft</code>. The inline JSDoc on each source file contains the same
        text and shows in IDE tooltips.
      </p>

      <h3 className={docsStyles.subsectionHeading}>
        <code>Mp4Muxer&lt;T extends Target = Target&gt;</code>
      </h3>
      <p className={docsStyles.paragraph}>
        The muxer. Takes a target, a fast-start mode, and at least one track configuration. The generic parameter
        preserves the concrete target type so accessors such as <code>ArrayBufferTarget.buffer</code> stay typed without
        casts.
      </p>
      <p className={docsStyles.signature}>new Mp4Muxer&lt;T&gt;(options: MuxerOptions&lt;T&gt;)</p>

      <p className={docsStyles.definitionTerm}>
        <code>addVideoChunk(chunk, metadata?): void</code>
      </p>
      <p className={docsStyles.definitionBody}>
        Appends a WebCodecs <code>EncodedVideoChunk</code> to the configured video track. Copies the chunk's bytes and
        forwards a <code>VideoSampleInput</code> internally.
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>addAudioChunk(chunk, metadata?): void</code>
      </p>
      <p className={docsStyles.definitionBody}>
        The audio counterpart. Symmetric to <code>addVideoChunk</code>.
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>addVideoSample(sample: VideoSampleInput): void</code>
      </p>
      <p className={docsStyles.definitionBody}>
        Appends a raw encoded video sample with explicit <code>data</code>, <code>timestamp</code>,{' '}
        <code>duration</code>, and <code>isKeyFrame</code>. Use this entry point from Node.js or wherever the encoded
        bytes did not come from WebCodecs.
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>addAudioSample(sample: AudioSampleInput): void</code>
      </p>
      <p className={docsStyles.definitionBody}>
        The audio counterpart. <code>isKeyFrame</code> defaults to <code>true</code> when omitted, matching the common
        case of lossy audio codecs whose frames are independently decodable.
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>finalize(): Promise&lt;void&gt;</code>
      </p>
      <p className={docsStyles.definitionBody}>
        Flushes internal state, writes the remaining boxes, and awaits <code>target.finish()</code>. Resolves when every
        byte has been committed. Calling <code>finalize</code> twice, or any <code>add*</code> method after, throws{' '}
        <code>StateError</code>.
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>target: T</code>
      </p>
      <p className={docsStyles.definitionBody}>
        The target instance passed to the constructor, with its concrete type preserved. Read it after{' '}
        <code>finalize</code> resolves to retrieve the finished bytes from <code>ArrayBufferTarget</code>.
      </p>

      <h3 className={docsStyles.subsectionHeading}>
        <code>ArrayBufferTarget</code>
      </h3>
      <p className={docsStyles.paragraph}>
        In-memory sink. No constructor arguments. The finished bytes become available on the <code>buffer</code>{' '}
        accessor once <code>finalize</code> resolves. Reading earlier throws <code>StateError</code>.
      </p>
      <CodeBlock
        code={`
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'

const target = new ArrayBufferTarget()
const muxer = new Mp4Muxer({ target, fastStart: 'in-memory', video: /* ... */ })
// feed samples
await muxer.finalize()
const bytes = new Uint8Array(target.buffer)
`}
      />

      <h3 className={docsStyles.subsectionHeading}>
        <code>StreamTarget</code>
      </h3>
      <p className={docsStyles.paragraph}>
        Sequential callback sink. Constructed with an <code>onData</code> and an optional <code>onFinish</code>{' '}
        callback. Refuses progressive mode because it does not expose <code>seek</code>.
      </p>
      <p className={docsStyles.signature}>new StreamTarget(options: StreamTargetOptions)</p>

      <h3 className={docsStyles.subsectionHeading}>Errors</h3>
      <p className={docsStyles.paragraph}>
        Every thrown error extends <code>Mp4CraftError</code>, which extends the built-in <code>Error</code>. Catch the
        base class to isolate library errors from unrelated exceptions.
      </p>
      <ul className={docsStyles.list}>
        <li className={docsStyles.listItem}>
          <strong>
            <code>ConfigError</code>
          </strong>
          . Invalid options: missing track, <code>fastStart: false</code> with a non-seekable target, a codec tag the
          muxer does not recognise, or output that would overflow the 32-bit <code>mdat</code> size.
        </li>
        <li className={docsStyles.listItem}>
          <strong>
            <code>StateError</code>
          </strong>
          . Lifecycle violation. Adding samples after <code>finalize</code>, finalizing twice, finalizing with zero
          samples, or reading <code>target.buffer</code> too early.
        </li>
        <li className={docsStyles.listItem}>
          <strong>
            <code>CodecError</code>
          </strong>
          . Codec-specific input bytes failed to parse. Carries a <code>codec: CodecTag</code> field identifying the
          source, so you can narrow with <code>if (error.codec === 'avc')</code>.
        </li>
        <li className={docsStyles.listItem}>
          <strong>
            <code>TargetError</code>
          </strong>
          . The sink rejected a write, or an <code>onFinish</code> callback threw. A <code>StreamTarget</code> also
          throws this when its own sequential-offset invariant is broken.
        </li>
        <li className={docsStyles.listItem}>
          <strong>
            <code>Mp4CraftError</code>
          </strong>
          . The shared base class. Extend it when your custom target needs a domain-specific error.
        </li>
      </ul>
    </section>
  )
}

/**
 * Field-by-field reference for every configuration type. Every byte-shape
 * field cites the ISO/IEC or companion spec section that defines its layout,
 * so the reader can cross-check against the standard directly.
 */
function renderTypeReferenceSection() {
  return (
    <section id="type-reference" className={docsStyles.section}>
      <h2 className={docsStyles.sectionHeading}>Type reference</h2>

      <h3 className={docsStyles.subsectionHeading}>
        <code>MuxerOptions&lt;T extends Target = Target&gt;</code>
      </h3>
      <div className={docsStyles.tableWrapper}>
        <table className={docsStyles.table}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Default</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>target</code>
              </td>
              <td>
                <code>T</code>
              </td>
              <td>required</td>
              <td>Destination sink.</td>
            </tr>
            <tr>
              <td>
                <code>video</code>
              </td>
              <td>
                <code>VideoTrackConfig</code>
              </td>
              <td>—</td>
              <td>
                Video track descriptor. At least one of <code>video</code> / <code>audio</code> must be set.
              </td>
            </tr>
            <tr>
              <td>
                <code>audio</code>
              </td>
              <td>
                <code>AudioTrackConfig</code>
              </td>
              <td>—</td>
              <td>Audio track descriptor.</td>
            </tr>
            <tr>
              <td>
                <code>fastStart</code>
              </td>
              <td>
                <code>FastStart</code>
              </td>
              <td>
                <code>false</code>
              </td>
              <td>Container layout strategy.</td>
            </tr>
            <tr>
              <td>
                <code>firstTimestampBehavior</code>
              </td>
              <td>
                <code>FirstTimestampBehavior</code>
              </td>
              <td>
                <code>"offset"</code>
              </td>
              <td>How the first timestamp of each track is treated.</td>
            </tr>
            <tr>
              <td>
                <code>minimumFragmentDuration</code>
              </td>
              <td>
                <code>number</code>
              </td>
              <td>
                <code>1_000_000</code>
              </td>
              <td>Minimum microseconds between fragment flushes. Fragmented mode only.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className={docsStyles.subsectionHeading}>
        <code>VideoTrackConfig</code>
      </h3>
      <div className={docsStyles.tableWrapper}>
        <table className={docsStyles.table}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>codec</code>
              </td>
              <td>
                <code>"avc" | "hevc" | "vp9" | "av1"</code>
              </td>
              <td>Video codec tag.</td>
            </tr>
            <tr>
              <td>
                <code>width</code>
              </td>
              <td>
                <code>number</code>
              </td>
              <td>Coded picture width in luma samples.</td>
            </tr>
            <tr>
              <td>
                <code>height</code>
              </td>
              <td>
                <code>number</code>
              </td>
              <td>Coded picture height in luma samples.</td>
            </tr>
            <tr>
              <td>
                <code>description</code>
              </td>
              <td>
                <code>ArrayBuffer | ArrayBufferView</code>
              </td>
              <td>
                Decoder configuration bytes. Format per codec: AVCDecoderConfigurationRecord (ISO/IEC 14496-15 §5.3.3),
                HEVCDecoderConfigurationRecord (§8.3.3), VP Codec Configuration Record (VP9 ISOBMFF §2.2),
                AV1CodecConfigurationRecord (AV1 ISOBMFF §2.3).
              </td>
            </tr>
            <tr>
              <td>
                <code>timescale</code>
              </td>
              <td>
                <code>number</code>
              </td>
              <td>
                Track timebase. Defaults to <code>90000</code>.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className={docsStyles.subsectionHeading}>
        <code>AudioTrackConfig</code> variants
      </h3>
      <p className={docsStyles.paragraph}>
        A discriminated union on <code>codec</code>. Every variant has <code>channels</code>, <code>sampleRate</code>,
        and an optional <code>timescale</code>. Individual fields below:
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>{'{ codec: "aac", description, ... }'}</code>
      </p>
      <p className={docsStyles.definitionBody}>
        <code>description</code> is the AudioSpecificConfig (ISO/IEC 14496-3 §1.6.2.1). In the browser this is the{' '}
        <code>metadata.decoderConfig.description</code> field emitted by the first encoded chunk.
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>{'{ codec: "opus", description, ... }'}</code>
      </p>
      <p className={docsStyles.definitionBody}>
        <code>description</code> is the OpusSpecificBox body (Opus-in-ISOBMFF §4.3.2). Chrome emits an RFC 7845 OpusHead
        instead. Convert before passing (see <a href="#recipes">Recipes</a>).
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>{'{ codec: "mp3", ... }'}</code>
      </p>
      <p className={docsStyles.definitionBody}>
        No description. The MP3 bitstream carries every decoder parameter inside its own frame headers.
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>{'{ codec: "flac", description, ... }'}</code>
      </p>
      <p className={docsStyles.definitionBody}>
        <code>description</code> is the <code>dfLa</code> metadata-block payload (FLAC-in-ISOBMFF §3). Must include the
        STREAMINFO block. Must not include the native <code>fLaC</code> magic that opens a standalone <code>.flac</code>{' '}
        file.
      </p>

      <p className={docsStyles.definitionTerm}>
        <code>{'{ codec: "pcm", bitsPerSample, endianness, ... }'}</code>
      </p>
      <p className={docsStyles.definitionBody}>
        No description. <code>bitsPerSample</code> is <code>16 | 24 | 32</code>. <code>endianness</code> is{' '}
        <code>"little" | "big"</code>. Parameters populate the <code>ipcm</code> sample entry and its <code>pcmC</code>{' '}
        child per ISO/IEC 23003-5.
      </p>

      <h3 className={docsStyles.subsectionHeading}>
        <code>VideoSampleInput</code> and <code>AudioSampleInput</code>
      </h3>
      <p className={docsStyles.paragraph}>
        The inputs to <code>addVideoSample</code> / <code>addAudioSample</code>. Both carry encoded bytes and timing
        metadata in microseconds.
      </p>
      <CodeBlock
        code={`
type VideoSampleInput = {
  data: Uint8Array<ArrayBuffer>    // codec-native bitstream
  timestamp: number                // microseconds
  duration: number                 // microseconds
  isKeyFrame: boolean
}

type AudioSampleInput = {
  data: Uint8Array<ArrayBuffer>
  timestamp: number
  duration: number
  isKeyFrame?: boolean             // defaults to true
}
`}
      />

      <h3 className={docsStyles.subsectionHeading}>
        <code>FastStart</code>
      </h3>
      <p className={docsStyles.paragraph}>
        <code>false | "in-memory" | "fragmented"</code>. See the comparison in{' '}
        <a href="#core-concepts">Core concepts</a>.
      </p>

      <h3 className={docsStyles.subsectionHeading}>
        <code>FirstTimestampBehavior</code>
      </h3>
      <p className={docsStyles.paragraph}>Controls how the first timestamp of each track is treated:</p>
      <ul className={docsStyles.list}>
        <li className={docsStyles.listItem}>
          <code>"offset"</code> (default). Subtracts the first timestamp so every track starts at zero.
        </li>
        <li className={docsStyles.listItem}>
          <code>"strict"</code>. The first timestamp must be zero. Throws otherwise.
        </li>
        <li className={docsStyles.listItem}>
          <code>"permissive"</code>. Passes timestamps through unchanged. Tracks may start at non-zero offsets.
        </li>
      </ul>

      <h3 className={docsStyles.subsectionHeading}>
        <code>Target</code>
      </h3>
      <CodeBlock
        code={`
type Target = {
  write(offset: number, data: Uint8Array): void | Promise<void>
  seek?(offset: number): void | Promise<void>
  finish(): void | Promise<void>
}
`}
      />
      <p className={docsStyles.paragraph}>
        The presence of <code>seek</code> gates which fast-start modes are available. Progressive mode requires it.
        In-memory and fragmented do not.
      </p>
    </section>
  )
}

/**
 * Short, focused snippets that solve problems other libraries do not document.
 * Each recipe covers one pitfall and one pattern that resolves it.
 */
function renderRecipesSection() {
  return (
    <section id="recipes" className={docsStyles.section}>
      <h2 className={docsStyles.sectionHeading}>Recipes</h2>

      <h3 className={docsStyles.subsectionHeading}>Compute per-sample duration from timestamp deltas</h3>
      <p className={docsStyles.paragraph}>
        WebCodecs does not populate <code>EncodedVideoChunk.duration</code> for frames captured from a{' '}
        <code>MediaStreamTrack</code>. The muxer writes <code>chunk.duration ?? 0</code>, which yields a zero-second
        file. Hold each chunk until its successor arrives, then emit the previous chunk with the delta as its duration.
      </p>
      <CodeBlock
        code={`
let pending: EncodedVideoChunk | null = null
const FRAME_INTERVAL_US = 33_333 // trailing-chunk fallback (30 fps)

function onChunk(chunk: EncodedVideoChunk) {
  if (pending) emit(pending, chunk.timestamp - pending.timestamp)
  pending = chunk
}

function flushTail() {
  if (pending) emit(pending, FRAME_INTERVAL_US)
  pending = null
}

function emit(chunk: EncodedVideoChunk, durationMicroseconds: number) {
  const bytes = new Uint8Array(chunk.byteLength)
  chunk.copyTo(bytes)
  muxer.addVideoSample({
    data: bytes,
    timestamp: chunk.timestamp,
    duration: Math.max(1, durationMicroseconds),
    isKeyFrame: chunk.type === 'key',
  })
}
`}
      />

      <h3 className={docsStyles.subsectionHeading}>Synthesize a VP9 decoder description</h3>
      <p className={docsStyles.paragraph}>
        Chrome's VP9 encoder never populates <code>metadata.decoderConfig.description</code> because VP9 is
        self-describing. Build the <code>vpcC</code> payload from the codec string instead of waiting forever.
      </p>
      <CodeBlock
        code={`
function buildVpcC(codecString: string): Uint8Array {
  // vp09.PROFILE.LEVEL.BITDEPTH, e.g. 'vp09.00.30.08'
  const [, profile = '0', level = '30', bitDepth = '08'] = codecString.split('.')
  const payload = new Uint8Array(8)
  payload[0] = Number.parseInt(profile, 10)
  payload[1] = Number.parseInt(level, 10)
  payload[2] = (Number.parseInt(bitDepth, 10) << 4) | (1 << 1) // 4:2:0 colocated, studio range
  payload[3] = 1 // colourPrimaries BT.709
  payload[4] = 1 // transferCharacteristics BT.709
  payload[5] = 1 // matrixCoefficients BT.709
  return payload
}
`}
      />

      <h3 className={docsStyles.subsectionHeading}>
        Convert Chrome's Opus description to <code>dOps</code>
      </h3>
      <p className={docsStyles.paragraph}>
        Chrome emits an Ogg OpusHead Identification Header (RFC 7845) in <code>metadata.decoderConfig.description</code>
        . MP4 expects a <code>dOps</code> OpusSpecificBox body instead. The two disagree on magic prefix, byte order,
        and version. Convert before handing it to the muxer.
      </p>
      <CodeBlock
        code={`
function opusHeadToDops(opusHead: Uint8Array): Uint8Array {
  const view = new DataView(opusHead.buffer, opusHead.byteOffset, opusHead.byteLength)
  const outputChannelCount = opusHead[9] ?? 0
  const preSkip = view.getUint16(10, true)              // little-endian in OpusHead
  const inputSampleRate = view.getUint32(12, true)
  const outputGain = view.getInt16(16, true)
  const channelMappingFamily = opusHead[18] ?? 0

  const dops = new Uint8Array(11)
  const dopsView = new DataView(dops.buffer)
  dops[0] = 0                                           // dOps version (mandatory)
  dops[1] = outputChannelCount
  dopsView.setUint16(2, preSkip, false)                 // big-endian in dOps
  dopsView.setUint32(4, inputSampleRate, false)
  dopsView.setInt16(8, outputGain, false)
  dops[10] = channelMappingFamily
  return dops
}
`}
      />

      <h3 className={docsStyles.subsectionHeading}>Upload the output to a streaming Fetch body</h3>
      <p className={docsStyles.paragraph}>
        Browsers that implement streaming request bodies can POST the muxer output directly to a server without first
        buffering the whole file. Wire a <code>TransformStream</code> to the request body and forward muxer writes into
        the writable side.
      </p>
      <CodeBlock
        code={`
const uploadStream = new TransformStream<Uint8Array, Uint8Array>()
const uploadWriter = uploadStream.writable.getWriter()

const uploadResponse = fetch('/upload', {
  method: 'POST',
  body: uploadStream.readable,
  headers: { 'Content-Type': 'video/mp4' },
  duplex: 'half', // required for streaming request bodies
})

const muxer = new Mp4Muxer({
  target: new StreamTarget({
    onData: ({ data }) => uploadWriter.write(data),
    onFinish: () => uploadWriter.close(),
  }),
  fastStart: 'in-memory',
  video: /* ... */,
})

// feed samples
await muxer.finalize()
const response = await uploadResponse
`}
      />

      <h3 className={docsStyles.subsectionHeading}>Remux an existing file in a different mode</h3>
      <p className={docsStyles.paragraph}>
        The raw-sample API is the right entry point when the encoded bytes already exist. Parse the source with a
        demuxer of your choice, then replay each sample into <code>addVideoSample</code> / <code>addAudioSample</code>{' '}
        with its original timestamp and duration. The playground's File Replay scenario demonstrates the full pipeline
        end to end.
      </p>

      <h3 className={docsStyles.subsectionHeading}>Run the muxer in a Web Worker</h3>
      <p className={docsStyles.paragraph}>
        mp4craft has no DOM dependencies. Host the <code>VideoEncoder</code> and the muxer together in a dedicated
        worker, then transfer the finalized <code>ArrayBuffer</code> to the main thread:
      </p>
      <CodeBlock
        code={`
// worker.ts
await muxer.finalize()
const bytes = new Uint8Array(target.buffer)
postMessage(bytes, [bytes.buffer])

// main.ts
worker.onmessage = ({ data }) => {
  const blob = new Blob([data], { type: 'video/mp4' })
  videoElement.src = URL.createObjectURL(blob)
}
`}
      />
    </section>
  )
}

/**
 * Idiomatic catch-block for the five error classes, with one-line recovery
 * notes per class.
 */
function renderErrorHandlingSection() {
  return (
    <section id="error-handling" className={docsStyles.section}>
      <h2 className={docsStyles.sectionHeading}>Error handling</h2>

      <p className={docsStyles.paragraph}>
        Each error class signals a distinct recovery path. <code>ConfigError</code> needs a code fix,{' '}
        <code>StateError</code> needs a lifecycle fix, <code>CodecError</code> flags malformed upstream input, and{' '}
        <code>TargetError</code> propagates a sink failure.
      </p>

      <CodeBlock
        code={`
import {
  ArrayBufferTarget,
  CodecError,
  ConfigError,
  Mp4CraftError,
  Mp4Muxer,
  StateError,
  TargetError,
} from 'mp4craft'

try {
  const muxer = new Mp4Muxer({ target: new ArrayBufferTarget(), fastStart: 'in-memory', video: /* ... */ })
  muxer.addVideoChunk(chunk)
  await muxer.finalize()
} catch (thrown) {
  if (thrown instanceof ConfigError) {
    // Invalid options. Inspect thrown.message and fix the call site.
  } else if (thrown instanceof StateError) {
    // Wrong lifecycle order. Restart the session from scratch.
  } else if (thrown instanceof CodecError) {
    console.error(\`\${thrown.codec} rejected the input: \${thrown.message}\`)
  } else if (thrown instanceof TargetError) {
    // The sink failed. Check its own error for the root cause.
  } else if (thrown instanceof Mp4CraftError) {
    // Any other mp4craft error not covered above.
  } else {
    throw thrown // not ours
  }
}
`}
      />

      <p className={docsStyles.paragraph}>
        For logging, catch <code>Mp4CraftError</code> alone. The <code>.name</code> field identifies the subclass, so
        one handler formats the message with the category included.
      </p>
    </section>
  )
}

/**
 * Closing section that names the library's guiding constraints. Four short
 * bullets, each one sentence on the rule and one on what it means in
 * practice.
 */
function renderDesignPrinciplesSection() {
  return (
    <section id="design-principles" className={docsStyles.section}>
      <h2 className={docsStyles.sectionHeading}>Design principles</h2>

      <ul className={docsStyles.list}>
        <li className={docsStyles.listItem}>
          <strong>Zero runtime dependencies.</strong> The published <code>package.json</code> has an empty{' '}
          <code>dependencies</code> field. Installing mp4craft adds one entry to your <code>node_modules</code>.
        </li>
        <li className={docsStyles.listItem}>
          <strong>Standards first.</strong> Every box writer cites the ISO/IEC or companion section that defines its
          layout. The emitted bytes are verified against the spec at the byte level and round-tripped through an
          independent parser at the integration level.
        </li>
        <li className={docsStyles.listItem}>
          <strong>WebCodecs-first, Node-ready.</strong> <code>addVideoChunk</code> wraps the raw-sample API at zero
          cost. Browser callers get the convenience. Node callers bypass WebCodecs types entirely.
        </li>
        <li className={docsStyles.listItem}>
          <strong>Narrow scope.</strong> mp4craft muxes containers and nothing else. Encoding belongs to WebCodecs and
          native codec libraries. Demuxing belongs to dedicated parsers. Within its scope mp4craft aims for complete
          coverage of every codec and layout the spec defines.
        </li>
      </ul>
    </section>
  )
}
