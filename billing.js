const billingButtons = document.querySelectorAll("[data-plan]");
const billingStatus = document.getElementById("billingStatus");

billingButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    billingStatus.textContent = "Connecting to secure checkout…";

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ plan: button.dataset.plan }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Checkout is unavailable.");
      if (!result.checkoutUrl) throw new Error("The billing server did not return a checkout URL.");
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      billingStatus.textContent = error.message.includes("Failed to fetch")
        ? "Secure checkout is not configured yet. Add the server-side billing API before accepting payments."
        : error.message;
      button.disabled = false;
    }
  });
});
