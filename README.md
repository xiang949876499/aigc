# aigc-app

## ComfyUI backend

- Development requests go through the Vite proxy at `/api/comfyui` to avoid browser CORS errors.
- Set `VITE_COMFYUI_SERVER` to the image ComfyUI server address when it is not `http://127.0.0.1:8188`.
- Set `VITE_COMFYUI_VIDEO_SERVER` when video workflows should use a different ComfyUI server.
- In the app, open Settings from the bottom of the left rail to override image and video generation server IP/port for the current browser/Electron profile, for example `http://192.168.0.131:8188`; do not include `/api/comfyui` routes.
- Electron sends configured absolute ComfyUI server requests through the main process so the renderer does not fail on ComfyUI CORS/Origin checks.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run check:speech`
- `npm run build:win`
- `npm test`

## Speech input

Speech recognition runs in the Electron main process through the ModelScope
FunASR CLI. Install it locally and make sure `funasr` is available in `PATH`:

```bash
pip install -U funasr
npm run check:speech
```

On Windows, use Python 3.10 or 3.11 for FunASR. Python 3.13 can fail while
building the `editdistance` dependency; if that happens, create a dedicated
conda env and set `FUNASR_CLI` to its `funasr.exe`.

The renderer records microphone samples through the preload IPC bridge. When the
user stops recording, Electron writes a temporary WAV file and calls:

```bash
funasr speech.wav --output-format json --model sensevoice --language zh
```

Set `FUNASR_CLI`, `FUNASR_MODEL`, `FUNASR_LANGUAGE`, or `FUNASR_TIMEOUT_MS` to
customize the local CLI command. See `docs/voice-recognition.md` for details.
