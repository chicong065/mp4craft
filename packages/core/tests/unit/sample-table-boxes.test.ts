import { writeBox } from '@/boxes/box'
import { createStco, createCo64 } from '@/boxes/stco'
import { createStsc } from '@/boxes/stsc'
import { createStss } from '@/boxes/stss'
import { createStsz } from '@/boxes/stsz'
import { createStts } from '@/boxes/stts'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('sample table boxes', () => {
  it('stts emits run-length-encoded time deltas', () => {
    const outputWriter = new Writer()
    writeBox(
      outputWriter,
      createStts([
        { count: 30, delta: 3000 },
        { count: 1, delta: 2000 },
      ])
    )
    const bytes = outputWriter.toBytes()
    const dataView = new DataView(bytes.buffer)
    // after header(8) + FullBox(4) + entry_count(4) = 16
    expect(dataView.getUint32(12, false)).toBe(2)
    expect(dataView.getUint32(16, false)).toBe(30)
    expect(dataView.getUint32(20, false)).toBe(3000)
    expect(dataView.getUint32(24, false)).toBe(1)
    expect(dataView.getUint32(28, false)).toBe(2000)
  })

  it('stsc run-length-encoded sample-to-chunk', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createStsc([{ firstChunk: 1, samplesPerChunk: 30, descIndex: 1 }]))
    const bytes = outputWriter.toBytes()
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint32(12, false)).toBe(1) // entry_count
    expect(dataView.getUint32(16, false)).toBe(1) // first_chunk
    expect(dataView.getUint32(20, false)).toBe(30) // samples_per_chunk
    expect(dataView.getUint32(24, false)).toBe(1) // sample_description_index
  })

  it('stsz with varying sizes', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createStsz({ sizes: [100, 200, 300] }))
    const bytes = outputWriter.toBytes()
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint32(12, false)).toBe(0) // sample_size (0 = per-entry)
    expect(dataView.getUint32(16, false)).toBe(3) // sample_count
    expect(dataView.getUint32(20, false)).toBe(100)
    expect(dataView.getUint32(24, false)).toBe(200)
    expect(dataView.getUint32(28, false)).toBe(300)
  })

  it('stsz with fixed size writes sample_size and count, no per-entry table', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createStsz({ fixedSize: 512, sampleCount: 90 }))
    const bytes = outputWriter.toBytes()
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint32(12, false)).toBe(512) // sample_size = fixed
    expect(dataView.getUint32(16, false)).toBe(90) // sample_count
    expect(bytes.length).toBe(20) // no per-entry table appended
  })

  it('stco emits 32-bit chunk offsets', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createStco([1000, 2000, 3000]))
    const bytes = outputWriter.toBytes()
    const dataView = new DataView(bytes.buffer)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('stco')
    expect(dataView.getUint32(12, false)).toBe(3)
    expect(dataView.getUint32(16, false)).toBe(1000)
  })

  it('co64 emits 64-bit chunk offsets', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createCo64([1000n, 0x100000000n]))
    const bytes = outputWriter.toBytes()
    const dataView = new DataView(bytes.buffer)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('co64')
    expect(dataView.getUint32(12, false)).toBe(2)
    expect(dataView.getBigUint64(16, false)).toBe(1000n)
    expect(dataView.getBigUint64(24, false)).toBe(0x100000000n)
  })

  it('stss emits keyframe sample numbers (1-indexed)', () => {
    const outputWriter = new Writer()
    writeBox(outputWriter, createStss([1, 30, 60]))
    const bytes = outputWriter.toBytes()
    const dataView = new DataView(bytes.buffer)
    expect(dataView.getUint32(12, false)).toBe(3)
    expect(dataView.getUint32(16, false)).toBe(1)
    expect(dataView.getUint32(20, false)).toBe(30)
  })
})
