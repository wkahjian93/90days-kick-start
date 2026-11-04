# Connect the 90Days Kick Start server (one time, about 10 minutes)

This gives the app a private Google Sheet for progress and a Drive folder for homework files. It also sends the reminder emails from your own Gmail.

Never paste your leader code into chat, email or the code. It goes only into Google.

## 1. Create the server
1. Sign in at https://script.google.com as wongkahjian93@gmail.com and click **New project**. Name it `90Days Kick Start`.
2. Delete the sample code. Open `server/Code.gs` from this folder, copy all of it, paste it in, and click Save.
3. Click **Project Settings** (the gear icon). Under **Script properties**, add:

| Property | Value |
|---|---|
| `LEADER_CODE` | a code only you know, at least 10 characters |

4. Go back to **Editor**, choose `setup` at the top, and click **Run**. Approve the permissions it asks for: Sheets, Drive, send email as you, and triggers. Google may say the app is unverified; choose **Advanced**, then continue. It is your own script.
   This creates the Sheet **90Days Kick Start Data**, the folder **90Days Kick Start Homework**, and the 8am daily check. Emails only go out after you switch them on in the app.

## 2. Publish the server
1. Click **Deploy**, then **New deployment**, then the gear icon, then **Web app**.
2. Set **Execute as** to **Me** and **Who has access** to **Anyone**. Agents need this to reach it. Codes protect the data.
3. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.

## 3. Send Claude the URL
Paste the `/exec` URL into chat. It isn't secret. Claude puts it in `docs/config.js` and publishes the app.

## Later
- **After Claude changes the code:** run `node build.js`, paste the new `server/Code.gs`, then go to Deploy, Manage deployments, edit, and choose **New version**. The URL stays the same.
- **Change the leader code:** edit `LEADER_CODE` in Script properties.
- **Gmail limit:** a free Gmail account can send about 100 emails a day. That is plenty for a daily digest to under 50 agents.
- **Don't** rename the Sheet's tabs or columns, or delete their first row.
