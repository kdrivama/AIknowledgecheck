import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── API keys ────────────────────────────────────────────────────────────────
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const DEEPSEEK_API_KEY   = process.env.DEEPSEEK_API_KEY;
const APPS_SCRIPT_URL    = process.env.APPS_SCRIPT_URL;

// ─── Campaign context ────────────────────────────────────────────────────────
const CAMPAIGN_CONTEXT = `
You are Coach K, the K Store Training Coach. You conduct a post-training knowledge
check for tenured K Store customer service agents who just completed the
Mid-Season Campaign update course.

CAMPAIGN KNOWLEDGE BASE — use this to evaluate all answers:

1. CAMPAIGN PROMO CODES
  - All three valid codes are Kstore30, Flash15, and Newuser10
  - Evaluate each code independently; accept case-insensitive spelling

2. DELIVERY SERVICE LEVELS
  - Standard delivery SLA is 5-7 days
  - Express delivery SLA is 2-3 days

3. BNPL_PENDING ESCALATION SLA
  - Allow 24 hours for BNPL_PENDING to resolve before escalating

4. BNPL ESCALATION DEPARTMENT
  - Escalate pending BNPL cases to Finance

5. EXPLAINING THE STANDARD DELIVERY SLA
  - Explain that higher order volume received during the campaign extended
    the standard delivery SLA to 5-7 days
  - Communicate the reason clearly and respectfully

EVALUATION PRINCIPLES:
- Evaluate intent and understanding, NOT word-for-word accuracy
- Correct meaning in different words = correct answer
- Right terminology in wrong context = incorrect
- You are a coach, not a spell-checker
`;

