// meeting-assistant fork: the MiniMax-only policy.
//
// npm test runs with MEETING_ASSISTANT_ALLOW_LEGACY_PROVIDERS=1 so the
// upstream multi-provider suites keep passing. This file deletes that flag to
// assert the FORK's production behavior: MiniMax is seeded from env, is the
// default model, nothing else can hijack the defaults, speech defaults to the
// on-device local Whisper, and a malformed key refuses the seed loudly instead
// of corrupting the cURL template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const COMPILED_CM = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist-electron/electron/services/CredentialsManager.js',
);
const COMPILED_MP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist-electron/electron/llm/minimaxProvider.js',
);

// Fork policy is on unless the escape hatch is set; npm test sets it for the
// legacy suites, so this file must take it back out.
const savedHatch = process.env.MEETING_ASSISTANT_ALLOW_LEGACY_PROVIDERS;
delete process.env.MEETING_ASSISTANT_ALLOW_LEGACY_PROVIDERS;
const savedKey = process.env.MINIMAX_API_KEY;

let CURRENT = null;
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    if (!CURRENT) throw new Error('no electron env active');
    return CURRENT.fakeElectron;
  }
  return origLoad.apply(this, arguments);
};

function freshManager() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-policy-'));
  CURRENT = {
    fakeElectron: {
      app: { getPath: () => userData, isPackaged: false, getVersion: () => '0.0.0-test' },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.concat([Buffer.from('KR'), Buffer.from(s, 'utf8')]),
        decryptString: (b) => Buffer.from(b).subarray(2).toString('utf8'),
        getSelectedStorageBackend: () => 'basic_text',
      },
    },
  };
  delete require.cache[require.resolve(COMPILED_CM)];
  const mod = require(COMPILED_CM);
  if (mod.CredentialsManager.instance) mod.CredentialsManager.instance = undefined;
  delete globalThis.__nativelyCredentialsManagerV1__;
  const cm = mod.CredentialsManager.getInstance();
  cm.init();
  return cm;
}

function loadMiniMaxModule() {
  delete require.cache[require.resolve(COMPILED_MP)];
  return require(COMPILED_MP);
}

test.after(() => {
  if (savedHatch !== undefined) process.env.MEETING_ASSISTANT_ALLOW_LEGACY_PROVIDERS = savedHatch;
  if (savedKey !== undefined) process.env.MINIMAX_API_KEY = savedKey;
  else delete process.env.MINIMAX_API_KEY;
});

test('policy is on by default and the seed carries the OpenAI-compatible shape', () => {
  const mp = loadMiniMaxModule();
  assert.equal(mp.miniMaxOnlyPolicy(), true);
  process.env.MINIMAX_API_KEY = 'mk-test-key-123';
  const p = mp.getMiniMaxBuiltinProvider();
  assert.ok(p);
  assert.equal(p.id, 'minimax-m2');
  assert.equal(p.multimodal, false, 'vision must be OFF or screenshots are silently dropped');
  assert.equal(p.responsePath, 'choices[0].message.content');
  assert.match(p.curlCommand, /https:\/\/api\.minimax\.io\/v1\/chat\/completions/);
  assert.match(p.curlCommand, /MiniMax-M2/);
  assert.match(p.curlCommand, /\{\{TEXT\}\}/);
});

test('a quote or newline in the key refuses the seed loudly instead of corrupting the cURL', () => {
  const mp = loadMiniMaxModule();
  process.env.MINIMAX_API_KEY = "mk'bad\"key";
  assert.equal(mp.getMiniMaxBuiltinProvider(), null);
  process.env.MINIMAX_API_KEY = 'mk-test-key-123';
  assert.ok(mp.getMiniMaxBuiltinProvider(), 'precondition: a clean key seeds');
});

test('with a key, custom providers include MiniMax and the default model is minimax-m2', () => {
  process.env.MINIMAX_API_KEY = 'mk-test-key-123';
  const cm = freshManager();
  const ids = cm.getCustomProviders().map(p => p.id);
  assert.ok(ids.includes('minimax-m2'), 'seed must be visible through the accessor');
  assert.equal(cm.getDefaultModel(), 'minimax-m2');
});

test('without a key, the default is still minimax-m2 (fail loudly, never strand on gemini)', () => {
  delete process.env.MINIMAX_API_KEY;
  const cm = freshManager();
  assert.equal(cm.getDefaultModel(), 'minimax-m2');
  assert.ok(!cm.getCustomProviders().some(p => p.id === 'minimax-m2'));
});

test('fresh installs default STT to on-device local-whisper, not none', () => {
  const cm = freshManager();
  assert.equal(cm.getSttProvider(), 'local-whisper');
});

test('a pasted Natively key cannot hijack the model or STT default under the fork policy', () => {
  process.env.MINIMAX_API_KEY = 'mk-test-key-123';
  const cm = freshManager();
  cm.setNativelyApiKey('natively_sk_probe');
  assert.equal(cm.getDefaultModel(), 'minimax-m2', 'policy: natively must not become the default model');
  assert.equal(cm.getSttProvider(), 'local-whisper', 'policy: natively must not hijack STT');
});

test('a user-saved minimax-m2 entry overrides the env seed (packaged key path)', () => {
  process.env.MINIMAX_API_KEY = 'mk-test-key-123';
  const cm = freshManager();
  cm.saveCustomProvider({
    id: 'minimax-m2',
    name: 'MiniMax (stored)',
    curlCommand: "curl 'https://api.minimaxi.com/v1/chat/completions' -d '{\"messages\":[{\"content\":\"{{TEXT}}\",\"role\":\"user\"}]}'",
    responsePath: 'choices[0].message.content',
    multimodal: false,
  });
  const seeds = cm.getCustomProviders().filter(p => p.id === 'minimax-m2');
  assert.equal(seeds.length, 1, 'the seed must not duplicate the user-saved entry');
  assert.equal(seeds[0].name, 'MiniMax (stored)');
});
