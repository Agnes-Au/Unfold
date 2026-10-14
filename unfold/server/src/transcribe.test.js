import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { transcribeRouter } from './routes/transcribe.js';

async function withServer(config, fetchImpl, run) {
  const app = express();
  app.use('/api/transcribe', transcribeRouter(config, fetchImpl));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.type || 'internal_error' }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/transcribe`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function audioForm(extra = {}) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }), 'recording.webm');
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}

test('transcription reports when no ElevenLabs key is configured', async () => {
  await withServer({ elevenLabsApiKey: '' }, fetch, async (url) => {
    const response = await fetch(url, { method: 'POST', body: audioForm() });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'transcription_not_configured');
  });
});

test('transcription forwards only the file with server-chosen options and key', async () => {
  let forwarded;
  const fakeFetch = async (endpoint, init) => {
    forwarded = { endpoint, headers: init.headers, form: init.body };
    return new Response(JSON.stringify({ text: 'hello' }), { status: 200 });
  };
  await withServer({ elevenLabsApiKey: 'server-key' }, fakeFetch, async (url) => {
    const response = await fetch(url, { method: 'POST', body: audioForm({ model_id: 'client-choice', extra: 'x' }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: 'hello' });
  });
  assert.equal(forwarded.endpoint, 'https://api.elevenlabs.io/v1/speech-to-text');
  assert.equal(forwarded.headers['xi-api-key'], 'server-key');
  assert.equal(forwarded.form.get('model_id'), 'scribe_v2');
  assert.equal(forwarded.form.get('extra'), null);
  const file = forwarded.form.get('file');
  assert.equal(file.size, 4);
  assert.equal(file.name, 'recording.webm');
});

test('transcription rejects a request without an audio file', async () => {
  await withServer({ elevenLabsApiKey: 'server-key' }, fetch, async (url) => {
    const form = new FormData();
    form.append('note', 'no file');
    assert.equal((await fetch(url, { method: 'POST', body: form })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  });
});

test('transcription surfaces upstream failures as 502 without the response body', async () => {
  const fakeFetch = async () => new Response('quota exceeded', { status: 429 });
  await withServer({ elevenLabsApiKey: 'server-key' }, fakeFetch, async (url) => {
    const response = await fetch(url, { method: 'POST', body: audioForm() });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'transcription_failed', upstreamStatus: 429 });
  });
});
