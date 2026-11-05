import { useEffect, useRef } from 'react'

/** Bring newly opened inline panels into view and return keyboard focus on close. */
export function useInventoryPanelFocus(enabled = true) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!enabled) return
    const element = heading.current
    const container = element?.closest('[data-inventory-panel]')
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.focus()
    return () => {
      if (trigger?.isConnected && (document.activeElement === document.body || container?.contains(document.activeElement))) trigger.focus({ preventScroll: true })
    }
  }, [enabled])
  return heading
}
