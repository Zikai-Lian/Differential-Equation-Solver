(function () {
  'use strict';
  const M = window.MathEngine;
  const S = window.ODESolvers;
  const { renderLatexInto, buildStepsPanel, escapeHtml, collectVars, round2 } = window.SiteUI;

  // Each category generates small-integer-coefficient problems chosen to have
  // a guaranteed closed-form answer via the corresponding solver in
  // odesolvers.js, and grades the user's typed answer against an
  // INDEPENDENT fresh RK4 integration of the same f(x,y) (or reduced
  // 2nd-order system) — not against the solver's own output — so a bug in
  // the solver couldn't accidentally validate a wrong answer as correct.
  function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function randNonZero(lo, hi) { let v; do { v = randInt(lo, hi); } while (v === 0); return v; }
  function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  const PRACTICE_CATEGORIES = [
    {
      id: 'separable', label: 'Separable', order: 1,
      generate: function () {
        const k = randNonZero(1, 3);
        const y0 = randInt(1, 4);
        const fxNode = M.parse(k + '*x'), gyNode = M.parse('1/y');
        const ic = { x0: 0, y0: y0 };
        const f = function (x, y) { return M.evaluate(fxNode, { x: x }) * M.evaluate(gyNode, { y: y }); };
        return {
          eqLatex: 'y\' = \\dfrac{' + k + 'x}{y}',
          icText: 'y(0) = ' + y0,
          order: 1, checkPoints: [0.3, 0.6, 0.9, 1.2],
          truth: function (x) { return M.rk4FirstOrder(f, ic.x0, ic.y0, x, 300).ys.slice(-1)[0]; },
          solve: function () { return S.solveSeparable(fxNode, gyNode, ic); },
        };
      },
    },
    {
      id: 'linear1', label: 'Linear (1st order)', order: 1,
      generate: function () {
        const P = randInt(1, 3), Qk = randNonZero(-3, 3);
        const Pnode = M.parse(String(P)), Qnode = M.parse(Qk + '*x');
        const y0 = randInt(-2, 2);
        const ic = { x0: 0, y0: y0 };
        const f = function (x, y) { return M.evaluate(Qnode, { x: x }) - M.evaluate(Pnode, { x: x }) * y; };
        return {
          eqLatex: 'y\' + ' + P + 'y = ' + Qk + 'x',
          icText: 'y(0) = ' + y0,
          order: 1, checkPoints: [0.3, 0.6, 0.9, 1.2],
          truth: function (x) { return M.rk4FirstOrder(f, ic.x0, ic.y0, x, 300).ys.slice(-1)[0]; },
          solve: function () { return S.solveLinearFirstOrder(Pnode, Qnode, ic); },
        };
      },
    },
    {
      id: 'homog2', label: '2nd-order homogeneous', order: 2,
      generate: function () {
        let r1, r2; do { r1 = randInt(-3, 3); r2 = randInt(-3, 3); } while (r1 === r2);
        const a = 1, b = -(r1 + r2), c = r1 * r2;
        const y0 = randInt(-2, 2), yp0 = randInt(-2, 2);
        const ic = { x0: 0, y0: y0, yp0: yp0 };
        const g2 = function (x, y, v) { return (0 - b * v - c * y) / a; };
        return {
          eqLatex: 'y\'\' ' + (b >= 0 ? '+' : '-') + ' ' + Math.abs(b) + 'y\' ' + (c >= 0 ? '+' : '-') + ' ' + Math.abs(c) + 'y = 0',
          icText: 'y(0)=' + y0 + ',\\ y\'(0)=' + yp0,
          order: 2, checkPoints: [0.3, 0.6, 0.9, 1.2],
          truth: function (x) { return M.rk4SecondOrder(g2, 0, y0, yp0, x, 300).ys.slice(-1)[0]; },
          solve: function () { return S.solveHomogeneous2ndOrder(a, b, c, ic); },
        };
      },
    },
    {
      id: 'nonhomog2', label: '2nd-order nonhomogeneous', order: 2,
      generate: function () {
        let r1, r2; do { r1 = randInt(-2, 2); r2 = randInt(-2, 2); } while (r1 === r2);
        const a = 1, b = -(r1 + r2), c = r1 * r2;
        const gType = randChoice(['const', 'lin', 'sin']);
        const k = randNonZero(1, 3);
        let gStr, gLatex;
        if (gType === 'const') { gStr = String(k); gLatex = String(k); }
        else if (gType === 'lin') { gStr = k + '*x'; gLatex = k + 'x'; }
        else { gStr = 'sin(' + k + '*x)'; gLatex = '\\sin(' + k + 'x)'; }
        const gNode = M.parse(gStr);
        const y0 = randInt(-2, 2), yp0 = randInt(-2, 2);
        const ic = { x0: 0, y0: y0, yp0: yp0 };
        const g2 = function (x, y, v) { return (M.evaluate(gNode, { x: x }) - b * v - c * y) / a; };
        return {
          eqLatex: 'y\'\' ' + (b >= 0 ? '+' : '-') + ' ' + Math.abs(b) + 'y\' ' + (c >= 0 ? '+' : '-') + ' ' + Math.abs(c) + 'y = ' + gLatex,
          icText: 'y(0)=' + y0 + ',\\ y\'(0)=' + yp0,
          order: 2, checkPoints: [0.3, 0.6, 0.9, 1.2],
          truth: function (x) { return M.rk4SecondOrder(g2, 0, y0, yp0, x, 300).ys.slice(-1)[0]; },
          solve: function () { return S.solveNonhomogeneous2ndOrder(a, b, c, gNode, ic); },
        };
      },
    },
    {
      id: 'cauchyEuler', label: 'Cauchy-Euler', order: 2,
      generate: function () {
        const a = 1;
        const b = randInt(-3, 3), c = randInt(-3, 3);
        const x0 = randChoice([1, 2, -1, -2]);
        const y0 = randInt(-2, 2), yp0 = randInt(-2, 2);
        const ic = { x0: x0, y0: y0, yp0: yp0 };
        const g2 = function (x, y, v) { return (0 - b * x * v - c * y) / (a * x * x); };
        return {
          eqLatex: 'x^2y\'\' ' + (b >= 0 ? '+' : '-') + ' ' + Math.abs(b) + 'xy\' ' + (c >= 0 ? '+' : '-') + ' ' + Math.abs(c) + 'y = 0',
          icText: 'y(' + x0 + ')=' + y0 + ',\\ y\'(' + x0 + ')=' + yp0,
          order: 2, checkPoints: x0 > 0 ? [x0 + 0.3, x0 + 0.6, x0 + 0.9, x0 + 1.2] : [x0 - 0.3, x0 - 0.6, x0 - 0.9, x0 - 1.2],
          truth: function (x) { return M.rk4SecondOrder(g2, x0, y0, yp0, x, 300).ys.slice(-1)[0]; },
          solve: function () { return S.solveCauchyEuler(a, b, c, M.parse('0'), ic); },
        };
      },
    },
  ];

  let currentProblem = null;

  function loadScore() {
    try { return JSON.parse(localStorage.getItem('steps-and-slopes-practice-score') || '{"correct":0,"total":0}'); }
    catch (e) { return { correct: 0, total: 0 }; }
  }
  function saveScore(s) {
    try { localStorage.setItem('steps-and-slopes-practice-score', JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  function updateScoreDisplay() {
    const s = loadScore();
    const el = document.getElementById('scoreDisplay');
    if (el) el.textContent = 'Score this session: ' + s.correct + ' / ' + s.total + ' correct';
  }

  function newProblem(catChoice) {
    const cat = catChoice === 'random'
      ? PRACTICE_CATEGORIES[Math.floor(Math.random() * PRACTICE_CATEGORIES.length)]
      : PRACTICE_CATEGORIES.filter(function (c) { return c.id === catChoice; })[0];
    currentProblem = cat.generate();
    currentProblem.categoryDef = cat;
    renderProblem();
  }

  function renderProblem() {
    const area = document.getElementById('problemArea');
    area.innerHTML = '';
    const p = currentProblem;

    const card = document.createElement('div');
    card.className = 'panel solution-card';
    const tag = document.createElement('span');
    tag.className = 'method-tag';
    tag.textContent = p.categoryDef.label;
    card.appendChild(tag);
    const h2 = document.createElement('h2');
    h2.textContent = 'Solve this';
    card.appendChild(h2);
    const eqEl = document.createElement('div');
    eqEl.className = 'final-eq';
    card.appendChild(eqEl);
    renderLatexInto(eqEl, p.eqLatex, true);
    const icEl = document.createElement('div');
    icEl.className = 'step-eq';
    card.appendChild(icEl);
    renderLatexInto(icEl, p.icText, true);

    const answerWrap = document.createElement('div');
    answerWrap.className = 'field';
    answerWrap.innerHTML = '<label><span>Your answer: y(x) =</span></label>';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'practiceAnswer';
    input.placeholder = p.order === 2 ? 'e.g. 2*exp(x) - exp(-x)' : 'e.g. x^2 + 1';
    input.autocomplete = 'off';
    input.spellcheck = false;
    answerWrap.appendChild(input);
    card.appendChild(answerWrap);

    const btnRow = document.createElement('div');
    btnRow.className = 'example-row';
    const checkBtn = document.createElement('button');
    checkBtn.type = 'button'; checkBtn.className = 'chip'; checkBtn.textContent = 'Check answer';
    const revealBtn = document.createElement('button');
    revealBtn.type = 'button'; revealBtn.className = 'chip'; revealBtn.textContent = 'Reveal solution';
    btnRow.appendChild(checkBtn); btnRow.appendChild(revealBtn);
    card.appendChild(btnRow);

    const feedback = document.createElement('div');
    feedback.id = 'practiceFeedback';
    card.appendChild(feedback);
    area.appendChild(card);

    checkBtn.addEventListener('click', function () { gradeAnswer(); });
    revealBtn.addEventListener('click', function () { revealSolution(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); gradeAnswer(); } });
    input.focus();
  }

  function gradeAnswer() {
    const p = currentProblem;
    const feedback = document.getElementById('practiceFeedback');
    const raw = document.getElementById('practiceAnswer').value.trim();
    if (!raw) { feedback.innerHTML = '<div class="fallback-note">Type an answer first.</div>'; return; }
    let node;
    try {
      node = M.parse(raw);
      const used = collectVars(node);
      const bad = used.filter(function (v) { return v !== 'x'; });
      if (bad.length) throw new Error('Use only x (and numeric constants) in your answer.');
    } catch (e) {
      feedback.innerHTML = '<div class="fallback-note"><strong>Could not parse:</strong> ' + escapeHtml(e.message) + '</div>';
      return;
    }
    const userFn = function (x) { return M.evaluate(node, { x: x }); };
    let maxErr = 0, worst = null;
    for (const x of p.checkPoints) {
      let yTrue, yUser;
      try { yTrue = p.truth(x); yUser = userFn(x); } catch (e) { continue; }
      if (!isFinite(yTrue) || !isFinite(yUser)) continue;
      const scale = Math.max(1, Math.abs(yTrue));
      const err = Math.abs(yTrue - yUser) / scale;
      if (worst === null || err > maxErr) { maxErr = err; worst = { x: x, yTrue: yTrue, yUser: yUser }; }
    }
    const ok = worst !== null && maxErr < 0.03;
    const score = loadScore();
    score.total++;
    if (ok) score.correct++;
    saveScore(score);
    updateScoreDisplay();
    feedback.innerHTML = ok
      ? '<div class="verify-badge verify-ok">Correct! Matches an independent numerical check to within rounding.</div>'
      : (worst
        ? '<div class="verify-badge verify-warn">Not quite — at x=' + round2(worst.x) + ', your answer gives ' + round2(worst.yUser) + ' but the correct value is about ' + round2(worst.yTrue) + '.</div>'
        : '<div class="verify-badge verify-warn">Could not check that answer (it may be undefined at the sample points) — try Reveal solution.</div>');
  }

  function revealSolution() {
    const p = currentProblem;
    const solved = p.solve();
    const feedback = document.getElementById('practiceFeedback');
    feedback.innerHTML = '';
    const finalEq = document.createElement('div');
    finalEq.className = 'final-eq';
    feedback.appendChild(finalEq);
    renderLatexInto(finalEq, solved.solutionLatex, true);
    feedback.appendChild(buildStepsPanel(solved.steps));
  }

  function init() {
    const select = document.getElementById('categorySelect');
    select.innerHTML = '<option value="random">Random mix</option>' +
      PRACTICE_CATEGORIES.map(function (c) { return '<option value="' + c.id + '">' + c.label + '</option>'; }).join('');
    document.getElementById('newProblemBtn').addEventListener('click', function () { newProblem(select.value); });
    updateScoreDisplay();
    newProblem('random');
    SiteUI.initTheme();
  }

  init();
})();
