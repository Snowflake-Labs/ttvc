import type {TimestampedMutationRecord} from '../inViewportMutationObserver';

/**
 * Consulted before a mutation is accepted as a visible change. Return false
 * to prevent it from becoming the measurement's last visible change — the
 * previously accepted mutation is kept instead, so the measurement is
 * corrected rather than discarded.
 */
export type IsValidDomChangePredicate = (
  mutation: TimestampedMutationRecord,
  entry: IntersectionObserverEntry
) => boolean;

export type TtvcOptions = {
  debug?: boolean;
  idleTimeout?: number;
  networkTimeout?: number;
  isValidDomChange?: IsValidDomChangePredicate;
};

/** ttvc configuration values set during initialization */
export const CONFIG = {
  /** Decide whether to log debug messages. */
  DEBUG: false,

  /** A duration in ms to wait before declaring the page completely idle. */
  IDLE_TIMEOUT: 200,

  /**
   * A duration in ms to wait before assuming that a single network request
   * was not instrumented correctly.
   *
   * If NETWORK_TIMEOUT is set to 0, disable this feature.
   */
  NETWORK_TIMEOUT: 60000,

  /**
   * Optional predicate consulted before a mutation is accepted as a visible
   * change. When unset, all in-viewport mutations are accepted.
   */
  IS_VALID_DOM_CHANGE: undefined as IsValidDomChangePredicate | undefined,
};

export const setConfig = (options?: TtvcOptions) => {
  if (options?.debug) CONFIG.DEBUG = options.debug;
  if (options?.idleTimeout) CONFIG.IDLE_TIMEOUT = options.idleTimeout;
  if (options?.networkTimeout) CONFIG.NETWORK_TIMEOUT = options.networkTimeout;
  if (options?.isValidDomChange) CONFIG.IS_VALID_DOM_CHANGE = options.isValidDomChange;
};
