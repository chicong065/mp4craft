import { writeBox } from '@/boxes/box'
import { AvcCodec } from '@/codecs/video/avc'
import { Writer } from '@/io/writer'
import { describe, expect, it } from 'vitest'

const sps = new Uint8Array([0x67, 0x42, 0xc0, 0x1e, 0xe5, 0x40, 0x50, 0x1e, 0x88])
const pps = new Uint8Array([0x68, 0xce, 0x38, 0x80])
const avcC = buildAvcC(sps, pps)

function buildAvcC(spsBytes: Uint8Array, ppsBytes: Uint8Array): Uint8Array {
  const out: number[] = [0x01, spsBytes[1]!, spsBytes[2]!, spsBytes[3]!, 0xff, 0xe1]
  out.push((spsBytes.length >> 8) & 0xff, spsBytes.length & 0xff)
  out.push(...spsBytes)
  out.push(0x01)
  out.push((ppsBytes.length >> 8) & 0xff, ppsBytes.length & 0xff)
  out.push(...ppsBytes)
  return new Uint8Array(out)
}

describe('AvcCodec', () => {
  it('extracts width & height from SPS', () => {
    const codec = new AvcCodec(avcC)
    expect(codec.width).toBe(640)
    expect(codec.height).toBe(480)
  })

  it('produces an avc1 sample entry containing an avcC box', () => {
    const codec = new AvcCodec(avcC)
    const outputWriter = new Writer()
    writeBox(outputWriter, codec.createSampleEntry())
    const bytes = outputWriter.toBytes()
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('avc1')
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('avcC')).toBeGreaterThan(0)
  })
})
