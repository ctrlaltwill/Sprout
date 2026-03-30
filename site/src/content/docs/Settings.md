---
title: "Settings"
---


Settings is the reference page for LearnKit's in-plugin settings view.

Open **Settings -> Community plugins -> LearnKit**, then use the top row inside LearnKit's settings view.

If you want help choosing the right tab first, start with [Settings Explained](../Settings-Explained).

## Top-Level Tabs

| Tab | What you will find there |
|---------|-------------|
| General | Theme, accent, animations, greeting, name, interface language, and Reading view controls |
| Audio | Text to speech, voice routing, script fallbacks, and voice tuning |
| Companion | Provider setup, models, API keys, privacy, context sources, prompts, and flashcard generation |
| Data & Maintenance | Attachment folders, vault database copies, backups, and analytics coaching controls |
| Flashcards | Flashcard-type options plus parsing controls such as delimiters and fenced-code handling |
| Notes | Note selection rules and note-review scheduling |
| Reminders | Launch reminders, routine reminders, Gatekeeper timing, and bypass rules |
| Studying | Session defaults, grading layout, sibling handling, flashcard scheduling, and FSRS optimisation |
| Reset | Reset actions and destructive cleanup actions |

## General

General combines appearance, profile, language, and Reading view settings.

### Theme

- **Theme preset**: currently the visual preset selector for the settings experience
- **Accent colour**: override the inherited theme accent and reset back to the active Obsidian theme
- **Enable animations**: turn interface transitions on or off
- **Home greeting**: show or hide the personalised greeting on Home

### User Details

- **User name**: the display name used in LearnKit greetings

### Language

- **Language**: choose the interface language
- **Help translate**: open the translation contribution guide

### Reading View

- **Card styling**: turn LearnKit reading-view styling on or off
- **Card style**: choose between **Flashcards** and **Clean markdown**
- **Show edit button**: only shown for the Flashcards style
- **Show audio button**: only shown for the Flashcards style
- **Show title / question / options / answer / info / groups / field labels**: only shown for the Clean markdown style

See [Reading View](../Reading-View) and [Reading View Styles](../Reading-View-Styles).

## Audio

Audio controls text to speech and language-aware voice routing.

### Text To Speech

- **Enable text to speech**
- **Limit to group**
- **Autoplay audio**
- **Read aloud + replay in widget**
- **Read aloud + replay in gatekeeper**
- **Cloze answer read mode**: choose **Just the answer** or **Full sentence**

### Flag-Aware Routing

- **Use flags for language and accent**
- **Speak language name before flag segments**

### Voice And Accent

- **Default voice**
- **Advanced script defaults**: optional fallback languages for Cyrillic, Arabic, CJK, and Devanagari text

### Voice Tuning

- **Speech rate**
- **Speech pitch**
- **Test voice**
- **Available system voices** status text appears when no system voices are available yet

See [Text to Speech](../Text-to-Speech), [Flags](../Flags), and [Flag Codes](../Flag-Codes).

## Companion

Companion contains AI provider setup, privacy, and generation controls.

### Enable Companion

- **Companion**: master on or off switch
- **Button visibility**: choose whether the Companion button is hidden, shown on hover, or always visible
- **Sidebar widget**: reminder row explaining how to open the sidebar Companion

### AI Provider

- **AI provider**
- **OpenRouter model catalog**: shown only when OpenRouter is selected
- **Model**
- **Endpoint override**: shown only for the custom provider
- **Provider API key**: the key field changes to match the selected provider

### Privacy And Context

- **Save chat history**
- **Delete chats on provider too**
- **Linked notes context limit**
- **Text attachment context limit**

### Companion Sources

- **Include embedded attachments**
- **Include linked notes as text**
- **Include linked attachments**
- **Custom instructions**

### Test Sources

- **Include embedded attachments**
- **Include linked notes as text**
- **Include linked attachments**
- **Custom instructions**

### Flashcard Generation

- **Target number of cards**
- **Flashcard types to generate**: Basic, Basic (reversed), Cloze, Multiple choice, Ordered question, and Image occlusion when the selected model supports vision
- **Optional flashcard fields**: Include titles, Include extra information, Include groups

See [Companion Configuration](../Companion-Configuration), [Companion Usage](../Companion-Usage), and [Guide for Free Usage](../Guide-for-Free-Usage).

