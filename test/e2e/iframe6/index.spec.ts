import {test, expect} from '@playwright/test';

import {FUDGE} from '../../util/constants';
import {getEntriesAndErrors} from '../../util/entries';

const PAGELOAD_DELAY = 200;
const IFRAME_AJAX_DELAY = 300;
const IMAGE_DELAY = 400;

test.describe('TTVC', () => {
  test('iframe image load after ajax contributes to TTVC', async ({page}) => {
    await page.goto(`/test/iframe6?delay=${PAGELOAD_DELAY}`, {
      waitUntil: 'networkidle',
    });

    const {entries} = await getEntriesAndErrors(page);

    expect(entries.length).toBe(1);
    const expected = PAGELOAD_DELAY + IFRAME_AJAX_DELAY + IMAGE_DELAY;
    expect(entries[0].duration).toBeGreaterThanOrEqual(expected);
    expect(entries[0].duration).toBeLessThanOrEqual(expected + FUDGE);
  });
});


