import {defineConfig,devices} from '@playwright/test';
import {randomBytes,randomInt} from 'node:crypto';

const e2ePort=Number(process.env.COSMIC_E2E_PORT ||= String(randomInt(20000,60000)));
const e2eToken=process.env.COSMIC_E2E_TOKEN ||= randomBytes(16).toString('hex');
const origin=`https://localhost:${e2ePort}`;

export default defineConfig({
 testDir:'./tests/e2e',fullyParallel:false,workers:process.env.CI?1:undefined,retries:process.env.CI?0:1,timeout:60000,expect:{timeout:10000},
 use:{baseURL:origin,ignoreHTTPSErrors:true,actionTimeout:15000,navigationTimeout:30000,trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{
  command:'node tests/e2e/mock-server.mjs',
  url:`${origin}/__cosmic_e2e_health?token=${e2eToken}`,
  env:{...process.env,COSMIC_E2E_PORT:String(e2ePort),COSMIC_E2E_TOKEN:e2eToken},
  reuseExistingServer:false,ignoreHTTPSErrors:true,timeout:30000,stdout:'pipe',stderr:'pipe'
 },
 projects:[
  {name:'chromium',use:{...devices['Desktop Chrome']}},
  {name:'firefox',use:{...devices['Desktop Firefox']}},
  {name:'webkit',use:{...devices['Desktop Safari']}},
  {name:'chrome',use:{...devices['Desktop Chrome'],channel:'chrome'}},
  {name:'edge',use:{...devices['Desktop Edge'],channel:'msedge'}},
  {name:'mobile-safari',use:{...devices['iPad Pro 11']}}
 ]
});
