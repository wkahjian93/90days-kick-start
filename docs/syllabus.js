/* 90Days Kick Start syllabus, taken from the Trello board "Sheldon Kick Start" on 2026-11-04.
   Each item's id is permanent: progress is saved against it, so never reuse or renumber an id.
   To retire an item, delete it here; its saved progress is kept but no longer shown.

   wk:   0 = Setup, 1-11 = Week 1-11, 12 = Last Week, 13 = Goals & Awards
   kind: task | training | homework | award
   due:  day number counted from the agent's start date (day 1 = start date)
*/
var S = 'https://sites.google.com/view/kjgroup/home/';
var SYLLABUS_VERSION = '2026-11-04';
var WEEK_NAMES = {0: 'Setup', 12: 'Last Week', 13: 'Goals & Awards'};
var PROSPECT5 = 'Homework- 5 Prospect open/present/follow up or joinfield';

var SYLLABUS = [
  // Setup ("To do lists" on Trello). Due days for s1 and s3 are app defaults, not from Trello.
  {id: 's1', wk: 0, kind: 'task', due: 3, title: 'Register SG Member', desc: 'Download the app from www.sg.com.my and register.', checks: ['Done Register']},
  {id: 's2', wk: 0, kind: 'task', due: 180, title: 'Complete PEPY1 within 6 months', checks: ['M1', 'M2', 'M3']},
  {id: 's3', wk: 0, kind: 'task', due: 30, title: 'Complete Mandatory TCF', desc: 'Complete them so you can sell products. Study and follow the link below.', links: [{t: 'TCF', u: S + 'new-agent-kick-start/tcf'}]},

  // Week 1
  {id: 'w1a', wk: 1, kind: 'training', title: 'Commission, Promotion, Career Path and Contest', links: [{t: 'Commission Structure', u: S + 'recruitment/commission-structure'}, {t: 'Promotion Guideline', u: S + 'um-gm-promotion'}]},
  {id: 'w1b', wk: 1, kind: 'training', title: 'Mutual Expectation', desc: '1. Weekly Night Meeting purpose and value\n2. Reason to join and what you expect from us\n3. What we expect from you\n4. We are your friend and senior in this industry, we respect each other.\n5. What and why is SUPER GROUP\n6. Our Team Vision and Mission\n事事有交代，万事好商量'},
  {id: 'w1c', wk: 1, kind: 'training', title: 'Goal Setting'},
  {id: 'w1d', wk: 1, kind: 'training', title: 'Understanding MAE', desc: 'M (Market) x A (Activity) x E (Efficiency) = ANP (result)\nCase Size x No. of Presentations x Closing Ratio = ANP', links: [{t: 'MAE', u: S + 'new-agent-kick-start/mae'}]},
  {id: 'w1e', wk: 1, kind: 'homework', title: 'Prospect 100 ABC', desc: '准备你的最少 100 个 prospect lists, 区分 Prospect A, B, C.\nProspect A: 一定会给你机会的人\nProspect B: 熟悉的人，但不一定给你机会的人\nProspect C: 认识但不熟悉，也不一定给你机会的人\n然后所有 prospect 标记 Age, Occupation, Relationship, 方便 IO 分析市场和 approaching method'},
  {id: 'w1f', wk: 1, kind: 'homework', title: 'Negative Insurance Feedback (minimum 10)'},

  // Week 2
  {id: 'w2a', wk: 2, kind: 'training', title: 'Negative Insurance Feedback'},
  {id: 'w2b', wk: 2, kind: 'training', title: 'Product training briefing', links: [{t: 'Fundamental', u: S + 'new-agent-kick-start/fundamental'}]},
  {id: 'w2c', wk: 2, kind: 'training', title: 'MPOS / Quotation', links: [{t: 'MPOS generate quotation', u: S + 'new-agent-kick-start/mpos-generate-quotation'}]},
  {id: 'w2d', wk: 2, kind: 'training', title: 'Understanding Sales Cycle OPFCR & Presentation Flow RDRC', desc: 'Sales Cycle: OPFCR\nPresentation Flow: Relax - Disturb - Release - Close', links: [{t: 'Sales Cycle', u: S + 'sales-cycle'}, {t: 'Presentation Flow', u: S + 'sales-cycle/presentation'}]},
  {id: 'w2e', wk: 2, kind: 'training', title: 'Sales Cycle (O) Open', desc: 'Learn the standard open script, then write your own open script.', links: [{t: 'Standard Open script', u: S + 'sales-cycle/open'}], summary: true},
  {id: 'w2f', wk: 2, kind: 'training', title: 'Self Introduction', desc: 'Understand the Relax part. Write your own solid reason: why do I become an insurance agent?', links: [{t: 'Self Introduction video', u: 'https://youtu.be/dBLQBI6FCkE'}], summary: true},
  {id: 'w2g', wk: 2, kind: 'training', title: 'Sales Cycle (P) CFF & T-presentation', desc: 'Disturb and release: CFF survey & T-presentation', links: [{t: 'CFF survey', u: S + 'sales-cycle/presentation/cff-survey'}]},
  {id: 'w2h', wk: 2, kind: 'homework', title: '5 Trial Prospect A open and survey', checks: ['Prospect 1', 'Prospect 2', 'Prospect 3', 'Prospect 4', 'Prospect 5']},
  {id: 'w2i', wk: 2, kind: 'homework', title: 'Insurance Basic Concept Selling videos', links: [{t: 'Medical protection', u: S + 'sales-cycle/presentation/medical-protection'}]},
  {id: 'w2j', wk: 2, kind: 'homework', title: 'Prepare 10 Objections'},

  // Week 3
  {id: 'w3a', wk: 3, kind: 'training', title: 'Objection Handling', links: [{t: 'Objection Handling', u: S + 'sales-cycle/objection-handling'}]},
  {id: 'w3b', wk: 3, kind: 'training', title: 'Review on concept selling', summary: true},
  {id: 'w3c', wk: 3, kind: 'training', title: 'Role Play Open'},
  {id: 'w3d', wk: 3, kind: 'training', title: 'Role Play Self Introduction'},
  {id: 'w3e', wk: 3, kind: 'training', title: 'Role Play CFF survey & T-presentation'},
  {id: 'w3f', wk: 3, kind: 'homework', title: PROSPECT5 + '/ Case Study'},

  // Week 4
  {id: 'w4a', wk: 4, kind: 'training', title: 'Product Training (Protection)', links: [{t: 'Income protection concept selling', u: S + 'sales-cycle/presentation/income-protection'}, {t: 'Product release', u: S + 'sales-cycle/presentation/protection-release'}], summary: true},
  {id: 'w4b', wk: 4, kind: 'training', title: 'Claim', links: [{t: 'Claim process', u: S + 'claim-process'}], summary: true},
  {id: 'w4c', wk: 4, kind: 'homework', title: PROSPECT5 + '/ Case Study'},

  // Week 5
  {id: 'w5a', wk: 5, kind: 'training', title: 'Product Training (Savings and Legacy)', desc: 'Try playing around with your MPOS quotation on various products.', links: [{t: 'Saving plan concept selling', u: S + 'sales-cycle/presentation/assurance-saving'}, {t: 'Saving plan product release', u: S + 'sales-cycle/presentation/saving-release'}, {t: 'Legacy planning concept selling', u: S + 'sales-cycle/presentation/legacy-planning'}]},
  {id: 'w5b', wk: 5, kind: 'training', title: 'Understanding DISC', links: [{t: 'DISC', u: 'https://drive.google.com/file/d/12CEdlyQFHUESyJiKCYur_dyY04WmLbW5/view'}]},
  {id: 'w5c', wk: 5, kind: 'training', title: 'Follow Up', links: [{t: 'Follow Up', u: S + 'sales-cycle/follow-up'}]},
  {id: 'w5d', wk: 5, kind: 'homework', title: PROSPECT5 + '/ Case Study'},
  {id: 'w5e', wk: 5, kind: 'homework', title: 'Get 2 policy summary'},

  // Week 6
  {id: 'w6a', wk: 6, kind: 'training', title: 'Policy Summary'},
  {id: 'w6b', wk: 6, kind: 'training', title: 'Lead To Close', links: [{t: 'Lead To Close video', u: 'https://youtu.be/QCMN51n1q5Q'}]},
  {id: 'w6c', wk: 6, kind: 'homework', title: PROSPECT5},

  // Week 7
  {id: 'w7a', wk: 7, kind: 'training', title: 'Referrals', links: [{t: 'Referrals', u: S + 'sales-cycle/referrals'}]},
  {id: 'w7b', wk: 7, kind: 'homework', title: PROSPECT5},
  {id: 'w7c', wk: 7, kind: 'homework', title: '2 approach on referrals'},

  // Week 8
  {id: 'w8a', wk: 8, kind: 'training', title: '定联'},
  {id: 'w8b', wk: 8, kind: 'homework', title: PROSPECT5},
  {id: 'w8c', wk: 8, kind: 'homework', title: '2 approach on referrals'},
  {id: 'w8d', wk: 8, kind: 'homework', title: '5 定联'}
];

// Weeks 9, 10, 11 and Last Week repeat the same three homework items.
[9, 10, 11, 12].forEach(function (w) {
  SYLLABUS.push(
    {id: 'w' + w + 'a', wk: w, kind: 'homework', title: PROSPECT5},
    {id: 'w' + w + 'b', wk: w, kind: 'homework', title: '2 approach on referrals'},
    {id: 'w' + w + 'c', wk: w, kind: 'homework', title: '5 定联'}
  );
});

SYLLABUS.push(
  {id: 'g1', wk: 13, kind: 'award', due: 90, title: 'SES'},
  {id: 'g2', wk: 13, kind: 'award', due: 90, title: 'ANP 30k Rookie award'},
  {id: 'g3', wk: 13, kind: 'award', due: 90, title: '90days Jumpstart Award'}
);

SYLLABUS.forEach(function (it) {
  if (it.kind === 'homework') it.title = it.title.replace(/^Homework- /, '');
  if (!it.due) it.due = it.wk === 12 ? 90 : it.wk * 7;
});

if (typeof module !== 'undefined') module.exports = {SYLLABUS: SYLLABUS, WEEK_NAMES: WEEK_NAMES, SYLLABUS_VERSION: SYLLABUS_VERSION};
