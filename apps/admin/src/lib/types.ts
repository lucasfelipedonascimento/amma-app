export interface Proposal {
  id: string;
  kind: string;
  title: string;
  description: string;
  ruleChange: unknown;
  status: string;
  opensAt: string;
  closesAt: string;
  quorumPercent: number;
  eligibleCount: number;
  requiredVotes: number;
  result: null | {
    yes: number;
    no: number;
    abstain: number;
    total: number;
    closedAt: string;
    ballotDigest: string;
  };
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  vehicleType: string;
  targetCents: number;
  status: string;
  fundedCents: number;
  queueSize: number;
}
