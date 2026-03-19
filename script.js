// ─── CONFIG — replace these two values ──────────────────────────────────────
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
// ─────────────────────────────────────────────────────────────────────────────

const CDN_BASE = 'https://d2bps9p1kiy4ka.cloudfront.net/5b09189f7285894d9130ccd0';

const STREAMS = [
  '9th Grade','10th Grade','11th JEE','11th NEET',
  '12th JEE','12th JEE HINDI','12th NEET','12th NEET HINDI',
  'CA','CUET','Dropper JEE','Dropper NEET','Dropper NEET HINDI',
  'GATE','GATE CS','GATE ECE','GATE EE','GATE ME',
  'NDA','SSC','UPSC',
];

// ── Supabase client ──────────────────────────────────────────────────────────
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── App state ────────────────────────────────────────────────────────────────
let parsedQuestions = null;
let allTests        = [];
let selectedTestId  = '';
let showNewTestForm = false;
let uploading       = false;

// ── Parser ───────────────────────────────────────────────────────────────────
function parseQuizFile(content) {
  try {
    const idsMatch = content.match(/(?:const|let|var)\s+rawIds\s*=\s*(\[[\s\S]*?\]);/);
    if (!idsMatch) throw new Error('Could not find rawIds array.');

    const ansMatch = content.match(/(?:const|let|var)\s+correctAnswers\s*=\s*(\[[\s\S]*?\]);/);
    if (!ansMatch) throw new Error('Could not find correctAnswers array.');

    const rawIds        = JSON.parse(idsMatch[1].replace(/'/g, '"'));
    const correctAnswers = JSON.parse(ansMatch[1].replace(/'/g, '"'));

    if (rawIds.length !== correctAnswers.length)
      throw new Error(`Length mismatch: rawIds(${rawIds.length}) vs correctAnswers(${correctAnswers.length})`);

    const questions = rawIds.map((id, i) => {
      let subject = 'Maths';
      if (i < 25)      subject = 'Physics';
      else if (i < 50) subject = 'Chemistry';

      return {
        image:   `${CDN_BASE}/${id}.png`,
        options: ['A', 'B', 'C', 'D'],
        correct: String(correctAnswers[i]).toUpperCase(),
        subject,
        type: 'mcq',            // ← always MCQ, never integer
      };
    });

    return { questions, error: null };
  } catch (e) {
    return { questions: null, error: e.message };
  }
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
async function fetchTests() {
  const { data, error } = await db.from('tests').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function createTest(payload) {
  const { data, error } = await db.from('tests').insert([payload]).select().single();
  if (error) throw error;
  return data;
}

async function uploadQuestions(questions, testId) {
  const rows = questions.map(q => ({
    test_id:        testId,
    image:          q.image,
    options:        q.options,
    correct:        q.correct,
    subject:        q.subject,
    type:           'mcq',      // ← hard-coded mcq at insert level too
    difficulty:     'medium',
    marks:          4,
    negative_marks: 1,
  }));

  const CHUNK = 50;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from('questions').insert(rows.slice(i, i + CHUNK));
    if (error) throw error;
    done += Math.min(CHUNK, rows.length - i);
    setProgress(done, rows.length);
  }
  return done;
}

// ── Toast ────────────────────────────────────────────────────────────────────
function toast(kind, title, desc) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `
    <span class="toast-icon">${kind === 'success' ? '✓' : kind === 'error' ? '✕' : 'ℹ'}</span>
    <div><div class="toast-title">${title}</div>${desc ? `<div class="toast-desc">${desc}</div>` : ''}</div>`;
  document.body.appendChild(el);
  const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 350); };
  setTimeout(remove, 4500);
  el.onclick = remove;
}

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function setProgress(done, total) {
  const pct = total ? Math.round(done / total * 100) : 0;
  $('prog-bar').style.width = pct + '%';
  $('prog-label').textContent = `Uploading… ${done} / ${total}`;
}

function setStep(n) {
  document.querySelectorAll('.step').forEach((s, i) => {
    s.className = 'step ' + (i + 1 < n ? 'done' : i + 1 === n ? 'active' : '');
  });
}

function renderTests() {
  const sel = $('test-select');
  sel.innerHTML = '<option value="">— Select a test —</option>';
  allTests.forEach(t => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.name}  ·  ${t.stream}`;
    sel.appendChild(o);
  });
  if (selectedTestId) sel.value = selectedTestId;
}

function renderStats() {
  if (!parsedQuestions) return;
  const subj = {};
  parsedQuestions.forEach(q => { subj[q.subject] = (subj[q.subject] || 0) + 1; });
  const colors = { Physics: 'blue', Chemistry: 'purple', Maths: 'green' };
  const badges = Object.entries(subj).map(([s, c]) =>
    `<span class="badge-item badge-${colors[s] || 'blue'}">${s}: ${c}</span>`
  ).join('') + `<span class="badge-item badge-orange">mcq: ${parsedQuestions.length}</span>`;

  $('stats-count').textContent = `${parsedQuestions.length} questions parsed — all MCQ`;
  $('stats-badges').innerHTML = badges;
  $('stats-box').hidden = false;
  $('error-box').hidden = true;
  $('step2').hidden = false;
  setStep(2);
}

function updateUploadBtn() {
  const btn = $('upload-btn');
  const ready = parsedQuestions && selectedTestId && !uploading;
  btn.disabled = !ready;
  btn.textContent = ready
    ? `Upload ${parsedQuestions.length} Questions`
    : 'Upload Questions';
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Populate stream dropdown
  const streamSel = $('new-stream');
  STREAMS.forEach(s => {
    const o = document.createElement('option');
    o.value = o.textContent = s;
    streamSel.appendChild(o);
  });
  streamSel.value = '11th JEE';

  // Load existing tests
  try {
    allTests = await fetchTests();
    renderTests();
  } catch (e) {
    toast('error', 'Could not load tests', e.message);
  }

  // ── File drop / click ──
  const dropZone = $('drop-zone');
  dropZone.addEventListener('click', () => $('file-input').click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('over');
    const f = e.dataTransfer.files[0]; if (f) readFile(f);
  });
  $('file-input').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });

  function readFile(f) {
    const r = new FileReader();
    r.onload = ev => process(ev.target.result);
    r.readAsText(f);
  }

  $('paste-area').addEventListener('input', e => {
    const v = e.target.value.trim();
    if (v) process(v);
    else reset();
  });

  function process(content) {
    const { questions, error } = parseQuizFile(content);
    if (error) {
      parsedQuestions = null;
      $('error-msg').textContent = error;
      $('error-box').hidden = false;
      $('stats-box').hidden = true;
      $('step2').hidden = true;
      setStep(1);
    } else {
      parsedQuestions = questions;
      renderStats();
    }
    updateUploadBtn();
  }

  function reset() {
    parsedQuestions = null;
    $('stats-box').hidden = true;
    $('error-box').hidden = true;
    $('step2').hidden = true;
    setStep(1);
    updateUploadBtn();
  }

  // ── Test select ──
  $('test-select').addEventListener('change', e => {
    selectedTestId = e.target.value;
    updateUploadBtn();
  });

  // ── Toggle new test form ──
  $('new-test-btn').addEventListener('click', () => {
    showNewTestForm = !showNewTestForm;
    $('new-test-form').hidden = !showNewTestForm;
    $('test-select-row').hidden = showNewTestForm;
  });
  $('cancel-new-btn').addEventListener('click', () => {
    showNewTestForm = false;
    $('new-test-form').hidden = true;
    $('test-select-row').hidden = false;
  });

  // ── Create test ──
  $('create-test-btn').addEventListener('click', async () => {
    const name = $('new-name').value.trim();
    if (!name) { toast('error', 'Please enter a test name'); return; }
    const btn = $('create-test-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const t = await createTest({
        name,
        stream:           $('new-stream').value,
        category:         $('new-category').value.trim() || 'All Tests',
        description:      $('new-desc').value.trim() || null,
        duration_minutes: parseInt($('new-duration').value) || 180,
        total_questions:  parseInt($('new-total').value) || 75,
      });
      allTests.unshift(t);
      renderTests();
      selectedTestId = t.id;
      $('test-select').value = t.id;
      showNewTestForm = false;
      $('new-test-form').hidden = true;
      $('test-select-row').hidden = false;
      toast('success', 'Test created!', t.name);
      updateUploadBtn();
    } catch (e) {
      toast('error', 'Failed to create test', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Create Test';
    }
  });

  // ── Upload ──
  $('upload-btn').addEventListener('click', async () => {
    if (!parsedQuestions || !selectedTestId || uploading) return;
    uploading = true;
    const btn = $('upload-btn');
    btn.disabled = true; btn.textContent = 'Uploading…';
    $('progress-wrap').hidden = false;
    setProgress(0, parsedQuestions.length);
    try {
      const n = await uploadQuestions(parsedQuestions, selectedTestId);
      toast('success', 'Upload complete!', `${n} MCQ questions saved.`);
      reset();
      $('paste-area').value = '';
      selectedTestId = '';
      renderTests();
    } catch (e) {
      toast('error', 'Upload failed', e.message);
    } finally {
      uploading = false;
      btn.disabled = false; btn.textContent = 'Upload Questions';
      $('progress-wrap').hidden = true;
    }
  });
});
