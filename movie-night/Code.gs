/**
 * Movie Night backend — bound Apps Script on a Google Sheet.
 * Deploy as Web App: Execute as "Me", Access "Anyone".
 * All actions go through doGet (see CORS note in README) using ?action=... params.
 *
 * Sheet tabs (created automatically if missing):
 *   Members       | Name | Points | FillerOptIn | LastPickDate
 *   ThisWeek      | Timestamp | Name | ClaimType | Status
 *   Reservations  | Date | Name | Status | BookedAt | PointsBefore
 *   Log           | Timestamp | Actor | Action | Detail
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
function thisWeekSheet()     { return sheetWithHeaders('ThisWeek', ['Timestamp', 'Name', 'ClaimType', 'Status']); }
function reservationsSheet() { return sheetWithHeaders('Reservations', ['Date', 'Name', 'Status', 'BookedAt', 'PointsBefore']); }
function logSheet()          { return sheetWithHeaders('Log', ['Timestamp', 'Actor', 'Action', 'Detail']); }

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
  thisWeekSheet().appendRow([new Date(), name, type === 'double' ? 'double' : 'single', 'pending']);
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

function cantMakeIt(name) {
  // Withdraw a WON slot from this week after resolution; reopen it.
  var rows = readRows(thisWeekSheet());
  var found = false;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Name === name && rows[i].Status === 'won') {
      thisWeekSheet().getRange(rows[i]._row, 4).setValue('withdrawn');
      found = true;
    }
  }
  if (!found) return { error: name + ' has no won slot to withdraw from' };
  logAction(name, 'cantMakeIt', 'slot reopened');
  return { reopened: true, state: getState() };
}

function override(actor, name, dateStr) {
  // Manual mod override: force-assign a slot to `name` for this week, logged visibly.
  if (!findMemberRow(name)) throw new Error('Unknown member: ' + name);
  thisWeekSheet().appendRow([new Date(), name, 'single', 'won']);
  var m = findMemberRow(name);
  logAction(actor || 'mod', 'override', 'forced slot for ' + name);
  setMemberPoints(name, 0);
  return getState();
}

/* ---------- weekly resolution ---------- */

function resolveWeek(actor, dateStr) {
  dateStr = dateStr || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var slotsLeft = SLOTS_PER_WEEK;
  var winners = [];

  // 1) Reservations for this date take priority.
  var resRows = readRows(reservationsSheet());
  for (var i = 0; i < resRows.length && slotsLeft > 0; i++) {
    if (resRows[i].Date === dateStr && resRows[i].Status === 'active') {
      reservationsSheet().getRange(resRows[i]._row, 3).setValue('used');
      winners.push({ name: resRows[i].Name, via: 'reservation' });
      slotsLeft -= 1;
    }
  }

  // 2) Rank pending claims by points desc, tie-break by earliest claim timestamp.
  var claims = readRows(thisWeekSheet()).filter(function (r) { return r.Status === 'pending'; });
  claims.forEach(function (c) {
    var m = findMemberRow(c.Name);
    c._points = m ? m.Points : 0;
  });
  claims.sort(function (a, b) {
    if (b._points !== a._points) return b._points - a._points;
    return new Date(a.Timestamp) - new Date(b.Timestamp);
  });

  var usedNames = winners.map(function (w) { return w.name; });
  for (var i = 0; i < claims.length && slotsLeft > 0; i++) {
    var c = claims[i];
    if (usedNames.indexOf(c.Name) !== -1) continue;
    if (c.ClaimType === 'double') {
      if (slotsLeft >= 2) {
        winners.push({ name: c.Name, via: 'claim-double' });
        thisWeekSheet().getRange(c._row, 4).setValue('won');
        slotsLeft -= 2;
      } else {
        thisWeekSheet().getRange(c._row, 4).setValue('bumped');
      }
    } else {
      winners.push({ name: c.Name, via: 'claim' });
      thisWeekSheet().getRange(c._row, 4).setValue('won');
      slotsLeft -= 1;
    }
    usedNames.push(c.Name);
  }

  // 3) Fill any remaining slots from the filler pool, ranked by points desc.
  if (slotsLeft > 0) {
    var fillers = readRows(membersSheet())
      .filter(function (m) { return m.FillerOptIn === 'yes' && usedNames.indexOf(m.Name) === -1; })
      .sort(function (a, b) { return b.Points - a.Points; });
    for (var i = 0; i < fillers.length && slotsLeft > 0; i++) {
      winners.push({ name: fillers[i].Name, via: 'filler' });
      thisWeekSheet().appendRow([new Date(), fillers[i].Name, 'single', 'won']);
      usedNames.push(fillers[i].Name);
      slotsLeft -= 1;
    }
  }

  // 4) Spend points for everyone who won via claim/filler (reservations already spent at booking time).
  winners.forEach(function (w) {
    if (w.via !== 'reservation') setMemberPoints(w.name, 0);
    var m = findMemberRow(w.name);
    if (m) membersSheet().getRange(m._row, 4).setValue(dateStr);
  });

  // 5) Everyone attending but not picking earns +1 point. We only know "attending" = members
  //    who didn't win — this assumes the full roster attends; adjust manually in the Sheet
  //    for people who skip a given week if you want strict accuracy.
  readRows(membersSheet()).forEach(function (m) {
    if (usedNames.indexOf(m.Name) === -1) {
      membersSheet().getRange(m._row, 2).setValue(m.Points + 1);
    }
  });

  logAction(actor || 'system', 'resolveWeek', dateStr + ' -> ' + JSON.stringify(winners) +
    (slotsLeft > 0 ? ' (UNFILLED: ' + slotsLeft + ')' : ''));

  return { winners: winners, unfilledSlots: slotsLeft, state: getState() };
}
