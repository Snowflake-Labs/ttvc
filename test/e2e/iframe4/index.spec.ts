import {test, expect} from '@playwright/test';

import {getEntriesAndErrors, entryCountIs} from '../../util/entries';
import { FUDGE } from '../../util/constants';

const PAGELOAD_DELAY = 200;
const AJAX_DELAY = 500;

test.describe('TTVC', () => {
  test('an iframe using srcdoc and internal mutations contributes to TTVC', async ({page}) => {
    await page.goto(`/test/iframe4?delay=${PAGELOAD_DELAY}`, {
      waitUntil: 'networkidle',
    });

    await entryCountIs(page, 1);
    const {entries} = await getEntriesAndErrors(page);

    expect(entries.length).toBe(1);

    expect(entries[0].duration).toBeGreaterThanOrEqual(PAGELOAD_DELAY + AJAX_DELAY);
    expect(entries[0].duration).toBeLessThanOrEqual(PAGELOAD_DELAY + AJAX_DELAY + FUDGE);
  });
});


