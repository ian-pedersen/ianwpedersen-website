// Prompt Builder — assembles a structured prompt from task-specific fields.
// Structure follows Google's "Prompt Engineering" whitepaper (Boonstra, 2025):
// role + context + specific instruction + output format + examples + technique.

(function () {
  'use strict';

  // ---------- Task definitions ----------
  // Each task supplies a default role, output format, recommended techniques,
  // a goal placeholder, and its own detail fields.
  // Field types: text (single line), area (multi-line), code (fenced in output).

  var TASKS = [
    {
      id: 'prd', label: 'Write a PRD',
      blurb: 'Turn an idea into a product requirements document with testable requirements.',
      goal: 'Write a PRD for a prompt-builder page on my personal website.',
      role: 'You are a senior product manager who writes clear, concise product requirements documents that engineers can build from directly.',
      format: 'A PRD in Markdown with these sections: Overview; Problem; Goals and success metrics; Users and key use cases; Functional requirements (numbered, each one testable); Non-functional requirements; Out of scope; Open questions.',
      tech: ['clarify'],
      fields: [
        { id: 'product', label: 'Product / feature', type: 'text', ph: 'e.g. A web page that builds structured prompts' },
        { id: 'users', label: 'Target users', type: 'text', ph: 'e.g. Me, plus visitors to my site who use LLMs for work' },
        { id: 'problem', label: 'Problem it solves', type: 'area', ph: 'What is painful or slow today?' },
        { id: 'success', label: 'What success looks like', type: 'area', ph: 'e.g. I use it for most prompts I write; output quality is noticeably better' },
        { id: 'outscope', label: 'Out of scope', type: 'area', ph: 'e.g. Accounts, saving prompts to a server, calling an LLM API' }
      ]
    },
    {
      id: 'plan', label: 'Plan an implementation',
      blurb: 'Get a technical design and step-by-step build plan before writing code.',
      goal: 'Design an implementation plan for adding a prompt builder page to my static site.',
      role: 'You are a senior software engineer who designs simple, maintainable implementations and explains trade-offs plainly.',
      format: 'Markdown with these sections: Summary; Approach (and the alternatives you rejected, with one line on why); Files and components to create or change; Data model / state; Step-by-step implementation plan (numbered, each step small enough to build and test on its own); Risks and edge cases; Testing plan.',
      tech: ['tot', 'clarify'],
      fields: [
        { id: 'what', label: 'What you are building', type: 'area', ph: 'Describe the feature, or paste the PRD' },
        { id: 'stack', label: 'Stack / environment', type: 'text', ph: 'e.g. Static HTML/CSS/JS on GitHub Pages, no build step' },
        { id: 'existing', label: 'Existing code or architecture', type: 'code', ph: 'Paste relevant files, folder structure, or describe the current setup' },
        { id: 'priorities', label: 'Priorities', type: 'text', ph: 'e.g. Simplicity over flexibility; no external dependencies' }
      ]
    },
    {
      id: 'build', label: 'Write code',
      blurb: 'Generate working code for a well-defined feature.',
      goal: 'Write a JavaScript function that copies the generated prompt to the clipboard and shows a confirmation.',
      role: 'You are an expert software engineer who writes clean, idiomatic, well-structured code that matches the conventions of the surrounding codebase.',
      format: 'For each file: the file path, then the complete code in a fenced code block. After the code: a short explanation of how it works and the exact steps to run or test it.',
      tech: [],
      fields: [
        { id: 'lang', label: 'Language / framework', type: 'text', ph: 'e.g. Vanilla JavaScript (ES2017), no libraries' },
        { id: 'spec', label: 'What the code should do', type: 'area', ph: 'Inputs, outputs, behavior, edge cases' },
        { id: 'existing', label: 'Existing code to integrate with', type: 'code', ph: 'Paste the code this needs to fit into' },
        { id: 'conventions', label: 'Conventions to follow', type: 'text', ph: 'e.g. 2-space indent, no semicolon-free style, comment only non-obvious logic' }
      ]
    },
    {
      id: 'debug', label: 'Debug',
      blurb: 'Find the root cause of a bug and get a verified fix.',
      goal: 'Find the root cause of this bug and fix it.',
      role: 'You are an expert debugger. You form hypotheses from evidence, identify the root cause rather than the symptom, and propose the smallest correct fix.',
      format: 'Markdown with these sections: Root cause (one or two sentences); Explanation (how the evidence points to it); Fix (the corrected code in a fenced block, showing only what changes plus enough surrounding lines to locate it); How to verify the fix; Related issues you noticed (if any).',
      tech: ['cot'],
      fields: [
        { id: 'stack', label: 'Language / environment', type: 'text', ph: 'e.g. Python 3.12, Windows 11' },
        { id: 'actual', label: 'What happens', type: 'area', ph: 'The actual behavior' },
        { id: 'expected', label: 'What should happen', type: 'area', ph: 'The expected behavior' },
        { id: 'error', label: 'Error message / logs', type: 'code', ph: 'Paste the full error and stack trace' },
        { id: 'code', label: 'Relevant code', type: 'code', ph: 'Paste the code involved' },
        { id: 'tried', label: 'What you already tried', type: 'area', ph: 'So the model skips dead ends' }
      ]
    },
    {
      id: 'review', label: 'Review / audit code',
      blurb: 'Get a prioritized review of code for bugs, security, and clarity.',
      goal: 'Review this code for bugs, security issues, and maintainability problems.',
      role: 'You are a meticulous senior code reviewer. You prioritize real defects over style preferences and back every finding with a concrete failure scenario.',
      format: 'A numbered list of findings ranked from most to least severe. For each: severity (High / Medium / Low), location, the problem, a concrete scenario where it fails, and the suggested fix. End with a one-paragraph overall assessment.',
      tech: ['stepback'],
      fields: [
        { id: 'lang', label: 'Language / framework', type: 'text', ph: 'e.g. TypeScript, React 19' },
        { id: 'purpose', label: 'What the code is supposed to do', type: 'area', ph: 'So the reviewer can judge correctness' },
        { id: 'focus', label: 'Focus areas', type: 'text', ph: 'e.g. correctness and security first; ignore formatting' },
        { id: 'code', label: 'Code to review', type: 'code', ph: 'Paste the code or diff' }
      ]
    },
    {
      id: 'ui', label: 'Design a UI',
      blurb: 'Design screens, layouts, and components, optionally as a working mockup.',
      goal: 'Design the UI for a prompt builder page with a form on the left and live output on the right.',
      role: 'You are a senior product designer with strong front-end skills. You design clear, accessible interfaces with a strong visual hierarchy.',
      format: 'Markdown with these sections: Layout (per screen, top to bottom); Components and their states (default, hover, empty, loading, error); Responsive behavior on mobile; Accessibility notes. Then a single self-contained HTML/CSS mockup in one fenced code block.',
      tech: ['tot'],
      fields: [
        { id: 'screen', label: 'Product / screens', type: 'area', ph: 'What screens or components are needed?' },
        { id: 'users', label: 'Users and their main tasks', type: 'area', ph: 'Who uses it and what are they trying to get done?' },
        { id: 'platform', label: 'Platform', type: 'text', ph: 'e.g. Responsive web, desktop-first' },
        { id: 'style', label: 'Visual style / brand', type: 'area', ph: 'e.g. Warm palette (rust #b5502e, ochre #8a5a1f), Lora serif + Space Mono, lots of whitespace' }
      ]
    },
    {
      id: 'brainstorm', label: 'Brainstorm',
      blurb: 'Generate a wide range of ideas, then narrow to the best.',
      goal: 'Generate ideas for projects to add to my personal website.',
      role: 'You are a creative strategist who generates varied, unexpected ideas and then evaluates them honestly.',
      format: 'A numbered list of ideas. For each: a short name, a one-sentence description, and one line on how it fits the criteria. Cover genuinely different directions rather than variations of one idea. Finish with your top 3 picks and why.',
      tech: ['stepback'],
      fields: [
        { id: 'topic', label: 'Topic', type: 'area', ph: 'What are you brainstorming about?' },
        { id: 'count', label: 'Number of ideas', type: 'text', ph: 'e.g. 15' },
        { id: 'criteria', label: 'What makes an idea good', type: 'area', ph: 'e.g. Buildable in a weekend, shows off analytical skills, useful to others' },
        { id: 'already', label: 'Ideas already considered', type: 'area', ph: 'So the model goes beyond them' }
      ]
    },
    {
      id: 'explain', label: 'Explain',
      blurb: 'Understand code or a concept at the right level.',
      goal: 'Explain how this code works.',
      role: 'You are a patient expert teacher who explains things at exactly the learner\'s level, using concrete examples.',
      format: 'Start with a one-paragraph plain-language summary. Then walk through the details in order, using short sections. Finish with one concrete example and a short list of key takeaways.',
      tech: [],
      fields: [
        { id: 'subject', label: 'What to explain', type: 'area', ph: 'A concept, or describe the code below' },
        { id: 'level', label: 'Your current level', type: 'text', ph: 'e.g. Comfortable with Python, new to async programming' },
        { id: 'why', label: 'Why you need to understand it', type: 'text', ph: 'e.g. I need to modify it to add caching' },
        { id: 'code', label: 'Code (optional)', type: 'code', ph: 'Paste code to explain' }
      ]
    },
    {
      id: 'write', label: 'Write / edit',
      blurb: 'Draft or improve an email, essay, post, or other writing.',
      goal: 'Write a short project description for my portfolio page.',
      role: 'You are a skilled editor and writer who writes clearly and concisely for the intended audience.',
      format: 'The finished text only, ready to use. After it, a separator line and up to 3 brief notes on choices you made.',
      tech: [],
      fields: [
        { id: 'kind', label: 'Type of writing', type: 'text', ph: 'e.g. Email, essay, LinkedIn post, cover letter' },
        { id: 'audience', label: 'Audience', type: 'text', ph: 'e.g. Hiring managers in healthcare analytics' },
        { id: 'points', label: 'Key points to include', type: 'area', ph: 'One per line' },
        { id: 'draft', label: 'Existing draft (to edit)', type: 'area', ph: 'Paste a draft if you want it edited rather than written from scratch' }
      ]
    },
    {
      id: 'analyze', label: 'Analyze / decide',
      blurb: 'Compare options or work through a question with explicit reasoning.',
      goal: 'Compare these options and recommend one.',
      role: 'You are a rigorous analyst who reasons from evidence, states assumptions explicitly, and gives a clear recommendation.',
      format: 'Markdown with: a comparison table (options as rows, criteria as columns); a short analysis of the key trade-offs; a clear recommendation with the reasoning behind it; and what would change the recommendation.',
      tech: ['stepback', 'cot'],
      fields: [
        { id: 'question', label: 'Question or decision', type: 'area', ph: 'What are you trying to figure out?' },
        { id: 'options', label: 'Options', type: 'area', ph: 'One per line' },
        { id: 'criteria', label: 'Criteria that matter', type: 'area', ph: 'e.g. Cost, time to build, long-term maintenance' },
        { id: 'data', label: 'Data or evidence', type: 'area', ph: 'Paste any numbers, sources, or facts' }
      ]
    },
    {
      id: 'extract', label: 'Extract data',
      blurb: 'Pull structured data out of messy text as JSON.',
      goal: 'Extract every job listed in this resume text.',
      role: 'You are a precise data extraction system. You extract only what is present in the source and never invent values.',
      format: 'Valid JSON only, with no surrounding text. Use null for any field not present in the source.',
      tech: [],
      fields: [
        { id: 'fields', label: 'Fields to extract / JSON schema', type: 'code', ph: '{ "company": "string", "title": "string", "start": "YYYY-MM", "end": "YYYY-MM or null" }' },
        { id: 'source', label: 'Source text', type: 'code', ph: 'Paste the text to extract from' }
      ]
    }
  ];

  var TECHS = [
    { id: 'stepback', label: 'Step-back',
      desc: 'Consider the general principles first, then apply them. Good for reviews, analysis, ideas.',
      text: 'Before answering, take a step back: briefly identify the general principles or key considerations that matter for this kind of task, then use them to shape your answer.' },
    { id: 'cot', label: 'Chain of thought',
      desc: 'Reason step by step, answer last. Good for debugging, math, logic.',
      text: 'Reason through the problem step by step before reaching a conclusion. Put your final answer after the reasoning, under a heading "Final answer".' },
    { id: 'tot', label: 'Explore alternatives',
      desc: 'Tree of thoughts: weigh several approaches before picking one. Good for design.',
      text: 'Generate at least three distinct approaches, compare their trade-offs, then choose the best one and explain why before developing it fully.' },
    { id: 'clarify', label: 'Ask first',
      desc: 'Model asks clarifying questions if key info is missing.',
      text: 'If anything essential is missing or ambiguous, ask me up to 3 clarifying questions before you start. Otherwise, proceed and list any assumptions you made.' }
  ];

  // Action verbs from the whitepaper's "Design with simplicity" list, plus common build verbs.
  var VERBS = ('act analyze categorize classify contrast compare create describe define evaluate extract find ' +
    'generate identify list measure organize parse pick predict provide rank recommend return retrieve rewrite ' +
    'select show sort summarize translate write build design debug fix plan review explain draft edit implement ' +
    'refactor propose outline brainstorm audit diagnose convert critique improve suggest test investigate research ' +
    'estimate calculate map prioritize assess teach help tighten shorten expand turn make update add').split(' ');

  var NEGATIVE = /^\s*(-\s*)?(don'?t|do not|never|avoid|no |not )/i;

  // ---------- State ----------

  var STORAGE_KEY = 'prompt-builder-v1';
  var COMMON = ['goal', 'context', 'role', 'format', 'length', 'tone', 'examples', 'constraints'];

  function blankState() {
    var t = TASKS[0];
    return {
      task: t.id, goal: '', context: '', role: t.role, format: t.format,
      length: '', tone: '', examples: '', constraints: '',
      tech: techDefaults(t), details: {}
    };
  }

  function techDefaults(task) {
    var o = {};
    TECHS.forEach(function (x) { o[x.id] = task.tech.indexOf(x.id) !== -1; });
    return o;
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && taskById(s.task)) return Object.assign(blankState(), s);
    } catch (e) { /* storage unavailable */ }
    return blankState();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function taskById(id) {
    for (var i = 0; i < TASKS.length; i++) if (TASKS[i].id === id) return TASKS[i];
    return null;
  }

  var state = load();
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Rendering the form ----------

  function renderTasks() {
    var box = $('tk-tasks');
    box.innerHTML = '';
    TASKS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tk-task mono';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t.id === state.task));
      b.textContent = t.label;
      b.addEventListener('click', function () { selectTask(t.id); });
      box.appendChild(b);
    });
    $('tk-task-blurb').textContent = taskById(state.task).blurb;
  }

  function renderDetails() {
    var t = taskById(state.task);
    var vals = state.details[t.id] || {};
    var box = $('tk-details');
    box.innerHTML = '';
    t.fields.forEach(function (f) {
      var label = document.createElement('label');
      label.className = 'tk-field';
      var span = document.createElement('span');
      span.className = 'tk-label';
      span.textContent = f.label;
      var input;
      if (f.type === 'text') {
        input = document.createElement('input');
        input.type = 'text';
      } else {
        input = document.createElement('textarea');
        input.rows = f.type === 'code' ? 5 : 3;
        if (f.type === 'code') { input.className = 'tk-code'; input.spellcheck = false; }
      }
      input.placeholder = f.ph;
      input.value = vals[f.id] || '';
      input.addEventListener('input', function () {
        state.details[t.id] = state.details[t.id] || {};
        state.details[t.id][f.id] = input.value;
        update();
      });
      label.appendChild(span);
      label.appendChild(input);
      box.appendChild(label);
    });
  }

  function renderTechs() {
    var box = $('tk-techs');
    box.innerHTML = '';
    var rec = taskById(state.task).tech;
    TECHS.forEach(function (x) {
      var label = document.createElement('label');
      label.className = 'tk-tech';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!state.tech[x.id];
      cb.addEventListener('change', function () { state.tech[x.id] = cb.checked; update(); });
      var body = document.createElement('span');
      var name = document.createElement('strong');
      name.textContent = x.label;
      body.appendChild(name);
      if (rec.indexOf(x.id) !== -1) {
        var tag = document.createElement('span');
        tag.className = 'tk-rec mono';
        tag.textContent = 'recommended';
        body.appendChild(tag);
      }
      var d = document.createElement('span');
      d.className = 'tk-tech-desc';
      d.textContent = x.desc;
      body.appendChild(d);
      label.appendChild(cb);
      label.appendChild(body);
      box.appendChild(label);
    });
  }

  function syncCommonInputs() {
    var t = taskById(state.task);
    COMMON.forEach(function (k) { $('f-' + k).value = state[k]; });
    $('f-goal').placeholder = 'e.g. ' + t.goal;
  }

  function selectTask(id) {
    var prev = taskById(state.task);
    var next = taskById(id);
    // Swap in the new task's defaults, but keep anything the user customized.
    if (state.role.trim() === '' || state.role === prev.role) state.role = next.role;
    if (state.format.trim() === '' || state.format === prev.format) state.format = next.format;
    state.tech = techDefaults(next);
    state.task = id;
    renderTasks();
    renderDetails();
    renderTechs();
    syncCommonInputs();
    update();
  }

  // ---------- Building the prompt ----------

  function fence(text) {
    // Use a fence longer than any backtick run inside the text.
    var runs = text.match(/`{3,}/g) || [];
    var n = runs.reduce(function (m, r) { return Math.max(m, r.length + 1); }, 3);
    var f = new Array(n + 1).join('`');
    return f + '\n' + text + '\n' + f;
  }

  function build() {
    var t = taskById(state.task);
    var vals = state.details[t.id] || {};
    var out = [];
    var v = function (s) { return (s || '').trim(); };

    out.push('# Role\n' + (v(state.role) || t.role));

    out.push('# Task\n' + (v(state.goal) || '[Your goal: ' + t.goal + ']'));

    if (v(state.context)) out.push('# Context\n' + v(state.context));

    var details = [];
    t.fields.forEach(function (f) {
      var val = v(vals[f.id]);
      if (!val) return;
      if (f.type === 'code') details.push(f.label + ':\n' + fence(val));
      else if (val.indexOf('\n') !== -1) details.push(f.label + ':\n' + val);
      else details.push(f.label + ': ' + val);
    });
    if (details.length) out.push('# Details\n' + details.join('\n\n'));

    var approach = TECHS.filter(function (x) { return state.tech[x.id]; })
      .map(function (x) { return '- ' + x.text; });
    if (approach.length) out.push('# Approach\n' + approach.join('\n'));

    var fmt = [v(state.format) || t.format];
    if (v(state.length)) fmt.push('Length: ' + v(state.length) + '.');
    if (v(state.tone)) fmt.push('Tone: ' + v(state.tone) + '.');
    out.push('# Output format\n' + fmt.join('\n'));

    var reqs = v(state.constraints).split('\n').map(function (l) { return l.replace(/^\s*[-*•]\s*/, '').trim(); })
      .filter(Boolean).map(function (l) { return '- ' + l; });
    if (reqs.length) out.push('# Requirements\n' + reqs.join('\n'));

    var ex = v(state.examples).split(/\n\s*---+\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (ex.length) {
      var intro = ex.length === 1
        ? 'Here is an example of the kind of output I want. Match its style and structure, not its specific content.'
        : 'Here are examples of the kind of output I want. Match their style and structure, not their specific content.';
      out.push('# Examples\n' + intro + '\n\n' + ex.map(function (e) {
        return '<example>\n' + e + '\n</example>';
      }).join('\n\n'));
    }

    return out.join('\n\n');
  }

  // ---------- Prompt check (whitepaper best practices) ----------

  function lint() {
    var t = taskById(state.task);
    var vals = state.details[t.id] || {};
    var items = [];
    var goal = state.goal.trim();
    var add = function (ok, text) { items.push({ ok: ok, text: text }); };

    if (!goal) {
      add(false, 'Add a goal: one sentence saying exactly what you want.');
    } else {
      var first = goal.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
      add(VERBS.indexOf(first) !== -1,
        VERBS.indexOf(first) !== -1 ? 'Goal starts with an action verb.'
          : 'Start the goal with an action verb (Write, Compare, Fix, Design…) rather than a question or backstory.');
      var words = goal.split(/\s+/).length;
      if (words > 40) add(false, 'The goal is ' + words + ' words long. Keep it to one clear sentence and move the background into Context.');
    }

    add(!!state.context.trim(), state.context.trim() ? 'Context provided.'
      : 'Add context. Background the model can\'t know makes the output specific to you.');

    var blank = t.fields.filter(function (f) { return !(vals[f.id] || '').trim(); }).length;
    add(blank === 0, blank === 0 ? 'All task details filled in.'
      : blank + ' of ' + t.fields.length + ' task details blank. Fill in the ones that apply.');

    add(!!state.examples.trim(), state.examples.trim() ? 'Example included.'
      : 'No example yet. The guide calls examples the single most effective practice.');

    add(!!state.length.trim(), state.length.trim() ? 'Length specified.'
      : 'Specify a length so the output is the size you need.');

    var neg = state.constraints.split('\n').filter(function (l) { return NEGATIVE.test(l); });
    if (neg.length) {
      add(false, neg.length + ' requirement' + (neg.length > 1 ? 's are' : ' is') +
        ' phrased as a "don\'t". Instructions beat constraints: say what to do instead.');
    }

    if (state.tech.cot && state.tech.tot) {
      add(false, 'Chain of thought and Explore alternatives both add reasoning. One is usually enough.');
    }

    return items;
  }

  // ---------- Update loop ----------

  function update() {
    var text = build();
    $('tk-prompt').textContent = text;
    var words = text.split(/\s+/).filter(Boolean).length;
    $('tk-count').textContent = words + ' words';

    var ul = $('tk-lint');
    ul.innerHTML = '';
    lint().forEach(function (it) {
      var li = document.createElement('li');
      li.className = it.ok ? 'ok' : 'todo';
      li.textContent = it.text;
      ul.appendChild(li);
    });
    save();
  }

  COMMON.forEach(function (k) {
    $('f-' + k).addEventListener('input', function (e) { state[k] = e.target.value; update(); });
  });

  $('tk-copy').addEventListener('click', function () {
    var btn = this;
    var text = build();
    var done = function () {
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = 'Copy prompt'; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'Select and copy manually'; }
      document.body.removeChild(ta);
    }
  });

  $('tk-reset').addEventListener('click', function () {
    if (!confirm('Clear every field and start over?')) return;
    var task = state.task;
    state = blankState();
    selectTask(task);
  });

  renderTasks();
  renderDetails();
  renderTechs();
  syncCommonInputs();
  update();
})();
