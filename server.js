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

// Allow embedding in Rise / Articulate iframes
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// ─── API keys ────────────────────────────────────────────────────────────────
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const APPS_SCRIPT_URL  = process.env.APPS_SCRIPT_URL;

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Limits each IP to MAX_SESSIONS AI assessment sessions per day.
// Resets every 24 hours. Static MCQ fallback is NOT rate limited
// (it uses no AI tokens) so blocked users still get an assessment.
const MAX_SESSIONS   = 3;           // max AI sessions per IP per day
const RESET_MS       = 24 * 3600_000; // 24 hours in ms
const ipStore        = new Map();   // IP -> { count, resetAt }

function getClientIP(req) {
  // Render.com passes the real IP in x-forwarded-for
  const forwarded = req.headers["x-forwarded-for"];
  return forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
}

function checkRateLimit(ip) {
  const now  = Date.now();
  const entry = ipStore.get(ip);

  if (!entry || now > entry.resetAt) {
    // First visit or window expired — reset
    ipStore.set(ip, { count: 1, resetAt: now + RESET_MS });
    return { allowed: true, remaining: MAX_SESSIONS - 1 };
  }

  if (entry.count >= MAX_SESSIONS) {
    const minutesLeft = Math.ceil((entry.resetAt - now) / 60_000);
    return { allowed: false, minutesLeft };
  }

  entry.count++;
  return { allowed: true, remaining: MAX_SESSIONS - entry.count };
}

// Clean up old entries every hour to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipStore.entries()) {
    if (now > entry.resetAt) ipStore.delete(ip);
  }
}, 3_600_000);

// ─── Campaign context ────────────────────────────────────────────────────────
const CAMPAIGN_CONTEXT = `
You are Coach K, the K Store Training Coach. You conduct a post-training knowledge
check for tenured K Store customer service agents who just completed the
Mid-Season Campaign update course.

CAMPAIGN KNOWLEDGE BASE — use this to evaluate all answers:

1. PROMO CODES (three active codes for this campaign)
   - KSTORE30: Campaign discount code, now active
   - FLASH15: Short-window offer with category limits
   - NEWUSER10: Use only when customer profile qualifies
   - Agents must know all three codes and their conditions
   - Check category eligibility before confirming any code should work
   - Flexible: agent mentions all three codes with broadly correct descriptions

2. DELIVERY SLA (two tiers)
   - Standard delivery: 5–7 days (extended due to high campaign volume)
   - Express delivery: 2–3 days
   - Agents must know both tiers and their specific day ranges
   - Flexible: approximate figures in the right range count

3. BNPL_PENDING ESCALATION SLA
   - SLA before escalating a BNPL_PENDING case: 24 hours
   - If status has not resolved within 24 hours, escalate
   - Agents must know the 24-hour threshold specifically
   - Flexible: "one day" or "24 hrs" counts

4. BNPL ESCALATION DEPARTMENT
   - BNPL_PENDING cases that exceed SLA must be escalated to: Finance department
   - Not payments team, not supervisor — specifically Finance
   - Flexible: "Finance" or "Finance team" or "Finance department" all count

5. CUSTOMER PUSHBACK ON EXTENDED SLA
   - If customer pushes back on why delivery changed to 5–7 days:
   - Correct explanation: due to higher order volume received during the campaign, the SLA is extended accordingly
   - Must convey: volume-driven reason, campaign context, matter-of-fact tone
   - Flexible: paraphrase that conveys volume + campaign context counts

EVALUATION PRINCIPLES:
- Evaluate intent and understanding, NOT word-for-word accuracy
- Correct meaning in different words = correct answer
- Right terminology in wrong context = incorrect
- You are a coach, not a spell-checker
`;

