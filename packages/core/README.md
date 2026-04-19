# mp4craft

**TypeScript-first, zero-dependency MP4 muxer designed for the browsers**

## What is mp4craft?

mp4craft takes pre-encoded video and audio samples and writes them into a valid MP4 file. It covers every codec and every container layout the format defines for the web, with zero runtime dependencies.

```ts
import { ArrayBufferTarget, Mp4Muxer } from 'mp4craft'

const target = new ArrayBufferTarget()
const muxer = new Mp4Muxer({
  target,
  fastStart: 'in-memory',
  video: { codec: 'avc', width: 1280, height: 720, description: avccBytes },
})

muxer.addVideoChunk(encodedChunk)
await muxer.finalize()

const mp4 = new Uint8Array(target.buffer)
```

## Features

- **Video codecs**: AVC, HEVC, VP9, AV1
- **Audio codecs**: AAC-LC, Opus, MP3, FLAC, integer PCM
- **Container layouts**: progressive, in-memory fast start, fragmented
- **Targets**: `ArrayBufferTarget`, `StreamTarget`, or a custom `Target`
- **WebCodecs-native**, with a raw-sample API for Node.js encoders
- **Zero runtime dependencies**

## Installation

```bash
npm install mp4craft
# or
pnpm add mp4craft
# or
yarn add mp4craft
```

## Quick start

### Mux video with audio

```ts
import { Mp4Muxer, ArrayBufferTarget } from 'mp4craft'

const muxer = new Mp4Muxer({
  target: new ArrayBufferTarget(),
  fastStart: 'in-memory',
  video: { codec: 'avc', width: 1280, height: 720, description: avccBytes },
  audio: { codec: 'aac', channels: 2, sampleRate: 48000, description: aacBytes },
})

for (const videoChunk of encodedVideoChunks) {
  muxer.addVideoChunk(videoChunk)
}
for (const audioChunk of encodedAudioChunks) {
  muxer.addAudioChunk(audioChunk)
}

await muxer.finalize()
```

### Stream to disk with backpressure

```ts
import { Mp4Muxer, StreamTarget } from 'mp4craft'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'

const writeStream = createWriteStream('output.mp4')

const target = new StreamTarget({
  onData: async ({ data }) => {
    if (!writeStream.write(data)) {
      await once(writeStream, 'drain')
    }
  },
  onFinish: () =>
    new Promise<void>((resolve, reject) => {
      writeStream.end((error?: Error | null) => (error ? reject(error) : resolve()))
    }),
})

const muxer = new Mp4Muxer({
  target,
  fastStart: 'in-memory',
  video: { codec: 'avc', width: 1920, height: 1080, description: avccBytes },
})

for (const rawSample of encodedVideoSamples) {
  muxer.addVideoSample(rawSample)
}
await muxer.finalize()
```

### Fragmented MP4 for live streaming

```ts
import { Mp4Muxer, StreamTarget } from 'mp4craft'

const muxer = new Mp4Muxer({
  target: new StreamTarget({
    onData: ({ data }) => sourceBuffer.appendBuffer(data),
  }),
  fastStart: 'fragmented',
  video: { codec: 'avc', width: 1280, height: 720, description: avccBytes },
})
```

## Documentation

Visit the [Docs](https://mp4craft.pages.dev/docs) for comprehensive guides, examples and API documentation.

## Playground

Visit the [Playground](https://mp4craft.pages.dev) to see mp4craft in action.

## License

mp4craft is open-source software licensed under the [MIT License](./LICENSE).
