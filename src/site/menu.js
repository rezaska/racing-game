// The main menu.
//
// It lives in the hero, over the game running in attract mode, and it owns the
// keyboard while it is open. That last part matters: the race used to start on
// any steering input, which is a fine arcade touch with no menu and impossible
// with one -- the first press of an arrow key would launch the race instead of
// moving the cursor.

const ACTIONS = ['race', 'course', 'controls', 'sound'];

export function mountMenu(root, handlers) {
  const items = [...root.querySelectorAll('[data-action]')];
  const panel = root.querySelector('[data-controls]');
  let index = 0;

  const paint = () => {
    items.forEach((el, i) => el.classList.toggle('on', i === index));
  };

  const move = (d) => {
    index = (index + d + items.length) % items.length;
    paint();
    // Move focus with the cursor so a screen reader follows, but keep the page
    // still -- the menu sits over a live 3D scene and must not scroll it.
    items[index].focus({ preventScroll: true });
  };

  // Controls are a sub-screen that REPLACES the menu rather than appearing
  // below it. Stacked, the two together were 822px tall against a 713px laptop
  // viewport, and the bindings fell off the bottom of the screen.
  const showControls = (on) => {
    root.classList.toggle('showing-controls', on);
    panel.hidden = !on;
  };
  const controlsOpen = () => !panel.hidden;

  const activate = (action) => {
    if (action === 'race') handlers.onRace();
    else if (action === 'course') handlers.onNewCourse();
    else if (action === 'controls') showControls(true);
    else if (action === 'sound') setSound(handlers.onToggleSound());
  };

  const setSound = (on) => {
    const el = root.querySelector('[data-sound]');
    if (el) el.textContent = on ? 'on' : 'off';
  };

  items.forEach((el, i) => {
    el.addEventListener('click', () => { index = i; paint(); activate(el.dataset.action); });
    el.addEventListener('pointerenter', () => { index = i; paint(); });
  });

  // Capture phase, so the menu sees arrow keys before the game's Input does and
  // can stop them scrolling the page behind it.
  window.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (controlsOpen()) {
      // Any of the three ways out. Escape is handled here so it closes the
      // sub-screen instead of falling through to the game's own Escape.
      if (['Escape', 'Enter', 'Space'].includes(e.code)) {
        showControls(false);
        items[index].focus({ preventScroll: true });
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { move(-1); e.preventDefault(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { move(1); e.preventDefault(); }
    else if (e.code === 'Enter' || e.code === 'Space') {
      activate(items[index].dataset.action);
      e.preventDefault();
    }
  }, true);

  const isOpen = () => !document.body.classList.contains('playing') &&
    // Scrolled down to read the story: the menu is off-screen, so the keyboard
    // belongs to the page.
    window.scrollY < window.innerHeight * 0.5;

  panel.querySelector('[data-back]')?.addEventListener('click', () => showControls(false));

  paint();
  return {
    closeControls() { showControls(false); },
    setSeed(seed) {
      const el = root.querySelector('[data-seed]');
      if (el) el.textContent = String(seed);
    },
    setSound,
    focus() { index = 0; paint(); },
  };
}

export { ACTIONS };
