"""What the plan generator is allowed to know about a member (blueprint §9: authorized context).

Exactly five profile fields: goal, experience, days per week, session minutes, equipment. No ids,
no names, no health data. This is everything that reaches the prompt.

Defaults when the member left the schedule unset (deterministic; recorded in
`generation_metadata.inputs.defaults_applied`):
- `days_per_week` → 3: three full-body days is the standard starting schedule for every level and
  leaves a rest day between sessions.
- `session_minutes` → 45: a common gym session and the M3 S0 spike's default, where 120b produced
  valid plans for it every time.
"""

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Protocol

DEFAULT_DAYS_PER_WEEK = 3
DEFAULT_SESSION_MINUTES = 45


class ProfileLike(Protocol):
    @property
    def primary_goal(self) -> str: ...
    @property
    def experience_level(self) -> str: ...
    @property
    def days_per_week(self) -> int | None: ...
    @property
    def session_minutes(self) -> int | None: ...
    @property
    def equipment(self) -> list[str]: ...


@dataclass(frozen=True)
class PlanInputs:
    primary_goal: str
    experience_level: str
    days_per_week: int
    session_minutes: int
    equipment: tuple[str, ...]
    defaults_applied: tuple[str, ...] = ()

    @classmethod
    def from_profile(cls, profile: ProfileLike) -> "PlanInputs":
        defaults = []
        if profile.days_per_week is None:
            defaults.append("days_per_week")
        if profile.session_minutes is None:
            defaults.append("session_minutes")
        return cls(
            primary_goal=str(profile.primary_goal),
            experience_level=str(profile.experience_level),
            days_per_week=profile.days_per_week or DEFAULT_DAYS_PER_WEEK,
            session_minutes=profile.session_minutes or DEFAULT_SESSION_MINUTES,
            equipment=tuple(sorted(str(e) for e in profile.equipment)),
            defaults_applied=tuple(defaults),
        )

    def prompt_fields(self) -> dict[str, object]:
        """The member context sent to the model."""
        return {
            "primary_goal": self.primary_goal,
            "experience_level": self.experience_level,
            "days_per_week": self.days_per_week,
            "session_minutes": self.session_minutes,
            "equipment": list(self.equipment),
        }

    def fixture_key(self) -> str:
        """Stable key for canned fake replies (offline evals). Not logged: the input space is
        small, so the hash would reveal the profile."""
        canonical = json.dumps(self.prompt_fields(), sort_keys=True)
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]

    def as_metadata(self) -> dict[str, object]:
        data = asdict(self)
        data["equipment"] = list(self.equipment)
        data["defaults_applied"] = list(self.defaults_applied)
        return data
