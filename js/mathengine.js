// ---------------------------------------------------------------------------
// Tiny symbolic math engine: tokenizer, parser, differentiator,
// expand/simplify, a limited symbolic integrator, LaTeX renderer, and a
// numeric evaluator. Designed for single-variable expressions built from
// +, -, *, /, ^, unary -, parentheses, and the functions:
// sin, cos, tan, exp, ln, sqrt, and named constants e, pi.
//
// AST node shapes:
//   {t:'num', v:number}
//   {t:'var', n:string}
//   {t:'add', a, b}
//   {t:'sub', a, b}
//   {t:'mul', a, b}
//   {t:'div', a, b}
//   {t:'pow', a, b}
//   {t:'neg', a}
//   {t:'fn',  n:'sin'|'cos'|'tan'|'exp'|'ln'|'sqrt', a}
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MathEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------- Tokenizer ----------------
  // Inserts implicit multiplication: "2x" -> 2*x, "2(x+1)" -> 2*(x+1),
  // "x(x+1)" (x not a function name) -> x*(x+1), ")(" -> )*( , "2 sin(x)" -> 2*sin(x)

  const FUNC_NAMES = new Set(['sin', 'cos', 'tan', 'exp', 'ln', 'sqrt', 'log', 'sinh', 'cosh', 'abs', 'step']);
  const CONST_NAMES = new Set(['e', 'pi']);

  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < n && /[0-9.]/.test(src[j])) j++;
        toks.push({ type: 'num', value: parseFloat(src.slice(i, j)) });
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z_0-9]/.test(src[j])) j++;
        const word = src.slice(i, j);
        toks.push({ type: 'ident', value: word });
        i = j;
        continue;
      }
      if ('+-*/^(),'.includes(c)) {
        toks.push({ type: 'op', value: c });
        i++;
        continue;
      }
      throw new Error('Unexpected character: ' + c);
    }
    return insertImplicitMultiplication(toks);
  }

  function insertImplicitMultiplication(toks) {
    const out = [];
    for (let k = 0; k < toks.length; k++) {
      const cur = toks[k];
      if (out.length) {
        const prev = out[out.length - 1];
        let needMul = false;
        const prevIsValueEnd =
          (prev.type === 'num') ||
          (prev.type === 'ident' && !FUNC_NAMES.has(prev.value)) ||
          (prev.type === 'op' && prev.value === ')');
        const curIsFuncStart = cur.type === 'ident'; // includes func names and vars/consts
        const curIsValueStart =
          cur.type === 'num' ||
          curIsFuncStart ||
          (cur.type === 'op' && cur.value === '(');
        if (prevIsValueEnd && curIsValueStart) needMul = true;
        // Special case: number followed by ident that IS a function name, e.g. "2sin(x)"
        if (needMul) out.push({ type: 'op', value: '*' });
      }
      out.push(cur);
    }
    return out;
  }

  // ---------------- Parser (recursive descent) ----------------
  // expr := term (('+'|'-') term)*
  // term := unary (('*'|'/') unary)*
  // unary := '-' unary | pow
  // pow := atom ('^' unary)?      (right-associative)
  // atom := number | ident | ident '(' expr (',' expr)* ')' | '(' expr ')'

  function parse(src) {
    const toks = tokenize(src);
    let pos = 0;

    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }
    function expectOp(v) {
      const t = next();
      if (!t || t.type !== 'op' || t.value !== v) {
        throw new Error('Expected "' + v + '" but got ' + (t ? JSON.stringify(t) : 'end of input'));
      }
    }

    function parseExpr() {
      let node = parseTerm();
      for (;;) {
        const t = peek();
        if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
          next();
          const rhs = parseTerm();
          node = t.value === '+' ? { t: 'add', a: node, b: rhs } : { t: 'sub', a: node, b: rhs };
        } else break;
      }
      return node;
    }

    function parseTerm() {
      let node = parseUnary();
      for (;;) {
        const t = peek();
        if (t && t.type === 'op' && (t.value === '*' || t.value === '/')) {
          next();
          const rhs = parseUnary();
          node = t.value === '*' ? { t: 'mul', a: node, b: rhs } : { t: 'div', a: node, b: rhs };
        } else break;
      }
      return node;
    }

    function parseUnary() {
      const t = peek();
      if (t && t.type === 'op' && t.value === '-') {
        next();
        return { t: 'neg', a: parseUnary() };
      }
      if (t && t.type === 'op' && t.value === '+') {
        next();
        return parseUnary();
      }
      return parsePow();
    }

    function parsePow() {
      const base = parseAtom();
      const t = peek();
      if (t && t.type === 'op' && t.value === '^') {
        next();
        const exp = parseUnary();
        return { t: 'pow', a: base, b: exp };
      }
      return base;
    }

    function parseAtom() {
      const t = next();
      if (!t) throw new Error('Unexpected end of input');
      if (t.type === 'num') return { t: 'num', v: t.value };
      if (t.type === 'op' && t.value === '(') {
        const node = parseExpr();
        expectOp(')');
        return node;
      }
      if (t.type === 'ident') {
        if (FUNC_NAMES.has(t.value)) {
          expectOp('(');
          const arg = parseExpr();
          expectOp(')');
          return { t: 'fn', n: t.value, a: arg };
        }
        return { t: 'var', n: t.value };
      }
      throw new Error('Unexpected token: ' + JSON.stringify(t));
    }

    const result = parseExpr();
    if (pos < toks.length) throw new Error('Unexpected trailing input at token ' + pos);
    return result;
  }

  // ---------------- Helpers to build nodes ----------------
  const num = (v) => ({ t: 'num', v });
  const vr = (n) => ({ t: 'var', n });
  const add = (a, b) => ({ t: 'add', a, b });
  const sub = (a, b) => ({ t: 'sub', a, b });
  const mul = (a, b) => ({ t: 'mul', a, b });
  const div = (a, b) => ({ t: 'div', a, b });
  const powN = (a, b) => ({ t: 'pow', a, b });
  const neg = (a) => ({ t: 'neg', a });
  const fn = (n, a) => ({ t: 'fn', n, a });

  const ZERO = num(0), ONE = num(1);

  function isNum(node, v) {
    return node.t === 'num' && (v === undefined || Math.abs(node.v - v) < 1e-12);
  }

  // ---------------- Differentiation ----------------
  function diff(node, x) {
    switch (node.t) {
      case 'num': return ZERO;
      case 'var': return node.n === x ? ONE : ZERO;
      case 'add': return add(diff(node.a, x), diff(node.b, x));
      case 'sub': return sub(diff(node.a, x), diff(node.b, x));
      case 'neg': return neg(diff(node.a, x));
      case 'mul': return add(mul(diff(node.a, x), node.b), mul(node.a, diff(node.b, x)));
      case 'div': {
        // (a'b - ab') / b^2
        const numr = sub(mul(diff(node.a, x), node.b), mul(node.a, diff(node.b, x)));
        return div(numr, powN(node.b, num(2)));
      }
      case 'pow': {
        const { a, b } = node;
        const aHasX = containsVar(a, x);
        const bHasX = containsVar(b, x);
        if (!bHasX) {
          // a^c -> c*a^(c-1)*a'
          return mul(mul(b, powN(a, sub(b, ONE))), diff(a, x));
        }
        if (!aHasX) {
          // c^b -> c^b * ln(c) * b'
          return mul(mul(node, fn('ln', a)), diff(b, x));
        }
        // general: a^b = exp(b ln a) -> a^b * (b' ln a + b a'/a)
        return mul(node, add(mul(diff(b, x), fn('ln', a)), mul(b, div(diff(a, x), a))));
      }
      case 'fn': {
        const { n, a } = node;
        const da = diff(a, x);
        switch (n) {
          case 'sin': return mul(fn('cos', a), da);
          case 'cos': return neg(mul(fn('sin', a), da));
          case 'tan': return mul(div(ONE, powN(fn('cos', a), num(2))), da);
          case 'exp': return mul(node, da);
          case 'ln': return mul(div(ONE, a), da);
          case 'sqrt': return mul(div(ONE, mul(num(2), fn('sqrt', a))), da);
          case 'sinh': return mul(fn('cosh', a), da);
          case 'cosh': return mul(fn('sinh', a), da);
          case 'abs': return mul(div(a, fn('abs', a)), da);
          default: throw new Error('diff: unknown function ' + n);
        }
      }
      default: throw new Error('diff: unknown node ' + node.t);
    }
  }

  function containsVar(node, x) {
    switch (node.t) {
      case 'num': return false;
      case 'var': return node.n === x;
      case 'add': case 'sub': case 'mul': case 'div': case 'pow':
        return containsVar(node.a, x) || containsVar(node.b, x);
      case 'neg': return containsVar(node.a, x);
      case 'fn': return containsVar(node.a, x);
      default: return false;
    }
  }

  // ---------------- Simplify / Expand ----------------
  // A single pass that folds constants, removes identities (x+0, x*1, x*0,
  // x^1, x^0), flattens double negation, and distributes multiplication
  // over addition (expand). Applied repeatedly to a fixed point.

  function simplifyOnce(node) {
    if (node.t === 'num' || node.t === 'var') return node;

    if (node.t === 'neg') {
      const a = simplifyOnce(node.a);
      if (a.t === 'num') return num(-a.v);
      if (a.t === 'neg') return a.a;
      // distribute negation over addition/subtraction so terms can combine:
      // -(p + q) -> -p - q,  -(p - q) -> q - p
      if (a.t === 'add') return simplifyOnce(sub(neg(a.a), a.b));
      if (a.t === 'sub') return simplifyOnce(sub(a.b, a.a));
      return { t: 'neg', a };
    }

    if (node.t === 'add') {
      let a = simplifyOnce(node.a), b = simplifyOnce(node.b);
      if (a.t === 'num' && b.t === 'num') return num(a.v + b.v);
      if (isNum(a, 0)) return b;
      if (isNum(b, 0)) return a;
      if (b.t === 'neg') return simplifyOnce(sub(a, b.a));
      return add(a, b);
    }

    if (node.t === 'sub') {
      let a = simplifyOnce(node.a), b = simplifyOnce(node.b);
      if (a.t === 'num' && b.t === 'num') return num(a.v - b.v);
      if (isNum(b, 0)) return a;
      if (isNum(a, 0)) return simplifyOnce(neg(b));
      if (b.t === 'neg') return simplifyOnce(add(a, b.a));
      // distribute so terms can combine: a - (p + q) -> (a - p) - q,  a - (p - q) -> (a - p) + q
      if (b.t === 'add') return simplifyOnce(sub(sub(a, b.a), b.b));
      if (b.t === 'sub') return simplifyOnce(add(sub(a, b.a), b.b));
      return sub(a, b);
    }

    if (node.t === 'mul') {
      let a = simplifyOnce(node.a), b = simplifyOnce(node.b);
      if (a.t === 'num' && b.t === 'num') return num(a.v * b.v);
      if (isNum(a, 0) || isNum(b, 0)) return ZERO;
      if (isNum(a, 1)) return b;
      if (isNum(b, 1)) return a;
      if (a.t === 'neg' && b.t === 'neg') return simplifyOnce(mul(a.a, b.a));
      if (a.t === 'neg') return simplifyOnce(neg(mul(a.a, b)));
      if (b.t === 'neg') return simplifyOnce(neg(mul(a, b.a)));
      // cancel c * (expr / c) -> expr  (and (expr / c) * c), a common leftover
      // shape after multiplying a fraction through by its own denominator
      if (b.t === 'div' && nodeKey(a) === nodeKey(b.b)) return b.a;
      if (a.t === 'div' && nodeKey(b) === nodeKey(a.b)) return a.a;
      // e^u * e^v -> e^{u+v} (combining exponentials is what lets later
      // factor-cancellation see through products like x*e^x*e^x / e^{2x})
      if (a.t === 'fn' && a.n === 'exp' && b.t === 'fn' && b.n === 'exp') {
        return simplifyOnce(fn('exp', add(a.a, b.a)));
      }
      // same-base powers: x^m * x^n -> x^{m+n} (bases compared structurally)
      if (a.t === 'pow' && b.t === 'pow' && nodeKey(a.a) === nodeKey(b.a)) {
        return simplifyOnce(powN(a.a, add(a.b, b.b)));
      }
      if (a.t === 'pow' && nodeKey(a.a) === nodeKey(b)) return simplifyOnce(powN(a.a, add(a.b, ONE)));
      if (b.t === 'pow' && nodeKey(b.a) === nodeKey(a)) return simplifyOnce(powN(b.a, add(b.b, ONE)));
      // a * (n/d) -> (a*n)/d, so factors on both sides of a division can meet
      // and cancel (e.g. x * e^x * (e^x/x) needs this to reach e^{2x})
      if (b.t === 'div') return simplifyOnce(div(mul(a, b.a), b.b));
      if (a.t === 'div') return simplifyOnce(div(mul(a.a, b), a.b));
      // distribute over addition/subtraction (expand)
      if (b.t === 'add') return simplifyOnce(add(mul(a, b.a), mul(a, b.b)));
      if (b.t === 'sub') return simplifyOnce(sub(mul(a, b.a), mul(a, b.b)));
      if (a.t === 'add') return simplifyOnce(add(mul(a.a, b), mul(a.b, b)));
      if (a.t === 'sub') return simplifyOnce(sub(mul(a.a, b), mul(a.b, b)));
      return mul(a, b);
    }

    if (node.t === 'div') {
      let a = simplifyOnce(node.a), b = simplifyOnce(node.b);
      if (isNum(b, 1)) return a;
      if (a.t === 'num' && b.t === 'num' && b.v !== 0) return num(a.v / b.v);
      if (isNum(a, 0)) return ZERO;
      if (a.t === 'neg' && b.t === 'neg') return simplifyOnce(div(a.a, b.a));
      if (a.t === 'neg') return simplifyOnce(neg(div(a.a, b)));
      if (b.t === 'neg') return simplifyOnce(neg(div(a, b.a)));
      // (c * expr) / c -> expr
      if (a.t === 'mul' && nodeKey(a.a) === nodeKey(b)) return a.b;
      if (a.t === 'mul' && nodeKey(a.b) === nodeKey(b)) return a.a;
      // e^u / e^v -> e^{u-v}
      if (a.t === 'fn' && a.n === 'exp' && b.t === 'fn' && b.n === 'exp') {
        return simplifyOnce(fn('exp', sub(a.a, b.a)));
      }
      // same-base powers: x^m / x^n -> x^{m-n}
      if (a.t === 'pow' && b.t === 'pow' && nodeKey(a.a) === nodeKey(b.a)) {
        return simplifyOnce(powN(a.a, sub(a.b, b.b)));
      }
      if (a.t === 'pow' && nodeKey(a.a) === nodeKey(b)) return simplifyOnce(powN(a.a, sub(a.b, ONE)));
      if (b.t === 'pow' && nodeKey(b.a) === nodeKey(a)) return simplifyOnce(div(ONE, powN(b.a, sub(b.b, ONE))));
      // Cancel any factor(s) shared between numerator and denominator, e.g.
      // (e^{2x} * x) / e^{2x} -> x, or (|x|^3 * x) / |x|^2 -> |x| * x. Only
      // applied when the denominator's factors are FULLY covered by the
      // numerator's (so no negative exponents get introduced) — this keeps
      // ordinary fractions like x/2 untouched.
      if (a.t !== 'add' && a.t !== 'sub' && b.t !== 'add' && b.t !== 'sub') {
        const fa = factorizeTerm(a), fb = factorizeTerm(b);
        const denKeys = Object.keys(fb.factors);
        const fullyCovered = denKeys.length > 0 && denKeys.every((k) => fa.factors[k] && fa.factors[k].exp >= fb.factors[k].exp);
        if (fullyCovered) {
          const newFactors = {};
          for (const k of Object.keys(fa.factors)) newFactors[k] = { base: fa.factors[k].base, exp: fa.factors[k].exp };
          for (const k of denKeys) {
            newFactors[k].exp -= fb.factors[k].exp;
            if (newFactors[k].exp === 0) delete newFactors[k];
          }
          return simplifyOnce(rebuildFromFactors(fa.coeff / fb.coeff, newFactors));
        }
      }
      // distribute a sum in the numerator over the denominator — this is
      // always valid (unlike distributing a sum in the denominator) and
      // exposes per-term cancellations like (mu*x + mu*C)/mu -> x + C
      if (a.t === 'add') return simplifyOnce(add(div(a.a, b), div(a.b, b)));
      if (a.t === 'sub') return simplifyOnce(sub(div(a.a, b), div(a.b, b)));
      return div(a, b);
    }

    if (node.t === 'pow') {
      let a = simplifyOnce(node.a), b = simplifyOnce(node.b);
      if (isNum(b, 0)) return ONE;
      if (isNum(b, 1)) return a;
      if (a.t === 'num' && b.t === 'num') return num(Math.pow(a.v, b.v));
      // (e^u)^n -> e^{u*n}
      if (a.t === 'fn' && a.n === 'exp') return simplifyOnce(fn('exp', mul(a.a, b)));
      // (x^m)^n -> x^{m*n}
      if (a.t === 'pow') return simplifyOnce(powN(a.a, mul(a.b, b)));
      return powN(a, b);
    }

    if (node.t === 'fn') {
      const a = simplifyOnce(node.a);
      if (a.t === 'num') {
        switch (node.n) {
          case 'sin': return num(Math.sin(a.v));
          case 'cos': return num(Math.cos(a.v));
          case 'tan': return num(Math.tan(a.v));
          case 'exp': return num(Math.exp(a.v));
          case 'ln': return num(Math.log(a.v));
          case 'sqrt': return num(Math.sqrt(a.v));
          case 'sinh': return num(Math.sinh(a.v));
          case 'cosh': return num(Math.cosh(a.v));
          case 'abs': return num(Math.abs(a.v));
          case 'step': return num(a.v >= 0 ? 1 : 0);
        }
      }
      // exp(ln(w)) -> w  and  ln(exp(w)) -> w  (inverse functions cancel)
      if (node.n === 'exp' && a.t === 'fn' && a.n === 'ln') return a.a;
      if (node.n === 'ln' && a.t === 'fn' && a.n === 'exp') return a.a;
      // exp(k * ln(w)) -> w^k  (arises constantly from integrating factors e^{c ln|x|})
      if (node.n === 'exp') {
        const lnMul = extractLnMultiple(a);
        if (lnMul) return powN(lnMul.w, lnMul.k);
      }
      return fn(node.n, a);
    }

    return node;
  }

  // If `node` has the shape k * ln(w) (in either multiplication order), or
  // just ln(w) (k=1), or -ln(w) (k=-1), return {k, w}; otherwise null.
  // Used to simplify exp(k * ln(w)) -> w^k, which is how integrating factors
  // like e^{c ln|x|} arise from integrate().
  function extractLnMultiple(node) {
    if (node.t === 'fn' && node.n === 'ln') return { k: ONE, w: node.a };
    if (node.t === 'neg') {
      const inner = extractLnMultiple(node.a);
      if (inner) return { k: neg(inner.k), w: inner.w };
    }
    if (node.t === 'mul') {
      if (node.a.t === 'fn' && node.a.n === 'ln') return { k: node.b, w: node.a.a };
      if (node.b.t === 'fn' && node.b.n === 'ln') return { k: node.a, w: node.b.a };
    }
    return null;
  }

  function nodeKey(node) {
    return JSON.stringify(node);
  }

  function simplify(node, maxIter) {
    maxIter = maxIter || 12;
    let cur = node;
    for (let i = 0; i < maxIter; i++) {
      let nxt = simplifyOnce(cur);
      nxt = collectLikeTerms(nxt);
      if (nodeKey(nxt) === nodeKey(cur)) return nxt;
      cur = nxt;
    }
    return cur;
  }

  // ---- Collect like terms ----
  // simplifyOnce expands products over sums but never combines terms that
  // land far apart in the resulting sum (e.g. x^2*|x|*y - x^2*|x|*y, or
  // 2*x + 3*x). This walks the tree bottom-up and, at every +/- node, groups
  // its flattened terms by their non-numeric "shape" and sums the numeric
  // coefficients — the standard "collect like terms" step done by hand.

  function factorizeTerm(node) {
    // Splits a single multiplicative term into an overall numeric coefficient
    // and a map of {base -> integer exponent} for everything else, so that
    // e.g. 3*x^2*y and -x^2*y*7 both produce the base map {x:2, y:1}.
    let coeff = 1;
    const factors = {}; // nodeKey(base) -> {base, exp}
    function addFactor(base, exp) {
      const k = nodeKey(base);
      if (factors[k]) factors[k].exp += exp; else factors[k] = { base, exp };
    }
    (function walk(nd, sign) {
      if (nd.t === 'num') { coeff *= sign === 1 ? nd.v : 1 / nd.v; return; }
      if (nd.t === 'neg') { coeff *= -1; walk(nd.a, sign); return; }
      if (nd.t === 'mul') { walk(nd.a, sign); walk(nd.b, sign); return; }
      // a/b: descend into a normally, and into b with the sign flipped (so a
      // denominator's factors accumulate negative exponents) — this lets e.g.
      // (e^{2x}/x)/e^{2x} line up its e^{2x} numerator against the outer
      // e^{2x} denominator and cancel, leaving 1/x.
      if (nd.t === 'div') { walk(nd.a, sign); walk(nd.b, -sign); return; }
      if (nd.t === 'pow' && nd.b.t === 'num' && Number.isInteger(nd.b.v) && Math.abs(nd.b.v) <= 64) {
        addFactor(nd.a, sign * nd.b.v);
        return;
      }
      addFactor(nd, sign);
    })(node, 1);
    return { coeff, factors };
  }

  function rebuildFromFactors(coeff, factors) {
    const keys = Object.keys(factors).sort();
    let product = null;
    for (const k of keys) {
      const { base, exp } = factors[k];
      if (exp === 0) continue;
      const factorNode = exp === 1 ? base : powN(base, num(exp));
      product = product === null ? factorNode : mul(product, factorNode);
    }
    if (product === null) return num(coeff);
    if (coeff === 1) return product;
    if (coeff === -1) return neg(product);
    return mul(num(coeff), product);
  }

  function collectLikeTerms(node) {
    if (!node || typeof node !== 'object') return node;
    switch (node.t) {
      case 'num': case 'var': return node;
      case 'neg': return { t: 'neg', a: collectLikeTerms(node.a) };
      case 'fn': return { t: 'fn', n: node.n, a: collectLikeTerms(node.a) };
      case 'mul': return { t: 'mul', a: collectLikeTerms(node.a), b: collectLikeTerms(node.b) };
      case 'div': return { t: 'div', a: collectLikeTerms(node.a), b: collectLikeTerms(node.b) };
      case 'pow': return { t: 'pow', a: collectLikeTerms(node.a), b: collectLikeTerms(node.b) };
      case 'add': case 'sub': {
        const collectedChildren = { t: node.t, a: collectLikeTerms(node.a), b: collectLikeTerms(node.b) };
        const terms = flattenSum(collectedChildren);
        const order = [];
        const buckets = new Map();
        for (const term of terms) {
          const { coeff, factors } = factorizeTerm(term);
          const key = Object.keys(factors).sort().map((k) => k + '^' + factors[k].exp).join('*');
          if (buckets.has(key)) buckets.get(key).coeff += coeff;
          else { buckets.set(key, { coeff, factors }); order.push(key); }
        }
        let result = null;
        for (const key of order) {
          const { coeff, factors } = buckets.get(key);
          if (Math.abs(coeff) < 1e-12) continue;
          const termNode = rebuildFromFactors(coeff, factors);
          result = result === null ? termNode : add(result, termNode);
        }
        return result === null ? num(0) : result;
      }
      default: return node;
    }
  }

  const expand = simplify; // our simplify already distributes, serving as expand too

  // ---------------- Term collection (for combining like terms) ----------------
  // Flattens a sum into an array of additive terms (each possibly negated),
  // useful for integrate()'s linearity rule.
  function flattenSum(node) {
    if (node.t === 'add') return [...flattenSum(node.a), ...flattenSum(node.b)];
    if (node.t === 'sub') return [...flattenSum(node.a), ...flattenSum(neg(node.b))];
    // distribute a bare negation over a sum so its terms flatten too, rather
    // than treating "-(p + q)" as one opaque term
    if (node.t === 'neg' && node.a.t === 'add') return [...flattenSum(neg(node.a.a)), ...flattenSum(neg(node.a.b))];
    if (node.t === 'neg' && node.a.t === 'sub') return [...flattenSum(neg(node.a.a)), ...flattenSum(node.a.b)];
    return [node];
  }

  // ---------------- LaTeX rendering ----------------
  function precedence(node) {
    switch (node.t) {
      case 'add': case 'sub': return 1;
      case 'neg': return 1.5;
      case 'mul': case 'div': return 2;
      case 'pow': return 3;
      default: return 4; // atoms
    }
  }

  function toLatex(node, parentPrec) {
    parentPrec = parentPrec || 0;
    let s, myPrec;
    switch (node.t) {
      case 'num': {
        const v = node.v;
        s = Number.isInteger(v) ? String(v) : String(v);
        myPrec = v < 0 ? 1.5 : 4;
        break;
      }
      case 'var': s = node.n; myPrec = 4; break;
      case 'neg': s = '-' + toLatex(node.a, 1.5); myPrec = 1.5; break;
      case 'add': s = toLatex(node.a, 1) + ' + ' + toLatex(node.b, 1); myPrec = 1; break;
      case 'sub': s = toLatex(node.a, 1) + ' - ' + toLatex(node.b, 1.01); myPrec = 1; break;
      case 'mul': {
        // Use \cdot, but suppress it before a variable/function/parenthesis for readability
        const left = toLatex(node.a, 2);
        const right = toLatex(node.b, 2.01);
        s = left + ' \\cdot ' + right;
        myPrec = 2;
        break;
      }
      case 'div': s = '\\frac{' + toLatex(node.a, 0) + '}{' + toLatex(node.b, 0) + '}'; myPrec = 4; break;
      case 'pow': s = toLatex(node.a, 3.01) + '^{' + toLatex(node.b, 0) + '}'; myPrec = 3; break;
      case 'fn': {
        const names = { sin: '\\sin', cos: '\\cos', tan: '\\tan', exp: 'e', ln: '\\ln', sqrt: '\\sqrt', sinh: '\\sinh', cosh: '\\cosh', abs: '\\left|\\cdot\\right|', step: '\\mathcal{H}' };
        if (node.n === 'sqrt') { s = '\\sqrt{' + toLatex(node.a, 0) + '}'; }
        else if (node.n === 'exp') { s = 'e^{' + toLatex(node.a, 0) + '}'; }
        else if (node.n === 'abs') { s = '\\left|' + toLatex(node.a, 0) + '\\right|'; }
        else { s = names[node.n] + '\\left(' + toLatex(node.a, 0) + '\\right)'; }
        myPrec = 4;
        break;
      }
      default: s = '?'; myPrec = 4;
    }
    if (myPrec < parentPrec) return '\\left(' + s + '\\right)';
    return s;
  }

  // Plain-text math rendering (no LaTeX markup) — used anywhere an expression
  // needs to appear in an ordinary sentence or error message rather than a
  // typeset equation, e.g. "e^(3x^2/2) * 5x^2" instead of raw LaTeX source.
  function toPlainText(node, parentPrec) {
    parentPrec = parentPrec || 0;
    let s, myPrec;
    switch (node.t) {
      case 'num': { const v = node.v; s = String(v); myPrec = v < 0 ? 1.5 : 4; break; }
      case 'var': s = node.n; myPrec = 4; break;
      case 'neg': s = '-' + toPlainText(node.a, 1.5); myPrec = 1.5; break;
      case 'add': s = toPlainText(node.a, 1) + ' + ' + toPlainText(node.b, 1); myPrec = 1; break;
      case 'sub': s = toPlainText(node.a, 1) + ' - ' + toPlainText(node.b, 1.01); myPrec = 1; break;
      case 'mul': s = toPlainText(node.a, 2) + '*' + toPlainText(node.b, 2.01); myPrec = 2; break;
      case 'div': s = toPlainText(node.a, 2.01) + '/' + toPlainText(node.b, 2.01); myPrec = 2; break;
      case 'pow': s = toPlainText(node.a, 3.01) + '^' + toPlainText(node.b, 3.01); myPrec = 3; break;
      case 'fn': {
        const names = { sin: 'sin', cos: 'cos', tan: 'tan', exp: 'exp', ln: 'ln', sqrt: 'sqrt', sinh: 'sinh', cosh: 'cosh', abs: 'abs', step: 'u' };
        if (node.n === 'exp') { s = 'e^(' + toPlainText(node.a, 0) + ')'; myPrec = 3; }
        else { s = names[node.n] + '(' + toPlainText(node.a, 0) + ')'; myPrec = 4; }
        break;
      }
      default: s = '?'; myPrec = 4;
    }
    if (myPrec < parentPrec) return '(' + s + ')';
    return s;
  }

  // Replace every occurrence of variable `name` with `replacement` (another
  // AST node) — used to plug a solved constant like C back into a general
  // solution before simplifying and displaying the particular solution.
  function substVar(node, name, replacement) {
    switch (node.t) {
      case 'num': return node;
      case 'var': return node.n === name ? replacement : node;
      case 'add': return { t: 'add', a: substVar(node.a, name, replacement), b: substVar(node.b, name, replacement) };
      case 'sub': return { t: 'sub', a: substVar(node.a, name, replacement), b: substVar(node.b, name, replacement) };
      case 'mul': return { t: 'mul', a: substVar(node.a, name, replacement), b: substVar(node.b, name, replacement) };
      case 'div': return { t: 'div', a: substVar(node.a, name, replacement), b: substVar(node.b, name, replacement) };
      case 'pow': return { t: 'pow', a: substVar(node.a, name, replacement), b: substVar(node.b, name, replacement) };
      case 'neg': return { t: 'neg', a: substVar(node.a, name, replacement) };
      case 'fn': return { t: 'fn', n: node.n, a: substVar(node.a, name, replacement) };
      default: return node;
    }
  }

  // ---------------- Numeric evaluation ----------------
  function evaluate(node, env) {
    switch (node.t) {
      case 'num': return node.v;
      case 'var': {
        if (node.n === 'e') return Math.E;
        if (node.n === 'pi') return Math.PI;
        if (!(node.n in env)) throw new Error('Undefined variable: ' + node.n);
        return env[node.n];
      }
      case 'add': return evaluate(node.a, env) + evaluate(node.b, env);
      case 'sub': return evaluate(node.a, env) - evaluate(node.b, env);
      case 'mul': return evaluate(node.a, env) * evaluate(node.b, env);
      case 'div': return evaluate(node.a, env) / evaluate(node.b, env);
      case 'pow': return Math.pow(evaluate(node.a, env), evaluate(node.b, env));
      case 'neg': return -evaluate(node.a, env);
      case 'fn': {
        const v = evaluate(node.a, env);
        switch (node.n) {
          case 'sin': return Math.sin(v);
          case 'cos': return Math.cos(v);
          case 'tan': return Math.tan(v);
          case 'exp': return Math.exp(v);
          case 'ln': return Math.log(v);
          case 'sqrt': return Math.sqrt(v);
          case 'sinh': return Math.sinh(v);
          case 'cosh': return Math.cosh(v);
          case 'abs': return Math.abs(v);
          case 'step': return v >= 0 ? 1 : 0;
          default: throw new Error('evaluate: unknown fn ' + node.n);
        }
      }
      default: throw new Error('evaluate: unknown node ' + node.t);
    }
  }

  function compile(node, varNames) {
    // Returns a fast JS function(env-array-in-order-of-varNames) for repeated numeric eval.
    return (...args) => {
      const env = {};
      varNames.forEach((n, i) => { env[n] = args[i]; });
      return evaluate(node, env);
    };
  }

  // ---------------- Symbolic integration (limited) ----------------
  // integrate(node, x) returns an AST for the antiderivative w.r.t. x, or
  // throws an Error('NO_CLOSED_FORM: ...') if it doesn't recognize the form.
  // Caller should catch and fall back to numeric methods.

  class NoClosedForm extends Error {
    constructor(msg) { super(msg); this.name = 'NoClosedForm'; }
  }

  // Try to express node as c * x^n (constant c not containing x, n constant), return {c,n} or null
  function asMonomial(node, x) {
    node = simplify(node);
    if (!containsVar(node, x)) return { c: node, n: ZERO };
    if (node.t === 'var' && node.n === x) return { c: ONE, n: ONE };
    if (node.t === 'pow' && node.a.t === 'var' && node.a.n === x && !containsVar(node.b, x)) {
      return { c: ONE, n: node.b };
    }
    if (node.t === 'mul') {
      const aHas = containsVar(node.a, x), bHas = containsVar(node.b, x);
      if (!aHas) {
        const inner = asMonomial(node.b, x);
        if (inner) return { c: simplify(mul(node.a, inner.c)), n: inner.n };
      }
      if (!bHas) {
        const inner = asMonomial(node.a, x);
        if (inner) return { c: simplify(mul(node.b, inner.c)), n: inner.n };
      }
    }
    if (node.t === 'neg') {
      const inner = asMonomial(node.a, x);
      if (inner) return { c: simplify(neg(inner.c)), n: inner.n };
    }
    if (node.t === 'div') {
      const bHas = containsVar(node.b, x);
      if (!bHas) {
        const inner = asMonomial(node.a, x);
        if (inner) return { c: simplify(div(inner.c, node.b)), n: inner.n };
      }
      // c / x^n  ->  c * x^(-n), when numerator doesn't contain x
      if (!containsVar(node.a, x)) {
        const denomMono = asMonomial(node.b, x);
        if (denomMono) {
          return { c: simplify(div(node.a, denomMono.c)), n: simplify(neg(denomMono.n)) };
        }
      }
    }
    return null;
  }

  // Try c * e^(k x)
  function asExpTerm(node, x) {
    node = simplify(node);
    if (node.t === 'fn' && node.n === 'exp') {
      const km = asMonomial(node.a, x);
      if (km && isNum(km.n, 1)) return { c: ONE, k: km.c };
      if (!containsVar(node.a, x)) return null; // constant exponent, not exp(kx)
    }
    if (node.t === 'mul') {
      const aHas = containsVar(node.a, x), bHas = containsVar(node.b, x);
      if (!aHas) { const inner = asExpTerm(node.b, x); if (inner) return { c: simplify(mul(node.a, inner.c)), k: inner.k }; }
      if (!bHas) { const inner = asExpTerm(node.a, x); if (inner) return { c: simplify(mul(node.b, inner.c)), k: inner.k }; }
    }
    if (node.t === 'neg') { const inner = asExpTerm(node.a, x); if (inner) return { c: simplify(neg(inner.c)), k: inner.k }; }
    return null;
  }

  // Try c * sin(kx) or c * cos(kx) -> {c, k, kind:'sin'|'cos'}
  function asTrigTerm(node, x) {
    node = simplify(node);
    if (node.t === 'fn' && (node.n === 'sin' || node.n === 'cos')) {
      const km = asMonomial(node.a, x);
      if (km && isNum(km.n, 1)) return { c: ONE, k: km.c, kind: node.n };
    }
    if (node.t === 'mul') {
      const aHas = containsVar(node.a, x), bHas = containsVar(node.b, x);
      if (!aHas) { const inner = asTrigTerm(node.b, x); if (inner) return { c: simplify(mul(node.a, inner.c)), k: inner.k, kind: inner.kind }; }
      if (!bHas) { const inner = asTrigTerm(node.a, x); if (inner) return { c: simplify(mul(node.b, inner.c)), k: inner.k, kind: inner.kind }; }
    }
    if (node.t === 'neg') { const inner = asTrigTerm(node.a, x); if (inner) return { c: simplify(neg(inner.c)), k: inner.k, kind: inner.kind }; }
    return null;
  }

  // integral of x^n dx (n constant, n != -1) = x^(n+1)/(n+1); n=-1 -> ln|x|
  function integratePower(n, x) {
    if (n.t === 'num' && Math.abs(n.v + 1) < 1e-12) return null; // signal ln case
    const np1 = simplify(add(n, ONE));
    return { node: div(powN(vr(x), np1), np1), np1 };
  }

  // Polynomial degree helper: returns integer degree of a monomial-sum in x, or null if not polynomial
  function polyDegree(node, x) {
    node = simplify(node);
    const terms = flattenSum(node);
    let maxDeg = 0;
    for (const term of terms) {
      const m = asMonomial(term, x);
      if (!m || m.n.t !== 'num' || !Number.isInteger(m.n.v) || m.n.v < 0) return null;
      maxDeg = Math.max(maxDeg, m.n.v);
    }
    return maxDeg;
  }

  // Repeated differentiation of a polynomial (as node) w.r.t x, returns array [P, P', P'', ...] until zero
  function polyDerivChain(node, x) {
    const chain = [simplify(node)];
    let cur = chain[0];
    while (!(cur.t === 'num' && cur.v === 0)) {
      cur = simplify(diff(cur, x));
      chain.push(cur);
      if (chain.length > 30) break;
    }
    return chain;
  }

  // Tabular integration by parts for P(x) * e^(kx): returns antiderivative node
  function tabularPolyExp(P, k, x) {
    const chain = polyDerivChain(P, x); // [P, P', P'', ..., 0]
    // integral P e^{kx} dx = e^{kx} * sum_{i=0}^{m-1} (-1)^i P^{(i)}(x) / k^{i+1}
    let sum = null;
    for (let i = 0; i < chain.length - 1; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const term = div(chain[i], powN(k, num(i + 1)));
      const signedTerm = sign === 1 ? term : neg(term);
      sum = sum === null ? signedTerm : add(sum, signedTerm);
    }
    return simplify(mul(fn('exp', mul(k, vr(x))), sum));
  }

  // Tabular integration by parts for P(x) * sin(kx) or cos(kx)
  function tabularPolyTrig(P, k, x, kind) {
    // Use complex-free tabular method for real sin/cos with alternating derivatives of P
    // and integrating trig part each round: d/dx sin(kx) cycle sin->cos->-sin->-cos ; integral cycle is inverse
    const chain = polyDerivChain(P, x);
    // antiderivatives of kind at "integration order" j: for sin(kx): -cos(kx)/k, -sin(kx)/k^2, cos(kx)/k^3, sin(kx)/k^4 ...
    // We'll build via the standard tabular sign-alternating pairing of P^{(i)} with the i-th antiderivative of trig(kx).
    function trigAntiderivChain(count) {
      // returns [g0, g1, ..., g_{count}] where g0 = kind(kx), g_{j} = integral of g_{j-1} dx
      const chain2 = [fn(kind, mul(k, vr(x)))];
      for (let j = 1; j <= count; j++) {
        const prev = chain2[j - 1];
        // integral of sin(kx) = -cos(kx)/k ; integral of cos(kx) = sin(kx)/k
        const prevIsSin = j - 1 === 0 ? kind === 'sin' : chain2[j - 1]._kind === 'sin';
        chain2.push(null); // placeholder, computed below with explicit tracking
      }
      return chain2;
    }
    // Simpler explicit approach: track (kind, sign) pairs cycling sin -> cos -> sin -> cos with sign flips
    // integral^{(1)} of sin(kx) = -(1/k) cos(kx)
    // integral^{(2)} of sin(kx) = -(1/k^2) sin(kx)
    // integral^{(3)} of sin(kx) = (1/k^3) cos(kx)
    // integral^{(4)} of sin(kx) = (1/k^4) sin(kx)
    // integral^{(1)} of cos(kx) = (1/k) sin(kx)
    // integral^{(2)} of cos(kx) = -(1/k^2) cos(kx)
    // integral^{(3)} of cos(kx) = -(1/k^3) sin(kx)
    // integral^{(4)} of cos(kx) = (1/k^4) cos(kx)
    function nthAntideriv(order) {
      const m = ((order - 1) % 4 + 4) % 4; // 0..3
      let outKind, sign;
      if (kind === 'sin') {
        const table = [
          ['cos', -1], ['sin', -1], ['cos', 1], ['sin', 1],
        ];
        [outKind, sign] = table[m];
      } else {
        const table = [
          ['sin', 1], ['cos', -1], ['sin', -1], ['cos', 1],
        ];
        [outKind, sign] = table[m];
      }
      const base = fn(outKind, mul(k, vr(x)));
      const scaled = div(base, powN(k, num(order)));
      return sign === 1 ? scaled : neg(scaled);
    }
    // integral P*trig dx = sum_{i=0}^{m-1} (-1)^i P^{(i)} * G_{i+1}  where G_j = nthAntideriv(j)
    let sum = null;
    for (let i = 0; i < chain.length - 1; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const term = mul(chain[i], nthAntideriv(i + 1));
      const signedTerm = sign === 1 ? term : neg(term);
      sum = sum === null ? signedTerm : add(sum, signedTerm);
    }
    return simplify(sum);
  }

  // Closed form for e^{ax} sin(bx) / e^{ax} cos(bx) via reduction formula
  function expTrigIntegral(a, b, kind, x) {
    // ∫ e^{ax} sin(bx) dx = e^{ax}(a sin(bx) - b cos(bx)) / (a^2+b^2)
    // ∫ e^{ax} cos(bx) dx = e^{ax}(a cos(bx) + b sin(bx)) / (a^2+b^2)
    const denom = add(powN(a, num(2)), powN(b, num(2)));
    if (kind === 'sin') {
      const numerVal = sub(mul(a, fn('sin', mul(b, vr(x)))), mul(b, fn('cos', mul(b, vr(x)))));
      return simplify(div(mul(fn('exp', mul(a, vr(x))), numerVal), denom));
    } else {
      const numerVal = add(mul(a, fn('cos', mul(b, vr(x)))), mul(b, fn('sin', mul(b, vr(x)))));
      return simplify(div(mul(fn('exp', mul(a, vr(x))), numerVal), denom));
    }
  }

  // Try to write node as c * x^m * |x|^n, where m is a nonnegative integer
  // (so x^m is smooth everywhere) and n is any constant. Covers products like
  // x^2|x| that show up when an integrating factor e^{c ln|x|} multiplies a
  // polynomial Q(x). Uses: d/dx[x^(m+1)|x|^n/(m+n+1)] = x^m|x|^n.
  function asPolyTimesAbs(node, x) {
    node = simplify(node);
    const isAbsX = (nd) => nd.t === 'fn' && nd.n === 'abs' && nd.a.t === 'var' && nd.a.n === x;
    let c = ONE, m = 0, n = null, ok = true;
    (function scan(nd) {
      if (!ok) return;
      if (nd.t === 'mul') { scan(nd.a); scan(nd.b); return; }
      if (nd.t === 'neg') { c = simplify(neg(c)); scan(nd.a); return; }
      if (isAbsX(nd)) { if (n === null) n = ONE; else ok = false; return; }
      if (nd.t === 'pow' && isAbsX(nd.a) && !containsVar(nd.b, x)) { if (n === null) n = nd.b; else ok = false; return; }
      if (nd.t === 'var' && nd.n === x) { m += 1; return; }
      if (nd.t === 'pow' && nd.a.t === 'var' && nd.a.n === x && nd.b.t === 'num' && Number.isInteger(nd.b.v) && nd.b.v >= 0) { m += nd.b.v; return; }
      if (!containsVar(nd, x)) { c = simplify(mul(c, nd)); return; }
      ok = false;
    })(node);
    if (!ok || n === null) return null; // no abs factor found, or an unrecognized factor — let other rules handle it
    return { c, m, n };
  }

  function integrateSingleTerm(node, x) {
    node = simplify(node);

    // constant
    if (!containsVar(node, x)) return simplify(mul(node, vr(x)));

    // c*x^m*|x|^n (m+n != -1)  ->  c * x^(m+1)*|x|^n/(m+n+1)
    // (covers c*|x|^n itself when m=0; verified via d/dx[x^(m+1)|x|^n/(m+n+1)] = x^m|x|^n)
    const polyAbs = asPolyTimesAbs(node, x);
    if (polyAbs) {
      const mPlusNPlus1 = simplify(add(add(num(polyAbs.m), polyAbs.n), ONE));
      if (!isNum(mPlusNPlus1, 0)) {
        return simplify(mul(polyAbs.c, div(mul(powN(vr(x), num(polyAbs.m + 1)), powN(fn('abs', vr(x)), polyAbs.n)), mPlusNPlus1)));
      }
    }

    // monomial c*x^n
    const mono = asMonomial(node, x);
    if (mono) {
      if (isNum(mono.n, -1)) return simplify(mul(mono.c, fn('ln', fn('abs', vr(x)))));
      const res = integratePower(mono.n, x);
      if (res) return simplify(mul(mono.c, res.node));
    }

    // pure exp term c*e^{kx}
    const expTerm = asExpTerm(node, x);
    if (expTerm && !(node.t === 'mul' && polyDegree(node.t === 'mul' ? (containsVar(node.a, x) && polyDegree(node.a,x)!==null ? node.a : node.b) : node, x) > 0)) {
      // Guard: only treat as pure exp if not actually poly*exp (handled below)
    }
    // Try polynomial * exp(kx)
    {
      const factored = factorPolyTimesSpecial(node, x, 'exp');
      if (factored) return tabularPolyExp(factored.P, factored.k, x);
    }
    // Try polynomial * sin(kx) or cos(kx)
    {
      const factored = factorPolyTimesSpecial(node, x, 'trig');
      if (factored) return tabularPolyTrig(factored.P, factored.k, x, factored.kind);
    }
    // Try exp(ax) * sin(bx) or cos(bx)
    {
      const factored = factorExpTimesTrig(node, x);
      if (factored) return expTrigIntegral(factored.a, factored.b, factored.kind, x);
    }
    // Pure exp(kx) (no polynomial factor beyond constant) — handled by asExpTerm path directly
    if (expTerm) {
      if (isNum(expTerm.k, 0)) return simplify(mul(expTerm.c, vr(x)));
      return simplify(mul(expTerm.c, div(fn('exp', mul(expTerm.k, vr(x))), expTerm.k)));
    }
    // Pure sin/cos c*trig(kx)
    const trigTerm = asTrigTerm(node, x);
    if (trigTerm) {
      const antideriv = trigTerm.kind === 'sin'
        ? neg(div(fn('cos', mul(trigTerm.k, vr(x))), trigTerm.k))
        : div(fn('sin', mul(trigTerm.k, vr(x))), trigTerm.k);
      return simplify(mul(trigTerm.c, antideriv));
    }

    throw new NoClosedForm('No elementary antiderivative recognized for ' + toPlainText(node) + '.');
  }

  // Try to write node as P(x) * special(kx) where special is exp, sin, or cos, P polynomial (degree>=0)
  function factorPolyTimesSpecial(node, x, kind) {
    node = simplify(node);
    let polyPart = ONE, specialNode = null, specialK = null, specialKind = null;

    function scan(n) {
      if (n.t === 'mul') { scan(n.a); scan(n.b); return; }
      if (n.t === 'neg') { polyPart = simplify(neg(polyPart)); scan(n.a); return; }
      if (kind === 'exp' && n.t === 'fn' && n.n === 'exp') {
        const km = asMonomial(n.a, x);
        if (km && isNum(km.n, 1)) { specialK = km.c; specialNode = n; return; }
      }
      if (kind === 'trig' && n.t === 'fn' && (n.n === 'sin' || n.n === 'cos')) {
        const km = asMonomial(n.a, x);
        if (km && isNum(km.n, 1)) { specialK = km.c; specialNode = n; specialKind = n.n; return; }
      }
      polyPart = simplify(mul(polyPart, n));
    }
    scan(node);
    if (!specialNode) return null;
    const deg = polyDegree(polyPart, x);
    if (deg === null) return null;
    if (deg === 0 && isNum(simplify(polyPart), 1)) return null; // pure special term, handled elsewhere for clarity but still valid
    return kind === 'exp'
      ? { P: polyPart, k: specialK }
      : { P: polyPart, k: specialK, kind: specialKind };
  }

  // Try to write node as C * e^{ax} * sin(bx) or C * e^{ax} * cos(bx)
  function factorExpTimesTrig(node, x) {
    node = simplify(node);
    let constPart = ONE, a = null, b = null, kind = null, sawExp = false, sawTrig = false;
    function scan(n) {
      if (n.t === 'mul') { scan(n.a); scan(n.b); return; }
      if (n.t === 'neg') { constPart = simplify(neg(constPart)); scan(n.a); return; }
      if (n.t === 'fn' && n.n === 'exp') {
        const km = asMonomial(n.a, x);
        if (km && isNum(km.n, 1)) { a = km.c; sawExp = true; return; }
      }
      if (n.t === 'fn' && (n.n === 'sin' || n.n === 'cos')) {
        const km = asMonomial(n.a, x);
        if (km && isNum(km.n, 1)) { b = km.c; kind = n.n; sawTrig = true; return; }
      }
      constPart = simplify(mul(constPart, n));
    }
    scan(node);
    if (!sawExp || !sawTrig) return null;
    const cVal = simplify(constPart);
    if (!(isNum(cVal, 1))) {
      // fold constant into result afterward — simplest: multiply final result by constPart
      return { a, b, kind, extraConst: cVal };
    }
    return { a, b, kind };
  }

  function integrate(node, x) {
    node = simplify(node);
    const terms = flattenSum(node);
    let result = null;
    for (const term of terms) {
      let piece;
      const factored = factorExpTimesTrig(term, x);
      if (factored && factored.extraConst) {
        const base = integrateSingleTerm(simplify(div(term, factored.extraConst)), x);
        piece = simplify(mul(factored.extraConst, base));
      } else {
        piece = integrateSingleTerm(term, x);
      }
      result = result === null ? piece : add(result, piece);
    }
    return simplify(result === null ? ZERO : result);
  }

  // ---------------- Numeric RK4 ----------------
  // First order: y' = f(x,y), y(x0) = y0. Returns arrays {xs, ys}.
  function rk4FirstOrder(f, x0, y0, xEnd, steps) {
    const h = (xEnd - x0) / steps;
    const xs = [x0], ys = [y0];
    let x = x0, y = y0;
    for (let i = 0; i < steps; i++) {
      const k1 = f(x, y);
      const k2 = f(x + h / 2, y + (h / 2) * k1);
      const k3 = f(x + h / 2, y + (h / 2) * k2);
      const k4 = f(x + h, y + h * k3);
      y = y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      x = x + h;
      xs.push(x); ys.push(y);
    }
    return { xs, ys };
  }

  // Second order via reduction to system: y'=v, v'=g(x,y,v). y(x0)=y0, y'(x0)=v0.
  function rk4SecondOrder(g, x0, y0, v0, xEnd, steps) {
    const h = (xEnd - x0) / steps;
    const xs = [x0], ys = [y0], vs = [v0];
    let x = x0, y = y0, v = v0;
    function deriv(x, y, v) { return [v, g(x, y, v)]; }
    for (let i = 0; i < steps; i++) {
      const k1 = deriv(x, y, v);
      const k2 = deriv(x + h / 2, y + (h / 2) * k1[0], v + (h / 2) * k1[1]);
      const k3 = deriv(x + h / 2, y + (h / 2) * k2[0], v + (h / 2) * k2[1]);
      const k4 = deriv(x + h, y + h * k3[0], v + h * k3[1]);
      y = y + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      v = v + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      x = x + h;
      xs.push(x); ys.push(y); vs.push(v);
    }
    return { xs, ys, vs };
  }

  return {
    tokenize, parse, diff, simplify, expand, integrate, toLatex, evaluate, compile,
    containsVar, flattenSum, NoClosedForm, toPlainText, substVar,
    rk4FirstOrder, rk4SecondOrder,
    // node builders (useful for callers constructing ASTs programmatically)
    num, vr, add, sub, mul, div, pow: powN, neg, fn,
  };
});
