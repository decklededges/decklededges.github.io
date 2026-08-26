/**
 * Movie Night backend — bound Apps Script on a Google Sheet.
 * Deploy as Web App: Execute as "Me", Access "Anyone".
 * All actions go through doGet (see CORS note in README) using ?action=... params.
 *
 * Sheet tabs (created automatically if missing):
 *   Members       | Name | Points | FillerOptIn | LastPickDate
 *   ThisWeek      | Timestamp | Name | ClaimType | Status | PointsAtWin
 *   Reservations  | Date | Name | Status | BookedAt | PointsBefore
 *   Log           | Timestamp | Actor | Action | Detail
 *   Settings      | Key | Value   (hand-edited, see settingsSheet() below)
 */

var SLOTS_PER_WEEK = 2;

function doGet(e) {
  var action = (e.parameter.action || '').trim();
  var result;
  try {
    switch (action) {
      case 'getState':
        result = getState();
        break;
      case 'claim':
        result = claim(e.parameter.name, e.parameter.type || 'single');
        break;
      case 'cancelClaim':
        result = cancelClaim(e.parameter.name);
        break;
      case 'cantMakeIt':
        result = cantMakeIt(e.parameter.name);
        break;
      case 'toggleFiller':
        result = toggleFiller(e.parameter.name);
        break;
      case 'reserve':
        result = reserve(e.parameter.name, e.parameter.date);
        break;
      case 'cancelReservation':
        result = cancelReservation(e.parameter.name, e.parameter.date);
        break;
      case 'resolveWeek':
        result = resolveWeek(e.parameter.actor, e.parameter.date);
        break;
      case 'override':
        result = override(e.parameter.actor, e.parameter.name, e.parameter.date);
        break;
      case 'startNewWeek':
        result = startNewWeek(e.parameter.actor);
        break;
      case 'addMember':
        result = addMember(e.parameter.name);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- sheet helpers ---------- */

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheetWithHeaders(name, headers) {
  var s = ss().getSheetByName(name);
  if (!s) {
    s = ss().insertSheet(name);
    s.appendRow(headers);
  }
  return s;
}

function membersSheet()      { return sheetWithHeaders('Members', ['Name', 'Points', 'FillerOptIn', 'LastPickDate']); }
function thisWeekSheet()     { return sheetWithHeaders('ThisWeek', ['Timestamp', 'Name', 'ClaimType', 'Status', 'PointsAtWin']); }
function reservationsSheet() { return sheetWithHeaders('Reservations', ['Date', 'Name', 'Status', 'BookedAt', 'PointsBefore']); }
function logSheet()          { return sheetWithHeaders('Log', ['Timestamp', 'Actor', 'Action', 'Detail']); }

/**
 * Settings tab — a plain Key/Value sheet you edit by hand. Not exposed through
 * the web app UI on purpose. Missing keys are auto-seeded with defaults the
 * first time they're read, so you never NEED to touch this tab, only if you
 * want to change behaviour. Currently supported keys:
 *
 *   GambleMode: "yes" | "no" (default "no")
 *     When "yes", the weekly claim ranking (and any post-withdrawal reroll)
 *     is a points-weighted random draw instead of strict points-desc
 *     ordering — e.g. 49/49/2 points gives roughly 49%/49%/2% odds.
 *
 *   WinnerCost: 0–1 (default 1)
 *     Fraction of points taken from someone who wins a slot via a normal
 *     claim (single or double) or a mod override. 1 = full reset to 0,
 *     as it's always worked; 0.5 = half taken; 0 = free.
 *
 *   FillerCost: 0–1 (default 1)
 *     Same idea, but for someone auto-picked from the filler pool because
 *     nobody else claimed. Kept separate from WinnerCost since filling in
 *     is a more passive role and the group may want it to cost less.
 */
var SETTINGS_DEFAULTS = { GambleMode: 'no', WinnerCost: '1', FillerCost: '1' };

function settingsSheet() {
  var s = sheetWithHeaders('Settings', ['Key', 'Value']);
  var existing = readRows(s).map(function (r) { return r.Key; });
  Object.keys(SETTINGS_DEFAULTS).forEach(function (k) {
    if (existing.indexOf(k) === -1) s.appendRow([k, SETTINGS_DEFAULTS[k]]);
  });
  return s;
}

function getSetting(key) {
  var rows = readRows(settingsSheet());
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Key === key) return rows[i].Value;
  }
  return SETTINGS_DEFAULTS[key] || '';
}

function getRatioSetting(key) {
  var v = parseFloat(getSetting(key));
  if (isNaN(v)) v = 1;
  return Math.min(1, Math.max(0, v));
}

/** Points-weighted random draw order (used only when GambleMode is "yes"). */
function weightedOrder(list) {
  var pool = list.slice();
  var order = [];
  while (pool.length) {
    var totalWeight = pool.reduce(function (s, c) { return s + Math.max(c._points, 0); }, 0);
    var pick;
    if (totalWeight <= 0) {
      pick = pool[Math.floor(Math.random() * pool.length)];
    } else {
      var r = Math.random() * totalWeight;
      var cum = 0;
      for (var i = 0; i < pool.length; i++) {
        cum += Math.max(pool[i]._points, 0);
        if (r <= cum) { pick = pool[i]; break; }
      }
      if (!pick) pick = pool[pool.length - 1];
    }
    order.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return order;
}

function readRows(sheet) {
  var vals = sheet.getDataRange().getValues();
  var headers = vals[0];
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var obj = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = vals[i][j];
    rows.push(obj);
  }
  return rows;
}

function logAction(actor, action, detail) {
  logSheet().appendRow([new Date(), actor || 'unknown', action, detail || '']);
}

function findMemberRow(name) {
  var rows = readRows(membersSheet());
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Name === name) return rows[i];
  }
  return null;
}

