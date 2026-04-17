le# Alaude v0.2.3 — Manual Test Plan

A scripted walkthrough to exercise every new feature shipped in v0.2.2 + v0.2.3.
Copy-paste the bold prompts one at a time. Each step tells you what to verify.

> **Setup:** launch Alaude 0.2.3. Pick any model with a key already configured
> (GPT-4o mini is fastest). If you only have Ollama, pick any local model.

---

## Test 1 — Baseline chat (sanity)

1. Type: **`What's 2+2? Answer in one word.`** → Enter
2. Type: **`And 3+3?`** → Enter
3. Type: **`And 4+4?`** → Enter

**Verify:**
- [ ] Three assistant replies, streaming smoothly (no flicker from v0.2.1 bug)
- [ ] Each assistant message has a 📋 Copy button on hover
- [ ] The **last** assistant message shows `↻ Regenerate`
- [ ] Earlier assistant messages show `↶ Rewind` + `⎇ Branch` (NEW)

---

## Test 2 — Conversation Minimap (v0.2.2)

After Test 1 you have 6 messages (3 user + 3 assistant).

**Verify:**
- [ ] A horizontal strip appeared above the chat labelled "TIMELINE"
- [ ] 6 colored dots: gray = user, green = assistant
- [ ] Hover a dot → preview tooltip shows the first 80 chars
- [ ] Click the first dot → smoothly scrolls to the first message
- [ ] Scroll manually → the dot(s) of the visible message grow larger (live "you are here" cursor)

---

## Test 3 — Rewind + Undo (v0.2.2)

1. On the **first** assistant reply ("4" or similar), click **`↶ Rewind`**

**Verify:**
- [ ] Messages 2 & 3 (both user and assistant) **fade + blur out** with a sliding animation
- [ ] After ~320ms they're gone — the chat now ends at the first exchange
- [ ] A toast appears at the bottom: *"↶ Rewound 4 msgs — saved as branch."* with an **undo** link
- [ ] The sidebar now shows a new branch session above the original:
  - Title starts with `⎇`
  - Indented with a connector line
  - Has a fork-mark glyph on hover tooltip reads *"(fork of …)"*

2. Click **undo** in the toast within 4 seconds

**Verify:**
- [ ] All 6 messages are restored in the same session
- [ ] The branch that was created has been removed from the sidebar
- [ ] Toast flashes: *"↷ Restored"*

---

## Test 4 — Branch (v0.2.2)

1. On the **second** assistant reply ("6"), click **`⎇ Branch`**

**Verify:**
- [ ] You're now in a **new session** — title starts with `⎇`
- [ ] This new session contains the first 4 messages (up through "6")
- [ ] The sidebar shows the original session unchanged, and the new branch indented beneath/above it
- [ ] The input is focused

2. Type: **`Actually, let's talk about colors instead. What's your favorite?`** → Enter

**Verify:**
- [ ] The branch diverges cleanly from the original's math-thread
- [ ] Switching back to the parent session (click it in sidebar) shows the full 6-message math conversation intact

---

## Test 5 — Thinking Graph (v0.2.3)

Make sure you have at least 3 sessions: the original math chat, the branch from Test 4, and create one more via **⌘N** → type **`Hello`** → Enter.

1. Press **⌘⇧M** (or click 🌳 Map in the top bar)

**Verify:**
- [ ] Full-screen overlay appears with a dotted-grid background
- [ ] Title bar: *"🌳 Thinking Graph"* + stats like *"3 sessions · 1 branch · 2 roots"*
- [ ] 3 nodes visible — two roots side-by-side at depth 0, one branch at depth 1
- [ ] Each node card shows: title, *"forked @ msg N"* or *"root"*, timestamp, N msgs
- [ ] A **smooth curve** connects parent → branch
- [ ] The **current** session has a green border + green glow + thicker green edge
- [ ] Graph auto-scrolls so the current session is centered

2. Click a different node

**Verify:**
- [ ] Graph closes
- [ ] You're now in that session (messages match, sidebar highlights it)

3. Press **⌘P** → type `map` → Enter

**Verify:**
- [ ] Command palette finds "🌳 Thinking Graph" via fuzzy search
- [ ] Opens the graph

4. Press **Esc** while graph is open

**Verify:**
- [ ] Graph closes smoothly

---

## Test 6 — Deep branching (stress)

1. Start a fresh session (⌘N). Ask: **`List 5 programming languages`**
2. After the reply, click **⎇ Branch** on that reply
3. In the branch, ask: **`Now pick the best one for web frontend`**
4. After that reply, click **⎇ Branch** again
5. In this sub-branch, ask: **`Give me a hello world in that language`**
6. Switch back to the root session, click **⎇ Branch** on the original list
7. Ask: **`Pick the best one for systems programming`**

Now you have a root with 2 sibling branches and one of those has a sub-branch.

**Verify in the Thinking Graph (⌘⇧M):**
- [ ] Tree is 3 levels deep
- [ ] The root sits at top with 2 children side-by-side
- [ ] One child has its own child beneath it
- [ ] Siblings are spaced so they don't overlap
- [ ] Curves connect parents to children cleanly without crossing any unrelated node

---

## Test 7 — Persistence

1. Press **⌘Q** to fully quit Alaude
2. Relaunch from Applications

**Verify:**
- [ ] All sessions including branches reappear in the sidebar
- [ ] Branches still indented with `⎇` mark
- [ ] ⌘⇧M still shows the same tree shape
- [ ] Rewind/Branch buttons still work on old messages (feature is retroactive)

---

## Test 8 — Regression guards

These verify **old behavior still works** (the new features shouldn't have broken anything):

- [ ] ⌘K focuses the input
- [ ] ⌘P opens command palette
- [ ] ⌘N creates a new session
- [ ] ⌘⇧L toggles dark/light theme
- [ ] ⌘⇧C toggles Council mode
- [ ] Streaming a response still shows smooth surgical updates (no flicker)
- [ ] Copy button on a message copies to clipboard
- [ ] Save button writes to file
- [ ] Regenerate re-runs the last turn
- [ ] Sessions < 4 messages don't show the minimap (no clutter)

---

## Known edge cases to probe

- **Empty sessions:** the Thinking Graph should still render a node (shows "0 msgs")
- **Very long session titles:** should truncate with `…` in graph nodes
- **Many branches (10+):** canvas should grow horizontally and scroll
- **Rewind on the last assistant message:** button shouldn't appear (nothing to rewind to)
- **Branch on first user message:** creates a 1-message branch — minimap hides until ≥ 4 msgs

---

## Reporting issues

If anything misbehaves, note:
- Which step number
- What you saw vs. what this doc said to expect
- Open **View → Toggle Developer Tools** in Alaude and check Console for red errors
- Paste the error + step into a new session and I'll debug it
