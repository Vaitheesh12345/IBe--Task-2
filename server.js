require('dotenv').config();
const express = require('express'), multer = require('multer'), pdf = require('pdf-parse');
const fs = require('fs'), path = require('path'), local = require('./local');
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const KEY = process.env.GEMINI_API_KEY, MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const SAMPLES = path.join(__dirname, 'samples');
app.use(express.static(path.join(__dirname, 'public')));

// Fields per analysis level + weights for the completeness score
const LEVELS = {
  basic: ['name', 'email', 'skills'],
  standard: ['name', 'email', 'skills', 'education', 'experience'],
  detailed: ['name', 'email', 'phone', 'skills', 'education', 'experience'],
};
const WEIGHTS = { name: 15, email: 15, phone: 10, skills: 20, education: 20, experience: 20 };

app.get('/api/samples', (_, res) => res.json(fs.readdirSync(SAMPLES).filter(f => f.endsWith('.txt'))));

async function readText(file, sample) {
  if (sample) {
    const p = path.join(SAMPLES, path.basename(sample));
    if (!fs.existsSync(p)) throw new Error('Sample not found.');
    return fs.readFileSync(p, 'utf8');
  }
  if (!file) throw new Error('Please upload a file or choose a sample.');
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.pdf') || file.mimetype === 'application/pdf') {
    try { return (await pdf(file.buffer)).text; }
    catch { throw new Error('Could not read this PDF (corrupted or scanned image).'); }
  }
  if (name.endsWith('.txt') || file.mimetype === 'text/plain') return file.buffer.toString('utf8');
  throw new Error('Unsupported file type. Please upload a PDF or TXT file.');
}

