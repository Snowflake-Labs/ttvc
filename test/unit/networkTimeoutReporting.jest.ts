import {decrementAjaxCount, incrementAjaxCount} from '../../src';
import {getNetworkIdleObservable} from '../../src/networkIdleObservable';
import {requestAllIdleCallback} from '../../src/requestAllIdleCallback';
import {CONFIG} from '../../src/util/constants';
import {FUDGE} from '../util/constants';

const wait = async (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * A stalled request is reported to the measurement it stalled. Measurements
 * overlap whenever one is restarted before the previous one resolved, and each
 * of them has to learn about the timeout independently.
 */
describe('network timeout reporting', () => {
  const NETWORK_TIMEOUT = 100;
  const settle = () => wait(NETWORK_TIMEOUT + CONFIG.IDLE_TIMEOUT + FUDGE);
  const waitForIdle = (callback: (didNetworkTimeOut: boolean) => void) =>
    requestAllIdleCallback(callback, getNetworkIdleObservable().networkTimeoutCount());

  beforeEach(() => {
    CONFIG.NETWORK_TIMEOUT = NETWORK_TIMEOUT;
  });

  afterEach(() => {
    CONFIG.NETWORK_TIMEOUT = 60000;
  });

  it('reports a stalled request to the measurement waiting for it', async () => {
    const callback = jest.fn();

    incrementAjaxCount();
    waitForIdle(callback);
    await settle();

    expect(callback).toHaveBeenCalledWith(true);
  });

  it('reports a stalled request to every measurement waiting for it', async () => {
    const restarted = jest.fn();
    const current = jest.fn();

    incrementAjaxCount();
    // a measurement that is replaced while the request is still pending
    waitForIdle(restarted);
    waitForIdle(current);
    await settle();

    expect(restarted).toHaveBeenCalledWith(true);
    expect(current).toHaveBeenCalledWith(true);
  });

  it('does not report a timeout to a measurement that started after it', async () => {
    incrementAjaxCount();
    waitForIdle(jest.fn());
    await settle();

    const callback = jest.fn();
    waitForIdle(callback);
    await wait(CONFIG.IDLE_TIMEOUT + FUDGE);

    expect(callback).toHaveBeenCalledWith(false);
  });

  it('does not report a timeout when requests resolve normally', async () => {
    const callback = jest.fn();

    incrementAjaxCount();
    waitForIdle(callback);
    decrementAjaxCount();
    await wait(CONFIG.IDLE_TIMEOUT + FUDGE);

    expect(callback).toHaveBeenCalledWith(false);
  });
});