## Data & Maintenance

Data & Maintenance combines storage, vault database syncing, backups, and analytics-coaching maintenance controls.

### Attachment Storage

- **Image occlusion folder**
- **Delete orphaned image occlusion images**
- **Card attachment folder**

### Obsidian Sync Database Storage

- **Store databases in vault**
- **Vault sync folder**

These options copy LearnKit database files into a vault folder so Obsidian Sync can move them between devices.

### Data Backup

- **Rolling daily backup**
- **Create manual backup**
- **Backup table** with backup label, date, scheduling-data summary, integrity status, and restore or delete actions

Use **Create manual backup** before large imports, schema changes, or destructive resets. See [Backups](../Backups).

### Analytics Coaching

- **Include practice sessions**
- **Topic hierarchy**
- **Mastery red threshold**
- **Mastery yellow threshold**
- **Weak topics shown**

## Flashcards

Flashcards contains flashcard-type behaviour plus note-parsing controls.

### Basic Cards

- No settings are currently exposed here

### Cloze

- **Cloze mode**: choose **Standard** or **Typed**

### Image Occlusion

- **Reveal mode**: choose **Reveal group** or **Reveal all**

### Multiple Choice

- **Shuffle order**

### Ordered Questions

- **Shuffle order**

### Syncing

- **Ignore fenced code blocks**
- **Card delimiter**

Changing the delimiter does not migrate old flashcards. Use [Custom Delimiters](../Custom-Delimiters) before changing it.

## Notes

Notes controls which notes enter note review and how note review is scheduled.

### Note Selection

- **Skip folder notes**
- **Include or exclude notes**: filter the queue by vault, folder, note, tag, or property

### Note Scheduling

- **Scheduling algorithm**: choose **FSRS** or **LKRS**

When **FSRS** is selected, Notes shows:

- **Retention target**
- **Learning steps (minutes)**
- **Relearning steps (minutes)**
- **Fuzz intervals**

When **LKRS** is selected, Notes shows:

- **Reviews per day**
- **Review steps (days)**
- **Fill session when under daily limit**

## Reminders

Reminders controls both gentle reminders and Gatekeeper interruptions.

### Launch Reminders

- **Show launch reminder**
- **Launch reminder delay**

### Routine Reminders

- **Show routine reminders**
- **Routine reminder interval**

### Gatekeeper Popups

- **Enable recurring gatekeeper popups**
- **Show gatekeeper on launch**

### Gatekeeper Behaviour

- **Gatekeeper interval**
- **Questions per popup**
- **Gatekeeper scope**
- **Pause gatekeeper while studying**

### Gatekeeper Bypass

- **Enable gatekeeper bypass**
- **Warn before bypassing gatekeeper**

Some reminder rows only appear after the related master toggle is enabled.

See [Reminders](../Reminders) and [Gatekeeper](../Gatekeeper).

## Studying

Studying combines study-session defaults with flashcard scheduling.

### Study Sessions

- **Daily new limit**
- **Daily review limit**
- **Auto-advance**
- **Auto-advance after**
- **Grading buttons**
- **Show grade intervals**
- **Skip button**
- **Treat folder notes as decks**
- **Hide card title bar**
- **Sibling card management**

### Flashcard Scheduling

- **Preset**: Custom, Relaxed, Balanced, or Aggressive
- **Learning steps**
- **Relearning steps**
- **Requested retention**
- **Fuzz intervals**

### Optimisation

- **Optimise FSRS parameters**
- **Clear** optimised parameters after they have been created

See [Study Sessions](../Study-Sessions), [Grading](../Grading), [Scheduling](../Scheduling), [Burying Flashcards](../Burying-Flashcards), and [Suspending Flashcards](../Suspending-Flashcards).

## Reset

Reset contains every destructive or recovery-style action.

### Reset

- **Reset to defaults**
- **Reset analytics**
- **Reset scheduling**

### Danger Zone

- **Delete all flashcards**

Reset scheduling and analytics can be restored from backups. Deleting all flashcards cannot be undone from LearnKit.

## Related

- [Settings Explained](../Settings-Explained)
- [Backups](../Backups)
- [Reminders](../Reminders)
- [Gatekeeper](../Gatekeeper)

---

Last modified: 30/03/2026
