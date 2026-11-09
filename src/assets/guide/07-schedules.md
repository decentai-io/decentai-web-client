# Schedules

Chats set things in motion that outlive the moment they were open. **AI → Schedules** shows what waits for you across your chats, and what they keep on the clock.

## What a schedule is

A schedule runs a chat's work with nobody present: once, at a date and a time; every so many minutes, hours or days; or on a cron, such as *every weekday at 09:00*. Its times are read in its chat's time zone, one of the chat's settings.

Two kinds:

- **A prompt that wakes the assistant.** It reads the prompt in the chat and does what it says: check, summarise, tell you.
- **A function on a clock** runs an agent's function with fixed inputs. Only functions an agent marked *schedulable* can run this way, and only of agents the chat uses. A function that asks you something while nobody is there is answered with nothing at once.

A chat keeps at most 50 schedules, and its runs' last 20 outcomes.

## Making one

Ask for it in any chat, in words, and the assistant sets it. Describe it in the line at the top of the Schedules page, and a new chat opens where the assistant sets it. Or press **+**, *New schedule*, and fill it in yourself: which chat it lives in, what it does, and when — **Every** so often, **On days** of the week at a time, **Once**, or **Custom**, a cron with its five parts named. As you choose, the form shows the next runs it comes to.

What a schedule does is set when it is made. Afterwards, **Change when it runs** moves it in time.

## Reading the list

Each row says when the schedule comes round, in words, with its chat's time zone; what it does and in which chat; who set it; when it runs next and how the last run went. A chip says how it stands: **Active**, **Paused**, **Done** for a one-off that has run, or **Failing** when its last run failed.

The switch on a row pauses and resumes it. A resumed schedule counts its next run from then: nothing it missed is run. A paused schedule stays on the page, to be resumed when you choose. **Run now** runs it at once; what it does shows up in its chat.

A row's name opens the schedule beside the list, with every run kept and the words each ended on.

## Cards waiting on you

Above the schedules, the page lists every card waiting for your answer, in every chat — an approval, a question, a sign-in, an offer — each leading to its chat, where you answer it.

## When everything is stopped

**Stop everything**, at the top of every page, stops all of your chats and holds the clock too. Your schedules stay listed, and none runs until you press **Resume**.
