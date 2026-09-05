// Shared UI helpers used by both the solver page (app.js) and the practice
// page (practice.js): LaTeX rendering via MathJax, the step-list renderer,
// small parsing/formatting utilities, and the light/dark theme switch.
window.SiteUI = (function () {
  'use strict';

  let mjReady = window.MathJax && window.MathJax.startup && window.MathJax.startup.promise
    ? window.MathJax.startup.promise
    : Promise.resolve();

  function renderLatexInto(el, latex, displayMode) {
    el.innerHTML = '';
    if (!latex) return;
    mjReady.then(function () {
      try {
        const node = MathJax.tex2svg(latex, { display: displayMode !== false });
        el.innerHTML = '';
        el.appendChild(node);
      } catch (e) {
        el.textContent = latex;
      }
    }).catch(function () {
      el.textContent = latex;
    });
  }

  function buildStepsPanel(steps) {
    const stepsPanel = document.createElement('div');
    stepsPanel.className = 'panel steps';
    steps.forEach(function (s, i) {
      const stepEl = document.createElement('div');
      stepEl.className = 'step';
      const numEl = document.createElement('div');
      numEl.className = 'step-num';
      numEl.textContent = String(i + 1);
      stepEl.appendChild(numEl);
      const body = document.createElement('div');
      body.className = 'step-body';
      const h3 = document.createElement('h3');
      h3.textContent = s.title;
      body.appendChild(h3);
      if (s.latex) {
        const eqEl = document.createElement('div');
        eqEl.className = 'step-eq';
        body.appendChild(eqEl);
        renderLatexInto(eqEl, s.latex, true);
      }
      if (s.text) {
        const p = document.createElement('p');
        p.className = 'step-text';
        p.textContent = s.text;
        body.appendChild(p);
      }
      stepEl.appendChild(body);
      stepsPanel.appendChild(stepEl);
    });
    return stepsPanel;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function collectVars(node) {
    const found = new Set();
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.t === 'var' && n.n !== 'e' && n.n !== 'pi') found.add(n.n);
      if (n.a) walk(n.a);
      if (n.b) walk(n.b);
    })(node);
    return Array.from(found);
  }

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); const args = arguments; t = setTimeout(function () { fn.apply(null, args); }, ms); };
  }

  function round2(v) { return (Math.round(v * 100) / 100).toString(); }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('steps-and-slopes-theme'); } catch (e) {}
    const buttons = document.querySelectorAll('[data-theme-choice]');
    function apply(choice) {
      if (choice === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', choice);
      buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.themeChoice === choice); });
      try { localStorage.setItem('steps-and-slopes-theme', choice); } catch (e) {}
    }
    buttons.forEach(function (b) { b.addEventListener('click', function () { apply(b.dataset.themeChoice); }); });
    apply(saved || 'system');
  }

  return { mjReady, renderLatexInto, buildStepsPanel, escapeHtml, collectVars, debounce, round2, initTheme };
})();
