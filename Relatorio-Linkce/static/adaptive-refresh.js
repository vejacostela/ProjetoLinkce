/* Shared refresh control for management and the offline field application. */
(function (root) {
  'use strict';
  function create({run, interval = 30000, enabled = () => true, onState = () => {}}) {
    let started = false, timer = null, inFlight = null, failures = 0, lastCompleted = 0;
    const cadence = () => Math.max(0, Number(typeof interval === 'function' ? interval() : interval) || 0);
    const state = value => onState(value, {interval: cadence(), failures});
    const clear = () => { clearTimeout(timer); timer = null; };
    function pauseReason(force = false) {
      if (!started) return 'stopped';
      if (root.navigator.onLine === false) return 'offline';
      if (root.document.hidden) return 'hidden';
      if (!force && (!cadence() || !enabled())) return 'paused';
      return '';
    }
    function schedule(delay) {
      clear();
      const reason = pauseReason();
      if (reason) {
        state(reason);
        // Dialogs/inputs can pause a visible screen; hidden/offline screens need no timer.
        if (reason === 'paused' && started && cadence()) timer = setTimeout(() => schedule(0), 5000);
        return;
      }
      if (inFlight) return;
      const next = delay ?? Math.min(180000, cadence() * 2 ** Math.min(failures, 3));
      state(failures ? 'retrying' : 'waiting');
      timer = setTimeout(() => refresh(), next);
    }
    function refresh({force = false} = {}) {
      if (inFlight) return inFlight;
      const reason = pauseReason(force);
      if (reason) { schedule(); return Promise.resolve(false); }
      clear(); state('updating');
      inFlight = Promise.resolve().then(run).then(result => {
        failures = result === false ? failures + 1 : 0;
        return result !== false;
      }, () => { failures++; return false; }).finally(() => {
        lastCompleted = Date.now(); inFlight = null; schedule();
      });
      return inFlight;
    }
    function resume(event) {
      if (!started) return;
      if (event?.type === 'online') { failures = 0; schedule(0); }
      else schedule(Math.max(0, cadence() - (Date.now() - lastCompleted)));
    }
    root.document.addEventListener('visibilitychange', resume);
    root.addEventListener('online', resume);
    root.addEventListener('offline', resume);
    return {
      start({immediate = true} = {}) { started = true; schedule(immediate ? 0 : cadence()); },
      stop() { started = false; clear(); state('stopped'); },
      refresh,
      reschedule() { schedule(); },
      dispose() {
        started = false; clear();
        root.document.removeEventListener('visibilitychange', resume);
        root.removeEventListener('online', resume);
        root.removeEventListener('offline', resume);
      },
    };
  }
  root.CampoRefresh = {create};
})(window);
