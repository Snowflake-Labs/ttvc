import {NetworkIdleObservable} from '../../src/networkIdleObservable';
import {CONFIG} from '../../src/util/constants';

const wait = async (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** A minimal Resource Timing entry; only `name` and `responseEnd` are read. */
const resourceEntry = (name: string, responseEnd: number): PerformanceEntry =>
  ({
    name,
    entryType: 'resource',
    startTime: 0,
    duration: responseEnd,
    responseEnd,
    toJSON: () => ({}),
  } as unknown as PerformanceEntry);

/**
 * jsdom's Performance implements no `getEntriesByName`, so it cannot be spied on --
 * it has to be installed as an own property and deleted again afterwards.
 */
const stubGetEntriesByName = (impl: (name: string) => PerformanceEntry[]) => {
  Object.defineProperty(performance, 'getEntriesByName', {
    value: impl,
    configurable: true,
    writable: true,
  });
};

const removeGetEntriesByNameStub = () => {
  delete (performance as Partial<Performance>).getEntriesByName;
};

/** Simulate a resource finishing, the way the browser would. */
const fireLoad = (element: Element) => {
  const loadEvent = new Event('load', {bubbles: true});
  Object.defineProperty(loadEvent, 'target', {value: element});
  document.dispatchEvent(loadEvent);
};

describe('ResourceLoadingIdleObservable - last resource tracking', () => {
  let networkIdleObservable: NetworkIdleObservable;
  let unsubscribe: () => void;

  beforeEach(() => {
    // disable cleanup timeout to avoid side-effects in tests
    CONFIG.NETWORK_TIMEOUT = 0;
    networkIdleObservable = new NetworkIdleObservable();
    unsubscribe = networkIdleObservable.subscribe(jest.fn());

    // trigger initialization of MutationObserver and event listeners
    window.dispatchEvent(new Event('load'));
  });

  afterEach(() => {
    unsubscribe();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    removeGetEntriesByNameStub();
  });

  it('reports no resource until one has resolved', () => {
    expect(networkIdleObservable.getLastResource()).toBeUndefined();
  });

  it('records the resource whose load released network idle', async () => {
    const script = document.createElement('script');
    script.src = 'https://localhost/main.js';
    document.head.appendChild(script);
    await wait(0);

    expect(networkIdleObservable.isIdle()).toBe(false);

    fireLoad(script);
    await wait(0);

    expect(networkIdleObservable.isIdle()).toBe(true);
    expect(networkIdleObservable.getLastResource()).toEqual(
      expect.objectContaining({url: 'https://localhost/main.js', tagName: 'SCRIPT'})
    );
  });

  it('records an error the same way a load is recorded', async () => {
    const img = document.createElement('img');
    img.src = 'https://localhost/missing.png';
    document.body.appendChild(img);
    await wait(0);

    const errorEvent = new Event('error', {bubbles: true});
    Object.defineProperty(errorEvent, 'target', {value: img});
    document.dispatchEvent(errorEvent);
    await wait(0);

    expect(networkIdleObservable.getLastResource()).toEqual(
      expect.objectContaining({tagName: 'IMG'})
    );
  });

  it('resolves responseEnd from Resource Timing when an entry exists', async () => {
    const url = 'https://localhost/styles.css';
    stubGetEntriesByName((name) => (name === url ? [resourceEntry(url, 1234)] : []));

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
    await wait(0);

    fireLoad(link);
    await wait(0);

    expect(networkIdleObservable.getLastResource()?.responseEnd).toBe(1234);
  });

  it('omits responseEnd when the entry has been evicted from the buffer', async () => {
    stubGetEntriesByName(() => []);

    const script = document.createElement('script');
    script.src = 'https://localhost/evicted.js';
    document.head.appendChild(script);
    await wait(0);

    fireLoad(script);
    await wait(0);

    const lastResource = networkIdleObservable.getLastResource();
    expect(lastResource).toBeDefined();
    expect(lastResource?.responseEnd).toBeUndefined();
    // the observed handler timestamp is always available as a fallback
    expect(typeof lastResource?.timestamp).toBe('number');
  });

  it('names the resource that emptied the set, not an earlier one', async () => {
    const first = document.createElement('script');
    first.src = 'https://localhost/first.js';
    const second = document.createElement('script');
    second.src = 'https://localhost/second.js';
    document.head.append(first, second);
    await wait(0);

    // `first` resolves while `second` is still pending, so idle is not released yet
    fireLoad(first);
    await wait(0);
    expect(networkIdleObservable.isIdle()).toBe(false);

    fireLoad(second);
    await wait(0);

    expect(networkIdleObservable.isIdle()).toBe(true);
    expect(networkIdleObservable.getLastResource()?.url).toBe('https://localhost/second.js');
  });

  it('ignores a load event for an element that was never pending', async () => {
    const script = document.createElement('script');
    script.src = 'https://localhost/tracked.js';
    document.head.appendChild(script);
    await wait(0);
    fireLoad(script);
    await wait(0);

    // an inline script is never added to pendingResources, so it must not overwrite
    // the record of what actually released idle
    const inline = document.createElement('script');
    inline.textContent = 'void 0;';
    document.head.appendChild(inline);
    await wait(0);
    fireLoad(inline);
    await wait(0);

    expect(networkIdleObservable.getLastResource()?.url).toBe('https://localhost/tracked.js');
  });
});
