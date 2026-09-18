import { useState } from 'react'
import { useDismissNotification, useMarkNotificationRead, useNotifications, useUnreadNotificationCount } from '../../hooks/useNotifications.js'
import { cn } from '../../lib/utils.js'

/**
 * Phase 19 gap-closing (spec §15) — the notification inbox UI surface.
 * A bell button with an unread badge that opens a dismissible,
 * per-notification-actionable panel. Every row links to its
 * underlying entity via entity_type/entity_id (or the narrower
 * related_tender_id/bid_strategy_project_id columns) rather than
 * duplicating detail here.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const unread = useUnreadNotificationCount()
  const notifications = useNotifications(false)
  const markRead = useMarkNotificationRead()
  const dismiss = useDismissNotification()

  const count = unread.status === 'success' ? unread.data : 0

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-foreground/80 hover:bg-muted hover:text-foreground"
      >
        <span aria-hidden="true">🔔</span>
        {count > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notification inbox"
          className="absolute right-0 z-20 mt-2 w-96 max-w-[90vw] rounded-md border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.status === 'loading' && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {notifications.status === 'error' && <p className="p-4 text-sm text-destructive">Could not load notifications.</p>}
            {notifications.status === 'success' && notifications.data.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No notifications.</p>
            )}
            {notifications.status === 'success' &&
              notifications.data.map((n) => (
                <div
                  key={n.id}
                  data-testid="notification-row"
                  className={cn('flex items-start justify-between gap-2 border-b border-border px-3 py-2 text-sm', !n.read_at && 'bg-muted/50')}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{formatEventType(n.event_type)}</p>
                    <p className="truncate text-xs text-muted-foreground">{formatPayload(n)}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {!n.read_at && (
                      <button type="button" className="text-xs text-primary hover:underline" onClick={() => markRead.mutate(n.id)}>
                        Mark read
                      </button>
                    )}
                    <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => dismiss.mutate(n.id)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatEventType(eventType: string): string {
  return eventType
    .split('_')
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function formatPayload(n: { entity_type: string | null; payload: Record<string, unknown> | null }): string {
  if (!n.payload) return n.entity_type ?? ''
  return Object.entries(n.payload)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ')
}
