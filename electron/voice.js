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
 * `_fetch` is injectable so tests never touch the network.
 */
async function transcribe({ buffer, mime, lang, getApiKey, _fetch }) {
  if (!buffer || !buffer.length) return { error: 'empty-audio' }
  if (buffer.length > MAX_AUDIO_BYTES) return { error: 'too-large' }
  const backend = pickBackend(getApiKey)
  if (!backend) return { error: 'no-backend' }
  if (backend === 'openai') return transcribeOpenAI({ buffer, mime, lang, key: getApiKey('openai'), _fetch })
  if (backend === 'google') return { error: 'backend-pending' } // Gemini route lands in cycle 9
  return { error: 'no-backend' }
}

// OpenAI whisper-1 — multipart upload on the user's own key (cycle 7).
// Whisper auto-detects language; a 2-letter hint from the UI locale
// improves short-clip accuracy for Arabic/Chinese without ever being
// wrong for mixed speech (it's a hint, not a constraint).
async function transcribeOpenAI({ buffer, mime, lang, key, _fetch }) {
  const doFetch = _fetch || fetch
  try {
    const form = new FormData()
    const ext = /webm/.test(mime || '') ? 'webm' : /mp4|m4a/.test(mime || '') ? 'mp4' : 'bin'
    form.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), 'audio.' + ext)
    form.append('model', 'whisper-1')
    if (lang && /^[a-z]{2}$/i.test(lang)) form.append('language', lang.toLowerCase())
    const res = await doFetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: form,
      signal: AbortSignal.timeout(45000),
    })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { error: 'key-rejected' }
      if (res.status === 429) return { error: 'rate-limited' }
      const detail = await res.text().then(s => s.slice(0, 200)).catch(() => '')
      return { error: 'stt-http-' + res.status, detail }
    }
    const data = await res.json()
    const text = String(data?.text || '').trim()
    if (!text) return { error: 'no-speech' }
    return { text, backend: 'openai' }
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { error: 'stt-timeout' }
    return { error: 'stt-network', detail: String(err?.message || err).slice(0, 200) }
  }
}

module.exports = { transcribe, pickBackend, MAX_AUDIO_BYTES }