// ─── Question definitions ────────────────────────────────────────────────────
const QUESTIONS = [
  {
    id: 1,
    topic: "Promo Codes",
    maxScore: 20,
    question: `This campaign has three active promo codes. Can you name all three and briefly describe when each one applies?`,
    dimensions: [
      { name: "KSTORE30 identified correctly", points: 7 },
      { name: "FLASH15 identified correctly", points: 7 },
      { name: "NEWUSER10 identified correctly", points: 6 },
    ],
    hints: {
      "KSTORE30 identified correctly": "You've got some of the codes — what's the main campaign discount code that's now active across the board?",
      "FLASH15 identified correctly": "Good — there's also a short-window offer with category limits. Which code is that?",
      "NEWUSER10 identified correctly": "Almost there — there's a third code that only applies when the customer profile qualifies. What is it?",
    },
    idealAnswer: "KSTORE30 — the main campaign discount code, now active. FLASH15 — a short-window offer with category limits. NEWUSER10 — only applied when the customer profile qualifies.",
    fallback: {
      question: "Which of the following correctly lists all three active promo codes for this campaign?",
      options: [
        { text: "KSTORE30, FLASH20, NEWUSER10", correct: false },
        { text: "KSTORE30, FLASH15, NEWUSER10", correct: true },
        { text: "KSTORE30, FLASH15, NEWUSER15", correct: false },
        { text: "SALE30, FLASH15, NEWUSER10", correct: false },
      ],
      points: 20,
      correctFeedback: "Correct. All three campaign codes: KSTORE30, FLASH15, and NEWUSER10.",
      wrongFeedback: "Incorrect. The three active codes are KSTORE30 (main campaign discount), FLASH15 (short-window with category limits), and NEWUSER10 (qualifying profiles only).",
    },
  },
  {
    id: 2,
    topic: "Delivery SLA",
    maxScore: 20,
    question: `A customer asks about delivery times. What are our current SLA windows for standard and express delivery?`,
    dimensions: [
      { name: "Standard delivery SLA correct", points: 10 },
      { name: "Express delivery SLA correct", points: 10 },
    ],
    hints: {
      "Standard delivery SLA correct": "You've mentioned express — what's the standard delivery window during this campaign period?",
      "Express delivery SLA correct": "Good on standard — what about express delivery? What's the specific day range?",
    },
    idealAnswer: "Standard delivery: 5–7 days (extended during the campaign due to high order volume). Express delivery: 2–3 days.",
    fallback: {
      question: "What are the correct SLA windows for standard and express delivery during this campaign?",
      options: [
        { text: "Standard: 3–5 days / Express: 1–2 days", correct: false },
        { text: "Standard: 5–7 days / Express: 2–3 days", correct: true },
        { text: "Standard: 5–7 days / Express: 1–2 days", correct: false },
        { text: "Standard: 7–10 days / Express: 2–3 days", correct: false },
      ],
      points: 20,
      correctFeedback: "Correct. Standard is 5–7 days, express is 2–3 days.",
      wrongFeedback: "Incorrect. Standard delivery is 5–7 days (extended due to campaign volume). Express delivery is 2–3 days.",
    },
  },
  {
    id: 3,
    topic: "BNPL Escalation SLA",
    maxScore: 20,
    question: `A customer's order shows BNPL_PENDING. You have been monitoring it. What is the SLA window before you should escalate this case?`,
    dimensions: [
      { name: "24-hour SLA threshold stated", points: 20 },
    ],
    hints: {
      "24-hour SLA threshold stated": "You're on the right track — what's the specific time threshold the training gives before BNPL_PENDING becomes an escalation trigger?",
    },
    idealAnswer: "24 hours. If a BNPL_PENDING status has not resolved within 24 hours, the case should be escalated.",
    fallback: {
      question: "How long should you wait before escalating an unresolved BNPL_PENDING case?",
      options: [
        { text: "12 hours", correct: false },
        { text: "24 hours", correct: true },
        { text: "48 hours", correct: false },
        { text: "72 hours", correct: false },
      ],
      points: 20,
      correctFeedback: "Correct. 24 hours is the SLA threshold before escalating a BNPL_PENDING case.",
      wrongFeedback: "Incorrect. The SLA is 24 hours. If BNPL_PENDING has not resolved within 24 hours, escalate.",
    },
  },
  {
    id: 4,
    topic: "BNPL Escalation Path",
    maxScore: 20,
    question: `A BNPL_PENDING case has exceeded the SLA. Which department do you escalate it to?`,
    dimensions: [
      { name: "Finance department identified", points: 20 },
    ],
    hints: {
      "Finance department identified": "Think about which internal team handles payment provider disputes and financial holds — which department is that?",
    },
    idealAnswer: "Finance department. BNPL_PENDING cases that exceed the 24-hour SLA are escalated to Finance, not to a supervisor or the payments team.",
    fallback: {
      question: "When a BNPL_PENDING case exceeds the SLA, which department should you escalate it to?",
      options: [
        { text: "Your direct supervisor", correct: false },
        { text: "Payments team", correct: false },
        { text: "Finance department", correct: true },
        { text: "Customer experience team", correct: false },
      ],
      points: 20,
      correctFeedback: "Correct. BNPL escalations go to the Finance department.",
      wrongFeedback: "Incorrect. BNPL_PENDING cases that exceed SLA are escalated to the Finance department — not a supervisor or the payments team.",
    },
  },
  {
    id: 5,
    topic: "SLA Pushback Handling",
    maxScore: 20,
    question: `A customer is frustrated and pushes back — they say the website showed 3–5 days when they ordered, and now it says 5–7. They want an explanation. What do you tell them?`,
    dimensions: [
      { name: "Volume-driven reason given", points: 10 },
      { name: "Campaign context referenced", points: 10 },
    ],
    hints: {
      "Volume-driven reason given": "Good start — what's the specific reason the SLA extended? What caused the change?",
      "Campaign context referenced": "You've got the reason — make sure you're also tying it to the campaign context so the customer understands why now specifically.",
    },
    idealAnswer: "Due to the higher order volume we received during the campaign, the standard delivery SLA has been extended to 5–7 days. This is a temporary adjustment to manage the increased demand.",
    fallback: {
      question: "A customer pushes back on the 5–7 day delivery window. What is the correct explanation to give them?",
      options: [
        { text: "There is a courier partner issue affecting all deliveries right now.", correct: false },
        { text: "Due to the higher volume we received during the campaign, the SLA has been extended accordingly.", correct: true },
        { text: "Our warehouse is relocating, which has caused temporary delays.", correct: false },
        { text: "Express delivery is available if they want a faster option.", correct: false },
      ],
      points: 20,
      correctFeedback: "Correct. Volume during the campaign is the reason — state it clearly and matter-of-factly.",
      wrongFeedback: "Incorrect. The correct explanation is that higher order volume during the campaign has extended the SLA. Do not attribute it to couriers, warehouses, or unrelated causes.",
    },
  },
];