function setMemberPoints(name, points) {
  var m = findMemberRow(name);
  if (!m) throw new Error('Unknown member: ' + name);
  membersSheet().getRange(m._row, 2).setValue(points);
}

function setMemberLastPick(name, dateStr) {
  var m = findMemberRow(name);
  if (m && dateStr) membersSheet().getRange(m._row, 4).setValue(dateStr);
}

/**
 * Marks a ThisWeek claim row as won: records the points they had going in
 * (so a later withdrawal can refund exactly that), then applies the given
 * cost ratio (WinnerCost or FillerCost) to their points.
 */
function markClaimWon(claimRow, ratio) {
  var pts = findMemberRow(claimRow.Name).Points;
  thisWeekSheet().getRange(claimRow._row, 4).setValue('won');
  thisWeekSheet().getRange(claimRow._row, 5).setValue(pts);
  setMemberPoints(claimRow.Name, pts * (1 - ratio));
}

/* ---------- actions ---------- */

function getState() {
  return {
    members: readRows(membersSheet()),
    thisWeek: readRows(thisWeekSheet()).filter(function (r) { return r.Status !== 'cancelled'; }),
    reservations: readRows(reservationsSheet()).filter(function (r) { return r.Status === 'active' || r.Status === 'used'; }),
    log: readRows(logSheet()).slice(-40).reverse()
  };
}

function addMember(name) {
  if (!name) throw new Error('name required');
  if (findMemberRow(name)) return { error: 'Member already exists' };
  membersSheet().appendRow([name, 0, 'no', '']);
  logAction(name, 'joined', 'added to roster');
  return getState();
}

function claim(name, type) {
  if (!findMemberRow(name)) throw new Error('Unknown member: ' + name);
  var rows = readRows(thisWeekSheet());
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Name === name && rows[i].Status !== 'cancelled') {
      return { error: name + ' has already claimed this week' };
    }
  }
  thisWeekSheet().appendRow([new Date(), name, type === 'double' ? 'double' : 'single', 'pending', '']);
  logAction(name, 'claim', type === 'double' ? 'double slot' : 'single slot');
  return getState();
}

function cancelClaim(name) {
  var rows = readRows(thisWeekSheet());
  var found = false;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Name === name && rows[i].Status !== 'cancelled') {
      thisWeekSheet().getRange(rows[i]._row, 4).setValue('cancelled');
      found = true;
    }
  }
  if (found) logAction(name, 'cancelClaim', '');
  return getState();
}

function toggleFiller(name) {
  var m = findMemberRow(name);
  if (!m) throw new Error('Unknown member: ' + name);
  var newVal = (m.FillerOptIn === 'yes') ? 'no' : 'yes';
  membersSheet().getRange(m._row, 3).setValue(newVal);
  logAction(name, 'toggleFiller', newVal);
  return getState();
}

function reserve(name, dateStr) {
  if (!findMemberRow(name)) throw new Error('Unknown member: ' + name);
  var rows = readRows(reservationsSheet());
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Date === dateStr && rows[i].Status === 'active') {
      return { error: 'That date is already reserved by ' + rows[i].Name };
    }
  }
  var m = findMemberRow(name);
  var before = m.Points;
  reservationsSheet().appendRow([dateStr, name, 'active', new Date(), before]);
  setMemberPoints(name, 0);
  logAction(name, 'reserve', dateStr + ' (points reset from ' + before + ')');
  return getState();
}

