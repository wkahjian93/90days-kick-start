# 90Days Kick Start

Phone app for the 90-day new agent syllabus: agents submit homework, the leader reviews it, and reminders go out when training is due.

- `docs/`: the app (static PWA). `syllabus.js` is the syllabus from Trello, `logic.js` has the due-date and alert rules, `core.js` has the server rules, `demo.js` is sample mode, `app.js` is the screens.
- `server/gas.js`: the Google Apps Script storage (Sheet, Drive, Gmail). `node build.js` makes `server/Code.gs` = syllabus + logic + core + gas.
- `node test.js` runs the end-to-end rules test. `node serve.js` previews on http://localhost:5192.
- `node tools/bundle-sample.js` makes a one-file sample page in `sample/`.
- See `GUIDE.md` for how to use it and `SETUP SERVER.md` to connect Google.
