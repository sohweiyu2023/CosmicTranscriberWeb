import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Synthetic TEST-ONLY 32-byte base64url master key injected only into the
// Workers-runtime test isolate. Production Wrangler still requires a real secret.
const TEST_BYOK_MASTER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export default defineConfig({
  plugins:[cloudflareTest(async()=>({
    wrangler:{configPath:'./tests/worker/wrangler.test.jsonc'},
    miniflare:{bindings:{
      BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY,
      TEST_MIGRATIONS:await readD1Migrations('./migrations')
    }}
  }))],
  test:{
    include:['tests/worker/**/*.test.js'],
    setupFiles:['./tests/worker/apply-migrations.js'],
    testTimeout:20000
  }
});
