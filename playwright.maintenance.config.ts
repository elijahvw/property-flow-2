import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/ui',testMatch:'maintenance.spec.ts',use:{baseURL:'http://127.0.0.1:5017'},workers:1});
