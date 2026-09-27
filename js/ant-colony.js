/**
 * A pheromone trail over a fixed set of providers. Each completed payment
 * attempt is one ant's round trip: it picks a route probabilistically
 * (weighted by the current trail strength), and afterwards reinforces or
 * cuts the trail it took based on how the *realized* outcome actually went
 * — a success adds to it, a failure directly cuts it. Every route also
 * evaporates a little after every trip regardless of who was chosen, so a
 * provider nobody has tried in a while still fades back toward neutral. No
 * closed-form formula is ever solved, only lived experience.
 */
export class ProviderPheromoneColony {
  constructor(
    providerCount,
    {
      evaporationRate = 0.06,
      depositScale = 1.4,
      failureDecay = 0.35,
      minPheromone = 0.15,
    } = {},
  ) {
    this.providerCount = providerCount;
    this.evaporationRate = evaporationRate;
    this.depositScale = depositScale;
    this.failureDecay = failureDecay;
    this.minPheromone = minPheromone;
    this.reset();
  }

  reset() {
    this.pheromones = Array(this.providerCount).fill(1);
  }

  /**
   * Selection probabilities for the next ant, given which providers are
   * even reachable for this trip (market eligibility). Providers with no
   * pheromone yet still get the trail-strength floor, so a route is never
   * permanently locked out just because it hasn't been tried recently.
   *
   * `weightMultipliers` (default all 1) lets something outside any single
   * ant's own experience — here, a volume commitment falling behind — give
   * a route extra consideration at *selection* time, without touching the
   * trail itself. This is deliberately the only place a commitment can
   * push: it can buy a struggling-but-committed route more chances to
   * prove itself, but it can never fabricate trust the route hasn't
   * actually earned. If that route is genuinely failing, its raw pheromone
   * keeps collapsing toward the floor no matter how large the multiplier
   * is, so `multiplier × (near-floor pheromone)` still ends up small — a
   * real, sustained outage still wins out over the contract.
   */
  getShares(eligibleMask, weightMultipliers = null) {
    const weights = this.pheromones.map((pheromone, index) => {
      if (!eligibleMask[index]) return 0;
      const multiplier = weightMultipliers ? weightMultipliers[index] : 1;
      return Math.max(pheromone, this.minPheromone) * multiplier;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) {
      const eligibleCount = eligibleMask.filter(Boolean).length;
      return eligibleMask.map((eligible) =>
        eligible ? 1 / eligibleCount : 0,
      );
    }
    return weights.map((weight) => weight / total);
  }

  /**
   * A successful trip lays down a trail. A failed one actively cuts this
   * route's own trail — like a scout reporting a dead end, not just an
   * absent report — which is what lets a route lose ground *relative to
   * the others* after only a few real failures, instead of waiting for
   * generic evaporation (which shrinks every route by the same factor and
   * so never changes the ratio between them on its own).
   */
  deposit(providerIndex, reward) {
    if (reward > 0) {
      this.pheromones[providerIndex] += reward * this.depositScale;
      return;
    }
    this.pheromones[providerIndex] = Math.max(
      this.minPheromone,
      this.pheromones[providerIndex] * (1 - this.failureDecay),
    );
  }

  evaporate() {
    this.pheromones = this.pheromones.map((pheromone) =>
      Math.max(this.minPheromone, pheromone * (1 - this.evaporationRate)),
    );
  }
}
