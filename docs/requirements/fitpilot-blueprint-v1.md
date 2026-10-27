# FitPilot AI — Functional Requirements & Project Blueprint

Project specification · Version 1.0 · October 2026

We're going to treat this as a real software product with a defined scope, architecture, implementation plan, and acceptance criteria—not just a collection of features to experiment with.

Our working product is FitPilot AI, an AI-powered personal training platform that combines interactive 3D exercise demonstrations, real-time camera-based movement analysis, personalized workout and nutrition plans, AI coaching, and gym business management.

The defining feature is the integration of the 3D trainer and computer vision: the user sees how an exercise should be performed, performs it themselves, receives feedback based on observable movement, and has their progress incorporated into a personalized coaching workflow.

The blueprint below establishes what we intend to build, what the system must do, how its components interact, and how we'll determine whether the project is complete.

# Part I — Product definition

## 1. Product objectives

For members

Provide accessible, personalized home workouts with visual demonstrations, exercise feedback, nutrition planning, and progress tracking.

For gym owners and trainers

Scale remote coaching, reduce repetitive administrative work, retain visibility into member engagement, and intervene when human expertise is needed.

For the engineering portfolio

Demonstrate full-stack development, computer vision, 3D graphics, applied AI, workflow orchestration, system integration, observability, and production-oriented engineering.

## 2. Target users and roles

| Role                   | Responsibilities and capabilities                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Member                 | Manage profile, follow workouts, use camera feedback, receive nutrition guidance, and track progress. |
| Trainer                | Review assigned members, inspect progress, review or adjust plans, and handle escalations.            |
| Gym administrator      | Manage members, trainers, coaching policies, memberships, content, and business analytics.            |
| Platform administrator | Configure system-wide settings, manage operational access, and investigate technical failures.        |

The first release can support all four roles through one responsive web application with role-based permissions. We do not need four separate applications.

## 3. Core product principles

1. Feedback must be grounded in measurements. The vision engine generates movement metrics; it must not invent observations.
2. The exercise library is the source of truth. AI selects and explains approved exercises rather than freely inventing movements.
3. Safety overrides personalization. When tracking is unreliable or a request falls outside the system's scope, the system communicates its limitations.
4. Human oversight remains available. Trainers can review, correct, and override plans.
5. Privacy by default. Camera processing should happen locally whenever practical, and raw video should not be uploaded by default.
6. Every important workflow is testable. We need observable outcomes, automated tests, and measurable reliability rather than relying on impressive demonstrations alone.

# Part II — Primary functional requirements

These requirements define what the system must actually do. Each requirement has an identifier so that we can trace it to implementation tasks and tests.

Priority definitions:

- P0 — Essential: required for the core MVP to work.
- P1 — Important: part of the intended first complete product, but can follow the core demonstration.
- P2 — Future: an extension after the foundational system is stable.

## FR-01. Authentication, roles, and member profiles

P0

The application must:

- Allow users to register, sign in, sign out, and recover access.
- Enforce role-based access for members, trainers, and administrators.
- Allow members to manage goals, experience level, training availability, equipment, and preferences.
- Collect relevant constraints and limitations with appropriate consent.
- Allow users to view and update their profile.
- Ensure members cannot access another member's private data.
- Support deletion and export workflows as appropriate to applicable privacy requirements.

Acceptance criteria: A member can register, complete onboarding, sign in again, and retrieve their saved profile. Attempts to access another member's records are denied by the backend.

## FR-02. Personalized workout planning

P0

The system must:

- Generate structured workout plans from the member's profile and goals.
- Support weekly schedules, exercise selection, sets, repetitions or duration, rest periods, and progression parameters.
- Restrict exercise selection to the approved exercise catalogue.
- Respect equipment availability, scheduling constraints, and applicable coaching rules.
- Allow a member to view their current plan and previous versions.
- Support plan regeneration and controlled modification.
- Validate generated plans before saving or presenting them.

Acceptance criteria: Given a supported member profile, the system produces a valid plan containing catalogue-backed exercises and required parameters. Invalid output is rejected, repaired, or escalated rather than silently accepted.

