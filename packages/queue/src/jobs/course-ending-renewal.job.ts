export const COURSE_ENDING_RENEWAL_QUEUE = "course-ending-renewal";

/**
 * How often the class groups ending in seven days are looked at for the
 * renewal e-mail (OOC-53). Hourly, so the e-mail leaves within the hour after
 * 09:00 Lima; a tick before nine, or with nothing ending, reads nothing or
 * one indexed day.
 */
export const COURSE_ENDING_RENEWAL_EVERY_MS = 60 * 60 * 1000;
