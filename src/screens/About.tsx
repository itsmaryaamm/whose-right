import { Pair } from '../components/Blob.tsx';

export function About() {
  return (
    <div className="screen about">
      <h1 className="page-title">How it works</h1>
      <div className="moment">
        <div className="moment-label">01 / Arrive</div>
        <Pair moment="arrive" size={110} />
        <p>
          Start a private case and invite the other person (a partner, friend, family member, co-founder or colleague) with a link or a 6-letter code.
        </p>
      </div>
      <div className="moment">
        <div className="moment-label">02 / Listen</div>
        <Pair moment="listen" size={110} />
        <p>
          Each of you talks to the mediator <b>privately</b>. Vent, rant, be unfair. Nobody else sees it. The mediator asks questions to find what’s
          really underneath: the facts, the feelings, the need.
        </p>
      </div>
      <div className="moment">
        <div className="moment-label">03 / Connect</div>
        <Pair moment="connect" size={110} />
        <p>
          The mediator drafts the <b>concern, not the attack</b>, and only sends it when you approve. Back and forth, until you can ask for a neutral analysis
          and a proposed agreement you both sign up to.
        </p>
      </div>
      <div className="example">
        <div className="example-row">
          <span className="example-label">You say privately</span>
          <p>“She never listens to me. She just does whatever she wants.”</p>
        </div>
        <div className="example-arrow">↓</div>
        <div className="example-row out">
          <span className="example-label">They hear</span>
          <p>“He feels important decisions are being made without involving him, which makes him feel his opinion isn’t valued.”</p>
        </div>
      </div>
      <p className="muted small">
        Who’s Right is a communication tool, not therapy or legal advice. If you are in danger or experiencing abuse, contact local emergency services or a
        support line.
      </p>
    </div>
  );
}
