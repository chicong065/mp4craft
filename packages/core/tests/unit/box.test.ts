import { type Box, writeBox } from '@/boxes/box'
import { type FullBox } from '@/boxes/full-box'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

describe('Box', () => {
  it('serializes leaf box with 8-byte header', () => {
    const box: Box = {
      type: 'mvex',
      write: (writer) => {
        writer.zeros(4)
      },
    }
    const outputWriter = new Writer()
    writeBox(outputWriter, box)
    // 4 size + 4 type + 4 payload = 12 bytes
    const bytes = outputWriter.toBytes()
    expect(bytes.length).toBe(12)
    expect(bytes[3]).toBe(12)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('mvex')
  })

  it('serializes nested boxes with correct sizes', () => {
    const childBox: Box = {
      type: 'mvex',
      write: (writer) => {
        writer.zeros(4)
      },
    } // 12 bytes
    const parentBox: Box = {
      type: 'moov',
      write: (writer) => {
        writeBox(writer, childBox)
      },
    }
    const outputWriter = new Writer()
    writeBox(outputWriter, parentBox)
    const bytes = outputWriter.toBytes()
    expect(bytes.length).toBe(8 + 12) // parent header + child
    expect(bytes[3]).toBe(20)
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('moov')
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('mvex')
  })

  it('FullBox writes version + flags after header', () => {
    const fullBox: FullBox = {
      type: 'mvhd',
      version: 0,
      flags: 0,
      write: (writer) => {
        writer.zeros(4)
      },
    }
    const outputWriter = new Writer()
    writeBox(outputWriter, fullBox)
    const bytes = outputWriter.toBytes()
    // 4 size + 4 type + 1 version + 3 flags + 4 payload = 16
    expect(bytes.length).toBe(16)
    expect(bytes[3]).toBe(16)
    expect(bytes[8]).toBe(0) // version
    expect(bytes[9]).toBe(0)
    expect(bytes[10]).toBe(0)
    expect(bytes[11]).toBe(0) // flags
  })
})
