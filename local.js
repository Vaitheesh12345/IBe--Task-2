// Built-in NLP engine: regex + skill dictionary + rule-based sections + TF-based extractive summary. No API needed.
const SK = {
  Programming: ['python','java','javascript','typescript','c++','c#','php','ruby','kotlin','swift','matlab','scala','bash'],
  Web: ['html','css','react','angular','vue','node.js','express','django','flask','spring boot','next.js','tailwind','bootstrap','rest apis','rest api','jquery','wordpress'],
  Data: ['sql','mysql','postgresql','mongodb','pandas','numpy','power bi','tableau','excel','scikit-learn','tensorflow','pytorch','keras','machine learning','deep learning','nlp','data analysis','statistics','opencv'],
  Cloud: ['aws','azure','gcp','docker','kubernetes','linux','ci/cd','jenkins','terraform'],
  Tools: ['git','github','jira','figma','postman','vs code','agile','scrum'],
  'Soft Skills': ['communication','teamwork','leadership','problem solving','time management','critical thinking','adaptability'],
};
const STOP = new Set('the a an and or of to in for with on at by is are was were be as from that this it its their his her has have had will can using used built use'.split(' '));
const esc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
const HEAD = /^(education|academic[a-z ]*|qualifications?|experience|work experience|professional experience|employment[a-z ]*|internships?|skills|technical skills|projects?|summary|objective|profile|certifications?|achievements?)\s*:?$/i;
const DEG = /\b(b\.?\s?e|b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|bca|mca|b\.?\s?com|m\.?\s?com|mba|ph\.?d|bachelor|master|diploma|hsc|sslc|ssc|higher secondary)\b/i;
const ROLE = /\b(intern|engineer|developer|analyst|manager|designer|trainee|consultant|assistant|lead|executive|associate|scientist|administrator|officer)\b/i;
const DUR = /\(?\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?\d{4}\s*(?:-|–|to)\s*(?:(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?\d{4}|present|current)\s*\)?/i;
const bullet = l => /^[-•*]\s*/.test(l);
const clean = l => l.replace(/^[-•*]\s*/, '').trim();
const title = s => s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s;

function local(text, level, style) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const x = {};
  x.email = (text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [null])[0];
  x.phone = (text.match(/(\+?\d[\d\s().-]{8,}\d)/) || [null])[0];
  const nm = lines.slice(0, 5).find(l => /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(l) && l.split(/\s+/).length <= 4 && !HEAD.test(l) && !/resume|curriculum|vitae/i.test(l));
  x.name = nm ? title(nm) : null;
  // skills dictionary match
  const seen = new Set(); x.skills = [];
  for (const [cat, list] of Object.entries(SK)) for (const s of list) {
    const m = text.match(new RegExp('(?<![\\w+#])' + esc(s) + '(?![\\w+#])', 'i'));
    if (m && !seen.has(s)) { seen.add(s); x.skills.push({ name: m[0], category: cat }); }
  }
  // sections
  const sec = { education: [], experience: [], other: [] }; let cur = 'other';
  for (const l of lines) {
    if (HEAD.test(l)) { const h = l.toLowerCase(); cur = /educ|academic|qualif/.test(h) ? 'education' : /exper|employ|intern/.test(h) ? 'experience' : 'other'; continue; }
    sec[cur].push(l);
  }
  const eduLines = (sec.education.length ? sec.education : lines).filter(l => DEG.test(l) && !bullet(l));
  x.education = eduLines.map(l => {
    const parts = l.split(/,|\||\s[-–]\s/).map(p => p.trim());
    const yr = (l.match(/(19|20)\d\d\s*[-–]\s*((19|20)\d\d|present)/i) || l.match(/(19|20)\d\d(?!.*(19|20)\d\d)/) || [null])[0];
    return { degree: parts[0], institution: parts.find(p => /college|university|institute|school|academy/i.test(p)) || null, year: yr };
  });
  x.experience = []; let last = null;
  for (const l of sec.experience) {
    if (!bullet(l) && ROLE.test(l)) {
      const dur = (l.match(DUR) || [null])[0];
      const rest = l.replace(DUR, '').replace(/[()]/g, '').trim();
      const p = rest.split(/,|\s+at\s+|\s[-–]\s|\|/).map(s => s.trim()).filter(Boolean);
      last = { title: p[0] || null, company: p[1] || null, duration: dur ? dur.replace(/[()]/g, '').trim() : null, description: null };
      x.experience.push(last);
    } else if (last && bullet(l)) last.description = ((last.description || '') + ' ' + clean(l)).trim();
  }
  if (level !== 'detailed') x.experience.forEach(e => e.description = null);
  // summary: facts + TF extractive sentences
  const cats = [...new Set(x.skills.map(s => s.category))];
  const facts = [];
  if (x.skills.length) facts.push(`${x.name || 'The candidate'} lists ${x.skills.length} recognised skills across ${cats.length} categories (${cats.join(', ')}).`);
  if (x.education[0]) facts.push(`Education: ${x.education[0].degree}${x.education[0].institution ? ' at ' + x.education[0].institution : ''}.`);
  if (x.experience.length) facts.push(`Has ${x.experience.length} work experience entr${x.experience.length > 1 ? 'ies' : 'y'}, most recently ${x.experience[0].title}${x.experience[0].company ? ' at ' + x.experience[0].company : ''}.`);
  else facts.push('No formal work experience was detected.');
  if (x.email) facts.push('Contact email is available in the document.');
  const sents = text.split(/[\n.]+/).map(s => clean(s)).filter(s => s.length > 25 && s.length < 220 && !/@/.test(s));
  const tf = {}; sents.join(' ').toLowerCase().match(/[a-z][a-z+#.]+/g)?.forEach(w => { if (!STOP.has(w)) tf[w] = (tf[w] || 0) + 1; });
  const score = s => { const w = (s.toLowerCase().match(/[a-z][a-z+#.]+/g) || []).filter(t => !STOP.has(t)); return w.reduce((a, t) => a + tf[t], 0) / Math.sqrt(w.length || 1); };
  const top = n => sents.map((s, i) => ({ s, i, v: score(s) })).sort((a, b) => b.v - a.v).slice(0, n).sort((a, b) => a.i - b.i).map(o => o.s + '.');
  const summary = style === 'bullets' ? [...facts, ...top(2)].map(f => '• ' + f).join('\n')
    : style === 'detailed' ? facts.join(' ') + '\n\n' + top(3).join(' ') : facts.slice(0, 2).join(' ') + ' ' + top(1).join(' ');
  return { summary, key_findings: [...facts, ...top(4)].slice(0, level === 'basic' ? 3 : level === 'standard' ? 5 : 8), extracted: x, uncertain_fields: [] };
}
module.exports = local;
