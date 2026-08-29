import { useState, useEffect, useRef } from "react";
import { Check, Copy, Wallet, ShieldCheck, Circle, ChevronRight } from "lucide-react";

const MOCK_ASSETS = [
  { id: "usdc", name: "USDC", kind: "ERC-20", amount: "1,240.00", selected: true },
  { id: "weth", name: "WETH", kind: "ERC-20", amount: "0.84", selected: true },
  { id: "bot", name: "BOT", kind: "Native", amount: "312.5", selected: false },
  { id: "punks", name: "CryptoPunks", kind: "ERC-721 (collection)", amount: "3 items", selected: true },
  { id: "azuki", name: "Azuki", kind: "ERC-721 (collection)", amount: "1 item", selected: false },
];

const PERIODS = [
  { id: "6m", label: "6 months" },
  { id: "1y", label: "1 year" },
  { id: "2y", label: "2 years" },
];

function strength(secret) {
  if (!secret) return 0;
  let s = Math.min(secret.length / 16, 1) * 60;
  if (/[A-Z]/.test(secret)) s += 10;
  if (/[0-9]/.test(secret)) s += 10;
  if (/[^A-Za-z0-9]/.test(secret)) s += 20;
  return Math.min(Math.round(s), 100);
}

function randHex(len) {
  const chars = "0123456789abcdef";
  let out = "0x";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * 16)];
  return out;
}

function Panel({ title, children, className = "", accent = "green" }) {
  return (
    <div className={`dmh-panel dmh-accent-${accent} ${className}`}>
      <div className="dmh-panel-title">
        <span>{title}</span>
      </div>
      <div className="dmh-panel-body">{children}</div>
    </div>
  );
}

