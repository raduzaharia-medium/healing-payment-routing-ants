import { ProviderPheromoneColony } from "./ant-colony.js";
import { createDashboardView } from "./rendering.js";

const MAX_PAYMENT_ATTEMPTS = 5;
const BENCHMARK_REQUESTS = 1200;
const BENCHMARK_SCENARIOS = 10;
const BANDIT_EPSILON = 0.1;
const LOAD_SHARE_EMA_ALPHA = 0.06;
const DEFAULT_COMMITMENT_PENALTY_WEIGHT = 1.5;

export function createPaymentFlow() {
  const providers = [
    {
      id: "adyen",
      name: "Adyen API",
      shortName: "Adyen",
      homeCountry: "NL",
      supportedCountries: ["US", "GB", "DE"],
      supportedCurrencies: ["USD", "GBP", "EUR"],
      feeBpsByCurrency: { USD: 238, GBP: 252, EUR: 246 },
      crossBorderFeeBps: 12,
      crossBorderLatency: 14,
      baseLatency: 148,
      baseApprovalRate: 0.992,
      capacityShare: 0.45,
      minVolumeCommitment: 0.45,
      commitmentPenaltyWeight: 1.5,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 148,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
    {
      id: "chase",
      name: "Chase EU",
      shortName: "Chase",
      homeCountry: "GB",
      supportedCountries: ["GB", "DE"],
      supportedCurrencies: ["GBP", "EUR"],
      feeBpsByCurrency: { GBP: 208, EUR: 204 },
      crossBorderFeeBps: 16,
      crossBorderLatency: 22,
      baseLatency: 196,
      baseApprovalRate: 0.988,
      capacityShare: 0.4,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 196,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
    {
      id: "worldpay",
      name: "Worldpay EU",
      shortName: "Worldpay",
      homeCountry: "GB",
      supportedCountries: ["GB", "DE"],
      supportedCurrencies: ["GBP", "EUR"],
      feeBpsByCurrency: { GBP: 215, EUR: 210 },
      crossBorderFeeBps: 18,
      crossBorderLatency: 20,
      baseLatency: 175,
      baseApprovalRate: 0.985,
      capacityShare: 0.35,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 175,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
    {
      id: "stripe",
      name: "Stripe API",
      shortName: "Stripe",
      homeCountry: "US",
      supportedCountries: ["US", "GB", "DE"],
      supportedCurrencies: ["USD", "GBP", "EUR"],
      feeBpsByCurrency: { USD: 251, GBP: 267, EUR: 259 },
      crossBorderFeeBps: 14,
      crossBorderLatency: 18,
      baseLatency: 145,
      baseApprovalRate: 0.987,
      capacityShare: 0.58,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 145,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
    {
      id: "braintree",
      name: "Braintree API",
      shortName: "Braintree",
      homeCountry: "US",
      supportedCountries: ["US", "GB", "DE"],
      supportedCurrencies: ["USD", "GBP", "EUR"],
      feeBpsByCurrency: { USD: 245, GBP: 260, EUR: 252 },
      crossBorderFeeBps: 13,
      crossBorderLatency: 16,
      baseLatency: 160,
      baseApprovalRate: 0.99,
      capacityShare: 0.5,
      feeAdjustmentBps: 0,
      latencyAdjustmentMs: 0,
      latency: 160,
      health: 99,
      attempts: 0,
      successes: 0,
      failures: 0,
      injected: false,
    },
  ];

  const profiles = [
    {
      id: "standard",
      label: "Standard",
      shortName: "Std",
      trafficShare: 0.55,
      failurePenalty: 3,
      latencyWeight: 1,
      feeWeight: 0.8,
    },
    {
      id: "priority",
      label: "Priority",
      shortName: "Priority",
      trafficShare: 0.25,
      failurePenalty: 8,
      latencyWeight: 1.6,
      feeWeight: 0.35,
    },
    {
      id: "feeSensitive",
      label: "Fee-sensitive",
      shortName: "Low fee",
      trafficShare: 0.2,
      failurePenalty: 3,
      latencyWeight: 0.35,
      feeWeight: 2.5,
    },
  ];

  const merchantCountries = [
    { id: "US", label: "United States", trafficShare: 0.48 },
    { id: "GB", label: "United Kingdom", trafficShare: 0.27 },
    { id: "DE", label: "Germany", trafficShare: 0.25 },
  ];
  const settlementCurrencies = [
    { id: "USD", label: "US dollar", trafficShare: 0.52 },
    { id: "GBP", label: "Pound sterling", trafficShare: 0.22 },
    { id: "EUR", label: "Euro", trafficShare: 0.26 },
  ];

  const profileColonies = profiles.map(
    () => new ProviderPheromoneColony(providers.length),
  );
  // A live exponential moving average of how much real traffic each
  // provider has actually carried recently — measured from lived outcomes,
  // never computed from a formula. This is what congestion reacts to.
  let providerLoadShares = providers.map(() => 1 / providers.length);
  let selectedProfileId = profiles[0].id;
  let selectedCountryId = merchantCountries[0].id;
  let selectedCurrencyId = settlementCurrencies[0].id;
  const stats = { payments: 0, delivered: 0, failovers: 0 };
  const events = [];
  let nextPaymentId = 1;
  let processing = false;

  const view = createDashboardView({
    providers,
    profiles,
    stats,
    events,
    getRouting: getSelectedProfileRouting,
    getRecoveryCandidate: () =>
      findRecoveryCandidate(
        nextPaymentId,
        selectedCountryId,
        selectedCurrencyId,
      ),
    getMarketContext: () => ({
      countryId: selectedCountryId,
      currencyId: selectedCurrencyId,
    }),
    getCommitmentStatus,
    getNaiveComparison,
    setProviderConfig,
  });

  function setProviderConfig(providerId, field, value) {
    const provider = getProvider(providerId);
    if (!provider) return;
    switch (field) {
      case "feeAdjustmentBps":
        provider.feeAdjustmentBps = value;
        break;
      case "latencyAdjustmentMs":
        provider.latencyAdjustmentMs = value;
        break;
      case "baseApprovalRate":
        provider.baseApprovalRate = value;
        break;
      case "capacityShare":
        provider.capacityShare = Math.max(0.05, value);
        break;
      case "minVolumeCommitment":
        provider.minVolumeCommitment = value > 0 ? value : 0;
        if (value > 0 && !provider.commitmentPenaltyWeight) {
          provider.commitmentPenaltyWeight = DEFAULT_COMMITMENT_PENALTY_WEIGHT;
        }
        break;
      default:
        return;
    }
    view.render();
  }

  // The naive baseline a junior dev would actually hardcode: read the
  // published spec sheet (fee/latency/approval), pick whichever provider
  // looks best on paper, and never adapt. No live state involved at all.
  function estimateNominalUtility(provider) {
    let total = 0;
    let weightSum = 0;
    for (const profile of profiles) {
      for (const country of merchantCountries) {
        for (const currency of settlementCurrencies) {
          if (!providerSupports(provider, country.id, currency.id)) continue;
          const weight =
            profile.trafficShare * country.trafficShare * currency.trafficShare;
          total +=
            weight *
            providerUtility(provider, 0, profile, country.id, currency.id, true);
          weightSum += weight;
        }
      }
    }
    return weightSum > 0 ? total / weightSum : -Infinity;
  }

  function getBestSingleProvider() {
    return providers.reduce((best, provider) =>
      estimateNominalUtility(provider) > estimateNominalUtility(best)
        ? provider
        : best,
    );
  }

  function getNaiveComparison() {
    const provider = getBestSingleProvider();
    return {
      provider,
      isEligibleHere: providerSupports(
        provider,
        selectedCountryId,
        selectedCurrencyId,
      ),
    };
  }

  function getCommitmentStatus() {
    return providers.map((provider, index) =>
      provider.minVolumeCommitment
        ? {
            minVolumeCommitment: provider.minVolumeCommitment,
            currentShare: providerLoadShares[index],
            // Compare at the same rounded precision the badge displays, so
            // the label never contradicts the percentage shown next to it.
            met:
              Math.round(providerLoadShares[index] * 100) >=
              Math.round(provider.minVolumeCommitment * 100),
          }
        : null,
    );
  }

  function getProvider(id) {
    return providers.find((provider) => provider.id === id);
  }

  function setInjectedOutage(providerId, isInjected) {
    const provider = getProvider(providerId);
    provider.injected = isInjected;
    addEvent(
      `${provider.name} outage ${isInjected ? "injected" : "cleared"}`,
      isInjected
        ? "Authorization requests will time out."
        : "Provider is accepting authorization requests again.",
      isInjected ? "fail" : "success",
    );
    view.setMessage(
      isInjected
        ? `${provider.name} marked unavailable`
        : `${provider.name} restored`,
      isInjected ? "warning" : "success",
    );
    view.render();
  }

  function eligibilityMask(countryId, currencyId) {
    return providers.map((provider) =>
      providerSupports(provider, countryId, currencyId),
    );
  }

  const COMMITMENT_WEIGHT_SCALE = 4;

  // A commitment shortfall buys a route more consideration at selection
  // time — more chances to prove itself and count toward the contract —
  // but it never touches the trail itself. If the route is genuinely
  // failing, its raw pheromone keeps collapsing regardless of this
  // multiplier, so a real outage still wins out over the contract.
  function getCommitmentWeightMultipliers(loadShares) {
    return providers.map((provider, index) => {
      if (!provider.minVolumeCommitment) return 1;
      const shortfall = Math.max(
        0,
        provider.minVolumeCommitment - loadShares[index],
      );
      return 1 + shortfall * COMMITMENT_WEIGHT_SCALE;
    });
  }

  function chooseProvider(
    paymentId,
    profile,
    countryId,
    currencyId,
    allowRecoveryProbe = false,
  ) {
    const recoveryCandidate = allowRecoveryProbe
      ? findRecoveryCandidate(paymentId, countryId, currencyId)
      : null;
    if (recoveryCandidate) {
      const providerIndex = providers.indexOf(recoveryCandidate);
      return {
        provider: recoveryCandidate,
        isRecoveryProbe: true,
        allocationShare: providerLoadShares[providerIndex],
      };
    }

    const profileIndex = profiles.indexOf(profile);
    const mask = eligibilityMask(countryId, currencyId);
    const multipliers = getCommitmentWeightMultipliers(providerLoadShares);
    const shares = profileColonies[profileIndex].getShares(mask, multipliers);
    const eligibleIndexes = providers
      .map((_, index) => index)
      .filter((index) => mask[index]);

    const draw = Math.random();
    let cumulative = 0;
    for (const index of eligibleIndexes) {
      cumulative += shares[index];
      if (draw <= cumulative) {
        return {
          provider: providers[index],
          isRecoveryProbe: false,
          allocationShare: providerLoadShares[index],
        };
      }
    }
    const lastEligible = eligibleIndexes[eligibleIndexes.length - 1];
    return {
      provider: providers[lastEligible],
      isRecoveryProbe: false,
      allocationShare: providerLoadShares[lastEligible],
    };
  }

  function findRecoveryCandidate(paymentId, countryId, currencyId) {
    if (!paymentId || paymentId % 3 !== 0) return null;
    return (
      providers
        .filter(
          (provider) =>
            providerSupports(provider, countryId, currencyId) &&
            !provider.injected &&
            provider.health < 95,
        )
        .sort((first, second) => first.health - second.health)[0] ?? null
    );
  }

  function providerSupports(provider, countryId, currencyId) {
    return (
      provider.supportedCountries.includes(countryId) &&
      provider.supportedCurrencies.includes(currencyId)
    );
  }

  function getProviderFeeBps(provider, countryId, currencyId) {
    return (
      provider.feeBpsByCurrency[currencyId] +
      (provider.homeCountry === countryId ? 0 : provider.crossBorderFeeBps) +
      (provider.feeAdjustmentBps || 0)
    );
  }

  function providerPerformance(
    provider,
    providerLoadShare,
    countryId,
    useBaseModel = false,
  ) {
    const observedApprovalRate = useBaseModel
      ? provider.baseApprovalRate
      : Math.min(provider.baseApprovalRate, provider.health / 100);
    const utilization = providerLoadShare / provider.capacityShare;
    const congestion = Math.max(0, utilization - 0.72);
    return {
      approvalProbability:
        provider.injected && !useBaseModel
          ? 0
          : Math.max(0.4, observedApprovalRate - congestion * 0.17),
      meanLatency:
        (useBaseModel ? provider.baseLatency : provider.latency) +
        (provider.latencyAdjustmentMs || 0) +
        650 * congestion ** 2 +
        (provider.homeCountry === countryId ? 0 : provider.crossBorderLatency),
    };
  }

  function providerUtility(
    provider,
    providerLoadShare,
    profile,
    countryId,
    currencyId,
    useBaseModel = false,
  ) {
    const performance = providerPerformance(
      provider,
      providerLoadShare,
      countryId,
      useBaseModel,
    );
    const expectedFailureCost =
      (1 - performance.approvalProbability) * profile.failurePenalty;
    const latencyCost =
      (performance.meanLatency / 3500) * profile.latencyWeight;
    const feeCost =
      (getProviderFeeBps(provider, countryId, currencyId) / 10000) *
      profile.feeWeight;
    return (
      performance.approvalProbability -
      expectedFailureCost -
      latencyCost -
      feeCost
    );
  }

  function getSelectedProfileRouting() {
    const profileIndex = profiles.findIndex(
      (profile) => profile.id === selectedProfileId,
    );
    const colony = profileColonies[profileIndex];
    const mask = eligibilityMask(selectedCountryId, selectedCurrencyId);
    const multipliers = getCommitmentWeightMultipliers(providerLoadShares);
    const shares = colony.getShares(mask, multipliers);
    return {
      profileId: profiles[profileIndex].id,
      profileName: profiles[profileIndex].label,
      shares,
      pheromones: [...colony.pheromones],
    };
  }

  function setProfile(profileId) {
    if (!profiles.some((profile) => profile.id === profileId)) return;
    selectedProfileId = profileId;
    view.renderRouting();
    view.setMessage(
      `Payment profile: ${profiles.find((profile) => profile.id === profileId).label}`,
    );
  }

  function setMarketContext(countryId, currencyId) {
    if (
      !merchantCountries.some((country) => country.id === countryId) ||
      !settlementCurrencies.some((currency) => currency.id === currencyId)
    )
      return;
    selectedCountryId = countryId;
    selectedCurrencyId = currencyId;
    view.render();
    view.setMessage(`Merchant route: ${countryId} · ${currencyId}`);
  }

  // The reinforcement step: exactly one ant's worth of feedback. No search,
  // no fitness formula — the reward is computed from what actually just
  // happened, deposited on the route that was actually walked, and every
  // trail evaporates a little so old information keeps getting refreshed.
  function reinforceRouting(profile, provider, result) {
    const providerIndex = providers.indexOf(provider);
    const feeCost = (result.feeBps / 10000) * profile.feeWeight;
    const latencyCost = (result.latency / 3500) * profile.latencyWeight;
    const reward =
      (result.ok ? 1 : -profile.failurePenalty) - latencyCost - feeCost;

    providerLoadShares = providerLoadShares.map((share, index) =>
      share +
      LOAD_SHARE_EMA_ALPHA * ((index === providerIndex ? 1 : 0) - share),
    );

    const profileIndex = profiles.indexOf(profile);
    const colony = profileColonies[profileIndex];
    colony.deposit(providerIndex, reward);
    colony.evaporate();
  }

  async function processPayment(forceFailureUntilReroute = false) {
    if (processing) return;
    processing = true;
    view.setBusy(true);

    const paymentId = nextPaymentId++;
    const profile = profiles.find(
      (candidate) => candidate.id === selectedProfileId,
    );
    const naiveProvider = getBestSingleProvider();
    const attemptHistory = [];
    let successfulProvider = null;
    let successfulRecoveryProbe = false;
    // "Send failed payment" doesn't just fail once — it keeps failing
    // whichever provider it lands on, so you can watch that route's own
    // trail actually get cut attempt by attempt, until the colony's next
    // draw lands on a different provider and gets to succeed or fail for
    // real. This is what makes the redirect a *consequence* of watching
    // pheromone drop, not a scripted jump.
    let strugglingProviderId = null;

    for (
      let attemptNumber = 1;
      attemptNumber <= MAX_PAYMENT_ATTEMPTS;
      attemptNumber++
    ) {
      const isInitialAttempt = attemptNumber === 1;
      const { provider, isRecoveryProbe, allocationShare } = chooseProvider(
        paymentId,
        profile,
        selectedCountryId,
        selectedCurrencyId,
        isInitialAttempt && !forceFailureUntilReroute,
      );
      if (isInitialAttempt && forceFailureUntilReroute) {
        strugglingProviderId = provider.id;
      }
      const forceThisAttempt =
        forceFailureUntilReroute && provider.id === strugglingProviderId;
      const result = await attemptProvider(
        provider,
        paymentId,
        isRecoveryProbe,
        forceThisAttempt,
        allocationShare,
        profile,
        selectedCountryId,
        selectedCurrencyId,
      );
      reinforceRouting(profile, provider, result);
      attemptHistory.push(
        `${provider.name} ${result.reason} (${result.latency} ms)`,
      );
      view.render();
      view.setMessage(
        result.ok
          ? `${provider.name} authorized · trail reinforced`
          : `${provider.name} failed · trail left to fade`,
        result.ok ? "success" : "warning",
      );

      if (result.ok) {
        successfulProvider = provider;
        successfulRecoveryProbe = isRecoveryProbe;
        break;
      }
    }

    stats.payments += 1;
    if (successfulProvider) {
      stats.delivered += 1;
      if (attemptHistory.length > 1) stats.failovers += 1;
      const naiveNote =
        successfulProvider.id !== naiveProvider.id
          ? ` · naive single-provider rule would have used ${naiveProvider.name}`
          : "";
      addEvent(
        successfulRecoveryProbe
          ? `${successfulProvider.name} recovery confirmed`
          : `Payment #${formatId(paymentId)} · ${profile.label} ${attemptHistory.length > 1 ? "recovered" : "authorized"}`,
        `${attemptHistory.join(" → ")}${naiveNote}`,
        attemptHistory.length > 1 ? "retry" : "success",
      );
      view.setMessage(
        successfulRecoveryProbe
          ? `${successfulProvider.name} recovery confirmed`
          : `Payment delivered by ${successfulProvider.name}`,
        attemptHistory.length > 1 ? "warning" : "success",
      );
    } else {
      addEvent(
        `Payment #${formatId(paymentId)} declined after ${attemptHistory.length} attempts`,
        attemptHistory.join(" → "),
        "fail",
      );
      view.setMessage(
        `Payment declined after ${attemptHistory.length} attempts`,
        "error",
      );
    }

    processing = false;
    view.setBusy(false);
    view.render();
  }

  async function attemptProvider(
    provider,
    paymentId,
    isRecoveryProbe = false,
    forceFailure = false,
    allocationShare = 1 / providers.length,
    profile = profiles[0],
    countryId = selectedCountryId,
    currencyId = selectedCurrencyId,
  ) {
    const isInjectedFailure = provider.injected;
    const performance = providerPerformance(
      provider,
      allocationShare,
      countryId,
    );
    const failed =
      forceFailure ||
      isInjectedFailure ||
      Math.random() >= performance.approvalProbability;
    const latency = Math.round(
      performance.meanLatency +
        (isInjectedFailure ? 900 + Math.random() * 280 : Math.random() * 54),
    );

    view.setMessage(
      `Payment #${formatId(paymentId)} · ${profile.label} · ${countryId}/${currencyId} attempting ${provider.name}…`,
    );
    await view.animatePacket(provider.id);

    provider.attempts += 1;
    if (failed) {
      provider.failures += 1;
      provider.health = Math.round(provider.health * 0.58);
      provider.latency = Math.min(
        1200,
        Math.round(provider.latency * 0.65 + latency * 0.35),
      );
    } else {
      provider.successes += 1;
      const recoveryWeight = isRecoveryProbe ? 0.62 : 0.12;
      provider.health = Math.min(
        100,
        Math.round(provider.health + (100 - provider.health) * recoveryWeight),
      );
      provider.latency = Math.round(
        provider.latency * (isRecoveryProbe ? 0.25 : 0.7) +
          latency * (isRecoveryProbe ? 0.75 : 0.3),
      );
    }

    const reason = !failed
      ? "authorized"
      : isInjectedFailure
        ? "timed out"
        : forceFailure
          ? "simulated failure"
          : "declined";
    return {
      ok: !failed,
      latency,
      reason,
      feeBps: getProviderFeeBps(provider, countryId, currencyId),
    };
  }

  function addEvent(title, detail, kind) {
    events.unshift({
      title,
      detail,
      kind,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    });
    events.length = Math.min(events.length, 6);
  }

  function createSeededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function createBenchmarkWorkload(seed) {
    const random = createSeededRandom(seed);
    const drawWeighted = (values, weightKey) => {
      const draw = random();
      let cumulative = 0;
      for (const value of values) {
        cumulative += value[weightKey];
        if (draw <= cumulative) return value;
      }
      return values[values.length - 1];
    };

    return Array.from({ length: BENCHMARK_REQUESTS }, () => {
      const profileDraw = random();
      let cumulativeShare = 0;
      let profileIndex = profiles.length - 1;
      for (let index = 0; index < profiles.length; index++) {
        cumulativeShare += profiles[index].trafficShare;
        if (profileDraw <= cumulativeShare) {
          profileIndex = index;
          break;
        }
      }
      const country = drawWeighted(merchantCountries, "trafficShare");
      const currency = drawWeighted(settlementCurrencies, "trafficShare");
      return {
        profileIndex,
        countryId: country.id,
        currencyId: currency.id,
        routeDraw: random(),
        epsilonRoll: random(),
        exploreDraw: random(),
        approvalRolls: providers.map(random),
        latencyFactors: providers.map(() => 0.9 + random() * 0.2),
      };
    });
  }

  // Runs the same stream of simulated payments through three online
  // policies side by side: a naive rule that never adapts, an
  // epsilon-greedy bandit, and the ant colony. Each makes its own
  // sequential decisions and updates its own state as it goes — nobody
  // gets to solve the workload in advance.
  function simulateOnlinePolicy(workload, kind, random) {
    const loadShares = providers.map(() => 1 / providers.length);
    const colonies =
      kind === "ants"
        ? profiles.map(() => new ProviderPheromoneColony(providers.length))
        : null;
    const banditStats =
      kind === "bandit"
        ? profiles.map(() => providers.map(() => ({ meanReward: 0 })))
        : null;
    const naiveProvider = kind === "naive" ? getBestSingleProvider() : null;
    const naiveProviderIndex = naiveProvider
      ? providers.indexOf(naiveProvider)
      : -1;

    let approvals = 0;
    let latencyTotal = 0;
    let feeTotal = 0;
    let utilityTotal = 0;

    for (const request of workload) {
      const profile = profiles[request.profileIndex];
      const mask = eligibilityMask(request.countryId, request.currencyId);
      const eligibleIndexes = providers
        .map((_, index) => index)
        .filter((index) => mask[index]);

      let providerIndex;
      if (kind === "naive") {
        providerIndex = mask[naiveProviderIndex]
          ? naiveProviderIndex
          : eligibleIndexes[
              Math.floor(request.exploreDraw * eligibleIndexes.length)
            ];
      } else if (kind === "bandit") {
        if (request.epsilonRoll < BANDIT_EPSILON) {
          providerIndex =
            eligibleIndexes[
              Math.floor(request.exploreDraw * eligibleIndexes.length)
            ];
        } else {
          providerIndex = eligibleIndexes.reduce((best, index) =>
            banditStats[request.profileIndex][index].meanReward >
            banditStats[request.profileIndex][best].meanReward
              ? index
              : best,
          );
        }
      } else {
        const multipliers = getCommitmentWeightMultipliers(loadShares);
        const shares = colonies[request.profileIndex].getShares(
          mask,
          multipliers,
        );
        let cumulative = 0;
        providerIndex = eligibleIndexes[eligibleIndexes.length - 1];
        for (const index of eligibleIndexes) {
          cumulative += shares[index];
          if (request.routeDraw <= cumulative) {
            providerIndex = index;
            break;
          }
        }
      }

      const provider = providers[providerIndex];
      const performance = providerPerformance(
        provider,
        loadShares[providerIndex],
        request.countryId,
        true,
      );
      const approved =
        request.approvalRolls[providerIndex] < performance.approvalProbability;
      const latency =
        performance.meanLatency * request.latencyFactors[providerIndex];
      const feeBps = getProviderFeeBps(
        provider,
        request.countryId,
        request.currencyId,
      );
      const feeCost = (feeBps / 10000) * profile.feeWeight;
      const reward =
        (approved ? 1 : -profile.failurePenalty) -
        (latency / 3500) * profile.latencyWeight -
        feeCost;

      approvals += Number(approved);
      latencyTotal += latency;
      feeTotal += feeBps;
      utilityTotal += reward;

      for (let index = 0; index < providers.length; index++) {
        loadShares[index] +=
          LOAD_SHARE_EMA_ALPHA * ((index === providerIndex ? 1 : 0) - loadShares[index]);
      }

      if (kind === "bandit") {
        const stat = banditStats[request.profileIndex][providerIndex];
        stat.meanReward += 0.1 * (reward - stat.meanReward);
      } else if (kind === "ants") {
        const colony = colonies[request.profileIndex];
        colony.deposit(providerIndex, reward);
        colony.evaporate();
      }
    }

    let commitmentPenalty = 0;
    for (const provider of providers) {
      if (!provider.minVolumeCommitment) continue;
      const index = providers.indexOf(provider);
      const shortfall = Math.max(
        0,
        provider.minVolumeCommitment - loadShares[index],
      );
      commitmentPenalty += shortfall * provider.commitmentPenaltyWeight;
    }

    return {
      shares: loadShares,
      approvalRate: approvals / workload.length,
      meanLatency: latencyTotal / workload.length,
      meanFeeBps: feeTotal / workload.length,
      utility: utilityTotal / workload.length - commitmentPenalty,
    };
  }

  function averagePolicyResults(results) {
    const average = (selector) =>
      results.reduce((total, result) => total + selector(result), 0) /
      results.length;
    return {
      shares: providers.map((_, index) =>
        average((result) => result.shares[index]),
      ),
      approvalRate: average((result) => result.approvalRate),
      meanLatency: average((result) => result.meanLatency),
      meanFeeBps: average((result) => result.meanFeeBps),
      utility: average((result) => result.utility),
    };
  }

  function runBenchmark() {
    if (processing) return;
    view.setBusy(true);

    const naiveTrials = [];
    const banditTrials = [];
    const antTrials = [];
    let antWinsBandit = 0;
    let antWinsNaive = 0;

    for (let scenario = 0; scenario < BENCHMARK_SCENARIOS; scenario++) {
      const workload = createBenchmarkWorkload(20260926 + scenario * 7919);
      const naiveResult = simulateOnlinePolicy(workload, "naive", null);
      const banditResult = simulateOnlinePolicy(workload, "bandit", null);
      const antResult = simulateOnlinePolicy(workload, "ants", null);
      naiveTrials.push(naiveResult);
      banditTrials.push(banditResult);
      antTrials.push(antResult);
      if (antResult.utility > banditResult.utility) antWinsBandit++;
      if (antResult.utility > naiveResult.utility) antWinsNaive++;
    }

    view.renderBenchmark({
      naive: averagePolicyResults(naiveTrials),
      bandit: averagePolicyResults(banditTrials),
      ants: averagePolicyResults(antTrials),
      scenarioCount: BENCHMARK_SCENARIOS,
      antWinsBandit,
      antWinsNaive,
      requestCount: BENCHMARK_REQUESTS * BENCHMARK_SCENARIOS,
    });
    view.setBusy(false);
    view.setMessage(
      `Benchmark complete · ants beat the bandit in ${antWinsBandit}/${BENCHMARK_SCENARIOS} scenarios`,
    );
  }

  function reset() {
    if (processing) return false;
    profileColonies.forEach((colony) => colony.reset());
    providerLoadShares = providers.map(() => 1 / providers.length);
    selectedProfileId = profiles[0].id;
    selectedCountryId = merchantCountries[0].id;
    selectedCurrencyId = settlementCurrencies[0].id;
    for (const provider of providers) {
      provider.latency = provider.baseLatency;
      provider.health = 99;
      provider.attempts = 0;
      provider.successes = 0;
      provider.failures = 0;
      provider.injected = false;
    }
    stats.payments = 0;
    stats.delivered = 0;
    stats.failovers = 0;
    nextPaymentId = 1;
    events.length = 0;
    view.clearRouteAnimation();
    view.setMessage("Simulation reset");
    view.render();
    return true;
  }

  function start() {
    view.render();
  }

  function formatId(paymentId) {
    return String(paymentId).padStart(3, "0");
  }

  return {
    processPayment,
    reset,
    setProfile,
    setMarketContext,
    runBenchmark,
    setInjectedOutage,
    setProviderConfig,
    setMessage: view.setMessage,
    start,
  };
}
