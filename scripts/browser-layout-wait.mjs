// Poll synchronously: backgrounded headless tabs can stop delivering animation frames.
export const layoutSampleExpression = `(() => {
  const boxes = [...document.querySelectorAll('.hs-win,.hs-chat,.hs-head,.hs-channel-dialog,.hs-channel-dialog-footer,#workspace-browser-panel,.wss-main')].map(node => {
    const {x,y,width,height} = node.getBoundingClientRect();
    return [x,y,width,height];
  });
  return {
    ready: document.readyState !== 'loading',
    visibility: document.visibilityState,
    animations: document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length,
    geometry: JSON.stringify([innerWidth,innerHeight,...boxes]),
  };
})()`;

export async function waitForLayout(sample, {
  label = 'layout', deadlineMs = 3000, pollMs = 25,
  now = () => performance.now(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const started = now();
  let previous, stable = 0, last;
  do {
    last = await sample(layoutSampleExpression);
    if (last.ready && last.animations === 0) {
      stable = last.geometry === previous ? stable + 1 : 0;
      if (stable >= 2) return last;
      previous = last.geometry;
    } else {
      previous = undefined; stable = 0;
    }
    await pause(pollMs);
  } while (now() - started < deadlineMs);
  throw new Error(`${label}: layout did not settle within ${deadlineMs}ms; ${JSON.stringify(last)}`);
}
