export const RELATIVE_SCHEDULE_STEP_MINUTES = 5
export const MAX_RELATIVE_SCHEDULE_MINUTES = 7 * 24 * 60

export function isValidRelativeScheduleMinutes(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= RELATIVE_SCHEDULE_STEP_MINUTES
        && value <= MAX_RELATIVE_SCHEDULE_MINUTES
        && value % RELATIVE_SCHEDULE_STEP_MINUTES === 0
}
