// ScopeDetector — figures out WHETHER to auto-create a scope, and WHAT to
// call it. Pure logic + cached IPC calls. No DOM, no store mutation.
//
// Two jobs:
//   1. shouldAutoScope(workspacePath) — returns true if workspace looks
//      like a blank/scratch folder (auto-scope on) or false if it looks
//      like an established project (auto-scope off).
//   2. slugForPrompt(firstPromptText) — derives a short, filesystem-safe
//      folder name from the user's first message.
//
// The project check is cached per workspace path for the duration of the
// session — a folder doesn't flip from "blank" to "project" mid-session,
// and re-checking on every message would be wasteful.

export class ScopeDetector {
  constructor({ api = globalThis.alaude } = {}) {
    this.api = api
    this._projectCache = new Map()  // workspacePath → boolean
  }

  // Is this workspace an existing project?
  async looksLikeProject(workspacePath) {
    if (!workspacePath) return false
    if (this._projectCache.has(workspacePath)) return this._projectCache.get(workspacePath)
    let result = false
    try {
      result = !!(await this.api?.taskScopeLooksLikeProject?.(workspacePath))
    } catch { result = false }
    this._projectCache.set(workspacePath, result)
    return result
  }

  // Opposite — should auto-scope fire for this workspace on a new task?
  async shouldAutoScope(workspacePath) {
    if (!workspacePath) return false
    return !(await this.looksLikeProject(workspacePath))
  }

  invalidateCache(workspacePath) {
    if (workspacePath) this._projectCache.delete(workspacePath)
    else this._projectCache.clear()
  }

  // v0.7.33: is this prompt too trivial to be worth auto-scoping?
  // Trivial = short / no content / conversational filler.
  isTrivialPrompt(text) {
    const t = String(text || '').trim()
    if (!t || t.length < 8) return true
    const words = t.toLowerCase().match(/[a-z0-9]{2,}/g) || []
    const stop = new Set([
      'a','an','the','please','can','you','me','i','my','for','to','with','and','or',
      'is','are','was','were','be','do','does','did','has','have','had',
      'this','that','these','those','it','its','there','here','what','why',
      'how','when','where','which','who',
      'yes','no','ok','okay','sure','thanks','thank','nope','yep',
      'hi','hey','hello','sup',
    ])
    const contentWords = words.filter(w => !stop.has(w))
    return contentWords.length < 2
  }

  // v0.7.37: does this prompt signal the user wants to CREATE something new?
  // Matches: build, create, make, generate, write me, design, code, scaffold,
  //          prototype, draft, start a new …
  // Intentional false-negative: edit/fix/debug verbs are NOT here — those
  // mean "modify existing work", which should NOT trigger subfolder creation.
  hasCreationIntent(text) {
    if (!text) return false
    return /\b(build|create|make|generate|develop|write|design|code|craft|draft|scaffold|prototype|spin\s+up|start\s+a\s+new|set\s+up|initialize|kick\s+off)\b/i.test(text)
  }

