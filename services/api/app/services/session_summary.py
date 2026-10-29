"""Session summary: computed from stored events only (ADR-0011 §3, FR-07).

Rules (see tests/db/test_session_complete.py):
- An exercise is listed when the member recorded a set or skipped it. Cue-only or tracking-gap-only
  exercises stay in the stored events but are not listed. Order = first set, counted rep or skip.
- Sets are keyed by `set_index`; the later of two events for the same index replaces the earlier.
  `set_completed` (camera) and `set_logged` (typed) both define sets. Reps the camera counted in a
  set that never closed are kept as a tracked set rather than lost.
- Status is `completed` when any set exists, otherwise `skipped`.
- A response attaches to the latest matching cue that was shown at or before it.
- Lists are capped at the contract limits; `ExerciseMetrics` always counts everything.
"""

import uuid
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from app.schemas.exercise import ExerciseContract
from app.schemas.session import (
    ExerciseSkippedEvent,
    ExerciseSummary,
    FeedbackAcknowledgedEvent,
    FeedbackDismissedEvent,
    FeedbackShownEvent,
    RepCompletedEvent,
    SessionEvent,
    SessionSummary,
    SetCompletedEvent,
    SetLoggedEvent,
    SkipReason,
    SummaryCue,
    SummarySet,
    SummaryTrackingSpan,
    TrackingDegradedEvent,
)

MAX_CUES = 200
MAX_SPANS = 100


@dataclass(frozen=True)
class ExerciseMetrics:
    """Everything a `performance_records` row stores, untruncated."""

    exercise_id: str
    skipped: bool
    tracked: bool
    set_count: int
    total_reps: int
    total_duration_s: int
    avg_tracking_confidence: float | None
    tracking_degraded_ms: int
    cue_count: int
    cue_counts: dict[str, int]


@dataclass
class _Acc:
    first_relevant: int | None = None
    sets: dict[int, SummarySet] = field(default_factory=dict)
    set_notes: dict[int, str | None] = field(default_factory=dict)
    counted_reps: dict[int, set[int]] = field(default_factory=dict)
    confidences: list[float] = field(default_factory=list)
    cues: list[SummaryCue] = field(default_factory=list)
    spans: list[SummaryTrackingSpan] = field(default_factory=list)
    skip_reason: SkipReason | None = None
    skipped: bool = False


def build_summary(
    *,
    session_id: uuid.UUID,
    started_at: datetime | None,
    completed_at: datetime | None,
    events: Sequence[SessionEvent],
    catalog: Mapping[str, ExerciseContract],
    perceived_difficulty: int | None,
    note: str | None,
) -> tuple[SessionSummary, list[ExerciseMetrics]]:
    """`events` must be ordered by (occurred_at, arrival)."""
    accs: dict[str, _Acc] = {}
    for position, event in enumerate(events):
        acc = accs.setdefault(event.exercise_id, _Acc())
        _apply(acc, event, position)

    included = sorted(
        (
            (acc.first_relevant, exercise_id)
            for exercise_id, acc in accs.items()
            if acc.first_relevant is not None and _has_sets_or_skip(acc)
        ),
        key=lambda pair: pair[0] if pair[0] is not None else 0,
    )
    exercises: list[ExerciseSummary] = []
    metrics: list[ExerciseMetrics] = []
    for _, exercise_id in included:
        acc = accs[exercise_id]
        _close_unfinished_sets(acc)
        summary, stats = _finish(exercise_id, acc, catalog[exercise_id])
        exercises.append(summary)
        metrics.append(stats)

    return (
        SessionSummary(
            session_id=session_id,
            started_at=started_at,
            completed_at=completed_at,
            exercises=exercises,
            perceived_difficulty=perceived_difficulty,
            note=note,
        ),
        metrics,
    )


def _has_sets_or_skip(acc: _Acc) -> bool:
    return bool(acc.sets or acc.counted_reps or acc.skipped)


