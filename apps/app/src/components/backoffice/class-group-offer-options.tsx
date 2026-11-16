'use client'

import { useTranslations } from 'next-intl'
import {
  offerSeatsLeft,
  pickerValue,
  seatsLeft,
  type OfferMember,
  type PickerOffer,
} from '@/lib/backoffice/class-group-offers'

/**
 * The `<option>`s of a class group picker, grouped by schedule (OOC-145).
 *
 * A schedule with one class group is one option, as before. A schedule with
 * several is an `<optgroup>`: first "the first one with room" — the API picks,
 * in code order —, then each code, for when staff means that one. Native
 * `<select>` on purpose: on a phone it opens the system picker, which already
 * shows the group headings.
 */
export function ClassGroupOfferOptions<T extends OfferMember>({
  offers,
  ownClassGroupId = null,
  label,
  heading,
  name,
  memberLabel,
}: {
  offers: readonly PickerOffer<T>[]
  /** The class group the seat is in now (the move): picking its schedule keeps the seat there. */
  ownClassGroupId?: string | null
  /** A schedule with a single class group: the whole option text. */
  label: (member: T) => string
  /** A schedule with several: the `<optgroup>` heading (course, hour, period). */
  heading: (offer: PickerOffer<T>) => string
  /**
   * A schedule with several: what the "first with room" option starts with.
   * A closed `<select>` shows the option, never its `<optgroup>` heading, so
   * the option has to say which course it is on its own.
   */
  name: (member: T) => string
  /** A schedule with several: what tells this one apart (code, teacher) — with the course, for the same reason as `name`. */
  memberLabel: (member: T) => string
}) {
  const t = useTranslations('bo')
  // Another run of its own class group: the seat stays, so room is not the question.
  const text = (key: 'single' | 'member', member: T, text: string) =>
    member.classGroupId === ownClassGroupId
      ? t(`class_group_picker.${key}_stays`, { label: text })
      : t(`class_group_picker.${key}`, { label: text, left: seatsLeft(member) })

  return offers.map((offer) => {
    if (offer.members.length === 1) {
      const member = offer.members[0]!
      return (
        <option key={member.id} value={pickerValue('class_group', member.id)}>
          {text('single', member, label(member))}
        </option>
      )
    }

    const first = offer.members[0]!
    const left = offerSeatsLeft(offer.members.filter((member) => member.classGroupId !== ownClassGroupId))
    const any =
      first.classGroupId === ownClassGroupId
        ? t('class_group_picker.any_stays', { name: name(first), code: first.code })
        : t('class_group_picker.any', { name: name(first), count: offer.members.length, left })

    return (
      <optgroup key={offer.key} label={heading(offer)}>
        <option value={pickerValue('schedule', first.id)}>{any}</option>
        {offer.members.map((member) => (
          <option key={member.id} value={pickerValue('class_group', member.id)}>
            {text('member', member, memberLabel(member))}
          </option>
        ))}
      </optgroup>
    )
  })
}
