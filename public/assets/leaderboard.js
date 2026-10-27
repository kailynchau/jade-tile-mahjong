/* ------------------------------------------------------------------
   Jade Tile leaderboard — drop-in section
   Usage:  <div id="jade-leaderboard"></div>
           <script src="/assets/leaderboard.js" defer></script>
   Mounts into any element with id="jade-leaderboard", or pass another
   element to JadeLeaderboard.mount(el, { apiBase }).

   Two boards (advanced / beginner) as tabs. Each shows the top 5 with
   points and win rate, and a viewer who picks their name sees their own
   place and the gap to whoever is ahead of them.
   ------------------------------------------------------------------ */

(function (global) {
  "use strict";

  var ME_KEY = "jade.me";
  var TIER_KEY = "jade.tier";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n) { return Number(n).toLocaleString("en-CA"); }
  function ord(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function ordHtml(n) { var t = ord(n); return t.slice(0, -2) + "<sup>" + t.slice(-2) + "</sup>"; }
  function nice(d) {
    if (!d) return null;
    var p = String(d).split("-");
    if (p.length !== 3) return d;
    var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return Number(p[2]) + " " + m[Number(p[1]) - 1] + " " + p[0];
  }
  function games(n) { return n + " game" + (n === 1 ? "" : "s"); }
  function wrValue(p) {
    return p.win_rate === null || p.win_rate === undefined ? "—" : p.win_rate + "%";
  }
  function wrMeta(p) {
    return p.win_rate === null || p.win_rate === undefined ? "no games yet" : p.win_rate + "% wins";
  }
  /**
   * How far a player moved since the last meet, as a small chip.
   * Positive is up. Null means they had not played before the last meet, so
   * there is nothing to compare against — a new player has not "held" at 0.
   */
  function moveChip(m) {
    if (m === null || m === undefined) {
      return '<span class="jtl__mv jtl__mv--new" title="First meet on this board">new</span>';
    }
    if (m === 0) {
      return '<span class="jtl__mv jtl__mv--hold" title="No change since the last meet">–</span>';
    }
    var up = m > 0;
    return '<span class="jtl__mv jtl__mv--' + (up ? "up" : "down") +
      '" title="' + (up ? "Up " : "Down ") + Math.abs(m) + " since the last meet\">" +
      (up ? "\u25B2" : "\u25BC") + Math.abs(m) + "</span>";
  }

  /** One row of the board. Shared by the top five and the pinned "you" row. */
  function rowHtml(p, mine) {
    return '<li class="jtl__tile jtl__row' + (p.rank === 1 ? " jtl__row--first" : "") +
      (mine ? " jtl__row--mine" : "") + '">' +
      '<span class="jtl__n">' + p.rank + "</span>" +
      '<span class="jtl__nm"><span class="jtl__nmt">' + esc(p.name) + "</span>" +
      '<span class="jtl__sub">' + games(p.games) + " \u00b7 " + wrMeta(p) + "</span></span>" +
      '<span class="jtl__sc">' + num(p.score) + moveChip(p.movement) + "</span>" +
      "</li>";
  }

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }

  function Board(el, opts) {
    this.el = el;
    this.api = (opts && opts.apiBase) || el.getAttribute("data-api") || "";
    this.tiers = null;
    this.tier = null;
    this.data = null;
    this.me = null;
    this.roster = null;
    this.picking = false;
    this.state = "loading";
    this.firstPaint = true;
    var self = this;
    el.classList.add("jtl");
    el.addEventListener("click", function (e) { self.onClick(e); });
    this.render();
    this.boot();
  }

  Board.prototype.fetchJson = function (path) {
    return fetch(this.api + path, { headers: { accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status + " " + path);
        return r.json();
      });
  };

  Board.prototype.boot = function () {
    var self = this;
    this.fetchJson("/api/tiers").then(function (t) {
      self.tiers = t.tiers;
      var saved = get(TIER_KEY);
      var ok = self.tiers.some(function (x) { return x.key === saved; });
      self.tier = ok ? saved : t.default || self.tiers[0].key;
      self.load();
    }).catch(function (err) {
      console.error(err);
      self.state = "error";
      self.render();
    });
  };

  Board.prototype.load = function () {
    var self = this;
    var id = get(ME_KEY);
    var jobs = [this.fetchJson("/api/standings?tier=" + encodeURIComponent(this.tier))];
    jobs.push(id ? this.fetchJson("/api/me?id=" + encodeURIComponent(id)).catch(function () {
      set(ME_KEY, null);
      return null;
    }) : Promise.resolve(null));

    Promise.all(jobs).then(function (res) {
      self.data = res[0];
      self.me = res[1];
      self.state = "ready";
      self.render();
    }).catch(function (err) {
      console.error(err);
      self.state = "error";
      self.render();
    });
  };

  Board.prototype.loadRoster = function () {
    var self = this;
    this.roster = null;
    this.render();
    this.fetchJson("/api/roster?tier=" + encodeURIComponent(this.tier)).then(function (r) {
      self.roster = r.players || [];
      self.render();
    }).catch(function () { self.roster = []; self.render(); });
  };

  Board.prototype.onClick = function (e) {
    var btn = e.target.closest("[data-jtl]");
    if (!btn) return;
    var act = btn.getAttribute("data-jtl");

    if (act === "tier") {
      var key = btn.getAttribute("data-key");
      if (key === this.tier) return;
      this.tier = key;
      set(TIER_KEY, key);
      this.picking = false;
      this.state = "loading";
      this.render();
      this.load();
      return;
    }
    if (act === "pick") { this.picking = true; this.loadRoster(); return; }
    if (act === "cancel") { this.picking = false; this.render(); return; }
    if (act === "confirm") {
      var sel = this.el.querySelector("[data-jtl-select]");
      if (!sel || !sel.value) return;
      set(ME_KEY, sel.value);
      this.picking = false;
      this.state = "loading";
      this.render();
      this.load();
      return;
    }
    if (act === "forget") {
      set(ME_KEY, null);
      this.me = null;
      this.render();
      return;
    }
    if (act === "retry") { this.state = "loading"; this.render(); this.boot(); return; }
  };

  Board.prototype.render = function () {
    if (this.state === "loading") {
      this.el.innerHTML = '<div class="jtl__inner">' + this.tabsHtml() +
        '<p class="jtl__loading">Shuffling the tiles…</p></div>';
      return;
    }
    if (this.state === "error") {
      this.el.innerHTML =
        '<div class="jtl__inner"><p class="jtl__error">The leaderboard did not load. ' +
        '<button class="jtl__link" data-jtl="retry">Try again</button></p></div>';
      return;
    }

    var d = this.data;
    var html = '<div class="jtl__inner">';
    html += this.tabsHtml();
    html += this.heroHtml();
    html += this.boardHtml();

    var bits = [];
    if (d.updated) bits.push("Last played " + esc(nice(d.updated)));
    if (d.rounds_played) bits.push(d.rounds_played + " round" + (d.rounds_played === 1 ? "" : "s") + " recorded");
    html += '<div class="jtl__foot"><p>' + (bits.join(" · ") || "No rounds yet on this board") + "</p></div>";
    html += "</div>";

    this.el.innerHTML = html;
    this.firstPaint = false;
  };

  Board.prototype.tabsHtml = function () {
    if (!this.tiers || this.tiers.length < 2) return "";
    var self = this;
    return '<div class="jtl__tabs" role="tablist">' + this.tiers.map(function (t) {
      return '<button class="jtl__tab' + (t.key === self.tier ? " jtl__tab--on" : "") +
        '" role="tab" aria-selected="' + (t.key === self.tier) + '" data-jtl="tier" data-key="' + esc(t.key) + '">' +
        esc(t.label) + '<span class="jtl__tabn">' + t.players + " player" + (t.players === 1 ? "" : "s") + "</span></button>";
    }).join("") + "</div>";
  };

  Board.prototype.tierLabel = function (key) {
    var t = (this.tiers || []).filter(function (x) { return x.key === key; })[0];
    return t ? t.label : key;
  };

  Board.prototype.heroHtml = function () {
    // picked someone who plays on the other board
    if (this.me && this.me.tier !== this.tier) {
      return '<section class="jtl__tile jtl__pick">' +
        "<h3>You play on the " + esc(this.me.label) + " board</h3>" +
        "<p>This tab is the " + esc(this.tierLabel(this.tier)) + " table.</p>" +
        '<button class="jtl__btn" data-jtl="tier" data-key="' + esc(this.me.tier) + '">Take me there</button>' +
        "</section>";
    }

    if (this.picking) {
      if (!this.roster) {
        return '<section class="jtl__tile jtl__pick"><p class="jtl__loading jtl__loading--tile">Loading names…</p></section>';
      }
      if (!this.roster.length) {
        return '<section class="jtl__tile jtl__pick"><h3>No players yet</h3>' +
          "<p>Once an exec adds the roster, you can find yourself here.</p></section>";
      }
      return '<section class="jtl__tile jtl__pick">' +
        "<h3>Choose your name</h3>" +
        "<p>Your place is saved on this device only.</p>" +
        '<div class="jtl__pickrow">' +
        '<select data-jtl-select aria-label="Your name"><option value="">Select a player</option>' +
        this.roster.map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>";
        }).join("") +
        "</select>" +
        '<button class="jtl__btn" data-jtl="confirm">Done</button>' +
        "</div>" +
        '<button class="jtl__link" data-jtl="cancel">Go back</button>' +
        "</section>";
    }

    if (!this.me) {
      if (!this.data.total_players) return "";
      return '<section class="jtl__tile jtl__pick">' +
        "<h3>Where do you sit?</h3>" +
        "<p>Find your name to see your place and how far you are behind.</p>" +
        '<button class="jtl__btn" data-jtl="pick">Find me</button>' +
        "</section>";
    }

    if (this.me.unranked) {
      return '<section class="jtl__tile jtl__pick">' +
        "<h3>" + esc(this.me.you.name) + ", you are on the board</h3>" +
        "<p>Your place shows up here once you have played a round.</p>" +
        '<button class="jtl__link" data-jtl="forget">Not you?</button>' +
        "</section>";
    }

    var y = this.me.you;
    var line;
    if (this.me.ahead) {
      line = "<b>" + num(this.me.ahead.gap) + " points</b> behind " + esc(this.me.ahead.name);
    } else if (this.me.lead !== null && this.me.lead !== undefined) {
      line = "<b>" + num(this.me.lead) + " points</b> clear at the top";
    } else {
      line = "Top of the table";
    }
    if (this.me.tied_with && this.me.tied_with.length) {
      line = "Tied with " + esc(this.me.tied_with[0]) + " · " + line;
    }

    return '<section class="jtl__tile jtl__hero' + (y.rank === 1 ? " jtl__hero--leader" : "") + '">' +
      '<button class="jtl__x" data-jtl="forget" aria-label="Not you? Clear this" title="Not you?">&times;</button>' +
      '<div class="jtl__rank">' + ordHtml(y.rank) + "</div>" +
      '<div class="jtl__who">' + esc(y.name) + "</div>" +
      '<div class="jtl__of">of ' + this.me.total_players + " on the " + esc(String(this.me.label).toLowerCase()) + " board</div>" +
      '<div class="jtl__stats">' +
        '<div class="jtl__stat"><span class="jtl__statv">' + num(y.score) + '</span><span class="jtl__statk">points</span></div>' +
        '<div class="jtl__stat"><span class="jtl__statv">' + y.games + '</span><span class="jtl__statk">games</span></div>' +
        '<div class="jtl__stat"><span class="jtl__statv">' + wrValue(y) + '</span><span class="jtl__statk">win rate</span></div>' +
      "</div>" +
      '<p class="jtl__gap">' + line + "</p>" +
      "</section>";
  };

  Board.prototype.boardHtml = function () {
    var d = this.data;
    var mineId = this.me ? this.me.you.id : null;

    if (!d.players.length) {
      return '<section class="jtl__tile jtl__empty"><strong>Nobody on this board yet</strong>' +
        "The first round played is the first round on the board.</section>";
    }

    var rows = d.players.map(function (p) {
      return rowHtml(p, p.id === mineId);
    }).join("");

    var count = d.total_players > d.players.length
      ? '<p class="jtl__count">' + d.total_players + " on this board</p>"
      : "";

    // If you are on this board but below the shown five, pin your own row
    // under a break so you can see yourself in context. Only your own score
    // appears — everyone else below fifth stays private.
    var pinned = "";
    if (this.me && !this.me.unranked && this.me.tier === this.tier && this.me.in_top === false) {
      pinned = '<li class="jtl__break" aria-hidden="true"><span></span><span></span><span></span></li>' +
        rowHtml(this.me.you, true);
    }

    return '<section><div class="jtl__head"><h2>Top 5</h2>' + count + "</div>" +
      '<ol class="jtl__rows">' + rows + pinned + "</ol></section>";
  };

  var JadeLeaderboard = {
    mount: function (el, opts) { return new Board(el, opts || {}); },
  };

  global.JadeLeaderboard = JadeLeaderboard;

  function auto() {
    var el = document.getElementById("jade-leaderboard");
    if (el && !el.dataset.jtlMounted) {
      el.dataset.jtlMounted = "1";
      JadeLeaderboard.mount(el, {});
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", auto);
  } else {
    auto();
  }
})(window);