## FR-03. Interactive 3D exercise engine

P0

The system must:

- Render a rigged 3D humanoid avatar in the browser.
- Load exercise-specific animation clips.
- Support play, pause, replay, and reset.
- Display movement instructions and the major phases of an exercise.
- Provide camera controls where useful, including viewing-angle changes.
- Synchronize animation, exercise instructions, and the selected workout.
- Display approved exercise metadata, such as target muscles, equipment, and common technique considerations.
- Handle missing or incompatible animation assets gracefully.

Acceptance criteria: A member can open a squat exercise, see the avatar demonstrate it, replay the movement, and follow its instructions without the 3D viewer blocking the rest of the application.

The initial release should use one avatar and a small set of authored animations, not a general-purpose character editor.

## FR-04. Live camera and pose estimation

P0

The system must:

- Request explicit browser camera permission before starting a session.
- Show a live preview and guide the member into an appropriate camera position.
- Process frames through a pose-estimation model such as MediaPipe Pose Landmarker.
- Display a skeletal overlay or other useful tracking visualization.
- Track landmark visibility and confidence.
- Handle camera denial, unsupported devices, low lighting, and temporary tracking failures.
- Provide a clear way to pause and stop camera processing.
- Keep raw camera video on the device by default.

Acceptance criteria: On a supported browser and device, a member can start a camera session, see pose landmarks update, receive tracking-status feedback, and stop the session. When tracking quality is inadequate, the system does not pretend that reliable analysis is available.

## FR-05. Exercise-specific movement analysis

P0

The system must:

- Convert pose landmarks into relevant movement features.
- Calculate selected joint-angle estimates and movement characteristics.
- Smooth noisy measurements over time.
- Detect exercise phases and count repetitions using explicit state transitions.
- Apply rules specific to the selected exercise.
- Produce feedback only when the relevant measurements are sufficiently reliable.
- Distinguish between an observed movement characteristic and a medical or safety conclusion.
- Record session metrics and confidence information for later review.

Initial supported exercises:

1. Bodyweight squat.
2. Dumbbell biceps curl.
3. Push-up.

Acceptance criteria: Each supported exercise has documented movement rules, reproducible tests using representative recorded inputs, and a defined response to missing or unreliable landmarks. Repetition counting and feedback are tested against annotated examples rather than assumed correct because a demo looks convincing.

## FR-06. Real-time coaching feedback

P0

The system must:

- Display exercise-specific cues based on the movement-analysis output.
- Provide repetition counts and set progress.
- Explain what a cue means in clear language.
- Avoid generating feedback when the camera view cannot support the conclusion.
- Distinguish coaching guidance from medical advice.
- Allow a member to dismiss or acknowledge feedback.
- Provide a post-set summary using recorded session data.
- Escalate appropriate questions or situations to a human professional.

Acceptance criteria: Every displayed real-time correction can be traced to a defined rule and its supporting measurements. The LLM must not independently invent a correction from a repetition count alone.

## FR-07. Workout session management

P0

The system must:

- Start, pause, resume, and complete a workout session.
- Display the current exercise, sets, repetitions, rest time, and instructions.
- Track completed exercises and skipped exercises.
- Save workout history and relevant metrics.
- Allow users to report perceived difficulty and optional feedback.
- Recover gracefully from temporary network loss where feasible.
- Update progress only from valid session events.

Acceptance criteria: A member can complete a workout, refresh the application, and still see the saved session and its recorded results.

## FR-08. Personalized nutrition planning

P1

The system must:

- Collect food preferences, dietary patterns, and budget constraints.
- Generate structured meal plans and recipes from approved nutrition information.
- Display ingredient quantities, portions, and meal timing where appropriate.
- Support ingredient substitutions and grocery lists.
- Explain the assumptions behind recommendations.
- Avoid presenting uncertain nutritional estimates as exact values.
- Recognize situations requiring qualified dietary or medical advice.

Acceptance criteria: Every generated meal plan has a valid structure, uses supported ingredients, reflects the member's stated preferences, and passes the applicable nutrition-policy checks before presentation.

