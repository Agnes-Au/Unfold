import express, { Router } from 'express';

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MODEL = 'scribe_v2';
const MAX_UPLOAD = '25mb';
const TIMEOUT_MS = 60_000;

/**
 * Transcription relay. Mounted at /api/transcribe.
 *
 * The ElevenLabs key stays in the server environment; the client posts the
 * recording as multipart `file` and gets the Scribe JSON back. Audio is held
 * in memory for the duration of the request only, never stored or logged.
 * The model and options are fixed here, not taken from the client.
 */
export function transcribeRouter(config, fetchImpl = fetch) {
  const router = Router();

  router.post('/', express.raw({ type: 'multipart/form-data', limit: MAX_UPLOAD }), async (req, res, next) => {
    try {
      if (!config.elevenLabsApiKey) return res.status(503).json({ error: 'transcription_not_configured' });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'multipart file is required' });
      }

      let upload;
      try {
        const incoming = await new Request('http://local/', {
          method: 'POST',
          headers: { 'content-type': req.get('content-type') },
          body: req.body,
        }).formData();
        upload = incoming.get('file');
      } catch {
        return res.status(400).json({ error: 'invalid multipart body' });
      }
      if (!(upload instanceof Blob) || upload.size === 0) {
        return res.status(400).json({ error: 'multipart file is required' });
      }

      const form = new FormData();
      form.append('model_id', MODEL);
      form.append('tag_audio_events', 'false');
      form.append('file', upload, upload.name || 'recording');

      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'xi-api-key': config.elevenLabsApiKey },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error(`[transcribe] ElevenLabs returned ${response.status}`);
        return res.status(502).json({ error: 'transcription_failed', upstreamStatus: response.status });
      }
      return res.json(await response.json());
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
