import {test, expect} from '@playwright/test';

import {getEntriesAndErrors} from '../../util/entries';

const PAGELOAD_DELAY = 200;

test.describe('TTVC', () => {
  test('an inaccessible iframe does not throw and does not block TTVC', async ({page}) => {
    await page.goto(`/test/iframe5?delay=${PAGELOAD_DELAY}`, {
      waitUntil: 'networkidle',
    });

    const {entries, errors} = await getEntriesAndErrors(page);

    expect(errors.length).toBe(0);
    expect(entries.length).toBe(1);
    // We didn't crash and we still produced a measurement
  });
});