## FR-09. AI coaching assistant

P1

The system must:

- Answer questions using the member's authorized profile, current plan, and approved knowledge sources.
- Explain exercise instructions and plan decisions.
- Summarize completed workouts.
- Suggest permitted modifications and request confirmation when appropriate.
- Use tool calls or structured outputs for actions that change application data.
- Avoid claiming to have updated a plan or recorded an event until the backend confirms it.
- Route unsupported or high-risk requests appropriately.

Acceptance criteria: The assistant can explain a member's existing plan using actual saved data, distinguish available information from missing information, and perform only authorized actions.

## FR-10. Progress tracking and adaptive planning

P1

The system must:

- Display workout consistency and completion history.
- Track relevant metrics over time.
- Summarize changes in exercise performance and reported difficulty.
- Recommend plan adjustments based on predefined rules and observed history.
- Maintain version history for generated plans.
- Allow users to inspect and accept proposed changes.
- Avoid claiming that short-term changes establish meaningful physiological improvement.

Acceptance criteria: A completed session updates the relevant progress view, and a subsequent adjustment uses actual recorded history rather than fabricated progress.

## FR-11. Gym owner and trainer dashboard

P1

The system must:

- Allow administrators to manage members and trainers.
- Associate members with the appropriate gym or coaching relationship.
- Display membership status and engagement metrics.
- Allow trainers to review authorized member plans and progress.
- Support review, approval, correction, or replacement of plans where required.
- Display escalations and outstanding review tasks.
- Allow administrators to configure approved exercises and coaching policies.
- Maintain an audit trail for significant administrative actions.

Acceptance criteria: An authorized trainer can inspect an assigned member's plan and progress, modify a plan, and see the change recorded. An unrelated trainer cannot access that member's records.

## FR-12. Notifications and business operations

P2

The system may eventually support:

- Workout reminders and inactivity notifications.
- Membership and subscription management.
- Trainer appointment booking.
- Email or push notifications.
- Payment integration.
- Retention and engagement reporting.

These are useful commercial capabilities, but they should not delay the 3D and computer-vision milestone.

## FR-13. Administration, evaluation, and observability

P0

The system must:

- Record application errors and important workflow events.
- Measure AI generation latency, failures, and cost.
- Track pose-processing performance and tracking failures.
- Run automated tests against workout generation and exercise-analysis logic.
- Version relevant prompts, rules, and evaluation datasets.
- Allow administrators to inspect system health without exposing unnecessary personal data.
- Provide repeatable evaluation results for supported scenarios.

Acceptance criteria: A failed plan-generation request, a rejected plan, or a pose-tracking failure produces a diagnosable event with sufficient technical context, without unnecessarily recording sensitive data.

# Part III — Non-functional requirements

Functional requirements describe what the product does. Non-functional requirements define how well it must do it.

The following are initial engineering targets to validate on representative hardware, not claims of achieved performance.

| Area             | Requirement                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Responsiveness   | Target responsive interactions on modern desktop and mobile browsers.                                                           |
| Pose processing  | Aim for approximately 15–30 processed frames per second on a capable target device, adapting to slower devices.                 |
| Feedback latency | Aim for a median of 250 ms or less from processed movement data to a displayed rule-based cue, excluding any optional LLM call. |
| AI performance   | Measure end-to-end latency separately for plan generation and conversational responses.                                         |
| Availability     | Handle backend errors and temporary network interruptions without corrupting saved workout records.                             |
| Security         | Enforce backend authorization, secure authentication, input validation, and secret management.                                  |
| Privacy          | Minimize collected data, avoid raw video uploads by default, and provide appropriate consent and deletion mechanisms.           |
| Accessibility    | Support keyboard navigation, readable contrast, clear labels, and alternatives to camera-based interaction.                     |
| Maintainability  | Separate rendering, pose estimation, movement rules, business logic, and AI orchestration into testable modules.                |
| Portability      | Provide reproducible development and deployment through documented setup and containerization.                                  |

Two targets deserve particular attention.