function cancelReservation(name, dateStr) {
  var rows = readRows(reservationsSheet());
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Date === dateStr && rows[i].Name === name && rows[i].Status === 'active') {
      reservationsSheet().getRange(rows[i]._row, 3).setValue('cancelled');
      var refund = rows[i].PointsBefore;
      var m = findMemberRow(name);
      setMemberPoints(name, Math.max(m.Points, refund));
      logAction(name, 'cancelReservation', dateStr + ' (points refunded to ' + refund + ')');
      return getState();
    }
  }
  return { error: 'No active reservation found for ' + name + ' on ' + dateStr };
}

function override(actor, name, dateStr) {
  // Manual mod override: force-assign a slot to `name` for this week, logged visibly.
  // Costs points exactly like a normal claim win (WinnerCost), and records
  // PointsAtWin so a later withdrawal can still be refunded correctly.
  if (!findMemberRow(name)) throw new Error('Unknown member: ' + name);
  thisWeekSheet().appendRow([new Date(), name, 'single', 'pending', '']);
  var rows = readRows(thisWeekSheet());
  var row = rows[rows.length - 1];
  markClaimWon(row, getRatioSetting('WinnerCost'));
  setMemberLastPick(name, dateStr || todayStr());
  logAction(actor || 'mod', 'override', 'forced slot for ' + name);
  return getState();
}

function todayStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ---------- withdrawal + replacement ---------- */

function cantMakeIt(name) {
  var rows = readRows(thisWeekSheet());
  var wonRow = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Name === name && rows[i].Status === 'won') { wonRow = rows[i]; break; }
  }
  if (!wonRow) return { error: name + ' has no won slot to withdraw from' };

  var slotsFreed = (wonRow.ClaimType === 'double') ? 2 : 1;
  thisWeekSheet().getRange(wonRow._row, 4).setValue('withdrawn');

  var refundTo = wonRow.PointsAtWin || 0;
  var m = findMemberRow(name);
  setMemberPoints(name, Math.max(m.Points, refundTo));
  logAction(name, 'cantMakeIt', slotsFreed + ' slot(s) reopened, refunded to ' + refundTo);

  var fillResult = fillSlots(slotsFreed, [name], todayStr());
  logAction(name, 'autoReplacement', JSON.stringify(fillResult.winners) +
    (fillResult.unfilledSlots > 0 ? ' (UNFILLED: ' + fillResult.unfilledSlots + ')' : ''));

  return { reopened: true, replacement: fillResult.winners, unfilledSlots: fillResult.unfilledSlots, state: getState() };
}

/**
 * Fills `slotsNeeded` open slots from this week's claim pool, then the filler
 * pool if claims run out. Shared by resolveWeek (the initial weekly fill) and
 * cantMakeIt (refilling a slot someone withdrew from).
 *
 * The claim pool is anyone in ThisWeek with status 'pending' or 'bumped' —
 * 'bumped' is included so that people who lost the original ranking are
 * automatically back in the running if a slot reopens later, rather than
 * needing to reclaim.
 *
 * Ranking uses GambleMode if it's on, otherwise points desc / longest-since-
 * pick / earliest-timestamp, same rules either way this function is called
 * from. Claim wins cost WinnerCost; filler wins cost FillerCost.
 */
