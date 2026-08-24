export type TtvcOptions = {
  debug?: boolean;
  idleTimeout?: number;
  networkTimeout?: number;
  isValidDomMutation?: (mutation: MutationRecord, entry: IntersectionObserverEntry) => boolean;
};

/** ttvc configuration values set during initialization */
export const CONFIG: {
  DEBUG: boolean;
  IDLE_TIMEOUT: number;
  NETWORK_TIMEOUT: number;
  IS_VALID_DOM_MUTATION?: (mutation: MutationRecord, entry: IntersectionObserverEntry) => boolean;
} = {
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
   * Called with each in-viewport DOM mutation and the IntersectionObserverEntry
   * for the element it affected, before the mutation is considered by the TTVC
   * calculation. Return false to exclude a mutation that shouldn't count
   * towards visual completeness.
   */
  IS_VALID_DOM_MUTATION: undefined,
};

export const setConfig = (options?: TtvcOptions) => {
  if (options?.debug) CONFIG.DEBUG = options.debug;
  if (options?.idleTimeout) CONFIG.IDLE_TIMEOUT = options.idleTimeout;
  if (options?.networkTimeout) CONFIG.NETWORK_TIMEOUT = options.networkTimeout;
  if (options?.isValidDomMutation) CONFIG.IS_VALID_DOM_MUTATION = options.isValidDomMutation;
};