First, pose estimation must not block the user interface. We should benchmark the actual browser implementation and use a Web Worker or equivalent approach if needed.

Second, we should not optimize only for average performance. The application must also communicate clearly when a camera, device, or model cannot support the requested analysis.

# Part IV — System architecture

## 4. High-level architecture

The proposed architecture separates the real-time interactive experience from the backend's business and AI workflows.

### Presentation layer

Next.js · React · TypeScript

Member application · Trainer dashboard · Admin dashboard

3D exercise module

Three.js · React Three Fiber · GLB · animation clips

Vision module

MediaPipe · landmarks · temporal analysis · movement rules

### Backend API

Python · FastAPI · Pydantic · authorization · business rules

AI orchestration

Plan generation, retrieval, validation, coaching

Domain services

Profiles, workouts, sessions, nutrition, administration

### Persistence and external services

PostgreSQL · optional pgvector · object storage · LLM provider

### Architectural decision: separate real-time logic from AI logic

The browser handles the latency-sensitive exercise experience:

- Camera acquisition and pose estimation.
- Landmark visualization and confidence checks.
- Joint-angle calculations and repetition counting.
- Rule-based feedback.
- 3D avatar rendering and animation playback.

The backend handles persistent and business-oriented work:

- Authentication and authorization.
- Profiles, plans, workout history, and nutrition data.
- AI orchestration and structured plan generation.
- Plan validation and versioning.
- Trainer oversight and business analytics.
- Evaluation records and operational telemetry.

The frontend can operate the core live exercise experience without requiring a round trip to an LLM for every frame. The backend remains authoritative for saved plans, permissions, and persistent records.

## 5. Recommended technology stack

| Layer              | Proposed technology                                        | Why                                                                      |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Web frontend       | Next.js, React, TypeScript                                 | Responsive product and business dashboard.                               |
| UI styling         | Tailwind CSS                                               | Consistent, maintainable UI development.                                 |
| 3D rendering       | Three.js with React Three Fiber                            | Reusable interactive 3D exercise viewer.                                 |
| 3D assets          | Blender, glTF/GLB                                          | Avatar rigging, exercise animation authoring, asset export.              |
| Pose estimation    | MediaPipe Pose Landmarker                                  | Existing body-landmark estimation without training a model from scratch. |
| Movement analysis  | TypeScript modules initially                               | Low-latency processing close to the camera pipeline.                     |
| Backend API        | Python, FastAPI, Pydantic                                  | Typed APIs, validation, and AI orchestration.                            |
| Database           | PostgreSQL                                                 | Relational data and transactional integrity.                             |
| Semantic retrieval | pgvector, if needed                                        | Retrieval over approved coaching content.                                |
| Authentication     | Managed auth service or a well-supported identity provider | Reduce custom authentication risk.                                       |
| Testing            | Vitest, Playwright, pytest                                 | Unit, integration, and end-to-end coverage.                              |
| Deployment         | Docker, CI/CD, managed hosting                             | Reproducible environments and automated releases.                        |
| Observability      | Structured logs, OpenTelemetry-compatible instrumentation  | Diagnose failures and measure performance.                               |

We should begin with a modular monolith: one frontend, one backend application, and one relational database, with clear internal module boundaries. Microservices would add operational overhead without a compelling initial need.

We should also keep the vision engine behind a stable interface so we can benchmark alternative pose-estimation implementations later.

## 6. Core data model

The following is the initial logical data model. It is not yet the final database schema; we will refine field types, indexes, constraints, and relationships during implementation.

User / Member Profile

Identity, preferences, goals, consent

Training Plan

Version, schedule, status, generation metadata

Planned Exercises

Exercise reference, sets, repetitions, rest, progression

Workout Session

Completion, feedback, session metrics

Exercise Performance Records

Repetitions, tempo, selected movement metrics, confidence

Additional entities:

