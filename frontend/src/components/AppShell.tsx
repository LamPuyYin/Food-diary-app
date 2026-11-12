import { type ReactNode } from 'react'
import {
  Activity,
  CalendarDays,
  Home,
  Info,
  Search,
  Toilet,
  UtensilsCrossed,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { PAGE_META, type AppRoute, type TrackerStatsItem } from '../lib/tracker'
import { PageTransition } from './PageTransition'
import logo from '../assets/logo-48.ico'

const NAV_ITEMS: Array<{
  to: AppRoute
  icon: typeof Home
}> = [
  { to: '/', icon: Home },
  { to: '/stats', icon: Activity },
  { to: '/ingredients', icon: Search },
  { to: '/meals', icon: UtensilsCrossed },
  { to: '/bowel', icon: Toilet },
  { to: '/calendar', icon: CalendarDays },
]

type AppShellProps = {
  stats: TrackerStatsItem[]
  loadError: string | null
  children: ReactNode
}

export function AppShell({ stats, loadError, children }: AppShellProps) {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={logo} alt="" />
          </div>
          <div>
            <strong>Gutmost</strong>
            <span>Your Own Food Diary</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {NAV_ITEMS.map(({ to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span>{PAGE_META[to].label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-stats">
          {stats.map((stat) => (  
            <div key={stat.label} className="stat">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
        

        <div className="sidebar-card sidebar-about">
          <span className="sidebar-kicker"><Info size={14} /> About the library</span>
          <p>FODMAP food records are attributed to the <a href="https://www.fodmapibsdiet.com/methodology" target="_blank" rel="noreferrer">IBS FODMAP Diet public export</a>. © IBS FODMAP Diet · All rights reserved.</p>
          <small>Independent app; not endorsed by Monash University.</small>
        </div>
      </aside>

      <section className="workspace">
        {loadError ? (
          <div className="alert" role="alert">
            {loadError}
          </div>
        ) : null}

        <PageTransition>{children}</PageTransition>

        <footer className="medical-disclaimer" role="contentinfo">
          <Info size={16} aria-hidden="true" />
          <p>
            Gutmost is a personal tracking tool, not medical advice. It does not diagnose, treat, cure, or prevent any condition.
            Consult a qualified healthcare professional about symptoms or dietary changes.
          </p>
        </footer>
      </section>
    </main>
  )
}
