import {test, expect} from '@playwright/test';

import {entryCountIs, getEntriesAndErrors} from '../../util/entries';

const PAGELOAD_DELAY = 200;
const RESTART_DELAY = 300;

declare global {
  interface Window {
    TTVC: {start: () => void};
  }
}

test.describe('TTVC', () => {
  test.describe('a resource that never resolves', () => {
    test.beforeEach(async ({page}) => {
      await page.goto(`/test/error7?delay=${PAGELOAD_DELAY}`, {
        waitUntil: 'load',
      });
    });

    test('reports the network timeout', async ({page}) => {
      await entryCountIs(page, 1, 8000);
      const {entries} = await getEntriesAndErrors(page);

      expect(entries[0].detail.navigationType).toBe('navigate');
      expect(entries[0].detail.didNetworkTimeOut).toBe(true);
    });

    test('reports the network timeout to a measurement restarted during the stall', async ({
      page,
    }) => {
      await page.waitForTimeout(RESTART_DELAY);
      await page.evaluate(() => window.TTVC.start());

      await entryCountIs(page, 1, 8000);
      const {entries, errors} = await getEntriesAndErrors(page);

      // the initial measurement is replaced by the restarted one
      expect(errors.map((error) => error.cancellationReason)).toEqual(['NEW_MEASUREMENT']);

      expect(entries[0].detail.navigationType).toBe('script');
      expect(entries[0].detail.didNetworkTimeOut).toBe(true);
    });
  });
});
