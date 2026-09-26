# K Store — Mid-Season Campaign AI Tutor Assessment

AI-powered knowledge check for K Store customer service agents. The root app supports DeepSeek with a static quiz fallback. Google Sheets score recording is optional for local simulator use.

---

## Architecture

```
Learner (browser)
    ↓
Render.com (Node.js server)
    ├── Calls Gemini API (server-side — API key never exposed)
    └── POSTs score to Google Apps Script webhook
            ↓
    Google Sheets (Roleplay Scores tab)
            ↓
    Power BI Desktop (connected to Sheets)
            ↓
    Notion (dashboard embedded)
```

---

## Deployment Steps

### Step 1 — Get your Gemini API key
1. Go to https://aistudio.google.com/app/apikey
2. Click **Create API key**
3. Copy the key — you'll add it to Render in Step 4

---

### Step 2 — Set up Google Sheets + Apps Script webhook

1. Open your Google Sheet (create one if needed)
2. Rename Tab 2 to exactly: `Roleplay Scores`
3. Go to **Extensions → Apps Script**
4. Delete any existing code, paste the entire contents of `apps-script/Code.gs`
5. Click **Save** (floppy disk icon)
6. Run `testWrite` function once to verify it works — check your Sheet for a test row
7. Click **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Click **Deploy** → copy the **Web App URL**

---

### Step 3 — Push to GitHub

```bash
# In your terminal, from the project folder:
git init
git add .
git commit -m "Initial commit — K Store AI tutor"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kstore-tutor.git
git push -u origin main
```

---

### Step 4 — Deploy to Render.com

1. Go to https://render.com → **New → Web Service**
2. Connect your GitHub account and select the `kstore-tutor` repo
3. Configure the service:
   - **Name:** kstore-tutor
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Add **Environment Variables**:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | Optional Gemini API key; tried first |
| `OPENROUTER_API_KEY` | Optional OpenRouter API key; tried second |
| `DEEPSEEK_API_KEY` | Optional DeepSeek API key; tried third |
| `APPS_SCRIPT_URL` | Optional Apps Script Web App URL for recording scores |

At least one AI provider key is needed for AI evaluation. If all configured providers are unavailable, the quiz offers a static multiple-choice mode. Without `APPS_SCRIPT_URL`, learners can still complete the simulator and see their score, but it will not be sent to Sheets.

5. Click **Create Web Service**
6. Wait ~2 minutes for the first deploy
7. Copy your Render URL (e.g. `https://kstore-tutor.onrender.com`)

---

### Step 5 — Link from Rise / Notion

- In **Articulate Rise**: add a button or continue block at the end of the course pointing to your Render URL
- In **Notion**: embed the Render URL as an embed block on your landing page

---

## Local Development

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/kstore-tutor.git
cd kstore-tutor

# Install dependencies
npm install

# Create your local .env file
Copy-Item .env.example .env
# Edit .env with your real keys

# Run locally from the project root
npm run dev
# Open http://localhost:3000
```

---

## Free Tier Notes

| Service | Limit | Impact |
|---|---|---|
| Render free tier | Spins down after 15min inactivity | First load after idle takes ~30–50s. Visit the URL yourself before a session to wake it up. |
| Gemini API free tier | 15 requests/min, 1,500/day | Sufficient for portfolio demo. Monitor at aistudio.google.com |
| Google Apps Script | 6 min execution limit | Not relevant for this use case |

---

## File Structure

```
kstore-tutor/
├── server.js            # Express server + Gemini API calls + scoring logic
├── package.json
├── .gitignore
├── .env.example         # Template — never commit real .env
├── apps-script/
│   └── Code.gs          # Paste into Google Apps Script editor
└── public/
    └── index.html       # Full frontend — tutor UI
```

---

## How the dual-call scoring works

Every question triggers two Gemini API calls:

**Call 1 — Initial evaluation**  
Sends the learner's answer + the campaign context + the rubric dimensions.  
Gemini returns: which dimensions are covered/partial/missed, the first missing dimension, and a tutor response.

**Call 2 — Follow-up evaluation (only if a dimension was missed)**  
Sends only the follow-up answer + the specific missing dimension being re-checked.  
Gemini returns: covered or missed, updated points, and a brief tutor response.

This means Gemini evaluates meaning and intent — not keyword matching — because it has the full campaign context loaded in every call.
