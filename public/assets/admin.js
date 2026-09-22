/* Exec score entry. Signing in posts the password to /api/admin/login,
   which sets an HttpOnly session cookie; the password never lives in this
   file or in the browser. Every other call rides that cookie. */

(function () {
  "use strict";

  var root = document.getElementById("admin");
  var state = {
    tiers: [],
    tier: null,        // board being scored
    addTier: null,     // board a new player joins
    boards: {},        // tier key -> players
    rounds: [],
    email: null,
    msg: null, bad: false, saving: false,
  };
  var draft = { note: "", date: today(), pts: {} };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n) { return Number(n).toLocaleString("en-CA"); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function nice(d) {
    var p = String(d).split("-");
    if (p.length !== 3) return d;
    var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return Number(p[2]) + " " + m[Number(p[1]) - 1];
  }
  function wr(p) { return p.win_rate === null || p.win_rate === undefined ? "no games" : p.win_rate + "% wins"; }
  function label(key) {
    var t = state.tiers.filter(function (x) { return x.key === key; })[0];
    return t ? t.label : key;
  }

  function api(path, opts) {
    return fetch("/api/admin" + path, Object.assign({
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin",
    }, opts || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw Object.assign(new Error(body.error || r.status), { body: body, status: r.status });
        return body;
      });
    });
  }

  function load() {
    api("/whoami").then(function (who) {
      state.email = who.email;
      state.tiers = who.tiers || [];
      if (!state.tier) state.tier = state.tiers[0] && state.tiers[0].key;
      if (!state.addTier) state.addTier = state.tier;
      return Promise.all(
        state.tiers.map(function (t) {
          return api("/standings?tier=" + encodeURIComponent(t.key)).then(function (r) {
            state.boards[t.key] = r.players;
          });
        }).concat([
          api("/rounds").then(function (r) { state.rounds = r.rounds; }),
        ])
      );
    }).then(function () {
      showSignOut(true);
      render();
    }).catch(function (err) {
      showSignOut(false);
      if (err.status === 401) {
        signInForm();
      } else if (err.status === 503) {
        fail("No exec password is set yet. On your computer, run:\n\nnpx wrangler secret put ADMIN_PASSWORD\n\nthen deploy again.");
      } else {
        fail("Could not reach the score API.");
      }
    });
  }

  function fail(text) {
    root.innerHTML = '<p class="msg bad" style="white-space:pre-wrap">' + esc(text) + "</p>";
  }

  function showSignOut(on) {
    var b = document.getElementById("signout");
    if (b) b.hidden = !on;
  }

  /* ---------------- sign in ---------------- */

  function signInForm(message) {
    root.innerHTML =
      '<div class="card signin">' +
      "<h2>Exec sign-in</h2>" +
      '<p class="note">Enter the club exec password to record scores.</p>' +
      (message ? '<p class="msg bad">' + esc(message) + "</p>" : "") +
      '<form id="loginform" autocomplete="on">' +
      '<label class="field" for="pw">Password' +
      '<input type="password" id="pw" name="password" autocomplete="current-password" required></label>' +
      '<button class="btn wide" type="submit">Sign in</button>' +
      "</form></div>";
    var f = document.getElementById("loginform");
    var input = document.getElementById("pw");
    if (input) input.focus();
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = f.querySelector("button");
      btn.disabled = true;
      btn.textContent = "Checking…";
      api("/login", { method: "POST", body: JSON.stringify({ password: input.value }) })
        .then(function () { state.msg = null; load(); })
        .catch(function (err) {
          var m = "That password is not right.";
          if (err.status === 429) m = (err.body && err.body.detail) || "Too many tries. Wait a few minutes.";
          if (err.status === 503) m = "No exec password is set on the server yet.";
          signInForm(m);
        });
    });
  }

  function signOut() {
    api("/logout", { method: "POST" }).catch(function () {}).then(function () {
      showSignOut(false);
      state.boards = {};
      state.rounds = [];
      signInForm();
    });
  }

  var soBtn = document.getElementById("signout");
  if (soBtn) soBtn.addEventListener("click", signOut);

  function capture() {
    var n = document.getElementById("note");
    var d = document.getElementById("date");
    if (n) draft.note = n.value;
    if (d) draft.date = d.value;
    Array.prototype.forEach.call(root.querySelectorAll("[data-pts]"), function (i) {
      draft.pts[i.getAttribute("data-pts")] = i.value;
    });
  }

  function seg(action, current) {
    return '<div class="seg">' + state.tiers.map(function (t) {
      return '<button data-act="' + action + '" data-id="' + esc(t.key) + '"' +
        (t.key === current ? ' class="on"' : "") + ">" + esc(t.label) + "</button>";
    }).join("") + "</div>";
  }

  function render() {
    var players = (state.boards[state.tier] || []).slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    var html = "";
    if (state.msg) html += '<p class="msg' + (state.bad ? " bad" : "") + '">' + esc(state.msg) + "</p>";
    html += '<p class="whoami">' +
      (state.email && state.email !== "exec" ? "Signed in as " + esc(state.email) : "Signed in as an exec") +
      "</p>";

    html += "<h2>Record a round</h2>";
    html += '<div class="card">';
    html += seg("tier", state.tier);
    if (!players.length) {
      html += '<p class="note">No players on the ' + esc(label(state.tier).toLowerCase()) + " board yet.</p>";
    } else {
      html += players.map(function (p) {
        return '<div class="entry"><span class="who">' + esc(p.name) + "</span>" +
          '<input type="number" step="1" data-pts="' + esc(p.id) + '" value="' +
          esc(draft.pts[p.id] || "") + '" placeholder="—" aria-label="Points for ' + esc(p.name) + '"></div>';
      }).join("");
      html += '<label class="field" style="margin-top:12px">Date<input type="date" id="date" value="' + esc(draft.date) + '"></label>';
      html += '<label class="field">Note (optional)<input type="text" id="note" value="' + esc(draft.note) + '" placeholder="Table 2, September meet"></label>';
      html += '<button class="btn wide" data-act="save"' + (state.saving ? " disabled" : "") + ">" +
        (state.saving ? "Saving…" : "Save " + esc(label(state.tier).toLowerCase()) + " round") + "</button>";
    }
    html += "</div>";

    html += "<h2>Add a player</h2>";
    html += '<div class="card">' + seg("addtier", state.addTier) +
      '<div class="inline"><input type="text" id="newname" placeholder="Full name" autocomplete="off">' +
      '<button class="btn ghost" data-act="add">Add</button></div></div>';

    state.tiers.forEach(function (t) {
      var list = state.boards[t.key] || [];
      if (!list.length) return;
      var other = state.tiers.filter(function (x) { return x.key !== t.key; })[0];
      html += "<h2>" + esc(t.label) + " standings</h2>";
      html += '<div class="card"><ul class="rows">' + list.map(function (p) {
        return "<li>" +
          '<span class="rk">' + p.rank + "</span>" +
          "<div>" + esc(p.name) + '<span class="sub">' + num(p.score) + " points · " +
          p.games + " games · " + wr(p) + "</span></div>" +
          '<button class="mini" data-act="rename" data-id="' + esc(p.id) + '">Rename</button>' +
          (other ? '<button class="mini" data-act="move" data-id="' + esc(p.id) +
            '" data-to="' + esc(other.key) + '">→ ' + esc(other.label) + "</button>" : "") +
          '<button class="mini warn" data-act="drop" data-id="' + esc(p.id) + '">Remove</button>' +
          "</li>";
      }).join("") + "</ul></div>";
    });

    if (state.rounds.length) {
      html += "<h2>Recent rounds</h2>";
      html += '<div class="card"><ul class="rows">' + state.rounds.map(function (r) {
        var summary = r.entries.map(function (e) {
          return e.name.split(" ")[0] + " " + (e.points > 0 ? "+" : "") + e.points;
        }).join(", ");
        return "<li><div>" + esc(summary) + '<span class="sub">' + esc(r.label || label(r.tier)) +
          " · " + esc(nice(r.played_on)) + (r.note ? " · " + esc(r.note) : "") +
          (r.created_by ? " · " + esc(r.created_by) : "") + "</span></div>" +
          '<button class="mini warn" data-act="undo" data-id="' + esc(r.id) + '">Undo</button></li>';
      }).join("") + "</ul></div>";
    }

    root.innerHTML = html;
  }

  function after(msg) { state.msg = msg; state.bad = false; state.saving = false; load(); }
  function oops(msg) { state.msg = msg; state.bad = true; state.saving = false; render(); }

  root.addEventListener("input", function (e) {
    if (e.target.id === "note" || e.target.id === "date" || e.target.hasAttribute("data-pts")) capture();
  });

  root.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    var id = btn.getAttribute("data-id");
    state.msg = null;

    if (act === "tier") { capture(); state.tier = id; render(); return; }
    if (act === "addtier") { state.addTier = id; render(); return; }

    if (act === "save") {
      capture();
      var board = state.boards[state.tier] || [];
      var deltas = [];
      board.forEach(function (p) {
        var raw = (draft.pts[p.id] || "").trim();
        if (raw === "") return;
        var v = Number(raw);
        if (!isFinite(v)) return;
        deltas.push([p.id, Math.round(v)]);
      });
      if (!deltas.length) return oops("Enter points for at least one player.");
      state.saving = true; render();
      api("/rounds", {
        method: "POST",
        body: JSON.stringify({
          tier: state.tier, deltas: deltas,
          note: draft.note.trim(), played_on: draft.date,
        }),
      }).then(function () {
        draft = { note: "", date: today(), pts: {} };
        after(label(state.tier) + " round saved.");
      }).catch(function () { oops("The round did not save."); });
      return;
    }

    if (act === "add") {
      var f = document.getElementById("newname");
      var name = f ? f.value.trim() : "";
      if (!name) return oops("Type a name first.");
      api("/players", { method: "POST", body: JSON.stringify({ name: name, tier: state.addTier }) })
        .then(function () { after(name + " added to the " + label(state.addTier).toLowerCase() + " board."); })
        .catch(function () { oops("Could not add that player."); });
      return;
    }

    if (act === "rename") {
      var cur = findPlayer(id);
      if (!cur) return;
      var nn = prompt("New name for " + cur.name, cur.name);
      if (!nn || !nn.trim() || nn.trim() === cur.name) return;
      api("/players/" + encodeURIComponent(id), {
        method: "PATCH", body: JSON.stringify({ name: nn.trim() }),
      }).then(function () { after("Name updated."); })
        .catch(function () { oops("Could not rename."); });
      return;
    }

    if (act === "move") {
      var to = btn.getAttribute("data-to");
      var mv = findPlayer(id);
      if (!mv || !to) return;
      if (!confirm("Move " + mv.name + " to the " + label(to).toLowerCase() +
        " board? They start that board at zero — the points they earned here do not follow them.")) return;
      api("/players/" + encodeURIComponent(id), {
        method: "PATCH", body: JSON.stringify({ tier: to }),
      }).then(function () { after(mv.name + " moved to " + label(to).toLowerCase() + "."); })
        .catch(function () { oops("Could not move that player."); });
      return;
    }

    if (act === "drop") {
      var p0 = findPlayer(id);
      if (!p0) return;
      if (!confirm("Take " + p0.name + " off the board? Past rounds are kept.")) return;
      api("/players/" + encodeURIComponent(id), { method: "DELETE" })
        .then(function () { after(p0.name + " removed."); })
        .catch(function () { oops("Could not remove."); });
      return;
    }

    if (act === "undo") {
      if (!confirm("Undo this round? The points come back off.")) return;
      api("/rounds/" + encodeURIComponent(id), { method: "DELETE" })
        .then(function () { after("Round undone."); })
        .catch(function () { oops("Could not undo."); });
      return;
    }
  });

  function findPlayer(id) {
    for (var k in state.boards) {
      var hit = (state.boards[k] || []).filter(function (p) { return p.id === id; })[0];
      if (hit) return hit;
    }
    return null;
  }

  load();
})();
