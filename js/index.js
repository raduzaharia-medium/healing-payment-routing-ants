import { createPaymentFlow } from "./payment-flow.js";

const payments = createPaymentFlow();
const sendButton = document.getElementById("sendPayment");
const failedPaymentButton = document.getElementById("sendFailedPayment");
const resetButton = document.getElementById("resetDemo");
const autoTraffic = document.getElementById("autoTraffic");
const transactionProfile = document.getElementById("transactionProfile");
const merchantCountry = document.getElementById("merchantCountry");
const settlementCurrency = document.getElementById("settlementCurrency");
let autoTimer;

sendButton.addEventListener("click", () => payments.processPayment());
failedPaymentButton.addEventListener("click", () =>
  payments.processPayment(true),
);
resetButton.addEventListener("click", () => {
  if (!payments.reset()) return;
  window.clearInterval(autoTimer);
  autoTraffic.checked = false;
  transactionProfile.value = "standard";
});
document
  .getElementById("runBenchmark")
  .addEventListener("click", () => payments.runBenchmark());

const sideColumn = document.querySelector(".side-column");

// Delegated so a fault-injection checkbox for a newly added provider works
// automatically, without needing its own addEventListener call wired up.
sideColumn.addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[type=checkbox][data-provider]");
  if (checkbox) {
    payments.setInjectedOutage(checkbox.dataset.provider, checkbox.checked);
  }
});

// Same reasoning for the per-provider config inputs: one delegated listener
// handles every current and future field, keyed off data-provider/data-field
// rather than a hand-maintained list of element ids.
sideColumn.addEventListener("input", (event) => {
  const input = event.target.closest("input[data-provider][data-field]");
  if (!input) return;
  const rawValue = Number(input.value);
  if (Number.isNaN(rawValue)) return;
  const value =
    input.dataset.field === "baseApprovalRate" ||
    input.dataset.field === "minVolumeCommitment"
      ? rawValue / 100
      : rawValue;
  payments.setProviderConfig(input.dataset.provider, input.dataset.field, value);
});

transactionProfile.addEventListener("change", () =>
  payments.setProfile(transactionProfile.value),
);
function updateMarketContext() {
  payments.setMarketContext(merchantCountry.value, settlementCurrency.value);
}
merchantCountry.addEventListener("change", updateMarketContext);
settlementCurrency.addEventListener("change", updateMarketContext);

autoTraffic.addEventListener("change", () => {
  window.clearInterval(autoTimer);
  if (autoTraffic.checked) {
    autoTimer = window.setInterval(() => payments.processPayment(), 1750);
    payments.setMessage("Automatic traffic running");
  } else {
    payments.setMessage("Automatic traffic paused");
  }
});

payments.start();
