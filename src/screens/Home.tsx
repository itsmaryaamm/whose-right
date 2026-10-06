import { Pair } from '../components/Blob.tsx';
import { CaseList, useCaseSummaries } from '../components/CaseList.tsx';
import { navigate } from '../router.ts';

export function Home() {
  const cases = useCaseSummaries();
  return (
    <div className="screen home">
      <h1 className="brand">Who’s right?</h1>
      <Pair moment="arrive" size={150} />
      <p className="tagline">Say it how it feels. We’ll pass on what it means.</p>

      <h2>Start a case</h2>
      <div className="start-grid">
        <button className="start-card primary" onClick={() => navigate('/new')}>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12 H19 M13 6 L19 12 L13 18" />
          </svg>
          <span>Invite someone</span>
        </button>
        <button className="start-card" onClick={() => navigate('/join')}>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M12 4 V20 M4 12 H20" />
          </svg>
          <span>Join a case</span>
        </button>
      </div>

      <h2>Your cases</h2>
      <CaseList
        cases={cases ? cases.slice(0, 4) : null}
        empty={<p className="muted empty">No cases yet. When something keeps turning into an argument, start one and invite them.</p>}
      />
      {cases && cases.length > 4 && (
        <button className="link-btn" onClick={() => navigate('/cases')}>
          See all {cases.length} cases →
        </button>
      )}

      <button className="btn btn-big" onClick={() => navigate('/new')}>
        <span aria-hidden="true">+</span> New case
      </button>
    </div>
  );
}
