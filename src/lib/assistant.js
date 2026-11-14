import { supabase, supabaseAnonKey, supabaseUrl } from "./supabaseClient.js";

const maxHistory = 12;

export function initAssistant() {
  const root = document.getElementById("erp-assistant");
  if (!root || root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";

  const panel = root.querySelector(".assistant-panel");
  const messages = root.querySelector(".assistant-messages");
  const form = root.querySelector(".assistant-form");
  const input = root.querySelector(".assistant-input");
  const sendButton = root.querySelector(".assistant-send");
  const status = root.querySelector(".assistant-status");
  const history = [];
  let isLoading = false;
  let pendingAction = null;
  let pendingCard = null;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const scrollToLatest = () => { messages.scrollTop = messages.scrollHeight; };
  const setOpen = (open) => {
    root.classList.toggle("is-open", open);
    panel.hidden = !open;
    if (open) window.setTimeout(() => input.focus(), 0);
  };
  const addMessage = (role, text, kind = "") => {
    const bubble = document.createElement("div");
    bubble.className = `assistant-message ${role} ${kind}`.trim();
    bubble.textContent = text;
    messages.appendChild(bubble);
    scrollToLatest();
  };
  const addPendingCard = (action) => {
    pendingCard?.remove();
    pendingCard = document.createElement("div");
    pendingCard.className = "assistant-pending-card";
    const fields = (action.fields || []).map((field) => `<div><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(field.value)}</strong></div>`).join("");
    pendingCard.innerHTML = `<strong class="assistant-pending-title">${escapeHtml(action.title || "Proposed record")}</strong><div class="assistant-pending-fields">${fields}</div><div class="assistant-pending-actions"><button type="button" class="button button-outline assistant-cancel" data-assistant-action="cancel-pending">Cancel</button><button type="button" class="button button-primary assistant-confirm" data-assistant-action="confirm-pending">Confirm</button></div>`;
    messages.appendChild(pendingCard);
    scrollToLatest();
  };
  const setLoading = (loading) => {
    isLoading = loading;
    sendButton.disabled = loading;
    input.disabled = loading;
    status.hidden = !loading;
  };
  const requestAssistant = async (body) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 55000);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch(`${supabaseUrl}/functions/v1/erp-assistant`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          apikey: supabaseAnonKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The assistant could not complete that request.");
      return result;
    } finally {
      window.clearTimeout(timeout);
    }
  };
  const ask = async (question) => {
    const content = question.trim();
    if (!content || isLoading) return;
    if (pendingAction) {
      addMessage("assistant", "Please choose Confirm or Cancel for the pending action before starting another request.", "error");
      return;
    }
    addMessage("user", content);
    history.push({ role: "user", content });
    while (history.length > maxHistory) history.shift();
    input.value = "";
    setLoading(true);
    try {
      const result = await requestAssistant({ messages: history });
      if (!result.message) throw new Error("The assistant returned no usable response.");
      history.push({ role: "assistant", content: result.message });
      while (history.length > maxHistory) history.shift();
      addMessage("assistant", result.message);
      if (result.pendingAction?.token) {
        pendingAction = result.pendingAction;
        addPendingCard(pendingAction);
      }
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "The assistant took too long to respond. Please try again."
        : error instanceof Error ? error.message : "The assistant could not respond right now.";
      addMessage("assistant", message, "error");
    } finally {
      setLoading(false);
      input.focus();
    }
  };
  const confirmPending = async () => {
    if (!pendingAction || isLoading) return;
    setLoading(true);
    pendingCard?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      const result = await requestAssistant({ requestType: "confirm", confirmationToken: pendingAction.token });
      pendingCard?.remove();
      pendingCard = null;
      pendingAction = null;
      addMessage("assistant", result.message || "The record was created.");
      history.push({ role: "assistant", content: result.message || "The record was created." });
      while (history.length > maxHistory) history.shift();
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "The confirmation took too long to complete. Please try again."
        : error instanceof Error ? error.message : "The record could not be created.";
      addMessage("assistant", message, "error");
      pendingCard?.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    } finally {
      setLoading(false);
      input.focus();
    }
  };
  const cancelPending = () => {
    if (!pendingAction || isLoading) return;
    pendingCard?.remove();
    pendingCard = null;
    pendingAction = null;
    addMessage("assistant", "Cancelled. Nothing was saved.");
  };

  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-assistant-action]")?.dataset.assistantAction;
    if (action === "open") setOpen(true);
    if (action === "close") setOpen(false);
    if (action === "confirm-pending") confirmPending();
    if (action === "cancel-pending") cancelPending();
    if (action === "clear") {
      pendingCard?.remove();
      pendingCard = null;
      pendingAction = null;
      history.length = 0;
      messages.innerHTML = "";
      addMessage("assistant", "Hi! I can help you understand the ERP and find your way around it.");
      root.querySelectorAll(".assistant-suggestion").forEach((button) => { button.hidden = false; });
    }
    const suggestion = event.target.closest(".assistant-suggestion");
    if (suggestion) {
      suggestion.hidden = true;
      ask(suggestion.textContent);
    }
  });
  form.addEventListener("submit", (event) => { event.preventDefault(); ask(input.value); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
}
