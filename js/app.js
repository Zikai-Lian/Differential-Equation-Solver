(function () {
  'use strict';
  const M = window.MathEngine;
  const S = window.ODESolvers;
  const { renderLatexInto, buildStepsPanel, escapeHtml, collectVars, debounce, round2 } = window.SiteUI;

  // ---------------- Mode definitions ----------------
  const MODES = [
    {
      id: 'separable', name: 'Separable', eqLatex: "y' = f(x)\\,g(y)",
      fields: [
        { key: 'fx', label: 'f(x)', vars: ['x'], placeholder: 'x', example: 'x' },
        { key: 'gy', label: 'g(y)', vars: ['y'], placeholder: '1/y', example: '1/y' },
      ],
      icKind: 'first', exampleIC: { x0: 0, y0: 2 },
    },
    {
      id: 'linear1', name: 'Linear (1st order)', eqLatex: "y' + P(x)\\,y = Q(x)",
      fields: [
        { key: 'P', label: 'P(x)', vars: ['x'], placeholder: '2', example: '2' },
        { key: 'Q', label: 'Q(x)', vars: ['x'], placeholder: 'x', example: 'x' },
      ],
      icKind: 'first', exampleIC: { x0: 0, y0: 1 },
    },
    {
      id: 'bernoulli', name: 'Bernoulli', eqLatex: "y' + P(x)\\,y = Q(x)\\,y^{n}",
      fields: [
        { key: 'P', label: 'P(x)', vars: ['x'], placeholder: '1', example: '1' },
        { key: 'Q', label: 'Q(x)', vars: ['x'], placeholder: 'x', example: 'x' },
        { key: 'n', label: 'n', number: true, placeholder: '2', example: '2' },
      ],
      icKind: 'first', exampleIC: { x0: 0, y0: 1 },
    },
    {
      id: 'exact', name: 'Exact', eqLatex: 'M(x,y)\\,dx + N(x,y)\\,dy = 0',
      fields: [
        { key: 'M', label: 'M(x, y)', vars: ['x', 'y'], placeholder: '2xy + 3', example: '2*x*y + 3' },
        { key: 'N', label: 'N(x, y)', vars: ['x', 'y'], placeholder: 'x^2 - 1', example: 'x^2 - 1' },
      ],
      icKind: 'first', exampleIC: { x0: 1, y0: 2 },
    },
    {
      id: 'homog2', name: '2nd-order homogeneous', eqLatex: "ay'' + by' + cy = 0",
      fields: [
        { key: 'a', label: 'a', number: true, placeholder: '1', example: '1' },
        { key: 'b', label: 'b', number: true, placeholder: '-3', example: '-3' },
        { key: 'c', label: 'c', number: true, placeholder: '2', example: '2' },
      ],
      icKind: 'second', exampleIC: { x0: 0, y0: 1, yp0: 0 },
    },
    {
      id: 'nonhomog2', name: '2nd-order nonhomogeneous', eqLatex: "ay'' + by' + cy = g(x)",
      fields: [
        { key: 'a', label: 'a', number: true, placeholder: '1', example: '1' },
        { key: 'b', label: 'b', number: true, placeholder: '0', example: '0' },
        { key: 'c', label: 'c', number: true, placeholder: '1', example: '1' },
        { key: 'g', label: 'g(x)', vars: ['x'], placeholder: 'x', example: 'x' },
      ],
      icKind: 'second', exampleIC: { x0: 0, y0: 0, yp0: 0 },
    },
    {
      id: 'cauchyEuler', name: 'Cauchy-Euler', eqLatex: "ax^2y'' + bxy' + cy = g(x)",
      fields: [
        { key: 'a', label: 'a', number: true, placeholder: '1', example: '1' },
        { key: 'b', label: 'b', number: true, placeholder: '-2', example: '-2' },
        { key: 'c', label: 'c', number: true, placeholder: '2', example: '2' },
        { key: 'g', label: 'g(x)  (0 for homogeneous)', vars: ['x'], placeholder: '0', example: 'x^3' },
      ],
      icKind: 'second', exampleIC: { x0: 1, y0: 0, yp0: 0 },
      note: 'Variable-coefficient equation of the form ax²y″+bxy′+cy=g(x). Singular at x=0, so pick an initial point x₀ ≠ 0.',
    },
    {
      id: 'system2x2', name: '2x2 linear system', eqLatex: "x'=a_{11}x+a_{12}y,\\ y'=a_{21}x+a_{22}y",
      fields: [
        { key: 'a11', label: 'a₁₁', number: true, placeholder: '1', example: '1' },
        { key: 'a12', label: 'a₁₂', number: true, placeholder: '0', example: '0' },
        { key: 'a21', label: 'a₂₁', number: true, placeholder: '0', example: '0' },
        { key: 'a22', label: 'a₂₂', number: true, placeholder: '-1', example: '-1' },
      ],
      icKind: 'system', exampleIC: { t0: 0, x0: 2, y0: 3 },
      note: 'A coupled linear system X\' = AX, solved via eigenvalues/eigenvectors, with a phase-plane plot and equilibrium classification.',
    },
    {
      id: 'laplace', name: 'Laplace transform', eqLatex: "ay''+by'+cy=g(x),\\ y(0),\\,y'(0)",
      fields: [
        { key: 'a', label: 'a', number: true, placeholder: '1', example: '1' },
        { key: 'b', label: 'b', number: true, placeholder: '0', example: '0' },
        { key: 'c', label: 'c', number: true, placeholder: '1', example: '1' },
        { key: 'g', label: 'g(x)  (use step(x-a) for a switch at x=a)', vars: ['x'], placeholder: 'step(x-1)', example: 'step(x-1)' },
      ],
      icKind: 'secondZero', exampleIC: { y0: 0, yp0: 0 },
      note: "The Laplace method's distinct strength is forcing that switches on partway through — write step(x-a) for the unit step (Heaviside function) turning on at x=a. Initial conditions are fixed at x=0.",
    },
    {
      id: 'bvp', name: 'Boundary value problem', eqLatex: "ay''+by'+cy=g(x)",
      fields: [
        { key: 'a', label: 'a', number: true, placeholder: '1', example: '1' },
        { key: 'b', label: 'b', number: true, placeholder: '0', example: '0' },
        { key: 'c', label: 'c', number: true, placeholder: '1', example: '1' },
        { key: 'g', label: 'g(x)', vars: ['x'], placeholder: 'x', example: 'x' },
      ],
      icKind: 'boundary', exampleIC: { x1: 0, y1: 0, x2: 1, y2: 0 },
      note: 'Two-point boundary value problem: y is specified at two different x-values instead of using an initial slope. If the interval happens to match an eigenvalue of the associated homogeneous (Sturm–Liouville) problem, no unique solution exists.',
    },
    {
      id: 'series', name: 'Power series', eqLatex: "y'' + p(x)y' + q(x)y = 0",
      fields: [
        { key: 'p', label: 'p(x)', vars: ['x'], placeholder: '0', example: '0' },
        { key: 'q', label: 'q(x)', vars: ['x'], placeholder: '-x', example: '-x' },
        { key: 'terms', label: 'Number of series terms', number: true, placeholder: '8', example: '10' },
      ],
      icKind: 'secondZero', exampleIC: { y0: 1, yp0: 0 },
      note: 'Power series solution about the ordinary point x=0. p(x) and q(x) must be polynomials in x (e.g. this example is the Airy equation y″ − xy = 0) — coefficients with poles or transcendental functions need the Frobenius method or numeric integration instead.',
    },
    {
      id: 'numeric', name: 'Numerical / direction field', eqLatex: "y' = f(x,y)",
      fields: [
        { key: 'f', label: 'f(x, y)', vars: ['x', 'y'], placeholder: 'x - y', example: 'x - y' },
      ],
      icKind: 'first', optionalIC: true, exampleIC: { x0: 0, y0: 1 },
      rangeFields: true,
    },
  ];

  let currentMode = MODES[0];
  const modeListEl = document.getElementById('modeList');
  const formEl = document.getElementById('odeForm');
  const resultsEl = document.getElementById('results');

  // ---------------- Sidebar: mode list ----------------
  function renderModeList() {
    modeListEl.innerHTML = '';
    MODES.forEach(function (mode) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-btn' + (mode.id === currentMode.id ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', mode.id === currentMode.id ? 'true' : 'false');
      btn.innerHTML = '<span class="mode-name">' + mode.name + '</span><span class="mode-eq" id="modeeq-' + mode.id + '"></span>';
      btn.addEventListener('click', function () {
        currentMode = mode;
        renderModeList();
        renderForm();
      });
      li.appendChild(btn);
      modeListEl.appendChild(li);
      renderLatexInto(document.getElementById('modeeq-' + mode.id), mode.eqLatex, false);
    });
  }

  // ---------------- Form rendering ----------------
  function renderForm() {
    formEl.innerHTML = '';
    formEl.dataset.mode = currentMode.id;

    if (currentMode.note) {
      const noteEl = document.createElement('p');
      noteEl.className = 'mode-note';
      noteEl.textContent = currentMode.note;
      formEl.appendChild(noteEl);
    }

    currentMode.fields.forEach(function (f) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.setAttribute('for', 'f_' + f.key);
      label.innerHTML = '<span>' + f.label + '</span>' + (f.vars ? '<span class="hint">in ' + f.vars.join(', ') + '</span>' : '');
      wrap.appendChild(label);

      const input = document.createElement('input');
      input.type = f.number ? 'number' : 'text';
      if (f.number) input.step = 'any';
      input.id = 'f_' + f.key;
      input.name = f.key;
      input.placeholder = f.placeholder || '';
      input.autocomplete = 'off';
      input.spellcheck = false;
      wrap.appendChild(input);

      let preview = null, errMsg = null;
      if (!f.number) {
        preview = document.createElement('div');
        preview.className = 'preview';
        wrap.appendChild(preview);
        errMsg = document.createElement('div');
        errMsg.className = 'err-msg';
        errMsg.hidden = true;
        wrap.appendChild(errMsg);

        input.addEventListener('input', debounce(function () {
          updatePreview(input, preview, errMsg, f);
        }, 220));
      }

      formEl.appendChild(wrap);
    });

    // Example chip
    const exampleRow = document.createElement('div');
    exampleRow.className = 'example-row';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = 'Fill in a worked example';
    chip.addEventListener('click', function () { fillExample(); });
    exampleRow.appendChild(chip);
    formEl.appendChild(exampleRow);

    // Range fields (numeric/direction-field mode only)
    if (currentMode.rangeFields) {
      const rangeWrap = document.createElement('div');
      rangeWrap.className = 'field';
      rangeWrap.innerHTML = '<label><span>Viewing window for x</span></label>';
      const row = document.createElement('div');
      row.className = 'row2';
      row.innerHTML =
        '<input type="number" step="any" id="f_xMin" placeholder="x min" value="-5">' +
        '<input type="number" step="any" id="f_xMax" placeholder="x max" value="5">';
      rangeWrap.appendChild(row);
      formEl.appendChild(rangeWrap);
    }

    // IC toggle
    const icToggleWrap = document.createElement('div');
    icToggleWrap.className = 'ic-toggle';
    const icOn = !currentMode.optionalIC ? true : false;
    icToggleWrap.innerHTML =
      '<label class="toggle"><input type="checkbox" id="icEnabled" ' + (icOn ? 'checked' : '') + '>' +
      '<span class="toggle-track"></span></label>' +
      '<span>' + (currentMode.optionalIC ? 'Use an initial condition (adds a solution curve)' : 'Initial condition') + '</span>';
    formEl.appendChild(icToggleWrap);

    const icFields = document.createElement('div');
    icFields.className = 'ic-fields';
    icFields.id = 'icFields';
    icFields.hidden = !icOn;
    if (currentMode.icKind === 'first') {
      icFields.innerHTML =
        '<div class="field"><label><span>x&#8320;</span></label>' +
        '<div class="row2"><input type="number" step="any" id="ic_x0" placeholder="x0"><input type="number" step="any" id="ic_y0" placeholder="y(x0)"></div></div>';
    } else if (currentMode.icKind === 'secondZero') {
      icFields.innerHTML =
        '<div class="field"><label><span>Initial values at x = 0</span></label>' +
        '<div class="row2"><input type="number" step="any" id="ic_y0" placeholder="y(0)"><input type="number" step="any" id="ic_yp0" placeholder="y&#8217;(0)"></div></div>';
    } else if (currentMode.icKind === 'system') {
      icFields.innerHTML =
        '<div class="field"><label><span>Initial values</span></label>' +
        '<div class="row2"><input type="number" step="any" id="ic_t0" placeholder="t0 (default 0)"><input type="number" step="any" id="ic_x0" placeholder="x(t0)"></div>' +
        '<input type="number" step="any" id="ic_y0" placeholder="y(t0)" style="margin-top:6px;"></div>';
    } else if (currentMode.icKind === 'boundary') {
      icFields.innerHTML =
        '<div class="field"><label><span>Boundary condition 1</span></label>' +
        '<div class="row2"><input type="number" step="any" id="ic_x1" placeholder="x1"><input type="number" step="any" id="ic_y1" placeholder="y(x1)"></div></div>' +
        '<div class="field"><label><span>Boundary condition 2</span></label>' +
        '<div class="row2"><input type="number" step="any" id="ic_x2" placeholder="x2"><input type="number" step="any" id="ic_y2" placeholder="y(x2)"></div></div>';
    } else {
      icFields.innerHTML =
        '<div class="field"><label><span>Initial values</span></label>' +
        '<div class="row2"><input type="number" step="any" id="ic_x0" placeholder="x0"><input type="number" step="any" id="ic_y0" placeholder="y(x0)"></div>' +
        '<input type="number" step="any" id="ic_yp0" placeholder="y&#8217;(x0)" style="margin-top:6px;"></div>';
    }
    formEl.appendChild(icFields);

    if (!currentMode.optionalIC) {
      icToggleWrap.querySelector('input').disabled = true;
      icToggleWrap.style.opacity = '0.55';
    } else {
      icToggleWrap.querySelector('input').addEventListener('change', function (e) {
        icFields.hidden = !e.target.checked;
      });
    }

    const solveBtn = document.createElement('button');
    solveBtn.type = 'submit';
    solveBtn.className = 'solve-btn';
    solveBtn.textContent = 'Solve';
    formEl.appendChild(solveBtn);

    formEl.onsubmit = function (e) { e.preventDefault(); onSolve(); };
  }

  function fillExample() {
    currentMode.fields.forEach(function (f) {
      const el = document.getElementById('f_' + f.key);
      if (el) {
        el.value = f.example;
        if (!f.number) {
          const wrap = el.closest('.field');
          updatePreview(el, wrap.querySelector('.preview'), wrap.querySelector('.err-msg'), f);
        }
      }
    });
    if (currentMode.exampleIC) {
      const icCk = document.getElementById('icEnabled');
      if (icCk) { icCk.checked = true; document.getElementById('icFields').hidden = false; }
      const x0 = document.getElementById('ic_x0'), y0 = document.getElementById('ic_y0'), yp0 = document.getElementById('ic_yp0'), t0 = document.getElementById('ic_t0');
      if (x0 && currentMode.exampleIC.x0 !== undefined) x0.value = currentMode.exampleIC.x0;
      if (y0) y0.value = currentMode.exampleIC.y0;
      if (yp0 && currentMode.exampleIC.yp0 !== undefined) yp0.value = currentMode.exampleIC.yp0;
      if (t0 && currentMode.exampleIC.t0 !== undefined) t0.value = currentMode.exampleIC.t0;
      const x1 = document.getElementById('ic_x1'), y1 = document.getElementById('ic_y1'), x2 = document.getElementById('ic_x2'), y2 = document.getElementById('ic_y2');
      if (x1 && currentMode.exampleIC.x1 !== undefined) x1.value = currentMode.exampleIC.x1;
      if (y1 && currentMode.exampleIC.y1 !== undefined) y1.value = currentMode.exampleIC.y1;
      if (x2 && currentMode.exampleIC.x2 !== undefined) x2.value = currentMode.exampleIC.x2;
      if (y2 && currentMode.exampleIC.y2 !== undefined) y2.value = currentMode.exampleIC.y2;
    }
  }

  function updatePreview(input, previewEl, errEl, fieldDef) {
    const val = input.value.trim();
    if (!val) { previewEl.innerHTML = ''; errEl.hidden = true; input.classList.remove('invalid'); return; }
    try {
      const node = M.parse(val);
      // check only allowed vars are used
      const usedVars = collectVars(node);
      const allowed = new Set(fieldDef.vars || []);
      const bad = usedVars.filter(function (v) { return !allowed.has(v); });
      if (bad.length) throw new Error('Unexpected symbol "' + bad[0] + '" — this field may only use ' + (fieldDef.vars || []).join(', '));
      renderLatexInto(previewEl, M.toLatex(node), false);
      errEl.hidden = true;
      input.classList.remove('invalid');
    } catch (e) {
      previewEl.innerHTML = '';
      errEl.textContent = e.message;
      errEl.hidden = false;
      input.classList.add('invalid');
    }
  }

  // ---------------- Solve orchestration ----------------
  function onSolve() {
    const mode = currentMode;
    let values = {};
    let parseError = null;

    for (const f of mode.fields) {
      const el = document.getElementById('f_' + f.key);
      const raw = el.value.trim();
      if (!raw) { parseError = 'Please fill in ' + f.label + '.'; el.classList.add('invalid'); break; }
      if (f.number) {
        const v = parseFloat(raw);
        if (!isFinite(v)) { parseError = f.label + ' must be a number.'; el.classList.add('invalid'); break; }
        values[f.key] = v;
      } else {
        try {
          const node = M.parse(raw);
          const usedVars = collectVars(node);
          const allowed = new Set(f.vars || []);
          const bad = usedVars.filter(function (v) { return !allowed.has(v); });
          if (bad.length) throw new Error('"' + bad[0] + '" is not allowed here — use only ' + (f.vars || []).join(', ') + '.');
          values[f.key] = node;
        } catch (e) {
          parseError = 'Could not parse ' + f.label + ': ' + e.message;
          el.classList.add('invalid');
          break;
        }
      }
    }

    if (parseError) { renderError(parseError); return; }

    let ic = null;
    const icEnabled = document.getElementById('icEnabled');
    if (icEnabled && icEnabled.checked) {
      if (mode.icKind === 'secondZero') {
        const y0 = parseFloat(document.getElementById('ic_y0').value);
        const yp0 = parseFloat(document.getElementById('ic_yp0').value);
        if (isFinite(y0) && isFinite(yp0)) ic = { x0: 0, y0: y0, yp0: yp0 };
      } else if (mode.icKind === 'system') {
        const t0Raw = document.getElementById('ic_t0').value.trim();
        const t0 = t0Raw === '' ? 0 : parseFloat(t0Raw);
        const x0 = parseFloat(document.getElementById('ic_x0').value);
        const y0 = parseFloat(document.getElementById('ic_y0').value);
        if (isFinite(t0) && isFinite(x0) && isFinite(y0)) ic = { t0: t0, x0: x0, y0: y0 };
      } else if (mode.icKind === 'boundary') {
        const x1 = parseFloat(document.getElementById('ic_x1').value);
        const y1 = parseFloat(document.getElementById('ic_y1').value);
        const x2 = parseFloat(document.getElementById('ic_x2').value);
        const y2 = parseFloat(document.getElementById('ic_y2').value);
        if (isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2)) ic = { x1: x1, y1: y1, x2: x2, y2: y2 };
      } else {
        const x0 = parseFloat(document.getElementById('ic_x0').value);
        const y0 = parseFloat(document.getElementById('ic_y0').value);
        if (isFinite(x0) && isFinite(y0)) {
          ic = { x0: x0, y0: y0 };
          if (mode.icKind === 'second') {
            const yp0 = parseFloat(document.getElementById('ic_yp0').value);
            if (isFinite(yp0)) ic.yp0 = yp0; else ic = null;
          }
        }
      }
    }

    let xRange = null;
    if (mode.rangeFields) {
      const xMin = parseFloat(document.getElementById('f_xMin').value);
      const xMax = parseFloat(document.getElementById('f_xMax').value);
      if (isFinite(xMin) && isFinite(xMax) && xMax > xMin) xRange = [xMin, xMax];
    }

    try {
      runMode(mode, values, ic, xRange);
    } catch (e) {
      renderError(e.message || String(e));
    }
  }

  // ---------------- Per-mode solving + rendering ----------------
  function runMode(mode, values, ic, xRange) {
    resultsEl.innerHTML = '';

    if (mode.id === 'numeric') {
      const fNode = values.f;
      const fFn = function (x, y) { return M.evaluate(fNode, { x: x, y: y }); };
      const range = xRange || [ic ? ic.x0 - 5 : -5, ic ? ic.x0 + 5 : 5];
      renderNumericOnly(mode, fNode, fFn, ic, range);
      return;
    }

    let solved = null, solveErr = null;
    try {
      if (mode.id === 'separable') solved = S.solveSeparable(values.fx, values.gy, ic);
      else if (mode.id === 'linear1') solved = S.solveLinearFirstOrder(values.P, values.Q, ic);
      else if (mode.id === 'bernoulli') solved = S.solveBernoulli(values.P, values.Q, values.n, ic);
      else if (mode.id === 'exact') solved = S.solveExact(values.M, values.N, ic);
      else if (mode.id === 'homog2') solved = S.solveHomogeneous2ndOrder(values.a, values.b, values.c, ic);
      else if (mode.id === 'nonhomog2') solved = S.solveNonhomogeneous2ndOrder(values.a, values.b, values.c, values.g, ic);
      else if (mode.id === 'cauchyEuler') solved = S.solveCauchyEuler(values.a, values.b, values.c, values.g, ic);
      else if (mode.id === 'system2x2') solved = S.solveLinearSystem2x2(values.a11, values.a12, values.a21, values.a22, ic);
      else if (mode.id === 'laplace') {
        if (!ic) throw new Error('Please fill in y(0) and y’(0) — the Laplace method needs both initial values.');
        solved = S.solveLaplaceIVP(values.a, values.b, values.c, values.g, ic.y0, ic.yp0);
      } else if (mode.id === 'bvp') {
        if (!ic) throw new Error('Please fill in both boundary conditions.');
        solved = S.solveBVP(values.a, values.b, values.c, values.g, ic);
      } else if (mode.id === 'series') {
        if (!ic) throw new Error('Please fill in y(0) and y’(0).');
        solved = S.solveSeriesODE(values.p, values.q, ic.y0, ic.yp0, values.terms);
      }
    } catch (e) {
      solveErr = e;
    }

    const card = document.createElement('div');
    card.className = 'panel solution-card';
    const methodTag = document.createElement('span');
    methodTag.className = 'method-tag';
    methodTag.textContent = mode.name;
    card.appendChild(methodTag);
    const h2 = document.createElement('h2');
    h2.textContent = solveErr ? (solveErr.isBVPSingular ? 'No unique solution' : 'No closed-form solution found this way') : 'Solution';
    card.appendChild(h2);
    resultsEl.appendChild(card);

    if (solveErr) {
      const note = document.createElement('div');
      note.className = 'fallback-note';
      note.innerHTML = solveErr.isBVPSingular
        ? '<strong>Singular boundary value problem.</strong> ' + escapeHtml(solveErr.message)
        : '<strong>Falling back to numerical integration.</strong> ' + escapeHtml(solveErr.message);
      resultsEl.appendChild(note);
    } else {
      const finalEq = document.createElement('div');
      finalEq.className = 'final-eq';
      card.appendChild(finalEq);
      renderLatexInto(finalEq, solved.solutionLatex, true);

      if (ic) {
        const verdict = verifyNumerically(mode, values, ic, solved);
        if (verdict) {
          const badge = document.createElement('div');
          badge.className = 'verify-badge ' + (verdict.ok ? 'verify-ok' : 'verify-warn');
          badge.textContent = verdict.ok
            ? 'Checked against an independent RK4 numerical integration — solutions agree.'
            : 'Numerical cross-check found a discrepancy (max relative difference ' + verdict.maxErr.toExponential(2) + ') — double-check this result.';
          card.appendChild(badge);
        }
      }

      resultsEl.appendChild(buildStepsPanel(solved.steps));
    }

    // Plot: numeric verification curve / phase reconstruction when we have an IC
    if (mode.id === 'homog2' || mode.id === 'nonhomog2') {
      renderSecondOrderPlot(mode, values, ic, solved, solveErr);
    } else if (mode.id === 'cauchyEuler') {
      renderCauchyEulerPlot(values, ic, solved, solveErr);
    } else if (mode.id === 'laplace') {
      renderLaplacePlot(values, ic, solved, solveErr);
    } else if (mode.id === 'system2x2') {
      renderPhasePlanePlot(values, ic, solved);
    } else if (mode.id === 'bvp') {
      renderBVPPlot(values, ic, solved, solveErr);
    } else if (mode.id === 'series') {
      renderSeriesPlot(values, ic, solved, solveErr);
    } else if (ic) {
      renderFirstOrderPlot(mode, values, ic, solveErr);
    }
  }

  // ---------------- Plotting ----------------
  function makePlotCard(title, subtitle) {
    const card = document.createElement('div');
    card.className = 'panel plot-card';
    card.innerHTML = '<h3>' + title + '</h3><p class="plot-sub">' + subtitle + '</p><div class="plot-wrap"><canvas id="plot"></canvas></div><div class="legend" id="legend"></div>';
    resultsEl.appendChild(card);
    return card;
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 300), h = 340;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx: ctx, w: w, h: h };
  }

  function computeYRange(valuesArrays) {
    let all = [];
    valuesArrays.forEach(function (arr) { arr.forEach(function (v) { if (isFinite(v)) all.push(v); }); });
    if (!all.length) return [-10, 10];
    let lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const span = hi - lo;
    // clip extreme blow-ups to keep the plot readable
    if (span > 200) {
      const mid = (hi + lo) / 2;
      lo = mid - 100; hi = mid + 100;
    }
    const pad = (hi - lo) * 0.12;
    return [lo - pad, hi + pad];
  }

  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawAxes(ctx, w, h, xMin, xMax, yMin, yMax, mapX, mapY) {
    const gridColor = getCssVar('--panel-border') || '#ccc';
    const textColor = getCssVar('--ink-soft') || '#666';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getCssVar('--panel') || '#fff';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillStyle = textColor;

    const xStep = niceStep(xMax - xMin), yStep = niceStep(yMax - yMin);
    for (let gx = Math.ceil(xMin / xStep) * xStep; gx <= xMax; gx += xStep) {
      const px = mapX(gx);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      ctx.fillText(round2(gx), px + 3, h - 5);
    }
    for (let gy = Math.ceil(yMin / yStep) * yStep; gy <= yMax; gy += yStep) {
      const py = mapY(gy);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
      ctx.fillText(round2(gy), 4, py - 3);
    }

    // axes (x=0 / y=0) in a stronger tone
    ctx.strokeStyle = getCssVar('--ink-faint') || '#999';
    ctx.lineWidth = 1.4;
    if (0 >= xMin && 0 <= xMax) { const px = mapX(0); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); }
    if (0 >= yMin && 0 <= yMax) { const py = mapY(0); ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke(); }
  }

  function niceStep(range) {
    const raw = range / 8;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1; else if (norm < 3.5) step = 2; else if (norm < 7.5) step = 5; else step = 10;
    return step * mag;
  }

  function renderFirstOrderPlot(mode, values, ic, solveErr) {
    let f;
    if (mode.id === 'separable') f = function (x, y) { return M.evaluate(values.fx, { x: x }) * M.evaluate(values.gy, { y: y }); };
    else if (mode.id === 'linear1') f = function (x, y) { return M.evaluate(values.Q, { x: x }) - M.evaluate(values.P, { x: x }) * y; };
    else if (mode.id === 'bernoulli') f = function (x, y) { return -M.evaluate(values.P, { x: x }) * y + M.evaluate(values.Q, { x: x }) * Math.pow(y, values.n); };
    else if (mode.id === 'exact') f = function (x, y) { const n = M.evaluate(values.N, { x: x, y: y }); return n === 0 ? NaN : -M.evaluate(values.M, { x: x, y: y }) / n; };
    else return;

    const range = [ic.x0 - 5, ic.x0 + 5];
    const forward = integrateSafe(f, ic.x0, ic.y0, range[1], 400);
    const backward = integrateSafe(f, ic.x0, ic.y0, range[0], 400);
    const xsAll = backward.xs.slice().reverse().concat(forward.xs.slice(1));
    const ysAll = backward.ys.slice().reverse().concat(forward.ys.slice(1));

    makePlotCard('Solution curve', 'Numerically integrated (RK4) from the initial condition — a visual check on the closed-form result above.');
    drawFirstOrderCurve(xsAll, ysAll, ic, range);
  }

  // ---------------- Independent numerical cross-check ----------------
  // Runs a fresh RK4 integration straight from the user's original f(x,y)/M,N/
  // a,b,c,g inputs (not from anything the symbolic solver derived) and compares
  // it against the closed-form answer. This is a safety net: a discrepancy here
  // means either a solver bug or a subtlety the closed-form method missed, and
  // it gives the user independent evidence that a clean-looking symbolic answer
  // is actually correct rather than just plausible-looking.
  function verifyNumerically(mode, values, ic, solved) {
    try {
      if (mode.id === 'separable' || mode.id === 'exact') {
        let f;
        if (mode.id === 'separable') {
          f = function (x, y) { return M.evaluate(values.fx, { x: x }) * M.evaluate(values.gy, { y: y }); };
        } else {
          f = function (x, y) {
            const n = M.evaluate(values.N, { x: x, y: y });
            return n === 0 ? NaN : -M.evaluate(values.M, { x: x, y: y }) / n;
          };
        }
        const range = [ic.x0 - 1.5, ic.x0 + 1.5];
        const fwd = rk4StopOnSingular(f, ic.x0, ic.y0, range[1], 240);
        const bwd = rk4StopOnSingular(f, ic.x0, ic.y0, range[0], 240);
        const xs = bwd.xs.slice().reverse().concat(fwd.xs.slice(1));
        const ys = bwd.ys.slice().reverse().concat(fwd.ys.slice(1));
        // The implicit relation F(x,y)=C (or leftInt(y)-rightInt(x)=C) should
        // hold as a conserved quantity all along the true trajectory, so we
        // check that it stays constant rather than solving it for y directly.
        const residuals = [];
        const stride = Math.max(1, Math.floor(xs.length / 30));
        for (let i = 0; i < xs.length; i += stride) {
          const x = xs[i], y = ys[i];
          if (!isFinite(x) || !isFinite(y)) continue;
          try {
            const val = mode.id === 'separable'
              ? M.evaluate(solved.leftInt, { y: y }) - M.evaluate(solved.rightInt, { x: x })
              : M.evaluate(solved.FNode, { x: x, y: y });
            if (isFinite(val)) residuals.push(val);
          } catch (e) { /* skip point */ }
        }
        if (residuals.length < 3) return null;
        const mean = residuals.reduce(function (a, b) { return a + b; }, 0) / residuals.length;
        const spread = Math.max.apply(null, residuals.map(function (r) { return Math.abs(r - mean); }));
        const scale = Math.max(1, Math.abs(mean));
        const relErr = spread / scale;
        return { ok: relErr < 1e-2, maxErr: relErr };
      }

      if (mode.id === 'linear1' || mode.id === 'bernoulli') {
        if (!solved.ySolNode) return null;
        let f;
        if (mode.id === 'linear1') {
          f = function (x, y) { return M.evaluate(values.Q, { x: x }) - M.evaluate(values.P, { x: x }) * y; };
        } else {
          f = function (x, y) { return -M.evaluate(values.P, { x: x }) * y + M.evaluate(values.Q, { x: x }) * Math.pow(y, values.n); };
        }
        const range = [ic.x0 - 1.5, ic.x0 + 1.5];
        const fwd = rk4StopOnSingular(f, ic.x0, ic.y0, range[1], 240);
        const bwd = rk4StopOnSingular(f, ic.x0, ic.y0, range[0], 240);
        const xs = bwd.xs.slice().reverse().concat(fwd.xs.slice(1));
        const ys = bwd.ys.slice().reverse().concat(fwd.ys.slice(1));
        return compareCurveToSymbolic(xs, ys, function (x) { return M.evaluate(solved.ySolNode, { x: x }); });
      }

      if (mode.id === 'homog2' || mode.id === 'nonhomog2') {
        if (!solved.yFn) return null;
        const a = values.a, b = values.b, c = values.c;
        const gFn = mode.id === 'nonhomog2' ? function (x) { return M.evaluate(values.g, { x: x }); } : function () { return 0; };
        const g2 = function (x, y, v) { return (gFn(x) - b * v - c * y) / a; };
        const range = [ic.x0 - 1.5, ic.x0 + 1.5];
        const fwd = M.rk4SecondOrder(g2, ic.x0, ic.y0, ic.yp0, range[1], 240);
        const bwd = M.rk4SecondOrder(g2, ic.x0, ic.y0, ic.yp0, range[0], 240);
        const xs = bwd.xs.slice().reverse().concat(fwd.xs.slice(1));
        const ys = bwd.ys.slice().reverse().concat(fwd.ys.slice(1));
        return compareCurveToSymbolic(xs, ys, solved.yFn);
      }

      if (mode.id === 'cauchyEuler') {
        if (!solved.yFn) return null;
        const a = values.a, b = values.b, c = values.c;
        const gFn = function (x) { return M.evaluate(values.g, { x: x }); };
        const g2 = function (x, y, v) { return (gFn(x) - b * x * v - c * y) / (a * x * x); };
        // Stay well clear of the singularity at x=0 in both directions — RK4
        // on 1/x^2-type coefficients gets numerically stiff as x -> 0, which
        // would otherwise look like a false discrepancy near the axis.
        const span = Math.abs(ic.x0) * 0.6;
        const range = ic.x0 > 0 ? [ic.x0 - span, ic.x0 + span] : [ic.x0 - span, ic.x0 + span];
        const fwd = M.rk4SecondOrder(g2, ic.x0, ic.y0, ic.yp0, range[1], 240);
        const bwd = M.rk4SecondOrder(g2, ic.x0, ic.y0, ic.yp0, range[0], 240);
        const xs = bwd.xs.slice().reverse().concat(fwd.xs.slice(1));
        const ys = bwd.ys.slice().reverse().concat(fwd.ys.slice(1));
        return compareCurveToSymbolic(xs, ys, solved.yFn);
      }

      if (mode.id === 'laplace') {
        if (!solved.yFn) return null;
        const a = values.a, b = values.b, c = values.c;
        const gFn = function (x) { return M.evaluate(values.g, { x: x }); };
        const g2 = function (x, y, v) { return (gFn(x) - b * v - c * y) / a; };
        const fwd = M.rk4SecondOrder(g2, 0, ic.y0, ic.yp0, 6, 240);
        return compareCurveToSymbolic(fwd.xs, fwd.ys, solved.yFn);
      }

      if (mode.id === 'series') {
        if (!solved.yFn) return null;
        const pFn = (x) => M.evaluate(values.p, { x });
        const qFn = (x) => M.evaluate(values.q, { x });
        const g2 = (x, y, v) => -(pFn(x) * v + qFn(x) * y);
        const span = 0.6;
        const fwd = M.rk4SecondOrder(g2, 0, ic.y0, ic.yp0, span, 200);
        const bwd = M.rk4SecondOrder(g2, 0, ic.y0, ic.yp0, -span, 200);
        const xs = bwd.xs.slice().reverse().concat(fwd.xs.slice(1));
        const ys = bwd.ys.slice().reverse().concat(fwd.ys.slice(1));
        // Looser tolerance than the other checks: this is a genuinely truncated
        // series, so even a correct implementation won't match RK4 to 1e-2 once
        // the omitted tail terms start to matter.
        const errs = [];
        const stride = Math.max(1, Math.floor(xs.length / 30));
        for (let i = 0; i < xs.length; i += stride) {
          const x = xs[i], yNum = ys[i];
          if (!isFinite(x) || !isFinite(yNum)) continue;
          const ySym = solved.yFn(x);
          if (!isFinite(ySym)) continue;
          const scale = Math.max(1, Math.abs(yNum));
          errs.push(Math.abs(ySym - yNum) / scale);
        }
        if (errs.length < 3) return null;
        const maxErr = Math.max.apply(null, errs);
        return { ok: maxErr < 0.05, maxErr };
      }

      if (mode.id === 'bvp') {
        if (!solved.yFn) return null;
        const a = values.a, b = values.b, c = values.c;
        const gFn = (x) => M.evaluate(values.g, { x });
        const g2 = (x, y, v) => (gFn(x) - b * v - c * y) / a;
        // Independent shooting-method check: since the ODE is linear, y(x2)
        // is an affine function of the trial slope at x1, so two RK4 shots
        // pin it down exactly without needing the symbolic solution's own
        // derivative at x1.
        function shoot(slope) {
          return M.rk4SecondOrder(g2, ic.x1, ic.y1, slope, ic.x2, 240).ys.slice(-1)[0];
        }
        const A0 = shoot(0), A1 = shoot(1);
        const Bslope = A1 - A0;
        if (Math.abs(Bslope) < 1e-9) return null;
        const trueSlope = (ic.y2 - A0) / Bslope;
        const fwd = M.rk4SecondOrder(g2, ic.x1, ic.y1, trueSlope, ic.x2, 240);
        return compareCurveToSymbolic(fwd.xs, fwd.ys, solved.yFn);
      }

      if (mode.id === 'system2x2') {
        if (!solved.xFn || !solved.yFn) return null;
        const t0 = ic.t0 || 0;
        const g2sys = function (t, state) {
          const [x, y] = state;
          const [vx, vy] = solved.vectorField(x, y);
          return [vx, vy];
        };
        // simple RK4 on the 2-vector state, independent of the closed-form path
        function rk4Vec(f, t0, s0, tEnd, steps) {
          const hh = (tEnd - t0) / steps;
          let t = t0, s = s0.slice();
          const add2 = (u, v, k) => [u[0] + k * v[0], u[1] + k * v[1]];
          for (let i = 0; i < steps; i++) {
            const k1 = f(t, s);
            const k2 = f(t + hh / 2, add2(s, k1, hh / 2));
            const k3 = f(t + hh / 2, add2(s, k2, hh / 2));
            const k4 = f(t + hh, add2(s, k3, hh));
            s = [s[0] + (hh / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), s[1] + (hh / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
            t += hh;
          }
          return s;
        }
        const errs = [];
        for (const dt of [0.3, 0.7, 1.1, 1.5]) {
          const sEnd = rk4Vec(g2sys, t0, [ic.x0, ic.y0], t0 + dt, 200);
          const symX = solved.xFn(t0 + dt), symY = solved.yFn(t0 + dt);
          if (!isFinite(sEnd[0]) || !isFinite(sEnd[1]) || !isFinite(symX) || !isFinite(symY)) continue;
          const scale = Math.max(1, Math.abs(sEnd[0]), Math.abs(sEnd[1]));
          errs.push((Math.abs(sEnd[0] - symX) + Math.abs(sEnd[1] - symY)) / scale);
        }
        if (errs.length < 2) return null;
        const maxErr = Math.max.apply(null, errs);
        return { ok: maxErr < 1e-2, maxErr };
      }
    } catch (e) { return null; }
    return null;
  }

  // Compares a numerically-integrated (xs, ys) trajectory against a symbolic
  // function symFn(x), sampling a spread of points and taking the worst
  // relative error (skipping any point where either side blows up or a
  // singularity makes the comparison meaningless).
  function compareCurveToSymbolic(xs, ys, symFn) {
    const errs = [];
    const stride = Math.max(1, Math.floor(xs.length / 30));
    for (let i = 0; i < xs.length; i += stride) {
      const x = xs[i], yNum = ys[i];
      if (!isFinite(x) || !isFinite(yNum) || Math.abs(yNum) > 200) continue;
      let ySym;
      try { ySym = symFn(x); } catch (e) { continue; }
      if (!isFinite(ySym)) continue;
      const scale = Math.max(1, Math.abs(yNum));
      errs.push(Math.abs(ySym - yNum) / scale);
    }
    if (errs.length < 3) return null;
    const maxErr = Math.max.apply(null, errs);
    return { ok: maxErr < 1e-2, maxErr: maxErr };
  }

  // Like M.rk4FirstOrder, but truncates the trajectory the moment f(x,y)
  // returns a non-finite slope (e.g. dy/dx = -M/N at a point where N = 0),
  // rather than silently substituting a slope of 0 — a substitution that
  // would otherwise send the numerical trajectory off in the wrong direction
  // and produce a false "discrepancy" against the true (singular) solution.
  // Used only for the numerical cross-check, where correctness matters more
  // than always having a full curve to draw.
  function rk4StopOnSingular(f, x0, y0, xEnd, steps) {
    const h = (xEnd - x0) / steps;
    const xs = [x0], ys = [y0];
    let x = x0, y = y0;
    for (let i = 0; i < steps; i++) {
      const k1 = f(x, y);
      if (!isFinite(k1)) break;
      const k2 = f(x + h / 2, y + (h / 2) * k1);
      if (!isFinite(k2)) break;
      const k3 = f(x + h / 2, y + (h / 2) * k2);
      if (!isFinite(k3)) break;
      const k4 = f(x + h, y + h * k3);
      if (!isFinite(k4)) break;
      const yNext = y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      if (!isFinite(yNext) || Math.abs(yNext) > 1e5) break;
      y = yNext;
      x = x + h;
      xs.push(x); ys.push(y);
    }
    return { xs: xs, ys: ys };
  }

  function integrateSafe(f, x0, y0, xEnd, steps) {
    try {
      const wrapped = function (x, y) { const v = f(x, y); return isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : 0; };
      const res = M.rk4FirstOrder(wrapped, x0, y0, xEnd, steps);
      // stop early if it diverges wildly
      for (let i = 0; i < res.ys.length; i++) {
        if (!isFinite(res.ys[i]) || Math.abs(res.ys[i]) > 1e5) {
          return { xs: res.xs.slice(0, i + 1), ys: res.ys.slice(0, i + 1) };
        }
      }
      return res;
    } catch (e) {
      return { xs: [x0], ys: [y0] };
    }
  }

  function drawFirstOrderCurve(xs, ys, ic, xRange) {
    const canvas = document.getElementById('plot');
    const { ctx, w, h } = setupCanvas(canvas);
    const [xMin, xMax] = xRange;
    const [yMin, yMax] = computeYRange([ys]);
    const mapX = (x) => ((x - xMin) / (xMax - xMin)) * (w - 40) + 30;
    const mapY = (y) => h - 24 - ((y - yMin) / (yMax - yMin)) * (h - 44);

    drawAxes(ctx, w, h, xMin, xMax, yMin, yMax, mapX, mapY);

    ctx.strokeStyle = getCssVar('--accent') || '#2f5fa3';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    xs.forEach(function (x, i) {
      const px = mapX(x), py = mapY(ys[i]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // initial point marker
    ctx.fillStyle = getCssVar('--accent-2') || '#c46a2c';
    ctx.beginPath();
    ctx.arc(mapX(ic.x0), mapY(ic.y0), 4.5, 0, Math.PI * 2);
    ctx.fill();

    document.getElementById('legend').innerHTML =
      '<div class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>Solution curve</div>' +
      '<div class="legend-item"><span class="legend-swatch" style="background:var(--accent-2); height:10px; border-radius:50%; width:10px;"></span>Initial condition</div>';
  }

  function renderNumericOnly(mode, fNode, fFn, ic, xRange) {
    makePlotCard('Direction field' + (ic ? ' with solution curve' : ''), "Each short segment shows the slope f(x, y) = y' at that point; " + (ic ? 'the curve is the numerical (RK4) solution through the initial condition.' : 'add an initial condition to trace a specific solution curve.'));

    const canvas = document.getElementById('plot');
    const { ctx, w, h } = setupCanvas(canvas);
    const [xMin, xMax] = xRange;

    // sample a grid of y-values for slope field range: probe f over a default window, and expand toward the IC if given
    let yMin = -6, yMax = 6;
    if (ic) { yMin = Math.min(yMin, ic.y0 - 4); yMax = Math.max(yMax, ic.y0 + 4); }

    let curveXs = null, curveYs = null;
    if (ic) {
      const forward = integrateSafe(fFn, ic.x0, ic.y0, xMax, 300);
      const backward = integrateSafe(fFn, ic.x0, ic.y0, xMin, 300);
      curveXs = backward.xs.slice().reverse().concat(forward.xs.slice(1));
      curveYs = backward.ys.slice().reverse().concat(forward.ys.slice(1));
      const yr = computeYRange([curveYs]);
      yMin = Math.min(yMin, yr[0]); yMax = Math.max(yMax, yr[1]);
    }

    const mapX = (x) => ((x - xMin) / (xMax - xMin)) * (w - 40) + 30;
    const mapY = (y) => h - 24 - ((y - yMin) / (yMax - yMin)) * (h - 44);
    drawAxes(ctx, w, h, xMin, xMax, yMin, yMax, mapX, mapY);

    // slope field
    const cols = 22, rows = 16;
    ctx.strokeStyle = getCssVar('--ink-faint') || '#999';
    ctx.lineWidth = 1.3;
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const x = xMin + (xMax - xMin) * (i / cols);
        const y = yMin + (yMax - yMin) * (j / rows);
        let slope;
        try { slope = fFn(x, y); } catch (e) { continue; }
        if (!isFinite(slope)) continue;
        const angle = Math.atan(slope);
        const len = 9;
        const dx = Math.cos(angle) * len, dy = -Math.sin(angle) * len;
        const px = mapX(x), py = mapY(y);
        ctx.beginPath();
        ctx.moveTo(px - dx / 2, py - dy / 2);
        ctx.lineTo(px + dx / 2, py + dy / 2);
        ctx.stroke();
      }
    }

    if (curveXs) {
      ctx.strokeStyle = getCssVar('--accent') || '#2f5fa3';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      curveXs.forEach(function (x, i) {
        const px = mapX(x), py = mapY(curveYs[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.fillStyle = getCssVar('--accent-2') || '#c46a2c';
      ctx.beginPath();
      ctx.arc(mapX(ic.x0), mapY(ic.y0), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    document.getElementById('legend').innerHTML =
      '<div class="legend-item"><span class="legend-swatch" style="background:var(--ink-faint)"></span>Slope field</div>' +
      (curveXs ? '<div class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>Solution curve</div>' : '');
  }

  function renderSecondOrderPlot(mode, values, ic, solved, solveErr) {
    if (!ic || ic.yp0 === undefined) return;
    const a = values.a, b = values.b, c = values.c;
    let yFn;
    if (!solveErr && solved.C1 !== null && solved.C1 !== undefined) {
      const disc = b * b - 4 * a * c;
      const ypFn = mode.id === 'nonhomog2' && solved.ypFn ? solved.ypFn : function () { return 0; };
      if (disc > 1e-9) {
        const r1 = (-b + Math.sqrt(disc)) / (2 * a), r2 = (-b - Math.sqrt(disc)) / (2 * a);
        yFn = function (x) { return solved.C1 * Math.exp(r1 * x) + solved.C2 * Math.exp(r2 * x) + ypFn(x); };
      } else if (Math.abs(disc) <= 1e-9) {
        const r = -b / (2 * a);
        yFn = function (x) { return (solved.C1 + solved.C2 * x) * Math.exp(r * x) + ypFn(x); };
      } else {
        const alpha = -b / (2 * a), beta = Math.sqrt(-disc) / (2 * a);
        yFn = function (x) { return Math.exp(alpha * x) * (solved.C1 * Math.cos(beta * x) + solved.C2 * Math.sin(beta * x)) + ypFn(x); };
      }
    }

    const range = [ic.x0 - 5, ic.x0 + 5];
    let xs, ys;
    if (yFn) {
      xs = []; ys = [];
      for (let i = 0; i <= 200; i++) { const x = range[0] + (range[1] - range[0]) * (i / 200); xs.push(x); ys.push(yFn(x)); }
    } else {
      // numeric fallback via RK4 on the reduced system, using g(x) if present
      const gFn = mode.id === 'nonhomog2' ? function (x) { return M.evaluate(values.g, { x: x }); } : function () { return 0; };
      const g2 = function (x, y, v) { return (gFn(x) - b * v - c * y) / a; };
      const fwd = M.rk4SecondOrder(g2, ic.x0, ic.y0, ic.yp0, range[1], 400);
      const bwd = M.rk4SecondOrder(g2, ic.x0, ic.y0, ic.yp0, range[0], 400);
      xs = bwd.xs.slice().reverse().concat(fwd.xs.slice(1));
      ys = bwd.ys.slice().reverse().concat(fwd.ys.slice(1));
    }

    makePlotCard('Solution curve', yFn ? 'Plotted directly from the closed-form solution above.' : 'Closed form unavailable for plotting directly — shown via numerical (RK4) integration instead.');
    drawFirstOrderCurve(xs, ys, ic, range);
  }

  function renderCauchyEulerPlot(values, ic, solved, solveErr) {
    if (!ic || ic.yp0 === undefined) return;
    const a = values.a, b = values.b, c = values.c;
    const yFn = !solveErr && solved.yFn ? solved.yFn : null;
    // Cauchy-Euler is singular at x=0, so plot only the side of the x-axis
    // containing the initial point.
    const span = 4;
    const range = ic.x0 > 0 ? [Math.max(1e-6, ic.x0 - span), ic.x0 + span] : [ic.x0 - span, Math.min(-1e-6, ic.x0 + span)];
    let xs, ys;
    if (yFn) {
      xs = []; ys = [];
      for (let i = 0; i <= 200; i++) { const x = range[0] + (range[1] - range[0]) * (i / 200); xs.push(x); ys.push(yFn(x)); }
    } else {
      const gFn = function (x) { return M.evaluate(values.g, { x: x }); };
      const g2 = function (x, y, v) { return (gFn(x) - b * x * v - c * y) / (a * x * x); };
      const fwd = M.rk4SecondOrder(g2, ic.x0, ic.y0, ic.yp0, range[1], 400);
      const bwd = M.rk4SecondOrder(g2, ic.x0, ic.y0, ic.yp0, range[0], 400);
      xs = bwd.xs.slice().reverse().concat(fwd.xs.slice(1));
      ys = bwd.ys.slice().reverse().concat(fwd.ys.slice(1));
    }
    makePlotCard('Solution curve', yFn ? 'Plotted directly from the closed-form solution above (restricted to the side of x=0 containing x₀, since the equation is singular there).' : 'Closed form unavailable for plotting directly — shown via numerical (RK4) integration instead.');
    drawFirstOrderCurve(xs, ys, ic, range);
  }

  function renderLaplacePlot(values, ic, solved, solveErr) {
    if (!ic) return;
    const a = values.a, b = values.b, c = values.c;
    const yFn = !solveErr && solved.yFn ? solved.yFn : null;
    const range = [0, 10];
    let xs, ys;
    if (yFn) {
      xs = []; ys = [];
      for (let i = 0; i <= 300; i++) { const x = range[0] + (range[1] - range[0]) * (i / 300); xs.push(x); ys.push(yFn(x)); }
    } else {
      const gFn = function (x) { return M.evaluate(values.g, { x: x }); };
      const g2 = function (x, y, v) { return (gFn(x) - b * v - c * y) / a; };
      const fwd = M.rk4SecondOrder(g2, 0, ic.y0, ic.yp0, range[1], 400);
      xs = fwd.xs; ys = fwd.ys;
    }
    makePlotCard('Solution curve', yFn ? 'Plotted directly from the closed-form solution above.' : 'Closed form unavailable for plotting directly — shown via numerical (RK4) integration instead.');
    drawFirstOrderCurve(xs, ys, { x0: 0, y0: ic.y0 }, range);
  }

  function renderBVPPlot(values, ic, solved, solveErr) {
    if (!ic || solveErr || !solved || !solved.yFn) return;
    const lo = Math.min(ic.x1, ic.x2), hi = Math.max(ic.x1, ic.x2);
    const pad = (hi - lo) * 0.15 || 0.5;
    const range = [lo - pad, hi + pad];
    const xs = [], ys = [];
    for (let i = 0; i <= 200; i++) { const x = range[0] + (range[1] - range[0]) * (i / 200); xs.push(x); ys.push(solved.yFn(x)); }
    makePlotCard('Solution curve', 'Plotted directly from the closed-form solution above, satisfying y at both boundary points.');
    drawFirstOrderCurve(xs, ys, { x0: ic.x1, y0: ic.y1 }, range);
    // mark the second boundary point too
    const canvas = document.getElementById('plot');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    const [yMin, yMax] = computeYRange([ys]);
    const mapX = (x) => ((x - range[0]) / (range[1] - range[0])) * (w - 40) + 30;
    const mapY = (y) => h - 24 - ((y - yMin) / (yMax - yMin)) * (h - 44);
    ctx.fillStyle = getCssVar('--accent-2') || '#c46a2c';
    ctx.beginPath();
    ctx.arc(mapX(ic.x2), mapY(ic.y2), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderSeriesPlot(values, ic, solved, solveErr) {
    if (!ic || solveErr || !solved || !solved.yFn) return;
    const range = [-2, 2];
    const xs = [], ys = [];
    for (let i = 0; i <= 200; i++) { const x = range[0] + (range[1] - range[0]) * (i / 200); xs.push(x); ys.push(solved.yFn(x)); }
    makePlotCard('Truncated series', `Plotted from the ${solved.numTerms}-term truncated series — accuracy degrades away from x=0 as the tail of the series becomes significant.`);
    drawFirstOrderCurve(xs, ys, { x0: 0, y0: ic.y0 }, range);
  }

  // ---------------- Phase-plane plot for 2x2 linear systems ----------------
  function renderPhasePlanePlot(values, ic, solved) {
    if (!ic || !solved.xFn || !solved.yFn) return;
    const card = document.createElement('div');
    card.className = 'panel plot-card';
    card.innerHTML = '<h3>Phase portrait</h3><p class="plot-sub">The trajectory (x(t), y(t)) through the initial point, with the vector field (x’, y’) shown as arrows.</p><div class="plot-wrap"><canvas id="plot"></canvas></div><div class="legend" id="legend"></div>';
    resultsEl.appendChild(card);

    const canvas = document.getElementById('plot');
    const { ctx, w, h } = setupCanvas(canvas);

    const t0 = ic.t0 || 0;
    const tSpan = 8;
    const xs = [], ys = [];
    for (let i = 0; i <= 400; i++) {
      const t = t0 - tSpan + (2 * tSpan) * (i / 400);
      xs.push(solved.xFn(t)); ys.push(solved.yFn(t));
    }
    const [xMin, xMax] = computeYRange([xs]);
    const [yMin, yMax] = computeYRange([ys]);
    const mapX = (x) => ((x - xMin) / (xMax - xMin)) * (w - 40) + 30;
    const mapY = (y) => h - 24 - ((y - yMin) / (yMax - yMin)) * (h - 44);
    drawAxes(ctx, w, h, xMin, xMax, yMin, yMax, mapX, mapY);

    // vector field arrows
    const cols = 16, rows = 12;
    ctx.strokeStyle = getCssVar('--ink-faint') || '#999';
    ctx.lineWidth = 1.2;
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const x = xMin + (xMax - xMin) * (i / cols);
        const y = yMin + (yMax - yMin) * (j / rows);
        const [vx, vy] = solved.vectorField(x, y);
        const mag = Math.sqrt(vx * vx + vy * vy);
        if (!isFinite(mag) || mag < 1e-9) continue;
        const len = 10;
        const dx = (vx / mag) * len, dy = -(vy / mag) * len;
        const px = mapX(x), py = mapY(y);
        ctx.beginPath();
        ctx.moveTo(px - dx / 2, py - dy / 2);
        ctx.lineTo(px + dx / 2, py + dy / 2);
        ctx.stroke();
      }
    }

    // trajectory
    ctx.strokeStyle = getCssVar('--accent') || '#2f5fa3';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    xs.forEach(function (x, i) {
      const px = mapX(x), py = mapY(ys[i]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // initial point + origin
    ctx.fillStyle = getCssVar('--accent-2') || '#c46a2c';
    ctx.beginPath();
    ctx.arc(mapX(ic.x0), mapY(ic.y0), 4.5, 0, Math.PI * 2);
    ctx.fill();
    if (xMin <= 0 && 0 <= xMax && yMin <= 0 && 0 <= yMax) {
      ctx.fillStyle = getCssVar('--ink-faint') || '#999';
      ctx.beginPath();
      ctx.arc(mapX(0), mapY(0), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    document.getElementById('legend').innerHTML =
      '<div class="legend-item"><span class="legend-swatch" style="background:var(--ink-faint)"></span>Vector field</div>' +
      '<div class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>Trajectory</div>' +
      '<div class="legend-item"><span class="legend-swatch" style="background:var(--accent-2); height:10px; border-radius:50%; width:10px;"></span>Initial condition</div>';
  }

  function renderError(msg) {
    resultsEl.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'panel error-card';
    card.style.padding = '20px 22px';
    card.innerHTML = '<strong>Could not solve:</strong> ' + escapeHtml(msg);
    resultsEl.appendChild(card);
  }

  const modeCountTag = document.getElementById('modeCountTag');
  if (modeCountTag) modeCountTag.textContent = MODES.length + ' solution methods';

  renderModeList();
  renderForm();
  SiteUI.initTheme();
})();
