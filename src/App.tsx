import { useEffect } from 'react';
import { navigate, usePath } from './router.ts';
import { tokens } from './api.ts';
import { Home } from './screens/Home.tsx';
import { NewCase } from './screens/NewCase.tsx';
import { Join } from './screens/Join.tsx';
import { CaseScreen } from './screens/CaseScreen.tsx';
import { About } from './screens/About.tsx';
import { Cases } from './screens/Cases.tsx';

export function App() {
  const path = usePath();

  // A private access link (/c/:id#t=token) lets you open a case on another device.
  useEffect(() => {
    const m = location.pathname.match(/^\/c\/([\w-]+)/);
    const t = new URLSearchParams(location.hash.slice(1)).get('t');
    if (m && t) {
      tokens.set(m[1], t);
      navigate(`/c/${m[1]}`, true);
    }
  }, []);

  let screen;
  let tab: 'home' | 'cases' | 'about' | null = null;
  let m: RegExpMatchArray | null;
  if (path === '/' || path === '') {
    screen = <Home />;
    tab = 'home';
  } else if (path === '/cases') {
    screen = <Cases />;
    tab = 'cases';
  } else if (path === '/about') {
    screen = <About />;
    tab = 'about';
  } else if (path === '/new') {
    screen = <NewCase />;
  } else if ((m = path.match(/^\/join(?:\/([\w-]+))?$/))) {
    screen = <Join initialCode={m[1] ?? ''} />;
  } else if ((m = path.match(/^\/c\/([\w-]+)$/))) {
    screen = <CaseScreen caseId={m[1]} key={m[1]} />;
  } else {
    screen = <Home />;
    tab = 'home';
  }

  return (
    <div className="app">
      <main className={tab ? 'with-nav' : ''}>{screen}</main>
      {tab && <BottomNav active={tab} />}
    </div>
  );
}

function BottomNav({ active }: { active: 'home' | 'cases' | 'about' }) {
  const items = [
    { id: 'home', label: 'Home', to: '/', icon: <path d="M4 11 L12 4 L20 11 V20 H14 V14 H10 V20 H4 Z" /> },
    {
      id: 'cases',
      label: 'Cases',
      to: '/cases',
      icon: (
        <>
          <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
          <path d="M9 9 H15 M9 13 H15 M9 17 H12" />
        </>
      ),
    },
    {
      id: 'about',
      label: 'How it works',
      to: '/about',
      icon: (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M9.6 9.5 A2.5 2.5 0 1 1 12 12.5 V14" />
          <circle cx="12" cy="17.2" r="0.6" />
        </>
      ),
    },
  ] as const;
  return (
    <nav className="bottom-nav">
      {items.map((it) => (
        <a
          key={it.id}
          href={it.to}
          className={active === it.id ? 'active' : ''}
          onClick={(e) => {
            e.preventDefault();
            navigate(it.to);
          }}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            {it.icon}
          </svg>
          <span>{it.label}</span>
        </a>
      ))}
    </nav>
  );
}
