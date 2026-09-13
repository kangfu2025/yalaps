const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compiled = new Map();
function load(file, modules = {}, globals = {}) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText);
  const context = { exports: {}, Response, Headers, AbortController, setTimeout, clearTimeout,
    setInterval, clearInterval, console: { log() {}, error() {}, warn() {} },
    require(name) { if (!(name in modules)) throw Error('Unexpected import: ' + name); return modules[name]; }, ...globals };
  vm.runInNewContext(compiled.get(file), context, { filename: file });
  return context.exports;
}
const classifier = load('src/lib/slipPayload.ts');
const payload = '00020101021129370016A000000677010111011300668123456785802TH53037646304ABCD';
const qr = 'BANK-SLIP-FIXTURE-REFERENCE-0001';
function fixture() {
  return { success: true, data: { matchedAccount: { bankNumber: '1234567890' },
    rawSlip: { transRef: 'TEST-REF', date: '2026-09-13T12:00:00+07:00', amount: { amount: 100 },
      receiver: { account: { name: { th: 'Test shop' } } } } } };
}
function server(options = {}) {
  const rows = options.rows || new Map();
  const requests = [];
  const db = { auth: { getUser: async () => ({ data: { user: options.anonymous ? null : { id: 'staff-id' } } }) },
    from(table) {
      const q = { select() { return q; }, eq() { return q; },
        then(resolve, reject) { return Promise.resolve({ data: options.roles ?? [{ role: 'staff' }] }).then(resolve, reject); },
        maybeSingle: async () => ({ data: rows.get('TEST-REF') || null }),
        async insert(row) {
          assert.equal(table, 'slip_verifications');
          if (options.insertError) return { error: { code: options.insertError } };
          if (rows.has(row.trans_ref)) return { error: { code: '23505' } };
          rows.set(row.trans_ref, row);
          return { error: null };
        } };
      return q;
    } };
  const route = load('src/routes/api/verify-slip.ts', {
    '@tanstack/react-router': { createFileRoute: () => config => config },
    '@supabase/supabase-js': { createClient: () => db }, '@/lib/slipPayload': classifier,
  }, { process: { env: { EASYSLIP_API_KEY: options.noKey ? '' : ' mock-key ' } },
    fetch: async (url, init) => {
      requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      if (options.network) throw Object.assign(Error('mock network'), { name: options.network });
      return new Response(options.nonJson ? '<html>bad gateway</html>' : JSON.stringify(options.response ?? fixture()), { status: options.http ?? 200 });
    } }).Route;
  return { rows, requests, async verify(body = { payload: qr, expectedAmount: 100 }) {
    const response = await route.server.handlers.POST({ request: {
      headers: new Headers({ authorization: 'Bearer mock-user' }), json: async () => body,
    } });
    return { http: response.status, ...await response.json() };
  } };
}
test('Base64 uses v2 JSON field, trimmed key and receiver matching', async () => {
  const s = server(); const r = await s.verify({ imageBase64: 'data:image/png;base64,AQID', expectedAmount: 100 });
  assert.equal(r.ok, true); assert.equal(s.requests[0].body.base64, 'AQID');
  assert.equal(s.requests[0].body.image, undefined); assert.equal(s.requests[0].body.matchAccount, true);
  assert.equal(s.requests[0].headers.Authorization, 'Bearer mock-key');
  assert.equal(s.rows.size, 1);
});
test('QR succeeds and binds bill metadata', async () => {
  const s = server(); const id = '11111111-1111-4111-8111-111111111111';
  assert.equal((await s.verify({ payload: qr, expectedAmount: 100, pcSessionId: id })).ok, true);
  assert.equal(s.rows.get('TEST-REF').pc_session_id, id);
});
test('a real slip for another receiver never authorizes payment', async () => {
  const response = fixture(); response.data.matchedAccount = null;
  const s = server({ response }); assert.equal((await s.verify()).code, 'RECEIVER_NOT_MATCHED'); assert.equal(s.rows.size, 0);
});
test('database failure cannot return verified', async () => {
  const s = server({ insertError: '42501' }); const r = await s.verify();
  assert.equal(r.ok, false); assert.equal(r.code, 'SAVE_FAILED'); assert.equal(s.rows.size, 0);
});
test('wrong amount can be corrected without consuming the slip', async () => {
  const s = server(); assert.equal((await s.verify({ payload: qr, expectedAmount: 99 })).status, 'amount_mismatch');
  assert.equal(s.rows.size, 0); assert.equal((await s.verify()).ok, true);
});
test('consumed slips cannot authorize a second payment, including concurrent requests', async () => {
  const s = server(); const results = await Promise.all([s.verify(), s.verify()]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.filter(r => r.status === 'duplicate').length, 1);
});
test('one satang tolerance is stable with floating point decimals', async () => {
  const response = fixture(); response.data.rawSlip.amount.amount = 100.01;
  assert.equal((await server({ response }).verify()).ok, true);
  response.data.rawSlip.amount.amount = 100.02;
  assert.equal((await server({ response }).verify()).status, 'amount_mismatch');
});
test('rejects malformed input before any provider request', async () => {
  for (const body of [null, [], { payload: 42, expectedAmount: 100 }, { payload: qr, expectedAmount: -1 },
    { payload: qr, expectedAmount: '100' }, { payload: qr, imageBase64: 'AQID', expectedAmount: 100 },
    { payload: qr, expectedAmount: 100, reservationId: 'invalid' },
    { imageBase64: 'data:image/svg+xml;base64,AQID', expectedAmount: 100 },
    { imageBase64: 'not base64!', expectedAmount: 100 }]) {
    const s = server(); assert.equal((await s.verify(body)).http, 400); assert.equal(s.requests.length, 0);
  }
});
test('rejects decoded images larger than 4 MB', async () => {
  const s = server(); const imageBase64 = Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64');
  assert.equal((await s.verify({ imageBase64, expectedAmount: 100 })).http, 413); assert.equal(s.requests.length, 0);
});
test('rejects payment QR / URL locally and normalizes repeated slip scans', async () => {
  const s = server(); assert.equal((await s.verify({ payload: 'https://example.com', expectedAmount: 100 })).ok, false);
  assert.equal((await s.verify({ payload, expectedAmount: 100 })).ok, false); assert.equal(s.requests.length, 0);
  assert.equal((await s.verify({ payload: qr + qr, expectedAmount: 100 })).ok, true); assert.equal(s.requests[0].body.payload, qr);
});
test('provider pending, quota and HTTP failures cannot pass', async () => {
  for (const code of ['SLIP_PENDING', 'QUOTA_EXCEEDED', 'INVALID_API_KEY']) {
    const s = server({ response: { success: false, error: { code } } }); const r = await s.verify();
    assert.equal(r.ok, false); assert.equal(r.code, code); assert.equal(r.retryable, code === 'SLIP_PENDING'); assert.equal(s.rows.size, 0);
  }
});
test('malformed or ambiguous provider success fails closed', async () => {
  for (const options of [{ nonJson: true }, { response: null, nonJson: true }, { response: {} },
    { response: [] }, { response: { ...fixture(), success: false } }, { http: 500 }]) {
    const s = server(options); assert.equal((await s.verify()).ok, false); assert.equal(s.rows.size, 0);
  }
});
test('missing transaction reference, amount or date never gets saved', async () => {
  for (const field of ['transRef', 'amount', 'date']) {
    const response = fixture(); delete response.data.rawSlip[field];
    const s = server({ response }); assert.equal((await s.verify()).ok, false); assert.equal(s.rows.size, 0);
  }
});
test('timeout/network failures preserve retryability of the bank transaction', async () => {
  for (const network of ['AbortError', 'TypeError']) {
    const s = server({ network }); assert.equal((await s.verify()).ok, false); assert.equal(s.rows.size, 0);
  }
});
test('unauthenticated users and users without staff/admin roles cannot consume quota', async () => {
  for (const options of [{ anonymous: true }, { roles: [] }]) {
    const s = server(options); assert.ok([401, 403].includes((await s.verify()).http)); assert.equal(s.requests.length, 0);
  }
});
test('missing API key fails before contacting provider', async () => {
  const s = server({ noKey: true }); assert.equal((await s.verify()).http, 500); assert.equal(s.requests.length, 0);
});
function scanFlow(options = {}) {
  let event; let poll; let removed = false;
  const writes = []; const shown = []; const results = [];
  const channel = { on(_name, _filter, callback) { event = callback; return channel; }, subscribe() { return channel; } };
  const db = { rpc: async () => ({ data: options.accept ?? true }), channel: () => channel, removeChannel: () => { removed = true; },
    from() { const q = { update(row) { writes.push(row); return q; }, eq() { return q; }, then(resolve) { resolve({ error: null }); } }; return q; } };
  const module = load('src/lib/slipScan.ts', { './supabase': { supabase: db },
    './slipVerify': { verifySlip: options.verify ?? (async () => ({ ok: true, expectedAmount: 100 })) },
    './customerDisplay': { clearDisplay: async () => {}, showSlipScanScreen: async () => {},
      showSlipResultScreen: async (...args) => { shown.push(args); if (options.displayError) throw Error('offline display'); } },
  }, { setInterval: fn => { poll = fn; return 1; }, clearInterval() { poll = null; } });
  return { module, writes, shown, results, start() { return module.watchSlipScan('request', r => results.push(r)); },
    scan() { return event({ new: { status: 'scanned', payload: qr, expected_amount: 100 } }); },
    get removed() { return removed; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('expired customer scan reports a failure rather than waiting forever', async () => {
  const flow = scanFlow({ accept: false }); await assert.rejects(flow.module.submitScannedPayload('request', qr));
});
test('cancelled scan ignores a provider result that arrives later', async () => {
  let resolve; const flow = scanFlow({ verify: () => new Promise(r => { resolve = r; }) });
  const stop = flow.start(); flow.scan(); stop(); resolve({ ok: true }); await flush();
  assert.equal(flow.results.length, 0); assert.equal(flow.shown.length, 0); assert.equal(flow.removed, true);
});
test('repeated realtime events only verify once', async () => {
  let count = 0; const flow = scanFlow({ verify: async () => { count++; return { ok: true }; } });
  const stop = flow.start(); flow.scan(); flow.scan(); await flush(); stop(); assert.equal(count, 1); assert.equal(flow.results.length, 1);
});
test('customer display outage does not lose a persisted successful verification', async () => {
  const flow = scanFlow({ displayError: true }); const stop = flow.start(); flow.scan(); await flush(); stop();
  assert.equal(flow.results[0].ok, true);
});

// Minimal hook driver for exercising the actual component callbacks without a browser or network.
function paymentUI() {
  const cells = []; let index = 0; let effects = []; let gun; let verified = 0; let verifyCalls = 0;
  let resolveVerify; let tree; let cameraResult;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = index++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
      return [cells[i], next => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
    useRef(initial) { const i = index++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(fn, deps) { const i = index++; const prev = cells[i]; if (!prev || !depsEqual(prev.deps, deps)) {
      effects.push(() => { prev?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); } },
    useCallback(fn, deps) { const i = index++; if (!cells[i] || !depsEqual(cells[i].deps, deps)) cells[i] = { deps, fn }; return cells[i].fn; },
  };
  const jsx = (type, props) => ({ type, props });
  const display = { clearDisplay: async () => {}, showSlipResultScreen: async () => {}, pushDisplay: async () => {}, lockDisplay() {}, unlockDisplay() {} };
  const component = load('src/components/shop/PromptPayQR.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'qrcode': { default: { toDataURL: async () => 'mock-qr-image' } },
    'lucide-react': {}, '@/lib/promptpay': { buildPromptpayDataUrl: async () => 'mock-image', PROMPTPAY_ID: 'test' },
    '@/lib/priceEngine': { formatBaht: String }, './SlipVerifyModal': { SlipVerifyModal: 'SlipVerifyModal' },
    '@/lib/slipScan': { startSlipScan: async () => ({ id: 'scan-id' }), cancelSlipScan: async () => {},
      watchSlipScan(_id, callback) { cameraResult = callback; return () => {}; } },
    '@/lib/slipVerify': { verifySlip: () => { verifyCalls++; return new Promise(resolve => { resolveVerify = resolve; }); } },
    '@/hooks/useBarcodeGun': { useBarcodeGun(callback, opts) { gun = opts.enabled ? callback : null; } },
    '@/lib/slipPayload': classifier, '@/lib/customerDisplay': display,
  }, { setInterval: () => 1, clearInterval() {} }).PromptPayQR;
  let props = { amount: 100, onVerified: () => { verified++; } };
  function render(next = {}) { props = { ...props, ...next }; index = 0; effects = []; tree = component(props); effects.forEach(fn => fn()); return tree; }
  function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes);
    return [value, ...nodes(value.props?.children)]; }
  function text(value) { if (value == null || typeof value === 'boolean') return ''; if (Array.isArray(value)) return value.map(text).join('');
    return typeof value === 'object' ? text(value.props?.children) : String(value); }
  return { render, click(label) { const button = nodes(tree).find(n => n.type === 'button' && text(n).includes(label));
      assert.ok(button, 'Missing button: ' + label); return button.props.onClick(); },
    scan() { gun?.(qr); }, succeed() { resolveVerify({ ok: true, expectedAmount: 100 }); },
    cameraSuccess() { cameraResult({ ok: true, expectedAmount: 100 }); },
    unmount() { cells.forEach(c => c?.cleanup?.()); },
    get verified() { return verified; }, get verifyCalls() { return verifyCalls; } };
}
test('direct scanner cannot start two concurrent EasySlip checks', async () => {
  const ui = paymentUI(); ui.render(); await flush(); ui.render(); await ui.click('ให้ลูกค้าโชว์สลิป'); ui.render();
  ui.scan(); ui.scan(); await flush(); assert.equal(ui.verifyCalls, 1);
  ui.succeed(); await flush(); assert.equal(ui.verified, 1); ui.unmount();
});
test('changing amount rejects a late EasySlip result', async () => {
  const ui = paymentUI(); ui.render(); await flush(); ui.render(); await ui.click('ให้ลูกค้าโชว์สลิป'); ui.render();
  ui.scan(); await flush(); ui.render({ amount: 200 }); ui.succeed(); await flush();
  assert.equal(ui.verified, 0); ui.unmount();
});
test('camera result from the previous bill cannot authorize the next bill', async () => {
  const ui = paymentUI(); ui.render(); await flush(); ui.render(); await ui.click('ให้ลูกค้าโชว์สลิป'); ui.render();
  ui.render({ pcSessionId: 'next-bill' }); ui.cameraSuccess(); assert.equal(ui.verified, 0); ui.unmount();
});
test('EasySlip connection status rejects malformed and application-level errors', async () => {
  for (const response of [{}, { success: false, error: { code: 'INVALID_API_KEY' } }, null, []]) {
    const route = load('src/routes/api/slip-status.ts', {
      '@tanstack/react-router': { createFileRoute: () => config => config },
      '@supabase/supabase-js': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'staff' } } }) } }) },
    }, { process: { env: { EASYSLIP_API_KEY: 'mock' } }, fetch: async () => new Response(JSON.stringify(response)) }).Route;
    const r = await route.server.handlers.GET({ request: { headers: new Headers({ authorization: 'Bearer mock' }) } });
    assert.equal((await r.json()).ok, false);
  }
});
test('EasySlip connection status accepts documented v2 success', async () => {
  const route = load('src/routes/api/slip-status.ts', {
    '@tanstack/react-router': { createFileRoute: () => config => config },
    '@supabase/supabase-js': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'staff' } } }) } }) },
  }, { process: { env: { EASYSLIP_API_KEY: 'mock' } }, fetch: async () => new Response(JSON.stringify({ success: true, data: {} })) }).Route;
  const r = await route.server.handlers.GET({ request: { headers: new Headers({ authorization: 'Bearer mock' }) } });
  assert.equal((await r.json()).ok, true);
});
