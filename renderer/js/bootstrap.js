// bootstrap.js — wires the memory + profile modules together and exposes
// the specific entry points the monolithic index.html inline script still
// expects via window.* aliases.
//
// Pattern: one factory `bootMemorySystem(ctx)` takes the bits of global
// state the modules need (getters, not values, so they always read fresh),
// plus shared UI helpers. Returns { memory, profile, recall, embeddings, ui, profileUI }.
// The inline script in index.html calls this once, then wires window aliases
// so inline onclick="..." handlers keep working.
//
// This file deliberately has ZERO direct DOM queries — those all live in
// the UI modules. Bootstrap is just glue.

import { MemoryStore } from './memory/memory-store.js'
import { MemoryEmbeddings } from './memory/memory-embeddings.js'
import { MemoryRecall } from './memory/memory-recall.js'
import { MemoryExtract, PROFILE_CATEGORIES } from './memory/memory-extract.js'
import { MemoryUI } from './memory/memory-ui.js'
import { ProfileStore } from './profile/profile-store.js'
import { ProfileUI } from './profile/profile-ui.js'

export function bootMemorySystem({
  getWorkspace,           // () => string | null
  getMessages,            // () => Message[]  (the chat messages array)
  getCurrentSessionId,    // () => string
  toast,                  // (msg, isError?) => void   (showRewindToast)
  escapeHtml,             // (s) => string
  renderMessages,         // () => void
  persistSessions,        // () => void
} = {}) {
  // ── data layer ────────────────────────────────────────────────
  const store = new MemoryStore()
  const profileStore = new ProfileStore()
  const embeddings = new MemoryEmbeddings({ store })

  // Incognito is a transient flag — owned by bootstrap so both MemoryUI
  // and the external send-flow gate (in index.html) share one source.
  let incognito = false
  const getIncognito = () => incognito
  const setIncognito = (v) => { incognito = !!v }

  const recall = new MemoryRecall({
    store,
    embeddings,
    getIncognito,
    getCurrentWorkspace: getWorkspace,
  })

  // ── UI layer ──────────────────────────────────────────────────
  const memoryUI = new MemoryUI({
    store,
    embeddings,
    recall,
    profileStore,
    getWorkspace,
    getIncognito,
    setIncognito,
    toast,
    escapeHtml,
  })
  const profileUI = new ProfileUI({
    store: profileStore,
    memoryUI,
    toast,
    renderMessages,
    persistSessions,
  })

  // ── back-compat: inline HTML `onclick="..."` handlers expect these ─
  // We attach UIs to dedicated namespaces (__memUI, __profileUI) AND
  // surface the specific named functions the existing markup references.
  const win = globalThis.window || globalThis
  win.__memSys = { store, profileStore, embeddings, recall, extract: MemoryExtract, PROFILE_CATEGORIES, getIncognito, setIncognito }
  win.__memUI = memoryUI
  win.__profileUI = profileUI

  // Named-function aliases matching what the existing HTML markup calls.
  // (Kept exhaustive so we can grep-verify every inline handler works.)
  win.toggleMemoryModal = () => memoryUI.toggleModal()
  win.renderMemoryModal = () => memoryUI.renderList()
  win.setMemoryScopeFilter = (f) => memoryUI.setScopeFilter(f)
  win.memoryEdit = (id) => memoryUI.editEntry(id)
  win.memoryDelete = (id) => memoryUI.deleteEntry(id)
  win.memoryClearAll = () => memoryUI.clearAll()
  win.memoryToggleScope = (id) => memoryUI.toggleScope(id)
  win.memoryAddBulk = () => memoryUI.addBulk()
  win.memoryImportFile = () => memoryUI.importFile()
  win.memoryImportFromInput = (ev) => memoryUI.importFromInput(ev)
  win.memoryExport = () => memoryUI.exportAll()
  win.setMemoryRecallMode = (mode) => memoryUI.setRecallMode(mode)
  win.reindexMemoryEmbeddings = () => memoryUI.reindex()
  win.installSemanticEmbedModel = () => memoryUI.installEmbedModel()
  win.refreshMemorySemanticStatus = () => memoryUI.refreshSemanticStatus()
  win.setMemoryIncognito = (on) => memoryUI.onIncognitoChange(on)

  // Remember button — needs messages + currentSessionId snapshot at click time.
  win.memoryRememberMessage = (idx, ev) => memoryUI.rememberMessage(idx, ev, {
    messages: getMessages(),
    currentSessionId: getCurrentSessionId(),
  })

  // Profile handlers
  win.profileAddFromUI = () => profileUI.addFromUI()
  win.profileEditInline = (id) => profileUI.editInline(id)
  win.profileRemoveAndRefresh = (id) => profileUI.removeAndRefresh(id)
  win.profileClearAll = () => profileUI.clearAll()
  win.profileOnboardingClose = (save) => profileUI.closeOnboarding(save)
  win.showProfileOnboarding = () => profileUI.showOnboarding()
  win.shouldShowProfileOnboarding = () => profileStore.shouldShowOnboarding()
  win.profilePromoteAccept = (msgIdx, candIdx) => profileUI.promoteAccept(msgIdx, candIdx, getMessages())
  win.profilePromoteDismiss = (msgIdx, candIdx) => profileUI.promoteDismiss(msgIdx, candIdx, getMessages())

  // Fire-and-forget auto-embed after add() calls from outside the UI
  // (e.g. the auto-extract path in index.html).
  win.__memEmbedAsync = (entry) => embeddings.ensureForEntry(entry).catch(() => {})

  // Drop-in replacement for the legacy inline `memoryAdd()` — adds to the
  // store AND fires the background embed, matching the old semantics.
  win.memoryAdd = (text, source, opts) => {
    const entry = store.add(text, source, opts)
    if (entry) embeddings.ensureForEntry(entry).catch(() => {})
    return entry
  }

  // The promote-chip rendering code (still in index.html until the chat
  // view itself is refactored) reads the canonical category list directly.
  win.PROFILE_CATEGORIES = PROFILE_CATEGORIES

  // Backup / restore compatibility — the full-backup export + import flow
  // in index.html (around the exportFullBackup / importFullBackup functions)
  // reads the live memories array by name. A getter proxy keeps those
  // call sites working without rewriting them.
  try {
    Object.defineProperty(win, 'memories', {
      configurable: true,
      get() { return store.entries },
    })
    Object.defineProperty(win, 'profile', {
      configurable: true,
      get() { return profileStore.entries },
    })
  } catch {}
  win.saveMemories = () => store.save()
  win.saveProfile = () => profileStore.save()

  // Convenience: a pre-built inject() that the send flow calls each turn.
  // Passes in a profile-block builder so incognito logic stays inside recall.
  win.__memInjectIntoLastUser = (cleanMsgs, queryText) =>
    recall.injectIntoLastUser(cleanMsgs, queryText, () => profileStore.getSystemBlock())

  // Expose the classic two-shot extract pair for the send flow.
  win.__memExtract = (text) => MemoryExtract.extract(text)
  win.__memExtractProfileCandidates = (text) =>
    MemoryExtract.extractProfileCandidates(text, profileStore.all())

  // ── v0.7.33: universal "no stuck overlay" reset on boot ──────
  //
  // ROOT CAUSE of the recurring "can't click workspace-bar" bug:
  //   The app has 15+ modal-overlay elements plus command-palette +
  //   shortcuts + tgraph + gsearch + drop + ptt overlays. They use THREE
  //   different open conventions (`.show` class / inline `display:flex` /
  //   both). Any one leaking an open state invisibly covers the workspace
  //   bar because .modal-overlay is position:fixed; inset:0; z-index:100.
  //
  //   The old boot-guard only covered 2 of those modals. Every new modal
  //   we ship broke the guard silently. This reset is SELECTOR-BASED so
  //   whatever future overlays land are handled automatically.
  //
  // What it does, per element matching the selector below:
  //   1. Remove `.show` class (handles class-based opens)
  //   2. Clear any inline style.display (handles inline-flex opens)
  //   3. Log the cleanup if it actually changed anything — so if the bug
  //      re-appears we have evidence of which element was stuck.
  try {
    const doc = globalThis.document
    if (doc) {
      const OVERLAY_SELECTOR = [
        '.modal-overlay',
        '.cmd-palette-overlay',
        '.shortcuts-overlay',
        '.tgraph-overlay',
        '.gsearch-overlay',
        '.drop-overlay',
        '.ptt-overlay',
      ].join(',')
      const cleared = []
      doc.querySelectorAll(OVERLAY_SELECTOR).forEach(el => {
        const hadShow = el.classList.contains('show')
        const hadInlineFlex = el.style && el.style.display === 'flex'
        if (hadShow || hadInlineFlex) {
          cleared.push({ id: el.id || '(no id)', class: el.className, hadShow, hadInlineFlex })
        }
        if (hadShow) el.classList.remove('show')
        // v0.7.48 FIX: clear the inline display entirely (don't set to 'none').
        // An inline `display:none` beats the CSS `.modal-overlay.show { display:
        // flex }` rule by specificity, which silently broke every modal that
        // opens via classList.add('show') alone (Keys, Map, Insights, Skills
        // — everything except Local Models which sets inline 'flex' itself).
        // Using removeProperty lets the CSS default (display:none on .modal-
        // overlay and display:flex on .modal-overlay.show) own visibility.
        if (el.style) el.style.removeProperty('display')
      })
      // Also remove any leaked image-lightbox (z-index:9999, created in JS).
      const lb = doc.getElementById('alaude-lightbox')
      if (lb) { cleared.push({ id: 'alaude-lightbox', note: 'leaked lightbox' }); lb.remove() }
      if (cleared.length) {
        console.warn('[v0.7.33] Cleared stuck overlays on boot:', cleared)
      }
    }
  } catch (err) {
    console.warn('[v0.7.33] Overlay reset failed:', err)
  }

  return { store, profileStore, recall, embeddings, memoryUI, profileUI, getIncognito, setIncognito }
}
