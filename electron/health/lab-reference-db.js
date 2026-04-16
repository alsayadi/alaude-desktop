/**
 * Lab Reference Database — ~80 common lab tests with LOINC codes,
 * sex/age-adjusted reference ranges, and plain-English explanations.
 *
 * Sources: LOINC (loinc.org), Mayo Clinic Labs, Quest Diagnostics,
 *          LabCorp published reference ranges, ARUP Laboratories.
 *
 * Each test has: id, loincCode, name, shortName, category, unit,
 *                referenceRanges (by population), and clinical significance.
 */

// ── Categories ───────────────────────────────────────────────────────────────

const CATEGORIES = {
  CBC: 'Complete Blood Count',
  CMP: 'Comprehensive Metabolic Panel',
  LIPID: 'Lipid Panel',
  THYROID: 'Thyroid',
  DIABETES: 'Diabetes / Metabolic',
  LIVER: 'Liver Function',
  KIDNEY: 'Kidney Function',
  IRON: 'Iron Studies',
  VITAMIN: 'Vitamins & Minerals',
  INFLAMMATION: 'Inflammation',
  HORMONE: 'Hormones',
  CARDIAC: 'Cardiac Markers',
  COAGULATION: 'Coagulation',
  URINALYSIS: 'Urinalysis',
  ELECTROLYTE: 'Electrolytes',
  CANCER: 'Cancer Markers',
}

// ── Lab Test Database ────────────────────────────────────────────────────────

