import {
    defineConfig,
    devices
} from '@playwright/test';

const chromeChannel = process.env.LAYER_PLAYWRIGHT_CHROME_CHANNEL || 'chrome';
const edgeProjectEnabled = process.env.LAYER_PLAYWRIGHT_EDGE_ENABLED !== 'false';
const browserProjects = [
    {
        name: 'chrome',
        use: {
            browserName: 'chromium',
            channel: chromeChannel
        }
    },
    {
        name: 'firefox',
        use: {
            ...devices['Desktop Firefox']
        }
    },
    {
        name: 'safari-webkit',
        use: {
            ...devices['Desktop Safari']
        }
    },
    {
        name: 'ios-viewport-webkit',
        testMatch: '**/viewport*.pw.js',
        use: {
            ...devices['iPhone 13']
        }
    },
    {
        name: 'ipad-viewport-webkit',
        testMatch: '**/viewport*.pw.js',
        use: {
            ...devices['iPad (gen 7)']
        }
    }
];

//Keeping the real Edge gate by default while Linux workflows use bundled engines only.
if (edgeProjectEnabled) {
    browserProjects.splice(1, 0, {
        name: 'edge',
        use: {
            browserName: 'chromium',
            channel: 'msedge'
        }
    });

}

export default defineConfig({
    testDir: './browser-tests',
    testMatch: '**/*.pw.js',
    fullyParallel: true,
    forbidOnly: true,
    retries: 1,
    workers: 4,
    reporter: 'list',
    timeout: 30000,
    expect: {
        timeout: 5000
    },
    use: {
        baseURL: 'http://127.0.0.1:5330',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/browser-fixture-server.js',
        url: 'http://127.0.0.1:5330/health',
        reuseExistingServer: false,
        timeout: 90000
    },
    projects: browserProjects
});
