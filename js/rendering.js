const svgNS = "http://www.w3.org/2000/svg";

export function createDashboardView({
  providers,
  profiles,
  stats,
  events,
  getRouting,
  getRecoveryCandidate,
  getMarketContext,
  getCommitmentStatus,
  getNaiveComparison,
}) {
  function render() {
    renderMetrics();
    renderProviders();
    renderEvents();
    renderRouting();
  }

  function renderMetrics() {
    document.getElementById("metricPayments").textContent = stats.payments;
    document.getElementById("metricDelivered").textContent = stats.delivered;
    document.getElementById("metricFailovers").textContent = stats.failovers;
    document.getElementById("metricRate").textContent = stats.payments
      ? `${Math.round((stats.delivered / stats.payments) * 100)}%`
      : "--";
  }

  function renderProviders() {
    const market = getMarketContext();
    const commitmentStatuses = getCommitmentStatus ? getCommitmentStatus() : [];
    providers.forEach((provider, providerIndex) => {
      const prefix = provider.id;
      const isEligible =
        provider.supportedCountries.includes(market.countryId) &&
        provider.supportedCurrencies.includes(market.currencyId);
      const status = !isEligible
        ? "UNSUPPORTED"
        : provider.injected
          ? "OUTAGE"
          : provider.health < 70
            ? "DEGRADED"
            : provider.health < 90
              ? "RECOVERING"
              : "HEALTHY";
      const card = document.getElementById(`provider-${prefix}`);
      const mapNode = document.getElementById(`mapNode-${prefix}`);
      card.classList.toggle(
        "is-degraded",
        provider.injected || provider.health < 45,
      );
      card.classList.toggle(
        "is-watch",
        !provider.injected && provider.health >= 45 && provider.health < 90,
      );
      card.classList.toggle("is-unavailable", !isEligible);
      mapNode.classList.toggle(
        "is-degraded",
        provider.injected || provider.health < 45,
      );
      mapNode.classList.toggle(
        "is-watch",
        !provider.injected && provider.health >= 45 && provider.health < 90,
      );
      mapNode.classList.toggle("is-unavailable", !isEligible);
      document
        .getElementById(`route-${provider.id}`)
        .classList.toggle("is-unavailable", !isEligible);
      document.getElementById(`${prefix}State`).textContent = status;
      document.getElementById(`${prefix}Health`).textContent = Math.round(
        provider.health,
      );
      document.getElementById(`${prefix}HealthBar`).style.width =
        `${provider.health}%`;
      document.getElementById(`${prefix}Latency`).textContent =
        `${provider.latency} ms`;
      document.getElementById(`${prefix}Success`).textContent =
        provider.successes;
      document.getElementById(`${prefix}Failures`).textContent =
        provider.failures;
      document.getElementById(`${prefix}MapStatus`).textContent = status;
      const controlName = `${prefix[0].toUpperCase()}${prefix.slice(1)}`;
      document.getElementById(`degrade${controlName}`).checked =
        provider.injected;
      document.getElementById(`${prefix}Capabilities`).textContent =
        `${provider.supportedCountries.join(" · ")} / ${provider.supportedCurrencies.join(" · ")}`;

      const commitmentEl = document.getElementById(`${prefix}Commitment`);
      const commitment = commitmentStatuses[providerIndex];
      if (commitmentEl) {
        if (commitment) {
          commitmentEl.textContent = `MIN VOLUME ${Math.round(commitment.minVolumeCommitment * 100)}% · CARRYING ${Math.round(commitment.currentShare * 100)}% · ${commitment.met ? "MET" : "SHORTFALL"}`;
          commitmentEl.classList.toggle("is-breached", !commitment.met);
          commitmentEl.hidden = false;
        } else {
          commitmentEl.hidden = true;
        }
      }
    });
  }

  function renderEvents() {
    const list = document.getElementById("eventList");
    document.getElementById("activityCount").textContent =
      `${events.length} EVENT${events.length === 1 ? "" : "S"}`;
    list.replaceChildren();

    if (events.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-event";
      empty.textContent = "No payment activity yet";
      list.append(empty);
      return;
    }

    for (const event of events) {
      const item = document.createElement("li");
      const mark = document.createElement("span");
      const copy = document.createElement("span");
      const title = document.createElement("span");
      const detail = document.createElement("span");
      const time = document.createElement("time");
      item.className = `is-${event.kind}`;
      mark.className = "event-mark";
      copy.className = "event-copy";
      title.className = "event-title";
      title.textContent = event.title;
      detail.className = "event-detail";
      detail.textContent = event.detail;
      time.className = "event-time";
      time.textContent = event.time;
      copy.append(title, detail);
      item.append(mark, copy, time);
      list.append(item);
    }
  }

  function renderRouting() {
    const routing = getRouting();
    document.getElementById("swarmProfileName").textContent =
      routing.profileName.toUpperCase();
    document.getElementById("transactionProfile").value = routing.profileId;
    const market = getMarketContext();
    document.getElementById("merchantCountry").value = market.countryId;
    document.getElementById("settlementCurrency").value = market.currencyId;
    const allocation = routing.shares
      .map(
        (share, index) =>
          `${providers[index].shortName} ${Math.round(share * 100)}%`,
      )
      .join(" / ");
    const recoveryCandidate = getRecoveryCandidate();
    document.getElementById("routeDecision").textContent =
      `Trail mix: ${allocation}`;
    const nextAction = recoveryCandidate
      ? `Next payment probes ${recoveryCandidate.name}.`
      : "Next payment follows the strongest trails.";
    document.getElementById("decisionDetail").textContent =
      `${routing.profileName} · ${market.countryId}/${market.currencyId} · ${allocation}. ${nextAction}`;
    renderNaiveComparison();
    renderRoutePheromones(routing.shares);
    renderPheromoneChart(routing.pheromones, routing.shares);
  }

  function renderNaiveComparison() {
    const naiveEl = document.getElementById("naiveComparison");
    if (!naiveEl || !getNaiveComparison) return;
    const { provider, isEligibleHere } = getNaiveComparison();
    naiveEl.textContent = isEligibleHere
      ? `A naive "always use the best single provider" rule would send every payment to ${provider.name}.`
      : `A naive "always use the best single provider" rule would send every payment to ${provider.name} — which doesn't even support this merchant's market.`;
    naiveEl.classList.toggle("is-broken", !isEligibleHere);
  }

  function renderRoutePheromones(shares) {
    providers.forEach((provider, index) => {
      const path = document.getElementById(`route-${provider.id}`);
      if (!path) return;
      const strength = shares[index];
      path.style.strokeWidth = `${(1.5 + strength * 7).toFixed(2)}px`;
      path.style.opacity = `${(0.35 + strength * 0.65).toFixed(2)}`;
    });
  }

  const PHEROMONE_CHART_AXIS_LEFT = 96;
  const PHEROMONE_CHART_AXIS_RIGHT = 460;
  const PHEROMONE_CHART_ROW_HEIGHT = 46;
  const PHEROMONE_CHART_FIRST_ROW_Y = 34;

  function renderPheromoneChart(pheromones, shares) {
    document.getElementById("swarmAllocation").textContent = shares
      .map(
        (share, index) =>
          `${providers[index].shortName.toUpperCase()} ${Math.round(share * 100)}%`,
      )
      .join(" / ");

    const container = document.getElementById("pheromoneChartRows");
    if (!container) return;
    const axisSpan = PHEROMONE_CHART_AXIS_RIGHT - PHEROMONE_CHART_AXIS_LEFT;
    const maxPheromone = Math.max(1, ...pheromones);

    while (container.children.length < providers.length) {
      const row = document.createElementNS(svgNS, "g");
      row.classList.add("pheromone-row");

      const track = document.createElementNS(svgNS, "line");
      track.classList.add("pheromone-row-track");
      track.setAttribute("x1", PHEROMONE_CHART_AXIS_LEFT);
      track.setAttribute("x2", PHEROMONE_CHART_AXIS_RIGHT);
      row.append(track);

      const bar = document.createElementNS(svgNS, "line");
      bar.classList.add("pheromone-row-bar");
      bar.setAttribute("x1", PHEROMONE_CHART_AXIS_LEFT);
      row.append(bar);

      const label = document.createElementNS(svgNS, "text");
      label.classList.add("swarm-row-label");
      label.setAttribute("x", 4);
      row.append(label);

      const readout = document.createElementNS(svgNS, "text");
      readout.classList.add("swarm-row-readout");
      readout.setAttribute("x", PHEROMONE_CHART_AXIS_RIGHT + 14);
      row.append(readout);

      container.append(row);
    }

    providers.forEach((provider, providerIndex) => {
      const rowY =
        PHEROMONE_CHART_FIRST_ROW_Y + providerIndex * PHEROMONE_CHART_ROW_HEIGHT;
      const row = container.children[providerIndex];
      const share = shares[providerIndex];
      const pheromoneWidth =
        (pheromones[providerIndex] / maxPheromone) * axisSpan;

      const track = row.querySelector(".pheromone-row-track");
      track.setAttribute("y1", rowY);
      track.setAttribute("y2", rowY);

      const bar = row.querySelector(".pheromone-row-bar");
      bar.setAttribute("y1", rowY);
      bar.setAttribute("y2", rowY);
      bar.setAttribute("x2", PHEROMONE_CHART_AXIS_LEFT + pheromoneWidth);
      bar.classList.toggle("is-leader", share === Math.max(...shares));

      const label = row.querySelector(".swarm-row-label");
      label.setAttribute("y", rowY + 4);
      label.textContent = provider.shortName;

      const readout = row.querySelector(".swarm-row-readout");
      readout.setAttribute("y", rowY + 4);
      readout.textContent = `${Math.round(share * 100)}%`;
    });
  }

  function renderBenchmark(result) {
    renderPolicyResult("naive", result.naive);
    renderPolicyResult("bandit", result.bandit);
    renderPolicyResult("ants", result.ants);
    const utilityDelta = result.ants.utility - result.bandit.utility;
    const approvalDelta =
      (result.ants.approvalRate - result.bandit.approvalRate) * 100;
    const summary = document.getElementById("benchmarkSummary");
    summary.classList.toggle("is-better", utilityDelta > 0);
    summary.classList.toggle("is-worse", utilityDelta < 0);
    const meanResult =
      Math.abs(utilityDelta) < 0.0005
        ? "mean utility was effectively tied with the bandit"
        : `${utilityDelta > 0 ? "mean utility exceeded" : "mean utility trailed"} the bandit by ${Math.abs(utilityDelta).toFixed(5)} per request`;
    summary.textContent = `Across ${result.scenarioCount} paired scenarios (${result.requestCount.toLocaleString()} requests per policy, all three learning online from the same simulated traffic), the ant colony ${meanResult}, and beat it in ${result.antWinsBandit}/${result.scenarioCount} scenarios. Versus the naive static rule: won ${result.antWinsNaive}/${result.scenarioCount} scenarios. Approval delta versus the bandit: ${approvalDelta >= 0 ? "+" : ""}${approvalDelta.toFixed(2)} points.`;
  }

  function renderPolicyResult(prefix, result) {
    document.getElementById(`${prefix}Mix`).textContent = result.shares
      .map(
        (share, providerIndex) =>
          `${providers[providerIndex].shortName} ${Math.round(share * 100)}%`,
      )
      .join(" / ");
    document.getElementById(`${prefix}Approval`).textContent =
      `${(result.approvalRate * 100).toFixed(1)}%`;
    document.getElementById(`${prefix}Latency`).textContent =
      `${Math.round(result.meanLatency)} ms`;
    document.getElementById(`${prefix}Fee`).textContent =
      `${result.meanFeeBps.toFixed(0)} bps`;
    document.getElementById(`${prefix}Utility`).textContent =
      result.utility.toFixed(5);
  }

  function setMessage(message, kind = "success") {
    const output = document.getElementById("liveMessage");
    output.textContent = message;
    output.classList.toggle("is-warning", kind === "warning");
    output.classList.toggle("is-error", kind === "error");
  }

  function setBusy(isBusy) {
    for (const id of [
      "sendPayment",
      "sendFailedPayment",
      "resetDemo",
      "runBenchmark",
    ]) {
      document.getElementById(id).disabled = isBusy;
    }
  }

  function clearRouteAnimation() {
    document
      .querySelectorAll(".route-line")
      .forEach((line) => line.classList.remove("is-active", "is-retry"));
    document
      .getElementById("paymentPacket")
      .setAttribute("visibility", "hidden");
  }

  function animatePacket(providerId) {
    const path = document.getElementById(`route-${providerId}`);
    const packet = document.getElementById("paymentPacket");
    document
      .querySelectorAll(".route-line")
      .forEach((line) => line.classList.remove("is-active", "is-retry"));
    path.classList.add("is-active");
    packet.setAttribute("visibility", "visible");

    const pathLength = path.getTotalLength();
    const start = performance.now();
    const duration = 640;

    return new Promise((resolve) => {
      const finish = () => {
        packet.setAttribute("visibility", "hidden");
        resolve();
      };

      if (
        document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        const point = path.getPointAtLength(pathLength);
        packet.setAttribute("cx", point.x);
        packet.setAttribute("cy", point.y);
        finish();
        return;
      }

      function movePacket(now) {
        const progress = Math.min(1, (now - start) / duration);
        const easedProgress =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const point = path.getPointAtLength(pathLength * easedProgress);
        packet.setAttribute("cx", point.x);
        packet.setAttribute("cy", point.y);

        if (progress < 1) {
          requestAnimationFrame(movePacket);
        } else {
          finish();
        }
      }

      requestAnimationFrame(movePacket);
    });
  }

  return {
    animatePacket,
    clearRouteAnimation,
    render,
    renderRouting,
    renderBenchmark,
    setBusy,
    setMessage,
  };
}
