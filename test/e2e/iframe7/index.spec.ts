import {test, expect} from '@playwright/test';

import {FUDGE} from '../../util/constants';
import {entryCountIs, getEntriesAndErrors} from '../../util/entries';

const PAGELOAD_DELAY = 200;
const LATE_SCRIPT_DELAY = 500;

declare global {
  interface Window {
    TTVC: {start: () => void};
  }
}

test.describe('TTVC', () => {
  test.describe('iframe re-observed by a new measurement', () => {
    test.beforeEach(async ({page}) => {
      await page.goto(`/test/iframe7?delay=${PAGELOAD_DELAY}`, {
        waitUntil: 'networkidle',
      });
      await entryCountIs(page, 1);
    });

    test('does not wait for iframe scripts that already loaded', async ({page}) => {
      await page.evaluate(() => window.TTVC.start());

      await entryCountIs(page, 2);
      const {entries} = await getEntriesAndErrors(page);

      expect(entries[1].detail.didNetworkTimeOut).toBe(false);
      expect(entries[1].duration).toBeLessThanOrEqual(FUDGE);
    });

    test('still waits for iframe scripts requested after the transition', async ({page}) => {
      await page.evaluate((delay) => {
        window.TTVC.start();

        const doc = (document.getElementById('frame') as HTMLIFrameElement).contentDocument;
        if (!doc) throw new Error('iframe document is not accessible');

        const script = doc.createElement('script');
        script.src = `/stub.js?delay=${delay}&late=1`;
        script.addEventListener('load', () => {
          (doc.getElementById('root') as HTMLElement).textContent = 'late script loaded';
        });
        doc.body.appendChild(script);
      }, LATE_SCRIPT_DELAY);

      await entryCountIs(page, 2);
      const {entries} = await getEntriesAndErrors(page);

      expect(entries[1].detail.didNetworkTimeOut).toBe(false);
      expect(entries[1].duration).toBeGreaterThanOrEqual(LATE_SCRIPT_DELAY);
      expect(entries[1].duration).toBeLessThanOrEqual(LATE_SCRIPT_DELAY + FUDGE);
    });
  });
});
