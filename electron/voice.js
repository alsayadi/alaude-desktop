/**
 * voice — speech-to-text engine routing for dictation.
 *
 * WHY: the old voice input rode webkitSpeechRecognition, which has NO
 * backend in Electron (fails with 'network') — that's why VOICE_ENABLED
 * was kill-switched in v0.7.41. This module is the real engine: the
 * renderer records mic audio (MediaRecorder, webm/opus) and ships it
 * over the `voice-transcribe` IPC; we route it to the best available
 * backend.
 *
 * BACKEND ORDER (plan: normal-people loop, voice arc)
 *   1. openai  — whisper-1 multipart (cycle 7). Auto-detects language;
 *                strong Arabic/Chinese/English.
 *   2. google  — Gemini inline-audio transcription (cycle 9).
 *   3. local   — on-device engine (Apple SpeechAnalyzer helper, later
 *                cycle; becomes the privacy-respecting default).
 *
 * PRIVACY: cloud backends send the recording to the provider on the
 * user's own key. The renderer labels which backend handled a result
 * (`backend` field) so the UI can disclose "uses your OpenAI key".
 */

const MAX_AUDIO_BYTES = 20 * 1024 * 1024 // whisper accepts 25MB; stay under

/** Pick the best available backend given a key lookup fn. */
function pickBackend(getApiKey) {
  try {
    if (getApiKey('openai')) return 'openai'
    if (getApiKey('google')) return 'google'
  } catch {}
  return null
}

/**
 * Transcribe a recorded clip. Returns { text, backend } on success or
 * { error } — callers render errors as friendly strings, never throw.
 */
async function transcribe({ buffer, mime, lang, getApiKey }) {
  if (!buffer || !buffer.length) return { error: 'empty-audio' }
  if (buffer.length > MAX_AUDIO_BYTES) return { error: 'too-large' }
  const backend = pickBackend(getApiKey)
  if (!backend) return { error: 'no-backend' }
  if (backend === 'openai') return transcribeOpenAI({ buffer, mime, lang, key: getApiKey('openai') })
  if (backend === 'google') return { error: 'backend-pending' } // Gemini route lands in cycle 9
  return { error: 'no-backend' }
}

// OpenAI whisper-1 — multipart upload. Implemented in cycle 7; the
// routing/guard layer above ships first so the renderer pipeline can be
// integration-tested end-to-end with a deterministic response.
async function transcribeOpenAI(_opts) {
  return { error: 'engine-pending' }
}

module.exports = { transcribe, pickBackend, MAX_AUDIO_BYTES }
