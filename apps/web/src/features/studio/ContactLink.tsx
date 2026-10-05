import type { ReactNode } from 'react'
import { CONTACT_URL } from '../../env.ts'
import { contactHref } from './contact.ts'

const HREF = contactHref(CONTACT_URL)

/** "Message the usmfomo admin": a link once the owner has set CONTACT_URL,
 * plain text until then. Use with <Trans components={{ contact: <ContactLink /> }}>
 * and "<contact>…</contact>" in the string (never "<link>": the Trans parser
 * treats it as an empty HTML void element). */
export function ContactLink({ children }: { children?: ReactNode }) {
  if (!HREF) return <span>{children}</span>
  return (
    <a href={HREF} target={/^https:/i.test(HREF) ? '_blank' : undefined} rel="noopener noreferrer" className="text-sky underline">
      {children}
    </a>
  )
}