// ─── Question definitions ────────────────────────────────────────────────────
const QUESTIONS = [
  {
    id: 1, topic: "Campaign Promo Codes", maxScore: 20,
    question: `What are all three promo codes available for this campaign?`,
    dimensions: [
      { name: "Identifies Kstore30", points: 7 },
      { name: "Identifies Flash15", points: 7 },
      { name: "Identifies Newuser10", points: 6 },
    ],
    hints: {
      "Identifies Kstore30": "One of the campaign codes is Kstore30. What are the other two?",
      "Identifies Flash15": "You have some of the codes. Which campaign code is Flash15?",
      "Identifies Newuser10": "You have some of the codes. Which campaign code is Newuser10?",
    },
    idealAnswer: "The three campaign promo codes are Kstore30, Flash15, and Newuser10.",
    fallback: {
      question: "Which option lists all three campaign promo codes?",
      options: [
        { text: "Kstore30, Flash15, and Newuser10", correct: true },
        { text: "Kstore30, Flash10, and Newuser15", correct: false },
        { text: "Kstore30 and Flash15 only", correct: false },
        { text: "Flash15, Newuser10, and Welcome20", correct: false },
      ],
      points: 20,
      correctFeedback: "Correct. All three campaign codes are Kstore30, Flash15, and Newuser10.",
      wrongFeedback: "Incorrect. The three campaign codes are Kstore30, Flash15, and Newuser10.",
    },
  },
  {
    id: 2, topic: "Delivery SLAs", maxScore: 20,
    question: `What are the delivery SLAs for standard and express delivery during the campaign?`,
    dimensions: [
      { name: "Standard delivery is 5-7 days", points: 8 },
      { name: "Express delivery is 2-3 days", points: 8 },
      { name: "Correctly distinguishes both service levels", points: 4 },
    ],
    hints: {
      "Standard delivery is 5-7 days": "What is the standard delivery SLA?",
      "Express delivery is 2-3 days": "And what is the express delivery SLA?",
      "Correctly distinguishes both service levels": "State which SLA applies to standard and which applies to express delivery.",
    },
    idealAnswer: "Standard delivery is 5-7 days. Express delivery is 2-3 days.",
    fallback: {
      question: "Which delivery SLA pairing is correct?",
      options: [
        { text: "Standard: 5-7 days; Express: 2-3 days", correct: true },
        { text: "Standard: 2-3 days; Express: 5-7 days", correct: false },
        { text: "Standard: 5-7 days; Express: 5-7 days", correct: false },
        { text: "Standard: 3-5 days; Express: 1-2 days", correct: false },
      ],
      points: 20,
      correctFeedback: "Correct. Standard delivery is 5-7 days and express delivery is 2-3 days.",
      wrongFeedback: "Incorrect. Standard delivery is 5-7 days; express delivery is 2-3 days.",
    },
  },
  {
    id: 3, topic: "BNPL Pending Escalation SLA", maxScore: 20,
    question: `How long should a BNPL_PENDING case be allowed to remain pending before escalating it?`,
    dimensions: [
      { name: "Allows 24 hours for BNPL_PENDING", points: 12 },
      { name: "Escalates if still pending after 24 hours", points: 8 },
    ],
    hints: {
      "Allows 24 hours for BNPL_PENDING": "What is the BNPL_PENDING waiting period before escalation?",
      "Escalates if still pending after 24 hours": "At what point should the case be escalated if it has not resolved?",
    },
    idealAnswer: "Allow BNPL_PENDING up to 24 hours to resolve before escalating. If it is still pending after 24 hours, escalate the case.",
    fallback: {
      question: "What is the escalation SLA for a BNPL_PENDING case?",
      options: [
        { text: "Wait 24 hours; escalate if it is still pending", correct: true },
        { text: "Escalate immediately when the status appears", correct: false },
        { text: "Wait 48 hours before escalating", correct: false },
        { text: "Do not escalate BNPL_PENDING cases", correct: false },
      ],
      points: 20,
      correctFeedback: "Correct. Allow 24 hours, then escalate if the case is still pending.",
      wrongFeedback: "Incorrect. BNPL_PENDING cases should be allowed 24 hours before escalation.",
    },
  },
  {
    id: 4, topic: "BNPL Escalation Department", maxScore: 15,
    question: `Which department should receive BNPL cases that need escalation?`,
    dimensions: [
      { name: "Identifies Finance department", points: 10 },
      { name: "Routes pending BNPL cases to Finance", points: 5 },
    ],
    hints: {
      "Identifies Finance department": "Which department owns these escalations?",
      "Routes pending BNPL cases to Finance": "Where should an unresolved pending BNPL case be sent?",
    },
    idealAnswer: "Escalate pending BNPL cases to the Finance department.",
    fallback: {
      question: "Which department should handle escalated pending BNPL cases?",
      options: [
        { text: "Finance", correct: true },
        { text: "Customer Support", correct: false },
        { text: "Marketing", correct: false },
        { text: "Delivery Operations", correct: false },
      ],
      points: 15,
      correctFeedback: "Correct. Pending BNPL escalations go to Finance.",
      wrongFeedback: "Incorrect. Pending BNPL escalations should be sent to Finance.",
    },
  },
  {
    id: 5, topic: "Explaining the Delivery SLA", maxScore: 25,
    question: `A customer pushes back and asks why the standard delivery SLA changed to 5-7 days. How would you explain the change?`,
    dimensions: [
      { name: "Explains higher order volume", points: 10 },
      { name: "States standard SLA is extended to 5-7 days", points: 10 },
      { name: "Gives a clear and respectful explanation", points: 5 },
    ],
    hints: {
      "Explains higher order volume": "What campaign-related factor caused the delivery SLA to change?",
      "States standard SLA is extended to 5-7 days": "What is the updated standard delivery SLA?",
      "Gives a clear and respectful explanation": "How can you explain the change clearly and respectfully to the customer?",
    },
    idealAnswer: "Due to the higher order volume we received during the campaign, the standard delivery SLA has been extended to 5-7 days. Explain this clearly and respectfully.",
    fallback: {
      question: "What is the correct explanation for the standard delivery SLA changing to 5-7 days?",
      options: [
        { text: "Higher order volume during the campaign extended the standard delivery SLA to 5-7 days", correct: true },
        { text: "The express delivery SLA changed to 5-7 days because of a new payment method", correct: false },
        { text: "The standard delivery SLA is still 3-5 days; the website is incorrect", correct: false },
        { text: "The SLA changed permanently because the returns policy changed", correct: false },
      ],
      points: 25,
      correctFeedback: "Correct. Higher campaign order volume extended standard delivery to 5-7 days.",
      wrongFeedback: "Incorrect. Explain that higher campaign order volume extended standard delivery to 5-7 days.",
    },
  },
];

