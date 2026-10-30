# Roast My Room

A phone-friendly demo: snap a room, get a short roast and four redesign ideas, then drag a slider to reveal a glow-up.

`PROVIDER=openrouter` is the default, so a showcase can stay cheap. `PROVIDER=xai` uses the xAI API instead.

## Setup

1. `npm install`
2. `cp .env.example .env` and set a key:
   - OpenRouter (default): `OPENROUTER_API_KEY` from https://openrouter.ai/keys
   - xAI: `PROVIDER=xai` and `XAI_API_KEY` from https://console.x.ai
   - No key: `MOCK=1`
3. `npm start` and open http://localhost:3000

The server listens on `0.0.0.0` and `PORT` (default `3000`). For a public demo link, point an HTTPS tunnel at that port. Leave this process on plain HTTP. The tunnel provides HTTPS, which the laptop webcam needs.

On a phone, use **Take a photo** (it opens the camera) or **Upload a photo**. On a laptop, use **Use webcam**, then **Capture**. **Use the sample room** works with no camera.

`npm test` checks the mock flow without a key.

## Models

Checked against the live OpenRouter and xAI docs on 30 Oct 2026.

| | Roast | Glow-up |
| --- | --- | --- |
| `PROVIDER=openrouter` | `google/gemini-2.5-flash-lite` via `POST https://openrouter.ai/api/v1/chat/completions`. Vision in, text out. About $0.10 / 1M input tokens and $0.40 / 1M output tokens. | `black-forest-labs/flux.2-klein-4b` via `POST https://openrouter.ai/api/v1/images`, with the photo as a reference. About $0.014 per output megapixel. |
| `PROVIDER=xai` | `grok-4.7` via `POST https://api.x.ai/v1/responses` | `grok-imagine-image-2.0` via `POST https://api.x.ai/v1/images/generations` (`quality=low`, `resolution=1k`) |

Override either model with `ROAST_MODEL` or `IMAGE_MODEL`.

If the OpenRouter glow-up fails and `XAI_API_KEY` is set, the server tries xAI image generation next. If that is also missing or fails, the before/after slider still plays with the built-in sample glow-up and a note that it is a placeholder. The same placeholder is used when the xAI image call fails.

## Demo script

Open the HTTPS tunnel link on the projector laptop. Leave the toggle on **Savage** if the room can take it.

Hit **Use webcam**, point it at the room, and press **Capture**. If the camera is fussy, **Use the sample room** instead. While it thinks: the model is reading the room, then writing the roast, then painting the fix.

Read the roast out loud. Drag the slider from the photo to the glow-up. If image generation fails, say so: the app still reveals a sample redesign. Share or save the card, then roast a second room on **Gentle**.

Backup: stop the server and run `MOCK=1 npm start`. Same clicks, no API bill.

## Stretch ideas

- Style chips (Japandi, maximalist, 1970s) that change the glow-up prompt.
- Stream the roast tokens so the first joke lands before the image.
- A control that rerenders the glow-up at a higher quality.
- A QR code to the tunnel URL so the audience submits rooms from their phones.
- Local history of past roasts in the browser.
