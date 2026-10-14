import { useEffect, useState, type FormEvent } from "react";

function activationCode(value: string) {
  const trimmed = value.trim();
  const fragment = trimmed.includes("#setup=") ? trimmed.split("#setup=")[1]?.split("&")[0] : trimmed;
  return /^[0-9a-f]{64}$/.test(fragment ?? "") ? fragment : "";
}
function readInitialCode() {
  if (typeof window === "undefined") return "";
  return activationCode(new URLSearchParams(window.location.hash.slice(1)).get("setup") ?? "");
}
type Step = "welcome" | "owner" | "complete";
export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [code, setCode] = useState(readInitialCode);
  const [codeInput, setCodeInput] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // The setup fragment is never sent to the server. Remove it from history too.
    if (window.location.hash.includes("setup=")) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const continueSetup = () => {
    const supplied = activationCode(codeInput);
    if (!code && !supplied) { setError("Use the private first-run setup link printed by your installer, or paste its activation code below."); return; }
    if (supplied) setCode(supplied);
    setError(""); setStep("owner");
  };
  async function createOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 12) { setError("Choose a password with at least 12 characters."); return; }
    if (password !== repeatPassword) { setError("The passwords do not match."); return; }
    if (!code) { setError("A one-time activation link is required."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DevOne-Setup-Token": code },
        credentials: "same-origin",
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as {error?:string};
        if (response.status === 409) throw new Error("This server already has an Owner account. Sign in instead.");
        if (response.status === 429) throw new Error("Too many attempts. Wait a minute before retrying.");
        if (result.error === "setup_token_required") throw new Error("The activation link is invalid or expired. Run the setup-link command on your VPS to retrieve the current link.");
        throw new Error(result.error === "invalid_email" ? "Enter a valid email address." : result.error === "password_too_long" ? "Password is too long." : "Setup could not be completed. Check your details and try again.");
      }
      setPassword(""); setRepeatPassword(""); setCode(""); setCodeInput("");
      setStep("complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-screen wizard-screen">
    <header className="auth-masthead">
      <div className="brand-lockup"><div className="logo-mark"><span aria-hidden="true">◇</span></div><div className="brand-text"><strong>DEVONE <span>SERVER</span></strong><small>YOUR SERVER. SIMPLIFIED.</small></div></div>
      <span className="auth-masthead-detail">PRIVATE <span>·</span> SECURE <span>·</span> YOUR CONTROL</span>
    </header>
    <div className="auth-frame glass wizard-frame">
      <section className="auth-story wizard-story">
        <div className="auth-story-copy">
          <span className="overline">GETTING STARTED</span>
          <h1>Your infrastructure.<br /><span className="wizard-gradient">Your control.</span></h1>
          <p>Welcome to DevOne Server. Set up your Owner account, verify the foundation, and step into your new control panel.</p>
          <div className="wizard-progress" aria-label="Setup progress">
            <div className={"wizard-progress-item " + (step === "welcome" ? "current" : "complete")}><b>01</b><span><strong>System foundation</strong><small>Server and HTTPS installed</small></span><span className="wizard-progress-check">✓</span></div>
            <div className={"wizard-progress-item " + (step === "owner" ? "current" : step === "complete" ? "complete" : "")}><b>02</b><span><strong>Owner account</strong><small>Secure administrator access</small></span><span className="wizard-progress-check">✓</span></div>
            <div className={"wizard-progress-item " + (step === "complete" ? "current complete" : "")}><b>03</b><span><strong>You're all set</strong><small>Open your dashboard</small></span><span className="wizard-progress-check">✓</span></div>
          </div>
        </div>
        <div className="wizard-visual" aria-hidden="true">
          <div className="wizard-visual-halo" />
          <div className="wizard-glass-block"><span>DEVONE SERVER</span><strong>◇</strong><small>INITIALIZATION</small></div>
          <div className="wizard-floating-chip one">TLS SECURED</div>
          <div className="wizard-floating-chip two">NODE EDITION</div>
        </div>
        <p className="story-footnote">PERFORMANCE · PERFECTION · PRISTINE DESIGN</p>
      </section>
      <section className="auth-panel wizard-panel">
        <div className="auth-panel-top"><span className="secure-label">◈ &nbsp; Secure first-time configuration</span><span className="wizard-step-label">{step === "welcome" ? "STEP 1 OF 3" : step === "owner" ? "STEP 2 OF 3" : "STEP 3 OF 3"}</span></div>
        {step === "welcome" && <div className="sign-in-form wizard-form">
          <span className="form-kicker">DEVONE SERVER SETUP</span>
          <h2>Let's get started.</h2>
          <p>Your server's Node.js API, dashboard and HTTPS are installed. Finish configuration securely in this browser.</p>
          <div className="wizard-check-list">
            <div><span>✓</span><strong>Server software installed</strong><small>Core API and agent</small></div>
            <div><span>✓</span><strong>HTTPS secured</strong><small>Encrypted connection required</small></div>
            <div><span>✓</span><strong>Owner creation</strong><small>Available only with your private setup link</small></div>
          </div>
          {!code && <><label htmlFor="setup-activation">One-time setup link or activation code</label><div className="input-wrap"><input id="setup-activation" type="password" autoComplete="off" spellCheck={false} value={codeInput} onChange={e=>setCodeInput(e.target.value)} placeholder="Paste the private link printed in your VPS terminal" /></div><p className="wizard-hint">Only the installer asks for your domain. For security, it prints a one-time setup URL. On existing installations, run <code>sudo bash /opt/devone/current/scripts/issue-setup-link.sh</code>.</p></>}
          {code && <p className="wizard-ready">✓ Secure activation link recognized.</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="button" className="primary-button signin-button" onClick={continueSetup}>Continue to Owner account <span aria-hidden="true">→</span></button>
        </div>}
        {step === "owner" && <form className="sign-in-form wizard-form" onSubmit={createOwner}>
          <span className="form-kicker">SECURE ADMINISTRATOR ACCOUNT</span>
          <h2>Create your Owner account</h2>
          <p>This will be the first and highest-permission account on your DevOne Server.</p>
          <label htmlFor="setup-email">Owner email address</label>
          <div className="input-wrap"><input id="setup-email" type="email" required autoFocus autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></div>
          <label htmlFor="setup-password">Password (12 characters minimum)</label>
          <div className="input-wrap"><input id="setup-password" type={showPassword ? "text" : "password"} minLength={12} maxLength={1024} required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Create a strong password" /><button type="button" className="input-action" onClick={()=>setShowPassword(!showPassword)}>{showPassword?"Hide":"Show"}</button></div>
          <label htmlFor="setup-confirm-password">Confirm password</label>
          <div className="input-wrap"><input id="setup-confirm-password" type={showPassword ? "text" : "password"} required autoComplete="new-password" value={repeatPassword} onChange={e=>setRepeatPassword(e.target.value)} placeholder="Repeat your password" /></div>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="primary-button signin-button" disabled={busy}>{busy?"Creating your Owner account…":"Create Owner & secure server"} <span aria-hidden="true">→</span></button>
          <button type="button" className="wizard-back" disabled={busy} onClick={()=>{setStep("welcome");setError("");}}>← Back to overview</button>
        </form>}
        {step === "complete" && <div className="sign-in-form wizard-form wizard-complete">
          <div className="wizard-success-icon">✓</div>
          <span className="form-kicker">SETUP COMPLETE</span>
          <h2>You're ready to launch.</h2>
          <p>Owner access is configured and your one-time setup link has been invalidated. You're signed in securely.</p>
          <div className="wizard-check-list"><div><span>✓</span><strong>Owner account</strong><small>{email}</small></div><div><span>✓</span><strong>Core infrastructure</strong><small>API, agent and web panel ready</small></div></div>
          <p className="wizard-hint">Additional runtimes, databases, backups and apps are managed separately as those Node-edition modules become available.</p>
          <button className="primary-button signin-button" onClick={onComplete}>Open DevOne dashboard <span aria-hidden="true">→</span></button>
        </div>}
        <div className="auth-panel-footer"><span>DEVONE SERVER</span><span>FIRST-RUN SETUP</span></div>
      </section>
    </div>
    <footer className="auth-footer">YOUR INFRASTRUCTURE. IN YOUR CONTROL.</footer>
  </main>;
}
