// Test-only transport injection. Never shipped or enabled by the production CLI.
const original = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (String(url) !== 'https://holocron.invalid/api/secrets') throw new Error('unexpected test endpoint');
  return original(process.env.HOLOCRON_TEST_RELAY_URL!, init);
};
