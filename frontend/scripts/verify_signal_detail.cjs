/* eslint-disable no-console */
// Mount the real SignalDetail and the real AnomalyRibbon in jsdom and assert
// the rendered DOM: the explainer says what the signal is, degrades cleanly
// through every partial payload, survives a component that throws, and the
// ribbon hands the WHOLE anomaly to onDrillIn rather than just a promptId.
const path = require('path');
const fs = require('fs');
const Module = require('module');

// Resolved from this file so the harness runs from any working directory.
const FE = path.resolve(__dirname, '..');
process.env.NODE_ENV = 'development';
process.env.REACT_APP_SUPABASE_URL = 'http://localhost/stub';
process.env.REACT_APP_SUPABASE_ANON_KEY = 'stub';
global.IS_REACT_ACT_ENVIRONMENT = true;

const { JSDOM } = require(FE + '/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { pretendToBeVisual: true, url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.sessionStorage = dom.window.sessionStorage;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = clearTimeout;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const babel = require(FE + '/node_modules/@babel/core');
const preset = require(FE + '/node_modules/babel-preset-react-app');
const origJs = Module._extensions['.js'];
const compile = (mod, filename) => mod._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, presets: [[preset, { runtime: 'automatic' }]], babelrc: false, configFile: false, sourceMaps: false,
}).code, filename);
Module._extensions['.jsx'] = compile;
Module._extensions['.js'] = (mod, f) => (f.includes('node_modules') ? origJs(mod, f) : compile(mod, f));

const React = require(FE + '/node_modules/react');
const { createRoot } = require(FE + '/node_modules/react-dom/client');
const act = React.act;

function stub(p, exports) {
  const m = new Module(p, null); m.filename = p; m.loaded = true; m.exports = exports;
  require.cache[p] = m;
}

// The ribbon's only data dependency. Stubbed so this harness tests the
// ribbon's click contract, not the fetchers.
let analyticsData = {};
stub(path.resolve(FE, 'src/hooks/useAnalytics.js'), {
  __esModule: true,
  useAnalytics: (key) => ({ data: analyticsData[key], isLoading: false, error: null }),
});

const SignalDetail = require(FE + '/src/components/analytics/SignalDetail.jsx').default;
const AnomalyRibbon = require(FE + '/src/components/analytics/AnomalyRibbon.jsx').default;
const { buildAnomalies } = require(FE + '/src/lib/anomalyRules.js');

let fails = 0;
const check = (l, c, d = '') => {
  if (c) console.log(`    ✓ ${l}`);
  else { console.log(`    ✗ ${l}${d ? ` — ${d}` : ''}`); fails++; }
};

async function mount(label, element, assertions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  console.log(`\n  ${label}`);
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => { errs.push(a.join(' ')); };
  try {
    await act(async () => { root.render(element); });
    const text = host.textContent || '';
    check('rendered something', host.innerHTML.length > 0);
    check('no literal NaN on screen', !/\bNaN\b/.test(text));
    check('no "undefined" leaked into text', !/\bundefined\b/.test(text));
    check('no "[object Object]" leaked into text', !/\[object Object\]/.test(text));
    if (assertions) assertions(host, text);
  } catch (err) {
    check('rendered without throwing', false, err.message);
  } finally {
    console.error = origErr;
    await act(async () => { root.unmount(); });
    host.remove();
  }
}

// A fully-populated signal, built by the REAL rules so the shape cannot
// drift away from what the component expects.
const full = buildAnomalies({
  customers: {
    kpis: {
      zeroValueTotalCount: 8, zeroValueQuoteCount: 5, zeroValueApprovedCount: 2,
      quotesScreened: 867,
    },
    breakdowns: {
      dataQualityFlags: Array.from({ length: 20 }, (_, i) => ({
        code: 'zero_value', entityId: `KW-QT-P26-${String(i + 1).padStart(4, '0')}`,
        date: '2026-03-21', customer: `Customer ${i + 1}`, value: 0,
        reason: 'Anomalous quote detected: quote value is KWD 0.',
      })),
    },
  },
}).find(f => f.id === 'zero_value_quotes');

