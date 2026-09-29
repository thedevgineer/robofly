import type { ChipGraph, Layout, RunSummary, Scenario, TraceResponse } from "./types";

export async function listRuns(): Promise<RunSummary[]> {
  const response = await fetch("/api/sim/runs");
  if (!response.ok) throw new Error(`Could not list runs (${response.status})`);
  const body = (await response.json()) as { runs: RunSummary[] };
  return body.runs;
}

export async function fetchTrace(id: string): Promise<TraceResponse> {
  const response = await fetch(`/api/sim/runs/${encodeURIComponent(id)}/trace`);
  if (!response.ok) throw new Error(`Could not load trace (${response.status})`);
  return (await response.json()) as TraceResponse;
}

export async function fetchGraph(): Promise<ChipGraph> {
  const response = await fetch("/api/chip/graph");
  if (!response.ok) throw new Error(`Could not load chip graph (${response.status})`);
  return (await response.json()) as ChipGraph;
}

export async function runSim(scenario: Scenario | "custom", steps = 400, layout?: Layout): Promise<{ run_dir: string }> {
  const response = await fetch("/api/sim/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario, steps, seed: 1701, layout }),
  });
  if (!response.ok) throw new Error(`Simulation failed (${response.status})`);
  return (await response.json()) as { run_dir: string };
}
