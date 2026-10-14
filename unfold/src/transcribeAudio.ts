import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { API_BASE_URL } from './api';
import { readTranscript } from './lib/transcriptText';

// The Unfold server relays the recording to ElevenLabs Scribe v2 and keeps the key private.
const ENDPOINT = `${API_BASE_URL}/api/transcribe`;

export type TranscribePhase = 'preparing' | 'transcribing';

async function appendAudio(form: FormData, uri: string) {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read the recording');
    const blob = await response.blob();
    if (blob.size === 0) throw new Error('The recording is empty');
    form.append('file', blob, blob.type.includes('webm') ? 'recording.webm' : 'recording.m4a');
    return;
  }
  // Expo's fetch only accepts Blob or a file with bytes(). A { uri, name, type } part throws
  // "Unsupported FormDataPart implementation".
  const file = new File(uri);
  if (!file.exists || file.size === 0) throw new Error('Could not read the recording');
  form.append('file', file);
}

export async function transcribeRecording(audioUri: string, onPhase?: (phase: TranscribePhase) => void): Promise<string> {
  if (!audioUri) return '';
  onPhase?.('preparing');
  const form = new FormData();
  await appendAudio(form, audioUri);
  onPhase?.('transcribing');
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    body: form,
  });
  if (response.status === 503) throw new Error('Voice transcription is not set up on the server (ELEVENLABS_API_KEY)');
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Transcription failed (${response.status}): ${detail}`);
  }
  return readTranscript(await response.json());
}

export async function retainRecording(uri?: string): Promise<string | undefined> {
  if (!uri) return undefined;
  if (!uri.startsWith('blob:') || typeof fetch !== 'function' || typeof URL === 'undefined') return uri;
  try {
    const blob = await (await fetch(uri)).blob();
    if (blob.size === 0) return undefined;
    return URL.createObjectURL(blob);
  } catch {
    return uri;
  }
}
