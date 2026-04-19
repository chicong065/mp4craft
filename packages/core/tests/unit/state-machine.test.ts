import { StateMachine } from '@/muxer/state-machine'
import { StateError } from '@/types/errors'
import { describe, expect, it } from 'vitest'

describe('StateMachine', () => {
  it('starts idle, moves to writing on first sample, then to finalized', () => {
    const stateMachine = new StateMachine()
    expect(stateMachine.state).toBe('idle')
    stateMachine.onSample()
    expect(stateMachine.state).toBe('writing')
    stateMachine.onFinalize()
    expect(stateMachine.state).toBe('finalized')
  })

  it('throws when adding a sample after finalize', () => {
    const stateMachine = new StateMachine()
    stateMachine.onSample()
    stateMachine.onFinalize()
    expect(() => stateMachine.onSample()).toThrow(StateError)
  })

  it('throws when finalizing twice', () => {
    const stateMachine = new StateMachine()
    stateMachine.onSample()
    stateMachine.onFinalize()
    expect(() => stateMachine.onFinalize()).toThrow(StateError)
  })

  it('throws when finalizing without any samples', () => {
    const stateMachine = new StateMachine()
    expect(() => stateMachine.onFinalize()).toThrow(StateError)
  })
})
