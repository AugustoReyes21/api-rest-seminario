import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';

interface Scenario {
  id: string;
  label: string;
  description: string;
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}

const scenarios = JSON.parse(
  await readFile(new URL('../examples/scenarios.json', import.meta.url), 'utf8'),
) as Scenario[];
const httpIndex = process.argv.indexOf('--http');
const remote = httpIndex >= 0;
const endpoint = remote
  ? process.argv[httpIndex + 1] ?? 'http://localhost:4000/graphql'
  : 'http://localhost/graphql';
const app = remote ? null : createApp();

console.log(remote ? `Servicio HTTP: ${endpoint}` : 'Servicio Yoga con almacenamiento nuevo en memoria');

for (const scenario of scenarios) {
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operationName: scenario.operationName,
      query: scenario.query,
      variables: scenario.variables,
    }),
  };
  const response = app
    ? await app.fetch(endpoint, request)
    : await fetch(endpoint, request);
  const result = await response.json() as {
    data?: unknown;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
    extensions?: { dataAccess?: { authorBatchReads: number } };
  };
  const expectedCode = scenario.id === 'missing'
    ? 'NOT_FOUND'
    : ['invalid', 'limit'].includes(scenario.id) ? 'BAD_USER_INPUT' : undefined;

  if (expectedCode) {
    assert.equal(result.errors?.[0]?.extensions?.code, expectedCode, scenario.label);
  } else {
    assert.ok(!result.errors, `${scenario.label}: ${JSON.stringify(result.errors)}`);
    assert.ok(result.data, `${scenario.label}: respuesta sin datos`);
  }
  if (scenario.id === 'list') assert.equal(result.extensions?.dataAccess?.authorBatchReads, 1);
  if (scenario.id === 'no-relation') assert.equal(result.extensions?.dataAccess?.authorBatchReads, 0);

  console.log(`\n${scenario.operationName} — ${scenario.label}`);
  console.log(`Variables: ${JSON.stringify(scenario.variables)}`);
  console.log(JSON.stringify(result, null, 2));
}

console.log(`\n${scenarios.length} operaciones verificadas, incluidos los errores esperados.`);
