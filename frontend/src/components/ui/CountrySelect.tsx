import { useId, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { countries, countryName, searchCountries } from '../../data/countries'
import { inputClassName } from './styles'

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  required?: boolean
}

export default function CountrySelect({ id, value, onChange, onBlur, disabled, invalid, describedBy, required }: Props) {
  const listId = useId()
  const container = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const options = query ? searchCountries(query) : countries
  const activeIndex = Math.min(active, options.length - 1)
  const choose = (code: string) => { onChange(code); setQuery(''); setActive(-1); setOpen(false) }

  return <div ref={container} className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(''); setActive(-1); onBlur?.() } }}>
    <div className="relative"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" aria-hidden="true" /><input id={id} role="combobox" type="text" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${options[activeIndex].code}` : undefined} aria-required={required} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled} value={open ? query : countryName(value)} placeholder="Search countries…" className={`${inputClassName} pr-10 pl-10`} onFocus={() => { setOpen(true); setQuery(''); setActive(-1) }} onClick={() => { if (!open) { setOpen(true); setQuery(''); setActive(-1) } }} onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); if (!event.target.value) onChange('') }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); const next = event.key === 'ArrowDown' ? Math.min(activeIndex + 1, options.length - 1) : Math.max(activeIndex - 1, 0); setActive(next); requestAnimationFrame(() => document.getElementById(`${listId}-${options[next]?.code}`)?.scrollIntoView({ block: 'nearest' })) }
      else if (event.key === 'Enter' && open) { event.preventDefault(); if (activeIndex >= 0 && options[activeIndex]) choose(options[activeIndex].code); else if (options.length === 1) choose(options[0].code) }
      else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(''); setActive(-1) }
      else if (event.key === 'Tab') { setOpen(false); setQuery(''); setActive(-1) }
    }} /><ChevronDown className="pointer-events-none absolute top-3 right-3 size-4 text-slate-400" aria-hidden="true" /></div>
    {open && <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"><ul id={listId} role="listbox" aria-label="Countries" className="max-h-60 overflow-y-auto py-1">
      {!required && !query && <li role="option" aria-selected={!value} className="cursor-pointer px-3 py-2.5 text-sm text-slate-500 hover:bg-teal-50" onMouseDown={event => event.preventDefault()} onClick={() => choose('')}>Any / no country</li>}
      {options.map((country, index) => <li id={`${listId}-${country.code}`} role="option" aria-selected={value === country.code} key={country.code} onMouseDown={event => event.preventDefault()} onClick={() => choose(country.code)} className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-sm ${activeIndex === index ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-50'}`}><span>{country.name} <span className="text-slate-400">({country.code})</span></span>{value === country.code && <Check className="size-4 shrink-0 text-teal-700" aria-hidden="true" />}</li>)}
    </ul>{!options.length && <p role="status" className="p-3 text-sm text-slate-500">No matching country. Choose a country from the list.</p>}</div>}
  </div>
}
