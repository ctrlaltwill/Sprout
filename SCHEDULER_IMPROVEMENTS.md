# Scheduler Improvements Plan

## 1. Non-deterministic Shuffling

**Issue**: `shuffleCardsWithinTimeWindow()` and `shuffleCardsWithParentAwareness()` use `Math.random()` directly, making testing, reproducibility, and debugging difficult.

**Severity**: Medium  
**Impact**: Limits test determinism and makes bug reproduction harder

**Recommendation**: Implement injectable/seeded RNG
- Add optional `rng?: () => number` parameter to shuffle functions
- Default to `Math.random` for backward compatibility
- Tests can inject seeded RNG for deterministic behavior

**Implementation approach**:
```typescript
export function shuffleCardsWithinTimeWindow<T>(
  cards: T[],
  windowSizeMs: number = 30 * 60 * 1000,
  rng: () => number = Math.random
): T[]
```

**Benefits**:
- Deterministic tests that can verify shuffle correctness
- Reproducible bug reports (users can share seed)
- No breaking changes (optional parameter)

---

## 2. Parent-aware Shuffle is Heuristic

**Issue**: Round-robin interleaving reduces sibling adjacency but doesn't guarantee optimal separation. With skewed parent distributions (e.g., parent A has 10 cards, parent B has 2), siblings can still cluster.

**Severity**: Low  
**Impact**: Minor UX degradation in edge cases with heavily skewed distributions

**Recommendation**: Document current behavior, consider advanced algorithm only if users report issues

**Current behavior**: Round-robin interleaving provides good-enough separation for typical use cases:
- If parent A has [a1, a2, a3, a4] and parent B has [b1, b2]
- Result: [a1, b1, a2, b2, a3, a4] — siblings separated by at least 1 card

**Optimal solution** (if needed later):
- Priority-queue greedy placement: always place next card that maximizes distance from same-parent
- Significantly more complex (~100 lines vs current ~50)
- Marginal benefit for typical cases

**Decision**: DEFER. Current heuristic is sufficient. Only implement if user reports indicate real problems.

---

## 3. Timezone Semantics

**Issue**: `startOfTomorrowMs()` uses local timezone (`setHours`, `setDate`). If the rest of the system assumes UTC, this can cause subtle bugs (e.g., cards buried at 11 PM might reappear immediately if timezone != UTC).

**Severity**: Medium  
**Impact**: Can cause cards to reappear at wrong times, particularly for users not in UTC

**Recommendation**: CRITICAL FIX
- Add UTC version: `startOfTomorrowUtcMs()`
- Document timezone behavior clearly
- Check codebase to determine which is appropriate

**Investigation needed**:
1. Does the app store/display times in UTC or local time?
2. Are users' due times in UTC or local?
3. Should bury use UTC midnight or local midnight?

**Implementation**:
```typescript
function startOfTomorrowUtcMs(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

function startOfTomorrowLocalMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}
```

Then document clearly in `buryCard()` which is used and why.

---

## 4. resetCardScheduling Ignores Settings

**Issue**: Function signature includes `settings: { scheduling: SchedulerSettings }` but it's explicitly unused (`void settings;`).

**Severity**: Low  
**Impact**: API confusion, potential for misunderstanding

**Recommendation**: Remove unused parameter OR add clear documentation

**Option A** (cleaner): Remove the parameter entirely
```typescript
export function resetCardScheduling(
  prev: CardState,
  now: number
): CardState
```

**Option B** (keep for future-proofing): Add JSDoc explaining why it's there
```typescript
/**
 * Resets a card's scheduling state back to New.
 * @param settings - Reserved for future use (e.g., custom reset behavior based on settings)
 */
export function resetCardScheduling(
  prev: CardState,
  now: number,
  settings: { scheduling: SchedulerSettings }
): CardState
```

**Decision**: Prefer Option A unless there's a concrete plan to use settings.

---

## 5. Silent Fallbacks

**Issue**: Several state coercions happen silently without logging:

1. `toFsrsCard()` line ~316: When `last_review` is missing but state !== New, silently resets to New
   ```typescript
   if (!last_review && state !== State.New) {
     state = State.New;
     last_review = undefined;
   }
   ```

2. `inferFsrsState()` has one warning for suspended cards, but other cases fall through silently

**Severity**: Medium  
**Impact**: Makes diagnosing data corruption difficult in production

**Recommendation**: Add telemetry/warnings for unexpected coercions

**Implementation**:
```typescript
// In toFsrsCard() around line 316
if (!last_review && state !== State.New) {
  log.warn(
    `toFsrsCard: coercing card to State.New due to missing last_review ` +
    `(state=${state}, reps=${s.reps}, lapses=${s.lapses})`
  );
  state = State.New;
  last_review = undefined;
}

// When clamping difficulty
if (Number.isFinite(s.difficulty)) {
  const original = Number(s.difficulty);
  const clamped = clamp(original, 1, 10);
  if (original !== clamped) {
    log.warn(`toFsrsCard: clamped difficulty from ${original} to ${clamped}`);
  }
}
```

**Benefits**:
- Production telemetry can catch data corruption early
- Easier debugging when users report unexpected behavior
- Minimal performance impact (warnings only fire on bad data)

---

## Priority Order

1. **HIGH**: Fix timezone semantics (#3) — can cause real bugs
2. **MEDIUM**: Add telemetry for silent fallbacks (#5) — helps diagnose issues
3. **MEDIUM**: Add seeded RNG option (#1) — improves testing
4. **LOW**: Clean up resetCardScheduling signature (#4) — minor cleanup
5. **DEFER**: Optimal parent shuffle (#2) — current approach is sufficient

---

## Testing Plan

After implementing fixes:

1. **Shuffle with seeded RNG**: Test that same seed produces same output
2. **UTC vs Local timezone**: Test bury behavior across timezone boundaries
3. **Telemetry**: Verify warnings fire for corrupted data scenarios
4. **Regression**: Ensure all existing tests still pass
