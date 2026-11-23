"use client";

import { createContext, useContext, useState } from "react";
import { useTranslations } from "next-intl";
import type { ClassGroupItem } from "@/lib/backoffice/types";
import {
  deleteClassGroups,
  setCatalogEntryOnOffer,
} from "@/lib/backoffice/catalog-client";
import { BoIcon } from "@/components/backoffice/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Which class groups are ticked on the list, while selecting is on. Absent
 * (null) everywhere else — the pending list, a reader without the right —
 * and then the table has no checkbox column at all.
 */
export interface ClassGroupSelection {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  /** Ticks or unticks every id at once — the header checkbox of one table. */
  setMany: (ids: string[], on: boolean) => void;
}

export const ClassGroupSelectionContext =
  createContext<ClassGroupSelection | null>(null);

export function useClassGroupSelection(): ClassGroupSelection | null {
  return useContext(ClassGroupSelectionContext);
}

const secondaryButtonClass =
  "inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

const dangerButtonClass =
  "inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40";

const solidDangerButtonClass =
  "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40";

type Action = "retire" | "delete";

/** What one bulk action did, for the toast. */
export interface BulkOutcome {
  action: Action;
  done: number;
  /** Refused or failed — still there. */
  left: number;
}

/**
 * The bar above the list while class groups are ticked: retire them from the
 * catalog, or delete the ones nobody ever touched (CLAUDE.md §1, exception of
 * 23/11/2026). Both confirm first and say what will happen to each part of
 * the selection before anything is sent.
 */
export function ClassGroupSelectionBar({
  rows,
  onClear,
  onDone,
}: {
  /** The ticked class groups that are still on the list. */
  rows: ClassGroupItem[];
  onClear: () => void;
  onDone: (outcome: BulkOutcome) => void;
}) {
  const t = useTranslations("bo");
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [pending, setPending] = useState(false);

  const retirable = rows.filter((row) => row.active);
  const deletable = rows.filter((row) => row.deleteBlocker === null);
  const kept = rows.filter((row) => row.deleteBlocker !== null);
  /* Seats still held on what is about to leave the catalog — the warning
     retiring always carries (OOC-70), summed for the selection. */
  const seatsHeld = retirable.reduce(
    (sum, row) => sum + row.seatsTaken + row.seatsOver,
    0,
  );

  async function retire() {
    setPending(true);
    let done = 0;
    // One at a time: the retire route is per entry, and idempotent.
    for (const row of retirable) {
      const result = await setCatalogEntryOnOffer(
        "class_group",
        row.id,
        "retire",
      );
      if (result.ok) done += 1;
    }
    setPending(false);
    setConfirming(null);
    onDone({ action: "retire", done, left: retirable.length - done });
  }

  async function remove() {
    setPending(true);
    const answer = await deleteClassGroups(deletable.map((row) => row.id));
    const done = answer.results.filter(
      (result) => result.outcome === "deleted",
    ).length;
    setPending(false);
    setConfirming(null);
    onDone({ action: "delete", done, left: deletable.length - done });
  }

  return (
    <>
      <div
        role="region"
        aria-label={t("class_groups.selection_label")}
        className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-brand-blue/30 bg-sky-soft/95 px-4 py-3 shadow-sm backdrop-blur"
      >
        <span className="mr-auto text-sm font-semibold text-ink">
          {t("class_groups.selected_count", { count: rows.length })}
        </span>
        <button
          type="button"
          disabled={retirable.length === 0}
          onClick={() => setConfirming("retire")}
          className={secondaryButtonClass}
        >
          <BoIcon name="close" size={16} />
          {t("class_groups.bulk_retire", { count: retirable.length })}
        </button>
        <button
          type="button"
          disabled={deletable.length === 0}
          onClick={() => setConfirming("delete")}
          className={dangerButtonClass}
        >
          <BoIcon name="trash" size={16} />
          {t("class_groups.bulk_delete", { count: deletable.length })}
        </button>
        <button
          type="button"
          onClick={onClear}
          className={secondaryButtonClass}
        >
          {t("class_groups.selection_cancel")}
        </button>
      </div>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => !open && !pending && setConfirming(null)}
      >
        <DialogContent className="bg-white">
          {confirming === "retire" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("class_groups.bulk_retire_title", {
                    count: retirable.length,
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t("class_groups.bulk_retire_body")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 px-4">
                <p className="text-sm text-ink">
                  {seatsHeld === 0
                    ? t("class_groups.bulk_retire_no_seats")
                    : t("class_groups.bulk_retire_seats", { count: seatsHeld })}
                </p>
                {retirable.length < rows.length && (
                  <p className="text-sm text-muted-foreground">
                    {t("class_groups.bulk_retire_already", {
                      count: rows.length - retirable.length,
                    })}
                  </p>
                )}
              </div>
              <DialogFooter>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(null)}
                  className={secondaryButtonClass}
                >
                  {t("class_groups.cancel")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void retire()}
                  className={solidDangerButtonClass}
                >
                  {t("class_groups.bulk_retire_confirm", {
                    count: retirable.length,
                  })}
                </button>
              </DialogFooter>
            </>
          )}

          {confirming === "delete" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("class_groups.bulk_delete_title", {
                    count: deletable.length,
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t("class_groups.bulk_delete_body")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4">
                <ul className="max-h-40 overflow-y-auto text-sm text-ink">
                  {deletable.map((row) => (
                    <li
                      key={row.id}
                      className="tabular-nums"
                    >{`${row.code} · ${row.courseName}`}</li>
                  ))}
                </ul>
                {kept.length > 0 && (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="flex items-start gap-2 text-sm text-ink">
                      <BoIcon
                        name="alert"
                        size={14}
                        className="mt-0.5 shrink-0 text-amber-700"
                      />
                      {t("class_groups.bulk_delete_kept", {
                        count: kept.length,
                      })}
                    </p>
                    <ul className="max-h-32 overflow-y-auto pl-6 text-xs text-muted-foreground">
                      {kept.map((row) => (
                        <li key={row.id} className="tabular-nums">
                          {`${row.code} · ${t(`class_groups.delete_blocker_${row.deleteBlocker!}`)}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <DialogFooter>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(null)}
                  className={secondaryButtonClass}
                >
                  {t("class_groups.cancel")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void remove()}
                  className={solidDangerButtonClass}
                >
                  {t("class_groups.bulk_delete_confirm", {
                    count: deletable.length,
                  })}
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
