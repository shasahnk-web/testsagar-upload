// ── Supabase config ────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://gaqyuylvawgoxuaevhsi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdhcXl1eWx2YXdnb3h1YWV2aHNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI0MDExNTQsImV4cCI6MjA2Nzk3NzE1NH0.tRJXi5vTSopCza_61sYu2ccOrk8LR7UvJ07JPP07OEI';

// ── State ───────────────────────────────────────────────────────────────────
let parsedQuestions = [];
let fileLoaded      = false;

// ── DOM refs ────────────────────────────────────────────────────────────────
const dropZone       = document.getElementById('dropZone');
const fileInput      = document.getElementById('fileInput');
const fileInfo       = document.getElementById('fileInfo');
const fileName       = document.getElementById('fileName');
const removeFile     = document.getElementById('removeFile');
const previewSection = document.getElementById('previewSection');
const statsGrid      = document.getElementById('statsGrid');
const previewBody    = document.getElementById('previewBody');
const tableNote      = document.getElementById('tableNote');
const uploadBtn      = document.getElementById('uploadBtn');
const uploadBtnText  = document.getElementById('uploadBtnText');
const logSection     = document.getElementById('logSection');
const logBody        = document.getElementById('logBody');
const progressFill   = document.getElementById('progressFill');
const progressPct    = document.getElementById('progressPct');
const successSection = document.getElementById('successSection');
const successMsg     = document.getElementById('successMsg');
const resetBtn       = document.getElementById('resetBtn');

