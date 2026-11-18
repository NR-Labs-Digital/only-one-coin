'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CheckoutDraft, HoldOutcome, PublicCatalog, SeatHold, StepId } from './types'
import { STEP_ORDER } from './types'
import { emptyDraft, MAX_LOT_ITEMS, sameOfferGroups } from './checkout'

/**
 * Where a half-filled checkout survives a reload. `sessionStorage`, not
 * `localStorage`: the draft carries a document number and a birth date, and a
 * shared machine in a cabina should not hand the next person the previous
 * person's form. Closing the tab is meant to end it.
 */
const DRAFT_KEY = 'ooc.enrollment.draft'
const HOLD_KEY = 'ooc.enrollment.hold'

/** How often the countdown redraws. One second — it is a clock on screen. */
const TICK_MS = 1000

type StoredDraft = Omit<CheckoutDraft, 'payment'> & {
  payment: Omit<CheckoutDraft['payment'], 'receipt'> & {
    receipt: { fileName: string; sizeBytes: number; receiptUploadId: string | null } | null
  }
}

function readStored<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    // A private-mode browser that refuses storage costs the reader their
    // draft on reload; it must never cost them the page.
    return null
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* see readStored */
  }
}

function clearStored(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    /* see readStored */
  }
}

export interface CheckoutController {
  draft: CheckoutDraft
  setDraft: (next: CheckoutDraft | ((prev: CheckoutDraft) => CheckoutDraft)) => void
  step: StepId
  goTo: (step: StepId) => void
  /** Seconds left on the checkout hold, or null when no seat is held. */
  holdSecondsLeft: number | null
  /**
   * The hold ran out. A terminal state, not a step: the checkout is over and
   * the only way on is to start again.
   */
  holdExpired: boolean
  /** The hold the submit consumes, or null when no seat is held. */
  holdId: string | null
  /** A request for a seat is in flight. */
  holding: boolean
  /** Why the last request for a seat did not get one. */
  holdError: Exclude<HoldOutcome, 'held'> | null
  /** Throws the attempt away and opens an empty checkout. */
  restart: () => void
  /**
   * Asks the server for a seat in the class group. A live hold on the same
   * class group is kept; one on another class group is given back first.
   */
  startHold: (classGroupId: string) => Promise<HoldOutcome>
  /** Freezes the hold once the receipt is in — the 5-day clock takes over. */
  settleHold: () => void
  /** The server said the hold is gone (submit refused it): end the attempt. */
  expireHold: () => void
  /**
   * The hold the receipt is uploaded against: the lot's first (OOC-158), or the
   * only one. The submit's receipt has to belong to it.
   */
  receiptHoldId: string | null
  /**
   * Settles the item being filled into the lot, with the seat it holds, and
   * opens a new item for the next course — for the same person by default.
   * False when there is no seat to carry or the lot is full.
   */
  addAnotherCourse: () => boolean
  /** Undoes the last `addAnotherCourse`: that item is the one being filled again. */
  cancelAnotherCourse: () => void
  /** Takes one settled item out of the lot and gives its seat back. */
  removeLotEntry: (index: number) => void
}

/** The API's error envelope — only `reason` matters here. */
async function reasonOf(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { reason?: unknown }
    return typeof body.reason === 'string' ? body.reason : null
  } catch {
    return null
  }
}

/**
 * Gives a seat back on the server. Best effort and never awaited by the
 * screen: if it fails, the sweep hands the seat back when the hold runs out.
 */
function releaseOnServer(holdId: string): void {
  void fetch(`/api/v1/seat-holds/${encodeURIComponent(holdId)}/release`, {
    method: 'POST',
    keepalive: true,
  }).catch(() => {
    /* see above — the sweep is the guarantee */
  })
}

/**
 * The wizard's state: the draft, the step and the seat hold.
 *
 * Two things it is careful about.
 *
 * The **draft persists** (Sessão 20 of the roadmap): step 3 sends the reader
 * out to their banking app, and on a phone that often means the tab is
 * reloaded on return. Losing twenty fields at that exact moment is losing the
 * enrollment.
 *
 * The **hold is the server's**, not this hook's. `apps/api` takes the seat,
 * stamps the deadline and hands the seat back when it passes; the countdown
 * on screen is comfort. A clock the client owns is a clock the client can
 * stop (`docs/MATRICULA-CHECKOUT.md` §3) — which is why the submit, not this
 * countdown, is what finally says a hold is gone.
 *
 * The **channel** (`draft.source`) was resolved from the link on arrival and
 * travels with the claim; the server keeps it on the hold and copies it onto
 * the enrollment, so the submit never gets to say where it came from.
 */