(async () => {
  await mount('populated signal — zero-value quotes', React.createElement(SignalDetail, { anomaly: full }), (host, t) => {
    check('restates the headline in full', t.includes('anomalous quotes detected: quote value is KWD 0.'));
    check('explains what the signal is', t.includes('What this signal is'));
    check('explains why it fired', t.includes('Why it fired'));
    check('shows the numbers', t.includes('The numbers') && t.includes('867'));
    check('discloses how it is measured', t.includes('How it is measured'));
    check('says what to do', t.includes('What to do'));
    check('names the affected quotations', t.includes('KW-QT-P26-0001'));
    check('caps the record list', t.includes('more not shown'));
    check('records table scrolls in its own container',
      !!host.querySelector('.overflow-x-auto table'));
    check('does NOT ask about top customers', !/top customers by billing/i.test(t));
  });

  await mount('signal with no explain block at all',
    React.createElement(SignalDetail, { anomaly: { id: 'x', severity: 'warning', headline: 'Something happened', detail: 'A detail line.' } }),
    (host, t) => {
      check('falls back to the headline', t.includes('Something happened'));
      check('falls back to the detail', t.includes('A detail line.'));
      check('no empty section headings left behind', !t.includes('What to do'));
    });

  const partials = {
    'explain present but empty': { ...full, explain: {} },
    'metrics empty': { ...full, explain: { ...full.explain, metrics: [] } },
    'records with zero rows': { ...full, explain: { ...full.explain, records: { title: 'T', rows: [] } } },
    'records rows not an array': { ...full, explain: { ...full.explain, records: { rows: 'nope' } } },
    'actions not an array': { ...full, explain: { ...full.explain, actions: 'do something' } },
    'related is junk': { ...full, explain: { ...full.explain, related: [null, 3] } },
    'metrics rows are null': { ...full, explain: { ...full.explain, metrics: [null, undefined] } },
    'record values are null/negative/absent': {
      ...full,
      explain: {
        ...full.explain,
        records: { title: 'Mixed', rows: [
          { id: 'A-1', date: null, label: null, value: null },
          { id: 'A-2', date: 'not-a-date', label: 'X', value: -450.5 },
          { id: 'A-3', date: '2026-08-14', label: 'Y' },
          { id: 'A-4', date: '2026-08-14', label: 'Z', value: 0 },
        ] },
      },
    },
    'unknown severity': { ...full, severity: 'catastrophic' },
    'headline missing': { ...full, headline: undefined },
  };
  for (const [label, anomaly] of Object.entries(partials)) {
    await mount(label, React.createElement(SignalDetail, { anomaly }));
  }

  await mount('anomaly is null', React.createElement(SignalDetail, { anomaly: null }), (host, t) => {
    check('says the signal is gone rather than blanking', t.includes('no longer available'));
  });
  await mount('anomaly is a string', React.createElement(SignalDetail, { anomaly: 'oops' }), (host, t) => {
    check('handles a non-object without throwing', t.length > 10);
  });

  // ── Ribbon click contract ────────────────────────────────────────────
  console.log('\n  AnomalyRibbon — click contract');
  analyticsData = {
    top_customers: {
      kpis: { zeroValueTotalCount: 8, zeroValueQuoteCount: 5, zeroValueApprovedCount: 0, quotesScreened: 867 },
      breakdowns: { dataQualityFlags: [] },
    },
  };
  const seen = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(AnomalyRibbon, {
      ctx: { windowDays: 365 },
      onDrillIn: (s) => seen.push(s),
    }));
  });
  const btn = [...host.querySelectorAll('button')].find(b => /anomalous quotes/i.test(b.textContent));
  check('a signal chip rendered', !!btn);
  if (btn) {
    await act(async () => { btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    check('onDrillIn was called', seen.length === 1);
    check('it received the WHOLE anomaly, not a promptId', !!seen[0]?.signal?.explain);
    check('the anomaly carries its headline', /KWD 0/.test(seen[0]?.signal?.headline ?? ''));
    check('the old promptId is still available as a fallback',
      seen[0]?.signal?.promptId === 'top_customers');
    check('chip tooltip explains before the click',
      /Click to see what this signal means/.test(btn.getAttribute('title') ?? ''));
  }
  await act(async () => { root.unmount(); });

  // A payload engineered to make the body throw, proving the boundary catches
  // it and the reader still gets the headline. React 19 re-surfaces a
  // boundary-caught error through act(), so this case is asserted against the
  // DOM directly rather than through the shared mount() helper.
  {
    console.log('\n  explain getter throws');
    const poison = { ...full };
    Object.defineProperty(poison, 'explain', { get() { throw new Error('boom'); } });
    const h = document.createElement('div');
    document.body.appendChild(h);
    const r = createRoot(h);
    const origErr = console.error;
    console.error = () => {};
    try {
      await act(async () => { r.render(React.createElement(SignalDetail, { anomaly: poison })); });
    } catch (_) { /* re-surfaced by act; the boundary has already rendered */ }
    console.error = origErr;
    const t = h.textContent || '';
    check('boundary rendered the fallback instead of a blank bubble', t.includes('could not be rendered'));
    check('the reader still gets the headline', /KWD 0/.test(t));
    // Deliberately NOT unmounted: tearing down a root whose render threw
    // leaves React's scheduler wedged for every later root in this process.
    h.remove();
  }

  console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll signal render checks passed.');
  process.exit(fails ? 1 : 0);
})();
