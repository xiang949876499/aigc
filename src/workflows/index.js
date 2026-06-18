import defaultWorkflow from './default.json'
import fluxWorkflow from './flux.json'
import textToImageWorkflow from './text_to_image.json'
import imageToImageWorkflow from './image_to_image.json'
import textToVideoWorkflow from './text_to_video.json'
import imageToVideoWorkflow from './image_to_video.json'
import outfitChangeWorkflow from './outfit_change.json'

export default {
  default: defaultWorkflow,
  flux: fluxWorkflow,
  textToImage: textToImageWorkflow,
  imageToImage: imageToImageWorkflow,
  textToVideo: textToVideoWorkflow,
  imageToVideo: imageToVideoWorkflow,
  outfitChange: outfitChangeWorkflow,
}
