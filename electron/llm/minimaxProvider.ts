/**
 * Built-in MiniMax provider (meeting-assistant fork).
 *
 * Registers MiniMax's OpenAI-compatible chat-completions endpoint as the
 * default custom provider, activated purely by env — set MINIMAX_API_KEY in
 * .env and the app speaks MiniMax with zero clicks. Users can still add more
 * custom providers in Settings; a user-saved entry with id 'minimax-m2'
 * overrides this seed.
 *
 * Vision is declared OFF: MiniMax-M2 is text-only in this API shape, and
 * on-screen text is handled locally by the Tesseract OcrProvider before it
 * ever reaches an LLM prompt.
 */

import type { CustomProvider } from '../services/CredentialsManager';

export const MINIMAX_PROVIDER_ID = 'minimax-m2';

/**
 * The fork policy: MiniMax-only unless the escape hatch is explicitly set.
 * Read from the environment on every call so tests can toggle it.
 */
export function miniMaxOnlyPolicy(): boolean {
    return process.env.MEETING_ASSISTANT_ALLOW_LEGACY_PROVIDERS !== '1';
}

export function getMiniMaxApiKey(): string | null {
    const key = (process.env.MINIMAX_API_KEY || '').trim();
    return key.length > 0 ? key : null;
}

/** Returns the seeded provider, or null when no key is configured. */
export function getMiniMaxBuiltinProvider(): CustomProvider | null {
    const apiKey = getMiniMaxApiKey();
    if (!apiKey) return null;

    // The key/model/baseURL are interpolated into quoted cURL args. They never
    // reach a shell (curl2Json → parsed object → axios), so a quote cannot
    // inject a command — but it silently corrupts the parsed template. Refuse
    // the seed loudly instead of failing later as "Invalid cURL syntax".
    if (/[\'"\r\n]/.test(apiKey) || /[\'"\r\n]/.test((process.env.MINIMAX_MODEL || '')) || /['"\s]/.test(process.env.MINIMAX_BASE_URL || '')) {
        console.error('[MiniMaxProvider] MINIMAX_API_KEY / MINIMAX_MODEL / MINIMAX_BASE_URL contains a quote or whitespace character — refusing to seed MiniMax.');
        return null;
    }

    const baseURL = (process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1').trim().replace(/\/+$/, '');
    const model = (process.env.MINIMAX_MODEL || 'MiniMax-M2').trim();

    // curl2Json parses -d into an object; applyCurlVariables substitutes
    // {{TEXT}}/{{IMAGE_BASE64}} raw and axios serializes on the way out.
    const curlCommand =
        `curl '${baseURL}/chat/completions' ` +
        `-H 'Content-Type: application/json' ` +
        `-H 'Authorization: Bearer ${apiKey}' ` +
        `-d '{"model":"${model}","messages":[{"role":"user","content":"{{TEXT}}"}]}'`;

    return {
        id: MINIMAX_PROVIDER_ID,
        name: 'MiniMax M2',
        curlCommand,
        multimodal: false,
        responsePath: 'choices[0].message.content',
    };
}

/**
 * Merge the built-in seed into the user's saved list.
 * User-saved entry with the same id wins (settings are authoritative).
 */
export function withMiniMaxBuiltin(userProviders: CustomProvider[]): CustomProvider[] {
    const builtin = getMiniMaxBuiltinProvider();
    if (!builtin) return userProviders;
    if (userProviders.some(p => p.id === builtin.id)) return userProviders;
    return [builtin, ...userProviders];
}