export default function DMHTerminal() {
  const [step, setStep] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [period, setPeriod] = useState(null);
  const [secret, setSecret] = useState("");
  const [assets, setAssets] = useState(MOCK_ASSETS);
  const [approveIdx, setApproveIdx] = useState(-1);
  const [vaultId, setVaultId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [log, setLog] = useState([
    { t: "boot", tag: "sys", text: "dmh v0.1 — zero-deposit inheritance protocol" },
    { t: "boot", tag: "sys", text: "network: BOT CHAIN TESTNET" },
  ]);
  const logRef = useRef(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    if (step !== 4) return;
    const iv = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [step]);

  function pushLog(entries) {
    setLog((l) => [...l, ...entries.map((e) => ({ t: Date.now() + Math.random(), ...e }))]);
  }

  function connectWallet(name) {
    setConnecting(true);
    pushLog([{ tag: "cmd", text: `dmh connect --wallet=${name}` }]);
    setTimeout(() => {
      const addr = "0x" + [...Array(4)].map(() => Math.floor(Math.random() * 16).toString(16)).join("") +
        "…" + [...Array(4)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
      setWallet({ name, addr });
      pushLog([{ tag: "ok", text: `wallet ${addr} linked via ${name}` }]);
      setConnecting(false);
      setStep(1);
    }, 700);
  }

  function confirmParams() {
    pushLog([
      { tag: "cmd", text: `dmh vault init --period=${period}` },
      { tag: "ok", text: "secret received — hashing locally (never sent in plaintext)" },
      { tag: "ok", text: "secret salted + committed: keccak256(secret, owner, vaultId)" },
    ]);
    setStep(2);
  }

  function toggleAsset(id) {
    setAssets((as) => as.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a)));
  }

  function beginApprovals() {
    const selected = assets.filter((a) => a.selected);
    pushLog([{ tag: "cmd", text: `dmh assets stage --count=${selected.length}` }]);
    setStep(3);
    setApproveIdx(0);
  }

  useEffect(() => {
    if (step !== 3) return;
    const selected = assets.filter((a) => a.selected);
    if (approveIdx < 0 || approveIdx >= selected.length) {
      if (approveIdx >= selected.length && selected.length > 0) {
        const id = randHex(10);
        setVaultId(id);
        pushLog([
          { tag: "cmd", text: "dmh vault activate" },
          { tag: "ok", text: `vault ${id} is live — countdown started` },
        ]);
        setTimeout(() => setStep(4), 500);
      }
      return;
    }
    const asset = selected[approveIdx];
    pushLog([{ tag: "cmd", text: `dmh approve --token=${asset.name}` }]);
    const timer = setTimeout(() => {
      pushLog([{ tag: "ok", text: `${asset.name} approved — dmh registered as spender` }]);
      setApproveIdx((i) => i + 1);
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, approveIdx]);

  function copyVaultId() {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const selectedAssets = assets.filter((a) => a.selected);
  const secretScore = strength(secret);
  const secretOk = secretScore >= 50;
  const periodDays = period === "6m" ? 182 : period === "1y" ? 365 : period === "2y" ? 730 : 0;
  const remaining = Math.max(periodDays * 86400 - seconds, 0);
  const rd = Math.floor(remaining / 86400);
  const rh = Math.floor((remaining % 86400) / 3600);
  const rm = Math.floor((remaining % 3600) / 60);
  const rs = remaining % 60;

  return (
    <div className="dmh-root">
      <style>{`
        .dmh-root {
          --bg: #0a0d0c;
          --panel: #0f1412;
          --border: #263029;
          --border-active: #3ddc84;
          --text: #d5ddd7;
          --dim: #67786e;
          --green: #3ddc84;
          --amber: #f2b544;
          --red: #f2545b;
          --blue: #6cb6e8;
          background: var(--bg);
          color: var(--text);
          font-family: ui-monospace, "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
          font-size: 13px;
          line-height: 1.5;
          min-height: 560px;
          padding: 14px;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dmh-topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          border: 1px solid var(--border);
          border-radius: 4px;
          letter-spacing: 0.5px;
        }
        .dmh-topbar .title { color: var(--text); font-weight: 600; }
        .dmh-topbar .title span { color: var(--green); }
        .dmh-status-dot { display: inline-flex; align-items: center; gap: 6px; color: var(--dim); font-size: 12px; }
        .dmh-status-dot.on { color: var(--green); }
        .dmh-main {
          display: flex;
          gap: 10px;
          flex: 1;
          min-height: 340px;
        }
        .dmh-panel {
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--panel);
          position: relative;
          display: flex;
          flex-direction: column;
        }
        .dmh-panel-title {
          position: absolute;
          top: -9px;
          left: 12px;
          background: var(--bg);
          padding: 0 6px;
          font-size: 11px;
          letter-spacing: 1px;
          color: var(--dim);
          text-transform: uppercase;
        }
        .dmh-accent-green .dmh-panel-title { color: var(--green); }
        .dmh-panel-body { padding: 22px 16px 16px; flex: 1; overflow: auto; }
        .dmh-wizard { flex: 2; min-width: 0; }
        .dmh-status { flex: 1; min-width: 210px; }
        .dmh-prompt { color: var(--green); margin-bottom: 14px; display: flex; gap: 8px; align-items: baseline; }
        .dmh-prompt .caret { display: inline-block; width: 7px; height: 14px; background: var(--green); animation: blink 1.1s steps(1) infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        .dmh-btnrow { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
        .dmh-btn {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          padding: 8px 14px;
          border-radius: 4px;
          cursor: pointer;
          font-family: inherit;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: border-color .15s, color .15s;
        }
        .dmh-btn:hover { border-color: var(--green); color: var(--green); }
        .dmh-btn.active { border-color: var(--green); color: var(--green); background: rgba(61,220,132,0.08); }
        .dmh-btn.primary { border-color: var(--green); color: var(--green); }
        .dmh-btn.primary:hover { background: rgba(61,220,132,0.12); }
        .dmh-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .dmh-btn.primary:disabled:hover { background: transparent; color: var(--text); }
        .dmh-input {
          width: 100%;
          background: #0a0f0d;
          border: 1px solid var(--border);
          color: var(--text);
          padding: 9px 10px;
          border-radius: 4px;
          font-family: inherit;
          font-size: 13px;
          margin: 8px 0;
        }
        .dmh-input:focus { outline: none; border-color: var(--green); }
        .dmh-meter { height: 4px; border-radius: 2px; background: #1a221e; overflow: hidden; margin-bottom: 4px; }
        .dmh-meter-fill { height: 100%; transition: width .2s; }
        .dmh-hint { color: var(--dim); font-size: 12px; margin-top: 2px; }
        .dmh-asset-row {
          display: flex; align-items: center; gap: 10px;
          padding: 7px 8px; border: 1px solid transparent; border-radius: 4px; cursor: pointer;
        }
        .dmh-asset-row:hover { border-color: var(--border); }
        .dmh-asset-row .chk {
          width: 15px; height: 15px; border: 1px solid var(--dim); border-radius: 3px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .dmh-asset-row.on .chk { border-color: var(--green); background: rgba(61,220,132,0.12); }
        .dmh-asset-row .name { flex: 1; }
        .dmh-asset-row .kind { color: var(--dim); font-size: 11px; }
        .dmh-asset-row .amt { color: var(--dim); font-size: 12px; }
        .dmh-approve-row { display: flex; align-items: center; gap: 10px; padding: 6px 2px; }
        .dmh-approve-row .idx { color: var(--dim); width: 16px; }
        .dmh-approve-row .st-pending { color: var(--dim); }
        .dmh-approve-row .st-active { color: var(--amber); }
        .dmh-approve-row .st-done { color: var(--green); }
        .dmh-kv { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed var(--border); font-size: 12px; }
        .dmh-kv:last-child { border-bottom: none; }
        .dmh-kv .k { color: var(--dim); }
        .dmh-kv .v { color: var(--text); text-align: right; }
        .dmh-vaultid { display: flex; align-items: center; gap: 8px; background: #0a0f0d; border: 1px solid var(--border); padding: 8px 10px; border-radius: 4px; margin: 10px 0; }
        .dmh-vaultid code { color: var(--green); flex: 1; overflow-wrap: anywhere; }
        .dmh-copybtn { background: none; border: none; color: var(--dim); cursor: pointer; display: flex; }
        .dmh-copybtn:hover { color: var(--green); }
        .dmh-countdown { font-size: 22px; color: var(--amber); letter-spacing: 1px; margin: 6px 0; }
        .dmh-log {
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--panel);
          height: 130px;
          overflow-y: auto;
          padding: 22px 14px 10px;
          position: relative;
          font-size: 12px;
        }
        .dmh-log-line { display: flex; gap: 8px; padding: 1px 0; }
        .dmh-log-line.cmd .tag { color: var(--blue); }
        .dmh-log-line.ok .tag { color: var(--green); }
        .dmh-log-line.sys .tag { color: var(--dim); }
        .dmh-log-line .tag { flex-shrink: 0; }
        .dmh-log-line .txt { color: var(--text); }
        .dmh-badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; border: 1px solid var(--border); color: var(--dim); }
      `}</style>

      <div className="dmh-topbar">
        <div className="title">DEAD MAN'S <span>HAND</span></div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span className="dmh-badge">BOT CHAIN TESTNET</span>
          <span className={`dmh-status-dot ${wallet ? "on" : ""}`}>
            <Circle size={8} fill="currentColor" stroke="none" />
            {wallet ? wallet.addr : "disconnected"}
          </span>
        </div>
      </div>

      <div className="dmh-main">
        <Panel title="Setup Wizard" className="dmh-wizard">
          {step === 0 && (
            <>
              <div className="dmh-prompt">identify wallet<span className="caret" /></div>
              <p className="dmh-hint" style={{ marginBottom: 14 }}>
                Connect the wallet that holds the assets you want to protect. No Safe, no migration — your everyday wallet works.
              </p>
              <div className="dmh-btnrow">
                <button className="dmh-btn" disabled={connecting} onClick={() => connectWallet("MetaMask")}>
                  <Wallet size={14} /> Connect MetaMask
                </button>
                <button className="dmh-btn" disabled={connecting} onClick={() => connectWallet("OKX Wallet")}>
                  <Wallet size={14} /> Connect OKX Wallet
                </button>
              </div>
              {connecting && <p className="dmh-hint">awaiting signature…</p>}
            </>
          )}

          {step === 1 && (
            <>
              <div className="dmh-prompt">set inactivity period<span className="caret" /></div>
              <div className="dmh-btnrow">
                {PERIODS.map((p) => (
                  <button key={p.id} className={`dmh-btn ${period === p.id ? "active" : ""}`} onClick={() => setPeriod(p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="dmh-hint">Timer resets each time you ping the vault. No activity for this long triggers claim eligibility.</p>

              <div className="dmh-prompt" style={{ marginTop: 20 }}>set secret pass-phrase<span className="caret" /></div>
              <input
                className="dmh-input"
                type="password"
                placeholder="enter a high-entropy phrase, code, or emoji string"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              <div className="dmh-meter">
                <div
                  className="dmh-meter-fill"
                  style={{
                    width: `${secretScore}%`,
                    background: secretScore < 50 ? "var(--red)" : secretScore < 80 ? "var(--amber)" : "var(--green)",
                  }}
                />
              </div>
              <p className="dmh-hint">
                {secretScore === 0 ? "This is hashed locally — never sent or stored in plaintext." :
                 secretOk ? "Strength: sufficient." : "Strength: too weak — add length or symbols."}
              </p>

              <div className="dmh-btnrow" style={{ marginTop: 16 }}>
                <button className="dmh-btn primary" disabled={!period || !secretOk} onClick={confirmParams}>
                  Continue <ChevronRight size={14} />
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="dmh-prompt">select assets to protect<span className="caret" /></div>
              <p className="dmh-hint" style={{ marginBottom: 10 }}>Scanned from your connected wallet. Toggle what dmh should be able to recover.</p>
              {assets.map((a) => (
                <div key={a.id} className={`dmh-asset-row ${a.selected ? "on" : ""}`} onClick={() => toggleAsset(a.id)}>
                  <span className="chk">{a.selected && <Check size={11} />}</span>
                  <span className="name">{a.name}</span>
                  <span className="kind">{a.kind}</span>
                  <span className="amt">{a.amount}</span>
                </div>
              ))}
              <div className="dmh-btnrow" style={{ marginTop: 14 }}>
                <button className="dmh-btn primary" disabled={selectedAssets.length === 0} onClick={beginApprovals}>
                  Approve {selectedAssets.length} asset{selectedAssets.length !== 1 ? "s" : ""} <ChevronRight size={14} />
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="dmh-prompt">confirming approvals<span className="caret" /></div>
              <p className="dmh-hint" style={{ marginBottom: 10 }}>One signature per asset. Confirm each prompt as it appears in your wallet.</p>
              {selectedAssets.map((a, i) => (
                <div className="dmh-approve-row" key={a.id}>
                  <span className="idx">{i + 1}</span>
                  <span className={i < approveIdx ? "st-done" : i === approveIdx ? "st-active" : "st-pending"}>
                    {i < approveIdx ? <Check size={13} /> : i === approveIdx ? "…" : "—"}
                  </span>
                  <span>{a.name}</span>
                  <span className="dmh-hint" style={{ marginLeft: "auto" }}>
                    {i < approveIdx ? "approved" : i === approveIdx ? "awaiting signature" : "queued"}
                  </span>
                </div>
              ))}
            </>
          )}

          {step === 4 && (
            <>
              <div className="dmh-prompt"><ShieldCheck size={15} /> vault is live</div>
              <p className="dmh-hint" style={{ marginBottom: 10 }}>
                Give the vault ID below to your claimant, out-of-band (not publicly searchable). They'll need it plus your secret phrase after expiry.
              </p>
              <div className="dmh-vaultid">
                <code>{vaultId}</code>
                <button className="dmh-copybtn" onClick={copyVaultId}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p className="dmh-hint">Remember to ping the vault before the countdown reaches zero to keep it from becoming claimable.</p>
            </>
          )}
        </Panel>

        <Panel title="Vault Status" className="dmh-status" accent="amber">
          <div className="dmh-kv"><span className="k">wallet</span><span className="v">{wallet ? wallet.addr : "—"}</span></div>
          <div className="dmh-kv"><span className="k">period</span><span className="v">{period ? PERIODS.find(p=>p.id===period).label : "—"}</span></div>
          <div className="dmh-kv"><span className="k">assets staged</span><span className="v">{step >= 2 ? selectedAssets.length : "—"}</span></div>
          <div className="dmh-kv"><span className="k">vault id</span><span className="v">{vaultId ? vaultId.slice(0, 10) + "…" : "—"}</span></div>
          <div className="dmh-kv"><span className="k">retrieval fee</span><span className="v">1 USDT</span></div>
          <div className="dmh-kv"><span className="k">searchable by</span><span className="v">wallet + vault id</span></div>
          {step === 4 && (
            <>
              <div className="dmh-hint" style={{ marginTop: 14 }}>time until claimable</div>
              <div className="dmh-countdown">{rd}d {String(rh).padStart(2,"0")}h {String(rm).padStart(2,"0")}m {String(rs).padStart(2,"0")}s</div>
            </>
          )}
        </Panel>
      </div>

      <div className="dmh-log" ref={logRef}>
        <div className="dmh-panel-title" style={{ color: "var(--dim)" }}>Activity Log</div>
        {log.map((l) => (
          <div className={`dmh-log-line ${l.tag}`} key={l.t}>
            <span className="tag">{l.tag === "cmd" ? "$" : l.tag === "ok" ? "✓" : "·"}</span>
            <span className="txt">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
