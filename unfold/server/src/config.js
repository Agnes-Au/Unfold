import 'dotenv/config';
import { fileURLToPath } from 'node:url';

/**
 * Central configuration. All values come from the server environment only.
 * The GEMINI_API_KEY must never be shipped to the Expo client or
 * worker-web; only this server may call the Gemini API.
 */
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 8787),
    dbPath: env.DB_PATH || './unfold.db',
    // Explicit opt-in only; a deployed demo sets DEMO_MODE=1 even with NODE_ENV=production.
    demoMode: env.DEMO_MODE === '1',
    jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
    elevenLabsApiKey: env.ELEVENLABS_API_KEY || '',
    // Built front-ends served by this server when present (see the root package.json build).
    studentWebDir: env.STUDENT_WEB_DIR || fileURLToPath(new URL('../../dist', import.meta.url)),
    workerWebDir: env.WORKER_WEB_DIR || fileURLToPath(new URL('../../worker-web/dist', import.meta.url)),
    geminiApiKey: env.GEMINI_API_KEY || '',
    geminiBaseUrl: env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    genaiModel: env.GENAI_MODEL || 'gemini-3.8-flash',
    unclaimedTimeoutHours: Number(env.UNCLAIMED_TIMEOUT_HOURS || 72),
    responseTimeoutHours: Number(env.RESPONSE_TIMEOUT_HOURS || 48),
  };
}

export const config = loadConfig();