  // v0.7.37: explicit user request to create a named subfolder.
  // Examples:
  //   "save this in a folder called game"
  //   "put everything in my-app"
  //   "use a subfolder named todo"
  //   "in folder called finance"
  // Returns { name: "my-app" } on match, null otherwise.
  detectExplicitFolderRequest(text) {
    if (!text) return null
    const patterns = [
      /(?:save|put|create|make|place|keep|store)\s+(?:everything|this|it|them|the\s+files?)?\s*(?:in|into|inside)\s+(?:a\s+)?(?:new\s+)?(?:folder|subfolder|directory|dir)\s+(?:called|named|titled)?\s*["'`]?([a-zA-Z0-9][\w.-]{0,40})["'`]?/i,
      /\b(?:in|into|using)\s+(?:a\s+)?(?:new\s+)?(?:folder|subfolder|directory|dir)\s+(?:called|named|titled)\s+["'`]?([a-zA-Z0-9][\w.-]{0,40})["'`]?/i,
      /\bsubfolder\s+(?:called|named)\s+["'`]?([a-zA-Z0-9][\w.-]{0,40})["'`]?/i,
    ]
    for (const re of patterns) {
      const m = text.match(re)
      if (m && m[1]) {
        // Normalize to filesystem-safe slug
        const clean = m[1].toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
        if (clean) return { name: clean.slice(0, 40) }
      }
    }
    return null
  }

  // v0.7.37: explicit user opt-out. Examples:
  //   "no subfolder"
  //   "don't create a folder"
  //   "use the root"
  //   "in the root directory"
  // v0.8 cycle 43: widened after a dogfood run where the prompt literally
  // said "do not create subfolders" and a subfolder was created anyway.
  // Three separate misses in the old pattern:
  //   · "do not" — only the contraction "don't" was handled
  //   · "subfolders" — only the singular matched
  //   · "work in this folder" / "directly in this folder" — the most
  //     natural way to say it wasn't covered at all
  // Being generous here is the safe direction: a false positive just means
  // files land in the folder the user pointed at, which is what they asked
  // for. A false negative hides their data from the agent.
  detectExplicitNoFolder(text) {
    if (!text) return false
    const t = String(text)
    const noFolder = /\b(?:no\s+(?:new\s+)?(?:folder|subfolder|dir|directory)s?|use\s+(?:the\s+)?root|in\s+(?:the\s+)?root|(?:don'?t|do\s+not|never|avoid)\s+(?:make|create|creating|use|using|add|adding)\s+(?:a\s+|any\s+)?(?:new\s+)?(?:folder|subfolder|dir|directory)s?|skip\s+(?:the\s+)?(?:folder|subfolder)s?)\b/i
    // "work in this folder", "directly in the current directory", "right here"
    // The object can sit between the verb and the preposition — "save IT in
    // the current directory", "keep EVERYTHING in this folder", "write THE
    // FILES into my workspace". Up to three words, non-greedy.
    const workHere = /\b(?:work|save|write|put|keep|store|create)\s+(?:\w+\s+){0,3}?(?:directly\s+)?(?:in|into|inside)\s+(?:this|the\s+current|the\s+existing|my)\s+(?:folder|dir|directory|workspace)\b/i
    return noFolder.test(t) || workHere.test(t)
  }

  // ── slug generation ──────────────────────────────────────────
  // Rules:
  //   - Strip markdown/code fences/URLs
  //   - Lowercase, keep only [a-z0-9-]
  //   - Collapse dashes, trim
  //   - Stop at ~3-5 content words (max 32 chars)
  //   - Append date suffix YYYYMMDD
  //   - Fallback: "task-{date}"
  slugForPrompt(firstPromptText) {
    const today = new Date()
    const dateSfx = today.toISOString().slice(0, 10).replace(/-/g, '')
    const text = String(firstPromptText || '').trim()
    if (!text) return `task-${dateSfx}`

    // Strip code fences / obvious non-prose content
    const stripped = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\w+@\w+\.\w+/g, ' ')
      .toLowerCase()

    // Drop common filler verbs / stopwords that add no signal in a slug
    const stop = new Set([
      'a','an','the','please','can','you','me','i','my','for','to','with','and','or',
      'build','make','create','help','need','want','write','generate','give','show',
      'this','that','these','those','new','some','any','it','its','app','thing',
      'thats','lets','really','very','quick','simple','basic','nice','cool',
    ])

    const tokens = stripped
      .match(/[a-z0-9]{2,}/g)   // alnum chunks of ≥2 chars
      ?.filter(w => !stop.has(w)) || []

    if (!tokens.length) return `task-${dateSfx}`

    // Take first 4 content words — enough to be meaningful without being noisy
    const picked = tokens.slice(0, 4).join('-')
    // Hard-cap at 32 chars before the date suffix
    const trimmed = picked.length > 32 ? picked.slice(0, 32).replace(/-+$/, '') : picked
    if (!trimmed) return `task-${dateSfx}`

    return `${trimmed}-${dateSfx}`
  }
}
