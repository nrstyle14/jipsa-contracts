import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import {
  ABI,
  ADDR,
  delegationToJson,
  getDelegationHash,
  tkrw,
  type Delegation,
  type JipsaPolicy,
} from "@jipsa/delegation";
import { useAgentBinding } from "../../hooks/useAgents.js";
import { useDelegationProvider } from "../../hooks/useDelegationProvider.js";
import { Button, Card, Chip, shortAddr } from "../ui.js";

/** 데모 기본 정책 — MVP 시나리오와 동일 */
const DEFAULTS = {
  totalBudget: 5_000,
  perTxCap: 50,
  dailyCap: 500,
  validDays: 7,
  verifiedRecipientOnly: true,
};

type Step = 1 | 2 | 3;

/**
 * 등록 마법사 (설계서 §5.2).
 *
 * ① 바인딩 제안 → ② 에이전트 수락 대기 → ③ 위임 EIP-712 서명 → JSON 다운로드
 *
 * ⚠️ 개인키 입력란은 어디에도 두지 않는다. 에이전트 수락은 CLI 명령을 안내한다.
 */
export function RegisterWizard({
  onClose,
  onDelegation,
}: {
  onClose: () => void;
  onDelegation: (d: Delegation) => void;
}) {
  const { address: owner } = useAccount();
  const provider = useDelegationProvider();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<Step>(1);
  const [agentInput, setAgentInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [policy, setPolicy] = useState(DEFAULTS);
  const [issued, setIssued] = useState<Delegation | undefined>();

  const agent = isAddress(agentInput) ? (agentInput as Address) : undefined;
  const binding = useAgentBinding(agent);
  const acceptedByAgent =
    Boolean(agent && owner) && binding.owner?.toLowerCase() === owner!.toLowerCase();

  async function propose() {
    if (!agent) return;
    setBusy(true);
    setError(undefined);
    try {
      await writeContractAsync({
        address: ADDR.bindingRegistry,
        abi: ABI.ownerBindingRegistry,
        functionName: "proposeBinding",
        args: [agent],
      });
      setStep(2);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelProposal() {
    if (!agent) return;
    setBusy(true);
    setError(undefined);
    try {
      await writeContractAsync({
        address: ADDR.bindingRegistry,
        abi: ABI.ownerBindingRegistry,
        functionName: "cancelProposal",
        args: [agent],
      });
      setStep(1);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    if (!agent || !provider) return;
    setBusy(true);
    setError(undefined);
    try {
      const p: JipsaPolicy = {
        totalBudget: tkrw(policy.totalBudget),
        perTxCap: tkrw(policy.perTxCap),
        dailyCap: tkrw(policy.dailyCap),
        validUntil: Math.floor(Date.now() / 1000) + policy.validDays * 86_400,
        verifiedRecipientOnly: policy.verifiedRecipientOnly,
        agent,
      };
      const d = await provider.grantDelegation(p);
      setIssued(d);
      onDelegation(d);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!issued) return;
    const json = delegationToJson(issued, {
      chainId: 91342,
      delegationManager: ADDR.delegationManager,
      delegationHash: getDelegationHash(issued),
      createdAt: new Date().toISOString(),
    });
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(json, null, 2)}\n`], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "delegation.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const acceptCmd = agent
    ? `cast send ${ADDR.bindingRegistry} "acceptBinding(address)" ${owner} --private-key $AGENT_PRIVATE_KEY --rpc-url https://sepolia-rpc-flashblocks.giwa.io`
    : "";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <Card className="max-h-[90dvh] w-full max-w-xl overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">에이전트 등록</h2>
          <button className="text-muted hover:text-text" onClick={onClose}>
            닫기
          </button>
        </div>

        <ol className="mb-4 flex gap-2 text-[11px]">
          {(["바인딩 제안", "에이전트 수락", "위임 서명"] as const).map((t, i) => (
            <li
              key={t}
              className={`rounded-full border px-2.5 py-1 ${
                step === i + 1 ? "border-blue bg-surface2 text-text" : "border-line text-muted"
              }`}
            >
              {i + 1}. {t}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-muted">에이전트 주소</span>
              <input
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value.trim())}
                placeholder="0x…"
                className="num w-full rounded-btn border border-line bg-bg px-3 py-2 outline-none focus:border-blue"
              />
            </label>
            {agentInput && !agent && (
              <p className="text-[11px] text-[#E8A6A1]">주소 형식이 올바르지 않습니다.</p>
            )}
            <Button variant="primary" disabled={!agent || busy} onClick={propose}>
              {busy ? "서명 대기…" : "바인딩 제안 서명"}
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              에이전트가 자신의 키로 수락해야 바인딩이 확정됩니다. 아래 명령을 에이전트 쪽에서
              실행하세요 — <b>대시보드는 에이전트 키를 받지 않습니다.</b>
            </p>
            <p className="text-[11px] text-muted">
              `expectedOwner` 인자를 넘기는 이유: 제안은 누구나 덮어쓸 수 있어, 수락 직전 다른
              주인으로 바뀌는 프런트러닝을 막습니다.
            </p>
            <pre className="num overflow-x-auto rounded-btn border border-line bg-bg p-3 text-[11px] leading-relaxed text-muted">
              {acceptCmd}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void navigator.clipboard.writeText(acceptCmd)}>
                명령 복사
              </Button>
              <Button onClick={cancelProposal} disabled={busy}>
                제안 취소
              </Button>
              <span className="text-[11px] text-muted">
                상태:{" "}
                {acceptedByAgent ? (
                  <Chip tone="ok">수락됨</Chip>
                ) : binding.pendingOwner && binding.pendingOwner !== ZERO ? (
                  <Chip>수락 대기 중</Chip>
                ) : (
                  <Chip tone="red">제안 없음</Chip>
                )}
              </span>
            </div>
            <Button variant="primary" disabled={!acceptedByAgent} onClick={() => setStep(3)}>
              {acceptedByAgent ? "다음: 위임 서명" : "수락을 기다리는 중…"}
            </Button>
          </div>
        )}

        {step === 3 && !issued && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <NumField
                label="총예산 (tKRW)"
                value={policy.totalBudget}
                onChange={(v) => setPolicy({ ...policy, totalBudget: v })}
              />
              <NumField
                label="건당 한도 (tKRW)"
                value={policy.perTxCap}
                onChange={(v) => setPolicy({ ...policy, perTxCap: v })}
              />
              <NumField
                label="일간 한도 (tKRW)"
                value={policy.dailyCap}
                onChange={(v) => setPolicy({ ...policy, dailyCap: v })}
              />
              <NumField
                label="유효기간 (일)"
                value={policy.validDays}
                onChange={(v) => setPolicy({ ...policy, validDays: v })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={policy.verifiedRecipientOnly}
                onChange={(e) =>
                  setPolicy({ ...policy, verifiedRecipientOnly: e.target.checked })
                }
              />
              검증 수신처 전용 (Dojang 도장 보유 주소에만 결제 허용)
            </label>
            <p className="text-[11px] text-muted">
              온체인 트랜잭션이 아니라 <b>EIP-712 서명</b>입니다. 예치도 없습니다 — 자금은 계속
              주인 지갑에 있고 지출 권한만 위임됩니다.
            </p>
            <Button variant="primary" disabled={busy || !provider} onClick={sign}>
              {busy ? "MetaMask 서명 대기…" : "위임 서명"}
            </Button>
          </div>
        )}

        {step === 3 && issued && (
          <div className="space-y-3 text-sm">
            <Chip tone="ok">위임 발급 완료</Chip>
            <div className="num space-y-1 text-[11px] text-muted">
              <div>에이전트: {shortAddr(issued.delegate)}</div>
              <div>caveat: {issued.caveats.length}개</div>
              <div className="break-all">해시: {getDelegationHash(issued)}</div>
            </div>
            <p className="text-muted">
              이 JSON을 에이전트에 전달하면 결제를 시작합니다.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={download}>
                delegation.json 다운로드
              </Button>
              <Button onClick={onClose}>완료</Button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-btn border border-red/40 bg-redSoft p-2 text-[11px] text-[#E8A6A1]">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}

const ZERO = "0x0000000000000000000000000000000000000000";

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num w-full rounded-btn border border-line bg-bg px-3 py-2 outline-none focus:border-blue"
      />
    </label>
  );
}

function msg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // wagmi/viem 에러는 장문이라 첫 문장만 보여준다
  return m.split("\n")[0] ?? m;
}
