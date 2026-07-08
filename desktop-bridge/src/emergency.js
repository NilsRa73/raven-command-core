let stopped = false;
export function isStopped() { return stopped; }
export function stop() { stopped = true; }
export function resume() { stopped = false; }
export function _resetForTests() { stopped = false; }
