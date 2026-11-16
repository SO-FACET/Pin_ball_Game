# Game conversion and drop-off

GA4 property: SO/FACET website (`564377958`). Analytics consent is required. The existing Google and PostHog providers receive the same sanitized events.

## Reports

In **Reports → Game analytics → Game journey**, open **Game journey and drop-off – Visit to saved points**. The shared exploration **Game journey and drop-off** also shows elapsed time and device breakdowns.

The historical funnel uses existing events so it continues to work with earlier traffic:

| Stage | Event | Interpretation of not progressing |
| --- | --- | --- |
| Visited site | `page_view` | Did not reach the ready game; includes visitors browsing other pages |
| Game ready | `game_ready` | Did not start a run |
| Started game | `game_started` | Did not finish a run; this event precedes the first ball launch |
| Finished game | `game_finished` | Score verification did not follow |
| Score verified | `score_verified` | No confirmed points save followed in the reporting window |
| Points saved | `reward_saved` | Successful server-confirmed save (`pointsSaved: true`) |

This is a closed, indirect, **user-level** GA4 funnel. Intervening events are allowed. It counts the first qualifying sequence per user, not individual games; stages can span retries or visits. Do not interpret its abandonment column as a count of definitely closed tabs or failed requests. Choose the reporting period explicitly.

## Additional tracking

`game_load_started` distinguishes entering the loader from reaching `game_ready`. `game_play_started` records the first actual ball launch. `game_engaged` records reaching 30 seconds of active play. Active time excludes tutorial, launcher wait before the first launch, pauses, background time, menus and other blocking overlays.

`reward_save_started` records intent before sign-in/sign-up and automatic save requests. `reward_save_failed` records a failed save request with an HTTP status only. Neither event means points were saved. `reward_saved` requires a successful API response and the explicit confirmation above.

`game_session_outcome` describes an observed run when it is restarted, discarded, saved, or the document leaves:

| `outcome` | Meaning |
| --- | --- |
| `before_play` | Left before the first actual ball launch |
| `quit_early` | Unfinished game after launch, with less than 30 active seconds |
| `quit` | Unfinished game after at least 30 active seconds |
| `completed_unsaved` | Finished an eligible run; no confirmed save observed before departure/restart/discard |
| `completed_ineligible` | Finished with fewer than 10 points, below the save threshold |
| `saved` | Confirmed points save |

A legitimate completed game under 30 seconds is completed, not an early quit. `game_abandoned` additionally records interrupted started games and an `early` flag. The terminal outcome contains the last `stage`, `reason`, active `duration_ms`, points, and a memory-only `run_sequence`. The ordinal distinguishes retries inside the current document/session; it is not a globally unique game ID and must not be registered as a GA4 dimension.

Registered GA4 event-scoped dimensions are **Game outcome** (`outcome`), **Game funnel stage** (`stage`) and **Game exit reason** (`reason`). Filter these to `game_session_outcome` before interpreting them; other event families also use `outcome` and `reason`. Existing active play/page custom metrics remain available.

## Reliability and interpretation

Backgrounding, losing focus and entering the back/forward cache do not mean quit. Mobile OS termination can omit the final event. A completed-unsaved outcome is an observation at that departure, not a permanent statement: the player might return and save later. Use the missing-success funnel over a declared reporting window as the primary conversion measure, and observed outcomes/save failures to explain it.

Consent granted late, revoked/regranted, full document reloads, blockers and network failure can produce partial sequences. Actions before consent are not replayed into analytics. No phone number, email, auth token, business game ID or replay inputs are added. New events/dimensions begin collecting after deployment and can take 24–48 hours to appear in standard GA4 reports; historical early-exit outcomes cannot be reconstructed reliably.
