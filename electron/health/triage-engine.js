/**
 * Symptom Triage Engine — hardcoded red-flag rules for emergency detection.
 * These rules are DETERMINISTIC and never rely on LLM judgment.
 *
 * The LLM handles conversational symptom gathering, but every response
 * is screened through this engine before display.
 */

const TRIAGE_LEVELS = {
  EMERGENCY: { level: 1, label: 'Emergency', color: '#d32f2f', action: 'Call 911 / Go to ER immediately' },
  URGENT:    { level: 2, label: 'Urgent',    color: '#e65100', action: 'See a doctor within 24 hours' },
  SOON:      { level: 3, label: 'Soon',      color: '#f9a825', action: 'Schedule appointment this week' },
  ROUTINE:   { level: 4, label: 'Routine',   color: '#2e7d32', action: 'Schedule routine appointment' },
  SELF_CARE: { level: 5, label: 'Self-Care', color: '#1565c0', action: 'Home care with monitoring' },
}

// ── Crisis Resources ─────────────────────────────────────────────────────────

const CRISIS_RESOURCES = {
  emergency: '911 (or your local emergency number)',
  suicide: '988 Suicide & Crisis Lifeline (call or text 988)',
  crisis_text: 'Crisis Text Line: text HOME to 741741',
  poison: 'Poison Control: 1-800-222-1222',
  domestic: 'National Domestic Violence Hotline: 1-800-799-7233',
}

// ── Red Flag Rules ───────────────────────────────────────────────────────────

const RED_FLAG_RULES = [
  // === CARDIAC EMERGENCIES ===
  {
    id: 'chest_pain_cardiac',
    keywords: ['chest pain', 'chest pressure', 'chest tightness', 'crushing chest'],
    amplifiers: ['radiating to arm', 'jaw pain', 'sweating', 'nausea', 'shortness of breath', 'dizziness'],
    triage: 'EMERGENCY',
    message: 'Chest pain with these symptoms may indicate a heart attack. Call 911 immediately.',
    action: 'Call 911. Chew an aspirin (325mg) if not allergic. Do not drive yourself.',
  },
  {
    id: 'sudden_sob',
    keywords: ['sudden shortness of breath', 'can\'t breathe', 'severe difficulty breathing', 'gasping'],
    triage: 'EMERGENCY',
    message: 'Sudden severe difficulty breathing is a medical emergency.',
    action: 'Call 911. Sit upright. If you have an inhaler, use it.',
  },

  // === NEUROLOGICAL EMERGENCIES ===
  {
    id: 'stroke_signs',
    keywords: ['sudden weakness one side', 'face drooping', 'arm weakness', 'speech difficulty', 'sudden confusion'],
    amplifiers: ['sudden onset', 'numbness one side', 'vision loss one eye'],
    triage: 'EMERGENCY',
    message: 'These may be signs of STROKE. Remember FAST: Face, Arms, Speech, Time.',
    action: 'Call 911 immediately. Note the time symptoms started — this is critical for treatment.',
  },
  {
    id: 'worst_headache',
    keywords: ['worst headache of my life', 'thunderclap headache', 'sudden severe headache'],
    triage: 'EMERGENCY',
    message: 'A sudden, severe "worst headache of your life" could indicate a brain hemorrhage.',
    action: 'Go to the ER immediately. Do not wait.',
  },
  {
    id: 'seizure_first',
    keywords: ['seizure', 'convulsion', 'uncontrollable shaking'],
    amplifiers: ['first time', 'never had before', 'lasted more than 5 minutes'],
    triage: 'EMERGENCY',
    message: 'A first-time seizure or prolonged seizure requires emergency evaluation.',
    action: 'Call 911. Do not put anything in the person\'s mouth. Turn them on their side.',
  },

  // === ALLERGIC EMERGENCIES ===
  {
    id: 'anaphylaxis',
    keywords: ['throat swelling', 'tongue swelling', 'difficulty swallowing', 'hives all over', 'severe allergic reaction'],
    amplifiers: ['after eating', 'after medication', 'bee sting', 'can\'t breathe'],
    triage: 'EMERGENCY',
    message: 'This may be anaphylaxis — a life-threatening allergic reaction.',
    action: 'Use epinephrine (EpiPen) if available. Call 911 immediately.',
  },

  // === MENTAL HEALTH CRISIS ===
  {
    id: 'suicidal',
    keywords: ['suicidal', 'want to die', 'kill myself', 'end my life', 'no reason to live', 'better off dead'],
    triage: 'EMERGENCY',
    message: 'If you or someone you know is having thoughts of suicide, please reach out for help immediately.',
    action: `Call 988 (Suicide & Crisis Lifeline) or text HOME to 741741 (Crisis Text Line). You are not alone.`,
    resources: ['suicide', 'crisis_text'],
  },
  {
    id: 'self_harm',
    keywords: ['self harm', 'cutting myself', 'hurting myself', 'self-injury'],
    triage: 'EMERGENCY',
    message: 'If you are harming yourself, please reach out for support.',
    action: 'Call 988 (Suicide & Crisis Lifeline) or text HOME to 741741.',
    resources: ['suicide', 'crisis_text'],
  },

  // === ABDOMINAL EMERGENCIES ===
  {
    id: 'severe_abdominal',
    keywords: ['severe abdominal pain', 'worst stomach pain', 'rigid abdomen'],
    amplifiers: ['vomiting blood', 'bloody stool', 'black stool', 'fever', 'can\'t stand up'],
    triage: 'EMERGENCY',
    message: 'Severe abdominal pain with these symptoms may indicate a surgical emergency.',
    action: 'Go to the ER. Do not eat or drink anything.',
  },

  // === BLEEDING ===
  {
    id: 'severe_bleeding',
    keywords: ['uncontrolled bleeding', 'won\'t stop bleeding', 'arterial bleeding', 'spurting blood'],
    triage: 'EMERGENCY',
    message: 'Severe uncontrolled bleeding is a medical emergency.',
    action: 'Apply direct pressure with a clean cloth. Call 911. Elevate the wound above the heart if possible.',
  },
  {
    id: 'vomiting_blood',
    keywords: ['vomiting blood', 'coughing blood', 'blood in vomit', 'hematemesis'],
    triage: 'EMERGENCY',
    message: 'Vomiting or coughing blood requires immediate medical attention.',
    action: 'Go to the ER immediately.',
  },

  // === URGENT (24 hours) ===
  {
    id: 'high_fever',
    keywords: ['fever over 103', 'fever 104', 'fever 105', 'very high fever'],
    amplifiers: ['stiff neck', 'confusion', 'rash', 'not responding to medication'],
    triage: 'URGENT',
    message: 'A very high fever, especially with stiff neck or confusion, needs urgent evaluation.',
    action: 'See a doctor today or go to urgent care. Take acetaminophen/ibuprofen for fever reduction.',
  },
  {
    id: 'dehydration_severe',
    keywords: ['not urinating', 'no urine', 'severe dehydration', 'sunken eyes'],
    amplifiers: ['can\'t keep fluids down', 'dizziness standing up', 'rapid heartbeat'],
    triage: 'URGENT',
    message: 'Severe dehydration can be dangerous, especially in children and elderly.',
    action: 'Seek medical attention today. Try small sips of oral rehydration solution.',
  },
  {
    id: 'sudden_vision',
    keywords: ['sudden vision change', 'sudden blurry vision', 'floaters suddenly', 'curtain over vision'],
    triage: 'URGENT',
    message: 'Sudden vision changes may indicate retinal detachment or other serious eye condition.',
    action: 'See an eye doctor or go to the ER today.',
  },
  {
    id: 'deep_wound',
    keywords: ['deep cut', 'deep wound', 'bone visible', 'tendon visible', 'gaping wound'],
    triage: 'URGENT',
    message: 'Deep wounds may need stitches and should be evaluated within hours.',
    action: 'Apply pressure. Go to urgent care or ER for stitches. Clean the wound gently.',
  },

  // === SOON (This week) ===
  {
    id: 'persistent_fever',
    keywords: ['fever for days', 'fever won\'t go away', 'fever for a week'],
    triage: 'SOON',
    message: 'A persistent fever lasting more than a few days should be evaluated.',
    action: 'Schedule an appointment this week. Keep tracking your temperature.',
  },
  {
    id: 'unexplained_weight',
    keywords: ['unexplained weight loss', 'losing weight without trying', 'unintentional weight loss'],
    triage: 'SOON',
    message: 'Unexplained weight loss of more than 5% in 6-12 months warrants medical evaluation.',
    action: 'Schedule an appointment with your doctor this week.',
  },
  {
    id: 'new_lump',
    keywords: ['new lump', 'new mass', 'growing lump', 'swollen lymph node'],
    amplifiers: ['hard', 'painless', 'growing', 'doesn\'t move'],
    triage: 'SOON',
    message: 'New lumps or masses should be evaluated by a healthcare provider.',
    action: 'Schedule an appointment this week. Don\'t panic — most lumps are benign.',
  },
]