| Entity                | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `users`               | Authentication identity and account status.                       |
| `member_profiles`     | Goals, equipment, preferences, and permitted personal context.    |
| `gyms`                | Tenant or business information.                                   |
| `gym_memberships`     | Member-to-gym relationship and membership status.                 |
| `trainer_assignments` | Defines which trainers may access which members.                  |
| `exercises`           | Approved exercise definitions and movement metadata.              |
| `exercise_assets`     | Animation files, thumbnails, instructions, and asset versions.    |
| `exercise_rules`      | Versioned, reviewed movement-analysis criteria.                   |
| `training_plans`      | Plan versions and lifecycle status.                               |
| `planned_exercises`   | Exercises and prescribed parameters within a plan.                |
| `workout_sessions`    | Actual workout sessions and completion status.                    |
| `performance_records` | Session-level measurements and confidence summaries.              |
| `meal_plans`          | Structured nutrition plans and version history.                   |
| `recipes`             | Ingredients, quantities, substitutions, and nutrition references. |
| `coach_conversations` | Authorized conversation metadata and relevant history.            |
| `escalations`         | Cases requiring trainer review or other human attention.          |
| `audit_events`        | Significant changes, administrative actions, and traceability.    |

### Important data-design decisions

- Each gym-owned record must have appropriate tenant scoping.
- Workout plans should be versioned rather than overwritten without history.
- Exercise rules and animation assets should have identifiable versions.
- Raw video should not be stored as a normal workout-session field.
- We should store only the movement metrics needed for feedback and evaluation.
- Sensitive profile information should be separated from general operational telemetry wherever practical.

## 7. Proposed API surface

The API should reflect business resources and explicit actions, rather than exposing one large endpoint that handles the entire application.

| Endpoint                                      | Purpose                                          | Priority |
| --------------------------------------------- | ------------------------------------------------ | -------- |
| `POST /api/v1/profiles`                       | Create or initialize a member profile.           | P0       |
| `GET /api/v1/profiles/me`                     | Retrieve the authenticated member's profile.     | P0       |
| `POST /api/v1/training-plans/generate`        | Request a new training plan.                     | P0       |
| `GET /api/v1/training-plans/current`          | Retrieve the current plan.                       | P0       |
| `POST /api/v1/workout-sessions`               | Start a workout session.                         | P0       |
| `POST /api/v1/workout-sessions/{id}/events`   | Record validated session events.                 | P0       |
| `POST /api/v1/workout-sessions/{id}/complete` | Complete and persist a session summary.          | P0       |
| `GET /api/v1/progress/summary`                | Retrieve progress and adherence metrics.         | P1       |
| `POST /api/v1/nutrition-plans/generate`       | Generate a structured meal plan.                 | P1       |
| `POST /api/v1/coach/messages`                 | Send a coaching message and retrieve a response. | P1       |
| `GET /api/v1/trainer/members`                 | List members assigned to a trainer.              | P1       |
| `GET /api/v1/admin/analytics`                 | Retrieve authorized business metrics.            | P1       |

The browser's live pose-estimation loop does not need to call a backend endpoint on every frame. We should send session summaries or selected derived events when persistence is required.

Plan generation and session completion should be designed to tolerate retries. We should use appropriate idempotency controls so that a repeated network request does not accidentally create duplicate plans or duplicate completed sessions.

# Part V — AI and computer vision design

## 8. Exercise-analysis engine

This is the most technically distinctive module in the project, so it deserves its own design.

The analysis engine should not be a single function that returns “good form” or “bad form.” It should be a pipeline with measurable intermediate outputs.

Stage 1: Landmark extraction

Obtain the required body landmarks, coordinates, visibility, and confidence from the pose estimator.

Stage 2: Feature calculation

Compute selected angles, relative distances, velocities, and temporal features. Reject invalid or implausible measurements.

Stage 3: Movement state machine

Track states such as standing, descending, bottom, ascending, and completed repetition. Use hysteresis and temporal constraints to avoid double counting.

Stage 4: Exercise-specific evaluation

Apply versioned rules to the available measurements, taking camera angle and tracking confidence into account.

Stage 5: Feedback selection

Prioritize the most useful supported cue, avoid repetitive messages, and explain when a measurement is uncertain.