// ════════════════════════════════════════════════════════════════════════════
// AI LAYERS
// ════════════════════════════════════════════════════════════════════════════
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`Gemini HTTP ${res.status}: ${e}`); }
  const data = await res.json();
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  console.log("[Gemini] OK");
  return text;
}

async function callOpenRouter(prompt) {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://kstore-tutor.onrender.com",
      "X-Title": "K Store AI Tutor",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3.1-8b-instruct:free",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3, max_tokens: 1024,
    }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`OpenRouter HTTP ${res.status}: ${e}`); }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter returned empty response");
  console.log("[OpenRouter] OK");
  return text;
}

async function callDeepSeek(prompt) {
  if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not set");
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3, max_tokens: 1024,
    }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`DeepSeek HTTP ${res.status}: ${e}`); }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepSeek returned empty response");
  console.log("[DeepSeek] OK");
  return text;
}

// ─── Fallback chain ───────────────────────────────────────────────────────────
async function callAI(prompt) {
  const errors = [];
  for (const [fn, name] of [[callGemini, "Gemini"], [callOpenRouter, "OpenRouter"], [callDeepSeek, "DeepSeek"]]) {
    try { const text = await fn(prompt); return { text, provider: name }; }
    catch (e) { console.warn(`[${name}] failed:`, e.message); errors.push(`${name}: ${e.message}`); }
  }
  throw new Error(`ALL_AI_FAILED: ${errors.join(" | ")}`);
}

// ─── Extract JSON robustly from any AI response ───────────────────────────────
function extractJSON(raw) {
  // Strip markdown fences
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Try direct parse
  try { return JSON.parse(cleaned); } catch (_) {}
  // Bracket-counting extraction — finds the first complete {...} block
  let depth = 0, start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") { if (depth === 0) start = i; depth++; }
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch (_) {}
      }
    }
  }
  throw new Error("Could not parse AI response as JSON");
}

