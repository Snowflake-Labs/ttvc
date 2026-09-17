import {NetworkIdleObservable} from '../../src/networkIdleObservable';

/**
 * Every TTVC measurement re-attaches to the iframes that are already in the
 * document, so `observeIframeResources` is called many times for the same
 * frame. Resource Timing cannot be used to prove that a script has finished
 * loading, because entries are dropped once the buffer is full, and a script
 * that has already loaded will never emit another load event.
 */
describe('iframe resource observation', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const appendIframe = () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument as Document;
    // a saturated Resource Timing buffer discards entries, so a lookup for a
    // resource that has already loaded comes back empty
    Object.defineProperty(doc.defaultView, 'performance', {
      configurable: true,
      value: {getEntriesByName: () => []},
    });
    return {iframe, doc};
  };

  const setReadyState = (doc: Document, readyState: DocumentReadyState) =>
    Object.defineProperty(doc, 'readyState', {configurable: true, value: readyState});

  const appendScript = (doc: Document, src: string) => {
    const script = doc.createElement('script');
    script.src = src;
    doc.body.appendChild(script);
    return script;
  };

  const load = (el: Element) => {
    const view = el.ownerDocument?.defaultView ?? window;
    el.dispatchEvent(new view.Event('load'));
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reports busy while an iframe resource is loading', async () => {
    const {iframe, doc} = appendIframe();
    const observable = new NetworkIdleObservable();

    observable.observeIframeResources(iframe);
    const script = appendScript(doc, 'https://example.com/chunk.js');
    await flush();
    expect(observable.isIdle()).toBe(false);

    load(script);
    expect(observable.isIdle()).toBe(true);
  });

  it('tracks resources that are already pending when an unfinished document is attached', async () => {
    const {iframe, doc} = appendIframe();
    setReadyState(doc, 'loading');
    const script = appendScript(doc, 'https://example.com/chunk.js');
    const observable = new NetworkIdleObservable();

    observable.observeIframeResources(iframe);
    await flush();
    expect(observable.isIdle()).toBe(false);

    load(script);
    expect(observable.isIdle()).toBe(true);
  });

  it('does not re-queue loaded resources when the same document is observed again', async () => {
    const {iframe, doc} = appendIframe();
    setReadyState(doc, 'loading');
    const observable = new NetworkIdleObservable();

    observable.observeIframeResources(iframe);
    const script = appendScript(doc, 'https://example.com/chunk.js');
    await flush();
    load(script);
    expect(observable.isIdle()).toBe(true);

    // a new measurement re-observes every iframe that is already in the document
    observable.observeIframeResources(iframe);
    await flush();
    expect(observable.isIdle()).toBe(true);
  });

  it('does not queue resources of a document that has finished loading', async () => {
    const {iframe, doc} = appendIframe();
    setReadyState(doc, 'complete');
    appendScript(doc, 'https://example.com/chunk.js');

    // a fresh observable has never seen this script load
    const observable = new NetworkIdleObservable();
    observable.observeIframeResources(iframe);
    await flush();

    expect(observable.isIdle()).toBe(true);
  });

  it('keeps tracking new resources after the iframe is observed again', async () => {
    const {iframe, doc} = appendIframe();
    setReadyState(doc, 'loading');
    const observable = new NetworkIdleObservable();

    observable.observeIframeResources(iframe);
    observable.observeIframeResources(iframe);

    const script = appendScript(doc, 'https://example.com/late.js');
    await flush();
    expect(observable.isIdle()).toBe(false);

    load(script);
    expect(observable.isIdle()).toBe(true);
  });

  it('observes the new document after the iframe navigates', async () => {
    const {iframe} = appendIframe();
    const observable = new NetworkIdleObservable();
    observable.observeIframeResources(iframe);

    const nextDoc = document.implementation.createHTMLDocument('next');
    Object.defineProperty(iframe, 'contentDocument', {configurable: true, value: nextDoc});
    Object.defineProperty(iframe, 'contentWindow', {configurable: true, value: null});
    observable.observeIframeResources(iframe);

    const script = appendScript(nextDoc, 'https://example.com/next-chunk.js');
    await flush();
    expect(observable.isIdle()).toBe(false);

    load(script);
    expect(observable.isIdle()).toBe(true);
  });
});