### Example: squat analysis

For a squat, the engine might calculate a knee-angle estimate from the hip, knee, and ankle landmarks.

For points \\(A\\), \\(B\\), and \\(C\\), with \\(B\\) as the joint, the angle can be calculated as:

\\[ \theta = \cos^{-1}\left( \frac{(A-B)\cdot(C-B)} {\\|A-B\\|\\|C-B\\|} \right) \\]

We can then analyze how the angle changes over time, combine it with other landmark information, and identify likely movement phases.

However, an angle threshold alone is not a universal standard of good technique. Thresholds must be calibrated and reviewed for the particular exercise and intended feedback. The engine should also account for tracking confidence and the limitations of the camera view.

### Exercise rule contract

Each rule should declare:

- The exercise and rule version.
- Required landmarks and camera-view assumptions.
- Required measurement features.
- Confidence and validity conditions.
- The observable condition being evaluated.
- The permitted feedback message.
- Conditions under which feedback must be withheld.
- Test cases and expected outcomes.

This allows us to add exercises without rewriting the entire vision pipeline.

## 9. AI orchestration architecture

AI should coordinate approved capabilities rather than have unrestricted control of the application.

The core workflow is:

Member request

Goal, question, or requested plan change

Context retrieval

Authorized profile, approved content, current plan, session history

AI orchestration

Intent handling, structured generation, tool selection

Policy and domain validation

Permissions, schema, constraints, allowed actions

Approved action or response

Return an explanation, save a validated plan, or escalate

The model should not have unrestricted database access. It should invoke narrowly defined backend tools, such as `get_current_plan`, `generate_plan_draft`, and `request_trainer_review`, each with appropriate authorization.

We should start with one orchestrated AI workflow and deterministic business rules. Multiple autonomous agents can be introduced later only if evaluations show a meaningful benefit.

## 10. AI evaluation plan

We should maintain a versioned test suite containing representative member profiles, coaching requests, and edge cases.

Initial evaluation categories:

- Plan validity: Are all required fields present and correctly typed?
- Constraint adherence: Does the plan respect the member's equipment, schedule, and stated preferences?
- Knowledge grounding: Are exercise descriptions and nutrition information supported by approved sources?
- Permission correctness: Can the AI access only the authorized member context?
- Action correctness: Does the system avoid claiming that an action succeeded when it failed?
- Escalation correctness: Does the system recognize requests that exceed its intended scope?
- Operational performance: What are latency, failure rate, token consumption, and cost per workflow?

Every model or prompt change should be evaluated against the same regression suite. We should store aggregate results and representative failure cases, while avoiding unnecessary personal information in test fixtures.

# Part VI — Development plan

## 11. Milestones and deliverables

I recommend a milestone-driven implementation plan. Each phase must produce something working and testable.

### Milestone 0 — Foundation

Weeks 1–2 · Establish the engineering baseline

- Repository, development environment, linting, and tests.
- Responsive application shell and initial design system.
- Database and authentication.
- Exercise metadata schema and one seeded exercise.
- Architecture decision records.

  Exit condition: the application runs reproducibly and a signed-in member can access their own profile.

### Milestone 1 — 3D trainer

Weeks 3–4 · Build the visual exercise system

- Rigged avatar and GLB asset pipeline.
- Three.js exercise viewer and animation controls.
- Squat animation and phase-specific instructions.
- Exercise library with metadata and asset references.

  Exit condition: the user can open, play, pause, replay, and understand the squat demonstration.

### Milestone 2 — Live vision engine

Weeks 5–6 · Make camera tracking useful

- Camera permission and preview.
- Pose landmarks and tracking-confidence display.
- Feature extraction and temporal smoothing.
- Squat state machine and repetition counting.
- Camera-placement guidance and failure states.

  Exit condition: a member can perform a supported squat while the application tracks and counts repetitions, with explicit handling of unreliable tracking.

### Milestone 3 — Integrated AI coaching

Weeks 7–8 · Connect feedback and personalization

