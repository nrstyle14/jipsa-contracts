import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useViewer } from "./viewer.js";
import type { Address } from "viem";
import { Header } from "./components/layout/Header.js";
import { Sidebar } from "./components/agent/Sidebar.js";
import { AgentDetail } from "./components/agent/AgentDetail.js";
import {
  ConnectGate,
  DelegationAccountBanner,
  DojangBanner,
} from "./components/onboarding/Gates.js";
import { RegisterWizard } from "./components/onboarding/RegisterWizard.js";
import { useAccountStatus } from "./hooks/useAccountStatus.js";
import { useAgents } from "./hooks/useAgents.js";
import { useStoredDelegation } from "./hooks/useStoredDelegation.js";
import { Card } from "./components/ui.js";
import { ReadOnlyBanner } from "./components/onboarding/ReadOnlyBanner.js";
import { DEMO_OWNER } from "./viewer.js";

export default function App() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const viewer = useViewer();
  // 화면이 조회하는 주소는 연결 계정이 아니라 viewer 주소다 (열람 모드 지원)
  const address = viewer.address;
  const status = useAccountStatus();
  const { agents } = useAgents();
  const stored = useStoredDelegation();
  const [selected, setSelected] = useState<Address | undefined>();
  const [wizardOpen, setWizardOpen] = useState(false);
  /** 이미 귀속된 에이전트에 위임만 재발급할 때 마법사에 넘긴다 */
  const [issueFor, setIssueFor] = useState<Address | undefined>();

  // 첫 에이전트를 자동 선택
  useEffect(() => {
    if (!selected && agents.length > 0) setSelected(agents[0]);
  }, [agents, selected]);

  return (
    <div className="min-h-dvh">
      <Header />

      <main className="mx-auto max-w-[1200px] px-5 py-5">
        {!viewer.hasTarget ? (
          <ConnectGate
            onConnect={() => connectors[0] && connect({ connector: connectors[0] })}
            onViewDemo={() => viewer.setViewAs(DEMO_OWNER)}
          />
        ) : (
          <>
            {viewer.isReadOnly && <ReadOnlyBanner />}
            {status.hasStamp === false && <DojangBanner />}
            {/* 7702 안내는 내 계정일 때만 — 남의 계정을 열람하며 CLI 명령을 보여줄 이유가 없다 */}
            {!viewer.isReadOnly && status.isDelegationAccount === false && address && (
              <DelegationAccountBanner address={address} code={status.code} />
            )}

            <div className="flex flex-col gap-5 md:flex-row">
              <Sidebar
                selected={selected}
                onSelect={setSelected}
                onRegister={() => {
                  setIssueFor(undefined);
                  setWizardOpen(true);
                }}
              />
              {selected ? (
                <AgentDetail
                  agent={selected}
                  delegation={stored.delegation}
                  onImport={stored.importJson}
                  onClearDelegation={stored.clear}
                  importError={stored.error}
                  onIssue={() => {
                    setIssueFor(selected);
                    setWizardOpen(true);
                  }}
                />
              ) : (
                <Card className="flex-1 text-sm text-muted">
                  왼쪽에서 에이전트를 선택하세요. 바인딩된 에이전트가 없으면 먼저 등록해야 합니다
                  (M2).
                </Card>
              )}
            </div>
          </>
        )}
      </main>

      {wizardOpen && (
        <RegisterWizard
          initialAgent={issueFor}
          onClose={() => setWizardOpen(false)}
          onDelegation={(d) => {
            stored.save(d);
            setSelected(d.delegate);
          }}
        />
      )}
    </div>
  );
}
