/* RSVP dashboard: Sign in with Google → responses from the Sheet (via the Apps Script). */
(function () {
  var CFG = window.WEDDING_CONFIG || {};
  var API = window.WeddingAPI;
  var TOKEN_KEY = 'wedding-admin-token';
  var $ = function (id) { return document.getElementById(id); };
  var data = null, filter = 'all', query = '';
  var activity = null, feedFilter = 'all', feedQuery = '', view = 'responses';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function toast(t) { var n = $('toast'); n.textContent = t; n.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.remove('on'); }, 2200); }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return String(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function link(code) {
    var base = (data && data.siteUrl) || CFG.siteUrl || '';
    return base ? base + (base.indexOf('?') >= 0 ? '&' : '?') + 'c=' + code : '';
  }

  /* ---------------- sign-in ---------------- */
  function signinMessage(t) { $('signin-msg').textContent = t || ''; }
  function showSignin() { $('dash').hidden = true; $('who').hidden = true; $('signin').hidden = false; }

  function errorText(res) {
    switch (res.error) {
      case 'not_allowed': return (res.email || 'This account') + ' isn’t on the Admins tab of your Sheet.';
      case 'not_configured': return 'Add your Google sign-in client ID to the Settings tab of your Sheet.';
      case 'token_invalid': return 'Sign-in couldn’t be verified. Check that the client ID in config.js matches the one in your Sheet’s Settings tab.';
      case 'token_expired': case 'signin_required': return 'Please sign in again.';
      default: return 'Couldn’t load the responses. Please try again.';
    }
  }

  function fetchData(token, quiet) {
    if (!quiet) signinMessage('Loading…');
    return API.admin(token).then(function (res) {
      if (!res.ok) {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
        showSignin(); signinMessage(errorText(res)); return;
      }
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) {}
      data = res; signinMessage('');
      $('signin').hidden = true; $('dash').hidden = false; $('who').hidden = false;
      $('who-email').textContent = res.admin;
      render();
      if (quiet) toast('Updated');
    }).catch(function () { signinMessage('Couldn’t reach the RSVP service. Check your connection.'); });
  }

  function setupGoogle() {
    if (!CFG.googleClientId) {
      signinMessage('Add your Google sign-in client ID to config.js to enable sign-in.');
      return;
    }
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = function () {
      google.accounts.id.initialize({
        client_id: CFG.googleClientId,
        callback: function (r) { fetchData(r.credential); },
        auto_select: true,
        use_fedcm_for_prompt: true
      });
      google.accounts.id.renderButton($('gsi-button'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left' });
    };
    s.onerror = function () {
      var cur = $('signin-msg').textContent;
      if (!cur || cur === 'Loading…' || cur === 'Signed out.') signinMessage('Couldn’t load Google sign-in. Check your connection.');
    };
    document.head.appendChild(s);
  }

  function signOut() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    data = null; showSignin(); signinMessage('Signed out.');
  }

  /* ---------------- dashboard ---------------- */
  function statusOf(inv) {
    if (!inv.response) return 'wait';
    var y = countOf(inv, 'yes'), n = inv.response.guests.length;
    return y === n ? 'yes' : y === 0 ? 'no' : 'mixed';
  }
  function countOf(inv, val) {
    return inv.response ? inv.response.guests.filter(function (g) { return g.attending === val; }).length : 0;
  }

  function render() {
    var s = data.stats;
    $('meta').textContent = 'RSVP deadline: ' + (data.deadlineText || '—') + (data.closed ? ' (closed)' : '') + ' · Updated ' + fmtDate(data.generated);
    var stats = $('stats'); stats.innerHTML = '';
    [
      ['Attending', s.attending, 'people', 'yes'],
      ['Declined', s.declined, 'people', 'no'],
      ['Awaiting reply', s.awaiting, 'people', 'wait'],
      ['Replied', s.responded + ' / ' + s.invitations, 'invitations', 'all']
    ].forEach(function (x) {
      stats.appendChild(el('button', { type: 'button', class: 'stat stat-' + x[3], onclick: function () { setFilter(x[3]); } }, [
        el('span', { class: 'stat-num', text: String(x[1]) }),
        el('span', { class: 'stat-label', text: x[0] }),
        el('span', { class: 'stat-unit', text: x[2] })
      ]));
    });
    var pct = s.seats ? Math.round(100 * (s.attending + s.declined) / s.seats) : 0;
    $('progress-bar').style.width = pct + '%';
    renderList();
  }

  function renderList() {
    var q = query.toLowerCase();
    var items = data.invitations.slice().sort(function (a, b) {
      var ua = a.response && a.response.updated ? Date.parse(a.response.updated) : 0;
      var ub = b.response && b.response.updated ? Date.parse(b.response.updated) : 0;
      if (ua !== ub) return ub - ua;
      return a.party.localeCompare(b.party);
    }).filter(function (inv) {
      var st = statusOf(inv);
      if (filter === 'yes' && !countOf(inv, 'yes')) return false;      // anyone attending (incl. split invitations)
      if (filter === 'no' && !countOf(inv, 'no')) return false;        // anyone declining (incl. split invitations)
      if (filter === 'wait' && (st !== 'wait' || !inv.active)) return false;
      if (filter === 'msg' && !(inv.response && inv.response.message)) return false;
      if (filter === 'opened' && (st !== 'wait' || !inv.visits || !inv.active)) return false;   // opened, no reply
      if (filter === 'unopened' && (st !== 'wait' || inv.visits || !inv.active)) return false;  // not opened yet
      if (!q) return true;
      var hay = [inv.party, inv.code].concat(inv.invited)
        .concat(inv.response ? inv.response.guests.map(function (g) { return g.name; }).concat([inv.response.message, inv.response.email]) : [])
        .join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var people = items.reduce(function (sum, inv) {
      if (filter === 'yes') return sum + countOf(inv, 'yes');
      if (filter === 'no') return sum + countOf(inv, 'no');
      if (filter === 'wait' || filter === 'opened' || filter === 'unopened') return sum + inv.invited.length;
      return sum;
    }, 0);
    var what = { yes: ' attending', no: ' declined', wait: ' awaiting reply', opened: ' awaiting reply', unopened: ' awaiting reply' }[filter];
    $('count').textContent = items.length + (items.length === 1 ? ' invitation' : ' invitations') +
      (what ? ' · ' + people + (people === 1 ? ' person' : ' people') + what : '');
    var list = $('list'); list.innerHTML = '';
    if (!items.length) { list.appendChild(el('p', { class: 'empty', text: 'Nothing here yet.' })); return; }
    items.forEach(function (inv) { list.appendChild(card(inv)); });
  }

  function card(inv) {
    var st = statusOf(inv), r = inv.response;
    var guests = (r ? r.guests : inv.invited.map(function (n) { return { name: n, attending: '' }; })).map(function (g) {
      var cls = g.attending === 'yes' ? 'g-yes' : g.attending === 'no' ? 'g-no' : 'g-wait';
      if ((filter === 'yes' || filter === 'no') && g.attending !== filter) cls += ' g-dim';
      var mark = g.attending === 'yes' ? '✓' : g.attending === 'no' ? '✕' : '…';
      return el('li', { class: cls }, [el('span', { class: 'mark', 'aria-hidden': 'true', text: mark }), el('span', { text: g.name }),
        el('span', { class: 'sr-only', text: g.attending === 'yes' ? ' attending' : g.attending === 'no' ? ' declined' : ' no reply yet' })]);
    });
    var url = link(inv.code);
    var label = !inv.active ? 'Switched off' : st === 'yes' ? 'Attending' : st === 'no' ? 'Declined'
      : st === 'mixed' ? countOf(inv, 'yes') + ' of ' + inv.response.guests.length + ' attending' : 'Awaiting reply';
    return el('article', { class: 'inv inv-' + st + (inv.active ? '' : ' inv-off') }, [
      el('div', { class: 'inv-head' }, [
        el('div', {}, [el('h2', { text: inv.party }), el('span', { class: 'code', text: inv.code })]),
        el('span', { class: 'pill pill-' + (inv.active ? st : 'off'), text: label })
      ]),
      el('ul', { class: 'guests' }, guests),
      r && r.message ? el('blockquote', { text: r.message }) : null,
      el('div', { class: 'inv-foot' }, [
        el('span', { class: 'foot-meta' }, [
          [r && r.email, r && r.updated ? 'Replied ' + fmtDate(r.updated) : 'No reply yet'].filter(Boolean).join(' · '),
          el('br'),
          el('span', { class: 'visits', text: inv.visits
            ? 'Opened ' + inv.visits.count + (inv.visits.count === 1 ? ' time' : ' times') + ' · last ' + fmtDate(inv.visits.last)
            : 'Not opened yet' })
        ]),
        url ? el('span', { class: 'foot-actions' }, [
          el('button', { type: 'button', class: 'link', text: 'History', onclick: function () { openHistory(inv.code, inv.party); } }),
          el('button', { type: 'button', class: 'link', text: 'Copy link', onclick: function () { copy(url); } }),
          el('a', { class: 'link', href: url + '&preview=1', target: '_blank', rel: 'noopener', text: 'Open', title: 'Preview (not counted as a visit)' })
        ]) : null
      ])
    ]);
  }

  function copy(text) {
    function done() { toast('Link copied'); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var t = el('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { prompt('Copy this link:', text); }
      t.remove();
    }
  }

  function setFilter(f) {
    filter = f;
    document.querySelectorAll('.chip[data-filter]').forEach(function (c) { c.classList.toggle('is-on', c.getAttribute('data-filter') === f); });
    renderList();
  }

  function csv() {
    var rows = [['Party', 'Code', 'Guest', 'Attending', 'Email', 'Message', 'Replied', 'Times opened', 'Last opened', 'Personal link']];
    data.invitations.forEach(function (inv) {
      var r = inv.response;
      var guests = r ? r.guests : inv.invited.map(function (n) { return { name: n, attending: '' }; });
      guests.forEach(function (g) {
        rows.push([inv.party, inv.code, g.name, g.attending === 'yes' ? 'Yes' : g.attending === 'no' ? 'No' : 'Awaiting',
          r ? r.email : '', r ? r.message : '', r ? fmtDate(r.updated) : '',
          inv.visits ? inv.visits.count : 0, inv.visits ? fmtDate(inv.visits.last) : '', link(inv.code)]);
      });
    });
    var text = rows.map(function (row) {
      return row.map(function (v) {
        v = String(v == null ? '' : v);
        if (/^[=+\-@]/.test(v)) v = "'" + v;            // keep spreadsheet apps from running it as a formula
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n');
    var a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })), download: 'rsvp-responses.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------------- activity & history ---------------- */
  function token() {
    if (API.isDemo) return 'demo';
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function showView(v) {
    view = v;
    document.querySelectorAll('.view-btn').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-view') === v); });
    $('view-responses').hidden = v !== 'responses';
    $('view-activity').hidden = v !== 'activity';
    $('csv').hidden = v !== 'responses';
    if (v === 'activity') loadActivity();
  }

  function loadActivity(quiet) {
    if (!quiet) { $('feed').innerHTML = ''; $('feed').appendChild(el('p', { class: 'empty', text: 'Loading activity…' })); }
    return API.activity(token()).then(function (res) {
      if (!res.ok) { $('feed').innerHTML = ''; $('feed').appendChild(el('p', { class: 'empty', text: errorText(res) })); return; }
      activity = res; renderFeed();
    }).catch(function () { $('feed').innerHTML = ''; $('feed').appendChild(el('p', { class: 'empty', text: 'Couldn’t load the activity. Please try again.' })); });
  }

  function renderFeed() {
    var q = feedQuery.toLowerCase();
    var ev = activity.events.filter(function (e) {
      if (feedFilter !== 'all' && e.type !== feedFilter) return false;
      if (!q) return true;
      return [e.party, e.code, e.summary, e.message, e.email].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var rsvps = ev.filter(function (e) { return e.type === 'rsvp'; }).length;
    $('feed-count').textContent = rsvps + (rsvps === 1 ? ' RSVP or change' : ' RSVPs & changes') + ' · ' + (ev.length - rsvps) +
      (ev.length - rsvps === 1 ? ' visit' : ' visits') + (activity.truncated ? ' (showing the most recent)' : '');
    timeline($('feed'), ev, true);
  }

  function timeline(box, events, showParty) {
    box.innerHTML = '';
    if (!events.length) { box.appendChild(el('p', { class: 'empty', text: 'Nothing here yet.' })); return; }
    var lastDay = '';
    events.forEach(function (e) {
      var d = new Date(e.time), day = isNaN(d) ? '' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      if (day !== lastDay) { box.appendChild(el('h3', { class: 'feed-day', text: day })); lastDay = day; }
      var time = isNaN(d) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      var who = showParty
        ? el('button', { type: 'button', class: 'feed-party', text: e.party || e.code, onclick: function () { openHistory(e.code, e.party); } })
        : null;
      var body;
      if (e.type === 'visit') {
        body = [who, el('span', { class: 'feed-what', text: showParty ? ' opened their invitation' : 'Opened their invitation' })];
      } else {
        var answers = String(e.summary || '').split(/;\s*/).filter(Boolean).map(function (part) {
          var m = /^(.*):\s*(Yes|No)$/i.exec(part.trim()), yes = m && /yes/i.test(m[2]);
          return el('span', { class: 'ans ' + (m ? (yes ? 'ans-yes' : 'ans-no') : '') }, [m ? m[1] + (yes ? ' ✓' : ' ✕') : part]);
        });
        body = [who, el('span', { class: 'feed-what', text: (showParty ? ' ' : '') + (/updated/i.test(e.kind) ? 'changed their RSVP' : 'sent their RSVP') }),
          el('div', { class: 'ans-row' }, answers),
          e.message ? el('blockquote', { text: e.message }) : null,
          e.email ? el('div', { class: 'feed-email', text: e.email }) : null];
      }
      box.appendChild(el('div', { class: 'feed-item feed-' + e.type }, [
        el('span', { class: 'feed-time', text: time }),
        el('span', { class: 'feed-dot', 'aria-hidden': 'true' }),
        el('div', { class: 'feed-body' }, body)
      ]));
    });
  }

  function openHistory(code, party) {
    $('history-title').textContent = party || code;
    $('history-meta').textContent = code + ' · loading…';
    $('history-body').innerHTML = '';
    $('history').hidden = false; document.body.classList.add('no-scroll');
    API.activity(token(), code).then(function (res) {
      if (!res.ok) { $('history-meta').textContent = errorText(res); return; }
      var r = res.events.filter(function (e) { return e.type === 'rsvp'; }).length, v = res.events.length - r;
      $('history-meta').textContent = code + ' · ' + r + (r === 1 ? ' RSVP or change' : ' RSVPs & changes') + ' · ' + v + (v === 1 ? ' visit' : ' visits');
      timeline($('history-body'), res.events, false);
    }).catch(function () { $('history-meta').textContent = 'Couldn’t load the history. Please try again.'; });
  }
  function closeHistory() { $('history').hidden = true; document.body.classList.remove('no-scroll'); }

  /* ---------------- start ---------------- */
  function init() {
    $('signout').addEventListener('click', signOut);
    $('refresh').addEventListener('click', function () {
      fetchData(token(), true);
      if (view === 'activity') loadActivity(true);
    });
    document.querySelectorAll('.view-btn').forEach(function (b) { b.addEventListener('click', function () { showView(b.getAttribute('data-view')); }); });
    document.querySelectorAll('.feed-chip').forEach(function (c) {
      c.addEventListener('click', function () {
        feedFilter = c.getAttribute('data-feed');
        document.querySelectorAll('.feed-chip').forEach(function (x) { x.classList.toggle('is-on', x === c); });
        if (activity) renderFeed();
      });
    });
    $('feed-search').addEventListener('input', function (e) { feedQuery = e.target.value.trim(); if (activity) renderFeed(); });
    $('history-close').addEventListener('click', closeHistory);
    $('history').addEventListener('click', function (e) { if (e.target === $('history')) closeHistory(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('history').hidden) closeHistory(); });
    $('csv').addEventListener('click', csv);
    $('search').addEventListener('input', function (e) { query = e.target.value.trim(); renderList(); });
    document.querySelectorAll('.chip[data-filter]').forEach(function (c) { c.addEventListener('click', function () { setFilter(c.getAttribute('data-filter')); }); });

    if (API.isDemo) {
      $('signin-help').textContent = 'Demo mode: sample data, no Google account needed. Add your Apps Script URL and Google client ID in config.js to go live.';
      var b = $('demo-signin'); b.hidden = false;
      b.addEventListener('click', function () { fetchData('demo'); });
      return;
    }
    var saved = ''; try { saved = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
    setupGoogle();
    if (saved) fetchData(saved);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
