# Settings

Last modified: 24/03/2026

## Settings Hub

Open **Settings → Community plugins → LearnKit** to configure the plugin.

Settings are grouped by tab and mirror the runtime settings object.

## Tab Overview

| Tab | What it controls |
|---------|-------------|
| General | Language, profile display, animations, and appearance presets |
| Study | Daily limits, grading layout, skip behavior, randomization, and analytics behavior |
| Study Assistant | AI provider, model, prompts, generation options, and privacy controls |
| Note Review | Note-review queue behavior and spacing |
| Scheduling | FSRS learning steps and retention target |
| Cards | Cloze rendering options |
| Indexing | Parser delimiters, code-fence behavior, and ID placement |
| Image Occlusion | Mask/reveal defaults for IO cards |
| Reading View | Display presets, fields, and style system |
| Storage | Attachment locations, vault sync folder, and backups |
| Audio | TTS playback behavior, language detection, and voice preferences |
| Reminders | Startup reminders and Gatekeeper cadence |

## Storage Sync

LearnKit stores its scheduling database in **SQLite**.

- Markdown note content remains in your vault files.
- Scheduling and review state are stored in the LearnKit database.
- Backups in the Data backup section are restore points for scheduling data.

## User Details

| Setting | Default | Description |
|---------|---------|-------------|
| User name | *(empty)* | Name shown in greetings on the home page |
| Show LearnKit information on the homepage | On | Display developer info on the home view |
| Show greeting text | On | Personalised greeting vs plain "Home" title |

## General

| Setting | Default | Description |
|---------|---------|-------------|
| Enable animations | On | Page-load fade-up animations |

## Study

| Setting | Default | Description |
|---------|---------|-------------|
| Daily new limit | 20 | Max new cards per scope per day |
| Daily review limit | 200 | Max due cards per scope per day |
| Auto-advance | Off | Auto-fail and advance unanswered cards |
| Auto-advance after | 60 s | Seconds before auto-advancing (3-60) |
| Grading buttons | Two buttons | **Two** (Again / Good) or **Four** (Again / Hard / Good / Easy). See [Grading](./Grading). |
| Skip button | Off | Show a Skip button in the reviewer |
| Randomise MCQ options | On | Shuffle MCQ option order |
| Randomise ordered-question items | On | Shuffle order where supported |
| Show info by default | Off | Expand the info field on the card back |
| Treat folder notes as decks | On | Folder notes can act as deck roots. See [Widget](./Widget). |

Daily limits reset at midnight and are tracked per scope.

## Study Assistant

The assistant settings are split into provider setup and behavior controls.

| Group | Default | Description |
|---------|---------|-------------|
| Enabled | On | Global assistant availability |
| Location | Modal | UI location (`modal` or sidebar) |
| Provider | OpenAI | Model provider selection |
| Model | gpt-4.1-mini | Active model for Ask/Review/Generate |
| Endpoint override | Empty | Optional custom API endpoint |
| API keys | Empty | One key per provider |
| Prompts | Built-in defaults | Assistant, note-review, and generator prompt templates |
| Generator types | All enabled | Card types allowed in generated output |
| Generator target count | 5 | Requested number of cards |
| Privacy controls | Mixed defaults | Payload preview, image/attachment inclusion, history retention |

See [Companion Configuration](./Companion-Configuration) and [Companion Usage](./Companion-Usage).

## Note Review

| Setting | Default | Description |
|---------|---------|-------------|
| Algorithm | FSRS | Scheduling method for note review |
| Reviews per day | 10 | Daily note-review cap |
| Review steps | 1, 7, 30, 365 days | Spacing plan for note review |
| Fill from future | On | Pull future items if under daily target |
| Avoid folder notes | On | Skip folder-note entries |
| Filter query | Empty | Restrict queue to matching notes |

## Reminder Tools

Reminders and Gatekeeper are documented on dedicated pages:

- [Reminders](./Reminders) — gentle launch/routine nudges
- [Gatekeeper](./Gatekeeper) — enforced review popups and bypass behavior

## Reading View

Reading View includes macro presets and optional advanced styling:

