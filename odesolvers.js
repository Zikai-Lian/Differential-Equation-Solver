// ---------------------------------------------------------------------------
// ODE solving methods built on top of MathEngine. Each solver returns:
//   { steps: [{title, latex?, text?}], solutionLatex, solutionNode? (in x,y form when applicable),
//     kind: 'separable'|'linear'|...}
// or throws an Error with a user-facing .message when the method doesn't apply
// or the required symbolic integral has no closed form (caller should offer
// the numeric RK4 fallback in that case).
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./mathengine.js'));
  } else {
    root.ODESolvers = factory(root.MathEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const { num, vr, add, sub, mul, div, pow: powN, neg, fn, simplify, diff, integrate, toLatex, toPlainText, evaluate, NoClosedForm, containsVar, substVar } = M;

  function step(title, latex, text) {
    return { title, latex, text };
  }

  // ---------------- 1. Separable: dy/dx = f(x) g(y) ----------------
  // Input: f(x) node, g(y) node (as functions of x and y respectively, using
  // variable names 'x' and 'y'). Solves ∫ 1/g(y) dy = ∫ f(x) dx.
  function solveSeparable(fxNode, gyNode, ic) {
    const steps = [];
    steps.push(step(
      'Set up the separable equation',
      `\\frac{dy}{dx} = \\left(${toLatex(fxNode)}\\right)\\left(${toLatex(gyNode)}\\right)`,
      'The right-hand side factors into a function of x times a function of y, so we can separate variables.'
    ));

    const invG = div(ONE(), gyNode);
    steps.push(step(
      'Separate variables',
      `\\frac{1}{${toLatex(gyNode)}}\\,dy = \\left(${toLatex(fxNode)}\\right)dx`,
      'Divide both sides by g(y) and multiply by dx so all y-terms are on the left and all x-terms are on the right.'
    ));

    // integrate LHS with respect to y (rename var to y internally)
    const invGasY = invG; // already in y
    let leftInt, rightInt;
    try {
      leftInt = integrate(invGasY, 'y');
    } catch (e) {
      throw new NoClosedForm('Could not find a closed-form integral of 1/g(y) = ' + toPlainText(invG) + ' (' + e.message + ')');
    }
    try {
      rightInt = integrate(fxNode, 'x');
    } catch (e) {
      throw new NoClosedForm('Could not find a closed-form integral of f(x) = ' + toPlainText(fxNode) + ' (' + e.message + ')');
    }

    steps.push(step(
      'Integrate both sides',
      `\\int \\frac{1}{${toLatex(gyNode)}}\\,dy = \\int \\left(${toLatex(fxNode)}\\right) dx`,
      'Integrate the left side with respect to y and the right side with respect to x.'
    ));

    steps.push(step(
      'Evaluate the integrals',
      `${toLatex(leftInt)} = ${toLatex(rightInt)} + C`,
      'Only one constant of integration C is needed since both are indefinite integrals.'
    ));

    let finalLatex = `${toLatex(leftInt)} = ${toLatex(rightInt)} + C`;
    let Cvalue = null;
    if (ic) {
      const lhsAtIC = evaluate(leftInt, { x: ic.x0, y: ic.y0 });
      const rhsAtIC = evaluate(rightInt, { x: ic.x0, y: ic.y0 });
      Cvalue = lhsAtIC - rhsAtIC;
      steps.push(step(
        'Apply the initial condition',
        `y(${ic.x0}) = ${ic.y0} \\;\\Rightarrow\\; C = ${round(Cvalue)}`,
        `Substitute x = ${ic.x0}, y = ${ic.y0} into the implicit solution to solve for C.`
      ));
      finalLatex = `${toLatex(leftInt)} = ${toLatex(rightInt)}${plusTerm(Cvalue)}`;
    }

    return { steps, solutionLatex: finalLatex, kind: 'separable', implicit: true, C: Cvalue, leftInt, rightInt };
  }

  function ONE() { return num(1); }
  // Renders "+ C" style suffixes with a proper minus sign when C is negative,
  // e.g. plusTerm(-0.5) => " - 0.5" instead of " + -0.5".
  function plusTerm(v) {
    const r = round(v);
    return r < 0 ? ` - ${Math.abs(r)}` : ` + ${r}`;
  }
  function round(v, d) {
    d = d === undefined ? 4 : d;
    const r = Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
    return Object.is(r, -0) ? 0 : r;
  }

  // ---------------- 2. First-order linear: y' + P(x) y = Q(x) ----------------
  function solveLinearFirstOrder(Pnode, Qnode, ic) {
    const steps = [];
    steps.push(step(
      'Identify the standard form',
      `\\frac{dy}{dx} + \\left(${toLatex(Pnode)}\\right) y = ${toLatex(Qnode)}`,
      'This is already in the standard linear form y\' + P(x)y = Q(x).'
    ));

    let intP;
    try { intP = integrate(Pnode, 'x'); }
    catch (e) { throw new NoClosedForm('Could not find the integrating factor: ' + e.message); }

    const muRaw = fn('exp', intP);
    const mu = simplify(muRaw);
    steps.push(step(
      'Compute the integrating factor',
      `\\mu(x) = e^{\\int ${toLatex(Pnode)}\\,dx} = e^{${toLatex(intP)}}` + (nodeDiffers(mu, muRaw) ? ` = ${toLatex(mu)}` : ''),
      'Multiplying both sides by μ(x) will make the left side a perfect derivative, d/dx[μ(x) y].'
    ));

    const rhs = simplify(mul(mu, Qnode));
    steps.push(step(
      'Multiply through by the integrating factor',
      `\\frac{d}{dx}\\!\\left[${toLatex(mu)}\\, y\\right] = ${toLatex(mu)}\\cdot\\left(${toLatex(Qnode)}\\right) = ${toLatex(rhs)}`,
      'By construction, the left side collapses to the derivative of μ(x)·y.'
    ));

    let intRhs;
    try { intRhs = integrate(rhs, 'x'); }
    catch (e) { throw new NoClosedForm('Could not integrate μ(x)·Q(x) in closed form: ' + e.message); }

    steps.push(step(
      'Integrate both sides',
      `${toLatex(mu)}\\, y = \\int ${toLatex(rhs)}\\,dx = ${toLatex(intRhs)} + C`,
      'Integrate the right-hand side with respect to x, adding a constant of integration.'
    ));

    steps.push(step(
      'Solve for y',
      `y = \\dfrac{${toLatex(intRhs)} + C}{${toLatex(mu)}}`,
      'Divide both sides by the integrating factor μ(x) to isolate y.'
    ));

    const ySolGeneral = simplify(div(add(intRhs, vr('C')), mu));
    let finalLatex = `y = ${toLatex(ySolGeneral)}`;
    let Cvalue = null;
    let ySolNode = null;
    if (ic) {
      const muAtX0 = evaluate(mu, { x: ic.x0 });
      const intRhsAtX0 = evaluate(intRhs, { x: ic.x0 });
      Cvalue = ic.y0 * muAtX0 - intRhsAtX0;
      steps.push(step(
        'Apply the initial condition',
        `y(${ic.x0}) = ${ic.y0} \\;\\Rightarrow\\; C = ${round(Cvalue)}`,
        `Substitute x=${ic.x0}, y=${ic.y0} into μ(x)y = ∫μQ\\,dx + C and solve for C.`
      ));
      ySolNode = simplify(substVar(ySolGeneral, 'C', num(round(Cvalue))));
      finalLatex = `y = ${toLatex(ySolNode)}`;
    }

    return { steps, solutionLatex: finalLatex, kind: 'linear1', C: Cvalue, mu, intRhs, ySolNode };
  }

  // ---------------- 3. Bernoulli: y' + P(x) y = Q(x) y^n ----------------
  function solveBernoulli(Pnode, Qnode, nVal, ic) {
    if (nVal === 0 || nVal === 1) {
      throw new Error('For n = 0 or n = 1 the equation is already linear — use the Linear solver instead.');
    }
    const steps = [];
    steps.push(step(
      'Identify the Bernoulli equation',
      `\\frac{dy}{dx} + \\left(${toLatex(Pnode)}\\right) y = \\left(${toLatex(Qnode)}\\right) y^{${nVal}}`,
      `This has the Bernoulli form y' + P(x)y = Q(x)y^n with n = ${nVal} ≠ 0, 1.`
    ));

    steps.push(step(
      'Substitute v = y^{1-n}',
      `v = y^{1-${nVal}} = y^{${round(1 - nVal)}}, \\qquad \\frac{dv}{dx} = (1-${nVal})\\,y^{-${nVal}}\\frac{dy}{dx}`,
      'This substitution transforms the nonlinear equation into a linear one in v.'
    ));

    const oneMinusN = 1 - nVal;
    // Resulting linear ODE: v' + (1-n)P(x) v = (1-n)Q(x)
    const Pv = simplify(mul(num(oneMinusN), Pnode));
    const Qv = simplify(mul(num(oneMinusN), Qnode));
    steps.push(step(
      'Derive the linear equation in v',
      `\\frac{dv}{dx} + \\left(${toLatex(Pv)}\\right) v = ${toLatex(Qv)}`,
      `Dividing the original equation by y^{${nVal}} and substituting v gives a first-order linear equation: v' + (1-n)P(x)v = (1-n)Q(x).`
    ));

    // Solve the resulting linear ODE for v (no IC yet — apply after back-substitution)
    const linResult = solveLinearFirstOrder(Pv, Qv, null);
    // splice in the linear-solver's steps, relabeled (that solve was for v, not y)
    for (const s of linResult.steps.slice(1)) {
      if (s.title === 'Solve for y') {
        steps.push({ ...s, title: 'Solve for v', latex: s.latex.replace(/^y = /, 'v = ') });
      } else {
        steps.push(s);
      }
    }

    const vSolGeneral = simplify(div(add(linResult.intRhs, vr('C')), linResult.mu));
    steps.push(step(
      'Back-substitute v = y^{1-n}',
      `y^{${round(oneMinusN)}} = ${toLatex(vSolGeneral)}`,
      `Replace v with y^{1-n} to return to the original variable y.`
    ));

    let finalLatex = `y = \\left(${toLatex(vSolGeneral)}\\right)^{1/${round(oneMinusN)}}`;
    let Cvalue = null;
    let ySolNode = null;
    if (ic) {
      const vAtX0 = Math.pow(ic.y0, oneMinusN);
      const muAtX0 = evaluate(linResult.mu, { x: ic.x0 });
      const intRhsAtX0 = evaluate(linResult.intRhs, { x: ic.x0 });
      Cvalue = vAtX0 * muAtX0 - intRhsAtX0;
      steps.push(step(
        'Apply the initial condition',
        `y(${ic.x0}) = ${ic.y0} \\;\\Rightarrow\\; C = ${round(Cvalue)}`,
        'Convert the initial condition to v(x0) = y(x0)^{1-n} and solve for C as in the linear case.'
      ));
      const vSolParticular = simplify(substVar(vSolGeneral, 'C', num(round(Cvalue))));
      finalLatex = `y = \\left(${toLatex(vSolParticular)}\\right)^{1/${round(oneMinusN)}}`;
      ySolNode = powN(vSolParticular, div(ONE(), num(oneMinusN)));
    }

    return { steps, solutionLatex: finalLatex, kind: 'bernoulli', C: Cvalue, ySolNode };
  }

  // ---------------- 4. Exact equations: M(x,y)dx + N(x,y)dy = 0 ----------------
  // Requires partial derivatives w.r.t. x and y treating the other as a parameter.
  // We reuse `diff` by treating whichever variable is not being differentiated as
  // an opaque symbol (diff already does this correctly since it only acts on the
  // named variable).
  function solveExact(Mnode, Nnode, ic) {
    const steps = [];
    steps.push(step(
      'Write in the form M dx + N dy = 0',
      `\\underbrace{\\left(${toLatex(Mnode)}\\right)}_{M(x,y)}dx + \\underbrace{\\left(${toLatex(Nnode)}\\right)}_{N(x,y)}dy = 0`,
      'Identify M(x,y) and N(x,y) from the differential equation.'
    ));

    let My = simplify(diff(Mnode, 'y'));
    let Nx = simplify(diff(Nnode, 'x'));
    steps.push(step(
      'Test for exactness',
      `\\frac{\\partial M}{\\partial y} = ${toLatex(My)}, \\qquad \\frac{\\partial N}{\\partial x} = ${toLatex(Nx)}`,
      'The equation is exact if and only if these two partial derivatives are equal.'
    ));

    let isExact = JSON.stringify(My) === JSON.stringify(Nx) || approxNodesEqual(My, Nx);

    if (!isExact) {
      // Not exact as given — look for an integrating factor that depends on
      // only x or only y, the two standard cases with a closed-form recipe.
      const diffMN = simplify(sub(My, Nx));

      // (M_y - N_x)/N as a function of x alone, or (N_x - M_y)/M as a
      // function of y alone — tested via exact polynomial division (in y, or
      // in x respectively) rather than naive fraction simplification, since
      // this ratio's y (or x) dependence must genuinely cancel against the
      // denominator for the classic examples this method is built for.
      let muFactorNode = null, muDesc = null;
      const xOnlyExpr = divideToConstantIn(diffMN, Nnode, 'y');
      if (xOnlyExpr !== null) {
        let intMu;
        try { intMu = integrate(xOnlyExpr, 'x'); } catch (e) { intMu = null; }
        if (intMu) {
          muFactorNode = simplify(fn('exp', intMu));
          muDesc = { variable: 'x', expr: xOnlyExpr, intMu, label: '\\mu(x)' };
        }
      }
      if (!muFactorNode) {
        const yOnlyExpr = divideToConstantIn(simplify(neg(diffMN)), Mnode, 'x');
        if (yOnlyExpr !== null) {
          let intMu;
          try { intMu = integrate(yOnlyExpr, 'y'); } catch (e) { intMu = null; }
          if (intMu) {
            muFactorNode = simplify(fn('exp', intMu));
            muDesc = { variable: 'y', expr: yOnlyExpr, intMu, label: '\\mu(y)' };
          }
        }
      }

      if (!muFactorNode) {
        throw new Error(
          `The equation is not exact as given (∂M/∂y = ${toPlainText(My)} ≠ ∂N/∂x = ${toPlainText(Nx)}), ` +
          `and no integrating factor depending on x alone or y alone was found. Try the numeric solver instead, ` +
          `or double-check M and N.`
        );
      }

      steps.push(step(
        'Look for an integrating factor',
        muDesc.variable === 'x'
          ? `\\frac{M_y - N_x}{N} = ${toLatex(muDesc.expr)}`
          : `\\frac{N_x - M_y}{M} = ${toLatex(muDesc.expr)}`,
        `The equation is not exact, but this ratio depends only on ${muDesc.variable}, so an integrating factor ${muDesc.label} that restores exactness exists.`
      ));

      steps.push(step(
        'Compute the integrating factor',
        `${muDesc.label} = e^{\\int ${toLatex(muDesc.expr)}\\,d${muDesc.variable}} = ${toLatex(muFactorNode)}`,
        `Multiplying the whole equation by ${muDesc.label} will make it exact.`
      ));

      const MnodeNew = simplify(mul(muFactorNode, Mnode));
      const NnodeNew = simplify(mul(muFactorNode, Nnode));
      steps.push(step(
        'Multiply through by the integrating factor',
        `\\left(${toLatex(MnodeNew)}\\right)dx + \\left(${toLatex(NnodeNew)}\\right)dy = 0`,
        `The new M and N below are ${muDesc.label} times the originals.`
      ));

      Mnode = MnodeNew;
      Nnode = NnodeNew;
      My = simplify(diff(Mnode, 'y'));
      Nx = simplify(diff(Nnode, 'x'));
      isExact = JSON.stringify(My) === JSON.stringify(Nx) || approxNodesEqual(My, Nx);

      steps.push(step(
        'Confirm the new equation is exact',
        `\\frac{\\partial M}{\\partial y} = ${toLatex(My)} = \\frac{\\partial N}{\\partial x} = ${toLatex(Nx)}`,
        isExact
          ? 'The mixed partials now match, so the standard exact-equation method applies from here.'
          : 'The mixed partials should match here — if they do not, floating-point rounding in the integrating factor is the likely cause.'
      ));
    } else {
      steps.push(step(
        'Confirm exactness',
        `\\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x}`,
        'Since the mixed partials match, there exists a potential function F(x,y) with F_x = M and F_y = N.'
      ));
    }

    let Fpartial;
    try { Fpartial = integrate(Mnode, 'x'); }
    catch (e) { throw new NoClosedForm('Could not integrate M(x, y) with respect to x: ' + e.message); }

    steps.push(step(
      'Integrate M with respect to x',
      `F(x,y) = \\int M\\,dx = ${toLatex(Fpartial)} + h(y)`,
      'Integrate M with respect to x, treating y as a constant; the "constant" of integration may depend on y.'
    ));

    const dFdy = simplify(diff(Fpartial, 'y'));
    const hPrime = simplify(sub(Nnode, dFdy));
    steps.push(step(
      "Differentiate with respect to y and match with N",
      `\\frac{\\partial F}{\\partial y} = ${toLatex(dFdy)} + h'(y) = ${toLatex(Nnode)}`,
      "Differentiate F with respect to y, set it equal to N, and solve for h'(y)."
    ));

    let hOfY;
    try { hOfY = integrate(hPrime, 'y'); }
    catch (e) { throw new NoClosedForm("Could not integrate h'(y) = " + toPlainText(hPrime) + ' in closed form (' + e.message + ')'); }

    steps.push(step(
      'Integrate to find h(y)',
      `h'(y) = ${toLatex(hPrime)} \\;\\Rightarrow\\; h(y) = ${toLatex(hOfY)}`,
      'Integrate with respect to y to recover h(y) (dropping its own constant, absorbed into C below).'
    ));

    const Ffull = simplify(add(Fpartial, hOfY));
    let finalLatex = `${toLatex(Ffull)} = C`;
    let Cvalue = null;
    if (ic) {
      Cvalue = evaluate(Ffull, { x: ic.x0, y: ic.y0 });
      steps.push(step(
        'Apply the initial condition',
        `F(${ic.x0}, ${ic.y0}) = C \\;\\Rightarrow\\; C = ${round(Cvalue)}`,
        'Substitute the initial point into F(x,y) to find the specific constant C.'
      ));
      finalLatex = `${toLatex(Ffull)} = ${round(Cvalue)}`;
    }

    steps.push(step('Write the implicit solution', finalLatex, 'The solution is given implicitly by F(x,y) = C.'));

    return { steps, solutionLatex: finalLatex, kind: 'exact', implicit: true, C: Cvalue, FNode: Ffull };
  }

  function nodeDiffers(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
  }

  function approxNodesEqual(a, b) {
    // Numeric spot-check equality across a few sample points as a fallback
    // to catch algebraically-equal-but-differently-shaped ASTs.
    const pts = [{ x: 0.7, y: 1.3 }, { x: 1.9, y: -0.4 }, { x: -0.5, y: 2.2 }];
    try {
      return pts.every((p) => Math.abs(evaluate(a, p) - evaluate(b, p)) < 1e-6);
    } catch (e) { return false; }
  }

  // ---- Single-variable polynomial division with symbolic coefficients ----
  // Used to test "is (M_y - N_x)/N a function of x alone?" properly: rather
  // than simplifying the ratio directly (our simplifier doesn't cancel common
  // polynomial factors), treat both sides as polynomials in y with
  // x-dependent coefficients and do the division term by term. If N divides
  // (M_y - N_x) exactly and the quotient has y-degree 0, that quotient IS the
  // required function of x — this is the standard textbook test, made exact.

  // Extract {c, n}: node = c * v^n, with n a nonnegative integer and c free of v.
  function monomialIn(node, v) {
    node = simplify(node);
    if (!containsVar(node, v)) return { c: node, n: 0 };
    if (node.t === 'var' && node.n === v) return { c: num(1), n: 1 };
    if (node.t === 'pow' && node.a.t === 'var' && node.a.n === v && node.b.t === 'num' && Number.isInteger(node.b.v) && node.b.v >= 0) {
      return { c: num(1), n: node.b.v };
    }
    if (node.t === 'mul') {
      const aHas = containsVar(node.a, v), bHas = containsVar(node.b, v);
      if (!aHas) { const inner = monomialIn(node.b, v); if (inner) return { c: simplify(mul(node.a, inner.c)), n: inner.n }; }
      if (!bHas) { const inner = monomialIn(node.a, v); if (inner) return { c: simplify(mul(node.b, inner.c)), n: inner.n }; }
    }
    if (node.t === 'neg') { const inner = monomialIn(node.a, v); if (inner) return { c: simplify(neg(inner.c)), n: inner.n }; }
    return null;
  }

  // Returns an array `coeffs` with coeffs[i] = coefficient of v^i (0-indexed,
  // low to high degree, gaps filled with 0), or null if `node` isn't a sum of
  // v-monomials our limited matcher can recognize.
  function polyCoeffsIn(node, v) {
    const terms = M.flattenSum(simplify(node));
    const coeffs = [];
    for (const term of terms) {
      const m = monomialIn(term, v);
      if (!m) return null;
      coeffs[m.n] = coeffs[m.n] ? simplify(add(coeffs[m.n], m.c)) : m.c;
    }
    for (let i = 0; i < coeffs.length; i++) if (coeffs[i] === undefined) coeffs[i] = num(0);
    return coeffs.length ? coeffs : [num(0)];
  }

  // Divide polynomial `numCoeffs` by `denCoeffs` (both 0-indexed low-to-high
  // arrays of coefficient nodes). Returns {quotient, remainder} as coefficient
  // arrays, or null if the leading coefficient is (numerically) zero.
  function polyDivide(numCoeffs, denCoeffs) {
    const numDeg = numCoeffs.length - 1, denDeg = denCoeffs.length - 1;
    const remainder = numCoeffs.slice();
    while (remainder.length - 1 < numDeg) remainder.push(num(0));
    const quotient = new Array(Math.max(numDeg - denDeg + 1, 0)).fill(num(0));
    const leadDen = denCoeffs[denDeg];
    if (isSymbolicallyZero(leadDen)) return null;
    for (let d = numDeg; d >= denDeg; d--) {
      const factor = simplify(div(remainder[d], leadDen));
      quotient[d - denDeg] = factor;
      for (let k = 0; k <= denDeg; k++) {
        remainder[d - denDeg + k] = simplify(sub(remainder[d - denDeg + k], mul(factor, denCoeffs[k])));
      }
    }
    return { quotient, remainder: remainder.slice(0, denDeg) };
  }

  function isSymbolicallyZero(node) {
    node = simplify(node);
    if (node.t === 'num' && Math.abs(node.v) < 1e-9) return true;
    const pts = [0.7, 1.9, -0.5, 3.3];
    try {
      return pts.every((x) => Math.abs(evaluate(node, { x, y: x })) < 1e-6);
    } catch (e) { return false; }
  }

  // Test whether `numer` is exactly divisible by `denom` when both are
  // viewed as polynomials in `v`, with a quotient that does not depend on v
  // at all (i.e. quotient has v-degree 0). Returns the quotient node, or null.
  function divideToConstantIn(numer, denom, v) {
    const numCoeffs = polyCoeffsIn(numer, v);
    const denCoeffs = polyCoeffsIn(denom, v);
    if (!numCoeffs || !denCoeffs) return null;
    const result = polyDivide(numCoeffs, denCoeffs);
    if (!result) return null;
    if (result.quotient.length !== 1) return null; // quotient still depends on v
    const remainderIsZero = result.remainder.every(isSymbolicallyZero);
    if (!remainderIsZero) return null;
    return result.quotient[0];
  }

  // ---------------- 5. Second-order linear homogeneous, constant coefficients ----------------
  // a y'' + b y' + c y = 0
  // e^{rx} with the trivial cases (r=0 -> 1, r=1 -> e^x, r=-1 -> e^{-x}) cleaned up
  function expLabel(r) {
    if (Math.abs(r) < 1e-9) return '';
    const rr = round(r);
    return rr === 1 ? 'e^{x}' : rr === -1 ? 'e^{-x}' : `e^{${rr}x}`;
  }
  // clean "freq*x" argument for trig functions (freq=1 -> just "x")
  function trigArg(freq) {
    const f = round(freq);
    return f === 1 ? 'x' : `${f}x`;
  }
  // "C_1 * label" with the same 0/1/-1 coefficient special-casing used for
  // undetermined-coefficients terms, joined additively across a term list
  function combineTerms(termLabels) {
    const present = termLabels.filter((t) => t.latex !== null);
    if (!present.length) return '0';
    return present.map((t, i) => (i === 0 ? t.latex : (t.latex.startsWith('-') ? ' - ' + t.latex.slice(1) : ' + ' + t.latex))).join('');
  }
  function coeffTerm(coeffSym, label) {
    // General (symbolic C1/C2) form: always show "C_1 \cdot label" (or bare C_1 if label is trivial)
    return label ? `${coeffSym}${label === '' ? '' : '\\cdot ' + label}` : coeffSym;
  }
  function numericTerm(coeffVal, label) {
    const c = round(coeffVal);
    if (Math.abs(c) < 1e-9) return null;
    if (!label) return `${c}`;
    if (c === 1) return label;
    if (c === -1) return `-${label}`;
    return `${c}\\cdot ${label}`;
  }

  // Numeric JS-closure basis {basis1, basis2} for the homogeneous solution of
  // a y'' + b y' + c y = 0, covering all three discriminant cases. Shared by
  // the nonhomogeneous solver's IC-fitting and the Laplace/step-forcing solver.
  function basisFunctionsFor(a, b, c) {
    const disc = b * b - 4 * a * c;
    if (disc > 1e-9) {
      const r1 = (-b + Math.sqrt(disc)) / (2 * a), r2 = (-b - Math.sqrt(disc)) / (2 * a);
      return { basis1: (x) => Math.exp(r1 * x), basis2: (x) => Math.exp(r2 * x), disc, r1, r2 };
    } else if (Math.abs(disc) <= 1e-9) {
      const r = -b / (2 * a);
      return { basis1: (x) => Math.exp(r * x), basis2: (x) => x * Math.exp(r * x), disc, r };
    } else {
      const alpha = -b / (2 * a), beta = Math.sqrt(-disc) / (2 * a);
      return {
        basis1: (x) => Math.exp(alpha * x) * Math.cos(beta * x),
        basis2: (x) => Math.exp(alpha * x) * Math.sin(beta * x),
        disc, alpha, beta,
      };
    }
  }

  // Symbolic AST basis {y1, y2} for the same homogeneous equation, in variable
  // 'x'. Used by variation of parameters, which needs to differentiate and
  // integrate the basis functions symbolically rather than just evaluate them.
  function basisNodesFor(a, b, c) {
    const disc = b * b - 4 * a * c;
    if (disc > 1e-9) {
      const r1 = (-b + Math.sqrt(disc)) / (2 * a), r2 = (-b - Math.sqrt(disc)) / (2 * a);
      return { y1: fn('exp', mul(num(r1), vr('x'))), y2: fn('exp', mul(num(r2), vr('x'))) };
    } else if (Math.abs(disc) <= 1e-9) {
      const r = -b / (2 * a);
      return { y1: fn('exp', mul(num(r), vr('x'))), y2: mul(vr('x'), fn('exp', mul(num(r), vr('x')))) };
    } else {
      const alpha = -b / (2 * a), beta = Math.sqrt(-disc) / (2 * a);
      const env = fn('exp', mul(num(alpha), vr('x')));
      return { y1: mul(env, fn('cos', mul(num(beta), vr('x')))), y2: mul(env, fn('sin', mul(num(beta), vr('x')))) };
    }
  }

  // Variation of parameters: given a symbolic basis y1, y2 for the homogeneous
  // equation and gOverA = g(x)/(leading coefficient) already reduced to the
  // standard form y'' + p(x)y' + q(x)y = gOverA, computes a particular
  // solution yp = u1 y1 + u2 y2 via the standard formulas
  //   u1' = -y2 gOverA / W,   u2' = y1 gOverA / W,   W = y1 y2' - y2 y1'.
  // Throws NoClosedForm (from the underlying integrate calls) when u1' or u2'
  // isn't elementarily integrable — the same honest fallback used everywhere
  // else in this engine.
  function variationOfParameters(y1, y2, gOverA, x) {
    const Wron = simplify(sub(mul(y1, diff(y2, x)), mul(y2, diff(y1, x))));
    const u1p = simplify(neg(div(mul(y2, gOverA), Wron)));
    const u2p = simplify(div(mul(y1, gOverA), Wron));
    const u1 = integrate(u1p, x);
    const u2 = integrate(u2p, x);
    const yp = simplify(add(mul(u1, y1), mul(u2, y2)));
    return { Wron, u1p, u2p, u1, u2, yp };
  }

  function solveHomogeneous2ndOrder(a, b, c, ic) {
    const steps = [];
    steps.push(step(
      'Write the characteristic equation',
      `${a}r^2 + ${b}r + ${c} = 0`,
      'For a constant-coefficient linear ODE, try y = e^{rx}; substituting gives this characteristic (auxiliary) equation in r.'
    ));

    const disc = b * b - 4 * a * c;
    steps.push(step('Compute the discriminant', `\\Delta = b^2-4ac = ${round(disc)}`, ''));

    let solutionLatex, generalSolFn, r1, r2;
    let labelParts; // describes the two basis functions for this case, used for both general and particular display
    if (disc > 1e-9) {
      r1 = (-b + Math.sqrt(disc)) / (2 * a);
      r2 = (-b - Math.sqrt(disc)) / (2 * a);
      steps.push(step(
        'Two distinct real roots',
        `r_1 = ${round(r1)}, \\quad r_2 = ${round(r2)}`,
        'Since Δ > 0, the characteristic equation has two distinct real roots.'
      ));
      labelParts = [expLabel(r1), expLabel(r2)];
      solutionLatex = `y = ${combineTerms([{ latex: coeffTerm('C_1', labelParts[0]) }, { latex: coeffTerm('C_2', labelParts[1]) }])}`;
      steps.push(step('General solution', solutionLatex, 'Each root contributes an independent exponential solution.'));
      generalSolFn = (x, C1, C2) => C1 * Math.exp(r1 * x) + C2 * Math.exp(r2 * x);
    } else if (Math.abs(disc) <= 1e-9) {
      const r = -b / (2 * a);
      steps.push(step('Repeated real root', `r = ${round(r)}\\text{ (double root)}`, 'Since Δ = 0, there is one repeated real root.'));
      const rLabel = expLabel(r);
      solutionLatex = rLabel ? `y = (C_1 + C_2 x)${rLabel}` : `y = C_1 + C_2 x`;
      steps.push(step('General solution', solutionLatex, 'A repeated root r contributes solutions e^{rx} and x e^{rx}.'));
      generalSolFn = (x, C1, C2) => (C1 + C2 * x) * Math.exp(r * x);
    } else {
      const alpha = -b / (2 * a);
      const beta = Math.sqrt(-disc) / (2 * a);
      steps.push(step(
        'Complex conjugate roots',
        `r = ${round(alpha)} \\pm ${round(beta)}i`,
        'Since Δ < 0, the roots are complex conjugates α ± βi.'
      ));
      const envelope = expLabel(alpha);
      const trigPart = `C_1\\cos(${trigArg(beta)}) + C_2\\sin(${trigArg(beta)})`;
      solutionLatex = envelope ? `y = ${envelope}\\left(${trigPart}\\right)` : `y = ${trigPart}`;
      steps.push(step('General solution', solutionLatex, "Euler's formula converts the complex exponentials into sine and cosine, scaled by the real exponential envelope e^{αx}."));
      generalSolFn = (x, C1, C2) => Math.exp(alpha * x) * (C1 * Math.cos(beta * x) + C2 * Math.sin(beta * x));
    }

    let C1 = null, C2 = null;
    if (ic && ic.y0 !== undefined && ic.yp0 !== undefined) {
      const h = 1e-5;
      // Solve linear system using generalSolFn basis via finite differences on C1/C2 (numerically robust for all 3 cases)
      const y_C1 = generalSolFn(ic.x0, 1, 0), yp_C1 = (generalSolFn(ic.x0 + h, 1, 0) - generalSolFn(ic.x0 - h, 1, 0)) / (2 * h);
      const y_C2 = generalSolFn(ic.x0, 0, 1), yp_C2 = (generalSolFn(ic.x0 + h, 0, 1) - generalSolFn(ic.x0 - h, 0, 1)) / (2 * h);
      // [y_C1 y_C2; yp_C1 yp_C2] [C1;C2] = [y0; yp0]
      const detM = y_C1 * yp_C2 - y_C2 * yp_C1;
      C1 = (ic.y0 * yp_C2 - y_C2 * ic.yp0) / detM;
      C2 = (y_C1 * ic.yp0 - ic.y0 * yp_C1) / detM;
      steps.push(step(
        'Apply initial conditions',
        `y(${ic.x0})=${ic.y0},\\ y'(${ic.x0})=${ic.yp0} \\;\\Rightarrow\\; C_1 = ${round(C1)},\\ C_2 = ${round(C2)}`,
        'Substitute the initial conditions (and their derivative) into the general solution and solve the resulting 2×2 linear system for C1 and C2.'
      ));
      if (Math.abs(disc) <= 1e-9) {
        // repeated-root case: (C1 + C2 x) e^{rx} doesn't split into two independent additive terms the same way
        const r = -b / (2 * a);
        const rLabel = expLabel(r);
        const polyPart = combineTerms([{ latex: numericTerm(C1, '') }, { latex: numericTerm(C2, 'x') }]);
        solutionLatex = rLabel ? `y = \\left(${polyPart}\\right)${rLabel}` : `y = ${polyPart}`;
      } else if (disc > 1e-9) {
        solutionLatex = `y = ${combineTerms([{ latex: numericTerm(C1, labelParts[0]) }, { latex: numericTerm(C2, labelParts[1]) }])}`;
      } else {
        const alpha = -b / (2 * a), beta = Math.sqrt(-disc) / (2 * a);
        const envelope = expLabel(alpha);
        const trigPart = combineTerms([
          { latex: numericTerm(C1, `\\cos(${trigArg(beta)})`) },
          { latex: numericTerm(C2, `\\sin(${trigArg(beta)})`) },
        ]);
        solutionLatex = envelope ? `y = ${envelope}\\left(${trigPart}\\right)` : `y = ${trigPart}`;
      }
      steps.push(step('Particular solution', solutionLatex, ''));
    }

    return {
      steps, solutionLatex, kind: 'homogeneous2', C1, C2,
      roots: disc > 1e-9 ? [r1, r2] : undefined,
      disc, a, b, c,
      yFn: (C1 !== null && C2 !== null) ? ((x) => generalSolFn(x, C1, C2)) : null,
    };
  }

  // Given C1/C2 numeric values, build a clean yh string for this a,b,c using the
  // same discriminant case and helpers as solveHomogeneous2ndOrder's own
  // particular-solution branch. Used by solveNonhomogeneous2ndOrder to avoid
  // regex-substituting into the symbolic solutionLatex string.
  function homogeneousParticularLatex(a, b, c, C1, C2) {
    const disc = b * b - 4 * a * c;
    if (Math.abs(disc) <= 1e-9) {
      const r = -b / (2 * a);
      const rLabel = expLabel(r);
      const polyPart = combineTerms([{ latex: numericTerm(C1, '') }, { latex: numericTerm(C2, 'x') }]);
      return rLabel ? `\\left(${polyPart}\\right)${rLabel}` : `${polyPart}`;
    } else if (disc > 1e-9) {
      const r1 = (-b + Math.sqrt(disc)) / (2 * a), r2 = (-b - Math.sqrt(disc)) / (2 * a);
      return combineTerms([{ latex: numericTerm(C1, expLabel(r1)) }, { latex: numericTerm(C2, expLabel(r2)) }]);
    } else {
      const alpha = -b / (2 * a), beta = Math.sqrt(-disc) / (2 * a);
      const envelope = expLabel(alpha);
      const trigPart = combineTerms([
        { latex: numericTerm(C1, `\\cos(${trigArg(beta)})`) },
        { latex: numericTerm(C2, `\\sin(${trigArg(beta)})`) },
      ]);
      return envelope ? `${envelope}\\left(${trigPart}\\right)` : `${trigPart}`;
    }
  }

  // ---------------- 6. Second-order linear nonhomogeneous, constant coefficients ----------------
  // a y'' + b y' + c y = g(x), g(x) restricted to forms handled by undetermined coefficients:
  //   polynomial, exponential, sin/cos, and products thereof (i.e. anything our
  //   tabular integrator also understands, since the same term-classification applies)
  // Runs the classify -> propose trial -> check duplication -> solve
  // coefficients pipeline for ONE forcing term. Shared by the single-term
  // case and by each term of a superposition sum.
  function solveOneForcingTerm(termNode, a, b, c, label) {
    const guess = classifyForUndeterminedCoefficients(termNode);
    if (!guess) {
      // Undetermined coefficients only covers polynomial/exponential/sine-cosine
      // forcing. For anything else (1/x, tan(x), ln(x), non-integer powers, ...)
      // fall back to variation of parameters, which works for any g(x) that
      // integrates in closed form against the homogeneous basis.
      return solveByVariationOfParameters(termNode, a, b, c, label);
    }

    const localSteps = [];
    localSteps.push(step(
      (label ? `Propose a trial form for ${label}` : 'Propose a trial form for the particular solution'),
      guess.trialLatexRaw,
      guess.explanation
    ));

    const s = duplicationOrder(guess, a, b, c);
    if (s > 0) {
      const trialLatex = 'y_p = ' + (s === 1 ? 'x\\cdot\\left(' : `x^{${s}}\\cdot\\left(`) + guess.trialLatexRaw.replace('y_p = ', '') + '\\right)';
      localSteps.push(step(
        'Adjust for duplication with the homogeneous solution',
        trialLatex,
        `The proposed trial form (or part of it) already appears in y_h, so multiply by x^{${s}} to find an independent particular solution.`
      ));
    }

    const solved = solveUndeterminedCoefficients(guess, s, a, b, c, termNode);
    localSteps.push(step(
      'Solve for the undetermined coefficients',
      solved.coeffEquationLatex,
      'Substitute the trial y_p into the ODE, collect like terms, and match coefficients with g(x) to solve for the unknown constants.'
    ));
    localSteps.push(step(label ? `Particular solution for ${label}` : 'Particular solution', `y_p = ${solved.ypLatex}`, ''));

    return { steps: localSteps, ypLatex: solved.ypLatex, ypFn: solved.ypFn };
  }

  // Fallback for forcing terms that undetermined coefficients can't classify
  // (non-integer or negative powers of x, 1/x, tan(x), ln(x), and so on):
  // variation of parameters, using the homogeneous basis y1, y2 built
  // symbolically. Throws NoClosedForm (bubbling up from integrate) when the
  // resulting integrals aren't elementary, at which point the caller's
  // existing fallback to numeric RK4 kicks in exactly as for any other
  // unintegrable case in this engine.
  function solveByVariationOfParameters(termNode, a, b, c, label) {
    const { y1, y2 } = basisNodesFor(a, b, c);
    const gOverA = simplify(div(termNode, num(a)));

    const localSteps = [];
    localSteps.push(step(
      label ? `Use variation of parameters for ${label}` : 'Use variation of parameters',
      `y_p = u_1(x)\\,y_1 + u_2(x)\\,y_2`,
      `${toPlainText(termNode)} is not a polynomial/exponential/sine-cosine product, so undetermined coefficients does not apply directly. ` +
      `Variation of parameters works for any g(x): with y_1, y_2 a basis for the homogeneous solution, seek y_p = u_1 y_1 + u_2 y_2.`
    ));

    let vop;
    try {
      vop = variationOfParameters(y1, y2, gOverA, 'x');
    } catch (e) {
      throw new NoClosedForm(
        `Variation of parameters requires integrating ${toPlainText(gOverA)} against the homogeneous basis, ` +
        `which has no elementary closed form (${e.message})`
      );
    }

    localSteps.push(step(
      'Compute the Wronskian and u_1\', u_2\'',
      `W = ${toLatex(vop.Wron)}, \\qquad u_1' = ${toLatex(vop.u1p)}, \\qquad u_2' = ${toLatex(vop.u2p)}`,
      "The Wronskian W = y_1 y_2' - y_2 y_1' is nonzero since y_1, y_2 are independent; u_1' = -y_2 g/(aW) and u_2' = y_1 g/(aW) follow from matching the variation-of-parameters ansatz against the ODE."
    ));
    localSteps.push(step(
      'Integrate to find u_1 and u_2',
      `u_1 = ${toLatex(vop.u1)}, \\qquad u_2 = ${toLatex(vop.u2)}`,
      'Integrate each derivative (dropping the constants of integration, which would only add multiples of the homogeneous solution).'
    ));

    const ypLatex = toLatex(vop.yp);
    localSteps.push(step(label ? `Particular solution for ${label}` : 'Particular solution', `y_p = ${ypLatex}`, 'Substitute u_1 and u_2 back into y_p = u_1 y_1 + u_2 y_2.'));

    const ypFn = (x) => evaluate(vop.yp, { x });
    return { steps: localSteps, ypLatex, ypFn };
  }

  // Shared by solveNonhomogeneous2ndOrder and solveBVP: solves for a particular
  // solution y_p of a y'' + b y' + c y = g(x), handling single-term forcing
  // directly and multi-term forcing via superposition. Returns
  // {steps, ypLatex, ypFn}.
  function computeParticularSolution(gNode, a, b, c) {
    const forcingTerms = M.flattenSum(simplify(gNode));
    const steps = [];
    let ypLatex, ypFn;
    if (forcingTerms.length === 1) {
      const result = solveOneForcingTerm(gNode, a, b, c, null);
      steps.push(...result.steps);
      ypLatex = result.ypLatex;
      ypFn = result.ypFn;
    } else {
      steps.push(step(
        'Split g(x) by superposition',
        `g(x) = ${forcingTerms.map((t) => toLatex(t)).join(' + ')}`,
        'g(x) is a sum of terms with different forms, so solve for a particular solution for each term on its own, then add the results (the superposition principle for linear ODEs).'
      ));
      const partials = forcingTerms.map((term, i) => solveOneForcingTerm(term, a, b, c, `g_{${i + 1}}(x) = ${toLatex(term)}`));
      partials.forEach((p) => steps.push(...p.steps));
      ypLatex = partials.map((p) => p.ypLatex).join(' + ');
      const fns = partials.map((p) => p.ypFn);
      ypFn = (x) => fns.reduce((sum, f) => sum + f(x), 0);
      steps.push(step('Combine by superposition', `y_p = ${ypLatex}`, 'Add the particular solutions found for each term of g(x).'));
    }
    return { steps, ypLatex, ypFn };
  }

  function solveNonhomogeneous2ndOrder(a, b, c, gNode, ic) {
    const homog = solveHomogeneous2ndOrder(a, b, c, null);
    const steps = [step(
      'Solve the associated homogeneous equation',
      `${a}y'' + ${b}y' + ${c}y = 0 \\;\\Rightarrow\\; y_h = ${homog.solutionLatex.replace('y = ', '')}`,
      'The general solution will be y = y_h + y_p, where y_h solves the homogeneous equation and y_p is any particular solution.'
    )];

    const solved = computeParticularSolution(gNode, a, b, c);
    steps.push(...solved.steps);

    let solutionLatex = `y = \\underbrace{${homog.solutionLatex.replace('y = ', '')}}_{y_h} + \\underbrace{${solved.ypLatex}}_{y_p}`;
    steps.push(step('General solution', solutionLatex, 'Add the homogeneous and particular solutions.'));

    let C1 = null, C2 = null, yFn = null;
    if (ic && ic.y0 !== undefined && ic.yp0 !== undefined) {
      const ypFn = solved.ypFn;
      const h = 1e-5;
      const ypAtX0 = ypFn(ic.x0), ypPrimeAtX0 = (ypFn(ic.x0 + h) - ypFn(ic.x0 - h)) / (2 * h);
      const { basis1, basis2 } = basisFunctionsFor(a, b, c);
      const y_C1 = basis1(ic.x0), yp_C1 = (basis1(ic.x0 + h) - basis1(ic.x0 - h)) / (2 * h);
      const y_C2 = basis2(ic.x0), yp_C2 = (basis2(ic.x0 + h) - basis2(ic.x0 - h)) / (2 * h);
      const rhsY = ic.y0 - ypAtX0, rhsYp = ic.yp0 - ypPrimeAtX0;
      const detM = y_C1 * yp_C2 - y_C2 * yp_C1;
      C1 = (rhsY * yp_C2 - y_C2 * rhsYp) / detM;
      C2 = (y_C1 * rhsYp - rhsY * yp_C1) / detM;
      steps.push(step(
        'Apply initial conditions',
        `y(${ic.x0})=${ic.y0},\\ y'(${ic.x0})=${ic.yp0} \\;\\Rightarrow\\; C_1=${round(C1)},\\ C_2=${round(C2)}`,
        'Substitute into y = y_h + y_p (and its derivative) at the initial point, then solve for C1, C2.'
      ));
      const yhLatexParticular = homogeneousParticularLatex(a, b, c, C1, C2);
      solutionLatex = yhLatexParticular === '0'
        ? `y = ${solved.ypLatex}`
        : `y = ${yhLatexParticular} + ${solved.ypLatex}`;
      steps.push(step('Particular (IC-satisfying) solution', solutionLatex, ''));
      yFn = (x) => C1 * basis1(x) + C2 * basis2(x) + ypFn(x);
    }

    return { steps, solutionLatex, kind: 'nonhomogeneous2', C1, C2, ypFn: solved.ypFn, yFn };
  }

  // ---------------- 6b. Boundary value problem: a y'' + b y' + c y = g(x), y(x1)=y1, y(x2)=y2 ----------------
  // Unlike an initial-value problem, both conditions are values of y itself
  // (not y and y'), so C1, C2 are fit from a 2x2 linear system built from the
  // homogeneous basis evaluated at the two boundary points directly — no
  // derivatives needed. When that system is singular, the boundary points
  // coincide with an eigenvalue of the associated Sturm-Liouville problem
  // (e.g. y''+y=0 with y(0)=y(L)=0 has no unique solution when L = nπ).
  function solveBVP(a, b, c, gNode, bc) {
    if (a === 0) throw new Error('a must be nonzero for a second-order equation.');
    if (Math.abs(bc.x1 - bc.x2) < 1e-9) throw new Error('The two boundary points must be different.');

    const homog = solveHomogeneous2ndOrder(a, b, c, null);
    const steps = [step(
      'Solve the associated homogeneous equation',
      `${a}y'' + ${b}y' + ${c}y = 0 \\;\\Rightarrow\\; y_h = ${homog.solutionLatex.replace('y = ', '')}`,
      'As with an initial-value problem, y = y_h + y_p — but here the two constants will be fit using values of y at two different points instead of y and y\' at one point.'
    )];

    const particular = computeParticularSolution(gNode, a, b, c);
    steps.push(...particular.steps);

    const generalLatex = `y = \\underbrace{${homog.solutionLatex.replace('y = ', '')}}_{y_h} + \\underbrace{${particular.ypLatex}}_{y_p}`;
    steps.push(step('General solution', generalLatex, 'Add the homogeneous and particular solutions.'));

    const { basis1, basis2 } = basisFunctionsFor(a, b, c);
    const y1x1 = basis1(bc.x1), y2x1 = basis2(bc.x1);
    const y1x2 = basis1(bc.x2), y2x2 = basis2(bc.x2);
    const yp1 = particular.ypFn(bc.x1), yp2 = particular.ypFn(bc.x2);
    const rhs1 = bc.y1 - yp1, rhs2 = bc.y2 - yp2;
    const detM = y1x1 * y2x2 - y2x1 * y1x2;

    if (Math.abs(detM) < 1e-7) {
      const err = new Error(
        `This boundary value problem is singular: with these coefficients, the two boundary points x=${bc.x1} and x=${bc.x2} coincide with an ` +
        `eigenvalue of the associated homogeneous (Sturm–Liouville) problem, so there is no unique solution — either none exists (if g and the ` +
        `boundary values are inconsistent) or infinitely many do. Try different boundary points, or check whether the boundary data happens to ` +
        `match a homogeneous solution exactly.`
      );
      err.isBVPSingular = true;
      throw err;
    }

    const C1 = (rhs1 * y2x2 - y2x1 * rhs2) / detM;
    const C2 = (y1x1 * rhs2 - rhs1 * y1x2) / detM;
    steps.push(step(
      'Apply the boundary conditions',
      `y(${bc.x1})=${bc.y1},\\ y(${bc.x2})=${bc.y2} \\;\\Rightarrow\\; C_1=${round(C1)},\\ C_2=${round(C2)}`,
      'Substitute both boundary points into y = y_h + y_p — here both conditions are values of y itself, so no derivative is needed — giving a 2×2 linear system for C1, C2.'
    ));

    const yhParticular = homogeneousParticularLatex(a, b, c, C1, C2);
    const solutionLatex = yhParticular === '0' ? `y = ${particular.ypLatex}` : `y = ${yhParticular} + ${particular.ypLatex}`;
    steps.push(step('Boundary-value solution', solutionLatex, ''));

    const yFn = (x) => C1 * basis1(x) + C2 * basis2(x) + particular.ypFn(x);

    return { steps, solutionLatex, kind: 'bvp', C1, C2, yFn };
  }

  // ---------------- 7. Cauchy-Euler: a x^2 y'' + b x y' + c y = g(x) ----------------
  // A variable-coefficient equation, solved by trying y = x^r: substituting
  // gives a r(r-1) + b r + c = 0, i.e. A r^2 + B r + C = 0 with A=a, B=b-a, C=c
  // — the same three-case structure as the constant-coefficient equation, but
  // with basis functions |x|^r (and ln|x| for the repeated-root/complex cases)
  // in place of e^{rx}. Nonhomogeneous forcing is handled by variation of
  // parameters directly in x (no need for the classic t=ln|x| substitution,
  // since the |x|^r basis is already explicit).
  function cauchyEulerRootInfo(a, b, c) {
    const A = a, B = b - a, C = c;
    return { A, B, C, disc: B * B - 4 * A * C };
  }

  function cauchyEulerBasisFns(a, b, c) {
    const { A, B, disc } = cauchyEulerRootInfo(a, b, c);
    if (disc > 1e-9) {
      const r1 = (-B + Math.sqrt(disc)) / (2 * A), r2 = (-B - Math.sqrt(disc)) / (2 * A);
      return { basis1: (x) => Math.pow(Math.abs(x), r1), basis2: (x) => Math.pow(Math.abs(x), r2), disc, r1, r2 };
    } else if (Math.abs(disc) <= 1e-9) {
      const r = -B / (2 * A);
      return { basis1: (x) => Math.pow(Math.abs(x), r), basis2: (x) => Math.pow(Math.abs(x), r) * Math.log(Math.abs(x)), disc, r };
    } else {
      const alpha = -B / (2 * A), beta = Math.sqrt(-disc) / (2 * A);
      return {
        basis1: (x) => Math.pow(Math.abs(x), alpha) * Math.cos(beta * Math.log(Math.abs(x))),
        basis2: (x) => Math.pow(Math.abs(x), alpha) * Math.sin(beta * Math.log(Math.abs(x))),
        disc, alpha, beta,
      };
    }
  }

  function cauchyEulerBasisNodes(a, b, c) {
    const { A, B, disc } = cauchyEulerRootInfo(a, b, c);
    const absX = fn('abs', vr('x'));
    if (disc > 1e-9) {
      const r1 = (-B + Math.sqrt(disc)) / (2 * A), r2 = (-B - Math.sqrt(disc)) / (2 * A);
      return { y1: powN(absX, num(r1)), y2: powN(absX, num(r2)) };
    } else if (Math.abs(disc) <= 1e-9) {
      const r = -B / (2 * A);
      return { y1: powN(absX, num(r)), y2: mul(powN(absX, num(r)), fn('ln', absX)) };
    } else {
      const alpha = -B / (2 * A), beta = Math.sqrt(-disc) / (2 * A);
      const env = powN(absX, num(alpha));
      const lnAbsX = fn('ln', absX);
      return { y1: mul(env, fn('cos', mul(num(beta), lnAbsX))), y2: mul(env, fn('sin', mul(num(beta), lnAbsX))) };
    }
  }

  function absXLabel(r) {
    if (Math.abs(r) < 1e-9) return '';
    const rr = round(r);
    return rr === 1 ? '|x|' : `|x|^{${rr}}`;
  }
  // clean "freq * ln|x|" argument for trig functions (freq=1 -> just "ln|x|")
  function lnAbsArg(freq) {
    const f = round(freq);
    return f === 1 ? '\\ln\\left|x\\right|' : `${f}\\ln\\left|x\\right|`;
  }

  function solveCauchyEuler(a, b, c, gNode, ic) {
    if (a === 0) throw new Error('a must be nonzero for a Cauchy-Euler equation (otherwise it is not second order).');
    if (ic && Math.abs(ic.x0) < 1e-9) {
      throw new Error('Cauchy-Euler equations are singular at x = 0 — choose an initial point x₀ ≠ 0.');
    }

    const steps = [];
    steps.push(step(
      'Try y = x^r',
      `${a}x^2y'' + ${b}xy' + ${c}y = 0 \\;\\Rightarrow\\; ${a}r(r-1) + ${b}r + ${c} = 0`,
      'A Cauchy-Euler (equidimensional) equation has variable coefficients that are powers of x matching the order of each derivative, so the trial y = x^r turns the equation into a plain polynomial in r.'
    ));

    const { A, B, C, disc } = cauchyEulerRootInfo(a, b, c);
    steps.push(step(
      'Simplify to a quadratic in r',
      `${A}r^2 ${B >= 0 ? '+' : '-'} ${Math.abs(round(B))}r + ${C} = 0, \\qquad \\Delta = ${round(disc)}`,
      'Expanding r(r-1) and collecting terms gives A r^2 + B r + C = 0 with A=a, B=b-a, C=c.'
    ));

    let homogLatex, r1, r2, r, alpha, beta;
    if (disc > 1e-9) {
      r1 = (-B + Math.sqrt(disc)) / (2 * A); r2 = (-B - Math.sqrt(disc)) / (2 * A);
      steps.push(step('Two distinct real roots', `r_1 = ${round(r1)}, \\quad r_2 = ${round(r2)}`, 'Since Δ > 0, the indicial equation has two distinct real roots.'));
      homogLatex = combineTerms([{ latex: coeffTerm('C_1', absXLabel(r1)) }, { latex: coeffTerm('C_2', absXLabel(r2)) }]);
      steps.push(step('Homogeneous solution', `y_h = ${homogLatex}`, 'Each root r contributes an independent solution |x|^r.'));
    } else if (Math.abs(disc) <= 1e-9) {
      r = -B / (2 * A);
      steps.push(step('Repeated real root', `r = ${round(r)}\\text{ (double root)}`, 'Since Δ = 0, there is one repeated root.'));
      const rLabel = absXLabel(r);
      homogLatex = rLabel ? `\\left(C_1 + C_2\\ln\\left|x\\right|\\right)${rLabel}` : `C_1 + C_2\\ln\\left|x\\right|`;
      steps.push(step('Homogeneous solution', `y_h = ${homogLatex}`, 'A repeated root r contributes |x|^r and |x|^r ln|x| (the Cauchy-Euler analogue of x e^{rx} for constant-coefficient equations).'));
    } else {
      alpha = -B / (2 * A); beta = Math.sqrt(-disc) / (2 * A);
      steps.push(step('Complex conjugate roots', `r = ${round(alpha)} \\pm ${round(beta)}i`, 'Since Δ < 0, the roots are complex conjugates.'));
      const envelope = absXLabel(alpha);
      const trigPart = `C_1\\cos(${lnAbsArg(beta)}) + C_2\\sin(${lnAbsArg(beta)})`;
      homogLatex = envelope ? `${envelope}\\left(${trigPart}\\right)` : trigPart;
      steps.push(step('Homogeneous solution', `y_h = ${homogLatex}`, 'Writing x^{\\alpha+i\\beta} = |x|^\\alpha e^{i\\beta\\ln|x|} and applying Euler\'s formula gives real solutions |x|^\\alpha\\cos(\\beta\\ln|x|) and |x|^\\alpha\\sin(\\beta\\ln|x|).'));
    }

    const gSimplified = simplify(gNode || num(0));
    const isHomogeneous = isNum0(gSimplified);

    let ypLatex = null, ypFn = null;
    if (!isHomogeneous) {
      const { y1, y2 } = cauchyEulerBasisNodes(a, b, c);
      const gOverA = simplify(div(gSimplified, mul(num(a), powN(vr('x'), num(2)))));
      steps.push(step(
        'Set up variation of parameters',
        `y_p = u_1(x)y_1 + u_2(x)y_2, \\qquad y'' + \\frac{${b}}{${a}x}y' + \\frac{${c}}{${a}x^2}y = ${toLatex(gOverA)}`,
        'Divide through by a x^2 to get the standard form y\'\' + p(x)y\' + q(x)y = g(x)/(ax^2), then apply variation of parameters with the two homogeneous solutions y_1, y_2 found above.'
      ));
      let vop;
      try {
        vop = variationOfParameters(y1, y2, gOverA, 'x');
      } catch (e) {
        throw new NoClosedForm(
          `Variation of parameters requires integrating against the homogeneous basis, which has no elementary closed form (${e.message})`
        );
      }
      steps.push(step(
        'Compute the Wronskian and u_1\', u_2\'',
        `W = ${toLatex(vop.Wron)}, \\qquad u_1' = ${toLatex(vop.u1p)}, \\qquad u_2' = ${toLatex(vop.u2p)}`,
        "W = y_1y_2' - y_2y_1'; then u_1' = -y_2 g/(ax^2 W) and u_2' = y_1 g/(ax^2 W)."
      ));
      steps.push(step('Integrate to find u_1 and u_2', `u_1 = ${toLatex(vop.u1)}, \\qquad u_2 = ${toLatex(vop.u2)}`, 'Integrate each derivative (dropping constants of integration, which would just add multiples of the homogeneous solution).'));
      ypLatex = toLatex(vop.yp);
      ypFn = (x) => evaluate(vop.yp, { x });
      steps.push(step('Particular solution', `y_p = ${ypLatex}`, ''));
    }

    let solutionLatex = isHomogeneous ? `y = ${homogLatex}` : `y = \\underbrace{${homogLatex}}_{y_h} + \\underbrace{${ypLatex}}_{y_p}`;
    if (!isHomogeneous) steps.push(step('General solution', solutionLatex, 'Add the homogeneous and particular solutions.'));

    let C1 = null, C2 = null, yFn = null;
    if (ic && ic.y0 !== undefined && ic.yp0 !== undefined) {
      const { basis1, basis2 } = cauchyEulerBasisFns(a, b, c);
      const h = Math.max(1e-5, Math.abs(ic.x0) * 1e-5);
      const ypAtX0 = ypFn ? ypFn(ic.x0) : 0;
      const ypPrimeAtX0 = ypFn ? (ypFn(ic.x0 + h) - ypFn(ic.x0 - h)) / (2 * h) : 0;
      const y_C1 = basis1(ic.x0), yp_C1 = (basis1(ic.x0 + h) - basis1(ic.x0 - h)) / (2 * h);
      const y_C2 = basis2(ic.x0), yp_C2 = (basis2(ic.x0 + h) - basis2(ic.x0 - h)) / (2 * h);
      const rhsY = ic.y0 - ypAtX0, rhsYp = ic.yp0 - ypPrimeAtX0;
      const detM = y_C1 * yp_C2 - y_C2 * yp_C1;
      C1 = (rhsY * yp_C2 - y_C2 * rhsYp) / detM;
      C2 = (y_C1 * rhsYp - rhsY * yp_C1) / detM;
      steps.push(step(
        'Apply initial conditions',
        `y(${ic.x0})=${ic.y0},\\ y'(${ic.x0})=${ic.yp0} \\;\\Rightarrow\\; C_1=${round(C1)},\\ C_2=${round(C2)}`,
        'Substitute the initial conditions (and derivative) at x0 into y and y\', then solve the resulting 2x2 linear system for C1, C2.'
      ));
      let yhParticular;
      if (disc > 1e-9) {
        yhParticular = combineTerms([{ latex: numericTerm(C1, absXLabel(r1)) }, { latex: numericTerm(C2, absXLabel(r2)) }]);
      } else if (Math.abs(disc) <= 1e-9) {
        const rLabel = absXLabel(r);
        const polyPart = combineTerms([{ latex: numericTerm(C1, '') }, { latex: numericTerm(C2, '\\ln\\left|x\\right|') }]);
        yhParticular = rLabel ? `\\left(${polyPart}\\right)${rLabel}` : polyPart;
      } else {
        const envelope = absXLabel(alpha);
        const trigPart = combineTerms([
          { latex: numericTerm(C1, `\\cos(${lnAbsArg(beta)})`) },
          { latex: numericTerm(C2, `\\sin(${lnAbsArg(beta)})`) },
        ]);
        yhParticular = envelope ? `${envelope}\\left(${trigPart}\\right)` : trigPart;
      }
      solutionLatex = isHomogeneous || ypLatex === null
        ? `y = ${yhParticular}`
        : (yhParticular === '0' ? `y = ${ypLatex}` : `y = ${yhParticular} + ${ypLatex}`);
      steps.push(step('Particular (IC-satisfying) solution', solutionLatex, ''));
      yFn = (x) => C1 * basis1(x) + C2 * basis2(x) + (ypFn ? ypFn(x) : 0);
    }

    return { steps, solutionLatex, kind: 'cauchyEuler', C1, C2, yFn };
  }

  function isNum0(node) {
    return node.t === 'num' && Math.abs(node.v) < 1e-12;
  }

  // Classify g(x) as C * x^m * e^{ax} * {sin|cos}(bx) (the standard UC family)
  function classifyForUndeterminedCoefficients(gNode) {
    gNode = simplify(gNode);
    const terms = M.flattenSum(gNode);
    if (terms.length > 1) {
      // Only support single-term forcing for now (still covers a very wide class);
      // multi-term forcing could be handled by superposition but keep scope bounded.
      // Try treating whole thing as one polynomial if all terms are pure powers of x (common case).
      const deg = polyOnlyDegree(gNode);
      if (deg !== null) {
        return {
          polyDeg: deg, a: 0, b: null, kind: null, node: gNode,
          trialLatexRaw: `y_p = A_{${deg}}x^{${deg}} + \\cdots + A_1 x + A_0`,
          explanation: `Since g(x) is a degree-${deg} polynomial, try a general degree-${deg} polynomial for y_p.`,
        };
      }
      return null;
    }
    const term = terms[0];
    const expT = tryFullClassify(term);
    return expT;
  }

  function polyOnlyDegree(node) {
    const d = polyDegreeSafe(node);
    return d;
  }
  function polyDegreeSafe(node) {
    try {
      const terms = M.flattenSum(simplify(node));
      let maxDeg = 0;
      for (const t of terms) {
        const m = matchMonomial(t);
        if (m === null) return null;
        maxDeg = Math.max(maxDeg, m);
      }
      return maxDeg;
    } catch (e) { return null; }
  }
  function matchMonomial(node) {
    node = simplify(node);
    if (!containsVar(node, 'x')) return 0;
    if (node.t === 'var' && node.n === 'x') return 1;
    if (node.t === 'pow' && node.a.t === 'var' && node.a.n === 'x' && node.b.t === 'num' && Number.isInteger(node.b.v) && node.b.v >= 0) return node.b.v;
    if (node.t === 'mul') {
      const l = containsVar(node.a, 'x') ? matchMonomial(node.a) : 0;
      const r = containsVar(node.b, 'x') ? matchMonomial(node.b) : 0;
      if (containsVar(node.a, 'x') && containsVar(node.b, 'x')) return null;
      return l + r;
    }
    if (node.t === 'neg') return matchMonomial(node.a);
    return null;
  }

  function tryFullClassify(term) {
    // Extract polynomial factor degree, exponential rate a, trig rate/kind
    let polyPart = num(1), a = 0, trigKind = null, b = 0;
    let node = simplify(term);

    function scan(n) {
      if (n.t === 'mul') { scan(n.a); scan(n.b); return; }
      if (n.t === 'neg') { polyPart = simplify(mul(polyPart, num(-1))); scan(n.a); return; }
      if (n.t === 'fn' && n.n === 'exp') {
        const lin = linearCoeff(n.a);
        if (lin !== null) { a += lin; return; }
      }
      if (n.t === 'fn' && (n.n === 'sin' || n.n === 'cos')) {
        const lin = linearCoeff(n.a);
        if (lin !== null) { trigKind = n.n; b = lin; return; }
      }
      polyPart = simplify(mul(polyPart, n));
    }
    scan(node);
    const deg = polyDegreeSafe(polyPart);
    if (deg === null) return null; // not a recognized product form

    const parts = [];
    if (deg > 0) parts.push(`(A_{${deg}}x^{${deg}}+\\cdots+A_0)`);
    else parts.push('A');
    if (a !== 0) parts.push(`e^{${round(a)}x}`);
    if (trigKind) parts.push(`\\left(B\\cos(${round(b)}x)+C\\sin(${round(b)}x)\\right)`);

    let explanation = 'Match the form of g(x): ';
    const bits = [];
    if (deg > 0) bits.push(`a degree-${deg} polynomial`);
    if (a !== 0) bits.push(`an exponential e^{${round(a)}x}`);
    if (trigKind) bits.push(`a sinusoid of frequency ${round(b)}`);
    explanation += bits.join(' times ') + ', so propose a trial y_p that is their product with unknown coefficients.';

    return {
      polyDeg: deg, a, b, kind: trigKind, node,
      trialLatexRaw: 'y_p = ' + parts.join('\\,'),
      explanation,
    };
  }

  function linearCoeff(node) {
    // returns k such that node === k*x, or null
    node = simplify(node);
    if (node.t === 'var' && node.n === 'x') return 1;
    if (node.t === 'mul') {
      if (!containsVar(node.a, 'x') && node.b.t === 'var' && node.b.n === 'x') return evaluate(node.a, {});
      if (!containsVar(node.b, 'x') && node.a.t === 'var' && node.a.n === 'x') return evaluate(node.b, {});
    }
    if (node.t === 'neg') { const inner = linearCoeff(node.a); return inner === null ? null : -inner; }
    return null;
  }

  function duplicationOrder(guess, a, b, c) {
    const disc = b * b - 4 * a * c;
    const targetIsExpOnly = (r) => Math.abs(guess.a - r) < 1e-9 && !guess.kind;
    if (disc > 1e-9) {
      const r1 = (-b + Math.sqrt(disc)) / (2 * a), r2 = (-b - Math.sqrt(disc)) / (2 * a);
      if (targetIsExpOnly(r1) || targetIsExpOnly(r2)) return 1;
      return 0;
    } else if (Math.abs(disc) <= 1e-9) {
      const r = -b / (2 * a);
      if (targetIsExpOnly(r)) return 2; // repeated root duplication needs x^2
      return 0;
    } else {
      const alpha = -b / (2 * a), beta = Math.sqrt(-disc) / (2 * a);
      if (guess.kind && Math.abs(guess.a - alpha) < 1e-9 && Math.abs(guess.b - beta) < 1e-9) return 1;
      return 0;
    }
  }

  // Numerically solve for undetermined coefficients by least-squares fit of the
  // trial function's derivatives-closed basis against sample points of g(x).
  // This sidesteps needing a fully symbolic linear-system solver while still
  // producing an exact answer for these finite-dimensional bases (using enough
  // points = dimension, exact linear solve).
  // Builds a clean LaTeX label for x^p * e^{rate x} * {cos|sin}(freq x),
  // omitting each factor that would be trivial (x^0, e^{0x}, x^1 shown as x,
  // e^{1x} shown as e^x, and so on) instead of printing it literally.
  function monomialLabel(p, rate, trigKind, freq) {
    const parts = [];
    if (p === 1) parts.push('x');
    else if (p !== 0) parts.push(`x^{${p}}`);
    if (Math.abs(rate) > 1e-9) {
      const r = round(rate);
      parts.push(r === 1 ? 'e^{x}' : r === -1 ? 'e^{-x}' : `e^{${r}x}`);
    }
    if (trigKind) {
      const fLabel = Math.abs(freq - 1) < 1e-9 ? 'x' : round(freq) + 'x';
      parts.push(`\\${trigKind}(${fLabel})`);
    }
    return parts.join('\\cdot ');
  }

  function solveUndeterminedCoefficients(guess, s, a, b, c, gNode) {
    const deg = guess.polyDeg || 0;
    const hasExp = !!guess.a;
    const hasTrig = !!guess.kind;

    // Build basis functions f_i(x) for y_p = sum coeff_i * f_i(x) * x^s
    const basisDescr = []; // {label, fn}
    for (let p = 0; p <= deg; p++) {
      if (hasTrig) {
        basisDescr.push({ label: monomialLabel(p + s, guess.a, 'cos', guess.b), fn: (x) => Math.pow(x, p) * Math.exp(guess.a * x) * Math.cos(guess.b * x) });
        basisDescr.push({ label: monomialLabel(p + s, guess.a, 'sin', guess.b), fn: (x) => Math.pow(x, p) * Math.exp(guess.a * x) * Math.sin(guess.b * x) });
      } else {
        basisDescr.push({ label: monomialLabel(p + s, guess.a, null, 0), fn: (x) => Math.pow(x, p) * Math.exp(guess.a * x) });
      }
    }
    const withXs = (f) => (x) => Math.pow(x, s) * f(x);
    const basisFns = basisDescr.map((bd) => withXs(bd.fn));

    // Differential operator L[y] = a y'' + b y' + c y, applied numerically via
    // central differences to each basis function, then fit coefficients so that
    // sum coeff_i * L[f_i](x) = g(x) at sample points (exact linear solve).
    function Lf(f, x) {
      const h = 1e-4;
      const y0 = f(x), yp = f(x + h), ym = f(x - h);
      const d2 = (yp - 2 * y0 + ym) / (h * h);
      const d1 = (yp - ym) / (2 * h);
      return a * d2 + b * d1 + c * y0;
    }

    const N = basisFns.length;
    const samplePts = [];
    for (let i = 0; i < N; i++) samplePts.push(0.37 + i * 0.91); // arbitrary well-spread points avoiding symmetry issues

    // Build matrix A (N x N) where A[i][j] = L[f_j](samplePts[i]), rhs[i] = g(samplePts[i])
    const Amat = samplePts.map((x) => basisFns.map((f) => Lf(f, x)));
    const rhsVec = samplePts.map((x) => evaluate(gNode, { x }));
    const coeffs = solveLinearSystem(Amat, rhsVec);

    const ypFn = (x) => coeffs.reduce((acc, ci, i) => acc + ci * basisFns[i](x), 0);

    const ypLatexTerms = [];
    coeffs.forEach((ciRaw, i) => {
      const ci = round(ciRaw);
      if (Math.abs(ci) < 1e-9) return; // drop zero-coefficient terms entirely
      const label = basisDescr[i].label; // '' means this basis function is just the constant 1
      let termLatex;
      if (!label) termLatex = `${ci}`;
      else if (ci === 1) termLatex = label;
      else if (ci === -1) termLatex = `-${label}`;
      else termLatex = `${ci}\\cdot ${label}`;
      ypLatexTerms.push({ latex: termLatex, negative: termLatex.startsWith('-') });
    });
    let ypLatex = ypLatexTerms.length
      ? ypLatexTerms.map((t, i) => (i === 0 ? t.latex : (t.negative ? ' - ' + t.latex.slice(1) : ' + ' + t.latex))).join('')
      : '0';

    const coeffEquationLatex = `\\text{Matching coefficients gives: } ` + coeffs.map((ci, i) => `A_${i}=${round(ci)}`).join(',\\ ');

    return { ypFn, ypLatex, coeffEquationLatex };
  }

  // Simple Gaussian elimination with partial pivoting
  function solveLinearSystem(A, b) {
    const n = b.length;
    const M2 = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M2[r][col]) > Math.abs(M2[pivot][col])) pivot = r;
      [M2[col], M2[pivot]] = [M2[pivot], M2[col]];
      const pv = M2[col][col];
      if (Math.abs(pv) < 1e-12) continue; // singular direction, coefficient stays 0
      for (let j = col; j <= n; j++) M2[col][j] /= pv;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M2[r][col];
        for (let j = col; j <= n; j++) M2[r][j] -= factor * M2[col][j];
      }
    }
    return M2.map((row) => row[n]);
  }

  // ---------------- 8. Linear system of two ODEs: X' = AX, A = [[a11,a12],[a21,a22]] ----------------
  // Solved via the eigenvalue/eigenvector method — the 2x2 analogue of the
  // characteristic-equation approach used for the single 2nd-order equation.
  // Independent variable is named t (the usual convention for a system/phase
  // portrait); dependent variables are x(t), y(t).
  function classifySystem(trace, det, disc) {
    if (Math.abs(det) < 1e-9) return 'Degenerate: at least one eigenvalue is zero (a line, or the whole plane, of equilibria).';
    if (det < 0) return 'Saddle point (unstable) — eigenvalues have opposite signs.';
    if (disc > 1e-9) return trace < 0 ? 'Stable node — both eigenvalues real and negative.' : 'Unstable node — both eigenvalues real and positive.';
    if (Math.abs(disc) <= 1e-9) return trace < 0 ? 'Stable degenerate node (repeated negative eigenvalue).' : 'Unstable degenerate node (repeated positive eigenvalue).';
    if (Math.abs(trace) < 1e-9) return 'Center — purely imaginary eigenvalues, trajectories are closed ellipses.';
    return trace < 0 ? 'Stable spiral — complex eigenvalues with negative real part.' : 'Unstable spiral — complex eigenvalues with positive real part.';
  }

  function solveLinearSystem2x2(a11, a12, a21, a22, ic) {
    const steps = [];
    steps.push(step(
      'Write the system in matrix form',
      `\\begin{pmatrix}x'\\\\y'\\end{pmatrix} = \\begin{pmatrix}${a11} & ${a12}\\\\${a21} & ${a22}\\end{pmatrix}\\begin{pmatrix}x\\\\y\\end{pmatrix}`,
      "For X' = AX, try a solution of the form X = v e^{\\lambda t}; substituting gives (A - \\lambda I)v = 0, so \\lambda must be an eigenvalue of A with v an eigenvector."
    ));

    const trace = a11 + a22, det = a11 * a22 - a12 * a21;
    const disc = trace * trace - 4 * det;
    steps.push(step(
      'Find the eigenvalues',
      `\\lambda^2 - (${round(trace)})\\lambda + (${round(det)}) = 0, \\qquad \\Delta = ${round(disc)}`,
      'The characteristic equation of a 2x2 matrix is \\lambda^2 - (\\text{tr }A)\\lambda + \\det A = 0.'
    ));

    function eigenvectorFor(lambda) {
      if (Math.abs(a12) > 1e-9) return [a12, lambda - a11];
      if (Math.abs(a21) > 1e-9) return [lambda - a22, a21];
      // diagonal matrix (a12=a21=0): eigenvector is (1,0) if this eigenvalue
      // matches a11, otherwise (0,1) matching a22 — needed so the two
      // eigenvalues (generally a11 and a22 themselves) get independent
      // eigenvectors rather than both defaulting to the same one.
      return Math.abs(lambda - a11) <= Math.abs(lambda - a22) ? [1, 0] : [0, 1];
    }

    let xFn, yFn, classification, solutionLatex, lambda1, lambda2;
    if (disc > 1e-9) {
      lambda1 = (trace + Math.sqrt(disc)) / 2; lambda2 = (trace - Math.sqrt(disc)) / 2;
      const v1 = eigenvectorFor(lambda1), v2 = eigenvectorFor(lambda2);
      steps.push(step(
        'Two distinct real eigenvalues',
        `\\lambda_1 = ${round(lambda1)},\\ v_1=\\begin{pmatrix}${round(v1[0])}\\\\${round(v1[1])}\\end{pmatrix}; \\qquad \\lambda_2 = ${round(lambda2)},\\ v_2=\\begin{pmatrix}${round(v2[0])}\\\\${round(v2[1])}\\end{pmatrix}`,
        'Each eigenvalue contributes an independent solution v e^{\\lambda t}.'
      ));
      solutionLatex = `\\begin{pmatrix}x\\\\y\\end{pmatrix} = C_1\\begin{pmatrix}${round(v1[0])}\\\\${round(v1[1])}\\end{pmatrix}e^{${round(lambda1)}t} + C_2\\begin{pmatrix}${round(v2[0])}\\\\${round(v2[1])}\\end{pmatrix}e^{${round(lambda2)}t}`;
      xFn = (t, c1, c2) => c1 * v1[0] * Math.exp(lambda1 * t) + c2 * v2[0] * Math.exp(lambda2 * t);
      yFn = (t, c1, c2) => c1 * v1[1] * Math.exp(lambda1 * t) + c2 * v2[1] * Math.exp(lambda2 * t);
    } else if (Math.abs(disc) <= 1e-9) {
      const lambda = trace / 2;
      const isDiagonal = Math.abs(a12) < 1e-9 && Math.abs(a21) < 1e-9;
      steps.push(step('Repeated eigenvalue', `\\lambda = ${round(lambda)}\\text{ (double)}`, 'Since Δ = 0, there is a single repeated eigenvalue.'));
      if (isDiagonal) {
        solutionLatex = `\\begin{pmatrix}x\\\\y\\end{pmatrix} = e^{${round(lambda)}t}\\begin{pmatrix}C_1\\\\C_2\\end{pmatrix}`;
        steps.push(step('Every vector is an eigenvector', solutionLatex, 'A is already a multiple of the identity, so any two independent vectors work as a basis.'));
        xFn = (t, c1, c2) => c1 * Math.exp(lambda * t);
        yFn = (t, c1, c2) => c2 * Math.exp(lambda * t);
      } else {
        const v = eigenvectorFor(lambda);
        // Generalized eigenvector w solving (A-λI)w = v, picking the free
        // component to be 0 (always solvable this way since v itself came
        // from whichever row of A-λI is nonzero).
        let w;
        if (Math.abs(a12) > 1e-9) w = [0, v[0] / a12];
        else w = [v[1] / a21, 0];
        steps.push(step(
          'Find the eigenvector and a generalized eigenvector',
          `v=\\begin{pmatrix}${round(v[0])}\\\\${round(v[1])}\\end{pmatrix}, \\qquad w=\\begin{pmatrix}${round(w[0])}\\\\${round(w[1])}\\end{pmatrix}\\text{ solving } (A-\\lambda I)w=v`,
          'A repeated, defective eigenvalue needs a generalized eigenvector w to build a second independent solution.'
        ));
        solutionLatex = `\\begin{pmatrix}x\\\\y\\end{pmatrix} = C_1\\begin{pmatrix}${round(v[0])}\\\\${round(v[1])}\\end{pmatrix}e^{${round(lambda)}t} + C_2\\left(\\begin{pmatrix}${round(v[0])}\\\\${round(v[1])}\\end{pmatrix}t + \\begin{pmatrix}${round(w[0])}\\\\${round(w[1])}\\end{pmatrix}\\right)e^{${round(lambda)}t}`;
        xFn = (t, c1, c2) => (c1 * v[0] + c2 * (v[0] * t + w[0])) * Math.exp(lambda * t);
        yFn = (t, c1, c2) => (c1 * v[1] + c2 * (v[1] * t + w[1])) * Math.exp(lambda * t);
      }
    } else {
      const alpha = trace / 2, beta = Math.sqrt(-disc) / 2;
      let p, q;
      if (Math.abs(a12) > 1e-9) { p = [a12, alpha - a11]; q = [0, beta]; }
      else { p = [alpha - a22, a21]; q = [beta, 0]; }
      steps.push(step(
        'Complex conjugate eigenvalues',
        `\\lambda = ${round(alpha)} \\pm ${round(beta)}i, \\qquad v = \\begin{pmatrix}${round(p[0])}\\\\${round(p[1])}\\end{pmatrix} \\pm i\\begin{pmatrix}${round(q[0])}\\\\${round(q[1])}\\end{pmatrix}`,
        'Since Δ < 0, the eigenvalues are complex conjugates α ± βi with a complex eigenvector p ± iq.'
      ));
      solutionLatex = `\\begin{pmatrix}x\\\\y\\end{pmatrix} = e^{${round(alpha)}t}\\left[C_1\\left(\\begin{pmatrix}${round(p[0])}\\\\${round(p[1])}\\end{pmatrix}\\cos(${round(beta)}t) - \\begin{pmatrix}${round(q[0])}\\\\${round(q[1])}\\end{pmatrix}\\sin(${round(beta)}t)\\right) + C_2\\left(\\begin{pmatrix}${round(p[0])}\\\\${round(p[1])}\\end{pmatrix}\\sin(${round(beta)}t) + \\begin{pmatrix}${round(q[0])}\\\\${round(q[1])}\\end{pmatrix}\\cos(${round(beta)}t)\\right)\\right]`;
      steps.push(step("General solution via Euler's formula", solutionLatex, "Splitting v e^{(\\alpha+i\\beta)t} into real and imaginary parts gives two real, independent solutions."));
      xFn = (t, c1, c2) => Math.exp(alpha * t) * (c1 * (p[0] * Math.cos(beta * t) - q[0] * Math.sin(beta * t)) + c2 * (p[0] * Math.sin(beta * t) + q[0] * Math.cos(beta * t)));
      yFn = (t, c1, c2) => Math.exp(alpha * t) * (c1 * (p[1] * Math.cos(beta * t) - q[1] * Math.sin(beta * t)) + c2 * (p[1] * Math.sin(beta * t) + q[1] * Math.cos(beta * t)));
    }

    classification = classifySystem(trace, det, disc);
    steps.push(step('Classify the equilibrium at the origin', classification, `trace = ${round(trace)}, \\det = ${round(det)}, \\Delta = ${round(disc)}.`));

    let C1 = null, C2 = null, xOfT = null, yOfT = null;
    if (ic && ic.x0 !== undefined && ic.y0 !== undefined) {
      const t0 = ic.t0 || 0;
      const x_C1 = xFn(t0, 1, 0), x_C2 = xFn(t0, 0, 1);
      const y_C1 = yFn(t0, 1, 0), y_C2 = yFn(t0, 0, 1);
      const detM = x_C1 * y_C2 - x_C2 * y_C1;
      C1 = (ic.x0 * y_C2 - x_C2 * ic.y0) / detM;
      C2 = (x_C1 * ic.y0 - ic.x0 * y_C1) / detM;
      steps.push(step(
        'Apply the initial condition',
        `x(${t0})=${ic.x0},\\ y(${t0})=${ic.y0} \\;\\Rightarrow\\; C_1=${round(C1)},\\ C_2=${round(C2)}`,
        'Substitute the initial point into the general solution and solve the resulting 2x2 linear system for C1, C2.'
      ));
      xOfT = (t) => xFn(t, C1, C2);
      yOfT = (t) => yFn(t, C1, C2);
      const finalLatex = solutionLatex.replace(/C_1/g, round(C1)).replace(/C_2/g, round(C2));
      steps.push(step('Particular (IC-satisfying) solution', finalLatex, ''));
      solutionLatex = finalLatex;
    }

    return {
      steps, solutionLatex, kind: 'system2x2', classification, C1, C2,
      xFn: xOfT, yFn: yOfT,
      vectorField: (x, y) => [a11 * x + a12 * y, a21 * x + a22 * y],
    };
  }

  // ---------------- 9. Laplace transforms: a y'' + b y' + c y = g(x), y(0), y'(0) ----------------
  // Laplace's real advantage over the classical methods above is handling
  // forcing that switches on partway through — a term step(x-t1)*h(x), where
  // step is the Heaviside unit step. For everything else, the Laplace-domain
  // answer is mathematically identical to y_h + y_p from undetermined
  // coefficients/variation of parameters, so rather than re-deriving that
  // algebra symbolically in s, this solves the equivalent "zero initial rest
  // state" response q(x) for each term (q(0)=q'(0)=0, via solveOneForcingTerm
  // plus a homogeneous correction), and applies the second shifting theorem —
  // L^{-1}{e^{-t1 s}H(s)} = u(x-t1) q(x-t1) — to place each response at its
  // own start time.
  function fdiff(f, x, h) { return (f(x + h) - f(x - h)) / (2 * h); }

  // Detects arg = x - t1 (or x + k, i.e. t1 = -k), returning t1, or null.
  function extractStepArg(node) {
    const s = simplify(node);
    if (s.t === 'var' && s.n === 'x') return 0;
    if (s.t === 'sub' && s.a.t === 'var' && s.a.n === 'x' && s.b.t === 'num') return s.b.v;
    if (s.t === 'add' && s.a.t === 'var' && s.a.n === 'x' && s.b.t === 'num') return -s.b.v;
    if (s.t === 'add' && s.b.t === 'var' && s.b.n === 'x' && s.a.t === 'num') return -s.a.v;
    return null;
  }

  // Detects a term of the shape step(x-t1)*h(x) (either multiplication
  // order, or a bare step(x-t1) meaning h(x)=1). Returns {t1, hNode} or null
  // if this term isn't step-gated at all (caller then treats t1=0).
  function extractStepTerm(termNode) {
    const t = simplify(termNode);
    function tryMatch(stepSide, otherSide) {
      if (stepSide.t === 'fn' && stepSide.n === 'step') {
        const t1 = extractStepArg(stepSide.a);
        if (t1 !== null) return { t1, hNode: otherSide };
      }
      return null;
    }
    if (t.t === 'mul') return tryMatch(t.a, t.b) || tryMatch(t.b, t.a);
    if (t.t === 'fn' && t.n === 'step') {
      const t1 = extractStepArg(t.a);
      if (t1 !== null) return { t1, hNode: num(1) };
    }
    if (t.t === 'neg') {
      const inner = extractStepTerm(t.a);
      if (inner) return { t1: inner.t1, hNode: neg(inner.hNode) };
    }
    return null;
  }

  function solveLaplaceIVP(a, b, c, gNode, y0, yp0) {
    if (a === 0) throw new Error('a must be nonzero.');
    const steps = [];
    steps.push(step(
      'Take the Laplace transform of both sides',
      `${a}\\left[s^2Y(s) - sy(0) - y'(0)\\right] + ${b}\\left[sY(s) - y(0)\\right] + ${c}Y(s) = G(s)`,
      "The Laplace transform turns derivatives into algebra: \\mathcal{L}\\{y''\\}=s^2Y(s)-sy(0)-y'(0) and \\mathcal{L}\\{y'\\}=sY(s)-y(0), turning the ODE into an algebraic equation for Y(s)."
    ));

    const gsLatex = buildGsLatex(gNode);
    if (gsLatex !== null) {
      steps.push(step(
        'Write G(s) using the Laplace transform table',
        `G(s) = \\mathcal{L}\\{g(x)\\}(s) = ${gsLatex}`,
        'Each term of g(x) is a standard Laplace pair (a polynomial, exponential, or sinusoid, possibly delayed by a unit step, in which case the second shifting theorem contributes the e^{-t_1 s} factor).'
      ));
      steps.push(step(
        'Solve for Y(s)',
        `Y(s) = \\frac{\\left(${gsLatex}\\right) + ${a}sy(0) + ${a}y'(0) + ${b}y(0)}{${a}s^2 + ${b}s + ${c}}`,
        'Collect the Y(s) terms and divide through by the characteristic polynomial in s.'
      ));
    } else {
      steps.push(step(
        'Solve for Y(s)',
        `Y(s) = \\frac{G(s) + ${a}sy(0) + ${a}y'(0) + ${b}y(0)}{${a}s^2 + ${b}s + ${c}}`,
        'Collect the Y(s) terms and divide through by the characteristic polynomial in s.'
      ));
    }

    const { basis1, basis2 } = basisFunctionsFor(a, b, c);
    const h = 1e-5;
    const gTerms = M.flattenSum(simplify(gNode));
    const pieces = [];

    gTerms.forEach((term, i) => {
      const extracted = extractStepTerm(term) || { t1: 0, hNode: term };
      const label = gTerms.length > 1 ? `h_{${i + 1}}(x)` : null;
      const result = solveOneForcingTerm(extracted.hNode, a, b, c, label);
      steps.push(...result.steps);

      // Adjust the raw particular solution so it has zero value and zero
      // derivative at x=0 — the "zero initial rest state" response, which is
      // exactly what the second shifting theorem needs to place at x=t1.
      const ypFn = result.ypFn;
      const targetVal = -ypFn(0), targetDeriv = -fdiff(ypFn, 0, h);
      const b1_0 = basis1(0), b2_0 = basis2(0);
      const b1p_0 = fdiff(basis1, 0, h), b2p_0 = fdiff(basis2, 0, h);
      const detM = b1_0 * b2p_0 - b2_0 * b1p_0;
      const d1 = (targetVal * b2p_0 - b2_0 * targetDeriv) / detM;
      const d2 = (b1_0 * targetDeriv - targetVal * b1p_0) / detM;
      const qFn = (x) => ypFn(x) + d1 * basis1(x) + d2 * basis2(x);

      if (Math.abs(extracted.t1) > 1e-9) {
        steps.push(step(
          `Apply the second shifting theorem (term ${i + 1})`,
          `\\mathcal{L}^{-1}\\{e^{-${round(extracted.t1)}s}H_{${i + 1}}(s)\\} = u(x-${round(extracted.t1)})\\,q_{${i + 1}}(x-${round(extracted.t1)})`,
          `This forcing term switches on at x = ${round(extracted.t1)}. Its response is the zero-initial-rest-state response q_{${i + 1}} to h_{${i + 1}} alone, delayed by ${round(extracted.t1)} and gated by the unit step so it is silent before then.`
        ));
      }
      pieces.push({ t1: extracted.t1, qFn, index: i + 1 });
    });

    // The homogeneous part alone carries the original IC at x=0, since every
    // piece above vanishes (value and derivative) at its own start time —
    // in particular at x=0, whether that is its start time or still before it.
    const y_C1 = basis1(0), yp_C1 = fdiff(basis1, 0, h);
    const y_C2 = basis2(0), yp_C2 = fdiff(basis2, 0, h);
    const detHomog = y_C1 * yp_C2 - y_C2 * yp_C1;
    const C1 = (y0 * yp_C2 - y_C2 * yp0) / detHomog;
    const C2 = (y_C1 * yp0 - y0 * yp_C1) / detHomog;
    steps.push(step(
      'Apply the initial condition',
      `y(0)=${y0},\\ y'(0)=${yp0} \\;\\Rightarrow\\; C_1=${round(C1)},\\ C_2=${round(C2)}`,
      'Every piece of the particular response is built to vanish (value and derivative) at its own start time, so the homogeneous part alone needs to match y(0) and y\'(0).'
    ));

    const homogLatex = homogeneousParticularLatex(a, b, c, C1, C2);
    const pieceLatexParts = pieces
      .filter((p) => true)
      .map((p) => (Math.abs(p.t1) > 1e-9
        ? `\\mathcal{H}(x-${round(p.t1)})\\,q_{${p.index}}(x-${round(p.t1)})`
        : `q_{${p.index}}(x)`));
    const solutionLatex = homogLatex === '0'
      ? `y = ${pieceLatexParts.join(' + ')}`
      : `y = ${homogLatex} + ${pieceLatexParts.join(' + ')}`;
    if (gsLatex !== null) {
      steps.push(step(
        'Invert Y(s) termwise',
        `\\mathcal{L}^{-1}\\{Y(s)\\}`,
        'Each piece of Y(s) above is (after partial fractions, where needed) a sum of the same standard transform pairs used to build G(s), read right to left — this is exactly the zero-initial-rest-state computation carried out term by term below.'
      ));
    }
    steps.push(step('Assemble the solution', solutionLatex, 'Add the homogeneous (IC-matching) part to each piece\'s delayed, gated response.'));

    const yFn = (x) => {
      let val = C1 * basis1(x) + C2 * basis2(x);
      for (const p of pieces) if (x >= p.t1 - 1e-9) val += p.qFn(x - p.t1);
      return val;
    };

    return { steps, solutionLatex, kind: 'laplace', C1, C2, yFn };
  }

  // ---------------- 10. Power series solutions about an ordinary point ----------------
  // y'' + p(x)y' + q(x)y = 0, with p(x), q(x) polynomials in x (so x=0 is an
  // ordinary point and the series converges everywhere). Writing y = sum a_n
  // x^n and matching coefficients of x^n gives the recurrence
  //   (n+2)(n+1)a_{n+2} = -sum_{k=0}^n [ p_k(n-k+1)a_{n-k+1} + q_k a_{n-k} ]
  // starting from a_0 = y(0), a_1 = y'(0).

  // Extract {coeff, deg} for a single monomial c * x^n (deg a nonnegative
  // integer), or null if `node` isn't of that shape.
  function extractMonomialXPower(node) {
    node = simplify(node);
    if (node.t === 'neg') { const inner = extractMonomialXPower(node.a); return inner ? { coeff: -inner.coeff, deg: inner.deg } : null; }
    if (node.t === 'num') return { coeff: node.v, deg: 0 };
    if (node.t === 'var' && node.n === 'x') return { coeff: 1, deg: 1 };
    if (node.t === 'pow' && node.a.t === 'var' && node.a.n === 'x' && node.b.t === 'num' && Number.isInteger(node.b.v) && node.b.v >= 0) {
      return { coeff: 1, deg: node.b.v };
    }
    if (node.t === 'mul') {
      const l = extractMonomialXPower(node.a);
      if (!l) return null;
      const r = extractMonomialXPower(node.b);
      if (!r) return null;
      return { coeff: l.coeff * r.coeff, deg: l.deg + r.deg };
    }
    return null;
  }

  // Numeric coefficient array (index = power of x) for a polynomial-in-x node,
  // up to `maxDeg`. Throws with a user-facing message if the node isn't a
  // polynomial in x, or its degree exceeds maxDeg.
  function polyCoeffsAst(node, maxDeg, label) {
    const coeffs = new Array(maxDeg + 1).fill(0);
    const terms = M.flattenSum(simplify(node));
    for (const term of terms) {
      const m = extractMonomialXPower(term);
      if (!m) throw new Error(`${label} must be a polynomial in x (the power series method here does not support ${toPlainText(term)}).`);
      if (m.deg > maxDeg) throw new Error(`${label} has degree too high for the requested number of series terms — use fewer terms or a lower-degree ${label}.`);
      coeffs[m.deg] += m.coeff;
    }
    return coeffs;
  }

  function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }

  function solveSeriesODE(pNode, qNode, y0, yp0, numTerms) {
    numTerms = Math.max(4, Math.min(14, Math.round(numTerms || 8)));
    const maxDeg = numTerms + 2;
    const pc = polyCoeffsAst(pNode, maxDeg, 'p(x)');
    const qc = polyCoeffsAst(qNode, maxDeg, 'q(x)');

    const steps = [];
    steps.push(step(
      'Assume a power series solution about x=0',
      `y = \\sum_{n=0}^{\\infty} a_n x^n, \\qquad y' = \\sum_{n=1}^{\\infty} n a_n x^{n-1}, \\qquad y'' = \\sum_{n=2}^{\\infty} n(n-1)a_n x^{n-2}`,
      `p(x) = ${toLatex(simplify(pNode))} and q(x) = ${toLatex(simplify(qNode))} are polynomials, hence analytic everywhere, so x=0 is an ordinary point and this series converges for all x.`
    ));

    steps.push(step(
      'Substitute and match coefficients of x^n',
      `(n+2)(n+1)a_{n+2} = -\\sum_{k=0}^{n}\\Big[p_k(n-k+1)a_{n-k+1} + q_k a_{n-k}\\Big]`,
      "Substituting the series into y'' + p(x)y' + q(x)y = 0 and collecting the coefficient of x^n on the left (which must vanish) gives this recurrence, where p_k, q_k are the coefficients of x^k in p(x), q(x)."
    ));

    const a = new Array(numTerms).fill(0);
    a[0] = y0; if (numTerms > 1) a[1] = yp0;
    for (let n = 0; n <= numTerms - 3; n++) {
      let sumP = 0, sumQ = 0;
      for (let k = 0; k <= n; k++) {
        const pk = pc[k] || 0, qk = qc[k] || 0;
        sumP += pk * (n - k + 1) * (a[n - k + 1] || 0);
        sumQ += qk * (a[n - k] || 0);
      }
      a[n + 2] = -(sumP + sumQ) / ((n + 2) * (n + 1));
    }

    steps.push(step(
      'Coefficients from the initial conditions',
      `a_0 = y(0) = ${round(y0)}, \\qquad a_1 = y'(0) = ${round(yp0)}`,
      'These come directly from the initial conditions, since y(0)=a_0 and y\'(0)=a_1.'
    ));

    const coeffList = a.slice(2).map((v, i) => `a_{${i + 2}} = ${round(v)}`).join(',\\ ');
    if (coeffList) {
      steps.push(step('Compute the remaining coefficients from the recurrence', coeffList, `Each a_{n+2} follows from the previously computed a_0,\\dots,a_{n+1} via the recurrence above.`));
    }

    const termsLatex = [];
    a.forEach((v, n) => {
      const c = round(v);
      if (Math.abs(c) < 1e-9) return;
      let t;
      if (n === 0) t = `${c}`;
      else if (n === 1) t = c === 1 ? 'x' : (c === -1 ? '-x' : `${c}x`);
      else t = c === 1 ? `x^{${n}}` : (c === -1 ? `-x^{${n}}` : `${c}x^{${n}}`);
      termsLatex.push(t);
    });
    const seriesBody = termsLatex.length
      ? termsLatex.map((t, i) => (i === 0 ? t : (t.startsWith('-') ? ' - ' + t.slice(1) : ' + ' + t))).join('')
      : '0';
    const solutionLatex = `y \\approx ${seriesBody} + \\cdots`;
    steps.push(step(`Truncated series solution (${numTerms} terms)`, solutionLatex, 'Each additional term further improves the local approximation to the exact solution.'));

    const yFn = (x) => { let s = 0, p = 1; for (let n = 0; n < numTerms; n++) { s += a[n] * p; p *= x; } return s; };

    return { steps, solutionLatex, kind: 'series', yFn, coeffs: a, numTerms };
  }

  // ---------------- Laplace transform table (for the "fuller" Laplace mode) ----------------
  // Recognizes single monomial-times-exponential-times-sinusoid terms
  // c * x^n * e^{ax} * {sin|cos}(bx) (the same family undetermined
  // coefficients handles) and returns the LaTeX of its Laplace transform,
  // using the standard table. Throws (caller catches) for anything else, or
  // for a combined nonzero polynomial degree with a trig factor (no simple
  // closed form in that case without a fuller symbolic apparatus).
  function laplaceTermTransform(node) {
    node = simplify(node);
    let coeff = 1, n = 0, a = 0, trigKind = null, b = 0;
    (function scan(nd) {
      if (nd.t === 'mul') { scan(nd.a); scan(nd.b); return; }
      if (nd.t === 'neg') { coeff *= -1; scan(nd.a); return; }
      if (nd.t === 'num') { coeff *= nd.v; return; }
      if (nd.t === 'var' && nd.n === 'x') { n += 1; return; }
      if (nd.t === 'pow' && nd.a.t === 'var' && nd.a.n === 'x' && nd.b.t === 'num' && Number.isInteger(nd.b.v) && nd.b.v >= 0) { n += nd.b.v; return; }
      if (nd.t === 'fn' && nd.n === 'exp') { const lin = linearCoeff(nd.a); if (lin !== null) { a += lin; return; } }
      if (nd.t === 'fn' && (nd.n === 'sin' || nd.n === 'cos')) { const lin = linearCoeff(nd.a); if (lin !== null) { trigKind = nd.n; b = lin; return; } }
      throw new Error('term not in the standard Laplace table');
    })(node);

    if (trigKind && n > 0) throw new Error('polynomial times sinusoid needs partial fractions beyond this table');

    let F;
    if (trigKind) {
      const base = a === 0 ? `s^2+${round(b * b)}` : `(s-${round(a)})^2+${round(b * b)}`;
      const numer = trigKind === 'sin' ? `${round(b)}` : (a === 0 ? 's' : `(s-${round(a)})`);
      F = `\\frac{${numer}}{${base}}`;
    } else {
      const base = a === 0 ? 's' : `(s-${round(a)})`;
      F = n === 0 ? `\\frac{1}{${base}}` : `\\frac{${factorial(n)}}{${base}^{${n + 1}}}`;
    }
    const c = round(coeff);
    if (Math.abs(c - 1) < 1e-9) return F;
    if (Math.abs(c + 1) < 1e-9) return `-${F}`;
    return `${c}\\cdot ${F}`;
  }

  // Builds the LaTeX for G(s) = L{g(x)}(s), handling step-gated terms via the
  // (s-domain) second shifting theorem L{u(x-t1)h(x)} = e^{-t1 s}L{h(x+t1)}(s).
  // Returns null if any term isn't in the standard table (caller then omits
  // the G(s) breakdown and falls back to the existing symbolic-only steps).
  function buildGsLatex(gNode) {
    try {
      const terms = M.flattenSum(simplify(gNode));
      const parts = [];
      for (const term of terms) {
        const extracted = extractStepTerm(term) || { t1: 0, hNode: term };
        const shifted = Math.abs(extracted.t1) > 1e-9 ? simplify(substVar(extracted.hNode, 'x', add(vr('x'), num(extracted.t1)))) : extracted.hNode;
        const transformed = laplaceTermTransform(shifted);
        parts.push(Math.abs(extracted.t1) > 1e-9 ? `e^{-${round(extracted.t1)}s}\\left(${transformed}\\right)` : transformed);
      }
      return parts.map((p, i) => (i === 0 ? p : (p.startsWith('-') ? ' - ' + p.slice(1) : ' + ' + p))).join('');
    } catch (e) {
      return null;
    }
  }

  return {
    solveSeparable, solveLinearFirstOrder, solveBernoulli, solveExact,
    solveHomogeneous2ndOrder, solveNonhomogeneous2ndOrder, solveCauchyEuler,
    solveLinearSystem2x2, solveLaplaceIVP, solveBVP, solveSeriesODE,
  };
});