// ════════════════════════════════════════════════════════════════════════════
// AI LAYER — DeepSeek only
// ════════════════════════════════════════════════════════════════════════════
async function callDeepSeek(prompt) {
  if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not set");
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const e = await res.text();
    throw new Error(`DeepSeek HTTP ${res.status}: ${e}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepSeek returned empty response");
  console.log("[DeepSeek] OK");
  return text;
}

// ─── Extract JSON robustly from AI response ───────────────────────────────────
function extractJSON(raw) {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
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
// RATE LIMIT STATUS — check your own IP's remaining sessions
// ════════════════════════════════════════════════════════════════════════════
app.get("/api/rate-status", (req, res) => {
  const ip    = getClientIP(req);
  const entry = ipStore.get(ip);
  const now   = Date.now();
  if (!entry || now > entry.resetAt) {
    return res.json({ ip, sessions: 0, remaining: MAX_SESSIONS, maxPerDay: MAX_SESSIONS });
  }
  res.json({
    ip,
    sessions:   entry.count,
    remaining:  Math.max(0, MAX_SESSIONS - entry.count),
    maxPerDay:  MAX_SESSIONS,
    resetsInMin: Math.ceil((entry.resetAt - now) / 60_000),
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK — DeepSeek only, cached 60s
// ════════════════════════════════════════════════════════════════════════════
let healthCache = null;
let healthCacheTime = 0;
const HEALTH_TTL = 60_000;

app.get("/api/health", async (req, res) => {
  const now = Date.now();
  if (healthCache && now - healthCacheTime < HEALTH_TTL) {
    return res.json(healthCache);
  }
  try {
    const text = await callDeepSeek("Reply with only the word: OK");
    if (text.toLowerCase().includes("ok")) {
      healthCache = { aiAvailable: true, provider: "deepseek" };
      healthCacheTime = now;
      return res.json(healthCache);
    }
    throw new Error("DeepSeek responded but not OK");
  } catch (e) {
    console.warn("[Health] DeepSeek failed:", e.message);
    healthCache = { aiAvailable: false, errors: [`DeepSeek: ${e.message}`] };
    healthCacheTime = now;
    res.json(healthCache);
  }
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

  // Rate limit check — only on Q1 first attempt (not follow-ups or later questions)
  // This counts one session per Q1 submission rather than per individual answer
  if (questionId === 1 && !isFollowUp) {
    const ip = getClientIP(req);
    const limit = checkRateLimit(ip);
    if (!limit.allowed) {
      console.warn(`[RateLimit] Blocked ${ip} — limit reached, resets in ${limit.minutesLeft} min`);
      // Return allAiFailed so frontend switches to static MCQ (no AI tokens used)
      return res.status(429).json({
        allAiFailed: true,
        detail: `Daily assessment limit reached. You have used all ${MAX_SESSIONS} AI sessions for today. Please try again tomorrow.`,
      });
    }
    console.log(`[RateLimit] ${ip} — session counted, ${limit.remaining} remaining today`);
  }

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
    const text = await callDeepSeek(prompt);
    const parsed = extractJSON(text);
    if (parsed.results) parsed.results = clampPoints(parsed.results, q);
    res.json(parsed);
  } catch (err) {
    console.error("DeepSeek error:", err.message);
    res.status(503).json({ allAiFailed: true, detail: err.message });
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

// ─── Geolocation lookup via ip-api.com (free, no key required) ───────────────
async function getLocation(ip) {
  // Skip lookup for localhost/private IPs
  if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return { country: "Local", city: "Local", region: "Local" };
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,regionName,city,status`, {
      signal: AbortSignal.timeout(3000), // 3 second timeout — never block score submission
    });
    const data = await res.json();
    if (data.status === "success") {
      return {
        country: data.country   || "Unknown",
        region:  data.regionName || "Unknown",
        city:    data.city       || "Unknown",
      };
    }
    return { country: "Unknown", city: "Unknown", region: "Unknown" };
  } catch (e) {
    console.warn("[Geo] Lookup failed:", e.message);
    return { country: "Unknown", city: "Unknown", region: "Unknown" };
  }
}

