"use client";

import { MAX_NOTE_LENGTH } from "@fitpilot/exercise-contracts";
import { useState } from "react";
import { DIFFICULTY_HINT } from "./labels";

export interface SetFormValues {
  /** reps or seconds, when the form asks for them */
  amount: number | null;
  difficulty: number | null;
  note: string;
}

const input = "rounded-md border border-border bg-background px-3 py-2 text-base text-foreground";

/**
 * What the member tells us about one set: how much they did (typed sets only, a camera-counted
 * set already has its count), how hard it felt, and an optional note. Difficulty and note are
 * always optional (FR-07).
 */
export function SetForm({
  amountLabel,
  difficultyLabel = "How hard was it? (optional)",
  defaultAmount,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  /** null: no amount field (the camera counted the reps) */
  amountLabel: string | null;
  difficultyLabel?: string;
  defaultAmount?: number | null;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (values: SetFormValues) => void;
}) {
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : "");
  const [difficulty, setDifficulty] = useState("");
  const [note, setNote] = useState("");
  const amountValue = amount.trim() === "" ? null : Number(amount);
  const amountInvalid =
    amountLabel !== null &&
    (amountValue === null || !Number.isInteger(amountValue) || amountValue < 1);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (amountInvalid) return;
        onSubmit({
          amount: amountLabel === null ? null : amountValue,
          difficulty: difficulty === "" ? null : Number(difficulty),
          note,
        });
      }}
    >
      {amountLabel !== null && (
        <label className="flex flex-col gap-1 font-medium">
          {amountLabel}
          <input
            name="amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${input} w-32`}
          />
        </label>
      )}
      <label className="flex flex-col gap-1 font-medium">
        {difficultyLabel}
        <select
          name="difficulty"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          aria-describedby="difficulty-hint"
          className={`${input} w-48`}
        >
          <option value="">Not rated</option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span id="difficulty-hint" className="text-sm font-normal text-muted">
          {DIFFICULTY_HINT}
        </span>
      </label>
      <label className="flex flex-col gap-1 font-medium">
        Note (optional)
        <textarea
          name="note"
          rows={2}
          maxLength={MAX_NOTE_LENGTH}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={input}
        />
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={busy || amountInvalid}
          className="rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