// ─── Clamp AI-returned points to dimension max ────────────────────────────────
function clampPoints(results, question) {
  return results.map(r => {
    const dim = question.dimensions.find(d => d.name === r.dimension);
    if (!dim) return r;
    return { ...r, points: Math.max(0, Math.min(r.points, dim.points)) };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK — cached for 60 seconds
// ════════════════════════════════════════════════════════════════════════════
let healthCache = null;
let healthCacheTime = 0;
const HEALTH_TTL = 60_000;

app.get("/api/health", async (req, res) => {
  const now = Date.now();
  if (healthCache && now - healthCacheTime < HEALTH_TTL) {
    return res.json(healthCache);
  }
  const probe = "Reply with only the word: OK";
  const errors = [];
  for (const [fn, name] of [[callGemini, "gemini"], [callOpenRouter, "openrouter"], [callDeepSeek, "deepseek"]]) {
    try {
      const text = await fn(probe);
      if (text.toLowerCase().includes("ok")) {
        healthCache = { aiAvailable: true, provider: name };
        healthCacheTime = now;
        return res.json(healthCache);
      }
      errors.push(`${name}: responded but not OK`);
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  healthCache = { aiAvailable: false, errors };
  healthCacheTime = now;
  res.json(healthCache);
});

// ════════════════════════════════════════════════════════════════════════════
// QUESTION ROUTES
// ════════════════════════════════════════════════════════════════════════════
app.get("/api/questions", (_req, res) => {
  res.json(QUESTIONS.map(q => ({
    id: q.id, topic: q.topic, question: q.question,
    maxScore: q.maxScore, dimensions: q.dimensions, idealAnswer: q.idealAnswer,
  })));
});

app.get("/api/fallback-questions", (_req, res) => {
  res.json(QUESTIONS.map(q => ({
    id: q.id, topic: q.topic, maxScore: q.maxScore,
    fallback: q.fallback, idealAnswer: q.idealAnswer,
  })));
});

// ════════════════════════════════════════════════════════════════════════════
// EVALUATE
// ════════════════════════════════════════════════════════════════════════════
app.post("/api/evaluate", async (req, res) => {
  const { questionId, answer, isFollowUp, missingDimension } = req.body;
  if (!questionId || !answer) return res.status(400).json({ error: "questionId and answer required" });
  const q = QUESTIONS.find(q => q.id === questionId);
  if (!q) return res.status(400).json({ error: "Invalid question ID" });

  const prompt = !isFollowUp
    ? `${CAMPAIGN_CONTEXT}

QUESTION ${q.id}: "${q.question}"
AGENT ANSWER: "${answer}"

TASK: Evaluate this answer against the dimensions below.
For each, decide: COVERED (full points), PARTIAL (half points rounded down), or MISSED (0).
Be generous — correct meaning in agent's own words = COVERED.

DIMENSIONS:
${q.dimensions.map(d => `- "${d.name}" worth ${d.points} pts`).join("\n")}

Return ONLY a valid JSON object, no other text:
{
  "results": [{ "dimension": "exact name from list", "status": "COVERED|PARTIAL|MISSED", "points": number }],
  "firstMissingDimension": "exact name of first MISSED or PARTIAL dimension, or null if all COVERED",
  "tutorResponse": "one sentence: briefly affirm what they got right"
}`
    : `${CAMPAIGN_CONTEXT}

QUESTION ${q.id}: "${q.question}"
MISSING DIMENSION: "${missingDimension}"
FOLLOW-UP ANSWER: "${answer}"

TASK: Has the agent now covered "${missingDimension}"?

Return ONLY a valid JSON object, no other text:
{
  "status": "COVERED|MISSED",
  "points": number,
  "tutorResponse": "one affirming sentence if COVERED, or 'Noted — we will capture that.' if MISSED"
}`;

  try {
    const { text } = await callAI(prompt);
    const parsed = extractJSON(text);
    // Fix issue #2 — clamp points to dimension maximums
    if (parsed.results) parsed.results = clampPoints(parsed.results, q);
    res.json(parsed);
  } catch (err) {
    if (err.message.startsWith("ALL_AI_FAILED")) {
      return res.status(503).json({ allAiFailed: true, detail: err.message });
    }
    res.status(500).json({ error: "Evaluation failed", detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// TUTOR MESSAGE
// ════════════════════════════════════════════════════════════════════════════
app.post("/api/tutor-message", (req, res) => {
  const { type, questionId, hint, tutorResponse } = req.body;
  const q = QUESTIONS.find(q => q.id === questionId);
  if (type === "hint") {
    const hintText = q?.hints?.[hint] || "Can you expand on that?";
    return res.json({ message: `${tutorResponse} One thing to add — ${hintText} What would you say there?` });
  }
  if (type === "affirm") return res.json({ message: tutorResponse });
  if (type === "missed") return res.json({ message: "Noted — we'll capture that. Let's keep going." });
  res.status(400).json({ error: "Unknown message type" });
});

// ════════════════════════════════════════════════════════════════════════════
// SUBMIT SCORE
// ════════════════════════════════════════════════════════════════════════════
app.post("/api/submit-score", async (req, res) => {
  const { name, totalScore, maxScore, passed, breakdown, timestamp, mode } = req.body;
  if (!Array.isArray(breakdown) || breakdown.length !== 6) {
    return res.status(400).json({ error: "breakdown must be an array of 6 scores" });
  }
  if (!APPS_SCRIPT_URL) {
    return res.json({ success: false, message: "Assessment complete; score recording is not configured." });
  }
  try {
    const payload = {
      name, totalScore, maxScore, passed,
      timestamp: timestamp || new Date().toISOString(),
      mode: mode || "ai",
      q1: breakdown[0]?.earned ?? 0,
      q2: breakdown[1]?.earned ?? 0,
      q3: breakdown[2]?.earned ?? 0,
      q4: breakdown[3]?.earned ?? 0,
      q5: breakdown[4]?.earned ?? 0,
      q6: breakdown[5]?.earned ?? 0,
    };
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.text();
    res.json({ success: true, result });
  } catch (err) {
    console.error("Apps Script error:", err);
    res.status(500).json({ error: "Score submission failed", detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`K Store Tutor running on port ${PORT}`));
