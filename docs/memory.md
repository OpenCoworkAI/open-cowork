# Memory

How Open Cowork writes, injects, corrects and rebuilds memory, and where to see what a reply used. For a manual check with a real API key, see [memory-live-smoke-checklist.md](memory-live-smoke-checklist.md).

## Two kinds of memory

- **Core memory** is a short list of facts that apply everywhere, such as your name or the language you want answers in. Each entry has a category and a key (`identity.name`), a value of at most 500 characters, and the list holds at most 24 entries.
- **Experience memory** is what past conversations were about. Each conversation is stored as a summary plus chunks (a summary, details and keywords), tagged with the workspace it ran in.

## Where it is stored

Everything is plain JSON under the memory storage root, `<userData>/memory` unless `memoryRuntime.storageRoot` is set. You can open the files from Settings → Memory.

| File | Content |
| --- | --- |
| `core_memory.json` | `entries` (the facts), `written` (entries you wrote or edited) and `forgotten` (keys you removed). |
| `experience_memory.json` | Conversation summaries and chunks. |
| `session_state.json` | How many messages of each conversation were ingested, and the last error. |

## How memory is written

After a run finishes, and only when memory is on and the conversation has memory enabled, the conversation is queued for ingestion. Each conversation has its own queue, so its runs are ingested one after another.

1. The messages added since the last ingestion go to the core extractor, which changes core entries.
2. The whole transcript goes to the experience extractor, which writes the conversation's summary and chunks.

Both steps call a model. By default it is the provider you are chatting with; Settings → Memory can point them at another one. Extraction skips keys you forgot and never overwrites entries you wrote.

## How memory is injected

Before each run, the prompt gets a `<memory_context>` block that tells the model the entries are untrusted evidence, not instructions. Memory text is escaped so it cannot close the block.

- Every core entry is included.
- For experience memory, the prompt is matched against stored chunks and conversation summaries (up to 10 chunks and 5 conversations). A navigation step may then read some of them in full, up to `memoryRuntime.maxNavSteps` times (default 2, at most 4). Retrieval prefers the current workspace.

If memory is off, or nothing relevant is stored, no block is added.

## What a reply used

The context panel shows a **Memory used** section for the latest run. It lists:

- the core entries that were injected, marking the ones you wrote;
- the past-conversation summaries that were injected, with the conversation each came from, and whether the model also read that conversation in full;
- an **Open conversation** link for every source conversation that still exists.

The list is saved with the conversation's trace, so it is still there after a restart. It is a record of what that run was given, so it keeps the text as it was then: forgetting a conversation, clearing memory or editing an entry later does not change it, and deleting the conversation that used the memory deletes the list with it. Core entries have no source conversation: core memory does not record which conversation a fact came from.

## Correcting memory

- **Edit or forget a core entry** in Settings → Memory → Core memory entries. An edited entry is saved as yours, and extraction and rebuilding leave it alone. A forgotten key is not extracted again.
- **Turn memory off** in Settings → Memory. This stops ingestion and recall and keeps the stored records.
- **Forget a conversation** from its memory view in Settings → Memory. The experience memory taken from it is removed and memory is turned off for that conversation, so it is not learned from again, even when memory is rebuilt. The conversation stays and core entries do not change. This cannot be undone.
- **Delete a conversation** to remove the experience memory taken from it. Core entries are global and stay.
- **Clear** either the current workspace's experience memory or all core memory (which also clears your edits and forgotten keys). Clearing cannot be undone.

## Rebuilding

- **Rebuild current workspace** clears that workspace's experience memory and ingests its conversations again, oldest first, for conversations that have memory enabled.
- **Rebuild all** drops the extracted core entries and all experience memory, keeps the entries you wrote, and ingests every memory-enabled conversation again.

Rebuilding calls the extraction model once per conversation, so it can take a while and cost tokens on a long history. Up to `memoryRuntime.ingestionConcurrency` (default 4) conversations are extracted in parallel; their results are then ingested oldest first.