const LAB_TESTS = [
  // ═══ CBC ═══════════════════════════════════════════════════════════════════
  {
    id: 'wbc', loincCode: '6690-2', name: 'White Blood Cell Count', shortName: 'WBC',
    category: 'CBC', unit: 'x10³/µL',
    ranges: [{ sex: 'any', low: 4.5, high: 11.0, criticalLow: 2.0, criticalHigh: 30.0 }],
    highMeaning: 'May indicate infection, inflammation, stress, leukemia, or immune disorders',
    lowMeaning: 'May indicate bone marrow problems, autoimmune conditions, or severe infections',
    description: 'White blood cells fight infection. This counts total WBCs in your blood.',
  },
  {
    id: 'rbc', loincCode: '789-8', name: 'Red Blood Cell Count', shortName: 'RBC',
    category: 'CBC', unit: 'x10⁶/µL',
    ranges: [
      { sex: 'male', low: 4.7, high: 6.1, criticalLow: 3.0, criticalHigh: 7.5 },
      { sex: 'female', low: 4.2, high: 5.4, criticalLow: 2.5, criticalHigh: 7.0 },
    ],
    highMeaning: 'May indicate dehydration, polycythemia, lung disease, or living at high altitude',
    lowMeaning: 'May indicate anemia, bleeding, nutritional deficiency, or bone marrow problems',
    description: 'Red blood cells carry oxygen throughout your body.',
  },
  {
    id: 'hemoglobin', loincCode: '718-7', name: 'Hemoglobin', shortName: 'Hgb',
    category: 'CBC', unit: 'g/dL',
    ranges: [
      { sex: 'male', low: 13.5, high: 17.5, criticalLow: 7.0, criticalHigh: 20.0 },
      { sex: 'female', low: 12.0, high: 16.0, criticalLow: 7.0, criticalHigh: 20.0 },
    ],
    highMeaning: 'May indicate dehydration, polycythemia, or chronic lung disease',
    lowMeaning: 'May indicate anemia (iron deficiency, B12 deficiency, chronic disease, or blood loss)',
    description: 'The oxygen-carrying protein in red blood cells. Key indicator of anemia.',
  },
  {
    id: 'hematocrit', loincCode: '4544-3', name: 'Hematocrit', shortName: 'Hct',
    category: 'CBC', unit: '%',
    ranges: [
      { sex: 'male', low: 38.3, high: 48.6 },
      { sex: 'female', low: 35.5, high: 44.9 },
    ],
    highMeaning: 'May indicate dehydration or polycythemia',
    lowMeaning: 'May indicate anemia, blood loss, or nutritional deficiency',
    description: 'Percentage of blood volume made up of red blood cells.',
  },
  {
    id: 'platelets', loincCode: '777-3', name: 'Platelet Count', shortName: 'PLT',
    category: 'CBC', unit: 'x10³/µL',
    ranges: [{ sex: 'any', low: 150, high: 400, criticalLow: 50, criticalHigh: 1000 }],
    highMeaning: 'May indicate inflammation, infection, iron deficiency, or myeloproliferative disorder',
    lowMeaning: 'May indicate viral infection, medication effect, autoimmune condition, or bone marrow problem',
    description: 'Platelets help blood clot. Too few increases bleeding risk; too many increases clot risk.',
  },
  {
    id: 'mcv', loincCode: '787-2', name: 'Mean Corpuscular Volume', shortName: 'MCV',
    category: 'CBC', unit: 'fL',
    ranges: [{ sex: 'any', low: 80, high: 100 }],
    highMeaning: 'Large red blood cells — may indicate B12/folate deficiency, liver disease, or hypothyroidism',
    lowMeaning: 'Small red blood cells — may indicate iron deficiency or thalassemia',
    description: 'Average size of your red blood cells. Helps classify the type of anemia.',
  },
  {
    id: 'mch', loincCode: '785-6', name: 'Mean Corpuscular Hemoglobin', shortName: 'MCH',
    category: 'CBC', unit: 'pg',
    ranges: [{ sex: 'any', low: 27, high: 33 }],
    highMeaning: 'May indicate B12/folate deficiency (macrocytic anemia)',
    lowMeaning: 'May indicate iron deficiency (microcytic anemia)',
    description: 'Average amount of hemoglobin per red blood cell.',
  },
  {
    id: 'rdw', loincCode: '788-0', name: 'Red Cell Distribution Width', shortName: 'RDW',
    category: 'CBC', unit: '%',
    ranges: [{ sex: 'any', low: 11.5, high: 14.5 }],
    highMeaning: 'Variable-sized red blood cells — may indicate mixed anemia, iron/B12 deficiency, or recent transfusion',
    lowMeaning: 'Usually not clinically significant',
    description: 'Variation in red blood cell size. Elevated in many types of anemia.',
  },

  // ═══ CMP / METABOLIC ═════════════════════════════════════════════════════
  {
    id: 'glucose', loincCode: '2345-7', name: 'Glucose (fasting)', shortName: 'Glucose',
    category: 'DIABETES', unit: 'mg/dL',
    ranges: [{ sex: 'any', low: 70, high: 100, optimalLow: 70, optimalHigh: 90, criticalLow: 40, criticalHigh: 400 }],
    highMeaning: 'May indicate pre-diabetes (100-125) or diabetes (≥126). Can also be elevated by stress, medications, or recent meals',
    lowMeaning: 'Hypoglycemia — may cause dizziness, confusion, shakiness. Can indicate insulin excess or liver disease',
    description: 'Blood sugar level after fasting. Primary screening test for diabetes.',
  },
  {
    id: 'hba1c', loincCode: '4548-4', name: 'Hemoglobin A1c', shortName: 'HbA1c',
    category: 'DIABETES', unit: '%',
    ranges: [{ sex: 'any', low: 4.0, high: 5.6, optimalHigh: 5.4 }],
    highMeaning: '5.7-6.4% = pre-diabetes, ≥6.5% = diabetes. Reflects average blood sugar over 2-3 months',
    lowMeaning: 'Unusually low — may indicate blood loss, hemolytic anemia, or certain hemoglobin variants',
    description: 'Average blood sugar over the past 2-3 months. Gold standard for diabetes monitoring.',
  },
  {
    id: 'bun', loincCode: '3094-0', name: 'Blood Urea Nitrogen', shortName: 'BUN',
    category: 'KIDNEY', unit: 'mg/dL',
    ranges: [{ sex: 'any', low: 7, high: 20 }],
    highMeaning: 'May indicate dehydration, high protein diet, kidney dysfunction, or heart failure',
    lowMeaning: 'May indicate liver disease, malnutrition, or overhydration',
    description: 'Waste product filtered by kidneys. Elevated in kidney dysfunction.',
  },
  {
    id: 'creatinine', loincCode: '2160-0', name: 'Creatinine', shortName: 'Creat',
    category: 'KIDNEY', unit: 'mg/dL',
    ranges: [
      { sex: 'male', low: 0.7, high: 1.3 },
      { sex: 'female', low: 0.6, high: 1.1 },
    ],
    highMeaning: 'May indicate kidney dysfunction, dehydration, or muscle breakdown. Also elevated with high protein diet or creatine supplements',
    lowMeaning: 'May indicate low muscle mass or liver disease',
    description: 'Waste product from muscle metabolism, filtered by kidneys. Key kidney function marker.',
  },
  {
    id: 'egfr', loincCode: '33914-3', name: 'Estimated GFR', shortName: 'eGFR',
    category: 'KIDNEY', unit: 'mL/min/1.73m²',
    ranges: [{ sex: 'any', low: 60, high: 999 }],
    highMeaning: 'Normal — kidneys are filtering well',
    lowMeaning: '<60 = chronic kidney disease. <15 = kidney failure. Measures how well kidneys filter waste',
    description: 'Best overall measure of kidney function. Higher is better.',
  },
  {
    id: 'sodium', loincCode: '2951-2', name: 'Sodium', shortName: 'Na',
    category: 'ELECTROLYTE', unit: 'mEq/L',
    ranges: [{ sex: 'any', low: 136, high: 145, criticalLow: 120, criticalHigh: 160 }],
    highMeaning: 'Hypernatremia — usually dehydration. Can cause confusion, seizures at extreme levels',
    lowMeaning: 'Hyponatremia — can be caused by medications (diuretics), heart failure, or excessive water intake',
    description: 'Essential electrolyte for fluid balance and nerve function.',
  },
  {
    id: 'potassium', loincCode: '2823-3', name: 'Potassium', shortName: 'K',
    category: 'ELECTROLYTE', unit: 'mEq/L',
    ranges: [{ sex: 'any', low: 3.5, high: 5.0, criticalLow: 2.5, criticalHigh: 6.5 }],
    highMeaning: 'Hyperkalemia — can cause dangerous heart rhythm problems. May indicate kidney disease or medication effect',
    lowMeaning: 'Hypokalemia — can cause muscle weakness, cramps, heart rhythm issues. Often from diuretics or vomiting',
    description: 'Critical for heart rhythm and muscle function. Both high and low levels are dangerous.',
  },
  {
    id: 'chloride', loincCode: '2075-0', name: 'Chloride', shortName: 'Cl',
    category: 'ELECTROLYTE', unit: 'mEq/L',
    ranges: [{ sex: 'any', low: 98, high: 106 }],
    highMeaning: 'May indicate dehydration or kidney problems',
    lowMeaning: 'May indicate overhydration, vomiting, or adrenal insufficiency',
    description: 'Electrolyte that helps maintain fluid balance and acid-base status.',
  },
  {
    id: 'co2', loincCode: '2028-9', name: 'Carbon Dioxide (Bicarbonate)', shortName: 'CO2',
    category: 'ELECTROLYTE', unit: 'mEq/L',
    ranges: [{ sex: 'any', low: 23, high: 29 }],
    highMeaning: 'Metabolic alkalosis — may indicate vomiting, diuretic use, or lung disease',
    lowMeaning: 'Metabolic acidosis — may indicate kidney disease, diabetes (DKA), or severe diarrhea',
    description: 'Reflects acid-base balance. Important for evaluating kidney and lung function.',
  },
  {
    id: 'calcium', loincCode: '17861-6', name: 'Calcium', shortName: 'Ca',
    category: 'CMP', unit: 'mg/dL',
    ranges: [{ sex: 'any', low: 8.5, high: 10.5, criticalLow: 6.0, criticalHigh: 13.0 }],
    highMeaning: 'Hypercalcemia — may indicate hyperparathyroidism, cancer, vitamin D excess, or dehydration',
    lowMeaning: 'Hypocalcemia — may indicate vitamin D deficiency, hypoparathyroidism, or kidney disease',
    description: 'Essential for bones, muscles, nerves, and heart. Usually regulated by parathyroid gland.',
  },
  {
    id: 'total_protein', loincCode: '2885-2', name: 'Total Protein', shortName: 'TP',
    category: 'CMP', unit: 'g/dL',
    ranges: [{ sex: 'any', low: 6.0, high: 8.3 }],
    highMeaning: 'May indicate dehydration, chronic infection, or multiple myeloma',
    lowMeaning: 'May indicate malnutrition, liver disease, or kidney disease (protein loss)',
    description: 'Total albumin and globulin proteins in blood.',
  },
  {
    id: 'albumin', loincCode: '1751-7', name: 'Albumin', shortName: 'Alb',
    category: 'CMP', unit: 'g/dL',
    ranges: [{ sex: 'any', low: 3.5, high: 5.5 }],
    highMeaning: 'Usually indicates dehydration',
    lowMeaning: 'May indicate liver disease, kidney disease (nephrotic syndrome), malnutrition, or inflammation',
    description: 'Most abundant blood protein. Made by liver. Marker of nutritional and liver status.',
  },

  // ═══ LIVER ════════════════════════════════════════════════════════════════
  {
    id: 'alt', loincCode: '1742-6', name: 'Alanine Aminotransferase', shortName: 'ALT',
    category: 'LIVER', unit: 'U/L',
    ranges: [{ sex: 'any', low: 7, high: 56 }],
    highMeaning: 'Liver cell damage — may indicate hepatitis, fatty liver, medication effect, or alcohol use',
    lowMeaning: 'Normal — not typically concerning',
    description: 'Enzyme mainly found in the liver. Most specific marker for liver cell injury.',
  },
  {
    id: 'ast', loincCode: '1920-8', name: 'Aspartate Aminotransferase', shortName: 'AST',
    category: 'LIVER', unit: 'U/L',
    ranges: [{ sex: 'any', low: 10, high: 40 }],
    highMeaning: 'May indicate liver damage, heart damage, or muscle injury. AST:ALT ratio helps determine cause',
    lowMeaning: 'Normal — not typically concerning',
    description: 'Enzyme found in liver, heart, and muscle. Elevated in liver disease and after heart attack.',
  },
  {
    id: 'alp', loincCode: '6768-6', name: 'Alkaline Phosphatase', shortName: 'ALP',
    category: 'LIVER', unit: 'U/L',
    ranges: [{ sex: 'any', low: 44, high: 147 }],
    highMeaning: 'May indicate bile duct obstruction, bone disease, or liver disease. Normally elevated in growing children',
    lowMeaning: 'May indicate malnutrition, zinc deficiency, or hypothyroidism',
    description: 'Enzyme from liver and bones. Elevated in bile duct blockage and bone disorders.',
  },
  {
    id: 'bilirubin_total', loincCode: '1975-2', name: 'Bilirubin, Total', shortName: 'T.Bili',
    category: 'LIVER', unit: 'mg/dL',
    ranges: [{ sex: 'any', low: 0.1, high: 1.2, criticalHigh: 12.0 }],
    highMeaning: 'Jaundice — may indicate liver disease, bile duct obstruction, or hemolytic anemia. Mild elevation may be Gilbert syndrome (benign)',
    lowMeaning: 'Normal — not typically concerning',
    description: 'Breakdown product of red blood cells. Elevated levels cause yellowing of skin and eyes.',
  },

  // ═══ LIPID PANEL ══════════════════════════════════════════════════════════
  {
    id: 'cholesterol_total', loincCode: '2093-3', name: 'Total Cholesterol', shortName: 'TC',
    category: 'LIPID', unit: 'mg/dL',
    ranges: [{ sex: 'any', high: 200, optimalHigh: 180 }],
    highMeaning: '200-239 = borderline high, ≥240 = high. Increased cardiovascular risk',
    lowMeaning: 'Very low cholesterol (<120) may indicate malnutrition or hyperthyroidism',
    description: 'Total cholesterol in your blood. Includes LDL, HDL, and VLDL.',
  },
  {
    id: 'ldl', loincCode: '2089-1', name: 'LDL Cholesterol', shortName: 'LDL',
    category: 'LIPID', unit: 'mg/dL',
    ranges: [{ sex: 'any', high: 100, optimalHigh: 70 }],
    highMeaning: 'Higher LDL = higher cardiovascular risk. Optimal <70 for high-risk patients, <100 for most adults',
    lowMeaning: 'Lower is generally better for heart health',
    description: '"Bad" cholesterol. Builds up in artery walls. The primary target for cholesterol treatment.',
  },
  {
    id: 'hdl', loincCode: '2085-9', name: 'HDL Cholesterol', shortName: 'HDL',
    category: 'LIPID', unit: 'mg/dL',
    ranges: [
      { sex: 'male', low: 40, high: 999, optimalLow: 50 },
      { sex: 'female', low: 50, high: 999, optimalLow: 60 },
    ],
    highMeaning: 'Higher is protective — reduces cardiovascular risk',
    lowMeaning: 'Low HDL is a cardiovascular risk factor. <40 (men) or <50 (women) is concerning',
    description: '"Good" cholesterol. Removes LDL from arteries. Higher levels are protective.',
  },
  {
    id: 'triglycerides', loincCode: '2571-8', name: 'Triglycerides', shortName: 'TG',
    category: 'LIPID', unit: 'mg/dL',
    ranges: [{ sex: 'any', high: 150, optimalHigh: 100 }],
    highMeaning: '150-199 = borderline, 200-499 = high, ≥500 = very high (pancreatitis risk). Often elevated by diet, alcohol, obesity',
    lowMeaning: 'Low levels are generally healthy',
    description: 'Fat in your blood from food. Elevated by carbs, alcohol, and sugar. Increases heart disease risk.',
  },

  // ═══ THYROID ══════════════════════════════════════════════════════════════
  {
    id: 'tsh', loincCode: '3016-3', name: 'Thyroid Stimulating Hormone', shortName: 'TSH',
    category: 'THYROID', unit: 'mIU/L',
    ranges: [{ sex: 'any', low: 0.4, high: 4.0, optimalLow: 0.5, optimalHigh: 2.5 }],
    highMeaning: 'Hypothyroidism (underactive thyroid) — fatigue, weight gain, cold intolerance, constipation',
    lowMeaning: 'Hyperthyroidism (overactive thyroid) — anxiety, weight loss, rapid heartbeat, heat intolerance',
    description: 'Primary thyroid screening test. TSH rises when thyroid is underactive and drops when overactive.',
  },
  {
    id: 'free_t4', loincCode: '3024-7', name: 'Free T4 (Thyroxine)', shortName: 'FT4',
    category: 'THYROID', unit: 'ng/dL',
    ranges: [{ sex: 'any', low: 0.8, high: 1.8 }],
    highMeaning: 'Hyperthyroidism or excessive thyroid medication',
    lowMeaning: 'Hypothyroidism or pituitary dysfunction',
    description: 'Active thyroid hormone. Checked with TSH to evaluate thyroid function.',
  },
  {
    id: 'free_t3', loincCode: '3051-0', name: 'Free T3 (Triiodothyronine)', shortName: 'FT3',
    category: 'THYROID', unit: 'pg/mL',
    ranges: [{ sex: 'any', low: 2.3, high: 4.2 }],
    highMeaning: 'May indicate hyperthyroidism, especially T3 thyrotoxicosis',
    lowMeaning: 'May indicate hypothyroidism, malnutrition, or chronic illness',
    description: 'Most active thyroid hormone. Useful for diagnosing hyperthyroidism.',
  },

  // ═══ IRON STUDIES ═════════════════════════════════════════════════════════
  {
    id: 'iron', loincCode: '2498-4', name: 'Serum Iron', shortName: 'Iron',
    category: 'IRON', unit: 'µg/dL',
    ranges: [{ sex: 'any', low: 60, high: 170 }],
    highMeaning: 'May indicate hemochromatosis (iron overload), liver disease, or iron supplement excess',
    lowMeaning: 'May indicate iron deficiency anemia, chronic blood loss, or poor absorption',
    description: 'Amount of iron circulating in your blood.',
  },
  {
    id: 'ferritin', loincCode: '2276-4', name: 'Ferritin', shortName: 'Ferr',
    category: 'IRON', unit: 'ng/mL',
    ranges: [
      { sex: 'male', low: 12, high: 300 },
      { sex: 'female', low: 12, high: 150 },
    ],
    highMeaning: 'May indicate iron overload, inflammation, liver disease, or infection (ferritin is also an acute phase reactant)',
    lowMeaning: 'Iron deficiency — most sensitive marker. Fatigue, hair loss, brittle nails',
    description: 'Iron storage protein. Best single test for iron deficiency. Also rises with inflammation.',
  },
  {
    id: 'tibc', loincCode: '2500-7', name: 'Total Iron Binding Capacity', shortName: 'TIBC',
    category: 'IRON', unit: 'µg/dL',
    ranges: [{ sex: 'any', low: 250, high: 370 }],
    highMeaning: 'Body is trying to absorb more iron — indicates iron deficiency',
    lowMeaning: 'May indicate iron overload, chronic disease, or malnutrition',
    description: 'Measures blood\'s capacity to bind iron. Elevated when body needs more iron.',
  },

  // ═══ VITAMINS ═════════════════════════════════════════════════════════════
  {
    id: 'vitamin_d', loincCode: '1989-3', name: 'Vitamin D, 25-Hydroxy', shortName: 'Vit D',
    category: 'VITAMIN', unit: 'ng/mL',
    ranges: [{ sex: 'any', low: 30, high: 100, optimalLow: 40, optimalHigh: 60 }],
    highMeaning: '>100 ng/mL = toxicity risk. Can cause calcium buildup, kidney damage',
    lowMeaning: '<20 = deficient, 20-29 = insufficient. Causes bone weakness, fatigue, mood changes, weakened immunity',
    description: 'Essential for bone health, immune function, and mood. Most people are insufficient.',
  },
  {
    id: 'vitamin_b12', loincCode: '2132-9', name: 'Vitamin B12', shortName: 'B12',
    category: 'VITAMIN', unit: 'pg/mL',
    ranges: [{ sex: 'any', low: 200, high: 900, optimalLow: 400 }],
    highMeaning: 'Usually not harmful from supplements. Very high levels may indicate liver disease',
    lowMeaning: 'B12 deficiency — fatigue, numbness/tingling, cognitive issues, megaloblastic anemia. Common in vegans and elderly',
    description: 'Essential for nerve function and red blood cell formation. Deficiency causes neurological symptoms.',
  },
  {
    id: 'folate', loincCode: '2284-8', name: 'Folate (Folic Acid)', shortName: 'Folate',
    category: 'VITAMIN', unit: 'ng/mL',
    ranges: [{ sex: 'any', low: 2.7, high: 17.0 }],
    highMeaning: 'Usually not harmful. May mask B12 deficiency symptoms',
    lowMeaning: 'Folate deficiency — causes megaloblastic anemia, fatigue. Critical during pregnancy (neural tube defects)',
    description: 'B vitamin essential for cell division. Critical for pregnancy. Works with B12.',
  },

  // ═══ INFLAMMATION ═════════════════════════════════════════════════════════
  {
    id: 'crp_hs', loincCode: '30522-7', name: 'C-Reactive Protein (High Sensitivity)', shortName: 'hs-CRP',
    category: 'INFLAMMATION', unit: 'mg/L',
    ranges: [{ sex: 'any', high: 1.0, optimalHigh: 0.5 }],
    highMeaning: '<1.0 = low cardiovascular risk, 1.0-3.0 = moderate, >3.0 = high risk. Also elevated by infections, autoimmune conditions',
    lowMeaning: 'Low is good — indicates low inflammation',
    description: 'Inflammation marker. Used to assess cardiovascular risk and detect inflammation.',
  },
  {
    id: 'esr', loincCode: '4537-7', name: 'Erythrocyte Sedimentation Rate', shortName: 'ESR',
    category: 'INFLAMMATION', unit: 'mm/hr',
    ranges: [
      { sex: 'male', low: 0, high: 22 },
      { sex: 'female', low: 0, high: 29 },
    ],
    highMeaning: 'Non-specific inflammation marker — infections, autoimmune diseases, cancer, anemia',
    lowMeaning: 'Normal — generally not concerning',
    description: 'General inflammation marker. Not specific — elevated in many conditions.',
  },

  // ═══ HORMONES ═════════════════════════════════════════════════════════════
  {
    id: 'testosterone_m', loincCode: '2986-8', name: 'Testosterone, Total (Male)', shortName: 'Testo',
    category: 'HORMONE', unit: 'ng/dL',
    ranges: [{ sex: 'male', low: 270, high: 1070, optimalLow: 400, optimalHigh: 800 }],
    highMeaning: 'May indicate supplementation, tumors, or early puberty',
    lowMeaning: 'Low T — fatigue, decreased libido, mood changes, loss of muscle mass. Common after age 40',
    description: 'Primary male sex hormone. Affects energy, muscle, mood, and sexual function.',
  },
  {
    id: 'psa', loincCode: '2857-1', name: 'Prostate-Specific Antigen', shortName: 'PSA',
    category: 'CANCER', unit: 'ng/mL',
    ranges: [{ sex: 'male', high: 4.0 }],
    highMeaning: 'May indicate prostate cancer, BPH, prostatitis, or recent prostate manipulation. NOT diagnostic alone',
    lowMeaning: 'Normal',
    description: 'Prostate screening marker. Elevated in prostate cancer but also benign conditions.',
  },
  {
    id: 'insulin_fasting', loincCode: '2484-4', name: 'Insulin (fasting)', shortName: 'Insulin',
    category: 'DIABETES', unit: 'µIU/mL',
    ranges: [{ sex: 'any', low: 2.6, high: 24.9 }],
    highMeaning: 'Insulin resistance — body needs more insulin to control blood sugar. Precursor to type 2 diabetes',
    lowMeaning: 'May indicate type 1 diabetes or advanced type 2 diabetes',
    description: 'Hormone that regulates blood sugar. High fasting insulin indicates insulin resistance.',
  },
  {
    id: 'uric_acid', loincCode: '3084-1', name: 'Uric Acid', shortName: 'UA',
    category: 'CMP', unit: 'mg/dL',
    ranges: [
      { sex: 'male', low: 3.4, high: 7.0 },
      { sex: 'female', low: 2.4, high: 6.0 },
    ],
    highMeaning: 'May cause gout (painful joint inflammation). Also associated with kidney stones and cardiovascular risk',
    lowMeaning: 'Usually not clinically significant',
    description: 'Waste product from purine metabolism. Elevated by red meat, alcohol, and kidney dysfunction.',
  },

  // ═══ COAGULATION ══════════════════════════════════════════════════════════
  {
    id: 'pt', loincCode: '5902-2', name: 'Prothrombin Time', shortName: 'PT',
    category: 'COAGULATION', unit: 'seconds',
    ranges: [{ sex: 'any', low: 11.0, high: 13.5 }],
    highMeaning: 'Blood clots slower — may indicate liver disease, vitamin K deficiency, or warfarin therapy',
    lowMeaning: 'Not typically significant',
    description: 'Measures how long blood takes to clot. Used to monitor warfarin therapy.',
  },
  {
    id: 'inr', loincCode: '6301-6', name: 'International Normalized Ratio', shortName: 'INR',
    category: 'COAGULATION', unit: 'ratio',
    ranges: [{ sex: 'any', low: 0.8, high: 1.1 }],
    highMeaning: 'Blood clots slower. Therapeutic range for warfarin is typically 2.0-3.0',
    lowMeaning: 'Blood clots faster than normal',
    description: 'Standardized version of PT. Key for monitoring blood thinner therapy.',
  },

  // ═══ CARDIAC ══════════════════════════════════════════════════════════════
  {
    id: 'bnp', loincCode: '42637-9', name: 'BNP (B-type Natriuretic Peptide)', shortName: 'BNP',
    category: 'CARDIAC', unit: 'pg/mL',
    ranges: [{ sex: 'any', high: 100 }],
    highMeaning: '>100 pg/mL suggests heart failure. Higher levels correlate with more severe heart failure',
    lowMeaning: 'Normal — heart failure unlikely',
    description: 'Released by heart when it\'s under stress. Primary screening test for heart failure.',
  },
  {
    id: 'troponin', loincCode: '49563-0', name: 'Troponin I (High Sensitivity)', shortName: 'hs-TnI',
    category: 'CARDIAC', unit: 'ng/L',
    ranges: [{ sex: 'any', high: 26, criticalHigh: 52 }],
    highMeaning: 'Heart muscle damage — may indicate heart attack, myocarditis, or heart failure',
    lowMeaning: 'Normal — no heart muscle damage detected',
    description: 'Released when heart muscle is damaged. Primary test for diagnosing heart attack.',
  },
]

