# Movie Night — setup

## 1. Create the Sheet
1. Create a new Google Sheet, name it anything (e.g. "Movie Night").
2. Extensions → Apps Script. Delete the placeholder code and paste in the contents of `Code.gs`.
3. Save. Click **Run** once on any function (e.g. `getState`) so Google asks you to authorize — accept it. This also auto-creates the four tabs (Members, ThisWeek, Reservations, Log) the first time any action runs.
4. Open the **Members** tab and paste in the starting roster (column A = Name, B = Points, C = FillerOptIn, D = LastPickDate):

   ```
   manwhat	0	no	
   drunkenmonkeystyle	0	no	
   Treguna Mekoides	0	no	
   ```

   (Paste starting at cell A2, tab-separated — most spreadsheet paste boxes handle tabs fine.)

## 2. Deploy the Apps Script as a Web App
1. In the Apps Script editor: **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**. Who has access: **Anyone**.
4. Deploy, authorize again if asked, then copy the **Web app URL** (ends in `/exec`).
5. **Important**: every time you edit `Code.gs` later, you need to **Deploy → Manage deployments → Edit → New version** — just saving the script doesn't update the live `/exec` URL.

## 3. Wire up the frontend
1. Open `movie-night/app.js` and replace `PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE` with the URL from step 2.4.

## 4. Publish to GitHub Pages
Just publish it to Github and Github Pages does the rest.


## Notes / things you'll likely want to hand-edit in the Sheet sometimes
- **Adding members later**: just add a row to Members directly, or use the `addMember` API action.
- **Re-zeroing someone / fixing a mistake**: just edit the Points cell directly in the Sheet — that's the whole point of this backend choice.
- **Attendance assumption**: the weekly resolve step gives +1 point to everyone *not* selected that week, on the assumption the whole roster attended. If someone skipped a week entirely, undo their point manually — the sheet doesn't currently track RSVPs/attendance, only picks.
- **"Clear the log** between weeks the log will get bigger and you'll need to clear it out!