// ── Drop zone ───────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
dropZone.addEventListener('click', e => { if (!e.target.closest('label')) fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
removeFile.addEventListener('click', resetFile);
resetBtn.addEventListener('click', resetAll);
uploadBtn.addEventListener('click', doUpload);

// ── Parse JS file ───────────────────────────────────────────────────────────
function handleFile(file) {
  if (!file.name.endsWith('.js')) {
    alert('Please select a .js file in the AITS/Practice Test format.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const src = e.target.result;
    const questions = parseQuestionsJS(src);
    if (!questions || !questions.length) {
      alert('Could not parse questions from this file. Make sure it uses the rawIds + correctAnswers format.');
      return;
    }
    parsedQuestions = questions;
    fileLoaded = true;

    // Show file info
    fileName.textContent = file.name;
    fileInfo.classList.remove('hidden');
    dropZone.style.display = 'none';

    renderPreview(questions);
    checkReady();
  };
  reader.readAsText(file);
}

function parseQuestionsJS(src) {
  try {
    // ── Extract rawIds ────────────────────────────────────────────────────
    const idsMatch = src.match(/const\s+rawIds\s*=\s*\[([\s\S]*?)\];/);
    if (!idsMatch) return null;
    const idsArr = idsMatch[1]
      .split(',')
      .map(s => s.replace(/["'\s]/g, ''))
      .filter(Boolean);

    // ── Extract correctAnswers ────────────────────────────────────────────
    const ansMatch = src.match(/const\s+correctAnswers\s*=\s*\[([\s\S]*?)\];/);
    if (!ansMatch) return null;
    const ansArr = ansMatch[1]
      .split(',')
      .map(s => s.replace(/["'\s]/g, ''))
      .filter(Boolean);

    // ── Detect special image URL overrides ───────────────────────────────
    // Files have special cases like:
    //   if (id === "some-uuid") { imageURL = `https://.../${id}.png`; }
    // We collect all such special ids and their URL templates.
    const specialMap = {};
    const specialRegex = /id\s*===\s*["']([^"']+)["'][^}]*imageURL\s*=\s*`([^`]+)`/g;
    let m;
    while ((m = specialRegex.exec(src)) !== null) {
      specialMap[m[1]] = m[2];
    }

    // ── Detect the default URL pattern ───────────────────────────────────
    // The default branch is a regular string (NOT a template literal):
    //   imageURL = 'https://d2bps9p1kiy4ka.cloudfront.net/5b09189f7285894d9130ccd0/${id}.png';
    // The ${id} is a literal string, NOT interpolated. We build the real URL with the actual id.
    const defaultUrlMatch = src.match(/imageURL\s*=\s*'(https:\/\/[^']+)'/);
    let defaultUrlTemplate = defaultUrlMatch
      ? defaultUrlMatch[1]                       // raw string with literal "${id}"
      : 'https://d2bps9p1kiy4ka.cloudfront.net/5b09189f7285894d9130ccd0/${id}.png';

    // ── Detect subject boundaries ─────────────────────────────────────────
    // Look for patterns like "index < 25" in the source to auto-detect thresholds.
    let phy = 25, chem = 50;
    const boundMatch = src.match(/index\s*<\s*(\d+)/g);
    if (boundMatch && boundMatch.length >= 2) {
      phy  = parseInt(boundMatch[0].match(/\d+/)[0]);
      chem = parseInt(boundMatch[1].match(/\d+/)[0]);
    }

    // ── Build question list ───────────────────────────────────────────────
    const questions = idsArr.map((id, index) => {
      let subject;
      if (index < phy)       subject = 'Physics';
      else if (index < chem) subject = 'Chemistry';
      else                   subject = 'Maths';

      // Build image URL
      let imageURL;
      if (specialMap[id]) {
        // Template literal — replace ${id} with actual id
        imageURL = specialMap[id].replace(/\$\{id\}/g, id);
      } else {
        // Regular string — replace literal "${id}" text with actual id
        imageURL = defaultUrlTemplate.replace('${id}', id);
      }

      const answer = ansArr[index] || '';

      // In these files, answers are "1","2","3","4" for MCQ (not A/B/C/D).
      // Integer-type questions have numeric answers outside 1-4 range,
      // OR the file explicitly checks answer against A/B/C/D.
      const mcqLetters = ['A', 'B', 'C', 'D'];
      const isMCQLetter = mcqLetters.includes(answer.toUpperCase());
      const isNumericMCQ = ['1','2','3','4'].includes(answer);

      let type, correct;

      if (isMCQLetter) {
        type = 'mcq';
        correct = answer.toUpperCase();
      } else if (isNumericMCQ) {
        // "1"→"A", "2"→"B", "3"→"C", "4"→"D"
        type = 'mcq';
        const map = { '1':'A', '2':'B', '3':'C', '4':'D' };
        correct = map[answer];
      } else {
        // Any other numeric value = integer type
        type = 'integer';
        correct = answer;
      }

      return {
        _index: index + 1,
        image: imageURL,
        options: JSON.stringify(['A','B','C','D']),
        correct,
        subject,
        type,
        difficulty: 'medium',
        marks: 4,
        negative_marks: 1.0
      };
    });

    return questions;
  } catch (err) {
    console.error('Parse error:', err);
    return null;
  }
}

// ── Render preview ───────────────────────────────────────────────────────────
function renderPreview(questions) {
  previewSection.classList.remove('hidden');

  // Stats
  const total   = questions.length;
  const mcqCount = questions.filter(q => q.type === 'mcq').length;
  const intCount = questions.filter(q => q.type === 'integer').length;
  const phyCount = questions.filter(q => q.subject === 'Physics').length;
  const chemCount= questions.filter(q => q.subject === 'Chemistry').length;
  const mathCount= questions.filter(q => q.subject === 'Maths').length;

  statsGrid.innerHTML = `
    ${stat(total,   'Total Questions')}
    ${stat(mcqCount, 'MCQ')}
    ${stat(intCount, 'Integer')}
    ${stat(phyCount, 'Physics')}
    ${stat(chemCount,'Chemistry')}
    ${stat(mathCount,'Maths')}
  `;

  // Table (show first 20 + note)
  const SHOW = 20;
  const preview = questions.slice(0, SHOW);
  previewBody.innerHTML = preview.map(q => `
    <tr>
      <td>${q._index}</td>
      <td><code style="font-size:0.72rem;color:#93c5fd;">${q.image.split('/').pop().replace('.png','')}</code></td>
      <td>${subjectBadge(q.subject)}</td>
      <td>${typeBadge(q.type)}</td>
      <td><strong>${q.correct}</strong></td>
      <td style="color:#64748b;font-size:0.72rem;">${q.image.substring(0,50)}…</td>
    </tr>
  `).join('');

  if (questions.length > SHOW)
    tableNote.textContent = `Showing first ${SHOW} of ${questions.length} questions.`;
}

function stat(val, label) {
  return `<div class="stat-box"><div class="stat-val">${val}</div><div class="stat-label">${label}</div></div>`;
}
function subjectBadge(s) {
  const cls = s === 'Physics' ? 'badge-phy' : s === 'Chemistry' ? 'badge-chem' : 'badge-math';
  return `<span class="badge ${cls}">${s}</span>`;
}
function typeBadge(t) {
  return t === 'mcq'
    ? `<span class="badge badge-mcq">MCQ</span>`
    : `<span class="badge badge-integer">Integer</span>`;
}

// ── Ready state ─────────────────────────────────────────────────────────────
function checkReady() {
  const name   = document.getElementById('testName').value.trim();
  const stream = document.getElementById('testStream').value;
  uploadBtn.disabled = !(fileLoaded && name && stream);
}

document.getElementById('testName').addEventListener('input', checkReady);
document.getElementById('testStream').addEventListener('change', checkReady);

// ── Upload ───────────────────────────────────────────────────────────────────
async function doUpload() {
  const name     = document.getElementById('testName').value.trim();
  const stream   = document.getElementById('testStream').value;
  const category = document.getElementById('testCategory').value || 'All Tests';
  const duration = parseInt(document.getElementById('testDuration').value) || 180;
  const desc     = document.getElementById('testDescription').value.trim();

  if (!name || !stream) { alert('Fill in Test Name and Stream first.'); return; }
  if (!parsedQuestions.length) { alert('No questions loaded.'); return; }

  uploadBtn.disabled = true;
  uploadBtnText.innerHTML = '<span class="spinner"></span> Uploading…';
  logSection.classList.remove('hidden');
  logBody.innerHTML = '';
  setProgress(0);

  log('info', `Starting upload: "${name}" (${parsedQuestions.length} questions)`);

  // ── 1. Create test row ────────────────────────────────────────────────────
  log('info', 'Creating test entry…');
  let testId;
  try {
    const testPayload = {
      name,
      description: desc || null,
      stream,
      duration_minutes: duration,
      total_questions: parsedQuestions.length,
      status: 'active',
      category
    };
    const res = await supabaseInsert('tests', [testPayload]);
    if (res.error) throw new Error(res.error.message);
    testId = res.data[0].id;
    log('ok', `Test created ✓  ID: ${testId}`);
  } catch (err) {
    log('err', `Failed to create test: ${err.message}`);
    uploadBtn.disabled = false;
    uploadBtnText.textContent = 'Upload to Database';
    return;
  }

  // ── 2. Upload questions in batches ────────────────────────────────────────
  const BATCH = 25;
  let done = 0, errors = 0;
  const total = parsedQuestions.length;

  for (let i = 0; i < total; i += BATCH) {
    const batch = parsedQuestions.slice(i, i + BATCH).map(q => ({
      test_id:        testId,
      question_text:  null,
      image:          q.image,
      options:        JSON.parse(q.options),
      correct:        q.correct,
      type:           q.type,
      subject:        q.subject,
      difficulty:     q.difficulty,
      marks:          q.marks,
      negative_marks: q.negative_marks
    }));

    try {
      const res = await supabaseInsert('questions', batch);
      if (res.error) throw new Error(res.error.message);
      done += batch.length;
      log('ok', `Uploaded Q${i+1}–Q${Math.min(i+BATCH, total)} ✓`);
    } catch (err) {
      errors += batch.length;
      log('err', `Batch Q${i+1}–Q${Math.min(i+BATCH, total)} failed: ${err.message}`);
    }

    setProgress(Math.round(((i + BATCH) / total) * 100));
    await sleep(120);
  }

  setProgress(100);

  if (errors === 0) {
    log('ok', `✅ All ${total} questions uploaded successfully!`);
    successMsg.textContent = `${total} questions uploaded to test "${name}". Test ID: ${testId}`;
    successSection.classList.remove('hidden');
  } else {
    log('warn', `Upload finished with ${errors} errors. ${done} questions uploaded.`);
    uploadBtnText.textContent = 'Upload to Database';
    uploadBtn.disabled = false;
  }
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
async function supabaseInsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'apikey':          SUPABASE_ANON,
      'Authorization':   `Bearer ${SUPABASE_ANON}`,
      'Prefer':          'return=representation'
    },
    body: JSON.stringify(rows)
  });
  const data = await res.json();
  if (!res.ok) return { error: { message: data.message || data.hint || JSON.stringify(data) } };
  return { data };
}

// ── Log helpers ──────────────────────────────────────────────────────────────
function log(type, msg) {
  const div = document.createElement('div');
  div.className = `log-line log-${type}`;
  const time = new Date().toLocaleTimeString();
  div.textContent = `[${time}] ${msg}`;
  logBody.appendChild(div);
  logBody.scrollTop = logBody.scrollHeight;
}
function setProgress(pct) {
  const v = Math.min(100, pct);
  progressFill.style.width = v + '%';
  progressPct.textContent  = v + '%';
}

// ── Reset ────────────────────────────────────────────────────────────────────
function resetFile() {
  parsedQuestions = [];
  fileLoaded = false;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.style.display = '';
  previewSection.classList.add('hidden');
  previewBody.innerHTML = '';
  statsGrid.innerHTML = '';
  uploadBtn.disabled = true;
  uploadBtnText.textContent = 'Upload to Database';
}

function resetAll() {
  resetFile();
  document.getElementById('testName').value = '';
  document.getElementById('testStream').value = '';
  document.getElementById('testCategory').value = 'All Tests';
  document.getElementById('testDuration').value = '180';
  document.getElementById('testDescription').value = '';
  logSection.classList.add('hidden');
  logBody.innerHTML = '';
  successSection.classList.add('hidden');
  setProgress(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
