/**
 * Health Calculators — pure functions, no external deps.
 * BMI, BMR, TDEE, macros, water intake, heart rate zones, body fat.
 */

// ── BMI ──────────────────────────────────────────────────────────────────────

function calculateBMI(weightKg, heightCm) {
  const heightM = heightCm / 100
  const bmi = weightKg / (heightM * heightM)
  return {
    value: Math.round(bmi * 10) / 10,
    category: classifyBMI(bmi),
    healthyWeightRange: {
      low: Math.round(18.5 * heightM * heightM * 10) / 10,
      high: Math.round(24.9 * heightM * heightM * 10) / 10,
    },
  }
}

function classifyBMI(bmi) {
  if (bmi < 16.0) return { label: 'Severe Underweight', risk: 'high', color: '#d32f2f' }
  if (bmi < 18.5) return { label: 'Underweight', risk: 'moderate', color: '#f9a825' }
  if (bmi < 25.0) return { label: 'Normal Weight', risk: 'low', color: '#2e7d32' }
  if (bmi < 30.0) return { label: 'Overweight', risk: 'moderate', color: '#f9a825' }
  if (bmi < 35.0) return { label: 'Obese (Class I)', risk: 'high', color: '#e65100' }
  if (bmi < 40.0) return { label: 'Obese (Class II)', risk: 'very high', color: '#d32f2f' }
  return { label: 'Obese (Class III)', risk: 'very high', color: '#b71c1c' }
}

// ── BMR (Mifflin-St Jeor) ───────────────────────────────────────────────────

function calculateBMR(weightKg, heightCm, ageYears, sex) {
  const base = (10 * weightKg) + (6.25 * heightCm) - (5 * ageYears)
  return Math.round(sex === 'male' ? base + 5 : base - 161)
}

// ── TDEE ─────────────────────────────────────────────────────────────────────

const ACTIVITY_LEVELS = {
  sedentary:  { multiplier: 1.2,   label: 'Sedentary (little or no exercise)' },
  light:      { multiplier: 1.375, label: 'Light (exercise 1-3 days/week)' },
  moderate:   { multiplier: 1.55,  label: 'Moderate (exercise 3-5 days/week)' },
  active:     { multiplier: 1.725, label: 'Active (exercise 6-7 days/week)' },
  veryActive: { multiplier: 1.9,   label: 'Very Active (intense daily exercise / physical job)' },
}

function calculateTDEE(bmr, activityLevel) {
  const level = ACTIVITY_LEVELS[activityLevel] || ACTIVITY_LEVELS.moderate
  return Math.round(bmr * level.multiplier)
}

// ── Macro Calculator ─────────────────────────────────────────────────────────

function calculateMacros(tdee, goal, bodyweightKg, preference = 'balanced') {
  const calorieAdjust = { lose: -500, maintain: 0, gain: 300 }
  const calories = tdee + (calorieAdjust[goal] || 0)

  const proteinMultiplier = { balanced: 1.6, high_protein: 2.2, low_carb: 2.0, keto: 1.8 }
  const fatPercent = { balanced: 0.30, high_protein: 0.25, low_carb: 0.45, keto: 0.70 }

  const proteinG = Math.round(bodyweightKg * (proteinMultiplier[preference] || 1.6))
  const fatG = Math.round((calories * (fatPercent[preference] || 0.30)) / 9)
  const carbG = Math.max(0, Math.round((calories - (proteinG * 4) - (fatG * 9)) / 4))

  return {
    calories: Math.round(calories),
    protein: { grams: proteinG, calories: proteinG * 4, percent: Math.round((proteinG * 4 / calories) * 100) },
    fat: { grams: fatG, calories: fatG * 9, percent: Math.round((fatG * 9 / calories) * 100) },
    carbs: { grams: carbG, calories: carbG * 4, percent: Math.round((carbG * 4 / calories) * 100) },
    goal,
    preference,
  }
}

// ── Water Intake ─────────────────────────────────────────────────────────────

function calculateWaterIntake(weightKg, activityLevel = 'moderate', climate = 'temperate') {
  let mlPerKg = 33
  if (activityLevel === 'active' || activityLevel === 'veryActive') mlPerKg += 7
  else if (activityLevel === 'moderate') mlPerKg += 3
  if (climate === 'hot') mlPerKg += 5
  if (climate === 'cold') mlPerKg -= 2

  const liters = (weightKg * mlPerKg) / 1000
  return {
    liters: Math.round(liters * 10) / 10,
    ounces: Math.round(liters * 33.814),
    glasses: Math.round(liters / 0.25), // 250mL glasses
  }
}

// ── Heart Rate Zones (Karvonen) ──────────────────────────────────────────────