function fillSlots(slotsNeeded, excludeNames, dateStr) {
  excludeNames = excludeNames || [];
  var winners = [];
  if (slotsNeeded <= 0) return { winners: winners, unfilledSlots: 0 };

  var pool = readRows(thisWeekSheet()).filter(function (r) {
    return (r.Status === 'pending' || r.Status === 'bumped') && excludeNames.indexOf(r.Name) === -1;
  });
  pool.forEach(function (c) {
    var m = findMemberRow(c.Name);
    c._points = m ? m.Points : 0;
    c._lastPick = (m && m.LastPickDate) ? new Date(m.LastPickDate) : new Date(0);
  });

  var ordered = (getSetting('GambleMode') === 'yes')
    ? weightedOrder(pool)
    : pool.slice().sort(function (a, b) {
        if (b._points !== a._points) return b._points - a._points;
        if (a._lastPick - b._lastPick !== 0) return a._lastPick - b._lastPick;
        return new Date(a.Timestamp) - new Date(b.Timestamp);
      });

  var winnerCost = getRatioSetting('WinnerCost');
  var usedNames = [];
  var slotsLeft = slotsNeeded;

  ordered.forEach(function (c) {
    if (slotsLeft <= 0 || usedNames.indexOf(c.Name) !== -1) return;
    if (c.ClaimType === 'double') {
      if (slotsLeft >= 2) {
        markClaimWon(c, winnerCost);
        winners.push({ name: c.Name, via: 'claim-double' });
        usedNames.push(c.Name);
        slotsLeft -= 2;
      }
      // else: leave for the "still not picked -> bumped" sweep below.
    } else {
      markClaimWon(c, winnerCost);
      winners.push({ name: c.Name, via: 'claim' });
      usedNames.push(c.Name);
      slotsLeft -= 1;
    }
  });

  // Anyone from the pool not picked this round is (still) bumped.
  pool.forEach(function (c) {
    if (usedNames.indexOf(c.Name) === -1 && c.Status !== 'bumped') {
      thisWeekSheet().getRange(c._row, 4).setValue('bumped');
    }
  });

  if (slotsLeft > 0) {
    var fillerCost = getRatioSetting('FillerCost');
    var fillers = readRows(membersSheet())
      .filter(function (m) { return m.FillerOptIn === 'yes' && usedNames.indexOf(m.Name) === -1; })
      .sort(function (a, b) { return b.Points - a.Points; });
    for (var i = 0; i < fillers.length && slotsLeft > 0; i++) {
      var pointsAtWin = fillers[i].Points;
      thisWeekSheet().appendRow([new Date(), fillers[i].Name, 'single', 'won', pointsAtWin]);
      setMemberPoints(fillers[i].Name, pointsAtWin * (1 - fillerCost));
      usedNames.push(fillers[i].Name);
      winners.push({ name: fillers[i].Name, via: 'filler' });
      slotsLeft -= 1;
    }
  }

  if (dateStr) {
    winners.forEach(function (w) { setMemberLastPick(w.name, dateStr); });
  }

  return { winners: winners, unfilledSlots: slotsLeft };
}

/* ---------- weekly resolution ---------- */

function startNewWeek(actor) {
  // Archives every ThisWeek row into the Log, then wipes ThisWeek clean so
  // claim() stops seeing stale 'won'/'bumped'/'withdrawn' rows and blocking
  // people from claiming again. Call this once the event is actually over —
  // there's no time-based or auto-clear, by design (matches resolveWeek).
  var rows = readRows(thisWeekSheet());
  rows.forEach(function (r) {
    logAction(actor || 'system', 'archiveThisWeek', r.Name + ' | ' + r.ClaimType + ' | ' + r.Status);
  });
  var sheet = thisWeekSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 5).clearContent();
  logAction(actor || 'system', 'startNewWeek', 'board cleared for next week');
  return getState();
}

function resolveWeek(actor, dateStr) {
  dateStr = dateStr || todayStr();
  var slotsLeft = SLOTS_PER_WEEK;
  var winners = [];

  // 1) Reservations for this date take priority.
  var resRows = readRows(reservationsSheet());
  for (var i = 0; i < resRows.length && slotsLeft > 0; i++) {
    if (resRows[i].Date === dateStr && resRows[i].Status === 'active') {
      reservationsSheet().getRange(resRows[i]._row, 3).setValue('used');
      winners.push({ name: resRows[i].Name, via: 'reservation' });
      setMemberLastPick(resRows[i].Name, dateStr);
      slotsLeft -= 1;
    }
  }

  // 2) Claims, then filler pool, for whatever slots are left.
  var reservedNames = winners.map(function (w) { return w.name; });
  var fillResult = fillSlots(slotsLeft, reservedNames, dateStr);
  winners = winners.concat(fillResult.winners);

  // 3) Everyone attending but not picking earns +1 point. We only know "attending" = members
  //    who didn't win — this assumes the full roster attends; adjust manually in the Sheet
  //    for people who skip a given week if you want strict accuracy.
  var winnerNames = winners.map(function (w) { return w.name; });
  readRows(membersSheet()).forEach(function (m) {
    if (winnerNames.indexOf(m.Name) === -1) {
      membersSheet().getRange(m._row, 2).setValue(m.Points + 1);
    }
  });

  logAction(actor || 'system', 'resolveWeek', dateStr + ' -> ' + JSON.stringify(winners) +
    (fillResult.unfilledSlots > 0 ? ' (UNFILLED: ' + fillResult.unfilledSlots + ')' : ''));

  return { winners: winners, unfilledSlots: fillResult.unfilledSlots, state: getState() };
}