// Run once to generate avc-key-frame.bin, avc-delta-frame.bin, avcc.bin.
// Requires ffmpeg on PATH.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = dirname(fileURLToPath(import.meta.url))
const h264Path = resolve(fixturesDir, 'out.h264')

// Use -g 30 so we get both IDR (key) and non-IDR (P) frames.
// -bf 0 disables B-frames; baseline profile does not support them anyway.
execSync(
  `ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=30 ` +
    `-c:v libx264 -profile:v baseline -g 30 -bf 0 -pix_fmt yuv420p ` +
    `-f h264 ${h264Path}`,
  { stdio: 'inherit' }
)

const h264Bytes = readFileSync(h264Path)
rmSync(h264Path)

// Both 3-byte (0x000001) and 4-byte (0x00000001) start codes appear in baseline H.264 streams;
// tracking the start code position (not payload start) is required to correctly terminate the previous NAL payload.
const startCodeEntries = []
for (let byteIndex = 0; byteIndex + 2 < h264Bytes.length; byteIndex++) {
  if (h264Bytes[byteIndex] === 0 && h264Bytes[byteIndex + 1] === 0 && h264Bytes[byteIndex + 2] === 1) {
    const isFourByte = byteIndex > 0 && h264Bytes[byteIndex - 1] === 0
    const startCodeBytePosition = isFourByte ? byteIndex - 1 : byteIndex
    const startCodeLength = isFourByte ? 4 : 3
    const payloadStart = startCodeBytePosition + startCodeLength
    // Avoid duplicates: the 4-byte scanner can match both at byteIndex and byteIndex-1
    if (
      startCodeEntries.length === 0 ||
      startCodeEntries[startCodeEntries.length - 1].startCodeBytePosition !== startCodeBytePosition
    ) {
      startCodeEntries.push({ startCodeBytePosition, startCodeLength, payloadStart })
      // Advance past start code to avoid re-matching inside it
      byteIndex = payloadStart - 1
    }
  }
}

const naluPayloads = []
for (let entryIndex = 0; entryIndex < startCodeEntries.length; entryIndex++) {
  const { payloadStart } = startCodeEntries[entryIndex]
  const nextEntry = startCodeEntries[entryIndex + 1]
  // Payload ends at the next start code's position (not its payload start) so the start code
  // bytes themselves are excluded from the NALU payload.
  const payloadEnd = nextEntry !== undefined ? nextEntry.startCodeBytePosition : h264Bytes.length
  naluPayloads.push(h264Bytes.subarray(payloadStart, payloadEnd))
}

// ISO 14496-10 §7.4.1: NAL unit type occupies the low 5 bits of the first byte (7=SPS, 8=PPS, 5=IDR, 1=non-IDR).
const spsNalu = naluPayloads.find((naluBytes) => (naluBytes[0] & 0x1f) === 7)
const ppsNalu = naluPayloads.find((naluBytes) => (naluBytes[0] & 0x1f) === 8)
const idrNalu = naluPayloads.find((naluBytes) => (naluBytes[0] & 0x1f) === 5)
const pFrameNalu = naluPayloads.find((naluBytes) => (naluBytes[0] & 0x1f) === 1)

if (!spsNalu || !ppsNalu || !idrNalu || !pFrameNalu) {
  throw new Error(
    `Fixture missing required NAL units: SPS=${!!spsNalu} PPS=${!!ppsNalu} IDR=${!!idrNalu} P-frame=${!!pFrameNalu}`
  )
}

function annexBPrefix(naluBytes) {
  return Buffer.concat([Buffer.from([0, 0, 0, 1]), naluBytes])
}

const avccRecord = Buffer.concat([
  Buffer.from([0x01, spsNalu[1], spsNalu[2], spsNalu[3], 0xff, 0xe1]),
  Buffer.from([(spsNalu.length >> 8) & 0xff, spsNalu.length & 0xff]),
  spsNalu,
  Buffer.from([0x01, (ppsNalu.length >> 8) & 0xff, ppsNalu.length & 0xff]),
  ppsNalu,
])

const keyFrameBytes = Buffer.concat([annexBPrefix(spsNalu), annexBPrefix(ppsNalu), annexBPrefix(idrNalu)])
const deltaFrameBytes = annexBPrefix(pFrameNalu)

writeFileSync(resolve(fixturesDir, 'avc-key-frame.bin'), keyFrameBytes)
writeFileSync(resolve(fixturesDir, 'avc-delta-frame.bin'), deltaFrameBytes)
writeFileSync(resolve(fixturesDir, 'avcc.bin'), avccRecord)

console.log(
  `Written: avc-key-frame.bin (${keyFrameBytes.length} bytes), avc-delta-frame.bin (${deltaFrameBytes.length} bytes), avcc.bin (${avccRecord.length} bytes)`
)
