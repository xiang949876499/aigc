import { describe, expect, it } from 'vitest'
import workflows from '../index.js'

describe('workflow registry', () => {
  it('exports the two-image item replacement workflow', () => {
    expect(workflows.outfitChange).toBeTruthy()
    expect(workflows.outfitChange['78']?.class_type).toBe('LoadImage')
    expect(workflows.outfitChange['139']?.class_type).toBe('LoadImage')
  })
})
