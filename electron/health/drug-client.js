/**
 * Drug Interaction Checker — uses the free NIH RxNorm REST API.
 * No API key required. No license needed.
 *
 * API docs: https://lhncbc.nlm.nih.gov/RxNav/APIs/
 * Interaction data sources: DrugBank + ONCHigh (NIH expert panel)
 */

const BASE_URL = 'https://rxnav.nlm.nih.gov/REST'

/**
 * Search for drugs by name (autocomplete).
 * Returns array of { rxcui, name }.
 */
async function searchDrug(query) {
  try {
    const res = await fetch(`${BASE_URL}/approximateTerm.json?term=${encodeURIComponent(query)}&maxEntries=10`)
    const data = await res.json()
    const candidates = data?.approximateGroup?.candidate || []
    // Deduplicate by name
    const seen = new Set()
    return candidates
      .filter(c => {
        const name = (c.name || '').toLowerCase()
        if (seen.has(name)) return false
        seen.add(name)
        return c.rxcui
      })
      .map(c => ({ rxcui: c.rxcui, name: c.name, score: c.score }))
      .slice(0, 8)
  } catch (err) {
    console.error('[drug-client] search error:', err.message)
    return []
  }
}

/**
 * Get drug info by RxCUI.
 * Returns { rxcui, name, synonym, tty }.
 */
async function getDrugInfo(rxcui) {
  try {
    const res = await fetch(`${BASE_URL}/rxcui/${rxcui}/properties.json`)
    const data = await res.json()
    const props = data?.properties
    return props ? { rxcui: props.rxcui, name: props.name, synonym: props.synonym, tty: props.tty } : null
  } catch (err) {
    console.error('[drug-client] info error:', err.message)
    return null
  }
}

/**
 * Check interactions between multiple drugs.
 * @param {string[]} rxcuis - Array of RxCUI strings
 * @returns {Array<{ drug1, drug2, severity, description, source }>}
 */
async function checkInteractions(rxcuis) {
  if (!rxcuis || rxcuis.length < 2) return []

  try {
    const cuiList = rxcuis.join('+')
    const res = await fetch(`${BASE_URL}/interaction/list.json?rxcuis=${cuiList}`)
    const data = await res.json()

    const interactions = []
    const groups = data?.fullInteractionTypeGroup || []

    for (const group of groups) {
      const source = group.sourceName || 'Unknown'
      const types = group.fullInteractionType || []

      for (const type of types) {
        const pairs = type.interactionPair || []

        for (const pair of pairs) {
          const concepts = pair.interactionConcept || []
          if (concepts.length < 2) continue

          const drug1 = {
            rxcui: concepts[0]?.minConceptItem?.rxcui,
            name: concepts[0]?.minConceptItem?.name,
          }
          const drug2 = {
            rxcui: concepts[1]?.minConceptItem?.rxcui,
            name: concepts[1]?.minConceptItem?.name,
          }

          const severity = normalizeSeverity(pair.severity)

          interactions.push({
            drug1,
            drug2,
            severity,
            description: pair.description || 'Interaction reported',
            source,
          })
        }
      }
    }

    // Sort by severity (most severe first)
    const severityOrder = { contraindicated: 0, serious: 1, moderate: 2, minor: 3, unknown: 4 }
    interactions.sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4))

    return interactions
  } catch (err) {
    console.error('[drug-client] interaction check error:', err.message)
    return []
  }
}

/**
 * Normalize severity string from API to standard levels.
 */
function normalizeSeverity(raw) {
  if (!raw) return 'unknown'
  const s = raw.toLowerCase()
  if (s.includes('contraindic')) return 'contraindicated'
  if (s.includes('high') || s.includes('serious') || s.includes('severe') || s.includes('major')) return 'serious'
  if (s.includes('moderate') || s.includes('significant')) return 'moderate'
  if (s.includes('minor') || s.includes('low')) return 'minor'
  return 'unknown'
}

/**
 * Severity display info.
 */
const SEVERITY_INFO = {
  contraindicated: { label: 'Contraindicated', color: '#d32f2f', emoji: '🚫', description: 'These drugs should NOT be used together' },
  serious:         { label: 'Serious',         color: '#e65100', emoji: '⚠️', description: 'May cause significant harm. Monitor closely or avoid' },
  moderate:        { label: 'Moderate',         color: '#f9a825', emoji: '⚡', description: 'May require dose adjustment or monitoring' },
  minor:           { label: 'Minor',            color: '#2e7d32', emoji: '💊', description: 'Usually not significant. Be aware' },
  unknown:         { label: 'Unknown',          color: '#757575', emoji: '❓', description: 'Interaction reported but severity not classified' },
}

/**
 * Full workflow: search drug names → resolve to RxCUIs → check interactions.
 * @param {string[]} drugNames - Array of drug name strings
 * @returns {{ medications, interactions, errors }}
 */
async function checkDrugInteractions(drugNames) {
  const medications = []
  const errors = []

  // Resolve each drug name to an RxCUI
  for (const name of drugNames) {
    const results = await searchDrug(name)
    if (results.length > 0) {
      medications.push({ input: name, rxcui: results[0].rxcui, resolved: results[0].name })
    } else {
      errors.push(`Could not find drug: "${name}"`)
    }
  }

  // Check interactions
  const rxcuis = medications.map(m => m.rxcui)
  const interactions = await checkInteractions(rxcuis)

  return { medications, interactions, errors }
}

module.exports = {
  searchDrug,
  getDrugInfo,
  checkInteractions,
  checkDrugInteractions,
  SEVERITY_INFO,
}
