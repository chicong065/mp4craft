import { SampleTable } from '@/tracks/sample-table'
import { describe, expect, it } from 'vitest'

describe('SampleTable', () => {
  it('records samples and builds stts with RLE', () => {
    const sampleTable = new SampleTable({ isVideo: true })
    for (let sampleIndex = 0; sampleIndex < 5; sampleIndex++) {
      sampleTable.addSample({
        size: 100,
        duration: 3000,
        isKeyFrame: sampleIndex === 0,
        chunkOffset: 1000 + sampleIndex * 100,
      })
    }
    const { sttsEntries } = sampleTable.build()
    expect(sttsEntries).toEqual([{ count: 5, delta: 3000 }])
  })

  it('splits stts runs on delta change', () => {
    const sampleTable = new SampleTable({ isVideo: false })
    sampleTable.addSample({ size: 100, duration: 1000, isKeyFrame: true, chunkOffset: 0 })
    sampleTable.addSample({ size: 100, duration: 1000, isKeyFrame: true, chunkOffset: 100 })
    sampleTable.addSample({ size: 100, duration: 2000, isKeyFrame: true, chunkOffset: 200 })
    const { sttsEntries } = sampleTable.build()
    expect(sttsEntries).toEqual([
      { count: 2, delta: 1000 },
      { count: 1, delta: 2000 },
    ])
  })

  it('records keyframes (1-indexed) for video', () => {
    const sampleTable = new SampleTable({ isVideo: true })
    sampleTable.addSample({ size: 100, duration: 3000, isKeyFrame: true, chunkOffset: 0 })
    sampleTable.addSample({ size: 100, duration: 3000, isKeyFrame: false, chunkOffset: 100 })
    sampleTable.addSample({ size: 100, duration: 3000, isKeyFrame: true, chunkOffset: 200 })
    const { syncSamples } = sampleTable.build()
    expect(syncSamples).toEqual([1, 3])
  })

  it('collects chunk offsets (one sample per chunk for MVP)', () => {
    const sampleTable = new SampleTable({ isVideo: true })
    sampleTable.addSample({ size: 100, duration: 3000, isKeyFrame: true, chunkOffset: 1000 })
    sampleTable.addSample({ size: 100, duration: 3000, isKeyFrame: true, chunkOffset: 1100 })
    const { chunkOffsets, stscEntries } = sampleTable.build()
    expect(chunkOffsets).toEqual([1000, 1100])
    expect(stscEntries).toEqual([{ firstChunk: 1, samplesPerChunk: 1, descIndex: 1 }])
  })

  it('reports needs64Bit when any offset exceeds 2^32-1', () => {
    const sampleTable = new SampleTable({ isVideo: false })
    sampleTable.addSample({ size: 100, duration: 1000, isKeyFrame: true, chunkOffset: 0 })
    sampleTable.addSample({
      size: 100,
      duration: 1000,
      isKeyFrame: true,
      chunkOffset: Number.MAX_SAFE_INTEGER,
    })
    const { needs64Bit } = sampleTable.build()
    expect(needs64Bit).toBe(true)
  })

  it('exposes total duration and sample count', () => {
    const sampleTable = new SampleTable({ isVideo: true })
    for (let sampleIndex = 0; sampleIndex < 10; sampleIndex++) {
      sampleTable.addSample({
        size: 100,
        duration: 3000,
        isKeyFrame: sampleIndex === 0,
        chunkOffset: sampleIndex * 100,
      })
    }
    const buildResult = sampleTable.build()
    expect(buildResult.sampleCount).toBe(10)
    expect(buildResult.totalDuration).toBe(30000)
  })
})