| Preset | Purpose |
|---------|-------------|
| Flashcards | Minimal card-first display |
| Classic | Full metadata and labels |
| Guidebook | Reading-centric with full context |
| Markdown | Embed-safe output with minimal controls |
| Custom | User-defined CSS and field mix |

See [Reading View](./Reading-View), [Reading View Styles](./Reading-View-Styles), and [Custom Reading Styles](./Custom-Reading-Styles).

## Image Occlusion

| Setting | Default | Description |
|---------|---------|-------------|
| Default IO attachment folder | `Attachments/Image Occlusion/` | Where IO images are saved |
| Delete orphaned IO images | On | Auto-delete IO images when their cards are removed |
| Default mask mode | Solo | Initial mask behavior |
| Reveal mode | Group | Reveal strategy during review |

## Card Attachments

| Setting | Default | Description |
|---------|---------|-------------|
| Card attachment folder | `Attachments/Cards/` | Where card media (images, audio) is saved |
| Vault sync folder | `LearnKit/` | Optional local folder used for vault-level sync artifacts |

## Data Backup

| Setting | Default | Description |
|---------|---------|-------------|
| Enable rolling daily backup | On | Keep one automatic daily backup (`daily-backup.db`). Manual backups are never auto-deleted. |
| Recent backups | 8 | Number of recent snapshots retained |
| Daily backups | 7 | Number of daily snapshots retained |
| Weekly backups | 4 | Number of weekly snapshots retained |
| Monthly backups | 1 | Number of monthly snapshots retained |
| Max total size | 250 MB | Backup budget before pruning |

Use **Create manual backup** before risky changes (large imports, schema/migration changes, or major cleanup).

For restore flow, integrity status, and backup behavior details, see [Backups](./Backups).

## Scheduling FSRS

LearnKit uses **FSRS**. Choose a preset or edit values manually.

See [Scheduling](./Scheduling) for details.

### Presets

| Preset | Learning steps | Relearning steps | Retention |
|--------|----------------|------------------|-----------|
| Relaxed | 20 min | 20 min | 0.88 |
| Balanced | 10 min, 1 day | 10 min | 0.90 |
| Aggressive | 5 min, 30 min, 1 day | 10 min | 0.92 |
| Custom | *(user-defined)* | *(user-defined)* | *(user-defined)* |

### Manual Options

| Setting | Default | Description |
|---------|---------|-------------|
| Learning steps | `10, 1440` | Minutes between learning steps (comma-separated) |
| Relearning steps | `10` | Minutes between relearning steps |
| Requested retention | 0.90 | Target recall probability (0.80–0.97) |

## Cards

| Setting | Default | Description |
|---------|---------|-------------|
| Cloze mode | Standard | Cloze reveal behavior |
| Cloze background/text colors | Empty | Optional per-theme cloze styling overrides |

## Indexing

| Setting | Default | Description |
|---------|---------|-------------|
| Ignore fenced code blocks | On | Skip card syntax inside fenced code blocks |
| Card delimiter | Pipe `\|` | Character used to separate card fields. See [Custom Delimiters](./Custom-Delimiters). |
| ID placement | Above | Place card anchors above or below the card block |

If the delimiter is changed, card parsing behavior changes on next sync.

## Audio

| Setting | Default | Description |
|---------|---------|-------------|
| Enable text-to-speech | Off | Master TTS enable toggle |
| Autoplay | On | Start speech automatically where supported |
| Auto-detect language | On | Detect script and language before speaking |
| Preferred voice | Empty | Use a fixed voice URI when available |
| Use flags for voice selection | On | Allow flag labels to steer voice choice |
| Rate / Pitch | 1.0 / 1.0 | Playback speed and pitch |

## Danger Zone

| Button | Effect |
|--------|--------|
| Delete all flashcards | Removes **all** LearnKit data from every note and the plugin store. This cannot be undone. |

## Quarantine

If a card cannot be parsed (for example, malformed syntax), it is listed here with its ID and error.

Use **Open note** to jump to the source, fix the syntax, then sync again. See [Syncing](./Syncing).

## Related

- [Settings Explained](./Settings-Explained)
- [Reminders](./Reminders)
- [Gatekeeper](./Gatekeeper)
