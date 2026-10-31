import {defineConfig,devices} from '@playwright/test';
// The launcher owns the bound TLS listener before Playwright starts.
const e2ePort=Number(process.env.COSMIC_E2E_PORT);
const e2eToken=String(process.env.COSMIC_E2E_TOKEN||'');
if(!Number.isInteger(e2ePort)||e2ePort<1024||e2ePort>65535||!/^[0-9a-f]{32}$/.test(e2eToken)||!/^[1-9]\d*$/.test(process.env.COSMIC_E2E_OWNED_SERVER||''))throw new Error('Use the owned-server npm E2E launcher.');
const origin=`https://localhost:${e2ePort}`;

export default defineConfig({
 testDir:'./tests/e2e',fullyParallel:false,workers:process.env.CI?1:undefined,retries:process.env.CI?0:1,timeout:60000,expect:{timeout:10000},
 use:{baseURL:origin,ignoreHTTPSErrors:true,actionTimeout:15000,navigationTimeout:30000,trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[
  {name:'chromium',use:{...devices['Desktop Chrome']}},
  {name:'firefox',use:{...devices['Desktop Firefox']}},
  {name:'webkit',use:{...devices['Desktop Safari']}},
  {name:'chrome',use:{...devices['Desktop Chrome'],channel:'chrome'}},
  {name:'edge',use:{...devices['Desktop Edge'],channel:'msedge'}},
  {name:'mobile-safari',use:{...devices['iPad Pro 11']}}
 ]
});
