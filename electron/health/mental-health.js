/**
 * Mental Health Toolkit — validated screening instruments + mood tracking.
 * PHQ-9 (depression) and GAD-7 (anxiety) are public-domain instruments.
 *
 * CRITICAL SAFETY: Question 9 of PHQ-9 (self-harm/suicidal ideation)
 * MUST trigger crisis resources if score > 0, regardless of total score.
 */

// ── PHQ-9 Depression Screening ───────────────────────────────────────────────

const PHQ9_QUESTIONS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
  'Trouble concentrating on things, such as reading the newspaper or watching television',
  'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual',
  'Thoughts that you would be better off dead, or of hurting yourself in some way',
]

const PHQ9_OPTIONS = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
]

const PHQ9_FUNCTIONAL_QUESTION = 'If you checked off any problems, how difficult have these problems made it for you to do your work, take care of things at home, or get along with other people?'

const PHQ9_FUNCTIONAL_OPTIONS = [
  { value: 0, label: 'Not difficult at all' },
  { value: 1, label: 'Somewhat difficult' },
  { value: 2, label: 'Very difficult' },
  { value: 3, label: 'Extremely difficult' },
]

function scorePHQ9(responses) {
  const score = responses.reduce((sum, r) => sum + r, 0)
  const q9Score = responses[8] || 0 // Question 9: self-harm

  let severity, recommendation
  if (score <= 4) {
    severity = 'none'
    recommendation = 'Your responses suggest minimal symptoms. Continue monitoring.'
  } else if (score <= 9) {
    severity = 'mild'
    recommendation = 'Your responses suggest mild symptoms. Consider lifestyle changes (exercise, sleep, social connection). Monitor and reassess in 2 weeks.'
  } else if (score <= 14) {
    severity = 'moderate'
    recommendation = 'Your responses suggest moderate symptoms. Consider speaking with a healthcare provider. Therapy and/or medication may be helpful.'
  } else if (score <= 19) {
    severity = 'moderately_severe'
    recommendation = 'Your responses suggest moderately severe symptoms. Strongly recommend consulting a mental health professional. Treatment is effective.'
  } else {
    severity = 'severe'
    recommendation = 'Your responses suggest severe symptoms. Please consult a mental health professional as soon as possible. Help is available and treatment works.'
  }

  const result = {
    score,
    maxScore: 27,
    severity,
    recommendation,
    responses,
    crisisAlert: false,
  }

  // CRITICAL: Question 9 safety check
  if (q9Score > 0) {
    result.crisisAlert = true
    result.crisisMessage = 'Your response to Question 9 indicates thoughts of self-harm. Please reach out for support:'
    result.crisisResources = [
      '988 Suicide & Crisis Lifeline — call or text 988',
      'Crisis Text Line — text HOME to 741741',
      'Emergency: call 911',
    ]
    // Override recommendation regardless of total score
    result.recommendation = 'IMPORTANT: Your response indicates thoughts of self-harm. Please contact one of the crisis resources above, or speak with a trusted person. You are not alone, and help is available.'
  }

  return result
}

// ── GAD-7 Anxiety Screening ──────────────────────────────────────────────────

const GAD7_QUESTIONS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it is hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid as if something awful might happen',
]

const GAD7_OPTIONS = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
]

function scoreGAD7(responses) {
  const score = responses.reduce((sum, r) => sum + r, 0)

  let severity, recommendation
  if (score <= 4) {
    severity = 'minimal'
    recommendation = 'Your responses suggest minimal anxiety. Continue healthy coping strategies.'
  } else if (score <= 9) {
    severity = 'mild'
    recommendation = 'Your responses suggest mild anxiety. Consider relaxation techniques, exercise, and mindfulness. Monitor symptoms.'
  } else if (score <= 14) {
    severity = 'moderate'
    recommendation = 'Your responses suggest moderate anxiety. Consider speaking with a healthcare provider. Therapy (especially CBT) is very effective for anxiety.'
  } else {
    severity = 'severe'
    recommendation = 'Your responses suggest severe anxiety. Please consult a mental health professional. Treatment is highly effective for anxiety disorders.'
  }

  return { score, maxScore: 21, severity, recommendation, responses }
}

// ── Severity Display ─────────────────────────────────────────────────────────

const SEVERITY_COLORS = {
  // PHQ-9
  none: '#2e7d32',
  mild: '#689f38',
  moderate: '#f9a825',
  moderately_severe: '#e65100',
  severe: '#d32f2f',
  // GAD-7
  minimal: '#2e7d32',
}

// ── Mood Entry ───────────────────────────────────────────────────────────────

const MOOD_LEVELS = [
  { value: 1, label: 'Very Bad', emoji: '😞', color: '#d32f2f' },
  { value: 2, label: 'Bad',      emoji: '😟', color: '#e65100' },
  { value: 3, label: 'Okay',     emoji: '😐', color: '#f9a825' },
  { value: 4, label: 'Good',     emoji: '🙂', color: '#689f38' },
  { value: 5, label: 'Great',    emoji: '😊', color: '#2e7d32' },
]

const EMOTION_TAGS = {
  positive: ['happy', 'calm', 'energetic', 'hopeful', 'grateful', 'content', 'motivated', 'confident'],
  negative: ['sad', 'anxious', 'angry', 'frustrated', 'lonely', 'overwhelmed', 'numb', 'irritable', 'restless', 'fearful', 'guilty'],
}

const ACTIVITY_TAGS = [
  'exercise', 'meditation', 'socializing', 'work', 'hobby', 'nature',
  'reading', 'cooking', 'therapy', 'journaling', 'screen_time', 'alcohol', 'caffeine',
]

function createMoodEntry(data) {
  return {
    id: `mood-${Date.now()}`,
    timestamp: new Date().toISOString(),
    mood: data.mood, // 1-5
    energy: data.energy, // 1-5
    anxiety: data.anxiety, // 0-5
    emotions: data.emotions || [],
    sleepHours: data.sleepHours,
    sleepQuality: data.sleepQuality,
    activities: data.activities || [],
    stressors: data.stressors || [],
    gratitude: data.gratitude || '',
    journal: data.journal || '',
  }
}

const DISCLAIMER = 'These screening tools are for informational purposes only. They do not constitute a diagnosis. If you are concerned about your mental health, please consult a qualified mental health professional.'

module.exports = {
  PHQ9_QUESTIONS,
  PHQ9_OPTIONS,
  PHQ9_FUNCTIONAL_QUESTION,
  PHQ9_FUNCTIONAL_OPTIONS,
  scorePHQ9,
  GAD7_QUESTIONS,
  GAD7_OPTIONS,
  scoreGAD7,
  SEVERITY_COLORS,
  MOOD_LEVELS,
  EMOTION_TAGS,
  ACTIVITY_TAGS,
  createMoodEntry,
  DISCLAIMER,
}
