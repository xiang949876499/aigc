# Third-Party Notices

Last reviewed: 2026-08-16.

The root [LICENSE](./LICENSE) covers only original contributions. Third-party
software, models, node packages, and external services retain their own terms.

## ComfyUI integration

- Integration: this repository communicates with ComfyUI as an external
  service/API; no ComfyUI source tree was identified as bundled in this
  repository during the review.
- Upstream: [ComfyUI](https://github.com/Comfy-Org/ComfyUI).
- License: GPL-3.0; see the
  [upstream license](https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE).
- Distribution boundary: if a release later bundles ComfyUI, custom nodes, or
  model weights, review each component's GPL and model-license obligations
  before distribution.

## JavaScript and Electron dependencies

Dependency licenses are recorded in package manifests and lockfiles. Generate
an artifact-specific license inventory before shipping an Electron installer.
