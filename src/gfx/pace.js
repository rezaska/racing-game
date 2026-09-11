// Frame pacing.
//
// The only correct way to present at a fixed rate is to render on every Nth
// vsync. The obvious alternative -- `if (now - last < 1000 / 60) return;` --
// is worse than no cap at all: the threshold beats against the display's own
// cadence, so frames land 1, 2, 1, 2 vsyncs apart and the result is exactly the
// uneven pacing the cap was meant to prevent.
//
// N is therefore an integer divisor of the refresh rate, and the rate actually
// presented is refresh / N, which only equals the target when the refresh is a
// multiple of it. That is a feature: at 144 Hz this presents an even 72 rather
// than a lurching 60.

// The largest divisor whose presented rate is still at least the target.
//
// floor, not round: at 90 Hz, round(1.5) = 2 would present 45 fps, half the
// target. floor never goes under it. The 1% slack is for a display that
// measures a hair below nominal -- 119.8 Hz has to divide by 2 -- and it is
// written as a fraction of the target rather than added to the ratio, because
// a fixed offset on the ratio means something different at every refresh rate:
// +0.1 tolerates 5% at 120 Hz, which would cap a 114 Hz display to 57 fps.
export function paceDivisor(hz, target) {
  if (!(target > 0) || !(hz > 0)) return 1;
  return Math.max(1, Math.floor(hz / (target * 0.99)));
}

// Refresh rate from observed vsync intervals. Median, not mean: a single long
// frame from a garbage collection or a tab switch would drag a mean far enough
// to change the divisor, and the divisor changing mid-race is itself a hitch.
export function refreshHz(intervalsMs) {
  const ok = intervalsMs.filter((d) => d > 1 && d < 100).sort((a, b) => a - b);
  if (ok.length < 8) return 0;
  return 1000 / ok[ok.length >> 1];
}
