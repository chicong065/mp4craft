import { writeBox } from '@/boxes/box'
import type { Box } from '@/boxes/box'
import { createStsd } from '@/boxes/stsd'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('stsd', () => {
  it('wraps a single sample entry with entry_count=1', () => {
    const sampleEntry: Box = { type: 'avc1', write: (writer) => writer.zeros(78) }
    const outputWriter = new Writer()
    writeBox(outputWriter, createStsd(sampleEntry))
    const bytes = outputWriter.toBytes()
    // 8 header + 4 FullBox + 4 entry_count + (8 + 78) child = 102
    expect(bytes.length).toBe(102)
    const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(dataView.getUint32(12, false)).toBe(1)
    expect(String.fromCharCode(...bytes.subarray(20, 24))).toBe('avc1')
  })
})
