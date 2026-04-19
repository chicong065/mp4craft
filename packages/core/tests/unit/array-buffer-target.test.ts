import { ArrayBufferTarget } from '@/targets/array-buffer-target'
import { StateError } from '@/types/errors'
import { describe, expect, it } from 'vitest'

describe('ArrayBufferTarget', () => {
  it('accepts sequential writes and exposes buffer after finish()', () => {
    const target = new ArrayBufferTarget()
    target.write(0, new Uint8Array([1, 2, 3]))
    target.write(3, new Uint8Array([4, 5]))
    target.finish()
    expect(new Uint8Array(target.buffer)).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  it('throws StateError when buffer is accessed before finish()', () => {
    const target = new ArrayBufferTarget()
    target.write(0, new Uint8Array([1]))
    expect(() => target.buffer).toThrow(StateError)
  })

  it('supports seek and out-of-order writes', () => {
    const target = new ArrayBufferTarget()
    target.write(10, new Uint8Array([10, 11]))
    target.write(0, new Uint8Array([0, 1]))
    target.finish()
    const targetBytes = new Uint8Array(target.buffer)
    expect(targetBytes[0]).toBe(0)
    expect(targetBytes[1]).toBe(1)
    expect(targetBytes[10]).toBe(10)
    expect(targetBytes[11]).toBe(11)
    expect(targetBytes.length).toBe(12)
  })
})