async function gemini(prompt) {
  if (!KEY) throw new Error('GEMINI_API_KEY is not set.');
  let last = '';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }),
    });
    if (r.ok) {
      const d = await r.json();
      const t = d.candidates?.[0]?.content?.parts?.map(p => p.text).join('');
      if (t) return t;
      throw new Error('AI returned an empty response.');
    }
    if (![429, 500, 503].includes(r.status)) throw new Error(`AI error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    last = r.status + ': ' + (await r.text()).slice(0, 150);
    await new Promise(s => setTimeout(s, 2000 * (i + 1)));
  }
  throw new Error('AI service busy (' + last + ')');
}

const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null);

// Schema validation + grounding checks: never keep what the document doesn't support
function validate(raw, source, fields) {
  const low = source.toLowerCase(), warnings = [], x = raw.extracted || {}, out = {};
  const grounded = (s) => s && low.includes(s.toLowerCase());
  if (fields.includes('name')) { out.name = str(x.name); }
  if (fields.includes('email')) {
    let e = str(x.email);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { warnings.push('Email format invalid – removed'); e = null; }
    if (e && !grounded(e)) { warnings.push('Email not found in source – removed'); e = null; }
    out.email = e;
  }
  if (fields.includes('phone')) {
    let p = str(x.phone);
    if (p && !grounded(p.replace(/\s+/g, ' ')) && !source.replace(/\D/g, '').includes(p.replace(/\D/g, ''))) { warnings.push('Phone not found in source – removed'); p = null; }
    out.phone = p;
  }
  if (fields.includes('skills')) {
    const s = arr(x.skills).map(k => typeof k === 'string' ? { name: k, category: 'Other' } : { name: str(k?.name), category: str(k?.category) || 'Other' })
      .filter(k => k.name && grounded(k.name));
    out.skills = s.length ? s : null;
  }
  if (fields.includes('education')) {
    const e = arr(x.education).map(i => ({ degree: str(i?.degree), institution: str(i?.institution), year: str(String(i?.year ?? '')) }))
      .filter(i => i.degree || i.institution);
    out.education = e.length ? e : null;
  }
  if (fields.includes('experience')) {
    const e = arr(x.experience).map(i => ({ title: str(i?.title), company: str(i?.company), duration: str(i?.duration), description: str(i?.description) }))
      .filter(i => i.title || i.company);
    out.experience = e.length ? e : null;
  }
  return { out, warnings };
}

app.post('/api/analyze', upload.single('file'), async (req, res) => {
  try {
    const engine = ['auto', 'local', 'gemini'].includes(req.body.engine) ? req.body.engine : 'auto';
    const level = LEVELS[req.body.level] ? req.body.level : 'standard';
    const style = ['brief', 'detailed', 'bullets'].includes(req.body.style) ? req.body.style : 'brief';
    let focus = []; try { focus = JSON.parse(req.body.focus || '[]'); } catch {}
    const fields = focus.length ? focus.filter(f => WEIGHTS[f]) : LEVELS[level];
    let text = (await readText(req.file, req.body.sample)).replace(/\u0000/g, '').trim();
    if (text.length < 50) throw new Error('The document is empty or has no readable text (scanned PDFs are not supported).');
    const truncated = text.length > 30000; text = text.slice(0, 30000);

    const styleMap = { brief: '2-3 sentences', detailed: 'a detailed 2-3 paragraph summary', bullets: '5-7 concise bullet points, each starting with "• " (joined by \\n)' };
    const depth = { basic: 'Include only the most essential facts.', standard: 'Include a balanced amount of detail.', detailed: 'Include thorough detail, including descriptions of responsibilities and achievements.' }[level];
    const prompt = `You are a resume analysis engine. Use ONLY the document text below. Never invent information. If something is missing, use null (or [] for lists).
Return ONLY JSON in exactly this shape:
{"summary": string (${styleMap[style]}),
 "key_findings": [string] (${level === 'basic' ? 3 : level === 'standard' ? 5 : 8} items),
 "extracted": {"name": string|null, "email": string|null, "phone": string|null,
   "skills": [{"name": string, "category": string (e.g. Programming, Web, Data, Cloud, Tools, Soft Skills)}],
   "education": [{"degree": string|null, "institution": string|null, "year": string|null}],
   "experience": [{"title": string|null, "company": string|null, "duration": string|null, "description": string|null}]},
 "uncertain_fields": [string] (fields where the text is ambiguous)}
Analysis level: ${level}. ${depth}
${focus.length ? 'Focus especially on: ' + focus.join(', ') + '.' : ''}
Experience "description" ${level === 'detailed' ? 'must be a 1-2 sentence summary' : 'should be null'}.

DOCUMENT:
"""
${text}
"""`;
    let raw, used = 'gemini', note = null;
    if (engine === 'local') { raw = local(text, level, style); used = 'local'; }
    else try { raw = JSON.parse((await gemini(prompt)).replace(/```json|```/g, '').trim()); }
    catch (e) {
      if (engine === 'gemini') throw e instanceof SyntaxError ? new Error('AI returned malformed JSON. Please retry.') : e;
      raw = local(text, level, style); used = 'local';
      note = 'Gemini unavailable (' + e.message.slice(0, 90) + ') – the built-in ML/NLP engine was used instead.';
    }

    const { out, warnings } = validate(raw, text, fields);
    const total = fields.reduce((s, f) => s + WEIGHTS[f], 0);
    const got = fields.reduce((s, f) => s + (out[f] ? WEIGHTS[f] : 0), 0);
    const missing = fields.filter(f => !out[f]);
    if (note) warnings.push(note);
    if (truncated) warnings.push('Document was long – only the first 30,000 characters were analysed.');
    res.json({ summary: str(raw.summary) || 'No summary available.', key_findings: arr(raw.key_findings).filter(s => typeof s === 'string'),
      engine: used, extracted: out, fields, level, style, missing, uncertain: arr(raw.uncertain_fields), warnings,
      completeness: Math.round((got / total) * 100) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.use((err, _req, res, _next) => res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 5 MB).' : err.message }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
