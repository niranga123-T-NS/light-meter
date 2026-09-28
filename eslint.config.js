// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions run on Deno (npm: specifiers), checked by the Supabase CLI
    ignores: ['dist/*', 'supabase/functions/*/index.ts', 'supabase/functions/_shared/http.ts'],
  },
]);
