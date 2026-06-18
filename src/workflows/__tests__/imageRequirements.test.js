import { describe, expect, it } from 'vitest'
import {
  getWorkflowKeyForSubmit,
  isSourceImageRequiredForSubmit,
} from '../imageRequirements.js'

describe('image input requirements', () => {
  it('allows reference image modes to submit without an image', () => {
    expect(isSourceImageRequiredForSubmit('image_to_image')).toBe(false)
    expect(isSourceImageRequiredForSubmit('image_to_video')).toBe(false)
  })

  it('keeps replacement workflow source images required', () => {
    expect(isSourceImageRequiredForSubmit('replace_item')).toBe(true)
  })

  it('falls back to text workflows when optional image modes have no source image', () => {
    expect(getWorkflowKeyForSubmit('image_to_image', false)).toBe('textToImage')
    expect(getWorkflowKeyForSubmit('image_to_video', false)).toBe('textToVideo')
  })

  it('keeps image workflows when optional source images are provided', () => {
    expect(getWorkflowKeyForSubmit('image_to_image', true)).toBe('imageToImage')
    expect(getWorkflowKeyForSubmit('image_to_video', true)).toBe('imageToVideo')
    expect(getWorkflowKeyForSubmit('replace_item', true)).toBe('outfitChange')
  })
})
