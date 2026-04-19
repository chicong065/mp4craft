import { Mp4CraftError, ConfigError, StateError, CodecError, TargetError } from '@/types/errors'
import { describe, expect, it } from 'vitest'

describe('error hierarchy', () => {
  it('all errors extend Mp4CraftError and Error', () => {
    for (const Err of [ConfigError, StateError, CodecError, TargetError]) {
      const e = new (Err as new (m: string) => Error)('x')
      expect(e).toBeInstanceOf(Mp4CraftError)
      expect(e).toBeInstanceOf(Error)
      expect(e.message).toBe('x')
    }
  })

  it('CodecError exposes the codec tag', () => {
    const e = new CodecError('bad sps', 'avc')
    expect(e.codec).toBe('avc')
    expect(e.name).toBe('CodecError')
  })

  it('errors preserve name for discrimination', () => {
    expect(new ConfigError('x').name).toBe('ConfigError')
    expect(new StateError('x').name).toBe('StateError')
    expect(new TargetError('x').name).toBe('TargetError')
  })

  it('forwards Error.cause for chaining', () => {
    const root = new TypeError('root cause')
    const cfg = new ConfigError('bad options', { cause: root })
    expect(cfg.cause).toBe(root)

    const codec = new CodecError('bad sps', 'avc', { cause: root })
    expect(codec.cause).toBe(root)
    expect(codec.codec).toBe('avc')
  })
})
