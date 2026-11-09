/* Shared rules: due dates, item states, agent health and alerts.
   Used by the app, the demo server, the Google server (copied in by build.js) and test.js.
   Dates are 'YYYY-MM-DD' strings in Malaysia time. */
var KS = (function () {
  var SOON_DAYS = 3;          // "due soon" window, and how early to warn about arranging training
  var DAY = 86400000;

  function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
  function addDays(s, n) { return new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY); }
  function todayMYT(now) { return new Date((now || new Date()).getTime() + 8 * 3600000).toISOString().slice(0, 10); }

  // Day 1 is the start date, so an item due on day 7 is due 6 days after the start date.
  function dueDate(agent, item) { return validDate(agent.start) ? addDays(agent.start, item.due - 1) : null; }
  function dayNumber(agent, today) { return validDate(agent.start) ? diffDays(agent.start, today) + 1 : null; }

  /* state of one item for one agent:
     approved | submitted | redo | overdue | soon | open | goal (awards not yet achieved) */
  function itemState(agent, item, prog, today) {
    var st = prog && prog.status;
    if (st === 'approved') return 'approved';
    if (st === 'submitted') return 'submitted';
    if (st === 'redo') return 'redo';
    if (item.kind === 'award') return 'goal';
    var due = dueDate(agent, item);
    if (!due) return 'open';
    var left = diffDays(today, due);
    if (left < 0) return 'overdue';
    if (left <= SOON_DAYS) return 'soon';
    return 'open';
  }

  function progressMap(progress, agentId) {
    var m = {};
    (progress || []).forEach(function (p) { if (p.agentId === agentId) m[p.itemId] = p; });
    return m;
  }

  // Cards for one agent: team-wide cards plus cards the leader added only for them.
  function forAgent(syllabus, agent) { return syllabus.filter(function (it) { return !it.agentId || it.agentId === agent.id; }); }

  function summary(agent, syllabus, progress, today) {
    syllabus = forAgent(syllabus, agent);
    var pm = progressMap(progress, agent.id), req = 0, done = 0, overdue = 0, waiting = 0, redo = 0, worstLate = 0, awards = 0;
    var known = {};
    syllabus.forEach(function (it) {
      known[it.id] = 1;
      var s = itemState(agent, it, pm[it.id], today);
      if (it.kind === 'award') { if (s === 'approved') awards++; return; }
      req++;
      if (s === 'approved') done++;
      if (s === 'submitted') waiting++;
      if (s === 'redo') redo++;
      if (s === 'overdue' || (s === 'redo' && dueDate(agent, it) < today)) {
        overdue++;
        worstLate = Math.max(worstLate, diffDays(dueDate(agent, it), today));
      }
    });
    var unmatched = Object.keys(pm).filter(function (k) { return !known[k]; }).length;
    var day = dayNumber(agent, today);
    var health = !validDate(agent.start) ? 'nostart'
      : day < 1 ? 'notyet'
      : done === req ? 'complete'
      : (overdue >= 3 || worstLate > 7) ? 'risk'
      : overdue > 0 ? 'behind' : 'ontrack';
    return {
      required: req, done: done, pct: req ? Math.round(done * 100 / req) : 0,
      overdue: overdue, waiting: waiting, redo: redo, awards: awards, unmatched: unmatched,
      day: day, week: day == null ? null : Math.min(12, Math.max(1, Math.ceil(day / 7))),
      health: health, nextTraining: nextTraining(agent, syllabus, pm, today)
    };
  }

  // The first week that still has training not approved: that is the session to arrange next.
  function nextTraining(agent, syllabus, pm, today) {
    for (var w = 1; w <= 12; w++) {
      var open = syllabus.filter(function (it) { return it.wk === w && it.kind === 'training' && !(pm[it.id] && pm[it.id].status === 'approved'); });
      if (open.length) {
        var due = dueDate(agent, open[0]);
        return {wk: w, items: open.map(function (it) { return it.title; }), due: due, daysLeft: due ? diffDays(today, due) : null};
      }
    }
    return null;
  }

  /* Alerts for the leader (all agents) or one agent.
     type: arrange | review | overdue | redo | soon | nostart */
  function alerts(agents, syllabus, progress, today, forAgentId) {
    var out = [];
    agents.forEach(function (a) {
      if (a.active === false || (forAgentId && a.id !== forAgentId)) return;
      if (!validDate(a.start)) { if (!forAgentId) out.push({type: 'nostart', agent: a}); return; }
      var pm = progressMap(progress, a.id), sm = summary(a, syllabus, progress, today);
      if (sm.health === 'complete' || sm.day < 1) return;
      var nt = sm.nextTraining;
      if (nt && nt.daysLeft != null && nt.daysLeft <= SOON_DAYS) out.push({type: 'arrange', agent: a, wk: nt.wk, due: nt.due, daysLeft: nt.daysLeft, items: nt.items});
      forAgent(syllabus, a).forEach(function (it) {
        var s = itemState(a, it, pm[it.id], today), due = dueDate(a, it);
        if (s === 'submitted' && !forAgentId) out.push({type: 'review', agent: a, item: it});
        else if (s === 'redo') out.push({type: 'redo', agent: a, item: it, comment: pm[it.id].comment || ''});
        // Training sessions are covered by the single "arrange" alert for their week.
        else if (s === 'overdue' && it.kind !== 'training') out.push({type: 'overdue', agent: a, item: it, due: due, late: diffDays(due, today)});
        else if (s === 'soon' && forAgentId && it.kind !== 'training') out.push({type: 'soon', agent: a, item: it, due: due, daysLeft: diffDays(today, due)});
      });
    });
    var rank = {arrange: 0, review: 1, redo: 2, overdue: 3, soon: 4, nostart: 5};
    return out.sort(function (x, y) { return rank[x.type] - rank[y.type]; });
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function nice(d) { return validDate(d) ? (+d.slice(8)) + ' ' + MON[+d.slice(5, 7) - 1] : '—'; }
  function list(items) { return items.length > 3 ? items.slice(0, 3).join(', ') + ' +' + (items.length - 3) + ' more' : items.join(', '); }

  function weekLabel(wk, names) { return (names && names[wk]) || ('Week ' + wk); }

  // mine = written to the agent themself; leaderName is used in that case
  function alertText(al, names, mine, leaderName) {
    var who = al.agent.name;
    if (mine) switch (al.type) {
      case 'arrange': return 'Book your ' + weekLabel(al.wk, names) + ' training with ' + (leaderName || 'your leader') + ' by ' + nice(al.due) + (al.daysLeft < 0 ? ' (' + (-al.daysLeft) + ' days late)' : '') + ': ' + list(al.items);
      case 'redo': return 'Redo "' + al.item.title + '"' + (al.comment ? ': ' + al.comment : '');
      case 'overdue': return '"' + al.item.title + '" is overdue by ' + al.late + ' day' + (al.late === 1 ? '' : 's');
    }
    switch (al.type) {
      case 'arrange': return 'Arrange ' + weekLabel(al.wk, names) + ' training for ' + who + ' by ' + nice(al.due) + (al.daysLeft < 0 ? ' (' + (-al.daysLeft) + ' days late)' : '') + ': ' + list(al.items);
      case 'review': return who + ' submitted "' + al.item.title + '": review it';
      case 'redo': return who + ': redo "' + al.item.title + '"' + (al.comment ? ' (' + al.comment + ')' : '');
      case 'overdue': return who + ': "' + al.item.title + '" overdue by ' + al.late + ' day' + (al.late === 1 ? '' : 's');
      case 'soon': return '"' + al.item.title + '" due ' + nice(al.due) + (al.daysLeft === 0 ? ' (today)' : ' (in ' + al.daysLeft + ' days)');
      case 'nostart': return who + ' has no start date, so no due dates can be set';
    }
    return '';
  }

  return {validDate: validDate, addDays: addDays, diffDays: diffDays, todayMYT: todayMYT, dueDate: dueDate, dayNumber: dayNumber,
    itemState: itemState, progressMap: progressMap, forAgent: forAgent, summary: summary, alerts: alerts, alertText: alertText, weekLabel: weekLabel, nice: nice, list: list, SOON_DAYS: SOON_DAYS};
})();

if (typeof module !== 'undefined') module.exports = KS;
