import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { MAX_RELATIVE_SCHEDULE_MINUTES } from '@/lib/relativeSchedule'
import { ScheduleTimePicker } from './ScheduleTimePicker'

describe('ScheduleTimePicker interactions', () => {
    it('adjusts a custom relative delay in five-minute steps and confirms it', () => {
        const onSchedule = vi.fn()
        const onClose = vi.fn()
        render(
            <I18nProvider>
                <ScheduleTimePicker
                    anchorRef={{ current: document.createElement('button') }}
                    onSchedule={onSchedule}
                    onClose={onClose}
                />
            </I18nProvider>
        )

        const decrease = screen.getByRole('button', { name: 'Decrease by 5 minutes' })
        const increase = screen.getByRole('button', { name: 'Increase by 5 minutes' })
        expect(decrease).toBeDisabled()
        expect(screen.getByText('5 min')).toBeInTheDocument()
        fireEvent.click(increase)
        expect(screen.getByText('10 min')).toBeInTheDocument()
        fireEvent.click(increase)
        expect(screen.getByText('15 min')).toBeInTheDocument()
        fireEvent.click(decrease)
        expect(screen.getByText('10 min')).toBeInTheDocument()
        expect(onSchedule).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Schedule send' }))
        expect(onSchedule).toHaveBeenCalledWith({ type: 'relative', minutes: 10 })
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('respects the seven-day limit when editing a relative delay', () => {
        const onSchedule = vi.fn()
        render(
            <I18nProvider>
                <ScheduleTimePicker
                    anchorRef={{ current: document.createElement('button') }}
                    onSchedule={onSchedule}
                    onClose={vi.fn()}
                    pendingSchedule={{ type: 'relative', minutes: MAX_RELATIVE_SCHEDULE_MINUTES }}
                />
            </I18nProvider>
        )

        expect(screen.getByText(`${MAX_RELATIVE_SCHEDULE_MINUTES} min`)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Increase by 5 minutes' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Decrease by 5 minutes' }))
        fireEvent.click(screen.getByRole('button', { name: 'Schedule send' }))
        expect(onSchedule).toHaveBeenCalledWith({ type: 'relative', minutes: MAX_RELATIVE_SCHEDULE_MINUTES - 5 })
    })

    it('keeps the existing preset buttons as one-click choices', () => {
        const onSchedule = vi.fn()
        const onClose = vi.fn()
        render(
            <I18nProvider>
                <ScheduleTimePicker
                    anchorRef={{ current: document.createElement('button') }}
                    onSchedule={onSchedule}
                    onClose={onClose}
                />
            </I18nProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: '+30m' }))
        expect(onSchedule).toHaveBeenCalledWith({ type: 'preset', preset: '+30m' })
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('submits the specific datetime when Enter is pressed in the datetime input', () => {
        const anchorRef = { current: document.createElement('button') }
        const onSchedule = vi.fn()
        const onClose = vi.fn()
        const future = new Date(Date.now() + 60 * 60 * 1000)
        const pad = (n: number) => String(n).padStart(2, '0')
        const value = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`

        const onParentKeyDown = vi.fn()

        render(
            <I18nProvider>
                <div onKeyDown={onParentKeyDown}>
                    <ScheduleTimePicker
                        anchorRef={anchorRef}
                        onSchedule={onSchedule}
                        onClose={onClose}
                        pendingSchedule={null}
                    />
                </div>
            </I18nProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: /specific/i }))
        const input = screen.getByDisplayValue('')
        fireEvent.change(input, { target: { value } })

        const defaultNotPrevented = fireEvent.keyDown(input, { key: 'Enter' })

        expect(defaultNotPrevented).toBe(false)
        expect(onParentKeyDown).not.toHaveBeenCalled()
        expect(onSchedule).toHaveBeenCalledWith({ type: 'absolute', ms: new Date(value).getTime() })
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})
