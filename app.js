(() => {
  const params = new URLSearchParams(location.search);
  const guest = params.get('to');
  if (guest) document.querySelectorAll('[data-name]').forEach(n => (n.textContent = guest));

  // Set to the path of a real photo of Coffeebook (e.g. 'coffeebook.jpg') once you have one.
  // While empty, a clearly labelled placeholder is shown instead.
  const VENUE_PHOTO = 'coffeebook.jpg';
  const VENUE = 'Coffeebook, Shugyla, Almaty';
  const TZ = 'Asia/Almaty'; // UTC+05:00, no DST
  const DAYS = [
    { id: '31', short: 'Sat, Oct 31', long: 'Saturday, October 31, 2026', iso: '2026-10-31' },
    { id: '01', short: 'Sun, Nov 1', long: 'Sunday, November 1, 2026', iso: '2026-11-01' },
  ];
  const TIMES = ['14:00', '15:00', '16:00'];
  const state = { day: null, time: null };

  const $ = (s, r = document) => r.querySelector(s);
  const screens = [...document.querySelectorAll('[data-screen]')];
  let current = 'envelope';

  const FINAL = { confirmed: 1, declined: 1 };
  let finalScreen = null; // set once a reply has been delivered
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function go(name, { push = true } = {}) {
    // after a reply is delivered, the only place to be is its confirmation
    if (finalScreen && !FINAL[name]) name = finalScreen;
    const from = screens.find(s => s.dataset.screen === current);
    const to = screens.find(s => s.dataset.screen === name);
    if (!to || name === current) return;
    // browser back/forward stays within the page's own history
    if (push) {
      if (FINAL[name]) history.replaceState({ screen: name }, '');
      else history.pushState({ screen: name }, '');
    }
    const swap = () => {
      screens.forEach(s => { s.hidden = s !== to; s.classList.remove('leaving'); });
      current = name;
      if (name === 'envelope') resetEnvelope();
      window.scrollTo({ top: 0 });
      const focusTarget = $('h1, h2, .btn.primary', to);
      if (focusTarget) { focusTarget.setAttribute('tabindex', '-1'); focusTarget.focus({ preventScroll: true }); }
    };
    from.classList.add('leaving');
    setTimeout(swap, reduced() ? 0 : 400);
  }
  history.replaceState({ screen: 'envelope' }, '');
  window.addEventListener('popstate', e => go((e.state && e.state.screen) || 'envelope', { push: false }));

  // envelope
  const env = $('#envelope');
  function resetEnvelope() {
    env.classList.remove('open');
    env.setAttribute('aria-label', 'Open the invitation');
    $('#envelope-hint').textContent = 'Open when you have a quiet minute.';
  }
  env.addEventListener('click', () => {
    if (env.classList.contains('open')) return;
    env.classList.add('open');
    env.setAttribute('aria-label', 'Invitation opening');
    $('#envelope-hint').textContent = 'Unfolding…';
    setTimeout(() => go('invitation'), reduced() ? 0 : 1900);
  });

  // venue photo
  if (VENUE_PHOTO) {
    const img = $('#venue-img'); img.src = VENUE_PHOTO; img.hidden = false;
    $('#venue-placeholder').hidden = true;
  }

  // choices
  const alt = $('#alt-time');
  function radio(container, items, label, isOn, onPick) {
    items.forEach(item => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio');
      b.textContent = label(item);
      b.addEventListener('click', () => { onPick(item); sync(); });
      b._item = item; container.appendChild(b);
    });
    container._isOn = isOn;
    // arrow keys move between options, like a native radio group
    container.addEventListener('keydown', e => {
      const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!k) return;
      e.preventDefault();
      const bs = [...container.children], i = bs.indexOf(document.activeElement);
      const next = bs[(i + k + bs.length) % bs.length];
      next.focus(); next.click();
    });
  }
  function sync() {
    for (const c of [$('#days'), $('#times')]) {
      [...c.children].forEach((b, i, all) => {
        const on = c._isOn(b._item);
        b.setAttribute('aria-checked', String(on));
        // roving tabindex: one stop per group
        const anyOn = all.some(x => c._isOn(x._item));
        b.tabIndex = on || (!anyOn && i === 0) ? 0 : -1;
      });
    }
    const note = alt.value.trim();
    const slot = state.day && state.time ? `${state.day.long} at ${state.time}` : '';
    const parts = [];
    if (slot) parts.push(slot);
    if (note) parts.push(slot ? `or: ${note}` : `Suggested: ${note}`);
    $('#preview').textContent = parts.length ? parts.join(' — ') : 'Pick a day and time, or suggest your own.';
    $('#confirm').disabled = busy || !(slot || note);
  }
  radio($('#days'), DAYS, d => d.short, d => d === state.day, d => (state.day = d));
  radio($('#times'), TIMES, t => t, t => t === state.time, t => (state.time = t));
  alt.addEventListener('input', sync);

  // replies go to the server, which saves them for the host.
  // clientId lets the server ignore a retry of a request that already landed.
  const clientId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
  let busy = false, done = false;
  const send = payload => fetch('/api/response', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, guest: $('[data-name]').textContent, ...payload }),
  }).then(r => { if (!r.ok) throw new Error(r.status); });

  // confirm
  $('#confirm').addEventListener('click', async () => {
    if (busy || done) return;
    const btn = $('#confirm'), label = btn.textContent;
    busy = true; btn.disabled = true; btn.textContent = 'Sending…'; $('#confirm-error').hidden = true;
    const d = state.day, t = state.time, note = alt.value.trim();
    try {
      await send({
        type: 'accepted', place: VENUE, timezone: TZ,
        day: d ? d.long : '', time: t || '',
        start: d && t ? `${d.iso}T${t}:00+05:00` : '',
        alternative: note,
      });
    } catch {
      busy = false; btn.textContent = label; $('#confirm-error').hidden = false; sync(); return;
    }
    busy = false; done = true; finalScreen = 'confirmed'; btn.textContent = label;
    $('#c-day').textContent = d ? d.long : 'To be agreed';
    $('#c-time').textContent = (t ? `${t} (Almaty)` : '') + (note ? `${t ? ' · ' : ''}${note}` : '') || '—';
    go('confirmed');
  });

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-go]');
    if (t) go(t.dataset.go);
  });
  // decline: the note is optional; "Send response" works with it empty
  const form = $('#note-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || done) return;
    const btn = $('button[type=submit]', form), label = btn.textContent;
    busy = true; btn.disabled = true; btn.textContent = 'Sending…'; $('#note-error').hidden = true;
    try { await send({ type: 'declined', note: $('#note-text').value.trim() }); }
    catch { busy = false; btn.disabled = false; btn.textContent = label; $('#note-error').hidden = false; return; }
    busy = false; done = true; finalScreen = 'declined'; btn.textContent = label;
    go('declined');
  });
  sync();
})();