- Exercise-specific rule engine and feedback.
- Workout sessions and persistent history.
- Structured AI-generated workout plans.
- Validation, error handling, and evaluation suite.

  Exit condition: the member can receive a plan, follow a demonstration, complete a tracked workout, and see a saved session summary.

### Milestone 4 — Full member experience

Weeks 9–10 · Complete the coaching journey

- Add biceps curl and push-up analysis.
- Nutrition plans and approved recipes.
- Coaching assistant and progress dashboard.
- Plan versions and controlled adjustments.

  Exit condition: the supported member journey works end to end across all three initial exercises.

### Milestone 5 — Gym operations and hardening

Weeks 11–12 · Make it a business product

- Trainer and administrator dashboards.
- Member oversight and escalation workflow.
- Automated regression and end-to-end tests.
- Deployment, monitoring, security checks, and documentation.

  Exit condition: an administrator can manage the demo gym, a trainer can review assigned members, and the core system is deployed with observable operational behavior.

These are planning estimates for a focused solo developer, not guaranteed delivery dates. Animation authoring, pose-analysis validation, and browser performance may take longer than ordinary UI development. If we have limited time, we should preserve the quality of the core 3D-plus-vision workflow and defer lower-priority features rather than ship everything superficially.

## 12. Suggested repository structure

A monorepo will make it easier to develop and test the frontend and backend together.

```
fitpilot-ai/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   ├── features/
│       │   │   ├── onboarding/
│       │   │   ├── workouts/
│       │   │   ├── exercise-viewer/
│       │   │   ├── live-coaching/
│       │   │   ├── nutrition/
│       │   │   └── dashboard/
│       │   └── lib/
│       └── tests/
├── services/
│   └── api/
│       ├── app/
│       │   ├── api/
│       │   ├── core/
│       │   ├── models/
│       │   ├── schemas/
│       │   ├── repositories/
│       │   └── services/
│       │       ├── plans/
│       │       ├── coaching/
│       │       ├── nutrition/
│       │       ├── gym_operations/
│       │       └── evaluation/
│       └── tests/
├── packages/
│   ├── exercise-contracts/
│   ├── exercise-rules/
│   └── ui/
├── assets/
│   └── exercises/
│       ├── squat/
│       ├── biceps-curl/
│       └── push-up/
├── data/
│   ├── exercise-catalog/
│   └── evaluation-fixtures/
├── docs/
│   ├── architecture/
│   ├── requirements/
│   ├── decisions/
│   └── runbooks/
├── infra/
├── docker-compose.yml
├── README.md
└── .github/
    └── workflows/
```

This is a logical starting structure, not a requirement to create every folder on day one.

The `exercise-contracts` package should define shared exercise metadata and session-event formats. The browser and backend should agree on these contracts so that the frontend, vision engine, and persistence layer do not gradually develop incompatible representations.

## 13. Example exercise contract

Every supported exercise should be described in structured data.

```
{
  "id": "bodyweight_squat",
  "name": "Bodyweight Squat",
  "version": 1,
  "equipment": [],
  "camera_views": ["side"],
  "animation_asset": "squat.glb",
  "supported_capabilities": [
    "pose_tracking",
    "rep_counting",
    "phase_detection",
    "rule_based_feedback"
  ],
  "required_landmarks": [
    "left_hip",
    "left_knee",
    "left_ankle"
  ],
  "ruleset_version": 1
}
```

This is illustrative; the actual schema will need explicit validation and a defined mapping between MediaPipe's landmark identifiers and our application-level names.

The contract gives us a consistent way to load the avatar animation, configure pose analysis, select the correct instructions, and record which ruleset produced a feedback event.

## 14. Testing strategy

Testing should be designed into every milestone.

| Test level              | What it verifies                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Unit tests              | Joint-angle calculations, movement state machines, repetition counting, plan validation. |
| Component tests         | Exercise viewer controls, tracking-status indicators, and workout interactions.          |
| Integration tests       | API persistence, plan generation, authorization, and session-event recording.            |
| Vision regression tests | Movement analysis against annotated sample sequences.                                    |
| End-to-end tests        | Onboarding through workout completion and saved progress.                                |
| Security tests          | Unauthorized access, tenant isolation, input validation, and permission enforcement.     |
| Performance tests       | Frame processing, rendering responsiveness, API latency, and AI generation cost.         |
| AI evaluations          | Constraint adherence, grounding, correct tool use, and escalation behavior.              |

