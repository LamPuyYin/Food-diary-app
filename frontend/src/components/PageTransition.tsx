import { type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

type PageTransitionProps = { children: ReactNode }

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation()

  return <div className="page-transition" key={location.key}>{children}</div>
}
