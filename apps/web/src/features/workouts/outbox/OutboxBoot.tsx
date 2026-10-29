"use client";
import { useEffect } from "react";
import { getOutbox, installFlushTriggers } from "./browser";

/** Mounted once in the member shell: sends anything left from an earlier visit, and on reconnect. */
export function OutboxBoot() {
  useEffect(() => installFlushTriggers(getOutbox()), []);
  return null;
}
