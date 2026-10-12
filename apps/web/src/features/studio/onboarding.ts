// "Getting started" progress for a club account: each step ticks once its page
// has been opened. Per-browser convenience only (localStorage); if storage is
// blocked the checklist simply keeps showing.
import { useEffect } from 'react'

export type OnboardingStep = 'rules' | 'first'

// Older browsers may still store 'mfa' (a removed step): readVisited ignores
// anything not listed here.
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['rules', 'first']

const stepsKey = (username: string) => `usmfomo.studio.onboarding.${username}`
// The rules page is public and knows no account, so it marks the browser.
const RULES_KEY = 'usmfomo.rulesSeen'

export function readVisited(username: string): Set<OnboardingStep> {
  const seen = new Set<OnboardingStep>()
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(stepsKey(username)) ?? '[]')
    if (Array.isArray(raw)) for (const s of raw) if (ONBOARDING_STEPS.includes(s)) seen.add(s)
    if (window.localStorage.getItem(RULES_KEY) === '1') seen.add('rules')
  } catch {
    // unreadable or blocked storage: nothing seen yet
  }
  return seen
}

export function markVisited(username: string, step: OnboardingStep): void {
  try {
    const seen = readVisited(username)
    seen.add(step)
    window.localStorage.setItem(stepsKey(username), JSON.stringify([...seen]))
  } catch {
    // storage blocked
  }
}

export function markRulesSeen(): void {
  try {
    window.localStorage.setItem(RULES_KEY, '1')
  } catch {
    // storage blocked
  }
}

/** Marks a step as seen when its page opens. */
export function useMarkVisited(username: string, step: OnboardingStep): void {
  useEffect(() => markVisited(username, step), [username, step])
}
