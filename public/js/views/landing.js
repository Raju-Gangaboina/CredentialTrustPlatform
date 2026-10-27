// Landing page — dark / crimson design. Layout is 'landing' (see main.js + shell.js); styles in css/landing.css.
import { icon } from '../ui/icons.js';

const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

const shieldCheck = `<svg viewBox="0 0 52 62" fill="none" stroke="#e5243f" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M26 3.5L47 11.5V31c0 14-9.4 24.2-21 28.5C14.4 55.2 5 45 5 31V11.5L26 3.5z"/>
  <path d="M16 31.5l7.5 7.5L37 23"/>
</svg>`;

const shieldTick = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8l7.5 3v5.6c0 4.6-3.1 8.2-7.5 10-4.4-1.8-7.5-5.4-7.5-10V5.8L12 2.8z"/><path d="M8.8 12l2.3 2.3 4.2-4.4"/></svg>`;

const waves = `<svg viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
  <g stroke="rgba(255,255,255,0.05)" stroke-width="1">
    <path d="M0 470C90 500 150 560 260 600S420 640 470 700"/>
    <path d="M0 500C80 535 140 590 245 630S410 668 455 735"/>
    <path d="M0 530C70 568 130 620 232 660S400 695 440 765"/>
    <path d="M0 560C60 600 120 650 220 690S388 722 426 795"/>
    <path d="M0 590C52 632 110 680 208 720S376 750 412 825"/>
  </g>
  <g stroke="rgba(235,60,85,0.20)" stroke-width="1">
    <path d="M1672 540C1560 560 1470 610 1400 690S1290 800 1180 860"/>
    <path d="M1672 580C1565 600 1480 650 1415 725S1310 830 1210 890"/>
    <path d="M1672 620C1572 640 1492 690 1432 760S1330 860 1240 920"/>
    <path d="M1672 660C1580 680 1505 725 1448 795S1352 890 1272 941"/>
  </g>
</svg>`;

export async function landing(ctx) {
  ctx.render(`
    <div class="lp">
      <div class="lp-bg" aria-hidden="true">${waves}</div>

      <header class="lp-nav">
        <a class="lp-brand" href="#/" aria-label="Credential Trust — verification platform">
          ${shieldCheck}
          <span class="lp-brand-text">
            <strong>Credential <em>Trust</em></strong>
            <small>Verification platform</small>
          </span>
        </a>
        <nav class="lp-links" aria-label="Primary">
          <button type="button" class="lp-link" data-scroll="lp-how">How it works</button>
          <button type="button" class="lp-link" data-scroll="lp-how">About us</button>
          <button type="button" class="lp-signin" data-scroll="lp-roles"><span>Sign in</span><i>${arrow}</i></button>
        </nav>
      </header>

      <section class="lp-hero">
        <span class="lp-pill">${shieldTick}<hr><b>Secure. Private. Trusted.</b></span>
        <h1>Certificates verified by<br>the <em>people who issued them</em></h1>
        <p class="lp-sub">Students upload coursework certificates into their class vault. Each one is checked against what its issuer can confirm, and anything uncertain goes to faculty for review.</p>
      </section>

      <section class="lp-cards" id="lp-roles" aria-label="Choose your role">
        <a class="lp-card is-primary" href="#/faculty/login">
          <span class="lp-tile">${icon.faculty}</span>
          <div class="lp-card-body">
            <h2>I'm faculty</h2>
            <i></i>
            <p>Create classes, upload rosters, review flagged certificates and manage recognised issuers.</p>
          </div>
          <span class="lp-go">${arrow}</span>
        </a>
        <a class="lp-card" href="#/student/login">
          <span class="lp-tile">${icon.student}</span>
          <div class="lp-card-body">
            <h2>I'm a student</h2>
            <i></i>
            <p>Find your class, sign in with your roll number and upload certificates to your subject vaults.</p>
          </div>
          <span class="lp-go">${arrow}</span>
        </a>
      </section>

      <section class="lp-principle" id="lp-how">
        <span class="lp-seal">${shieldTick}</span>
        <hr>
        <p>We don't ask AI whether a certificate looks real.<strong>We ask the issuer whether it actually exists.</strong></p>
      </section>
    </div>
  `);

  ctx.on('click', '[data-scroll]', (e, el) => {
    const target = document.getElementById(el.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}
