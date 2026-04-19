import { StreamTarget } from '@/targets/stream-target'
import { TargetError } from '@/types/errors'
import { describe, expect, it } from 'vitest'

describe('StreamTarget', () => {
  it('emits chunks sequentially to the callback', async () => {
    const receivedChunks: { offset: number; data: Uint8Array }[] = []
    const target = new StreamTarget({
      onData: (chunk) => {
        receivedChunks.push({ offset: chunk.offset, data: new Uint8Array(chunk.data) })
      },
    })
    await target.write(0, new Uint8Array([1, 2]))
    await target.write(2, new Uint8Array([3, 4, 5]))
    await target.finish()
    expect(receivedChunks).toEqual([
      { offset: 0, data: new Uint8Array([1, 2]) },
      { offset: 2, data: new Uint8Array([3, 4, 5]) },
    ])
  })

  it('throws TargetError on out-of-order writes (non-seekable)', async () => {
    const target = new StreamTarget({ onData: () => undefined })
    await target.write(0, new Uint8Array([1]))
    await expect(target.write(100, new Uint8Array([2]))).rejects.toThrow(TargetError)
  })

  it('awaits async onData promises (backpressure)', async () => {
    let resolvedCount = 0
    const target = new StreamTarget({
      onData: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        resolvedCount++
      },
    })
    await target.write(0, new Uint8Array([1]))
    expect(resolvedCount).toBe(1)
    await target.finish()
  })

  it('calls onFinish once at the end', async () => {
    let finished = false
    const target = new StreamTarget({
      onData: () => undefined,
      onFinish: () => {
        finished = true
      },
    })
    await target.write(0, new Uint8Array([1]))
    await target.finish()
    expect(finished).toBe(true)
  })
})
