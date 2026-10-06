import { CaseList, useCaseSummaries } from '../components/CaseList.tsx';
import { navigate } from '../router.ts';

export function Cases() {
  const cases = useCaseSummaries();
  return (
    <div className="screen">
      <h1 className="page-title">Your cases</h1>
      <CaseList
        cases={cases}
        empty={
          <div className="empty">
            <p className="muted">Nothing here yet.</p>
            <button className="btn" onClick={() => navigate('/new')}>
              Start a case
            </button>
          </div>
        }
      />
      <p className="muted small">
        Cases are remembered on this device. To open one somewhere else, use “Open on another device” inside the case.
      </p>
    </div>
  );
}