function calculateHeartRateZones(age, restingHR) {
  const maxHR = 208 - (0.7 * age) // Tanaka formula (more accurate than 220-age)
  const hrr = restingHR ? maxHR - restingHR : null

  const zones = [
    { zone: 1, name: 'Recovery',   pctLow: 0.50, pctHigh: 0.60, desc: 'Very light — warm-up, cool-down, active recovery' },
    { zone: 2, name: 'Fat Burn',   pctLow: 0.60, pctHigh: 0.70, desc: 'Light — endurance base, fat as primary fuel' },
    { zone: 3, name: 'Aerobic',    pctLow: 0.70, pctHigh: 0.80, desc: 'Moderate — cardiovascular fitness improvement' },
    { zone: 4, name: 'Threshold',  pctLow: 0.80, pctHigh: 0.90, desc: 'Hard — lactate threshold, performance gains' },
    { zone: 5, name: 'Maximum',    pctLow: 0.90, pctHigh: 1.00, desc: 'Maximum effort — sprints, short bursts only' },
  ]

  return {
    maxHR: Math.round(maxHR),
    restingHR: restingHR || null,
    zones: zones.map(z => ({
      zone: z.zone,
      name: z.name,
      description: z.desc,
      minBPM: Math.round(hrr ? (hrr * z.pctLow + restingHR) : (maxHR * z.pctLow)),
      maxBPM: Math.round(hrr ? (hrr * z.pctHigh + restingHR) : (maxHR * z.pctHigh)),
    })),
  }
}

// ── Body Fat % (US Navy Method) ─────────────────────────────────────────────

function calculateBodyFat(sex, waistCm, neckCm, heightCm, hipCm) {
  let bf
  if (sex === 'male') {
    bf = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450
  } else {
    if (!hipCm) return null
    bf = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.22100 * Math.log10(heightCm)) - 450
  }

  return {
    percentage: Math.round(bf * 10) / 10,
    category: classifyBodyFat(bf, sex),
  }
}

function classifyBodyFat(bf, sex) {
  if (sex === 'male') {
    if (bf < 6) return { label: 'Essential Fat', color: '#f9a825' }
    if (bf < 14) return { label: 'Athletic', color: '#2e7d32' }
    if (bf < 18) return { label: 'Fitness', color: '#2e7d32' }
    if (bf < 25) return { label: 'Average', color: '#f9a825' }
    return { label: 'Above Average', color: '#e65100' }
  } else {
    if (bf < 14) return { label: 'Essential Fat', color: '#f9a825' }
    if (bf < 21) return { label: 'Athletic', color: '#2e7d32' }
    if (bf < 25) return { label: 'Fitness', color: '#2e7d32' }
    if (bf < 32) return { label: 'Average', color: '#f9a825' }
    return { label: 'Above Average', color: '#e65100' }
  }
}

// ── Waist-to-Hip Ratio ──────────────────────────────────────────────────────

function calculateWaistToHipRatio(waistCm, hipCm, sex) {
  const ratio = waistCm / hipCm
  let risk
  if (sex === 'male') {
    risk = ratio > 0.90 ? 'High' : ratio > 0.85 ? 'Moderate' : 'Low'
  } else {
    risk = ratio > 0.85 ? 'High' : ratio > 0.80 ? 'Moderate' : 'Low'
  }
  return { ratio: Math.round(ratio * 100) / 100, risk }
}

// ── Ideal Weight (multiple formulas) ────────────────────────────────────────

function calculateIdealWeight(heightCm, sex) {
  const heightInches = heightCm / 2.54
  const over60 = Math.max(0, heightInches - 60)

  // Devine formula
  const devine = sex === 'male'
    ? 50 + 2.3 * over60
    : 45.5 + 2.3 * over60

  // Robinson formula
  const robinson = sex === 'male'
    ? 52 + 1.9 * over60
    : 49 + 1.7 * over60

  // BMI-based range
  const heightM = heightCm / 100
  const bmiLow = Math.round(18.5 * heightM * heightM * 10) / 10
  const bmiHigh = Math.round(24.9 * heightM * heightM * 10) / 10

  return {
    devine: Math.round(devine * 10) / 10,
    robinson: Math.round(robinson * 10) / 10,
    bmiRange: { low: bmiLow, high: bmiHigh },
    unit: 'kg',
  }
}

module.exports = {
  calculateBMI,
  calculateBMR,
  calculateTDEE,
  calculateMacros,
  calculateWaterIntake,
  calculateHeartRateZones,
  calculateBodyFat,
  calculateWaistToHipRatio,
  calculateIdealWeight,
  ACTIVITY_LEVELS,
}
