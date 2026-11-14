/**
 * When a check runs.
 *
 * The interval is a constant rather than a setting: the refresh control covers
 * the impatient case, and every extra field is a chance to misconfigure. The
 * interval only advances while the interface is open, so opening the interface
 * always checks.
 * @module dsh-plugin-updater/schedule
 */

/** Interval between automatic checks, in milliseconds. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * A check scheduler that runs one cycle at a time.
 */
export class CheckScheduler {
  /**
   * @param {{
   *   check: () => Promise<object>,
   *   intervalMs?: number,
   *   onStateChange?: (state: object) => void
   * }} options The check to run and where to report state.
   */
  constructor(options) {
    this.check = options.check
    this.intervalMs = options.intervalMs ?? CHECK_INTERVAL_MS
    this.onStateChange = options.onStateChange
    this.running = undefined
    this.timer = undefined
    this.lastResult = undefined
    this.lastFailure = undefined
  }

  /**
   * Start a check, unless one is already running.
   *
   * Coalescing rather than queueing: a second request while a cycle runs would
   * produce the same answer twice.
   * @param {'startup'|'interval'|'manual'} trigger What asked for the check.
   * @returns {Promise<object|null>} The result, or null when one was already running.
   */
  async run(trigger) {
    if (this.running !== undefined) return null
    this.onStateChange?.({ running: true, trigger, ...this.lastResult === undefined ? {} : { lastResult: this.lastResult } })
    this.running = (async () => {
      try {
        const result = await this.check()
        this.lastResult = result
        this.lastFailure = undefined
        this.onStateChange?.({ running: false, result, current: true })
        return result
      } catch (error) {
        // A failed cycle keeps the previous result and marks it not current:
        // reporting zero updates on a network failure would read as "all good".
        this.lastFailure = error instanceof Error ? error.message : String(error)
        this.onStateChange?.({
          running: false, failure: this.lastFailure, current: false,
          ...this.lastResult === undefined ? {} : { lastResult: this.lastResult },
        })
        throw error
      } finally {
        this.running = undefined
      }
    })()
    return this.running
  }

  /**
   * Arm the interval timer.
   * @returns {void}
   */
  start() {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => {
      void this.run('interval').catch(() => {
        // A failed interval run is already reported through onStateChange.
      })
    }, this.intervalMs)
    // Timers must not hold the process open.
    this.timer.unref?.()
  }

  /**
   * Disarm the interval timer.
   * @returns {void}
   */
  stop() {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Wait for the running cycle, when one is in progress.
   *
   * A caller that needs the next result to include a cycle already under way
   * awaits this instead of starting a second one, which the scheduler refuses.
   * @returns {Promise<void>} Resolves after the cycle settles, failure included.
   */
  async whenIdle() {
    if (this.running === undefined) return
    try {
      await this.running
    } catch {
      // The failure is reported through onStateChange; a caller waiting for the
      // cycle to finish has nothing to add.
    }
  }

  /**
   * Whether a cycle is in progress.
   * @returns {boolean} True while running.
   */
  isRunning() {
    return this.running !== undefined
  }
}