For computer vision, we need representative recordings with human-annotated repetitions, movement phases, and relevant observable characteristics. We should evaluate across different camera positions, lighting conditions, clothing, and body proportions.

We must not treat model confidence as proof of biomechanical correctness. Pose confidence measures the reliability of landmark estimation, while movement-rule validity requires separate evidence.

# Part VII — Risk register and release criteria

## 15. Major project risks

High

Unreliable form feedback

Mitigation: restrict the initial exercise set, define camera requirements, test against annotated examples, and withhold feedback when evidence is insufficient.

High

Poor 3D animation quality

Mitigation: use one rigged avatar, focus on a few reviewed animations, and validate joint motion and floor contact before adding exercises.

Medium

Scope expansion

Mitigation: maintain explicit MVP boundaries and require each new feature to justify its development and maintenance costs.

Medium

Unpredictable AI output or cost

Mitigation: structured outputs, deterministic validation, model abstraction, regression evaluations, caching where appropriate, and usage budgets.

Medium

Sensitive information and privacy exposure

Mitigation: local camera processing by default, data minimization, authorization checks, appropriate consent, retention controls, and security reviews.

## 16. Definition of Done for the MVP

The MVP should not be considered complete merely because the screens look finished.

It is complete when all of the following are true:

## MVP release checklist

### 0/12

Users can register, sign in, and manage their profiles.

A personalized workout plan is generated, validated, and saved.

A rigged 3D avatar demonstrates all three supported exercises.

The webcam pose tracker works on the documented supported devices and browsers.

Squat, biceps curl, and push-up analysis have tested exercise-specific rules.

Repetition counting and supported feedback are evaluated against annotated test examples.

The application handles poor tracking confidence without fabricating corrections.

A member can complete a workout and retrieve its saved history.

Nutrition planning and coaching chat respect approved data and application policies.

A trainer can review an assigned member and handle escalations.

Core authorization, privacy, error handling, and regression tests pass.

The application is deployed, documented, monitored, and reproducible from the repository.

This is a manual planning checklist, not an automated report of the project's implementation status.

One qualification: the first deployed version can be an MVP for portfolio demonstration and controlled pilot testing. It should not be marketed as a validated substitute for a qualified personal trainer until the exercise feedback, safety boundaries, and real-world performance have been independently evaluated to an appropriate standard.

# Part VIII — What we should do next

We now have a product specification, but we should resist immediately coding random features. The next step is to turn this blueprint into a buildable engineering plan.

I recommend proceeding in this order:

1. Finalize the technical decisions. Confirm the frontend and backend stack, 3D approach, pose-estimation implementation, authentication, database, and deployment strategy.
2. Create the project skeleton. Set up the monorepo, development environment, linting, test runners, Docker configuration, and initial CI workflow.
3. Prototype the highest-risk feature. Build a browser-based 3D squat demonstration alongside live webcam pose tracking and repetition counting. This will tell us early whether our chosen approach performs adequately on our target devices.
4. Establish a measurable baseline. Create annotated test sequences, define initial evaluation metrics, and document the limitations of the first movement-analysis rules.
5. Build the complete member workflow. Add authentication, onboarding, plan generation, session persistence, and progress tracking around the working 3D and vision components.

I would make the 3D avatar plus live squat analysis our first engineering milestone. It is the hardest and most differentiating part of the product, and validating it early will prevent us from spending weeks building a polished application around an unreliable core.

Once that prototype works, we can develop the rest of the system against the contracts and architecture defined above.

The end goal is not merely to say that we used AI, computer vision, and 3D graphics. It is to demonstrate that we can integrate those technologies into a reliable, measurable, business-oriented system—the kind of engineering problem that makes this project particularly relevant to Forward Deployed Engineering.