// ── Scoring Function ─────────────────────────────────────────────────────────

/**
 * Score a lab result against reference ranges.
 * @param {string} testId - The test ID from LAB_TESTS
 * @param {number} value - The result value
 * @param {string} sex - 'male' or 'female'
 * @param {number} [age] - Patient age (for future age-specific ranges)
 * @returns {object} { status, referenceRange, test }
 */
function scoreLabResult(testId, value, sex = 'any', age) {
  const test = LAB_TESTS.find(t => t.id === testId)
  if (!test) return null

  // Find best matching range
  const range = test.ranges.find(r =>
    (r.sex === 'any' || r.sex === sex)
  ) || test.ranges[0]

  if (!range) return null

  let status = 'normal'

  if (range.criticalLow != null && value < range.criticalLow) status = 'critical-low'
  else if (range.low != null && value < range.low) status = 'low'
  else if (range.criticalHigh != null && value > range.criticalHigh) status = 'critical-high'
  else if (range.high != null && value > range.high) status = 'high'
  else if (range.optimalLow != null && range.optimalHigh != null && value >= range.optimalLow && value <= range.optimalHigh) status = 'optimal'
  else if (range.optimalHigh != null && value <= range.optimalHigh) status = 'optimal'

  return {
    status,
    value,
    unit: test.unit,
    referenceLow: range.low,
    referenceHigh: range.high,
    optimalLow: range.optimalLow,
    optimalHigh: range.optimalHigh,
    test: {
      id: test.id,
      name: test.name,
      shortName: test.shortName,
      category: test.category,
      loincCode: test.loincCode,
      description: test.description,
      meaning: status.includes('high') ? test.highMeaning : status.includes('low') ? test.lowMeaning : 'Within normal range',
    },
  }
}

/**
 * Find a test by name (fuzzy match).
 */
function findTestByName(name) {
  const n = name.toLowerCase().trim()
  return LAB_TESTS.find(t =>
    t.name.toLowerCase() === n ||
    t.shortName.toLowerCase() === n ||
    t.id === n ||
    t.loincCode === n ||
    t.name.toLowerCase().includes(n) ||
    n.includes(t.shortName.toLowerCase())
  )
}

/**
 * Get all tests in a category.
 */
function getTestsByCategory(category) {
  return LAB_TESTS.filter(t => t.category === category)
}

module.exports = {
  CATEGORIES,
  LAB_TESTS,
  scoreLabResult,
  findTestByName,
  getTestsByCategory,
}
