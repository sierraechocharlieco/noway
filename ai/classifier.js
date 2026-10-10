/* global NoWayAuto */
(() => {
  'use strict';
  const options = Object.freeze({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
  // Leave room for one card and its answer. Chrome evicts the oldest turns on overflow,
  // and those are the few-shot examples.
  const contextReserve = 1024;
  // topK 1 is greedy decoding: a card always gets the same answer, so evaluations are
  // reproducible and the setup probe cannot fail by chance. Extensions must set topK and
  // temperature together. Chrome 155 honours them although params() reports no limits,
  // so params() only signals that the legacy options exist.
  const sampling = (api) => typeof api.params === 'function' ? { topK: 1, temperature: 0 }
    // Newer builds describe sampling with a mode; builds without it ignore the option.
    : { samplingMode: 'most-predictable' };
  // Chrome normally honours AbortSignal. Race it as well so cancellation cannot
  // leave the queue or setup UI waiting on a stalled browser/model operation.
  function abortable(promise, signal, destroyLate) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      let cancelled = false;
      const abort = () => { cancelled = true; reject(new DOMException('Cancelled', 'AbortError')); };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then((value) => {
        signal.removeEventListener('abort', abort);
        if (cancelled) { try { destroyLate?.(value); } catch (_) {} }
        else resolve(value);
      }, (error) => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  class Classifier {
    constructor(api = globalThis.LanguageModel) {
      this.api = api;
      this.base = null;
      this.setupController = null;
      this.tail = Promise.resolve();
      this.queued = 0;
    }
    async availability() {
      if (!this.api?.availability) return 'unavailable';
      let timer;
      try {
        return await Promise.race([this.api.availability(options),
          new Promise((resolve) => { timer = setTimeout(() => resolve('unknown'), 5000); })]);
      } finally { clearTimeout(timer); }
    }
    async setup(onProgress) {
      this.destroy();
      const controller = this.setupController = new AbortController();
      // create() is called directly by the panel button, before a message/availability await.
      const base = await abortable(this.api.create({ ...options, ...sampling(this.api), signal: controller.signal,
        initialPrompts: NoWayAuto.initialPrompts(),
        monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)),
      }), controller.signal, (late) => late.destroy());
      if (controller.signal.aborted || this.setupController !== controller) { base.destroy(); throw new Error('Setup cancelled'); }
      this.base = base;
      const used = base.contextUsage ?? base.inputUsage;
      const limit = base.contextWindow ?? base.inputQuota;
      if (Number.isFinite(used) && Number.isFinite(limit) && limit - used < contextReserve) {
        this.destroy();
        throw new Error('The local model doesn’t have enough context for Auto.');
      }
      const probeController = new AbortController();
      const abortProbe = () => probeController.abort();
      controller.signal.addEventListener('abort', abortProbe, { once: true });
      const timer = setTimeout(() => probeController.abort(), 10000);
      let probe;
      try {
        probe = await this.classify({ eventKind: 'activate', tag: 'button', role: '', inputType: '', label: 'Search',
          language: 'en', attributes: {}, context: [], truncated: false, disabled: false, pressed: '', checked: '', expanded: '' }, probeController.signal);
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abortProbe); }
      if (controller.signal.aborted || this.setupController !== controller || this.base !== base) throw new Error('Setup cancelled');
      if (probe.decision !== 'safe') { this.destroy(); throw new Error('The local model could not complete the compatibility check.'); }
    }
    async classify(evidence, signal) {
      if (!this.base || !NoWayAuto.validateEvidence(evidence) || evidence.truncated || !/^en(?:-|$)/.test(evidence.language)) return NoWayAuto.uncertain();
      if (this.queued >= 20) return NoWayAuto.uncertain();
      this.queued++;
      const base = this.base;
      const run = async () => {
        if (signal?.aborted || this.base !== base) return NoWayAuto.uncertain();
        let clone;
        let overflowed = false;
        try {
          clone = await abortable(base.clone({ signal }), signal, (late) => late.destroy());
          // An overflow means Chrome dropped few-shot examples from this clone.
          for (const type of ['contextoverflow', 'quotaoverflow']) clone.addEventListener?.(type, () => { overflowed = true; });
          // The system prompt lists the allowed values, so the schema need not be re-sent as input.
          const raw = await abortable(clone.prompt(NoWayAuto.card(evidence), { responseConstraint: NoWayAuto.schema,
            omitResponseConstraintInput: true, signal }), signal);
          if (overflowed || raw.length > 64) return NoWayAuto.uncertain();
          return NoWayAuto.adjudicate(evidence, NoWayAuto.fromEffect(JSON.parse(raw)));
        } catch (_) {
          return NoWayAuto.uncertain();
        } finally { clone?.destroy(); }
      };
      const result = this.tail.then(run, run);
      this.tail = result.catch(() => {});
      try { return await result; } finally { this.queued--; }
    }
    destroy() {
      this.setupController?.abort();
      this.setupController = null;
      this.base?.destroy();
      this.base = null;
    }
  }
  globalThis.NoWayClassifier = Classifier;
})();
