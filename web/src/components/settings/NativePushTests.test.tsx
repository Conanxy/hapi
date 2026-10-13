import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { I18nProvider } from '@/lib/i18n-context'
import { NativePushTests } from './NativePushTests'

const { api, context } = vi.hoisted(() => ({
    api: { getNativePushDevices: vi.fn(), testNativePush: vi.fn() },
    context: { baseUrl: 'https://hub.test', token: 'token-a' },
}))

vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ api, ...context }) }))

const device = { deviceId: 'install-1', platform: 'vivo', providerId: 'vivo', updatedAt: 100_000, enabled: true, testable: true }

function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const tree = () => <QueryClientProvider client={client}><I18nProvider><NativePushTests /></I18nProvider></QueryClientProvider>
    const result = render(tree())
    return { ...result, redraw: () => result.rerender(tree()) }
}

describe('native push tests settings', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
        context.baseUrl = 'https://hub.test'
        context.token = 'token-a'
        api.getNativePushDevices.mockResolvedValue({ devices: [device] })
        api.testNativePush.mockResolvedValue({ status: 'accepted', providerId: 'vivo', retryAfterSeconds: 10 })
    })
    afterEach(() => vi.useRealTimers())

    it('sends only the selected device and distinguishes acceptance from receipt', async () => {
        api.getNativePushDevices.mockResolvedValue({ devices: [device, { ...device, deviceId: 'install-2' }] })
        mount()
        const send = await screen.findByRole('button', { name: 'Send test push to vivo install-2' })
        vi.useFakeTimers({ shouldAdvanceTime: true })
        fireEvent.click(send)
        await waitFor(() => expect(api.testNativePush).toHaveBeenCalledWith({ deviceId: 'install-2', platform: 'vivo' }))
        expect(await screen.findByText('Push provider accepted the test. Device receipt is not confirmed.')).toBeInTheDocument()
        expect(send).toBeDisabled()
        expect(screen.getByText('Next test available in 10s.')).toBeInTheDocument()
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
        expect(send).toBeEnabled()
        expect(api.testNativePush).toHaveBeenCalledTimes(1)
    })

    it('shows pending state and prevents duplicate sends', async () => {
        let resolveSend!: (value: unknown) => void
        api.testNativePush.mockImplementation(() => new Promise(resolve => { resolveSend = resolve }))
        mount()
        const send = await screen.findByRole('button', { name: 'Send test push to vivo install-1' })
        fireEvent.click(send)
        await screen.findByText('Sending test push...')
        expect(send).toBeDisabled()
        fireEvent.click(send)
        expect(api.testNativePush).toHaveBeenCalledTimes(1)
        await act(async () => { resolveSend({ status: 'accepted', providerId: 'vivo', retryAfterSeconds: 10 }) })
    })

    it.each([
        ['device-not-found', 404, 'Device is no longer registered.'],
        ['push-test-unavailable', 503, 'Push testing is unavailable for this channel.'],
        ['push-test-rate-limited', 429, 'Push tests are temporarily rate limited.'],
        ['push-test-failed', 502, 'Push provider did not accept the test. Check the Hub push configuration and logs.'],
    ])('shows a safe localized error for %s', async (code, status, message) => {
        api.testNativePush.mockRejectedValue(new ApiError('private error', status, code, JSON.stringify({ retryAfterSeconds: 20 })))
        mount()
        fireEvent.click(await screen.findByRole('button', { name: 'Send test push to vivo install-1' }))
        expect(await screen.findByText(message)).toBeInTheDocument()
        expect(screen.queryByText(/private error/)).not.toBeInTheDocument()
        expect(screen.getByText(`Next test available in ${status === 429 ? 20 : 10}s.`)).toBeInTheDocument()
    })

    it('disables unavailable devices and supports refreshing an empty list', async () => {
        api.getNativePushDevices.mockResolvedValue({ devices: [{ ...device, enabled: false, testable: false }] })
        mount()
        expect(await screen.findByRole('button', { name: 'Send test push to vivo install-1' })).toBeDisabled()
        expect(screen.getByText('Push channel is disabled on this Hub.')).toBeInTheDocument()
        api.getNativePushDevices.mockResolvedValue({ devices: [] })
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
        expect(await screen.findByText('No push devices registered.')).toBeInTheDocument()
    })

    it('renders a load error and can retry', async () => {
        api.getNativePushDevices.mockRejectedValueOnce(new Error('offline'))
        mount()
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load push devices.')
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
        expect(await screen.findByText('install-1')).toBeInTheDocument()
    })

    it('clears cached devices and send state when switching hubs or credentials', async () => {
        const view = mount()
        await screen.findByText('install-1')
        api.getNativePushDevices.mockResolvedValue({ devices: [{ ...device, deviceId: 'other-install' }] })
        context.baseUrl = 'https://other-hub.test'
        context.token = 'token-b'
        view.redraw()
        expect(screen.queryByText('install-1')).not.toBeInTheDocument()
        expect(await screen.findByText('other-install')).toBeInTheDocument()
    })

    it('renders Chinese labels', async () => {
        localStorage.setItem('hapi-lang', 'zh-CN')
        mount()
        expect(await screen.findByRole('button', { name: '向 vivo install-1 发送测试推送' })).toHaveTextContent('发送测试推送')
    })
})
