/**
 * Local end-to-end test for worker.js without deploying to Cloudflare.
 * Loads the worker module, fakes a Worker env, and calls the real model provider.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... SITE_ACCESS_CODE=testcode node worker/test-worker.mjs
 * (Inside the worker/ directory: OPENAI_API_KEY=sk-... SITE_ACCESS_CODE=testcode npm test)
 *
 * OPENAI_API_KEY is read from the environment only; never hardcode it here.
 */
import worker from './worker.js';

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
function call(path, {method = 'GET', headers = {}, body} = {}) {
  const request = new Request(ORIGIN + path, {method, headers: {Origin: ORIGIN, ...headers}, body});
  return worker.fetch(request, env);
}

// 1. Status endpoint with correct access code
{
  const res = await call('/api/status', {headers: {'X-App-Access': env.SITE_ACCESS_CODE}});
  const data = await res.json();
  check('GET /api/status -> 200 available', res.status === 200 && data.available === true, JSON.stringify(data));
  check('status reports model name', typeof data.model === 'string' && data.model.length > 0, JSON.stringify(data));
}

// 2. Wrong access code must be rejected
{
  const res = await call('/api/status', {headers: {'X-App-Access': 'wrong-code'}});
  check('wrong access code -> 401', res.status === 401, 'status ' + res.status);
}

// 3. Foreign origin must be rejected
{
  const request = new Request('https://evil.example/api/status', {headers: {Origin: 'https://evil.example'}});
  const res = await worker.fetch(request, env);
  check('foreign origin -> 403', res.status === 403, 'status ' + res.status);
}

// 4. A rule-ambiguous case must reach the provider and return cleaned JSON
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
    const codes = data.candidates.map(c => c.code).join(',');
    check('candidate codes all valid', data.candidates.every(c => /^[a-z]+$/.test(c.code) && c.reason), codes);
  }
  console.log('  model summary:', data.summary);
  for (const c of data.candidates || []) console.log(`  candidate: ${c.code} - ${String(c.reason).slice(0, 80)}`);
}

// 5. A rule-decided case must be rejected without calling the provider
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
