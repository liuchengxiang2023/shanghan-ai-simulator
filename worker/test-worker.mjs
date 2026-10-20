/**
 * Local end-to-end test for worker.js without deploying to Cloudflare.
 * Loads the worker module, fakes a Worker env, and calls the real model provider.
 *
 * worker.js imports ../index.html as a text module (a Wrangler bundling rule);
 * plain Node cannot load .html, so the import is replaced with a stub string here.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... SITE_ACCESS_CODE=testcode node worker/test-worker.mjs
 * (Inside the worker/ directory: OPENAI_API_KEY=sk-... SITE_ACCESS_CODE=testcode npm test)
 *
 * OPENAI_API_KEY is read from the environment only; never hardcode it here.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./worker.js', import.meta.url), 'utf8')
  .replace(/^import INDEX_HTML from ['"][^'"]+['"];?$/m,
    'const INDEX_HTML = "<!DOCTYPE html><html><title>伤寒论·外感辨证学习模拟器</title></html>";');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;

const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  SITE_ACCESS_CODE: process.env.SITE_ACCESS_CODE || 'local-test-access-code',
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'https://liuchengxiang2023.github.io',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'deepseek-chat',
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
  OPENAI_JSON_MODE: 'true',
};
const ORIGIN = env.ALLOWED_ORIGIN;

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <- ' + detail}`);
  if (!ok) failures++;
}
function call(path, {method = 'GET', headers = {}, body, origin = ORIGIN} = {}) {
  const h = {...headers};
  if (origin) h['Origin'] = origin;
  return worker.fetch(new Request(ORIGIN + path, {method, headers: h, body}), env);
}

// 1. All-in-one: the Worker serves the bundled page at "/"
{
  const res = await call('/');
  const text = await res.text();
  check('GET / serves the HTML page', res.status === 200 && (res.headers.get('Content-Type') || '').includes('text/html'), `status ${res.status}`);
  check('served page is the simulator', text.includes('伤寒论'), text.slice(0, 80));
}

// 2. Same-origin status probe WITH access code
{
  const res = await call('/api/status', {headers: {'X-App-Access': env.SITE_ACCESS_CODE}});
  const data = await res.json();
  check('GET /api/status -> 200 available', res.status === 200 && data.available === true, JSON.stringify(data));
  check('status reports model name', typeof data.model === 'string' && data.model.length > 0, JSON.stringify(data));
}

// 3. Same-origin probe WITHOUT access code (browser first visit) -> 401, not 403
{
  const res = await call('/api/status');
  check('same-origin without access code -> 401 (not 403)', res.status === 401, 'status ' + res.status);
}

// 4. Non-browser call without Origin header still passes CORS and hits auth
{
  const res = await call('/api/status', {headers: {'X-App-Access': env.SITE_ACCESS_CODE}, origin: null});
  const data = await res.json();
  check('no-Origin request -> 200 via access code', res.status === 200 && data.available === true, 'status ' + res.status);
}

// 5. Wrong access code must be rejected
{
  const res = await call('/api/status', {headers: {'X-App-Access': 'wrong-code'}});
  check('wrong access code -> 401', res.status === 401, 'status ' + res.status);
}

// 6. Foreign origin must be rejected (API-only mode keeps ALLOWED_ORIGIN gating)
{
  const request = new Request(ORIGIN + '/api/status', {headers: {Origin: 'https://evil.example'}});
  const res = await worker.fetch(request, env);
  check('foreign origin -> 403', res.status === 403, 'status ' + res.status);
}

// 7. A rule-ambiguous case must reach the provider and return cleaned JSON
{
  const payload = {
    symptoms: {primary: 'gut', sweat: 'unk', temp: 'neutral', thirst: 'warm', phlegm: 'unk',
      extras: [], note: '腹泻两次，喝水不多，小便量没注意'},
    rule: {candidate: null, reasons: [],
      ambiguity: ['目前的症状组合未落入图表的典型完整分支，不能确定单一对应方剂。']},
  };
  const res = await call('/api/analyze', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-App-Access': env.SITE_ACCESS_CODE},
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  check('POST /api/analyze -> 200', res.status === 200, JSON.stringify(data).slice(0, 300));
  check('summary is non-empty text', typeof data.summary === 'string' && data.summary.length > 0, JSON.stringify(data).slice(0, 300));
  check('candidates is an array (may be empty)', Array.isArray(data.candidates), JSON.stringify(data).slice(0, 300));
  if (data.candidates?.length) {
    check('candidate codes all valid', data.candidates.every(c => /^[a-z]+$/.test(c.code) && c.reason), data.candidates.map(c => c.code).join(','));
  }
  console.log('  model summary:', data.summary);
  for (const c of data.candidates || []) console.log(`  candidate: ${c.code} - ${String(c.reason).slice(0, 80)}`);
}

// 8. A rule-decided case must be rejected without calling the provider
{
  const payload = {
    symptoms: {primary: 'fever', sweat: 'yes', temp: 'cold', thirst: 'warm', phlegm: 'white', extras: [], note: ''},
    rule: {candidate: 'guizhi', reasons: ['图示匹配'], ambiguity: []},
  };
  const res = await call('/api/analyze', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-App-Access': env.SITE_ACCESS_CODE},
    body: JSON.stringify(payload),
  });
  check('rule-decided case -> 422 (no provider call)', res.status === 422, 'status ' + res.status);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