def _apply(acc: _Acc, event: SessionEvent, position: int) -> None:
    def mark() -> None:
        if acc.first_relevant is None:
            acc.first_relevant = position

    if isinstance(event, SetCompletedEvent):
        mark()
        acc.sets[event.set_index] = SummarySet(
            set_index=event.set_index,
            source="tracked",
            reps=event.reps,
            duration_s=None,
            perceived_difficulty=event.perceived_difficulty,
        )
        acc.set_notes[event.set_index] = event.note
    elif isinstance(event, SetLoggedEvent):
        mark()
        acc.sets[event.set_index] = SummarySet(
            set_index=event.set_index,
            source="manual",
            reps=event.reps,
            duration_s=event.duration_s,
            perceived_difficulty=event.perceived_difficulty,
        )
        acc.set_notes[event.set_index] = event.note
    elif isinstance(event, RepCompletedEvent):
        mark()
        acc.counted_reps.setdefault(event.set_index, set()).add(event.rep_index)
        acc.confidences.append(event.tracking_confidence)
    elif isinstance(event, ExerciseSkippedEvent):
        mark()
        acc.skipped = True
        acc.skip_reason = event.reason
    elif isinstance(event, FeedbackShownEvent):
        acc.cues.append(
            SummaryCue(
                rule_id=event.rule_id,
                ruleset_version=event.ruleset_version,
                message_id=event.message_id,
                shown_at=event.occurred_at,
                measurements=dict(event.measurements),
                response=None,
            )
        )
    elif isinstance(event, FeedbackAcknowledgedEvent | FeedbackDismissedEvent):
        response: Literal["acknowledged", "dismissed"] = (
            "acknowledged" if isinstance(event, FeedbackAcknowledgedEvent) else "dismissed"
        )
        for i in range(len(acc.cues) - 1, -1, -1):
            cue = acc.cues[i]
            if cue.rule_id == event.rule_id and cue.message_id == event.message_id:
                acc.cues[i] = cue.model_copy(update={"response": response})
                break
    elif isinstance(event, TrackingDegradedEvent):
        acc.spans.append(
            SummaryTrackingSpan(
                reason=event.reason, started_at=event.occurred_at, duration_ms=event.duration_ms
            )
        )


def _close_unfinished_sets(acc: _Acc) -> None:
    """Keep reps the camera counted in a set whose `set_completed` never arrived."""
    for set_index, reps in acc.counted_reps.items():
        if set_index not in acc.sets:
            acc.sets[set_index] = SummarySet(
                set_index=set_index,
                source="tracked",
                reps=len(reps),
                duration_s=None,
                perceived_difficulty=None,
            )
            acc.set_notes[set_index] = None


def _finish(
    exercise_id: str, acc: _Acc, exercise: ExerciseContract
) -> tuple[ExerciseSummary, ExerciseMetrics]:
    sets = [acc.sets[i] for i in sorted(acc.sets)]
    total_reps = sum(s.reps or 0 for s in sets)
    total_duration = sum(s.duration_s or 0 for s in sets)
    tracked = any(s.source == "tracked" for s in sets)
    completed = bool(sets)

    difficulty = next(
        (s.perceived_difficulty for s in reversed(sets) if s.perceived_difficulty), None
    )
    note = next(
        (acc.set_notes[s.set_index] for s in reversed(sets) if acc.set_notes[s.set_index]), None
    )
    spans = sorted(acc.spans, key=lambda s: s.started_at)

    summary = ExerciseSummary(
        exercise_id=exercise_id,
        status="completed" if completed else "skipped",
        skip_reason=None if completed else acc.skip_reason,
        prescription=exercise.prescription,
        tracked=tracked,
        sets=sets,
        total_reps=total_reps,
        total_duration_s=total_duration,
        cues=acc.cues[:MAX_CUES],
        tracking_degraded=spans[:MAX_SPANS],
        perceived_difficulty=difficulty,
        note=note,
    )
    confidence = round(sum(acc.confidences) / len(acc.confidences), 3) if acc.confidences else None
    stats = ExerciseMetrics(
        exercise_id=exercise_id,
        skipped=not completed,
        tracked=tracked,
        set_count=len(sets),
        total_reps=total_reps,
        total_duration_s=total_duration,
        avg_tracking_confidence=confidence,
        tracking_degraded_ms=sum(s.duration_ms for s in spans),
        cue_count=len(acc.cues),
        cue_counts=dict(Counter(c.rule_id for c in acc.cues)),
    )
    return summary, stats