// ── Screening Function ───────────────────────────────────────────────────────

/**
 * Screen text for red flags. Checks user messages AND AI responses.
 * Returns the highest-priority red flag found, or null if none.
 */
function screenForRedFlags(text) {
  if (!text) return null

  const lower = text.toLowerCase()
  let highestPriority = null

  for (const rule of RED_FLAG_RULES) {
    // Check if any keyword matches
    const keywordMatch = rule.keywords.some(kw => lower.includes(kw))
    if (!keywordMatch) continue

    // Count amplifier matches (boosts confidence but not required)
    const amplifierMatches = (rule.amplifiers || []).filter(a => lower.includes(a)).length

    const triageInfo = TRIAGE_LEVELS[rule.triage]
    if (!triageInfo) continue

    // Keep highest priority (lowest level number)
    if (!highestPriority || triageInfo.level < highestPriority.triageInfo.level) {
      highestPriority = {
        rule,
        triageInfo,
        amplifierMatches,
        resources: (rule.resources || []).map(r => CRISIS_RESOURCES[r]).filter(Boolean),
      }
    }
  }

  return highestPriority
}

/**
 * Format a red flag alert for display.
 */
function formatRedFlagAlert(result) {
  if (!result) return null

  let alert = `\n⚠️ **${result.triageInfo.label.toUpperCase()} ALERT**\n\n`
  alert += `${result.rule.message}\n\n`
  alert += `**What to do:** ${result.rule.action}\n`

  if (result.resources.length > 0) {
    alert += '\n**Crisis Resources:**\n'
    for (const r of result.resources) {
      alert += `- ${r}\n`
    }
  }

  alert += '\n---\n*This is for informational purposes only and does not constitute medical advice. Always consult a qualified healthcare professional.*'

  return alert
}

const DISCLAIMER = 'This is for informational purposes only and does not constitute medical advice. Consult a qualified healthcare professional for medical concerns.'

module.exports = {
  TRIAGE_LEVELS,
  CRISIS_RESOURCES,
  RED_FLAG_RULES,
  screenForRedFlags,
  formatRedFlagAlert,
  DISCLAIMER,
}
