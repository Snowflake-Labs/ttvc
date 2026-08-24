import {InViewportMutationObserver} from '../../src/inViewportMutationObserver';
import {CONFIG} from '../../src/util/constants';

/**
 * jsdom does not implement IntersectionObserver. This fake reports every
 * observed target as intersecting, asynchronously (mirroring the real API),
 * so tests can focus on mutation filtering rather than intersection timing.
 */
class FakeIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    queueMicrotask(() => {
      const entry: IntersectionObserverEntry = {
        isIntersecting: true,
        target,
        boundingClientRect: target.getBoundingClientRect(),
      } as IntersectionObserverEntry;
      this.callback([entry], this);
    });
  }

  unobserve() {
    // no-op
  }

  disconnect() {
    // no-op
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('InViewportMutationObserver', () => {
  let originalIntersectionObserver: typeof IntersectionObserver;
  let callback: jest.Mock;
  let observer: InViewportMutationObserver;

  beforeAll(() => {
    originalIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterAll(() => {
    window.IntersectionObserver = originalIntersectionObserver;
  });

  beforeEach(() => {
    callback = jest.fn();
    observer = new InViewportMutationObserver(callback);
    observer.observe(document.body);
  });

  afterEach(() => {
    observer.disconnect();
    CONFIG.IS_VALID_DOM_MUTATION = undefined;
  });

  const mutate = async () => {
    document.body.appendChild(document.createElement('div'));
    await flushMicrotasks();
  };

  it('reports mutations by default', async () => {
    await mutate();
    expect(callback).toHaveBeenCalled();
  });

  it('excludes mutations rejected by isValidDomMutation', async () => {
    CONFIG.IS_VALID_DOM_MUTATION = () => false;
    await mutate();
    expect(callback).not.toHaveBeenCalled();
  });

  it('includes mutations accepted by isValidDomMutation', async () => {
    CONFIG.IS_VALID_DOM_MUTATION = () => true;
    await mutate();
    expect(callback).toHaveBeenCalled();
  });

  it('is called once per mutation, with the record and the entry', async () => {
    const isValidDomMutation = jest.fn().mockReturnValue(true);
    CONFIG.IS_VALID_DOM_MUTATION = isValidDomMutation;
    await mutate();

    expect(isValidDomMutation).toHaveBeenCalledTimes(1);
    expect(isValidDomMutation).toHaveBeenCalledWith(
      expect.objectContaining({type: 'childList'}),
      expect.objectContaining({isIntersecting: true})
    );
  });

  it('accepts the mutation and still cleans up when isValidDomMutation throws', async () => {
    const unobserveSpy = jest.spyOn(FakeIntersectionObserver.prototype, 'unobserve');
    CONFIG.IS_VALID_DOM_MUTATION = () => {
      throw new Error('predicate blew up');
    };

    await mutate();

    // the throw was swallowed and the mutation accepted
    expect(callback).toHaveBeenCalled();
    // ...and execution continued past the throw site, so the element was
    // unobserved rather than leaked
    expect(unobserveSpy).toHaveBeenCalled();

    unobserveSpy.mockRestore();
  });

  it('treats a missing return value as valid rather than rejecting', async () => {
    CONFIG.IS_VALID_DOM_MUTATION = (() => undefined) as unknown as NonNullable<
      typeof CONFIG.IS_VALID_DOM_MUTATION
    >;
    await mutate();
    expect(callback).toHaveBeenCalled();
  });
});