export function useCheckout(
  catalog: PublicCatalog,
  initialDraft: CheckoutDraft,
): CheckoutController {
  const [draft, setDraftState] = useState<CheckoutDraft>(initialDraft)
  const [step, setStep] = useState<StepId>(
    initialDraft.course.classGroupId ? 'student' : 'course',
  )
  const [hold, setHoldState] = useState<SeatHold | null>(null)
  const [now, setNow] = useState<number | null>(null)
  const [holdExpired, setHoldExpired] = useState(false)
  const [holding, setHolding] = useState(false)
  const [holdError, setHoldError] = useState<CheckoutController['holdError']>(null)
  /** The same hold, readable from inside an async claim without a stale closure. */
  const holdRef = useRef<SeatHold | null>(null)
  /** The draft, readable from inside a callback without a stale closure. */
  const draftRef = useRef(initialDraft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  const sourceRef = useRef(initialDraft.source)

  /** State for the screen, ref for the async claim, storage for a reload. */
  const setHold = useCallback((next: SeatHold | null) => {
    holdRef.current = next
    setHoldState(next)
    if (next) writeStored(HOLD_KEY, next)
    else clearStored(HOLD_KEY)
  }, [])

  useEffect(() => {
    sourceRef.current = draft.source
  }, [draft.source])
  const [restored, setRestored] = useState(false)
  const bootstrapped = useRef(false)
  /** The arrival as the server resolved it — frozen at first render. */
  const arrival = useRef(initialDraft)

  /**
   * Restore after mount, never during render: the server rendered the arrival
   * draft, and reading storage while rendering hands React a different tree
   * than the HTML it is hydrating.
   *
   * The merge is where the two ways in meet. A stored draft is somebody's
   * unfinished session in this tab; the URL is what they just clicked. When
   * both have an opinion about the course, **the link wins** — opening a
   * seller's link and landing on the course you abandoned an hour ago is worse
   * than losing a half-made choice. Everything the link says nothing about
   * (name, document, receipt) is restored as it was.
   */
  useEffect(() => {
    const incoming = arrival.current
    const stored = readStored<StoredDraft>(DRAFT_KEY)
    const linkChose = incoming.course.courseId !== null

    if (stored) {
      const course = linkChose ? incoming.course : stored.course
      // A stored draft from before a field was added to StudentDraft/
      // GuardianDraft (sessionStorage outlives a deploy) restores without
      // it — merged over a fresh empty draft's shape, not the raw stored
      // object, so a missing field lands on its default instead of
      // `undefined`.
      const fallback = emptyDraft(incoming.source)
      setDraftState({
        ...stored,
        course,
        student: { ...fallback.student, ...stored.student },
        guardian: { ...fallback.guardian, ...stored.guardian },
        // A draft stored before lots existed (OOC-158) has neither.
        lot: stored.lot ?? [],
        samePersonAs: stored.samePersonAs ?? null,
        // The object URL from the previous page life is dead; the file
        // description survives so the reader sees what they attached.
        payment: {
          ...stored.payment,
          receipt: stored.payment.receipt
            ? { ...stored.payment.receipt, previewUrl: null }
            : null,
        },
        // The link that brought them here decided the channel, and a reload is
        // not a new arrival — the restored value wins over the fresh one only
        // when the fresh one is the default.
        source: incoming.source === 'web' ? stored.source : incoming.source,
        campaign:
          Object.keys(incoming.campaign).length > 0
            ? incoming.campaign
            : stored.campaign,
      })
      // The invariant that keeps the wizard coherent: no step past the first
      // without a class group behind it. Everything downstream reads the class
      // group for the price, the schedule and the seat.
      setStep(course.classGroupId ? 'student' : 'course')
    }

    const storedHold = readStored<SeatHold>(HOLD_KEY)
    // A hold that belongs to a class group nobody is buying any more is not a
    // hold — it is a countdown against the wrong seat, so it goes back. One
    // stored before holds had a server id (sessionStorage outlives a deploy)
    // names nothing on the server and is simply dropped.
    if (storedHold) {
      const target = linkChose
        ? incoming.course.classGroupId
        : (stored?.course.classGroupId ?? null)
      if (storedHold.id && storedHold.classGroupId === target) {
        setHold(storedHold)
      } else {
        if (storedHold.id) releaseOnServer(storedHold.id)
        clearStored(HOLD_KEY)
      }
    }

    setNow(Date.now())
    setRestored(true)
  }, [setHold])

  /**
   * Persist — but never before the restore has actually landed in state.
   *
   * Gating this on a ref was a bug with teeth. Effects run in declaration
   * order within one commit, so the restore effect flipped the ref and queued
   * `setDraftState(stored)`, and then THIS effect ran in the same commit with
   * `draft` still holding the empty initial value — writing the empty draft
   * over the good one. A second remount before the corrective write (a locale
   * switch does exactly that) then read the emptied draft back.
   *
   * `restored` is state, not a ref: the first render where it is true is the
   * render where `draft` is already the restored one.
   */
  useEffect(() => {
    if (restored) writeStored(DRAFT_KEY, draft)
  }, [draft, restored])

  /** Every seat the checkout holds: the lot's (OOC-158) and the current one. */
  const heldSeats = useMemo(
    () => [...draft.lot.map((entry) => entry.hold), ...(hold ? [hold] : [])],
    [draft.lot, hold],
  )

  /** The countdown only runs while a seat is actually being held. */
  const holdingAny = heldSeats.length > 0
  useEffect(() => {
    if (!holdingAny) return
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [holdingAny])

  /** The countdown runs to the first seat to run out — it is one checkout. */
  const holdSecondsLeft = useMemo(() => {
    if (heldSeats.length === 0 || now === null) return null
    const first = Math.min(...heldSeats.map((seat) => Date.parse(seat.expiresAt)))
    return Math.max(0, Math.round((first - now) / 1000))
  }, [heldSeats, now])

  /**
   * The server says the hold is no longer a reservation — the checkout let go
   * of it, or nothing of the schedule is on sale any more — and the attempt
   * ends here.
   *
   * The countdown reaching zero does **not** end it any more (OOC-155, owner's
   * decision of 14/11/2026): somebody who left to pay and came back late has
   * already paid, and the server seats an expired hold on submit — in a
   * regular seat if the schedule still has one, above capacity if not. Only
   * the server's refusal is terminal.
   *
   * Everything typed is discarded then rather than kept warm for a retry: a
   * half-filled form sitting in a shared browser is a document number and a
   * birth date left on a machine in a cabina, and the checkout has no session
   * to tie it to anybody.
   */
  const expireHold = useCallback(() => {
    setHoldExpired(true)
    setHold(null)
    clearStored(DRAFT_KEY)
  }, [setHold])

  /** Points the draft at the class group the seat is actually held in. */
  const settleOnGroup = useCallback((classGroupId: string) => {
    setDraftState((prev) =>
      prev.course.classGroupId === classGroupId
        ? prev
        : { ...prev, course: { ...prev.course, classGroupId } },
    )
  }, [])

  const startHold = useCallback(
    async (classGroupId: string): Promise<HoldOutcome> => {
      // The reader picked a schedule, not a class group (OOC-140): any group
      // of the same offer is the seat they asked for, and which one it lands
      // in is the server's call — it fills them in code order (OOC-145).
      const offer = sameOfferGroups(catalog, classGroupId)

      const current = holdRef.current
      if (
        current &&
        offer.some((group) => group.id === current.classGroupId) &&
        Date.parse(current.expiresAt) > Date.now()
      ) {
        // Back to step 1 and on again with the same schedule: still the same seat.
        settleOnGroup(current.classGroupId)
        return 'held'
      }

      // The catalog on screen can be minutes old, so a schedule it shows as
      // full is still asked for: the server has the last word.
      if (offer.length === 0) {
        setHoldError('full')
        return 'full'
      }

      // Changing class group gives the previous seat back now, not in fifteen
      // minutes — in a class group down to its last seats, that is somebody
      // else's place.
      if (current) {
        releaseOnServer(current.id)
        setHold(null)
      }

      setHolding(true)
      setHoldError(null)
      try {
        const response = await fetch('/api/v1/seat-holds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classGroupId, origin: sourceRef.current }),
        })

        if (!response.ok) {
          const reason = await reasonOf(response)
          // Every group of this schedule is full, or none is on offer any
          // more: the reader picks again.
          if (
            reason === 'enrollment.class_group_full' ||
            reason === 'enrollment.class_group_not_found'
          ) {
            setHoldError('full')
            return 'full'
          }
          setHoldError('failed')
          return 'failed'
        }

        const body = (await response.json()) as {
          holdId: string
          classGroupId: string
          secondsLeft: number
        }
        setHold({
          id: body.holdId,
          classGroupId: body.classGroupId,
          expiresAt: new Date(Date.now() + body.secondsLeft * 1000).toISOString(),
        })
        // The seat may have landed in a sibling of the group the draft named;
        // the submit has to name the group the hold is in.
        settleOnGroup(body.classGroupId)
        setHoldExpired(false)
        setNow(Date.now())
        return 'held'
      } catch {
        setHoldError('failed')
        return 'failed'
      } finally {
        setHolding(false)
      }
    },
    [catalog, setHold, settleOnGroup],
  )

  /**
   * The receipt landed. The seat stays `reserved` — sending proof is not the
   * same as having it approved (`CLAUDE.md` §5) — but it stops racing the short
   * clock and starts waiting on the review window instead. The server already
   * consumed the hold in the same transaction as the enrollment.
   */
  const settleHold = useCallback(() => {
    setHold(null)
    setHoldExpired(false)
  }, [setHold])

  /**
   * Somebody arriving on the seller's link lands past step 1 with the class
   * group already settled, so nothing ever pressed "continue" to claim the
   * seat. They still need one held: they have usually already paid, and a seat
   * filling up while they type their name is the exact failure the hold exists
   * to prevent. Runs once, and only when no hold came back from a reload. If
   * the seat cannot be had, they land back on step 1 with the reason on screen.
   */
  useEffect(() => {
    if (!restored || bootstrapped.current) return
    bootstrapped.current = true
    if (!hold && draft.course.classGroupId && step !== 'course') {
      void startHold(draft.course.classGroupId).then((outcome) => {
        if (outcome !== 'held') setStep('course')
      })
    }
  }, [restored, hold, draft.course.classGroupId, step, startHold])

  const restart = useCallback(() => {
    // Starting over from the success screen finds no hold (the submit consumed
    // it); starting over mid-checkout gives every seat back, the lot's too.
    if (holdRef.current) releaseOnServer(holdRef.current.id)
    for (const entry of draftRef.current.lot) releaseOnServer(entry.hold.id)
    clearCheckoutStorage()
    bootstrapped.current = true
    setDraftState(emptyDraft(arrival.current.source))
    setHold(null)
    setHoldExpired(false)
    setHoldError(null)
    setStep('course')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }, [setHold])


  const setDraft = useCallback(
    (next: CheckoutDraft | ((prev: CheckoutDraft) => CheckoutDraft)) => {
      setDraftState((prev) => (typeof next === 'function' ? next(prev) : next))
    },
    [],
  )

  /*
   * The lot (OOC-158). Every change to it drops the attached receipt: the
   * amount to pay changed with it, and a receipt for the old amount is one the
   * review would have to refuse. The payment method stays — it is a choice,
   * not a fact about the money.
   */
  const addAnotherCourse = useCallback((): boolean => {
    const current = holdRef.current
    if (!current || draftRef.current.lot.length + 1 >= MAX_LOT_ITEMS) return false
    // The seat moves into the lot — never given back: it is one of the
    // enrollments this checkout pays for.
    setHold(null)
    setDraftState((prev) => {
      const lot = [
        ...prev.lot,
        { course: prev.course, student: prev.student, guardian: prev.guardian, hold: current },
      ]
      return {
        ...prev,
        lot,
        // The next course is for the same person until the reader says otherwise.
        samePersonAs: lot.length - 1,
        course: { languageId: prev.course.languageId, courseId: null, startDate: null, classGroupId: null },
        payment: { ...prev.payment, receipt: null },
      }
    })
    return true
  }, [setHold])

  const cancelAnotherCourse = useCallback(() => {
    const last = draftRef.current.lot.at(-1)
    if (!last) return
    // A seat claimed for the course being abandoned goes back now.
    if (holdRef.current) releaseOnServer(holdRef.current.id)
    setHold(last.hold)
    setDraftState((prev) => ({
      ...prev,
      lot: prev.lot.slice(0, -1),
      samePersonAs: null,
      course: last.course,
      student: last.student,
      guardian: last.guardian,
      payment: { ...prev.payment, receipt: null },
    }))
  }, [setHold])

  const removeLotEntry = useCallback((index: number) => {
    const entry = draftRef.current.lot[index]
    if (!entry) return
    releaseOnServer(entry.hold.id)
    setDraftState((prev) => {
      const samePersonAs =
        prev.samePersonAs === null || prev.samePersonAs === index
          ? null
          : prev.samePersonAs > index
            ? prev.samePersonAs - 1
            : prev.samePersonAs
      return {
        ...prev,
        lot: prev.lot.filter((_, at) => at !== index),
        samePersonAs,
        payment: { ...prev.payment, receipt: null },
      }
    })
  }, [])

  const goTo = useCallback((target: StepId) => {
    if (!STEP_ORDER.includes(target)) return
    setStep(target)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }, [])

  return {
    draft,
    setDraft,
    step,
    goTo,
    holdSecondsLeft,
    holdExpired,
    holdId: hold?.id ?? null,
    holding,
    holdError,
    startHold,
    settleHold,
    expireHold,
    restart,
    receiptHoldId: draft.lot[0]?.hold.id ?? hold?.id ?? null,
    addAnotherCourse,
    cancelAnotherCourse,
    removeLotEntry,
  }
}

/** Wipes the draft once it has been submitted — nothing left to resume. */
export function clearCheckoutStorage(): void {
  clearStored(DRAFT_KEY)
  clearStored(HOLD_KEY)
}
