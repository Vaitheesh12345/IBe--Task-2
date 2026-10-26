# AI-Powered Document Intelligence Platform (Task 2)
Resume analyser: upload a PDF/TXT resume → AI summary, structured JSON extraction, validation, completeness score and visual insights.

## Setup
1. Install Node.js 18+.
2. `npm install`
3. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` (free key: https://aistudio.google.com/apikey).
4. `npm start` → open http://localhost:3000

## Tech
Node.js, Express, Multer, pdf-parse, vanilla HTML/CSS/JS. AI: Google Gemini API (`gemini-flash-latest`, free tier). No model training – prompt-engineered structured output + validation.

## Environment variables
`GEMINI_API_KEY` (required), `GEMINI_MODEL` (optional), `PORT` (set by host).

## Deploy (Render free tier)
Push to GitHub → New Web Service → Build: `npm install`, Start: `npm start` → add `GEMINI_API_KEY` in Environment.

## Testing
Pick a sample resume (full / partial) or upload your own; try each style (brief/detailed/bullets), level (basic/standard/detailed) and the focus checkboxes. The partial sample shows null handling and a lower completeness score.

## Logic
- **Extraction**: one Gemini call returns JSON (summary, key findings, fields). Prompt forbids invention; missing = null.
- **Analysis levels**: basic = name/email/skills (3 findings); standard = + education/experience (5); detailed = + phone and experience descriptions (8). Focus checkboxes override the field list.
- **Validation**: server-side schema normalisation; email format check; email, phone and skills must literally appear in the source text or they are dropped (anti-hallucination grounding).
- **Completeness**: weighted % of requested fields found (name 15, email 15, phone 10, skills 20, education 20, experience 20).
- **Visuals**: skill-category breakdown chart and completeness ring generated from extracted data.

## Limitations
Scanned/image PDFs have no OCR; only the first 30,000 characters are analysed; education/experience grounding relies on the prompt (not string-matching); free-tier rate limits may cause retries.
