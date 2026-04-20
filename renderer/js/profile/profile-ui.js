// ProfileUI — About You add-form + onboarding modal + approval-chip handlers.
//
// Split from MemoryUI because the surfaces are different:
//   - ProfileUI owns the "+ Add" row in the About You section
//   - ProfileUI owns the onboarding modal shown once on first Memory Lens open
//   - ProfileUI owns the green approval-chip handlers fired from user messages
//
// MemoryUI renders the About You LIST (it's inside the Memory Lens modal),
// so for list refreshes we call memoryUI.renderProfileList() — one owner
// per DOM surface, but both UIs collaborate on the shared modal.

export class ProfileUI {
  constructor({ store, memoryUI, toast, renderMessages, persistSessions }) {
    this.store = store
    this.memoryUI = memoryUI
    this.toast = toast || (() => {})
    this.renderMessages = renderMessages || (() => {})
    this.persistSessions = persistSessions || (() => {})
  }

  // ── quick-add row inside the About You section ────────────────
  addFromUI() {
    const inp = document.getElementById('profile-add-text')
    const sel = document.getElementById('profile-add-cat')
    if (!inp) return
    const t = inp.value.trim()
    if (!t) return
    const added = this.store.add(t, sel?.value || 'context')
    if (added) {
      inp.value = ''
      this.memoryUI.renderProfileList()
      this.toast(`👤 Added to profile`, false)
    } else {
      this.toast('Already in profile (or too long)', false)
    }
  }

  editInline(id) {
    const p = this.store.find(id)
    if (!p) return
    const edited = prompt(`Edit "${p.category}" fact:`, p.text)
    if (edited == null) return
    if (this.store.edit(id, edited)) this.memoryUI.renderProfileList()
  }

  removeAndRefresh(id) {
    this.store.remove(id)
    this.memoryUI.renderProfileList()
  }

  clearAll() {
    if (!confirm('Clear all profile facts? This cannot be undone.')) return
    this.store.clearAll()
    this.memoryUI.renderProfileList()
  }

  // ── onboarding modal (one-time) ───────────────────────────────
  showOnboarding() {
    const el = document.getElementById('profile-onboard-modal')
    if (!el) return
    el.classList.add('show')
    el.style.display = 'flex'
    setTimeout(() => document.getElementById('onb-name')?.focus(), 60)
  }
  closeOnboarding(save) {
    if (save) {
      const name = (document.getElementById('onb-name')?.value || '').trim()
      const tools = (document.getElementById('onb-tools')?.value || '').trim()
      const prefs = (document.getElementById('onb-prefs')?.value || '').trim()
      const ctx = (document.getElementById('onb-context')?.value || '').trim()
      let added = 0
      if (name && this.store.add(`Call me ${name}`, 'identity')) added++
      if (tools && this.store.add(`Main stack: ${tools}`, 'tools')) added++
      if (prefs && this.store.add(prefs, 'preferences')) added++
      if (ctx && this.store.add(ctx, 'context')) added++
      if (added) this.toast(`👤 Saved ${added} profile fact${added === 1 ? '' : 's'}`, false)
    }
    this.store.markOnboarded()
    const el = document.getElementById('profile-onboard-modal')
    if (el) { el.classList.remove('show'); el.style.display = 'none' }
    this.memoryUI.renderProfileList()
  }

  // ── approval chip (Cursor-style) — promote episodic → profile ─
  promoteAccept(msgIdx, candIdx, messagesRef) {
    const msg = messagesRef?.[msgIdx]
    const cand = msg?.profileCandidates?.[candIdx]
    if (!cand) return
    const added = this.store.add(cand.text, cand.category)
    cand._accepted = true
    if (added) {
      this.toast(`👤 Saved to profile`, false)
    } else {
      this.toast('Already in profile', false)
    }
    this.renderMessages()
    this.persistSessions()
  }
  promoteDismiss(msgIdx, candIdx, messagesRef) {
    const msg = messagesRef?.[msgIdx]
    const cand = msg?.profileCandidates?.[candIdx]
    if (!cand) return
    cand._dismissed = true
    this.renderMessages()
    this.persistSessions()
  }
}
