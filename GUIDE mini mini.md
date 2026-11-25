# mini mini: meeting minutes in REDEFINE Meeting App

**What it does:** one person records the meeting on their phone. mini mini turns the talk (华语, English, Malay) into short minutes: key points, decisions, each person's tasks, homework and leader comments, anything said after "mini mini", and the next meeting date. You check it, then each agent gets their own tasks in their own app.

## Before the meeting
- Open the app → **🎙 Meetings · mini mini → Open → 🎙 Record a meeting**.
- Type the meeting name, tick who is in the meeting, and add guests by name.
- Tell everyone you are recording and tick **"Everyone here knows…"**. Recording cannot start without this tick.
- **Only one person records each meeting.** If someone is already recording, the app shows who it is. Same meeting? Don't record; you'll get the minutes anyway.

## During the meeting
- Put the phone in the middle of the table and **keep the screen on, with the app open**. Don't lock the phone or switch apps; an iPhone stops recording when you do.
- Say **"mini mini, …"** when something must be noted, for example *"mini mini，记下来：Yi Ting 星期五前交 10 个 prospect"*. You can also tap **📌 Mark this**.
- Say the next meeting date out loud, for example *"下次开会下个星期一晚上八点"*. mini mini picks it up.
- Recording can run up to 4 hours. Every 5 minutes, the part recorded so far is sent to the server.
  - If the internet drops, the parts wait on the phone and send themselves later.
  - If the app closes, it asks to carry on when you open it again.

## After the meeting
1. Tap **■ Stop**. mini mini writes the minutes, which takes about 1 minute for every 10 minutes recorded. You can close the app while it works.
2. When the meeting shows **👀 Ready to check**, the GM or the person who recorded opens it:
   - Fix anything wrong. mini mini lists what it was **not sure about** at the top.
   - Under **Each person**, use **Send to** to choose which agent each name is. If you leave a name unmatched, nothing is sent for it.
   - Leader comments stay private unless you tick **"Let this agent see the comments"**.
   - Check the **Next meeting** date. If it's ticked, it goes into REDEFINE Calendar for everyone in the meeting who has connected their calendar.
3. Tap **✅ Approve and send**. The app shows exactly who gets what before anything is sent.

## What agents see
- In **Meetings**: the summary of meetings they were in, plus **only their own** tasks and homework, and any comments you chose to share.
- They tick tasks when they're done. You see each person's progress, e.g. *2/3 done*, on the meeting page.
- If something was wrong, tap **✏️ Edit and send again**. Tasks already ticked stay ticked.

## Privacy and data
- Audio is **deleted 30 days after approval**. The text minutes are kept.
- Recordings and minutes are stored in your private Google Drive and Sheet, the same place as the homework files.
- Only the GM and the person who recorded can see the full transcript. **Delete this meeting…** removes everything: audio, transcript, minutes and tasks.
- The speech-to-text and summary are done by OpenAI using your OpenAI key, which is stored on the Google server and never in the app.

## Cost (approximate)
- Speech to text: about **US$0.27 per hour** recorded (gpt-transcribe, US$0.0045 a minute).
- Summary: a 7-minute test used about 2,800 tokens of gpt-6.2-sol. To see the real cost, check your OpenAI usage page after the first full meeting.

## Good to know
- Accuracy is best with one person speaking at a time and the phone close to the speakers.
- mini mini can't tell voices apart. It works out who should do what from what is said, e.g. "Yi Ting, you…", so **say names when giving tasks**.
