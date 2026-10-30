# Roast My Room

A phone-friendly demo: snap a room, Grok roasts it, then a glow-up image slides in beside the original.

The roast goes through [OpenRouter](https://openrouter.ai) to `x-ai/grok-4.7` (vision). The glow-up uses OpenRouter’s image API and `x-ai/grok-imagine-image-2.0`, with the photo as a reference. If image generation fails, the reveal still plays with a sample glow-up.

## Setup

1. `npm install`
2. `cp .env.example .env` and paste an OpenRouter key into `OPENROUTER_API_KEY`. To rehearse with no key, set `MOCK=1` instead.
3. `npm start` and open http://localhost:3000

The server listens on `0.0.0.0` and `PORT` (default `3000`). For a public demo link, point an HTTPS tunnel at that port. Leave this process on plain HTTP. The tunnel provides HTTPS, which the laptop webcam needs. Do not turn on a second HTTPS redirect inside the app.

On a phone, use **Take a photo** (it opens the camera) or **Upload a photo**. On a laptop, use **Use webcam**, then **Capture**. **Use the sample room** works with no camera.

`npm test` checks the mock flow without a key.

## Demo script

Open the HTTPS tunnel link on the projector laptop. Leave the toggle on **Savage** if the room can take it.

Hit **Use webcam**, point it at the room, and press **Capture**. If the camera is fussy, **Use the sample room** instead. Say one sentence while it thinks: Grok is looking, then it writes the roast, then it paints the fix.

Read the roast out loud. Drag the slider from the messy photo to the glow-up. If the image service fails, the app still reveals a sample redesign and says so. Share or save the card, then roast a second room on **Gentle** so the audience hears the difference.

Backup: stop the server and run `MOCK=1 npm start`. Same clicks, no API bill, sample roast and sample glow-up.

## Stretch ideas

- Style chips (Japandi, maximalist, 1970s) that change the glow-up prompt.
- Stream the roast tokens so the first joke lands before the image.
- A quality switch that rerenders the glow-up at `IMAGE_QUALITY=medium`.
- A QR code to the tunnel URL so the audience submits rooms from their phones.
- Local history of past roasts in the browser.
- Try another OpenRouter image model via `IMAGE_MODEL`.
