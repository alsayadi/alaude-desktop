/**
 * Built-in Labaik Spaces — domain-specific AI modes.
 * Each space defines: persona, quick actions, file types, and UI hints.
 */

const BUILT_IN_SPACES = [
  {
    id: 'general',
    name: 'General',
    icon: '⚙️',
    color: '#00a846',
    description: 'General-purpose AI assistant',
    systemPromptAddition: '',
    quickActions: [
      { id: 'write', label: 'Write', icon: '✍️', prompt: 'Write a ', filePicker: false },
      { id: 'summarize', label: 'Summarize', icon: '📄', prompt: 'Summarize this document:', filePicker: true },
      { id: 'translate', label: 'Translate', icon: '🌐', prompt: 'Translate this to [language]: ', filePicker: false },
      { id: 'analyze', label: 'Analyze Data', icon: '📊', prompt: 'Analyze this data:', filePicker: true },
      { id: 'proofread', label: 'Proofread', icon: '📝', prompt: 'Proofread and improve this text:\n\n', filePicker: false },
      { id: 'describe', label: 'Describe Image', icon: '🖼️', prompt: 'Describe this image in detail:', filePicker: true },
    ],
    placeholder: 'Message Labaik...',
  },
  {
    id: 'health',
    name: 'Health',
    icon: '🏥',
    color: '#e53935',
    description: 'Health information, lab results, nutrition, symptoms',
    systemPromptAddition: `You are a health information assistant. Important rules:
- Always include a medical disclaimer: "This is for informational purposes only and does not constitute medical advice. Consult a qualified healthcare professional."
- When analyzing lab results, present findings in a table with columns: Test, Result, Reference Range, Status (Normal/High/Low)
- For symptoms, use structured differential thinking: list possible causes from most common to least, with key distinguishing features
- For nutrition and meal plans, consider stated conditions, allergies, and dietary restrictions
- Use clear, non-alarming language when discussing health topics
- Never diagnose or prescribe — only inform and educate`,
    quickActions: [
      { id: 'symptoms', label: 'Symptom Check', icon: '🔍', prompt: 'I want to understand some symptoms: ', filePicker: false },
      { id: 'lab', label: 'Analyze Lab Results', icon: '🧪', prompt: 'Analyze these lab results. Flag any out-of-range values and explain what each marker means in plain language:', filePicker: true },
      { id: 'medication', label: 'Medication Lookup', icon: '💊', prompt: 'Tell me about this medication (uses, dosage, side effects, interactions): ', filePicker: false },
      { id: 'meal', label: 'Meal Plan', icon: '🥗', prompt: 'Create a 7-day meal plan that is ', filePicker: false },
      { id: 'medsummary', label: 'Summarize Medical Doc', icon: '📋', prompt: 'Summarize this medical document in plain language. Highlight key findings, dates, and action items:', filePicker: true },
    ],
    placeholder: 'Ask about health, symptoms, nutrition...',
  },
  {
    id: 'finance',
    name: 'Finance',
    icon: '💰',
    color: '#43a047',
    description: 'Budgets, expenses, invoices, tax, financial analysis',
    systemPromptAddition: `You are a financial analysis assistant. Important rules:
- Present all numbers in formatted tables with proper currency formatting
- For financial data, default to showing: totals, averages, month-over-month change, and trend direction
- Note tax jurisdiction caveats when discussing taxes ("Tax rules vary by jurisdiction. Consult a tax professional.")
- For budgets, use the 50/30/20 framework unless the user specifies otherwise
- For invoices, use clean, professional formatting with line items, subtotal, tax, and total
- Always distinguish between gross and net figures
- When analyzing expenses, categorize automatically and flag unusual items`,
    quickActions: [
      { id: 'expense', label: 'Expense Report', icon: '🧾', prompt: 'Categorize and total these expenses. Flag any anomalies or unusual items:', filePicker: true },
      { id: 'budget', label: 'Build Budget', icon: '📊', prompt: 'Help me create a monthly budget. My monthly income is $', filePicker: false },
      { id: 'invoice', label: 'Create Invoice', icon: '📄', prompt: 'Create a professional invoice with these details:\n\nFrom:\nTo:\nItems:\n', filePicker: false },
      { id: 'tax', label: 'Tax Estimate', icon: '🏦', prompt: 'Help me estimate my taxes. Here is my situation: ', filePicker: false },
      { id: 'pnl', label: 'P&L Analysis', icon: '📈', prompt: 'Analyze this profit & loss data. Calculate margins, identify trends, and highlight concerns:', filePicker: true },
      { id: 'cashflow', label: 'Cash Flow Forecast', icon: '💵', prompt: 'Help me create a 12-month cash flow forecast based on:\n\nMonthly revenue: $\nMonthly fixed costs: $\nVariable costs: ', filePicker: false },
    ],
    placeholder: 'Ask about finances, budgets, taxes...',
  },
  {
    id: 'realestate',
    name: 'Real Estate',
    icon: '🏠',
    color: '#1e88e5',
    description: 'Listings, property analysis, investment ROI, comps',
    systemPromptAddition: `You are a real estate analysis assistant. Important rules:
- For property analysis, calculate: price per sqft, estimated monthly payment, cap rate, cash-on-cash return, and NOI
- Write MLS listings that are compelling but accurate — highlight unique features, neighborhood appeal, and lifestyle benefits
- For investment analysis, default to showing: purchase price, down payment, mortgage details, rental income, expenses, NOI, cap rate, and 5-year equity projection
- For comparable analysis, present in a table: address, price, sqft, price/sqft, beds/baths, year built, days on market
- Use professional real estate terminology but explain technical terms
- Include standard real estate disclaimers when appropriate`,
    quickActions: [
      { id: 'analyze', label: 'Analyze Property', icon: '🏡', prompt: 'Analyze this property:\n\nAddress:\nPrice: $\nBeds/Baths:\nSqft:\nYear Built:\nMonthly Rent (if investment): $', filePicker: false },
      { id: 'listing', label: 'Write Listing', icon: '✍️', prompt: 'Write a compelling MLS listing description for this property: ', filePicker: false },
      { id: 'comps', label: 'Comp Analysis', icon: '📊', prompt: 'Analyze these comparable properties and determine a fair market value:', filePicker: true },
      { id: 'roi', label: 'Investment ROI', icon: '💰', prompt: 'Calculate the investment returns:\n\nPurchase price: $\nDown payment: %\nInterest rate: %\nMonthly rent: $\nMonthly expenses: $', filePicker: false },
      { id: 'letter', label: 'Draft Letter', icon: '📝', prompt: 'Draft a professional letter to a tenant regarding: ', filePicker: false },
    ],
    placeholder: 'Ask about properties, listings, investments...',
  },
  {
    id: 'legal',
    name: 'Legal',
    icon: '⚖️',
    color: '#6d4c41',
    description: 'Contract review, NDA drafting, compliance, legal docs',
    systemPromptAddition: `You are a legal document assistant. Important rules:
- ALWAYS include: "This does not constitute legal advice. Consult a qualified attorney for legal matters."
- When reviewing contracts, systematically check: parties, effective date, term, payment terms, termination clauses, liability/indemnification, IP ownership, non-compete/non-solicit, confidentiality, governing law, dispute resolution
- Flag: ambiguous language, missing standard clauses, one-sided terms, unlimited liability exposure, auto-renewal traps
- Use precise legal language but provide plain-English explanations in parentheses
- For drafts, use standard legal formatting with numbered sections and defined terms
- Mark areas that need customization with [BRACKETS]`,
    quickActions: [
      { id: 'review', label: 'Review Contract', icon: '📑', prompt: 'Review this contract clause-by-clause. Flag risks, ambiguities, and missing standard clauses:', filePicker: true },
      { id: 'nda', label: 'Draft NDA', icon: '🔒', prompt: 'Draft a mutual NDA with these details:\n\nParty 1:\nParty 2:\nPurpose:\nDuration:', filePicker: false },
      { id: 'compliance', label: 'Compliance Check', icon: '✅', prompt: 'Check this document for compliance issues (GDPR, SOC2, HIPAA as applicable):', filePicker: true },
      { id: 'summary', label: 'Summarize Legal Doc', icon: '📋', prompt: 'Summarize this legal document. Extract: key dates, obligations, rights, termination conditions, and financial terms:', filePicker: true },
      { id: 'clause', label: 'Draft Clause', icon: '✏️', prompt: 'Draft a contract clause for: ', filePicker: false },
    ],
    placeholder: 'Ask about contracts, compliance, legal docs...',
  },
  {
    id: 'education',
    name: 'Education',
    icon: '📚',
    color: '#7b1fa2',
    description: 'Lesson plans, quizzes, grading, study guides, research',
    systemPromptAddition: `You are an education assistant using the Feynman technique. Important rules:
- Use simple language, real-world analogies, and concrete examples
- Adapt complexity to the stated education level (elementary, middle, high school, undergraduate, graduate)
- Lesson plans follow: Learning Objectives, Materials, Warm-up (5min), Direct Instruction (15min), Guided Practice (10min), Independent Practice (10min), Assessment, Differentiation (advanced/struggling)
- For quizzes, include: answer key, point values, and Bloom's taxonomy level for each question
- For grading, use constructive language — strengths first, then growth areas with specific suggestions
- Study materials include: key concepts, practice questions with worked solutions, common misconceptions, and further reading`,
    quickActions: [
      { id: 'lesson', label: 'Lesson Plan', icon: '📝', prompt: 'Create a lesson plan:\n\nSubject:\nGrade level:\nTopic:\nDuration: minutes', filePicker: false },
      { id: 'quiz', label: 'Generate Quiz', icon: '❓', prompt: 'Generate a quiz:\n\nSubject:\nTopic:\nNumber of questions:\nDifficulty: easy/medium/hard\nQuestion types: multiple choice, short answer, essay', filePicker: false },
      { id: 'explain', label: 'Explain Concept', icon: '💡', prompt: 'Explain this clearly at a level appropriate for a ', filePicker: false },
      { id: 'grade', label: 'Grade & Feedback', icon: '✏️', prompt: 'Grade this work and provide constructive feedback with a rubric-based score:', filePicker: true },
      { id: 'paper', label: 'Summarize Paper', icon: '📖', prompt: 'Summarize this research paper. Extract: research question, methodology, key findings, limitations, and implications:', filePicker: true },
      { id: 'study', label: 'Study Guide', icon: '📚', prompt: 'Create a study guide:\n\nSubject:\nTopic:\nExam type: multiple choice / essay / mixed', filePicker: false },
    ],
    placeholder: 'Ask about lessons, quizzes, research...',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    icon: '📣',
    color: '#f57c00',
    description: 'Social media, email campaigns, SEO, ad copy, analytics',
    systemPromptAddition: `You are a marketing assistant. Important rules:
- Match the user's brand voice — ask about tone if not specified (professional, casual, playful, authoritative)
- Follow platform-specific best practices: Instagram (visual + 5-10 hashtags), X/Twitter (concise, <280 chars), LinkedIn (professional, thought leadership), TikTok (trending, hooks in first 2 sec), Email (subject line <50 chars, preview text, clear CTA)
- For analytics, focus on: conversion rate, CPA, ROAS, engagement rate, CTR
- Always suggest 2-3 A/B test variants for any copy
- Include character counts for platform-specific content
- For SEO, structure with H1/H2/H3, include meta description, and suggest internal/external linking opportunities`,
    quickActions: [
      { id: 'social', label: 'Social Post', icon: '📱', prompt: 'Write a social media post:\n\nPlatform: Instagram / X / LinkedIn / TikTok\nTopic:\nTone:\nCall to action:', filePicker: false },
      { id: 'email', label: 'Email Campaign', icon: '📧', prompt: 'Write an email campaign:\n\nProduct/service:\nTarget audience:\nGoal: awareness / conversion / retention', filePicker: false },
      { id: 'seo', label: 'SEO Article', icon: '🔍', prompt: 'Write an SEO-optimized article:\n\nPrimary keyword:\nWord count:\nTarget audience:', filePicker: false },
      { id: 'adcopy', label: 'Ad Copy', icon: '💬', prompt: 'Write ad copy:\n\nPlatform: Google / Facebook / Instagram\nProduct:\nTarget audience:\nKey benefit:\nCTA:', filePicker: false },
      { id: 'campaign', label: 'Analyze Campaign', icon: '📊', prompt: 'Analyze this campaign data. Calculate CTR, CPA, and ROAS. Give recommendations for improvement:', filePicker: true },
      { id: 'brand', label: 'Brand Voice Guide', icon: '🎨', prompt: 'Create a brand voice guide:\n\nBusiness name:\nIndustry:\nTarget audience:\nValues:', filePicker: false },
    ],
    placeholder: 'Ask about marketing, content, campaigns...',
  },
]

function getSpaceById(id) {
  return BUILT_IN_SPACES.find(s => s.id === id) || BUILT_IN_SPACES[0]
}

function getAllSpaceIds() {
  return BUILT_IN_SPACES.map(s => s.id)
}

module.exports = { BUILT_IN_SPACES, getSpaceById, getAllSpaceIds }