// ─── Format duration from seconds to human-readable ──────────────────────────
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "Unknown";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// ════════════════════════════════════════════════════════════════════════════
// SUBMIT SCORE
// ════════════════════════════════════════════════════════════════════════════
app.post("/api/submit-score", async (req, res) => {
  if (!APPS_SCRIPT_URL) return res.status(500).json({ error: "APPS_SCRIPT_URL not configured" });
  const { name, totalScore, maxScore, passed, breakdown, timestamp, mode, durationSeconds } = req.body;
  if (!Array.isArray(breakdown) || breakdown.length !== 5) {
    return res.status(400).json({ error: "breakdown must be an array of 5 scores" });
  }
  try {
    // Get location from client IP — runs in parallel, never blocks submission
    const ip = getClientIP(req);
    const location = await getLocation(ip);

    const payload = {
      name,
      totalScore,
      maxScore,
      passed,
      timestamp:       timestamp || new Date().toISOString(),
      mode:            mode || "ai",
      durationSeconds: durationSeconds || 0,
      duration:        formatDuration(durationSeconds),
      country:         location.country,
      region:          location.region,
      city:            location.city,
      q1: breakdown[0]?.earned ?? 0,
      q2: breakdown[1]?.earned ?? 0,
      q3: breakdown[2]?.earned ?? 0,
      q4: breakdown[3]?.earned ?? 0,
      q5: breakdown[4]?.earned ?? 0,
      q1_raw: breakdown[0]?.userAnswer ?? "",
      q2_raw: breakdown[1]?.userAnswer ?? "",
      q3_raw: breakdown[2]?.userAnswer ?? "",
      q4_raw: breakdown[3]?.userAnswer ?? "",
      q5_raw: breakdown[4]?.userAnswer ?? "",
    };

    console.log(`[Submit] ${name} | Score: ${totalScore}/${maxScore} | Duration: ${payload.duration} | Location: ${location.city}, ${location.country}`);

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