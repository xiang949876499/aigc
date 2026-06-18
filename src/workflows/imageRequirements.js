const SUBMIT_SOURCE_IMAGE_REQUIRED_MODES = new Set(['replace_item'])

const WORKFLOW_KEYS_BY_MODE = {
  text_to_image: 'textToImage',
  image_to_image: 'imageToImage',
  text_to_video: 'textToVideo',
  image_to_video: 'imageToVideo',
  replace_item: 'outfitChange',
}

const TEXT_WORKFLOW_FALLBACKS = {
  image_to_image: 'textToImage',
  image_to_video: 'textToVideo',
}

export function isSourceImageRequiredForSubmit(mode) {
  return SUBMIT_SOURCE_IMAGE_REQUIRED_MODES.has(mode)
}

export function getWorkflowKeyForSubmit(mode, hasSourceImage) {
  if (!hasSourceImage && TEXT_WORKFLOW_FALLBACKS[mode]) {
    return TEXT_WORKFLOW_FALLBACKS[mode]
  }

  return WORKFLOW_KEYS_BY_MODE[mode] || 'textToImage'
}
